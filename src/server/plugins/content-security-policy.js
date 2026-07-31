import Blankie from 'blankie'

const uploaderUrl = process.env.UPLOADER_URL ?? 'http://localhost:7337'

// A local cdp-uploader (docker compose) is reached directly or via the nginx
// proxy; in real CDP environments the upload URL is relative so 'self' covers it
const isLocalUploader = !uploaderUrl.startsWith('https://')
const localUploaderOrigins = isLocalUploader
  ? ['http://localhost:7337', 'http://uploader.127.0.0.1.sslip.io:7300']
  : []

/**
 * Manage content security policies.
 * @satisfies {import('@hapi/hapi').Plugin}
 */
const contentSecurityPolicy = {
  plugin: Blankie,
  options: {
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
    formAction: ['self', uploaderUrl, ...localUploaderOrigins],
    manifestSrc: ['self'],
    generateNonces: false
  }
}

export { contentSecurityPolicy }
