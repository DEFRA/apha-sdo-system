import { config } from '#/config/config.js'
import {
  pendingSubmissionsOf,
  recordPendingSubmission,
  registerPendingSubmissions
} from './pending-submissions.js'

const ONE_HOUR_MS = 3600000

/**
 * A cache policy that keeps what it is given, as catbox does
 */
function createCache() {
  const values = new Map()

  return {
    values,
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, value) => {
      values.set(key, structuredClone(value))
    })
  }
}

function createRequest(cache = createCache()) {
  return {
    server: { app: { pendingSubmissions: cache } },
    logger: { warn: vi.fn() }
  }
}

function record(overrides = {}) {
  return {
    referenceNumber: 'BR1-AAA-111',
    form: 'bat-rabies',
    processName: 'BR',
    userId: 'user-id',
    userEmail: 'person@example.gov.uk',
    organisationId: 'Test Lab 1',
    organisationName: 'Test Lab 1',
    submittedAt: '2026-11-25T10:00:00.000Z',
    fileName: '2026-10 bat rabies.xlsx',
    reportMonthYear: 'October 2026',
    answers: [],
    ...overrides
  }
}

function setNow(isoTime) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(isoTime))
}

describe('#pendingSubmissions', () => {
  beforeEach(() => {
    setNow('2026-11-25T10:00:30.000Z')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('Should keep them in a segment of the shared cache for the configured time', () => {
    const policy = createCache()
    const server = { app: {}, cache: vi.fn().mockReturnValue(policy) }

    registerPendingSubmissions(server)

    expect(server.cache).toHaveBeenCalledWith({
      cache: config.get('session.cache.name'),
      segment: 'pendingSubmissions',
      expiresIn: ONE_HOUR_MS
    })
    expect(server.app.pendingSubmissions).toBe(policy)
  })

  test("Should keep a delivered report under its lab's name, with what the history shows of it", async () => {
    const request = createRequest()

    await recordPendingSubmission(request, record())

    expect(await pendingSubmissionsOf(request, 'Test Lab 1')).toEqual([
      {
        referenceNumber: 'BR1-AAA-111',
        processName: 'BR',
        reportMonthYear: 'October 2026',
        submittedAt: '2026-11-25T10:00:00.000Z',
        fileName: '2026-10 bat rabies.xlsx'
      }
    ])
    expect(await pendingSubmissionsOf(request, 'Another Lab')).toEqual([])
  })

  test('Should keep a web form report without a file name, and one without a month', async () => {
    const request = createRequest()

    await recordPendingSubmission(
      request,
      record({ fileName: undefined, reportMonthYear: undefined })
    )

    expect(await pendingSubmissionsOf(request, 'Test Lab 1')).toEqual([
      expect.objectContaining({ fileName: null, reportMonthYear: null })
    ])
  })

  test('Should list the newest first, a report recorded again once, and no more than 20', async () => {
    const request = createRequest()

    for (let index = 1; index <= 22; index++) {
      await recordPendingSubmission(
        request,
        record({ referenceNumber: `REF-${index}` })
      )
    }
    await recordPendingSubmission(request, record({ referenceNumber: 'REF-5' }))

    const references = (await pendingSubmissionsOf(request, 'Test Lab 1')).map(
      ({ referenceNumber }) => referenceNumber
    )

    expect(references).toHaveLength(20)
    expect(references.slice(0, 3)).toEqual(['REF-5', 'REF-22', 'REF-21'])
    expect(
      references.filter((reference) => reference === 'REF-5')
    ).toHaveLength(1)
  })

  test('Should forget a report an hour after it was submitted', async () => {
    const request = createRequest()

    await recordPendingSubmission(
      request,
      record({
        referenceNumber: 'OLDER',
        submittedAt: '2026-11-25T09:30:00.000Z'
      })
    )
    await recordPendingSubmission(request, record({ referenceNumber: 'NEWER' }))

    setNow('2026-11-25T10:29:59.000Z')
    expect(
      (await pendingSubmissionsOf(request, 'Test Lab 1')).map(
        ({ referenceNumber }) => referenceNumber
      )
    ).toEqual(['NEWER', 'OLDER'])

    setNow('2026-11-25T10:30:01.000Z')
    expect(
      (await pendingSubmissionsOf(request, 'Test Lab 1')).map(
        ({ referenceNumber }) => referenceNumber
      )
    ).toEqual(['NEWER'])

    setNow('2026-11-25T11:00:01.000Z')
    expect(await pendingSubmissionsOf(request, 'Test Lab 1')).toEqual([])
  })

  test.each([
    ['without a lab', { organisationId: null }],
    ['of no report type', { processName: null }],
    ['of the diagnostic tests', { processName: 'DT' }]
  ])('Should not keep a record %s', async (_case, overrides) => {
    const request = createRequest()

    await recordPendingSubmission(request, record(overrides))

    expect(request.server.app.pendingSubmissions.set).not.toHaveBeenCalled()
  })

  test('Should do nothing without the cache', async () => {
    const request = { logger: { warn: vi.fn() } }

    await recordPendingSubmission(request, record())

    expect(await pendingSubmissionsOf(request, 'Test Lab 1')).toEqual([])
  })

  test('Should read nothing for no lab', async () => {
    const request = createRequest()

    expect(await pendingSubmissionsOf(request, null)).toEqual([])
    expect(request.server.app.pendingSubmissions.get).not.toHaveBeenCalled()
  })

  test('Should leave out what is not a report it kept', async () => {
    const cache = createCache()
    const request = createRequest(cache)

    cache.values.set('Test Lab 1', [
      'not a report',
      null,
      { referenceNumber: 'NO-TYPE', submittedAt: '2026-11-25T10:00:00.000Z' },
      { referenceNumber: 'NO-DATE', processName: 'AHR' },
      { processName: 'BR', submittedAt: '2026-11-25T10:00:00.000Z' },
      {
        referenceNumber: 'KEPT',
        processName: 'AHR',
        submittedAt: '2026-11-25T10:00:00.000Z'
      }
    ])
    cache.values.set('Not A List', { referenceNumber: 'X' })

    expect(
      (await pendingSubmissionsOf(request, 'Test Lab 1')).map(
        ({ referenceNumber }) => referenceNumber
      )
    ).toEqual(['KEPT'])
    expect(await pendingSubmissionsOf(request, 'Not A List')).toEqual([])
  })

  test('Should log, not throw, when the report cannot be kept', async () => {
    const cache = createCache()
    const failure = new Error('Redis unavailable')
    cache.set.mockRejectedValue(failure)
    const request = createRequest(cache)

    await expect(
      recordPendingSubmission(request, record())
    ).resolves.toBeUndefined()
    expect(request.logger.warn).toHaveBeenCalledWith(
      { err: failure, referenceNumber: 'BR1-AAA-111' },
      'Report just submitted could not be kept for the submission history'
    )
  })

  test('Should log and read none when they cannot be read', async () => {
    const cache = createCache()
    const failure = new Error('Redis unavailable')
    cache.get.mockRejectedValue(failure)
    const request = createRequest(cache)

    expect(await pendingSubmissionsOf(request, 'Test Lab 1')).toEqual([])
    expect(request.logger.warn).toHaveBeenCalledWith(
      { err: failure },
      'Reports just submitted could not be read for the submission history'
    )
  })
})
