import { initAll } from '@defra/forms-engine-plugin/shared.js'
import { Accordion, createAll } from 'govuk-frontend'

// Initialises GOV.UK Frontend components plus the forms-engine-plugin
// client-side behaviour (autocomplete, file upload, etc.)
initAll()

// The engine initialises the components its own pages use, which does not
// include the accordion of the diagnostic tests page
createAll(Accordion)
