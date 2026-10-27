import { initAll } from '@defra/forms-engine-plugin/shared.js'
import { Accordion, Tabs, createAll } from 'govuk-frontend'

// Initialises GOV.UK Frontend components plus the forms-engine-plugin
// client-side behaviour (autocomplete, file upload, etc.)
initAll()

// The engine initialises the components its own pages use, which does not
// include the accordion of the diagnostic tests page or the tabs of the
// previous submissions page
createAll(Accordion)
createAll(Tabs)
