import { config } from '#/config/config.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import {
  ReportDraftCacheService,
  SAVED_AT_KEY,
  describeWebFormDraft,
  discardWebFormDraft,
  draftKeyId,
  draftOwnerOf,
  draftSummary,
  getWebFormDraft,
  isStartedDraft,
  isWebFormSlug,
  webFormResumePath
} from '#/server/forms/services/report-draft-cache-service.js'
import {
  ENTRIES_PATH,
  ENTRY_PATHS,
  buildEntry,
  buildState
} from '#/test-helpers/web-form-model.js'

const ahr = reportTypesBySlug.get('animal-health-regulations')
const WEB_FORM_SLUG = ahr.webFormSlug
const UPLOAD_SLUG = ahr.slug

const OWNER = { userId: 'user-1', organisationId: 'TestLab1' }
const SAVED_AT = '2026-10-21T13:51:00.000Z'

function buildUser(overrides = {}) {
  return {
    id: OWNER.userId,
    organisationId: OWNER.organisationId,
    journeys: ['AHR'],
    ...overrides
  }
}

function buildRequest({
  slug,
  state,
  user = buildUser(),
  yarId = 'yar-1'
} = {}) {
  return {
    params: { slug, state },
    yar: { id: yarId, flash: vi.fn().mockReturnValue([]) },
    auth: user ? { credentials: { user } } : undefined
  }
}

/**
 * A server whose cache remembers what it is given, like catbox memory
 */
function buildServer() {
  const store = new Map()
  const policy = {
    get: vi.fn(async (key) => store.get(key.id) ?? null),
    set: vi.fn(async (key, value) => {
      store.set(key.id, value)
    }),
    drop: vi.fn(async (key) => {
      store.delete(key.id)
    })
  }
  const server = {
    cache: vi.fn().mockReturnValue(policy),
    logger: { info: vi.fn(), warn: vi.fn() },
    log: vi.fn(),
    plugins: {}
  }

  return { server, policy, store }
}

function buildService() {
  const { server, policy, store } = buildServer()
  const service = new ReportDraftCacheService({ server, cacheName: 'session' })

  server.plugins['forms-engine-plugin'] = { cacheService: service }

  return { service, server, policy, store }
}

describe('report draft cache service', () => {
  describe('isWebFormSlug', () => {
    test('Should know the web form journey from the upload journey', () => {
      expect(isWebFormSlug(WEB_FORM_SLUG)).toBe(true)
      expect(isWebFormSlug(UPLOAD_SLUG)).toBe(false)
      expect(isWebFormSlug('bat-rabies')).toBe(false)
      expect(isWebFormSlug(undefined)).toBe(false)
      expect(isWebFormSlug('not-a-journey')).toBe(false)
    })
  })

  describe('draftOwnerOf', () => {
    test('Should be the signed-in person at their laboratory', () => {
      expect(draftOwnerOf(buildRequest())).toEqual(OWNER)
    })

    test('Should be nobody without a user, a user id or a laboratory', () => {
      expect(draftOwnerOf(buildRequest({ user: null }))).toBeUndefined()
      expect(
        draftOwnerOf(buildRequest({ user: buildUser({ id: '' }) }))
      ).toBeUndefined()
      expect(
        draftOwnerOf(
          buildRequest({ user: buildUser({ organisationId: null }) })
        )
      ).toBeUndefined()
      expect(draftOwnerOf({})).toBeUndefined()
    })
  })

  describe('draftKeyId', () => {
    test('Should name the laboratory, the person and the journey, in the shape of the engine keys', () => {
      expect(draftKeyId(OWNER, WEB_FORM_SLUG)).toBe(
        `draft:TestLab1:user-1::${WEB_FORM_SLUG}:`
      )
      expect(
        draftKeyId(OWNER, WEB_FORM_SLUG, {
          state: 'preview',
          additionalIdentifier: ':confirmation'
        })
      ).toBe(`draft:TestLab1:user-1:preview:${WEB_FORM_SLUG}::confirmation`)
    })
  })

  describe('#Key', () => {
    test('Should key the web form by its owner, not the session', () => {
      const { service } = buildService()

      expect(service.Key(buildRequest({ slug: WEB_FORM_SLUG }))).toEqual({
        segment: 'cache',
        id: `draft:TestLab1:user-1::${WEB_FORM_SLUG}:`
      })
      // Whichever browser session the owner is in
      expect(
        service.Key(buildRequest({ slug: WEB_FORM_SLUG, yarId: 'yar-2' }))
      ).toEqual(service.Key(buildRequest({ slug: WEB_FORM_SLUG })))
    })

    test("Should append the engine's confirmation suffix to the owner's key", () => {
      const { service } = buildService()

      expect(
        service.Key(buildRequest({ slug: WEB_FORM_SLUG }), ':confirmation').id
      ).toBe(`draft:TestLab1:user-1::${WEB_FORM_SLUG}::confirmation`)
    })

    test('Should keep the preview state apart from the live form', () => {
      const { service } = buildService()

      expect(
        service.Key(buildRequest({ slug: WEB_FORM_SLUG, state: 'preview' })).id
      ).toBe(`draft:TestLab1:user-1:preview:${WEB_FORM_SLUG}:`)
    })

    test('Should key an upload journey by the session, as the engine does', () => {
      const { service } = buildService()

      expect(service.Key(buildRequest({ slug: UPLOAD_SLUG }))).toEqual({
        segment: 'cache',
        id: `yar-1::${UPLOAD_SLUG}:`
      })
    })

    test('Should key the web form by the session when nobody owns it', () => {
      const { service } = buildService()

      expect(
        service.Key(buildRequest({ slug: WEB_FORM_SLUG, user: null }))
      ).toEqual({ segment: 'cache', id: `yar-1::${WEB_FORM_SLUG}:` })
    })

    test('Should keep two people at the same laboratory apart', () => {
      const { service } = buildService()
      const colleague = buildUser({ id: 'user-2' })

      expect(
        service.Key(buildRequest({ slug: WEB_FORM_SLUG, user: colleague })).id
      ).not.toBe(service.Key(buildRequest({ slug: WEB_FORM_SLUG })).id)
    })
  })

  describe('#setState', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(SAVED_AT))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('Should keep a draft for the draft time, recording when it was saved', async () => {
      const { service, policy } = buildService()
      const request = buildRequest({ slug: WEB_FORM_SLUG })
      const state = buildState([buildEntry()])

      const saved = await service.setState(request, state)

      expect(policy.set).toHaveBeenCalledWith(
        service.Key(request),
        { ...state, [SAVED_AT_KEY]: SAVED_AT },
        config.get('formsEngine.draftTtl')
      )
      expect(saved).toEqual({ ...state, [SAVED_AT_KEY]: SAVED_AT })
      // The state given is not changed
      expect(state).not.toHaveProperty(SAVED_AT_KEY)
    })

    test("Should leave an upload journey's state to the engine", async () => {
      const { service, policy } = buildService()
      const request = buildRequest({ slug: UPLOAD_SLUG })
      const state = { reportDate__month: 8, reportDate__year: 2026 }

      const saved = await service.setState(request, state)

      expect(policy.set).toHaveBeenCalledWith(
        service.Key(request),
        state,
        expect.any(Number)
      )
      expect(policy.set.mock.calls[0][2]).not.toBe(
        config.get('formsEngine.draftTtl')
      )
      expect(saved).toEqual(state)
    })
  })

  describe('#getDraft and #dropDraft', () => {
    test('Should read and drop the owner’s draft from outside the journey', async () => {
      const { service } = buildService()
      const inJourney = buildRequest({ slug: WEB_FORM_SLUG })
      const outside = buildRequest()
      const state = buildState([buildEntry()])

      await service.setState(inJourney, state)

      await expect(service.getDraft(outside, WEB_FORM_SLUG)).resolves.toEqual(
        expect.objectContaining(state)
      )

      await service.dropDraft(outside, WEB_FORM_SLUG)

      await expect(service.getDraft(outside, WEB_FORM_SLUG)).resolves.toBeNull()
      await expect(service.getState(inJourney)).resolves.toEqual({})
    })

    test('Should find nothing for an upload journey or for nobody', async () => {
      const { service, policy } = buildService()

      await expect(
        service.getDraft(buildRequest(), UPLOAD_SLUG)
      ).resolves.toBeNull()
      await expect(
        service.getDraft(buildRequest({ user: null }), WEB_FORM_SLUG)
      ).resolves.toBeNull()
      await service.dropDraft(buildRequest({ user: null }), WEB_FORM_SLUG)

      expect(policy.get).not.toHaveBeenCalled()
      expect(policy.drop).not.toHaveBeenCalled()
    })
  })

  describe('isStartedDraft', () => {
    test('Should count a report date or an entry as started', () => {
      expect(isStartedDraft(buildState([]))).toBe(true)
      expect(
        isStartedDraft({
          $$__referenceNumber: 'REF-1',
          entries: [buildEntry()]
        })
      ).toBe(true)
    })

    test('Should not count a reference number alone, or nothing', () => {
      expect(isStartedDraft({ $$__referenceNumber: 'REF-1' })).toBe(false)
      expect(
        isStartedDraft({ reportDate__month: 13, reportDate__year: 2026 })
      ).toBe(false)
      expect(isStartedDraft({})).toBe(false)
      expect(isStartedDraft(null)).toBe(false)
      expect(isStartedDraft(undefined)).toBe(false)
    })
  })

  describe('getWebFormDraft and discardWebFormDraft', () => {
    test('Should read a started draft through the engine’s cache service', async () => {
      const { service, server } = buildService()
      const state = buildState([buildEntry()])

      await service.setState(buildRequest({ slug: WEB_FORM_SLUG }), state)

      const request = { ...buildRequest(), server }

      await expect(getWebFormDraft(request, ahr)).resolves.toEqual(
        expect.objectContaining(state)
      )

      await discardWebFormDraft(request, ahr)

      await expect(getWebFormDraft(request, ahr)).resolves.toBeNull()
    })

    test('Should not count a draft with nothing in it yet', async () => {
      const { service, server } = buildService()

      await service.setState(buildRequest({ slug: WEB_FORM_SLUG }), {
        $$__referenceNumber: 'REF-1'
      })

      await expect(
        getWebFormDraft({ ...buildRequest(), server }, ahr)
      ).resolves.toBeNull()
    })

    test('Should find nothing for a report type without a web form', async () => {
      const { server } = buildService()

      await expect(
        getWebFormDraft(
          { ...buildRequest(), server },
          reportTypesBySlug.get('bat-rabies')
        )
      ).resolves.toBeNull()
    })

    test("Should find nothing on a server that keeps the engine's own cache", async () => {
      const { server } = buildServer()

      server.plugins['forms-engine-plugin'] = { cacheService: {} }

      await expect(
        getWebFormDraft({ ...buildRequest(), server }, ahr)
      ).resolves.toBeNull()
      await expect(
        discardWebFormDraft({ ...buildRequest(), server }, ahr)
      ).resolves.toBeUndefined()
      await expect(getWebFormDraft(buildRequest(), ahr)).resolves.toBeNull()
    })
  })

  describe('draftSummary and describeWebFormDraft', () => {
    test('Should sum up the month, the entries and when it was saved', () => {
      const state = { ...buildState([buildEntry()]), [SAVED_AT_KEY]: SAVED_AT }

      expect(draftSummary(state)).toEqual({
        reportMonthYear: 'August 2026',
        entries: 1,
        savedAt: SAVED_AT
      })
      expect(describeWebFormDraft(state)).toBe(
        'It covers August 2026 and has 1 entry. It was last saved on 21 October 2026.'
      )
    })

    test('Should leave out what is not known', () => {
      expect(draftSummary({})).toEqual({
        reportMonthYear: null,
        entries: 0,
        savedAt: null
      })
      expect(
        describeWebFormDraft({ entries: [buildEntry(), buildEntry()] })
      ).toBe('It has 2 entries.')
      expect(describeWebFormDraft(buildState([]))).toBe(
        'It covers August 2026 and has 0 entries.'
      )
    })
  })

  describe('webFormResumePath', () => {
    test('Should pick up at the report entries page once there are entries', () => {
      expect(webFormResumePath(ahr, buildState([buildEntry()]))).toBe(
        `/${WEB_FORM_SLUG}${ENTRIES_PATH}`
      )
    })

    test('Should pick up at the first entry page once the report date is answered', () => {
      expect(webFormResumePath(ahr, buildState([]))).toBe(
        `/${WEB_FORM_SLUG}${ENTRY_PATHS.pathogen}`
      )
    })

    test('Should start from the beginning otherwise', () => {
      expect(webFormResumePath(ahr, { $$__referenceNumber: 'REF-1' })).toBe(
        `/${WEB_FORM_SLUG}`
      )
      expect(webFormResumePath(ahr, undefined)).toBe(`/${WEB_FORM_SLUG}`)
    })
  })
})
