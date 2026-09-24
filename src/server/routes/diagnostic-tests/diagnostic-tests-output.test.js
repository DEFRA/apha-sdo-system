import { config } from '#/config/config.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import { deliverDiagnosticTestsSubmission } from './diagnostic-tests-output.js'
import {
  DIAGNOSTIC_TESTS_FILE_NAME,
  XLSX_CONTENT_TYPE
} from './diagnostic-tests-workbook.js'

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
  fileName: DIAGNOSTIC_TESTS_FILE_NAME
}

const workbook = Buffer.from('PK-workbook-bytes')

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function uploadOf(type) {
  return azureStorageService.uploadFile.mock.calls.find(
    ([, , metadata]) => metadata.type === type
  )
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

    await deliverDiagnosticTestsSubmission({ submission, workbook, logger })

    expect(azureStorageService.uploadFile).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      { submission },
      'Diagnostic tests submission received'
    )
  })

  test('Should write the workbook under the reference number, as a file of the submission', async () => {
    await deliverDiagnosticTestsSubmission({
      submission,
      workbook,
      logger: buildLogger()
    })

    const [uploadId, content, metadata] = uploadOf('file')

    expect(uploadId).toBe('REF-1-diagnostic-tests')
    expect(content).toBe(workbook)
    expect(metadata).toEqual({
      blobPrefix: 'REF-1',
      originalName: DIAGNOSTIC_TESTS_FILE_NAME,
      contentType: XLSX_CONTENT_TYPE,
      type: 'file',
      referenceNumber: 'REF-1'
    })
  })

  test('Should write the record as submission.json alongside the workbook', async () => {
    await deliverDiagnosticTestsSubmission({
      submission,
      workbook,
      logger: buildLogger()
    })

    const [uploadId, content, metadata] = uploadOf('submission')

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

  test('Should write the workbook before the record, and nothing else', async () => {
    await deliverDiagnosticTestsSubmission({
      submission,
      workbook,
      logger: buildLogger()
    })

    expect(
      azureStorageService.uploadFile.mock.calls.map(
        ([, , metadata]) => metadata.type
      )
    ).toEqual(['file', 'submission'])
  })

  test('Should log the submission on receipt and again once delivered', async () => {
    const logger = buildLogger()

    await deliverDiagnosticTestsSubmission({ submission, workbook, logger })

    expect(logger.info.mock.calls).toEqual([
      [{ submission }, 'Diagnostic tests submission received'],
      [
        { referenceNumber: 'REF-1', fileName: DIAGNOSTIC_TESTS_FILE_NAME },
        'Submission delivered to Azure Blob Storage'
      ]
    ])
  })

  test('Should not write the record when the workbook upload fails', async () => {
    azureStorageService.uploadFile.mockRejectedValueOnce(
      new Error('Azure upload failed: container unavailable')
    )
    const logger = buildLogger()

    await expect(
      deliverDiagnosticTestsSubmission({ submission, workbook, logger })
    ).rejects.toThrow('Azure upload failed: container unavailable')

    expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)
    expect(uploadOf('submission')).toBeUndefined()
    expect(logger.info).toHaveBeenCalledTimes(1)
  })
})
