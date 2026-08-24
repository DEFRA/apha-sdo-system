import {
  entraCallbackController,
  frontChannelLogoutController,
  signInChooseGetController,
  signInChoosePostController,
  signInEntraController,
  signInExternalController,
  signedOutController,
  signOutController
} from './controller.js'
import { AUTH_PATHS } from '#/server/auth/auth-constants.js'

/**
 * The journey starts at /sign-in-choose where the user picks a provider:
 *
 * - Defra Single Sign-on (internal users): Entra ID OIDC
 * - Government Gateway or GOV.UK One Login (external users): placeholder
 *   page only.
 */
function publicRoute(method, path, controller, options = {}) {
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
  publicRoute('GET', AUTH_PATHS.SIGN_IN_CHOOSE, signInChooseGetController),
  publicRoute('POST', AUTH_PATHS.SIGN_IN_CHOOSE, signInChoosePostController),
  publicRoute('GET', AUTH_PATHS.SIGN_IN_EXTERNAL, signInExternalController),
  publicRoute('GET', AUTH_PATHS.SIGN_IN_ENTRA, signInEntraController),
  publicRoute(
    ['GET', 'POST'],
    AUTH_PATHS.ENTRA_CALLBACK,
    entraCallbackController,
    {
      plugins: {
        crumb: false
      }
    }
  ),
  publicRoute('GET', AUTH_PATHS.SIGN_OUT, signOutController),
  publicRoute(
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
  publicRoute('GET', AUTH_PATHS.SIGNED_OUT, signedOutController)
]

export const authRoutes = {
  plugin: {
    name: 'auth-routes',
    register(server) {
      server.route(routes)
    }
  }
}
