import { config } from '#/config/config.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import { deliverDiagnosticTestsSubmission } from './diagnostic-tests-output.js'

vi.mock('#/server/upload/services/azure-storage-service.js', () => ({
  azureStorageService: { uploadFile: vi.fn() }
}))

const submission = {
  referenceNumber: 'REF-1',
  form: 'diagnostic-tests',
  processName: 'DT',
  userId: 'entra-oid',
  organisationId: 'TestLab1',
  submittedAt: '2026-09-24T14:04:00.000Z',
  diagnosticTestsData: [
    {
      pathogen: 'Mycoplasma gallisepticum / M. meleagridis',
      test: 'PCR',
      accreditation: 'Yes'
    }
  ]
}

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('deliverDiagnosticTestsSubmission', () => {
  beforeEach(() => {
    config.set('azure.storage.enabled', true)
    azureStorageService.uploadFile.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    config.set('azure.storage.enabled', false)
  })

  test('Should only log the submission when Azure storage is disabled', async () => {
    config.set('azure.storage.enabled', false)
    const logger = buildLogger()

    await deliverDiagnosticTestsSubmission({ submission, logger })

    expect(azureStorageService.uploadFile).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      { submission },
      'Diagnostic tests submission received'
    )
  })

  test('Should write the record as submission.json under the reference number, and nothing else', async () => {
    await deliverDiagnosticTestsSubmission({
      submission,
      logger: buildLogger()
    })

    expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)

    const [uploadId, content, metadata] =
      azureStorageService.uploadFile.mock.calls[0]

    expect(uploadId).toBe('REF-1-submission')
    expect(JSON.parse(content.toString())).toEqual(submission)
    expect(metadata).toEqual({
      blobPrefix: 'REF-1',
      originalName: 'submission.json',
      contentType: 'application/json',
      type: 'submission',
      referenceNumber: 'REF-1'
    })
  })

  test('Should log the submission on receipt and again once delivered', async () => {
    const logger = buildLogger()

    await deliverDiagnosticTestsSubmission({ submission, logger })

    expect(logger.info.mock.calls).toEqual([
      [{ submission }, 'Diagnostic tests submission received'],
      [
        { referenceNumber: 'REF-1' },
        'Submission delivered to Azure Blob Storage'
      ]
    ])
  })

  test('Should surface a failed upload and not log a delivery', async () => {
    azureStorageService.uploadFile.mockRejectedValueOnce(
      new Error('Azure upload failed: container unavailable')
    )
    const logger = buildLogger()

    await expect(
      deliverDiagnosticTestsSubmission({ submission, logger })
    ).rejects.toThrow('Azure upload failed: container unavailable')

    expect(logger.info).toHaveBeenCalledTimes(1)
  })
})
