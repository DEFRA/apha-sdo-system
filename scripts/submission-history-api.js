/**
 * Dev utility for checking the submission history API settings in .env.
 *
 *   npm run submissions:check                                    - "Test Lab 1", BR and AHR, page 1, 2 per page
 *   npm run submissions:check -- "APHA Weybridge" 5 BR,AHR,DT 2  - another lab, 5 per page, those processes, page 2
 *
 * Asks for one page of the lab's submissions and prints a line per row
 * (SubmissionID, UploadReferenceNumber, SubmissionProcessName,
 * SubmissionDate, SubmissionStatus), or the body as the API returned it
 * when it holds no rows. Runs whether SUBMISSION_HISTORY_API_ENABLED is on
 * or not.
 */
import { reportTypes } from '../src/server/forms/report-types.js'
import { submissionHistoryApi } from '../src/server/services/submission-history-api.js'

const laboratoryId = process.argv[2] || 'Test Lab 1'
const pageSize = Number(process.argv[3]) || 2
const processNames = process.argv[4]
  ? process.argv[4].split(',').map((name) => name.trim())
  : reportTypes.map(({ code }) => code)
const page = Number(process.argv[5]) || 1

console.log(
  `\n${processNames.join(',')} for "${laboratoryId}", page ${page}, ${pageSize} per page`
)

const started = Date.now()

try {
  const { status, correlationId, body } =
    await submissionHistoryApi.fetchSubmissionPage({
      processNames,
      laboratoryId,
      page,
      pageSize
    })
  const rows = (Array.isArray(body) ? body.flat() : []).filter(
    (row) => row && typeof row === 'object' && Object.keys(row).length > 0
  )

  console.log(
    `  ${status} in ${Date.now() - started} ms, x-correlation-id ${correlationId ?? 'none'}, ${rows.length} rows`
  )

  if (rows.length === 0) {
    console.log(`  body: ${JSON.stringify(body)}`)
  }

  for (const row of rows) {
    console.log(
      `  ${row.SubmissionID}  ${row.UploadReferenceNumber}  ${row.SubmissionProcessName}  ${row.SubmissionDate}  ${row.SubmissionStatus}`
    )
  }
} catch (error) {
  console.log(`  failed in ${Date.now() - started} ms: ${error.message}`)

  if (error.correlationId) {
    console.log(`  x-correlation-id ${error.correlationId}`)
  }
}
