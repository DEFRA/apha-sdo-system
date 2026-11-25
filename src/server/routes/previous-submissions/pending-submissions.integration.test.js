import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { submissionHistoryApi } from '#/server/services/submission-history-api.js'
import { PREVIOUS_SUBMISSIONS_PATH } from './controller.js'
import { recordPendingSubmission } from './pending-submissions.js'

vi.mock(
  '#/server/services/submission-history-api.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    submissionHistoryApi: { fetchSubmissionPage: vi.fn() }
  })
)

const RECORD_PATH = '/test/record-pending-submission'

// The record the output service writes as submission.json, for TestLab1
const submission = {
  referenceNumber: '48B-2LK-8NS',
  form: 'bat-rabies',
  processName: 'BR',
  organisationId: 'Test Lab 1',
  organisationName: 'Test Lab 1',
  submittedAt: new Date().toISOString(),
  fileName: '2025-01 Bat Rabies.xlsx',
  reportMonthYear: 'January 2025',
  answers: []
}

const auth = {
  strategy: 'session',
  credentials: {
    sessionId: 'test-session',
    user: {
      id: 'user-id',
      name: 'A Person',
      organisationId: 'TestLab1',
      journeys: ['BR']
    },
    claims: {}
  }
}

function answerWithRows(rows) {
  submissionHistoryApi.fetchSubmissionPage.mockResolvedValue({
    status: 200,
    correlationId: 'corr-1',
    body: rows.length ? [rows] : [{}]
  })
}

describe('reports just submitted, through the server', () => {
  let server

  beforeAll(async () => {
    config.set('submissionHistoryApi.enabled', true)
    server = await createServer()

    // Records the report the way the output service does once delivered
    server.route({
      method: 'GET',
      path: RECORD_PATH,
      async handler(request, h) {
        await recordPendingSubmission(request, submission)

        return h.response().code(statusCodes.noContent)
      }
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    config.set('submissionHistoryApi.enabled', false)
  })

  test('Should show the report straight away, then the API row in its place', async () => {
    answerWithRows([])

    await server.inject({ method: 'GET', url: RECORD_PATH, auth })

    const before = await server.inject({
      method: 'GET',
      url: PREVIOUS_SUBMISSIONS_PATH,
      auth
    })

    expect(before.statusCode).toBe(statusCodes.ok)
    expect(before.result).toEqual(expect.stringContaining('48B-2LK-8NS'))
    expect(before.result).toEqual(
      expect.stringContaining('govuk-tag--blue">Processing')
    )
    expect(before.result).toEqual(
      expect.stringContaining('2025-01 Bat Rabies.xlsx')
    )

    answerWithRows([
      {
        UploadReferenceNumber: '48B-2LK-8NS',
        SubmissionProcessName: 'BR',
        SubmissionMnthYr: 'January 2025',
        SubmissionDate: '2026-11-25 10:44:45.5590000',
        FileName: '2025-01 Bat Rabies.xlsx',
        SubmissionStatus: 'Successful',
        LaboratoryID: 'Test Lab 1'
      }
    ])

    const after = await server.inject({
      method: 'GET',
      url: PREVIOUS_SUBMISSIONS_PATH,
      auth
    })

    expect(after.result.match(/48B-2LK-8NS/g)).toHaveLength(2)
    expect(after.result).toEqual(
      expect.stringContaining('govuk-tag--green">Accepted')
    )
    expect(after.result).not.toEqual(
      expect.stringContaining('govuk-tag--blue">Processing')
    )
  })
})
