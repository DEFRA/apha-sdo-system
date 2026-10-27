import {
  howToReportPath,
  reportTypesByCode,
  reportTypesBySlug
} from '#/server/forms/report-types.js'

const HOME = { text: 'Home', href: '/' }
const SUBMISSION_WELCOME_PATH = '/submission-welcome'
const SUBMISSION_WELCOME_TEXT = 'Submission Welcome'

// The diagnostic tests are updated from within the Animal Health Regulations
// report, so they sit under it
const diagnosticTestsReportType = reportTypesByCode.get('AHR')

const DIAGNOSTIC_TESTS_TRAIL = [
  HOME,
  { text: SUBMISSION_WELCOME_TEXT, href: SUBMISSION_WELCOME_PATH },
  {
    text: diagnosticTestsReportType.title,
    href: howToReportPath(diagnosticTestsReportType)
  },
  { text: 'Update diagnostic tests' }
]

// Trails for the service's own pages. The report journeys are derived from the
// report type registry, so they do not need an entry here.
const trailsByPath = new Map([
  [SUBMISSION_WELCOME_PATH, [HOME, { text: SUBMISSION_WELCOME_TEXT }]],
  [
    '/previous-submissions',
    [
      HOME,
      { text: SUBMISSION_WELCOME_TEXT, href: SUBMISSION_WELCOME_PATH },
      { text: 'Previous submissions' }
    ]
  ],
  ['/diagnostic-tests/laboratory-details', DIAGNOSTIC_TESTS_TRAIL],
  ['/diagnostic-tests', DIAGNOSTIC_TESTS_TRAIL],
  // Like a report journey's confirmation, which keeps the journey's trail
  ['/diagnostic-tests/confirmation', DIAGNOSTIC_TESTS_TRAIL]
])

/**
 * Breadcrumbs for the current page, following the GOV.UK pattern: the trail
 * starts at the service home page, and the current page is the final item
 * with no href so it renders as `aria-current="page"` rather than a link.
 *
 * Pages outside the reporting hierarchy (home, sign-in, errors) get no
 * breadcrumbs, and the layout hides any trail shorter than two items.
 */
export function buildBreadcrumbs(request) {
  const requestPath = request?.path

  if (!requestPath) {
    return []
  }

  const trail = trailsByPath.get(requestPath)

  if (trail) {
    return trail
  }

  // Report journey pages are served at /{slug}/{page} by the forms engine.
  const reportType = reportTypesBySlug.get(requestPath.split('/')[1])

  if (reportType) {
    return [
      HOME,
      { text: SUBMISSION_WELCOME_TEXT, href: SUBMISSION_WELCOME_PATH },
      { text: reportType.title }
    ]
  }

  return []
}
