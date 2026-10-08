import { config } from '#/config/config.js'

import { AUTH_PROVIDERS } from './auth-constants.js'
import {
  assertAllowedEntraGroups,
  getAllowedGroupIds,
  getDefraIdUserProfile,
  getUserProfile
} from './authorization.js'
import { ensureValidDefraIdToken } from './defra-id.js'

/**
 * What differs between the identity providers once a session exists: how
 * its token set is refreshed, whether the claims still entitle the user to
 * the service, and how they become the session user.
 */
const sessionProviders = {
  [AUTH_PROVIDERS.ENTRA_ID]: {
    ensureValidToken: (request, token) => request.ensureValidToken(token),
    assertAuthorised: (claims) =>
      assertAllowedEntraGroups(
        claims,
        getAllowedGroupIds(config.get('auth.entraId'))
      ),
    getUserProfile: (claims) => getUserProfile(claims)
  },
  [AUTH_PROVIDERS.DEFRA_ID]: {
    ensureValidToken: (request, token) =>
      ensureValidDefraIdToken(token, { logger: request.logger }),
    // Entitlement is the roles in the token, read into the profile
    assertAuthorised: () => {},
    getUserProfile: (claims) => getDefraIdUserProfile(claims)
  }
}

/**
 * Sessions written before the provider was recorded are Entra sessions.
 * @param {{ provider?: string }} session
 */
export function getSessionProvider(session) {
  return session?.provider ?? AUTH_PROVIDERS.ENTRA_ID
}

function getUserSessionCache(server) {
  const cache = server.app.userSessionCache

  if (!cache) {
    throw new Error('User session cache has not been initialised')
  }

  return cache
}

function getEntraSidCacheKey(sid) {
  return `entraSid:${sid}`
}

export async function setUserSession(server, sessionId, session) {
  const cache = getUserSessionCache(server)
  const entraSid = session.claims?.sid

  if (entraSid) {
    const existingRecord = await cache.get(getEntraSidCacheKey(entraSid))

    if (existingRecord?.sessionId && existingRecord.sessionId !== sessionId) {
      await dropUserSession(server, existingRecord.sessionId)
    }
  }

  await cache.set(sessionId, session)

  if (entraSid) {
    await cache.set(getEntraSidCacheKey(entraSid), { sessionId })
  }
}

export async function getUserSession(server, sessionId) {
  if (!sessionId) {
    return null
  }

  return getUserSessionCache(server).get(sessionId)
}

export async function dropUserSession(server, sessionId) {
  if (sessionId) {
    const cache = getUserSessionCache(server)
    const session = await cache.get(sessionId)

    await cache.drop(sessionId)

    if (session?.claims?.sid) {
      await cache.drop(getEntraSidCacheKey(session.claims.sid))
    }

    if (session?.yarId) {
      await server.yar.revoke(session.yarId)
    }
  }
}

export async function getUserSessionIdByEntraSid(server, sid) {
  if (!sid) {
    return null
  }

  const record = await getUserSessionCache(server).get(getEntraSidCacheKey(sid))
  return record?.sessionId ?? null
}

/**
 * Milliseconds of access token life remaining, or null when the expiry cannot
 * be read.
 */
function getAccessTokenLifetimeRemaining(accessToken) {
  const payload = accessToken?.split?.('.')[1]

  if (!payload) {
    return null
  }

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString())

    return typeof exp === 'number' ? exp * 1000 - Date.now() : null
  } catch {
    return null
  }
}

/**
 * The OIDC client refreshes shortly before expiry, so a refresh can fail while
 * the current token is still usable. Ending the session at that point would
 * sign every user out over a brief provider outage and lose any part-written
 * report, so the current token is kept and the next request retries.
 */
async function refreshTokenWhenPossible(request, session, provider) {
  try {
    return await sessionProviders[provider].ensureValidToken(
      request,
      session.token
    )
  } catch (error) {
    const remaining = getAccessTokenLifetimeRemaining(
      session.token?.accessToken
    )

    if (remaining === null || remaining <= 0) {
      throw error
    }

    request.logger?.warn?.(
      { err: error, provider },
      'Keeping user session while token refresh is failing'
    )

    return { token: session.token, refreshed: false }
  }
}

export async function validateUserSession(request, cookie) {
  const sessionId = cookie?.sessionId

  try {
    const session = await getUserSession(request.server, sessionId)

    if (!session) {
      return { isValid: false }
    }

    const provider = getSessionProvider(session)
    const sessionProvider = sessionProviders[provider]

    if (!sessionProvider) {
      throw new Error(`Unknown session provider: ${provider}`)
    }

    const { token, refreshed } = await refreshTokenWhenPossible(
      request,
      session,
      provider
    )
    const claims = token.claims ?? session.claims

    sessionProvider.assertAuthorised(claims)

    const updatedSession = {
      ...session,
      provider,
      token,
      claims,
      user: sessionProvider.getUserProfile(claims)
    }

    if (refreshed) {
      await setUserSession(request.server, sessionId, updatedSession)
    }

    return {
      isValid: true,
      credentials: {
        sessionId,
        user: updatedSession.user,
        claims
      }
    }
  } catch (error) {
    request.logger?.warn?.({ err: error }, 'Invalidating user session')
    await dropUserSession(request.server, sessionId)
    return { isValid: false }
  }
}
