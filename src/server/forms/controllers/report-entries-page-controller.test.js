import {
  ENTRIES_KEY,
  MAX_ENTRIES
} from '#/server/forms/controllers/report-entries.js'
import { ReportEntriesPageController } from '#/server/forms/controllers/report-entries-page-controller.js'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  ENTRIES_PATH,
  ENTRY_PATHS,
  FIRST_ENTRY_ID,
  REPORT_DATE_PATH,
  SECOND_ENTRY_ID,
  UNKNOWN_ENTRY_ID,
  WEB_FORM_SLUG,
  buildEntry,
  buildOtherSpeciesEntry,
  buildRequest,
  buildState,
  buildToolkit,
  buildWebFormModel,
  pageOf
} from '#/test-helpers/web-form-model.js'

const model = buildWebFormModel()
const page = pageOf(model, ENTRIES_PATH)
const { t } = model.createTranslator()

const href = (path) => `/${WEB_FORM_SLUG}${path}`
const NEW_ENTRY = new RegExp(
  `^${href(ENTRY_PATHS.pathogen)}/[0-9a-f-]{36}(\\?.*)?$`
)

function buildContext(state) {
  return {
    state,
    paths: [REPORT_DATE_PATH, ENTRY_PATHS.pathogen, ENTRIES_PATH],
    evaluationState: {}
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReportEntriesPageController', () => {
  test('Should serve the report entries page of the form', () => {
    expect(page).toBeInstanceOf(ReportEntriesPageController)
    expect(page.viewName).toBe('report-entries')
    expect(page.keys).toEqual([ENTRIES_KEY])
  })

  test("Should only need the entries to be a list for the engine's walk", () => {
    const { stateSchema } = page.collection

    expect(stateSchema.validate({}).error).toBeUndefined()
    expect(
      stateSchema.validate({ [ENTRIES_KEY]: [{ itemId: 'partial' }] }).error
    ).toBeUndefined()
    expect(stateSchema.validate({ [ENTRIES_KEY]: 'no' }).error).toBeDefined()
  })

  test('Should start new entries at the first entry page', () => {
    expect(page.newEntryPath()).toMatch(
      new RegExp(`^${ENTRY_PATHS.pathogen}/[0-9a-f-]{36}$`)
    )
    expect(page.newEntryPath({ returnUrl: '/x' })).toMatch(/\?returnUrl=%2Fx$/)
    expect(page.removeHref(FIRST_ENTRY_ID)).toBe(
      href(`${ENTRIES_PATH}/${FIRST_ENTRY_ID}`)
    )
  })

  describe('GET', () => {
    test('Should start the first entry when there are none to list', async () => {
      const h = buildToolkit()

      const response = await page.makeGetRouteHandler()(
        buildRequest({ query: { returnUrl: '/back' } }),
        buildContext(buildState([])),
        h
      )

      const [location] = h.redirect.mock.calls[0]

      expect(location).toMatch(NEW_ENTRY)
      expect(location).toMatch(/\?returnUrl=%2Fback$/)
      expect(response.statusCode).toBe(statusCodes.redirect)
    })

    test('Should list the entries as cards, with the buttons to go on', async () => {
      const h = buildToolkit()
      const state = buildState([buildEntry(), buildOtherSpeciesEntry()])

      const { name, context } = await page.makeGetRouteHandler()(
        buildRequest(),
        buildContext(state),
        h
      )

      expect(name).toBe('report-entries')
      expect(context).toEqual(
        expect.objectContaining({
          pageTitle: 'You have added 2 entries to the report',
          showTitle: true,
          errors: undefined,
          addAnotherText: 'Add another entry to the report',
          continueText: 'Continue',
          backLink: { text: 'Back', href: href(REPORT_DATE_PATH) }
        })
      )
      expect(context.entryCards.map((card) => card.card.title.text)).toEqual([
        'Entry 1',
        'Entry 2'
      ])

      // Each card offers to change an answer, returning here, or remove the entry
      const [first, second] = context.entryCards

      expect(first.rows[0].actions.items[0].href).toBe(
        `${href(ENTRY_PATHS.pathogen)}/${FIRST_ENTRY_ID}?returnUrl=${encodeURIComponent(href(ENTRIES_PATH))}`
      )
      expect(first.card.actions.items[0].href).toBe(
        href(`${ENTRIES_PATH}/${FIRST_ENTRY_ID}`)
      )
      expect(second.rows).toHaveLength(7)
    })

    test('Should count a single entry in the singular', async () => {
      const { context } = await page.makeGetRouteHandler()(
        buildRequest(),
        buildContext(buildState([buildEntry()])),
        buildToolkit()
      )

      expect(context.pageTitle).toBe('You have added 1 entry to the report')
    })

    test('Should ask for confirmation before removing an entry', async () => {
      const state = buildState([buildEntry(), buildOtherSpeciesEntry()])

      const { name, context } = await page.makeGetRouteHandler()(
        buildRequest({ itemId: SECOND_ENTRY_ID }),
        buildContext(state),
        buildToolkit()
      )

      expect(name).toBe('item-delete')
      expect(context).toEqual(
        expect.objectContaining({
          pageTitle: 'Are you sure you want to remove this entry?',
          itemTitle: 'Entry 2',
          buttonConfirm: { text: 'Remove' },
          buttonCancel: { text: 'Cancel' },
          backLink: { text: 'Back', href: href(ENTRIES_PATH) }
        })
      )
    })

    test('Should not find an entry that is not in the report', async () => {
      await expect(
        page.makeGetRouteHandler()(
          buildRequest({ itemId: UNKNOWN_ENTRY_ID }),
          buildContext(buildState([buildEntry()])),
          buildToolkit()
        )
      ).rejects.toThrow('Entry to remove not found')
    })
  })

  describe('POST', () => {
    const post = (payload, itemId) => buildRequest({ itemId, payload })

    test('Should start another entry', async () => {
      const h = buildToolkit()

      const response = await page.makePostRouteHandler()(
        post({ action: 'add-another' }),
        buildContext(buildState([buildEntry()])),
        h
      )

      expect(h.redirect.mock.calls[0][0]).toMatch(NEW_ENTRY)
      expect(response.statusCode).toBe(statusCodes.seeOther)
    })

    test('Should refuse another entry beyond the limit', async () => {
      const entries = Array.from({ length: MAX_ENTRIES }, (_, index) =>
        buildEntry({ itemId: `entry-${index}` })
      )
      const h = buildToolkit()

      const { name, context } = await page.makePostRouteHandler()(
        post({ action: 'add-another' }),
        buildContext(buildState(entries)),
        h
      )

      expect(h.redirect).not.toHaveBeenCalled()
      expect(name).toBe('report-entries')
      expect(context.errors).toEqual([
        expect.objectContaining({
          text: `You can only add up to ${MAX_ENTRIES} entries to the report`
        })
      ])
    })

    test('Should continue to check your answers with complete entries', async () => {
      const h = buildToolkit()

      const response = await page.makePostRouteHandler()(
        post({ action: 'continue' }),
        buildContext(buildState([buildEntry(), buildOtherSpeciesEntry()])),
        h
      )

      expect(h.redirect).toHaveBeenCalledWith(href('/summary'))
      expect(response.statusCode).toBe(statusCodes.seeOther)
    })

    test('Should return to check your answers when changing from there', async () => {
      const h = buildToolkit()

      await page.makePostRouteHandler()(
        buildRequest({
          payload: { action: 'continue' },
          query: { returnUrl: href('/summary') }
        }),
        buildContext(buildState([buildEntry()])),
        h
      )

      expect(h.redirect).toHaveBeenCalledWith(href('/summary'))
    })

    test('Should not continue without an entry', async () => {
      const { name, context } = await page.makePostRouteHandler()(
        post({ action: 'continue' }),
        buildContext(buildState([])),
        buildToolkit()
      )

      expect(name).toBe('report-entries')
      expect(context.errors).toEqual([
        expect.objectContaining({ text: 'Add at least 1 entry to the report' })
      ])
    })

    test('Should not continue with an incomplete entry, and link to what it needs', async () => {
      const incomplete = buildOtherSpeciesEntry({ country: undefined })

      const { context } = await page.makePostRouteHandler()(
        post({ action: 'continue' }),
        buildContext(buildState([buildEntry(), incomplete])),
        buildToolkit()
      )

      expect(context.errors).toEqual([
        expect.objectContaining({
          text: 'Complete entry 2 or remove it',
          href: `${href(ENTRY_PATHS.country)}/${SECOND_ENTRY_ID}?returnUrl=${encodeURIComponent(href(ENTRIES_PATH))}`
        })
      ])
    })

    test('Should remove an entry once confirmed', async () => {
      const first = buildEntry()
      const second = buildOtherSpeciesEntry()
      const state = buildState([first, second])
      const mergeState = vi.spyOn(page, 'mergeState').mockResolvedValue(state)
      const h = buildToolkit()

      const response = await page.makePostRouteHandler()(
        buildRequest({
          itemId: FIRST_ENTRY_ID,
          payload: { action: 'delete', confirm: true }
        }),
        buildContext(state),
        h
      )

      expect(mergeState).toHaveBeenCalledWith(expect.anything(), state, {
        [ENTRIES_KEY]: [second]
      })
      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
      expect(response.statusCode).toBe(statusCodes.seeOther)
    })

    test('Should keep the entry when removal is cancelled', async () => {
      const state = buildState([buildEntry()])
      const mergeState = vi.spyOn(page, 'mergeState')
      const h = buildToolkit()

      await page.makePostRouteHandler()(
        buildRequest({ itemId: FIRST_ENTRY_ID, payload: { action: 'delete' } }),
        buildContext(state),
        h
      )

      expect(mergeState).not.toHaveBeenCalled()
      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
    })

    test('Should not remove an entry that is not in the report', async () => {
      await expect(
        page.makePostRouteHandler()(
          buildRequest({
            itemId: UNKNOWN_ENTRY_ID,
            payload: { action: 'delete', confirm: true }
          }),
          buildContext(buildState([buildEntry()])),
          buildToolkit()
        )
      ).rejects.toThrow('Entry to remove not found')
    })
  })

  describe('#getBackLink', () => {
    test('Should go back to check your answers when changing from there', () => {
      expect(
        page.getBackLink(
          buildRequest({ query: { returnUrl: href('/summary') } }),
          buildContext(buildState([])),
          t
        )
      ).toEqual({ text: 'Go back to check answers', href: href('/summary') })
    })

    test('Should otherwise go back to the page before the entries', () => {
      expect(
        page.getBackLink(buildRequest(), buildContext(buildState([])), t)
      ).toEqual({ text: 'Back', href: href(REPORT_DATE_PATH) })
    })

    test('Should offer no back link when there is nowhere to go', () => {
      expect(
        page.getBackLink(buildRequest(), { paths: [], state: {} }, t)
      ).toBeUndefined()
    })
  })
})
