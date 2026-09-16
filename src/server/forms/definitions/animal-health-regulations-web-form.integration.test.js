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
  summary: `/${SLUG}/summary`,
  status: `/${SLUG}/status`
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
 * Nothing is mocked but the Azure client: the pages, the condition, the
 * session state and the summary are the real forms engine, so this is the
 * test that proves the designed journey runs end to end and that its answers
 * reach the output service in the same record as an uploaded report.
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

  test('Should walk the journey and deliver the answers as the report', async () => {
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

    const pathogenPage = await get(PAGES.pathogen)
    expect(pathogenPage.statusCode).toBe(statusCodes.ok)
    expect(pathogenPage.result).toContain('Pathogen 1')
    expect(pathogenPage.result).toContain('Pathogen 2')

    await answer(PAGES.pathogen, { pathogen: 'Pathogen 1' }, PAGES.species)

    // A species from the list skips the "other species" question
    await answer(PAGES.species, { species: 'Cattle' }, PAGES.country)

    // "Other" asks for it
    await answer(PAGES.species, { species: 'Other' }, PAGES.otherSpecies)

    const otherSpeciesPage = await get(PAGES.otherSpecies)
    expect(otherSpeciesPage.statusCode).toBe(statusCodes.ok)
    expect(otherSpeciesPage.result).toContain('Enter other species')

    await answer(PAGES.otherSpecies, { otherSpecies: 'Alpaca' }, PAGES.country)

    await answer(PAGES.country, { country: 'England' }, PAGES.numbers)

    // Every count is required
    const incomplete = await post(PAGES.numbers, {
      submissionsWithQualifyingTest: '12'
    })
    expect(incomplete.statusCode).toBe(statusCodes.ok)
    expect(incomplete.result).toContain('There is a problem')

    await answer(
      PAGES.numbers,
      {
        submissionsWithQualifyingTest: '12',
        submissionsWithPositiveSamples: '3',
        positiveSamples: '5'
      },
      PAGES.summary
    )

    // Check your answers shows the submission kind first, then every answer
    const summaryPage = await get(PAGES.summary)
    expect(summaryPage.statusCode).toBe(statusCodes.ok)

    const answers = /<dl class="govuk-summary-list[\s\S]*?<\/dl>/.exec(
      summaryPage.result
    )?.[0]

    expect(answers).toMatch(/Submission kind/)
    expect(answers).toMatch(new RegExp(ahr.kind))
    expect(answers.indexOf('Submission kind')).toBeLessThan(
      answers.indexOf('Report Date')
    )

    for (const value of [
      'August 2026',
      'Pathogen 1',
      'Other',
      'Alpaca',
      'England',
      '12',
      '3',
      '5'
    ]) {
      expect(answers).toContain(value)
    }

    expect(summaryPage.result).not.toContain('Uploaded')

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
      fileNames: [],
      reportMonthYear: 'August 2026',
      notificationEmail: 'sdo@apha.gov.uk',
      answers: expect.arrayContaining([
        expect.objectContaining({ name: 'reportDate', value: 'August 2026' }),
        expect.objectContaining({ name: 'pathogen', value: 'Pathogen 1' }),
        expect.objectContaining({ name: 'species', value: 'Other' }),
        expect.objectContaining({ name: 'otherSpecies', value: 'Alpaca' }),
        expect.objectContaining({ name: 'country', value: 'England' }),
        expect.objectContaining({
          name: 'submissionsWithQualifyingTest',
          value: '12'
        }),
        expect.objectContaining({
          name: 'submissionsWithPositiveSamples',
          value: '3'
        }),
        expect.objectContaining({ name: 'positiveSamples', value: '5' })
      ])
    })
    expect(submission.answers).toHaveLength(8)

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
