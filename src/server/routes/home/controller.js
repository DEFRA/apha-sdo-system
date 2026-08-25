import { POST_SIGN_IN_PATH } from '#/server/auth/auth-constants.js'

/**
 * The home page is the service's entry point for signed-out visitors. A signed
 * in user has nothing to do here, so they go straight to their submissions.
 */
export const homeController = {
  handler(request, h) {
    if (request.auth.isAuthenticated) {
      return h.redirect(POST_SIGN_IN_PATH)
    }

    return h.view('home/index', {
      pageTitle: 'Home',
      heading: 'Home'
    })
  }
}
