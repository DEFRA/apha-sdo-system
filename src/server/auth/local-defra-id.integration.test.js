import { OAuth2Server } from 'oauth2-mock-server'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { clearDefraIdOidcConfigCache } from '#/server/auth/defra-id.js'

function getCookieHeader(response, name) {
  return [response.headers['set-cookie']]
    .flat()
    .find((header) => header?.startsWith(`${name}=`))
    ?.split(';')[0]
}

/**
 * The Defra Customer Identity sign-in end to end against a signing OIDC
 * provider that issues tokens in the Customer Identity shape: discovery,
 * PKCE and nonce, the code exchange with a client secret, the relationships
 * and roles claims becoming the lab and journeys, refresh-capable session
 * validation, and provider sign-out.
 */
describe('local Defra ID stand-in', () => {
  const port = 5558
  const issuerUrl = `http://localhost:${port}`
  const defraIdSettings = {
    enabled: true,
    discoveryUrl: `${issuerUrl}/.well-known/openid-configuration`,
    clientId: 'local-defra-id-client',
    clientSecret: 'test_value',
    serviceId: 'service-id',
    scopes: 'openid offline_access',
    accountManagementUrl: 'https://your-account.example/management'
  }
  const previousSettings = {}
  // The roles the next token carries; a test changes them before signing in
  let roles = ['rel-1:BR:3']
  let oidcServer
  let appServer

  beforeAll(async () => {
    oidcServer = new OAuth2Server()
    await oidcServer.issuer.keys.generate('RS256')
    oidcServer.issuer.url = issuerUrl
    oidcServer.service.on('beforeTokenSigning', (token) => {
      Object.assign(token.payload, {
        sub: 'b2c-subject',
        contactId: 'contact-id',
        firstName: 'Susan',
        lastName: 'Example',
        email: 'susan@lab.example',
        uniqueReference: 'AAA-0001-BB-12345',
        amr: 'one',
        currentRelationshipId: 'rel-1',
        relationships: [
          'rel-1:org-1:Anytown Veterinary Laboratory:0:Employee:0'
        ],
        roles
      })
    })
    await oidcServer.start(port, 'localhost')

    for (const [key, value] of Object.entries(defraIdSettings)) {
      previousSettings[key] = config.get(`auth.defraId.${key}`)
      config.set(`auth.defraId.${key}`, value)
    }
    clearDefraIdOidcConfigCache()

    appServer = await createServer()
    await appServer.initialize()
  })

  afterAll(async () => {
    await appServer.stop({ timeout: 0 })
    await oidcServer.stop()

    for (const [key, value] of Object.entries(previousSettings)) {
      config.set(`auth.defraId.${key}`, value)
    }
    clearDefraIdOidcConfigCache()
  })

  afterEach(() => {
    roles = ['rel-1:BR:3']
  })

  /**
   * Signs in through the provider and returns the session cookie.
   */
  async function signIn() {
    const loginResponse = await appServer.inject('/sign-in-external')
    const authorizeResponse = await fetch(loginResponse.headers.location, {
      redirect: 'manual'
    })
    const callbackUrl = new URL(authorizeResponse.headers.get('location'))
    const callbackResponse = await appServer.inject({
      url: `${callbackUrl.pathname}${callbackUrl.search}`,
      headers: { cookie: getCookieHeader(loginResponse, 'defraIdOidc') }
    })

    return getCookieHeader(callbackResponse, 'userSession')
  }

  test('offers both journeys to a user holding both roles for the lab', async () => {
    // The lab admin ticked both roles in Your Defra account. The CDP stub
    // cannot hold two roles for one relationship, so this is the only place
    // the combination is exercised end to end.
    roles = ['rel-1:AHR:3', 'rel-1:BR:3']

    const userSessionCookie = await signIn()
    const welcome = await appServer.inject({
      url: '/submission-welcome',
      headers: { cookie: userSessionCookie }
    })

    expect(welcome.statusCode).toBe(200)
    expect(welcome.result).toContain('value="bat-rabies"')
    expect(welcome.result).toContain('value="animal-health-regulations"')
    // Registry order, whatever order the token listed them in
    expect(welcome.result.indexOf('value="bat-rabies"')).toBeLessThan(
      welcome.result.indexOf('value="animal-health-regulations"')
    )
  })

  test('tells a user holding only the Default role to ask their lab administrator', async () => {
    roles = ['rel-1:Default:3']

    const userSessionCookie = await signIn()
    const welcome = await appServer.inject({
      url: '/submission-welcome',
      headers: { cookie: userSessionCookie }
    })

    expect(welcome.statusCode).toBe(200)
    expect(welcome.result).toContain("laboratory's account administrator")
    expect(welcome.result).not.toContain('value="bat-rabies"')
    expect(welcome.result).not.toContain('value="animal-health-regulations"')
  })

  test('completes sign-in, maps roles to journeys and signs out at the provider', async () => {
    const loginResponse = await appServer.inject('/sign-in-external')
    const oidcStateCookie = getCookieHeader(loginResponse, 'defraIdOidc')
    const authorizeUrl = new URL(loginResponse.headers.location)

    expect(loginResponse.statusCode).toBe(302)
    expect(authorizeUrl.origin).toBe(issuerUrl)
    // Customer Identity's own parameter, alongside PKCE. The mock provider
    // advertises PKCE support, so no nonce is needed (as with the local stub)
    expect(authorizeUrl.searchParams.get('serviceId')).toBe('service-id')
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizeUrl.searchParams.has('nonce')).toBe(false)
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/signin-defra-id'
    )
    expect(oidcStateCookie).toBeDefined()

    const authorizeResponse = await fetch(authorizeUrl, {
      redirect: 'manual'
    })
    const callbackUrl = new URL(authorizeResponse.headers.get('location'))
    const callbackResponse = await appServer.inject({
      url: `${callbackUrl.pathname}${callbackUrl.search}`,
      headers: { cookie: oidcStateCookie }
    })
    const userSessionCookie = getCookieHeader(callbackResponse, 'userSession')

    expect(callbackResponse.statusCode).toBe(302)
    expect(callbackResponse.headers.location).toBe('/submission-welcome')
    expect(userSessionCookie).toBeDefined()

    const protectedResponse = await appServer.inject({
      url: '/submission-welcome',
      headers: { cookie: userSessionCookie }
    })

    expect(protectedResponse.statusCode).toBe(200)
    // The roles claim decides which journeys are offered
    expect(protectedResponse.result).toContain('value="bat-rabies"')
    expect(protectedResponse.result).not.toContain(
      'value="animal-health-regulations"'
    )
    // The lab is named, not shown as its Customer Identity GUID
    expect(protectedResponse.result).toContain('Anytown Veterinary Laboratory')
    expect(protectedResponse.result).toContain('Susan Example')
    // Laboratory users manage roles and colleagues in Your Defra account
    expect(protectedResponse.result).toContain(
      'href="https://your-account.example/management"'
    )
    expect(protectedResponse.result).toContain('Manage your Defra account')

    const crumb = getCookieHeader(protectedResponse, 'crumb')?.split('=')[1]
    const signOutResponse = await appServer.inject({
      method: 'POST',
      url: '/sign-out',
      headers: { cookie: `${userSessionCookie}; crumb=${crumb}` },
      payload: { crumb }
    })
    const providerLogoutUrl = new URL(signOutResponse.headers.location)

    expect(signOutResponse.statusCode).toBe(302)
    expect(providerLogoutUrl.origin).toBe(issuerUrl)
    expect(providerLogoutUrl.searchParams.get('id_token_hint')).toBeTruthy()
    expect(providerLogoutUrl.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://localhost:3000/signed-out'
    )

    const afterSignOut = await appServer.inject({
      url: '/submission-welcome',
      headers: { cookie: userSessionCookie }
    })

    expect(afterSignOut.statusCode).toBe(302)
  })

  test('returns a deep-linked user to the page they asked for', async () => {
    const loginResponse = await appServer.inject(
      '/sign-in-external?redirect=%2Fbat-rabies'
    )
    const handshakeCookies = [
      getCookieHeader(loginResponse, 'defraIdOidc'),
      getCookieHeader(loginResponse, 'signInReturnTo')
    ].join('; ')

    const authorizeResponse = await fetch(loginResponse.headers.location, {
      redirect: 'manual'
    })
    const callbackUrl = new URL(authorizeResponse.headers.get('location'))
    const callbackResponse = await appServer.inject({
      url: `${callbackUrl.pathname}${callbackUrl.search}`,
      headers: { cookie: handshakeCookies }
    })

    expect(callbackResponse.statusCode).toBe(302)
    expect(callbackResponse.headers.location).toBe('/bat-rabies')
  })

  test('offers the external option as available', async () => {
    const { result } = await appServer.inject('/sign-in-choose')

    expect(result).toContain('GOV.UK One Login or Government Gateway')
    expect(result).toContain('For laboratory users')
    expect(result).not.toContain('not available yet')
  })

  test('sends a tampered callback back to the chooser', async () => {
    const loginResponse = await appServer.inject('/sign-in-external')
    const oidcStateCookie = getCookieHeader(loginResponse, 'defraIdOidc')

    const callbackResponse = await appServer.inject({
      url: '/signin-defra-id?code=forged&state=wrong-state',
      headers: { cookie: oidcStateCookie }
    })

    expect(callbackResponse.statusCode).toBe(302)
    expect(callbackResponse.headers.location).toBe('/sign-in-choose')
    expect(getCookieHeader(callbackResponse, 'userSession')).toBeUndefined()
  })
})
