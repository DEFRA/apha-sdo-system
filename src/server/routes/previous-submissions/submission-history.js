import { config } from '#/config/config.js'
import { reportTypesByCode } from '#/server/forms/report-types.js'

/**
 * The reports a lab has submitted: what the previous submissions page lists
 * and what Submission Welcome names as the last report submitted.
 *
 * TEMPORARY: until the backend can be asked, each report is kept in a cookie
 * in the user's browser as it is submitted, so only the reports submitted
 * from that browser are known. Nothing outside this module knows that: the
 * functions below are the contract the backend version keeps (async, keyed
 * by the user's lab), and are what tests mock. See "Moving to the backend"
 * in the README.
 */

const COOKIE_NAME = 'submissionHistory'
const ONE_YEAR_MS = 31536000000

// A lab reports each report type monthly, so ten reports cover several
// months even for a lab that reports both. Two labs, as for the diagnostic
// tests, for a user who reports for more than one.
const MAX_LABS = 2
const MAX_SUBMISSIONS_PER_LAB = 10

// File names are the user's own, so the oldest reports are forgotten to keep
// the cookie inside the 4 KB a browser allows: encrypting adds about a third
// and some 200 characters. Names are cut to the length file systems allow,
// so the latest report always fits.
const MAX_STORED_BYTES = 2048
const MAX_FILE_NAME_LENGTH = 255

const MEMO_KEY = 'submissionHistory'
const PENDING_KEY = 'submissionHistoryPending'

/**
 * Where a report is in its processing downstream.
 */
export const SUBMISSION_STATUS = {
  PROCESSING: 'processing',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
}

// SHOWCASE: only the backend can know whether a report was accepted or
// rejected. So that both can be demonstrated meanwhile, a report is
// processing for two minutes after it was submitted, then accepted or
// rejected, alternately for each lab: its first report accepted, the next
// rejected, and so on.
const SHOWCASE_DECISION_DELAY_MS = 120000

/**
 * Called when the previous submissions routes are registered. The output
 * service records a report without a response toolkit, so what it records
 * is written to the cookie as the response goes out. Sign-out leaves the
 * cookie in place.
 * @param {import('@hapi/hapi').Server} server
 */
export function registerSubmissionHistoryStore(server) {
  const { password, secure } = config.get('session.cookie')

  server.state(COOKIE_NAME, {
    ttl: ONE_YEAR_MS,
    encoding: 'iron',
    password,
    path: '/',
    isSecure: secure,
    isHttpOnly: true,
    isSameSite: 'Lax',
    clearInvalid: true
  })

  server.ext('onPreResponse', writeRecordedSubmissions)
}

/**
 * onPreResponse extension: writes the reports recorded during the request.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
export function writeRecordedSubmissions(request, h) {
  const pending = request.app?.[PENDING_KEY]

  if (pending) {
    h.state(COOKIE_NAME, pending)
  }

  return h.continue
}

function labOf(request) {
  return request.auth?.credentials?.user?.organisationId || null
}

// The cookie holds [lab, reports] pairs, the most recently saved lab first,
// and each lab's reports newest first. Once a report is recorded, the rest of
// the request reads what is about to be written.
function storedLabs(request) {
  const value = request.app?.[PENDING_KEY] ?? request.state?.[COOKIE_NAME]

  return Array.isArray(value)
    ? value.filter(
        (entry) =>
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          Array.isArray(entry[1])
      )
    : []
}

// A report is kept as [code, referenceNumber, reportMonthYear, submittedAt,
// fileName, decision], with a null fileName for a web form report: tuples
// rather than objects, so more reports fit
function storedEntryOf(submission, decision) {
  const fileName = Array.from(submission.fileName ?? '')
    .slice(0, MAX_FILE_NAME_LENGTH)
    .join('')

  return [
    submission.processName,
    submission.referenceNumber,
    submission.reportMonthYear ?? null,
    submission.submittedAt,
    fileName || null,
    decision
  ]
}

// Reports kept before decisions were read as accepted
function decisionOf(entry) {
  return entry[5] === SUBMISSION_STATUS.REJECTED
    ? SUBMISSION_STATUS.REJECTED
    : SUBMISSION_STATUS.ACCEPTED
}

// The opposite of the lab's latest report's decision
function nextDecision(entries) {
  return entries.length > 0 &&
    decisionOf(entries[0]) === SUBMISSION_STATUS.ACCEPTED
    ? SUBMISSION_STATUS.REJECTED
    : SUBMISSION_STATUS.ACCEPTED
}

function statusOf(entry, submittedAt, now) {
  return now - Date.parse(submittedAt) < SHOWCASE_DECISION_DELAY_MS
    ? SUBMISSION_STATUS.PROCESSING
    : decisionOf(entry)
}

// Report types no longer in the registry and entries that are not a report
// are dropped
function submissionOf(entry, now = Date.now()) {
  if (!Array.isArray(entry)) {
    return null
  }

  const [code, referenceNumber, reportMonthYear, submittedAt, fileName] = entry
  const reportType = reportTypesByCode.get(code)

  if (
    !reportType ||
    typeof referenceNumber !== 'string' ||
    typeof submittedAt !== 'string' ||
    Number.isNaN(Date.parse(submittedAt))
  ) {
    return null
  }

  return {
    referenceNumber,
    reportType,
    reportMonthYear:
      typeof reportMonthYear === 'string' ? reportMonthYear : null,
    submittedAt,
    fileName: typeof fileName === 'string' ? fileName : null,
    status: statusOf(entry, submittedAt, now)
  }
}

function submissionsOf(entries) {
  const now = Date.now()

  return entries.map((entry) => submissionOf(entry, now)).filter(Boolean)
}

function reportEntriesOf(entries) {
  return entries.filter((entry) => submissionOf(entry))
}

function storedBytes(labs) {
  return Buffer.byteLength(JSON.stringify(labs))
}

// Forgets the oldest reports until the cookie fits: the other lab's first,
// then the other lab itself, then the signed-in lab's own oldest reports
function fitted(labs) {
  let kept = labs

  while (storedBytes(kept) > MAX_STORED_BYTES) {
    const [lab, entries] = kept.at(-1)

    if (entries.length > 1) {
      kept = [...kept.slice(0, -1), [lab, entries.slice(0, -1)]]
    } else if (kept.length > 1) {
      kept = kept.slice(0, -1)
    } else {
      break
    }
  }

  return kept
}

/**
 * The reports the signed-in user's lab has submitted, newest first, each
 * with its entry of the report type registry and its status (one of
 * SUBMISSION_STATUS, see SHOWCASE_DECISION_DELAY_MS). Empty when there are
 * none. Read once per request.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<{ referenceNumber: string, reportType: object, reportMonthYear: string | null, submittedAt: string, fileName: string | null, status: string }[]>}
 */
export async function getSubmissionHistory(request) {
  if (Object.hasOwn(request.app, MEMO_KEY)) {
    return request.app[MEMO_KEY]
  }

  const lab = labOf(request)
  const entries = lab
    ? (storedLabs(request).find(([id]) => id === lab)?.[1] ?? [])
    : []
  const submissions = submissionsOf(entries)

  request.app[MEMO_KEY] = submissions

  return submissions
}

/**
 * Records a delivered report as the signed-in user's lab's latest. Takes the
 * record written as submission.json (see
 * src/server/forms/services/output-service.js); a record that is not a
 * report, or a user without a lab, records nothing.
 * @param {import('@hapi/hapi').Request} request
 * @param {{ referenceNumber: string, processName: string | null, reportMonthYear?: string | null, submittedAt: string, fileName?: string }} submission
 */
export async function recordSubmission(request, submission) {
  const lab = labOf(request)
  const labs = storedLabs(request).map(([id, entries]) => [
    id,
    reportEntriesOf(entries)
  ])
  const entries = labs.find(([id]) => id === lab)?.[1] ?? []
  const entry = storedEntryOf(submission, nextDecision(entries))

  if (!lab || !submissionOf(entry)) {
    return
  }

  const others = labs.filter(
    ([id, otherEntries]) => id !== lab && otherEntries.length > 0
  )
  const kept = fitted(
    [
      [lab, [entry, ...entries].slice(0, MAX_SUBMISSIONS_PER_LAB)],
      ...others
    ].slice(0, MAX_LABS)
  )

  request.app[PENDING_KEY] = kept
  request.app[MEMO_KEY] = submissionsOf(kept[0][1])
}
