import { OAuth2Server } from 'oauth2-mock-server'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'

function getCookieHeader(response, name) {
  return [response.headers['set-cookie']]
    .flat()
    .find((header) => header?.startsWith(`${name}=`))
    ?.split(';')[0]
}

describe('local OIDC stub', () => {
  const port = 5557
  const issuerUrl = `http://localhost:${port}`
  let oidcServer
  let appServer

  beforeAll(async () => {
    oidcServer = new OAuth2Server()
    await oidcServer.issuer.keys.generate('RS256')
    oidcServer.issuer.url = issuerUrl
    oidcServer.service.on('beforeTokenSigning', (token) => {
      Object.assign(token.payload, {
        oid: 'local-user-id',
        sub: 'local-user-id',
        name: 'Local Stub User',
        preferred_username: 'local.stub@defra.gov.uk',
        groups: ['local-dev-group']
      })
    })
    await oidcServer.start(port, 'localhost')

    config.set(
      'auth.entraId.discoveryUrl',
      `${issuerUrl}/.well-known/openid-configuration`
    )
    config.set('auth.entraId.allowedGroupIds', ['local-dev-group'])

    appServer = await createServer()
    await appServer.initialize()
  })

  afterAll(async () => {
    await appServer.stop({ timeout: 0 })
    await oidcServer.stop()
    config.set('auth.entraId.discoveryUrl', null)
    config.set('auth.entraId.allowedGroupIds', [])
  })

  test('completes sign-in, protected access and provider sign-out', async () => {
    const loginResponse = await appServer.inject('/sign-in-entra')
    const oidcStateCookie = getCookieHeader(loginResponse, 'entraOidc')

    expect(loginResponse.statusCode).toBe(302)
    expect(oidcStateCookie).toBeDefined()

    const authorizeResponse = await fetch(loginResponse.headers.location, {
      redirect: 'manual'
    })
    const callbackUrl = new URL(authorizeResponse.headers.get('location'))
    const callbackResponse = await appServer.inject({
      url: `${callbackUrl.pathname}${callbackUrl.search}`,
      headers: { cookie: oidcStateCookie }
    })
    const userSessionCookie = getCookieHeader(callbackResponse, 'userSession')
    const yarSessionCookie = getCookieHeader(callbackResponse, 'session')

    expect(callbackResponse.statusCode).toBe(302)
    expect(callbackResponse.headers.location).toBe('/submission-welcome')
    expect(userSessionCookie).toBeDefined()
    expect(yarSessionCookie).toBeDefined()

    const protectedResponse = await appServer.inject({
      url: '/submission-welcome',
      headers: { cookie: userSessionCookie }
    })

    expect(protectedResponse.statusCode).toBe(200)
    expect(protectedResponse.result).toContain('Sign out')

    const signOutResponse = await appServer.inject({
      url: '/sign-out',
      headers: { cookie: userSessionCookie }
    })
    const providerLogoutUrl = new URL(signOutResponse.headers.location)

    expect(signOutResponse.statusCode).toBe(302)
    expect(providerLogoutUrl.origin).toBe(issuerUrl)
    expect(providerLogoutUrl.searchParams.get('id_token_hint')).toBeTruthy()
    expect(providerLogoutUrl.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://localhost:3000/signed-out'
    )
  })
})
