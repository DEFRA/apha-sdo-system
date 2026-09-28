// Import order matters here. The engine's page controllers form a cycle
// through its component barrel, so QuestionPageController.js throws unless a
// module that pulls the components in first has already been evaluated —
// FileUploadPageController, by way of the upload controller below.
import { findReportFileUploadPage } from './report-file-upload-page-controller.js'
import { QuestionPageController } from '@defra/forms-engine-plugin/controllers/QuestionPageController.js'

import { POST_SIGN_IN_PATH } from '#/server/auth/auth-constants.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { howToReportPath } from '#/server/routes/report-method/controller.js'

const SAVE_AND_EXIT = 'save-and-exit'

/**
 * Where Back goes from a reporting period page when the journey has no
 * earlier page: the "how would you like to report" screen for a report type
 * that offers one, and Submission Welcome otherwise.
 * @param {string} [slug] - the journey slug, the form model's base path
 */
export function reportingPeriodBackHref(slug) {
  const reportType = reportTypesBySlug.get(slug)

  return reportType?.webFormSlug
    ? howToReportPath(reportType)
    : POST_SIGN_IN_PATH
}

/**
 * Report date page. Changing the date from a "Check your answers" change link
 * would otherwise return the user straight to the summary, leaving a file named
 * after the old date attached to the report. So once the new date is saved, any
 * file it invalidates is turned away and the user is sent to the upload page to
 * upload a correctly named one.
 */
export class ReportDatePageController extends QuestionPageController {
  /**
   * The engine only links back to an earlier page of the journey. A reporting
   * period page is the first page, so Back returns to wherever the journey
   * was opened from. A change link from check your answers still wins.
   */
  getBackLink(request, context, t) {
    return (
      super.getBackLink(request, context, t) ?? {
        text: t('common.back'),
        href: reportingPeriodBackHref(this.model.basePath)
      }
    )
  }

  makePostRouteHandler() {
    const handler = super.makePostRouteHandler()

    return async (request, context, h) => {
      const response = await handler(request, context, h)

      // The default handler only saves the new date once it validates, and
      // save-and-exit takes the user out of the journey entirely
      if (
        context.errors?.length ||
        context.isForceAccess ||
        request.payload?.action === SAVE_AND_EXIT
      ) {
        return response
      }

      const uploadPage = findReportFileUploadPage(this.model)

      if (!uploadPage) {
        return response
      }

      const { rejected } = await uploadPage.rejectMisnamedFiles(
        request,
        context.state
      )

      if (!rejected.length) {
        return response
      }

      // Not proceed(), which prefers the returnUrl of a change link over the
      // path it is given and would send the user back to the summary
      return h.redirect(uploadPage.href).code(statusCodes.seeOther)
    }
  }
}
