import { vi } from 'vitest'

const mockGetDefraIdOrigins = vi.fn()

vi.mock('#/server/auth/defra-id.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getDefraIdOrigins: (...args) => mockGetDefraIdOrigins(...args)
}))

const { config } = await import('#/config/config.js')
const { createServer } = await import('#/server/server.js')
const { getEntraIdDiscoveryUrl } =
  await import('#/server/auth/credential-provider.js')
const { getContentSecurityPolicyOptions, getDefraIdFormActionOrigins } =
  await import('./content-security-policy.js')

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

describe('getDefraIdFormActionOrigins', () => {
  const settings = {
    enabled: true,
    discoveryUrl:
      'https://your-account.example/idphub/b2c/policy/.well-known/openid-configuration',
    redirectHosts: [
      ' https://*.account.gov.uk ',
      'https://*.access.service.gov.uk',
      ''
    ]
  }

  beforeEach(() => {
    mockGetDefraIdOrigins.mockReset()
  })

  test('is empty when external sign-in is disabled', async () => {
    await expect(
      getDefraIdFormActionOrigins({ ...settings, enabled: false })
    ).resolves.toEqual([])
    expect(mockGetDefraIdOrigins).not.toHaveBeenCalled()
  })

  test('lists the provider origins from discovery and the configured redirect hosts', async () => {
    mockGetDefraIdOrigins.mockResolvedValue([
      'https://your-account.example',
      'https://tenant.b2clogin.example'
    ])

    await expect(getDefraIdFormActionOrigins(settings)).resolves.toEqual([
      'https://your-account.example',
      'https://tenant.b2clogin.example',
      'https://*.account.gov.uk',
      'https://*.access.service.gov.uk'
    ])
  })

  test('falls back to the discovery origin when discovery is unavailable', async () => {
    mockGetDefraIdOrigins.mockRejectedValue(new Error('stub not running'))
    const logger = { warn: vi.fn() }

    await expect(
      getDefraIdFormActionOrigins(settings, { logger })
    ).resolves.toEqual([
      'https://your-account.example',
      'https://*.account.gov.uk',
      'https://*.access.service.gov.uk'
    ])
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('getContentSecurityPolicyOptions', () => {
  test('allows the Defra ID origins as form actions after the Entra origin', () => {
    const { formAction } = getContentSecurityPolicyOptions([
      'https://tenant.b2clogin.example'
    ])

    expect(formAction.slice(0, 3)).toEqual([
      'self',
      new URL(getEntraIdDiscoveryUrl(config.get('auth.entraId'))).origin,
      'https://tenant.b2clogin.example'
    ])
  })
})
