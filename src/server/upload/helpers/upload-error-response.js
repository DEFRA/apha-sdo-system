import Boom from '@hapi/boom'
import { getTraceId } from '@defra/hapi-tracing'

import { createLogger } from '../../common/helpers/logging/logger.js'
import { uploadErrorCodes } from '../constants/upload-error-codes.js'

const logger = createLogger()

/**
 * Safe, pre-approved user-facing messages keyed by error code. These cover
 * only the Azure transfer step; upload/type/virus-scan messages are already
 * handled upstream by the forms-engine-plugin.
 */
const userMessages = {
  [uploadErrorCodes.UPLOAD_FAILED]:
    'Your file could not be saved. Try submitting again, and contact us if the problem continues.',
  [uploadErrorCodes.STORAGE_UNAVAILABLE]:
    'The upload service is temporarily unavailable. Try again later.',
  [uploadErrorCodes.UNKNOWN_ERROR]:
    'Something went wrong while processing your submission. Try again later.'
}

/**
 * Build a Boom error for an Azure transfer failure.
 *
 * Technical detail (cause, stack, extra context) is written to the internal
 * logger only. The returned Boom error carries just a safe message and a
 * correlationId in `data`, for the SSR error page (see errors.js) to render.
 *
 * The correlationId is the existing request trace ID (from the `x-cdp-request-id`
 * header, via @defra/hapi-tracing) so it matches what already appears
 * against every log line for this request - not a disconnected new ID.
 *
 * @param {object} options
 * @param {string} options.errorCode      - One of uploadErrorCodes
 * @param {Error|string} [options.cause]  - Internal error for logging only
 * @param {object} [options.logContext]   - Extra key/value pairs for the internal log entry
 * @returns {import('@hapi/boom').Boom}
 */
export function buildUploadTransferError({
  errorCode,
  cause,
  logContext = {}
}) {
  const resolvedCode = uploadErrorCodes[errorCode]
    ? errorCode
    : uploadErrorCodes.UNKNOWN_ERROR

  const correlationId = getTraceId() ?? 'unknown'

  // Log full technical detail internally - never surfaces to the user.
  logger.error(
    {
      correlationId,
      errorCode: resolvedCode,
      cause: cause instanceof Error ? cause.message : cause,
      stack: cause instanceof Error ? cause.stack : undefined,
      ...logContext
    },
    'Azure transfer error'
  )

  const safeMessage =
    userMessages[resolvedCode] ?? userMessages[uploadErrorCodes.UNKNOWN_ERROR]

  return Boom.internal(safeMessage, {
    safeMessage,
    errorCode: resolvedCode,
    correlationId
  })
}
