import { FileUploadPageController } from '@defra/forms-engine-plugin/controllers/FileUploadPageController.js'

import {
  ReportFileUploadPageController,
  findReportFileUploadPage
} from '#/server/forms/controllers/report-file-upload-page-controller.js'

const UPLOAD_PATH = '/files-upload'
const FIELD_NAME = 'supportingDocuments'

function buildFile(filename) {
  return {
    uploadId: `upload-${filename}`,
    status: { form: { file: { fileId: filename, filename } } }
  }
}

// The MonthYearField holds its inputs flat in state, never as an object
function buildState({ month = 3, year = 2024, files = [] } = {}) {
  return {
    reportDate__month: month,
    reportDate__year: year,
    [FIELD_NAME]: files,
    upload: { [UPLOAD_PATH]: { files, upload: { uploadId: 'upload-1' } } }
  }
}

// The engine's constructor needs a whole FormModel, so build the instance from
// the prototype and give it only what these methods reach for.
function buildController() {
  const controller = Object.create(ReportFileUploadPageController.prototype)

  // path and href are getters over pageDef and model
  controller.pageDef = { path: UPLOAD_PATH }
  controller.model = { basePath: 'bat-rabies' }
  controller.fileUpload = { name: FIELD_NAME }
  controller.setState = vi.fn((_request, state) => Promise.resolve(state))

  return controller
}

function buildRequest({ flashed } = {}) {
  const cacheService = {
    getFlash: vi.fn(() => flashed),
    setFlash: vi.fn()
  }

  return {
    cacheService,
    request: {
      server: { plugins: { 'forms-engine-plugin': { cacheService } } }
    }
  }
}

function flashedErrors(cacheService) {
  return cacheService.setFlash.mock.calls.at(0)?.at(1).errors
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('#rejectMisnamedFiles', () => {
  test.each(['march2024.xlsx', 'March2024-1.xls', 'March2024-part2.xls'])(
    'Should keep a file whose name includes the report date (%s)',
    async (filename) => {
      const controller = buildController()
      const file = buildFile(filename)
      const state = buildState({ files: [file] })
      const { request, cacheService } = buildRequest()

      const result = await controller.rejectMisnamedFiles(request, state)

      expect(result.rejected).toEqual([])
      expect(result.state.upload[UPLOAD_PATH].files).toEqual([file])
      expect(controller.setState).not.toHaveBeenCalled()
      expect(cacheService.setFlash).not.toHaveBeenCalled()
    }
  )

  test('Should drop a misnamed file from state and save it', async () => {
    const controller = buildController()
    const state = buildState({ files: [buildFile('April2024.xlsx')] })
    const { request } = buildRequest()

    const result = await controller.rejectMisnamedFiles(request, state)

    expect(result.rejected).toHaveLength(1)
    expect(result.state.upload[UPLOAD_PATH].files).toEqual([])
    expect(result.state[FIELD_NAME]).toEqual([])
    expect(controller.setState).toHaveBeenCalledWith(request, result.state)
  })

  test('Should flash an error against the upload component', async () => {
    const controller = buildController()
    const state = buildState({ files: [buildFile('April2024.xlsx')] })
    const { request, cacheService } = buildRequest()

    await controller.rejectMisnamedFiles(request, state)

    expect(flashedErrors(cacheService)).toEqual([
      {
        path: [FIELD_NAME],
        href: `#${FIELD_NAME}`,
        name: FIELD_NAME,
        text: '‘April2024.xlsx’ must include ‘March2024’'
      }
    ])
  })

  test('Should keep the matching files of a mixed batch and report the rest', async () => {
    const controller = buildController()
    const matching = buildFile('MARCH2024.csv')
    const state = buildState({
      files: [matching, buildFile('April2024.xlsx'), buildFile('report.xlsx')]
    })
    const { request, cacheService } = buildRequest()

    const result = await controller.rejectMisnamedFiles(request, state)

    expect(result.rejected).toHaveLength(2)
    expect(result.state.upload[UPLOAD_PATH].files).toEqual([matching])
    expect(flashedErrors(cacheService).map(({ text }) => text)).toEqual([
      '‘April2024.xlsx’ must include ‘March2024’',
      '‘report.xlsx’ must include ‘March2024’'
    ])
  })

  test('Should keep errors the engine has already flashed this request', async () => {
    const controller = buildController()
    const state = buildState({ files: [buildFile('April2024.xlsx')] })
    const virusError = {
      path: [FIELD_NAME],
      href: `#${FIELD_NAME}`,
      name: FIELD_NAME,
      text: 'The selected file contains a virus'
    }
    const { request, cacheService } = buildRequest({
      flashed: { errors: [virusError] }
    })

    await controller.rejectMisnamedFiles(request, state)

    expect(flashedErrors(cacheService)).toEqual([
      virusError,
      expect.objectContaining({
        text: '‘April2024.xlsx’ must include ‘March2024’'
      })
    ])
  })

  test('Should leave state alone when there is no report date to check against', async () => {
    const controller = buildController()
    const file = buildFile('April2024.xlsx')
    const state = buildState({ files: [file] })
    const { request, cacheService } = buildRequest()

    delete state.reportDate__month
    delete state.reportDate__year

    const result = await controller.rejectMisnamedFiles(request, state)

    expect(result.rejected).toEqual([])
    expect(result.state.upload[UPLOAD_PATH].files).toEqual([file])
    expect(controller.setState).not.toHaveBeenCalled()
    expect(cacheService.setFlash).not.toHaveBeenCalled()
  })
})

describe('#getState', () => {
  test('Should turn away a misnamed file the engine has just added', async () => {
    const controller = buildController()
    const state = buildState({ files: [buildFile('April2024.xlsx')] })
    const { request, cacheService } = buildRequest()

    vi.spyOn(FileUploadPageController.prototype, 'getState').mockResolvedValue(
      state
    )

    const result = await controller.getState(request)

    expect(FileUploadPageController.prototype.getState).toHaveBeenCalledWith(
      request
    )
    expect(result.upload[UPLOAD_PATH].files).toEqual([])
    expect(cacheService.setFlash).toHaveBeenCalled()
  })

  test('Should return the engine state untouched when the file matches', async () => {
    const controller = buildController()
    const file = buildFile('March2024.xlsx')
    const state = buildState({ files: [file] })
    const { request } = buildRequest()

    vi.spyOn(FileUploadPageController.prototype, 'getState').mockResolvedValue(
      state
    )

    const result = await controller.getState(request)

    expect(result).toBe(state)
    expect(result.upload[UPLOAD_PATH].files).toEqual([file])
  })
})

describe('#getViewModel', () => {
  function buildViewModel(hint) {
    return {
      formComponent: { model: { id: FIELD_NAME, hint } }
    }
  }

  test('Should tell users what to name the file', () => {
    const controller = buildController()
    const viewModel = buildViewModel({ text: 'Only csv, xls and xlsx.' })

    vi.spyOn(
      FileUploadPageController.prototype,
      'getViewModel'
    ).mockReturnValue(viewModel)

    const result = controller.getViewModel({}, { state: buildState() }, {})

    expect(result.formComponent.model.hint).toEqual({
      html: 'The file name must include March2024, for example March2024.xlsx or March2024-1.xlsx<br>Only csv, xls and xlsx.'
    })
  })

  test('Should add a hint when the component has none', () => {
    const controller = buildController()

    vi.spyOn(
      FileUploadPageController.prototype,
      'getViewModel'
    ).mockReturnValue(buildViewModel(undefined))

    const result = controller.getViewModel({}, { state: buildState() }, {})

    expect(result.formComponent.model.hint).toEqual({
      html: 'The file name must include March2024, for example March2024.xlsx or March2024-1.xlsx'
    })
  })

  test('Should leave the hint alone when the report date is unknown', () => {
    const controller = buildController()
    const hint = { text: 'Only csv, xls and xlsx.' }

    vi.spyOn(
      FileUploadPageController.prototype,
      'getViewModel'
    ).mockReturnValue(buildViewModel(hint))

    const result = controller.getViewModel({}, { state: {} }, {})

    expect(result.formComponent.model.hint).toEqual(hint)
  })
})

describe('#findReportFileUploadPage', () => {
  test('Should find the upload page among the pages of a journey', () => {
    const uploadPage = buildController()
    const model = { pages: [{ path: '/report-date' }, uploadPage] }

    expect(findReportFileUploadPage(model)).toBe(uploadPage)
  })

  test('Should return undefined when a journey has no upload page', () => {
    expect(
      findReportFileUploadPage({ pages: [{ path: '/report-date' }] })
    ).toBeUndefined()
    expect(findReportFileUploadPage(undefined)).toBeUndefined()
  })
})
