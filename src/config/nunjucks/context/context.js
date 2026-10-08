import path from 'node:path'
import { readFileSync } from 'node:fs'

import { config } from '#/config/config.js'
import { AUTH_PROVIDERS } from '#/server/auth/auth-constants.js'
import { identityRows } from '#/server/common/helpers/identity-rows.js'
import { buildBreadcrumbs } from './build-breadcrumbs.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()
const assetPath = config.get('assetPath')
const manifestPath = path.join(
  config.get('root'),
  '.public/.vite/manifest.json'
)

let viteManifest

/**
 * Your Defra account, for users who signed in with Defra Customer Identity.
 * Entra users have no account there, and an environment without the URL
 * configured gets no link rather than a broken one.
 * @param {{ provider?: string } | null} user - the session user
 */
export function accountManagementUrlFor(user) {
  if (user?.provider !== AUTH_PROVIDERS.DEFRA_ID) {
    return null
  }

  return config.get('auth.defraId.accountManagementUrl') || null
}

export function context(request) {
  if (config.get('isProduction') && !viteManifest) {
    try {
      viteManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      logger.error(`Vite ${path.basename(manifestPath)} not found`)
    }
  }

  const signedInUser = request?.auth?.credentials?.user ?? null

  return {
    assetPath: `${assetPath}/assets`,
    serviceName: config.get('serviceName'),
    serviceUrl: '/',
    isAuthenticated: request?.auth?.isAuthenticated ?? false,
    signedInUser,
    accountManagementUrl: accountManagementUrlFor(signedInUser),
    identityRows: identityRows(signedInUser),
    breadcrumbs: buildBreadcrumbs(request),
    getAssetPath(asset) {
      if (!config.get('isProduction')) {
        return `${assetPath}/${asset}`
      }

      const viteAssetPath = viteManifest?.[asset]?.file
      return `${assetPath}/${viteAssetPath ?? asset}`
    }
  }
}
