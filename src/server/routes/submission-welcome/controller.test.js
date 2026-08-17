import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

function getCookieValue(response, name) {
  const setCookieHeaders = [response.headers['set-cookie']].flat()
  const cookie = setCookieHeaders.find((header) =>
    header?.startsWith(`${name}=`)
  )

  return cookie?.split(';')[0].split('=')[1]
}

describe('submission welcome routes', () => {
  let server

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
      url: '/submission-welcome'
    })
    const crumb = getCookieValue(getResponse, 'crumb')

    return server.inject({
      method: 'POST',
      url: '/submission-welcome',
      headers: { cookie: `crumb=${crumb}` },
      payload: { ...payload, crumb }
    })
  }

  describe('GET /submission-welcome', () => {
    test('Should render the submit report option', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/submission-welcome'
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('Submission Welcome'))
      expect(result).toEqual(expect.stringContaining('Submit report'))
    })
  })

  describe('POST /submission-welcome', () => {
    test('Should redirect to the form journey when submit report is selected', async () => {
      const { statusCode, headers } = await postSubmissionWelcome({
        submissionAction: 'submitReport'
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/sdo-test')
    })

    test('Should redirect back when no option is selected', async () => {
      const { statusCode, headers } = await postSubmissionWelcome()

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })
  })
})
