import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypesByCode } from '#/server/forms/report-types.js'
import { NO_SUBMISSIONS_TEXT, PREVIOUS_SUBMISSIONS_PATH } from './controller.js'
import {
  SUBMISSION_STATUS,
  getSubmissionHistory,
  recordSubmission
} from './submission-history.js'

// Read through the real cookie unless a test gives the backend's statuses,
// which the cookie never holds
vi.mock(
  '#/server/routes/previous-submissions/submission-history.js',
  async (importOriginal) => {
    const original = await importOriginal()

    return {
      ...original,
      getSubmissionHistory: vi.fn(original.getSubmissionHistory)
    }
  }
)

const RECORD_PATH = '/test/record-submissions'

const batRabiesUpload = {
  referenceNumber: 'BR1-AAA-111',
  form: 'bat-rabies',
  processName: 'BR',
  submittedAt: '2026-03-03T10:15:00.000Z',
  fileName: '2026-02 BR.xlsx',
  reportMonthYear: 'February 2026'
}

const animalHealthRegulationsWebForm = {
  referenceNumber: 'AHR-BBB-222',
  form: 'animal-health-regulations-web-form',
  processName: 'AHR',
  submittedAt: '2026-04-02T09:00:00.000Z',
  reportMonthYear: 'March 2026'
}

/**
 * A signed-in session whose roles grant the given journeys.
 */
function authWithJourneys(journeys, organisationId = 'TestLab1') {
  return {
    strategy: 'session',
    credentials: {
      sessionId: 'test-session',
      user: { id: 'user-id', name: 'A Person', organisationId, journeys },
      claims: {}
    }
  }
}

const RESUBMIT_LINK =
  /<a class="govuk-link govuk-link--no-visited-state" href="#">Resubmit<span class="govuk-visually-hidden"> report ([^<]+)<\/span><\/a>/g

function resubmittedReferences(html) {
  return [...html.matchAll(RESUBMIT_LINK)].map(([, reference]) => reference)
}

function setNow(isoTime) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(isoTime))
}

function cookieOf(response, name) {
  return [response.headers['set-cookie']]
    .flat()
    .find((header) => header?.startsWith(`${name}=`))
    ?.split(';')[0]
}

describe('previous submissions routes', () => {
  let server
  let submissionsToRecord = []

  beforeAll(async () => {
    server = await createServer()

    // Records reports the way the output service does at submit, so the
    // page is read through the real cookie
    server.route({
      method: 'GET',
      path: RECORD_PATH,
      async handler(request, h) {
        for (const submission of submissionsToRecord) {
          await recordSubmission(request, submission)
        }

        return h.response().code(statusCodes.noContent)
      }
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * The page as seen by a user holding the given journeys, after their lab
   * submitted the given reports, oldest first, from this browser
   */
  async function getPreviousSubmissions({
    journeys = ['BR', 'AHR'],
    submissions = []
  } = {}) {
    const auth = authWithJourneys(journeys)
    let cookie

    if (submissions.length) {
      submissionsToRecord = submissions

      const recorded = await server.inject({
        method: 'GET',
        url: RECORD_PATH,
        auth
      })

      cookie = cookieOf(recorded, 'submissionHistory')
      expect(cookie).toBeDefined()
    }

    return server.inject({
      method: 'GET',
      url: PREVIOUS_SUBMISSIONS_PATH,
      auth,
      ...(cookie ? { headers: { cookie } } : {})
    })
  }

  test('Should send a signed-out user to sign in', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: PREVIOUS_SUBMISSIONS_PATH
    })

    expect(statusCode).toBe(statusCodes.redirect)
  })

  test('Should say so when the lab has submitted nothing', async () => {
    const { result, statusCode } = await getPreviousSubmissions()

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Previous submissions'))
    expect(result).toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
    expect(result).not.toEqual(expect.stringContaining('govuk-tabs'))
    expect(result).not.toEqual(expect.stringContaining('govuk-table'))
  })

  test('Should list the reports of a user who holds one report type in a single table', async () => {
    const { result, statusCode } = await getPreviousSubmissions({
      journeys: ['BR'],
      submissions: [batRabiesUpload]
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(expect.stringContaining('govuk-tabs'))
    expect(result).toEqual(expect.stringContaining('Bat rabies reports'))
    expect(result).toEqual(expect.stringContaining('govuk-table'))
    expect(result).not.toMatch(/>\s*Type\s*</)

    for (const heading of [
      'Period',
      'Submitted',
      'Method',
      'Reference',
      'Status',
      'Actions'
    ]) {
      expect(result).toMatch(
        new RegExp(`class="govuk-table__header"[^>]*>\\s*${heading}\\s*<`)
      )
    }

    for (const text of [
      'February 2026',
      '03/03/2026',
      '2026-02 BR.xlsx',
      'BR1-AAA-111'
    ]) {
      expect(result).toEqual(expect.stringContaining(text))
    }

    expect(result).not.toEqual(expect.stringContaining('File upload'))
  })

  test('Should show a report as processing, with nothing to do, for two minutes after it was submitted', async () => {
    setNow('2026-03-03T10:16:59.000Z')

    const { result } = await getPreviousSubmissions({
      journeys: ['BR'],
      submissions: [batRabiesUpload]
    })

    expect(result).toMatch(
      /<strong class="govuk-tag govuk-tag--blue">Processing<\/strong>/
    )
    expect(resubmittedReferences(result)).toEqual([])
  })

  test('Should then accept and reject reports alternately, offering to resubmit each', async () => {
    setNow('2026-05-01T00:00:00.000Z')

    const { result } = await getPreviousSubmissions({
      submissions: [batRabiesUpload, animalHealthRegulationsWebForm]
    })
    const allSubmissions = result.slice(
      result.indexOf('id="all-submissions"'),
      result.indexOf('id="bat-rabies-submissions"')
    )

    expect(allSubmissions).toMatch(
      /AHR-BBB-222[\s\S]*govuk-tag--red">Rejected[\s\S]*BR1-AAA-111[\s\S]*govuk-tag--green">Accepted/
    )
    expect(resubmittedReferences(allSubmissions)).toEqual([
      'AHR-BBB-222',
      'BR1-AAA-111'
    ])
  })

  test('Should tag each status the backend can give, offering to resubmit only those decided', async () => {
    const report = (referenceNumber, status) => ({
      referenceNumber,
      reportType: reportTypesByCode.get('BR'),
      reportMonthYear: 'February 2026',
      submittedAt: '2026-03-03T10:15:00.000Z',
      fileName: null,
      status
    })

    getSubmissionHistory.mockResolvedValueOnce([
      report('REF-1', SUBMISSION_STATUS.PROCESSING),
      report('REF-2', SUBMISSION_STATUS.ACCEPTED),
      report('REF-3', SUBMISSION_STATUS.REJECTED)
    ])

    const { result } = await getPreviousSubmissions({ journeys: ['BR'] })

    for (const tag of [
      'govuk-tag--blue">Processing',
      'govuk-tag--green">Accepted',
      'govuk-tag--red">Rejected'
    ]) {
      expect(result).toEqual(expect.stringContaining(tag))
    }

    expect(resubmittedReferences(result)).toEqual(['REF-2', 'REF-3'])
  })

  test('Should keep each report on one line, letting only a long file name wrap', async () => {
    const { result } = await getPreviousSubmissions({
      submissions: [batRabiesUpload, animalHealthRegulationsWebForm]
    })

    expect(result).toEqual(
      expect.stringContaining('govuk-table app-submissions-table')
    )
    expect(result).toMatch(
      /class="govuk-table__cell app-submissions-table__file-name"[^>]*>\s*2026-02 BR\.xlsx\s*</
    )
    expect(result).not.toMatch(
      /class="govuk-table__cell app-submissions-table__file-name"[^>]*>\s*Web form\s*</
    )
  })

  test('Should offer all reports and each report type as tabs to a user who holds both', async () => {
    const { result, statusCode } = await getPreviousSubmissions({
      submissions: [batRabiesUpload, animalHealthRegulationsWebForm]
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('govuk-tabs'))

    const tabPositions = [
      'href="#all-submissions"',
      'href="#bat-rabies-submissions"',
      'href="#animal-health-regulations-submissions"'
    ].map((href) => result.indexOf(href))

    expect(tabPositions.every((position) => position >= 0)).toBe(true)
    expect(tabPositions).toEqual([...tabPositions].sort((a, b) => a - b))

    for (const id of [
      'all-submissions',
      'bat-rabies-submissions',
      'animal-health-regulations-submissions'
    ]) {
      expect(result).toEqual(expect.stringContaining(`id="${id}"`))
    }

    expect(result).toEqual(expect.stringContaining('All submissions'))
    expect(result).toEqual(
      expect.stringContaining('Animal Health Regulations reports')
    )
    // Only the table of all reports names each report's type, by its code
    expect(result.match(/>\s*Type\s*</g)).toHaveLength(1)
    expect(result.match(/class="govuk-table__cell">\s*BR\s*</g)).toHaveLength(1)
    expect(result.match(/class="govuk-table__cell">\s*AHR\s*</g)).toHaveLength(
      1
    )
    expect(result).toEqual(expect.stringContaining('Web form'))
  })

  test('Should list the newest report first', async () => {
    const { result } = await getPreviousSubmissions({
      submissions: [batRabiesUpload, animalHealthRegulationsWebForm]
    })
    const allSubmissions = result.slice(
      result.indexOf('id="all-submissions"'),
      result.indexOf('id="bat-rabies-submissions"')
    )

    expect(allSubmissions.indexOf('AHR-BBB-222')).toBeLessThan(
      allSubmissions.indexOf('BR1-AAA-111')
    )
  })

  test('Should say so in the tab of a report type the lab has not submitted', async () => {
    const { result } = await getPreviousSubmissions({
      submissions: [batRabiesUpload]
    })

    expect(result).toEqual(expect.stringContaining('govuk-tabs'))
    expect(result).toEqual(
      expect.stringContaining(
        'You have not submitted any Animal Health Regulations reports yet.'
      )
    )
    expect(result).not.toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
  })

  test('Should hide reports of a type the user does not hold', async () => {
    const { result } = await getPreviousSubmissions({
      journeys: ['BR'],
      submissions: [animalHealthRegulationsWebForm]
    })

    expect(result).toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
    expect(result).not.toEqual(expect.stringContaining('AHR-BBB-222'))
  })

  test('Should show nothing to a user who holds no report type', async () => {
    const { result, statusCode } = await getPreviousSubmissions({
      journeys: [],
      submissions: [batRabiesUpload]
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
    expect(result).not.toEqual(expect.stringContaining('BR1-AAA-111'))
  })

  test("Should escape the user's file name", async () => {
    const { result } = await getPreviousSubmissions({
      journeys: ['BR'],
      submissions: [
        { ...batRabiesUpload, fileName: '2026-02 <script>x</script>.xlsx' }
      ]
    })

    expect(result).not.toEqual(expect.stringContaining('<script>x</script>'))
    expect(result).toEqual(
      expect.stringContaining('2026-02 &lt;script&gt;x&lt;/script&gt;.xlsx')
    )
  })

  test('Should show the trail back to Submission Welcome', async () => {
    const { result } = await getPreviousSubmissions()

    expect(result).toEqual(expect.stringContaining('govuk-breadcrumbs'))
    expect(result).toEqual(
      expect.stringContaining('href="/submission-welcome"')
    )
  })
})
