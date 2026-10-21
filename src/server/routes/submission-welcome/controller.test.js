import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypes } from '#/server/forms/report-types.js'
import { getLabDiagnosticTests } from '../diagnostic-tests/lab-diagnostic-tests.js'
import { LABORATORY_DETAILS_PATH } from '../diagnostic-tests/laboratory-details.js'
import { DEFINED_LAB_DIAGNOSTIC_TESTS } from '#/test-helpers/lab-diagnostic-tests.js'
import {
  dropWebFormDraft,
  saveWebFormDraft
} from '#/test-helpers/web-form-draft.js'
import {
  UPDATE_DIAGNOSTIC_TESTS,
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

const BANNER_HEADING =
  'You need to set up your diagnostic tests before you can submit an Animal Health Regulations report.'

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

      // History stays available. Diagnostic tests need Animal Health Regulations.
      expect(result).not.toEqual(
        expect.stringContaining(`value="${UPDATE_DIAGNOSTIC_TESTS}"`)
      )
      expect(result).toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
    })

    test('Should render the update diagnostic tests option', async () => {
      const { result, statusCode } = await getSubmissionWelcome()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(`value="${UPDATE_DIAGNOSTIC_TESTS}"`)
      )
      expect(result).toEqual(
        expect.stringContaining('Update your diagnostic tests in use')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'Only use this service if you are setting up your qualifying tests for the first time, or updating your tests and UKAS accreditation since your last report month'
        )
      )
    })

    test('Should list the report types, then history, then diagnostic tests', async () => {
      const { result } = await getSubmissionWelcome()

      const positions = [
        ...reportTypes.map((reportType) => `value="${reportType.slug}"`),
        `value="${VIEW_SUBMISSION_HISTORY}"`,
        `value="${UPDATE_DIAGNOSTIC_TESTS}"`
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
      expect(result).toEqual(
        expect.stringContaining('Last report submitted: 2026-02 BR.xls')
      )
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

    test('Should open the laboratory details page, the first step of the diagnostic tests, when update diagnostic tests is selected', async () => {
      const { statusCode, headers } = await postSubmissionWelcome({
        submissionAction: UPDATE_DIAGNOSTIC_TESTS
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
    })

    test('Should offer diagnostic tests only when the user can submit Animal Health Regulations', async () => {
      const withAhr = await getSubmissionWelcome(authWithJourneys(['AHR']))
      const batOnly = await getSubmissionWelcome(authWithJourneys(['BR']))

      expect(withAhr.result).toEqual(
        expect.stringContaining(`value="${UPDATE_DIAGNOSTIC_TESTS}"`)
      )
      expect(batOnly.result).not.toEqual(
        expect.stringContaining(`value="${UPDATE_DIAGNOSTIC_TESTS}"`)
      )
    })

    test('Should not open diagnostic tests for a user who holds no report type', async () => {
      const { statusCode, headers } = await postSubmissionWelcome(
        { submissionAction: UPDATE_DIAGNOSTIC_TESTS },
        authWithJourneys([])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should not open diagnostic tests for a user who holds only Bat rabies', async () => {
      const { statusCode, headers } = await postSubmissionWelcome(
        { submissionAction: UPDATE_DIAGNOSTIC_TESTS },
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should do nothing when submission history is selected', async () => {
      const { statusCode, headers, result } = await postSubmissionWelcome({
        submissionAction: VIEW_SUBMISSION_HISTORY
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(headers.location).toBeUndefined()
      expect(result).toEqual(
        expect.stringContaining('What would you like to do?')
      )
      expect(result).not.toEqual(expect.stringContaining('There is a problem'))
      expect(result).not.toEqual(
        expect.stringContaining('govuk-notification-banner')
      )
      // The page is re-rendered rather than redirected to, so the form must
      // still carry a crumb for the user's next submission to pass CSRF.
      expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)
    })

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

    test('Should only offer diagnostic tests to a user who holds just Animal Health Regulations', async () => {
      const { result, statusCode } = await getSubmissionWelcome(
        authWithJourneys(['AHR'])
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(`value="${UPDATE_DIAGNOSTIC_TESTS}"`)
      )
      expect(result).not.toEqual(
        expect.stringContaining('value="animal-health-regulations"')
      )
      expect(result).not.toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
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
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
      expect(result).toEqual(
        expect.stringContaining(`value="${UPDATE_DIAGNOSTIC_TESTS}"`)
      )
      expect(result).not.toEqual(
        expect.stringContaining('value="animal-health-regulations"')
      )
      expect(radioCount(result)).toBe(3)
    })

    test.each([[['AHR']], [['BR', 'AHR']]])(
      'Should explain why Animal Health Regulations is not offered to %j',
      async (journeys) => {
        const { result } = await getSubmissionWelcome(
          authWithJourneys(journeys)
        )

        expect(result).toEqual(
          expect.stringContaining('govuk-notification-banner')
        )
        expect(result).toEqual(expect.stringContaining(BANNER_HEADING))
        expect(result).toEqual(
          expect.stringContaining(
            'Select ‘Update your diagnostic tests in use’ to tell us which qualifying tests your laboratory uses and their UKAS accreditation.'
          )
        )
        // Above the question it is about
        expect(result.indexOf(BANNER_HEADING)).toBeLessThan(
          result.indexOf('govuk-fieldset__heading')
        )
      }
    )

    test('Should neither hold back nor ask about a user who holds only Bat rabies', async () => {
      const { result } = await getSubmissionWelcome(authWithJourneys(['BR']))

      expect(result).toEqual(expect.stringContaining('value="bat-rabies"'))
      expect(result).not.toEqual(expect.stringContaining(BANNER_HEADING))
      expect(getLabDiagnosticTests).not.toHaveBeenCalled()
    })

    test('Should redirect back when Animal Health Regulations is posted anyway', async () => {
      const { statusCode, headers } = await postSubmissionWelcome({
        submissionAction: 'animal-health-regulations'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should still continue into Bat rabies', async () => {
      const { statusCode, headers } = await postSubmissionWelcome({
        submissionAction: 'bat-rabies'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/bat-rabies')
    })

    test('Should still open the diagnostic tests journey', async () => {
      const { headers } = await postSubmissionWelcome(
        { submissionAction: UPDATE_DIAGNOSTIC_TESTS },
        authWithJourneys(['AHR'])
      )

      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
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
