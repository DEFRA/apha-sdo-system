import cookie from '@hapi/cookie'

import { config } from '#/config/config.js'
import {
  AUTH_PATHS,
  RETURN_TO_COOKIE_NAME,
  RETURN_TO_QUERY_PARAM,
  USER_SESSION_CACHE_SEGMENT,
  USER_SESSION_COOKIE_NAME
} from '#/server/auth/auth-constants.js'
import { validateUserSession } from '#/server/auth/user-session.js'
import { getOidcBrowserSettings } from './open-id.js'

export const SESSION_AUTH_STRATEGY = 'session'

/**
 * The handshake with Entra is short-lived, so the page the user was heading to
 * only needs to outlive the round trip.
 */
const RETURN_TO_COOKIE_TTL = 600000

export const sessionCookie = {
  plugin: {
    name: 'user-session-cookie',
    async register(server) {
      const sessionConfig = config.get('session')

      server.app.userSessionCache = server.cache({
        cache: sessionConfig.cache.name,
        segment: USER_SESSION_CACHE_SEGMENT,
        expiresIn: sessionConfig.cache.ttl
      })

      // Matches the OIDC state cookie, which has to be readable on Entra's
      // cross-site form_post callback.
      server.state(RETURN_TO_COOKIE_NAME, {
        ttl: RETURN_TO_COOKIE_TTL,
        encoding: 'iron',
        password: sessionConfig.cookie.password,
        path: '/',
        isSecure: sessionConfig.cookie.secure,
        isHttpOnly: true,
        isSameSite: getOidcBrowserSettings().sameSite,
        clearInvalid: true
      })

      await server.register(cookie)
      server.auth.strategy(SESSION_AUTH_STRATEGY, 'cookie', {
        cookie: {
          name: USER_SESSION_COOKIE_NAME,
          password: sessionConfig.cookie.password,
          path: '/',
          ttl: sessionConfig.cookie.ttl,
          isSecure: sessionConfig.cookie.secure,
          isHttpOnly: true,
          // Only the OIDC state cookie needs SameSite=None for the form_post
          // callback. The session cookie is set on that response rather than
          // read from it, so it can stay Lax and out of cross-site requests.
          isSameSite: 'Lax',
          clearInvalid: true
        },
        // Without this the 4 hour TTL runs from sign-in, timing out users
        // part-way through a report.
        keepAlive: true,
        redirectTo: AUTH_PATHS.SIGN_IN_CHOOSE,
        appendNext: RETURN_TO_QUERY_PARAM,
        validate: validateUserSession
      })
      server.auth.default(SESSION_AUTH_STRATEGY)
    }
  }
}
