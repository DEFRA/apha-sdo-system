import * as openid from 'openid-client'
import {
  createOidcConfig,
  ensureValidToken,
  postLogin
} from '@defra/hapi-auth-oidc'

import { config } from '#/config/config.js'
import { getOidcBrowserSettings } from '#/server/plugins/auth/open-id.js'
import { AUTH_PATHS, DEFRA_ID_STATE_COOKIE_NAME } from './auth-constants.js'

/**
 * External (laboratory) users sign in with Defra Customer Identity (Defra
 * ID), which offers GOV.UK One Login or Government Gateway according to the
 * service's configuration there and returns the user's organisation and
 * service roles in the ID token.
 *
 * `@defra/hapi-auth-oidc` already drives the Entra sign-in and can only be
 * registered once (it decorates `request.login`), so this module builds the
 * second provider from the package's exported pieces: discovery via
 * `createOidcConfig`, the callback via `postLogin` and refresh via
 * `ensureValidToken`. Only the authorize request is written here, because
 * Customer Identity needs its own `serviceId` parameter on it.
 */

const authConfigPath = 'auth.defraId'
const httpsProtocol = 'https:'
const stubPathMarker = 'cdp-defra-id-stub'

/**
 * Discovery is done once and shared: session validation may need the token
 * endpoint on any request, and the document only changes on provider
 * upgrades. A failed discovery is not kept, so the next sign-in retries.
 */
let oidcConfigPromise = null
let oidcConfigKey = null

function isHttp(url) {
  return new URL(url).protocol === 'http:'
}

/**
 * Scopes may be separated by spaces or commas: CDP configuration fields do
 * not accept spaces, and OIDC itself wants a space-separated string.
 */
function scopeList(scopes) {
  return typeof scopes === 'string'
    ? scopes.split(/[\s,]+/).filter(Boolean)
    : []
}

function scopeString(scopes) {
  return scopeList(scopes).join(' ')
}

export function isDefraIdEnabled(settings = config.get(authConfigPath)) {
  return Boolean(settings.enabled)
}

export async function getDefraIdOidcConfig({
  settings = config.get(authConfigPath),
  logger
} = {}) {
  const key = `${settings.discoveryUrl}|${settings.clientId}`

  if (!oidcConfigPromise || oidcConfigKey !== key) {
    oidcConfigKey = key
    oidcConfigPromise = createOidcConfig({
      discoveryUri: settings.discoveryUrl,
      clientId: settings.clientId,
      authProvider: {
        type: 'client_secret',
        getCredentials: async () => settings.clientSecret
      },
      // The local cdp-defra-id-stub is plain http; everything else is https
      discoveryRequestOptions: isHttp(settings.discoveryUrl)
        ? { execute: [openid.allowInsecureRequests] }
        : {},
      logger
    }).catch((error) => {
      oidcConfigPromise = null
      oidcConfigKey = null
      throw error
    })
  }

  return oidcConfigPromise
}

export function clearDefraIdOidcConfigCache() {
  oidcConfigPromise = null
  oidcConfigKey = null
}

/**
 * The authorize request. The code is bound to this browser session with
 * PKCE (S256) and `state`; no nonce is sent. A nonce protects the implicit
 * and hybrid flows, and the Customer Identity guide lists it as recommended
 * rather than required for the code flow, while the local stub drops any
 * nonce it is given, which would fail ID token validation. Leaving it out
 * keeps the local stub and Customer Identity on the same path. `serviceId`
 * is the Customer Identity extra that identifies which onboarded service the
 * user is signing in to, so their roles for it are returned.
 * @returns {Promise<import('@hapi/hapi').ResponseObject>} a redirect carrying the state cookie
 */
export async function startDefraIdLogin(
  h,
  {
    settings = config.get(authConfigPath),
    appBaseUrl = config.get('appBaseUrl'),
    browserSettings = getOidcBrowserSettings(),
    logger
  } = {}
) {
  const oidcConfig = await getDefraIdOidcConfig({ settings, logger })
  const codeVerifier = openid.randomPKCECodeVerifier()
  const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier)
  const state = openid.randomState()

  const params = {
    redirect_uri: new URL(AUTH_PATHS.DEFRA_ID_CALLBACK, appBaseUrl).toString(),
    scope: scopeString(settings.scopes),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    ...(settings.serviceId && { serviceId: settings.serviceId }),
    // `query` is the protocol default and the stub rejects the parameter
    // outright, so only the CDP form_post choice is spelled out
    ...(browserSettings.responseMode === 'form_post' && {
      response_mode: 'form_post'
    })
  }

  const redirectUrl = openid.buildAuthorizationUrl(oidcConfig, params)

  return h
    .redirect(redirectUrl.toString())
    .state(DEFRA_ID_STATE_COOKIE_NAME, { codeVerifier, state })
}

/**
 * The callback URL as Customer Identity saw it: the request arrives on the
 * container's own host and port, but the authorization response has to be
 * checked against the external redirect URL that was registered.
 */
function asExternalUrl(requestUrl, appBaseUrl) {
  const url = new URL(requestUrl)
  const external = new URL(appBaseUrl)

  url.protocol = external.protocol
  url.hostname = external.hostname
  url.port = external.port

  return url
}

/**
 * Exchanges the authorization code for tokens, validating state, PKCE and
 * the ID token signature against the discovered keys. Handles both
 * response modes: `form_post` (CDP) carries the response in the POST body,
 * `query` (local) in the URL.
 * @returns {Promise<{ accessToken: string, refreshToken?: string, idToken: string, claims: object, expiresIn?: number }>}
 */
export async function completeDefraIdLogin(
  request,
  h,
  {
    settings = config.get(authConfigPath),
    appBaseUrl = config.get('appBaseUrl'),
    logger = request.logger
  } = {}
) {
  const record = request.state[DEFRA_ID_STATE_COOKIE_NAME]
  const currentUrl = asExternalUrl(request.url, appBaseUrl)

  if (request.method.toUpperCase() === 'POST' && request.payload) {
    for (const [key, value] of Object.entries(request.payload)) {
      if (typeof value === 'string') {
        currentUrl.searchParams.set(key, value)
      }
    }
  }

  try {
    const oidcConfig = await getDefraIdOidcConfig({ settings, logger })

    return await postLogin({
      codeVerifier: record?.codeVerifier,
      state: record?.state,
      oidcConfig,
      currentUrl,
      logger
    })
  } finally {
    h.unstate(DEFRA_ID_STATE_COOKIE_NAME)
  }
}

/**
 * Refreshes the token set shortly before the access token expires. The
 * refreshed ID token carries the user's current roles, so a role the lab
 * admin adds or removes in Your Defra account reaches the service without a
 * new sign-in.
 */
export async function ensureValidDefraIdToken(
  token,
  { settings = config.get(authConfigPath), logger } = {}
) {
  return ensureValidToken(
    token,
    (log) => getDefraIdOidcConfig({ settings, logger: log ?? logger }),
    settings.earlyRefreshMs,
    scopeString(settings.scopes),
    logger
  )
}

export async function getDefraIdEndSessionEndpoint(options = {}) {
  const oidcConfig = await getDefraIdOidcConfig(options)

  return oidcConfig.serverMetadata().end_session_endpoint ?? null
}

/**
 * The origins a sign-in or sign-out redirect chain passes through, for the
 * content security policy. Customer Identity publishes its discovery
 * document from one host but authorizes on another, so the authorization
 * and end-session endpoints are read from the document itself.
 */
export async function getDefraIdOrigins(options = {}) {
  const { settings = config.get(authConfigPath) } = options
  const metadata = (await getDefraIdOidcConfig(options)).serverMetadata()

  return [
    ...new Set(
      [
        settings.discoveryUrl,
        metadata.authorization_endpoint,
        metadata.end_session_endpoint
      ]
        .filter(Boolean)
        .map((endpoint) => new URL(endpoint).origin)
    )
  ]
}

function isHttps(url) {
  return new URL(url).protocol === httpsProtocol
}

/**
 * Each check answers with the problem or null, so the two lists read as the
 * configuration contract. The first applies wherever the provider is
 * enabled; the second only on CDP, where the real Customer Identity is in
 * use rather than the stub.
 */
const requiredChecks = [
  (settings) =>
    settings.discoveryUrl
      ? null
      : 'AUTH_DEFRA_ID_OIDC_CONFIGURATION_URL is required when Defra ID sign-in is enabled',
  (settings) =>
    settings.clientId
      ? null
      : 'AUTH_DEFRA_ID_CLIENT_ID is required when Defra ID sign-in is enabled',
  (settings) =>
    settings.clientSecret
      ? null
      : 'AUTH_DEFRA_ID_CLIENT_SECRET is required when Defra ID sign-in is enabled'
]

const cdpChecks = [
  // A missing URL is already reported above
  (settings) =>
    !settings.discoveryUrl || isHttps(settings.discoveryUrl)
      ? null
      : 'AUTH_DEFRA_ID_OIDC_CONFIGURATION_URL must use HTTPS on CDP',
  (settings) =>
    settings.discoveryUrl?.includes(stubPathMarker)
      ? 'cdp-defra-id-stub is not allowed on CDP'
      : null,
  (settings) =>
    settings.serviceId ? null : 'AUTH_DEFRA_ID_SERVICE_ID is required on CDP',
  // Without the client ID as a scope Customer Identity issues no access
  // token, and session refresh relies on one
  (settings) =>
    scopeList(settings.scopes).includes(settings.clientId)
      ? null
      : 'AUTH_DEFRA_ID_SCOPES must include the client ID on CDP'
]

/**
 * Mirrors validateEntraIdConfiguration: the settings a sign-in cannot work
 * without are checked wherever the provider is enabled, the ones that only
 * matter on CDP (real Customer Identity rather than the stub) on CDP.
 */
export function validateDefraIdConfiguration({
  settings = config.get(authConfigPath),
  isCdp = Boolean(config.get('serviceVersion'))
} = {}) {
  if (!settings.enabled) {
    return
  }

  const checks = isCdp ? [...requiredChecks, ...cdpChecks] : requiredChecks
  const errors = checks.map((check) => check(settings)).filter(Boolean)

  if (errors.length > 0) {
    throw new Error(`Invalid Defra ID configuration: ${errors.join('; ')}`)
  }
}
