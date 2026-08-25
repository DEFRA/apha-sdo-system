/**
 * Fingerprinted static assets, which are safe to cache and are not tied to a
 * user.
 */
const CACHEABLE_PATH_PREFIXES = ['/public/', '/assets/']
const CACHEABLE_PATHS = new Set(['/favicon.ico', '/health'])

function isCacheable(path) {
  return (
    CACHEABLE_PATHS.has(path) ||
    CACHEABLE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

/**
 * Stops pages being replayed from the browser's history after sign-out, which
 * would otherwise redisplay a user's name and report data on a shared machine.
 *
 * Runs after `catchAll`, so Boom errors have already become view responses.
 */
export function setCacheControlHeaders(request, h) {
  const { response } = request

  if (isCacheable(request.path) || response.isBoom) {
    return h.continue
  }

  // Handlers that have already chosen a policy, such as the front-channel
  // logout endpoint, keep it.
  if (!response.headers?.['cache-control']) {
    response.header('cache-control', 'no-cache, no-store, must-revalidate')
    response.header('pragma', 'no-cache')
    response.header('expires', '0')
  }

  return h.continue
}
