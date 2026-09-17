/**
 * The forms engine sends a user back to the `returnUrl` query param of a
 * change link once they have answered, and this service links back to it
 * too. The engine only checks that it starts with "/", which lets a
 * protocol-relative "//other.site" (or "/\other.site", which browsers read
 * the same way) through and off to another site. Only a path within this
 * service is kept; anything else is dropped before any handler sees it.
 */

const PATH_WITHIN_SERVICE = /^\/(?![/\\])/

/**
 * @param {unknown} url - a candidate return URL
 * @returns {boolean}
 */
export function isSafeReturnUrl(url) {
  return typeof url === 'string' && PATH_WITHIN_SERVICE.test(url)
}

/**
 * hapi `onPreHandler` extension: removes a return URL that does not point
 * within this service from the request's query
 * @param {object} request - the hapi request
 * @param {object} h - the hapi response toolkit
 */
export function stripUnsafeReturnUrl(request, h) {
  const { returnUrl } = request.query ?? {}

  if (returnUrl !== undefined && !isSafeReturnUrl(returnUrl)) {
    request.logger?.warn(
      { returnUrl, path: request.path },
      'Ignoring a return URL outside the service'
    )
    delete request.query.returnUrl
  }

  return h.continue
}
