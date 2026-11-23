import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypes } from '#/server/forms/report-types.js'

// Animal Health Regulations is held back until the lab defines its tests
vi.mock(
  '#/server/routes/diagnostic-tests/lab-diagnostic-tests.js',
  async (importOriginal) =>
    (
      await import('#/test-helpers/lab-diagnostic-tests.js')
    ).mockLabDiagnosticTestsDefined(importOriginal)
)

/**
 * Breadcrumbs reach the page through two different rendering paths: Hapi Vision
 * for the service's own routes, and the forms-engine-plugin `viewContext` for
 * the journey pages. Both are covered here.
 */
// Added to the page container when there are no breadcrumbs
const NO_BREADCRUMBS_SPACING = 'app-width-container--no-breadcrumbs'

describe('breadcrumbs rendering', () => {
  let server
  const auth = {
    strategy: 'session',
    credentials: {
      sessionId: 'test-session',
      user: {
        id: 'user-id',
        name: 'A Person',
        organisationId: 'TestLab1',
        journeys: ['BR', 'AHR']
      },
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

  function getBreadcrumbs(html) {
    return /<nav class="govuk-breadcrumbs[\s\S]*?<\/nav>/.exec(html)?.[0]
  }

  test('Should render breadcrumbs on a route view, starting at the welcome page', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/previous-submissions',
      auth
    })
    const breadcrumbs = getBreadcrumbs(result)

    expect(statusCode).toBe(statusCodes.ok)
    expect(breadcrumbs).toEqual(
      expect.stringContaining('href="/submission-welcome">Welcome page')
    )
    expect(breadcrumbs).not.toEqual(expect.stringContaining('href="/"'))
    expect(result).not.toEqual(expect.stringContaining(NO_BREADCRUMBS_SPACING))
  })

  test('Should not render a breadcrumb of the welcome page alone', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/submission-welcome',
      auth
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getBreadcrumbs(result)).toBeUndefined()
    // Spaced from the header as the breadcrumbs would have spaced it
    expect(result).toEqual(
      expect.stringContaining(
        `<div class="govuk-width-container ${NO_BREADCRUMBS_SPACING}">`
      )
    )
  })

  test.each(reportTypes)(
    'Should render breadcrumbs on the $slug journey',
    async ({ slug, title }) => {
      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/${slug}/report-date`,
        auth
      })
      const breadcrumbs = getBreadcrumbs(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(breadcrumbs).not.toEqual(expect.stringContaining('href="/"'))
      expect(breadcrumbs).toEqual(
        expect.stringContaining('href="/submission-welcome">Welcome page')
      )
      // The current page is the final item and must not be a link.
      expect(breadcrumbs).toEqual(
        expect.stringContaining(`aria-current="page">${title}</li>`)
      )
      expect(result).not.toEqual(
        expect.stringContaining(NO_BREADCRUMBS_SPACING)
      )
    }
  )

  test('Should not render breadcrumbs on the home page', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getBreadcrumbs(result)).toBeUndefined()
    expect(result).toEqual(
      expect.stringContaining(
        `<div class="govuk-width-container ${NO_BREADCRUMBS_SPACING}">`
      )
    )
  })
})
