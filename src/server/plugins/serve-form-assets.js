import path from 'node:path'
import { createRequire } from 'node:module'

import { config } from '#/config/config.js'

const require = createRequire(import.meta.url)

const govukFrontendAssets = path.join(
  path.dirname(require.resolve('govuk-frontend/package.json')),
  'dist/govuk/assets'
)
const formsEngineAssets = path.join(
  path.dirname(require.resolve('@defra/forms-engine-plugin/package.json')),
  '.public/assets'
)

// The forms engine CSS is compiled with $govuk-assets-path: "/assets/",
// so its fonts and images must be served from /assets.
export const serveFormAssets = {
  plugin: {
    name: 'formAssets',
    register(server) {
      server.route({
        method: 'GET',
        path: '/assets/{param*}',
        options: {
          auth: false,
          cache: {
            expiresIn: config.get('staticCacheTimeout'),
            privacy: 'private'
          }
        },
        handler: {
          directory: {
            path: [govukFrontendAssets, formsEngineAssets],
            redirectToSlash: true
          }
        }
      })
    }
  }
}
