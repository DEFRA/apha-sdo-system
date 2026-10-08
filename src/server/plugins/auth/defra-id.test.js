import hapi from '@hapi/hapi'
import { vi } from 'vitest'

const defraIdMocks = vi.hoisted(() => ({
  getDefraIdOidcConfig: vi.fn(),
  validateDefraIdConfiguration: vi.fn()
}))

vi.mock('#/server/auth/defra-id.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...defraIdMocks
}))

const { config } = await import('#/config/config.js')
const { DEFRA_ID_STATE_COOKIE_NAME } =
  await import('#/server/auth/auth-constants.js')
const { defraIdOpenId } = await import('./defra-id.js')

describe('defraIdOpenId plugin', () => {
  let server
  let logger

  beforeEach(() => {
    server = hapi.server()
    logger = { warn: vi.fn(), info: vi.fn() }
    // As hapi-pino does in the app, so plugin realms see it
    server.decorate('server', 'logger', logger)
    defraIdMocks.getDefraIdOidcConfig.mockReset()
    defraIdMocks.validateDefraIdConfiguration.mockReset()
    defraIdMocks.getDefraIdOidcConfig.mockResolvedValue({})
  })

  afterEach(() => {
    config.set('auth.defraId.enabled', false)
    config.set('serviceVersion', undefined)
  })

  test('does nothing while external sign-in is disabled', async () => {
    config.set('auth.defraId.enabled', false)

    await server.register(defraIdOpenId)

    expect(defraIdMocks.validateDefraIdConfiguration).not.toHaveBeenCalled()
    expect(defraIdMocks.getDefraIdOidcConfig).not.toHaveBeenCalled()
    expect(server.states.cookies[DEFRA_ID_STATE_COOKIE_NAME]).toBeUndefined()
  })

  test('validates, registers the state cookie and warms discovery when enabled', async () => {
    config.set('auth.defraId.enabled', true)

    await server.register(defraIdOpenId)

    expect(defraIdMocks.validateDefraIdConfiguration).toHaveBeenCalledWith({
      settings: config.get('auth.defraId'),
      isCdp: false
    })
    expect(defraIdMocks.getDefraIdOidcConfig).toHaveBeenCalledTimes(1)
    expect(server.states.cookies[DEFRA_ID_STATE_COOKIE_NAME]).toMatchObject({
      encoding: 'iron',
      isHttpOnly: true,
      isSameSite: 'Lax',
      path: '/'
    })
  })

  test('only warns when discovery fails off CDP', async () => {
    config.set('auth.defraId.enabled', true)
    defraIdMocks.getDefraIdOidcConfig.mockRejectedValue(
      new Error('stub not running')
    )

    await expect(server.register(defraIdOpenId)).resolves.not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('discovery failed at start-up')
    )
  })

  test('fails start-up when discovery fails on CDP', async () => {
    config.set('auth.defraId.enabled', true)
    config.set('serviceVersion', '1.0.0')
    defraIdMocks.getDefraIdOidcConfig.mockRejectedValue(
      new Error('wrong metadata URL')
    )

    await expect(server.register(defraIdOpenId)).rejects.toThrow(
      'wrong metadata URL'
    )
    expect(defraIdMocks.validateDefraIdConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ isCdp: true })
    )
  })

  test('refuses an invalid configuration before anything else', async () => {
    config.set('auth.defraId.enabled', true)
    defraIdMocks.validateDefraIdConfiguration.mockImplementation(() => {
      throw new Error('Invalid Defra ID configuration')
    })

    await expect(server.register(defraIdOpenId)).rejects.toThrow(
      'Invalid Defra ID configuration'
    )
    expect(defraIdMocks.getDefraIdOidcConfig).not.toHaveBeenCalled()
  })
})
