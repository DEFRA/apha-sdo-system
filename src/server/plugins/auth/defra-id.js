import { config } from '#/config/config.js'
import { DEFRA_ID_STATE_COOKIE_NAME } from '#/server/auth/auth-constants.js'
import {
  getDefraIdOidcConfig,
  validateDefraIdConfiguration
} from '#/server/auth/defra-id.js'
import { getOidcBrowserSettings } from './open-id.js'

/**
 * The handshake with Customer Identity is short-lived, so the PKCE verifier,
 * state and nonce only need to outlive the round trip.
 */
const STATE_COOKIE_TTL = 600000

/**
 * External user sign-in with Defra Customer Identity. Registered only when
 * `auth.defraId.enabled` is set, which keeps the external option on its
 * placeholder page until an environment has been onboarded (or points at the
 * local stub).
 *
 * Discovery runs at start-up so that a wrong metadata URL or unreachable
 * provider fails a CDP deployment immediately rather than the first sign-in,
 * and so the content security policy can read the provider's origins.
 * Locally the stub may simply not be up yet, so that is a warning and the
 * first sign-in retries.
 */
export const defraIdOpenId = {
  plugin: {
    name: 'defra-id-open-id',
    async register(server) {
      const settings = config.get('auth.defraId')
      const isCdp = Boolean(config.get('serviceVersion'))

      if (!settings.enabled) {
        return
      }

      validateDefraIdConfiguration({ settings, isCdp })

      // Matches the Entra OIDC state cookie: readable on the cross-site
      // form_post callback on CDP, Lax for the query callback locally.
      server.state(DEFRA_ID_STATE_COOKIE_NAME, {
        ttl: STATE_COOKIE_TTL,
        encoding: 'iron',
        password: config.get('session.cookie.password'),
        path: '/',
        isSecure: config.get('session.cookie.secure'),
        isHttpOnly: true,
        isSameSite: getOidcBrowserSettings().sameSite,
        clearInvalid: true,
        ignoreErrors: true
      })

      try {
        await getDefraIdOidcConfig({ settings, logger: server.logger })
      } catch (error) {
        if (isCdp) {
          throw error
        }

        server.logger?.warn?.(
          { err: error, discoveryUrl: settings.discoveryUrl },
          'Defra ID discovery failed at start-up; is the cdp-defra-id-stub running? Sign-in will retry'
        )
      }
    }
  }
}
