import { statusCodes } from '#/server/common/constants/status-codes.js'
import { redisUploadStore } from '#/server/services/redis-upload-store.js'

// File fields in the callback payload are objects with fileId/fileStatus
// (or arrays of them); other fields are plain values.
function extractFiles(form = {}) {
  return Object.values(form)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(
      (value) =>
        value !== null &&
        typeof value === 'object' &&
        'fileId' in value &&
        'fileStatus' in value
    )
}

// Scan-completion callback from the cdp-uploader ({SUBMISSION_URL}/file).
// The uploader retries via SQS until it gets a 2xx back.
export const fileCallbackController = {
  options: {
    plugins: {
      crumb: false // server-to-server callback, no CSRF token
    },
    payload: {
      parse: true,
      allow: 'application/json'
    }
  },
  async handler(request, h) {
    const { payload } = request

    const files = extractFiles(payload?.form)

    request.logger.info(
      {
        uploadStatus: payload?.uploadStatus,
        numberOfRejectedFiles: payload?.numberOfRejectedFiles,
        files: files.map(
          ({ fileId, filename, fileStatus, s3Bucket, s3Key }) => ({
            fileId,
            filename,
            fileStatus,
            s3Bucket,
            s3Key
          })
        )
      },
      'cdp-uploader scan-completion callback received'
    )

    // Track scan outcomes for observability and future status endpoints.
    // Never fail the ack over tracking: the uploader would keep retrying.
    try {
      await Promise.all(
        files.map(({ fileId, filename, fileStatus, s3Bucket, s3Key }) =>
          redisUploadStore.setUpload(fileId, {
            type: 'scan',
            fileId,
            filename,
            fileStatus,
            s3Bucket,
            s3Key,
            uploadStatus: payload?.uploadStatus,
            scannedAt: new Date().toISOString()
          })
        )
      )
    } catch (error) {
      request.logger.error(
        { error: error.message },
        'Failed to record scan outcome in upload store'
      )
    }

    return h.response({ message: 'success' }).code(statusCodes.ok)
  }
}
