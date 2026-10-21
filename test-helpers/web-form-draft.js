// Import order matters here. The engine's modules form a cycle through its
// component barrel, so report-entries.js, which pulls the components in
// first, has to be evaluated before the engine's helpers.
import { ENTRIES_KEY } from '#/server/forms/controllers/report-entries.js'
import { getCacheService } from '@defra/forms-engine-plugin/engine/helpers.js'

import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { buildEntry, buildState } from './web-form-model.js'

export const WEB_FORM_SLUG = reportTypesBySlug.get(
  'animal-health-regulations'
).webFormSlug

/**
 * A request for the web form journey by the given user, as the engine's
 * cache service keys it; the session id does not matter to a draft
 * @param {object} user - the session user
 */
export function draftRequest(user) {
  return {
    params: { slug: WEB_FORM_SLUG },
    yar: { id: 'draft-seed' },
    auth: { credentials: { user } }
  }
}

/**
 * Saves a web form draft for the user on a running server, the way the
 * journey's pages do
 * @param {import('@hapi/hapi').Server} server
 * @param {object} user - the session user
 * @param {object} [state] - the form state, by default a report with one entry
 */
export function saveWebFormDraft(
  server,
  user,
  state = buildState([buildEntry()])
) {
  return getCacheService(server).setState(draftRequest(user), state)
}

/**
 * The user's web form draft on a running server, or null
 * @param {import('@hapi/hapi').Server} server
 * @param {object} user - the session user
 */
export function readWebFormDraft(server, user) {
  return getCacheService(server).getDraft(draftRequest(user), WEB_FORM_SLUG)
}

/**
 * Drops the user's web form draft on a running server
 * @param {import('@hapi/hapi').Server} server
 * @param {object} user - the session user
 */
export function dropWebFormDraft(server, user) {
  return getCacheService(server).dropDraft(draftRequest(user), WEB_FORM_SLUG)
}

export { ENTRIES_KEY }
