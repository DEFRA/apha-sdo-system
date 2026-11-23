import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { MAX_FILES_TEXT } from './report-file-upload-page-controller.js'

/**
 * A stand-in cdp-uploader on an ephemeral port, wired up before any imports so
 * the forms engine reads its address from UPLOADER_URL at load time. Nothing
 * else is mocked: controller resolution, MonthYearField state, session cache,
 * flash messages and views are all the real engine. This is the test that
 * proves the file name rule actually fires in a running journey.
 */
const uploader = await vi.hoisted(async () => {
  const { createServer: createHttpServer } = await import('node:http')
  const { randomUUID } = await import('node:crypto')

  let status = { uploadStatus: 'initiated' }

  const server = createHttpServer((req, res) => {
    res.setHeader('content-type', 'application/json')

    if (req.method === 'POST' && req.url === '/initiate') {
      res.end(
        JSON.stringify({
          uploadId: randomUUID(),
          uploadUrl: 'http://uploader.test/upload-and-scan',
          statusUrl: 'http://uploader.test/status'
        })
      )
      return
    }

    if (req.method === 'GET' && req.url?.startsWith('/status/')) {
      res.end(JSON.stringify(status))
      return
    }

    res.statusCode = 404
    res.end('{}')
  })

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  process.env.UPLOADER_URL = `http://127.0.0.1:${server.address().port}`

  return {
    close: () => new Promise((resolve) => server.close(resolve)),

    // What the next status poll reports: a freshly scanned file...
    scannedFile(filename) {
      status = {
        uploadStatus: 'ready',
        metadata: { retrievalKey: 'sdo@apha.gov.uk' },
        form: {
          file: {
            fileId: randomUUID(),
            filename,
            contentLength: 1024,
            fileStatus: 'complete'
          }
        },
        numberOfRejectedFiles: 0
      }
    },

    // ...or nothing uploaded since the upload was initiated
    nothingUploadedYet() {
      status = { uploadStatus: 'initiated' }
    }
  }
})

const SLUG = 'bat-rabies'

describe('report file name rule (end to end)', () => {
  let server

  const auth = {
    strategy: 'session',
    credentials: {
      sessionId: 'test-session',
      user: {
        id: 'user-id',
        name: 'A Person',
        organisationId: 'TestLab1',
        journeys: ['BR', 'AHR']
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

  beforeAll(async () => {
    // The forms engine loads the developer's .env on import, which may switch
    // the Azure transfer on. Submitting here must not reach for S3 or Redis.
    config.set('azure.storage.enabled', false)

    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    await uploader.close()
  })

  test('Should walk the journey and enforce the rule at every turn', async () => {
    uploader.nothingUploadedYet()

    // Enter report date 03/2024
    const reportDatePage = await get(`/${SLUG}/report-date`)
    expect(reportDatePage.statusCode).toBe(statusCodes.ok)
    expect(reportDatePage.result).toContain(
      'What month does your report cover?'
    )
    expect(reportDatePage.result).toContain(
      'The month your report covers is the month in which your lab received the samples.'
    )
    expect(reportDatePage.result).toContain(
      'This means that if you need to upload an amended report for that month, it will replace the one you&#39;ve already uploaded.'
    )
    // Bat rabies has no 30-day deadline
    expect(reportDatePage.result).not.toContain('30 days')
    expect(reportDatePage.result).toContain('Month covered')
    expect(reportDatePage.result).toContain('For example, 08 2026')

    // Nothing entered: the error names the month covered
    const dateMissing = await post(`/${SLUG}/report-date`, {
      reportDate__month: '',
      reportDate__year: ''
    })
    expect(dateMissing.statusCode).toBe(statusCodes.ok)
    expect(dateMissing.result).toContain('There is a problem')
    expect(dateMissing.result).toContain('Month covered must include a month')
    expect(reportDatePage.result).toContain(
      'href="/submission-welcome" class="govuk-back-link"'
    )
    expect(reportDatePage.result).toContain(
      '<span class="govuk-!-font-weight-bold">Laboratory name:</span>'
    )
    expect(reportDatePage.result).not.toContain(
      'govuk-summary-list__key">\n      Laboratory name'
    )
    expect(reportDatePage.result).toContain('TestLab1')
    expect(reportDatePage.result).toContain('Reporting person')
    expect(reportDatePage.result).toContain('A Person')

    const dateSaved = await post(`/${SLUG}/report-date`, {
      reportDate__month: '3',
      reportDate__year: '2024'
    })
    expect(dateSaved.statusCode).toBe(statusCodes.seeOther)
    expect(dateSaved.headers.location).toBe(`/${SLUG}/files-upload`)

    // The upload page tells the user the required name before they upload
    const uploadPage = await get(`/${SLUG}/files-upload`)
    expect(uploadPage.statusCode).toBe(statusCodes.ok)
    expect(uploadPage.result).toContain(
      `href="/${SLUG}/report-date" class="govuk-back-link"`
    )
    expect(uploadPage.result).toContain('Upload your report')
    expect(uploadPage.result).toContain(
      'To upload the file, drag and drop it or choose it from your documents folder.'
    )
    expect(uploadPage.result).toContain(
      'The name of your file must include the year and month that your report covers in figures and a hyphen, for example: ‘Report-2024-03.xlsx’.<br>Only CSV, XLS and XLSX files are accepted.'
    )

    // Continuing without a file asks for one
    const noFile = await post(`/${SLUG}/files-upload`, {})
    expect(noFile.statusCode).toBe(statusCodes.ok)
    expect(noFile.result).toContain('Select a file')
    expect(uploadPage.result).not.toContain(
      'Upload laboratory results spreadsheet'
    )

    // A misnamed file comes back from the scan and is turned away
    uploader.scannedFile('Show-and-Tell-2.xlsx')
    const rejectedPage = await get(`/${SLUG}/files-upload`)
    uploader.nothingUploadedYet()

    expect(rejectedPage.statusCode).toBe(statusCodes.ok)
    expect(rejectedPage.result).toContain('There is a problem')
    expect(rejectedPage.result).toContain(
      '‘Show-and-Tell-2.xlsx’ must include ‘2024-03’'
    )
    expect(rejectedPage.result).not.toContain('1 file uploaded')

    // Turning the file away frees the page's only upload slot, so the user
    // can try again right away: the form posts to a fresh upload, not the
    // "maximum number of files" warning
    expect(rejectedPage.result).toContain(
      'http://uploader.test/upload-and-scan'
    )
    expect(rejectedPage.result).not.toContain(
      'You have reached the maximum number of files'
    )

    // The rejected file really is gone, not just hidden: reloading shows no
    // error and still no files
    const reloadedPage = await get(`/${SLUG}/files-upload`)
    expect(reloadedPage.result).not.toContain('There is a problem')
    expect(reloadedPage.result).not.toContain('Show-and-Tell-2.xlsx')

    // A file whose name includes the report date is kept, including suffixes
    uploader.scannedFile('2024-03-part2.xlsx')
    const acceptedPage = await get(`/${SLUG}/files-upload`)
    uploader.nothingUploadedYet()

    expect(acceptedPage.result).not.toContain('There is a problem')
    expect(acceptedPage.result).toContain('2024-03-part2.xlsx')
    expect(acceptedPage.result).toContain('1 file uploaded')

    // With the one file attached, the page says how to change it
    expect(acceptedPage.result).toContain(MAX_FILES_TEXT)
    expect(acceptedPage.result).not.toContain(
      'You have reached the maximum number of files'
    )

    // Continue to the summary, which names the attached file rather than
    // counting it
    const continued = await post(`/${SLUG}/files-upload`, {})
    expect(continued.statusCode).toBe(statusCodes.seeOther)
    expect(continued.headers.location).toBe(`/${SLUG}/summary`)

    const summaryPage = await get(`/${SLUG}/summary`)
    expect(summaryPage.statusCode).toBe(statusCodes.ok)
    expect(summaryPage.result).toContain(
      `href="/${SLUG}/files-upload" class="govuk-back-link"`
    )
    expect(summaryPage.result).toContain('2024-03-part2.xlsx')
    expect(summaryPage.result).not.toContain('Uploaded 1 file')

    const answers = [
      ...summaryPage.result.matchAll(
        /<dl class="govuk-summary-list[\s\S]*?<\/dl>/g
      )
    ]
      .map((match) => match[0])
      .find((list) => list.includes('Report type'))

    expect(answers).toMatch(/Report type/)
    expect(answers).toMatch(/Bat rabies report/)
    expect(answers).toMatch(/File uploaded/)
    expect(answers.indexOf('Report type')).toBeLessThan(
      answers.indexOf('Month your report covers')
    )

    // Changing the report date from check-your-answers invalidates the stored
    // file: the user is sent to the upload page, not back to the summary.
    // action=validate is the only POST the engine both saves the new date for
    // and would bounce back to the summary via returnUrl.
    const dateChanged = await post(
      `/${SLUG}/report-date?returnUrl=/${SLUG}/summary`,
      {
        reportDate__month: '4',
        reportDate__year: '2024',
        action: 'validate'
      }
    )
    expect(dateChanged.statusCode).toBe(statusCodes.seeOther)
    expect(dateChanged.headers.location).toBe(`/${SLUG}/files-upload`)

    const invalidatedPage = await get(`/${SLUG}/files-upload`)
    expect(invalidatedPage.result).toContain(
      '‘2024-03-part2.xlsx’ must include ‘2024-04’'
    )
    expect(invalidatedPage.result).not.toContain('1 file uploaded')
    expect(invalidatedPage.result).toContain(
      'for example: ‘Report-2024-04.xlsx’.<br>Only CSV, XLS and XLSX files are accepted.'
    )
  })

  test('Should confirm the submission with its reference number', async () => {
    uploader.nothingUploadedYet()

    await post(`/${SLUG}/report-date`, {
      reportDate__month: '5',
      reportDate__year: '2024'
    })

    uploader.scannedFile('2024-05.xlsx')
    const uploadPage = await get(`/${SLUG}/files-upload`)
    uploader.nothingUploadedYet()
    expect(uploadPage.result).toContain('1 file uploaded')

    const continued = await post(`/${SLUG}/files-upload`, {})
    expect(continued.headers.location).toBe(`/${SLUG}/summary`)

    const summaryPage = await get(`/${SLUG}/summary`)
    expect(summaryPage.statusCode).toBe(statusCodes.ok)
    expect(summaryPage.result).not.toContain('Confirm diagnostic test status')

    const submitted = await post(`/${SLUG}/summary`, {})
    expect(submitted.statusCode).toBe(statusCodes.seeOther)
    expect(submitted.headers.location).toBe(`/${SLUG}/status`)

    // The same confirmation as the web form: the reference to quote, and no
    // link to the engine's feedback form, which this service does not serve
    const statusPage = await get(`/${SLUG}/status`)
    expect(statusPage.statusCode).toBe(statusCodes.ok)
    expect(statusPage.result).toMatch(
      /<title>\s*Report submitted \| [^<]+<\/title>/
    )
    expect(statusPage.result).toMatch(
      /<h1 class="govuk-panel__title">\s*Report submitted\s*<\/h1>/
    )
    expect(statusPage.result).toMatch(
      /Your reference number<br><strong>[^<\s]+<\/strong>/
    )
    expect(statusPage.result).toContain(
      '<p>This reference number will be emailed to you. Please use it if you need to contact us about your report.</p>'
    )
    expect(statusPage.result).toContain('<p>Thank you for your report.</p>')
    expect(statusPage.result).toContain(
      '<p>We will contact you if we need more information.</p>'
    )
    expect(statusPage.result).not.toContain('Form submitted')
    expect(statusPage.result).not.toContain('What happens next')
    expect(statusPage.result).not.toContain('/form/feedback')
  })
})
