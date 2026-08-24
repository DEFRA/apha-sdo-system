import { vi, describe, test, expect, beforeEach } from 'vitest'

import { buildUploadTransferError } from './upload-error-response.js'
import { uploadErrorCodes } from '../constants/upload-error-codes.js'

// Use vi.hoisted so the mock fns are available when vi.mock factories run.
const { mockLoggerError, mockGetTraceId } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
  mockGetTraceId: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ error: mockLoggerError })
}))

vi.mock('@defra/hapi-tracing', () => ({
  getTraceId: mockGetTraceId
}))

const FIXED_TRACE_ID = 'cdp-trace-id-123'

describe('#buildUploadTransferError', () => {
  beforeEach(() => {
    mockLoggerError.mockClear()
    mockGetTraceId.mockReturnValue(FIXED_TRACE_ID)
  })

  describe('Boom error shape', () => {
    test('returns a Boom error with a 500 status', () => {
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(error.isBoom).toBe(true)
      expect(error.output.statusCode).toBe(500)
    })

    test('attaches the errorCode to boom.data', () => {
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(error.data.errorCode).toBe(uploadErrorCodes.UPLOAD_FAILED)
    })

    test('attaches a safeMessage string to boom.data', () => {
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(typeof error.data.safeMessage).toBe('string')
      expect(error.data.safeMessage.length).toBeGreaterThan(0)
    })
  })

  describe('correlationId', () => {
    test('uses the existing trace ID (x-cdp-request-id) as the correlationId', () => {
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(error.data.correlationId).toBe(FIXED_TRACE_ID)
    })

    test('falls back to "unknown" when no trace ID is available', () => {
      mockGetTraceId.mockReturnValue(undefined)

      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(error.data.correlationId).toBe('unknown')
    })

    test('logs the same correlationId used in boom.data', () => {
      buildUploadTransferError({ errorCode: uploadErrorCodes.UPLOAD_FAILED })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: FIXED_TRACE_ID }),
        expect.any(String)
      )
    })
  })

  describe('message mapping', () => {
    test('maps UPLOAD_FAILED to the correct safe message', () => {
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(error.data.safeMessage).toBe(
        'Your file could not be saved. Try submitting again, and contact us if the problem continues.'
      )
    })

    test('maps STORAGE_UNAVAILABLE to the correct safe message', () => {
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.STORAGE_UNAVAILABLE
      })

      expect(error.data.safeMessage).toBe(
        'The upload service is temporarily unavailable. Try again later.'
      )
    })

    test('maps UNKNOWN_ERROR to the generic safe message', () => {
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UNKNOWN_ERROR
      })

      expect(error.data.safeMessage).toBe(
        'Something went wrong while processing your submission. Try again later.'
      )
    })

    test('falls back to UNKNOWN_ERROR for an unrecognised error code', () => {
      const error = buildUploadTransferError({ errorCode: 'NOT_A_REAL_CODE' })

      expect(error.data.errorCode).toBe(uploadErrorCodes.UNKNOWN_ERROR)
      expect(error.data.safeMessage).toBe(
        'Something went wrong while processing your submission. Try again later.'
      )
    })
  })

  describe('sensitive detail redaction', () => {
    test('does not include the raw cause message in the boom error', () => {
      const cause = new Error('Azure SAS token: sv=2021&sig=secretvalue')
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause
      })

      const serialised = JSON.stringify({
        message: error.message,
        data: error.data,
        output: error.output
      })

      expect(serialised).not.toContain('SAS')
      expect(serialised).not.toContain('sig=')
      expect(serialised).not.toContain('secretvalue')
    })

    test('does not include stack traces in boom.data', () => {
      const cause = new Error('connection reset by peer')
      const error = buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause
      })

      expect(error.data.stack).toBeUndefined()
    })

    test('logs the technical cause and stack internally only', () => {
      const cause = new Error('connection reset by peer')
      buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: 'connection reset by peer',
          stack: cause.stack
        }),
        'Azure transfer error'
      )
    })

    test('logs a string cause when no Error object is provided', () => {
      buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause: 'timeout after 30s'
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'timeout after 30s' }),
        'Azure transfer error'
      )
    })

    test('logs extra context from logContext', () => {
      buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        logContext: { referenceNumber: 'REF-123' }
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ referenceNumber: 'REF-123' }),
        'Azure transfer error'
      )
    })
  })
})
