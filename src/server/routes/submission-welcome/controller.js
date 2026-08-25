import { reportTypes, reportTypesBySlug } from '#/server/forms/report-types.js'

const SUBMISSION_ERROR_FLASH_KEY = 'submissionWelcomeError'

export const VIEW_SUBMISSION_HISTORY = 'view-submission-history'

const submissionActionItems = [
  ...reportTypes.map((reportType) => ({
    value: reportType.slug,
    text: reportType.title,
    hint: { text: reportType.optionHint }
  })),
  {
    value: VIEW_SUBMISSION_HISTORY,
    text: 'View submission history',
    hint: { text: 'Check your previous reports/submissions' }
  }
]

function renderWelcome(h, error) {
  return h.view('submission-welcome/index', {
    pageTitle: 'Submission Welcome',
    submissionActionItems,
    error
  })
}

/**
 * Post-sign-in welcome screen. Selecting a report type continues into that
 * form journey, e.g. /bat-rabies (report date page).
 */
export const submissionWelcomeGetController = {
  handler(request, h) {
    const [error] = request.yar.flash(SUBMISSION_ERROR_FLASH_KEY)

    return renderWelcome(h, error)
  }
}

export const submissionWelcomePostController = {
  handler(request, h) {
    const { submissionAction } = request.payload ?? {}
    const reportType = reportTypesBySlug.get(submissionAction)

    if (reportType) {
      return h.redirect(`/${reportType.slug}`)
    }

    // Submission history has no journey to send the user to yet, so Continue
    // does nothing and the page is served again unchanged.
    if (submissionAction === VIEW_SUBMISSION_HISTORY) {
      return renderWelcome(h)
    }

    request.yar.flash(SUBMISSION_ERROR_FLASH_KEY, 'Select what you want to do')

    return h.redirect('/submission-welcome')
  }
}
