import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConfigGet, mockEcsFormat, mockGetTraceId } = vi.hoisted(() => ({
  mockConfigGet: vi.fn(),
  mockEcsFormat: vi.fn(),
  mockGetTraceId: vi.fn()
}))

vi.mock('#/config/config.js', () => ({
  config: {
    get: mockConfigGet
  }
}))

vi.mock('@elastic/ecs-pino-format', () => ({
  ecsFormat: mockEcsFormat
}))

vi.mock('@defra/hapi-tracing', () => ({
  getTraceId: mockGetTraceId
}))

function stubConfig(logFormat = 'pino-pretty') {
  mockConfigGet.mockImplementation((key) => {
    const values = {
      log: {
        enabled: true,
        redact: ['request.headers.authorization'],
        level: 'info',
        format: logFormat
      },
      serviceName: 'apha-sdo-system',
      serviceVersion: '1.2.3'
    }

    return values[key]
  })
}

async function loadLoggerOptions(logFormat = 'pino-pretty') {
  vi.resetModules()
  mockConfigGet.mockReset()
  mockEcsFormat.mockReset()
  mockGetTraceId.mockReset()

  stubConfig(logFormat)
  mockEcsFormat.mockReturnValue({ ecsMeta: true })

  const { loggerOptions } = await import('./logger-options.js')
  return loggerOptions
}

describe('loggerOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds pino-pretty logger options from config values', async () => {
    const loggerOptions = await loadLoggerOptions('pino-pretty')

    expect(mockEcsFormat).toHaveBeenCalledWith({
      serviceVersion: '1.2.3',
      serviceName: 'apha-sdo-system'
    })
    expect(loggerOptions).toMatchObject({
      enabled: true,
      ignorePaths: ['/health'],
      redact: {
        paths: ['request.headers.authorization'],
        remove: true
      },
      level: 'info',
      transport: {
        target: 'pino-pretty'
      },
      nesting: true
    })
  })

  it('adds trace id in mixin when one is present', async () => {
    const loggerOptions = await loadLoggerOptions('ecs')
    mockGetTraceId.mockReturnValue('trace-123')

    expect(loggerOptions.mixin()).toEqual({
      trace: { id: 'trace-123' }
    })
    expect(loggerOptions.ecsMeta).toBe(true)
  })

  it('returns an empty mixin object when no trace id is present', async () => {
    const loggerOptions = await loadLoggerOptions('ecs')
    mockGetTraceId.mockReturnValue(undefined)

    expect(loggerOptions.mixin()).toEqual({})
  })
})
