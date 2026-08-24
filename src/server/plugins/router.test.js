import hapi from '@hapi/hapi'
import { vi } from 'vitest'

const viteMiddleware = vi.fn((request, response) => {
  expect(request.url).toBe('/src/client/stylesheets/application.scss')
  response.setHeader('content-type', 'text/css')
  response.end('body { color: black; }')
})

vi.mock('vite', () => ({
  createServer: vi.fn().mockResolvedValue({
    middlewares: viteMiddleware
  })
}))

vi.mock(import('#/config/config.js'), async (importOriginal) => {
  const originalModule = await importOriginal()

  return {
    config: {
      get(key) {
        if (key === 'isProduction' || key === 'isTest') {
          return false
        }
        return originalModule.config.get(key)
      }
    }
  }
})

const { router } = await import('./router.js')

describe('router development assets', () => {
  test('serves Vite CSS through the unauthenticated public route', async () => {
    const server = hapi.server()
    server.auth.scheme('test', () => ({
      authenticate(_request, h) {
        return h.authenticated({ credentials: {} })
      }
    }))
    server.auth.strategy('session', 'test')
    server.auth.default('session')
    await server.register(router)
    await server.initialize()

    const response = await server.inject(
      '/public/src/client/stylesheets/application.scss'
    )

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/css')
    expect(response.result).toBe('body { color: black; }')
    expect(viteMiddleware).toHaveBeenCalledOnce()

    await server.stop()
  })
})
