import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypes } from '#/server/forms/report-types.js'
import { VIEW_SUBMISSION_HISTORY } from './controller.js'

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
      expect(result).toEqual(expect.stringContaining('Submission Welcome'))

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

      // The history option is not role-gated
      expect(result).toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
    })

    test('Should render the submission history option', async () => {
      const { result, statusCode } = await getSubmissionWelcome()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(`value="${VIEW_SUBMISSION_HISTORY}"`)
      )
      expect(result).toEqual(expect.stringContaining('View submission history'))
      expect(result).toEqual(
        expect.stringContaining('Check your previous reports/submissions')
      )
    })
  })

  describe('POST /submission-welcome', () => {
    test.each(reportTypes.map((reportType) => reportType.slug))(
      'Should redirect to the %s journey when it is selected',
      async (slug) => {
        const { statusCode, headers } = await postSubmissionWelcome({
          submissionAction: slug
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(`/${slug}`)
      }
    )

    test('Should redirect back when a report type the user does not hold is posted', async () => {
      const { statusCode, headers } = await postSubmissionWelcome(
        { submissionAction: 'animal-health-regulations' },
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
      expect(result).toEqual(expect.stringContaining('Submission Welcome'))
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
})
