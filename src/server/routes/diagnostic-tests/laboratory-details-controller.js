import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  howToReportPath,
  reportTypesByCode
} from '#/server/forms/report-types.js'

import {
  DIAGNOSTIC_TESTS_PATH,
  endDiagnosticTestsConfirmation,
  redirectWithoutAnimalHealthRegulations
} from './controller.js'
import { getLabDetails } from './lab-diagnostic-tests.js'
import {
  LABORATORY_DETAILS_FIELD_NAMES,
  LABORATORY_DETAILS_PATH,
  LABORATORY_DETAILS_TITLE,
  getJourneyLaboratoryDetails,
  keepJourneyLaboratoryDetails,
  laboratoryDetailsValues,
  normaliseLaboratoryDetails,
  parseLaboratoryDetails,
  validateLaboratoryDetails
} from './laboratory-details.js'

// Updating the tests is offered where the Animal Health Regulations report
// asks how the user would like to report
const BACK_HREF = howToReportPath(reportTypesByCode.get('AHR'))

/**
 * What the template needs: each input's id, name, value and error, and the
 * error summary.
 */
function buildViewModel(values, errors = []) {
  const errorsByHref = new Map(errors.map((error) => [error.href, error.text]))

  const fields = Object.fromEntries(
    LABORATORY_DETAILS_FIELD_NAMES.map((name) => {
      const error = errorsByHref.get(`#${name}`)

      return [
        name,
        {
          id: name,
          name,
          value: values[name],
          errorMessage: error ? { text: error } : null
        }
      ]
    })
  )

  return {
    pageTitle: LABORATORY_DETAILS_TITLE,
    formAction: LABORATORY_DETAILS_PATH,
    backLink: { text: 'Back', href: BACK_HREF },
    fields,
    errors
  }
}

function renderLaboratoryDetails(h, values, errors) {
  return h.view(
    'diagnostic-tests/laboratory-details',
    buildViewModel(values, errors)
  )
}

/**
 * The first step of updating the diagnostic tests, reached from the Animal
 * Health Regulations report's "How would you like to report". It starts from
 * what was answered earlier in this session (the user came back from the
 * tests), otherwise from the lab's last submitted details. Opening it ends
 * the previous submission's confirmation.
 */
export const laboratoryDetailsGetController = {
  async handler(request, h) {
    const refused = redirectWithoutAnimalHealthRegulations(request, h)

    if (refused) {
      return refused
    }

    endDiagnosticTestsConfirmation(request)

    const details =
      getJourneyLaboratoryDetails(request) ?? (await getLabDetails(request))

    return renderLaboratoryDetails(h, laboratoryDetailsValues(details))
  }
}

/**
 * Continue: valid answers are kept in the session, to be delivered with the
 * tests, and the user goes on to the tests.
 */
export const laboratoryDetailsPostController = {
  handler(request, h) {
    const refused = redirectWithoutAnimalHealthRegulations(request, h)

    if (refused) {
      return refused
    }

    const values = parseLaboratoryDetails(request.payload ?? {})
    const errors = validateLaboratoryDetails(values)

    if (errors.length > 0) {
      return renderLaboratoryDetails(h, values, errors)
    }

    keepJourneyLaboratoryDetails(request, normaliseLaboratoryDetails(values))

    return h.redirect(DIAGNOSTIC_TESTS_PATH).code(statusCodes.seeOther)
  }
}
