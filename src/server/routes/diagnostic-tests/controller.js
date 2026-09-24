import { generateUniqueReference } from '@defra/forms-engine-plugin/engine/referenceNumbers.js'

import {
  ACCREDITATION_OPTIONS,
  pathogens,
  tests,
  testsByKey
} from './qualifying-tests.js'
import {
  DIAGNOSTIC_TESTS_FILE_NAME,
  buildDiagnosticTestsWorkbook
} from './diagnostic-tests-workbook.js'
import { deliverDiagnosticTestsSubmission } from './diagnostic-tests-output.js'

export const DIAGNOSTIC_TESTS_PATH = '/diagnostic-tests'
export const DIAGNOSTIC_TESTS_TITLE = 'Define your qualifying tests in use'

// `form` and `processName` of the record, the way a report journey's slug and
// report type code fill them (see src/server/forms/services/output-service.js)
export const DIAGNOSTIC_TESTS_FORM = 'diagnostic-tests'
export const DIAGNOSTIC_TESTS_PROCESS_NAME = 'DT'

// The checkboxes share one name, so the payload carries the ticked tests as
// one value or an array of them; each test's select is named after its key
const TESTS_FIELD = 'tests'
const ACCREDITATION_FIELD_PREFIX = 'accreditation-'

// The element the "no test ticked" error points at: the group wrapping the
// accordion, since that error belongs to no single section
export const TESTS_GROUP_ID = 'tests'

export const NO_TESTS_ERROR = 'Select at least one qualifying test'
const ACCREDITATION_PLACEHOLDER = 'Select'

/**
 * The id and name of a test's accreditation select
 * @param {{ key: string }} test - an entry of the catalogue
 */
export function accreditationFieldId(test) {
  return `${ACCREDITATION_FIELD_PREFIX}${test.key}`
}

/**
 * Named after the test and its pathogen, since several pathogens share test
 * names (PCR) and the error summary lists every message together
 * @param {{ name: string, pathogen: { name: string } }} test - an entry of the catalogue
 */
export function accreditationError(test) {
  return `Select the accreditation for ${test.name} (${test.pathogen.name})`
}

/**
 * The tests ticked in a posted form, each with the accreditation chosen for
 * it, in catalogue order. Values that name no test are ignored: they were
 * never offered. A select left on its placeholder reads as null.
 * @param {Record<string, unknown>} [payload] - request.payload
 * @returns {{ test: object, accreditation: string | null }[]}
 */
export function parseDiagnosticTestsPayload(payload = {}) {
  const ticked = new Set(
    [payload[TESTS_FIELD]]
      .flat()
      .filter((value) => typeof value === 'string' && testsByKey.has(value))
  )

  return tests
    .filter((test) => ticked.has(test.key))
    .map((test) => {
      const accreditation = payload[accreditationFieldId(test)]

      return {
        test,
        accreditation:
          typeof accreditation === 'string' && accreditation !== ''
            ? accreditation
            : null
      }
    })
}

/**
 * The errors of a set of selections, as error summary items: at least one
 * test must be ticked, and every ticked test needs one of the offered
 * accreditations.
 * @param {{ test: object, accreditation: string | null }[]} selections
 * @returns {{ href: string, text: string }[]}
 */
export function validateDiagnosticTests(selections) {
  if (selections.length === 0) {
    return [{ href: `#${TESTS_GROUP_ID}`, text: NO_TESTS_ERROR }]
  }

  return selections
    .filter(
      ({ accreditation }) => !ACCREDITATION_OPTIONS.includes(accreditation)
    )
    .map(({ test }) => ({
      href: `#${accreditationFieldId(test)}`,
      text: accreditationError(test)
    }))
}

/**
 * The record of a lab's qualifying tests, shaped like the submission.json of
 * a report (see src/server/forms/services/output-service.js) with only the
 * fields that apply: no report month and no notification email. The tests
 * themselves are not in the record; they are in the workbook it names, the
 * one file of the submission (see diagnostic-tests-workbook.js).
 * @param {{ id?: string, organisationId?: string }} [user] - the session user
 * @param {{ referenceNumber?: string, now?: Date }} [options] - fixed for tests
 */
export function buildDiagnosticTestsSubmission(
  user,
  { referenceNumber = generateUniqueReference(), now = new Date() } = {}
) {
  return {
    referenceNumber,
    form: DIAGNOSTIC_TESTS_FORM,
    processName: DIAGNOSTIC_TESTS_PROCESS_NAME,
    userId: user?.id ?? null,
    organisationId: user?.organisationId ?? null,
    submittedAt: now.toISOString(),
    fileName: DIAGNOSTIC_TESTS_FILE_NAME
  }
}

// The select's options: a placeholder that reads as "nothing chosen yet",
// then the accreditations, with the chosen one selected
function accreditationItems(selected) {
  return [
    { value: '', text: ACCREDITATION_PLACEHOLDER, selected: selected === null },
    ...ACCREDITATION_OPTIONS.map((option) => ({
      value: option,
      text: option,
      selected: option === selected
    }))
  ]
}

/**
 * What the template needs: one accordion section per pathogen, each test as
 * a checkbox with its accreditation select, and the errors. A section starts
 * collapsed and is only expanded when it holds a ticked test or an error, so
 * what needs attention is visible when the page comes back.
 */
function buildViewModel(selections = [], errors = []) {
  const selectionsByKey = new Map(
    selections.map((selection) => [selection.test.key, selection])
  )
  const errorsByHref = new Map(errors.map((error) => [error.href, error.text]))

  const sections = pathogens.map((pathogen) => {
    const items = pathogen.tests.map((test) => {
      const key = test.key
      const selection = selectionsByKey.get(key)
      const fieldId = accreditationFieldId(test)
      const accreditation = selection?.accreditation ?? null

      return {
        id: `test-${key}`,
        value: key,
        text: test.name,
        checked: Boolean(selection),
        accreditation: {
          id: fieldId,
          name: fieldId,
          items: accreditationItems(accreditation),
          errorMessage: errorsByHref.get(`#${fieldId}`) ?? null
        }
      }
    })

    return {
      key: pathogen.key,
      heading: pathogen.name,
      expanded: items.some(
        (item) => item.checked || item.accreditation.errorMessage
      ),
      items
    }
  })

  return {
    pageTitle: DIAGNOSTIC_TESTS_TITLE,
    diagnosticTestsPath: DIAGNOSTIC_TESTS_PATH,
    testsGroupId: TESTS_GROUP_ID,
    testsField: TESTS_FIELD,
    testsError: errorsByHref.get(`#${TESTS_GROUP_ID}`) ?? null,
    sections,
    errors
  }
}

function renderDiagnosticTests(h, selections, errors) {
  return h.view('diagnostic-tests/index', buildViewModel(selections, errors))
}

/**
 * "Define your qualifying tests in use": the tests a lab uses for each
 * pathogen and whether each is UKAS accredited. Reached from Submission
 * Welcome; any signed-in user may open it.
 */
export const diagnosticTestsGetController = {
  handler(_request, h) {
    return renderDiagnosticTests(h)
  }
}

/**
 * Continue: the ticked tests are validated and, once they pass, written into
 * APHA's workbook and delivered with the record to the Azure container under
 * the reference number, as a report is. The page is then shown again with
 * the answers still in place. A failed delivery surfaces as the service's
 * error page, as it does for a report.
 */
export const diagnosticTestsPostController = {
  async handler(request, h) {
    const selections = parseDiagnosticTestsPayload(request.payload ?? {})
    const errors = validateDiagnosticTests(selections)

    if (errors.length > 0) {
      return renderDiagnosticTests(h, selections, errors)
    }

    await deliverDiagnosticTestsSubmission({
      submission: buildDiagnosticTestsSubmission(
        request.auth.credentials?.user
      ),
      workbook: buildDiagnosticTestsWorkbook(selections),
      logger: request.logger
    })

    return renderDiagnosticTests(h, selections)
  }
}
