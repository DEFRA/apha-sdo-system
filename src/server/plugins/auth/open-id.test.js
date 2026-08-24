import hapi from '@hapi/hapi'
import { vi } from 'vitest'

import { config } from '#/config/config.js'
import {
  getEndSessionEndpoint,
  getOidcBrowserSettings,
  openId
} from './open-id.js'

describe('getOidcBrowserSettings', () => {
  test('uses query and Lax cookies locally', () => {
    expect(getOidcBrowserSettings(false)).toEqual({
      responseMode: 'query',
      sameSite: 'Lax'
    })
  })

  test('uses form_post and None cookies on CDP', () => {
    expect(getOidcBrowserSettings(true)).toEqual({
      responseMode: 'form_post',
      sameSite: 'None'
    })
  })
})

describe('getEndSessionEndpoint', () => {
  test('returns the endpoint from OIDC discovery metadata', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        end_session_endpoint: 'http://localhost:5556/logout'
      })
    })

    await expect(getEndSessionEndpoint(fetchImplementation)).resolves.toBe(
      'http://localhost:5556/logout'
    )
  })

  test('returns null when the provider has no logout endpoint', async () => {
    await expect(
      getEndSessionEndpoint(
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({})
        })
      )
    ).resolves.toBeNull()
  })

  test('rejects a failed discovery request', async () => {
    await expect(
      getEndSessionEndpoint(
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503
        })
      )
    ).rejects.toThrow('Unable to load OIDC discovery document (503)')
  })
})

describe('openId plugin', () => {
  test('registers in client-secret mode', async () => {
    const originalConfig = structuredClone(config.get('auth.entraId'))
    const server = hapi.server()

    try {
      config.set('auth.entraId.credentialMode', 'client-secret')
      config.set('auth.entraId.clientSecret', 'replacement-secret')
      config.set(
        'auth.entraId.discoveryUrl',
        'https://login.example/.well-known/openid-configuration'
      )

      await expect(server.register(openId)).resolves.toBe(server)
    } finally {
      await server.stop()
      config.set('auth.entraId', originalConfig)
    }
  })

  test('registers with the first DEV client-secret configuration', async () => {
    const original = {
      appBaseUrl: config.get('appBaseUrl'),
      auth: structuredClone(config.get('auth.entraId')),
      cacheEngine: config.get('session.cache.engine'),
      cookiePassword: config.get('session.cookie.password'),
      cookieSecure: config.get('session.cookie.secure'),
      nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY,
      serviceVersion: config.get('serviceVersion')
    }
    const server = hapi.server()

    try {
      config.set('serviceVersion', 'dev-smoke-test')
      config.set(
        'appBaseUrl',
        'https://apha-sdo-system.dev.cdp-int.defra.cloud'
      )
      config.set('auth.entraId', {
        ...original.auth,
        authorizationMode: 'tenant-only',
        clientId: 'de586797-a50f-4b14-b777-e5889a37e4f8',
        clientSecret: 'replacement-secret',
        credentialMode: 'client-secret',
        discoveryUrl: null,
        tenantId: '6f504113-6b64-43f2-ade9-242e05780007',
        tenantWideAccessConfirmed: true
      })
      config.set('session.cache.engine', 'redis')
      config.set(
        'session.cookie.password',
        'a-unique-dev-cookie-password-over-32-characters'
      )
      config.set('session.cookie.secure', true)
      process.env.NODE_USE_ENV_PROXY = '1'

      await expect(server.register(openId)).resolves.toBe(server)
    } finally {
      await server.stop()
      config.set('appBaseUrl', original.appBaseUrl)
      config.set('auth.entraId', original.auth)
      config.set('serviceVersion', original.serviceVersion)
      config.set('session.cache.engine', original.cacheEngine)
      config.set('session.cookie.password', original.cookiePassword)
      config.set('session.cookie.secure', original.cookieSecure)

      if (original.nodeUseEnvProxy === undefined) {
        delete process.env.NODE_USE_ENV_PROXY
      } else {
        process.env.NODE_USE_ENV_PROXY = original.nodeUseEnvProxy
      }
    }
  })
})
