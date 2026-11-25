/**
 * The convict schema of `submissionHistoryApi` in ./config.js: the lab's
 * submitted reports, read for the previous submissions page from the APHA
 * SDO API (Boomi, over Azure Synapse) on the Defra API gateway.
 */
export const submissionHistoryApiSchema = {
  enabled: {
    doc: 'Read the lab submission history from the APHA SDO API. Off, the history reads as empty',
    format: Boolean,
    default: false,
    env: 'SUBMISSION_HISTORY_API_ENABLED'
  },
  url: {
    doc: 'The batch submission message endpoint of the APHA SDO API, without a query',
    format: String,
    default: '',
    env: 'SUBMISSION_HISTORY_API_URL'
  },
  tokenUrl: {
    doc: 'OAuth 2.0 token endpoint the API client credentials are exchanged at',
    format: String,
    default: '',
    env: 'SUBMISSION_HISTORY_API_TOKEN_URL'
  },
  clientId: {
    doc: 'OAuth 2.0 client ID issued for the API',
    format: String,
    default: '',
    env: 'SUBMISSION_HISTORY_API_CLIENT_ID'
  },
  clientSecret: {
    doc: 'OAuth 2.0 client secret issued for the API',
    format: String,
    default: '',
    sensitive: true,
    env: 'SUBMISSION_HISTORY_API_CLIENT_SECRET'
  },
  scope: {
    doc: 'OAuth 2.0 scope the access token is requested for, e.g. api://{application ID}/.default',
    format: String,
    default: '',
    env: 'SUBMISSION_HISTORY_API_SCOPE'
  },
  pageSize: {
    doc: 'Reports listed per page of the previous submissions page',
    format: 'nat',
    default: 10,
    env: 'SUBMISSION_HISTORY_API_PAGE_SIZE'
  },
  pendingTtlMs: {
    doc: 'How long a report just submitted is shown, as processing, until the API returns it, in milliseconds (see src/server/routes/previous-submissions/pending-submissions.js)',
    format: 'nat',
    default: 3600000,
    env: 'SUBMISSION_HISTORY_PENDING_TTL_MS'
  },
  timeoutMs: {
    doc: 'How long a token or API request may take, in milliseconds. The DEV API answers in 3 to 5 seconds',
    format: 'nat',
    default: 15000,
    env: 'SUBMISSION_HISTORY_API_TIMEOUT_MS'
  }
}
