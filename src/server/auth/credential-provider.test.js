import {
  AUTH_CREDENTIAL_MODES,
  ClientSecretTokenProvider,
  createEntraIdCredentialProvider,
  getEntraIdDiscoveryUrl,
  validateEntraIdConfiguration
} from './credential-provider.js'

const baseSettings = {
  allowedGroupIds: [],
  assignmentRequiredConfirmed: false,
  authorizationMode: 'groups',
  clientId: 'local-stub-client',
  clientSecret: '',
  credentialMode: AUTH_CREDENTIAL_MODES.MOCK,
  discoveryUrl: null,
  earlyRefreshMs: 300000,
  federatedAudience: ['api://AzureADTokenExchange'],
  tenantWideAccessConfirmed: false,
  tenantId: ''
}

describe('Entra credential provider', () => {
  test('creates a mock provider for the local stub', async () => {
    const provider = createEntraIdCredentialProvider(baseSettings)

    expect(provider.type).toBe('federated')
    await expect(provider.getCredentials()).resolves.toBe(
      'local-stub-client-assertion'
    )
  })

  test('creates a non-logging client secret provider', async () => {
    const provider = createEntraIdCredentialProvider({
      ...baseSettings,
      credentialMode: AUTH_CREDENTIAL_MODES.CLIENT_SECRET,
      clientSecret: 'replacement-secret'
    })

    expect(provider).toBeInstanceOf(ClientSecretTokenProvider)
    expect(provider.type).toBe('client_secret')
    expect(provider.getCredentials).toHaveLength(1)
    await expect(provider.getCredentials()).resolves.toBe('replacement-secret')
  })

  test('requires a client secret in client-secret mode', () => {
    expect(() =>
      createEntraIdCredentialProvider({
        ...baseSettings,
        credentialMode: AUTH_CREDENTIAL_MODES.CLIENT_SECRET
      })
    ).toThrow('AUTH_ENTRA_ID_CLIENT_SECRET is required')
  })

  test('creates a web identity provider', () => {
    const provider = createEntraIdCredentialProvider({
      ...baseSettings,
      credentialMode: AUTH_CREDENTIAL_MODES.WEB_IDENTITY
    })

    expect(provider.type).toBe('federated')
    expect(provider.audience).toEqual(['api://AzureADTokenExchange'])
  })

  test('rejects an unsupported mode', () => {
    expect(() =>
      createEntraIdCredentialProvider({
        ...baseSettings,
        credentialMode: 'unsupported'
      })
    ).toThrow('Unsupported Entra credential mode')
  })
})

describe('validateEntraIdConfiguration', () => {
  test('allows local mock configuration outside CDP', () => {
    expect(() =>
      validateEntraIdConfiguration({
        settings: baseSettings,
        isCdp: false
      })
    ).not.toThrow()
  })

  test('rejects unsafe CDP defaults', () => {
    let error

    try {
      validateEntraIdConfiguration({
        settings: baseSettings,
        isCdp: true,
        appBaseUrl: 'http://localhost:3000',
        cookiePassword: 'the-password-must-be-at-least-32-characters-long',
        cookieSecure: false,
        cacheEngine: 'memory',
        nodeUseEnvProxy: undefined
      })
    } catch (caughtError) {
      error = caughtError
    }

    expect(error.message).toContain('mock credential mode')
    expect(error.message).toContain('APP_BASE_URL must use HTTPS')
    expect(error.message).toContain('AUTH_ENTRA_ID_TENANT_ID is required')
    expect(error.message).toContain('AUTH_ENTRA_ID_CLIENT_ID')
    expect(error.message).toContain('SESSION_COOKIE_PASSWORD')
    expect(error.message).toContain('SESSION_COOKIE_SECURE')
    expect(error.message).toContain('SESSION_CACHE_ENGINE')
    expect(error.message).toContain('NODE_USE_ENV_PROXY')
    expect(error.message).toContain('AUTH_ENTRA_ID_ALLOWED_GROUP_IDS')
  })

  test('accepts an explicit assignment-only CDP configuration', () => {
    expect(() =>
      validateEntraIdConfiguration({
        settings: {
          ...baseSettings,
          authorizationMode: 'assignment-only',
          assignmentRequiredConfirmed: true,
          clientId: 'environment-client-id',
          credentialMode: AUTH_CREDENTIAL_MODES.WEB_IDENTITY,
          tenantId: 'tenant-id'
        },
        isCdp: true,
        appBaseUrl: 'https://service.example.gov.uk',
        cookiePassword: 'a-unique-cookie-password-over-32-characters',
        cookieSecure: true,
        cacheEngine: 'redis',
        nodeUseEnvProxy: '1'
      })
    ).not.toThrow()
  })

  test('rejects an HTTP discovery override on CDP', () => {
    expect(() =>
      validateEntraIdConfiguration({
        settings: {
          ...baseSettings,
          authorizationMode: 'assignment-only',
          assignmentRequiredConfirmed: true,
          clientId: 'environment-client-id',
          credentialMode: AUTH_CREDENTIAL_MODES.CLIENT_SECRET,
          discoveryUrl:
            'http://identity.example/.well-known/openid-configuration'
        },
        isCdp: true,
        appBaseUrl: 'https://service.example.gov.uk',
        cookiePassword: 'a-unique-cookie-password-over-32-characters',
        cookieSecure: true,
        cacheEngine: 'redis',
        nodeUseEnvProxy: '1'
      })
    ).toThrow('AUTH_ENTRA_ID_OIDC_CONFIGURATION_URL must use HTTPS')
  })

  test('requires explicit confirmation for assignment-only mode', () => {
    expect(() =>
      validateEntraIdConfiguration({
        settings: {
          ...baseSettings,
          authorizationMode: 'assignment-only',
          clientId: 'environment-client-id',
          credentialMode: AUTH_CREDENTIAL_MODES.CLIENT_SECRET,
          tenantId: 'tenant-id'
        },
        isCdp: true,
        appBaseUrl: 'https://service.example.gov.uk',
        cookiePassword: 'a-unique-cookie-password-over-32-characters',
        cookieSecure: true,
        cacheEngine: 'redis',
        nodeUseEnvProxy: '1'
      })
    ).toThrow('AUTH_ENTRA_ID_ASSIGNMENT_REQUIRED_CONFIRMED must be true')
  })

  test('accepts explicitly confirmed tenant-only access for a DEV smoke test', () => {
    expect(() =>
      validateEntraIdConfiguration({
        settings: {
          ...baseSettings,
          authorizationMode: 'tenant-only',
          clientId: 'environment-client-id',
          credentialMode: AUTH_CREDENTIAL_MODES.CLIENT_SECRET,
          tenantId: 'tenant-id',
          tenantWideAccessConfirmed: true
        },
        isCdp: true,
        appBaseUrl: 'https://service.example.gov.uk',
        cookiePassword: 'a-unique-cookie-password-over-32-characters',
        cookieSecure: true,
        cacheEngine: 'redis',
        nodeUseEnvProxy: '1'
      })
    ).not.toThrow()
  })

  test('requires explicit confirmation for tenant-only mode', () => {
    expect(() =>
      validateEntraIdConfiguration({
        settings: {
          ...baseSettings,
          authorizationMode: 'tenant-only',
          clientId: 'environment-client-id',
          credentialMode: AUTH_CREDENTIAL_MODES.CLIENT_SECRET,
          tenantId: 'tenant-id'
        },
        isCdp: true,
        appBaseUrl: 'https://service.example.gov.uk',
        cookiePassword: 'a-unique-cookie-password-over-32-characters',
        cookieSecure: true,
        cacheEngine: 'redis',
        nodeUseEnvProxy: '1'
      })
    ).toThrow('AUTH_ENTRA_ID_TENANT_WIDE_ACCESS_CONFIRMED must be true')
  })
})

describe('getEntraIdDiscoveryUrl', () => {
  test('uses an explicit discovery URL', () => {
    expect(
      getEntraIdDiscoveryUrl({
        ...baseSettings,
        discoveryUrl:
          'https://identity.example/.well-known/openid-configuration'
      })
    ).toBe('https://identity.example/.well-known/openid-configuration')
  })

  test('uses the local stub in mock mode', () => {
    expect(getEntraIdDiscoveryUrl(baseSettings)).toBe(
      'http://localhost:5556/.well-known/openid-configuration'
    )
  })

  test('derives the Entra discovery URL from the tenant', () => {
    expect(
      getEntraIdDiscoveryUrl({
        ...baseSettings,
        credentialMode: AUTH_CREDENTIAL_MODES.CLIENT_SECRET,
        tenantId: 'tenant-id'
      })
    ).toBe(
      'https://login.microsoftonline.com/tenant-id/v2.0/.well-known/openid-configuration'
    )
  })

  test('requires a tenant outside mock mode', () => {
    expect(() =>
      getEntraIdDiscoveryUrl({
        ...baseSettings,
        credentialMode: AUTH_CREDENTIAL_MODES.WEB_IDENTITY
      })
    ).toThrow('AUTH_ENTRA_ID_TENANT_ID is required')
  })
})
