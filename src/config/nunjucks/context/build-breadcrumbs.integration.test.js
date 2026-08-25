import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypes } from '#/server/forms/report-types.js'

/**
 * Breadcrumbs reach the page through two different rendering paths: Hapi Vision
 * for the service's own routes, and the forms-engine-plugin `viewContext` for
 * the journey pages. Both are covered here.
 */
describe('breadcrumbs rendering', () => {
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

  function getBreadcrumbs(html) {
    return /<nav class="govuk-breadcrumbs[\s\S]*?<\/nav>/.exec(html)?.[0]
  }

  test('Should render breadcrumbs on a route view', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/submission-welcome',
      auth
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getBreadcrumbs(result)).toEqual(
      expect.stringContaining('href="/">Home')
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
      expect(breadcrumbs).toEqual(expect.stringContaining('href="/">Home'))
      expect(breadcrumbs).toEqual(
        expect.stringContaining('href="/submission-welcome"')
      )
      // The current page is the final item and must not be a link.
      expect(breadcrumbs).toEqual(
        expect.stringContaining(`aria-current="page">${title}</li>`)
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
  })
})
