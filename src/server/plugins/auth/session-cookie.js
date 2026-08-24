import cookie from '@hapi/cookie'

import { config } from '#/config/config.js'
import {
  AUTH_PATHS,
  USER_SESSION_CACHE_SEGMENT,
  USER_SESSION_COOKIE_NAME
} from '#/server/auth/auth-constants.js'
import { validateUserSession } from '#/server/auth/user-session.js'

export const SESSION_AUTH_STRATEGY = 'session'

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

      await server.register(cookie)
      server.auth.strategy(SESSION_AUTH_STRATEGY, 'cookie', {
        cookie: {
          name: USER_SESSION_COOKIE_NAME,
          password: sessionConfig.cookie.password,
          ttl: sessionConfig.cookie.ttl,
          isSecure: sessionConfig.cookie.secure,
          isHttpOnly: true,
          isSameSite: sessionConfig.cookie.secure ? 'None' : 'Lax',
          clearInvalid: true
        },
        redirectTo: AUTH_PATHS.SIGN_IN_CHOOSE,
        validate: validateUserSession
      })
      server.auth.default(SESSION_AUTH_STRATEGY)
    }
  }
}
