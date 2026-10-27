import Iron from '@hapi/iron'

import { config } from '#/config/config.js'
import { reportTypesByCode } from '#/server/forms/report-types.js'
import {
  SUBMISSION_STATUS,
  getSubmissionHistory,
  recordSubmission,
  registerSubmissionHistoryStore,
  writeRecordedSubmissions
} from './submission-history.js'

const COOKIE_NAME = 'submissionHistory'
const BROWSER_COOKIE_LIMIT = 4096

const batRabies = reportTypesByCode.get('BR')
const animalHealthRegulations = reportTypesByCode.get('AHR')

// When the reports below were submitted, and a minute later
const SUBMITTED_AT = '2026-03-03T10:15:00.000Z'
const WHILE_PROCESSING = '2026-03-03T10:16:00.000Z'

function setNow(isoTime) {
  vi.setSystemTime(new Date(isoTime))
}

/**
 * The record the output service writes as submission.json, with only what
 * the store reads
 */
function buildSubmission(overrides = {}) {
  return {
    referenceNumber: 'ABC-DEF-GHJ',
    form: 'bat-rabies',
    processName: 'BR',
    organisationId: 'TestLab1',
    submittedAt: SUBMITTED_AT,
    fileName: '2026-02 BR.xlsx',
    reportMonthYear: 'February 2026',
    ...overrides
  }
}

function storedEntry(
  index,
  { code = 'BR', fileName = null, decision = SUBMISSION_STATUS.ACCEPTED } = {}
) {
  return [
    code,
    `REF-${index}`,
    'February 2026',
    SUBMITTED_AT,
    fileName,
    decision
  ]
}

/**
 * A request from a user of the given lab, carrying the given cookie value
 */
function createRequest({ lab = 'TestLab1', cookie } = {}) {
  return {
    auth: { credentials: { user: { id: 'user-id', organisationId: lab } } },
    state: cookie === undefined ? {} : { [COOKIE_NAME]: cookie },
    app: {}
  }
}

function createToolkit() {
  return { state: vi.fn(), continue: Symbol('continue') }
}

// What the store writes to the cookie as the response goes out
function writtenCookie(request) {
  const h = createToolkit()

  expect(writeRecordedSubmissions(request, h)).toBe(h.continue)
  expect(h.state).toHaveBeenCalledTimes(1)

  const [name, value] = h.state.mock.calls[0]

  expect(name).toBe(COOKIE_NAME)

  return value
}

describe('submission history store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    setNow(WHILE_PROCESSING)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getSubmissionHistory', () => {
    test('Should read no reports without the cookie', async () => {
      expect(await getSubmissionHistory(createRequest())).toEqual([])
    })

    test('Should read no reports for a lab the cookie does not hold', async () => {
      const request = createRequest({
        lab: 'TestLab2',
        cookie: [['TestLab1', [storedEntry(1)]]]
      })

      expect(await getSubmissionHistory(request)).toEqual([])
    })

    test("Should read the lab's reports in the order they were kept, with their report type", async () => {
      const request = createRequest({
        cookie: [
          [
            'TestLab1',
            [
              [
                'AHR',
                'REF-2',
                'March 2026',
                '2026-03-03T10:15:30.000Z',
                null,
                'rejected'
              ],
              [
                'BR',
                'REF-1',
                'February 2026',
                SUBMITTED_AT,
                '2026-02 BR.xlsx',
                'accepted'
              ]
            ]
          ]
        ]
      })

      expect(await getSubmissionHistory(request)).toEqual([
        {
          referenceNumber: 'REF-2',
          reportType: animalHealthRegulations,
          reportMonthYear: 'March 2026',
          submittedAt: '2026-03-03T10:15:30.000Z',
          fileName: null,
          status: SUBMISSION_STATUS.PROCESSING
        },
        {
          referenceNumber: 'REF-1',
          reportType: batRabies,
          reportMonthYear: 'February 2026',
          submittedAt: SUBMITTED_AT,
          fileName: '2026-02 BR.xlsx',
          status: SUBMISSION_STATUS.PROCESSING
        }
      ])
    })

    describe('status', () => {
      const cookie = [
        [
          'TestLab1',
          [
            storedEntry(2, { decision: SUBMISSION_STATUS.REJECTED }),
            storedEntry(1, { decision: SUBMISSION_STATUS.ACCEPTED })
          ]
        ]
      ]
      const statuses = async () =>
        (await getSubmissionHistory(createRequest({ cookie }))).map(
          ({ status }) => status
        )

      test('Should be processing for two minutes after the report was submitted', async () => {
        setNow('2026-03-03T10:16:59.999Z')

        expect(await statuses()).toEqual([
          SUBMISSION_STATUS.PROCESSING,
          SUBMISSION_STATUS.PROCESSING
        ])
      })

      test("Should then be the report's decision", async () => {
        setNow('2026-03-03T10:17:00.000Z')

        expect(await statuses()).toEqual([
          SUBMISSION_STATUS.REJECTED,
          SUBMISSION_STATUS.ACCEPTED
        ])
      })

      test('Should read a report kept before decisions as accepted', async () => {
        setNow('2026-03-03T10:17:00.000Z')

        const request = createRequest({
          cookie: [
            [
              'TestLab1',
              [
                ['BR', 'REF-1', 'February 2026', SUBMITTED_AT],
                ['BR', 'REF-2', 'February 2026', SUBMITTED_AT, 'old.xlsx']
              ]
            ]
          ]
        })

        expect(
          (await getSubmissionHistory(request)).map(({ status }) => status)
        ).toEqual([SUBMISSION_STATUS.ACCEPTED, SUBMISSION_STATUS.ACCEPTED])
      })
    })

    test('Should drop report types no longer offered and entries that are not reports', async () => {
      const request = createRequest({
        cookie: [
          [
            'TestLab1',
            [
              storedEntry(1),
              ['DT', 'REF-2', null, '2026-03-03T10:15:00.000Z'],
              ['BR', 42, 'February 2026', '2026-03-03T10:15:00.000Z'],
              ['BR', 'REF-3', 'February 2026', 'not a date'],
              { code: 'BR' }
            ]
          ]
        ]
      })

      expect(
        (await getSubmissionHistory(request)).map(
          ({ referenceNumber }) => referenceNumber
        )
      ).toEqual(['REF-1'])
    })

    test('Should read a missing report month as null', async () => {
      const request = createRequest({
        cookie: [['TestLab1', [['BR', 'REF-1', 7, '2026-03-03T10:15:00.000Z']]]]
      })

      expect(await getSubmissionHistory(request)).toEqual([
        expect.objectContaining({ reportMonthYear: null })
      ])
    })

    test.each([
      ['a string', 'TestLab1'],
      ['an object keyed by lab', { TestLab1: [storedEntry(1)] }],
      ['entries that are not pairs', ['TestLab1', [storedEntry(1)]]],
      ['a pair without reports', [['TestLab1', { 'REF-1': 'BR' }]]],
      ['a pair without a lab', [[42, [storedEntry(1)]]]]
    ])('Should read no reports from %s', async (_description, cookie) => {
      expect(await getSubmissionHistory(createRequest({ cookie }))).toEqual([])
    })

    test('Should read no reports for a user without a lab', async () => {
      const request = createRequest({
        lab: null,
        cookie: [['TestLab1', [storedEntry(1)]]]
      })

      expect(await getSubmissionHistory(request)).toEqual([])
    })

    test('Should read once per request', async () => {
      const request = createRequest({
        cookie: [['TestLab1', [storedEntry(1)]]]
      })
      const first = await getSubmissionHistory(request)

      request.state[COOKIE_NAME] = []

      expect(await getSubmissionHistory(request)).toBe(first)
    })
  })

  describe('recordSubmission', () => {
    test("Should keep an uploaded report as the lab's latest, with its file name, to be accepted", async () => {
      const request = createRequest()

      await recordSubmission(request, buildSubmission())

      expect(writtenCookie(request)).toEqual([
        [
          'TestLab1',
          [
            [
              'BR',
              'ABC-DEF-GHJ',
              'February 2026',
              SUBMITTED_AT,
              '2026-02 BR.xlsx',
              'accepted'
            ]
          ]
        ]
      ])
    })

    test("Should decide the opposite of the lab's latest report each time", async () => {
      const request = createRequest()

      for (const referenceNumber of ['REF-1', 'REF-2', 'REF-3']) {
        await recordSubmission(request, buildSubmission({ referenceNumber }))
      }

      setNow('2026-03-03T10:17:00.000Z')

      expect(
        (
          await getSubmissionHistory(
            createRequest({ cookie: writtenCookie(request) })
          )
        ).map(({ referenceNumber, status }) => [referenceNumber, status])
      ).toEqual([
        ['REF-3', SUBMISSION_STATUS.ACCEPTED],
        ['REF-2', SUBMISSION_STATUS.REJECTED],
        ['REF-1', SUBMISSION_STATUS.ACCEPTED]
      ])
    })

    test("Should alternate each lab's decisions on their own", async () => {
      const request = createRequest({
        cookie: [
          [
            'TestLab2',
            [storedEntry(2, { decision: SUBMISSION_STATUS.ACCEPTED })]
          ],
          [
            'TestLab1',
            [storedEntry(1, { decision: SUBMISSION_STATUS.REJECTED })]
          ]
        ]
      })

      await recordSubmission(request, buildSubmission())

      const [[lab, [latest]]] = writtenCookie(request)

      expect(lab).toBe('TestLab1')
      expect(latest).toContain('ABC-DEF-GHJ')
      expect(latest.at(-1)).toBe('accepted')
    })

    test('Should keep a web form report without a file name', async () => {
      const request = createRequest()

      await recordSubmission(
        request,
        buildSubmission({
          form: 'animal-health-regulations-web-form',
          processName: 'AHR',
          fileName: undefined
        })
      )

      expect(writtenCookie(request)).toEqual([
        [
          'TestLab1',
          [
            [
              'AHR',
              'ABC-DEF-GHJ',
              'February 2026',
              SUBMITTED_AT,
              null,
              'accepted'
            ]
          ]
        ]
      ])
    })

    test('Should be read back by the same request', async () => {
      const request = createRequest()

      expect(await getSubmissionHistory(request)).toEqual([])

      await recordSubmission(request, buildSubmission())

      expect(await getSubmissionHistory(request)).toEqual([
        {
          referenceNumber: 'ABC-DEF-GHJ',
          reportType: batRabies,
          reportMonthYear: 'February 2026',
          submittedAt: '2026-03-03T10:15:00.000Z',
          fileName: '2026-02 BR.xlsx',
          status: SUBMISSION_STATUS.PROCESSING
        }
      ])
    })

    test('Should be read back by a later request carrying the cookie', async () => {
      const request = createRequest()

      await recordSubmission(request, buildSubmission())

      expect(
        await getSubmissionHistory(
          createRequest({ cookie: writtenCookie(request) })
        )
      ).toEqual([expect.objectContaining({ referenceNumber: 'ABC-DEF-GHJ' })])
    })

    test('Should keep every report recorded by the same request', async () => {
      const request = createRequest()

      await recordSubmission(
        request,
        buildSubmission({ referenceNumber: 'REF-1' })
      )
      await recordSubmission(
        request,
        buildSubmission({ referenceNumber: 'REF-2' })
      )

      expect(
        (await getSubmissionHistory(request)).map(
          ({ referenceNumber }) => referenceNumber
        )
      ).toEqual(['REF-2', 'REF-1'])
    })

    test('Should put the lab first with its latest report first, keeping other labs', async () => {
      const request = createRequest({
        cookie: [
          ['TestLab2', [storedEntry(2)]],
          ['TestLab1', [storedEntry(1)]]
        ]
      })

      await recordSubmission(request, buildSubmission())

      expect(writtenCookie(request)).toEqual([
        [
          'TestLab1',
          [
            expect.arrayContaining(['ABC-DEF-GHJ']),
            expect.arrayContaining(['REF-1'])
          ]
        ],
        ['TestLab2', [storedEntry(2)]]
      ])
    })

    test('Should forget the least recently saved lab beyond two', async () => {
      const request = createRequest({
        lab: 'TestLab3',
        cookie: [
          ['TestLab1', [storedEntry(1)]],
          ['TestLab2', [storedEntry(2)]]
        ]
      })

      await recordSubmission(request, buildSubmission())

      expect(writtenCookie(request).map(([lab]) => lab)).toEqual([
        'TestLab3',
        'TestLab1'
      ])
    })

    test("Should forget the lab's oldest reports beyond ten", async () => {
      const request = createRequest({
        cookie: [
          [
            'TestLab1',
            Array.from({ length: 10 }, (_, index) => storedEntry(index + 1))
          ]
        ]
      })

      await recordSubmission(request, buildSubmission())

      const [[, entries]] = writtenCookie(request)

      expect(entries).toHaveLength(10)
      expect(entries[0]).toContain('ABC-DEF-GHJ')
      expect(entries.at(-1)).toContain('REF-9')
    })

    test('Should drop entries that are not reports, and labs left with none', async () => {
      const request = createRequest({
        cookie: [
          ['TestLab2', [['DT', 'REF-2', null, '2026-03-03T10:15:00.000Z']]],
          ['TestLab1', [storedEntry(1), 'not a report']]
        ]
      })

      await recordSubmission(request, buildSubmission())

      expect(writtenCookie(request)).toEqual([
        ['TestLab1', [expect.any(Array), storedEntry(1)]]
      ])
    })

    test('Should keep two labs of ten reports each with the usual file names', async () => {
      const lab = (id, code) => [
        id,
        Array.from({ length: 10 }, (_, index) =>
          storedEntry(index, { code, fileName: `2026-0${index} ${code}.xlsx` })
        )
      ]
      const request = createRequest({
        cookie: [lab('TestLab1', 'AHR'), lab('TestLab2', 'BR')]
      })

      await recordSubmission(request, buildSubmission())

      const written = writtenCookie(request)

      expect(written.map(([, entries]) => entries.length)).toEqual([10, 10])
    })

    test.each([
      ['plain', 'x'],
      ['accented', 'é'],
      ['CJK', '漢'],
      ['emoji', '📄']
    ])(
      'Should stay inside the browser cookie limit with the longest %s file names',
      async (_description, character) => {
        const longName = character.repeat(300)
        const lab = (id) => [
          id,
          Array.from({ length: 10 }, (_, index) =>
            storedEntry(index, { code: 'AHR', fileName: longName })
          )
        ]
        const request = createRequest({
          cookie: [lab('TestLab1'), lab('TestLab2')]
        })

        await recordSubmission(request, buildSubmission({ fileName: longName }))

        const written = writtenCookie(request)
        const sealed = await Iron.seal(
          written,
          config.get('session.cookie.password'),
          Iron.defaults
        )

        expect(`${COOKIE_NAME}=${sealed}`.length).toBeLessThan(
          BROWSER_COOKIE_LIMIT
        )
        // The latest report is always kept, its name cut to 255 characters
        expect(written[0][1][0]).toContain('ABC-DEF-GHJ')
        expect(Array.from(written[0][1][0][4])).toHaveLength(255)
      }
    )

    test.each([
      ['a record that is not a report', { processName: 'DT' }],
      ['a record of no report type', { processName: null }],
      ['a record without a submission time', { submittedAt: undefined }]
    ])('Should keep nothing for %s', async (_description, overrides) => {
      const request = createRequest()
      const h = createToolkit()

      await recordSubmission(request, buildSubmission(overrides))
      writeRecordedSubmissions(request, h)

      expect(h.state).not.toHaveBeenCalled()
      expect(await getSubmissionHistory(request)).toEqual([])
    })

    test('Should keep nothing for a user without a lab', async () => {
      const request = createRequest({ lab: null })
      const h = createToolkit()

      await recordSubmission(request, buildSubmission())
      writeRecordedSubmissions(request, h)

      expect(h.state).not.toHaveBeenCalled()
      expect(await getSubmissionHistory(request)).toEqual([])
    })
  })

  describe('writeRecordedSubmissions', () => {
    test('Should write nothing when no report was recorded', () => {
      const h = createToolkit()

      expect(writeRecordedSubmissions(createRequest(), h)).toBe(h.continue)
      expect(h.state).not.toHaveBeenCalled()
    })
  })

  describe('registerSubmissionHistoryStore', () => {
    test('Should register an encrypted, long-lived, HTTP-only cookie and its writer', () => {
      const server = { state: vi.fn(), ext: vi.fn() }

      registerSubmissionHistoryStore(server)

      expect(server.state).toHaveBeenCalledWith(
        COOKIE_NAME,
        expect.objectContaining({
          ttl: 31536000000,
          encoding: 'iron',
          password: expect.any(String),
          path: '/',
          isHttpOnly: true,
          isSameSite: 'Lax',
          clearInvalid: true
        })
      )
      expect(server.ext).toHaveBeenCalledWith(
        'onPreResponse',
        writeRecordedSubmissions
      )
    })
  })
})
