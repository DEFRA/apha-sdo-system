import { MockProvider, WebIdentityTokenProvider } from '@defra/hapi-auth-oidc'
import { STSClient } from '@aws-sdk/client-sts'
import { addProxyToClient } from 'aws-sdk-v3-proxy'

import { config } from '#/config/config.js'

export const AUTH_CREDENTIAL_MODES = {
  MOCK: 'mock',
  CLIENT_SECRET: 'client-secret',
  WEB_IDENTITY: 'web-identity'
}

const authConfigPath = 'auth.entraId'
const httpsProtocol = 'https:'
const redisCacheEngine = 'redis'
const localDiscoveryUrl =
  'http://localhost:5556/.well-known/openid-configuration'
const unsafeCookiePasswords = new Set([
  'the-password-must-be-at-least-32-characters-long',
  'local-cookie-password-change-before-deploying'
])
const authorizationValidators = {
  groups: (settings) =>
    settings.allowedGroupIds.length > 0
      ? null
      : 'AUTH_ENTRA_ID_ALLOWED_GROUP_IDS is required in groups authorization mode',
  'assignment-only': (settings) =>
    settings.assignmentRequiredConfirmed
      ? null
      : 'AUTH_ENTRA_ID_ASSIGNMENT_REQUIRED_CONFIRMED must be true in assignment-only mode',
  'tenant-only': (settings) =>
    settings.tenantWideAccessConfirmed
      ? null
      : 'AUTH_ENTRA_ID_TENANT_WIDE_ACCESS_CONFIRMED must be true in tenant-only mode'
}

function requireHttps(name, url) {
  return new URL(url).protocol === httpsProtocol
    ? null
    : `${name} must use HTTPS on CDP`
}

function validateDiscovery(settings) {
  if (settings.discoveryUrl) {
    return requireHttps(
      'AUTH_ENTRA_ID_OIDC_CONFIGURATION_URL',
      settings.discoveryUrl
    )
  }

  return settings.tenantId ? null : 'AUTH_ENTRA_ID_TENANT_ID is required on CDP'
}

function validateClientId(settings) {
  return settings.clientId && settings.clientId !== 'local-stub-client'
    ? null
    : 'AUTH_ENTRA_ID_CLIENT_ID must identify the environment app'
}

function validateAuthorization(settings) {
  return authorizationValidators[settings.authorizationMode]?.(settings)
}

/**
 * The DEFRA OIDC package supports the client_secret provider contract but
 * intentionally does not ship a provider that reads a static secret.
 */
export class ClientSecretTokenProvider {
  type = 'client_secret'

  constructor(secret) {
    if (!secret) {
      throw new Error(
        'AUTH_ENTRA_ID_CLIENT_SECRET is required in client-secret mode'
      )
    }

    this.secret = secret
  }

  async getCredentials(_logger) {
    return this.secret
  }
}

export function createProxyAwareStsClient() {
  return addProxyToClient(new STSClient(), {
    throwOnNoProxy: false
  })
}

export function createEntraIdCredentialProvider(
  settings = config.get(authConfigPath)
) {
  switch (settings.credentialMode) {
    case AUTH_CREDENTIAL_MODES.MOCK:
      return new MockProvider({
        token: 'local-stub-client-assertion',
        type: 'federated'
      })
    case AUTH_CREDENTIAL_MODES.CLIENT_SECRET:
      return new ClientSecretTokenProvider(settings.clientSecret)
    case AUTH_CREDENTIAL_MODES.WEB_IDENTITY:
      return new WebIdentityTokenProvider({
        audience: settings.federatedAudience,
        earlyRefreshMs: settings.earlyRefreshMs,
        stsClient: createProxyAwareStsClient()
      })
    default:
      throw new Error(
        `Unsupported Entra credential mode: ${settings.credentialMode}`
      )
  }
}

export function validateEntraIdConfiguration({
  settings = config.get(authConfigPath),
  isCdp = Boolean(config.get('serviceVersion')),
  appBaseUrl = config.get('appBaseUrl'),
  cookiePassword = config.get('session.cookie.password'),
  cookieSecure = config.get('session.cookie.secure'),
  cacheEngine = config.get('session.cache.engine'),
  nodeUseEnvProxy = process.env.NODE_USE_ENV_PROXY
} = {}) {
  if (!isCdp) {
    return
  }

  const errors = [
    settings.credentialMode === AUTH_CREDENTIAL_MODES.MOCK
      ? 'mock credential mode is not allowed on CDP'
      : null,
    requireHttps('APP_BASE_URL', appBaseUrl),
    validateDiscovery(settings),
    validateClientId(settings),
    unsafeCookiePasswords.has(cookiePassword)
      ? 'SESSION_COOKIE_PASSWORD must be replaced on CDP'
      : null,
    cookieSecure ? null : 'SESSION_COOKIE_SECURE must be true on CDP',
    cacheEngine === redisCacheEngine
      ? null
      : 'SESSION_CACHE_ENGINE must be redis on CDP',
    nodeUseEnvProxy === '1' ? null : 'NODE_USE_ENV_PROXY must be 1 on CDP',
    validateAuthorization(settings)
  ].filter(Boolean)

  if (errors.length > 0) {
    throw new Error(`Invalid CDP Entra configuration: ${errors.join('; ')}`)
  }
}

export function getEntraIdDiscoveryUrl(settings = config.get(authConfigPath)) {
  if (settings.discoveryUrl) {
    return settings.discoveryUrl
  }

  if (settings.credentialMode === AUTH_CREDENTIAL_MODES.MOCK) {
    return localDiscoveryUrl
  }

  if (!settings.tenantId) {
    throw new Error(
      'AUTH_ENTRA_ID_TENANT_ID is required when the discovery URL is not set'
    )
  }

  return `https://login.microsoftonline.com/${encodeURIComponent(settings.tenantId)}/v2.0/.well-known/openid-configuration`
}
