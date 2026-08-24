import { notFound } from '@hapi/boom'
import { finished } from 'node:stream/promises'

/**
 * Serves Vite assets locally while explicitly opting out of the default
 * authenticated route strategy.
 */
export const viteDevAssets = {
  plugin: {
    name: 'vite-dev-assets',
    register(server, options) {
      const { path, middleware } = options

      server.route({
        method: '*',
        path: `${path}/{param*}`,
        options: {
          auth: false
        },
        async handler(request, h) {
          const { req, res } = request.raw

          req.url = req.url.slice(path.length) || '/'

          const { promise: next, resolve: resolveNext } =
            Promise.withResolvers()
          middleware(req, res, () => resolveNext(true))

          const nextCalled = await Promise.race([finished(res), next])

          if (nextCalled) {
            return notFound()
          }

          return h.abandon
        }
      })
    }
  }
}
