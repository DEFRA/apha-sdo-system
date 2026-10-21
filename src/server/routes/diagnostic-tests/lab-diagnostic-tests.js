import { config } from '#/config/config.js'

import { LABORATORY_DETAILS_FIELD_NAMES } from './laboratory-details.js'
import { ACCREDITATION_OPTIONS, tests } from './qualifying-tests.js'

/**
 * The diagnostic tests a lab currently uses: what decides whether the lab
 * still has to define them before reporting Animal Health Regulations (see
 * diagnostic-tests-gate.js), and what the diagnostic tests page starts from.
 * Also the lab's last submitted laboratory details, which the laboratory
 * details page starts from.
 *
 * TEMPORARY: until the backend can be asked, they are kept in cookies in the
 * user's browser, so they are only known to the browser that saved them.
 * Nothing outside this module knows that: the functions below are the
 * contract the backend version keeps (async, keyed by the user's lab), and
 * are what tests mock. See "Moving to the backend" in the README.
 */

const COOKIE_NAME = 'diagnosticTests'
const LABORATORY_DETAILS_COOKIE_NAME = 'laboratoryDetails'
const ONE_YEAR_MS = 31536000000

// A lab's tests are up to about 1.2 KB once encrypted, and its laboratory
// details about as much, so each has its own cookie. Two labs stay well
// inside the 4 KB a browser allows a cookie; older labs are forgotten.
const MAX_LABS = 2

const MEMO_KEY = 'labDiagnosticTests'

/**
 * Called when the diagnostic tests routes are registered. Sign-out leaves
 * the cookies in place, so the tests survive signing in again.
 * @param {import('@hapi/hapi').Server} server
 */
export function registerLabDiagnosticTestsStore(server) {
  const { password, secure } = config.get('session.cookie')

  for (const name of [COOKIE_NAME, LABORATORY_DETAILS_COOKIE_NAME]) {
    server.state(name, {
      ttl: ONE_YEAR_MS,
      encoding: 'iron',
      password,
      path: '/',
      isSecure: secure,
      isHttpOnly: true,
      isSameSite: 'Lax',
      clearInvalid: true
    })
  }
}

function labOf(request) {
  return request.auth?.credentials?.user?.organisationId || null
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Each cookie holds [lab, record] pairs, the most recently saved first. A
// pair list rather than an object keyed by lab, because an object would
// reorder labs whose IDs look like numbers.
function storedLabs(request, cookieName) {
  const value = request.state?.[cookieName]

  return Array.isArray(value)
    ? value.filter(
        (entry) =>
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          isRecord(entry[1])
      )
    : []
}

function storedRecord(request, cookieName) {
  const lab = labOf(request)

  return lab
    ? storedLabs(request, cookieName).find(([id]) => id === lab)?.[1]
    : undefined
}

// Puts the lab first with its new record, keeping the other labs
function storeRecord(request, h, cookieName, lab, record) {
  const others = storedLabs(request, cookieName).filter(([id]) => id !== lab)

  h.state(cookieName, [[lab, record], ...others].slice(0, MAX_LABS))
}

// Tests no longer in the catalogue and accreditations no longer offered are
// dropped. A record left with nothing reads as never defined: the tests it
// named can no longer be reported against.
function selectionsOf(record) {
  const selections = tests
    .filter((test) => ACCREDITATION_OPTIONS.includes(record?.[test.key]))
    .map((test) => ({ test, accreditation: record[test.key] }))

  return selections.length > 0 ? selections : null
}

/**
 * The signed-in user's lab's current diagnostic tests, in catalogue order
 * and in the shape parseDiagnosticTestsPayload reads a posted form into, or
 * null when the lab has never defined them. Read once per request.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<{ test: object, accreditation: string }[] | null>}
 */
export async function getLabDiagnosticTests(request) {
  if (Object.hasOwn(request.app, MEMO_KEY)) {
    return request.app[MEMO_KEY]
  }

  const selections = selectionsOf(storedRecord(request, COOKIE_NAME))

  request.app[MEMO_KEY] = selections

  return selections
}

/**
 * Records validated selections as the signed-in user's lab's current
 * diagnostic tests, replacing any it had.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h - sets the cookie on the response
 * @param {{ test: { key: string }, accreditation: string }[]} selections
 */
export async function saveLabDiagnosticTests(request, h, selections) {
  const lab = labOf(request)

  if (!lab) {
    return
  }

  const record = Object.fromEntries(
    selections.map(({ test, accreditation }) => [test.key, accreditation])
  )

  storeRecord(request, h, COOKIE_NAME, lab, record)
  request.app[MEMO_KEY] = selectionsOf(record)
}

/**
 * The signed-in user's lab's last submitted laboratory details, with a field
 * it has no text for as null, or null when nothing is kept for the lab. Only
 * a starting point for the page, which validates what it is sent.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<Record<string, string | null> | null>}
 */
export async function getLabDetails(request) {
  const record = storedRecord(request, LABORATORY_DETAILS_COOKIE_NAME)

  if (!record) {
    return null
  }

  const details = Object.fromEntries(
    LABORATORY_DETAILS_FIELD_NAMES.map((name) => [
      name,
      typeof record[name] === 'string' ? record[name] : null
    ])
  )

  return Object.values(details).some((value) => value !== null) ? details : null
}

/**
 * Records submitted laboratory details as the signed-in user's lab's,
 * replacing any it had. Blank fields are left out.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h - sets the cookie on the response
 * @param {Record<string, string | null>} details - normalised answers
 */
export async function saveLabDetails(request, h, details) {
  const lab = labOf(request)

  if (!lab) {
    return
  }

  const record = Object.fromEntries(
    LABORATORY_DETAILS_FIELD_NAMES.filter(
      (name) => typeof details?.[name] === 'string'
    ).map((name) => [name, details[name]])
  )

  storeRecord(request, h, LABORATORY_DETAILS_COOKIE_NAME, lab, record)
}
