import {
  ADD_ANOTHER_ENTRY_TEXT,
  ENTRIES_KEY,
  MAX_ENTRIES,
  MIN_ENTRIES,
  answerData,
  answerHtml,
  answersSoFar,
  clearAnswersAfter,
  disallowedListAnswers,
  entriesCountText,
  entriesErrors,
  entriesOf,
  entriesPageOf,
  entryCaption,
  entryCard,
  entryDetailItems,
  entryEvaluationState,
  entryName,
  entryPageAnswersChanged,
  entryPageHref,
  entryPagePath,
  entryPagesOf,
  entryTitleOf,
  findEntry,
  firstIncompleteEntryPage,
  incompleteEntryErrors,
  isAddedEntry,
  isEntryComplete,
  isEntryPageComplete,
  isReportWithEntries,
  newEntryId,
  offeredListItems,
  pagesBeforeEntries,
  pruneEntry,
  relevantEntryPages,
  removeEntry,
  tooFewEntriesError,
  tooManyEntriesError,
  upsertEntry
} from '#/server/forms/controllers/report-entries.js'
import {
  ENTRIES_PATH,
  ENTRY_PATHS,
  FIRST_ENTRY_ID,
  REPORT_DATE_PATH,
  SECOND_ENTRY_ID,
  WEB_FORM_SLUG,
  buildEntry,
  buildOtherSpeciesEntry,
  buildState,
  buildWebFormModel,
  pageOf
} from '#/test-helpers/web-form-model.js'

const model = buildWebFormModel()
const translator = model.createTranslator()

const ENTRY_PAGE_PATHS = Object.values(ENTRY_PATHS)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('report entries', () => {
  describe('the pages of the form', () => {
    test('Should find the pages answered once per entry, in journey order', () => {
      expect(entryPagesOf(model).map((page) => page.path)).toEqual(
        ENTRY_PAGE_PATHS
      )
    })

    test('Should find the page that lists the entries', () => {
      expect(entriesPageOf(model).path).toBe(ENTRIES_PATH)
    })

    test('Should find nothing in a form without entries', () => {
      expect(entryPagesOf({ pages: [{ pageDef: {} }] })).toEqual([])
      expect(entriesPageOf({ pages: [] })).toBeUndefined()
      expect(entryPagesOf(undefined)).toEqual([])
      expect(entriesPageOf(undefined)).toBeUndefined()
      expect(pagesBeforeEntries(undefined)).toEqual([])
      expect(pagesBeforeEntries({ pages: [{ pageDef: {} }] })).toEqual([])
    })

    test('Should know a report with entries from its definition alone', () => {
      expect(isReportWithEntries(model)).toBe(true)
      expect(isReportWithEntries({ def: { pages: [{ path: '/x' }] } })).toBe(
        false
      )
      expect(isReportWithEntries(undefined)).toBe(false)
    })

    test('Should find the question pages answered before the entries begin', () => {
      expect(pagesBeforeEntries(model).map((page) => page.path)).toEqual([
        REPORT_DATE_PATH
      ])
    })

    test('Should name entries after the section of the entry pages', () => {
      expect(entryTitleOf(model)).toBe('Entry')
      expect(entryName(model, 0)).toBe('Entry 1')
      expect(entryName(model, 4)).toBe('Entry 5')
    })

    test('Should fall back to "Entry" when there is no section', () => {
      expect(entryTitleOf({ pages: [] })).toBe('Entry')
    })

    test('Should count entries in words', () => {
      expect(entriesCountText(model, 0)).toBe('0 entries')
      expect(entriesCountText(model, 1)).toBe('1 entry')
      expect(entriesCountText(model, 2)).toBe('2 entries')
    })

    test('Should tell an entry added before from one still being added', () => {
      expect(isAddedEntry(buildEntry({ added: true }))).toBe(true)
      expect(isAddedEntry(buildEntry())).toBe(false)
      expect(isAddedEntry(undefined)).toBe(false)
    })

    test('Should caption an entry being added with the position it will take', () => {
      const entries = [buildEntry({ added: true })]

      expect(entryCaption(model, [], { itemId: 'new' })).toBe('Adding entry 1')
      expect(entryCaption(model, entries, { itemId: 'new' })).toBe(
        'Adding entry 2'
      )
      // Started, so already in the list, but not complete yet
      expect(
        entryCaption(model, [...entries, { itemId: SECOND_ENTRY_ID }], {
          itemId: SECOND_ENTRY_ID
        })
      ).toBe('Adding entry 2')
    })

    test('Should caption an entry added before as being edited, out of how many', () => {
      const first = buildEntry({ added: true })
      const second = buildOtherSpeciesEntry({ added: true })

      expect(entryCaption(model, [first, second], first)).toBe(
        'Editing entry 1/2'
      )
      expect(entryCaption(model, [first, second], second)).toBe(
        'Editing entry 2/2'
      )
    })

    test('Should offer the wording the report uses', () => {
      expect(ADD_ANOTHER_ENTRY_TEXT).toBe('Add another entry to the report')
      expect(MIN_ENTRIES).toBe(1)
      expect(MAX_ENTRIES).toBeGreaterThan(MIN_ENTRIES)
    })
  })

  describe('the entries in form state', () => {
    test('Should read the entries from state', () => {
      const entries = [buildEntry(), buildOtherSpeciesEntry()]

      expect(entriesOf({ [ENTRIES_KEY]: entries })).toEqual(entries)
    })

    test('Should read no entries from state without any', () => {
      expect(entriesOf(undefined)).toEqual([])
      expect(entriesOf({})).toEqual([])
      expect(entriesOf({ [ENTRIES_KEY]: 'not a list' })).toEqual([])
    })

    test('Should ignore anything in the list that is not an entry', () => {
      const entry = buildEntry()

      expect(
        entriesOf({ [ENTRIES_KEY]: [entry, null, 'x', { pathogen: 'P' }] })
      ).toEqual([entry])
    })

    test('Should find an entry by its id', () => {
      const entries = [buildEntry(), buildOtherSpeciesEntry()]

      expect(findEntry(entries, SECOND_ENTRY_ID)).toBe(entries[1])
      expect(findEntry(entries, 'missing')).toBeUndefined()
      expect(findEntry(entries, undefined)).toBeUndefined()
    })

    test('Should mint a new entry id', () => {
      const id = newEntryId()

      expect(id).toMatch(UUID)
      expect(newEntryId()).not.toBe(id)
    })

    test('Should add an entry that is new to the list', () => {
      const existing = buildEntry()
      const added = buildOtherSpeciesEntry()
      const entries = [existing]

      expect(upsertEntry(entries, added)).toEqual([existing, added])
      expect(entries).toEqual([existing])
    })

    test('Should replace an entry already in the list, in place', () => {
      const first = buildEntry()
      const second = buildOtherSpeciesEntry()
      const changed = buildEntry({ country: 'Wales' })

      expect(upsertEntry([first, second], changed)).toEqual([changed, second])
    })

    test('Should remove an entry by its id', () => {
      const first = buildEntry()
      const second = buildOtherSpeciesEntry()

      expect(removeEntry([first, second], FIRST_ENTRY_ID)).toEqual([second])
      expect(removeEntry([first], 'missing')).toEqual([first])
    })
  })

  describe('the pages an entry needs answered', () => {
    test("Should evaluate conditions against the entry's own answers", () => {
      expect(entryEvaluationState(model, buildOtherSpeciesEntry())).toEqual(
        expect.objectContaining({
          pathogen: 'Tritrichomonas foetus',
          species: 'Other',
          otherSpecies: 'Alpaca',
          country: 'England'
        })
      )
      expect(entryEvaluationState(model)).toEqual(
        expect.objectContaining({ species: null, otherSpecies: null })
      )
    })

    test('Should skip the other species page for a species on the list', () => {
      expect(
        relevantEntryPages(model, buildEntry()).map((p) => p.path)
      ).toEqual(
        ENTRY_PAGE_PATHS.filter((path) => path !== ENTRY_PATHS.otherSpecies)
      )
    })

    test('Should ask for the other species when the species is Other', () => {
      expect(
        relevantEntryPages(model, buildOtherSpeciesEntry()).map((p) => p.path)
      ).toEqual(ENTRY_PAGE_PATHS)
    })

    test('Should start a new entry with the unconditional pages', () => {
      expect(relevantEntryPages(model, undefined).map((p) => p.path)).toEqual(
        ENTRY_PAGE_PATHS.filter((path) => path !== ENTRY_PATHS.otherSpecies)
      )
    })

    test("Should tell whether a page's answers are complete in an entry", () => {
      const numbers = pageOf(model, ENTRY_PATHS.numbers)

      expect(isEntryPageComplete(model, numbers, buildEntry())).toBe(true)
      expect(
        isEntryPageComplete(
          model,
          numbers,
          buildEntry({ positiveSamples: undefined })
        )
      ).toBe(false)
      expect(isEntryPageComplete(model, numbers)).toBe(false)
    })

    test('Should treat a page without a schema of its own as complete', () => {
      expect(
        isEntryPageComplete(model, { collection: { fields: [] } }, {})
      ).toBe(true)
    })

    test('Should offer the species reported for the pathogen, and Other for all', () => {
      const species = pageOf(model, ENTRY_PATHS.species).collection.fields[0]
      const offered = (pathogen) =>
        offeredListItems(model, species, buildEntry({ pathogen })).map(
          (item) => item.text
        )

      expect(offered('Mycoplasma gallisepticum / M. meleagridis')).toEqual([
        'Chicken',
        'Turkey',
        'Other (please specify on the next page)'
      ])
      expect(offered('Campylobacter fetus subsp. venerealis')).toEqual([
        'Domestic cattle',
        'Bison',
        'Buffalo',
        'Other (please specify on the next page)'
      ])
      expect(
        offered(
          'Bovine Virus Diarrhoea Virus 1 (BVDV-1) or BVDV (-1 and -2 not differentiated)'
        )
      ).toEqual([
        'Domestic cattle',
        'Bison',
        'Buffalo',
        'Other (please specify on the next page)'
      ])
      expect(offered('Bovine Herpes Virus 1 (BHV-1)')).toEqual([
        'Domestic cattle',
        'Bison',
        'Buffalo',
        'Other (please specify on the next page)'
      ])
      expect(
        offered('Mycobacterium avium subsp. paratuberculosis (Map)')
      ).toEqual([
        'Domestic cattle',
        'Sheep',
        'Goat',
        'Deer',
        'Camelid',
        'Bison',
        'Buffalo',
        'Other (please specify on the next page)'
      ])
      expect(
        offered(
          'Porcine reproductive and respiratory syndrome virus - 1 (PRRSV-1) or PRRSV (-1 and -2 not differentiated)'
        )
      ).toEqual([
        'Domestic pig',
        'Wild boar',
        'Other (please specify on the next page)'
      ])
      expect(offered('Tritrichomonas foetus')).toEqual([
        'Domestic cattle',
        'Bison',
        'Buffalo',
        'Other (please specify on the next page)'
      ])
    })

    test('Should offer only Other before a pathogen is chosen', () => {
      const species = pageOf(model, ENTRY_PATHS.species).collection.fields[0]

      expect(
        offeredListItems(model, species, { itemId: 'new' }).map(
          (item) => item.value
        )
      ).toEqual(['Other'])
    })

    test('Should offer every option of a list without conditions', () => {
      const pathogen = pageOf(model, ENTRY_PATHS.pathogen).collection.fields[0]

      expect(offeredListItems(model, pathogen, {})).toHaveLength(7)
    })

    test('Should notice a species that is not reported for the pathogen', () => {
      const speciesPage = pageOf(model, ENTRY_PATHS.species)

      expect(
        disallowedListAnswers(
          model,
          speciesPage,
          buildEntry({ species: 'Chicken' })
        ).map((field) => field.name)
      ).toEqual(['species'])
      expect(disallowedListAnswers(model, speciesPage, buildEntry())).toEqual(
        []
      )
      expect(
        disallowedListAnswers(model, speciesPage, buildOtherSpeciesEntry())
      ).toEqual([])
    })

    test('Should leave an unanswered list field to the page schema', () => {
      const speciesPage = pageOf(model, ENTRY_PATHS.species)

      expect(
        disallowedListAnswers(model, speciesPage, buildEntry({ species: '' }))
      ).toEqual([])
      expect(disallowedListAnswers(model, speciesPage)).toEqual([])
    })

    test('Should count a species not reported for the pathogen as incomplete', () => {
      const speciesPage = pageOf(model, ENTRY_PATHS.species)
      const entry = buildEntry({ species: 'Chicken' })

      expect(isEntryPageComplete(model, speciesPage, entry)).toBe(false)
      expect(firstIncompleteEntryPage(model, entry)).toBe(speciesPage)
    })

    test('Should find the first page of an entry left unanswered', () => {
      expect(firstIncompleteEntryPage(model, buildEntry())).toBeUndefined()
      expect(firstIncompleteEntryPage(model, { itemId: 'new' }).path).toBe(
        ENTRY_PATHS.pathogen
      )
      expect(
        firstIncompleteEntryPage(
          model,
          buildOtherSpeciesEntry({ otherSpecies: undefined })
        ).path
      ).toBe(ENTRY_PATHS.otherSpecies)
      expect(
        firstIncompleteEntryPage(model, buildEntry({ country: undefined })).path
      ).toBe(ENTRY_PATHS.country)
    })

    test('Should not want the other species of a species on the list', () => {
      expect(isEntryComplete(model, buildEntry())).toBe(true)
      expect(isEntryComplete(model, buildOtherSpeciesEntry())).toBe(true)
      expect(
        isEntryComplete(model, buildOtherSpeciesEntry({ otherSpecies: '' }))
      ).toBe(false)
    })

    test('Should drop the other species once the species is on the list', () => {
      const entry = buildOtherSpeciesEntry({ species: 'Domestic cattle' })

      expect(pruneEntry(model, entry)).toEqual(
        buildEntry({ itemId: SECOND_ENTRY_ID })
      )
      expect(entry.otherSpecies).toBe('Alpaca')
    })

    test('Should keep the other species of a species that is Other', () => {
      const entry = buildOtherSpeciesEntry()

      expect(pruneEntry(model, entry)).toEqual(entry)
    })

    test('Should keep the entry id and drop what is not an answer', () => {
      expect(pruneEntry(model, { itemId: 'x', stray: true })).toEqual({
        itemId: 'x'
      })
    })

    test('Should keep whether the entry was added before', () => {
      expect(pruneEntry(model, { itemId: 'x', added: true })).toEqual({
        itemId: 'x',
        added: true
      })
      expect(pruneEntry(model, { itemId: 'x', added: 'yes' })).toEqual({
        itemId: 'x'
      })
    })
  })

  describe('changing an earlier answer', () => {
    const species = pageOf(model, ENTRY_PATHS.species)
    const numbers = pageOf(model, ENTRY_PATHS.numbers)

    test("Should notice when a page's answers differ from the entry's", () => {
      const entry = buildEntry()

      expect(
        entryPageAnswersChanged(species, entry, { species: 'Domestic cattle' })
      ).toBe(false)
      expect(
        entryPageAnswersChanged(species, entry, { species: 'Turkey' })
      ).toBe(true)
      expect(
        entryPageAnswersChanged(numbers, entry, {
          submissionsWithQualifyingTest: 12,
          submissionsWithPositiveSamples: 3,
          positiveSamples: 6
        })
      ).toBe(true)
    })

    test('Should count a page never answered as changed', () => {
      expect(
        entryPageAnswersChanged(
          species,
          { itemId: 'new' },
          { species: 'Domestic cattle' }
        )
      ).toBe(true)
      expect(entryPageAnswersChanged(species)).toBe(false)
    })

    test('Should drop the answers of every page after the one changed', () => {
      expect(
        clearAnswersAfter(model, species, buildOtherSpeciesEntry())
      ).toEqual({
        itemId: SECOND_ENTRY_ID,
        pathogen: 'Tritrichomonas foetus',
        species: 'Other'
      })
    })

    test('Should keep every answer when the last page is the one changed', () => {
      const entry = buildEntry()

      expect(clearAnswersAfter(model, numbers, entry)).toEqual(entry)
    })
  })

  describe('the answers so far on an entry page', () => {
    const returnUrl = (page, itemId) =>
      encodeURIComponent(`/${WEB_FORM_SLUG}${page.path}/${itemId}`)

    test('Should list the report date, then the answers of the pages before this one', () => {
      const numbers = pageOf(model, ENTRY_PATHS.numbers)
      const entry = buildOtherSpeciesEntry()
      const { rows } = answersSoFar(
        model,
        numbers,
        entry,
        buildState([entry]),
        translator
      )

      expect(
        rows.map((row) => [
          row.key.text,
          row.value.html,
          row.actions.items[0].href
        ])
      ).toEqual([
        [
          'Report Date',
          'August 2026',
          `/${WEB_FORM_SLUG}${REPORT_DATE_PATH}?returnUrl=${returnUrl(numbers, SECOND_ENTRY_ID)}`
        ],
        [
          'Selected pathogen',
          'Tritrichomonas foetus',
          `/${WEB_FORM_SLUG}${ENTRY_PATHS.pathogen}/${SECOND_ENTRY_ID}?returnUrl=${returnUrl(numbers, SECOND_ENTRY_ID)}`
        ],
        [
          'Species the report is for',
          'Other (please specify on the next page)',
          `/${WEB_FORM_SLUG}${ENTRY_PATHS.species}/${SECOND_ENTRY_ID}?returnUrl=${returnUrl(numbers, SECOND_ENTRY_ID)}`
        ],
        [
          'Other species',
          'Alpaca',
          `/${WEB_FORM_SLUG}${ENTRY_PATHS.otherSpecies}/${SECOND_ENTRY_ID}?returnUrl=${returnUrl(numbers, SECOND_ENTRY_ID)}`
        ],
        [
          'Country',
          'England',
          `/${WEB_FORM_SLUG}${ENTRY_PATHS.country}/${SECOND_ENTRY_ID}?returnUrl=${returnUrl(numbers, SECOND_ENTRY_ID)}`
        ]
      ])
      expect(rows[1].actions.items[0]).toEqual(
        expect.objectContaining({
          text: 'Change',
          visuallyHiddenText: 'selected pathogen'
        })
      )
    })

    test('Should leave out the other species of a species on the list', () => {
      const entry = buildEntry()
      const { rows } = answersSoFar(
        model,
        pageOf(model, ENTRY_PATHS.country),
        entry,
        buildState([entry]),
        translator
      )

      expect(rows.map((row) => row.key.text)).toEqual([
        'Report Date',
        'Selected pathogen',
        'Species the report is for'
      ])
    })

    test('Should leave out questions not yet answered', () => {
      const entry = {
        itemId: FIRST_ENTRY_ID,
        pathogen: 'Bovine Herpes Virus 1 (BHV-1)'
      }
      const { rows } = answersSoFar(
        model,
        pageOf(model, ENTRY_PATHS.country),
        entry,
        buildState([entry], {
          reportDate__month: undefined,
          reportDate__year: undefined
        }),
        translator
      )

      expect(rows.map((row) => row.key.text)).toEqual(['Selected pathogen'])
    })

    test('Should show only the report date on the first page of an entry', () => {
      const entry = { itemId: FIRST_ENTRY_ID }
      const { rows } = answersSoFar(
        model,
        pageOf(model, ENTRY_PATHS.pathogen),
        entry,
        buildState([]),
        translator
      )

      expect(rows.map((row) => row.key.text)).toEqual(['Report Date'])
    })
  })

  describe('the paths of an entry', () => {
    const species = pageOf(model, ENTRY_PATHS.species)

    test('Should name the entry in the path of its page', () => {
      expect(entryPagePath(species, FIRST_ENTRY_ID)).toBe(
        `${ENTRY_PATHS.species}/${FIRST_ENTRY_ID}`
      )
      expect(entryPageHref(species, FIRST_ENTRY_ID)).toBe(
        `/${WEB_FORM_SLUG}${ENTRY_PATHS.species}/${FIRST_ENTRY_ID}`
      )
    })

    test('Should carry a return URL', () => {
      expect(
        entryPagePath(species, FIRST_ENTRY_ID, { returnUrl: '/x/y' })
      ).toBe(`${ENTRY_PATHS.species}/${FIRST_ENTRY_ID}?returnUrl=%2Fx%2Fy`)
      expect(
        entryPageHref(species, FIRST_ENTRY_ID, { returnUrl: undefined })
      ).toBe(`/${WEB_FORM_SLUG}${ENTRY_PATHS.species}/${FIRST_ENTRY_ID}`)
    })
  })

  describe('an entry as a summary', () => {
    test('Should show an answer without the line break the engine adds to punctuated list items', () => {
      const pathogen = pageOf(model, ENTRY_PATHS.pathogen).collection.fields[0]
      const numbers = pageOf(model, ENTRY_PATHS.numbers).collection.fields[0]
      const entry = buildEntry({ pathogen: 'Bovine Herpes Virus 1 (BHV-1)' })

      expect(answerHtml(pathogen, entry, translator)).toBe(
        'Bovine Herpes Virus 1 (BHV-1)'
      )
      expect(answerHtml(pathogen, buildEntry(), translator)).toBe(
        'Tritrichomonas foetus'
      )
      expect(answerHtml(numbers, entry, translator)).toBe('12')
    })

    test('Should submit an answer as given', () => {
      const pathogen = pageOf(model, ENTRY_PATHS.pathogen).collection.fields[0]
      const numbers = pageOf(model, ENTRY_PATHS.numbers).collection.fields[0]
      const entry = buildEntry({ pathogen: 'Bovine Herpes Virus 1 (BHV-1)' })

      expect(answerData(pathogen, entry, translator)).toBe(
        'Bovine Herpes Virus 1 (BHV-1)'
      )
      expect(answerData(numbers, entry, translator)).toBe('12')
      expect(answerData(numbers, {}, translator)).toBe('')
    })

    test('Should list the answers of the pages the entry needed', () => {
      const items = entryDetailItems(
        model,
        buildOtherSpeciesEntry(),
        translator,
        {
          returnUrl: '/back'
        }
      )

      expect(
        items.map(({ name, title, value }) => [name, title, value])
      ).toEqual([
        ['pathogen', 'Selected pathogen', 'Tritrichomonas foetus'],
        [
          'species',
          'Species the report is for',
          'Other (please specify on the next page)'
        ],
        ['otherSpecies', 'Other species', 'Alpaca'],
        ['country', 'Country', 'England'],
        [
          'submissionsWithQualifyingTest',
          'Submissions with at least one qualifying test',
          '12'
        ],
        [
          'submissionsWithPositiveSamples',
          'Submissions with at least one positive result',
          '3'
        ],
        ['positiveSamples', 'Total positive submissions', '5']
      ])

      // In the engine's shape: field and state for the submission records,
      // and a Change link to the page for the entry
      const [pathogen] = items

      expect(pathogen).toEqual(
        expect.objectContaining({
          data: 'Tritrichomonas foetus',
          label: 'Select the pathogen that was tested',
          href: `/${WEB_FORM_SLUG}${ENTRY_PATHS.pathogen}/${SECOND_ENTRY_ID}?returnUrl=%2Fback`,
          page: pageOf(model, ENTRY_PATHS.pathogen),
          field: expect.objectContaining({ name: 'pathogen' })
        })
      )
      expect(pathogen.state).toEqual(buildOtherSpeciesEntry())
    })

    test('Should leave out the other species of a species on the list', () => {
      const names = entryDetailItems(model, buildEntry(), translator).map(
        (item) => item.name
      )

      expect(names).not.toContain('otherSpecies')
      expect(names).toHaveLength(6)
    })

    test('Should build a card titled with the entry name, a row per answer', () => {
      const card = entryCard(model, buildEntry(), 1, translator, {
        returnUrl: '/back'
      })

      expect(card.card).toEqual({ title: { text: 'Entry 2' } })
      expect(card.rows).toHaveLength(6)
      expect(card.rows[2]).toEqual({
        key: { text: 'Country' },
        value: { classes: 'app-prose-scope', html: 'England' },
        actions: {
          items: [
            {
              href: `/${WEB_FORM_SLUG}${ENTRY_PATHS.country}/${FIRST_ENTRY_ID}?returnUrl=%2Fback`,
              text: 'Change',
              classes: 'govuk-link--no-visited-state',
              visuallyHiddenText: 'country'
            }
          ]
        }
      })
    })

    test('Should offer to remove the entry when given where to', () => {
      const card = entryCard(model, buildEntry(), 0, translator, {
        removeHref: '/remove'
      })

      expect(card.card.actions).toEqual({
        items: [
          {
            href: '/remove',
            text: 'Remove',
            classes: 'govuk-link--no-visited-state',
            visuallyHiddenText: 'entry'
          }
        ]
      })
    })

    test('Should say when an answer is not provided', () => {
      const card = entryCard(
        model,
        buildEntry({ country: undefined }),
        0,
        translator
      )

      expect(card.rows[2].key.text).toBe('Country')
      expect(card.rows[2].value.html).toBe('Not provided')
    })
  })

  describe('what stops a report going forward', () => {
    test('Should want at least the minimum number of entries', () => {
      expect(tooFewEntriesError(model)).toEqual({
        text: 'Add at least 1 entry to the report',
        href: '',
        name: ENTRIES_KEY,
        path: [ENTRIES_KEY]
      })
      expect(entriesErrors(model, [])).toEqual([tooFewEntriesError(model)])
    })

    test('Should refuse more than the maximum number of entries', () => {
      const tooMany = Array.from({ length: MAX_ENTRIES + 1 }, (_, index) =>
        buildEntry({ itemId: `entry-${index}` })
      )

      expect(tooManyEntriesError(model)).toEqual(
        expect.objectContaining({
          text: `You can only add up to ${MAX_ENTRIES} entries to the report`
        })
      )
      expect(entriesErrors(model, tooMany)).toEqual([
        tooManyEntriesError(model)
      ])
    })

    test('Should point at the unanswered page of an incomplete entry', () => {
      const complete = buildEntry()
      const incomplete = buildOtherSpeciesEntry({ otherSpecies: undefined })

      expect(
        incompleteEntryErrors(model, [complete, incomplete], {
          returnUrl: '/list'
        })
      ).toEqual([
        {
          text: 'Complete entry 2 or remove it',
          href: `/${WEB_FORM_SLUG}${ENTRY_PATHS.otherSpecies}/${SECOND_ENTRY_ID}?returnUrl=%2Flist`,
          name: ENTRIES_KEY,
          path: [ENTRIES_KEY]
        }
      ])
      expect(entriesErrors(model, [complete, incomplete])).toHaveLength(1)
    })

    test('Should find nothing wrong with complete entries', () => {
      expect(
        entriesErrors(model, [buildEntry(), buildOtherSpeciesEntry()])
      ).toEqual([])
    })
  })
})
