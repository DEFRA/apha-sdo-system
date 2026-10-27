import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { AUTH_PATHS } from '#/server/auth/auth-constants.js'
import {
  howToReportPath,
  reportTypesBySlug
} from '#/server/forms/report-types.js'
import { DEFINED_LAB_DIAGNOSTIC_TESTS } from '#/test-helpers/lab-diagnostic-tests.js'
import {
  dropWebFormDraft,
  readWebFormDraft,
  saveWebFormDraft
} from '#/test-helpers/web-form-draft.js'
import { buildState } from '#/test-helpers/web-form-model.js'
import { getLabDiagnosticTests } from '../diagnostic-tests/lab-diagnostic-tests.js'
import { LABORATORY_DETAILS_PATH } from '../diagnostic-tests/laboratory-details.js'
import {
  CONTINUE_SAVED_TEXT,
  CONTINUE_WEB_FORM_TEXT,
  REPORT_METHOD,
  START_NEW_CONFIRM_TEXT,
  START_NEW_HEADING,
  startNewWebFormPath
} from './controller.js'

// Animal Health Regulations is held back until the lab defines its tests
vi.mock(
  '#/server/routes/diagnostic-tests/lab-diagnostic-tests.js',
  async (importOriginal) =>
    (
      await import('#/test-helpers/lab-diagnostic-tests.js')
    ).mockLabDiagnosticTestsDefined(importOriginal)
)

const ahr = reportTypesBySlug.get('animal-health-regulations')
const batRabies = reportTypesBySlug.get('bat-rabies')

const HOW_TO_REPORT = howToReportPath(ahr)
const ERROR_MESSAGE = 'Select how you would like to report'
const DIAGNOSTIC_TESTS_BANNER_HEADING =
  'You need to set up your diagnostic tests before you can submit an Animal Health Regulations report.'

const valueOf = (method) => `value="${method}"`
const radioCount = (html) => html.match(/name="reportMethod"/g).length

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
      // Full width, like Submission Welcome and the web form pages
      expect(result).toEqual(expect.stringContaining('govuk-grid-column-full'))
      expect(result).not.toEqual(
        expect.stringContaining('govuk-grid-column-two-thirds')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'href="/submission-welcome" class="govuk-back-link"'
        )
      )
      expect(result).toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.FILE_UPLOAD}"`)
      )
      expect(result).toEqual(expect.stringContaining('Upload a file'))
      expect(result).toEqual(
        expect.stringContaining(
          'govuk-label govuk-radios__label govuk-!-font-weight-bold'
        )
      )
      expect(result).toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.WEB_FORM}"`)
      )
      expect(result).toEqual(expect.stringContaining('Complete a web form'))
      expect(result).toEqual(
        expect.stringContaining(`action="${HOW_TO_REPORT}"`)
      )
      expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)
      expect(result).not.toEqual(expect.stringContaining('There is a problem'))
      // Nothing saved: nothing to continue, and no banner about it
      expect(result).not.toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.CONTINUE_WEB_FORM}"`)
      )
      expect(result).not.toEqual(
        expect.stringContaining('govuk-notification-banner')
      )
    })

    test('Should offer updating the diagnostic tests last, saying what it is for', async () => {
      const { result } = await get(HOW_TO_REPORT)

      expect(result).toEqual(
        expect.stringContaining('Update your diagnostic tests in use')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'Only use this service if you are setting up your qualifying tests for the first time, or updating your tests and UKAS accreditation since your last report month'
        )
      )

      const positions = [
        REPORT_METHOD.FILE_UPLOAD,
        REPORT_METHOD.WEB_FORM,
        REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS
      ].map((method) => result.indexOf(valueOf(method)))

      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      expect(radioCount(result)).toBe(3)
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

    test('Should open the laboratory details page, the first step of the diagnostic tests', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
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

    test('Should ask again when continue is posted with nothing saved', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.CONTINUE_WEB_FORM
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

  describe('with a saved web form report', () => {
    const START_NEW = startNewWebFormPath(ahr)
    const WEB_FORM = `/${ahr.webFormSlug}`
    const RESUME_AT_ENTRIES = `${WEB_FORM}/report-entries`
    const user = auth.credentials.user

    beforeEach(async () => {
      await saveWebFormDraft(server, user)
    })

    afterEach(async () => {
      await dropWebFormDraft(server, user)
    })

    test('startNewWebFormPath names the confirmation for a report type', () => {
      expect(START_NEW).toBe(
        '/animal-health-regulations/how-to-report/start-new'
      )
    })

    test('Should say so, and offer to continue it first', async () => {
      const { result } = await get(HOW_TO_REPORT)

      expect(result).toEqual(
        expect.stringContaining('govuk-notification-banner')
      )
      // The text runs the full width of the banner
      expect(result).toEqual(
        expect.stringContaining('app-notification-banner-full-width')
      )
      expect(result).toEqual(
        expect.stringContaining(
          `You have a saved ${ahr.title} that has not been submitted.`
        )
      )
      expect(result).toEqual(
        expect.stringContaining('It covers August 2026 and has 1 entry.')
      )
      expect(result).toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.CONTINUE_WEB_FORM}"`)
      )
      expect(result).toEqual(expect.stringContaining(CONTINUE_WEB_FORM_TEXT))
      // Ahead of the other options
      expect(
        result.indexOf(`value="${REPORT_METHOD.CONTINUE_WEB_FORM}"`)
      ).toBeLessThan(result.indexOf(`value="${REPORT_METHOD.FILE_UPLOAD}"`))
    })

    test('Should still offer updating the diagnostic tests last', async () => {
      const { result } = await get(HOW_TO_REPORT)

      const positions = [
        REPORT_METHOD.CONTINUE_WEB_FORM,
        REPORT_METHOD.FILE_UPLOAD,
        REPORT_METHOD.WEB_FORM,
        REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS
      ].map((method) => result.indexOf(valueOf(method)))

      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      expect(radioCount(result)).toBe(4)
    })

    test('Should offer a new web form report in place of the web form, with a warning', async () => {
      const { result } = await get(HOW_TO_REPORT)

      expect(result).toEqual(
        expect.stringContaining('Start a new web form report')
      )
      expect(result).toEqual(
        expect.stringContaining('Your saved web form report will be discarded')
      )
      expect(result).not.toEqual(expect.stringContaining('Complete a web form'))
      expect(result).toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.WEB_FORM}"`)
      )
      expect(result).toEqual(expect.stringContaining('Upload a file'))
    })

    test('Should still offer the web form, plainly, to a user with nothing saved', async () => {
      await dropWebFormDraft(server, user)

      const { result } = await get(HOW_TO_REPORT)

      expect(result).toEqual(expect.stringContaining('Complete a web form'))
      expect(result).not.toEqual(
        expect.stringContaining('Start a new web form report')
      )
      expect(result).not.toEqual(
        expect.stringContaining(`value="${REPORT_METHOD.CONTINUE_WEB_FORM}"`)
      )
    })

    test('Should continue the saved report at the report entries page', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.CONTINUE_WEB_FORM
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(RESUME_AT_ENTRIES)
    })

    test('Should continue at the first entry when only the report date was saved', async () => {
      await saveWebFormDraft(server, user, buildState([]))

      const { headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.CONTINUE_WEB_FORM
      })

      expect(headers.location).toBe(`${WEB_FORM}/which-pathogen-was-tested`)
    })

    test('Should ask for confirmation before the web form journey starts', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.WEB_FORM
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(START_NEW)
    })

    test('Should still go straight into the upload journey', async () => {
      const { headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.FILE_UPLOAD
      })

      expect(headers.location).toBe(`/${ahr.slug}`)
    })

    describe(`GET ${START_NEW}`, () => {
      test('Should describe the saved report and offer to start afresh or continue it', async () => {
        const { result, statusCode } = await get(START_NEW)

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toEqual(expect.stringContaining(START_NEW_HEADING))
        expect(result).toEqual(
          expect.stringContaining('govuk-grid-column-full')
        )
        expect(result).toEqual(expect.stringContaining(ahr.title))
        expect(result).toEqual(
          expect.stringContaining('It covers August 2026 and has 1 entry.')
        )
        expect(result).toEqual(
          expect.stringContaining(
            'Starting a new report discards the saved one.'
          )
        )
        expect(result).toEqual(expect.stringContaining(START_NEW_CONFIRM_TEXT))
        expect(result).toEqual(expect.stringContaining('govuk-button--warning'))
        expect(result).toEqual(expect.stringContaining(CONTINUE_SAVED_TEXT))
        expect(result).toEqual(
          expect.stringContaining(`href="${RESUME_AT_ENTRIES}"`)
        )
        expect(result).toEqual(expect.stringContaining(`action="${START_NEW}"`))
        expect(result).toEqual(
          expect.stringContaining(
            `href="${HOW_TO_REPORT}" class="govuk-back-link"`
          )
        )
        expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)
      })

      test('Should start the web form straight away when nothing is saved', async () => {
        await dropWebFormDraft(server, user)

        const { statusCode, headers } = await get(START_NEW)

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(WEB_FORM)
      })

      test('Should not exist for a report type that is upload only', async () => {
        const { statusCode } = await get(startNewWebFormPath(batRabies))

        expect(statusCode).toBe(statusCodes.notFound)
      })

      test('Should refuse a user whose roles do not grant the report type', async () => {
        const { statusCode, headers } = await get(
          START_NEW,
          authWithJourneys(['BR'])
        )

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(AUTH_PATHS.NO_ACCESS)
      })
    })

    describe(`POST ${START_NEW}`, () => {
      test('Should discard the saved report and start the web form when confirmed', async () => {
        const { statusCode, headers } = await post(START_NEW, {
          confirm: 'true'
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(WEB_FORM)
        await expect(readWebFormDraft(server, user)).resolves.toBeNull()

        // With nothing saved any more, the web form is offered plainly again
        const { result } = await get(HOW_TO_REPORT)
        expect(result).toEqual(expect.stringContaining('Complete a web form'))
      })

      test('Should keep the saved report and continue it when not confirmed', async () => {
        const { statusCode, headers } = await post(START_NEW)

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(RESUME_AT_ENTRIES)
        await expect(readWebFormDraft(server, user)).resolves.toEqual(
          expect.objectContaining({ reportDate__month: 8 })
        )
      })

      test('Should continue at the first entry when only the report date was saved', async () => {
        await saveWebFormDraft(server, user, buildState([]))

        const { headers } = await post(START_NEW)

        expect(headers.location).toBe(`${WEB_FORM}/which-pathogen-was-tested`)
      })

      test('Should start the web form straight away when nothing is saved', async () => {
        await get(START_NEW)
        await dropWebFormDraft(server, user)

        const { statusCode, headers } = await post(START_NEW, {
          confirm: 'true'
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(WEB_FORM)
      })

      test('Should not exist for a report type that is upload only', async () => {
        await get(START_NEW)

        const { statusCode } = await post(startNewWebFormPath(batRabies), {
          confirm: 'true'
        })

        expect(statusCode).toBe(statusCodes.notFound)
      })
    })
  })

  describe('before the lab has defined its diagnostic tests', () => {
    const user = auth.credentials.user

    beforeEach(() => {
      getLabDiagnosticTests.mockResolvedValue(null)
    })

    afterEach(() => {
      getLabDiagnosticTests.mockResolvedValue(DEFINED_LAB_DIAGNOSTIC_TESTS)
    })

    test('Should say why, and only offer updating the diagnostic tests', async () => {
      const { result, statusCode } = await get(HOW_TO_REPORT)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('How would you like to report?')
      )
      expect(result).toEqual(
        expect.stringContaining('govuk-notification-banner')
      )
      expect(result).toEqual(
        expect.stringContaining('app-notification-banner-full-width')
      )
      expect(result).toEqual(
        expect.stringContaining(DIAGNOSTIC_TESTS_BANNER_HEADING)
      )
      expect(result).toEqual(
        expect.stringContaining(
          'Select ‘Update your diagnostic tests in use’ to tell us which qualifying tests your laboratory uses and their UKAS accreditation.'
        )
      )
      // Above the question it is about
      expect(result.indexOf(DIAGNOSTIC_TESTS_BANNER_HEADING)).toBeLessThan(
        result.indexOf('govuk-fieldset__heading')
      )

      expect(result).toEqual(
        expect.stringContaining(valueOf(REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS))
      )
      expect(result).not.toEqual(
        expect.stringContaining(valueOf(REPORT_METHOD.FILE_UPLOAD))
      )
      expect(result).not.toEqual(
        expect.stringContaining(valueOf(REPORT_METHOD.WEB_FORM))
      )
      expect(radioCount(result)).toBe(1)
    })

    test('Should not offer to continue a saved web form report', async () => {
      await saveWebFormDraft(server, user)

      try {
        const { result } = await get(HOW_TO_REPORT)

        expect(result).not.toEqual(
          expect.stringContaining(
            `You have a saved ${ahr.title} that has not been submitted.`
          )
        )
        expect(result).not.toEqual(
          expect.stringContaining(valueOf(REPORT_METHOD.CONTINUE_WEB_FORM))
        )
        expect(radioCount(result)).toBe(1)
      } finally {
        await dropWebFormDraft(server, user)
      }
    })

    test('Should not show the diagnostic tests banner once they are defined', async () => {
      getLabDiagnosticTests.mockResolvedValue(DEFINED_LAB_DIAGNOSTIC_TESTS)

      const { result } = await get(HOW_TO_REPORT)

      expect(result).not.toEqual(
        expect.stringContaining(DIAGNOSTIC_TESTS_BANNER_HEADING)
      )
    })

    test('Should open the laboratory details page when updating the diagnostic tests', async () => {
      const { statusCode, headers } = await post(HOW_TO_REPORT, {
        reportMethod: REPORT_METHOD.UPDATE_DIAGNOSTIC_TESTS
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
    })

    test.each([
      REPORT_METHOD.FILE_UPLOAD,
      REPORT_METHOD.WEB_FORM,
      REPORT_METHOD.CONTINUE_WEB_FORM
    ])(
      'Should ask again, with an error, when %s is posted anyway',
      async (reportMethod) => {
        await saveWebFormDraft(server, user)

        try {
          const { statusCode, headers } = await post(HOW_TO_REPORT, {
            reportMethod
          })

          expect(statusCode).toBe(statusCodes.redirect)
          expect(headers.location).toBe(HOW_TO_REPORT)

          const errorPage = await get(HOW_TO_REPORT)

          expect(errorPage.result).toEqual(
            expect.stringContaining(ERROR_MESSAGE)
          )
        } finally {
          await dropWebFormDraft(server, user)
        }
      }
    )

    test('Should send the user back here from the new web form confirmation', async () => {
      const { statusCode, headers } = await get(startNewWebFormPath(ahr))

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(HOW_TO_REPORT)
    })
  })
})
