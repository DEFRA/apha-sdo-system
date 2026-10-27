import {
  PREVIOUS_SUBMISSIONS_PATH,
  previousSubmissionsGetController
} from './controller.js'
import { registerSubmissionHistoryStore } from './submission-history.js'

/**
 * Sets up the protected /previous-submissions screen, reached from
 * Submission Welcome, and the store the output service records each
 * submitted report in. The default session strategy applies, so it needs a
 * signed-in user; it is not a report journey, so no report role is required.
 */
export const previousSubmissions = {
  plugin: {
    name: 'previous-submissions',
    register(server) {
      registerSubmissionHistoryStore(server)

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
