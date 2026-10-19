import {
  DIAGNOSTIC_TESTS_CONFIRMATION_PATH,
  DIAGNOSTIC_TESTS_PATH,
  diagnosticTestsConfirmationGetController,
  diagnosticTestsGetController,
  diagnosticTestsPostController
} from './controller.js'
import { registerLabDiagnosticTestsStore } from './lab-diagnostic-tests.js'

/**
 * Sets up the protected /diagnostic-tests screen, where a lab defines the
 * qualifying tests it uses and their accreditation, and the confirmation
 * shown once they are submitted. Reached from Submission Welcome. The
 * default session strategy applies, so it needs a signed-in user; it is not
 * a report journey, so no report role is required.
 */
export const diagnosticTests = {
  plugin: {
    name: 'diagnostic-tests',
    register(server) {
      registerLabDiagnosticTestsStore(server)

      server.route([
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
