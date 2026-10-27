import escapeHtml from 'lodash/escape.js'

import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { getAllowedReportTypes } from '#/server/auth/report-access.js'
import {
  SUBMISSION_STATUS,
  getSubmissionHistory
} from './submission-history.js'

export const PREVIOUS_SUBMISSIONS_PATH = '/previous-submissions'
export const PREVIOUS_SUBMISSIONS_TITLE = 'Previous submissions'

export const NO_SUBMISSIONS_TEXT = 'You have not submitted any reports yet.'

const ALL_SUBMISSIONS_TAB_ID = 'all-submissions'
const ALL_SUBMISSIONS_LABEL = 'All submissions'
const SUBMITTED_ON_FORMAT = 'dd/MM/yyyy'
const NOT_KNOWN_TEXT = 'Not known'
const WEB_FORM_TEXT = 'Web form'
const TABLE_CLASS = 'app-submissions-table'
const FILE_NAME_CELL_CLASS = 'app-submissions-table__file-name'

// GOV.UK tag colours as the Design System's examples use them: blue for
// waiting on someone else, green for done, red for turned down
const STATUS_TAGS = {
  [SUBMISSION_STATUS.PROCESSING]: { text: 'Processing', colour: 'blue' },
  [SUBMISSION_STATUS.ACCEPTED]: { text: 'Accepted', colour: 'green' },
  [SUBMISSION_STATUS.REJECTED]: { text: 'Rejected', colour: 'red' }
}

// A report still processing has nothing to correct yet
const RESUBMITTABLE_STATUSES = new Set([
  SUBMISSION_STATUS.ACCEPTED,
  SUBMISSION_STATUS.REJECTED
])

// Not wired to a journey yet
const RESUBMIT_HREF = '#'

/**
 * "Bat rabies", "Animal Health Regulations": a report type's title without
 * the trailing "report", short enough for a tab.
 * @param {{ title: string }} reportType - an entry of the report type registry
 */
function tabLabelOf(reportType) {
  return reportType.title.replace(/ report$/, '')
}

// The uploaded file's name, or that the report was typed into the web form
function howSubmittedCell(submission) {
  return submission.fileName
    ? { text: submission.fileName, classes: FILE_NAME_CELL_CLASS }
    : { text: WEB_FORM_TEXT }
}

function statusCell(submission) {
  const tag = STATUS_TAGS[submission.status]

  return {
    html: `<strong class="govuk-tag govuk-tag--${tag.colour}">${tag.text}</strong>`
  }
}

// The link names its report for screen reader users, who may hear it
// without the rest of the row
function actionsCell(submission) {
  if (!RESUBMITTABLE_STATUSES.has(submission.status)) {
    return { text: '' }
  }

  return {
    html: `<a class="govuk-link govuk-link--no-visited-state" href="${RESUBMIT_HREF}">Resubmit<span class="govuk-visually-hidden"> report ${escapeHtml(submission.referenceNumber)}</span></a>`
  }
}

/**
 * A GOV.UK table of the reports, newest first, one line each. The report
 * type column, by code (BR, AHR), is only needed where reports of more than
 * one type are listed together. Reports that are accepted or rejected can
 * be resubmitted.
 */
function buildTable(submissions, { showReportType }) {
  return {
    classes: TABLE_CLASS,
    head: [
      { text: 'Period' },
      ...(showReportType ? [{ text: 'Type' }] : []),
      { text: 'Submitted' },
      { text: 'Method' },
      { text: 'Reference' },
      { text: 'Status' },
      { text: 'Actions' }
    ],
    rows: submissions.map((submission) => [
      { text: submission.reportMonthYear ?? NOT_KNOWN_TEXT },
      ...(showReportType ? [{ text: submission.reportType.code }] : []),
      { text: formatDate(submission.submittedAt, SUBMITTED_ON_FORMAT) },
      howSubmittedCell(submission),
      { text: submission.referenceNumber },
      statusCell(submission),
      actionsCell(submission)
    ])
  }
}

function reportTypePanel(reportType, submissions) {
  const ofType = submissions.filter(
    (submission) => submission.reportType.code === reportType.code
  )

  return {
    id: `${reportType.slug}-submissions`,
    label: tabLabelOf(reportType),
    heading: `${reportType.title}s`,
    table: ofType.length ? buildTable(ofType, { showReportType: false }) : null,
    emptyText: `You have not submitted any ${reportType.title}s yet.`
  }
}

/**
 * One panel per report type the user holds. A user who holds more than one
 * also gets every report together, first, and the panels become tabs.
 */
function buildPanels(allowedReportTypes, submissions) {
  if (allowedReportTypes.length === 1) {
    return [reportTypePanel(allowedReportTypes[0], submissions)]
  }

  return [
    {
      id: ALL_SUBMISSIONS_TAB_ID,
      label: ALL_SUBMISSIONS_LABEL,
      heading: ALL_SUBMISSIONS_LABEL,
      table: buildTable(submissions, { showReportType: true }),
      emptyText: NO_SUBMISSIONS_TEXT
    },
    ...allowedReportTypes.map((reportType) =>
      reportTypePanel(reportType, submissions)
    )
  ]
}

/**
 * "Previous submissions": the reports the user's lab has submitted, newest
 * first, for the report types the user holds. Reached from Submission
 * Welcome. A user who holds Bat rabies and Animal Health Regulations can
 * switch between all of them and each type's on GOV.UK tabs. Without any
 * report to show, it says so instead.
 */
export const previousSubmissionsGetController = {
  async handler(request, h) {
    const allowedReportTypes = getAllowedReportTypes(
      request.auth.credentials?.user
    )
    const allowedCodes = new Set(allowedReportTypes.map(({ code }) => code))
    const submissions = (await getSubmissionHistory(request)).filter(
      (submission) => allowedCodes.has(submission.reportType.code)
    )
    const panels = submissions.length
      ? buildPanels(allowedReportTypes, submissions)
      : []

    return h.view('previous-submissions/index', {
      pageTitle: PREVIOUS_SUBMISSIONS_TITLE,
      panels,
      showTabs: panels.length > 1,
      noSubmissionsText: submissions.length ? null : NO_SUBMISSIONS_TEXT
    })
  }
}
