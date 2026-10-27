import Boom from '@hapi/boom'

import { POST_SIGN_IN_PATH } from '#/server/auth/auth-constants.js'
import {
  howToReportPath,
  reportTypesBySlug
} from '#/server/forms/report-types.js'
import {
  describeWebFormDraft,
  discardWebFormDraft,
  getWebFormDraft,
  webFormResumePath
} from '#/server/forms/services/report-draft-cache-service.js'
import {
  carriesDiagnosticTests,
  isHeldBackForDiagnosticTests
} from '../diagnostic-tests/diagnostic-tests-gate.js'
import { LABORATORY_DETAILS_PATH } from '../diagnostic-tests/laboratory-details.js'

const REPORT_METHOD_ERROR_FLASH_KEY = 'reportMethodError'

export const REPORT_METHOD = {
  FILE_UPLOAD: 'file-upload',
  WEB_FORM: 'web-form',
  // Only offered while the user has a saved web form report
  CONTINUE_WEB_FORM: 'continue-web-form',
  // Only offered for the report type the diagnostic tests belong to
  UPDATE_DIAGNOSTIC_TESTS: 'update-diagnostic-tests'
}

export const CONTINUE_WEB_FORM_TEXT = 'Continue your saved web form report'
export const START_NEW_HEADING = 'Start a new web form report?'
export const START_NEW_CONFIRM_TEXT = 'Start a new report'
export const CONTINUE_SAVED_TEXT = 'Continue saved report'

// Same bold option labels as Submission Welcome and sign-in.
const optionLabel = { classes: 'govuk-!-font-weight-bold' }

const fileUploadItem = {
  value: REPORT_METHOD.FILE_UPLOAD,
  text: 'Upload a file',
  label: optionLabel,
  hint: { text: 'Upload a data file (CSV, XLS or XLSX)' }
}

const webFormItem = {
  value: REPORT_METHOD.WEB_FORM,
  text: 'Complete a web form',
  label: optionLabel,
  hint: { text: 'Enter the figures for the report on screen' }
}

// Offered in place of the web form when the user has a saved web form
// report: choosing it asks them to confirm before the saved one goes
const startNewWebFormItem = {
  value: REPORT_METHOD.WEB_FORM,
  text: 'Start a new web form report',
  label: optionLabel,
  hint: {
    text: 'Enter the figures for a new report on screen. Your saved web form report will be discarded.'
  }
}

// The hint is the diagnostic tests page's warning, as one sentence: a radio
// hint is not the place for the bullet list that page shows in full.
const updateDiagnosticTestsItem = {
  value: REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS,
  text: 'Update your diagnostic tests in use',
  label: optionLabel,
  hint: {
    text: 'Only use this service if you are setting up your qualifying tests for the first time, or updating your tests and UKAS accreditation since your last report month'
  }
}

/**
 * The first option when the user has a saved web form report: carry on with
 * it, described as on Submission Welcome
 * @param {object} draft - the saved report's form state
 */
function continueWebFormItem(draft) {
  return {
    value: REPORT_METHOD.CONTINUE_WEB_FORM,
    text: CONTINUE_WEB_FORM_TEXT,
    label: optionLabel,
    hint: { text: describeWebFormDraft(draft) }
  }
}

/**
 * The options offered: with a saved web form report, continuing it comes
 * first and the web form is offered as a new report. Updating the diagnostic
 * tests comes last for the report type they belong to, and is the only
 * option until the lab has defined them.
 * @param {{ code: string }} reportType - an entry of the report type registry
 * @param {object | null} draft - the saved report's form state, if any
 * @param {boolean} heldBack - the lab has not defined its diagnostic tests
 */
function reportMethodItems(reportType, draft, heldBack) {
  if (heldBack) {
    return [updateDiagnosticTestsItem]
  }

  const reportingItems = draft
    ? [continueWebFormItem(draft), fileUploadItem, startNewWebFormItem]
    : [fileUploadItem, webFormItem]

  return carriesDiagnosticTests(reportType)
    ? [...reportingItems, updateDiagnosticTestsItem]
    : reportingItems
}

/**
 * Where a user with a saved web form report confirms starting a new one.
 * @param {{ slug: string }} reportType - an entry of the report type registry
 */
export function startNewWebFormPath(reportType) {
  return `${howToReportPath(reportType)}/start-new`
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

function askAgain(request, h, reportType) {
  request.yar.flash(
    REPORT_METHOD_ERROR_FLASH_KEY,
    'Select how you would like to report'
  )

  return h.redirect(howToReportPath(reportType))
}

/**
 * Screen between Submission Welcome and a report type's journeys: the user
 * picks whether to upload a data file or to complete a web form, and is sent
 * into the matching journey. A user with a web form report saved part-way
 * through (see src/server/forms/services/report-draft-cache-service.js) is
 * told so in a banner and offered to continue it first; the web form is
 * then offered as a new report, confirmed before it discards the saved one.
 * For the report type the diagnostic tests belong to, "Update your
 * diagnostic tests in use" opens the laboratory details page, the first step
 * of defining them. Until the lab has, it is the only option and a banner
 * says why (see src/server/routes/diagnostic-tests/diagnostic-tests-gate.js).
 */
export const reportMethodGetController = {
  async handler(request, h) {
    const reportType = reportTypeOfferingChoice(request.params.slug)

    if (!reportType) {
      throw Boom.notFound()
    }

    const [error] = request.yar.flash(REPORT_METHOD_ERROR_FLASH_KEY)
    const heldBack = await isHeldBackForDiagnosticTests(request, reportType)
    // A saved report cannot be continued until the tests are defined
    const draft = heldBack ? null : await getWebFormDraft(request, reportType)

    return h.view('report-method/index', {
      pageTitle: 'How would you like to report?',
      formAction: howToReportPath(reportType),
      reportMethodItems: reportMethodItems(reportType, draft, heldBack),
      awaitingDiagnosticTests: heldBack,
      webFormDraft: draft && {
        title: reportType.title,
        continueText: CONTINUE_WEB_FORM_TEXT,
        description: describeWebFormDraft(draft)
      },
      backLink: { text: 'Back', href: POST_SIGN_IN_PATH },
      error
    })
  }
}

export const reportMethodPostController = {
  async handler(request, h) {
    const reportType = reportTypeOfferingChoice(request.params.slug)

    if (!reportType) {
      throw Boom.notFound()
    }

    const { reportMethod } = request.payload ?? {}

    if (
      reportMethod === REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS &&
      carriesDiagnosticTests(reportType)
    ) {
      return h.redirect(LABORATORY_DETAILS_PATH)
    }

    // Reporting was never offered: the only option was the diagnostic tests
    if (await isHeldBackForDiagnosticTests(request, reportType)) {
      return askAgain(request, h, reportType)
    }

    if (reportMethod === REPORT_METHOD.FILE_UPLOAD) {
      return h.redirect(`/${reportType.slug}`)
    }

    if (reportMethod === REPORT_METHOD.WEB_FORM) {
      const draft = await getWebFormDraft(request, reportType)

      return h.redirect(
        draft ? startNewWebFormPath(reportType) : `/${reportType.webFormSlug}`
      )
    }

    // Only offered while there is a saved report; posted with none, it was
    // never offered and falls through to the error below
    if (reportMethod === REPORT_METHOD.CONTINUE_WEB_FORM) {
      const draft = await getWebFormDraft(request, reportType)

      if (draft) {
        return h.redirect(webFormResumePath(reportType, draft))
      }
    }

    return askAgain(request, h, reportType)
  }
}

/**
 * Asks the user to confirm starting a new web form report when they have one
 * saved: what the saved report holds, "Start a new report", which discards
 * it, and "Continue saved report", which picks it up instead. With nothing
 * saved there is nothing to confirm, and the new report starts.
 */
export const startNewWebFormGetController = {
  async handler(request, h) {
    const reportType = reportTypeOfferingChoice(request.params.slug)

    if (!reportType) {
      throw Boom.notFound()
    }

    const draft = await getWebFormDraft(request, reportType)

    if (!draft) {
      return h.redirect(`/${reportType.webFormSlug}`)
    }

    return h.view('report-method/start-new', {
      pageTitle: START_NEW_HEADING,
      heading: START_NEW_HEADING,
      caption: reportType.title,
      draftDescription: describeWebFormDraft(draft),
      formAction: startNewWebFormPath(reportType),
      confirmText: START_NEW_CONFIRM_TEXT,
      continueText: CONTINUE_SAVED_TEXT,
      continueHref: webFormResumePath(reportType, draft),
      backLink: { text: 'Back', href: howToReportPath(reportType) }
    })
  }
}

export const startNewWebFormPostController = {
  async handler(request, h) {
    const reportType = reportTypeOfferingChoice(request.params.slug)

    if (!reportType) {
      throw Boom.notFound()
    }

    const draft = await getWebFormDraft(request, reportType)

    if (!draft) {
      return h.redirect(`/${reportType.webFormSlug}`)
    }

    if (request.payload?.confirm !== 'true') {
      return h.redirect(webFormResumePath(reportType, draft))
    }

    await discardWebFormDraft(request, reportType)
    request.logger.info(
      {
        userId: request.auth.credentials?.user?.id,
        organisationId: request.auth.credentials?.user?.organisationId,
        form: reportType.webFormSlug
      },
      'Saved web form report discarded for a new one'
    )

    return h.redirect(`/${reportType.webFormSlug}`)
  }
}
