import { randomUUID } from 'node:crypto'
import Boom from '@hapi/boom'

import { config } from '#/config/config.js'
import {
  assertAllowedEntraGroups,
  getAllowedGroupIds,
  getUserProfile
} from '#/server/auth/authorization.js'
import {
  AUTH_PATHS,
  POST_SIGN_IN_PATH,
  RETURN_TO_COOKIE_NAME,
  RETURN_TO_QUERY_PARAM,
  USER_SESSION_COOKIE_NAME
} from '#/server/auth/auth-constants.js'
import { getSafeRedirect } from '#/server/auth/safe-redirect.js'
import {
  dropUserSession,
  getUserSession,
  getUserSessionIdByEntraSid,
  setUserSession
} from '#/server/auth/user-session.js'
import { getEndSessionEndpoint } from '#/server/plugins/auth/open-id.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const SIGN_IN_ERROR_FLASH_KEY = 'signInError'
const NO_ACCESS_ACCOUNT_FLASH_KEY = 'noAccessAccount'

/**
 * Only used to build relative URLs. Never sent to the browser.
 */
const RETURN_TO_RESOLUTION_ORIGIN = 'https://redirect.invalid'

/**
 * A requested page, or null when it is just the default destination and does
 * not need carrying through the sign-in URLs.
 *
 * Always re-checked rather than trusted, because the value starts life as a
 * query parameter the user can edit.
 */
function normaliseReturnTo(requested) {
  const returnTo = getSafeRedirect(requested)

  return returnTo === POST_SIGN_IN_PATH ? null : returnTo
}

/**
 * The page the user asked for before being sent to sign in, if any.
 */
function getReturnTo(request) {
  return normaliseReturnTo(
    request.query?.[RETURN_TO_QUERY_PARAM] ??
      request.payload?.[RETURN_TO_QUERY_PARAM]
  )
}

/**
 * Keeps the requested page attached to a path within the sign-in journey, so it
 * survives each hop up to the point it is stored in a cookie.
 */
function withReturnTo(path, returnTo) {
  if (!returnTo) {
    return path
  }

  const url = new URL(path, RETURN_TO_RESOLUTION_ORIGIN)
  url.searchParams.set(RETURN_TO_QUERY_PARAM, returnTo)

  return `${url.pathname}${url.search}`
}

/**
 * Internal users authenticate with Entra ID. External authentication remains
 * a placeholder until its identity provider is agreed.
 */
export const signInChooseGetController = {
  handler(request, h) {
    const [error] = request.yar.flash(SIGN_IN_ERROR_FLASH_KEY)

    return h.view('auth/sign-in-choose', {
      pageTitle: 'How do you want to sign in?',
      returnTo: getReturnTo(request),
      error
    })
  }
}

export const signInChoosePostController = {
  handler(request, h) {
    const providerRoutes = {
      defraId: AUTH_PATHS.SIGN_IN_ENTRA,
      external: AUTH_PATHS.SIGN_IN_EXTERNAL
    }
    const redirectTo = providerRoutes[request.payload?.authProvider]
    const returnTo = getReturnTo(request)

    if (!redirectTo) {
      request.yar.flash(
        SIGN_IN_ERROR_FLASH_KEY,
        'Select how you want to sign in'
      )

      return h.redirect(withReturnTo(AUTH_PATHS.SIGN_IN_CHOOSE, returnTo))
    }

    return h.redirect(withReturnTo(redirectTo, returnTo))
  }
}

/**
 * Placeholder until the external sign-in (Government Gateway / GOV.UK One
 * Login) integration is implemented
 */
export const signInExternalController = {
  handler(_request, h) {
    return h.view('auth/sign-in-external', {
      pageTitle: 'External sign-in is not available yet'
    })
  }
}

export const signInEntraController = {
  async handler(request, h) {
    const returnTo = getReturnTo(request)

    try {
      const response = await request.login(h)

      // A cookie is the only carrier that survives the round trip to Entra.
      return returnTo
        ? response.state(RETURN_TO_COOKIE_NAME, returnTo)
        : response
    } catch (error) {
      request.logger.error({ err: error }, 'Entra sign-in could not be started')
      request.yar.flash(
        SIGN_IN_ERROR_FLASH_KEY,
        'Defra sign in is temporarily unavailable. Try again.'
      )
      return h.redirect(withReturnTo(AUTH_PATHS.SIGN_IN_CHOOSE, returnTo))
    }
  }
}

export const entraCallbackController = {
  async handler(request, h) {
    // Read before the cookie is cleared, and before yar is reset below.
    const returnTo = normaliseReturnTo(request.state[RETURN_TO_COOKIE_NAME])
    h.unstate(RETURN_TO_COOKIE_NAME)

    let token

    try {
      token = await request.callback(h)
    } catch (error) {
      request.logger.warn({ err: error }, 'Entra sign-in failed')
      request.yar.flash(
        SIGN_IN_ERROR_FLASH_KEY,
        'We could not sign you in. Try again.'
      )
      return h.redirect(withReturnTo(AUTH_PATHS.SIGN_IN_CHOOSE, returnTo))
    }

    const claims = token.claims ?? {}
    const user = getUserProfile(claims)

    try {
      assertAllowedEntraGroups(
        claims,
        getAllowedGroupIds(config.get('auth.entraId'))
      )
    } catch (error) {
      // The user signed in successfully but is not entitled to this service.
      // A bare 403 leaves them stuck, because their Entra session is still
      // live and signing in again silently repeats the same outcome.
      request.logger.warn(
        { userId: user.id, err: error },
        'Entra user is not permitted to use this service'
      )
      request.yar.flash(NO_ACCESS_ACCOUNT_FLASH_KEY, user.email)

      return h.redirect(AUTH_PATHS.NO_ACCESS)
    }

    const sessionId = randomUUID()

    request.yar.reset()
    await setUserSession(request.server, sessionId, {
      token,
      claims,
      user,
      yarId: request.yar.id
    })
    request.cookieAuth.set({ sessionId })
    request.logger.info(
      { userId: user.id },
      'Entra user authenticated successfully'
    )

    return h.redirect(returnTo ?? POST_SIGN_IN_PATH)
  }
}

export const noAccessController = {
  handler(request, h) {
    const [account] = request.yar.flash(NO_ACCESS_ACCOUNT_FLASH_KEY)

    return h
      .view('auth/no-access', {
        pageTitle: 'You do not have access to this service',
        account
      })
      .code(statusCodes.forbidden)
  }
}

async function clearUserSession(request) {
  const sessionId = request.state[USER_SESSION_COOKIE_NAME]?.sessionId
  const session = await getUserSession(request.server, sessionId)

  await dropUserSession(request.server, sessionId)
  request.yar.reset()
  request.cookieAuth.clear()

  return session
}

export function buildEndSessionUrl(endpoint, idToken) {
  const logoutUrl = new URL(endpoint)
  logoutUrl.searchParams.set(
    'post_logout_redirect_uri',
    new URL(AUTH_PATHS.SIGNED_OUT, config.get('appBaseUrl')).toString()
  )

  if (idToken) {
    logoutUrl.searchParams.set('id_token_hint', idToken)
  }

  return logoutUrl.toString()
}

export const signOutController = {
  async handler(request, h) {
    const session = await clearUserSession(request)
    request.logger.info({ userId: session?.user?.id }, 'Entra user signed out')

    try {
      const endpoint = await getEndSessionEndpoint()

      if (endpoint) {
        return h.redirect(buildEndSessionUrl(endpoint, session?.token?.idToken))
      }
    } catch (error) {
      request.logger.warn(
        { err: error },
        'Entra end-session endpoint was unavailable'
      )
    }

    return h.redirect(AUTH_PATHS.SIGNED_OUT)
  }
}

export const frontChannelLogoutController = {
  async handler(request, h) {
    const { iss, sid } = request.query

    if (typeof iss !== 'string' || typeof sid !== 'string') {
      throw Boom.badRequest('Front-channel logout requires iss and sid')
    }

    const sessionId = await getUserSessionIdByEntraSid(request.server, sid)
    const session = await getUserSession(request.server, sessionId)

    if (session) {
      if (session.claims?.iss !== iss || session.claims?.sid !== sid) {
        throw Boom.unauthorized('Front-channel logout claims do not match')
      }

      await dropUserSession(request.server, sessionId)

      if (request.state[USER_SESSION_COOKIE_NAME]?.sessionId === sessionId) {
        request.cookieAuth.clear()
      }

      request.logger.info(
        { userId: session.user?.id },
        'Entra front-channel logout completed'
      )
    }

    return h
      .response()
      .code(statusCodes.noContent)
      .header('cache-control', 'no-store')
  }
}

export const signedOutController = {
  handler(_request, h) {
    return h.view('auth/signed-out', {
      pageTitle: 'You have signed out'
    })
  }
}
