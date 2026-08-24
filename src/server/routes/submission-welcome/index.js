import {
  submissionWelcomeGetController,
  submissionWelcomePostController
} from './controller.js'

/**
 * Sets up the protected /submission-welcome screen, shown after internal
 * users authenticate and before the form journey.
 */
export const submissionWelcome = {
  plugin: {
    name: 'submission-welcome',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/submission-welcome',
          ...submissionWelcomeGetController
        },
        {
          method: 'POST',
          path: '/submission-welcome',
          ...submissionWelcomePostController
        }
      ])
    }
  }
}
