export const uploadErrorCodes = {
  // File validation errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_EMPTY: 'FILE_EMPTY',
  FILE_MISSING: 'FILE_MISSING',

  // Security scan
  SECURITY_SCAN_FAILED: 'SECURITY_SCAN_FAILED',

  // Upload / storage infrastructure
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',

  // Catch-all for unexpected errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
}
