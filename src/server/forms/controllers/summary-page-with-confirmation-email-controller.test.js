import { SummaryPageController } from '@defra/forms-engine-plugin/controllers/SummaryPageController.js'

import { ReportFileUploadPageController } from '#/server/forms/controllers/report-file-upload-page-controller.js'
import { SummaryPageWithConfirmationEmailController } from '#/server/forms/controllers/summary-page-with-confirmation-email-controller.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  ENTRIES_PATH,
  ENTRY_PATHS,
  FIRST_ENTRY_ID,
  WEB_FORM_SLUG,
  buildEntry,
  buildOtherSpeciesEntry,
  buildRequest,
  buildState,
  buildWebFormModel,
  pageOf
} from '#/test-helpers/web-form-model.js'

const UPLOAD_HREF = '/bat-rabies/files-upload'
const SUBMITTED_RESPONSE = { submitted: true }

const WEB_FORM_SUMMARY_HREF = `/${WEB_FORM_SLUG}/summary`
const WEB_FORM_ENTRIES_HREF = `/${WEB_FORM_SLUG}${ENTRIES_PATH}`
const ENTRIES_CHANGE_HREF = `${WEB_FORM_ENTRIES_HREF}?returnUrl=${encodeURIComponent(WEB_FORM_SUMMARY_HREF)}`

function buildUploadPage(rejected = []) {
  const page = Object.create(ReportFileUploadPageController.prototype)

  page.pageDef = { path: '/files-upload' }
  page.model = { basePath: 'bat-rabies' }
  page.rejectMisnamedFiles = vi.fn((_request, state) =>
    Promise.resolve({ state, rejected })
  )

  return page
}

function buildController(pages, { basePath = 'bat-rabies' } = {}) {
  const controller = Object.create(
    SummaryPageWithConfirmationEmailController.prototype
  )

  controller.pageDef = { path: '/summary' }
  controller.model = { basePath, pages }

  return controller
}

function stubSubmit() {
  return vi
    .spyOn(SummaryPageController.prototype, 'handleFormSubmit')
    .mockResolvedValue(SUBMITTED_RESPONSE)
}

function buildToolkit() {
  return {
    redirect: vi.fn((path) => ({ path, code: (code) => ({ path, code }) }))
  }
}

function buildFile(filename) {
  return {
    uploadId: `upload-${filename}`,
    status: { form: { file: { fileId: filename, filename } } }
  }
}

function buildViewModel({ files, value = 'Uploaded 1 file' } = {}) {
  return {
    details: [
      {
        items: [
          {
            name: 'supportingDocuments',
            field: {
              type: 'FileUploadField',
              getFormValueFromState: () => files
            },
            state: {},
            value
          }
        ]
      }
    ],
    checkAnswers: [
      {
        summaryList: {
          rows: [
            {
              key: { text: 'Supporting documents' },
              value: { classes: 'app-prose-scope', html: value }
            }
          ]
        }
      }
    ]
  }
}

function filesRow(viewModel) {
  return viewModel.checkAnswers[0].summaryList.rows.find(
    (row) => row.key.text !== 'Submission kind'
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('#getSummaryViewModel', () => {
  test('Should show the uploaded file name instead of a file count', () => {
    const viewModel = buildViewModel({
      files: [buildFile('March2025.xlsx')]
    })

    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(viewModel)

    const result = buildController([]).getSummaryViewModel({}, {}, {})

    expect(filesRow(result).value.html).toBe('March2025.xlsx')
  })

  test('Should skip files that carry no name', () => {
    const viewModel = buildViewModel({
      files: [{ uploadId: 'upload-x', status: {} }, buildFile('March2025.xlsx')]
    })

    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(viewModel)

    const result = buildController([]).getSummaryViewModel({}, {}, {})

    expect(filesRow(result).value.html).toBe('March2025.xlsx')
  })

  test('Should escape file names so they cannot break the summary HTML', () => {
    const viewModel = buildViewModel({
      files: [buildFile('<script>alert(1)</script>.xlsx')]
    })

    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(viewModel)

    const result = buildController([]).getSummaryViewModel({}, {}, {})

    expect(filesRow(result).value.html).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;.xlsx'
    )
  })

  test('Should leave the engine copy when no file names are available', () => {
    const viewModel = buildViewModel({ files: [], value: '' })

    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(viewModel)

    const result = buildController([]).getSummaryViewModel({}, {}, {})

    expect(filesRow(result).value.html).toBe('')
  })

  test.each([
    { slug: 'bat-rabies', kind: 'Bat rabies' },
    { slug: 'animal-health-regulations', kind: 'Animal Health Regulation' }
  ])('Should show $kind as the submission kind for $slug', ({ slug, kind }) => {
    const viewModel = buildViewModel({
      files: [buildFile('March2025.xlsx')]
    })

    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(viewModel)

    const result = buildController([], { basePath: slug }).getSummaryViewModel(
      {},
      {},
      {}
    )
    const [firstRow, secondRow] = result.checkAnswers[0].summaryList.rows

    expect(firstRow).toEqual({
      classes: 'govuk-summary-list__row--no-actions',
      key: { text: 'Submission kind' },
      value: { classes: 'app-prose-scope', text: kind }
    })
    expect(secondRow.value.html).toBe('March2025.xlsx')
  })

  test('Should not invent a submission kind for a journey that is not a report', () => {
    const viewModel = buildViewModel({
      files: [buildFile('March2025.xlsx')]
    })

    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(viewModel)

    const result = buildController([], {
      basePath: 'example-application'
    }).getSummaryViewModel({}, {}, {})

    expect(result.checkAnswers[0].summaryList.rows).toHaveLength(1)
    expect(result.checkAnswers[0].summaryList.rows[0].key.text).toBe(
      'Supporting documents'
    )
  })
})

describe('#handleFormSubmit', () => {
  test('Should submit when every uploaded file is named after the report date', async () => {
    const uploadPage = buildUploadPage()
    const controller = buildController([uploadPage])
    const request = {}
    const context = { state: { reportDate__month: 3, reportDate__year: 2024 } }
    const h = buildToolkit()

    const submit = stubSubmit()

    const response = await controller.handleFormSubmit(request, context, h)

    expect(uploadPage.rejectMisnamedFiles).toHaveBeenCalledWith(
      request,
      context.state
    )
    expect(submit).toHaveBeenCalledWith(request, context, h)
    expect(response).toBe(SUBMITTED_RESPONSE)
  })

  test('Should refuse to submit a misnamed file and return to the upload page', async () => {
    const uploadPage = buildUploadPage([{ uploadId: 'upload-1' }])
    const controller = buildController([uploadPage])
    const h = buildToolkit()

    const submit = stubSubmit()

    const response = await controller.handleFormSubmit(
      {},
      { state: { reportDate__month: 4, reportDate__year: 2024 } },
      h
    )

    expect(submit).not.toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith(UPLOAD_HREF)
    expect(response).toEqual({
      path: UPLOAD_HREF,
      code: statusCodes.seeOther
    })
  })

  test('Should submit a journey that has no upload page', async () => {
    const controller = buildController([{ path: '/somewhere-else' }])

    const submit = stubSubmit()

    const response = await controller.handleFormSubmit(
      {},
      { state: {} },
      buildToolkit()
    )

    expect(submit).toHaveBeenCalled()
    expect(response).toBe(SUBMITTED_RESPONSE)
  })
})

/**
 * The web form report, whose entries the summary shows and guards. The model
 * is the real one so the entries are read from the real pages; the engine's
 * own summary view model is stubbed with what it builds for that form: a
 * group for the entries section (the first entry page's field, "Not
 * provided" since the answers are never at the top level of state) and a
 * group for the report date.
 */
describe('web form report entries', () => {
  const model = buildWebFormModel()
  const summaryPage = pageOf(model, '/summary')
  const translator = model.createTranslator()
  const request = buildRequest()

  function buildEngineViewModel() {
    return {
      details: [
        {
          name: 'entries',
          title: 'Entry',
          items: [{ name: 'pathogen', title: 'Selected pathogen', value: '' }]
        },
        {
          name: undefined,
          items: [
            { name: 'reportDate', title: 'Report Date', value: 'August 2026' }
          ]
        }
      ],
      checkAnswers: [
        {
          title: { text: 'Entry' },
          summaryList: {
            rows: [
              {
                key: { text: 'Selected pathogen' },
                value: { html: 'Not provided' }
              }
            ]
          }
        },
        {
          summaryList: {
            rows: [
              {
                key: { text: 'Report Date' },
                value: { html: 'August 2026' }
              }
            ]
          }
        }
      ]
    }
  }

  function summaryViewModelFor(entries) {
    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(buildEngineViewModel())

    return summaryPage.getSummaryViewModel(
      request,
      { state: buildState(entries) },
      translator
    )
  }

  test('Should render its own, full-width, check your answers page', () => {
    expect(summaryPage.viewName).toBe('report-summary')
  })

  test("Should leave an upload journey with the engine's check your answers page", () => {
    const uploadSummary = new SummaryPageWithConfirmationEmailController(
      {
        def: { name: 'x', options: {} },
        pages: [],
        getSection: () => undefined
      },
      { path: '/summary', title: 'Check your answers' }
    )

    expect(uploadSummary.viewName).toBe('summary')
  })

  describe('#getSummaryViewModel', () => {
    test('Should replace the engine group for the entries section with a count of the entries', () => {
      const viewModel = summaryViewModelFor([
        buildEntry(),
        buildOtherSpeciesEntry()
      ])
      const [main] = viewModel.checkAnswers

      expect(main.title).toBeUndefined()
      expect(main.summaryList.rows.map((row) => row.key.text)).toEqual([
        'Submission kind',
        'Report Date',
        'Entries'
      ])
      expect(main.summaryList.rows[2]).toEqual({
        key: { text: 'Entries' },
        value: { classes: 'app-prose-scope', text: '2 entries' },
        actions: {
          items: [
            {
              href: ENTRIES_CHANGE_HREF,
              text: 'Change',
              classes: 'govuk-link--no-visited-state',
              visuallyHiddenText: 'entries'
            }
          ]
        }
      })
      expect(JSON.stringify(viewModel.checkAnswers)).not.toContain(
        'Not provided'
      )
    })

    test('Should show a card per entry with a change link back here on every answer', () => {
      const viewModel = summaryViewModelFor([
        buildEntry(),
        buildOtherSpeciesEntry()
      ])
      const [, ...cards] = viewModel.checkAnswers

      expect(cards.map((card) => card.summaryList.card.title.text)).toEqual([
        'Entry 1',
        'Entry 2'
      ])
      expect(cards[0].summaryList.card.actions).toBeUndefined()
      expect(cards[0].summaryList.rows).toHaveLength(6)
      expect(cards[1].summaryList.rows).toHaveLength(7)
      expect(cards[0].summaryList.rows[0].actions.items[0].href).toBe(
        `/${WEB_FORM_SLUG}${ENTRY_PATHS.pathogen}/${FIRST_ENTRY_ID}?returnUrl=${encodeURIComponent(WEB_FORM_SUMMARY_HREF)}`
      )
    })

    test('Should hand the entries to the output service as a repeated item', () => {
      const viewModel = summaryViewModelFor([
        buildEntry(),
        buildOtherSpeciesEntry()
      ])

      expect(viewModel.details.map((detail) => detail.name)).toEqual([
        undefined,
        'entries'
      ])

      const [entriesItem] = viewModel.details[1].items

      expect(entriesItem).toEqual(
        expect.objectContaining({
          name: 'entries',
          title: 'Entries',
          value: '2 entries',
          href: ENTRIES_CHANGE_HREF,
          page: pageOf(model, ENTRIES_PATH)
        })
      )
      // Each answer as submitted (data) and as shown (value)
      expect(
        entriesItem.subItems.map((answers) =>
          answers.map(({ name, data }) => [name, data])
        )
      ).toEqual([
        [
          ['pathogen', 'Tritrichomonas foetus'],
          ['species', 'Domestic cattle'],
          ['country', 'England'],
          ['submissionsWithQualifyingTest', '12'],
          ['submissionsWithPositiveSamples', '3'],
          ['positiveSamples', '5']
        ],
        [
          ['pathogen', 'Tritrichomonas foetus'],
          ['species', 'Other'],
          ['otherSpecies', 'Alpaca'],
          ['country', 'England'],
          ['submissionsWithQualifyingTest', '12'],
          ['submissionsWithPositiveSamples', '3'],
          ['positiveSamples', '5']
        ]
      ])
      expect(entriesItem.subItems[1][1].value).toBe(
        'Other (please specify on the next page)'
      )
    })

    test('Should count no entries and show no cards for a report without any', () => {
      const viewModel = summaryViewModelFor([])

      expect(viewModel.checkAnswers).toHaveLength(1)
      expect(viewModel.checkAnswers[0].summaryList.rows[2].value.text).toBe(
        '0 entries'
      )
      expect(viewModel.details[1].items[0].subItems).toEqual([])
    })

    test('Should cope with an engine view model that lists nothing', () => {
      vi.spyOn(
        SummaryPageController.prototype,
        'getSummaryViewModel'
      ).mockReturnValue({})

      const viewModel = summaryPage.getSummaryViewModel(
        request,
        { state: buildState([buildEntry()]) },
        translator
      )

      expect(
        viewModel.checkAnswers[0].summaryList.rows.map((row) => row.key.text)
      ).toEqual(['Submission kind', 'Entries'])
      expect(viewModel.checkAnswers).toHaveLength(2)
      expect(viewModel.details).toHaveLength(1)
    })
  })

  describe('#handleFormSubmit', () => {
    test('Should submit a report whose entries are complete', async () => {
      const submit = stubSubmit()
      const context = { state: buildState([buildEntry()]) }
      const h = buildToolkit()

      const response = await summaryPage.handleFormSubmit(request, context, h)

      expect(submit).toHaveBeenCalledWith(request, context, h)
      expect(response).toBe(SUBMITTED_RESPONSE)
    })

    test('Should send a report without entries back to the entries page', async () => {
      const submit = stubSubmit()
      const h = buildToolkit()

      const response = await summaryPage.handleFormSubmit(
        request,
        { state: buildState([]) },
        h
      )

      expect(submit).not.toHaveBeenCalled()
      expect(response).toEqual({
        path: WEB_FORM_ENTRIES_HREF,
        code: statusCodes.seeOther
      })
    })

    test('Should send a report with an incomplete entry back to the entries page', async () => {
      const submit = stubSubmit()
      const h = buildToolkit()

      await summaryPage.handleFormSubmit(
        request,
        { state: buildState([buildEntry({ country: undefined })]) },
        h
      )

      expect(submit).not.toHaveBeenCalled()
      expect(h.redirect).toHaveBeenCalledWith(WEB_FORM_ENTRIES_HREF)
    })
  })
})
