# Azure transfer error handling

This folder contains the backend error handling for the one upload step our
own code owns: transferring a scanned file from S3 staging into Azure Blob
Storage, and writing the submission JSON alongside it (see
[output-service.js](../forms/services/output-service.js)).

## Scope - what this is not

This app is server-side rendered (GOV.UK Design System pages), not a JSON
API, so there is no front-end HTTP client to consume a `{success, errorCode,
message, correlationId}` payload.

File size limits, file type checks and virus scanning happen upstream in the
CDP uploader and are already surfaced to users by
`@defra/forms-engine-plugin`'s `FileUploadField`, which has its own
pre-approved messages (e.g. "The selected file must be smaller than 100MB",
"The selected file must be a {type}", "The selected file contains a virus")
plus its own unknown-error fallback. This folder does not duplicate that
handling.

## Source files

- constants/upload-error-codes.js
- helpers/upload-error-response.js
- helpers/upload-error-response.test.js

## How it works

1. `outputService.submit` (in `output-service.js`) wraps the Azure transfer
   and submission-JSON upload in a try/catch.
2. On failure, `buildUploadTransferError` in `helpers/upload-error-response.js`
   logs the full technical cause internally and returns a `Boom.internal`
   error carrying only a safe message, an error code, and a correlationId in
   `boom.data`.
3. That Boom error propagates up to the existing global `onPreResponse`
   handler (`catchAll` in
   [errors.js](../common/helpers/errors.js)), which renders it on the
   standard `error/index` page - the same page every other error in this app
   already uses. No new consumer or contract is needed.

## Error categories

Defined in constants/upload-error-codes.js:

- UPLOAD_FAILED
- STORAGE_UNAVAILABLE
- UNKNOWN_ERROR

## Security and sensitive data rules

- The rendered error page must never include stack traces, connection
  strings, S3/Azure error detail, or any other internal exception content.
- Detailed failure context (the original error, stack, referenceNumber, etc.)
  is logged internally only, via `helpers/upload-error-response.js`.
- Internal log entries are emitted through the standard service logger and
  are available in the platform log pipeline, including the CDP portal.

## Correlation ID rules

- The correlationId is the existing request trace ID (read via `getTraceId()`
  from `@defra/hapi-tracing`), which is the same ID already stamped on every
  log line for that request via the `x-cdp-request-id` header (see
  [logger-options.js](../plugins/logger-options.js)). It is not a new,
  disconnected ID.
- The error page shows this correlationId so a user can quote it to support,
  and that same ID can be searched for directly in CDP log search.

## Usage pattern

1. Wrap the Azure transfer/upload call in a try/catch (see
   `output-service.js`).
2. On failure, call `buildUploadTransferError` with an errorCode from
   `constants/upload-error-codes.js` and the original error as `cause`.
3. Throw the returned Boom error - do not return or render the original
   error's message anywhere.

### Example

```javascript
import { uploadErrorCodes } from './constants/upload-error-codes.js'
import { buildUploadTransferError } from './helpers/upload-error-response.js'

try {
  await azureStorageService.uploadFile(uploadId, file, metadata)
} catch (error) {
  throw buildUploadTransferError({
    errorCode: uploadErrorCodes.UPLOAD_FAILED,
    cause: error,
    logContext: { referenceNumber }
  })
}
```

## Unknown error handling

- If a failure cannot be classified, use UNKNOWN_ERROR.
- The user-facing message for UNKNOWN_ERROR must remain generic and safe.

## Test coverage

Contract and safety behaviour are validated in
helpers/upload-error-response.test.js, including:

- Boom error shape (status code, data.errorCode, data.safeMessage)
- correlationId sourced from the existing trace ID, with a safe fallback
- category-to-message mapping and unknown error fallback
- sensitive detail redaction (raw cause/stack never present on the boom
  error, only in the logger call)

[output-service.test.js](../forms/services/output-service.test.js) covers the
integration: an Azure transfer failure is rethrown as a safe error while the
raw cause is still recorded in Redis for investigation.
