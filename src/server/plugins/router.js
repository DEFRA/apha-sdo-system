import inert from '@hapi/inert'

import { home } from '../routes/home/index.js'
import { authRoutes } from '../routes/auth/index.js'
import { submissionWelcome } from '../routes/submission-welcome/index.js'
import { health } from '../routes/health/index.js'
import { fileCallback } from '../routes/file-callback/index.js'
import { serveFormAssets } from './serve-form-assets.js'
import { serveStaticFiles } from './serve-static-files.js'
import { config } from '#/config/config.js'

export const router = {
  plugin: {
    name: 'router',
    async register(server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      // Application specific routes, add your own routes here
      await server.register([home])

      // Sign-in journey screens (UI only, no auth strategy registered)
      await server.register([authRoutes])

      // Post-sign-in welcome screen
      await server.register([submissionWelcome])

      // cdp-uploader scan-completion callback
      await server.register([fileCallback])

      // Fonts and images referenced by the GOV.UK / forms engine stylesheets
      await server.register([serveFormAssets])

      // Static assets
      if (!config.get('isProduction') && !config.get('isTest')) {
        await (async () => {
          const createViteServer = (await import('vite')).createServer
          const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom'
          })

          await server.register({
            plugin: (await import('@defra/hapi-connect')).default,
            options: {
              path: '/public',
              middleware: [vite.middlewares]
            }
          })
        })()
      } else {
        server.register(serveStaticFiles)
      }
    }
  }
}
