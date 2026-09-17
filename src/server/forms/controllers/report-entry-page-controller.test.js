import { ENTRIES_KEY } from '#/server/forms/controllers/report-entries.js'
import { ReportEntryPageController } from '#/server/forms/controllers/report-entry-page-controller.js'
import { QuestionPageController } from '@defra/forms-engine-plugin/controllers/QuestionPageController.js'

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
const translator = model.createTranslator()
const { t } = translator

const pathogen = pageOf(model, ENTRY_PATHS.pathogen)
const species = pageOf(model, ENTRY_PATHS.species)
const otherSpecies = pageOf(model, ENTRY_PATHS.otherSpecies)
const country = pageOf(model, ENTRY_PATHS.country)
const numbers = pageOf(model, ENTRY_PATHS.numbers)

const href = (path) => `/${WEB_FORM_SLUG}${path}`
const entryHref = (page, itemId) => href(`${page.path}/${itemId}`)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/

// The context the engine builds for a request, as far as these pages read it:
// the state, and the paths its own walk reached (the report date, then the
// first entry page, then the report entries page)
function buildContext(state, { reportDateAnswered = true } = {}) {
  return {
    state,
    paths: reportDateAnswered
      ? [REPORT_DATE_PATH, ENTRY_PATHS.pathogen, ENTRIES_PATH]
      : [REPORT_DATE_PATH],
    evaluationState: {}
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReportEntryPageController', () => {
  test('Should serve every entry page of the form', () => {
    for (const page of [pathogen, species, otherSpecies, country, numbers]) {
      expect(page).toBeInstanceOf(ReportEntryPageController)
    }
  })

  describe('schemas and keys', () => {
    test("Should keep the page's field schema for validating an entry", () => {
      // Validated with the other answers of the entry stripped, as
      // isEntryPageComplete does
      const options = { stripUnknown: true }

      expect(
        numbers.entryStateSchema.validate(buildEntry(), options).error
      ).toBeUndefined()
      expect(numbers.entryStateSchema.validate({}, options).error).toBeDefined()
    })

    test('Should accept any top-level state, where the answers never are', () => {
      expect(numbers.collection.stateSchema.validate({}).error).toBeUndefined()
      expect(
        numbers.collection.stateSchema.validate({ anything: 1 }).error
      ).toBeUndefined()
    })

    test('Should require the entry id in the form payload', () => {
      const { error } = pathogen.collection.formSchema.validate({
        pathogen: 'Tritrichomonas foetus'
      })

      expect(error?.details.map((detail) => detail.path)).toEqual([['itemId']])
      expect(
        pathogen.collection.formSchema.validate({
          pathogen: 'Tritrichomonas foetus',
          itemId: FIRST_ENTRY_ID
        }).error
      ).toBeUndefined()
    })

    test('Should tell the engine the entries are its state', () => {
      expect(pathogen.keys).toEqual([ENTRIES_KEY])
    })

    test('Should know which page starts an entry and where the entries are listed', () => {
      expect(pathogen.isFirstEntryPage).toBe(true)
      expect(species.isFirstEntryPage).toBe(false)
      expect(species.entriesPagePath).toBe(ENTRIES_PATH)
    })
  })

  describe('#getFormParams', () => {
    test('Should apply the entry id in the URL to a form post', () => {
      const params = pathogen.getFormParams(
        buildRequest({ itemId: FIRST_ENTRY_ID, payload: { pathogen: 'P' } })
      )

      expect(params.itemId).toBe(FIRST_ENTRY_ID)
    })

    test('Should not invent an entry id for a form post without one', () => {
      const params = pathogen.getFormParams(
        buildRequest({ payload: { pathogen: 'P' } })
      )

      expect(params.itemId).toBeUndefined()
    })

    test('Should apply nothing to a request without a payload', () => {
      expect(pathogen.getFormParams(buildRequest()).itemId).toBeUndefined()
    })
  })

  describe('#getFormDataFromState', () => {
    test("Should read the page's answers from the entry in the URL", () => {
      const state = buildState([buildEntry(), buildOtherSpeciesEntry()])

      expect(
        species.getFormDataFromState(
          buildRequest({ itemId: SECOND_ENTRY_ID }),
          state
        )
      ).toEqual({ species: 'Other' })
      expect(
        numbers.getFormDataFromState(
          buildRequest({ itemId: FIRST_ENTRY_ID }),
          state
        )
      ).toEqual({
        submissionsWithQualifyingTest: 12,
        submissionsWithPositiveSamples: 3,
        positiveSamples: 5
      })
    })

    test('Should read nothing for an entry not yet started', () => {
      expect(
        species.getFormDataFromState(
          buildRequest({ itemId: UNKNOWN_ENTRY_ID }),
          buildState([buildEntry()])
        )
      ).toEqual({ species: undefined })
    })
  })

  describe('#getStateFromValidForm', () => {
    test('Should add a new entry to the list', () => {
      const existing = buildEntry()
      const request = buildRequest({
        itemId: SECOND_ENTRY_ID,
        payload: { pathogen: 'Bovine Herpes Virus 1 (BHV-1)' }
      })

      expect(
        pathogen.getStateFromValidForm(request, buildState([existing]), {
          pathogen: 'Bovine Herpes Virus 1 (BHV-1)',
          itemId: SECOND_ENTRY_ID,
          crumb: 'x'
        })
      ).toEqual({
        [ENTRIES_KEY]: [
          existing,
          { itemId: SECOND_ENTRY_ID, pathogen: 'Bovine Herpes Virus 1 (BHV-1)' }
        ]
      })
    })

    test("Should update an entry's answers in place, leaving the other entries alone", () => {
      const first = buildEntry()
      const second = buildOtherSpeciesEntry()
      const request = buildRequest({
        itemId: FIRST_ENTRY_ID,
        payload: { positiveSamples: 6 }
      })

      expect(
        numbers.getStateFromValidForm(request, buildState([first, second]), {
          submissionsWithQualifyingTest: 12,
          submissionsWithPositiveSamples: 3,
          positiveSamples: 6
        })
      ).toEqual({
        [ENTRIES_KEY]: [buildEntry({ positiveSamples: 6, added: true }), second]
      })
    })

    test('Should mark an entry as added once it is complete', () => {
      const request = buildRequest({
        itemId: FIRST_ENTRY_ID,
        payload: { positiveSamples: 5 }
      })
      const started = buildEntry({
        submissionsWithQualifyingTest: undefined,
        submissionsWithPositiveSamples: undefined,
        positiveSamples: undefined
      })

      const [entry] = numbers.getStateFromValidForm(
        request,
        buildState([started]),
        {
          submissionsWithQualifyingTest: 12,
          submissionsWithPositiveSamples: 3,
          positiveSamples: 5
        }
      )[ENTRIES_KEY]

      expect(entry.added).toBe(true)
    })

    test('Should keep an entry added once its later answers are dropped by a change', () => {
      const request = buildRequest({
        itemId: FIRST_ENTRY_ID,
        payload: { pathogen: 'Bovine Herpes Virus 1 (BHV-1)' }
      })

      const [entry] = pathogen.getStateFromValidForm(
        request,
        buildState([buildEntry({ added: true })]),
        { pathogen: 'Bovine Herpes Virus 1 (BHV-1)' }
      )[ENTRIES_KEY]

      expect(entry).toEqual({
        itemId: FIRST_ENTRY_ID,
        added: true,
        pathogen: 'Bovine Herpes Virus 1 (BHV-1)'
      })
    })

    test('Should drop the other species once the species is on the list', () => {
      const entry = buildOtherSpeciesEntry({
        country: undefined,
        submissionsWithQualifyingTest: undefined,
        submissionsWithPositiveSamples: undefined,
        positiveSamples: undefined
      })
      const request = buildRequest({
        itemId: SECOND_ENTRY_ID,
        payload: { species: 'Domestic cattle' }
      })

      expect(
        species.getStateFromValidForm(request, buildState([entry]), {
          species: 'Domestic cattle'
        })
      ).toEqual({
        [ENTRIES_KEY]: [
          {
            itemId: SECOND_ENTRY_ID,
            pathogen: 'Tritrichomonas foetus',
            species: 'Domestic cattle'
          }
        ]
      })
    })

    test('Should ask the questions that followed again once an answer is changed', () => {
      const request = buildRequest({
        itemId: FIRST_ENTRY_ID,
        payload: { pathogen: 'Bovine Herpes Virus 1 (BHV-1)' }
      })

      expect(
        pathogen.getStateFromValidForm(request, buildState([buildEntry()]), {
          pathogen: 'Bovine Herpes Virus 1 (BHV-1)'
        })
      ).toEqual({
        [ENTRIES_KEY]: [
          { itemId: FIRST_ENTRY_ID, pathogen: 'Bovine Herpes Virus 1 (BHV-1)' }
        ]
      })
      expect(request.app.reportEntryAnswersChanged).toBe(true)
    })

    test('Should keep the answers that followed when an answer is given again unchanged', () => {
      const entry = buildOtherSpeciesEntry()
      const request = buildRequest({
        itemId: SECOND_ENTRY_ID,
        payload: { species: 'Other' }
      })

      expect(
        species.getStateFromValidForm(request, buildState([entry]), {
          species: 'Other'
        })
      ).toEqual({ [ENTRIES_KEY]: [{ ...entry, added: true }] })
      expect(request.app.reportEntryAnswersChanged).toBe(false)
    })

    test('Should refuse a post that names no entry', () => {
      expect(() =>
        pathogen.getStateFromValidForm(
          buildRequest({ payload: { pathogen: 'P' } }),
          buildState([]),
          { pathogen: 'P' }
        )
      ).toThrow('No entry id found')
    })
  })

  describe('#getNextPath', () => {
    test("Should step the engine's walk over the entry pages to the entries page", () => {
      for (const page of [pathogen, species, otherSpecies, country, numbers]) {
        expect(page.getNextPath(buildContext(buildState([])))).toBe(
          ENTRIES_PATH
        )
      }
    })

    test('Should fall back to the summary in a form with no entries page', () => {
      const page = Object.create(ReportEntryPageController.prototype)

      page.model = { pages: [] }

      expect(page.getNextPath()).toBe('/summary')
    })
  })

  describe('#getRelevantPath', () => {
    test('Should leave the engine to send the user back until the report date is answered', () => {
      const context = buildContext(buildState([]), {
        reportDateAnswered: false
      })

      expect(
        species.getRelevantPath(
          buildRequest({ itemId: FIRST_ENTRY_ID }),
          context
        )
      ).toBe(REPORT_DATE_PATH)
    })

    test('Should let the first page start an entry without an id', () => {
      expect(
        pathogen.getRelevantPath(buildRequest(), buildContext(buildState([])))
      ).toBe(ENTRY_PATHS.pathogen)
    })

    test('Should send any other page without an id to the entries page', () => {
      expect(
        country.getRelevantPath(buildRequest(), buildContext(buildState([])))
      ).toBe(ENTRIES_PATH)
    })

    test('Should let the user on to a page once the pages before it are answered', () => {
      const entry = buildEntry({
        country: undefined,
        positiveSamples: undefined
      })
      const context = buildContext(buildState([entry]))
      const request = buildRequest({ itemId: FIRST_ENTRY_ID })

      expect(pathogen.getRelevantPath(request, context)).toBe(
        `${ENTRY_PATHS.pathogen}/${FIRST_ENTRY_ID}`
      )
      expect(country.getRelevantPath(request, context)).toBe(
        `${ENTRY_PATHS.country}/${FIRST_ENTRY_ID}`
      )
    })

    test("Should send the user back to the entry's first unanswered page", () => {
      const entry = buildEntry({ species: undefined })
      const request = buildRequest({ itemId: FIRST_ENTRY_ID })

      expect(
        numbers.getRelevantPath(request, buildContext(buildState([entry])))
      ).toBe(`${ENTRY_PATHS.species}/${FIRST_ENTRY_ID}`)
    })

    test('Should start a new entry at its first page whichever page is asked for', () => {
      const request = buildRequest({ itemId: UNKNOWN_ENTRY_ID })

      expect(
        country.getRelevantPath(request, buildContext(buildState([])))
      ).toBe(`${ENTRY_PATHS.pathogen}/${UNKNOWN_ENTRY_ID}`)
    })

    test('Should not show a page the entry does not need', () => {
      const request = buildRequest({ itemId: FIRST_ENTRY_ID })

      // A complete entry for a species on the list: on to the entries page
      expect(
        otherSpecies.getRelevantPath(
          request,
          buildContext(buildState([buildEntry()]))
        )
      ).toBe(ENTRIES_PATH)

      // An incomplete one: to what it still needs
      expect(
        otherSpecies.getRelevantPath(
          request,
          buildContext(buildState([buildEntry({ country: undefined })]))
        )
      ).toBe(`${ENTRY_PATHS.country}/${FIRST_ENTRY_ID}`)
    })
  })

  describe('#makeGetRouteHandler', () => {
    function stubEngineHandler() {
      const engineHandler = vi.fn().mockReturnValue('rendered')

      vi.spyOn(
        QuestionPageController.prototype,
        'makeGetRouteHandler'
      ).mockReturnValue(engineHandler)

      return engineHandler
    }

    test('Should render the page for the entry in the URL', () => {
      const engineHandler = stubEngineHandler()
      const request = buildRequest({ itemId: FIRST_ENTRY_ID })
      const context = buildContext(buildState([buildEntry()]))
      const h = buildToolkit()

      const response = pathogen.makeGetRouteHandler()(request, context, h)

      expect(response).toBe('rendered')
      expect(engineHandler).toHaveBeenCalledWith(request, context, h)
    })

    test('Should start the first entry with a new id, keeping the return URL', () => {
      stubEngineHandler()
      const h = buildToolkit()
      const request = buildRequest({ query: { returnUrl: '/back' } })

      const response = pathogen.makeGetRouteHandler()(
        request,
        buildContext(buildState([])),
        h
      )

      const [location] = h.redirect.mock.calls[0]
      const [, itemId, query] = new RegExp(
        `^${href(ENTRY_PATHS.pathogen)}/(${UUID.source.slice(1, -1)})(\\?.*)$`
      ).exec(location)

      expect(itemId).toMatch(UUID)
      expect(query).toBe('?returnUrl=%2Fback')
      expect(response.statusCode).toBe(statusCodes.redirect)
    })

    test('Should send the first page to the entries page once there are entries', () => {
      stubEngineHandler()
      const h = buildToolkit()

      pathogen.makeGetRouteHandler()(
        buildRequest(),
        buildContext(buildState([buildEntry()])),
        h
      )

      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
    })

    test('Should send any other page without an id to the entries page', () => {
      stubEngineHandler()
      const h = buildToolkit()

      species.makeGetRouteHandler()(
        buildRequest(),
        buildContext(buildState([])),
        h
      )

      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
    })
  })

  describe('#makePostRouteHandler', () => {
    function stubEngineHandler() {
      const engineHandler = vi.fn().mockReturnValue('handled')

      vi.spyOn(
        QuestionPageController.prototype,
        'makePostRouteHandler'
      ).mockReturnValue(engineHandler)

      return engineHandler
    }

    test("Should evaluate conditions against the entry's answers", () => {
      stubEngineHandler()
      const context = buildContext(buildState([buildEntry()]))

      species.makePostRouteHandler()(
        buildRequest({ itemId: FIRST_ENTRY_ID, payload: { species: 'Bison' } }),
        context,
        buildToolkit()
      )

      expect(context.evaluationState).toEqual(
        expect.objectContaining({
          pathogen: 'Tritrichomonas foetus',
          species: 'Domestic cattle'
        })
      )
      expect(context.errors).toBeUndefined()
    })

    test('Should refuse a species that is not reported for the pathogen', () => {
      const engineHandler = stubEngineHandler()
      // The engine has already merged the posted answer into the state
      const context = buildContext(
        buildState([buildEntry({ species: 'Chicken' })])
      )
      const request = buildRequest({
        itemId: FIRST_ENTRY_ID,
        payload: { species: 'Chicken' }
      })
      const h = buildToolkit()

      const response = species.makePostRouteHandler()(request, context, h)

      expect(context.errors).toEqual([
        {
          path: ['species'],
          href: '#species',
          name: 'species',
          text: 'Select one of the options shown for species the report is for'
        }
      ])
      expect(engineHandler).toHaveBeenCalledWith(request, context, h)
      expect(response).toBe('handled')
    })

    test('Should keep the errors the engine found', () => {
      stubEngineHandler()
      const context = {
        ...buildContext(buildState([buildEntry({ species: 'Chicken' })])),
        errors: [{ name: 'other', text: 'Other error' }]
      }

      species.makePostRouteHandler()(
        buildRequest({ itemId: FIRST_ENTRY_ID, payload: {} }),
        context,
        buildToolkit()
      )

      expect(context.errors.map((error) => error.name)).toEqual([
        'other',
        'species'
      ])
    })
  })

  describe('#makeGetRouteHandler evaluation', () => {
    test("Should evaluate conditions against the entry's answers when rendering", () => {
      vi.spyOn(
        QuestionPageController.prototype,
        'makeGetRouteHandler'
      ).mockReturnValue(vi.fn())
      const context = buildContext(buildState([buildEntry()]))

      species.makeGetRouteHandler()(
        buildRequest({ itemId: FIRST_ENTRY_ID }),
        context,
        buildToolkit()
      )

      expect(context.evaluationState.pathogen).toBe('Tritrichomonas foetus')
    })
  })

  describe('#proceed', () => {
    function stubSavedState(page, state) {
      vi.spyOn(page, 'getState').mockResolvedValue(state)
    }

    // The engine posts every question with the "validate" action
    const postRequest = (itemId, query) =>
      buildRequest({ itemId, query, payload: { action: 'validate' } })

    test('Should go on to the next page the entry needs', async () => {
      stubSavedState(species, buildState([buildEntry()]))
      const h = buildToolkit()

      const response = await species.proceed(postRequest(FIRST_ENTRY_ID), h)

      expect(h.redirect).toHaveBeenCalledWith(
        entryHref(country, FIRST_ENTRY_ID)
      )
      expect(response.statusCode).toBe(statusCodes.seeOther)
    })

    test('Should ask for the other species after choosing Other', async () => {
      stubSavedState(species, buildState([buildOtherSpeciesEntry()]))
      const h = buildToolkit()

      await species.proceed(postRequest(SECOND_ENTRY_ID), h)

      expect(h.redirect).toHaveBeenCalledWith(
        entryHref(otherSpecies, SECOND_ENTRY_ID)
      )
    })

    test('Should go to the entries page after the last page', async () => {
      stubSavedState(numbers, buildState([buildEntry()]))
      const h = buildToolkit()

      await numbers.proceed(postRequest(FIRST_ENTRY_ID), h)

      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
    })

    test('Should return a complete entry to where the change came from', async () => {
      stubSavedState(country, buildState([buildEntry()]))
      const h = buildToolkit()

      await country.proceed(
        postRequest(FIRST_ENTRY_ID, { returnUrl: href('/summary') }),
        h
      )

      expect(h.redirect).toHaveBeenCalledWith(href('/summary'))
    })

    test('Should finish an entry before returning to where the change came from', async () => {
      stubSavedState(
        species,
        buildState([buildOtherSpeciesEntry({ otherSpecies: undefined })])
      )
      const h = buildToolkit()

      await species.proceed(
        postRequest(SECOND_ENTRY_ID, { returnUrl: href(ENTRIES_PATH) }),
        h
      )

      expect(h.redirect).toHaveBeenCalledWith(
        `${entryHref(otherSpecies, SECOND_ENTRY_ID)}?returnUrl=${encodeURIComponent(href(ENTRIES_PATH))}`
      )
    })

    test('Should still return to another page once a changed entry is complete', async () => {
      stubSavedState(numbers, buildState([buildEntry()]))
      const h = buildToolkit()
      const request = postRequest(FIRST_ENTRY_ID, {
        returnUrl: href('/summary')
      })

      request.app.reportEntryAnswersChanged = true

      await numbers.proceed(request, h)

      expect(h.redirect).toHaveBeenCalledWith(href('/summary'))
    })

    test('Should return to a later page of the entry when nothing was changed', async () => {
      // Even when that page has not been answered yet
      stubSavedState(
        species,
        buildState([buildEntry({ positiveSamples: undefined })])
      )
      const h = buildToolkit()
      const returnUrl = entryHref(numbers, FIRST_ENTRY_ID)
      const request = postRequest(FIRST_ENTRY_ID, { returnUrl })

      request.app.reportEntryAnswersChanged = false

      await species.proceed(request, h)

      expect(h.redirect).toHaveBeenCalledWith(returnUrl)
    })

    test('Should walk the entry forward again instead of returning to a later page once changed', async () => {
      // The later page's answers were dropped with the change
      stubSavedState(
        species,
        buildState([
          buildEntry({
            country: undefined,
            submissionsWithQualifyingTest: undefined,
            submissionsWithPositiveSamples: undefined,
            positiveSamples: undefined
          })
        ])
      )
      const h = buildToolkit()
      const request = postRequest(FIRST_ENTRY_ID, {
        returnUrl: entryHref(numbers, FIRST_ENTRY_ID)
      })

      request.app.reportEntryAnswersChanged = true

      await species.proceed(request, h)

      expect(h.redirect).toHaveBeenCalledWith(
        entryHref(country, FIRST_ENTRY_ID)
      )
    })
  })

  describe('#getViewModel', () => {
    const banner = { type: 'NotificationBanner', model: { content: 'Careful' } }
    const question = { type: 'SelectField', model: { name: 'pathogen' } }

    beforeEach(() => {
      vi.spyOn(
        QuestionPageController.prototype,
        'getViewModel'
      ).mockReturnValue({
        sectionTitle: 'Entry',
        pageTitle: 'Which species was tested?',
        components: [banner, question]
      })
    })

    test('Should caption an entry being added with its position, in place of the section title', () => {
      const state = buildState([buildEntry()])

      expect(
        pathogen.getViewModel(
          buildRequest({ itemId: UNKNOWN_ENTRY_ID }),
          buildContext(state),
          translator
        )
      ).toEqual(
        expect.objectContaining({
          sectionTitle: null,
          entryCaption: 'Adding entry 2',
          pageTitle: 'Which species was tested?'
        })
      )
    })

    test('Should caption an entry added before as being edited, out of how many', () => {
      const state = buildState([
        buildEntry({ added: true }),
        buildOtherSpeciesEntry({ added: true })
      ])

      expect(
        species.getViewModel(
          buildRequest({ itemId: SECOND_ENTRY_ID }),
          buildContext(state),
          translator
        ).entryCaption
      ).toBe('Editing entry 2/2')
    })

    test('Should lift notification banners out of the questions', () => {
      const viewModel = species.getViewModel(
        buildRequest({ itemId: FIRST_ENTRY_ID }),
        buildContext(buildState([buildEntry()])),
        translator
      )

      expect(viewModel.banners).toEqual([banner])
      expect(viewModel.components).toEqual([question])
    })

    test('Should offer to abort an entry being added, but not one added before', () => {
      const adding = species.getViewModel(
        buildRequest({ itemId: FIRST_ENTRY_ID }),
        buildContext(buildState([buildEntry()])),
        translator
      )
      const editing = species.getViewModel(
        buildRequest({ itemId: FIRST_ENTRY_ID }),
        buildContext(buildState([buildEntry({ added: true })])),
        translator
      )

      expect(adding).toEqual(
        expect.objectContaining({
          abortText: 'Abort new entry',
          canAbort: true,
          saveAndExitText: 'Save and exit'
        })
      )
      expect(editing.canAbort).toBe(false)
    })

    test('Should list the answers given so far, with a change link back to this page', () => {
      const state = buildState([buildEntry()])

      const { answersSoFar } = country.getViewModel(
        buildRequest({ itemId: FIRST_ENTRY_ID }),
        buildContext(state),
        translator
      )

      expect(answersSoFar.rows.map((row) => row.key.text)).toEqual([
        'Report Date',
        'Selected pathogen',
        'Species the report is for'
      ])
      expect(answersSoFar.rows[2].actions.items[0].href).toBe(
        `${entryHref(species, FIRST_ENTRY_ID)}?returnUrl=${encodeURIComponent(entryHref(country, FIRST_ENTRY_ID))}`
      )
    })

    test('Should render the entry page view, which shows the answers so far', () => {
      expect(country.viewName).toBe('report-entry')
    })
  })

  describe('aborting a new entry', () => {
    const abortRequest = (itemId) =>
      buildRequest({ itemId, payload: { action: 'delete' } })

    function stubClearState(request) {
      const clearState = vi.fn().mockResolvedValue(undefined)

      request.server.plugins['forms-engine-plugin'].cacheService = {
        clearState
      }

      return clearState
    }

    test('Should handle the abort before the engine saves anything', async () => {
      const engineHandler = vi.fn()

      vi.spyOn(
        QuestionPageController.prototype,
        'makePostRouteHandler'
      ).mockReturnValue(engineHandler)
      vi.spyOn(species, 'mergeState').mockResolvedValue({})
      const h = buildToolkit()

      await species.makePostRouteHandler()(
        abortRequest(SECOND_ENTRY_ID),
        buildContext(
          buildState([buildEntry(), { itemId: SECOND_ENTRY_ID, pathogen: 'P' }])
        ),
        h
      )

      expect(engineHandler).not.toHaveBeenCalled()
      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
    })

    test('Should drop the entry and go to the list of the others', async () => {
      const first = buildEntry({ added: true })
      const started = { itemId: SECOND_ENTRY_ID, pathogen: 'P' }
      const state = buildState([first, started])
      const mergeState = vi
        .spyOn(species, 'mergeState')
        .mockResolvedValue(state)
      const h = buildToolkit()

      const response = await species.abortEntry(
        abortRequest(SECOND_ENTRY_ID),
        buildContext(state),
        h
      )

      expect(mergeState).toHaveBeenCalledWith(expect.anything(), state, {
        [ENTRIES_KEY]: [first]
      })
      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
      expect(response.statusCode).toBe(statusCodes.seeOther)
    })

    test('Should abandon the whole report and go to Submission Welcome when no entry is left', async () => {
      const request = abortRequest(FIRST_ENTRY_ID)
      const clearState = stubClearState(request)
      const mergeState = vi.spyOn(species, 'mergeState')
      const h = buildToolkit()

      await species.abortEntry(
        request,
        buildContext(buildState([{ itemId: FIRST_ENTRY_ID, pathogen: 'P' }])),
        h
      )

      expect(clearState).toHaveBeenCalledWith(request)
      expect(mergeState).not.toHaveBeenCalled()
      expect(h.redirect).toHaveBeenCalledWith('/submission-welcome')
    })

    test('Should abandon the report when the entry was never saved and there is no other', async () => {
      const request = abortRequest(UNKNOWN_ENTRY_ID)
      const clearState = stubClearState(request)
      const h = buildToolkit()

      await pathogen.abortEntry(request, buildContext(buildState([])), h)

      expect(clearState).toHaveBeenCalledWith(request)
      expect(h.redirect).toHaveBeenCalledWith('/submission-welcome')
    })

    test('Should change nothing for an entry that was never saved when there are others', async () => {
      const mergeState = vi.spyOn(pathogen, 'mergeState')
      const h = buildToolkit()

      await pathogen.abortEntry(
        abortRequest(UNKNOWN_ENTRY_ID),
        buildContext(buildState([buildEntry({ added: true })])),
        h
      )

      expect(mergeState).not.toHaveBeenCalled()
      expect(h.redirect).toHaveBeenCalledWith(href(ENTRIES_PATH))
    })

    test('Should send an entry added before to be removed with confirmation instead', async () => {
      const mergeState = vi.spyOn(species, 'mergeState')
      const h = buildToolkit()

      await species.abortEntry(
        abortRequest(FIRST_ENTRY_ID),
        buildContext(buildState([buildEntry({ added: true })])),
        h
      )

      expect(mergeState).not.toHaveBeenCalled()
      expect(h.redirect).toHaveBeenCalledWith(
        href(`${ENTRIES_PATH}/${FIRST_ENTRY_ID}`)
      )
    })

    test('Should fall back to the summary for an added entry in a form with no entries page', async () => {
      const page = Object.create(ReportEntryPageController.prototype)
      const h = buildToolkit()

      page.model = { pages: [], basePath: 'x' }
      page.pageDef = { path: '/q' }

      await page.abortEntry(
        abortRequest(FIRST_ENTRY_ID),
        { state: buildState([buildEntry({ added: true })]) },
        h
      )

      expect(h.redirect).toHaveBeenCalledWith('/x/summary')
    })
  })

  describe('#handleSaveAndExit', () => {
    test('Should leave for Submission Welcome', () => {
      const h = buildToolkit()

      const response = species.handleSaveAndExit(
        buildRequest({
          itemId: FIRST_ENTRY_ID,
          payload: { action: 'save-and-exit' }
        }),
        buildContext(buildState([buildEntry()])),
        h
      )

      expect(h.redirect).toHaveBeenCalledWith('/submission-welcome')
      expect(response.statusCode).toBe(statusCodes.seeOther)
    })
  })

  describe('#getBackLink', () => {
    test('Should go back to check your answers when changing from there', () => {
      expect(
        species.getBackLink(
          buildRequest({
            itemId: FIRST_ENTRY_ID,
            query: { returnUrl: href('/summary') }
          }),
          buildContext(buildState([buildEntry()])),
          t
        )
      ).toEqual({ text: 'Go back to check answers', href: href('/summary') })
    })

    test('Should go back to wherever else the change came from', () => {
      expect(
        species.getBackLink(
          buildRequest({
            itemId: FIRST_ENTRY_ID,
            query: { returnUrl: href(ENTRIES_PATH) }
          }),
          buildContext(buildState([buildEntry()])),
          t
        )
      ).toEqual({ text: 'Back', href: href(ENTRIES_PATH) })
    })

    test('Should go back to the previous page the entry needed', () => {
      const request = buildRequest({ itemId: SECOND_ENTRY_ID })
      const context = buildContext(buildState([buildOtherSpeciesEntry()]))

      expect(country.getBackLink(request, context, t)).toEqual({
        text: 'Back',
        href: entryHref(otherSpecies, SECOND_ENTRY_ID)
      })
      expect(otherSpecies.getBackLink(request, context, t)).toEqual({
        text: 'Back',
        href: entryHref(species, SECOND_ENTRY_ID)
      })
    })

    test('Should skip the other species page for a species on the list', () => {
      expect(
        country.getBackLink(
          buildRequest({ itemId: FIRST_ENTRY_ID }),
          buildContext(buildState([buildEntry()])),
          t
        )
      ).toEqual({ text: 'Back', href: entryHref(species, FIRST_ENTRY_ID) })
    })

    test('Should go back from the first page of the first entry to the report date', () => {
      expect(
        pathogen.getBackLink(
          buildRequest({ itemId: FIRST_ENTRY_ID }),
          buildContext(buildState([])),
          t
        )
      ).toEqual({ text: 'Back', href: href(REPORT_DATE_PATH) })
    })

    test('Should go back from the first page of a later entry to the entries page', () => {
      expect(
        pathogen.getBackLink(
          buildRequest({ itemId: SECOND_ENTRY_ID }),
          buildContext(buildState([buildEntry()])),
          t
        )
      ).toEqual({ text: 'Back', href: href(ENTRIES_PATH) })
    })

    test('Should offer no back link when there is nowhere to go', () => {
      const context = { ...buildContext(buildState([])), paths: [] }

      expect(
        pathogen.getBackLink(
          buildRequest({ itemId: FIRST_ENTRY_ID }),
          context,
          t
        )
      ).toBeUndefined()
    })
  })
})
