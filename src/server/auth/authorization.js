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

function claimText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

/**
 * The person's name as "Given Surname", for example "George Surname".
 *
 * Entra stores the directory display name in `name`. With the `profile`
 * scope that is often already "Given Surname", but many directories,
 * including Defra, store it as "Surname, Given". `given_name` and
 * `family_name` are the reliable parts. Entra does not put them in the ID
 * token just because `profile` was requested: the app registration has to
 * list both as optional ID-token claims. Until that is configured, a
 * display name written "Surname, Given" is turned round, and any other
 * `name` is shown as issued.
 * @param {object} [claims] - ID token claims
 * @returns {string}
 */
export function formatPersonName(claims = {}) {
  const givenName = claimText(claims.given_name)
  const familyName = claimText(claims.family_name)

  if (givenName && familyName) {
    return `${givenName} ${familyName}`
  }

  const name = claimText(claims.name)
  const comma = name.indexOf(',')

  if (comma > 0 && comma < name.length - 1) {
    const familyFromName = name.slice(0, comma).trim()
    const givenFromName = name.slice(comma + 1).trim()

    if (familyFromName && givenFromName) {
      return `${givenFromName} ${familyFromName}`
    }
  }

  return name
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
    name: formatPersonName(claims),
    email: claims.preferred_username ?? claims.email ?? claims.upn ?? '',
    groups: Array.isArray(claims.groups) ? claims.groups : [],
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    ...getReportAccess(claims, options)
  }
}
