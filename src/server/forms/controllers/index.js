import { SummaryPageWithConfirmationEmailController } from './summary-page-with-confirmation-email-controller.js'
import { NoFutureDatesPageController } from './no-future-dates-page-controller.js'
import { ReportDatePageController } from './report-date-page-controller.js'
import { ReportFileUploadPageController } from './report-file-upload-page-controller.js'
import { ReportEntryPageController } from './report-entry-page-controller.js'
import { ReportEntriesPageController } from './report-entries-page-controller.js'

/**
 * The page controllers the form definitions refer to by name, which the
 * forms-engine-plugin does not ship.
 */
export const controllers = {
  NoFutureDatesPageController,
  ReportDatePageController,
  ReportFileUploadPageController,
  ReportEntryPageController,
  ReportEntriesPageController,
  SummaryPageWithConfirmationEmailController
}
