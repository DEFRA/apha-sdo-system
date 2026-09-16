import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { AUTH_PATHS } from '#/server/auth/auth-constants.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { REPORT_METHOD, howToReportPath } from './controller.js'

const ahr = reportTypesBySlug.get('animal-health-regulations')
const batRabies = reportTypesBySlug.get('bat-rabies')

const HOW_TO_REPORT = howToReportPath(ahr)
const ERROR_MESSAGE = 'Select how you would like to report'

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

describe('report method routes', () => {
  let server
  const auth = authWithJourneys(['BR', 'AHR'])

  // The flashed error and the CSRF crumb both live in cookies, so carry them
  // across requests like a browser would
  const jar = new Map()

  function rememberCookies(res) {
    for (const header of [res.headers['set-cookie']].flat()) {
      if (!header) {
        continue
      }
      const [name, ...rest] = header.split(';')[0].split('=')
      jar.set(name, rest.join('='))
    }
  }

  function withCookies(options, authOverride = auth) {
    const cookie = [...jar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')

    return {
      ...options,
      auth: authOverride,
      headers: { ...options.headers, cookie }
    }
  }

  async function get(url, authOverride) {
    const res = await server.inject(
      withCookies({ method: 'GET', url }, authOverride)
    )
    rememberCookies(res)
    return res
  }

  async function post(url, payload = {}, authOverride) {
    if (!jar.has('crumb')) {
      await get(url, authOverride)
    }

    const res = await server.inject(
      withCookies(
        {
          method: 'POST',
          url,
          payload: { ...payload, crumb: jar.get('crumb') }
        },
        authOverride
      )
    )
    rememberCookies(res)
    return res
  }

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    jar.clear()
  })

  test('howToReportPath names the screen for a report type', () => {
    expect(HOW_TO_REPORT).toBe('/animal-health-regulations/how-to-report')
  })

  describe(`GET ${HOW_TO_REPORT}`, () => {
    test('Should offer file upload and web form', async () => {
      const { result, statusCode } = await get(HOW_TO_REPORT)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('How would you like to report?')
      )
      expect(result).toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.FILE_UPLOAD}"`)
      )
      expect(result).toEqual(expect.stringContaining('Upload a file'))
      expect(result).toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.WEB_FORM}"`)
      )
      expect(result).toEqual(expect.stringContaining('Complete a web form'))
      expect(result).toEqual(
        expect.stringContaining(`action="${HOW_TO_REPORT}"`)
      )
      expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)
      expect(result).not.toEqual(expect.stringContaining('There is a problem'))
    })

    test('Should sit under the report type in the breadcrumbs', async () => {
      const { result } = await get(HOW_TO_REPORT)

      expect(result).toEqual(expect.stringContaining('govuk-breadcrumbs'))
      expect(result).toEqual(
        expect.stringContaining('href="/submission-welcome"')
      )
      expect(result).toEqual(expect.stringContaining(ahr.title))
    })

    test('Should not exist for a report type that is upload only', async () => {
      const { statusCode } = await get(howToReportPath(batRabies))

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('Should not exist under the web form slug', async () => {
      const { statusCode } = await get(`/${ahr.webFormSlug}/how-to-report`)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('Should not exist for an unknown report type', async () => {
      const { statusCode } = await get('/not-a-report-type/how-to-report')

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('Should refuse a user whose roles do not grant the report type', async () => {
      const { statusCode, headers } = await get(
        HOW_TO_REPORT,
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(AUTH_PATHS.NO_ACCESS)
    })

    test('Should send a signed-out user to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: HOW_TO_REPORT
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(
        `${AUTH_PATHS.SIGN_IN_CHOOSE}?redirect=${encodeURIComponent(HOW_TO_REPORT)}`
      )
    })
  })

  describe(`POST ${HOW_TO_REPORT}`, () => {
    test('Should continue into the upload journey', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.FILE_UPLOAD
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(`/${ahr.slug}`)
    })

    test('Should continue into the web form journey', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.WEB_FORM
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(`/${ahr.webFormSlug}`)
    })

    test('Should ask again, with an error, when nothing is selected', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT)

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(HOW_TO_REPORT)

      const errorPage = await get(HOW_TO_REPORT)

      expect(errorPage.statusCode).toBe(statusCodes.ok)
      expect(errorPage.result).toEqual(
        expect.stringContaining('There is a problem')
      )
      expect(errorPage.result).toEqual(expect.stringContaining(ERROR_MESSAGE))
      expect(errorPage.result).toEqual(
        expect.stringContaining('href="#reportMethod"')
      )

      // The error is shown once, not on every later visit
      const reloadedPage = await get(HOW_TO_REPORT)

      expect(reloadedPage.result).not.toEqual(
        expect.stringContaining('There is a problem')
      )
    })

    test('Should ask again when an unknown option is posted', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: 'carrier-pigeon'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(HOW_TO_REPORT)
    })

    test('Should not exist for a report type that is upload only', async () => {
      await get(HOW_TO_REPORT)

      const { statusCode } = await post(howToReportPath(batRabies), {
        reportMethod: REPORT_METHOD.WEB_FORM
      })

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('Should refuse a user whose roles do not grant the report type', async () => {
      await get(HOW_TO_REPORT)

      const { statusCode, headers } = await post(
        HOW_TO_REPORT,
        { reportMethod: REPORT_METHOD.WEB_FORM },
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(AUTH_PATHS.NO_ACCESS)
    })
  })
})
