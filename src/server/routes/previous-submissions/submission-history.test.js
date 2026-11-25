import { config } from '#/config/config.js'
import { reportTypesByCode } from '#/server/forms/report-types.js'
import {
  SubmissionHistoryApiError,
  submissionHistoryApi
} from '#/server/services/submission-history-api.js'
import {
  SUBMISSION_STATUS,
  getLatestSubmission,
  getSubmissionPage
} from './submission-history.js'
import { pendingSubmissionsOf } from './pending-submissions.js'

vi.mock(
  '#/server/services/submission-history-api.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    submissionHistoryApi: { fetchSubmissionPage: vi.fn() }
  })
)

vi.mock('./pending-submissions.js', () => ({
  pendingSubmissionsOf: vi.fn()
}))

const batRabies = reportTypesByCode.get('BR')
const animalHealthRegulations = reportTypesByCode.get('AHR')
const bothReportTypes = [batRabies, animalHealthRegulations]

/**
 * A row in the format the API team shared, with made-up values
 */
function apiRow(overrides = {}) {
  return {
    SubmissionID: '00000000-0000-4000-8000-000000000001',
    UploadReferenceNumber: 'BR1-CCC-333',
    UserId: '00000000-0000-4000-8000-0000000000aa',
    SubmissionDate: '2026-10-29 14:08:17.0420000',
    FileName: '2026-09 bat rabies.xlsx',
    FileLocation: '',
    SubmissionMnthYr: 'September 2026',
    SubmissionProcessName: 'BR',
    CreatedDateTime: '2026-11-18 09:51:24.2935173',
    CreatedBy: 'pipeline',
    FailureCode: '',
    FailureReason: '',
    SubmissionStatus: 'Running',
    ETLProcessStatus: '',
    UpdatedDateTime: '2026-11-18 09:54:01.9373206',
    UpdatedBy: '',
    LaboratoryID: 'Test Lab 1',
    ...overrides
  }
}

const API_ROWS = [
  apiRow(),
  apiRow({
    UploadReferenceNumber: 'AHR-BBB-222',
    SubmissionProcessName: 'AHR',
    SubmissionDate: '2026-10-02 09:00:00.0000000',
    FileName: null,
    SubmissionStatus: 'Successful'
  }),
  apiRow({
    UploadReferenceNumber: 'BR1-AAA-111',
    SubmissionDate: '2026-07-01 08:30:00.5000000',
    SubmissionMnthYr: 'June 2026',
    FileName: '',
    SubmissionStatus: 'Failed'
  })
]

const entraUser = {
  id: 'entra-oid',
  organisationId: 'TestLab1',
  journeys: ['BR', 'AHR']
}

function createRequest({ user = entraUser } = {}) {
  return {
    app: {},
    auth: { credentials: { user } },
    logger: { warn: vi.fn(), error: vi.fn() }
  }
}

function answerWithBody(body) {
  submissionHistoryApi.fetchSubmissionPage.mockResolvedValue({
    status: 200,
    correlationId: 'corr-1',
    body
  })
}

// As the API answers: its rows wrapped in a list, or [{}] for none
function answerWith(rows) {
  answerWithBody(rows.length ? [rows] : [{}])
}

async function onlySubmissionOf(row) {
  answerWith([row])

  const request = createRequest()
  const [submission] = (await getSubmissionPage(request, bothReportTypes))
    .submissions

  return { submission, request }
}

describe('#submissionHistory', () => {
  beforeEach(() => {
    config.set('submissionHistoryApi.enabled', true)
    answerWith(API_ROWS)
    pendingSubmissionsOf.mockResolvedValue([])
  })

  afterEach(() => {
    config.set('submissionHistoryApi.enabled', false)
  })

  describe('getSubmissionPage', () => {
    test('Should read nothing while the API is turned off', async () => {
      config.set('submissionHistoryApi.enabled', false)

      expect(await getSubmissionPage(createRequest(), bothReportTypes)).toEqual(
        { submissions: [], page: 1, hasNextPage: false }
      )
      expect(submissionHistoryApi.fetchSubmissionPage).not.toHaveBeenCalled()
    })

    test('Should read nothing for a user without a lab', async () => {
      const request = createRequest({
        user: { ...entraUser, organisationId: null }
      })

      expect(
        (await getSubmissionPage(request, bothReportTypes)).submissions
      ).toEqual([])
      expect(submissionHistoryApi.fetchSubmissionPage).not.toHaveBeenCalled()
    })

    test('Should read nothing for no report type', async () => {
      expect(
        (await getSubmissionPage(createRequest(), [])).submissions
      ).toEqual([])
      expect(submissionHistoryApi.fetchSubmissionPage).not.toHaveBeenCalled()
    })

    test('Should ask for the report types together, for the lab by name, the first page the configured number at a time', async () => {
      await getSubmissionPage(createRequest(), bothReportTypes)

      expect(submissionHistoryApi.fetchSubmissionPage).toHaveBeenCalledWith({
        processNames: ['BR', 'AHR'],
        laboratoryId: 'Test Lab 1',
        page: 1,
        pageSize: 10
      })
    })

    test("Should ask for an external user's lab by its organisation name", async () => {
      const request = createRequest({
        user: {
          provider: 'defraId',
          id: 'contact-id',
          organisationId: 'organisation-guid',
          organisationName: 'Northern Veterinary Laboratory',
          journeys: ['AHR']
        }
      })

      await getSubmissionPage(request, [animalHealthRegulations], {
        page: 3,
        pageSize: 5
      })

      expect(submissionHistoryApi.fetchSubmissionPage).toHaveBeenCalledWith({
        processNames: ['AHR'],
        laboratoryId: 'Northern Veterinary Laboratory',
        page: 3,
        pageSize: 5
      })
    })

    test('Should read each row as a report of its report type, in the order given', async () => {
      expect(await getSubmissionPage(createRequest(), bothReportTypes)).toEqual(
        {
          submissions: [
            {
              referenceNumber: 'BR1-CCC-333',
              reportType: batRabies,
              reportMonthYear: 'September 2026',
              submittedAt: '2026-10-29T14:08:17.042Z',
              fileName: '2026-09 bat rabies.xlsx',
              status: SUBMISSION_STATUS.PROCESSING
            },
            {
              referenceNumber: 'AHR-BBB-222',
              reportType: animalHealthRegulations,
              reportMonthYear: 'September 2026',
              submittedAt: '2026-10-02T09:00:00.000Z',
              fileName: null,
              status: SUBMISSION_STATUS.ACCEPTED
            },
            {
              referenceNumber: 'BR1-AAA-111',
              reportType: batRabies,
              reportMonthYear: 'June 2026',
              submittedAt: '2026-07-01T08:30:00.500Z',
              fileName: null,
              status: SUBMISSION_STATUS.REJECTED
            }
          ],
          page: 1,
          hasNextPage: false
        }
      )
    })

    describe('submission date', () => {
      const originalTimeZone = process.env.TZ

      // Where Date would read a time without a zone an hour out in summer
      beforeEach(() => {
        process.env.TZ = 'Europe/London'
      })

      afterEach(() => {
        process.env.TZ = originalTimeZone
      })

      test.each([
        ['2026-07-01 08:30:00.5000000', '2026-07-01T08:30:00.500Z'],
        ['2026-11-16 10:55:06.2750000', '2026-11-16T10:55:06.275Z'],
        ['2026-07-01 08:30:00', '2026-07-01T08:30:00.000Z'],
        ['2026-07-01T08:30:00+01:00', '2026-07-01T07:30:00.000Z'],
        ['yesterday', null],
        ['', null],
        [null, null]
      ])('Should read %j as %j, in UTC', async (value, expected) => {
        const { submission } = await onlySubmissionOf(
          apiRow({ SubmissionDate: value })
        )

        expect(submission.submittedAt).toBe(expected)
      })
    })

    test.each([
      ['Running', SUBMISSION_STATUS.PROCESSING],
      ['Successful', SUBMISSION_STATUS.ACCEPTED],
      ['Failed', SUBMISSION_STATUS.REJECTED],
      ['SUCCESS', SUBMISSION_STATUS.ACCEPTED],
      ['Completed', SUBMISSION_STATUS.ACCEPTED],
      ['Rejected', SUBMISSION_STATUS.REJECTED],
      ['Pending', SUBMISSION_STATUS.PROCESSING],
      ['In progress', SUBMISSION_STATUS.PROCESSING]
    ])('Should read the status %s as %s', async (status, expected) => {
      const { submission, request } = await onlySubmissionOf(
        apiRow({ SubmissionStatus: status })
      )

      expect(submission.status).toBe(expected)
      expect(request.logger.warn).not.toHaveBeenCalled()
    })

    test.each(['Quarantined', '', null])(
      'Should show the status %j as processing, and log it',
      async (status) => {
        const { submission, request } = await onlySubmissionOf(
          apiRow({ SubmissionStatus: status })
        )

        expect(submission.status).toBe(SUBMISSION_STATUS.PROCESSING)
        expect(request.logger.warn).toHaveBeenCalledWith(
          { status },
          'Unknown submission status, shown as processing'
        )
      }
    )

    test('Should read a number as text', async () => {
      const { submission } = await onlySubmissionOf(
        apiRow({ UploadReferenceNumber: 42 })
      )

      expect(submission.referenceNumber).toBe('42')
    })

    test('Should read empty and missing values as not known', async () => {
      const { submission } = await onlySubmissionOf(
        apiRow({ SubmissionMnthYr: '', FileName: null })
      )

      expect(submission).toEqual(
        expect.objectContaining({ reportMonthYear: null, fileName: null })
      )
    })

    test('Should leave out rows of a process not asked for, without a reference, or that are not rows', async () => {
      answerWith([
        apiRow({ UploadReferenceNumber: 'DT-1', SubmissionProcessName: 'DT' }),
        apiRow({ UploadReferenceNumber: 'NONE-1', SubmissionProcessName: '' }),
        apiRow({ UploadReferenceNumber: '' }),
        apiRow({
          UploadReferenceNumber: 'AHR-1',
          SubmissionProcessName: 'AHR'
        }),
        'not a row',
        apiRow({ UploadReferenceNumber: 'BR-1' })
      ])

      const { submissions } = await getSubmissionPage(createRequest(), [
        batRabies
      ])

      expect(submissions.map(({ referenceNumber }) => referenceNumber)).toEqual(
        ['BR-1']
      )
    })

    describe('response', () => {
      test.each([
        ['wrapped in a list, as the API sends them', [API_ROWS]],
        ['as a list', API_ROWS]
      ])('Should read the rows %s', async (_shape, body) => {
        answerWithBody(body)

        expect(
          (await getSubmissionPage(createRequest(), bothReportTypes))
            .submissions
        ).toHaveLength(3)
      })

      test.each([
        ['[{}], as the API answers', [{}]],
        ['[[]]', [[]]],
        ['an empty body', null],
        ['an object', { data: API_ROWS }]
      ])('Should read %s as no reports', async (_shape, body) => {
        answerWithBody(body)

        expect(
          await getSubmissionPage(createRequest(), bothReportTypes)
        ).toEqual({ submissions: [], page: 1, hasNextPage: false })
      })

      test.each([
        [3, true],
        [4, false]
      ])(
        'Should take 3 rows, asking for %i a page, to have another page after them: %s',
        async (pageSize, hasNextPage) => {
          expect(
            await getSubmissionPage(createRequest(), bothReportTypes, {
              pageSize
            })
          ).toEqual(expect.objectContaining({ hasNextPage }))
        }
      )
    })

    test('Should read each page once per request', async () => {
      const request = createRequest()

      const first = await getSubmissionPage(request, bothReportTypes)

      expect(await getSubmissionPage(request, bothReportTypes)).toBe(first)
      await getSubmissionPage(request, bothReportTypes, { page: 2 })
      await getSubmissionPage(request, [batRabies])
      await getSubmissionPage(createRequest(), bothReportTypes)

      expect(submissionHistoryApi.fetchSubmissionPage).toHaveBeenCalledTimes(4)
    })

    test('Should log a failure with what the API team can trace it by, and throw it', async () => {
      const failure = new SubmissionHistoryApiError(
        'Submission history API responded 500',
        { status: 500, correlationId: 'corr-500' }
      )
      submissionHistoryApi.fetchSubmissionPage.mockRejectedValue(failure)

      const request = createRequest()

      await expect(
        getSubmissionPage(request, bothReportTypes, { page: 2 })
      ).rejects.toBe(failure)
      expect(request.logger.error).toHaveBeenCalledWith(
        {
          err: failure,
          processNames: 'BR,AHR',
          page: 2,
          status: 500,
          correlationId: 'corr-500'
        },
        'Submission history could not be read'
      )
    })

    test('Should log a failure that had no response', async () => {
      const failure = new TypeError('fetch failed')
      submissionHistoryApi.fetchSubmissionPage.mockRejectedValue(failure)

      const request = createRequest()

      await expect(getSubmissionPage(request, bothReportTypes)).rejects.toBe(
        failure
      )
      expect(request.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: null, correlationId: null }),
        'Submission history could not be read'
      )
    })
  })

  describe('reports just submitted', () => {
    // As pending-submissions.js keeps them, newest first
    const justSubmittedBr = {
      referenceNumber: 'NEW-BR-1',
      processName: 'BR',
      reportMonthYear: 'November 2026',
      submittedAt: '2026-11-25T10:44:45.559Z',
      fileName: '2026-11 bat rabies.xlsx'
    }
    const justSubmittedAhr = {
      referenceNumber: 'NEW-AHR-1',
      processName: 'AHR',
      reportMonthYear: 'October 2026',
      submittedAt: '2026-11-25T10:40:00.000Z',
      fileName: null
    }

    const references = ({ submissions }) =>
      submissions.map(({ referenceNumber }) => referenceNumber)

    test('Should lead the first page as processing, before the reports the API returns', async () => {
      pendingSubmissionsOf.mockResolvedValue([justSubmittedBr])

      const request = createRequest()
      const page = await getSubmissionPage(request, bothReportTypes)

      expect(pendingSubmissionsOf).toHaveBeenCalledWith(request, 'Test Lab 1')
      expect(page.submissions[0]).toEqual({
        referenceNumber: 'NEW-BR-1',
        reportType: batRabies,
        reportMonthYear: 'November 2026',
        submittedAt: '2026-11-25T10:44:45.559Z',
        fileName: '2026-11 bat rabies.xlsx',
        status: SUBMISSION_STATUS.PROCESSING
      })
      expect(references(page)).toEqual([
        'NEW-BR-1',
        'BR1-CCC-333',
        'AHR-BBB-222',
        'BR1-AAA-111'
      ])
    })

    test('Should give way to the report the API returns with the same reference', async () => {
      pendingSubmissionsOf.mockResolvedValue([
        justSubmittedBr,
        { ...justSubmittedAhr, referenceNumber: 'AHR-BBB-222' }
      ])

      const page = await getSubmissionPage(createRequest(), bothReportTypes)

      expect(references(page)).toEqual([
        'NEW-BR-1',
        'BR1-CCC-333',
        'AHR-BBB-222',
        'BR1-AAA-111'
      ])
      expect(page.submissions[2].status).toBe(SUBMISSION_STATUS.ACCEPTED)
    })

    test('Should only show the report types asked for', async () => {
      pendingSubmissionsOf.mockResolvedValue([
        justSubmittedBr,
        justSubmittedAhr
      ])

      expect(
        references(
          await getSubmissionPage(createRequest(), [animalHealthRegulations])
        )
      ).toEqual(['NEW-AHR-1', 'AHR-BBB-222'])
    })

    test('Should show one while the API returns none yet', async () => {
      answerWith([])
      pendingSubmissionsOf.mockResolvedValue([justSubmittedAhr])

      expect(await getSubmissionPage(createRequest(), bothReportTypes)).toEqual(
        {
          submissions: [
            {
              referenceNumber: 'NEW-AHR-1',
              reportType: animalHealthRegulations,
              reportMonthYear: 'October 2026',
              submittedAt: '2026-11-25T10:40:00.000Z',
              fileName: null,
              status: SUBMISSION_STATUS.PROCESSING
            }
          ],
          page: 1,
          hasNextPage: false
        }
      )
    })

    test('Should work out whether there is another page from the API alone', async () => {
      pendingSubmissionsOf.mockResolvedValue([justSubmittedBr])

      expect(
        await getSubmissionPage(createRequest(), bothReportTypes, {
          pageSize: 4
        })
      ).toEqual(expect.objectContaining({ hasNextPage: false }))
    })

    test('Should not add them to a later page', async () => {
      pendingSubmissionsOf.mockResolvedValue([justSubmittedBr])

      const page = await getSubmissionPage(createRequest(), bothReportTypes, {
        page: 2
      })

      expect(references(page)).not.toContain('NEW-BR-1')
      expect(pendingSubmissionsOf).not.toHaveBeenCalled()
    })

    test('Should not show them when the API cannot be read', async () => {
      submissionHistoryApi.fetchSubmissionPage.mockRejectedValue(
        new Error('timeout')
      )
      pendingSubmissionsOf.mockResolvedValue([justSubmittedBr])

      await expect(
        getSubmissionPage(createRequest(), bothReportTypes)
      ).rejects.toThrow('timeout')
      expect(pendingSubmissionsOf).not.toHaveBeenCalled()
    })

    test('Should not show them while the API is turned off', async () => {
      config.set('submissionHistoryApi.enabled', false)
      pendingSubmissionsOf.mockResolvedValue([justSubmittedBr])

      expect(
        (await getSubmissionPage(createRequest(), bothReportTypes)).submissions
      ).toEqual([])
      expect(pendingSubmissionsOf).not.toHaveBeenCalled()
    })

    test('Should name one as the latest report submitted', async () => {
      answerWith([API_ROWS[0]])
      pendingSubmissionsOf.mockResolvedValue([justSubmittedBr])

      expect(
        await getLatestSubmission(createRequest(), bothReportTypes)
      ).toEqual(
        expect.objectContaining({
          referenceNumber: 'NEW-BR-1',
          status: SUBMISSION_STATUS.PROCESSING
        })
      )
    })
  })

  describe('getLatestSubmission', () => {
    test('Should give the newest report of the report types, asking for one in one call', async () => {
      answerWith([API_ROWS[1]])

      const latest = await getLatestSubmission(createRequest(), bothReportTypes)

      expect(latest).toEqual(
        expect.objectContaining({
          referenceNumber: 'AHR-BBB-222',
          reportType: animalHealthRegulations
        })
      )
      expect(submissionHistoryApi.fetchSubmissionPage).toHaveBeenCalledTimes(1)
      expect(submissionHistoryApi.fetchSubmissionPage).toHaveBeenCalledWith(
        expect.objectContaining({
          processNames: ['BR', 'AHR'],
          page: 1,
          pageSize: 1
        })
      )
    })

    test('Should give null when the lab has submitted none', async () => {
      answerWith([])

      expect(
        await getLatestSubmission(createRequest(), bothReportTypes)
      ).toBeNull()
    })

    test('Should give null, asking nothing, for no report types', async () => {
      expect(await getLatestSubmission(createRequest(), [])).toBeNull()
      expect(submissionHistoryApi.fetchSubmissionPage).not.toHaveBeenCalled()
    })

    test('Should throw when the reports cannot be read', async () => {
      submissionHistoryApi.fetchSubmissionPage.mockRejectedValue(
        new Error('timeout')
      )

      await expect(
        getLatestSubmission(createRequest(), [batRabies])
      ).rejects.toThrow('timeout')
    })
  })
})
