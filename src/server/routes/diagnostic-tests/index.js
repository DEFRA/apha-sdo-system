import {
  DIAGNOSTIC_TESTS_CONFIRMATION_PATH,
  DIAGNOSTIC_TESTS_PATH,
  diagnosticTestsConfirmationGetController,
  diagnosticTestsGetController,
  diagnosticTestsPostController
} from './controller.js'
import { LABORATORY_DETAILS_PATH } from './laboratory-details.js'
import {
  laboratoryDetailsGetController,
  laboratoryDetailsPostController
} from './laboratory-details-controller.js'
import { registerLabDiagnosticTestsStore } from './lab-diagnostic-tests.js'

/**
 * Sets up the protected diagnostic tests screens: /diagnostic-tests/laboratory-details,
 * where a lab gives its address and UKAS accreditation number, then
 * /diagnostic-tests, where it defines the qualifying tests it uses and their
 * accreditation, and the confirmation shown once both are submitted. Reached
 * from Submission Welcome. The default session strategy applies, so it
 * needs a signed-in user; it is not a report journey, so no report role is
 * required.
 */
export const diagnosticTests = {
  plugin: {
    name: 'diagnostic-tests',
    register(server) {
      registerLabDiagnosticTestsStore(server)

      server.route([
        {
          method: 'GET',
          path: LABORATORY_DETAILS_PATH,
          ...laboratoryDetailsGetController
        },
        {
          method: 'POST',
          path: LABORATORY_DETAILS_PATH,
          ...laboratoryDetailsPostController
        },
        {
          method: 'GET',
          path: DIAGNOSTIC_TESTS_PATH,
          ...diagnosticTestsGetController
        },
        {
          method: 'POST',
          path: DIAGNOSTIC_TESTS_PATH,
          ...diagnosticTestsPostController
        },
        {
          method: 'GET',
          path: DIAGNOSTIC_TESTS_CONFIRMATION_PATH,
          ...diagnosticTestsConfirmationGetController
        }
      ])
    }
  }
}
