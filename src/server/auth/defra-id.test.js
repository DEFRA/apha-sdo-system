import { vi } from 'vitest'
import * as openid from 'openid-client'

const mocks = vi.hoisted(() => ({
  createOidcConfig: vi.fn(),
  postLogin: vi.fn(),
  ensureValidToken: vi.fn()
}))

vi.mock('@defra/hapi-auth-oidc', async (importOriginal) => ({
  ...(await importOriginal()),
  createOidcConfig: mocks.createOidcConfig,
  postLogin: mocks.postLogin,
  ensureValidToken: mocks.ensureValidToken
}))

const { DEFRA_ID_STATE_COOKIE_NAME } = await import('./auth-constants.js')
const {
  clearDefraIdOidcConfigCache,
  completeDefraIdLogin,
  ensureValidDefraIdToken,
  getDefraIdEndSessionEndpoint,
  getDefraIdOidcConfig,
  getDefraIdOrigins,
  isDefraIdEnabled,
  startDefraIdLogin,
  validateDefraIdConfiguration
} = await import('./defra-id.js')

const settings = {
  enabled: true,
  discoveryUrl:
    'https://your-account.example/idphub/b2c/policy/.well-known/openid-configuration',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  serviceId: 'service-id',
  scopes: 'openid offline_access client-id',
  earlyRefreshMs: 300000
}

// Customer Identity publishes discovery from one host and authorizes on
// another, and, being Azure AD B2C, does not advertise PKCE support
function createOidcConfiguration(metadata = {}) {
  return new openid.Configuration(
    {
      issuer: 'https://tenant.b2clogin.example/tenant-guid/v2.0/',
      authorization_endpoint: 'https://tenant.b2clogin.example/authorize',
      token_endpoint: 'https://tenant.b2clogin.example/token',
      end_session_endpoint:
        'https://your-account.example/idphub/b2c/policy/signout',
      ...metadata
    },
    'client-id',
    {
      client_secret: 'client-secret',
      token_endpoint_auth_method: 'client_secret_post'
    }
  )
}

function createToolkit() {
  const response = {}
  response.state = vi.fn(() => response)

  return {
    response,
    redirect: vi.fn(() => response),
    unstate: vi.fn()
  }
}

beforeEach(() => {
  clearDefraIdOidcConfigCache()
  mocks.createOidcConfig.mockReset()
  mocks.postLogin.mockReset()
  mocks.ensureValidToken.mockReset()
  mocks.createOidcConfig.mockResolvedValue(createOidcConfiguration())
})

describe('isDefraIdEnabled', () => {
  test('reads the enabled flag', () => {
    expect(isDefraIdEnabled({ enabled: true })).toBe(true)
    expect(isDefraIdEnabled({ enabled: false })).toBe(false)
  })
})

describe('getDefraIdOidcConfig', () => {
  test('discovers once per client with the client secret', async () => {
    const first = await getDefraIdOidcConfig({ settings })
    const second = await getDefraIdOidcConfig({ settings })

    expect(second).toBe(first)
    expect(mocks.createOidcConfig).toHaveBeenCalledTimes(1)

    const options = mocks.createOidcConfig.mock.calls[0][0]
    expect(options).toMatchObject({
      discoveryUri: settings.discoveryUrl,
      clientId: 'client-id',
      authProvider: { type: 'client_secret' },
      discoveryRequestOptions: {}
    })
    await expect(options.authProvider.getCredentials()).resolves.toBe(
      'client-secret'
    )
  })

  test('allows plain http only for the local stub', async () => {
    await getDefraIdOidcConfig({
      settings: {
        ...settings,
        discoveryUrl:
          'http://localhost:3200/cdp-defra-id-stub/.well-known/openid-configuration'
      }
    })

    expect(
      mocks.createOidcConfig.mock.calls[0][0].discoveryRequestOptions.execute
    ).toEqual([openid.allowInsecureRequests])
  })

  test('rediscovers after a failure and when the settings change', async () => {
    mocks.createOidcConfig.mockRejectedValueOnce(new Error('unreachable'))

    await expect(getDefraIdOidcConfig({ settings })).rejects.toThrow(
      'unreachable'
    )
    await expect(getDefraIdOidcConfig({ settings })).resolves.toBeDefined()
    await getDefraIdOidcConfig({
      settings: { ...settings, clientId: 'other-client' }
    })

    expect(mocks.createOidcConfig).toHaveBeenCalledTimes(3)
  })
})

describe('startDefraIdLogin', () => {
  test('redirects to the authorize endpoint with PKCE, state and serviceId', async () => {
    const h = createToolkit()

    const response = await startDefraIdLogin(h, {
      settings,
      appBaseUrl: 'https://service.example',
      browserSettings: { responseMode: 'form_post', sameSite: 'None' }
    })

    expect(response).toBe(h.response)

    const url = new URL(h.redirect.mock.calls[0][0])
    const params = url.searchParams
    const [cookieName, cookieValue] = h.response.state.mock.calls[0]

    expect(url.origin + url.pathname).toBe(
      'https://tenant.b2clogin.example/authorize'
    )
    expect(params.get('client_id')).toBe('client-id')
    expect(params.get('response_type')).toBe('code')
    expect(params.get('redirect_uri')).toBe(
      'https://service.example/signin-defra-id'
    )
    expect(params.get('scope')).toBe('openid offline_access client-id')
    expect(params.get('serviceId')).toBe('service-id')
    expect(params.get('response_mode')).toBe('form_post')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBe(
      await openid.calculatePKCECodeChallenge(cookieValue.codeVerifier)
    )
    expect(cookieName).toBe(DEFRA_ID_STATE_COOKIE_NAME)
    // PKCE and state bind the code; no nonce, which the stub would drop
    expect(params.has('nonce')).toBe(false)
    expect(cookieValue).toEqual({
      codeVerifier: expect.any(String),
      state: params.get('state')
    })
  })

  test('accepts comma-separated scopes, as CDP configuration fields take no spaces', async () => {
    const h = createToolkit()

    await startDefraIdLogin(h, {
      settings: { ...settings, scopes: 'openid,offline_access,client-id' },
      appBaseUrl: 'https://service.example',
      browserSettings: { responseMode: 'form_post', sameSite: 'None' }
    })

    expect(new URL(h.redirect.mock.calls[0][0]).searchParams.get('scope')).toBe(
      'openid offline_access client-id'
    )
  })

  test('omits serviceId when there is none and response_mode for the query default', async () => {
    const h = createToolkit()

    // Locally the response comes back in the query string, the protocol
    // default; the stub rejects an explicit response_mode parameter
    await startDefraIdLogin(h, {
      settings: { ...settings, serviceId: '' },
      appBaseUrl: 'http://localhost:3000',
      browserSettings: { responseMode: 'query', sameSite: 'Lax' }
    })

    const params = new URL(h.redirect.mock.calls[0][0]).searchParams

    expect(params.has('serviceId')).toBe(false)
    expect(params.has('response_mode')).toBe(false)
  })
})

describe('completeDefraIdLogin', () => {
  const record = { codeVerifier: 'verifier', state: 'state' }
  const token = { accessToken: 'access', idToken: 'id', claims: {} }

  function createRequest(overrides = {}) {
    return {
      method: 'get',
      url: new URL(
        'http://127.0.0.1:3000/signin-defra-id?code=abc&state=state'
      ),
      payload: null,
      state: { [DEFRA_ID_STATE_COOKIE_NAME]: record },
      logger: { info: vi.fn(), warn: vi.fn() },
      ...overrides
    }
  }

  test('completes a query callback against the external URL and clears the state cookie', async () => {
    mocks.postLogin.mockResolvedValue(token)
    const h = createToolkit()

    await expect(
      completeDefraIdLogin(createRequest(), h, {
        settings,
        appBaseUrl: 'https://service.example'
      })
    ).resolves.toBe(token)

    const call = mocks.postLogin.mock.calls[0][0]
    expect(call).toMatchObject({
      codeVerifier: 'verifier',
      state: 'state'
    })
    expect(call.nonce).toBeUndefined()
    expect(call.currentUrl.toString()).toBe(
      'https://service.example/signin-defra-id?code=abc&state=state'
    )
    expect(h.unstate).toHaveBeenCalledWith(DEFRA_ID_STATE_COOKIE_NAME)
  })

  test('carries a form_post response in the URL it validates', async () => {
    mocks.postLogin.mockResolvedValue(token)

    await completeDefraIdLogin(
      createRequest({
        method: 'post',
        url: new URL('http://127.0.0.1:3000/signin-defra-id'),
        payload: { code: 'posted-code', state: 'state', ignored: 1 }
      }),
      createToolkit(),
      { settings, appBaseUrl: 'https://service.example' }
    )

    const currentUrl = mocks.postLogin.mock.calls[0][0].currentUrl

    expect(currentUrl.searchParams.get('code')).toBe('posted-code')
    expect(currentUrl.searchParams.get('state')).toBe('state')
    expect(currentUrl.searchParams.has('ignored')).toBe(false)
  })

  test('clears the state cookie even when validation fails', async () => {
    mocks.postLogin.mockRejectedValue(new Error('state mismatch'))
    const h = createToolkit()

    await expect(
      completeDefraIdLogin(createRequest({ state: {} }), h, {
        settings,
        appBaseUrl: 'https://service.example'
      })
    ).rejects.toThrow('state mismatch')
    expect(mocks.postLogin.mock.calls[0][0]).toMatchObject({
      codeVerifier: undefined,
      state: undefined
    })
    expect(h.unstate).toHaveBeenCalledWith(DEFRA_ID_STATE_COOKIE_NAME)
  })
})

describe('ensureValidDefraIdToken', () => {
  test('refreshes through the shared helper with the Defra ID configuration', async () => {
    const token = { accessToken: 'access', refreshToken: 'refresh' }
    const result = { token, refreshed: false }
    const logger = { info: vi.fn() }
    mocks.ensureValidToken.mockResolvedValue(result)

    await expect(
      ensureValidDefraIdToken(token, { settings, logger })
    ).resolves.toBe(result)

    const [givenToken, getOidcConfig, earlyRefreshMs, scope, givenLogger] =
      mocks.ensureValidToken.mock.calls[0]
    expect(givenToken).toBe(token)
    expect(earlyRefreshMs).toBe(300000)
    expect(scope).toBe('openid offline_access client-id')
    expect(givenLogger).toBe(logger)
    await expect(getOidcConfig()).resolves.toBeInstanceOf(openid.Configuration)
  })
})

describe('discovery-derived values', () => {
  test('reads the end-session endpoint', async () => {
    await expect(getDefraIdEndSessionEndpoint({ settings })).resolves.toBe(
      'https://your-account.example/idphub/b2c/policy/signout'
    )
  })

  test('lists the distinct provider origins for the content security policy', async () => {
    await expect(getDefraIdOrigins({ settings })).resolves.toEqual([
      'https://your-account.example',
      'https://tenant.b2clogin.example'
    ])
  })
})

describe('validateDefraIdConfiguration', () => {
  test('does nothing when the provider is disabled', () => {
    expect(() =>
      validateDefraIdConfiguration({
        settings: { enabled: false },
        isCdp: true
      })
    ).not.toThrow()
  })

  test('accepts a complete CDP configuration', () => {
    expect(() =>
      validateDefraIdConfiguration({ settings, isCdp: true })
    ).not.toThrow()
    expect(() =>
      validateDefraIdConfiguration({
        settings: { ...settings, scopes: 'openid,offline_access,client-id' },
        isCdp: true
      })
    ).not.toThrow()
  })

  test('requires the essentials everywhere', () => {
    expect(() =>
      validateDefraIdConfiguration({
        settings: {
          enabled: true,
          discoveryUrl: '',
          clientId: '',
          clientSecret: ''
        },
        isCdp: false
      })
    ).toThrow(
      /AUTH_DEFRA_ID_OIDC_CONFIGURATION_URL is required.*AUTH_DEFRA_ID_CLIENT_ID is required.*AUTH_DEFRA_ID_CLIENT_SECRET is required/
    )
  })

  test('accepts the local stub off CDP', () => {
    expect(() =>
      validateDefraIdConfiguration({
        settings: {
          ...settings,
          discoveryUrl:
            'http://localhost:3200/cdp-defra-id-stub/.well-known/openid-configuration',
          serviceId: '',
          scopes: 'openid offline_access'
        },
        isCdp: false
      })
    ).not.toThrow()
  })

  test('refuses the stub, http, a missing service ID and missing client scope on CDP', () => {
    expect(() =>
      validateDefraIdConfiguration({
        settings: {
          ...settings,
          discoveryUrl:
            'http://localhost:3200/cdp-defra-id-stub/.well-known/openid-configuration',
          serviceId: '',
          scopes: 'openid offline_access'
        },
        isCdp: true
      })
    ).toThrow(
      /must use HTTPS on CDP.*cdp-defra-id-stub is not allowed on CDP.*AUTH_DEFRA_ID_SERVICE_ID is required on CDP.*must include the client ID on CDP/
    )
  })
})
