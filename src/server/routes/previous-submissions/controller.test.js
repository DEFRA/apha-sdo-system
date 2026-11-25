import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypesByCode } from '#/server/forms/report-types.js'
import {
  NO_REPORTS_ON_PAGE_TEXT,
  NO_SUBMISSIONS_TEXT,
  PREVIOUS_SUBMISSIONS_PATH,
  SUBMISSIONS_UNAVAILABLE_TEXT
} from './controller.js'
import { SUBMISSION_STATUS, getSubmissionPage } from './submission-history.js'

vi.mock(
  '#/server/routes/previous-submissions/submission-history.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    getSubmissionPage: vi.fn()
  })
)

const batRabies = reportTypesByCode.get('BR')
const animalHealthRegulations = reportTypesByCode.get('AHR')

function report(code, overrides = {}) {
  return {
    referenceNumber: `${code}-REF`,
    reportType: reportTypesByCode.get(code),
    reportMonthYear: 'February 2026',
    submittedAt: '2026-03-03T10:15:00.000Z',
    fileName: null,
    status: SUBMISSION_STATUS.ACCEPTED,
    ...overrides
  }
}

const batRabiesUpload = report('BR', {
  referenceNumber: 'BR1-AAA-111',
  fileName: '2026-02 BR.xlsx',
  status: SUBMISSION_STATUS.PROCESSING
})

const animalHealthRegulationsWebForm = report('AHR', {
  referenceNumber: 'AHR-BBB-222',
  submittedAt: '2026-04-02T09:00:00.000Z',
  reportMonthYear: 'March 2026'
})

function pageOf(submissions, paging = {}) {
  return {
    submissions,
    page: 1,
    hasNextPage: false,
    ...paging
  }
}

/**
 * What the store answers for the report types asked for together, by their
 * codes ("BR", "BR,AHR"): a page, or an error it throws. Report types
 * without an answer have no reports.
 */
function answerWith(answersByCodes = {}) {
  getSubmissionPage.mockImplementation(async (_request, reportTypes) => {
    const codes = reportTypes.map(({ code }) => code).join(',')
    const answer = answersByCodes[codes] ?? pageOf([])

    if (answer instanceof Error) {
      throw answer
    }

    return answer
  })
}

/**
 * A signed-in session whose roles grant the given journeys.
 */
function authWithJourneys(journeys) {
  return {
    strategy: 'session',
    credentials: {
      sessionId: 'test-session',
      user: {
        id: 'user-id',
        name: 'A Person',
        organisationId: 'TestLab1',
        journeys
      },
      claims: {}
    }
  }
}

const RESUBMIT_LINK =
  /<a class="govuk-link govuk-link--no-visited-state" href="#">Resubmit<span class="govuk-visually-hidden"> report ([^<]+)<\/span><\/a>/g

function resubmittedReferences(html) {
  return [...html.matchAll(RESUBMIT_LINK)].map(([, reference]) => reference)
}

function paginationOf(html) {
  return html.match(/<nav class="govuk-pagination[\s\S]*?<\/nav>/)?.[0] ?? null
}

function hrefsOf(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) =>
    href.replaceAll('&amp;', '&')
  )
}

// The tab of all reports, named in page links as a report type is by slug
const ALL_SUBMISSIONS = { slug: 'all' }

function pageHref(tab, page) {
  return `/previous-submissions?type=${tab.slug}&page=${page}#${tab.slug}-submissions`
}

describe('previous submissions routes', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    answerWith()
  })

  function getPreviousSubmissions({
    journeys = ['BR', 'AHR'],
    query = ''
  } = {}) {
    return server.inject({
      method: 'GET',
      url: `${PREVIOUS_SUBMISSIONS_PATH}${query}`,
      auth: authWithJourneys(journeys)
    })
  }

  function requestedPages() {
    return getSubmissionPage.mock.calls.map(([, reportTypes, paging]) => [
      reportTypes.map(({ code }) => code).join(','),
      paging
    ])
  }

  test('Should send a signed-out user to sign in', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: PREVIOUS_SUBMISSIONS_PATH
    })

    expect(statusCode).toBe(statusCodes.redirect)
  })

  test('Should say so when the lab has submitted nothing', async () => {
    const { result, statusCode } = await getPreviousSubmissions()

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Previous submissions'))
    expect(result).toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
    expect(result).not.toEqual(expect.stringContaining('govuk-tabs'))
    expect(result).not.toEqual(expect.stringContaining('govuk-table'))
    expect(result).not.toEqual(expect.stringContaining('govuk-pagination'))
  })

  test('Should list the reports of a user who holds one report type in a single table', async () => {
    answerWith({ BR: pageOf([batRabiesUpload]) })

    const { result, statusCode } = await getPreviousSubmissions({
      journeys: ['BR']
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(expect.stringContaining('govuk-tabs'))
    expect(result).toEqual(expect.stringContaining('Bat rabies reports'))
    expect(result).toEqual(expect.stringContaining('govuk-table'))
    expect(result).not.toMatch(/>\s*Type\s*</)

    for (const heading of [
      'Period',
      'Submitted',
      'Method',
      'Reference',
      'Status',
      'Actions'
    ]) {
      expect(result).toMatch(
        new RegExp(`class="govuk-table__header"[^>]*>\\s*${heading}\\s*<`)
      )
    }

    for (const text of [
      'February 2026',
      '03/03/2026',
      '2026-02 BR.xlsx',
      'BR1-AAA-111'
    ]) {
      expect(result).toEqual(expect.stringContaining(text))
    }

    expect(requestedPages()).toEqual([['BR', { page: 1 }]])
  })

  test('Should tag each status, offering to resubmit only those decided', async () => {
    answerWith({
      BR: pageOf([
        report('BR', {
          referenceNumber: 'REF-1',
          status: SUBMISSION_STATUS.PROCESSING
        }),
        report('BR', {
          referenceNumber: 'REF-2',
          status: SUBMISSION_STATUS.ACCEPTED
        }),
        report('BR', {
          referenceNumber: 'REF-3',
          status: SUBMISSION_STATUS.REJECTED
        })
      ])
    })

    const { result } = await getPreviousSubmissions({ journeys: ['BR'] })

    for (const tag of [
      'govuk-tag--blue">Processing',
      'govuk-tag--green">Accepted',
      'govuk-tag--red">Rejected'
    ]) {
      expect(result).toEqual(expect.stringContaining(tag))
    }

    expect(resubmittedReferences(result)).toEqual(['REF-2', 'REF-3'])
  })

  test('Should keep each report on one line, letting only a long file name wrap', async () => {
    answerWith({
      'BR,AHR': pageOf([animalHealthRegulationsWebForm, batRabiesUpload]),
      BR: pageOf([batRabiesUpload]),
      AHR: pageOf([animalHealthRegulationsWebForm])
    })

    const { result } = await getPreviousSubmissions()

    expect(result).toEqual(
      expect.stringContaining('govuk-table app-submissions-table')
    )
    expect(result).toMatch(
      /class="govuk-table__cell app-submissions-table__file-name"[^>]*>\s*2026-02 BR\.xlsx\s*</
    )
    expect(result).not.toMatch(
      /class="govuk-table__cell app-submissions-table__file-name"[^>]*>\s*Web form\s*</
    )
  })

  test('Should offer all reports, then each report type, as tabs to a user who holds both', async () => {
    answerWith({
      'BR,AHR': pageOf([animalHealthRegulationsWebForm, batRabiesUpload]),
      BR: pageOf([batRabiesUpload]),
      AHR: pageOf([animalHealthRegulationsWebForm])
    })

    const { result, statusCode } = await getPreviousSubmissions()

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('govuk-tabs'))

    const tabPositions = [
      'href="#all-submissions"',
      'href="#bat-rabies-submissions"',
      'href="#animal-health-regulations-submissions"'
    ].map((href) => result.indexOf(href))

    expect(tabPositions.every((position) => position >= 0)).toBe(true)
    expect(tabPositions).toEqual([...tabPositions].sort((a, b) => a - b))
    expect(result).toEqual(expect.stringContaining('All submissions'))
    expect(result).toEqual(
      expect.stringContaining('Reportable diseases monthly reports')
    )
    expect(result).toEqual(expect.stringContaining('Web form'))
    expect(requestedPages()).toEqual([
      ['BR,AHR', { page: 1 }],
      ['BR', { page: 1 }],
      ['AHR', { page: 1 }]
    ])
  })

  test('Should name the type of each report only where all are listed, newest first as given', async () => {
    answerWith({
      'BR,AHR': pageOf([animalHealthRegulationsWebForm, batRabiesUpload]),
      BR: pageOf([batRabiesUpload]),
      AHR: pageOf([animalHealthRegulationsWebForm])
    })

    const { result } = await getPreviousSubmissions()
    const allSubmissions = result.slice(
      result.indexOf('id="all-submissions"'),
      result.indexOf('id="bat-rabies-submissions"')
    )

    expect(result.match(/>\s*Type\s*</g)).toHaveLength(1)
    expect(allSubmissions).toMatch(/>\s*Type\s*</)
    expect(allSubmissions).toMatch(
      /class="govuk-table__cell">\s*AHR\s*<[\s\S]*AHR-BBB-222[\s\S]*class="govuk-table__cell">\s*BR\s*<[\s\S]*BR1-AAA-111/
    )
  })

  test('Should say so in the tab of a report type the lab has not submitted', async () => {
    answerWith({
      'BR,AHR': pageOf([batRabiesUpload]),
      BR: pageOf([batRabiesUpload])
    })

    const { result } = await getPreviousSubmissions()

    expect(result).toEqual(expect.stringContaining('govuk-tabs'))
    expect(result).toEqual(
      expect.stringContaining(
        'You have not submitted any Reportable diseases monthly reports yet.'
      )
    )
    expect(result).not.toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
  })

  test('Should only ask for the report types the user holds', async () => {
    const { result } = await getPreviousSubmissions({ journeys: ['BR'] })

    expect(result).toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
    expect(requestedPages()).toEqual([['BR', { page: 1 }]])
  })

  test('Should show nothing, asking nothing, to a user who holds no report type', async () => {
    const { result, statusCode } = await getPreviousSubmissions({
      journeys: []
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
    expect(getSubmissionPage).not.toHaveBeenCalled()
  })

  test("Should escape the user's file name", async () => {
    answerWith({
      BR: pageOf([
        { ...batRabiesUpload, fileName: '2026-02 <script>x</script>.xlsx' }
      ])
    })

    const { result } = await getPreviousSubmissions({ journeys: ['BR'] })

    expect(result).not.toEqual(expect.stringContaining('<script>x</script>'))
    expect(result).toEqual(
      expect.stringContaining('2026-02 &lt;script&gt;x&lt;/script&gt;.xlsx')
    )
  })

  test('Should say when the period or the date submitted is not known', async () => {
    answerWith({
      BR: pageOf([
        { ...batRabiesUpload, reportMonthYear: null, submittedAt: null }
      ])
    })

    const { result } = await getPreviousSubmissions({ journeys: ['BR'] })

    expect(
      result.match(/class="govuk-table__cell">\s*Not known\s*</g)
    ).toHaveLength(2)
  })

  describe('pages', () => {
    test('Should link to the pages either side, each link opening its tab', async () => {
      answerWith({
        BR: pageOf([batRabiesUpload], { page: 3, hasNextPage: true }),
        AHR: pageOf([animalHealthRegulationsWebForm])
      })

      const { result } = await getPreviousSubmissions({
        query: '?type=bat-rabies&page=3'
      })
      const pagination = paginationOf(result)

      expect(pagination).toEqual(
        expect.stringContaining('aria-label="Bat rabies reports pages"')
      )
      expect(hrefsOf(pagination)).toEqual([
        pageHref(batRabies, 2),
        pageHref(batRabies, 4)
      ])
      expect(pagination).toMatch(/rel="prev"/)
      expect(pagination).toMatch(/rel="next"/)
      expect(pagination).not.toEqual(
        expect.stringContaining('govuk-pagination__item')
      )
    })

    test('Should page through all reports together', async () => {
      answerWith({
        'BR,AHR': pageOf([animalHealthRegulationsWebForm, batRabiesUpload], {
          page: 2
        })
      })

      const { result } = await getPreviousSubmissions({
        query: '?type=all&page=2'
      })
      const pagination = paginationOf(result)

      expect(pagination).toEqual(
        expect.stringContaining('aria-label="All submissions pages"')
      )
      expect(hrefsOf(pagination)).toEqual([pageHref(ALL_SUBMISSIONS, 1)])
      expect(pagination).not.toMatch(/rel="next"/)
    })

    test.each([
      [
        '?type=animal-health-regulations&page=3',
        [
          ['BR,AHR', { page: 1 }],
          ['BR', { page: 1 }],
          ['AHR', { page: 3 }]
        ]
      ],
      [
        '?type=all&page=2',
        [
          ['BR,AHR', { page: 2 }],
          ['BR', { page: 1 }],
          ['AHR', { page: 1 }]
        ]
      ]
    ])(
      'Should move only the tab %s names to its page',
      async (query, pages) => {
        await getPreviousSubmissions({ query })

        expect(requestedPages()).toEqual(pages)
      }
    )

    test('Should offer the next page alone from the first', async () => {
      answerWith({
        AHR: pageOf([animalHealthRegulationsWebForm], { hasNextPage: true })
      })

      const { result } = await getPreviousSubmissions({ journeys: ['AHR'] })
      const pagination = paginationOf(result)

      expect(hrefsOf(pagination)).toEqual([
        pageHref(animalHealthRegulations, 2)
      ])
      expect(pagination).not.toMatch(/rel="prev"/)
    })

    test('Should not offer pages when there is only one', async () => {
      answerWith({ BR: pageOf([batRabiesUpload]) })

      const { result } = await getPreviousSubmissions({ journeys: ['BR'] })

      expect(paginationOf(result)).toBeNull()
    })

    test('Should say a page past the last has no reports, linking back', async () => {
      answerWith({ BR: pageOf([], { page: 5 }) })

      const { result } = await getPreviousSubmissions({
        journeys: ['BR'],
        query: '?type=bat-rabies&page=5'
      })

      expect(result).toEqual(expect.stringContaining(NO_REPORTS_ON_PAGE_TEXT))
      expect(result).not.toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
      expect(hrefsOf(paginationOf(result))).toEqual([pageHref(batRabies, 4)])
    })

    test.each([
      '?page=0',
      '?page=two',
      '?page=1.5',
      '?page=10001',
      '?type=rabies&page=2'
    ])('Should start over from the first page for %s', async (query) => {
      const { statusCode, headers } = await getPreviousSubmissions({ query })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(PREVIOUS_SUBMISSIONS_PATH)
      expect(getSubmissionPage).not.toHaveBeenCalled()
    })

    test('Should ignore a query it does not use', async () => {
      const { statusCode } = await getPreviousSubmissions({
        query: '?utm_source=email'
      })

      expect(statusCode).toBe(statusCodes.ok)
    })
  })

  describe('when the submissions cannot be read', () => {
    test('Should say so in the tab that failed, still showing the other', async () => {
      answerWith({
        'BR,AHR': new Error('Submission history API responded 500'),
        BR: new Error('Submission history API responded 500'),
        AHR: pageOf([animalHealthRegulationsWebForm])
      })

      const { result, statusCode } = await getPreviousSubmissions()
      const batRabiesPanel = result.slice(
        result.indexOf('id="bat-rabies-submissions"'),
        result.indexOf('id="animal-health-regulations-submissions"')
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(batRabiesPanel).toEqual(
        expect.stringContaining(SUBMISSIONS_UNAVAILABLE_TEXT)
      )
      expect(result).toEqual(expect.stringContaining('AHR-BBB-222'))
      expect(result).not.toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
    })

    test('Should not say that nothing was submitted', async () => {
      answerWith({ BR: new Error('timeout') })

      const { result } = await getPreviousSubmissions({ journeys: ['BR'] })

      expect(result).toEqual(
        expect.stringContaining(SUBMISSIONS_UNAVAILABLE_TEXT)
      )
      expect(result).not.toEqual(expect.stringContaining(NO_SUBMISSIONS_TEXT))
      expect(result).not.toEqual(expect.stringContaining('govuk-table'))
    })
  })

  test('Should show the trail back to Submission Welcome', async () => {
    const { result } = await getPreviousSubmissions()

    expect(result).toEqual(expect.stringContaining('govuk-breadcrumbs'))
    expect(result).toEqual(
      expect.stringContaining('href="/submission-welcome"')
    )
  })
})
