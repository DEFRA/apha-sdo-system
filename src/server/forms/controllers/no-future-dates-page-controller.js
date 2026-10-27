// Import order matters here. The engine's page controllers form a cycle
// through its component barrel, so QuestionPageController.js throws unless a
// module that pulls the components in first has already been evaluated — the
// engine's component helpers, imported for that alone.
import '@defra/forms-engine-plugin/engine/components/helpers/components.js'
import { QuestionPageController } from '@defra/forms-engine-plugin/controllers/QuestionPageController.js'

import { rejectFutureDates } from '../validation/no-future-dates.js'

/**
 * A question page that refuses a date in the future in any of its date
 * fields (see no-future-dates.js). Every page that asks for a date must use
 * this controller or one built on it; its test checks every form for that.
 */
export class NoFutureDatesPageController extends QuestionPageController {
  constructor(model, pageDef) {
    super(model, pageDef)

    this.collection.formSchema = rejectFutureDates(
      this.collection.formSchema,
      this.collection.fields
    )
  }
}
