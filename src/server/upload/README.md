# Upload API error contract

This folder contains the backend upload error model used for file validation, upload failures, security scan failures, and unexpected errors.

## Purpose

Provide a safe, consistent response format to the front end while keeping technical details in backend logs.

## Source files

- constants/upload-error-codes.js
- helpers/upload-error-response.js
- helpers/upload-error-response.test.js

## Standard error response model

All upload and upload-validation failures returned to the front end must use this shape:

success: false
errorCode: string
message: string
correlationId: string

Example:

{
  "success": false,
  "errorCode": "FILE_TOO_LARGE",
  "message": "The selected file must be smaller than the maximum allowed size.",
  "correlationId": "9c2e6f7a-2b6f-4f1e-9e66-2f1115b3f7b2"
}

## Error categories

Defined in constants/upload-error-codes.js:

- FILE_TOO_LARGE
- FILE_TYPE_NOT_ALLOWED
- FILE_EMPTY
- FILE_MISSING
- SECURITY_SCAN_FAILED
- UPLOAD_FAILED
- STORAGE_UNAVAILABLE
- UNKNOWN_ERROR

## Security and sensitive data rules

- Front end responses must never include malware names, macro detection results, scan engine output, tokens, connection strings, stack traces, or raw infrastructure error details.
- SECURITY_SCAN_FAILED must use a deliberately vague user-facing message.
- Detailed failure context is logged internally only.
- Internal log entries are emitted through the standard service logger and are available in the platform log pipeline (including the CDP portal where configured).

## Correlation ID rules

- Every response includes correlationId.
- If request context already provides one, pass it through.
- If not provided, generate one.
- Use correlationId in support and investigation workflows to find matching logs.
- Use the same correlationId when searching logs in CDP observability tools.

## Usage pattern

1. Catch the internal error in upload service or controller.
2. Map the failure to an errorCode from constants/upload-error-codes.js.
3. Build the response with helpers/upload-error-response.js.
4. Return that object to the front end.
5. Do not return internal exception details.

## Example usage

### Controller-level error mapping

```javascript
import { statusCodes } from '../common/constants/status-codes.js'
import { uploadErrorCodes } from './constants/upload-error-codes.js'
import { buildUploadErrorResponse } from './helpers/upload-error-response.js'

export const uploadController = {
  async handler(request, h) {
    try {
      await request.services().uploadService.upload(request.payload.file)
      return h.response({ success: true }).code(statusCodes.ok)
    } catch (error) {
      const correlationId = request.info.id

      const response = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause: error,
        correlationId,
        logContext: {
          route: request.path,
          method: request.method
        }
      })

      return h.response(response).code(statusCodes.badRequest)
    }
  }
}
```

### Security-scan failure mapping

```javascript
import { uploadErrorCodes } from './constants/upload-error-codes.js'
import { buildUploadErrorResponse } from './helpers/upload-error-response.js'

function mapScanFailure({ scanError, correlationId }) {
  return buildUploadErrorResponse({
    errorCode: uploadErrorCodes.SECURITY_SCAN_FAILED,
    cause: scanError,
    correlationId,
    logContext: { stage: 'security-scan' }
  })
}
```

The response sent to the front end remains safe and generic for
SECURITY_SCAN_FAILED, while the technical scan detail stays in internal logs.

## Unknown error handling

- If a failure cannot be classified, return UNKNOWN_ERROR.
- The user-facing message for UNKNOWN_ERROR must remain generic and safe.

## Test coverage

Contract and safety behavior are validated in helpers/upload-error-response.test.js, including:

- consistent response shape
- category-to-message mapping
- correlationId behavior
- unknown error fallback
- sensitive detail redaction in responses
- internal logging of technical details
