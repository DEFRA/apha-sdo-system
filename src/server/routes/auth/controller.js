const SIGN_IN_ERROR_FLASH_KEY = 'signInError'

export const AUTH_PATHS = {
  SIGN_IN_CHOOSE: '/sign-in-choose',
  SIGN_IN_EXTERNAL: '/sign-in-external'
}

/**
 * UI-only sign-in journey. No auth strategy is registered: selecting
 * "Defra ID" (internal users, Entra ID / Azure AD) goes to the submission
 * welcome screen; "Government Gateway or GOV.UK One Login" (external data
 * providers) shows a placeholder page.
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
      defraId: '/submission-welcome',
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
