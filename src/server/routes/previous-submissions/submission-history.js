import { config } from '#/config/config.js'
import { submissionIdentity } from '#/server/forms/services/submission-identity.js'
import { submissionHistoryApi } from '#/server/services/submission-history-api.js'
import { pendingSubmissionsOf } from './pending-submissions.js'

/**
 * The reports a lab has submitted: what the previous submissions page lists
 * and what Submission Welcome names as the last report submitted.
 *
 * They are read from the APHA SDO API (see
 * src/server/services/submission-history-api.js), which builds them from the
 * submission.json records delivered to the landing zone, newest first and a
 * page at a time, for one or more report types at once. The lab is asked for
 * by its name, the `organisationId` of those records (see
 * submission-identity.js), so every report of the lab is listed, whoever
 * submitted it and from wherever. A report the lab has just submitted, which
 * the API does not return yet, shows on the first page as processing, in
 * its place by date, until it does (see pending-submissions.js).
 */

/**
 * Where a report is in its processing downstream.
 */
export const SUBMISSION_STATUS = {
  PROCESSING: 'processing',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
}

const MEMO_KEY = 'submissionHistory'

// Each row is a submission as the API's table holds it, e.g.
// { "UploadReferenceNumber": "MVK-WBM-TLY", "SubmissionProcessName": "BR",
//   "SubmissionMnthYr": "June 2025",
//   "SubmissionDate": "2026-11-16 10:55:06.2750000",
//   "FileName": "2026-06 bat rabies.xlsx", "SubmissionStatus": "Running" },
// with null, or an empty string, for a value it does not have
const ROW_FIELDS = {
  referenceNumber: 'UploadReferenceNumber',
  processName: 'SubmissionProcessName',
  reportMonthYear: 'SubmissionMnthYr',
  submittedAt: 'SubmissionDate',
  fileName: 'FileName',
  status: 'SubmissionStatus'
}

// Keyed by the status in lower case, without spaces or punctuation.
// "Running" and "Successful" are the API's; the others are guesses.
const STATUSES_BY_NAME = new Map([
  ...[
    'running',
    'processing',
    'pending',
    'received',
    'submitted',
    'inprogress',
    'queued'
  ].map((name) => [name, SUBMISSION_STATUS.PROCESSING]),
  ...[
    'successful',
    'success',
    'succeeded',
    'accepted',
    'processed',
    'complete',
    'completed',
    'valid'
  ].map((name) => [name, SUBMISSION_STATUS.ACCEPTED]),
  ...['failed', 'failure', 'rejected', 'error', 'invalid'].map((name) => [
    name,
    SUBMISSION_STATUS.REJECTED
  ])
])

// SQL Server's datetime2 as text, "2026-11-16 10:55:06.2750000", which is
// UTC but which Date would read as local time
const SQL_DATETIME =
  /^(?<day>\d{4}-\d{2}-\d{2})[ T](?<time>\d{2}:\d{2}:\d{2})(?:\.(?<fraction>\d+))?$/

// Date keeps a time to the millisecond
const MILLISECOND_DIGITS = 3

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function textOf(value) {
  if (typeof value === 'number') {
    return String(value)
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// As an ISO timestamp, or null when it is not a date
function timestampOf(value) {
  const text = textOf(value)

  if (!text) {
    return null
  }

  const { day, time, fraction = '' } = SQL_DATETIME.exec(text)?.groups ?? {}
  const milliseconds = fraction
    .padEnd(MILLISECOND_DIGITS, '0')
    .slice(0, MILLISECOND_DIGITS)
  const date = day
    ? new Date(`${day}T${time}.${milliseconds}Z`)
    : new Date(text)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function statusOf(request, value) {
  const status = STATUSES_BY_NAME.get(
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
  )

  if (!status) {
    request.logger?.warn?.(
      { status: value ?? null },
      'Unknown submission status, shown as processing'
    )
  }

  return status ?? SUBMISSION_STATUS.PROCESSING
}

// The API wraps its rows in a list ([[row, row]]) and answers [{}] when
// there are none
function rowsOf(body) {
  return (Array.isArray(body) ? body.flat() : []).filter(
    (row) => isRecord(row) && Object.keys(row).length > 0
  )
}

// A row of a process not asked for, or without a reference anyone could
// look up, is left out
function submissionOf(request, reportTypesByCode, row) {
  const reportType = reportTypesByCode.get(textOf(row[ROW_FIELDS.processName]))
  const referenceNumber = textOf(row[ROW_FIELDS.referenceNumber])

  if (!reportType || !referenceNumber) {
    return null
  }

  return {
    referenceNumber,
    reportType,
    reportMonthYear: textOf(row[ROW_FIELDS.reportMonthYear]),
    submittedAt: timestampOf(row[ROW_FIELDS.submittedAt]),
    fileName: textOf(row[ROW_FIELDS.fileName]),
    status: statusOf(request, row[ROW_FIELDS.status])
  }
}

function labOf(request) {
  return submissionIdentity(request.auth?.credentials?.user).organisationId
}

function submittedTime(submission) {
  return Date.parse(submission?.submittedAt ?? '') || 0
}

/**
 * The first page with the lab's reports just submitted, of the report types
 * asked for, that the API does not return on it, each in its place by date.
 * A full page ends where a later page begins: a report just submitted that
 * is older than its last report belongs on a later page, where the API
 * returns it once loaded, so it is left out.
 */
async function withJustSubmitted(
  request,
  { laboratoryId, reportTypesByCode, submissions, isFull }
) {
  const listed = new Set(
    submissions.map(({ referenceNumber }) => referenceNumber)
  )
  const oldestListed = isFull ? submittedTime(submissions.at(-1)) : 0
  const merged = [...submissions]

  const justSubmitted = (await pendingSubmissionsOf(request, laboratoryId))
    .filter(
      (pending) =>
        reportTypesByCode.has(pending.processName) &&
        !listed.has(pending.referenceNumber)
    )
    .map((pending) => ({
      referenceNumber: pending.referenceNumber,
      reportType: reportTypesByCode.get(pending.processName),
      reportMonthYear: textOf(pending.reportMonthYear),
      submittedAt: timestampOf(pending.submittedAt),
      fileName: textOf(pending.fileName),
      status: SUBMISSION_STATUS.PROCESSING
    }))
    .filter((submission) => submittedTime(submission) > oldestListed)

  for (const submission of justSubmitted) {
    const olderAt = merged.findIndex(
      (listedSubmission) =>
        submittedTime(listedSubmission) < submittedTime(submission)
    )

    merged.splice(olderAt === -1 ? merged.length : olderAt, 0, submission)
  }

  return merged
}

async function readSubmissionPage(request, reportTypes, { page, pageSize }) {
  const laboratoryId = labOf(request)
  const reportTypesByCode = new Map(
    reportTypes.map((reportType) => [reportType.code, reportType])
  )
  const processNames = [...reportTypesByCode.keys()]

  if (
    !config.get('submissionHistoryApi.enabled') ||
    !laboratoryId ||
    processNames.length === 0
  ) {
    return { submissions: [], page, hasNextPage: false }
  }

  try {
    const { body } = await submissionHistoryApi.fetchSubmissionPage({
      processNames,
      laboratoryId,
      page,
      pageSize
    })
    const rows = rowsOf(body)
    const submissions = rows
      .map((row) => submissionOf(request, reportTypesByCode, row))
      .filter(Boolean)
    // The API gives no total, so a full page may have another after it
    const isFull = rows.length >= pageSize

    return {
      submissions:
        page === 1
          ? await withJustSubmitted(request, {
              laboratoryId,
              reportTypesByCode,
              submissions,
              isFull
            })
          : submissions,
      page,
      hasNextPage: isFull
    }
  } catch (error) {
    request.logger?.error?.(
      {
        err: error,
        processNames: processNames.join(','),
        page,
        status: error.status ?? null,
        correlationId: error.correlationId ?? null
      },
      'Submission history could not be read'
    )

    throw error
  }
}

/**
 * One page of the reports of the given report types the signed-in user's
 * lab has submitted, newest first, each with its entry of the report type
 * registry and its status (one of SUBMISSION_STATUS). The first page also
 * has the reports just submitted that belong on it and that the API does
 * not return yet (see withJustSubmitted). Empty
 * when the API is turned off, the user has no lab or no report type is
 * given. Each page is read once per request; a failure is logged and
 * thrown.
 * @param {import('@hapi/hapi').Request} request
 * @param {{ code: string }[]} reportTypes - entries of the report type registry
 * @param {{ page?: number, pageSize?: number }} [paging]
 * @returns {Promise<{ submissions: { referenceNumber: string, reportType: object, reportMonthYear: string | null, submittedAt: string | null, fileName: string | null, status: string }[], page: number, hasNextPage: boolean }>}
 */
export function getSubmissionPage(
  request,
  reportTypes,
  { page = 1, pageSize = config.get('submissionHistoryApi.pageSize') } = {}
) {
  request.app[MEMO_KEY] ??= new Map()

  const memo = request.app[MEMO_KEY]
  const key = `${reportTypes.map(({ code }) => code).join(',')}:${page}:${pageSize}`

  if (!memo.has(key)) {
    memo.set(key, readSubmissionPage(request, reportTypes, { page, pageSize }))
  }

  return memo.get(key)
}

/**
 * The newest report the signed-in user's lab has submitted of the given
 * report types, or null when it has submitted none. A failure to read it is
 * thrown.
 * @param {import('@hapi/hapi').Request} request
 * @param {{ code: string }[]} reportTypes - entries of the report type registry
 */
export async function getLatestSubmission(request, reportTypes) {
  const { submissions } = await getSubmissionPage(request, reportTypes, {
    page: 1,
    pageSize: 1
  })

  return submissions[0] ?? null
}
