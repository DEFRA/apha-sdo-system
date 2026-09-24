import {
  DIAGNOSTIC_TESTS_PATH,
  diagnosticTestsGetController,
  diagnosticTestsPostController
} from './controller.js'

/**
 * Sets up the protected /diagnostic-tests screen, where a lab defines the
 * qualifying tests it uses and their accreditation. Reached from Submission
 * Welcome. The default session strategy applies, so it needs a signed-in
 * user; it is not a report journey, so no report role is required.
 */
export const diagnosticTests = {
  plugin: {
    name: 'diagnostic-tests',
    register(server) {
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
        }
      ])
    }
  }
}
