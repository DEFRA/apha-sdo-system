import { hapiAuthOidcPlugin } from '@defra/hapi-auth-oidc'

import { config } from '#/config/config.js'
import {
  createEntraIdCredentialProvider,
  getEntraIdDiscoveryUrl,
  validateEntraIdConfiguration
} from '#/server/auth/credential-provider.js'
import {
  AUTH_PATHS,
  OIDC_STATE_COOKIE_NAME
} from '#/server/auth/auth-constants.js'

export function getOidcBrowserSettings(
  isCdp = Boolean(config.get('serviceVersion'))
) {
  return isCdp
    ? { responseMode: 'form_post', sameSite: 'None' }
    : { responseMode: 'query', sameSite: 'Lax' }
}

export const openId = {
  plugin: {
    name: 'entra-open-id',
    async register(server) {
      const authConfig = config.get('auth.entraId')
      validateEntraIdConfiguration({ settings: authConfig })
      const discoveryUri = getEntraIdDiscoveryUrl(authConfig)
      const browserSettings = getOidcBrowserSettings()

      await server.register({
        plugin: hapiAuthOidcPlugin,
        options: {
          oidc: {
            clientId: authConfig.clientId,
            discoveryUri,
            authProvider: createEntraIdCredentialProvider(authConfig),
            useHttp: new URL(discoveryUri).protocol === 'http:',
            loginCallbackUri: AUTH_PATHS.ENTRA_CALLBACK,
            responseMode: browserSettings.responseMode,
            scope: authConfig.scopes,
            externalBaseUrl: config.get('appBaseUrl'),
            earlyRefreshMs: authConfig.earlyRefreshMs
          },
          cookie: OIDC_STATE_COOKIE_NAME,
          cookieOptions: {
            password: config.get('session.cookie.password'),
            ttl: 600000,
            isSecure: config.get('session.cookie.secure'),
            isHttpOnly: true,
            isSameSite: browserSettings.sameSite,
            clearInvalid: true
          }
        }
      })
    }
  }
}

export async function getEndSessionEndpoint(fetchImplementation = fetch) {
  const response = await fetchImplementation(getEntraIdDiscoveryUrl())

  if (!response.ok) {
    throw new Error(
      `Unable to load OIDC discovery document (${response.status})`
    )
  }

  const metadata = await response.json()
  return metadata.end_session_endpoint ?? null
}
