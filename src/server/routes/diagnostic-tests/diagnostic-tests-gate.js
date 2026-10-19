import { POST_SIGN_IN_PATH } from '#/server/auth/auth-constants.js'
import { canUpdateDiagnosticTests } from '#/server/auth/report-access.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { getLabDiagnosticTests } from './lab-diagnostic-tests.js'

/**
 * A lab's first step is to define the diagnostic tests it uses: until it
 * has, its Animal Health Regulations reports cannot be submitted, since the
 * qualifying tests belong to that report. Other report types are not held
 * back, so a lab that also reports Bat rabies carries on doing so.
 */

const HELD_BACK_REPORT_TYPE_CODE = 'AHR'

/**
 * The user can define the diagnostic tests but their lab has not yet.
 * @param {import('@hapi/hapi').Request} request
 */
export async function isAwaitingDiagnosticTests(request) {
  if (!canUpdateDiagnosticTests(request.auth?.credentials?.user)) {
    return false
  }

  return (await getLabDiagnosticTests(request)) === null
}

/**
 * Whether the report type cannot be submitted yet because the lab has not
 * defined its diagnostic tests.
 * @param {import('@hapi/hapi').Request} request
 * @param {{ code: string }} [reportType] - an entry of the report type registry
 */
export async function isHeldBackForDiagnosticTests(request, reportType) {
  return (
    reportType?.code === HELD_BACK_REPORT_TYPE_CODE &&
    isAwaitingDiagnosticTests(request)
  )
}

/**
 * onPostAuth extension, after restrictReportJourneys: a held-back report
 * journey opened directly (/{slug}, /{slug}/{path}, /{slug}/how-to-report
 * and the engine's preview routes) sends the user to Submission Welcome,
 * whose banner says why. Requests without a session are left to the cookie
 * strategy, and the lab's tests are only looked up for such a journey.
 */
export async function requireDiagnosticTestsFirst(request, h) {
  const reportType = reportTypesBySlug.get(request.params?.slug)

  if (
    reportType?.code !== HELD_BACK_REPORT_TYPE_CODE ||
    !request.auth.isAuthenticated ||
    !(await isHeldBackForDiagnosticTests(request, reportType))
  ) {
    return h.continue
  }

  request.logger?.info?.(
    {
      userId: request.auth.credentials?.user?.id,
      reportType: reportType.code
    },
    'User opened a report journey before defining their diagnostic tests'
  )

  return h.redirect(POST_SIGN_IN_PATH).takeover()
}
