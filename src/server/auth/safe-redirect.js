import { AUTH_PATHS, POST_SIGN_IN_PATH } from './auth-constants.js'

/**
 * Only used to resolve and normalise relative paths. Never sent to the browser.
 */
const RESOLUTION_ORIGIN = 'https://redirect.invalid'

const authPaths = new Set(Object.values(AUTH_PATHS))

/**
 * Returns `redirect` when it points at a page within this service, otherwise
 * `fallback`.
 *
 * Anything that reaches the browser as a `Location` has to be checked, because
 * the value originates from a query parameter a user can edit.
 *
 * @param {unknown} redirect
 * @param {string} [fallback]
 * @returns {string}
 */
export function getSafeRedirect(redirect, fallback = POST_SIGN_IN_PATH) {
  if (typeof redirect !== 'string' || !redirect.startsWith('/')) {
    return fallback
  }

  // A second character of / or \ makes a protocol-relative URL, which browsers
  // resolve against an external origin, e.g. //evil.test or /\evil.test
  if (redirect[1] === '/' || redirect[1] === '\\') {
    return fallback
  }

  let url

  try {
    url = new URL(redirect, RESOLUTION_ORIGIN)
  } catch {
    return fallback
  }

  // Returning a signed-in user to an auth path either restarts the handshake
  // or replays a callback that can only be processed once.
  if (authPaths.has(url.pathname)) {
    return fallback
  }

  return `${url.pathname}${url.search}`
}
