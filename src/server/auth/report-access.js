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

// A percent-encoded name that does not decode is taken as written
function decodeLabName(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function configuredLabName(code, labNames) {
  for (const entry of Array.isArray(labNames) ? labNames : []) {
    const separator = typeof entry === 'string' ? entry.indexOf('=') : -1

    if (separator > 0 && entry.slice(0, separator).trim() === code) {
      const name = decodeLabName(entry.slice(separator + 1)).trim()

      if (name) {
        return name
      }
    }
  }

  return null
}

function isAsciiUpper(character) {
  return character >= 'A' && character <= 'Z'
}

function isAsciiLower(character) {
  return character >= 'a' && character <= 'z'
}

function isAsciiDigit(character) {
  return character >= '0' && character <= '9'
}

// A hyphen, an underscore or any whitespace becomes the space between words
function isLabCodeBreak(character) {
  return character === '-' || character === '_' || character.trim() === ''
}

// TestLab, and 1Lab: a capital after a lower-case letter or a digit
function capitalFollowsWord(previous, character) {
  const wordCharacter = isAsciiLower(previous) || isAsciiDigit(previous)

  return wordCharacter && isAsciiUpper(character)
}

// APHAWeybridge: the capital that starts a word after a run of capitals
function wordFollowsCapitals(previous, character, next) {
  return isAsciiUpper(previous) && isAsciiUpper(character) && isAsciiLower(next)
}

// Lab12: a digit after a letter
function digitFollowsLetter(previous, character) {
  const letter = isAsciiUpper(previous) || isAsciiLower(previous)

  return letter && isAsciiDigit(character)
}

// Where a space goes in a lab code, judged from the character before it.
// Read in one pass; a regular expression for the run of capitals backtracks
// over it.
function splitsLabCodeBefore(code, index) {
  const previous = code[index - 1]

  if (previous === undefined || isLabCodeBreak(previous)) {
    return false
  }

  const character = code[index]

  return (
    capitalFollowsWord(previous, character) ||
    wordFollowsCapitals(previous, character, code[index + 1]) ||
    digitFollowsLetter(previous, character)
  )
}

// The lab code with its words separated: TestLab1 is "Test Lab 1"
function labCodeAsWords(code) {
  let words = ''

  for (let index = 0; index < code.length; index++) {
    const character = code[index]

    if (isLabCodeBreak(character)) {
      if (words && !words.endsWith(' ')) {
        words += ' '
      }
      continue
    }

    if (words && !words.endsWith(' ') && splitsLabCodeBefore(code, index)) {
      words += ' '
    }

    words += character
  }

  return words.trim()
}

/**
 * The name of the lab an Entra lab code stands for. The token carries only
 * the code, so the name is its words: `TestLab1` is "Test Lab 1",
 * `APHAWeybridge` "APHA Weybridge". A lab whose name cannot be read that way
 * is named in configuration (`auth.entraId.labNames`, `Code=Name` entries),
 * which takes priority.
 * @param {string | null | undefined} code - the lab code from the app role
 * @param {string[]} [labNames] - configured `Code=Name` entries
 * @returns {string | null}
 */
export function labNameOf(code, labNames = []) {
  if (typeof code !== 'string' || !code.trim()) {
    return null
  }

  return configuredLabName(code, labNames) ?? labCodeAsWords(code)
}

/**
 * Defra Customer Identity packs the user's organisations and service roles
 * into colon-delimited strings (Technical Onboarding Guide, section 7.1):
 *
 *   relationships: relationshipId:organisationId:organisationName:organisationLoa:relationship:relationshipLoa
 *   roles:         relationshipId:roleName:status
 *
 * `currentRelationshipId` names the organisation the user picked when
 * signing in. Only roles for that relationship count, and only approved ones
 * (status 3): pending, rejected, blocked and removed roles grant nothing.
 */
const DEFRA_ID_ROLE_STATUS_APPROVED = '3'
// relationshipId and organisationId lead; organisationLoa, relationship and
// relationshipLoa trail; the organisation name is everything in between
const RELATIONSHIP_LEADING_FIELDS = 2
const RELATIONSHIP_TRAILING_FIELDS = 3
const RELATIONSHIP_FIELD_COUNT =
  RELATIONSHIP_LEADING_FIELDS + 1 + RELATIONSHIP_TRAILING_FIELDS
const ROLE_FIELD_COUNT = 3

/**
 * The organisation name is the only free-text field, so it is whatever sits
 * between the two leading and three trailing fields; a colon in a lab's name
 * does not break the parse.
 * @param {unknown} value - an entry of the relationships claim
 */
export function parseDefraIdRelationship(value) {
  if (typeof value !== 'string') {
    return null
  }

  const parts = value.split(':')

  if (parts.length < RELATIONSHIP_FIELD_COUNT) {
    return null
  }

  const [relationshipId, organisationId] = parts
  const [organisationLoa, relationship, relationshipLoa] = parts.slice(
    -RELATIONSHIP_TRAILING_FIELDS
  )

  return {
    relationshipId,
    organisationId,
    organisationName: parts
      .slice(RELATIONSHIP_LEADING_FIELDS, -RELATIONSHIP_TRAILING_FIELDS)
      .join(':'),
    organisationLoa,
    relationship,
    relationshipLoa
  }
}

/**
 * @param {unknown} value - an entry of the roles claim
 */
export function parseDefraIdRole(value) {
  if (typeof value !== 'string') {
    return null
  }

  const parts = value.split(':')

  if (parts.length < ROLE_FIELD_COUNT) {
    return null
  }

  return {
    relationshipId: parts[0],
    roleName: parts.slice(1, -1).join(':'),
    status: parts.at(-1)
  }
}

// Role names are configured and typed by people; compare them forgivingly
function normaliseRoleName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

/**
 * The lab and journeys granted by Defra Customer Identity claims.
 *
 * Which service role means which journey is configuration
 * (`auth.defraId.roleNames`, keyed by report type code), because the names
 * are defined in the Customer Identity onboarding rather than in this
 * service. A role that maps to nothing, such as the "Default" placeholder
 * everyone starts with, grants no journey.
 * @param {{ currentRelationshipId?: string, relationships?: unknown, roles?: unknown }} [claims] - ID token claims
 * @param {{ roleNames?: Record<string, string>, logger?: { warn?: Function } }} [options] - the configured role names and, at sign-in, the request logger
 * @returns {{ organisationId: string | null, organisationName: string | null, journeys: string[] }}
 */
export function getDefraIdReportAccess(
  claims = {},
  { roleNames = {}, logger } = {}
) {
  const relationships = (
    Array.isArray(claims.relationships) ? claims.relationships : []
  )
    .map(parseDefraIdRelationship)
    .filter(Boolean)
  // The picker always sets currentRelationshipId; a token with a single
  // relationship and no selection is still unambiguous
  const current =
    relationships.find(
      (relationship) =>
        relationship.relationshipId === claims.currentRelationshipId
    ) ?? (relationships.length === 1 ? relationships[0] : null)

  if (!current) {
    logger?.warn?.(
      { currentRelationshipId: claims.currentRelationshipId ?? null },
      'Defra ID token names no current organisation, report access withheld'
    )

    return { organisationId: null, organisationName: null, journeys: [] }
  }

  const codeByRoleName = new Map(
    Object.entries(roleNames).map(([code, name]) => [
      normaliseRoleName(name),
      code
    ])
  )
  const codes = new Set(
    (Array.isArray(claims.roles) ? claims.roles : [])
      .map(parseDefraIdRole)
      .filter(
        (role) =>
          role?.relationshipId === current.relationshipId &&
          role.status === DEFRA_ID_ROLE_STATUS_APPROVED
      )
      .map((role) => codeByRoleName.get(normaliseRoleName(role.roleName)))
      .filter(Boolean)
  )

  return {
    organisationId: current.organisationId || null,
    organisationName: current.organisationName || null,
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
 * Qualifying tests belong to Animal Health Regulations. A user who holds that
 * journey, alone or with others, may update them.
 * @param {{ journeys?: string[] }} [user] - the session user profile
 */
export function canUpdateDiagnosticTests(user) {
  return canSubmitReportType(
    user,
    reportTypes.find((reportType) => reportType.code === 'AHR')
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
