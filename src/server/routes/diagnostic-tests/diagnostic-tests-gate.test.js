import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { AUTH_PATHS } from '#/server/auth/auth-constants.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { DIAGNOSTIC_TESTS_PATH, accreditationFieldId } from './controller.js'
import {
  isAwaitingDiagnosticTests,
  isHeldBackForDiagnosticTests,
  requireDiagnosticTestsFirst
} from './diagnostic-tests-gate.js'
import { LABORATORY_DETAILS_PATH } from './laboratory-details.js'
import { testsByKey } from './qualifying-tests.js'

const ahr = reportTypesBySlug.get('animal-health-regulations')
const batRabies = reportTypesBySlug.get('bat-rabies')

// The lab's tests as the store keeps them, for a lab that has defined them
const DEFINED = [['TestLab1', { 'bhv-fat': 'Yes' }]]

/**
 * A request from a user of TestLab1, carrying the store's cookie when the
 * lab has defined its tests
 */
function createRequest({
  slug,
  journeys = ['BR', 'AHR'],
  isAuthenticated = true,
  defined = false
} = {}) {
  return {
    params: slug === undefined ? {} : { slug },
    auth: {
      isAuthenticated,
      credentials: isAuthenticated
        ? { user: { id: 'user-id', organisationId: 'TestLab1', journeys } }
        : undefined
    },
    state: defined ? { diagnosticTests: DEFINED } : {},
    app: {},
    logger: { info: vi.fn() }
  }
}

function createToolkit() {
  const response = { takeover: vi.fn() }
  response.takeover.mockReturnValue(response)

  return {
    continue: Symbol('continue'),
    redirect: vi.fn().mockReturnValue(response),
    response
  }
}

describe('isAwaitingDiagnosticTests', () => {
  test('is true for a user who can define the tests when their lab has not', async () => {
    expect(await isAwaitingDiagnosticTests(createRequest())).toBe(true)
  })

  test('is false once their lab has defined them', async () => {
    expect(
      await isAwaitingDiagnosticTests(createRequest({ defined: true }))
    ).toBe(false)
  })

  test('is false for a user who cannot define them', async () => {
    expect(
      await isAwaitingDiagnosticTests(createRequest({ journeys: ['BR'] }))
    ).toBe(false)
    expect(
      await isAwaitingDiagnosticTests(createRequest({ isAuthenticated: false }))
    ).toBe(false)
  })
})

describe('isHeldBackForDiagnosticTests', () => {
  test('holds back Animal Health Regulations until the lab has defined its tests', async () => {
    expect(await isHeldBackForDiagnosticTests(createRequest(), ahr)).toBe(true)
    expect(
      await isHeldBackForDiagnosticTests(createRequest({ defined: true }), ahr)
    ).toBe(false)
  })

  test('never holds back another report type', async () => {
    expect(await isHeldBackForDiagnosticTests(createRequest(), batRabies)).toBe(
      false
    )
    expect(await isHeldBackForDiagnosticTests(createRequest(), undefined)).toBe(
      false
    )
  })
})

describe('requireDiagnosticTestsFirst', () => {
  test.each([ahr.slug, ahr.webFormSlug])(
    'sends a user to Submission Welcome from %s before their lab has defined its tests',
    async (slug) => {
      const request = createRequest({ slug })
      const h = createToolkit()

      expect(await requireDiagnosticTestsFirst(request, h)).toBe(h.response)
      expect(h.redirect).toHaveBeenCalledWith('/submission-welcome')
      expect(h.response.takeover).toHaveBeenCalled()
      expect(request.logger.info).toHaveBeenCalledWith(
        { userId: 'user-id', reportType: 'AHR' },
        expect.any(String)
      )
    }
  )

  test('lets a user in once their lab has defined its tests', async () => {
    const h = createToolkit()

    expect(
      await requireDiagnosticTestsFirst(
        createRequest({ slug: ahr.slug, defined: true }),
        h
      )
    ).toBe(h.continue)
    expect(h.redirect).not.toHaveBeenCalled()
  })

  test('ignores other report types and routes that are not report journeys', async () => {
    const h = createToolkit()

    expect(
      await requireDiagnosticTestsFirst(
        createRequest({ slug: batRabies.slug }),
        h
      )
    ).toBe(h.continue)
    expect(await requireDiagnosticTestsFirst(createRequest(), h)).toBe(
      h.continue
    )
    expect(
      await requireDiagnosticTestsFirst(createRequest({ slug: 'help' }), h)
    ).toBe(h.continue)
    expect(h.redirect).not.toHaveBeenCalled()
  })

  test('leaves unauthenticated requests to the cookie strategy', async () => {
    const h = createToolkit()

    expect(
      await requireDiagnosticTestsFirst(
        createRequest({ slug: ahr.slug, isAuthenticated: false }),
        h
      )
    ).toBe(h.continue)
  })
})

describe('diagnostic tests first (end to end)', () => {
  let server

  const AHR_URLS = [
    `/${ahr.slug}/report-date`,
    `/${ahr.slug}/how-to-report`,
    `/${ahr.webFormSlug}/what-month-does-your-report-cover`
  ]

  function authFor({ journeys = ['BR', 'AHR'], lab = 'TestLab1' } = {}) {
    return {
      strategy: 'session',
      credentials: {
        sessionId: 'test-session',
        user: {
          id: 'user-id',
          name: 'A Person',
          organisationId: lab,
          journeys
        },
        claims: {}
      }
    }
  }

  function cookiesOf(response) {
    return new Map(
      [response.headers['set-cookie']]
        .flat()
        .filter(Boolean)
        .map((header) => header.split(';')[0].split(/=(.*)/s).slice(0, 2))
    )
  }

  /**
   * Defines TestLab1's tests through the laboratory details and diagnostic
   * tests pages, as a user would, and returns the cookie its browser then
   * holds
   */
  async function defineDiagnosticTests() {
    const auth = authFor()
    const page = await server.inject({
      method: 'GET',
      url: LABORATORY_DETAILS_PATH,
      auth
    })
    const crumb = cookiesOf(page).get('crumb')
    const details = await server.inject({
      method: 'POST',
      url: LABORATORY_DETAILS_PATH,
      auth,
      headers: { cookie: `crumb=${crumb}` },
      payload: {
        crumb,
        addressLine1: 'Y Buarth',
        townOrCity: 'Aberystwyth',
        postcode: 'SY23 1ND'
      }
    })

    expect(details.statusCode).toBe(statusCodes.seeOther)

    // The crumb, and the session holding the laboratory details
    const cookie = [...new Map([...cookiesOf(page), ...cookiesOf(details)])]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
    const submitted = await server.inject({
      method: 'POST',
      url: DIAGNOSTIC_TESTS_PATH,
      auth,
      headers: { cookie },
      payload: {
        crumb,
        tests: 'bhv-fat',
        [accreditationFieldId(testsByKey.get('bhv-fat'))]: 'Yes'
      }
    })

    expect(submitted.statusCode).toBe(statusCodes.seeOther)

    return `diagnosticTests=${cookiesOf(submitted).get('diagnosticTests')}`
  }

  function open(url, auth = authFor(), cookie = '') {
    return server.inject({ method: 'GET', url, auth, headers: { cookie } })
  }

  const azureStorageEnabled = config.get('azure.storage.enabled')

  beforeAll(async () => {
    // Defining the tests delivers them; a developer's .env may point at Azure
    config.set('azure.storage.enabled', false)
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('azure.storage.enabled', azureStorageEnabled)
    await server.stop({ timeout: 0 })
  })

  test.each(AHR_URLS)(
    'Should send the user from %s to Submission Welcome until the lab has defined its tests',
    async (url) => {
      const { statusCode, headers } = await open(url)

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    }
  )

  test.each(AHR_URLS)(
    'Should open %s once the lab has defined its tests',
    async (url) => {
      const cookie = await defineDiagnosticTests()
      const { statusCode } = await open(url, authFor(), cookie)

      expect(statusCode).toBe(statusCodes.ok)
    }
  )

  test('Should offer Animal Health Regulations on Submission Welcome once the lab has defined its tests', async () => {
    const before = await open('/submission-welcome')
    const cookie = await defineDiagnosticTests()
    const after = await open('/submission-welcome', authFor(), cookie)

    expect(before.result).not.toEqual(
      expect.stringContaining(`value="${ahr.slug}"`)
    )
    expect(after.result).toEqual(expect.stringContaining(`value="${ahr.slug}"`))
  })

  test("Should still hold back another lab's user in the same browser", async () => {
    const cookie = await defineDiagnosticTests()
    const { statusCode, headers } = await open(
      AHR_URLS[0],
      authFor({ lab: 'TestLab2' }),
      cookie
    )

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe('/submission-welcome')
  })

  test('Should never hold back Bat rabies', async () => {
    const { statusCode } = await open(`/${batRabies.slug}/report-date`)

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('Should tell a user without Animal Health Regulations they have no access first', async () => {
    const { statusCode, headers } = await open(
      AHR_URLS[0],
      authFor({ journeys: ['BR'] })
    )

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(AUTH_PATHS.NO_ACCESS)
  })
})
