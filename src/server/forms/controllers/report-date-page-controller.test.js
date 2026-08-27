// Imported ahead of QuestionPageController, which cannot be the first engine
// page controller a module loads. See report-date-page-controller.js.
import { ReportDatePageController } from '#/server/forms/controllers/report-date-page-controller.js'
import { QuestionPageController } from '@defra/forms-engine-plugin/controllers/QuestionPageController.js'

import { ReportFileUploadPageController } from '#/server/forms/controllers/report-file-upload-page-controller.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const UPLOAD_HREF = '/bat-rabies/files-upload'
const CONTINUE_RESPONSE = { continued: true }

function buildUploadPage(rejected = []) {
  const page = Object.create(ReportFileUploadPageController.prototype)

  page.pageDef = { path: '/files-upload' }
  page.model = { basePath: 'bat-rabies' }
  page.rejectMisnamedFiles = vi.fn((_request, state) =>
    Promise.resolve({ state, rejected })
  )

  return page
}

function buildController(uploadPage) {
  const controller = Object.create(ReportDatePageController.prototype)

  controller.pageDef = { path: '/report-date' }
  controller.model = { basePath: 'bat-rabies', pages: [uploadPage] }

  return controller
}

// Stands in for the handler QuestionPageController would have run
function stubDefaultHandler() {
  const handler = vi.fn(() => Promise.resolve(CONTINUE_RESPONSE))

  vi.spyOn(
    QuestionPageController.prototype,
    'makePostRouteHandler'
  ).mockReturnValue(handler)

  return handler
}

function buildToolkit() {
  return {
    redirect: vi.fn((path) => ({ path, code: (code) => ({ path, code }) }))
  }
}

function buildRequest({ action = 'continue' } = {}) {
  return { payload: { action } }
}

function buildContext(overrides = {}) {
  return {
    state: { reportDate__month: 4, reportDate__year: 2024 },
    ...overrides
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('#makePostRouteHandler', () => {
  test('Should send the user to the upload page when the new date invalidates a file', async () => {
    const uploadPage = buildUploadPage([{ uploadId: 'upload-1' }])
    const controller = buildController(uploadPage)
    const request = buildRequest()
    const context = buildContext()
    const h = buildToolkit()

    stubDefaultHandler()

    const response = await controller.makePostRouteHandler()(
      request,
      context,
      h
    )

    expect(uploadPage.rejectMisnamedFiles).toHaveBeenCalledWith(
      request,
      context.state
    )
    expect(h.redirect).toHaveBeenCalledWith(UPLOAD_HREF)
    expect(response).toEqual({
      path: UPLOAD_HREF,
      code: statusCodes.seeOther
    })
  })

  test('Should send the user to the upload page even when returning to check your answers', async () => {
    const uploadPage = buildUploadPage([{ uploadId: 'upload-1' }])
    const controller = buildController(uploadPage)
    const h = buildToolkit()

    stubDefaultHandler()

    const response = await controller.makePostRouteHandler()(
      {
        payload: { action: 'continue' },
        query: { returnUrl: '/bat-rabies/summary' }
      },
      buildContext(),
      h
    )

    expect(response.path).toBe(UPLOAD_HREF)
  })

  test('Should carry on as normal when the stored file still matches', async () => {
    const uploadPage = buildUploadPage()
    const controller = buildController(uploadPage)
    const h = buildToolkit()

    const handler = stubDefaultHandler()

    const response = await controller.makePostRouteHandler()(
      buildRequest(),
      buildContext(),
      h
    )

    expect(handler).toHaveBeenCalled()
    expect(uploadPage.rejectMisnamedFiles).toHaveBeenCalled()
    expect(response).toBe(CONTINUE_RESPONSE)
    expect(h.redirect).not.toHaveBeenCalled()
  })

  test('Should not touch uploaded files when the date failed validation', async () => {
    const uploadPage = buildUploadPage([{ uploadId: 'upload-1' }])
    const controller = buildController(uploadPage)
    const h = buildToolkit()

    stubDefaultHandler()

    const response = await controller.makePostRouteHandler()(
      buildRequest(),
      buildContext({ errors: [{ text: 'Enter a report date' }] }),
      h
    )

    expect(uploadPage.rejectMisnamedFiles).not.toHaveBeenCalled()
    expect(response).toBe(CONTINUE_RESPONSE)
  })

  test('Should not touch uploaded files on preview URL direct access', async () => {
    const uploadPage = buildUploadPage([{ uploadId: 'upload-1' }])
    const controller = buildController(uploadPage)

    stubDefaultHandler()

    const response = await controller.makePostRouteHandler()(
      buildRequest(),
      buildContext({ isForceAccess: true }),
      buildToolkit()
    )

    expect(uploadPage.rejectMisnamedFiles).not.toHaveBeenCalled()
    expect(response).toBe(CONTINUE_RESPONSE)
  })

  test('Should let save and exit take the user out of the journey', async () => {
    const uploadPage = buildUploadPage([{ uploadId: 'upload-1' }])
    const controller = buildController(uploadPage)

    stubDefaultHandler()

    const response = await controller.makePostRouteHandler()(
      buildRequest({ action: 'save-and-exit' }),
      buildContext(),
      buildToolkit()
    )

    expect(uploadPage.rejectMisnamedFiles).not.toHaveBeenCalled()
    expect(response).toBe(CONTINUE_RESPONSE)
  })

  test('Should carry on as normal for a journey without an upload page', async () => {
    const controller = buildController({ path: '/somewhere-else' })

    stubDefaultHandler()

    const response = await controller.makePostRouteHandler()(
      buildRequest(),
      buildContext(),
      buildToolkit()
    )

    expect(response).toBe(CONTINUE_RESPONSE)
  })
})
