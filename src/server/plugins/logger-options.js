import { ecsFormat } from '@elastic/ecs-pino-format'
import { getTraceId } from '@defra/hapi-tracing'

import { config } from '#/config/config.js'

const logConfig = config.get('log')
const serviceName = config.get('serviceName')
const serviceVersion = config.get('serviceVersion')
const sensitiveQueryParameters = new Set([
  'access_token',
  'client_secret',
  'code',
  'error_description',
  'id_token',
  'refresh_token',
  'session_state',
  'state'
])

export function sanitiseRequestLog(request) {
  const sanitisedRequest = { ...request }

  if (typeof request.url === 'string') {
    const url = new URL(request.url, 'https://request.invalid')

    for (const parameter of sensitiveQueryParameters) {
      if (url.searchParams.has(parameter)) {
        url.searchParams.set(parameter, '[Redacted]')
      }
    }

    sanitisedRequest.url = `${url.pathname}${url.search}`
  }

  if (request.query && typeof request.query === 'object') {
    sanitisedRequest.query = { ...request.query }

    for (const parameter of sensitiveQueryParameters) {
      if (parameter in sanitisedRequest.query) {
        sanitisedRequest.query[parameter] = '[Redacted]'
      }
    }
  }

  return sanitisedRequest
}

const formatters = {
  ecs: {
    ...ecsFormat({
      serviceVersion,
      serviceName
    })
  },
  'pino-pretty': { transport: { target: 'pino-pretty' } }
}

export const loggerOptions = {
  enabled: logConfig.enabled,
  ignorePaths: ['/health'],
  redact: {
    paths: logConfig.redact,
    remove: true
  },
  level: logConfig.level,
  serializers: {
    req: sanitiseRequestLog
  },
  ...formatters[logConfig.format],
  nesting: true,
  mixin() {
    const mixinValues = {}
    const traceId = getTraceId()
    if (traceId) {
      mixinValues.trace = { id: traceId }
    }
    return mixinValues
  }
}
