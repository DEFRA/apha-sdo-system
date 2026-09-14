import Boom from '@hapi/boom'

import { getReportAccess } from './report-access.js'

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

/**
 * The session user built from Entra ID token claims. `organisationId` (the
 * lab) and `journeys` (report type codes) come from the app roles, see
 * report-access.js; Defra ID will fill the same two fields from its own
 * claims so the rest of the service stays provider-agnostic.
 * @param {object} [claims] - ID token claims
 * @param {{ logger?: object }} [options] - pass the request logger at sign-in so role problems are reported once, not on every request
 */
export function getUserProfile(claims = {}, options = {}) {
  return {
    id: claims.oid ?? claims.sub,
    name: claims.name ?? '',
    email: claims.preferred_username ?? claims.email ?? claims.upn ?? '',
    groups: Array.isArray(claims.groups) ? claims.groups : [],
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    ...getReportAccess(claims, options)
  }
}
