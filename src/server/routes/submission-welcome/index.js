import {
  submissionWelcomeGetController,
  submissionWelcomePostController
} from './controller.js'

/**
 * Sets up the routes for the /submission-welcome screen, shown after the
 * mock Defra ID sign-in and before the form journey.
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
