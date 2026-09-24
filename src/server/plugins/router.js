import inert from '@hapi/inert'

import { home } from '../routes/home/index.js'
import { authRoutes } from '../routes/auth/index.js'
import { submissionWelcome } from '../routes/submission-welcome/index.js'
import { reportMethod } from '../routes/report-method/index.js'
import { diagnosticTests } from '../routes/diagnostic-tests/index.js'
import { health } from '../routes/health/index.js'
import { fileCallback } from '../routes/file-callback/index.js'
import { serveFormAssets } from './serve-form-assets.js'
import { serveStaticFiles } from './serve-static-files.js'
import { viteDevAssets } from './vite-dev-assets.js'
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

      // Interactive sign-in, callback and logout routes
      await server.register([authRoutes])

      // Post-sign-in welcome screen
      await server.register([submissionWelcome])

      // File upload or web form choice for report types offering both
      await server.register([reportMethod])

      // The qualifying tests a lab uses and their accreditation
      await server.register([diagnosticTests])

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
            plugin: viteDevAssets,
            options: {
              path: '/public',
              middleware: vite.middlewares
            }
          })
        })()
      } else {
        await server.register(serveStaticFiles)
      }
    }
  }
}
