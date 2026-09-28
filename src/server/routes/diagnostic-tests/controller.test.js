import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { AUTH_PATHS } from '#/server/auth/auth-constants.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import {
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

    test('Should record who, for which lab, when, and one row per ticked test', () => {
      expect(
        buildDiagnosticTestsSubmission(
          user,
          [
            { test: mycoplasmaPcr, accreditation: 'Yes' },
            { test: bhvFat, accreditation: 'No' }
          ],
          { referenceNumber: 'ABC-DEF-GHJ', now }
        )
      ).toEqual({
        referenceNumber: 'ABC-DEF-GHJ',
        form: DIAGNOSTIC_TESTS_FORM,
        processName: DIAGNOSTIC_TESTS_PROCESS_NAME,
        userId: 'user-id',
        organisationId: 'TestLab1',
        submittedAt: '2026-09-24T14:04:00.000Z',
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

    test('Should carry only the fields that apply, in the order of a report record', () => {
      const submission = buildDiagnosticTestsSubmission(user, [], {
        referenceNumber: 'ABC-DEF-GHJ',
        now
      })

      expect(Object.keys(submission)).toEqual([
        'referenceNumber',
        'form',
        'processName',
        'userId',
        'organisationId',
        'submittedAt',
        'diagnosticTestsData'
      ])
      expect(submission).not.toHaveProperty('fileName')
      expect(submission).not.toHaveProperty('fileNames')
      expect(submission).not.toHaveProperty('notificationEmail')
    })

    test('Should generate a reference number and timestamp by default', () => {
      const before = Date.now()
      const submission = buildDiagnosticTestsSubmission(user, [])

      expect(submission.referenceNumber).toMatch(
        /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/
      )
      expect(Date.parse(submission.submittedAt)).toBeGreaterThanOrEqual(before)
    })

    test('Should record null for a user without an id or lab', () => {
      const submission = buildDiagnosticTestsSubmission(undefined, [], { now })

      expect(submission.userId).toBeNull()
      expect(submission.organisationId).toBeNull()
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

  function getCookieValue(response, name) {
    const setCookieHeaders = [response.headers['set-cookie']].flat()
    const cookie = setCookieHeaders.find((header) =>
      header?.startsWith(`${name}=`)
    )

    return cookie?.split(';')[0].split('=')[1]
  }

  function getDiagnosticTests(authOverride = auth) {
    return server.inject({
      method: 'GET',
      url: DIAGNOSTIC_TESTS_PATH,
      auth: authOverride
    })
  }

  async function postDiagnosticTests(payload = {}, authOverride = auth) {
    const getResponse = await getDiagnosticTests(authOverride)
    const crumb = getCookieValue(getResponse, 'crumb')

    return server.inject({
      method: 'POST',
      url: DIAGNOSTIC_TESTS_PATH,
      auth: authOverride,
      headers: { cookie: `crumb=${crumb}` },
      payload: { ...payload, crumb }
    })
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

    test('Should post back to itself with a crumb, and offer Continue and Go back', async () => {
      const { result } = await getDiagnosticTests()

      expect(result).toEqual(
        expect.stringContaining(`action="${DIAGNOSTIC_TESTS_PATH}"`)
      )
      expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)
      expect(result).toEqual(expect.stringContaining('Continue'))
      expect(result).toEqual(
        expect.stringContaining(
          '<a class="govuk-link" href="/submission-welcome">Go back</a>'
        )
      )
      expect(result).not.toEqual(expect.stringContaining('Save and exit'))
    })

    test('Should sit under Submission Welcome in the breadcrumbs', async () => {
      const { result } = await getDiagnosticTests()

      expect(result).toEqual(expect.stringContaining('govuk-breadcrumbs'))
      expect(result).toEqual(
        expect.stringContaining('href="/submission-welcome"')
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

    test('Should log the submission and show the page again with the answers kept', async () => {
      const { result, statusCode, headers } = await postDiagnosticTests({
        tests: ['bhv-fat', 'mycoplasma-pcr', 'not-a-test'],
        [accreditationFieldId(mycoplasmaPcr)]: 'Yes',
        [accreditationFieldId(bhvFat)]: 'Unknown',
        // Not ticked, so not recorded
        [accreditationFieldId(bhvPcr)]: 'No'
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(headers.location).toBeUndefined()
      expect(result).not.toEqual(expect.stringContaining('There is a problem'))

      // The answers stay on the page, in their sections, which are open
      expect(result).toEqual(
        expect.stringContaining('value="mycoplasma-pcr" checked')
      )
      expect(result).toEqual(expect.stringContaining('value="bhv-fat" checked'))
      expect(result).not.toEqual(
        expect.stringContaining('value="bhv-pcr" checked')
      )
      expect(
        sectionOf(result, mycoplasmaPcr.pathogen).split(
          `id="${accreditationFieldId(mycoplasmaPcr)}"`
        )[1]
      ).toEqual(
        expect.stringContaining('<option value="Yes" selected>Yes</option>')
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
      // The form can be submitted again from here
      expect(/name="crumb" value="[^"]+"/.test(result)).toBe(true)

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

      expect(statusCode).toBe(statusCodes.ok)

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

      // The record itself carries the tests
      const written = JSON.parse(record.toString())

      expect(written).toEqual(submission)
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

    test('Should show the error page when the delivery fails', async () => {
      config.set('azure.storage.enabled', true)
      azureStorageService.uploadFile.mockRejectedValueOnce(
        new Error('Azure upload failed: container unavailable')
      )

      const { statusCode } = await postDiagnosticTests({
        tests: 'bhv-fat',
        [accreditationFieldId(bhvFat)]: 'Yes'
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
      expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)
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
})
