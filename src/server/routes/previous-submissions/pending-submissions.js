import { config } from '#/config/config.js'
import { reportTypesByCode } from '#/server/forms/report-types.js'

/**
 * The reports a lab has just submitted, which the APHA SDO API does not
 * return yet: the pipeline that loads a delivered report takes about a
 * minute. Each is kept, by the lab's name, in the shared server cache
 * (Redis on CDP), so every user of the lab sees it, whichever instance
 * serves them. The submission history shows it as processing until the
 * API returns its reference (see submission-history.js), and for no longer
 * than `submissionHistoryApi.pendingTtlMs` after it was submitted, in case
 * the API never does.
 */

const SEGMENT = 'pendingSubmissions'
const MAX_PER_LAB = 20

/**
 * Called when the previous submissions routes are registered.
 * @param {import('@hapi/hapi').Server} server
 */
export function registerPendingSubmissions(server) {
  server.app.pendingSubmissions = server.cache({
    cache: config.get('session.cache.name'),
    segment: SEGMENT,
    expiresIn: config.get('submissionHistoryApi.pendingTtlMs')
  })
}

function cacheOf(request) {
  return request.server?.app?.pendingSubmissions ?? null
}

// The cache's own expiry restarts with each report the lab submits, so
// each report's age is checked against when it was submitted
function isPending(entry, now) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.referenceNumber === 'string' &&
    reportTypesByCode.has(entry.processName) &&
    Date.parse(entry.submittedAt) >
      now - config.get('submissionHistoryApi.pendingTtlMs')
  )
}

async function pendingOf(cache, laboratoryId) {
  const entries = await cache.get(laboratoryId)
  const now = Date.now()

  return Array.isArray(entries)
    ? entries.filter((entry) => isPending(entry, now))
    : []
}

/**
 * Keeps a delivered report as its lab's latest, until the API returns it.
 * Takes the record written as submission.json (see
 * src/server/forms/services/output-service.js); a record without a lab or a
 * report type is not kept. The report has been delivered by then, so a
 * failure is logged rather than thrown.
 * @param {import('@hapi/hapi').Request} request
 * @param {{ referenceNumber: string, processName: string | null, organisationId: string | null, reportMonthYear?: string | null, submittedAt: string, fileName?: string }} submission
 */
export async function recordPendingSubmission(request, submission) {
  const cache = cacheOf(request)
  const { referenceNumber, processName, organisationId } = submission

  if (!cache || !organisationId || !reportTypesByCode.has(processName)) {
    return
  }

  const entry = {
    referenceNumber,
    processName,
    reportMonthYear: submission.reportMonthYear ?? null,
    submittedAt: submission.submittedAt,
    fileName: submission.fileName ?? null
  }

  try {
    const others = (await pendingOf(cache, organisationId)).filter(
      (pending) => pending.referenceNumber !== referenceNumber
    )

    await cache.set(organisationId, [entry, ...others].slice(0, MAX_PER_LAB))
  } catch (error) {
    request.logger?.warn?.(
      { err: error, referenceNumber },
      'Report just submitted could not be kept for the submission history'
    )
  }
}

/**
 * The reports the lab has submitted in the last
 * `submissionHistoryApi.pendingTtlMs`, newest first, as kept by
 * recordPendingSubmission: `{ referenceNumber, processName, reportMonthYear,
 * submittedAt, fileName }`. None when they cannot be read, which is logged.
 * @param {import('@hapi/hapi').Request} request
 * @param {string | null} laboratoryId - the lab's name
 */
export async function pendingSubmissionsOf(request, laboratoryId) {
  const cache = cacheOf(request)

  if (!cache || !laboratoryId) {
    return []
  }

  try {
    return await pendingOf(cache, laboratoryId)
  } catch (error) {
    request.logger?.warn?.(
      { err: error },
      'Reports just submitted could not be read for the submission history'
    )

    return []
  }
}
