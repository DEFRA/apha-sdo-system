import Blankie from 'blankie'

import { config } from '#/config/config.js'
import { getEntraIdDiscoveryUrl } from '#/server/auth/credential-provider.js'
import { getDefraIdOrigins } from '#/server/auth/defra-id.js'

const uploaderUrl = process.env.UPLOADER_URL ?? 'http://localhost:7337'
const oidcAuthorizationOrigin = new URL(
  getEntraIdDiscoveryUrl(config.get('auth.entraId'))
).origin

// A local cdp-uploader (docker compose) is reached directly or via the nginx
// proxy; in real CDP environments the upload URL is relative so 'self' covers it
const isLocalUploader = !uploaderUrl.startsWith('https://')
const localUploaderOrigins = isLocalUploader
  ? ['http://localhost:7337', 'http://uploader.127.0.0.1.sslip.io:7300']
  : []

/**
 * Browsers enforce form-action on the redirects that follow a form
 * submission, so every origin the POST /sign-in-choose chain can pass
 * through has to be listed, as the Entra origin is. Customer Identity
 * publishes its discovery document from one host but authorizes and signs
 * out on others, so those come from the discovery document; the GOV.UK One
 * Login and Government Gateway hops it then makes are configuration
 * (`auth.defraId.redirectHosts`), already CSP source expressions.
 * @param {object} [settings] - auth.defraId configuration
 * @param {{ logger?: object }} [options]
 * @returns {Promise<string[]>}
 */
export async function getDefraIdFormActionOrigins(
  settings = config.get('auth.defraId'),
  { logger } = {}
) {
  if (!settings.enabled) {
    return []
  }

  const redirectHosts = (settings.redirectHosts ?? [])
    .map((host) => host.trim())
    .filter(Boolean)
  let providerOrigins = [new URL(settings.discoveryUrl).origin]

  try {
    providerOrigins = await getDefraIdOrigins({ settings, logger })
  } catch (error) {
    // Only reachable off CDP, where the defra-id plugin has already let a
    // failed discovery through as a warning (the stub may not be up yet).
    // The policy then covers the discovery host; restart once it is.
    logger?.warn?.(
      { err: error },
      'Defra ID discovery unavailable; CSP form-action covers the discovery origin only'
    )
  }

  return [...new Set([...providerOrigins, ...redirectHosts])]
}

export function getContentSecurityPolicyOptions(defraIdFormActionOrigins = []) {
  return {
    // Hash 'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw=' is to support a GOV.UK frontend script bundled within Nunjucks macros
    // https://frontend.design-system.service.gov.uk/import-javascript/#if-our-inline-javascript-snippet-is-blocked-by-a-content-security-policy
    defaultSrc: ['self'],
    fontSrc: ['self', 'data:'],
    connectSrc: ['self', 'wss', 'data:', uploaderUrl, ...localUploaderOrigins],
    mediaSrc: ['self'],
    styleSrc: ['self'],
    scriptSrc: [
      'self',
      "'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw='"
    ],
    imgSrc: ['self', 'data:'],
    frameSrc: ['self', 'data:'],
    objectSrc: ['none'],
    frameAncestors: ['none'],
    formAction: [
      'self',
      oidcAuthorizationOrigin,
      ...defraIdFormActionOrigins,
      uploaderUrl,
      ...localUploaderOrigins
    ],
    manifestSrc: ['self'],
    generateNonces: false
  }
}

/**
 * Manage content security policies. Wraps Blankie so the Customer Identity
 * origins can be read from its (already fetched) discovery document.
 * @satisfies {import('@hapi/hapi').Plugin}
 */
const contentSecurityPolicy = {
  plugin: {
    name: 'content-security-policy',
    async register(server) {
      const defraIdFormActionOrigins = await getDefraIdFormActionOrigins(
        config.get('auth.defraId'),
        { logger: server.logger }
      )

      await server.register({
        plugin: Blankie,
        options: getContentSecurityPolicyOptions(defraIdFormActionOrigins)
      })
    }
  }
}

export { contentSecurityPolicy }
