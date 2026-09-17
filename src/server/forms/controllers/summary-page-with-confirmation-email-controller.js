import escapeHtml from 'lodash/escape.js'
import { SummaryPageController } from '@defra/forms-engine-plugin/controllers/SummaryPageController.js'
import { redirectPath } from '@defra/forms-engine-plugin/engine/helpers.js'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypesBySlug } from '../report-types.js'
import { uploadedFileName } from '../validation/report-file-name.js'
import { findReportFileUploadPage } from './report-file-upload-page-controller.js'
import {
  CHANGE_TEXT,
  ENTRIES_KEY,
  entriesCountText,
  entriesErrors,
  entriesOf,
  entriesPageOf,
  entryCard,
  entryDetailItems,
  entryPagesOf,
  isReportWithEntries
} from './report-entries.js'

const FILE_UPLOAD_FIELD = 'FileUploadField'
const SUBMISSION_KIND_KEY = 'Submission kind'
const ENTRIES_KEY_TEXT = 'Entries'

// Standard designer page type the plugin doesn't ship a controller for.
// Behaves as a plain summary page; no confirmation email is sent yet.
//
// handleFormSubmit is the last line of defence for the report file name rule
// and for the entries of a web-form report: the summary page submits whatever
// is in state without looking at context.errors, so a file that no longer
// matches the report date, or a report whose entries are missing or
// incomplete, is turned away here rather than reaching the output service.
export class SummaryPageWithConfirmationEmailController extends SummaryPageController {
  constructor(model, pageDef) {
    super(model, pageDef)

    // The web form's pages use the full width, so its check your answers
    // does too (see src/server/forms/views/report-summary.html). The upload
    // journeys keep the engine's summary page, as narrow as their pages.
    if (isReportWithEntries(model)) {
      this.viewName = 'report-summary'
    }
  }

  getSummaryViewModel(request, context, translator) {
    const viewModel = super.getSummaryViewModel(request, context, translator)

    showUploadedFileNames(viewModel)
    showReportEntries(viewModel, this, context, translator)
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

    const entriesPage = entriesPageOf(this.model)

    if (
      entriesPage &&
      entriesErrors(this.model, entriesOf(context.state)).length
    ) {
      return h.redirect(entriesPage.href).code(statusCodes.seeOther)
    }

    return super.handleFormSubmit(request, context, h)
  }
}

/**
 * Shows the entries of a web-form report. The engine lists the first entry
 * page's fields against top-level state, where an entry's answers never are,
 * so that group is replaced: a row counting the entries, with a Change link
 * to the report entries page where they are added and removed, and then a
 * summary card per entry with a Change link on each answer.
 *
 * The entries are also added to the summary details in the shape of the
 * engine's repeater items, so that the output service receives them with the
 * other answers (see getFormSubmissionData and output-service.js).
 * @param {{ details?: object[], checkAnswers?: object[] }} viewModel - the summary view model
 * @param {object} summaryPage - the summary page controller
 * @param {{ state?: object }} context - the form context
 * @param {object} translator - the engine translator for the request
 */
function showReportEntries(viewModel, summaryPage, context, translator) {
  const { model } = summaryPage
  const entriesPage = entriesPageOf(model)

  if (!entriesPage || !entryPagesOf(model).length) {
    return
  }

  const entries = entriesOf(context.state)
  const returnUrl = summaryPage.href
  const entriesHref = redirectPath(entriesPage.href, { returnUrl })

  removeEntriesSectionGroup(viewModel, entryPagesOf(model)[0].section?.name)

  viewModel.checkAnswers ??= []

  if (!viewModel.checkAnswers.length) {
    viewModel.checkAnswers.push({ summaryList: { rows: [] } })
  }

  const [mainSection] = viewModel.checkAnswers

  mainSection.summaryList ??= { rows: [] }
  mainSection.summaryList.rows ??= []
  mainSection.summaryList.rows.push({
    key: { text: ENTRIES_KEY_TEXT },
    value: {
      classes: 'app-prose-scope',
      text: entriesCountText(model, entries.length)
    },
    actions: {
      items: [
        {
          href: entriesHref,
          text: CHANGE_TEXT,
          classes: 'govuk-link--no-visited-state',
          visuallyHiddenText: ENTRIES_KEY_TEXT.toLowerCase()
        }
      ]
    }
  })

  for (const [index, entry] of entries.entries()) {
    viewModel.checkAnswers.push({
      summaryList: entryCard(model, entry, index, translator, { returnUrl })
    })
  }

  viewModel.details ??= []
  viewModel.details.push({
    name: ENTRIES_KEY,
    items: [
      {
        name: ENTRIES_KEY,
        label: ENTRIES_KEY_TEXT,
        title: ENTRIES_KEY_TEXT,
        value: entriesCountText(model, entries.length),
        href: entriesHref,
        state: context.state,
        page: entriesPage,
        subItems: entries.map((entry) =>
          entryDetailItems(model, entry, translator, { returnUrl })
        )
      }
    ]
  })
}

/**
 * Drops the group the engine built for the entries section from both the
 * details and the rows built from them, which share an index.
 * @param {{ details?: object[], checkAnswers?: object[] }} viewModel - the summary view model
 * @param {string} [sectionName] - name of the entries section
 */
function removeEntriesSectionGroup(viewModel, sectionName) {
  const index = (viewModel.details ?? []).findIndex(
    (detail) => detail.name === sectionName
  )

  if (index === -1) {
    return
  }

  viewModel.details.splice(index, 1)
  viewModel.checkAnswers?.splice(index, 1)
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
