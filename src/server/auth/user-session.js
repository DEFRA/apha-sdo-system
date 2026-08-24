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

export async function validateUserSession(request, cookie) {
  const sessionId = cookie?.sessionId

  try {
    const session = await getUserSession(request.server, sessionId)

    if (!session) {
      return { isValid: false }
    }

    const { token, refreshed } = await request.ensureValidToken(session.token)
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
