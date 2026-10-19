import { config } from '#/config/config.js'

import { ACCREDITATION_OPTIONS, tests } from './qualifying-tests.js'

/**
 * The diagnostic tests a lab currently uses: what decides whether the lab
 * still has to define them before reporting Animal Health Regulations (see
 * diagnostic-tests-gate.js), and what the diagnostic tests page starts from.
 *
 * TEMPORARY: until the backend can be asked, they are kept in a cookie in the
 * user's browser, so they are only known to the browser that saved them.
 * Nothing outside this module knows that: the functions below are the
 * contract the backend version keeps (async, keyed by the user's lab), and
 * are what tests mock. See "Moving to the backend" in the README.
 */

const COOKIE_NAME = 'diagnosticTests'
const ONE_YEAR_MS = 31536000000

// A lab's record is up to about 1.2 KB once encrypted. Two labs stay well
// inside the 4 KB a browser allows a cookie; older labs are forgotten.
const MAX_LABS = 2

const MEMO_KEY = 'labDiagnosticTests'

/**
 * Called when the diagnostic tests routes are registered. Sign-out leaves
 * the cookie in place, so the tests survive signing in again.
 * @param {import('@hapi/hapi').Server} server
 */
export function registerLabDiagnosticTestsStore(server) {
  const { password, secure } = config.get('session.cookie')

  server.state(COOKIE_NAME, {
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

function labOf(request) {
  return request.auth?.credentials?.user?.organisationId || null
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// The cookie holds [lab, { testKey: accreditation }] pairs, the most
// recently saved first. A pair list rather than an object keyed by lab,
// because an object would reorder labs whose IDs look like numbers.
function storedLabs(request) {
  const value = request.state?.[COOKIE_NAME]

  return Array.isArray(value)
    ? value.filter(
        (entry) =>
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          isRecord(entry[1])
      )
    : []
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

  const lab = labOf(request)
  const record = lab
    ? storedLabs(request).find(([id]) => id === lab)?.[1]
    : undefined
  const selections = selectionsOf(record)

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
  const others = storedLabs(request).filter(([id]) => id !== lab)

  h.state(COOKIE_NAME, [[lab, record], ...others].slice(0, MAX_LABS))
  request.app[MEMO_KEY] = selectionsOf(record)
}
