import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'

vi.mock('#/server/upload/services/azure-storage-service.js', () => ({
  azureStorageService: { uploadFile: vi.fn() }
}))

const ahr = reportTypesBySlug.get('animal-health-regulations')
const SLUG = ahr.webFormSlug

const PAGES = {
  reportDate: `/${SLUG}/what-month-does-your-report-cover`,
  pathogen: `/${SLUG}/which-pathogen-was-tested`,
  species: `/${SLUG}/which-species-was-tested`,
  otherSpecies: `/${SLUG}/enter-other-species`,
  country: `/${SLUG}/which-country-were-the-samples-collected-in`,
  numbers: `/${SLUG}/number-of-submissions-of-diagnostic-tests`,
  entries: `/${SLUG}/report-entries`,
  summary: `/${SLUG}/summary`,
  status: `/${SLUG}/status`
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/

const COUNTS = {
  submissionsWithQualifyingTest: '12',
  submissionsWithPositiveSamples: '3',
  positiveSamples: '5'
}

/**
 * The JSON written to {referenceNumber}/submission.json
 */
function uploadedSubmissionJson() {
  const call = azureStorageService.uploadFile.mock.calls.find(
    ([, , metadata]) => metadata.type === 'submission'
  )

  return JSON.parse(call[1].toString())
}

/**
 * The entry id at the end of an entry page URL
 * @param {string} url - /{slug}/{page}/{itemId}
 */
function entryIdOf(url) {
  const itemId = url.split('?')[0].split('/').pop()

  expect(itemId).toMatch(UUID)

  return itemId
}

function withReturnUrl(url, returnUrl) {
  return `${url}?returnUrl=${encodeURIComponent(returnUrl)}`
}

function pageHeading(html) {
  return /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/.exec(html)?.[1]
}

function pageCaption(html) {
  return /govuk-caption-l[^>]*>\s*([^<]+?)\s*<\/h2>/.exec(html)?.[1]
}

// The small text above an entry page's heading
function entryCaption(html) {
  return /govuk-caption-m">([^<]+)</.exec(html)?.[1]
}

function backLink(html) {
  const match = /<a href="([^"]*)" class="govuk-back-link">([^<]*)<\/a>/.exec(
    html
  )

  return match && { href: match[1], text: match[2] }
}

// The options of the page's select, without the empty first one
function selectOptions(html) {
  return [...html.matchAll(/<option value="([^"]*)"/g)]
    .map(([, value]) => value)
    .filter(Boolean)
}

function notificationBanner(html) {
  return /<div class="govuk-notification-banner"[\s\S]*?<\/div>\s*<\/div>/.exec(
    html
  )?.[0]
}

function errorSummaryLinks(html) {
  const list =
    /<ul class="govuk-list govuk-error-summary__list">([\s\S]*?)<\/ul>/.exec(
      html
    )?.[1]

  return [...(list ?? '').matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(
    ([, href, text]) => ({ href, text })
  )
}

/**
 * The answers so far listed above the question of an entry page: the first
 * summary list on the page, as [key, value, change href] rows
 */
function answersSoFar(html) {
  const list = /<dl class="govuk-summary-list[^"]*">([\s\S]*?)<\/dl>/.exec(
    html
  )?.[1]

  return [
    ...(list ?? '').matchAll(
      /govuk-summary-list__key">\s*([\s\S]*?)\s*<\/dt>\s*<dd class="govuk-summary-list__value[^"]*">\s*([\s\S]*?)\s*<\/dd>[\s\S]*?<a class="govuk-link[^"]*" href="([^"]+)">Change/g
    )
  ].map(([, key, value, changeHref]) => [key, value, changeHref])
}

function summaryCards(html) {
  return [
    ...html.matchAll(
      /<div class="govuk-summary-card">([\s\S]*?)<\/dl>\s*<\/div>\s*<\/div>/g
    )
  ].map(([, card]) => ({
    title: /govuk-summary-card__title">\s*([^<]+?)\s*</.exec(card)?.[1],
    values: [
      ...card.matchAll(
        /govuk-summary-list__value[^"]*">\s*([\s\S]*?)\s*<\/dd>/g
      )
    ].map(([, value]) => value)
  }))
}

/**
 * Nothing is mocked but the Azure client: the pages, the condition, the
 * session state and the summary are the real forms engine, so this is the
 * test that proves the designed journey runs end to end, that a report can
 * carry several entries, and that they reach the output service in the same
 * record as an uploaded report.
 */
describe('animal health regulations web form (end to end)', () => {
  let server

  const auth = {
    strategy: 'session',
    credentials: {
      sessionId: 'test-session',
      user: {
        id: 'user-id',
        name: 'A Person',
        organisationId: 'TestLab1',
        journeys: ['AHR']
      },
      claims: {}
    }
  }

  // Session state and CSRF protection both live in cookies, so carry them
  // across requests like a browser would
  const jar = new Map()

  function rememberCookies(res) {
    for (const header of res.headers['set-cookie'] ?? []) {
      const [name, ...rest] = header.split(';')[0].split('=')
      jar.set(name, rest.join('='))
    }
  }

  function withCookies(options) {
    const cookie = [...jar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')

    return { ...options, auth, headers: { ...options.headers, cookie } }
  }

  async function get(url) {
    const res = await server.inject(withCookies({ method: 'GET', url }))
    rememberCookies(res)
    return res
  }

  async function post(url, payload) {
    const res = await server.inject(
      withCookies({
        method: 'POST',
        url,
        payload: { ...payload, crumb: jar.get('crumb') }
      })
    )
    rememberCookies(res)
    return res
  }

  async function answer(url, payload, nextUrl) {
    const res = await post(url, payload)

    expect(res.statusCode).toBe(statusCodes.seeOther)
    expect(res.headers.location).toBe(nextUrl)
  }

  beforeAll(async () => {
    config.set('azure.storage.enabled', true)
    azureStorageService.uploadFile.mockResolvedValue({
      success: true,
      blobName: 'REF/submission.json'
    })

    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('azure.storage.enabled', false)
    await server.stop({ timeout: 0 })
  })

  test('Should walk the journey, add several entries and deliver them as the report', async () => {
    // The journey starts at the first question
    const start = await get(`/${SLUG}`)
    expect(start.headers.location).toBe(PAGES.reportDate)

    const reportDatePage = await get(PAGES.reportDate)
    expect(reportDatePage.statusCode).toBe(statusCodes.ok)
    expect(reportDatePage.result).toContain(
      'What month does your report cover?'
    )
    // Sits under the report type, like the upload journey
    expect(reportDatePage.result).toContain('href="/submission-welcome"')
    expect(reportDatePage.result).toContain(ahr.title)

    await answer(
      PAGES.reportDate,
      { reportDate__month: '8', reportDate__year: '2026' },
      PAGES.pathogen
    )

    // The first entry page starts a new entry, named by its id in the URL
    const newEntry = await get(PAGES.pathogen)
    expect(newEntry.statusCode).toBe(statusCodes.redirect)
    expect(newEntry.headers.location).toMatch(
      new RegExp(`^${PAGES.pathogen}/${UUID.source}`)
    )

    let first = entryIdOf(newEntry.headers.location)
    const entryPage = (page, itemId) => `${page}/${itemId}`

    const pathogenPage = await get(entryPage(PAGES.pathogen, first))
    expect(pathogenPage.statusCode).toBe(statusCodes.ok)
    expect(entryCaption(pathogenPage.result)).toBe('Adding entry 1')
    expect(pathogenPage.result).toContain('Tritrichomonas foetus')
    expect(pathogenPage.result).toContain('Bovine Herpes Virus 1 (BHV-1)')

    // Back from the first page of the first entry goes to the report date
    expect(backLink(pathogenPage.result)).toEqual({
      text: 'Back',
      href: PAGES.reportDate
    })

    // Uses the full width, flags what not to include in a banner above the
    // heading, and offers to save and exit or abort beside Continue
    expect(pathogenPage.result).toContain('govuk-grid-column-full')

    const banner = notificationBanner(pathogenPage.result)
    expect(banner).toContain('Important')
    expect(banner).toContain('Do not include PRRSV-2 or BVDV-2')
    expect(
      pathogenPage.result.indexOf('govuk-notification-banner')
    ).toBeLessThan(pathogenPage.result.indexOf('<h1'))

    expect(pathogenPage.result).toContain('value="save-and-exit"')
    expect(pathogenPage.result).toContain(
      '<button type="submit" name="action" value="delete" class="govuk-link app-link-button">Abort new entry</button>'
    )

    // Save and exit leaves for Submission Welcome without saving the page
    const savedAndExited = await post(entryPage(PAGES.pathogen, first), {
      pathogen: 'Bovine Herpes Virus 1 (BHV-1)',
      action: 'save-and-exit'
    })
    expect(savedAndExited.statusCode).toBe(statusCodes.seeOther)
    expect(savedAndExited.headers.location).toBe('/submission-welcome')

    const backAgain = await get(entryPage(PAGES.pathogen, first))
    expect(/<select[\s\S]*?<\/select>/.exec(backAgain.result)[0]).not.toContain(
      'selected'
    )

    // A return URL leading off the service is ignored
    const offSite = await post(
      `${entryPage(PAGES.pathogen, first)}?returnUrl=${encodeURIComponent('//other.site/phish')}`,
      { pathogen: 'Tritrichomonas foetus' }
    )
    expect(offSite.statusCode).toBe(statusCodes.seeOther)
    expect(offSite.headers.location).toBe(entryPage(PAGES.species, first))

    // Aborting the only entry abandons the report: it leaves for Submission
    // Welcome and coming back starts afresh, report date included
    const abortedOnly = await post(entryPage(PAGES.species, first), {
      action: 'delete'
    })
    expect(abortedOnly.statusCode).toBe(statusCodes.seeOther)
    expect(abortedOnly.headers.location).toBe('/submission-welcome')

    const freshStart = await get(PAGES.reportDate)
    expect(freshStart.statusCode).toBe(statusCodes.ok)
    expect(freshStart.result).not.toMatch(
      /name="reportDate__year"[^>]*value="2026"/
    )

    await answer(
      PAGES.reportDate,
      { reportDate__month: '8', reportDate__year: '2026' },
      PAGES.pathogen
    )

    const freshEntry = await get(PAGES.pathogen)
    expect(freshEntry.headers.location).not.toBe(
      entryPage(PAGES.pathogen, first)
    )

    // Carry on with the restarted entry as the first one
    first = entryIdOf(freshEntry.headers.location)

    const restartedPage = await get(entryPage(PAGES.pathogen, first))
    expect(entryCaption(restartedPage.result)).toBe('Adding entry 1')
    expect(
      /<select[\s\S]*?<\/select>/.exec(restartedPage.result)[0]
    ).not.toContain('selected')

    // Jumping ahead within the entry goes back to its first unanswered page
    const jumpedAhead = await get(entryPage(PAGES.country, first))
    expect(jumpedAhead.statusCode).toBe(statusCodes.redirect)
    expect(jumpedAhead.headers.location).toBe(entryPage(PAGES.pathogen, first))

    // The species offered depend on the pathogen
    await answer(
      entryPage(PAGES.pathogen, first),
      { pathogen: 'Mycoplasma gallisepticum / M. meleagridis' },
      entryPage(PAGES.species, first)
    )

    const poultryPage = await get(entryPage(PAGES.species, first))
    expect(selectOptions(poultryPage.result)).toEqual([
      'Chicken',
      'Turkey',
      'Other'
    ])
    expect(poultryPage.result).toContain(
      'Other (please specify on the next page)'
    )

    await answer(
      entryPage(PAGES.pathogen, first),
      { pathogen: 'Tritrichomonas foetus' },
      entryPage(PAGES.species, first)
    )

    const bovinePage = await get(entryPage(PAGES.species, first))
    expect(selectOptions(bovinePage.result)).toEqual([
      'Domestic cattle',
      'Bison',
      'Buffalo',
      'Other'
    ])

    // Back goes to the previous page of the entry
    expect(backLink(bovinePage.result)).toEqual({
      text: 'Back',
      href: entryPage(PAGES.pathogen, first)
    })

    // A species reported for another pathogen is refused
    const wrongSpecies = await post(entryPage(PAGES.species, first), {
      species: 'Chicken'
    })
    expect(wrongSpecies.statusCode).toBe(statusCodes.ok)
    expect(errorSummaryLinks(wrongSpecies.result)).toEqual([
      {
        href: '#species',
        text: 'Select one of the options shown for species the report is for'
      }
    ])

    // A species from the list skips the "other species" question
    await answer(
      entryPage(PAGES.species, first),
      { species: 'Domestic cattle' },
      entryPage(PAGES.country, first)
    )

    // "Other" asks for it
    await answer(
      entryPage(PAGES.species, first),
      { species: 'Other' },
      entryPage(PAGES.otherSpecies, first)
    )

    const otherSpeciesPage = await get(entryPage(PAGES.otherSpecies, first))
    expect(otherSpeciesPage.statusCode).toBe(statusCodes.ok)
    expect(otherSpeciesPage.result).toContain('Enter other species')

    await answer(
      entryPage(PAGES.otherSpecies, first),
      { otherSpecies: 'Alpaca' },
      entryPage(PAGES.country, first)
    )

    await answer(
      entryPage(PAGES.country, first),
      { country: 'England' },
      entryPage(PAGES.numbers, first)
    )

    // Each entry page lists the answers so far, each with a Change link that
    // returns to the page
    const numbersPage = await get(entryPage(PAGES.numbers, first))
    expect(numbersPage.statusCode).toBe(statusCodes.ok)

    const backHere = entryPage(PAGES.numbers, first)

    expect(answersSoFar(numbersPage.result)).toEqual([
      ['Report Date', 'August 2026', withReturnUrl(PAGES.reportDate, backHere)],
      [
        'Selected pathogen',
        'Tritrichomonas foetus',
        withReturnUrl(entryPage(PAGES.pathogen, first), backHere)
      ],
      [
        'Species the report is for',
        'Other (please specify on the next page)',
        withReturnUrl(entryPage(PAGES.species, first), backHere)
      ],
      [
        'Other species',
        'Alpaca',
        withReturnUrl(entryPage(PAGES.otherSpecies, first), backHere)
      ],
      [
        'Country',
        'England',
        withReturnUrl(entryPage(PAGES.country, first), backHere)
      ]
    ])

    // Giving an earlier answer again unchanged comes straight back
    await answer(
      withReturnUrl(entryPage(PAGES.species, first), backHere),
      { species: 'Other' },
      backHere
    )

    // Changing it drops the answers that followed, which are asked again
    await answer(
      withReturnUrl(entryPage(PAGES.otherSpecies, first), backHere),
      { otherSpecies: 'Llama' },
      entryPage(PAGES.country, first)
    )

    const countryAgain = await get(entryPage(PAGES.country, first))
    expect(
      answersSoFar(countryAgain.result).map(([key, value]) => [key, value])
    ).toEqual([
      ['Report Date', 'August 2026'],
      ['Selected pathogen', 'Tritrichomonas foetus'],
      ['Species the report is for', 'Other (please specify on the next page)'],
      ['Other species', 'Llama']
    ])

    // The country is gone, so the counts page is not reachable until it is
    // answered again
    const countsTooSoon = await get(entryPage(PAGES.numbers, first))
    expect(countsTooSoon.statusCode).toBe(statusCodes.redirect)
    expect(countsTooSoon.headers.location).toBe(entryPage(PAGES.country, first))

    await answer(
      entryPage(PAGES.country, first),
      { country: 'England' },
      entryPage(PAGES.numbers, first)
    )

    // Every count is required, and is a whole number that is not negative
    const incomplete = await post(entryPage(PAGES.numbers, first), {
      submissionsWithQualifyingTest: '12'
    })
    expect(incomplete.statusCode).toBe(statusCodes.ok)
    expect(incomplete.result).toContain('There is a problem')

    const badCounts = await post(entryPage(PAGES.numbers, first), {
      submissionsWithQualifyingTest: '-1',
      submissionsWithPositiveSamples: '1.5',
      positiveSamples: '5'
    })
    expect(badCounts.statusCode).toBe(statusCodes.ok)
    expect(errorSummaryLinks(badCounts.result).map(({ href }) => href)).toEqual(
      ['#submissionsWithQualifyingTest', '#submissionsWithPositiveSamples']
    )

    // The last entry page leads to the report entries page
    await answer(entryPage(PAGES.numbers, first), COUNTS, PAGES.entries)

    // ...which lists the entry and offers another
    const oneEntry = await get(PAGES.entries)
    expect(oneEntry.statusCode).toBe(statusCodes.ok)
    expect(pageHeading(oneEntry.result)).toBe(
      'You have added 1 entry to the report'
    )
    expect(oneEntry.result).toContain('Add another entry to the report')
    expect(summaryCards(oneEntry.result)).toEqual([
      {
        title: 'Entry 1',
        values: [
          'Tritrichomonas foetus',
          'Other (please specify on the next page)',
          'Llama',
          'England',
          '12',
          '3',
          '5'
        ]
      }
    ])
    expect(oneEntry.result).toContain(
      `href="${withReturnUrl(entryPage(PAGES.species, first), PAGES.entries)}"`
    )
    expect(oneEntry.result).toContain(
      `href="${entryPage(PAGES.entries, first)}"`
    )

    // Adding another starts a second entry
    const addAnother = await post(PAGES.entries, { action: 'add-another' })
    expect(addAnother.statusCode).toBe(statusCodes.seeOther)
    expect(addAnother.headers.location).toMatch(
      new RegExp(`^${PAGES.pathogen}/${UUID.source}`)
    )

    const second = entryIdOf(addAnother.headers.location)
    expect(second).not.toBe(first)

    const secondPathogenPage = await get(entryPage(PAGES.pathogen, second))
    expect(entryCaption(secondPathogenPage.result)).toBe('Adding entry 2')

    await answer(
      entryPage(PAGES.pathogen, second),
      { pathogen: 'Bovine Herpes Virus 1 (BHV-1)' },
      entryPage(PAGES.species, second)
    )
    await answer(
      entryPage(PAGES.species, second),
      { species: 'Domestic cattle' },
      entryPage(PAGES.country, second)
    )
    await answer(
      entryPage(PAGES.country, second),
      { country: 'Wales' },
      entryPage(PAGES.numbers, second)
    )
    await answer(
      entryPage(PAGES.numbers, second),
      {
        submissionsWithQualifyingTest: '1',
        submissionsWithPositiveSamples: '1',
        positiveSamples: '0'
      },
      PAGES.entries
    )

    const twoEntries = await get(PAGES.entries)
    expect(pageHeading(twoEntries.result)).toBe(
      'You have added 2 entries to the report'
    )
    expect(summaryCards(twoEntries.result).map((card) => card.title)).toEqual([
      'Entry 1',
      'Entry 2'
    ])

    // Changing an answer from the entries page asks the questions that
    // followed it again, then returns there. Throughout, the pages say the
    // entry is being edited, and do not offer to abort it
    const editingPage = await get(
      withReturnUrl(entryPage(PAGES.species, first), PAGES.entries)
    )
    expect(entryCaption(editingPage.result)).toBe('Editing entry 1/2')
    expect(editingPage.result).not.toContain('Abort new entry')
    expect(backLink(editingPage.result)).toEqual({
      text: 'Back',
      href: PAGES.entries
    })

    await answer(
      withReturnUrl(entryPage(PAGES.species, first), PAGES.entries),
      { species: 'Domestic cattle' },
      withReturnUrl(entryPage(PAGES.country, first), PAGES.entries)
    )

    const reAsked = await get(
      withReturnUrl(entryPage(PAGES.country, first), PAGES.entries)
    )
    expect(entryCaption(reAsked.result)).toBe('Editing entry 1/2')

    await answer(
      withReturnUrl(entryPage(PAGES.country, first), PAGES.entries),
      { country: 'England' },
      withReturnUrl(entryPage(PAGES.numbers, first), PAGES.entries)
    )
    await answer(
      withReturnUrl(entryPage(PAGES.numbers, first), PAGES.entries),
      COUNTS,
      PAGES.entries
    )

    // Giving the same answer again changes nothing and comes straight back
    await answer(
      withReturnUrl(entryPage(PAGES.pathogen, first), PAGES.entries),
      { pathogen: 'Tritrichomonas foetus' },
      PAGES.entries
    )

    const afterChanges = await get(PAGES.entries)
    expect(summaryCards(afterChanges.result)[0]).toEqual({
      title: 'Entry 1',
      values: [
        'Tritrichomonas foetus',
        'Domestic cattle',
        'England',
        '12',
        '3',
        '5'
      ]
    })

    // Aborting an entry being added drops it and goes back to the others
    const addAborted = await post(PAGES.entries, { action: 'add-another' })
    const aborted = entryIdOf(addAborted.headers.location)

    await answer(
      entryPage(PAGES.pathogen, aborted),
      { pathogen: 'Bovine Herpes Virus 1 (BHV-1)' },
      entryPage(PAGES.species, aborted)
    )

    const abortedPage = await post(entryPage(PAGES.species, aborted), {
      action: 'delete'
    })
    expect(abortedPage.statusCode).toBe(statusCodes.seeOther)
    expect(abortedPage.headers.location).toBe(PAGES.entries)

    const afterAbort = await get(PAGES.entries)
    expect(pageHeading(afterAbort.result)).toBe(
      'You have added 2 entries to the report'
    )

    // An entry left incomplete blocks the report until it is completed or
    // removed
    const addThird = await post(PAGES.entries, { action: 'add-another' })
    const third = entryIdOf(addThird.headers.location)

    await answer(
      entryPage(PAGES.pathogen, third),
      { pathogen: 'Tritrichomonas foetus' },
      entryPage(PAGES.species, third)
    )

    const blocked = await post(PAGES.entries, { action: 'continue' })
    expect(blocked.statusCode).toBe(statusCodes.ok)
    expect(errorSummaryLinks(blocked.result)).toEqual([
      {
        text: 'Complete entry 3 or remove it',
        href: withReturnUrl(entryPage(PAGES.species, third), PAGES.entries)
      }
    ])

    const blockedSubmit = await post(PAGES.summary, {})
    expect(blockedSubmit.statusCode).toBe(statusCodes.seeOther)
    expect(blockedSubmit.headers.location).toBe(PAGES.entries)
    expect(azureStorageService.uploadFile).not.toHaveBeenCalled()

    // Removing it asks for confirmation first
    const confirmRemove = await get(entryPage(PAGES.entries, third))
    expect(confirmRemove.statusCode).toBe(statusCodes.ok)
    expect(pageCaption(confirmRemove.result)).toBe('Entry 3')
    expect(pageHeading(confirmRemove.result)).toBe(
      'Are you sure you want to remove this entry?'
    )

    await answer(
      entryPage(PAGES.entries, third),
      { action: 'delete', confirm: 'true' },
      PAGES.entries
    )

    const afterRemoval = await get(PAGES.entries)
    expect(pageHeading(afterRemoval.result)).toBe(
      'You have added 2 entries to the report'
    )

    await answer(PAGES.entries, { action: 'continue' }, PAGES.summary)

    // Check your answers shows the submission kind first, the report date,
    // the number of entries, then a card per entry
    const summaryPage = await get(PAGES.summary)
    expect(summaryPage.statusCode).toBe(statusCodes.ok)
    expect(summaryPage.result).toContain('govuk-grid-column-full')
    expect(summaryPage.result).not.toContain('govuk-grid-column-two-thirds')

    const answers = /<dl class="govuk-summary-list[\s\S]*?<\/dl>/.exec(
      summaryPage.result
    )?.[0]

    expect(answers).toMatch(/Submission kind/)
    expect(answers).toMatch(new RegExp(ahr.kind))
    expect(answers.indexOf('Submission kind')).toBeLessThan(
      answers.indexOf('Report Date')
    )
    expect(answers).toContain('August 2026')
    expect(answers).toContain('2 entries')
    expect(answers).toContain(
      `href="${withReturnUrl(PAGES.entries, PAGES.summary)}"`
    )
    expect(answers).not.toContain('Not provided')

    expect(summaryCards(summaryPage.result)).toEqual([
      {
        title: 'Entry 1',
        values: [
          'Tritrichomonas foetus',
          'Domestic cattle',
          'England',
          '12',
          '3',
          '5'
        ]
      },
      {
        title: 'Entry 2',
        values: [
          'Bovine Herpes Virus 1 (BHV-1)',
          'Domestic cattle',
          'Wales',
          '1',
          '1',
          '0'
        ]
      }
    ])
    expect(summaryPage.result).toContain(
      `href="${withReturnUrl(entryPage(PAGES.country, second), PAGES.summary)}"`
    )
    expect(summaryPage.result).not.toContain('Uploaded')

    // Changing an answer from check your answers asks the questions that
    // followed it again, then returns there
    await answer(
      withReturnUrl(entryPage(PAGES.country, second), PAGES.summary),
      { country: 'Scotland' },
      withReturnUrl(entryPage(PAGES.numbers, second), PAGES.summary)
    )
    await answer(
      withReturnUrl(entryPage(PAGES.numbers, second), PAGES.summary),
      {
        submissionsWithQualifyingTest: '2',
        submissionsWithPositiveSamples: '1',
        positiveSamples: '0'
      },
      PAGES.summary
    )

    // Submitting delivers submission.json, and nothing else, to Azure
    const submitted = await post(PAGES.summary, {})
    expect(submitted.statusCode).toBe(statusCodes.seeOther)
    expect(submitted.headers.location).toBe(PAGES.status)

    expect(azureStorageService.uploadFile).toHaveBeenCalledTimes(1)

    const submission = uploadedSubmissionJson()

    expect(submission).toEqual({
      referenceNumber: expect.any(String),
      form: SLUG,
      processName: ahr.code,
      userId: 'user-id',
      organisationId: 'TestLab1',
      submittedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      fileName: null,
      reportMonthYear: 'August 2026',
      answers: [
        expect.objectContaining({ name: 'reportDate', value: 'August 2026' })
      ],
      entries: [
        {
          pathogen: 'Tritrichomonas foetus',
          species: 'Domestic cattle',
          country: 'England',
          submissionsWithQualifyingTest: '12',
          submissionsWithPositiveSamples: '3',
          positiveSamples: '5'
        },
        {
          pathogen: 'Bovine Herpes Virus 1 (BHV-1)',
          species: 'Domestic cattle',
          country: 'Scotland',
          submissionsWithQualifyingTest: '2',
          submissionsWithPositiveSamples: '1',
          positiveSamples: '0'
        }
      ]
    })

    // The confirmation page names the reference
    const statusPage = await get(PAGES.status)
    expect(statusPage.statusCode).toBe(statusCodes.ok)
    expect(statusPage.result).toContain(submission.referenceNumber)
  })

  test('Should refuse a user whose roles do not grant AHR', async () => {
    const res = await server.inject({
      method: 'GET',
      url: PAGES.reportDate,
      auth: {
        ...auth,
        credentials: {
          ...auth.credentials,
          user: { ...auth.credentials.user, journeys: ['BR'] }
        }
      }
    })

    expect(res.statusCode).toBe(statusCodes.redirect)
    expect(res.headers.location).toBe('/no-access')
  })
})
