import { SummaryPageController } from '@defra/forms-engine-plugin/controllers/SummaryPageController.js'

import { ReportFileUploadPageController } from '#/server/forms/controllers/report-file-upload-page-controller.js'
import { SummaryPageWithConfirmationEmailController } from '#/server/forms/controllers/summary-page-with-confirmation-email-controller.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const UPLOAD_HREF = '/bat-rabies/files-upload'
const SUBMITTED_RESPONSE = { submitted: true }

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
  test('Should list the uploaded file names instead of a file count', () => {
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

  test('Should list every uploaded file on its own line', () => {
    const viewModel = buildViewModel({
      files: [buildFile('March2025.xlsx'), buildFile('notes.csv')],
      value: 'Uploaded 2 files'
    })

    vi.spyOn(
      SummaryPageController.prototype,
      'getSummaryViewModel'
    ).mockReturnValue(viewModel)

    const result = buildController([]).getSummaryViewModel({}, {}, {})

    expect(filesRow(result).value.html).toBe('March2025.xlsx<br>notes.csv')
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
