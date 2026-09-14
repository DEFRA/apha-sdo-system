export const AUTH_PATHS = {
  SIGN_IN_CHOOSE: '/sign-in-choose',
  SIGN_IN_EXTERNAL: '/sign-in-external',
  SIGN_IN_ENTRA: '/sign-in-entra',
  ENTRA_CALLBACK: '/signin-entra-id',
  SIGN_OUT: '/sign-out',
  FRONT_CHANNEL_LOGOUT: '/logout',
  SIGNED_OUT: '/signed-out',
  NO_ACCESS: '/no-access'
}

/**
 * Where a user lands once signed in, when they did not ask for a specific page
 * first.
 */
export const POST_SIGN_IN_PATH = '/submission-welcome'

export const USER_SESSION_COOKIE_NAME = 'userSession'
export const OIDC_STATE_COOKIE_NAME = 'entraOidc'
export const USER_SESSION_CACHE_SEGMENT = 'userSession'

/**
 * Carries the page the user originally asked for across the Entra round trip.
 * A cookie is the only carrier that survives it: the OIDC plugin owns the
 * `state` parameter, and the yar cookie is SameSite=Lax so it is not sent on
 * Entra's cross-site form_post callback.
 */
export const RETURN_TO_COOKIE_NAME = 'signInReturnTo'

/**
 * Query parameter @hapi/cookie appends to the sign-in redirect, naming the page
 * that triggered it.
 */
export const RETURN_TO_QUERY_PARAM = 'redirect'

/**
 * Flash message set when a signed-in user opens a report journey their Entra
 * roles do not grant, so /no-access can name the report type rather than the
 * service as a whole.
 */
export const NO_ACCESS_REPORT_TYPE_FLASH_KEY = 'noAccessReportType'
