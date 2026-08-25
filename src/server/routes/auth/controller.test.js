import { vi } from 'vitest'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { buildEndSessionUrl } from './controller.js'

function getCookieValue(response, name) {
  const setCookieHeaders = [response.headers['set-cookie']].flat()
  const cookie = setCookieHeaders.find((header) =>
    header?.startsWith(`${name}=`)
  )

  return cookie?.split(';')[0].split('=')[1]
}

function getCookieHeader(response, name) {
  const setCookieHeaders = [response.headers['set-cookie']].flat()
  return setCookieHeaders.find((header) => header?.startsWith(`${name}=`))
}

function getCookiePair(response, name) {
  return getCookieHeader(response, name)?.split(';')[0]
}

describe('auth routes', () => {
  let server

  const accessToken = [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url'
    ),
    Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url'),
    ''
  ].join('.')

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  // The test environment restricts the service to a group, so tests that are
  // not about authorization start from an unrestricted service.
  beforeEach(() => {
    config.set('auth.entraId.allowedGroupIds', [])
  })

  afterEach(() => {
    config.set('auth.entraId.allowedGroupIds', [])
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mockCallback(claims = {}) {
    return vi
      .spyOn(server.plugins['hapi-auth-oidc'].oidc, 'callback')
      .mockResolvedValue({
        accessToken,
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        claims: {
          oid: 'user-id',
          name: 'A Person',
          preferred_username: 'person@example.gov.uk',
          ...claims
        }
      })
  }

  function mockLogin() {
    return vi
      .spyOn(server.plugins['hapi-auth-oidc'].oidc, 'login')
      .mockImplementation(async (_request, h) =>
        h.redirect('https://login.example/authorize')
      )
  }

  /**
   * Completes a callback and returns the cookies a signed-in browser would hold
   */
  async function signIn(claims) {
    mockCallback(claims)

    const response = await server.inject(
      '/signin-entra-id?code=code&state=state'
    )

    return {
      response,
      cookie: getCookiePair(response, 'userSession')
    }
  }

  async function postSignInChoose(payload = {}, url = '/sign-in-choose') {
    const getResponse = await server.inject({ method: 'GET', url })
    const crumb = getCookieValue(getResponse, 'crumb')

    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: `crumb=${crumb}` },
      payload: { ...payload, crumb }
    })
  }

  describe('GET /sign-in-choose', () => {
    test('Should render both sign-in options', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/sign-in-choose'
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('How do you want to sign in?')
      )
      expect(result).toEqual(expect.stringContaining('Defra Single Sign-on'))
      expect(result).toEqual(
        expect.stringContaining('Government Gateway or GOV.UK One Login')
      )
    })

    test('carries the requested page through the form', async () => {
      const { result } = await server.inject(
        '/sign-in-choose?redirect=%2Fbat-rabies'
      )

      expect(result).toContain(
        '<input type="hidden" name="redirect" value="/bat-rabies">'
      )
    })

    test('does not carry an off-site page through the form', async () => {
      const { result } = await server.inject(
        '/sign-in-choose?redirect=https%3A%2F%2Fevil.test'
      )

      expect(result).not.toContain('name="redirect"')
    })
  })

  describe('POST /sign-in-choose', () => {
    test('Should redirect to Entra when Defra Single Sign-on is selected', async () => {
      const { statusCode, headers } = await postSignInChoose({
        authProvider: 'defraId'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/sign-in-entra')
    })

    test('Should redirect to the external sign-in placeholder when selected', async () => {
      const { statusCode, headers } = await postSignInChoose({
        authProvider: 'external'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/sign-in-external')
    })

    test('Should redirect back to the chooser when no option is selected', async () => {
      const { statusCode, headers } = await postSignInChoose()

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/sign-in-choose')
    })

    test('keeps the requested page when continuing to Entra', async () => {
      const { headers } = await postSignInChoose({
        authProvider: 'defraId',
        redirect: '/bat-rabies/report-date'
      })

      expect(headers.location).toBe(
        '/sign-in-entra?redirect=%2Fbat-rabies%2Freport-date'
      )
    })

    test('keeps the requested page when redisplaying an error', async () => {
      const { headers } = await postSignInChoose({ redirect: '/bat-rabies' })

      expect(headers.location).toBe('/sign-in-choose?redirect=%2Fbat-rabies')
    })

    test('discards an off-site requested page', async () => {
      const { headers } = await postSignInChoose({
        authProvider: 'defraId',
        redirect: '//evil.test'
      })

      expect(headers.location).toBe('/sign-in-entra')
    })
  })

  describe('GET /sign-in-external', () => {
    test('Should render the external sign-in placeholder page', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/sign-in-external'
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('External sign-in is not available yet')
      )
    })
  })

  describe('Entra OIDC routes', () => {
    test('starts the Entra login flow', async () => {
      mockLogin()

      const response = await server.inject('/sign-in-entra')

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe('https://login.example/authorize')
    })

    test('returns to the chooser when Entra cannot be reached', async () => {
      vi.spyOn(
        server.plugins['hapi-auth-oidc'].oidc,
        'login'
      ).mockRejectedValue(new Error('discovery unavailable'))

      const response = await server.inject('/sign-in-entra')

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe('/sign-in-choose')
    })

    test('creates a server-side session after a valid callback', async () => {
      const { response: callbackResponse, cookie } = await signIn()

      expect(callbackResponse.statusCode).toBe(statusCodes.redirect)
      expect(callbackResponse.headers.location).toBe('/submission-welcome')
      expect(cookie).toBeDefined()

      const protectedResponse = await server.inject({
        url: '/submission-welcome',
        headers: { cookie }
      })

      expect(protectedResponse.statusCode).toBe(statusCodes.ok)
      expect(protectedResponse.result).toContain('Sign out')
    })

    test('returns to the chooser after a failed callback', async () => {
      vi.spyOn(
        server.plugins['hapi-auth-oidc'].oidc,
        'callback'
      ).mockRejectedValue(new Error('invalid callback'))

      const response = await server.inject(
        '/signin-entra-id?error=access_denied'
      )

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe('/sign-in-choose')
    })

    test('accepts a form_post callback without a CSRF crumb', async () => {
      mockCallback()

      const response = await server.inject({
        method: 'POST',
        url: '/signin-entra-id',
        payload: {
          code: 'code',
          state: 'state'
        }
      })

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe('/submission-welcome')
      expect(getCookieHeader(response, 'userSession')).toBeDefined()
    })

    test('sends the user back to the page that triggered sign-in', async () => {
      mockLogin()

      const loginResponse = await server.inject(
        '/sign-in-entra?redirect=%2Fbat-rabies'
      )
      const returnToCookie = getCookiePair(loginResponse, 'signInReturnTo')

      expect(returnToCookie).toBeDefined()

      mockCallback()

      const callbackResponse = await server.inject({
        url: '/signin-entra-id?code=code&state=state',
        headers: { cookie: returnToCookie }
      })

      expect(callbackResponse.headers.location).toBe('/bat-rabies')
    })

    test('does not remember an off-site page', async () => {
      mockLogin()

      const loginResponse = await server.inject(
        '/sign-in-entra?redirect=https%3A%2F%2Fevil.test%2Fphish'
      )

      expect(getCookieHeader(loginResponse, 'signInReturnTo')).toBeUndefined()
    })
  })

  describe('pages that only make sense when signed out', () => {
    test.each([
      '/sign-in-choose',
      '/sign-in-external',
      '/sign-in-entra',
      '/signed-out'
    ])('%s sends a signed-in user to their submissions', async (url) => {
      const { cookie } = await signIn()
      const login = mockLogin()

      const response = await server.inject({ url, headers: { cookie } })

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe('/submission-welcome')
      // A second handshake would replace the session the user already has
      expect(login).not.toHaveBeenCalled()
    })

    test('sends a signed-in user on to the page they asked for', async () => {
      const { cookie } = await signIn()

      const response = await server.inject({
        url: '/sign-in-choose?redirect=%2Fbat-rabies',
        headers: { cookie }
      })

      expect(response.headers.location).toBe('/bat-rabies')
    })

    test('still renders for a signed-out user', async () => {
      const response = await server.inject('/signed-out')

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(response.result).toContain('You have signed out')
    })
  })

  describe('authorization', () => {
    test('sends a user outside the configured groups to the no access page', async () => {
      config.set('auth.entraId.allowedGroupIds', ['allowed-group'])

      const { response } = await signIn({ groups: ['other-group'] })

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe('/no-access')
      expect(getCookieHeader(response, 'userSession')).toBeUndefined()

      const noAccessResponse = await server.inject({
        url: '/no-access',
        headers: { cookie: getCookiePair(response, 'session') }
      })

      expect(noAccessResponse.statusCode).toBe(statusCodes.forbidden)
      expect(noAccessResponse.result).toContain(
        'You do not have access to this service'
      )
      expect(noAccessResponse.result).toContain('person@example.gov.uk')
    })

    test('explains the problem without naming an account', async () => {
      const response = await server.inject('/no-access')

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(response.result).toContain('not a member of a group')
    })
  })

  describe('session protection and logout', () => {
    test('redirects an anonymous protected request to sign in', async () => {
      const [welcomeResponse, formResponse] = await Promise.all([
        server.inject('/submission-welcome'),
        server.inject('/bat-rabies')
      ])

      expect(welcomeResponse.statusCode).toBe(statusCodes.redirect)
      expect(welcomeResponse.headers.location).toBe(
        '/sign-in-choose?redirect=%2Fsubmission-welcome'
      )
      expect(formResponse.statusCode).toBe(statusCodes.redirect)
      expect(formResponse.headers.location).toBe(
        '/sign-in-choose?redirect=%2Fbat-rabies'
      )
    })

    test('clears the local session for front-channel logout', async () => {
      const { response: callbackResponse, cookie } = await signIn({
        iss: 'https://login.example/tenant/v2.0',
        sid: 'entra-session-id'
      })

      expect(callbackResponse.statusCode).toBe(statusCodes.redirect)

      const invalidLogoutResponse = await server.inject(
        '/logout?iss=https%3A%2F%2Fattacker.example&sid=entra-session-id'
      )
      const logoutResponse = await server.inject({
        url: '/logout?iss=https%3A%2F%2Flogin.example%2Ftenant%2Fv2.0&sid=entra-session-id'
      })

      expect(invalidLogoutResponse.statusCode).toBe(statusCodes.unauthorized)
      expect(logoutResponse.statusCode).toBe(statusCodes.noContent)
      expect(logoutResponse.headers['cache-control']).toBe('no-store')
      expect(logoutResponse.headers['x-frame-options']).toBeUndefined()
      expect(logoutResponse.headers['content-security-policy']).toBeUndefined()

      const protectedResponse = await server.inject({
        url: '/submission-welcome',
        headers: { cookie }
      })
      expect(protectedResponse.headers.location).toBe(
        '/sign-in-choose?redirect=%2Fsubmission-welcome'
      )
    })

    test('rejects front-channel logout without provider claims', async () => {
      const response = await server.inject('/logout')

      expect(response.statusCode).toBe(statusCodes.badRequest)
    })
  })

  describe('sign out', () => {
    function stubEndSessionEndpoint() {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            end_session_endpoint: 'https://login.example/logout'
          })
        })
      )
    }

    /**
     * A signed-in browser: session cookie, plus the crumb from a page it has
     * loaded
     */
    async function signedInBrowser() {
      const { cookie } = await signIn()
      const pageResponse = await server.inject({
        url: '/submission-welcome',
        headers: { cookie }
      })
      const crumb = getCookieValue(pageResponse, 'crumb')

      return { cookie: `${cookie}; crumb=${crumb}`, crumb }
    }

    test('is offered as a form rather than a link', async () => {
      const { cookie } = await signIn()

      const { result } = await server.inject({
        url: '/submission-welcome',
        headers: { cookie }
      })

      expect(result).toContain('<form method="post" action="/sign-out">')
      expect(result).not.toContain('href="/sign-out"')
    })

    test('cannot be triggered by another site linking to it', async () => {
      const { cookie } = await signIn()

      await server.inject({ url: '/sign-out', headers: { cookie } })

      const protectedResponse = await server.inject({
        url: '/submission-welcome',
        headers: { cookie }
      })

      expect(protectedResponse.statusCode).toBe(statusCodes.ok)
    })

    test('rejects a post without a CSRF crumb', async () => {
      const { cookie } = await signIn()

      const response = await server.inject({
        method: 'POST',
        url: '/sign-out',
        headers: { cookie }
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)
    })

    test('redirects user-initiated sign-out to the provider', async () => {
      const { cookie, crumb } = await signedInBrowser()
      stubEndSessionEndpoint()

      const response = await server.inject({
        method: 'POST',
        url: '/sign-out',
        headers: { cookie },
        payload: { crumb }
      })
      const location = new URL(response.headers.location)

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(location.origin + location.pathname).toBe(
        'https://login.example/logout'
      )
      expect(location.searchParams.get('post_logout_redirect_uri')).toBe(
        'http://localhost:3000/signed-out'
      )
    })

    test('ends the local session', async () => {
      const { cookie, crumb } = await signedInBrowser()
      stubEndSessionEndpoint()

      await server.inject({
        method: 'POST',
        url: '/sign-out',
        headers: { cookie },
        payload: { crumb }
      })

      const protectedResponse = await server.inject({
        url: '/submission-welcome',
        headers: { cookie }
      })

      expect(protectedResponse.statusCode).toBe(statusCodes.redirect)
      expect(protectedResponse.headers.location).toBe(
        '/sign-in-choose?redirect=%2Fsubmission-welcome'
      )
    })
  })

  describe('caching', () => {
    test('keeps signed-in pages out of the browser history', async () => {
      const { cookie } = await signIn()

      const response = await server.inject({
        url: '/submission-welcome',
        headers: { cookie }
      })

      expect(response.headers['cache-control']).toBe(
        'no-cache, no-store, must-revalidate'
      )
    })

    test('leaves endpoints that set their own policy alone', async () => {
      const response = await server.inject('/health')

      expect(response.headers['cache-control']).not.toContain('no-store')
    })
  })
})

describe('buildEndSessionUrl', () => {
  test('safely adds logout parameters', () => {
    const result = new URL(
      buildEndSessionUrl(
        'https://login.example/logout?existing=value',
        'id+token'
      )
    )

    expect(result.searchParams.get('existing')).toBe('value')
    expect(result.searchParams.get('id_token_hint')).toBe('id+token')
    expect(result.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://localhost:3000/signed-out'
    )
  })
})
