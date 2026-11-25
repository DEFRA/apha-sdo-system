import {
  PREVIOUS_SUBMISSIONS_PATH,
  previousSubmissionsGetController
} from './controller.js'
import { registerPendingSubmissions } from './pending-submissions.js'

/**
 * Sets up the protected /previous-submissions screen, reached from
 * Submission Welcome, and the cache the reports just submitted are kept in
 * until the API returns them. The default session strategy applies, so it
 * needs a signed-in user; it is not a report journey, so no report role is
 * required.
 */
export const previousSubmissions = {
  plugin: {
    name: 'previous-submissions',
    register(server) {
      registerPendingSubmissions(server)

      server.route([
        {
          method: 'GET',
          path: PREVIOUS_SUBMISSIONS_PATH,
          ...previousSubmissionsGetController
        }
      ])
    }
  }
}
