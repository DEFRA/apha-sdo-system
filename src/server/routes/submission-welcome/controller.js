import {
  canSubmitReportType,
  getAllowedReportTypes
} from '#/server/auth/report-access.js'
import {
  howToReportPath,
  reportTypesBySlug
} from '#/server/forms/report-types.js'
import { isHeldBackForDiagnosticTests } from '../diagnostic-tests/diagnostic-tests-gate.js'

const SUBMISSION_ERROR_FLASH_KEY = 'submissionWelcomeError'

export const SUBMISSION_WELCOME_HEADING = 'What would you like to do?'

export const VIEW_SUBMISSION_HISTORY = 'view-submission-history'

// The Design System's default radio label is regular weight. This service
// bolds the options, as on the sign-in page, so each choice reads as an action.
const optionLabel = { classes: 'govuk-!-font-weight-bold' }

// Placeholder until submission history has a store to read the real last
// report from. Continue still re-renders this page.
const viewSubmissionHistoryItem = {
  value: VIEW_SUBMISSION_HISTORY,
  text: 'View your laboratory submission history',
  label: optionLabel,
  hint: { text: 'Last report submitted: 2026-02 BR.xls' }
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
 * history. A user whose only report type is held back has no history to look
 * at yet, so their report type is the one thing offered. Built per request
 * because it depends on who is signed in.
 */
function buildSubmissionActionItems(
  allowedReportTypes,
  everyReportTypeHeldBack
) {
  return [
    ...allowedReportTypes.map((reportType) => ({
      value: reportType.slug,
      text: submitReportText(reportType.title),
      label: optionLabel,
      ...(reportType.welcomeHint
        ? { hint: { text: reportType.welcomeHint } }
        : {})
    })),
    ...(everyReportTypeHeldBack ? [] : [viewSubmissionHistoryItem])
  ]
}

async function renderWelcome(request, h, error) {
  const allowedReportTypes = getAllowedReportTypes(
    request.auth.credentials?.user
  )

  return h.view('submission-welcome/index', {
    pageTitle: SUBMISSION_WELCOME_HEADING,
    heading: SUBMISSION_WELCOME_HEADING,
    submissionActionItems: buildSubmissionActionItems(
      allowedReportTypes,
      await isEveryReportTypeHeldBack(request, allowedReportTypes)
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
 * offered to continue, and the lab's diagnostic tests are updated). A user
 * whose roles grant no report type is told so here rather than being turned
 * away at sign-in.
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

    // Submission history has no journey to send the user to yet, so Continue
    // does nothing and the page is served again unchanged.
    if (submissionAction === VIEW_SUBMISSION_HISTORY) {
      return renderWelcome(request, h)
    }

    request.yar.flash(SUBMISSION_ERROR_FLASH_KEY, 'Select what you want to do')

    return h.redirect('/submission-welcome')
  }
}
