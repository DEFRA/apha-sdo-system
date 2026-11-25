import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

/**
 * Client of the APHA SDO API's batch submission message endpoint, which the
 * lab's submission history is read from (see
 * src/server/routes/previous-submissions/submission-history.js). The API is
 * Boomi over Azure Synapse, behind the Defra API gateway, and takes an
 * OAuth 2.0 access token issued to this service with the client credentials
 * grant. The token is kept in memory and reused until shortly before it
 * expires.
 */

// So that a request never carries a token that expires on its way
const TOKEN_REFRESH_MARGIN_MS = 60000

const REQUIRED_SETTINGS = [
  ['url', 'SUBMISSION_HISTORY_API_URL'],
  ['tokenUrl', 'SUBMISSION_HISTORY_API_TOKEN_URL'],
  ['clientId', 'SUBMISSION_HISTORY_API_CLIENT_ID'],
  ['clientSecret', 'SUBMISSION_HISTORY_API_CLIENT_SECRET'],
  ['scope', 'SUBMISSION_HISTORY_API_SCOPE']
]

/**
 * A token or API request that failed. `status` is the HTTP status, when
 * there was a response, and `correlationId` the gateway's
 * x-correlation-id, which the API team can trace a request by.
 */
export class SubmissionHistoryApiError extends Error {
  constructor(message, { status = null, correlationId = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'SubmissionHistoryApiError'
    this.status = status
    this.correlationId = correlationId
  }
}

function configuredSettings(settings) {
  const missing = REQUIRED_SETTINGS.filter(([name]) => !settings[name]).map(
    ([, variable]) => variable
  )

  if (missing.length > 0) {
    throw new SubmissionHistoryApiError(
      `Submission history API is not configured: set ${missing.join(', ')}`
    )
  }

  return settings
}

// The parameter names are case sensitive. Spaces go as %20, as in the API's
// own example ("Test%20Lab%201"); URLSearchParams would send them as +. A
// list goes comma-separated, the commas as they are ("processName=BR,AHR").
function queryOf(parameters) {
  return Object.entries(parameters)
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${[value].flat().map(encodeURIComponent).join(',')}`
    )
    .join('&')
}

// "… failed with 500 (DATABASE_ERROR: …)", or the message alone without a
// reason
function withReason(message, reason) {
  return reason ? `${message} (${reason})` : message
}

// Entra's error and the first line of its description, which leads with
// the AADSTS code
async function tokenErrorOf(response) {
  const body = await response.json().catch(() => null)
  const description =
    typeof body?.error_description === 'string'
      ? body.error_description.split(/\r?\n/)[0]
      : null

  return [body?.error, description].filter(Boolean).join(': ')
}

async function requestToken({
  tokenUrl,
  clientId,
  clientSecret,
  scope,
  timeoutMs
}) {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope
    }),
    signal: AbortSignal.timeout(timeoutMs)
  })

  if (!response.ok) {
    const reason = await tokenErrorOf(response)

    throw new SubmissionHistoryApiError(
      withReason(
        `Submission history API token request failed with ${response.status}`,
        reason
      ),
      { status: response.status }
    )
  }

  const body = await response.json()
  const expiresInMs = Number(body?.expires_in) * 1000

  if (typeof body?.access_token !== 'string' || !Number.isFinite(expiresInMs)) {
    throw new SubmissionHistoryApiError(
      'Submission history API token response held no access token'
    )
  }

  return { accessToken: body.access_token, expiresAt: Date.now() + expiresInMs }
}

async function bodyOf(response, correlationId) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : null
  } catch (error) {
    throw new SubmissionHistoryApiError(
      'Submission history API response was not JSON',
      { status: response.status, correlationId, cause: error }
    )
  }
}

// The API answers an error as [{ "message": "…", "code": "…", "errors":
// [{ "code": "DATABASE_ERROR", "message": "…" }] }], at times with a 200.
// What went wrong, as "DATABASE_ERROR: Failed to execute database query",
// or null for a body that is not one.
function apiErrorOf(body) {
  const [first] = Array.isArray(body) ? body : [body]

  if (first === null || typeof first !== 'object' || !('errors' in first)) {
    return null
  }

  const errors = Array.isArray(first.errors) ? first.errors : []
  const reasons = errors
    .map((error) => [error?.code, error?.message].filter(Boolean).join(': '))
    .filter(Boolean)

  return reasons.length > 0 ? reasons.join('; ') : String(first.message)
}

/**
 * @param {{ getSettings?: () => object }} [options] - where the
 *   `submissionHistoryApi` settings are read from, at every request
 */
export function createSubmissionHistoryApiClient({
  getSettings = () => config.get('submissionHistoryApi')
} = {}) {
  let token = null
  let pendingToken = null

  // Concurrent requests share one token request
  async function accessToken(settings) {
    if (token && Date.now() < token.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return token.accessToken
    }

    pendingToken ??= requestToken(settings).finally(() => {
      pendingToken = null
    })
    token = await pendingToken

    return token.accessToken
  }

  return {
    /**
     * One page of a lab's submissions of the given processes (BR, AHR,
     * DT), newest first, as the API returns it. The body is null when the
     * API returns none. An error the API answers, whatever its status, is
     * thrown.
     * @param {{ processNames: string[], laboratoryId: string, page: number, pageSize: number }} query
     * @returns {Promise<{ status: number, correlationId: string | null, body: unknown }>}
     */
    async fetchSubmissionPage({ processNames, laboratoryId, page, pageSize }) {
      const settings = configuredSettings(getSettings())
      const query = queryOf({
        processName: processNames,
        laboratoryId,
        page,
        pageSize
      })
      const response = await fetch(`${settings.url}?${query}`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${await accessToken(settings)}`
        },
        signal: AbortSignal.timeout(settings.timeoutMs)
      })
      const correlationId = response.headers.get('x-correlation-id')

      if (!response.ok) {
        // A token the gateway refuses is not offered again
        if (response.status === statusCodes.unauthorized) {
          token = null
        }

        const failureReason = apiErrorOf(
          await bodyOf(response, correlationId).catch(() => null)
        )

        throw new SubmissionHistoryApiError(
          withReason(
            `Submission history API responded ${response.status}`,
            failureReason
          ),
          { status: response.status, correlationId }
        )
      }

      const body = await bodyOf(response, correlationId)
      const reason = apiErrorOf(body)

      if (reason) {
        throw new SubmissionHistoryApiError(
          `Submission history API answered an error (${reason})`,
          { status: response.status, correlationId }
        )
      }

      return { status: response.status, correlationId, body }
    }
  }
}

export const submissionHistoryApi = createSubmissionHistoryApiClient()
