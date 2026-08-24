import Boom from '@hapi/boom'

export function getAllowedGroupIds(settings) {
  return settings.authorizationMode === 'groups' ? settings.allowedGroupIds : []
}

export function assertAllowedEntraGroups(claims = {}, allowedGroupIds = []) {
  if (allowedGroupIds.length === 0) {
    return
  }

  if (claims._claim_names?.groups) {
    throw Boom.forbidden(
      'Your Entra group membership could not be evaluated for this service'
    )
  }

  const userGroups = Array.isArray(claims.groups) ? claims.groups : []
  const isAllowed = allowedGroupIds.some((groupId) =>
    userGroups.includes(groupId)
  )

  if (!isAllowed) {
    throw Boom.forbidden('You do not have permission to access this service')
  }
}

export function getUserProfile(claims = {}) {
  return {
    id: claims.oid ?? claims.sub,
    name: claims.name ?? '',
    email: claims.preferred_username ?? claims.email ?? claims.upn ?? '',
    groups: Array.isArray(claims.groups) ? claims.groups : []
  }
}
