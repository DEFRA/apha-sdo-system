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

describe('submission welcome routes', () => {
  let server
  const auth = {
    strategy: 'session',
    credentials: {
      sessionId: 'test-session',
      user: { id: 'user-id', name: 'A Person' },
      claims: {}
    }
  }

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function postSubmissionWelcome(payload = {}) {
    const getResponse = await server.inject({
      method: 'GET',
      url: '/submission-welcome',
      auth
    })
    const crumb = getCookieValue(getResponse, 'crumb')

    return server.inject({
      method: 'POST',
      url: '/submission-welcome',
      auth,
      headers: { cookie: `crumb=${crumb}` },
      payload: { ...payload, crumb }
    })
  }

  describe('GET /submission-welcome', () => {
    test('Should render a radio option for every report type', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/submission-welcome',
        auth
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('Submission Welcome'))

      for (const reportType of reportTypes) {
        expect(result).toEqual(expect.stringContaining(reportType.title))
        expect(result).toEqual(
          expect.stringContaining(`value="${reportType.slug}"`)
        )
      }
    })

    test('Should render the submission history option', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/submission-welcome',
        auth
      })

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
