import path from 'path'
import crumb from '@hapi/crumb'
import hapi from '@hapi/hapi'
import Scooter from '@hapi/scooter'
import formsEnginePlugin from '@defra/forms-engine-plugin'

import { router } from './plugins/router.js'
import { config } from '#/config/config.js'
import { pulse } from './plugins/pulse.js'
import { catchAll } from './common/helpers/errors.js'
import { setCacheControlHeaders } from './common/helpers/cache-control.js'
import { nunjucksConfig } from '#/config/nunjucks/nunjucks.js'
import { context } from '#/config/nunjucks/context/context.js'
import { requestTracing } from './plugins/request-tracing.js'
import { requestLogger } from './plugins/request-logger.js'
import { sessionCache } from './plugins/session-cache.js'
import { getCacheEngine } from './common/helpers/session-cache/cache-engine.js'
import { secureContext } from '@defra/hapi-secure-context'
import { contentSecurityPolicy } from './plugins/content-security-policy.js'
import { metrics } from '@defra/cdp-metrics'
import { services } from './forms/services/index.js'
import { SummaryPageWithConfirmationEmailController } from './forms/controllers/summary-page-with-confirmation-email-controller.js'
import { openId } from './plugins/auth/open-id.js'
import { sessionCookie } from './plugins/auth/session-cookie.js'

export async function createServer() {
  const server = hapi.server({
    host: config.get('host'),
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        }
      },
      files: {
        relativeTo: path.resolve(config.get('root'), '.public')
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false
        },
        xss: 'enabled',
        noSniff: true,
        xframe: true
      }
    },
    router: {
      stripTrailingSlash: true
    },
    cache: [
      {
        name: config.get('session.cache.name'),
        engine: getCacheEngine(config.get('session.cache.engine'))
      }
    ],
    state: {
      strictHeader: false
    }
  })
  await server.register([
    crumb,
    requestLogger,
    requestTracing,
    metrics,
    secureContext,
    pulse,
    sessionCache,
    openId,
    sessionCookie,
    nunjucksConfig,
    Scooter,
    contentSecurityPolicy,
    router // Register all the controllers/routes defined in src/server/router.js
  ])

  // Register the forms-engine-plugin, which serves the form journeys defined
  // in src/server/forms/definitions at /{slug}
  await server.register({
    plugin: formsEnginePlugin,
    options: {
      baseUrl: config.get('formsEngine.baseUrl'),
      cache: config.get('session.cache.name'),
      /**
       * Options the forms-engine-plugin uses to render Nunjucks templates.
       * The base layout is shared with the rest of the service.
       */
      nunjucks: {
        baseLayoutPath: 'layouts/page.njk',
        paths: [
          path.resolve(config.get('root'), 'src/server/common/templates'),
          path.resolve(config.get('root'), 'src/server/common/components')
        ]
      },
      /**
       * Services the forms-engine-plugin uses to load forms and handle
       * submissions. See src/server/forms/services
       */
      services,
      /**
       * Custom page controllers referenced by form definitions but not
       * shipped with the plugin
       */
      controllers: {
        SummaryPageWithConfirmationEmailController
      },
      /**
       * View context made available to pages rendered by the plugin, reusing
       * the same context (assetPath, getAssetPath, serviceName, etc.) as the
       * rest of the service
       */
      viewContext: context
    }
  })

  server.ext('onPreResponse', catchAll)
  server.ext('onPreResponse', setCacheControlHeaders)

  return server
}
