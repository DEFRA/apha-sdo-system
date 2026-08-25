import { config } from '#/config/config.js'

import {
  assertAllowedEntraGroups,
  getAllowedGroupIds,
  getUserProfile
} from './authorization.js'

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
 * sign every user out over a brief Entra outage and lose any part-written
 * report, so the current token is kept and the next request retries.
 */
async function refreshTokenWhenPossible(request, session) {
  try {
    return await request.ensureValidToken(session.token)
  } catch (error) {
    const remaining = getAccessTokenLifetimeRemaining(
      session.token?.accessToken
    )

    if (remaining === null || remaining <= 0) {
      throw error
    }

    request.logger?.warn?.(
      { err: error },
      'Keeping Entra session while token refresh is failing'
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

    const { token, refreshed } = await refreshTokenWhenPossible(
      request,
      session
    )
    const claims = token.claims ?? session.claims

    assertAllowedEntraGroups(
      claims,
      getAllowedGroupIds(config.get('auth.entraId'))
    )

    const updatedSession = {
      ...session,
      token,
      claims,
      user: getUserProfile(claims)
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
    request.logger?.warn?.({ err: error }, 'Invalidating Entra user session')
    await dropUserSession(request.server, sessionId)
    return { isValid: false }
  }
}
