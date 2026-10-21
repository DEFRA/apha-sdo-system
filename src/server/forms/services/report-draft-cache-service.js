/**
 * Where a web-form report in progress is kept.
 *
 * The forms engine keeps a form's answers in the session cache under the
 * browser's session id (see CacheService.Key in @defra/forms-engine-plugin),
 * which signing out or in resets, so a report part-way through was lost the
 * moment the user signed out. The engine lets a service supply its own
 * CacheService in place of a cache name, overriding how state is keyed and
 * stored; this is that service. It follows the pattern of DEFRA's grants-ui,
 * which keys form state by business and grant rather than by session.
 *
 * Only the Animal Health Regulations web form is kept this way: its state
 * is keyed by the signed-in person at their laboratory and the journey, so
 * it is theirs across sessions until the report is submitted, abandoned, or
 * left for longer than `formsEngine.draftTtl`. Every save refreshes that
 * time, so a report being worked on never expires. The upload journeys,
 * whose file lives in the uploader's staging bucket for only so long, keep
 * the engine's own per-session state.
 *
 * Submission Welcome and "How would you like to report" are outside the
 * journey, so they read and discard the draft through the helpers at the
 * end of this module rather than through the engine.
 */

// Import order matters here. The engine's modules form a cycle through its
// component barrel, so report-entries.js, which pulls the components in
// first, has to be evaluated before the engine's helpers.
import {
  ENTRIES_PAGE_CONTROLLER,
  ENTRY_PAGE_CONTROLLER,
  entriesOf
} from '../controllers/report-entries.js'
import { CacheService } from '@defra/forms-engine-plugin/cache-service.js'
import { getCacheService } from '@defra/forms-engine-plugin/engine/helpers.js'

import { config } from '#/config/config.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { definition as webFormDefinition } from '../definitions/animal-health-regulations-web-form.js'
import { reportTypesBySlug } from '../report-types.js'
import {
  reportDateFromState,
  reportMonthYearLabel
} from '../validation/report-file-name.js'

// The engine's own cache keys use this segment name; its catbox policy
// decides the real segment, so this only has to be consistent
const KEY_SEGMENT = 'cache'
const DRAFT_KEY_PREFIX = 'draft'

// When the draft was last saved, kept in state beside the engine's own
// `$$__referenceNumber`. Neither reaches submission.json: the output service
// reads the summary's answers, not state.
export const SAVED_AT_KEY = '$$__savedAt'

/**
 * Whether a journey slug is a report type's web form journey
 * @param {string} [slug] - the `slug` route parameter
 */
export function isWebFormSlug(slug) {
  return Boolean(slug) && reportTypesBySlug.get(slug)?.webFormSlug === slug
}

/**
 * The signed-in person at their laboratory, or undefined when the request
 * has no such user: the draft is theirs, and nobody else's.
 * @param {{ auth?: { credentials?: { user?: object } } }} request - the hapi request
 */
export function draftOwnerOf(request) {
  const user = request.auth?.credentials?.user
  const userId = user?.id
  const organisationId = user?.organisationId

  if (!isNonEmptyString(userId) || !isNonEmptyString(organisationId)) {
    return undefined
  }

  return { userId, organisationId }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * The cache key id of a draft: who it belongs to and which journey it is
 * for, in the shape of the engine's own keys (`{yarId}:{state}:{slug}:`)
 * with the owner in place of the session.
 * @param {{ userId: string, organisationId: string }} owner - the draft's owner
 * @param {string} slug - the web form journey slug
 * @param {{ state?: string, additionalIdentifier?: string }} [options] - the
 *   engine's preview state (empty for a live form) and key suffix
 */
export function draftKeyId(owner, slug, options = {}) {
  const { state = '', additionalIdentifier = '' } = options

  return `${DRAFT_KEY_PREFIX}:${owner.organisationId}:${owner.userId}:${state}:${slug}:${additionalIdentifier}`
}

function draftKey(owner, slug, options) {
  return { segment: KEY_SEGMENT, id: draftKeyId(owner, slug, options) }
}

export class ReportDraftCacheService extends CacheService {
  /**
   * Whether the request is for a web form journey by a user who can own a
   * draft. Anything else, the upload journeys included, is keyed by
   * session as the engine does itself.
   * @param {object} request - the hapi request
   */
  isDraftRequest(request) {
    return isWebFormSlug(request.params?.slug) && Boolean(draftOwnerOf(request))
  }

  /**
   * The engine's key for the request's form state. A web form journey's
   * state is keyed by its owner rather than the session. Named as the
   * engine names the method it overrides (Sonar's naming rule is excluded
   * for this file in sonar-project.properties for that reason).
   * @param {object} request - the hapi request
   * @param {string} [additionalIdentifier] - appended to the id, as the engine does for its confirmation state
   */
  Key(request, additionalIdentifier) {
    if (!this.isDraftRequest(request)) {
      return super.Key(request, additionalIdentifier)
    }

    return draftKey(draftOwnerOf(request), request.params.slug, {
      state: request.params.state ?? '',
      additionalIdentifier: additionalIdentifier ?? ''
    })
  }

  /**
   * Saves the form state. A draft is kept for `formsEngine.draftTtl` from
   * this save, and records when it was saved.
   * @param {object} request - the hapi request
   * @param {object} state - the form state
   */
  async setState(request, state) {
    if (!this.isDraftRequest(request)) {
      return super.setState(request, state)
    }

    const saved = { ...state, [SAVED_AT_KEY]: new Date().toISOString() }

    await this.cache.set(
      this.Key(request),
      saved,
      config.get('formsEngine.draftTtl')
    )

    return this.getState(request)
  }

  /**
   * The signed-in user's draft of a web form journey, read from outside the
   * journey, or null when there is none.
   * @param {object} request - the hapi request
   * @param {string} slug - the web form journey slug
   */
  async getDraft(request, slug) {
    const owner = draftOwnerOf(request)

    if (!owner || !isWebFormSlug(slug)) {
      return null
    }

    return (await this.cache.get(draftKey(owner, slug))) ?? null
  }

  /**
   * Drops the signed-in user's draft of a web form journey
   * @param {object} request - the hapi request
   * @param {string} slug - the web form journey slug
   */
  async dropDraft(request, slug) {
    const owner = draftOwnerOf(request)

    if (!owner || !isWebFormSlug(slug)) {
      return
    }

    await this.cache.drop(draftKey(owner, slug))
  }
}

/**
 * The engine's cache service when it is this one; undefined otherwise, as
 * on a server registered with a plain cache name.
 * @param {{ server?: object }} request - the hapi request
 */
function draftCacheServiceOf(request) {
  const cacheService = request.server?.plugins?.['forms-engine-plugin']
    ? getCacheService(request.server)
    : undefined

  return cacheService instanceof ReportDraftCacheService
    ? cacheService
    : undefined
}

/**
 * Whether a draft has got anywhere: a report date, or an entry. The engine
 * writes a reference number into state on the first page view, which alone
 * is not a report started.
 * @param {object} [state] - the draft's form state
 */
export function isStartedDraft(state) {
  return Boolean(state) && (hasReportDate(state) || entriesOf(state).length > 0)
}

function hasReportDate(state) {
  return reportMonthYearLabel(reportDateFromState(state)) !== undefined
}

/**
 * The signed-in user's started draft of a report type's web form, or null:
 * when the report type has no web form, the server keeps no drafts, or the
 * draft has nothing in it yet.
 * @param {object} request - the hapi request
 * @param {{ webFormSlug?: string }} [reportType] - an entry of the report type registry
 */
export async function getWebFormDraft(request, reportType) {
  const cacheService = draftCacheServiceOf(request)

  if (!cacheService || !reportType?.webFormSlug) {
    return null
  }

  const state = await cacheService.getDraft(request, reportType.webFormSlug)

  return isStartedDraft(state) ? state : null
}

/**
 * Drops the signed-in user's draft of a report type's web form, so the next
 * visit to the journey starts afresh.
 * @param {object} request - the hapi request
 * @param {{ webFormSlug?: string }} [reportType] - an entry of the report type registry
 */
export async function discardWebFormDraft(request, reportType) {
  const cacheService = draftCacheServiceOf(request)

  if (!cacheService || !reportType?.webFormSlug) {
    return
  }

  await cacheService.dropDraft(request, reportType.webFormSlug)
}

/**
 * What to tell the user about a draft: the month it is for, how many entries
 * it has, and when it was last saved (an ISO date-time), each null when not
 * known.
 * @param {object} [state] - the draft's form state
 */
export function draftSummary(state) {
  const savedAt = state?.[SAVED_AT_KEY]

  return {
    reportMonthYear: reportMonthYearLabel(reportDateFromState(state)) ?? null,
    entries: entriesOf(state).length,
    savedAt: isNonEmptyString(savedAt) ? savedAt : null
  }
}

// "21 October 2026": the day is enough, the time of day is not shown
const SAVED_AT_FORMAT = 'd MMMM yyyy'

/**
 * The draft described to the user in a sentence or two: "It covers August
 * 2026 and has 2 entries. It was last saved on 21 October 2026." Each part
 * is left out when it is not known.
 * @param {object} [state] - the draft's form state
 */
export function describeWebFormDraft(state) {
  const { reportMonthYear, entries, savedAt } = draftSummary(state)
  const facts = [
    reportMonthYear && `covers ${reportMonthYear}`,
    `has ${entries} ${entries === 1 ? 'entry' : 'entries'}`
  ].filter(Boolean)

  const sentences = [`It ${facts.join(' and ')}.`]

  if (savedAt) {
    sentences.push(
      `It was last saved on ${formatDate(savedAt, SAVED_AT_FORMAT)}.`
    )
  }

  return sentences.join(' ')
}

// The web form's pages a draft resumes at: the report entries page when
// there are entries, otherwise the first entry page, which starts an entry
const ENTRIES_PAGE_PATH = webFormDefinition.pages.find(
  (page) => page.controller === ENTRIES_PAGE_CONTROLLER
)?.path
const FIRST_ENTRY_PAGE_PATH = webFormDefinition.pages.find(
  (page) => page.controller === ENTRY_PAGE_CONTROLLER
)?.path

/**
 * Where a draft picks up: the report entries page when an entry has been
 * added (an incomplete one is listed there to be completed or removed), the
 * first entry page once the report date is answered, and otherwise the start
 * of the journey.
 * @param {{ webFormSlug: string }} reportType - an entry of the report type registry
 * @param {object} [state] - the draft's form state
 */
export function webFormResumePath(reportType, state) {
  const base = `/${reportType.webFormSlug}`

  if (entriesOf(state).length && ENTRIES_PAGE_PATH) {
    return `${base}${ENTRIES_PAGE_PATH}`
  }

  if (hasReportDate(state) && FIRST_ENTRY_PAGE_PATH) {
    return `${base}${FIRST_ENTRY_PAGE_PATH}`
  }

  return base
}
