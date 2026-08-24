import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { getEntraIdDiscoveryUrl } from '#/server/auth/credential-provider.js'

describe('#contentSecurityPolicy', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should set the CSP policy header', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(resp.headers['content-security-policy']).toBeDefined()
    const oidcOrigin = new URL(
      getEntraIdDiscoveryUrl(config.get('auth.entraId'))
    ).origin
    expect(resp.headers['content-security-policy']).toContain(
      `form-action 'self' ${oidcOrigin}`
    )
  })
})
