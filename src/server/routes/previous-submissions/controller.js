import Joi from 'joi'
import escapeHtml from 'lodash/escape.js'

import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { getAllowedReportTypes } from '#/server/auth/report-access.js'
import { reportTypes } from '#/server/forms/report-types.js'
import { SUBMISSION_STATUS, getSubmissionPage } from './submission-history.js'

export const PREVIOUS_SUBMISSIONS_PATH = '/previous-submissions'
export const PREVIOUS_SUBMISSIONS_TITLE = 'Previous submissions'

export const NO_SUBMISSIONS_TEXT = 'You have not submitted any reports yet.'
export const NO_REPORTS_ON_PAGE_TEXT = 'There are no reports on this page.'
export const SUBMISSIONS_UNAVAILABLE_TEXT =
  'Your submissions cannot be shown at the moment. Try again later.'

// Far beyond any lab's history; keeps the page a number the API accepts
const MAX_PAGE = 10000

const ALL_SUBMISSIONS_KEY = 'all'
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

function submittedCell(submission) {
  return {
    text: submission.submittedAt
      ? formatDate(submission.submittedAt, SUBMITTED_ON_FORMAT)
      : NOT_KNOWN_TEXT
  }
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
 * A GOV.UK table of one page of reports, one line each. The report type
 * column, by code (BR, AHR), is only needed where reports of more than one
 * type are listed together. Reports that are accepted or rejected can be
 * resubmitted.
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
      submittedCell(submission),
      howSubmittedCell(submission),
      { text: submission.referenceNumber },
      statusCell(submission),
      actionsCell(submission)
    ])
  }
}

/**
 * Previous and next links, without page numbers: the API does not give the
 * number of pages. Null for a single page.
 */
function buildPagination(hrefOf, { page, hasNextPage }, label) {
  if (page <= 1 && !hasNextPage) {
    return null
  }

  return {
    landmarkLabel: label,
    ...(page > 1 ? { previous: { href: hrefOf(page - 1) } } : {}),
    ...(hasNextPage ? { next: { href: hrefOf(page + 1) } } : {})
  }
}

function reportTypeListing(reportType) {
  return {
    key: reportType.slug,
    label: tabLabelOf(reportType),
    heading: `${reportType.title}s`,
    reportTypes: [reportType],
    showReportType: false,
    emptyText: `You have not submitted any ${reportType.title}s yet.`
  }
}

/**
 * What each panel lists: one report type each and, for a user who holds
 * more than one, every report together, first.
 */
function listingsOf(allowedReportTypes) {
  const byReportType = allowedReportTypes.map(reportTypeListing)

  if (allowedReportTypes.length < 2) {
    return byReportType
  }

  return [
    {
      key: ALL_SUBMISSIONS_KEY,
      label: ALL_SUBMISSIONS_LABEL,
      heading: ALL_SUBMISSIONS_LABEL,
      reportTypes: allowedReportTypes,
      showReportType: true,
      emptyText: NO_SUBMISSIONS_TEXT
    },
    ...byReportType
  ]
}

/**
 * A listing's reports, a page at a time. A page link names the listing,
 * so only its panel moves to that page, and the panel's ID, so the tabs
 * open on it. `isEmpty` when the lab has submitted none; a panel whose
 * reports could not be read says so instead.
 */
async function submissionsPanel(request, listing, page) {
  const id = `${listing.key}-submissions`
  const panel = { id, label: listing.label, heading: listing.heading }

  let result

  try {
    result = await getSubmissionPage(request, listing.reportTypes, { page })
  } catch {
    return { ...panel, isEmpty: false, text: SUBMISSIONS_UNAVAILABLE_TEXT }
  }

  const { submissions } = result
  const hrefOf = (number) =>
    `${PREVIOUS_SUBMISSIONS_PATH}?type=${listing.key}&page=${number}#${id}`

  return {
    ...panel,
    isEmpty: page === 1 && submissions.length === 0,
    table: submissions.length
      ? buildTable(submissions, { showReportType: listing.showReportType })
      : null,
    text: submissions.length ? null : emptyTextOf(listing.emptyText, page),
    pagination: buildPagination(hrefOf, result, `${listing.heading} pages`)
  }
}

function emptyTextOf(emptyText, page) {
  return page > 1 ? NO_REPORTS_ON_PAGE_TEXT : emptyText
}

/**
 * "Previous submissions": the reports the user's lab has submitted, newest
 * first, for the report types the user holds. Reached from Submission
 * Welcome. A user who holds Bat rabies and Animal Health Regulations
 * switches between all of them and each type's on GOV.UK tabs.
 * `?type={all or slug}&page={n}` pages through one of them; a query that
 * is not one is dropped. Without any report to show, it says so instead.
 */
export const previousSubmissionsGetController = {
  options: {
    validate: {
      query: Joi.object({
        type: Joi.string().valid(
          ALL_SUBMISSIONS_KEY,
          ...reportTypes.map(({ slug }) => slug)
        ),
        page: Joi.number().integer().min(1).max(MAX_PAGE).default(1)
      }).unknown(true),
      failAction(_request, h) {
        return h.redirect(PREVIOUS_SUBMISSIONS_PATH).takeover()
      }
    }
  },
  async handler(request, h) {
    const { type, page } = request.query
    const panels = await Promise.all(
      listingsOf(getAllowedReportTypes(request.auth.credentials?.user)).map(
        (listing) =>
          submissionsPanel(request, listing, listing.key === type ? page : 1)
      )
    )
    const hasSubmissions = panels.some((panel) => !panel.isEmpty)

    return h.view('previous-submissions/index', {
      pageTitle: PREVIOUS_SUBMISSIONS_TITLE,
      panels: hasSubmissions ? panels : [],
      showTabs: hasSubmissions && panels.length > 1,
      noSubmissionsText: hasSubmissions ? null : NO_SUBMISSIONS_TEXT
    })
  }
}
