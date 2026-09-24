import {
  canSubmitReportType,
  getAllowedReportTypes
} from '#/server/auth/report-access.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { howToReportPath } from '../report-method/controller.js'
import { DIAGNOSTIC_TESTS_PATH } from '../diagnostic-tests/controller.js'

const SUBMISSION_ERROR_FLASH_KEY = 'submissionWelcomeError'

export const UPDATE_DIAGNOSTIC_TESTS = 'update-diagnostic-tests'
export const VIEW_SUBMISSION_HISTORY = 'view-submission-history'

// Not role-gated for now: defining the qualifying tests is something every
// lab does before its first report, so every signed-in user is offered it
const updateDiagnosticTestsItem = {
  value: UPDATE_DIAGNOSTIC_TESTS,
  text: 'Update diagnostic tests',
  hint: {
    text: 'Define or update the qualifying tests your lab uses and their UKAS accreditation'
  }
}

const viewSubmissionHistoryItem = {
  value: VIEW_SUBMISSION_HISTORY,
  text: 'View submission history',
  hint: { text: 'Check your previous reports/submissions' }
}

/**
 * The radios a user sees: only the report types their roles grant, then the
 * diagnostic tests and history options. Built per request because it depends
 * on who is signed in.
 */
function buildSubmissionActionItems(user) {
  return [
    ...getAllowedReportTypes(user).map((reportType) => ({
      value: reportType.slug,
      text: reportType.title,
      hint: { text: reportType.optionHint }
    })),
    updateDiagnosticTestsItem,
    viewSubmissionHistoryItem
  ]
}

function renderWelcome(request, h, error) {
  const user = request.auth.credentials?.user
  const allowedReportTypes = getAllowedReportTypes(user)

  return h.view('submission-welcome/index', {
    pageTitle: 'Submission Welcome',
    submissionActionItems: buildSubmissionActionItems(user),
    hasReportTypes: allowedReportTypes.length > 0,
    error
  })
}

/**
 * Post-sign-in welcome screen. Selecting a report type continues into that
 * form journey, e.g. /bat-rabies (report date page), or, for a report type
 * that can also be entered as a web form, to the screen asking which of the
 * two the user wants. "Update diagnostic tests" opens the page where a lab
 * defines the qualifying tests it uses. A user whose roles grant no report
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

    if (submissionAction === UPDATE_DIAGNOSTIC_TESTS) {
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
