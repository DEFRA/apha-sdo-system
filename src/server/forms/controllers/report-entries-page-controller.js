// Import order matters here. The engine's page controllers form a cycle
// through its component barrel, so QuestionPageController.js throws unless a
// module that pulls the components in first has already been evaluated —
// report-entries.js, by way of the engine's component helpers.
import {
  ADD_ANOTHER_ENTRY_TEXT,
  CONTINUE_TEXT,
  ENTRIES_KEY,
  MAX_ENTRIES,
  REMOVE_TEXT,
  entriesCountText,
  entriesErrors,
  entriesOf,
  entryCard,
  entryName,
  entryPagePath,
  entryPagesOf,
  entryTitleOf,
  findEntry,
  newEntryId,
  removeEntry,
  tooManyEntriesError
} from './report-entries.js'
import { QuestionPageController } from '@defra/forms-engine-plugin/controllers/QuestionPageController.js'
import Boom from '@hapi/boom'
import Joi from 'joi'

const ADD_ANOTHER_ACTION = 'add-another'
const CANCEL_TEXT = 'Cancel'

/**
 * The report entries page of an Animal Health Regulations web-form report:
 * "You have added N entries to the report", each entry as a summary card
 * with Change and Remove links, and the buttons "Add another entry to the
 * report" and "Continue".
 *
 * Served at /{slug}/report-entries. With an entry id,
 * /{slug}/report-entries/{itemId}, it asks the user to confirm removing that
 * entry. It has no questions of its own; the entries are answered on the
 * pages served by ReportEntryPageController (see report-entries.js).
 *
 * For the engine's walk of the form the entries only need to be a list, so
 * that a user part way through their first entry is not turned back. That
 * the report has at least one entry and that every entry is complete is
 * checked here when the user continues, and again by the summary page when
 * they submit.
 */
export class ReportEntriesPageController extends QuestionPageController {
  removeViewName = 'item-delete'

  constructor(model, pageDef) {
    super(model, pageDef)

    this.viewName = 'report-entries'
    this.collection.stateSchema = Joi.object({
      [ENTRIES_KEY]: Joi.array().items(Joi.object().unknown(true))
    })
  }

  get keys() {
    return [ENTRIES_KEY]
  }

  /**
   * Where a new entry starts
   * @param {object} [query] - query params to carry, such as returnUrl
   */
  newEntryPath(query) {
    const [firstPage] = entryPagesOf(this.model)

    return entryPagePath(firstPage, newEntryId(), query)
  }

  /**
   * The remove confirmation for an entry
   * @param {string} itemId - the entry's id
   */
  removeHref(itemId) {
    return this.getHref(`${this.path}/${itemId}`)
  }

  makeGetRouteHandler() {
    return async (request, context, h) => {
      const entries = entriesOf(context.state)
      const itemId = this.getItemId(request)

      if (itemId) {
        return this.renderRemoveConfirmation(request, context, h, itemId)
      }

      // Nothing to list yet: straight into the first entry
      if (!entries.length) {
        return super.proceed(
          request,
          h,
          this.newEntryPath({ returnUrl: request.query.returnUrl })
        )
      }

      return this.renderList(request, context, h)
    }
  }

  makePostRouteHandler() {
    return async (request, context, h) => {
      const entries = entriesOf(context.state)
      const itemId = this.getItemId(request)
      const { action, confirm } = this.getFormParams(request)

      if (itemId) {
        if (!findEntry(entries, itemId)) {
          throw Boom.notFound('Entry to remove not found')
        }

        if (confirm) {
          await this.mergeState(request, context.state, {
            [ENTRIES_KEY]: removeEntry(entries, itemId)
          })
        }

        return super.proceed(request, h, this.path)
      }

      if (action === ADD_ANOTHER_ACTION) {
        if (entries.length >= MAX_ENTRIES) {
          return this.renderList(request, context, h, [
            tooManyEntriesError(this.model)
          ])
        }

        return super.proceed(request, h, this.newEntryPath())
      }

      // Continue: the report needs at least one entry, each complete
      const errors = entriesErrors(this.model, entries, {
        returnUrl: this.href
      })

      if (errors.length) {
        return this.renderList(request, context, h, errors)
      }

      return super.proceed(request, h, this.getNextPath(context))
    }
  }

  renderList(request, context, h, errors) {
    const translator = this.getTranslator(request)
    const { t } = translator
    const entries = entriesOf(context.state)

    const entryCards = entries.map((entry, index) =>
      entryCard(this.model, entry, index, translator, {
        returnUrl: this.href,
        removeHref: this.removeHref(entry.itemId)
      })
    )

    return h.view(this.viewName, {
      ...this.viewModel,
      backLink: this.getBackLink(request, context, t),
      pageTitle: `You have added ${entriesCountText(this.model, entries.length)} to the report`,
      showTitle: true,
      context,
      errors,
      entryCards,
      addAnotherText: ADD_ANOTHER_ENTRY_TEXT,
      continueText: CONTINUE_TEXT,
      t
    })
  }

  renderRemoveConfirmation(request, context, h, itemId) {
    const { t } = this.getTranslator(request)
    const entries = entriesOf(context.state)
    const entry = findEntry(entries, itemId)

    if (!entry) {
      throw Boom.notFound('Entry to remove not found')
    }

    return h.view(this.removeViewName, {
      ...this.viewModel,
      context,
      backLink: { text: t('common.back'), href: this.href },
      pageTitle: `Are you sure you want to remove this ${entryTitleOf(this.model).toLowerCase()}?`,
      itemTitle: entryName(this.model, entries.indexOf(entry)),
      buttonConfirm: { text: REMOVE_TEXT },
      buttonCancel: { text: CANCEL_TEXT },
      t
    })
  }

  /**
   * Back to check your answers when changing from there, otherwise to the
   * page before the entries: there is no single last entry page to return
   * to.
   */
  getBackLink(request, context, t) {
    const { returnUrl } = request.query

    if (returnUrl) {
      return {
        text: t('pages.question.backToCheckAnswers'),
        href: returnUrl
      }
    }

    const [firstPage] = entryPagesOf(this.model)
    const { paths } = context
    const backPath = paths[paths.indexOf(firstPage.path) - 1]

    if (!backPath) {
      return undefined
    }

    return {
      text: t('common.back'),
      href: this.getHref(backPath)
    }
  }
}
