/**
 * "Laboratory details": the lab's address and UKAS accreditation number,
 * asked for before its diagnostic tests and delivered with them in the same
 * record (see controller.js). The reporting person and the laboratory name
 * are not asked for: the sign-in already gives them, and every page shows
 * them (see src/server/common/helpers/identity-rows.js).
 */

export const LABORATORY_DETAILS_PATH = '/diagnostic-tests/laboratory-details'
export const LABORATORY_DETAILS_TITLE = 'Laboratory details'

// What the page was answered with, kept until the tests are submitted with it
const SESSION_KEY = 'diagnosticTestsLaboratoryDetails'

const MAX_TEXT_LENGTH = 100
const MAX_UKAS_NUMBER_LENGTH = 10

// A full UK postcode once spaces are removed and letters upper-cased: the
// outward code (area and district), then the inward code (sector and unit)
const POSTCODE_PATTERN = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/
const INWARD_CODE_LENGTH = 3
const DIGITS_PATTERN = /^\d+$/

function compactPostcode(value) {
  return value.replace(/\s+/g, '').toUpperCase()
}

function formatPostcode(value) {
  const compact = compactPostcode(value)

  return `${compact.slice(0, -INWARD_CODE_LENGTH)} ${compact.slice(-INWARD_CODE_LENGTH)}`
}

// The Design System's address messages: a missing line names what goes in
// it, a long one names its limit
function textError(label, missingError = null) {
  return (value) => {
    if (value === '') {
      return missingError
    }

    return value.length > MAX_TEXT_LENGTH
      ? `${label} must be ${MAX_TEXT_LENGTH} characters or less`
      : null
  }
}

function postcodeError(value) {
  if (value === '') {
    return 'Enter postcode'
  }

  return POSTCODE_PATTERN.test(compactPostcode(value))
    ? null
    : 'Enter a full UK postcode'
}

function ukasAccreditationNumberError(value) {
  if (value === '') {
    return null
  }

  if (!DIGITS_PATTERN.test(value)) {
    return 'UKAS accreditation number must only include numbers'
  }

  return value.length > MAX_UKAS_NUMBER_LENGTH
    ? `UKAS accreditation number must be ${MAX_UKAS_NUMBER_LENGTH} characters or less`
    : null
}

// In page order, which is also the order of the errors and of the record.
// Each is named as it is in the record.
const fields = [
  {
    name: 'addressLine1',
    error: textError(
      'Address line 1',
      'Enter address line 1, typically the building and street'
    )
  },
  { name: 'addressLine2', error: textError('Address line 2') },
  {
    name: 'townOrCity',
    error: textError('Town or city', 'Enter town or city')
  },
  { name: 'county', error: textError('County') },
  { name: 'postcode', error: postcodeError, format: formatPostcode },
  { name: 'ukasAccreditationNumber', error: ukasAccreditationNumberError }
]

export const LABORATORY_DETAILS_FIELD_NAMES = fields.map(({ name }) => name)

/**
 * The answers of a posted form, trimmed. A field left out reads as blank.
 * @param {Record<string, unknown>} [payload] - request.payload
 * @returns {Record<string, string>}
 */
export function parseLaboratoryDetails(payload = {}) {
  return Object.fromEntries(
    fields.map(({ name }) => {
      const value = payload[name]

      return [name, typeof value === 'string' ? value.trim() : '']
    })
  )
}

/**
 * The errors of a set of answers, as error summary items in page order.
 * Address line 1, town or city and postcode are required; the rest are
 * optional.
 * @param {Record<string, string>} values - parsed answers
 * @returns {{ href: string, text: string }[]}
 */
export function validateLaboratoryDetails(values) {
  return fields.flatMap(({ name, error }) => {
    const text = error(values[name])

    return text ? [{ href: `#${name}`, text }] : []
  })
}

/**
 * Valid answers as they are kept and delivered: a blank optional field is
 * null and the postcode is upper case with a single space, like SY23 1ND.
 * @param {Record<string, string>} values - validated answers
 * @returns {Record<string, string | null>}
 */
export function normaliseLaboratoryDetails(values) {
  return Object.fromEntries(
    fields.map(({ name, format }) => {
      const value = values[name]

      if (value === '') {
        return [name, null]
      }

      return [name, format ? format(value) : value]
    })
  )
}

/**
 * The values the page's inputs start from: the given details, with what is
 * missing left blank.
 * @param {Record<string, string | null> | null} [details]
 * @returns {Record<string, string>}
 */
export function laboratoryDetailsValues(details) {
  return Object.fromEntries(
    LABORATORY_DETAILS_FIELD_NAMES.map((name) => [name, details?.[name] ?? ''])
  )
}

/**
 * The laboratory details block of the diagnostic tests record: who reports
 * for which lab, as every page shows them, then the answers of the page.
 * @param {{ name?: string, organisationId?: string, organisationName?: string }} [user] - the session user
 * @param {Record<string, string | null>} [details] - normalised answers
 */
export function buildLaboratoryDetailsRecord(user, details) {
  return {
    reportingPerson: user?.name || null,
    laboratoryName: user?.organisationName || user?.organisationId || null,
    ...Object.fromEntries(
      LABORATORY_DETAILS_FIELD_NAMES.map((name) => [
        name,
        details?.[name] ?? null
      ])
    )
  }
}

/**
 * The details the page was answered with in this session, or null when it
 * has not been, or the tests have since been submitted with them.
 * @param {import('@hapi/hapi').Request} request
 */
export function getJourneyLaboratoryDetails(request) {
  return request.yar.get(SESSION_KEY) ?? null
}

/**
 * @param {import('@hapi/hapi').Request} request
 * @param {Record<string, string | null>} details - normalised answers
 */
export function keepJourneyLaboratoryDetails(request, details) {
  request.yar.set(SESSION_KEY, details)
}

/**
 * @param {import('@hapi/hapi').Request} request
 */
export function clearJourneyLaboratoryDetails(request) {
  request.yar.clear(SESSION_KEY)
}
