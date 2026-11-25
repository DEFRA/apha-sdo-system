import { config } from '#/config/config.js'
import {
  SubmissionHistoryApiError,
  createSubmissionHistoryApiClient,
  submissionHistoryApi
} from './submission-history-api.js'

const SETTINGS = {
  enabled: true,
  url: 'https://api.example.test/api/aphasdo/v1.0/db/batchsubmissionmessage',
  tokenUrl: 'https://login.example.test/tenant-id/oauth2/v2.0/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  scope: 'api://api-id/.default',
  pageSize: 10,
  timeoutMs: 5000
}

const QUERY = {
  processNames: ['BR'],
  laboratoryId: 'Test Lab 1',
  page: 2,
  pageSize: 5
}

const PAGE = [{ UploadReferenceNumber: 'BR1-AAA-111' }]

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function tokenResponse(accessToken, expiresIn = 3600) {
  return jsonResponse({
    token_type: 'Bearer',
    expires_in: expiresIn,
    access_token: accessToken
  })
}

function createClient(overrides = {}) {
  return createSubmissionHistoryApiClient({
    getSettings: () => ({ ...SETTINGS, ...overrides })
  })
}

function isTokenRequest(url) {
  return String(url) === SETTINGS.tokenUrl
}

describe('#submissionHistoryApi', () => {
  let fetchSpy

  // Each token request is answered with the next of the tokens, each API
  // request with the page
  function respondWith({ tokens = ['token-1', 'token-2'], page = PAGE } = {}) {
    let tokenRequests = 0

    fetchSpy.mockImplementation(async (url) =>
      isTokenRequest(url)
        ? tokenResponse(tokens[tokenRequests++])
        : jsonResponse(page, { headers: { 'x-correlation-id': 'corr-1' } })
    )
  }

  function tokenRequestCount() {
    return fetchSpy.mock.calls.filter(([url]) => isTokenRequest(url)).length
  }

  function bearerTokens() {
    return fetchSpy.mock.calls
      .filter(([url]) => !isTokenRequest(url))
      .map(([, init]) => init.headers.authorization)
  }

  function setNow(isoTime) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(isoTime))
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('Should exchange the client credentials for a token', async () => {
    respondWith()

    await createClient().fetchSubmissionPage(QUERY)

    const [url, init] = fetchSpy.mock.calls[0]

    expect(url).toBe(SETTINGS.tokenUrl)
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe(
      'application/x-www-form-urlencoded'
    )
    expect(Object.fromEntries(init.body)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
      scope: 'api://api-id/.default'
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test('Should ask for the page with the token, spaces sent as %20', async () => {
    respondWith()

    const result = await createClient().fetchSubmissionPage(QUERY)
    const [url, init] = fetchSpy.mock.calls[1]

    expect(url).toBe(
      `${SETTINGS.url}?processName=BR&laboratoryId=Test%20Lab%201&page=2&pageSize=5`
    )
    expect(init.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer token-1'
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(result).toEqual({ status: 200, correlationId: 'corr-1', body: PAGE })
  })

  test('Should ask for several processes at once, comma-separated', async () => {
    respondWith()

    await createClient().fetchSubmissionPage({
      ...QUERY,
      processNames: ['BR', 'AHR']
    })

    expect(fetchSpy.mock.calls[1][0]).toBe(
      `${SETTINGS.url}?processName=BR,AHR&laboratoryId=Test%20Lab%201&page=2&pageSize=5`
    )
  })

  test('Should reuse the token until a minute before it expires', async () => {
    respondWith()
    setNow('2026-11-24T12:00:00.000Z')

    const client = createClient()

    await client.fetchSubmissionPage(QUERY)
    vi.setSystemTime(new Date('2026-11-24T12:58:59.000Z'))
    await client.fetchSubmissionPage(QUERY)
    vi.setSystemTime(new Date('2026-11-24T12:59:01.000Z'))
    await client.fetchSubmissionPage(QUERY)

    expect(tokenRequestCount()).toBe(2)
    expect(bearerTokens()).toEqual([
      'Bearer token-1',
      'Bearer token-1',
      'Bearer token-2'
    ])
  })

  test('Should share one token request between requests made together', async () => {
    respondWith()

    const client = createClient()

    await Promise.all([
      client.fetchSubmissionPage(QUERY),
      client.fetchSubmissionPage({ ...QUERY, processNames: ['AHR'] })
    ])

    expect(tokenRequestCount()).toBe(1)
    expect(bearerTokens()).toEqual(['Bearer token-1', 'Bearer token-1'])
  })

  test('Should name the settings that are missing, without asking anything', async () => {
    const request = createClient({
      clientSecret: '',
      scope: ''
    }).fetchSubmissionPage(QUERY)

    await expect(request).rejects.toThrow(SubmissionHistoryApiError)
    await expect(request).rejects.toThrow(
      'Submission history API is not configured: set SUBMISSION_HISTORY_API_CLIENT_SECRET, SUBMISSION_HISTORY_API_SCOPE'
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("Should give Entra's reason when the token is refused, and ask again next time", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'unauthorized_client',
          error_description:
            "AADSTS700016: Application with identifier 'client-id' was not found in the directory 'tenant-id'.\r\nTrace ID: trace"
        },
        { status: 400 }
      )
    )

    const client = createClient()
    const error = await client.fetchSubmissionPage(QUERY).catch((e) => e)

    expect(error).toBeInstanceOf(SubmissionHistoryApiError)
    expect(error.message).toBe(
      "Submission history API token request failed with 400 (unauthorized_client: AADSTS700016: Application with identifier 'client-id' was not found in the directory 'tenant-id'.)"
    )
    expect(error.status).toBe(400)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    respondWith()
    await client.fetchSubmissionPage(QUERY)

    expect(bearerTokens()).toEqual(['Bearer token-1'])
  })

  test('Should say only the status when a refused token request gives no reason', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))

    await expect(createClient().fetchSubmissionPage(QUERY)).rejects.toThrow(
      /^Submission history API token request failed with 502$/
    )
  })

  test('Should refuse a token response without an access token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ token_type: 'Bearer' }))

    await expect(createClient().fetchSubmissionPage(QUERY)).rejects.toThrow(
      'Submission history API token response held no access token'
    )
  })

  test('Should give the status and correlation ID of a failed request', async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(
        jsonResponse(
          { statusCode: 500, message: 'Internal error' },
          { status: 500, headers: { 'x-correlation-id': 'corr-500' } }
        )
      )

    const error = await createClient()
      .fetchSubmissionPage(QUERY)
      .catch((e) => e)

    expect(error).toBeInstanceOf(SubmissionHistoryApiError)
    expect(error.message).toBe('Submission history API responded 500')
    expect(error.status).toBe(500)
    expect(error.correlationId).toBe('corr-500')
  })

  test("Should give the API's reason for a failed request", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(
        jsonResponse(
          [
            {
              message: 'An Internal server error occurred',
              code: 'INTERNAL_SERVER_ERROR',
              errors: [
                {
                  code: 'DATABASE_ERROR',
                  message: 'Failed to execute database query'
                }
              ]
            }
          ],
          { status: 500, headers: { 'x-correlation-id': 'corr-500' } }
        )
      )

    const error = await createClient()
      .fetchSubmissionPage(QUERY)
      .catch((e) => e)

    expect(error.message).toBe(
      'Submission history API responded 500 (DATABASE_ERROR: Failed to execute database query)'
    )
    expect(error.status).toBe(500)
    expect(error.correlationId).toBe('corr-500')
  })

  test('Should say only the status of a failed request whose body is not JSON', async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(
        new Response('<html>Bad gateway</html>', { status: 502 })
      )

    await expect(createClient().fetchSubmissionPage(QUERY)).rejects.toThrow(
      /^Submission history API responded 502$/
    )
  })

  test.each([
    [
      'its reasons',
      [
        {
          message: 'An Internal server error occurred',
          code: 'INTERNAL_SERVER_ERROR',
          errors: [
            {
              code: 'USER_REQUEST_ERROR',
              message:
                'Failed to execute database query, either or both of laboratoryId/processName is empty in query parameter'
            }
          ]
        }
      ],
      'Submission history API answered an error (USER_REQUEST_ERROR: Failed to execute database query, either or both of laboratoryId/processName is empty in query parameter)'
    ],
    [
      'its message, without reasons',
      { message: 'Something failed', errors: [] },
      'Submission history API answered an error (Something failed)'
    ]
  ])(
    'Should throw an error the API answers with a 200, giving %s',
    async (_case, body, message) => {
      fetchSpy
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(
          jsonResponse(body, { headers: { 'x-correlation-id': 'corr-200' } })
        )

      const error = await createClient()
        .fetchSubmissionPage(QUERY)
        .catch((e) => e)

      expect(error).toBeInstanceOf(SubmissionHistoryApiError)
      expect(error.message).toBe(message)
      expect(error.status).toBe(200)
      expect(error.correlationId).toBe('corr-200')
    }
  )

  test('Should get a new token after the gateway refuses one', async () => {
    let apiRequests = 0
    let tokenRequests = 0

    fetchSpy.mockImplementation(async (url) => {
      if (isTokenRequest(url)) {
        tokenRequests += 1
        return tokenResponse(`token-${tokenRequests}`)
      }

      apiRequests += 1
      return apiRequests === 1
        ? jsonResponse({ statusCode: 401 }, { status: 401 })
        : jsonResponse(PAGE)
    })

    const client = createClient()

    await expect(client.fetchSubmissionPage(QUERY)).rejects.toThrow(
      'Submission history API responded 401'
    )
    await client.fetchSubmissionPage(QUERY)

    expect(bearerTokens()).toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  test('Should read an empty response as no body', async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    expect(await createClient().fetchSubmissionPage(QUERY)).toEqual({
      status: 204,
      correlationId: null,
      body: null
    })
  })

  test('Should refuse a response that is not JSON', async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(
        new Response('<html>Gateway</html>', {
          status: 200,
          headers: { 'x-correlation-id': 'corr-html' }
        })
      )

    const error = await createClient()
      .fetchSubmissionPage(QUERY)
      .catch((e) => e)

    expect(error.message).toBe('Submission history API response was not JSON')
    expect(error.correlationId).toBe('corr-html')
    expect(error.cause).toBeInstanceOf(SyntaxError)
  })

  test('Should read its settings from configuration', async () => {
    const configured = config.get('submissionHistoryApi')

    config.set('submissionHistoryApi', { ...SETTINGS, url: '' })

    try {
      await expect(
        submissionHistoryApi.fetchSubmissionPage(QUERY)
      ).rejects.toThrow(
        'Submission history API is not configured: set SUBMISSION_HISTORY_API_URL'
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      config.set('submissionHistoryApi', configured)
    }
  })
})
