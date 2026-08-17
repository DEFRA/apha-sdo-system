import {
  AUTH_PATHS,
  signInChooseGetController,
  signInChoosePostController,
  signInExternalController
} from './controller.js'

/**
 * Sign-in journey screens (UI only). The journey starts at /sign-in-choose
 * where the user picks a provider:
 *
 * - Defra ID (internal users, Entra ID / Azure AD): goes straight to the
 *   form journey (no auth yet)
 * - Government Gateway or GOV.UK One Login (external users): placeholder
 *   page only
 */
export const authRoutes = {
  plugin: {
    name: 'auth-routes',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: AUTH_PATHS.SIGN_IN_CHOOSE,
          ...signInChooseGetController
        },
        {
          method: 'POST',
          path: AUTH_PATHS.SIGN_IN_CHOOSE,
          ...signInChoosePostController
        },
        {
          method: 'GET',
          path: AUTH_PATHS.SIGN_IN_EXTERNAL,
          ...signInExternalController
        }
      ])
    }
  }
}
