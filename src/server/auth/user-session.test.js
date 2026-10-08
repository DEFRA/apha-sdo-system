import { vi } from 'vitest'

const mockEnsureValidDefraIdToken = vi.fn()

vi.mock('./defra-id.js', () => ({
  ensureValidDefraIdToken: (...args) => mockEnsureValidDefraIdToken(...args)
}))

const {
  dropUserSession,
  getSessionProvider,
  getUserSession,
  getUserSessionIdByEntraSid,
  setUserSession,
  validateUserSession
} = await import('./user-session.js')

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
  groups: ['local-dev-group'],
  roles: ['Lab.TestLab1.BR']
}

const session = {
  token: {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    claims
  },
  claims,
  user: {
    provider: 'entraId',
    id: 'user-id',
    name: 'A Person',
    email: 'person@example.gov.uk',
    groups: ['local-dev-group'],
    roles: ['Lab.TestLab1.BR'],
    organisationId: 'TestLab1',
    journeys: ['BR']
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

  test('drops a session from an unknown provider', async () => {
    const cache = createCache({ ...session, provider: 'someone-else' })
    const request = createRequest(cache)

    await expect(
      validateUserSession(request, { sessionId: 'session-id' })
    ).resolves.toEqual({ isValid: false })
    expect(cache.drop).toHaveBeenCalledWith('session-id')
  })
})

describe('getSessionProvider', () => {
  test('treats a session recorded before providers were as Entra', () => {
    expect(getSessionProvider({})).toBe('entraId')
    expect(getSessionProvider(null)).toBe('entraId')
    expect(getSessionProvider({ provider: 'defraId' })).toBe('defraId')
  })
})

describe('validateUserSession for Defra Customer Identity', () => {
  const defraIdClaims = {
    sub: 'b2c-subject',
    contactId: 'contact-id',
    firstName: 'Susan',
    lastName: 'Example',
    email: 'susan@lab.example',
    amr: 'one',
    currentRelationshipId: 'rel-1',
    relationships: ['rel-1:org-1:Anytown Veterinary Laboratory:0:Employee:0'],
    roles: ['rel-1:BR:3']
  }
  const defraIdSession = {
    provider: 'defraId',
    token: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      claims: defraIdClaims
    },
    claims: defraIdClaims
  }

  beforeEach(() => {
    mockEnsureValidDefraIdToken.mockReset()
  })

  test('refreshes through the Defra ID provider and rebuilds its profile', async () => {
    const cache = createCache(defraIdSession)
    const entraEnsureValidToken = vi.fn()
    const request = createRequest(cache, entraEnsureValidToken)
    mockEnsureValidDefraIdToken.mockResolvedValue({
      token: defraIdSession.token,
      refreshed: false
    })

    const result = await validateUserSession(request, {
      sessionId: 'session-id'
    })

    expect(result.isValid).toBe(true)
    expect(result.credentials.user).toMatchObject({
      provider: 'defraId',
      id: 'contact-id',
      name: 'Susan Example',
      organisationId: 'org-1',
      organisationName: 'Anytown Veterinary Laboratory',
      journeys: ['BR'],
      amr: 'one'
    })
    expect(mockEnsureValidDefraIdToken).toHaveBeenCalledWith(
      defraIdSession.token,
      { logger: request.logger }
    )
    // Entra's refresh and group checks do not apply
    expect(entraEnsureValidToken).not.toHaveBeenCalled()
  })

  test('picks up role changes carried by a refreshed ID token', async () => {
    const cache = createCache(defraIdSession)
    const request = createRequest(cache)
    const refreshedToken = {
      ...defraIdSession.token,
      accessToken: 'new-access-token',
      claims: {
        ...defraIdClaims,
        roles: ['rel-1:BR:3', 'rel-1:AHR:3']
      }
    }
    mockEnsureValidDefraIdToken.mockResolvedValue({
      token: refreshedToken,
      refreshed: true
    })

    const result = await validateUserSession(request, {
      sessionId: 'session-id'
    })

    expect(result.credentials.user.journeys).toEqual(['BR', 'AHR'])
    expect(cache.set).toHaveBeenCalledWith(
      'session-id',
      expect.objectContaining({
        provider: 'defraId',
        token: refreshedToken,
        user: expect.objectContaining({ journeys: ['BR', 'AHR'] })
      })
    )
  })

  test('keeps the session while a refresh fails and the token is still valid', async () => {
    const cache = createCache({
      ...defraIdSession,
      token: {
        ...defraIdSession.token,
        accessToken: createAccessToken(3600)
      }
    })
    const request = createRequest(cache)
    mockEnsureValidDefraIdToken.mockRejectedValue(
      new Error('Customer Identity unreachable')
    )

    const result = await validateUserSession(request, {
      sessionId: 'session-id'
    })

    expect(result.isValid).toBe(true)
    expect(cache.drop).not.toHaveBeenCalled()
    expect(request.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'defraId' }),
      expect.stringContaining('refresh is failing')
    )
  })
})
