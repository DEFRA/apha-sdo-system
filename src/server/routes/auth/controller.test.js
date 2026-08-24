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

  afterEach(() => {
    config.set('auth.entraId.allowedGroupIds', [])
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function postSignInChoose(payload = {}) {
    const getResponse = await server.inject({
      method: 'GET',
      url: '/sign-in-choose'
    })
    const crumb = getCookieValue(getResponse, 'crumb')

    return server.inject({
      method: 'POST',
      url: '/sign-in-choose',
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
      vi.spyOn(
        server.plugins['hapi-auth-oidc'].oidc,
        'login'
      ).mockImplementation(async (_request, h) =>
        h.redirect('https://login.example/authorize')
      )

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
      vi.spyOn(
        server.plugins['hapi-auth-oidc'].oidc,
        'callback'
      ).mockResolvedValue({
        accessToken,
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        claims: {
          oid: 'user-id',
          name: 'A Person',
          preferred_username: 'person@example.gov.uk'
        }
      })

      const callbackResponse = await server.inject(
        '/signin-entra-id?code=code&state=state'
      )
      const sessionCookie = getCookieHeader(callbackResponse, 'userSession')

      expect(callbackResponse.statusCode).toBe(statusCodes.redirect)
      expect(callbackResponse.headers.location).toBe('/submission-welcome')
      expect(sessionCookie).toBeDefined()

      const protectedResponse = await server.inject({
        url: '/submission-welcome',
        headers: {
          cookie: sessionCookie.split(';')[0]
        }
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
      vi.spyOn(
        server.plugins['hapi-auth-oidc'].oidc,
        'callback'
      ).mockResolvedValue({
        accessToken,
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        claims: {
          oid: 'user-id',
          name: 'A Person'
        }
      })

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

    test('rejects a user outside the configured groups', async () => {
      config.set('auth.entraId.allowedGroupIds', ['allowed-group'])
      vi.spyOn(
        server.plugins['hapi-auth-oidc'].oidc,
        'callback'
      ).mockResolvedValue({
        accessToken,
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        claims: {
          oid: 'user-id',
          groups: ['other-group']
        }
      })

      const response = await server.inject(
        '/signin-entra-id?code=code&state=state'
      )

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(response.result).toContain('Forbidden')
      expect(getCookieHeader(response, 'userSession')).toBeUndefined()
    })
  })

  describe('session protection and logout', () => {
    test('redirects an anonymous protected request to sign in', async () => {
      const [welcomeResponse, formResponse] = await Promise.all([
        server.inject('/submission-welcome'),
        server.inject('/sdo-test')
      ])

      expect(welcomeResponse.statusCode).toBe(statusCodes.redirect)
      expect(welcomeResponse.headers.location).toBe('/sign-in-choose')
      expect(formResponse.statusCode).toBe(statusCodes.redirect)
      expect(formResponse.headers.location).toBe('/sign-in-choose')
    })

    test('clears the local session for front-channel logout', async () => {
      vi.spyOn(
        server.plugins['hapi-auth-oidc'].oidc,
        'callback'
      ).mockResolvedValue({
        accessToken,
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        claims: {
          oid: 'user-id',
          name: 'A Person',
          iss: 'https://login.example/tenant/v2.0',
          sid: 'entra-session-id'
        }
      })

      const callbackResponse = await server.inject(
        '/signin-entra-id?code=code&state=state'
      )
      const sessionCookie = getCookieHeader(
        callbackResponse,
        'userSession'
      ).split(';')[0]
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
        headers: { cookie: sessionCookie }
      })
      expect(protectedResponse.headers.location).toBe('/sign-in-choose')
    })

    test('rejects front-channel logout without provider claims', async () => {
      const response = await server.inject('/logout')

      expect(response.statusCode).toBe(statusCodes.badRequest)
    })

    test('redirects user-initiated sign-out to the provider', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            end_session_endpoint: 'https://login.example/logout'
          })
        })
      )

      const response = await server.inject('/sign-out')
      const location = new URL(response.headers.location)

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(location.origin + location.pathname).toBe(
        'https://login.example/logout'
      )
      expect(location.searchParams.get('post_logout_redirect_uri')).toBe(
        'http://localhost:3000/signed-out'
      )
    })

    test('renders the signed-out page', async () => {
      const response = await server.inject('/signed-out')

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(response.result).toContain('You have signed out')
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
