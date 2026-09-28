import Boom from '@hapi/boom'

import { POST_SIGN_IN_PATH } from '#/server/auth/auth-constants.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'

const REPORT_METHOD_ERROR_FLASH_KEY = 'reportMethodError'

export const REPORT_METHOD = {
  FILE_UPLOAD: 'file-upload',
  WEB_FORM: 'web-form'
}

// Same bold option labels as Submission Welcome and sign-in.
const optionLabel = { classes: 'govuk-!-font-weight-bold' }

const reportMethodItems = [
  {
    value: REPORT_METHOD.FILE_UPLOAD,
    text: 'Upload a file',
    label: optionLabel,
    hint: { text: 'Upload a data file (CSV, XLS or XLSX)' }
  },
  {
    value: REPORT_METHOD.WEB_FORM,
    text: 'Complete a web form',
    label: optionLabel,
    hint: { text: 'Enter the figures for the report on screen' }
  }
]

/**
 * Where a report type asks how the user would like to report.
 * @param {{ slug: string }} reportType - an entry of the report type registry
 */
export function howToReportPath(reportType) {
  return `/${reportType.slug}/how-to-report`
}

/**
 * The report type served at /{slug}/how-to-report, or null when there is no
 * such screen: the slug is unknown, is the web form journey itself, or names
 * a report type that only supports file upload. Which report types the user
 * may open is decided by restrictReportJourneys, not here.
 * @param {string} slug - the `slug` route parameter
 */
function reportTypeOfferingChoice(slug) {
  const reportType = reportTypesBySlug.get(slug)

  return reportType?.slug === slug && reportType.webFormSlug ? reportType : null
}

/**
 * Screen between Submission Welcome and a report type's journeys: the user
 * picks whether to upload a data file or to complete a web form, and is sent
 * into the matching journey.
 */
export const reportMethodGetController = {
  handler(request, h) {
    const reportType = reportTypeOfferingChoice(request.params.slug)

    if (!reportType) {
      throw Boom.notFound()
    }

    const [error] = request.yar.flash(REPORT_METHOD_ERROR_FLASH_KEY)

    return h.view('report-method/index', {
      pageTitle: 'How would you like to report?',
      formAction: howToReportPath(reportType),
      reportMethodItems,
      backLink: { text: 'Back', href: POST_SIGN_IN_PATH },
      error
    })
  }
}

export const reportMethodPostController = {
  handler(request, h) {
    const reportType = reportTypeOfferingChoice(request.params.slug)

    if (!reportType) {
      throw Boom.notFound()
    }

    const { reportMethod } = request.payload ?? {}

    if (reportMethod === REPORT_METHOD.FILE_UPLOAD) {
      return h.redirect(`/${reportType.slug}`)
    }

    if (reportMethod === REPORT_METHOD.WEB_FORM) {
      return h.redirect(`/${reportType.webFormSlug}`)
    }

    request.yar.flash(
      REPORT_METHOD_ERROR_FLASH_KEY,
      'Select how you would like to report'
    )

    return h.redirect(howToReportPath(reportType))
  }
}
