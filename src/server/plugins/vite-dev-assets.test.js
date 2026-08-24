import hapi from '@hapi/hapi'
import { vi } from 'vitest'

import { viteDevAssets } from './vite-dev-assets.js'

async function createAssetServer(middleware) {
  const server = hapi.server()
  await server.register({
    plugin: viteDevAssets,
    options: {
      path: '/public',
      middleware
    }
  })
  await server.initialize()
  return server
}

describe('viteDevAssets', () => {
  test('serves an asset without authentication', async () => {
    const middleware = vi.fn((request, response) => {
      expect(request.url).toBe('/app.js')
      response.end('asset content')
    })
    const server = await createAssetServer(middleware)

    const response = await server.inject('/public/app.js')

    expect(response.statusCode).toBe(200)
    expect(response.result).toBe('asset content')
    expect(server.match('get', '/public/app.js').settings.auth).toBe(false)
    await server.stop()
  })

  test('returns not found when Vite calls next', async () => {
    const server = await createAssetServer((_request, _response, next) =>
      next()
    )

    const response = await server.inject('/public/missing.js')

    expect(response.statusCode).toBe(404)
    await server.stop()
  })
})
