import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { AUTH_PATHS } from '#/server/auth/auth-constants.js'
import { DIAGNOSTIC_TESTS_PATH, accreditationFieldId } from './controller.js'
import {
  LABORATORY_DETAILS_FIELD_NAMES,
  LABORATORY_DETAILS_PATH,
  LABORATORY_DETAILS_TITLE,
  buildLaboratoryDetailsRecord,
  laboratoryDetailsValues,
  normaliseLaboratoryDetails,
  parseLaboratoryDetails,
  validateLaboratoryDetails
} from './laboratory-details.js'

const ADDRESS_LINE_1_MISSING =
  'Enter address line 1, typically the building and street'
const TOWN_OR_CITY_MISSING = 'Enter town or city'
const POSTCODE_MISSING = 'Enter postcode'
const POSTCODE_INVALID = 'Enter a full UK postcode'
const UKAS_NUMBER_NOT_NUMBERS =
  'UKAS accreditation number must only include numbers'

// What a lab types, before it is trimmed and normalised
const ANSWERS = {
  addressLine1: ' Y Buarth ',
  addressLine2: '',
  townOrCity: 'Aberystwyth',
  county: 'Ceredigion',
  postcode: 'sy23  1nd',
  ukasAccreditationNumber: '9934'
}

const LABORATORY_DETAILS = {
  addressLine1: 'Y Buarth',
  addressLine2: null,
  townOrCity: 'Aberystwyth',
  county: 'Ceredigion',
  postcode: 'SY23 1ND',
  ukasAccreditationNumber: '9934'
}

const user = {
  id: 'user-id',
  name: 'Caroline Ford',
  organisationId: 'TestLab1',
  journeys: ['AHR']
}

function validValues(overrides = {}) {
  return parseLaboratoryDetails({ ...ANSWERS, ...overrides })
}

describe('laboratory details helpers', () => {
  describe('parseLaboratoryDetails', () => {
    test('Should read every field, trimmed', () => {
      expect(parseLaboratoryDetails(ANSWERS)).toEqual({
        addressLine1: 'Y Buarth',
        addressLine2: '',
        townOrCity: 'Aberystwyth',
        county: 'Ceredigion',
        postcode: 'sy23  1nd',
        ukasAccreditationNumber: '9934'
      })
    })

    test('Should read a missing or non-text field as blank', () => {
      expect(parseLaboratoryDetails({ addressLine1: ['a', 'b'] })).toEqual(
        Object.fromEntries(
          LABORATORY_DETAILS_FIELD_NAMES.map((name) => [name, ''])
        )
      )
      expect(parseLaboratoryDetails()).toEqual(
        parseLaboratoryDetails({ addressLine1: ['a', 'b'] })
      )
    })
  })

  describe('validateLaboratoryDetails', () => {
    test('Should accept the required fields alone', () => {
      expect(
        validateLaboratoryDetails(
          validValues({ county: '', ukasAccreditationNumber: '' })
        )
      ).toEqual([])
    })

    test('Should ask for address line 1, town or city and postcode, in page order', () => {
      expect(validateLaboratoryDetails(parseLaboratoryDetails({}))).toEqual([
        { href: '#addressLine1', text: ADDRESS_LINE_1_MISSING },
        { href: '#townOrCity', text: TOWN_OR_CITY_MISSING },
        { href: '#postcode', text: POSTCODE_MISSING }
      ])
    })

    test.each([
      ['addressLine1', 'Address line 1'],
      ['addressLine2', 'Address line 2'],
      ['townOrCity', 'Town or city'],
      ['county', 'County']
    ])('Should refuse more than 100 characters in %s', (name, label) => {
      expect(
        validateLaboratoryDetails(validValues({ [name]: 'a'.repeat(101) }))
      ).toEqual([
        { href: `#${name}`, text: `${label} must be 100 characters or less` }
      ])
      expect(
        validateLaboratoryDetails(validValues({ [name]: 'a'.repeat(100) }))
      ).toEqual([])
    })

    test.each([
      'SY23 1ND',
      'sy231nd',
      'EC1A 1BB',
      'W1A 0AX',
      'M1 1AE',
      'B33 8TH'
    ])('Should accept %s as a postcode', (postcode) => {
      expect(validateLaboratoryDetails(validValues({ postcode }))).toEqual([])
    })

    test.each(['SY23', 'SY23 1N', '12345', 'SY23 1ND X', 'not a postcode'])(
      'Should refuse %s as a postcode',
      (postcode) => {
        expect(validateLaboratoryDetails(validValues({ postcode }))).toEqual([
          { href: '#postcode', text: POSTCODE_INVALID }
        ])
      }
    )

    test.each(['99 34', 'UKAS 9934', '9934a'])(
      'Should refuse %s as a UKAS accreditation number',
      (ukasAccreditationNumber) => {
        expect(
          validateLaboratoryDetails(validValues({ ukasAccreditationNumber }))
        ).toEqual([
          { href: '#ukasAccreditationNumber', text: UKAS_NUMBER_NOT_NUMBERS }
        ])
      }
    )

    test('Should refuse a UKAS accreditation number longer than 10 characters', () => {
      expect(
        validateLaboratoryDetails(
          validValues({ ukasAccreditationNumber: '12345678901' })
        )
      ).toEqual([
        {
          href: '#ukasAccreditationNumber',
          text: 'UKAS accreditation number must be 10 characters or less'
        }
      ])
    })
  })

  describe('normaliseLaboratoryDetails', () => {
    test('Should record blank fields as null and write the postcode in capitals with one space', () => {
      expect(normaliseLaboratoryDetails(validValues())).toEqual(
        LABORATORY_DETAILS
      )
    })

    test.each([
      ['ec1a1bb', 'EC1A 1BB'],
      ['m11ae', 'M1 1AE'],
      [' w1a  0ax ', 'W1A 0AX']
    ])('Should write %s as %s', (postcode, expected) => {
      expect(
        normaliseLaboratoryDetails(validValues({ postcode })).postcode
      ).toBe(expected)
    })
  })

  describe('laboratoryDetailsValues', () => {
    test('Should start the inputs from the details, blank where they have none', () => {
      expect(laboratoryDetailsValues(LABORATORY_DETAILS)).toEqual({
        ...LABORATORY_DETAILS,
        addressLine2: ''
      })
    })

    test('Should start every input blank without details', () => {
      expect(laboratoryDetailsValues(null)).toEqual(
        Object.fromEntries(
          LABORATORY_DETAILS_FIELD_NAMES.map((name) => [name, ''])
        )
      )
    })
  })

  describe('buildLaboratoryDetailsRecord', () => {
    test('Should record who reports for which lab, then the details', () => {
      expect(buildLaboratoryDetailsRecord(user, LABORATORY_DETAILS)).toEqual({
        reportingPerson: 'Caroline Ford',
        laboratoryName: 'TestLab1',
        ...LABORATORY_DETAILS
      })
    })

    test("Should name the lab after its organisation's name when the user has one", () => {
      expect(
        buildLaboratoryDetailsRecord(
          { ...user, organisationName: 'Wales Veterinary Science Centre' },
          LABORATORY_DETAILS
        ).laboratoryName
      ).toBe('Wales Veterinary Science Centre')
    })

    test('Should record null for what is not known', () => {
      expect(buildLaboratoryDetailsRecord(undefined, undefined)).toEqual({
        reportingPerson: null,
        laboratoryName: null,
        ...Object.fromEntries(
          LABORATORY_DETAILS_FIELD_NAMES.map((name) => [name, null])
        )
      })
    })
  })
})

describe('laboratory details routes', () => {
  let server

  function authWithJourneys(journeys = user.journeys) {
    return {
      strategy: 'session',
      credentials: {
        sessionId: 'test-session',
        user: { ...user, journeys },
        claims: {}
      }
    }
  }

  const auth = authWithJourneys()
  const azureStorageEnabled = config.get('azure.storage.enabled')

  beforeAll(async () => {
    // Submitting the tests delivers them; a developer's .env may point at Azure
    config.set('azure.storage.enabled', false)
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('azure.storage.enabled', azureStorageEnabled)
    await server.stop({ timeout: 0 })
  })

  // The cookies a browser would hold across requests
  function cookieJar() {
    const cookies = new Map()

    return {
      remember(response) {
        for (const header of [response.headers['set-cookie']].flat()) {
          if (!header) {
            continue
          }

          const [name, ...rest] = header.split(';')[0].split('=')
          const value = rest.join('=')

          if (value) {
            cookies.set(name, value)
          } else {
            cookies.delete(name)
          }
        }

        return response
      },
      get: (name) => cookies.get(name),
      header: () =>
        [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    }
  }

  async function get(url, jar = cookieJar(), authOverride = auth) {
    return jar.remember(
      await server.inject({
        method: 'GET',
        url,
        auth: authOverride,
        headers: { cookie: jar.header() }
      })
    )
  }

  async function post(url, payload, jar = cookieJar(), authOverride = auth) {
    return jar.remember(
      await server.inject({
        method: 'POST',
        url,
        auth: authOverride,
        headers: { cookie: jar.header() },
        payload: { ...payload, crumb: jar.get('crumb') }
      })
    )
  }

  async function postLaboratoryDetails(
    payload,
    jar = cookieJar(),
    authOverride = auth
  ) {
    await get(LABORATORY_DETAILS_PATH, jar, authOverride)

    return post(LABORATORY_DETAILS_PATH, payload, jar, authOverride)
  }

  // The rendered input of a field
  function inputOf(html, name) {
    return html.match(new RegExp(`<input[^>]*id="${name}"[^>]*>`))?.[0]
  }

  // The value an input starts from, blank when it has none
  function valueOf(html, name) {
    return inputOf(html, name)?.match(/ value="([^"]*)"/)?.[1] ?? ''
  }

  describe(`GET ${LABORATORY_DETAILS_PATH}`, () => {
    test('Should render the page as a two-thirds question page', async () => {
      const { result, statusCode } = await get(LABORATORY_DETAILS_PATH)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(
          `<h1 class="govuk-heading-l">${LABORATORY_DETAILS_TITLE}</h1>`
        )
      )
      expect(result).toEqual(
        expect.stringContaining('govuk-grid-column-two-thirds')
      )
      expect(result).not.toEqual(expect.stringContaining('There is a problem'))
    })

    test('Should ask for the address with the Design System address pattern', async () => {
      const { result } = await get(LABORATORY_DETAILS_PATH)

      expect(result).toMatch(
        /<legend class="govuk-fieldset__legend govuk-fieldset__legend--m">\s*Laboratory address\s*<\/legend>/
      )

      for (const [name, label, autocomplete] of [
        ['addressLine1', 'Address line 1', 'address-line1'],
        ['addressLine2', 'Address line 2 (optional)', 'address-line2'],
        ['townOrCity', 'Town or city', 'address-level2'],
        ['county', 'County (optional)', null],
        ['postcode', 'Postcode', 'postal-code']
      ]) {
        const input = inputOf(result, name)

        expect(input).toEqual(expect.stringContaining(`name="${name}"`))
        expect(result).toMatch(
          new RegExp(
            `for="${name}">\\s*${label.replace(/[()]/g, '\\$&')}\\s*</label>`
          )
        )

        if (autocomplete) {
          expect(input).toEqual(
            expect.stringContaining(`autocomplete="${autocomplete}"`)
          )
        }
      }

      expect(inputOf(result, 'townOrCity')).toEqual(
        expect.stringContaining('govuk-!-width-two-thirds')
      )
      expect(inputOf(result, 'postcode')).toEqual(
        expect.stringContaining('govuk-input--width-10')
      )
    })

    test('Should ask for the UKAS accreditation number as an optional number', async () => {
      const { result } = await get(LABORATORY_DETAILS_PATH)
      const input = inputOf(result, 'ukasAccreditationNumber')

      expect(result).toMatch(
        /for="ukasAccreditationNumber">\s*UKAS accreditation number \(optional\)\s*<\/label>/
      )
      expect(input).toEqual(expect.stringContaining('inputmode="numeric"'))
      expect(input).toEqual(expect.stringContaining('spellcheck="false"'))
      expect(input).toEqual(expect.stringContaining('govuk-input--width-10'))
    })

    test('Should not ask for what the sign-in gives', async () => {
      const { result } = await get(LABORATORY_DETAILS_PATH)

      expect(result).not.toEqual(
        expect.stringContaining('name="reportingPerson"')
      )
      expect(result).not.toEqual(
        expect.stringContaining('name="laboratoryName"')
      )
      // Shown above every signed-in page instead
      expect(result).toEqual(expect.stringContaining('Caroline Ford'))
    })

    test('Should post back to itself with a crumb, and go back to Submission Welcome', async () => {
      const { result } = await get(LABORATORY_DETAILS_PATH)

      expect(result).toEqual(
        expect.stringContaining(`action="${LABORATORY_DETAILS_PATH}"`)
      )
      expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)
      expect(result).toEqual(expect.stringContaining('Continue'))
      expect(result).toEqual(
        expect.stringContaining(
          'href="/submission-welcome" class="govuk-back-link"'
        )
      )
    })

    test('Should sit under Submission Welcome in the breadcrumbs', async () => {
      const { result } = await get(LABORATORY_DETAILS_PATH)

      expect(result).toEqual(expect.stringContaining('govuk-breadcrumbs'))
      expect(result).toEqual(expect.stringContaining('Update diagnostic tests'))
    })

    test('Should start blank for a lab that has given no details', async () => {
      const { result } = await get(LABORATORY_DETAILS_PATH)

      for (const name of LABORATORY_DETAILS_FIELD_NAMES) {
        expect(valueOf(result, name)).toBe('')
      }
    })

    test('Should start from what was answered earlier in the session', async () => {
      const jar = cookieJar()

      await postLaboratoryDetails(ANSWERS, jar)

      const { result } = await get(LABORATORY_DETAILS_PATH, jar)

      expect(valueOf(result, 'addressLine1')).toBe('Y Buarth')
      expect(valueOf(result, 'postcode')).toBe('SY23 1ND')
    })

    test("Should start from the lab's last submitted details", async () => {
      const jar = cookieJar()

      await postLaboratoryDetails(ANSWERS, jar)
      await get(DIAGNOSTIC_TESTS_PATH, jar)

      const submitted = await post(
        DIAGNOSTIC_TESTS_PATH,
        { tests: 'bhv-fat', [accreditationFieldId({ key: 'bhv-fat' })]: 'Yes' },
        jar
      )

      expect(submitted.statusCode).toBe(statusCodes.seeOther)

      const { result } = await get(LABORATORY_DETAILS_PATH, jar)

      expect(
        Object.fromEntries(
          LABORATORY_DETAILS_FIELD_NAMES.map((name) => [
            name,
            valueOf(result, name)
          ])
        )
      ).toEqual({
        addressLine1: 'Y Buarth',
        addressLine2: '',
        townOrCity: 'Aberystwyth',
        county: 'Ceredigion',
        postcode: 'SY23 1ND',
        ukasAccreditationNumber: '9934'
      })
    })

    test("Should not start from another lab's details", async () => {
      const jar = cookieJar()

      await postLaboratoryDetails(ANSWERS, jar)
      await get(DIAGNOSTIC_TESTS_PATH, jar)
      await post(
        DIAGNOSTIC_TESTS_PATH,
        { tests: 'bhv-fat', [accreditationFieldId({ key: 'bhv-fat' })]: 'Yes' },
        jar
      )

      const otherLab = {
        ...auth,
        credentials: {
          ...auth.credentials,
          user: { ...user, organisationId: 'TestLab2' }
        }
      }
      const { result } = await get(LABORATORY_DETAILS_PATH, jar, otherLab)

      expect(valueOf(result, 'addressLine1')).toBe('')
    })

    test('Should send a user without Animal Health Regulations back to Submission Welcome', async () => {
      const { statusCode, headers } = await get(
        LABORATORY_DETAILS_PATH,
        cookieJar(),
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should send a signed-out user to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: LABORATORY_DETAILS_PATH
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(
        `${AUTH_PATHS.SIGN_IN_CHOOSE}?redirect=${encodeURIComponent(LABORATORY_DETAILS_PATH)}`
      )
    })
  })

  describe(`POST ${LABORATORY_DETAILS_PATH}`, () => {
    test('Should keep the details and go on to the tests', async () => {
      const jar = cookieJar()
      const { statusCode, headers } = await postLaboratoryDetails(ANSWERS, jar)

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe(DIAGNOSTIC_TESTS_PATH)

      const tests = await get(DIAGNOSTIC_TESTS_PATH, jar)

      expect(tests.statusCode).toBe(statusCodes.ok)
    })

    test('Should list every error in the summary and next to its field, keeping what was typed', async () => {
      const { result, statusCode } = await postLaboratoryDetails({
        addressLine2: 'Penglais',
        postcode: 'SY23'
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('There is a problem'))

      for (const [name, message] of [
        ['addressLine1', ADDRESS_LINE_1_MISSING],
        ['townOrCity', TOWN_OR_CITY_MISSING],
        ['postcode', POSTCODE_INVALID]
      ]) {
        expect(result).toEqual(
          expect.stringContaining(`href="#${name}">${message}</a>`)
        )
        expect(result).toEqual(expect.stringContaining(`id="${name}-error"`))
        expect(inputOf(result, name)).toEqual(
          expect.stringContaining('govuk-input--error')
        )
      }

      expect(valueOf(result, 'addressLine2')).toBe('Penglais')
      expect(valueOf(result, 'postcode')).toBe('SY23')
    })

    test('Should not go on to the tests until the details are valid', async () => {
      const jar = cookieJar()
      const { result, statusCode } = await postLaboratoryDetails(
        { ...ANSWERS, ukasAccreditationNumber: 'UKAS 9934' },
        jar
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining(UKAS_NUMBER_NOT_NUMBERS))

      const tests = await get(DIAGNOSTIC_TESTS_PATH, jar)

      expect(tests.statusCode).toBe(statusCodes.redirect)
      expect(tests.headers.location).toBe(LABORATORY_DETAILS_PATH)
    })

    test('Should send a user without Animal Health Regulations back to Submission Welcome', async () => {
      const { statusCode, headers } = await postLaboratoryDetails(
        ANSWERS,
        cookieJar(),
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should send a signed-out user to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: LABORATORY_DETAILS_PATH,
        payload: ANSWERS
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(
        `${AUTH_PATHS.SIGN_IN_CHOOSE}?redirect=${encodeURIComponent(LABORATORY_DETAILS_PATH)}`
      )
    })
  })
})
