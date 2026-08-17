import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

function getCookieValue(response, name) {
  const setCookieHeaders = [response.headers['set-cookie']].flat()
  const cookie = setCookieHeaders.find((header) =>
    header?.startsWith(`${name}=`)
  )

  return cookie?.split(';')[0].split('=')[1]
}

describe('auth routes', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function postSignInChoose(payload = {}) {
    const getResponse = await server.inject({
      method: 'GET',
      url: '/sign-in-choose'
    })
    const crumb = getCookieValue(getResponse, 'crumb')

    return server.inject({
      method: 'POST',
      url: '/sign-in-choose',
      headers: { cookie: `crumb=${crumb}` },
      payload: { ...payload, crumb }
    })
  }

  describe('GET /sign-in-choose', () => {
    test('Should render both sign-in options', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/sign-in-choose'
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('How do you want to sign in?')
      )
      expect(result).toEqual(expect.stringContaining('Defra ID'))
      expect(result).toEqual(
        expect.stringContaining('Government Gateway or GOV.UK One Login')
      )
    })
  })

  describe('POST /sign-in-choose', () => {
    test('Should redirect to the submission welcome screen when Defra ID is selected', async () => {
      const { statusCode, headers } = await postSignInChoose({
        authProvider: 'defraId'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should redirect to the external sign-in placeholder when selected', async () => {
      const { statusCode, headers } = await postSignInChoose({
        authProvider: 'external'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/sign-in-external')
    })

    test('Should redirect back to the chooser when no option is selected', async () => {
      const { statusCode, headers } = await postSignInChoose()

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/sign-in-choose')
    })
  })

  describe('GET /sign-in-external', () => {
    test('Should render the external sign-in placeholder page', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/sign-in-external'
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('External sign-in is not available yet')
      )
    })
  })
})
