import {
  reportMethodGetController,
  reportMethodPostController
} from './controller.js'

/**
 * Sets up the protected /{slug}/how-to-report screen, shown after a report
 * type that can be submitted either as a file or as a web form is chosen on
 * Submission Welcome.
 *
 * The forms-engine serves the journeys at /{slug}/{path}; hapi prefers the
 * literal `how-to-report` segment over that parameter, so this route wins for
 * its own path and every other journey page is left to the engine. Because
 * the route carries the same `slug` parameter, restrictReportJourneys and the
 * breadcrumbs treat it as part of the report type's journey.
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
        }
      ])
    }
  }
}
