const SUBMISSION_ERROR_FLASH_KEY = 'submissionWelcomeError'

/**
 * Post-sign-in welcome screen (UI only). "Submit report" continues to the
 * form journey at /sdo-test (report date page).
 */
export const submissionWelcomeGetController = {
  handler(request, h) {
    const [error] = request.yar.flash(SUBMISSION_ERROR_FLASH_KEY)

    return h.view('submission-welcome/index', {
      pageTitle: 'Submission Welcome',
      error
    })
  }
}

export const submissionWelcomePostController = {
  handler(request, h) {
    if (request.payload?.submissionAction !== 'submitReport') {
      request.yar.flash(
        SUBMISSION_ERROR_FLASH_KEY,
        'Select what you want to do'
      )

      return h.redirect('/submission-welcome')
    }

    return h.redirect('/sdo-test')
  }
}
