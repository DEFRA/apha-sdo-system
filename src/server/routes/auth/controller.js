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
  USER_SESSION_COOKIE_NAME
} from '#/server/auth/auth-constants.js'
import {
  dropUserSession,
  getUserSession,
  getUserSessionIdByEntraSid,
  setUserSession
} from '#/server/auth/user-session.js'
import { getEndSessionEndpoint } from '#/server/plugins/auth/open-id.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const SIGN_IN_ERROR_FLASH_KEY = 'signInError'

/**
 * Internal users authenticate with Entra ID. External authentication remains
 * a placeholder until its identity provider is agreed.
 */
export const signInChooseGetController = {
  handler(request, h) {
    const [error] = request.yar.flash(SIGN_IN_ERROR_FLASH_KEY)

    return h.view('auth/sign-in-choose', {
      pageTitle: 'How do you want to sign in?',
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

    if (!redirectTo) {
      request.yar.flash(
        SIGN_IN_ERROR_FLASH_KEY,
        'Select how you want to sign in'
      )

      return h.redirect(AUTH_PATHS.SIGN_IN_CHOOSE)
    }

    return h.redirect(redirectTo)
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
    try {
      return await request.login(h)
    } catch (error) {
      request.logger.error({ err: error }, 'Entra sign-in could not be started')
      request.yar.flash(
        SIGN_IN_ERROR_FLASH_KEY,
        'Defra sign in is temporarily unavailable. Try again.'
      )
      return h.redirect(AUTH_PATHS.SIGN_IN_CHOOSE)
    }
  }
}

export const entraCallbackController = {
  async handler(request, h) {
    let token

    try {
      token = await request.callback(h)
    } catch (error) {
      request.logger.warn({ err: error }, 'Entra sign-in failed')
      request.yar.flash(
        SIGN_IN_ERROR_FLASH_KEY,
        'We could not sign you in. Try again.'
      )
      return h.redirect(AUTH_PATHS.SIGN_IN_CHOOSE)
    }

    const claims = token.claims ?? {}
    assertAllowedEntraGroups(
      claims,
      getAllowedGroupIds(config.get('auth.entraId'))
    )

    const sessionId = randomUUID()
    const user = getUserProfile(claims)

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

    return h.redirect('/submission-welcome')
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
