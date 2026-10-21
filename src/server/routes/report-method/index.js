import {
  reportMethodGetController,
  reportMethodPostController,
  startNewWebFormGetController,
  startNewWebFormPostController
} from './controller.js'

/**
 * Sets up the protected /{slug}/how-to-report screen, shown after a report
 * type that can be submitted either as a file or as a web form is chosen on
 * Submission Welcome, and /{slug}/how-to-report/start-new, where a user with
 * a saved web form report confirms starting a new one.
 *
 * The forms-engine serves the journeys at /{slug}/{path}; hapi prefers the
 * literal `how-to-report` segment over that parameter, so these routes win
 * for their own paths and every other journey page is left to the engine.
 * Because the routes carry the same `slug` parameter, restrictReportJourneys
 * and the breadcrumbs treat them as part of the report type's journey.
 */
export const reportMethod = {
  plugin: {
    name: 'report-method',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/{slug}/how-to-report',
          ...reportMethodGetController
        },
        {
          method: 'POST',
          path: '/{slug}/how-to-report',
          ...reportMethodPostController
        },
        {
          method: 'GET',
          path: '/{slug}/how-to-report/start-new',
          ...startNewWebFormGetController
        },
        {
          method: 'POST',
          path: '/{slug}/how-to-report/start-new',
          ...startNewWebFormPostController
        }
      ])
    }
  }
}
