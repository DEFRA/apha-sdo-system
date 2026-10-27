import {
  canSubmitReportType,
  getAllowedReportTypes
} from '#/server/auth/report-access.js'
import {
  howToReportPath,
  reportTypesBySlug
} from '#/server/forms/report-types.js'
import { isHeldBackForDiagnosticTests } from '../diagnostic-tests/diagnostic-tests-gate.js'
import { PREVIOUS_SUBMISSIONS_PATH } from '../previous-submissions/controller.js'
import { getSubmissionHistory } from '../previous-submissions/submission-history.js'

const SUBMISSION_ERROR_FLASH_KEY = 'submissionWelcomeError'

export const SUBMISSION_WELCOME_HEADING = 'What would you like to do?'

export const VIEW_SUBMISSION_HISTORY = 'view-submission-history'

export const NO_SUBMISSION_HISTORY_HINT =
  'You have not submitted any reports yet'

// The Design System's default radio label is regular weight. This service
// bolds the options, as on the sign-in page, so each choice reads as an action.
const optionLabel = { classes: 'govuk-!-font-weight-bold' }

/**
 * "Last report submitted: Bat rabies report for February 2026", or that the
 * lab has submitted none, among the report types the user holds.
 * @param {import('@hapi/hapi').Request} request
 * @param {{ code: string }[]} allowedReportTypes - those the user's roles grant
 */
async function submissionHistoryHint(request, allowedReportTypes) {
  const allowedCodes = new Set(allowedReportTypes.map(({ code }) => code))
  const latest = (await getSubmissionHistory(request)).find((submission) =>
    allowedCodes.has(submission.reportType.code)
  )

  if (!latest) {
    return NO_SUBMISSION_HISTORY_HINT
  }

  return latest.reportMonthYear
    ? `Last report submitted: ${latest.reportType.title} for ${latest.reportMonthYear}`
    : `Last report submitted: ${latest.reportType.title}`
}

function viewSubmissionHistoryItem(hint) {
  return {
    value: VIEW_SUBMISSION_HISTORY,
    text: 'View your laboratory submission history',
    label: optionLabel,
    hint: { text: hint }
  }
}

/**
 * "Submit an Animal Health Regulations report", "Submit a Bat rabies report".
 * @param {string} title - the report type's label
 */
function submitReportText(title) {
  const article = /^[aeiou]/i.test(title) ? 'an' : 'a'

  return `Submit ${article} ${title}`
}

/**
 * Whether every report type the user holds is held back until their lab has
 * defined its diagnostic tests. Holding none is not being held back.
 * @param {import('@hapi/hapi').Request} request
 * @param {{ code: string }[]} allowedReportTypes - those the user's roles grant
 */
async function isEveryReportTypeHeldBack(request, allowedReportTypes) {
  const heldBack = await Promise.all(
    allowedReportTypes.map((reportType) =>
      isHeldBackForDiagnosticTests(request, reportType)
    )
  )

  return heldBack.length > 0 && heldBack.every(Boolean)
}

/**
 * The radios a user sees: the report types they hold, then submission
 * history with the last report submitted. A user whose only report type is
 * held back has no history to look at yet, so their report type is the one
 * thing offered. Built per request because it depends on who is signed in.
 */
async function buildSubmissionActionItems(request, allowedReportTypes) {
  const reportTypeItems = allowedReportTypes.map((reportType) => ({
    value: reportType.slug,
    text: submitReportText(reportType.title),
    label: optionLabel,
    ...(reportType.welcomeHint
      ? { hint: { text: reportType.welcomeHint } }
      : {})
  }))

  if (await isEveryReportTypeHeldBack(request, allowedReportTypes)) {
    return reportTypeItems
  }

  return [
    ...reportTypeItems,
    viewSubmissionHistoryItem(
      await submissionHistoryHint(request, allowedReportTypes)
    )
  ]
}

async function renderWelcome(request, h, error) {
  const allowedReportTypes = getAllowedReportTypes(
    request.auth.credentials?.user
  )

  return h.view('submission-welcome/index', {
    pageTitle: SUBMISSION_WELCOME_HEADING,
    heading: SUBMISSION_WELCOME_HEADING,
    submissionActionItems: await buildSubmissionActionItems(
      request,
      allowedReportTypes
    ),
    hasReportTypes: allowedReportTypes.length > 0,
    error
  })
}

/**
 * Post-sign-in welcome screen. Selecting a report type continues into that
 * form journey, e.g. /bat-rabies (report date page), or, for a report type
 * that can also be entered as a web form, to the screen asking which of the
 * two the user wants (where a web form report saved part-way through is
 * offered to continue, and the lab's diagnostic tests are updated).
 * Selecting submission history continues to the previous submissions page.
 * A user whose roles grant no report type is told so here rather than being
 * turned away at sign-in.
 */
export const submissionWelcomeGetController = {
  handler(request, h) {
    const [error] = request.yar.flash(SUBMISSION_ERROR_FLASH_KEY)

    return renderWelcome(request, h, error)
  }
}

export const submissionWelcomePostController = {
  handler(request, h) {
    const { submissionAction } = request.payload ?? {}
    const reportType = reportTypesBySlug.get(submissionAction)

    // A report type the user's roles do not grant is treated like an unknown
    // value: it was never offered, so there is nothing more specific to say.
    if (canSubmitReportType(request.auth.credentials?.user, reportType)) {
      return h.redirect(
        reportType.webFormSlug
          ? howToReportPath(reportType)
          : `/${reportType.slug}`
      )
    }

    if (submissionAction === VIEW_SUBMISSION_HISTORY) {
      return h.redirect(PREVIOUS_SUBMISSIONS_PATH)
    }

    request.yar.flash(SUBMISSION_ERROR_FLASH_KEY, 'Select what you want to do')

    return h.redirect('/submission-welcome')
  }
}
