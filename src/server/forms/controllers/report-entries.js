/**
 * The entries of an Animal Health Regulations report entered as a web form.
 *
 * A report covers one month but any number of entries, one per pathogen,
 * species and country. Each entry is answered over the pages of the form's
 * `entries` section (see animal-health-regulations-web-form.js), which are
 * served by ReportEntryPageController, and the entries added so far are
 * listed by ReportEntriesPageController. The forms engine only repeats a
 * single page, so this module holds what the two controllers, the summary
 * page and the output service share: where the entries live in form state,
 * which pages an entry needs answered, whether it is complete, and how it is
 * shown as a summary card.
 *
 * Form state:
 *
 *   state.entries = [
 *     { itemId, added?, pathogen, species, otherSpecies?, country, ...counts },
 *     ...
 *   ]
 *
 * `added` is set once the entry has been completed for the first time, and
 * stays set when a later change drops some of its answers: from then on the
 * entry is being edited rather than added.
 *
 * The engine's own page walk sees the section as a single step (the first
 * entry page leads straight to the report entries page), so an entry's own
 * pages are walked here, evaluating each page's condition against that
 * entry's answers. That is what asks for the other species only when that
 * entry's species is "Other".
 */

import { randomUUID } from 'node:crypto'
import isEqual from 'lodash/isEqual.js'
import {
  getAnswer,
  hasListFormField
} from '@defra/forms-engine-plugin/engine/components/helpers/components.js'
import { redirectPath } from '@defra/forms-engine-plugin/engine/helpers.js'
import { validationOptions } from '@defra/forms-engine-plugin/engine/pageControllers/validationOptions.js'

export const ENTRIES_KEY = 'entries'
export const MIN_ENTRIES = 1
export const MAX_ENTRIES = 100

// The controller names the form definition uses for the two kinds of page
export const ENTRY_PAGE_CONTROLLER = 'ReportEntryPageController'
export const ENTRIES_PAGE_CONTROLLER = 'ReportEntriesPageController'

export const ADD_ANOTHER_ENTRY_TEXT = 'Add another entry to the report'
export const CONTINUE_TEXT = 'Continue'
export const CHANGE_TEXT = 'Change'
export const REMOVE_TEXT = 'Remove'
export const SAVE_AND_EXIT_TEXT = 'Save and exit'
export const ABORT_ENTRY_TEXT = 'Abort new entry'

// The flag an entry carries once it has been completed for the first time
export const ADDED_KEY = 'added'

// Change and Remove links look the same whether or not they were followed
const LINK_CLASSES = 'govuk-link--no-visited-state'

const DEFAULT_ENTRY_TITLE = 'Entry'

/**
 * The pages answered once per entry, in journey order.
 * @param {{ pages?: object[] }} [model] - the form model
 * @returns {object[]}
 */
export function entryPagesOf(model) {
  return (model?.pages ?? []).filter(
    (page) => page.pageDef?.controller === ENTRY_PAGE_CONTROLLER
  )
}

/**
 * The page that lists the entries added so far.
 * @param {{ pages?: object[] }} [model] - the form model
 */
export function entriesPageOf(model) {
  return model?.pages?.find(
    (page) => page.pageDef?.controller === ENTRIES_PAGE_CONTROLLER
  )
}

/**
 * Whether a form is a report with entries, from its definition. For use
 * while the engine is still building the model's pages, when entriesPageOf
 * cannot find them yet.
 * @param {{ def?: { pages?: object[] } }} [model] - the form model
 */
export function isReportWithEntries(model) {
  return (model?.def?.pages ?? []).some(
    (page) => page.controller === ENTRIES_PAGE_CONTROLLER
  )
}

/**
 * The question pages answered once for the whole report, before the entries
 * begin: the report date.
 * @param {{ pages?: object[] }} [model] - the form model
 * @returns {object[]}
 */
export function pagesBeforeEntries(model) {
  const pages = model?.pages ?? []
  const firstEntryPage = pages.findIndex(
    (page) => page.pageDef?.controller === ENTRY_PAGE_CONTROLLER
  )

  return (firstEntryPage === -1 ? [] : pages.slice(0, firstEntryPage)).filter(
    (page) => page.collection?.fields?.length
  )
}

/**
 * What an entry is called, from the section the entry pages belong to.
 * @param {{ pages?: object[] }} [model] - the form model
 * @returns {string}
 */
export function entryTitleOf(model) {
  return entryPagesOf(model)[0]?.section?.title ?? DEFAULT_ENTRY_TITLE
}

/**
 * "Entry 2": how an entry is named to the user.
 * @param {{ pages?: object[] }} model - the form model
 * @param {number} index - position of the entry in the list, from 0
 */
export function entryName(model, index) {
  return `${entryTitleOf(model)} ${index + 1}`
}

/**
 * "1 entry", "3 entries": how a number of entries is described.
 * @param {{ pages?: object[] }} model - the form model
 * @param {number} count - the number of entries
 */
export function entriesCountText(model, count) {
  const title = entryTitleOf(model).toLowerCase()
  const noun = count === 1 ? title : `${title.replace(/y$/, 'ie')}s`

  return `${count} ${noun}`
}

/**
 * Whether an entry has been completed before, and so is being edited rather
 * than added.
 * @param {object} [entry] - the entry
 */
export function isAddedEntry(entry) {
  return entry?.[ADDED_KEY] === true
}

/**
 * "Adding entry 2" while an entry is first being answered, "Editing entry
 * 2/3" once it has been completed before: the caption of an entry page.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object[]} entries - the entries in form state
 * @param {object} entry - the entry the page is for
 */
export function entryCaption(model, entries, entry) {
  const title = entryTitleOf(model).toLowerCase()
  const index = entries.findIndex((other) => other.itemId === entry.itemId)
  const position = (index === -1 ? entries.length : index) + 1

  return isAddedEntry(entry)
    ? `Editing ${title} ${position}/${entries.length}`
    : `Adding ${title} ${position}`
}

function isEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.itemId === 'string'
  )
}

/**
 * The entries in form state, oldest first.
 * @param {object} [state] - the form state
 * @returns {object[]}
 */
export function entriesOf(state) {
  const entries = state?.[ENTRIES_KEY]

  return Array.isArray(entries) ? entries.filter(isEntry) : []
}

/**
 * @param {object[]} entries - the entries in form state
 * @param {string} [itemId] - the id of the entry wanted
 */
export function findEntry(entries, itemId) {
  return entries.find((entry) => entry.itemId === itemId)
}

export function newEntryId() {
  return randomUUID()
}

/**
 * Adds or replaces an entry, leaving the others in place.
 * @param {object[]} entries - the entries in form state
 * @param {object} entry - the entry to store, with its itemId
 * @returns {object[]} a new list
 */
export function upsertEntry(entries, entry) {
  const index = entries.findIndex((other) => other.itemId === entry.itemId)

  if (index === -1) {
    return [...entries, entry]
  }

  return entries.map((other, position) => (position === index ? entry : other))
}

/**
 * @param {object[]} entries - the entries in form state
 * @param {string} itemId - the id of the entry to remove
 * @returns {object[]} a new list
 */
export function removeEntry(entries, itemId) {
  return entries.filter((entry) => entry.itemId !== itemId)
}

/**
 * The values an entry's page conditions are evaluated against: the answers
 * of every entry page, read from the entry rather than from top-level state.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} [entry] - the entry
 */
export function entryEvaluationState(model, entry = {}) {
  return Object.assign(
    {},
    ...entryPagesOf(model).map((page) =>
      page.collection.getContextValueFromState(entry)
    )
  )
}

/**
 * The pages an entry needs answered: every entry page whose condition holds
 * for that entry. "Enter other species" is only relevant when the species is
 * "Other".
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} [entry] - the entry
 * @returns {object[]}
 */
export function relevantEntryPages(model, entry) {
  const evaluationState = entryEvaluationState(model, entry)

  return entryPagesOf(model).filter(
    (page) => !page.condition || page.condition.fn(evaluationState)
  )
}

/**
 * The options of a list field offered to an entry: those without a
 * condition, and those whose condition holds for the entry's answers. The
 * species offered depend on the pathogen this way.
 * @param {{ conditions?: object }} model - the form model
 * @param {{ items: object[] }} field - a list form component
 * @param {object} [entry] - the entry
 * @returns {object[]} list items
 */
export function offeredListItems(model, field, entry) {
  const evaluationState = entryEvaluationState(model, entry)

  return field.items.filter(
    (item) =>
      !item.condition ||
      (model.conditions?.[item.condition]?.fn(evaluationState) ?? false)
  )
}

/**
 * The list fields of a page whose answer in the entry is not one of the
 * options offered to that entry, a species not reported for its pathogen,
 * say. An unanswered field is not among them; the page's schema deals with
 * those.
 * @param {{ conditions?: object }} model - the form model
 * @param {{ collection: { fields: object[] } }} page - an entry page
 * @param {object} [entry] - the entry
 * @returns {object[]} list form components
 */
export function disallowedListAnswers(model, page, entry = {}) {
  return page.collection.fields.filter((field) => {
    if (!hasListFormField(field)) {
      return false
    }

    const answer = entry[field.name]

    if (answer === undefined || answer === null || answer === '') {
      return false
    }

    return !offeredListItems(model, field, entry).some(
      (item) => item.value === answer
    )
  })
}

/**
 * Whether a page's answers are present, valid and among the options offered
 * to the entry.
 * @param {{ conditions?: object }} model - the form model
 * @param {{ entryStateSchema?: object, collection: object }} page - an entry page
 * @param {object} [entry] - the entry
 */
export function isEntryPageComplete(model, page, entry = {}) {
  const schema = page.entryStateSchema

  if (
    schema &&
    schema.validate(entry, { ...validationOptions, stripUnknown: true }).error
  ) {
    return false
  }

  return !disallowedListAnswers(model, page, entry).length
}

/**
 * The first relevant page of an entry whose answers are missing or invalid,
 * or undefined when the entry is complete.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} [entry] - the entry
 */
export function firstIncompleteEntryPage(model, entry) {
  return relevantEntryPages(model, entry).find(
    (page) => !isEntryPageComplete(model, page, entry)
  )
}

/**
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} [entry] - the entry
 */
export function isEntryComplete(model, entry) {
  return !firstIncompleteEntryPage(model, entry)
}

/**
 * Whether a page's answers differ from those the entry already holds. A page
 * never answered counts as changed.
 * @param {{ collection: { keys: string[] } }} page - an entry page
 * @param {object} [before] - the entry as stored
 * @param {object} [after] - the page's new answers
 */
export function entryPageAnswersChanged(page, before = {}, after = {}) {
  return page.collection.keys.some((key) => !isEqual(before[key], after[key]))
}

/**
 * Drops from an entry the answers of every page after the given one, so
 * that once an answer is changed the questions that followed it are asked
 * again rather than kept from before the change.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} page - the entry page whose answer changed
 * @param {object} entry - the entry
 * @returns {object} a new entry
 */
export function clearAnswersAfter(model, page, entry) {
  const pages = entryPagesOf(model)
  const laterKeys = new Set(
    pages
      .slice(pages.indexOf(page) + 1)
      .flatMap((later) => later.collection.keys)
  )

  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => !laterKeys.has(key))
  )
}

/**
 * Drops from an entry the answers of pages that are no longer relevant to it,
 * so a species changed away from "Other" does not keep its other species.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} entry - the entry
 * @returns {object} a new entry
 */
export function pruneEntry(model, entry) {
  const relevantKeys = new Set(
    relevantEntryPages(model, entry).flatMap((page) => page.collection.keys)
  )
  const pruned = { itemId: entry.itemId }

  if (isAddedEntry(entry)) {
    pruned[ADDED_KEY] = true
  }

  for (const [key, value] of Object.entries(entry)) {
    if (relevantKeys.has(key)) {
      pruned[key] = value
    }
  }

  return pruned
}

/**
 * The path of an entry page for one entry, relative to the form:
 * /which-species-was-tested/{itemId}
 * @param {{ path: string }} page - an entry page
 * @param {string} itemId - the entry's id
 * @param {object} [query] - query params to carry, such as returnUrl
 */
export function entryPagePath(page, itemId, query = {}) {
  return redirectPath(`${page.path}/${itemId}`, query)
}

/**
 * The href of an entry page for one entry, from the service root:
 * /{slug}/which-species-was-tested/{itemId}
 * @param {{ path: string, getHref: Function }} page - an entry page
 * @param {string} itemId - the entry's id
 * @param {object} [query] - query params to carry, such as returnUrl
 */
export function entryPageHref(page, itemId, query = {}) {
  return redirectPath(page.getHref(`${page.path}/${itemId}`), query)
}

/**
 * An answer as shown on check your answers. The engine renders list answers
 * through Markdown and, when the text has punctuation it escapes (the
 * parentheses of "BHV-1", say), ends them with a line break; that is dropped.
 * @param {object} field - the form component
 * @param {object} state - the state holding the answer
 * @param {object} translator - the engine translator for the request
 * @returns {string} HTML
 */
export function answerHtml(field, state, translator) {
  return getAnswer(field, state, translator, { format: 'summary' }).replace(
    /(<br>)+$/,
    ''
  )
}

/**
 * An answer as written to the submission: the raw value, as a string
 * @param {object} field - the form component
 * @param {object} state - the state holding the answer
 * @param {object} translator - the engine translator for the request
 * @returns {string}
 */
export function answerData(field, state, translator) {
  return getAnswer(field, state, translator, { format: 'data' })
}

/**
 * Summary detail items for an entry, one per field of its relevant pages, in
 * the shape of the engine's own detail items so the check your answers page,
 * the engine's submission records and the output service can all read them.
 * `value` is the answer as shown, `data` the answer as submitted.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} entry - the entry
 * @param {object} translator - the engine translator for the request
 * @param {{ returnUrl?: string }} [options] - where a Change link returns to
 * @returns {object[]}
 */
export function entryDetailItems(model, entry, translator, options = {}) {
  return relevantEntryPages(model, entry).flatMap((page) =>
    page.collection.fields.map((field) => ({
      name: field.name,
      label: field.title,
      title: field.label,
      value: answerHtml(field, entry, translator),
      data: answerData(field, entry, translator),
      href: entryPageHref(page, entry.itemId, {
        returnUrl: options.returnUrl
      }),
      state: entry,
      page,
      field
    }))
  )
}

/**
 * The answers given so far, shown at the top of an entry page: those of the
 * report before the entries (the report date), then those of the entry's
 * pages before this one. Each row has a Change link to its page that returns
 * here. A GOV.UK summary list, with only the questions answered.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} page - the entry page being shown
 * @param {object} entry - the entry
 * @param {object} state - the form state, for the answers before the entries
 * @param {object} translator - the engine translator for the request
 * @returns {{ rows: object[] }}
 */
export function answersSoFar(model, page, entry, state, translator) {
  const returnUrl = entryPageHref(page, entry.itemId)
  const allEntryPages = entryPagesOf(model)
  const earlierPages = relevantEntryPages(model, entry).filter(
    (other) => allEntryPages.indexOf(other) < allEntryPages.indexOf(page)
  )

  const answers = [
    ...pagesBeforeEntries(model).flatMap((before) =>
      before.collection.fields.map((field) => ({
        field,
        state,
        href: redirectPath(before.href, { returnUrl })
      }))
    ),
    ...earlierPages.flatMap((earlier) =>
      earlier.collection.fields.map((field) => ({
        field,
        state: entry,
        href: entryPageHref(earlier, entry.itemId, { returnUrl })
      }))
    )
  ]

  const rows = answers
    .map(({ field, state: answerState, href }) => ({
      key: { text: field.label },
      value: {
        classes: 'app-prose-scope',
        html: answerHtml(field, answerState, translator)
      },
      actions: {
        items: [
          {
            href,
            text: CHANGE_TEXT,
            classes: LINK_CLASSES,
            visuallyHiddenText: field.label.toLowerCase()
          }
        ]
      }
    }))
    .filter((row) => row.value.html)

  return { rows }
}

/**
 * A GOV.UK summary card for an entry: titled "Entry N", one row per answer
 * with a Change link to its page, and optionally a Remove action. The card
 * component adds the card title to each link's hidden text itself.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object} entry - the entry
 * @param {number} index - position of the entry in the list, from 0
 * @param {object} translator - the engine translator for the request
 * @param {{ returnUrl?: string, removeHref?: string }} [options] - where a
 *   Change link returns to, and the Remove link when removal is offered
 */
export function entryCard(model, entry, index, translator, options = {}) {
  const rows = entryDetailItems(model, entry, translator, options).map(
    (item) => ({
      key: { text: item.title },
      value: {
        classes: 'app-prose-scope',
        html: item.value || translator.t('pages.summary.notProvided')
      },
      actions: {
        items: [
          {
            href: item.href,
            text: CHANGE_TEXT,
            classes: LINK_CLASSES,
            visuallyHiddenText: item.title.toLowerCase()
          }
        ]
      }
    })
  )

  const card = { title: { text: entryName(model, index) } }

  if (options.removeHref) {
    card.actions = {
      items: [
        {
          href: options.removeHref,
          text: REMOVE_TEXT,
          classes: LINK_CLASSES,
          visuallyHiddenText: entryTitleOf(model).toLowerCase()
        }
      ]
    }
  }

  return { card, rows }
}

/**
 * The error shown when the report has fewer entries than it needs
 * @param {{ pages?: object[] }} model - the form model
 */
export function tooFewEntriesError(model) {
  return entriesError(
    `Add at least ${entriesCountText(model, MIN_ENTRIES)} to the report`
  )
}

/**
 * The error shown when another entry would take the report over its limit
 * @param {{ pages?: object[] }} model - the form model
 */
export function tooManyEntriesError(model) {
  return entriesError(
    `You can only add up to ${entriesCountText(model, MAX_ENTRIES)} to the report`
  )
}

/**
 * One error per entry with a question left unanswered, linking to it
 * @param {{ pages?: object[] }} model - the form model
 * @param {object[]} entries - the entries in form state
 * @param {{ returnUrl?: string }} [options] - where the entry's page returns to
 */
export function incompleteEntryErrors(model, entries, options = {}) {
  return entries.flatMap((entry, index) => {
    const page = firstIncompleteEntryPage(model, entry)

    if (!page) {
      return []
    }

    return [
      entriesError(
        `Complete ${entryName(model, index).toLowerCase()} or remove it`,
        entryPageHref(page, entry.itemId, { returnUrl: options.returnUrl })
      )
    ]
  })
}

/**
 * The errors that stop a report going forward with its entries: too few, too
 * many, or one with a question left unanswered.
 * @param {{ pages?: object[] }} model - the form model
 * @param {object[]} entries - the entries in form state
 * @param {{ returnUrl?: string }} [options] - where an entry's page returns to
 * @returns {{ text: string, href: string, name: string, path: string[] }[]}
 */
export function entriesErrors(model, entries, options = {}) {
  return [
    ...(entries.length < MIN_ENTRIES ? [tooFewEntriesError(model)] : []),
    ...(entries.length > MAX_ENTRIES ? [tooManyEntriesError(model)] : []),
    ...incompleteEntryErrors(model, entries, options)
  ]
}

function entriesError(text, href = '') {
  return { text, href, name: ENTRIES_KEY, path: [ENTRIES_KEY] }
}
