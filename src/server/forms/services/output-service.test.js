import { config } from '#/config/config.js'
import {
  outputService,
  extractFileStates
} from '#/server/forms/services/output-service.js'
import { downloadFromS3 } from '#/server/common/helpers/s3-client.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import { redisUploadStore } from '#/server/services/redis-upload-store.js'
import { uploadErrorCodes } from '#/server/upload/constants/upload-error-codes.js'

vi.mock('#/server/common/helpers/s3-client.js', () => ({
  downloadFromS3: vi.fn()
}))

vi.mock('#/server/upload/services/azure-storage-service.js', () => ({
  azureStorageService: { uploadFile: vi.fn() }
}))

vi.mock('#/server/services/redis-upload-store.js', () => ({
  redisUploadStore: { setUpload: vi.fn(), getUpload: vi.fn() }
}))

function buildFileState({
  uploadId = 'upload-1',
  fileId = 'file-1',
  filename = 'data.xlsx',
  fileStatus = 'complete',
  s3Bucket = 'apha-sdo-uploads',
  s3Key = 'staging/upload-1/file-1',
  contentType = 'text/csv'
} = {}) {
  return {
    uploadId,
    status: {
      uploadStatus: 'ready',
      metadata: { retrievalKey: 'enter-your-email-address' },
      form: {
        file: { fileId, filename, fileStatus, s3Bucket, s3Key, contentType }
      },
      numberOfRejectedFiles: 0
    }
  }
}

function buildRequest() {
  return { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
}

const submitArgs = (context, request) => [
  context,
  request,
  {},
  'someone@example.com',
  [{ name: 'field', title: 'Field', value: 'answer' }],
  {},
  { slug: 'sdo-test' }
]

describe('#extractFileStates', () => {
  test('finds file states in top-level form state', () => {
    const fileState = buildFileState()
    const state = { supportingDocuments: [fileState], name: 'Ben' }

    expect(extractFileStates(state)).toEqual([fileState])
  })

  test('finds file states nested under section names', () => {
    const fileState = buildFileState()
    const state = { documentsSection: { supportingDocuments: [fileState] } }

    expect(extractFileStates(state)).toEqual([fileState])
  })

  test('ignores plain values and non-file arrays', () => {
    const state = {
      name: 'Ben',
      hobbies: ['music', 'reading'],
      address: { town: 'x' }
    }

    expect(extractFileStates(state)).toEqual([])
  })
})

describe('#outputService.submit', () => {
  beforeEach(() => {
    config.set('azure.storage.enabled', true)
    downloadFromS3.mockResolvedValue({
      buffer: Buffer.from('file-content'),
      contentType: 'text/csv'
    })
    azureStorageService.uploadFile.mockResolvedValue({
      success: true,
      blobName: 'REF-1/data.xlsx'
    })
    redisUploadStore.setUpload.mockResolvedValue(true)
    redisUploadStore.getUpload.mockResolvedValue(null)
  })

  afterEach(() => {
    config.set('azure.storage.enabled', false)
  })

  test('does not transfer anything when Azure storage is disabled', async () => {
    config.set('azure.storage.enabled', false)

    const context = {
      referenceNumber: 'REF-1',
      relevantState: { supportingDocuments: [buildFileState()] }
    }
    const request = buildRequest()

    await outputService.submit(...submitArgs(context, request))

    expect(downloadFromS3).not.toHaveBeenCalled()
    expect(azureStorageService.uploadFile).not.toHaveBeenCalled()
    expect(request.logger.info).toHaveBeenCalled()
  })

  test('transfers completed files from S3 to Azure and uploads submission JSON', async () => {
    const context = {
      referenceNumber: 'REF-1',
      relevantState: { supportingDocuments: [buildFileState()] }
    }
    const request = buildRequest()

    await outputService.submit(...submitArgs(context, request))

    expect(downloadFromS3).toHaveBeenCalledWith(
      'apha-sdo-uploads',
      'staging/upload-1/file-1'
    )

    // file transfer
    expect(azureStorageService.uploadFile).toHaveBeenCalledWith(
      'upload-1',
      expect.objectContaining({
        originalname: 'data.xlsx',
        mimetype: 'text/csv'
      }),
      expect.objectContaining({
        blobPrefix: 'REF-1',
        originalName: 'data.xlsx',
        type: 'file'
      })
    )

    // submission JSON
    expect(azureStorageService.uploadFile).toHaveBeenCalledWith(
      'REF-1-submission',
      expect.any(Buffer),
      expect.objectContaining({
        blobPrefix: 'REF-1',
        originalName: 'submission.json',
        contentType: 'application/json',
        type: 'submission'
      })
    )

    expect(redisUploadStore.setUpload).toHaveBeenCalledWith(
      'upload-1',
      expect.objectContaining({ status: 'transferred', fileId: 'file-1' })
    )
  })

  test("uses the S3 object's content type when the file state has none", async () => {
    downloadFromS3.mockResolvedValue({
      buffer: Buffer.from('file-content'),
      contentType: 'application/vnd.ms-excel'
    })

    const context = {
      referenceNumber: 'REF-1',
      relevantState: {
        supportingDocuments: [buildFileState({ contentType: null })]
      }
    }
    const request = buildRequest()

    await outputService.submit(...submitArgs(context, request))

    expect(azureStorageService.uploadFile).toHaveBeenCalledWith(
      'upload-1',
      expect.objectContaining({ mimetype: 'application/vnd.ms-excel' }),
      expect.objectContaining({ contentType: 'application/vnd.ms-excel' })
    )
  })

  test('skips files that are not complete', async () => {
    const context = {
      referenceNumber: 'REF-1',
      relevantState: {
        supportingDocuments: [buildFileState({ fileStatus: 'rejected' })]
      }
    }
    const request = buildRequest()

    await outputService.submit(...submitArgs(context, request))

    expect(downloadFromS3).not.toHaveBeenCalled()
    // submission JSON is still delivered
    expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)
  })

  // The forms-engine strips s3Bucket/s3Key from the file state it stores in
  // the session, so in practice the S3 location must be recovered.
  test('recovers the S3 location from the recorded scan callback when missing from state', async () => {
    redisUploadStore.getUpload.mockResolvedValue({
      type: 'scan',
      s3Bucket: 'callback-bucket',
      s3Key: 'staging/upload-1/file-1'
    })

    const context = {
      referenceNumber: 'REF-1',
      relevantState: {
        supportingDocuments: [buildFileState({ s3Bucket: null, s3Key: null })]
      }
    }
    const request = buildRequest()

    await outputService.submit(...submitArgs(context, request))

    expect(redisUploadStore.getUpload).toHaveBeenCalledWith('file-1')
    expect(downloadFromS3).toHaveBeenCalledWith(
      'callback-bucket',
      'staging/upload-1/file-1'
    )
  })

  test('falls back to the conventional staging location when there is no scan record', async () => {
    const context = {
      referenceNumber: 'REF-1',
      relevantState: {
        supportingDocuments: [buildFileState({ s3Bucket: null, s3Key: null })]
      }
    }
    const request = buildRequest()

    await outputService.submit(...submitArgs(context, request))

    expect(downloadFromS3).toHaveBeenCalledWith(
      config.get('s3.bucket'),
      'staging/upload-1/file-1'
    )
    expect(request.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'upload-1', fileId: 'file-1' }),
      expect.stringContaining('conventional S3 staging location')
    )
  })

  test('records the failure and rethrows when a transfer fails', async () => {
    downloadFromS3.mockRejectedValue(new Error('S3 unavailable'))

    const context = {
      referenceNumber: 'REF-1',
      relevantState: { supportingDocuments: [buildFileState()] }
    }
    const request = buildRequest()

    const error = await outputService
      .submit(...submitArgs(context, request))
      .catch((thrown) => thrown)

    expect(redisUploadStore.setUpload).toHaveBeenCalledWith(
      'upload-1',
      expect.objectContaining({
        status: 'transfer_failed',
        transferError: 'S3 unavailable'
      })
    )

    // The raw cause ('S3 unavailable') is recorded in Redis for investigation
    // above, but the user only ever sees the safe, generic message below.
    expect(error.isBoom).toBe(true)
    expect(error.data.errorCode).toBe(uploadErrorCodes.UPLOAD_FAILED)
    expect(error.data.safeMessage).not.toContain('S3 unavailable')
    expect(error.data.correlationId).toBeDefined()
  })
})
