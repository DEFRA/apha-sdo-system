import { config } from '#/config/config.js'
import { uploadSubmissionJson } from '#/server/forms/services/output-service.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import {
  DIAGNOSTIC_TESTS_FILE_NAME,
  XLSX_CONTENT_TYPE
} from './diagnostic-tests-workbook.js'

/**
 * Delivers a diagnostic tests declaration the way the report journeys'
 * output service delivers a report (see
 * src/server/forms/services/output-service.js): the filled-in workbook goes
 * to the Azure container as {referenceNumber}/diagnostic-tests.xlsx and the
 * record alongside it as {referenceNumber}/submission.json. When Azure
 * storage is not enabled, the submission is only logged.
 * @param {object} options
 * @param {{ referenceNumber: string }} options.submission - the record (see buildDiagnosticTestsSubmission)
 * @param {Buffer} options.workbook - the filled-in workbook (see buildDiagnosticTestsWorkbook)
 * @param {{ info: Function }} options.logger - the request logger
 */
export async function deliverDiagnosticTestsSubmission({
  submission,
  workbook,
  logger
}) {
  const { referenceNumber } = submission

  logger.info({ submission }, 'Diagnostic tests submission received')

  if (!config.get('azure.storage.enabled')) {
    return
  }

  await azureStorageService.uploadFile(
    `${referenceNumber}-diagnostic-tests`,
    workbook,
    {
      blobPrefix: referenceNumber,
      originalName: DIAGNOSTIC_TESTS_FILE_NAME,
      contentType: XLSX_CONTENT_TYPE,
      type: 'file',
      referenceNumber
    }
  )

  await uploadSubmissionJson(submission)

  logger.info(
    { referenceNumber, fileName: submission.fileName },
    'Submission delivered to Azure Blob Storage'
  )
}
