import { vi } from 'vitest'

import {
  dropUserSession,
  getUserSession,
  getUserSessionIdByEntraSid,
  setUserSession,
  validateUserSession
} from './user-session.js'

function createCache(initialSession) {
  return {
    get: vi.fn().mockResolvedValue(initialSession ?? null),
    set: vi.fn().mockResolvedValue(undefined),
    drop: vi.fn().mockResolvedValue(undefined)
  }
}

function createRequest(cache, ensureValidToken = vi.fn()) {
  return {
    server: {
      app: {
        userSessionCache: cache
      }
    },
    ensureValidToken,
    logger: {
      warn: vi.fn()
    }
  }
}

function createAccessToken(expiresInSeconds) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
    ''
  ].join('.')
}

const claims = {
  oid: 'user-id',
  name: 'A Person',
  preferred_username: 'person@example.gov.uk',
  groups: ['local-dev-group']
}

const session = {
  token: {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    claims
  },
  claims,
  user: {
    id: 'user-id',
    name: 'A Person',
    email: 'person@example.gov.uk',
    groups: ['local-dev-group']
  }
}

describe('user session cache', () => {
  test('sets, gets and drops a session', async () => {
    const cache = createCache(session)
    const server = { app: { userSessionCache: cache } }

    await setUserSession(server, 'session-id', session)
    await expect(getUserSession(server, 'session-id')).resolves.toBe(session)
    await dropUserSession(server, 'session-id')

    expect(cache.set).toHaveBeenCalledWith('session-id', session)
    expect(cache.get).toHaveBeenCalledWith('session-id')
    expect(cache.drop).toHaveBeenCalledWith('session-id')
  })

  test('does not query or drop the cache without a session ID', async () => {
    const cache = createCache()
    const server = { app: { userSessionCache: cache } }

    await expect(getUserSession(server)).resolves.toBeNull()
    await dropUserSession(server)

    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.drop).not.toHaveBeenCalled()
  })

  test('requires the cache to be initialised', async () => {
    await expect(
      setUserSession({ app: {} }, 'session-id', session)
    ).rejects.toThrow('User session cache has not been initialised')
  })

  test('indexes Entra sid and revokes Yar when dropping a session', async () => {
    const indexedSession = {
      ...session,
      claims: { ...claims, sid: 'entra-session-id' },
      yarId: 'yar-session-id'
    }
    const cache = createCache(indexedSession)
    const server = {
      app: { userSessionCache: cache },
      yar: { revoke: vi.fn().mockResolvedValue(undefined) }
    }

    await setUserSession(server, 'session-id', indexedSession)
    await dropUserSession(server, 'session-id')

    expect(cache.set).toHaveBeenCalledWith('entraSid:entra-session-id', {
      sessionId: 'session-id'
    })
    expect(cache.drop).toHaveBeenCalledWith('entraSid:entra-session-id')
    expect(server.yar.revoke).toHaveBeenCalledWith('yar-session-id')
  })

  test('revokes an older local session for the same Entra sid', async () => {
    const oldSession = {
      ...session,
      claims: { ...claims, sid: 'entra-session-id' },
      yarId: 'old-yar-session'
    }
    const newSession = {
      ...oldSession,
      yarId: 'new-yar-session'
    }
    const cache = {
      get: vi.fn(async (key) => {
        if (key === 'entraSid:entra-session-id') {
          return { sessionId: 'old-session-id' }
        }
        if (key === 'old-session-id') {
          return oldSession
        }
        return null
      }),
      set: vi.fn().mockResolvedValue(undefined),
      drop: vi.fn().mockResolvedValue(undefined)
    }
    const server = {
      app: { userSessionCache: cache },
      yar: { revoke: vi.fn().mockResolvedValue(undefined) }
    }

    await setUserSession(server, 'new-session-id', newSession)

    expect(cache.drop).toHaveBeenCalledWith('old-session-id')
    expect(server.yar.revoke).toHaveBeenCalledWith('old-yar-session')
    expect(cache.set).toHaveBeenCalledWith('entraSid:entra-session-id', {
      sessionId: 'new-session-id'
    })
  })

  test('resolves a local session from an Entra sid', async () => {
    const cache = createCache({ sessionId: 'session-id' })
    const server = { app: { userSessionCache: cache } }

    await expect(
      getUserSessionIdByEntraSid(server, 'entra-session-id')
    ).resolves.toBe('session-id')
    await expect(getUserSessionIdByEntraSid(server)).resolves.toBeNull()
  })
})

describe('validateUserSession', () => {
  test('rejects a missing session', async () => {
    const request = createRequest(createCache())

    await expect(
      validateUserSession(request, { sessionId: 'missing' })
    ).resolves.toEqual({ isValid: false })
  })

  test('returns safe credentials for a valid session', async () => {
    const cache = createCache(session)
    const request = createRequest(
      cache,
      vi.fn().mockResolvedValue({ token: session.token, refreshed: false })
    )

    await expect(
      validateUserSession(request, { sessionId: 'session-id' })
    ).resolves.toEqual({
      isValid: true,
      credentials: {
        sessionId: 'session-id',
        user: session.user,
        claims
      }
    })
    expect(cache.set).not.toHaveBeenCalled()
  })

  test('persists a refreshed token and profile', async () => {
    const cache = createCache(session)
    const refreshedClaims = { ...claims, name: 'Updated Person' }
    const refreshedToken = {
      ...session.token,
      accessToken: 'new-access-token',
      claims: refreshedClaims
    }
    const request = createRequest(
      cache,
      vi.fn().mockResolvedValue({ token: refreshedToken, refreshed: true })
    )

    const result = await validateUserSession(request, {
      sessionId: 'session-id'
    })

    expect(result.credentials.user.name).toBe('Updated Person')
    expect(cache.set).toHaveBeenCalledWith(
      'session-id',
      expect.objectContaining({
        token: refreshedToken,
        claims: refreshedClaims
      })
    )
  })

  test('retains existing claims when refresh omits them', async () => {
    const cache = createCache(session)
    const refreshedToken = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token'
    }
    const request = createRequest(
      cache,
      vi.fn().mockResolvedValue({ token: refreshedToken, refreshed: true })
    )

    const result = await validateUserSession(request, {
      sessionId: 'session-id'
    })

    expect(result.credentials.claims).toBe(claims)
  })

  test('drops a session when token validation fails', async () => {
    const cache = createCache(session)
    const request = createRequest(
      cache,
      vi.fn().mockRejectedValue(new Error('refresh failed'))
    )

    await expect(
      validateUserSession(request, { sessionId: 'session-id' })
    ).resolves.toEqual({ isValid: false })
    expect(cache.drop).toHaveBeenCalledWith('session-id')
    expect(request.logger.warn).toHaveBeenCalled()
  })

  test('keeps a session alive when a refresh fails but the token has not expired', async () => {
    const cache = createCache({
      ...session,
      token: { ...session.token, accessToken: createAccessToken(3600) }
    })
    const request = createRequest(
      cache,
      vi.fn().mockRejectedValue(new Error('Entra unreachable'))
    )

    const result = await validateUserSession(request, {
      sessionId: 'session-id'
    })

    expect(result.isValid).toBe(true)
    expect(cache.drop).not.toHaveBeenCalled()
    expect(request.logger.warn).toHaveBeenCalled()
  })

  test('drops a session when a refresh fails and the token has expired', async () => {
    const cache = createCache({
      ...session,
      token: { ...session.token, accessToken: createAccessToken(-60) }
    })
    const request = createRequest(
      cache,
      vi.fn().mockRejectedValue(new Error('Entra unreachable'))
    )

    await expect(
      validateUserSession(request, { sessionId: 'session-id' })
    ).resolves.toEqual({ isValid: false })
    expect(cache.drop).toHaveBeenCalledWith('session-id')
  })
})
