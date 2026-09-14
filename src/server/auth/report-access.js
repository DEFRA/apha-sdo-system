import {
  reportTypes,
  reportTypesByCode,
  reportTypesBySlug
} from '#/server/forms/report-types.js'
import {
  AUTH_PATHS,
  NO_ACCESS_REPORT_TYPE_FLASH_KEY
} from './auth-constants.js'

/**
 * Which lab a user belongs to and which report journeys they may submit come
 * from Entra app roles named `Lab.<LAB>.<CODE>`, e.g. `Lab.TestLab1.BR`. A
 * security group per lab per journey is assigned to each role, so a person
 * who does both BR and AHR for a lab is in two groups and gets two roles.
 *
 * One role value therefore answers both questions at once. That is why the
 * lab is a code carried in the role rather than a group object ID: a lab has
 * two groups, so a group ID cannot identify it, and the roles claim needs no
 * token configuration on the app registration.
 *
 * Defra ID users will fill the same `organisationId` and `journeys` profile
 * fields from their own claims, so nothing downstream depends on Entra.
 */

// Lab.<LAB>.<CODE>: exactly three dot-separated parts, none empty
const LAB_ROLE_PATTERN = /^Lab\.([^.]+)\.([^.]+)$/

/**
 * `Lab.<LAB>.<CODE>` split into its parts, or null when the value is not a
 * lab role for a known report type. Other app roles are left alone.
 * @param {unknown} role - an entry of the roles claim
 * @returns {{ lab: string, code: string } | null}
 */
export function parseLabRole(role) {
  if (typeof role !== 'string') {
    return null
  }

  const match = LAB_ROLE_PATTERN.exec(role)

  if (!match) {
    return null
  }

  const [, lab, code] = match

  return reportTypesByCode.has(code) ? { lab, code } : null
}

/**
 * The lab and journeys granted by the roles claim.
 *
 * Roles for more than one lab are refused rather than guessed at: a
 * submission stamped with the wrong lab is worse than a blocked user. Picking
 * the lab for such a person is a follow-up, not something this decides.
 * @param {{ roles?: unknown }} [claims] - ID token claims
 * @param {{ logger?: { warn?: Function } }} [options] - pass the request logger to have the multi-lab case reported
 * @returns {{ organisationId: string | null, journeys: string[] }}
 */
export function getReportAccess(claims = {}, { logger } = {}) {
  const roles = Array.isArray(claims.roles) ? claims.roles : []
  const labRoles = roles.map(parseLabRole).filter(Boolean)
  const labs = [...new Set(labRoles.map(({ lab }) => lab))]

  if (labs.length !== 1) {
    if (labs.length > 1) {
      logger?.warn?.(
        { labs },
        'Entra user holds roles for more than one lab, report access withheld'
      )
    }

    return { organisationId: null, journeys: [] }
  }

  const codes = new Set(labRoles.map(({ code }) => code))

  return {
    organisationId: labs[0],
    // Registry order, so the welcome page lists journeys consistently
    journeys: reportTypes
      .filter((reportType) => codes.has(reportType.code))
      .map((reportType) => reportType.code)
  }
}

/**
 * The report types a signed-in user may submit, in registry order.
 * @param {{ journeys?: string[] }} [user] - the session user profile
 */
export function getAllowedReportTypes(user) {
  const journeys = Array.isArray(user?.journeys) ? user.journeys : []

  return reportTypes.filter((reportType) => journeys.includes(reportType.code))
}

/**
 * @param {{ journeys?: string[] }} [user] - the session user profile
 * @param {{ code: string }} [reportType] - an entry of the report type registry
 */
export function canSubmitReportType(user, reportType) {
  return (
    Boolean(reportType) &&
    Array.isArray(user?.journeys) &&
    user.journeys.includes(reportType.code)
  )
}

/**
 * onPostAuth extension: a signed-in user who opens a report journey their
 * roles do not grant is sent to /no-access, which names the report type.
 *
 * The forms-engine serves every journey route with a `slug` parameter
 * (/{slug}, /{slug}/{path} and the /preview variants), so the parameter is
 * the reliable way to know which journey a request is for. Requests without
 * a session are left to the cookie strategy, which already sends them to sign
 * in.
 */
export function restrictReportJourneys(request, h) {
  const reportType = reportTypesBySlug.get(request.params?.slug)

  if (!reportType || !request.auth.isAuthenticated) {
    return h.continue
  }

  const user = request.auth.credentials?.user

  if (canSubmitReportType(user, reportType)) {
    return h.continue
  }

  request.logger?.warn?.(
    { userId: user?.id, reportType: reportType.code },
    'User opened a report journey their roles do not grant'
  )
  request.yar?.flash?.(NO_ACCESS_REPORT_TYPE_FLASH_KEY, reportType.title)

  return h.redirect(AUTH_PATHS.NO_ACCESS).takeover()
}
