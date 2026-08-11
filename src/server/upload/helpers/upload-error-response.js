import { randomUUID } from 'node:crypto'

import { createLogger } from '../../common/helpers/logging/logger.js'
import { uploadErrorCodes } from '../constants/upload-error-codes.js'

const logger = createLogger()

/**
 * Safe user-facing messages keyed by error code.
 * Security-sensitive categories (e.g. SECURITY_SCAN_FAILED) use a deliberately
 * vague message so that malware detection results are never revealed to the user.
 */
const userMessages = {
  [uploadErrorCodes.FILE_TOO_LARGE]:
    'The selected file must be smaller than the maximum allowed size.',
  [uploadErrorCodes.FILE_TYPE_NOT_ALLOWED]:
    'The selected file type is not allowed. Check the guidance and try again.',
  [uploadErrorCodes.FILE_EMPTY]:
    'The selected file is empty. Choose a different file.',
  [uploadErrorCodes.FILE_MISSING]:
    'No file was selected. Choose a file and try again.',
  [uploadErrorCodes.SECURITY_SCAN_FAILED]:
    'The file could not be accepted. If the problem continues, contact support.',
  [uploadErrorCodes.UPLOAD_FAILED]:
    'The file could not be uploaded. Try again later.',
  [uploadErrorCodes.STORAGE_UNAVAILABLE]:
    'The upload service is temporarily unavailable. Try again later.',
  [uploadErrorCodes.UNKNOWN_ERROR]:
    'Something went wrong. Try again later.'
}

/**
 * Build a safe, consistent error response for the front end.
 *
 * Sensitive technical detail is written to the internal logger only and is
 * never included in the returned object.
 *
 * @param {object} options
 * @param {string} options.errorCode        - One of uploadErrorCodes
 * @param {Error|string} [options.cause]    - Internal error for logging only
 * @param {string} [options.correlationId]  - Existing request/correlation ID; a UUID is generated if omitted
 * @param {object} [options.logContext]     - Extra key/value pairs to include in the internal log entry
 * @returns {{ success: false, errorCode: string, message: string, correlationId: string }}
 */
export function buildUploadErrorResponse({
  errorCode,
  cause,
  correlationId,
  logContext = {}
}) {
  const resolvedCode = uploadErrorCodes[errorCode]
    ? errorCode
    : uploadErrorCodes.UNKNOWN_ERROR

  const id = correlationId ?? randomUUID()

  // Log full technical detail internally — never surfaces to the user, this goes to the CDP portal
  logger.error(
    {
      correlationId: id,
      errorCode: resolvedCode,
      cause: cause instanceof Error ? cause.message : cause,
      stack: cause instanceof Error ? cause.stack : undefined,
      ...logContext
    },
    'Upload error'
  )

  return {
    success: false,
    errorCode: resolvedCode,
    message: userMessages[resolvedCode] ?? userMessages[uploadErrorCodes.UNKNOWN_ERROR],
    correlationId: id
  }
}
