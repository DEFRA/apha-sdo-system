import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockConfigGet,
  mockCreateViteServer,
  mockViteMiddleware,
  mockHapiConnectPlugin
} = vi.hoisted(() => ({
  mockConfigGet: vi.fn(),
  mockCreateViteServer: vi.fn(),
  mockViteMiddleware: { id: 'vite-middleware' },
  mockHapiConnectPlugin: { name: 'hapi-connect-mock' }
}))

vi.mock('#/config/config.js', () => ({
  config: {
    get: mockConfigGet
  }
}))

vi.mock('vite', () => ({
  createServer: mockCreateViteServer
}))

vi.mock('@defra/hapi-connect', () => ({
  default: mockHapiConnectPlugin
}))

vi.mock('@hapi/inert', () => ({
  default: { plugin: { name: 'inert' } }
}))

vi.mock('../routes/home/index.js', () => ({
  home: { plugin: { name: 'home' } }
}))

vi.mock('../routes/about/index.js', () => ({
  about: { plugin: { name: 'about' } }
}))

vi.mock('../routes/health/index.js', () => ({
  health: { plugin: { name: 'health' } }
}))

vi.mock('../routes/file-callback/index.js', () => ({
  fileCallback: { plugin: { name: 'file-callback' } }
}))

vi.mock('./serve-form-assets.js', () => ({
  serveFormAssets: { plugin: { name: 'serve-form-assets' } }
}))

vi.mock('./serve-static-files.js', () => ({
  serveStaticFiles: { plugin: { name: 'serve-static-files' } }
}))

async function loadRouter({ isProduction, isTest }) {
  vi.resetModules()
  mockConfigGet.mockReset()
  mockCreateViteServer.mockReset()

  mockConfigGet.mockImplementation((key) => {
    if (key === 'isProduction') {
      return isProduction
    }

    if (key === 'isTest') {
      return isTest
    }

    return undefined
  })

  mockCreateViteServer.mockResolvedValue({
    middlewares: mockViteMiddleware
  })

  const { router } = await import('./router.js')
  return router
}

describe('router plugin', () => {
  let server

  beforeEach(() => {
    server = {
      register: vi.fn().mockResolvedValue(undefined)
    }
  })

  it('registers Vite middleware in non-production and non-test environments', async () => {
    const router = await loadRouter({ isProduction: false, isTest: false })

    await router.plugin.register(server)

    expect(mockCreateViteServer).toHaveBeenCalledWith({
      server: { middlewareMode: true },
      appType: 'custom'
    })

    expect(server.register).toHaveBeenCalledWith({
      plugin: mockHapiConnectPlugin,
      options: {
        path: '/public',
        middleware: [mockViteMiddleware]
      }
    })
  })

  it('registers static files plugin in production/test environments', async () => {
    const router = await loadRouter({ isProduction: true, isTest: false })

    await router.plugin.register(server)

    expect(mockCreateViteServer).not.toHaveBeenCalled()
    expect(server.register).toHaveBeenCalledWith({
      plugin: { name: 'serve-static-files' }
    })
  })
})
