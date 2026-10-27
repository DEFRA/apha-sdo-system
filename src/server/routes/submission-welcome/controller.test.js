import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypes, reportTypesByCode } from '#/server/forms/report-types.js'
import { getLabDiagnosticTests } from '../diagnostic-tests/lab-diagnostic-tests.js'
import { getSubmissionHistory } from '../previous-submissions/submission-history.js'
import { REPORT_METHOD } from '../report-method/controller.js'
import { DEFINED_LAB_DIAGNOSTIC_TESTS } from '#/test-helpers/lab-diagnostic-tests.js'
import {
  dropWebFormDraft,
  saveWebFormDraft
} from '#/test-helpers/web-form-draft.js'
import {
  NO_SUBMISSION_HISTORY_HINT,
  VIEW_SUBMISSION_HISTORY
} from './controller.js'

// Labs have defined their diagnostic tests unless a test says otherwise
vi.mock(
  '#/server/routes/diagnostic-tests/lab-diagnostic-tests.js',
  async (importOriginal) =>
    (
      await import('#/test-helpers/lab-diagnostic-tests.js')
    ).mockLabDiagnosticTestsDefined(importOriginal)
)

// Labs have submitted nothing unless a test says otherwise
vi.mock(
  '#/server/routes/previous-submissions/submission-history.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    getSubmissionHistory: vi.fn(async () => [])
  })
)

/**
 * A report as the submission history store reads it back
 */
function submittedReport(code, overrides = {}) {
  return {
    referenceNumber: `${code}-REF`,
    reportType: reportTypesByCode.get(code),
    reportMonthYear: 'February 2026',
    submittedAt: '2026-03-03T10:15:00.000Z',
    fileName: null,
    status: 'processing',
    ...overrides
  }
}

const BANNER_HEADING =
  'You need to set up your diagnostic tests before you can submit an Animal Health Regulations report.'
const UPDATE_DIAGNOSTIC_TESTS_VALUE = `value="${REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS}"`

function getCookieValue(response, name) {
  const setCookieHeaders = [response.headers['set-cookie']].flat()
  const cookie = setCookieHeaders.find((header) =>
    header?.startsWith(`${name}=`)
  )

  return cookie?.split(';')[0].split('=')[1]
}

const NO_REPORT_TYPES_MESSAGE = 'not assigned to any report type'

/**
 * A signed-in session whose Entra roles grant the given journeys.
 */
function authWithJourneys(journeys) {
  return {
    strategy: 'session',
    credentials: {
      sessionId: 'test-session',
      user: {
        id: 'user-id',
        name: 'A Person',
        organisationId: 'TestLab1',
        journeys
      },
      claims: {}
    }
  }
}

describe('submission welcome routes', () => {
  let server
  const auth = authWithJourneys(['BR', 'AHR'])

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  function getSubmissionWelcome(authOverride = auth) {
    return server.inject({
      method: 'GET',
      url: '/submission-welcome',
      auth: authOverride
    })
  }

  async function postSubmissionWelcome(payload = {}, authOverride = auth) {
    const getResponse = await getSubmissionWelcome(authOverride)
    const crumb = getCookieValue(getResponse, 'crumb')

    return server.inject({
      method: 'POST',
      url: '/submission-welcome',
      auth: authOverride,
      headers: { cookie: `crumb=${crumb}` },
      payload: { ...payload, crumb }
    })
  }

  describe('GET /submission-welcome', () => {
    test('Should render a radio option for every report type the user holds', async () => {
      const { result, statusCode } = await getSubmissionWelcome()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('What would you like to do?')
      )
      expect(result).toEqual(expect.stringContaining('Laboratory name'))
      expect(result).toEqual(expect.stringContaining('TestLab1'))
      expect(result).toEqual(expect.stringContaining('Reporting person'))
      expect(result).toEqual(expect.stringContaining('A Person'))

      for (const reportType of reportTypes) {
        expect(result).toEqual(expect.stringContaining(reportType.title))
        expect(result).toEqual(
          expect.stringContaining(`value="${reportType.slug}"`)
        )
      }

      expect(result).not.toEqual(
        expect.stringContaining(NO_REPORT_TYPES_MESSAGE)
      )
    })

    test.each(reportTypes)(
      'Should only offer $title to a user who holds just that journey',
      async (allowed) => {
        const { result, statusCode } = await getSubmissionWelcome(
          authWithJourneys([allowed.code])
        )

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toEqual(
          expect.stringContaining(`value="${allowed.slug}"`)
        )

        for (const other of reportTypes.filter((r) => r !== allowed)) {
          expect(result).not.toEqual(
            expect.stringContaining(`value="${other.slug}"`)
          )
        }
      }
    )

    test('Should explain when the user holds no report type', async () => {
      const { result, statusCode } = await getSubmissionWelcome(
        authWithJourneys([])
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining(NO_REPORT_TYPES_MESSAGE))

      for (const reportType of reportTypes) {
        expect(result).not.toEqual(
          expect.stringContaining(`value="${reportType.slug}"`)
        )
      }

      // History stays available
      expect(result).toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
    })

    test('Should not offer the diagnostic tests, which are updated within Animal Health Regulations', async () => {
      const { result, statusCode } = await getSubmissionWelcome()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining(UPDATE_DIAGNOSTIC_TESTS_VALUE)
      )
      expect(result).not.toEqual(
        expect.stringContaining('Update your diagnostic tests in use')
      )
    })

    test('Should list the report types, then history', async () => {
      const { result } = await getSubmissionWelcome()

      const positions = [
        ...reportTypes.map((reportType) => `value="${reportType.slug}"`),
        `value="${VIEW_SUBMISSION_HISTORY}"`
      ].map((value) => result.indexOf(value))

      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    })

    test('Should render the submission history option', async () => {
      const { result, statusCode } = await getSubmissionWelcome()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
      expect(result).toEqual(
        expect.stringContaining('View your laboratory submission history')
      )
    })

    test('Should say when the lab has submitted no report yet', async () => {
      const { result } = await getSubmissionWelcome()

      expect(result).toEqual(
        expect.stringContaining(NO_SUBMISSION_HISTORY_HINT)
      )
      expect(result).not.toEqual(
        expect.stringContaining('Last report submitted')
      )
    })

    test('Should name the last report submitted', async () => {
      getSubmissionHistory.mockResolvedValueOnce([
        submittedReport('AHR', { reportMonthYear: 'March 2026' }),
        submittedReport('BR')
      ])

      const { result } = await getSubmissionWelcome()

      expect(result).toEqual(
        expect.stringContaining(
          'Last report submitted: Animal Health Regulations report for March 2026'
        )
      )
      expect(result).not.toEqual(
        expect.stringContaining(NO_SUBMISSION_HISTORY_HINT)
      )
    })

    test('Should only name a report of a type the user holds', async () => {
      getSubmissionHistory.mockResolvedValueOnce([
        submittedReport('AHR', { reportMonthYear: 'March 2026' }),
        submittedReport('BR')
      ])

      const { result } = await getSubmissionWelcome(authWithJourneys(['BR']))

      expect(result).toEqual(
        expect.stringContaining(
          'Last report submitted: Bat rabies report for February 2026'
        )
      )
    })

    test('Should say none was submitted when the only reports are of a type the user does not hold', async () => {
      getSubmissionHistory.mockResolvedValueOnce([submittedReport('AHR')])

      const { result } = await getSubmissionWelcome(authWithJourneys(['BR']))

      expect(result).toEqual(
        expect.stringContaining(NO_SUBMISSION_HISTORY_HINT)
      )
    })

    test('Should name the report type alone when the report month is not known', async () => {
      getSubmissionHistory.mockResolvedValueOnce([
        submittedReport('BR', { reportMonthYear: null })
      ])

      const { result } = await getSubmissionWelcome()

      expect(result).toMatch(/Last report submitted: Bat rabies report\s*</)
    })

    test('Should offer each report type as submit a report', async () => {
      const { result } = await getSubmissionWelcome()

      expect(result).toEqual(
        expect.stringContaining('Submit a Bat rabies report')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'Use this service to submit your monthly bat rabies reports. The information you provide helps monitor and manage health threats and disease in bat populations across the UK and the British Isles.'
        )
      )
      expect(result).toEqual(
        expect.stringContaining('Submit an Animal Health Regulations report')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'Submit monthly disease reports using this service. Your reports help monitor animal health and support the management of disease threats across the UK.'
        )
      )
    })

    test('Should leave out a blank laboratory or reporting person', async () => {
      const { result } = await getSubmissionWelcome({
        strategy: 'session',
        credentials: {
          sessionId: 'test-session',
          user: { id: 'user-id', name: '', organisationId: null, journeys: [] },
          claims: {}
        }
      })

      expect(result).not.toEqual(expect.stringContaining('Laboratory name'))
      expect(result).not.toEqual(expect.stringContaining('Reporting person'))
    })
  })

  describe('POST /submission-welcome', () => {
    test.each(reportTypes.filter((reportType) => !reportType.webFormSlug))(
      'Should redirect straight into the $slug journey, which is upload only',
      async ({ slug }) => {
        const { statusCode, headers } = await postSubmissionWelcome({
          submissionAction: slug
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(`/${slug}`)
      }
    )

    test.each(reportTypes.filter((reportType) => reportType.webFormSlug))(
      'Should ask how to report $slug, which can also be a web form',
      async ({ slug }) => {
        const { statusCode, headers } = await postSubmissionWelcome({
          submissionAction: slug
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(`/${slug}/how-to-report`)
      }
    )

    test('Should offer both report methods for animal health regulations', async () => {
      // Guards the fixture: the registry must keep one of each kind for the
      // two cases above to mean anything
      expect(
        reportTypes.map((reportType) => Boolean(reportType.webFormSlug))
      ).toEqual([false, true])

      const { headers } = await postSubmissionWelcome({
        submissionAction: 'animal-health-regulations'
      })

      expect(headers.location).toBe('/animal-health-regulations/how-to-report')
    })

    test('Should redirect back when a report type the user does not hold is posted', async () => {
      const { statusCode, headers } = await postSubmissionWelcome(
        { submissionAction: 'animal-health-regulations' },
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test.each([[['BR', 'AHR']], [['AHR']], [['BR']], [[]]])(
      'Should not open the diagnostic tests from here for %j',
      async (journeys) => {
        const { statusCode, headers } = await postSubmissionWelcome(
          { submissionAction: REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS },
          authWithJourneys(journeys)
        )

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe('/submission-welcome')
      }
    )

    test.each([[['BR', 'AHR']], [['BR']], [[]]])(
      'Should continue to the previous submissions page for %j',
      async (journeys) => {
        const { statusCode, headers } = await postSubmissionWelcome(
          { submissionAction: VIEW_SUBMISSION_HISTORY },
          authWithJourneys(journeys)
        )

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe('/previous-submissions')
      }
    )

    test('Should redirect back when no option is selected', async () => {
      const { statusCode, headers } = await postSubmissionWelcome()

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should redirect back when an unknown option is selected', async () => {
      const { statusCode, headers } = await postSubmissionWelcome({
        submissionAction: 'not-a-report-type'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })
  })

  describe('before the lab has defined its diagnostic tests', () => {
    const radioCount = (html) => html.match(/name="submissionAction"/g).length

    beforeEach(() => {
      getLabDiagnosticTests.mockResolvedValue(null)
    })

    afterEach(() => {
      getLabDiagnosticTests.mockResolvedValue(DEFINED_LAB_DIAGNOSTIC_TESTS)
    })

    test('Should only offer Animal Health Regulations to a user who holds just that', async () => {
      const { result, statusCode } = await getSubmissionWelcome(
        authWithJourneys(['AHR'])
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('value="animal-health-regulations"')
      )
      expect(result).not.toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
      expect(result).not.toEqual(
        expect.stringContaining(UPDATE_DIAGNOSTIC_TESTS_VALUE)
      )
      expect(radioCount(result)).toBe(1)
      // Holding a report type, even held back, is not holding none
      expect(result).not.toEqual(
        expect.stringContaining(NO_REPORT_TYPES_MESSAGE)
      )
    })

    test('Should keep Bat rabies and history for a user who also holds it', async () => {
      const { result } = await getSubmissionWelcome(
        authWithJourneys(['BR', 'AHR'])
      )

      expect(result).toEqual(expect.stringContaining('value="bat-rabies"'))
      expect(result).toEqual(
        expect.stringContaining('value="animal-health-regulations"')
      )
      expect(result).toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
      expect(radioCount(result)).toBe(3)
    })

    test.each([[['AHR']], [['BR', 'AHR']]])(
      'Should leave explaining the diagnostic tests to how to report for %j',
      async (journeys) => {
        const { result } = await getSubmissionWelcome(
          authWithJourneys(journeys)
        )

        expect(result).not.toEqual(
          expect.stringContaining('govuk-notification-banner')
        )
        expect(result).not.toEqual(expect.stringContaining(BANNER_HEADING))
      }
    )

    test('Should neither hold back nor ask about a user who holds only Bat rabies', async () => {
      const { result } = await getSubmissionWelcome(authWithJourneys(['BR']))

      expect(result).toEqual(expect.stringContaining('value="bat-rabies"'))
      expect(result).not.toEqual(expect.stringContaining(BANNER_HEADING))
      expect(getLabDiagnosticTests).not.toHaveBeenCalled()
    })

    test('Should continue into how to report Animal Health Regulations, where the tests are defined', async () => {
      const { statusCode, headers } = await postSubmissionWelcome({
        submissionAction: 'animal-health-regulations'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/animal-health-regulations/how-to-report')
    })

    test('Should still continue into Bat rabies', async () => {
      const { statusCode, headers } = await postSubmissionWelcome({
        submissionAction: 'bat-rabies'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/bat-rabies')
    })
  })

  test('Should not show the banner once the lab has defined its diagnostic tests', async () => {
    const { result } = await getSubmissionWelcome(authWithJourneys(['AHR']))

    expect(result).toEqual(
      expect.stringContaining('value="animal-health-regulations"')
    )
    expect(result).not.toEqual(expect.stringContaining(BANNER_HEADING))
  })

  test('Should not mention a saved web form report; that is for how to report', async () => {
    const user = auth.credentials.user

    await saveWebFormDraft(server, user)

    try {
      const { result } = await getSubmissionWelcome()

      expect(result).not.toEqual(
        expect.stringContaining('govuk-notification-banner')
      )
      expect(result).not.toEqual(expect.stringContaining('saved'))
      expect(result).toEqual(
        expect.stringContaining('value="animal-health-regulations"')
      )
    } finally {
      await dropWebFormDraft(server, user)
    }
  })
})
