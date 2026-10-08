import Boom from '@hapi/boom'

import { config } from '#/config/config.js'
import { AUTH_PROVIDERS } from './auth-constants.js'
import { getDefraIdReportAccess, getReportAccess } from './report-access.js'

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

// Directory display names often end with a tag such as "(Other)", the
// placeholder Entra uses when company or department is not set. That is not
// part of the person's name.
function withoutDirectorySuffix(value) {
  const trimmed = value.trim()
  const open = trimmed.lastIndexOf('(')

  if (!trimmed.endsWith(')') || open === -1) {
    return trimmed
  }

  const inside = trimmed.slice(open + 1, -1)

  if (inside.includes(')')) {
    return trimmed
  }

  return trimmed.slice(0, open).trimEnd()
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
    return withoutDirectorySuffix(`${givenName} ${familyName}`)
  }

  const name = withoutDirectorySuffix(claimText(claims.name))
  const comma = name.indexOf(',')

  if (comma > 0 && comma < name.length - 1) {
    const familyFromName = name.slice(0, comma).trim()
    const givenFromName = name.slice(comma + 1).trim()

    if (familyFromName && givenFromName) {
      return withoutDirectorySuffix(`${givenFromName} ${familyFromName}`)
    }
  }

  return name
}

/**
 * The session user built from Entra ID token claims. `organisationId` (the
 * lab) and `journeys` (report type codes) come from the app roles, see
 * report-access.js; the Defra ID profile below fills the same fields from
 * its own claims so the rest of the service stays provider-agnostic.
 * @param {object} [claims] - ID token claims
 * @param {{ logger?: object }} [options] - pass the request logger at sign-in so role problems are reported once, not on every request
 */
export function getUserProfile(claims = {}, options = {}) {
  return {
    provider: AUTH_PROVIDERS.ENTRA_ID,
    id: claims.oid ?? claims.sub,
    name: formatPersonName(claims),
    email: claims.preferred_username ?? claims.email ?? claims.upn ?? '',
    groups: Array.isArray(claims.groups) ? claims.groups : [],
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    ...getReportAccess(claims, options)
  }
}

/**
 * The session user built from Defra Customer Identity token claims. The
 * person is `contactId` (their customer record) rather than the B2C subject,
 * and the lab is the organisation they picked at sign-in, named by
 * `organisationName` since the Customer Identity ID is an opaque GUID.
 * `amr` records how they signed in: `one` for GOV.UK One Login, `scp` for
 * Government Gateway.
 * @param {object} [claims] - ID token claims
 * @param {{ logger?: object, roleNames?: Record<string, string> }} [options] - the request logger at sign-in; role names default to configuration
 */
export function getDefraIdUserProfile(claims = {}, options = {}) {
  const { roleNames = config.get('auth.defraId.roleNames'), logger } = options

  return {
    provider: AUTH_PROVIDERS.DEFRA_ID,
    id: claims.contactId ?? claims.sub,
    name: [claimText(claims.firstName), claimText(claims.lastName)]
      .filter(Boolean)
      .join(' '),
    email: typeof claims.email === 'string' ? claims.email : '',
    uniqueReference: claims.uniqueReference ?? null,
    amr: claims.amr ?? null,
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    ...getDefraIdReportAccess(claims, { roleNames, logger })
  }
}
