// Import order matters here. The engine's page controllers form a cycle
// through its component barrel, so QuestionPageController.js throws unless a
// module that pulls the components in first has already been evaluated —
// report-entries.js, by way of the engine's component helpers.
import {
  ABORT_ENTRY_TEXT,
  ADDED_KEY,
  ENTRIES_KEY,
  SAVE_AND_EXIT_TEXT,
  answersSoFar,
  clearAnswersAfter,
  disallowedListAnswers,
  entriesOf,
  entriesPageOf,
  entryCaption,
  entryEvaluationState,
  entryPageAnswersChanged,
  entryPagePath,
  entryPageHref,
  entryPagesOf,
  findEntry,
  firstIncompleteEntryPage,
  isAddedEntry,
  isEntryComplete,
  newEntryId,
  pruneEntry,
  relevantEntryPages,
  removeEntry,
  upsertEntry
} from './report-entries.js'
import { QuestionPageController } from '@defra/forms-engine-plugin/controllers/QuestionPageController.js'
import { getCacheService } from '@defra/forms-engine-plugin/engine/helpers.js'
import Boom from '@hapi/boom'
import Joi from 'joi'

import { POST_SIGN_IN_PATH } from '#/server/auth/auth-constants.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

// Set on request.app by getStateFromValidForm, read by proceed: whether the
// post changed an answer the entry already had
const ANSWERS_CHANGED = 'reportEntryAnswersChanged'

// Rendered above the page heading rather than among the questions
const NOTIFICATION_BANNER = 'NotificationBanner'

// "Abort new entry" posts the engine's delete action, the one its routes
// accept that means removing an item
const ABORT_ACTION = 'delete'

// The engine's translation key for a plain "Back" link
const BACK_TEXT_KEY = 'common.back'

/**
 * A page answered once per entry of an Animal Health Regulations web-form
 * report, served at /{slug}/{path}/{itemId} where itemId names the entry.
 *
 * The engine keeps a page's answers at the top level of form state and walks
 * the form's pages once to decide which are relevant. Here the answers are
 * kept in the entry instead (state.entries[], see report-entries.js), and
 * the engine's walk treats the whole run of entry pages as a single step
 * from the first of them to the report entries page. The walk of one entry's
 * own pages, conditions evaluated against that entry, is done here: it
 * decides which page comes next, which page the user may be on, and where a
 * back link goes.
 *
 * Above its question, each page lists the answers given so far, the report
 * date and the entry's earlier answers, each with a Change link back to its
 * page. Changing an earlier answer drops the answers that followed it, so
 * the user is asked those questions again rather than keeping answers given
 * before the change.
 *
 * Beside Continue, "Save and exit" leaves for Submission Welcome without
 * saving the page being left (the pages before it are already saved), and
 * while an entry is being added, "Abort new entry" discards it.
 *
 * The engine evaluates conditions, including those that decide which options
 * of a list are offered, against top-level state. Before it renders a page
 * the entry's answers are added to that state, so the species offered are
 * those for the entry's pathogen, and an answer that is not among the
 * options offered is refused.
 */
export class ReportEntryPageController extends QuestionPageController {
  /**
   * The page's field schema, kept for validating an entry (see
   * report-entries.js isEntryPageComplete). The collection's own state
   * schema is emptied because the engine validates it against top-level
   * state, where an entry's answers never are.
   */
  entryStateSchema

  constructor(model, pageDef) {
    super(model, pageDef)

    this.viewName = 'report-entry'
    this.entryStateSchema = this.collection.stateSchema
    this.collection.stateSchema = Joi.object()

    // The entry id travels with the form payload (see getFormParams)
    this.collection.formSchema = this.collection.formSchema.append({
      itemId: Joi.string().uuid().required()
    })
  }

  get keys() {
    return [ENTRIES_KEY]
  }

  get entryPages() {
    return entryPagesOf(this.model)
  }

  get isFirstEntryPage() {
    return this.entryPages[0] === this
  }

  get entriesPagePath() {
    return entriesPageOf(this.model)?.path ?? this.getSummaryPath()
  }

  /**
   * The entry the request is about, from state, or a new one with the
   * request's id when it has not been saved yet.
   * @param {object} request - the hapi request
   * @param {object} [state] - the form state
   */
  entryOf(request, state) {
    const itemId = this.getItemId(request)

    return findEntry(entriesOf(state), itemId) ?? { itemId }
  }

  getFormParams(request) {
    const params = super.getFormParams(request)

    // Apply the entry id in the URL to the form payload. A post without one
    // is refused by getStateFromValidForm rather than given an id here,
    // which would differ on every call.
    if (request?.payload && request.params.itemId) {
      params.itemId = request.params.itemId
    }

    return params
  }

  /**
   * The page's answers, read from the entry rather than top-level state
   */
  getFormDataFromState(request, state) {
    const params = this.getFormParams(request)
    const entry = findEntry(entriesOf(state), this.getItemId(request)) ?? {}

    return {
      ...params,
      ...this.collection.getFormDataFromState(entry)
    }
  }

  /**
   * Stores the page's answers in the entry, and the entry in the list. When
   * they differ from the answers the entry had, the answers of the pages
   * that follow are dropped so those questions are asked again. Answers of
   * pages no longer relevant to the entry are dropped too. An entry that is
   * complete has been added to the report, from now on it is edited.
   */
  getStateFromValidForm(request, state, payload) {
    const itemId = this.getItemId(request)

    if (!itemId) {
      throw Boom.badRequest('No entry id found')
    }

    const entries = entriesOf(state)
    const existing = findEntry(entries, itemId) ?? { itemId }
    const answers = this.collection.getStateFromValidForm(payload)
    const changed = entryPageAnswersChanged(this, existing, answers)

    let updated = { ...existing, ...answers, itemId }

    if (changed) {
      updated = clearAnswersAfter(this.model, this, updated)
    }

    updated = pruneEntry(this.model, updated)

    if (isEntryComplete(this.model, updated)) {
      updated[ADDED_KEY] = true
    }

    if (request.app) {
      request.app[ANSWERS_CHANGED] = changed
    }

    return { [ENTRIES_KEY]: upsertEntry(entries, updated) }
  }

  /**
   * For the engine's walk of the form the run of entry pages is one step:
   * from the first entry page straight to the report entries page.
   */
  getNextPath() {
    return this.entriesPagePath
  }

  /**
   * The page the user may be on. Until the report date is answered the
   * engine's own answer stands. Otherwise it is this page for the entry,
   * unless an earlier page of the entry is unanswered, or this page is not
   * relevant to the entry at all.
   */
  getRelevantPath(request, context) {
    const modelPath = super.getRelevantPath(request, context)
    const [firstPage] = this.entryPages

    if (!context.paths.includes(firstPage.path)) {
      return modelPath
    }

    const itemId = this.getItemId(request)

    if (!itemId) {
      return this.isFirstEntryPage ? this.path : this.entriesPagePath
    }

    const entry = this.entryOf(request, context.state)
    const pages = relevantEntryPages(this.model, entry)
    const incomplete = firstIncompleteEntryPage(this.model, entry)

    if (!pages.includes(this)) {
      return incomplete
        ? entryPagePath(incomplete, itemId)
        : this.entriesPagePath
    }

    const target =
      incomplete && pages.indexOf(incomplete) < pages.indexOf(this)
        ? incomplete
        : this

    return entryPagePath(target, itemId)
  }

  /**
   * Adds the entry's answers to the state the engine evaluates conditions
   * against, so conditional list options follow the entry's own answers
   * @param {object} request - the hapi request
   * @param {{ state: object, evaluationState: object }} context - the form context
   */
  evaluateForEntry(request, context) {
    Object.assign(
      context.evaluationState,
      entryEvaluationState(this.model, this.entryOf(request, context.state))
    )
  }

  makeGetRouteHandler() {
    const handler = super.makeGetRouteHandler()

    return (request, context, h) => {
      const itemId = this.getItemId(request)

      if (itemId) {
        this.evaluateForEntry(request, context)

        return handler(request, context, h)
      }

      // Start a new entry from the first entry page, unless there are
      // entries already, in which case the user chooses what to do next
      const nextPath =
        this.isFirstEntryPage && !entriesOf(context.state).length
          ? entryPagePath(this, newEntryId(), {
              returnUrl: request.query.returnUrl
            })
          : this.entriesPagePath

      return super.proceed(request, h, nextPath)
    }
  }

  /**
   * Handles "Abort new entry", and refuses an answer that is not among the
   * options offered to the entry, before the engine saves the page
   */
  makePostRouteHandler() {
    const handler = super.makePostRouteHandler()

    return (request, context, h) => {
      if (this.getFormParams(request).action === ABORT_ACTION) {
        return this.abortEntry(request, context, h)
      }

      this.evaluateForEntry(request, context)

      const disallowed = disallowedListAnswers(
        this.model,
        this,
        this.entryOf(request, context.state)
      )

      if (disallowed.length) {
        context.errors = [
          ...(context.errors ?? []),
          ...disallowed.map((field) => ({
            path: [field.name],
            href: `#${field.name}`,
            name: field.name,
            text: `Select one of the options shown for ${field.label.toLowerCase()}`
          }))
        ]
      }

      return handler(request, context, h)
    }
  }

  /**
   * After saving, on to the next page the entry needs answered, then to the
   * report entries page. A change link's returnUrl is honoured only once the
   * entry is complete, so changing the species to "Other" still asks for
   * the other species first. A change made from a later page of the same
   * entry drops that page's answers along with the rest, so there is
   * nothing to return to: the entry is walked forward from here instead.
   */
  async proceed(request, h) {
    const state = await this.getState(request)
    const entry = this.entryOf(request, state)
    const { itemId } = entry
    const { returnUrl } = request.query
    const returnsToThisEntry = returnUrl?.includes(`/${itemId}`)
    const changed = request.app?.[ANSWERS_CHANGED] === true
    const redirectTo = (href) => h.redirect(href).code(statusCodes.seeOther)

    if (returnUrl && !(changed && returnsToThisEntry)) {
      // Back to a later page of this entry with nothing changed: the pages
      // before it are as complete as when the user was there
      const incomplete = returnsToThisEntry
        ? undefined
        : firstIncompleteEntryPage(this.model, entry)

      if (incomplete) {
        return redirectTo(entryPageHref(incomplete, itemId, { returnUrl }))
      }

      // The engine's proceed sends the user to the returnUrl
      return super.proceed(request, h, this.entriesPagePath)
    }

    // Not the engine's proceed, which would prefer a returnUrl
    const pages = relevantEntryPages(this.model, entry)
    const nextPage = pages[pages.indexOf(this) + 1]

    return redirectTo(
      nextPage
        ? entryPageHref(nextPage, itemId)
        : this.getHref(this.entriesPagePath)
    )
  }

  /**
   * Captions the page with the entry being added or edited, lists the
   * answers given so far above the question, lifts any notification banner
   * above the heading, and offers to save and exit or, while adding, to
   * abort the entry.
   */
  getViewModel(request, context, translator) {
    const viewModel = super.getViewModel(request, context, translator)
    const entries = entriesOf(context.state)
    const entry = this.entryOf(request, context.state)
    const { components = [] } = viewModel

    return {
      ...viewModel,
      // The caption is rendered by the page, not as a section title
      sectionTitle: null,
      entryCaption: entryCaption(this.model, entries, entry),
      banners: components.filter(isNotificationBanner),
      components: components.filter(
        (component) => !isNotificationBanner(component)
      ),
      answersSoFar: answersSoFar(
        this.model,
        this,
        entry,
        context.state,
        translator
      ),
      saveAndExitText: SAVE_AND_EXIT_TEXT,
      abortText: ABORT_ENTRY_TEXT,
      // An entry added before is removed from the report entries page, with
      // confirmation, not aborted
      canAbort: !isAddedEntry(entry)
    }
  }

  /**
   * "Abort new entry": drops the entry being added and sends the user on to
   * the report entries page when there are other entries. With none left the
   * report is abandoned, all of its state goes, the report date included, so
   * coming back starts afresh, and the user goes to Submission Welcome. An
   * entry added before is not dropped this way; the user is sent to confirm
   * removing it instead.
   */
  async abortEntry(request, context, h) {
    const entry = this.entryOf(request, context.state)
    const entries = entriesOf(context.state)
    const entriesPage = entriesPageOf(this.model)
    const redirectTo = (href) => h.redirect(href).code(statusCodes.seeOther)

    if (isAddedEntry(entry)) {
      return redirectTo(
        entriesPage
          ? entriesPage.getHref(`${entriesPage.path}/${entry.itemId}`)
          : this.getHref(this.getSummaryPath())
      )
    }

    const remaining = removeEntry(entries, entry.itemId)

    if (!remaining.length) {
      await getCacheService(request.server).clearState(request)

      return redirectTo(POST_SIGN_IN_PATH)
    }

    if (remaining.length !== entries.length) {
      await this.mergeState(request, context.state, {
        [ENTRIES_KEY]: remaining
      })
    }

    return redirectTo(this.getHref(this.entriesPagePath))
  }

  /**
   * "Save and exit": the engine has already saved everything but the page
   * being left, which is not saved. Back to Submission Welcome.
   */
  handleSaveAndExit(_request, _context, h) {
    return h.redirect(POST_SIGN_IN_PATH).code(statusCodes.seeOther)
  }

  /**
   * Back to the previous page the entry needed answered; from the first
   * page, to the report entries page when there are other entries, or else
   * to the page before the entries.
   */
  getBackLink(request, context, t) {
    const { returnUrl } = request.query

    if (returnUrl) {
      return {
        text: returnUrl.endsWith(this.getSummaryPath())
          ? t('pages.question.backToCheckAnswers')
          : t(BACK_TEXT_KEY),
        href: returnUrl
      }
    }

    const entry = this.entryOf(request, context.state)
    const pages = relevantEntryPages(this.model, entry)
    const previousPage = pages[pages.indexOf(this) - 1]

    if (previousPage) {
      return {
        text: t(BACK_TEXT_KEY),
        href: entryPageHref(previousPage, entry.itemId)
      }
    }

    const others = entriesOf(context.state).filter(
      ({ itemId }) => itemId !== entry.itemId
    )
    const [firstPage] = this.entryPages
    const { paths } = context
    const pageBeforeEntries = paths[paths.indexOf(firstPage.path) - 1]
    const backPath = others.length ? this.entriesPagePath : pageBeforeEntries

    if (!backPath) {
      return undefined
    }

    return {
      text: t(BACK_TEXT_KEY),
      href: this.getHref(backPath)
    }
  }
}

function isNotificationBanner(component) {
  return component.type === NOTIFICATION_BANNER
}
