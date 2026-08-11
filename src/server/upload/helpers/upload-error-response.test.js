import { vi, describe, test, expect, beforeEach } from 'vitest'

import { buildUploadErrorResponse } from './upload-error-response.js'
import { uploadErrorCodes } from '../constants/upload-error-codes.js'

// Use vi.hoisted so the mock fn is available when vi.mock factory runs.
const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn()
}))

// Mock the logger so we can assert on internal log calls without real I/O.
vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ error: mockLoggerError })
}))

// Stub crypto so correlationId is deterministic when not supplied.
const FIXED_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
vi.mock('node:crypto', () => ({ randomUUID: () => FIXED_UUID }))

describe('#buildUploadErrorResponse', () => {
  beforeEach(() => {
    mockLoggerError.mockClear()
  })

  describe('response shape', () => {
    test('always returns success: false', () => {
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.FILE_TOO_LARGE
      })

      expect(result.success).toBe(false)
    })

    test('includes the errorCode in the response', () => {
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.FILE_TOO_LARGE
      })

      expect(result.errorCode).toBe(uploadErrorCodes.FILE_TOO_LARGE)
    })

    test('includes a correlationId in the response', () => {
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(result.correlationId).toBeDefined()
      expect(typeof result.correlationId).toBe('string')
    })

    test('uses the provided correlationId when supplied', () => {
      const supplied = 'my-correlation-id-123'
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        correlationId: supplied
      })

      expect(result.correlationId).toBe(supplied)
    })

    test('generates a correlationId when none is provided', () => {
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(result.correlationId).toBe(FIXED_UUID)
    })

    test('includes a user-facing message string', () => {
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.FILE_MISSING
      })

      expect(typeof result.message).toBe('string')
      expect(result.message.length).toBeGreaterThan(0)
    })
  })

  describe('validation error messages', () => {
    test('maps FILE_TOO_LARGE to the correct safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.FILE_TOO_LARGE
      })

      expect(message).toBe(
        'The selected file must be smaller than the maximum allowed size.'
      )
    })

    test('maps FILE_TYPE_NOT_ALLOWED to the correct safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.FILE_TYPE_NOT_ALLOWED
      })

      expect(message).toBe(
        'The selected file type is not allowed. Check the guidance and try again.'
      )
    })

    test('maps FILE_EMPTY to the correct safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.FILE_EMPTY
      })

      expect(message).toBe('The selected file is empty. Choose a different file.')
    })

    test('maps FILE_MISSING to the correct safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.FILE_MISSING
      })

      expect(message).toBe('No file was selected. Choose a file and try again.')
    })
  })

  describe('upload / storage error messages', () => {
    test('maps UPLOAD_FAILED to the correct safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED
      })

      expect(message).toBe('The file could not be uploaded. Try again later.')
    })

    test('maps STORAGE_UNAVAILABLE to the correct safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.STORAGE_UNAVAILABLE
      })

      expect(message).toBe(
        'The upload service is temporarily unavailable. Try again later.'
      )
    })
  })

  describe('security scan errors', () => {
    test('maps SECURITY_SCAN_FAILED to a vague safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.SECURITY_SCAN_FAILED
      })

      expect(message).toBe(
        'The file could not be accepted. If the problem continues, contact support.'
      )
    })

    test('does not include malware or threat details in the response', () => {
      const cause = new Error('Malware detected: EICAR-Test-File trojan')
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.SECURITY_SCAN_FAILED,
        cause
      })

      const serialised = JSON.stringify(result)
      expect(serialised).not.toContain('Malware')
      expect(serialised).not.toContain('EICAR')
      expect(serialised).not.toContain('trojan')
    })

    test('does not include macro detection details in the response', () => {
      const cause = new Error('Macros detected in uploaded document')
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.SECURITY_SCAN_FAILED,
        cause
      })

      const serialised = JSON.stringify(result)
      expect(serialised).not.toContain('Macros')
      expect(serialised).not.toContain('macro')
    })

    test('logs the security scan cause internally', () => {
      const cause = new Error('Malware detected: EICAR-Test-File trojan')
      buildUploadErrorResponse({
        errorCode: uploadErrorCodes.SECURITY_SCAN_FAILED,
        cause
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ cause: cause.message }),
        expect.any(String)
      )
    })
  })

  describe('unexpected / unknown errors', () => {
    test('maps UNKNOWN_ERROR to the generic safe message', () => {
      const { message } = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UNKNOWN_ERROR
      })

      expect(message).toBe('Something went wrong. Try again later.')
    })

    test('falls back to UNKNOWN_ERROR for an unrecognised error code', () => {
      const result = buildUploadErrorResponse({
        errorCode: 'NOT_A_REAL_CODE'
      })

      expect(result.errorCode).toBe(uploadErrorCodes.UNKNOWN_ERROR)
      expect(result.message).toBe('Something went wrong. Try again later.')
    })
  })

  describe('internal logging', () => {
    test('logs the technical cause for an Error instance', () => {
      const cause = new Error('internal connection timeout')
      buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: 'internal connection timeout',
          stack: cause.stack
        }),
        'Upload error'
      )
    })

    test('logs a string cause when no Error object is provided', () => {
      buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause: 'timeout after 30s'
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'timeout after 30s' }),
        'Upload error'
      )
    })

    test('logs extra context from logContext', () => {
      buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        logContext: { uploadId: 'abc-123', fileName: 'report.pdf' }
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ uploadId: 'abc-123', fileName: 'report.pdf' }),
        'Upload error'
      )
    })

    test('sensitive technical detail is only in the log, not the response', () => {
      const cause = new Error('Azure SAS token: sv=2021&sig=secretvalue')
      const result = buildUploadErrorResponse({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause
      })

      const serialised = JSON.stringify(result)
      expect(serialised).not.toContain('SAS')
      expect(serialised).not.toContain('sig=')
      expect(serialised).not.toContain('secretvalue')

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ cause: cause.message }),
        expect.any(String)
      )
    })
  })
})
