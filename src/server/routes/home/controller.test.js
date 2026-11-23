import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

describe('#homeController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Should provide expected response', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(result).toMatch(
      /<title>\s*Disease surveillance data portal\s*<\/title>/
    )
    expect(result).toMatch(
      /class="govuk-header__link govuk-header__service-name">\s*Disease surveillance data portal\s*</
    )
    expect(result).not.toEqual(expect.stringContaining('apha-sdo-system'))
    expect(result).toMatch(
      /<h1 class="govuk-heading-xl govuk-!-margin-bottom-2"\s+data-testid="app-heading-title">Disease surveillance data portal<\/h1>/
    )
    expect(result).not.toEqual(
      expect.stringContaining('Surveillance data submission portal')
    )
    expect(result).not.toEqual(expect.stringContaining('>Home<'))
    expect(result).toEqual(
      expect.stringContaining(
        "Submit your veterinary surveillance data to APHA. You'll be helping with the detection and assessment of disease-related threats to livestock and wildlife in Great Britain."
      )
    )
    expect(result).not.toEqual(expect.stringContaining('Related links'))
    // Nothing sits beside the content, so it takes three quarters of the row
    expect(result).not.toEqual(
      expect.stringContaining('govuk-grid-column-two-thirds')
    )
    expect(result.match(/govuk-grid-column-three-quarters/g)).toHaveLength(2)
    expect(statusCode).toBe(statusCodes.ok)
  })

  test('sends a signed-in user to their submissions', async () => {
    const accessToken = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url'
      ),
      Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
      ).toString('base64url'),
      ''
    ].join('.')

    vi.spyOn(
      server.plugins['hapi-auth-oidc'].oidc,
      'callback'
    ).mockResolvedValue({
      accessToken,
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      claims: {
        oid: 'user-id',
        name: 'A Person',
        groups: ['local-dev-group']
      }
    })

    const callbackResponse = await server.inject(
      '/signin-entra-id?code=code&state=state'
    )
    const cookie = [callbackResponse.headers['set-cookie']]
      .flat()
      .find((header) => header?.startsWith('userSession='))
      ?.split(';')[0]

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe('/submission-welcome')
  })
})
