import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { AUTH_PATHS } from '#/server/auth/auth-constants.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import {
  DIAGNOSTIC_TESTS_CONFIRMATION_PATH,
  DIAGNOSTIC_TESTS_CONFIRMATION_TITLE,
  DIAGNOSTIC_TESTS_FORM,
  DIAGNOSTIC_TESTS_PATH,
  DIAGNOSTIC_TESTS_PROCESS_NAME,
  DIAGNOSTIC_TESTS_TITLE,
  NO_TESTS_ERROR,
  TESTS_GROUP_ID,
  accreditationError,
  accreditationFieldId,
  buildDiagnosticTestsSubmission,
  parseDiagnosticTestsPayload,
  validateDiagnosticTests
} from './controller.js'
import { LABORATORY_DETAILS_PATH } from './laboratory-details.js'
import {
  ACCREDITATION_OPTIONS,
  pathogens,
  tests,
  testsByKey
} from './qualifying-tests.js'

vi.mock('#/server/upload/services/azure-storage-service.js', () => ({
  azureStorageService: { uploadFile: vi.fn() }
}))

// Not an accreditation of a test in use: a test not in use is not ticked
const NOT_APPLICABLE = 'Not applicable'

const mycoplasmaPcr = testsByKey.get('mycoplasma-pcr')
const bhvFat = testsByKey.get('bhv-fat')
const bhvPcr = testsByKey.get('bhv-pcr')

const user = {
  id: 'user-id',
  name: 'A Person',
  organisationId: 'TestLab1',
  journeys: ['BR', 'AHR']
}

// The laboratory details page's answers, as kept once validated
const LABORATORY_DETAILS = {
  addressLine1: 'Y Buarth',
  addressLine2: null,
  townOrCity: 'Aberystwyth',
  county: 'Ceredigion',
  postcode: 'SY23 1ND',
  ukasAccreditationNumber: '9934'
}

// ... and as the record carries them, with who reports for which lab
const LABORATORY_DETAILS_RECORD = {
  reportingPerson: 'A Person',
  laboratoryName: 'TestLab1',
  ...LABORATORY_DETAILS
}

/**
 * A signed-in session. The page is open to a user who can submit Animal
 * Health Regulations.
 */
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

// Where each accordion section starts: the class is followed by the closing
// quote or, when expanded, by the modifier class. The header, heading and
// content elements share the prefix, so they must not split the page.
const SECTION_START = /<div class="govuk-accordion__section(?=[" ])/
const EXPANDED_START = ' govuk-accordion__section--expanded"'

// The section of the accordion holding the given pathogen, as rendered,
// found by the hidden legend of its checkboxes
function sectionOf(html, pathogen) {
  return html
    .split(SECTION_START)
    .slice(1)
    .find((section) =>
      section.includes(`Qualifying tests for ${pathogen.name}`)
    )
}

function isExpanded(section) {
  return section.startsWith(EXPANDED_START)
}

describe('diagnostic tests helpers', () => {
  describe('parseDiagnosticTestsPayload', () => {
    test('Should read one ticked test and its accreditation', () => {
      expect(
        parseDiagnosticTestsPayload({
          tests: 'bhv-fat',
          [accreditationFieldId(bhvFat)]: 'Yes'
        })
      ).toEqual([{ test: bhvFat, accreditation: 'Yes' }])
    })

    test('Should read several ticked tests in catalogue order, not tick order', () => {
      const selections = parseDiagnosticTestsPayload({
        tests: ['bhv-fat', 'mycoplasma-pcr'],
        [accreditationFieldId(bhvFat)]: 'No',
        [accreditationFieldId(mycoplasmaPcr)]: 'Unknown'
      })

      expect(selections).toEqual([
        { test: mycoplasmaPcr, accreditation: 'Unknown' },
        { test: bhvFat, accreditation: 'No' }
      ])
    })

    test('Should read a select left on its placeholder as null', () => {
      expect(
        parseDiagnosticTestsPayload({
          tests: 'bhv-fat',
          [accreditationFieldId(bhvFat)]: ''
        })
      ).toEqual([{ test: bhvFat, accreditation: null }])
      expect(parseDiagnosticTestsPayload({ tests: 'bhv-fat' })).toEqual([
        { test: bhvFat, accreditation: null }
      ])
    })

    test('Should ignore accreditations of tests that are not ticked', () => {
      expect(
        parseDiagnosticTestsPayload({
          tests: 'bhv-fat',
          [accreditationFieldId(bhvFat)]: 'Yes',
          [accreditationFieldId(mycoplasmaPcr)]: 'Yes'
        })
      ).toEqual([{ test: bhvFat, accreditation: 'Yes' }])
    })

    test('Should ignore values that name no test', () => {
      expect(
        parseDiagnosticTestsPayload({ tests: ['not-a-test', 'bhv-fat'] })
      ).toEqual([{ test: bhvFat, accreditation: null }])
      expect(parseDiagnosticTestsPayload({ tests: [42, null] })).toEqual([])
    })

    test('Should read nothing from an empty or missing payload', () => {
      expect(parseDiagnosticTestsPayload({})).toEqual([])
      expect(parseDiagnosticTestsPayload()).toEqual([])
    })

    test('Should not read an accreditation that is not a string', () => {
      expect(
        parseDiagnosticTestsPayload({
          tests: 'bhv-fat',
          [accreditationFieldId(bhvFat)]: ['Yes', 'No']
        })
      ).toEqual([{ test: bhvFat, accreditation: null }])
    })
  })

  describe('validateDiagnosticTests', () => {
    test('Should require at least one test', () => {
      expect(validateDiagnosticTests([])).toEqual([
        { href: `#${TESTS_GROUP_ID}`, text: NO_TESTS_ERROR }
      ])
    })

    test.each(ACCREDITATION_OPTIONS)(
      'Should accept "%s" as an accreditation',
      (accreditation) => {
        expect(
          validateDiagnosticTests([{ test: bhvFat, accreditation }])
        ).toEqual([])
      }
    )

    test('Should refuse "Not applicable", which is what a test not in use reads', () => {
      expect(
        validateDiagnosticTests([
          { test: bhvFat, accreditation: NOT_APPLICABLE }
        ])
      ).toEqual([
        {
          href: `#${accreditationFieldId(bhvFat)}`,
          text: accreditationError(bhvFat)
        }
      ])
    })

    test('Should require an accreditation for every ticked test', () => {
      expect(
        validateDiagnosticTests([
          { test: mycoplasmaPcr, accreditation: null },
          { test: bhvPcr, accreditation: 'Yes' },
          { test: bhvFat, accreditation: 'Maybe' }
        ])
      ).toEqual([
        {
          href: `#${accreditationFieldId(mycoplasmaPcr)}`,
          text: accreditationError(mycoplasmaPcr)
        },
        {
          href: `#${accreditationFieldId(bhvFat)}`,
          text: accreditationError(bhvFat)
        }
      ])
    })

    test('Should name the test and its pathogen, since tests share names', () => {
      expect(accreditationError(bhvPcr)).toBe(
        'Select the accreditation for PCR (including gE PCR) (Bovine Herpes Virus 1 (BHV-1))'
      )
      expect(accreditationError(mycoplasmaPcr)).toBe(
        'Select the accreditation for PCR (Mycoplasma gallisepticum / M. meleagridis)'
      )
    })
  })

  describe('buildDiagnosticTestsSubmission', () => {
    const now = new Date('2026-09-24T14:04:00.000Z')

    test("Should record who, for which lab, when, the lab's details, and one row per ticked test", () => {
      expect(
        buildDiagnosticTestsSubmission(
          user,
          [
            { test: mycoplasmaPcr, accreditation: 'Yes' },
            { test: bhvFat, accreditation: 'No' }
          ],
          LABORATORY_DETAILS,
          { referenceNumber: 'ABC-DEF-GHJ', now }
        )
      ).toEqual({
        referenceNumber: 'ABC-DEF-GHJ',
        form: DIAGNOSTIC_TESTS_FORM,
        processName: DIAGNOSTIC_TESTS_PROCESS_NAME,
        userId: 'user-id',
        organisationId: 'TestLab1',
        submittedAt: '2026-09-24T14:04:00.000Z',
        laboratoryDetails: LABORATORY_DETAILS_RECORD,
        diagnosticTestsData: [
          {
            pathogen: 'Mycoplasma gallisepticum / M. meleagridis',
            test: 'PCR',
            accreditation: 'Yes'
          },
          {
            pathogen: 'Bovine Herpes Virus 1 (BHV-1)',
            test: 'FAT',
            accreditation: 'No'
          }
        ]
      })
    })

    test('Should identify the record as the diagnostic tests process', () => {
      expect(DIAGNOSTIC_TESTS_FORM).toBe('diagnostic-tests')
      expect(DIAGNOSTIC_TESTS_PROCESS_NAME).toBe('DT')
    })

    test('Should name the lab after its Customer Identity organisation when the user has one', () => {
      const submission = buildDiagnosticTestsSubmission(
        {
          ...user,
          organisationId: '6b2a1c0e-0000-4000-8000-000000000000',
          organisationName: 'Wales Veterinary Science Centre'
        },
        [],
        LABORATORY_DETAILS,
        { referenceNumber: 'ABC-DEF-GHJ', now }
      )

      expect(submission.organisationName).toBe(
        'Wales Veterinary Science Centre'
      )
      expect(submission.laboratoryDetails.laboratoryName).toBe(
        'Wales Veterinary Science Centre'
      )
    })

    test('Should carry only the fields that apply, in the order of a report record', () => {
      const submission = buildDiagnosticTestsSubmission(
        user,
        [],
        LABORATORY_DETAILS,
        { referenceNumber: 'ABC-DEF-GHJ', now }
      )

      expect(Object.keys(submission)).toEqual([
        'referenceNumber',
        'form',
        'processName',
        'userId',
        'organisationId',
        'submittedAt',
        'laboratoryDetails',
        'diagnosticTestsData'
      ])
      expect(Object.keys(submission.laboratoryDetails)).toEqual([
        'reportingPerson',
        'laboratoryName',
        'addressLine1',
        'addressLine2',
        'townOrCity',
        'county',
        'postcode',
        'ukasAccreditationNumber'
      ])
      expect(submission).not.toHaveProperty('fileName')
      expect(submission).not.toHaveProperty('fileNames')
      expect(submission).not.toHaveProperty('notificationEmail')
    })

    test('Should generate a reference number and timestamp by default', () => {
      const before = Date.now()
      const submission = buildDiagnosticTestsSubmission(
        user,
        [],
        LABORATORY_DETAILS
      )

      expect(submission.referenceNumber).toMatch(
        /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/
      )
      expect(Date.parse(submission.submittedAt)).toBeGreaterThanOrEqual(before)
    })

    test('Should record null for a user without an id, name or lab', () => {
      const submission = buildDiagnosticTestsSubmission(
        undefined,
        [],
        LABORATORY_DETAILS,
        { now }
      )

      expect(submission.userId).toBeNull()
      expect(submission.organisationId).toBeNull()
      expect(submission.laboratoryDetails).toEqual({
        ...LABORATORY_DETAILS_RECORD,
        reportingPerson: null,
        laboratoryName: null
      })
    })
  })
})

describe('diagnostic tests routes', () => {
  let server
  const auth = authWithJourneys()

  // What each request logged at info level, so the submission can be checked
  let infoLogs

  beforeAll(async () => {
    server = await createServer()

    server.ext('onPreHandler', (request, h) => {
      const info = request.logger.info.bind(request.logger)

      request.logger.info = (...args) => {
        infoLogs.push(args)
        return info(...args)
      }

      return h.continue
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    infoLogs = []
    config.set('azure.storage.enabled', false)
    azureStorageService.uploadFile.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    config.set('azure.storage.enabled', false)
  })

  /**
   * The cookies a browser would hold across requests: the CSRF crumb, the
   * session holding the laboratory details and the confirmation, and the
   * lab's diagnostic tests and laboratory details.
   */
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

  async function getLaboratoryDetails(authOverride = auth, jar = cookieJar()) {
    return jar.remember(
      await server.inject({
        method: 'GET',
        url: LABORATORY_DETAILS_PATH,
        auth: authOverride,
        headers: { cookie: jar.header() }
      })
    )
  }

  // The laboratory details page answered, as a user would
  const LABORATORY_DETAILS_PAYLOAD = {
    addressLine1: 'Y Buarth',
    addressLine2: '',
    townOrCity: 'Aberystwyth',
    county: 'Ceredigion',
    postcode: 'sy231nd',
    ukasAccreditationNumber: '9934'
  }

  // The step before the tests, which keeps its answers in the session
  async function enterLaboratoryDetails(
    authOverride = auth,
    jar = cookieJar()
  ) {
    await getLaboratoryDetails(authOverride, jar)

    return jar.remember(
      await server.inject({
        method: 'POST',
        url: LABORATORY_DETAILS_PATH,
        auth: authOverride,
        headers: { cookie: jar.header() },
        payload: { ...LABORATORY_DETAILS_PAYLOAD, crumb: jar.get('crumb') }
      })
    )
  }

  /**
   * The tests page, by default opened as a user reaches it: once the
   * laboratory details page is answered
   */
  async function getDiagnosticTests(
    authOverride = auth,
    jar = cookieJar(),
    { withLaboratoryDetails = true } = {}
  ) {
    if (withLaboratoryDetails) {
      await enterLaboratoryDetails(authOverride, jar)
    }

    return jar.remember(
      await server.inject({
        method: 'GET',
        url: DIAGNOSTIC_TESTS_PATH,
        auth: authOverride,
        headers: { cookie: jar.header() }
      })
    )
  }

  async function postDiagnosticTests(
    payload = {},
    authOverride = auth,
    jar = cookieJar()
  ) {
    await getDiagnosticTests(authOverride, jar)

    return jar.remember(
      await server.inject({
        method: 'POST',
        url: DIAGNOSTIC_TESTS_PATH,
        auth: authOverride,
        headers: { cookie: jar.header() },
        payload: { ...payload, crumb: jar.get('crumb') }
      })
    )
  }

  async function getConfirmation(authOverride = auth, jar = cookieJar()) {
    return jar.remember(
      await server.inject({
        method: 'GET',
        url: DIAGNOSTIC_TESTS_CONFIRMATION_PATH,
        auth: authOverride,
        headers: { cookie: jar.header() }
      })
    )
  }

  // A valid submission of two tests, from which the lab's tests are kept
  const VALID_PAYLOAD = {
    tests: ['mycoplasma-pcr', 'bhv-fat'],
    [accreditationFieldId(mycoplasmaPcr)]: 'Yes',
    [accreditationFieldId(bhvFat)]: 'Unknown'
  }

  function loggedSubmissions() {
    return infoLogs
      .filter(
        ([, message]) => message === 'Diagnostic tests submission received'
      )
      .map(([fields]) => fields.submission)
  }

  describe(`GET ${DIAGNOSTIC_TESTS_PATH}`, () => {
    test('Should render the page with its guidance', async () => {
      const { result, statusCode } = await getDiagnosticTests()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining(DIAGNOSTIC_TESTS_TITLE))
      expect(result).toEqual(
        expect.stringContaining('Only use this service if you are:')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'setting up your Qualifying tests for the first time'
        )
      )
      expect(result).toEqual(
        expect.stringContaining(
          'updating your tests and UK Accreditation Service (<strong>UKAS</strong>) since your last report month'
        )
      )
      expect(result).not.toEqual(expect.stringContaining('There is a problem'))
    })

    test('Should use the full page width, like the report entry pages', async () => {
      const { result } = await getDiagnosticTests()

      expect(result).toEqual(expect.stringContaining('govuk-grid-column-full'))
      expect(result).not.toEqual(
        expect.stringContaining('govuk-grid-column-two-thirds')
      )
    })

    test('Should render an accordion section per pathogen, all collapsed', async () => {
      const { result } = await getDiagnosticTests()

      expect(result).toEqual(
        expect.stringContaining('data-module="govuk-accordion"')
      )
      expect(result).toEqual(
        expect.stringContaining('data-remember-expanded="false"')
      )
      expect(result).not.toEqual(
        expect.stringContaining('govuk-accordion__section--expanded')
      )
      expect(result.split(SECTION_START)).toHaveLength(pathogens.length + 1)

      for (const pathogen of pathogens) {
        const section = sectionOf(result, pathogen)

        expect(section).toBeDefined()
        expect(isExpanded(section)).toBe(false)
        expect(section).toEqual(expect.stringContaining(pathogen.name))
      }
    })

    test('Should render a checkbox for every test that reveals an accreditation select', async () => {
      const { result } = await getDiagnosticTests()

      for (const test of tests) {
        const section = sectionOf(result, test.pathogen)
        const selectId = accreditationFieldId(test)

        expect(section).toEqual(
          expect.stringContaining(
            `id="test-${test.key}" name="tests" type="checkbox" value="${test.key}" data-aria-controls="conditional-test-${test.key}"`
          )
        )
        expect(section).toEqual(
          expect.stringContaining(
            `<select class="govuk-select" id="${selectId}" name="${selectId}">`
          )
        )
      }

      // The label of the test, with the design's own capitalisation
      expect(result).toEqual(
        expect.stringContaining('>\n              culture\n')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'Culture &amp; microscopy of Tritrichomonas foetus'
        )
      )
    })

    test('Should offer the accreditations after a placeholder, nothing chosen', async () => {
      const { result } = await getDiagnosticTests()
      const selectId = accreditationFieldId(bhvFat)
      const select = result.split(`id="${selectId}"`)[1].split('</select>')[0]

      expect(select).toEqual(
        expect.stringContaining('<option value="" selected>Select</option>')
      )

      for (const option of ACCREDITATION_OPTIONS) {
        expect(select).toEqual(
          expect.stringContaining(
            `<option value="${option}">${option}</option>`
          )
        )
      }

      expect(select.match(/<option /g)).toHaveLength(
        ACCREDITATION_OPTIONS.length + 1
      )
      // Not an accreditation of a test in use, so not a choice here
      expect(select).not.toEqual(expect.stringContaining(NOT_APPLICABLE))

      expect(result).toMatch(
        new RegExp(`for="${selectId}">\\s*Accreditation\\s*</label>`)
      )
    })

    test('Should post back to itself with a crumb, and offer Continue and Go back to the laboratory details', async () => {
      const { result } = await getDiagnosticTests()

      expect(result).toEqual(
        expect.stringContaining(`action="${DIAGNOSTIC_TESTS_PATH}"`)
      )
      expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)
      expect(result).toEqual(expect.stringContaining('Continue'))
      expect(result).toEqual(
        expect.stringContaining(
          `<a class="govuk-link" href="${LABORATORY_DETAILS_PATH}">Go back</a>`
        )
      )
      expect(result).not.toEqual(expect.stringContaining('Save and exit'))
    })

    test('Should send the user to the laboratory details page first', async () => {
      const { statusCode, headers } = await getDiagnosticTests(
        auth,
        cookieJar(),
        { withLaboratoryDetails: false }
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
    })

    test('Should sit under the Animal Health Regulations report in the breadcrumbs', async () => {
      const { result } = await getDiagnosticTests()

      expect(result).toEqual(expect.stringContaining('govuk-breadcrumbs'))
      expect(result).toEqual(
        expect.stringContaining('href="/submission-welcome"')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'href="/animal-health-regulations/how-to-report"'
        )
      )
      expect(result).toEqual(expect.stringContaining('Update diagnostic tests'))
    })

    test('Should be open to a user who holds only Animal Health Regulations', async () => {
      const { statusCode } = await getDiagnosticTests(authWithJourneys(['AHR']))

      expect(statusCode).toBe(statusCodes.ok)
    })

    test('Should send a user without Animal Health Regulations back to Submission Welcome', async () => {
      const { statusCode, headers } = await getDiagnosticTests(
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should send a signed-out user to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: DIAGNOSTIC_TESTS_PATH
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(
        `${AUTH_PATHS.SIGN_IN_CHOOSE}?redirect=${encodeURIComponent(DIAGNOSTIC_TESTS_PATH)}`
      )
    })

    test("Should open with the lab's current tests ticked, their sections open", async () => {
      const jar = cookieJar()

      await postDiagnosticTests(VALID_PAYLOAD, auth, jar)

      const { result, statusCode } = await getDiagnosticTests(auth, jar)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(expect.stringContaining('There is a problem'))
      expect(result).toEqual(
        expect.stringContaining('value="mycoplasma-pcr" checked')
      )
      expect(result).toEqual(expect.stringContaining('value="bhv-fat" checked'))
      expect(result).not.toEqual(
        expect.stringContaining('value="bhv-pcr" checked')
      )
      expect(
        sectionOf(result, bhvFat.pathogen).split(
          `id="${accreditationFieldId(bhvFat)}"`
        )[1]
      ).toEqual(
        expect.stringContaining(
          '<option value="Unknown" selected>Unknown</option>'
        )
      )

      for (const pathogen of pathogens) {
        expect(isExpanded(sectionOf(result, pathogen))).toBe(
          ['mycoplasma', 'bhv'].includes(pathogen.key)
        )
      }
    })

    test("Should not open with another lab's tests", async () => {
      const jar = cookieJar()

      await postDiagnosticTests(VALID_PAYLOAD, auth, jar)

      const { result } = await getDiagnosticTests(
        {
          ...auth,
          credentials: {
            ...auth.credentials,
            user: { ...user, organisationId: 'TestLab2' }
          }
        },
        jar
      )

      expect(result).not.toEqual(expect.stringContaining('checked'))
    })
  })

  describe(`POST ${DIAGNOSTIC_TESTS_PATH}`, () => {
    test('Should send a user without Animal Health Regulations back to Submission Welcome', async () => {
      const { statusCode, headers } = await postDiagnosticTests(
        {},
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })

    test('Should ask for at least one test when none is ticked', async () => {
      const { result, statusCode, headers } = await postDiagnosticTests()

      expect(statusCode).toBe(statusCodes.ok)
      expect(headers.location).toBeUndefined()
      expect(result).toEqual(expect.stringContaining('There is a problem'))
      expect(result).toEqual(
        expect.stringContaining(
          `href="#${TESTS_GROUP_ID}">${NO_TESTS_ERROR}</a>`
        )
      )
      expect(result).toEqual(
        expect.stringContaining(
          `class="govuk-form-group govuk-form-group--error" id="${TESTS_GROUP_ID}"`
        )
      )
      expect(result).toEqual(
        expect.stringContaining(
          `<p class="govuk-error-message" id="${TESTS_GROUP_ID}-error">`
        )
      )
      // Nothing was ticked, so there is nothing to open
      expect(result).not.toEqual(
        expect.stringContaining('govuk-accordion__section--expanded')
      )
      expect(loggedSubmissions()).toEqual([])
    })

    test('Should ask for the accreditation of a ticked test, keeping the tick', async () => {
      const { result, statusCode } = await postDiagnosticTests({
        tests: ['mycoplasma-pcr', 'bhv-fat'],
        [accreditationFieldId(mycoplasmaPcr)]: 'Yes',
        [accreditationFieldId(bhvFat)]: ''
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('There is a problem'))
      expect(result).toEqual(
        expect.stringContaining(
          `href="#${accreditationFieldId(bhvFat)}">${accreditationError(bhvFat)}</a>`
        )
      )
      expect(result).not.toEqual(expect.stringContaining(NO_TESTS_ERROR))
      expect(result).not.toEqual(
        expect.stringContaining(accreditationError(mycoplasmaPcr))
      )

      const bhvSection = sectionOf(result, bhvFat.pathogen)

      expect(bhvSection).toEqual(
        expect.stringContaining(`value="bhv-fat" checked`)
      )
      expect(bhvSection).toEqual(
        expect.stringContaining(
          `<select class="govuk-select govuk-select--error" id="${accreditationFieldId(bhvFat)}"`
        )
      )
      expect(bhvSection).toEqual(
        expect.stringContaining(`id="${accreditationFieldId(bhvFat)}-error"`)
      )
      expect(loggedSubmissions()).toEqual([])
    })

    test('Should open the sections holding a tick or an error and leave the others closed', async () => {
      const { result } = await postDiagnosticTests({
        tests: ['mycoplasma-pcr', 'bhv-fat'],
        [accreditationFieldId(mycoplasmaPcr)]: 'Yes'
      })

      for (const pathogen of pathogens) {
        expect(isExpanded(sectionOf(result, pathogen))).toBe(
          ['mycoplasma', 'bhv'].includes(pathogen.key)
        )
      }
    })

    test.each(['Maybe', NOT_APPLICABLE])(
      'Should refuse "%s" as an accreditation',
      async (accreditation) => {
        const { result, statusCode } = await postDiagnosticTests({
          tests: 'bhv-fat',
          [accreditationFieldId(bhvFat)]: accreditation
        })

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toEqual(
          expect.stringContaining(accreditationError(bhvFat))
        )
        expect(loggedSubmissions()).toEqual([])
        expect(azureStorageService.uploadFile).not.toHaveBeenCalled()
      }
    )

    test('Should log the submission, keep the tests and send the user to the confirmation', async () => {
      const jar = cookieJar()
      const { statusCode, headers } = await postDiagnosticTests(
        {
          tests: ['bhv-fat', 'mycoplasma-pcr', 'not-a-test'],
          [accreditationFieldId(mycoplasmaPcr)]: 'Yes',
          [accreditationFieldId(bhvFat)]: 'Unknown',
          // Not ticked, so not recorded
          [accreditationFieldId(bhvPcr)]: 'No'
        },
        auth,
        jar
      )

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe(DIAGNOSTIC_TESTS_CONFIRMATION_PATH)
      expect(jar.get('diagnosticTests')).toEqual(expect.any(String))
      expect(jar.get('laboratoryDetails')).toEqual(expect.any(String))

      const [submission, ...others] = loggedSubmissions()

      expect(others).toEqual([])
      expect(submission).toEqual({
        referenceNumber: expect.stringMatching(
          /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/
        ),
        form: DIAGNOSTIC_TESTS_FORM,
        processName: DIAGNOSTIC_TESTS_PROCESS_NAME,
        userId: user.id,
        organisationId: user.organisationId,
        submittedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        // Blank answers as null, the postcode as written on a letter
        laboratoryDetails: LABORATORY_DETAILS_RECORD,
        diagnosticTestsData: [
          {
            pathogen: 'Mycoplasma gallisepticum / M. meleagridis',
            test: 'PCR',
            accreditation: 'Yes'
          },
          {
            pathogen: 'Bovine Herpes Virus 1 (BHV-1)',
            test: 'FAT',
            accreditation: 'Unknown'
          }
        ]
      })
      // Azure storage is off in this test, so nothing was delivered
      expect(azureStorageService.uploadFile).not.toHaveBeenCalled()
    })

    test('Should deliver the record, and nothing else, to Azure under the reference number', async () => {
      config.set('azure.storage.enabled', true)

      const { statusCode } = await postDiagnosticTests({
        tests: ['mycoplasma-pcr', 'bhv-fat'],
        [accreditationFieldId(mycoplasmaPcr)]: 'Yes',
        [accreditationFieldId(bhvFat)]: 'No'
      })

      expect(statusCode).toBe(statusCodes.seeOther)

      const [submission] = loggedSubmissions()
      const { referenceNumber } = submission

      expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)

      const [recordId, record, recordMetadata] =
        azureStorageService.uploadFile.mock.calls[0]

      expect(recordId).toBe(`${referenceNumber}-submission`)
      expect(recordMetadata).toEqual({
        blobPrefix: referenceNumber,
        originalName: 'submission.json',
        contentType: 'application/json',
        type: 'submission',
        referenceNumber
      })

      // The record itself carries the lab's details and tests
      const written = JSON.parse(record.toString())

      expect(written).toEqual(submission)
      expect(written.laboratoryDetails).toEqual(LABORATORY_DETAILS_RECORD)
      expect(written.diagnosticTestsData).toEqual([
        {
          pathogen: 'Mycoplasma gallisepticum / M. meleagridis',
          test: 'PCR',
          accreditation: 'Yes'
        },
        {
          pathogen: 'Bovine Herpes Virus 1 (BHV-1)',
          test: 'FAT',
          accreditation: 'No'
        }
      ])
    })

    test('Should show the error page, and keep nothing, when the delivery fails', async () => {
      config.set('azure.storage.enabled', true)
      azureStorageService.uploadFile.mockRejectedValueOnce(
        new Error('Azure upload failed: container unavailable')
      )

      const jar = cookieJar()
      const { statusCode } = await postDiagnosticTests(
        {
          tests: 'bhv-fat',
          [accreditationFieldId(bhvFat)]: 'Yes'
        },
        auth,
        jar
      )

      expect(statusCode).toBe(statusCodes.internalServerError)
      expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)
      expect(jar.get('diagnosticTests')).toBeUndefined()
      expect(jar.get('laboratoryDetails')).toBeUndefined()

      const confirmation = await getConfirmation(auth, jar)

      expect(confirmation.headers.location).toBe(LABORATORY_DETAILS_PATH)
    })

    test('Should send the user back to the laboratory details page, delivering nothing, when the session no longer holds them', async () => {
      const jar = cookieJar()

      await getLaboratoryDetails(auth, jar)

      const { statusCode, headers } = jar.remember(
        await server.inject({
          method: 'POST',
          url: DIAGNOSTIC_TESTS_PATH,
          auth,
          headers: { cookie: jar.header() },
          payload: { ...VALID_PAYLOAD, crumb: jar.get('crumb') }
        })
      )

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
      expect(loggedSubmissions()).toEqual([])
      expect(jar.get('diagnosticTests')).toBeUndefined()
    })

    test('Should start the next update from the laboratory details page', async () => {
      const jar = cookieJar()

      await postDiagnosticTests(VALID_PAYLOAD, auth, jar)

      const { statusCode, headers } = await getDiagnosticTests(auth, jar, {
        withLaboratoryDetails: false
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
    })

    test('Should send a signed-out user to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: DIAGNOSTIC_TESTS_PATH,
        payload: { tests: 'bhv-fat' }
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(
        `${AUTH_PATHS.SIGN_IN_CHOOSE}?redirect=${encodeURIComponent(DIAGNOSTIC_TESTS_PATH)}`
      )
    })
  })

  describe(`GET ${DIAGNOSTIC_TESTS_CONFIRMATION_PATH}`, () => {
    test('Should confirm the submission with its reference, like a report confirmation', async () => {
      const jar = cookieJar()

      await postDiagnosticTests(VALID_PAYLOAD, auth, jar)

      const { referenceNumber } = loggedSubmissions()[0]
      const { result, statusCode } = await getConfirmation(auth, jar)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('govuk-panel'))
      expect(result).toEqual(
        expect.stringContaining(DIAGNOSTIC_TESTS_CONFIRMATION_TITLE)
      )
      expect(result).toEqual(
        expect.stringContaining(
          `Your reference number<br><strong>${referenceNumber}</strong>`
        )
      )
      expect(result).toEqual(expect.stringContaining('What happens next'))
      expect(result).toEqual(
        expect.stringContaining(
          'Thank you for your submission. We will process it and contact you if additional information is required.'
        )
      )
      expect(result).toEqual(
        expect.stringContaining(
          'href="/submission-welcome" class="govuk-link govuk-link--no-visited-state">Return to Submission Welcome</a>'
        )
      )
      expect(result).toEqual(
        expect.stringContaining('govuk-grid-column-two-thirds')
      )
      expect(result).toEqual(expect.stringContaining('govuk-breadcrumbs'))
      expect(result).toEqual(expect.stringContaining('Update diagnostic tests'))
    })

    test('Should still confirm the submission when refreshed', async () => {
      const jar = cookieJar()

      await postDiagnosticTests(VALID_PAYLOAD, auth, jar)
      await getConfirmation(auth, jar)

      const { referenceNumber } = loggedSubmissions()[0]
      const { result, statusCode } = await getConfirmation(auth, jar)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining(referenceNumber))
    })

    test('Should send the user to the start of the journey when nothing was submitted', async () => {
      const { statusCode, headers } = await getConfirmation()

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
    })

    test.each([
      ['the laboratory details page', LABORATORY_DETAILS_PATH],
      ['the tests page', DIAGNOSTIC_TESTS_PATH]
    ])(
      'Should end the confirmation once %s is opened again',
      async (_page, url) => {
        const jar = cookieJar()

        await postDiagnosticTests(VALID_PAYLOAD, auth, jar)
        jar.remember(
          await server.inject({
            method: 'GET',
            url,
            auth,
            headers: { cookie: jar.header() }
          })
        )

        const { statusCode, headers } = await getConfirmation(auth, jar)

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(LABORATORY_DETAILS_PATH)
      }
    )

    test('Should send a user without Animal Health Regulations back to Submission Welcome', async () => {
      const { statusCode, headers } = await getConfirmation(
        authWithJourneys(['BR'])
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe('/submission-welcome')
    })
  })
})
