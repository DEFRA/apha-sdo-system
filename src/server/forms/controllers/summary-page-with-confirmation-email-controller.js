import { SummaryPageController } from '@defra/forms-engine-plugin/controllers/SummaryPageController.js'

// Standard designer page type the plugin doesn't ship a controller for.
// Behaves as a plain summary page; no confirmation email is sent yet.
export class SummaryPageWithConfirmationEmailController extends SummaryPageController {}
