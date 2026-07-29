import { vi } from 'vitest'

const mockLoggerInfo = vi.fn()
const mockServer = {
  start: vi.fn(),
  logger: {
    info: mockLoggerInfo
  }
}

const mockCreateServer = vi.fn()

vi.mock('#/config/config.js', () => ({
  config: {
    get: (key) => (key === 'port' ? 3097 : undefined)
  }
}))

vi.mock('../../server.js', () => ({
  createServer: mockCreateServer
}))

const { startServer } = await import('./start-server.js')

describe('#startServer', () => {
  beforeEach(() => {
    vi.stubEnv('PORT', '3097')
    mockCreateServer.mockReset()
    mockServer.start.mockReset()
    mockLoggerInfo.mockReset()
    mockCreateServer.mockResolvedValue(mockServer)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('When server starts', () => {
    test('Should start up server as expected', async () => {
      const server = await startServer()

      expect(mockCreateServer).toHaveBeenCalled()
      expect(mockServer.start).toHaveBeenCalled()

      expect(server).toBe(mockServer)
      expect(mockLoggerInfo).toHaveBeenCalledWith('Server started successfully')
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Access your frontend on http://localhost:3097'
      )
    })
  })

  describe('When server start fails', () => {
    test('Should log failed startup message', async () => {
      mockCreateServer.mockRejectedValue(new Error('Server failed to start'))

      await expect(startServer()).rejects.toThrow('Server failed to start')
    })
  })
})
