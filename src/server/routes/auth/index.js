import {
  entraCallbackController,
  frontChannelLogoutController,
  noAccessController,
  signInChooseGetController,
  signInChoosePostController,
  signInEntraController,
  signInExternalController,
  signedOutController,
  signOutController
} from './controller.js'
import {
  AUTH_PATHS,
  RETURN_TO_QUERY_PARAM
} from '#/server/auth/auth-constants.js'
import { getSafeRedirect } from '#/server/auth/safe-redirect.js'

/**
 * The journey starts at /sign-in-choose where the user picks a provider:
 *
 * - Defra Single Sign-on (internal users): Entra ID OIDC
 * - Government Gateway or GOV.UK One Login (external users): placeholder
 *   page only.
 */

/**
 * Sends a signed-in user on to the page they asked for instead of letting them
 * back into the sign-in journey, where choosing a provider would start a second
 * handshake and replace the session they already have.
 */
function redirectWhenSignedIn(request, h) {
  if (!request.auth.isAuthenticated) {
    return h.continue
  }

  const returnTo =
    request.query?.[RETURN_TO_QUERY_PARAM] ??
    request.payload?.[RETURN_TO_QUERY_PARAM]

  return h.redirect(getSafeRedirect(returnTo)).takeover()
}

/**
 * A page that only makes sense when signed out. `mode: 'try'` rather than
 * `auth: false` so the handler can see an existing session at all.
 */
function guestRoute(method, path, controller, options = {}) {
  return {
    method,
    path,
    ...controller,
    options: {
      auth: { mode: 'try' },
      ext: {
        onPreHandler: { method: redirectWhenSignedIn }
      },
      ...options
    }
  }
}

/**
 * An endpoint called by the identity provider rather than browsed to, so there
 * is no session to consider.
 */
function providerRoute(method, path, controller, options = {}) {
  return {
    method,
    path,
    ...controller,
    options: {
      auth: false,
      ...options
    }
  }
}

const routes = [
  guestRoute('GET', AUTH_PATHS.SIGN_IN_CHOOSE, signInChooseGetController),
  guestRoute('POST', AUTH_PATHS.SIGN_IN_CHOOSE, signInChoosePostController),
  guestRoute('GET', AUTH_PATHS.SIGN_IN_EXTERNAL, signInExternalController),
  guestRoute('GET', AUTH_PATHS.SIGN_IN_ENTRA, signInEntraController),
  guestRoute('GET', AUTH_PATHS.SIGNED_OUT, signedOutController),
  providerRoute(
    ['GET', 'POST'],
    AUTH_PATHS.ENTRA_CALLBACK,
    entraCallbackController,
    {
      plugins: {
        crumb: false
      }
    }
  ),
  providerRoute(
    'GET',
    AUTH_PATHS.FRONT_CHANNEL_LOGOUT,
    frontChannelLogoutController,
    {
      security: {
        xframe: false
      },
      plugins: {
        blankie: false
      }
    }
  ),
  {
    method: 'POST',
    path: AUTH_PATHS.SIGN_OUT,
    ...signOutController,
    options: {
      // Signing out is a state change, so it is a POST carrying a CSRF crumb.
      // `try` rather than `required` because a user refused access by
      // authorization has no session here but still needs to end the one Entra
      // holds for them.
      auth: { mode: 'try' }
    }
  },
  {
    method: 'GET',
    path: AUTH_PATHS.NO_ACCESS,
    ...noAccessController,
    options: {
      auth: { mode: 'try' }
    }
  }
]

export const authRoutes = {
  plugin: {
    name: 'auth-routes',
    register(server) {
      server.route(routes)
    }
  }
}
