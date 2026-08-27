import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

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
      user: { id: 'user-id', name: 'A Person' },
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
      'The file name must include March2024, for example March2024.xlsx or March2024-1.xlsx<br>Only csv, xls and xlsx files are supported.'
    )
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
      '‘Show-and-Tell-2.xlsx’ must include ‘March2024’'
    )
    expect(rejectedPage.result).not.toContain('1 file uploaded')

    // The rejected file really is gone, not just hidden: reloading shows no
    // error and still no files
    const reloadedPage = await get(`/${SLUG}/files-upload`)
    expect(reloadedPage.result).not.toContain('There is a problem')
    expect(reloadedPage.result).not.toContain('Show-and-Tell-2.xlsx')

    // A file whose name includes the report date is kept, including suffixes
    uploader.scannedFile('March2024-part2.xlsx')
    const acceptedPage = await get(`/${SLUG}/files-upload`)
    uploader.nothingUploadedYet()

    expect(acceptedPage.result).not.toContain('There is a problem')
    expect(acceptedPage.result).toContain('March2024-part2.xlsx')
    expect(acceptedPage.result).toContain('1 file uploaded')

    // Continue to the summary, which names the attached file rather than
    // counting it
    const continued = await post(`/${SLUG}/files-upload`, {})
    expect(continued.statusCode).toBe(statusCodes.seeOther)
    expect(continued.headers.location).toBe(`/${SLUG}/summary`)

    const summaryPage = await get(`/${SLUG}/summary`)
    expect(summaryPage.statusCode).toBe(statusCodes.ok)
    expect(summaryPage.result).toContain('March2024-part2.xlsx')
    expect(summaryPage.result).not.toContain('Uploaded 1 file')

    const answers = /<dl class="govuk-summary-list[\s\S]*?<\/dl>/.exec(
      summaryPage.result
    )?.[0]

    expect(answers).toMatch(/Submission kind/)
    expect(answers).toMatch(/Bat rabies/)
    expect(answers.indexOf('Submission kind')).toBeLessThan(
      answers.indexOf('Report date')
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
      '‘March2024-part2.xlsx’ must include ‘April2024’'
    )
    expect(invalidatedPage.result).not.toContain('1 file uploaded')
    expect(invalidatedPage.result).toContain(
      'The file name must include April2024, for example April2024.xlsx or April2024-1.xlsx<br>Only csv, xls and xlsx files are supported.'
    )
  })
})
