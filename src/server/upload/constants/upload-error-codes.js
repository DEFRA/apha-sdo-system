// File validation, type checks and virus scanning happen upstream in the
// CDP uploader / forms-engine-plugin, which already has its own approved
// error messages. These codes only cover failures in the one step our own
// backend owns: transferring a scanned file from S3 staging into Azure.
export const uploadErrorCodes = {
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',

  // Catch-all for unexpected errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
}
