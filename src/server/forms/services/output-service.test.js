import { config } from '#/config/config.js'
import {
  outputService,
  extractFileStates
} from '#/server/forms/services/output-service.js'
import { downloadFromS3 } from '#/server/common/helpers/s3-client.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import { redisUploadStore } from '#/server/services/redis-upload-store.js'

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

const signedInUser = {
  id: 'entra-oid',
  name: 'A Person',
  email: 'person@example.gov.uk',
  organisationId: 'TestLab1',
  journeys: ['BR']
}

function buildRequest({ user = signedInUser } = {}) {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    auth: user ? { credentials: { user } } : undefined
  }
}

const reportDateAnswer = {
  name: 'reportDate',
  title: 'Report date',
  value: 'March 2024'
}

const submitArgs = (
  context,
  request,
  {
    items = [
      reportDateAnswer,
      { name: 'supportingDocuments', title: 'Files', value: 'Uploaded 1 file' }
    ],
    formMetadata = { slug: 'bat-rabies' }
  } = {}
) => [context, request, {}, 'someone@example.com', items, {}, formMetadata]

/**
 * The JSON written to {referenceNumber}/submission.json
 */
function uploadedSubmissionJson() {
  const call = azureStorageService.uploadFile.mock.calls.find(
    ([, , metadata]) => metadata.type === 'submission'
  )

  return JSON.parse(call[1].toString())
}

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

  describe('submission.json contents', () => {
    test('records who submitted what, for which lab, process and month', async () => {
      const context = {
        referenceNumber: 'REF-1',
        relevantState: {
          reportDate__month: 3,
          reportDate__year: 2024,
          supportingDocuments: [buildFileState({ filename: 'March2024.xlsx' })]
        }
      }
      const request = buildRequest()

      await outputService.submit(...submitArgs(context, request))

      expect(uploadedSubmissionJson()).toEqual({
        referenceNumber: 'REF-1',
        form: 'bat-rabies',
        processName: 'BR',
        userId: 'entra-oid',
        organisationId: 'TestLab1',
        submittedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        fileName: 'March2024.xlsx',
        fileNames: ['March2024.xlsx'],
        reportMonthYear: 'March 2024',
        notificationEmail: 'someone@example.com',
        answers: [
          reportDateAnswer,
          {
            name: 'supportingDocuments',
            title: 'Files',
            value: 'Uploaded 1 file'
          }
        ]
      })
    })

    test('maps the journey slug to its process name', async () => {
      const context = { referenceNumber: 'REF-1', relevantState: {} }

      await outputService.submit(
        ...submitArgs(context, buildRequest(), {
          formMetadata: { slug: 'animal-health-regulations' }
        })
      )

      expect(uploadedSubmissionJson()).toEqual(
        expect.objectContaining({
          form: 'animal-health-regulations',
          processName: 'AHR'
        })
      )
    })

    test('records a web form report the same way, with its answers and no files', async () => {
      const webFormAnswers = [
        { name: 'reportDate', title: 'Report Date', value: 'August 2026' },
        { name: 'pathogen', title: 'Selected pathogen', value: 'Pathogen 1' },
        {
          name: 'species',
          title: 'Species the report is for',
          value: 'Cattle'
        },
        { name: 'country', title: 'Country', value: 'England' },
        {
          name: 'submissionsWithQualifyingTest',
          title: 'Submissions with at least one qualifying test',
          value: '12'
        }
      ]
      const context = {
        referenceNumber: 'REF-2',
        relevantState: {
          reportDate__month: 8,
          reportDate__year: 2026,
          pathogen: 'Pathogen 1',
          species: 'Cattle',
          country: 'England',
          submissionsWithQualifyingTest: 12
        }
      }
      const request = buildRequest({
        user: { ...signedInUser, journeys: ['AHR'] }
      })

      await outputService.submit(
        ...submitArgs(context, request, {
          items: webFormAnswers,
          formMetadata: { slug: 'animal-health-regulations-web-form' }
        })
      )

      expect(downloadFromS3).not.toHaveBeenCalled()
      expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)
      expect(uploadedSubmissionJson()).toEqual({
        referenceNumber: 'REF-2',
        form: 'animal-health-regulations-web-form',
        processName: 'AHR',
        userId: 'entra-oid',
        organisationId: 'TestLab1',
        submittedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        fileName: null,
        fileNames: [],
        reportMonthYear: 'August 2026',
        notificationEmail: 'someone@example.com',
        answers: webFormAnswers
      })
    })

    test('lists every complete file and leaves fileName empty when there are several', async () => {
      const context = {
        referenceNumber: 'REF-1',
        relevantState: {
          supportingDocuments: [
            buildFileState({
              uploadId: 'upload-1',
              filename: 'March2024-1.csv'
            }),
            buildFileState({
              uploadId: 'upload-2',
              fileId: 'file-2',
              filename: 'March2024-2.csv'
            }),
            buildFileState({
              uploadId: 'upload-3',
              fileId: 'file-3',
              filename: 'rejected.csv',
              fileStatus: 'rejected'
            })
          ]
        }
      }

      await outputService.submit(...submitArgs(context, buildRequest()))

      expect(uploadedSubmissionJson()).toEqual(
        expect.objectContaining({
          fileName: null,
          fileNames: ['March2024-1.csv', 'March2024-2.csv']
        })
      )
    })

    test('derives the report month from state when the answer is missing', async () => {
      const context = {
        referenceNumber: 'REF-1',
        relevantState: { reportDate__month: '11', reportDate__year: '2023' }
      }

      await outputService.submit(
        ...submitArgs(context, buildRequest(), { items: [] })
      )

      expect(uploadedSubmissionJson()).toEqual(
        expect.objectContaining({
          reportMonthYear: 'November 2023',
          fileName: null,
          fileNames: []
        })
      )
    })

    test('writes nulls rather than failing when identity or date are unavailable', async () => {
      const context = { referenceNumber: 'REF-1', relevantState: {} }

      await outputService.submit(
        ...submitArgs(context, buildRequest({ user: null }), {
          items: [],
          formMetadata: null
        })
      )

      expect(uploadedSubmissionJson()).toEqual(
        expect.objectContaining({
          form: null,
          processName: null,
          userId: null,
          organisationId: null,
          reportMonthYear: null
        })
      )
    })
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

    await expect(
      outputService.submit(...submitArgs(context, request))
    ).rejects.toThrow('S3 unavailable')

    expect(redisUploadStore.setUpload).toHaveBeenCalledWith(
      'upload-1',
      expect.objectContaining({
        status: 'transfer_failed',
        transferError: 'S3 unavailable'
      })
    )
  })
})
