import { config } from '#/config/config.js'
import { uploadSubmissionJson } from '#/server/forms/services/output-service.js'

/**
 * Delivers a diagnostic tests declaration the way the report journeys'
 * output service delivers a report's record (see
 * src/server/forms/services/output-service.js): as
 * {referenceNumber}/submission.json in the Azure container. The declaration
 * has no data file; the tests are in the record itself. When Azure storage
 * is not enabled, the submission is only logged.
 * @param {object} options
 * @param {{ referenceNumber: string }} options.submission - the record (see buildDiagnosticTestsSubmission)
 * @param {{ info: Function }} options.logger - the request logger
 */
export async function deliverDiagnosticTestsSubmission({ submission, logger }) {
  const { referenceNumber } = submission

  logger.info({ submission }, 'Diagnostic tests submission received')

  if (!config.get('azure.storage.enabled')) {
    return
  }

  await uploadSubmissionJson(submission)

  logger.info({ referenceNumber }, 'Submission delivered to Azure Blob Storage')
}
