// Import order matters here. The engine's page controllers form a cycle
// through its component barrel, so its models throw unless a module that
// pulls the components in first has already been evaluated — report-entries.js
// does, by way of the engine's component helpers.
import { ENTRIES_KEY } from '#/server/forms/controllers/report-entries.js'
import { FormModel } from '@defra/forms-engine-plugin/engine/models/FormModel.js'

import { ReportEntriesPageController } from '#/server/forms/controllers/report-entries-page-controller.js'
import { ReportEntryPageController } from '#/server/forms/controllers/report-entry-page-controller.js'
import { SummaryPageWithConfirmationEmailController } from '#/server/forms/controllers/summary-page-with-confirmation-email-controller.js'
import {
  definition,
  metadata
} from '#/server/forms/definitions/animal-health-regulations-web-form.js'

export const WEB_FORM_SLUG = metadata.slug

export const ENTRY_PATHS = {
  pathogen: '/which-pathogen-was-tested',
  species: '/which-species-was-tested',
  otherSpecies: '/enter-other-species',
  country: '/which-country-were-the-samples-collected-in',
  numbers: '/number-of-submissions-of-diagnostic-tests'
}

export const ENTRIES_PATH = '/report-entries'
export const REPORT_DATE_PATH = '/what-month-does-your-report-cover'

export const FIRST_ENTRY_ID = '11111111-1111-4111-8111-111111111111'
export const SECOND_ENTRY_ID = '22222222-2222-4222-8222-222222222222'
export const UNKNOWN_ENTRY_ID = '99999999-9999-4999-8999-999999999999'

/**
 * The real form model of the AHR web form, with the service's page
 * controllers, so tests exercise the pages, conditions and lists as served.
 */
export function buildWebFormModel() {
  return new FormModel(definition, { basePath: WEB_FORM_SLUG }, undefined, {
    ReportEntryPageController,
    ReportEntriesPageController,
    SummaryPageWithConfirmationEmailController
  })
}

export function pageOf(model, path) {
  return model.pages.find((page) => page.path === path)
}

/**
 * A complete entry for a species from the list
 */
export function buildEntry(overrides = {}) {
  return {
    itemId: FIRST_ENTRY_ID,
    pathogen: 'Tritrichomonas foetus',
    species: 'Domestic cattle',
    country: 'England',
    submissionsWithQualifyingTest: 12,
    submissionsWithPositiveSamples: 3,
    positiveSamples: 5,
    ...overrides
  }
}

/**
 * A complete entry for a species not on the list
 */
export function buildOtherSpeciesEntry(overrides = {}) {
  return buildEntry({
    itemId: SECOND_ENTRY_ID,
    species: 'Other',
    otherSpecies: 'Alpaca',
    ...overrides
  })
}

export function buildState(entries, overrides = {}) {
  return {
    $$__referenceNumber: 'REF-1',
    reportDate__month: 8,
    reportDate__year: 2026,
    [ENTRIES_KEY]: entries,
    ...overrides
  }
}

/**
 * A request for a page of the form, as the engine's routes build it. The
 * server carries the engine plugin's options, which the pages read to pick
 * the language.
 */
export function buildRequest({
  itemId,
  query = {},
  payload,
  method = payload ? 'post' : 'get'
} = {}) {
  return {
    method,
    params: { slug: WEB_FORM_SLUG, itemId },
    query,
    payload,
    app: {},
    server: { plugins: { 'forms-engine-plugin': {} } },
    url: { pathname: '', search: '' }
  }
}

/**
 * A hapi response toolkit that records redirects and views
 */
export function buildToolkit() {
  const response = {
    code: vi.fn(function (code) {
      this.statusCode = code
      return this
    })
  }

  return {
    redirect: vi.fn((location) => ({ ...response, location })),
    view: vi.fn((name, context) => ({ name, context })),
    continue: Symbol('continue')
  }
}
