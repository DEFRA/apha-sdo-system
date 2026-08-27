import escapeHtml from 'lodash/escape.js'
import { SummaryPageController } from '@defra/forms-engine-plugin/controllers/SummaryPageController.js'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypesBySlug } from '../report-types.js'
import { uploadedFileName } from '../validation/report-file-name.js'
import { findReportFileUploadPage } from './report-file-upload-page-controller.js'

const FILE_UPLOAD_FIELD = 'FileUploadField'
const SUBMISSION_KIND_KEY = 'Submission kind'

// Standard designer page type the plugin doesn't ship a controller for.
// Behaves as a plain summary page; no confirmation email is sent yet.
//
// handleFormSubmit is the last line of defence for the report file name rule:
// the summary page submits whatever is in state without looking at
// context.errors, so a file that no longer matches the report date is turned
// away here rather than reaching the output service.
export class SummaryPageWithConfirmationEmailController extends SummaryPageController {
  getSummaryViewModel(request, context, translator) {
    const viewModel = super.getSummaryViewModel(request, context, translator)

    showUploadedFileNames(viewModel)
    showSubmissionKind(viewModel, this.model)

    return viewModel
  }

  async handleFormSubmit(request, context, h) {
    const uploadPage = findReportFileUploadPage(this.model)

    if (uploadPage) {
      const { rejected } = await uploadPage.rejectMisnamedFiles(
        request,
        context.state
      )

      if (rejected.length) {
        return h.redirect(uploadPage.href).code(statusCodes.seeOther)
      }
    }

    return super.handleFormSubmit(request, context, h)
  }
}

/**
 * Puts Submission kind first on check your answers, before Report date. It is
 * not a question in the journey — the user already chose it on Submission
 * Welcome — so the row has no Change link.
 * @param {{ checkAnswers?: object[] }} viewModel - the summary view model
 * @param {{ basePath?: string }} [model] - the form model
 */
function showSubmissionKind(viewModel, model) {
  const kind = reportTypesBySlug.get(model?.basePath)?.kind

  if (!kind) {
    return
  }

  const row = {
    classes: 'govuk-summary-list__row--no-actions',
    key: { text: SUBMISSION_KIND_KEY },
    value: { classes: 'app-prose-scope', text: kind }
  }

  const section = viewModel.checkAnswers?.[0]

  if (!section) {
    viewModel.checkAnswers = [{ summaryList: { rows: [row] } }]
    return
  }

  section.summaryList ??= { rows: [] }
  section.summaryList.rows ??= []
  section.summaryList.rows.unshift(row)
}

/**
 * The engine summarises a FileUploadField as "Uploaded 1 file". Replace that
 * with the actual names so check-your-answers shows what was attached.
 * @param {{ details?: object[], checkAnswers?: object[] }} viewModel - the summary view model
 */
function showUploadedFileNames(viewModel) {
  for (const [sectionIndex, detail] of (viewModel.details ?? []).entries()) {
    for (const [itemIndex, item] of (detail.items ?? []).entries()) {
      showUploadedFileName(viewModel, sectionIndex, itemIndex, item)
    }
  }
}

/**
 * @param {{ checkAnswers?: object[] }} viewModel - the summary view model
 * @param {number} sectionIndex - index into checkAnswers
 * @param {number} itemIndex - index into that section's rows
 * @param {{ field?: { type?: string, getFormValueFromState?: Function }, state?: object }} item - a summary detail item
 */
function showUploadedFileName(viewModel, sectionIndex, itemIndex, item) {
  if (item.field?.type !== FILE_UPLOAD_FIELD) {
    return
  }

  const html = uploadedFilesSummaryHtml(
    item.field.getFormValueFromState(item.state)
  )
  const row =
    viewModel.checkAnswers?.[sectionIndex]?.summaryList?.rows?.[itemIndex]

  if (html && row?.value) {
    row.value.html = html
  }
}

/**
 * @param {object[]} [files] - a FileUploadField value from form state
 */
function uploadedFilesSummaryHtml(files) {
  const names = (files ?? []).map(uploadedFileName).filter(Boolean)

  return names.map((name) => escapeHtml(name)).join('<br>')
}
