import {
  canSubmitReportType,
  canUpdateDiagnosticTests,
  getAllowedReportTypes
} from '#/server/auth/report-access.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { howToReportPath } from '../report-method/controller.js'
import { DIAGNOSTIC_TESTS_PATH } from '../diagnostic-tests/controller.js'

const SUBMISSION_ERROR_FLASH_KEY = 'submissionWelcomeError'

export const SUBMISSION_WELCOME_HEADING = 'What would you like to do?'

export const UPDATE_DIAGNOSTIC_TESTS = 'update-diagnostic-tests'
export const VIEW_SUBMISSION_HISTORY = 'view-submission-history'

// The Design System's default radio label is regular weight. This service
// bolds the options, as on the sign-in page, so each choice reads as an action.
const optionLabel = { classes: 'govuk-!-font-weight-bold' }

// Only a user who can submit Animal Health Regulations is offered this.
// The hint is the diagnostic tests page's warning, as one sentence: a radio
// hint is not the place for the bullet list that page shows in full.
const updateDiagnosticTestsItem = {
  value: UPDATE_DIAGNOSTIC_TESTS,
  text: 'Update your diagnostic tests in use',
  label: optionLabel,
  hint: {
    text: 'Only use this service if you are setting up your qualifying tests for the first time, or updating your tests and UKAS accreditation since your last report month'
  }
}

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
 * The radios a user sees: only the report types their roles grant, then
 * submission history, then diagnostic tests when they hold Animal Health
 * Regulations. Built per request because it depends on who is signed in.
 */
function buildSubmissionActionItems(user) {
  return [
    ...getAllowedReportTypes(user).map((reportType) => ({
      value: reportType.slug,
      text: submitReportText(reportType.title),
      label: optionLabel,
      ...(reportType.welcomeHint
        ? { hint: { text: reportType.welcomeHint } }
        : {})
    })),
    viewSubmissionHistoryItem,
    ...(canUpdateDiagnosticTests(user) ? [updateDiagnosticTestsItem] : [])
  ]
}

function renderWelcome(request, h, error) {
  const user = request.auth.credentials?.user
  const allowedReportTypes = getAllowedReportTypes(user)

  return h.view('submission-welcome/index', {
    pageTitle: SUBMISSION_WELCOME_HEADING,
    heading: SUBMISSION_WELCOME_HEADING,
    submissionActionItems: buildSubmissionActionItems(user),
    hasReportTypes: allowedReportTypes.length > 0,
    error
  })
}

/**
 * Post-sign-in welcome screen. Selecting a report type continues into that
 * form journey, e.g. /bat-rabies (report date page), or, for a report type
 * that can also be entered as a web form, to the screen asking which of the
 * two the user wants. "Update your diagnostic tests in use" opens the page
 * where a lab defines the qualifying tests it uses. A user whose roles grant no report
 * type is told so here rather than being turned away at sign-in.
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

    if (
      submissionAction === UPDATE_DIAGNOSTIC_TESTS &&
      canUpdateDiagnosticTests(request.auth.credentials?.user)
    ) {
      return h.redirect(DIAGNOSTIC_TESTS_PATH)
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
