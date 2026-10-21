import {
  getLabDetails,
  getLabDiagnosticTests,
  registerLabDiagnosticTestsStore,
  saveLabDetails,
  saveLabDiagnosticTests
} from './lab-diagnostic-tests.js'
import { testsByKey } from './qualifying-tests.js'

const COOKIE_NAME = 'diagnosticTests'
const LABORATORY_DETAILS_COOKIE_NAME = 'laboratoryDetails'

const LABORATORY_DETAILS = {
  addressLine1: 'Y Buarth',
  addressLine2: null,
  townOrCity: 'Aberystwyth',
  county: 'Ceredigion',
  postcode: 'SY23 1ND',
  ukasAccreditationNumber: '9934'
}

// The same details as the cookie keeps them: blank fields left out
const STORED_LABORATORY_DETAILS = {
  addressLine1: 'Y Buarth',
  townOrCity: 'Aberystwyth',
  county: 'Ceredigion',
  postcode: 'SY23 1ND',
  ukasAccreditationNumber: '9934'
}

const mycoplasmaPcr = testsByKey.get('mycoplasma-pcr')
const bhvFat = testsByKey.get('bhv-fat')

/**
 * A request from a user of the given lab, carrying the given cookie values
 */
function createRequest({ lab = 'TestLab1', cookie, detailsCookie } = {}) {
  return {
    auth: { credentials: { user: { id: 'user-id', organisationId: lab } } },
    state: {
      ...(cookie === undefined ? {} : { [COOKIE_NAME]: cookie }),
      ...(detailsCookie === undefined
        ? {}
        : { [LABORATORY_DETAILS_COOKIE_NAME]: detailsCookie })
    },
    app: {}
  }
}

function createToolkit() {
  return { state: vi.fn() }
}

// What the store wrote to the cookie
function writtenCookie(h, cookieName = COOKIE_NAME) {
  expect(h.state).toHaveBeenCalledTimes(1)

  const [name, value] = h.state.mock.calls[0]

  expect(name).toBe(cookieName)

  return value
}

describe('lab diagnostic tests store', () => {
  describe('getLabDiagnosticTests', () => {
    test('Should read never defined without the cookie', async () => {
      expect(await getLabDiagnosticTests(createRequest())).toBeNull()
    })

    test('Should read never defined for a lab the cookie does not hold', async () => {
      const request = createRequest({
        lab: 'TestLab2',
        cookie: [['TestLab1', { 'bhv-fat': 'Yes' }]]
      })

      expect(await getLabDiagnosticTests(request)).toBeNull()
    })

    test("Should read the lab's tests in catalogue order, whatever order they were kept in", async () => {
      const request = createRequest({
        cookie: [['TestLab1', { 'bhv-fat': 'No', 'mycoplasma-pcr': 'Yes' }]]
      })

      expect(await getLabDiagnosticTests(request)).toEqual([
        { test: mycoplasmaPcr, accreditation: 'Yes' },
        { test: bhvFat, accreditation: 'No' }
      ])
    })

    test('Should drop tests no longer in the catalogue and accreditations no longer offered', async () => {
      const request = createRequest({
        cookie: [
          [
            'TestLab1',
            {
              'bhv-fat': 'Yes',
              'retired-test': 'Yes',
              'mycoplasma-pcr': 'Not applicable'
            }
          ]
        ]
      })

      expect(await getLabDiagnosticTests(request)).toEqual([
        { test: bhvFat, accreditation: 'Yes' }
      ])
    })

    test('Should read never defined when nothing usable is left', async () => {
      const request = createRequest({
        cookie: [['TestLab1', { 'retired-test': 'Yes' }]]
      })

      expect(await getLabDiagnosticTests(request)).toBeNull()
    })

    test.each([
      ['a string', 'TestLab1'],
      ['an object keyed by lab', { TestLab1: { 'bhv-fat': 'Yes' } }],
      ['entries that are not pairs', ['TestLab1', { 'bhv-fat': 'Yes' }]],
      ['a pair without tests', [['TestLab1', ['bhv-fat']]]],
      ['a pair without a lab', [[42, { 'bhv-fat': 'Yes' }]]]
    ])('Should read never defined from %s', async (_description, cookie) => {
      expect(await getLabDiagnosticTests(createRequest({ cookie }))).toBeNull()
    })

    test('Should read never defined for a user without a lab', async () => {
      const request = createRequest({
        lab: null,
        cookie: [['TestLab1', { 'bhv-fat': 'Yes' }]]
      })

      expect(await getLabDiagnosticTests(request)).toBeNull()
    })

    test('Should read once per request', async () => {
      const request = createRequest({
        cookie: [['TestLab1', { 'bhv-fat': 'Yes' }]]
      })
      const first = await getLabDiagnosticTests(request)

      request.state[COOKIE_NAME] = []

      expect(await getLabDiagnosticTests(request)).toBe(first)
    })
  })

  describe('saveLabDiagnosticTests', () => {
    const selections = [
      { test: mycoplasmaPcr, accreditation: 'Yes' },
      { test: bhvFat, accreditation: 'Unknown' }
    ]

    test("Should keep the lab's tests by test key", async () => {
      const h = createToolkit()

      await saveLabDiagnosticTests(createRequest(), h, selections)

      expect(writtenCookie(h)).toEqual([
        ['TestLab1', { 'mycoplasma-pcr': 'Yes', 'bhv-fat': 'Unknown' }]
      ])
    })

    test('Should be read back by the same request', async () => {
      const request = createRequest()

      expect(await getLabDiagnosticTests(request)).toBeNull()

      await saveLabDiagnosticTests(request, createToolkit(), selections)

      expect(await getLabDiagnosticTests(request)).toEqual(selections)
    })

    test('Should be read back by a later request carrying the cookie', async () => {
      const h = createToolkit()

      await saveLabDiagnosticTests(createRequest(), h, selections)

      expect(
        await getLabDiagnosticTests(createRequest({ cookie: writtenCookie(h) }))
      ).toEqual(selections)
    })

    test("Should replace the lab's tests and put it first, keeping other labs", async () => {
      const h = createToolkit()

      await saveLabDiagnosticTests(
        createRequest({
          cookie: [
            ['TestLab2', { 'bhv-fat': 'No' }],
            ['TestLab1', { 'bhv-fat': 'Yes' }]
          ]
        }),
        h,
        [{ test: mycoplasmaPcr, accreditation: 'No' }]
      )

      expect(writtenCookie(h)).toEqual([
        ['TestLab1', { 'mycoplasma-pcr': 'No' }],
        ['TestLab2', { 'bhv-fat': 'No' }]
      ])
    })

    test('Should forget the least recently saved lab beyond two', async () => {
      const h = createToolkit()

      await saveLabDiagnosticTests(
        createRequest({
          lab: 'TestLab3',
          cookie: [
            ['TestLab1', { 'bhv-fat': 'Yes' }],
            ['TestLab2', { 'bhv-fat': 'No' }]
          ]
        }),
        h,
        selections
      )

      expect(writtenCookie(h).map(([lab]) => lab)).toEqual([
        'TestLab3',
        'TestLab1'
      ])
    })

    test('Should keep nothing for a user without a lab', async () => {
      const h = createToolkit()
      const request = createRequest({ lab: null })

      await saveLabDiagnosticTests(request, h, selections)

      expect(h.state).not.toHaveBeenCalled()
      expect(await getLabDiagnosticTests(request)).toBeNull()
    })
  })

  describe('getLabDetails', () => {
    test('Should read nothing without the cookie', async () => {
      expect(await getLabDetails(createRequest())).toBeNull()
    })

    test('Should read nothing for a lab the cookie does not hold', async () => {
      const request = createRequest({
        lab: 'TestLab2',
        detailsCookie: [['TestLab1', STORED_LABORATORY_DETAILS]]
      })

      expect(await getLabDetails(request)).toBeNull()
    })

    test("Should read the lab's details, with the fields it has no text for as null", async () => {
      const request = createRequest({
        detailsCookie: [['TestLab1', STORED_LABORATORY_DETAILS]]
      })

      expect(await getLabDetails(request)).toEqual(LABORATORY_DETAILS)
    })

    test('Should drop fields that are not text or not asked for', async () => {
      const request = createRequest({
        detailsCookie: [
          [
            'TestLab1',
            { addressLine1: 'Y Buarth', townOrCity: 42, laboratoryName: 'X' }
          ]
        ]
      })

      expect(await getLabDetails(request)).toEqual({
        addressLine1: 'Y Buarth',
        addressLine2: null,
        townOrCity: null,
        county: null,
        postcode: null,
        ukasAccreditationNumber: null
      })
    })

    test.each([
      ['a string', 'TestLab1'],
      ['entries that are not pairs', ['TestLab1', STORED_LABORATORY_DETAILS]],
      ['a pair without text', [['TestLab1', { addressLine1: 42 }]]]
    ])('Should read nothing from %s', async (_description, detailsCookie) => {
      expect(await getLabDetails(createRequest({ detailsCookie }))).toBeNull()
    })

    test('Should read nothing for a user without a lab', async () => {
      const request = createRequest({
        lab: null,
        detailsCookie: [['TestLab1', STORED_LABORATORY_DETAILS]]
      })

      expect(await getLabDetails(request)).toBeNull()
    })

    test("Should not read the lab's tests as its details", async () => {
      const request = createRequest({
        cookie: [['TestLab1', { 'bhv-fat': 'Yes' }]]
      })

      expect(await getLabDetails(request)).toBeNull()
    })
  })

  describe('saveLabDetails', () => {
    test("Should keep the lab's details in their own cookie, leaving blank fields out", async () => {
      const h = createToolkit()

      await saveLabDetails(createRequest(), h, LABORATORY_DETAILS)

      expect(writtenCookie(h, LABORATORY_DETAILS_COOKIE_NAME)).toEqual([
        ['TestLab1', STORED_LABORATORY_DETAILS]
      ])
    })

    test('Should be read back by a later request carrying the cookie', async () => {
      const h = createToolkit()

      await saveLabDetails(createRequest(), h, LABORATORY_DETAILS)

      expect(
        await getLabDetails(
          createRequest({
            detailsCookie: writtenCookie(h, LABORATORY_DETAILS_COOKIE_NAME)
          })
        )
      ).toEqual(LABORATORY_DETAILS)
    })

    test("Should replace the lab's details and put it first, forgetting labs beyond two", async () => {
      const h = createToolkit()

      await saveLabDetails(
        createRequest({
          detailsCookie: [
            ['TestLab2', { addressLine1: 'Two' }],
            ['TestLab3', { addressLine1: 'Three' }],
            ['TestLab1', { addressLine1: 'Old' }]
          ]
        }),
        h,
        LABORATORY_DETAILS
      )

      expect(writtenCookie(h, LABORATORY_DETAILS_COOKIE_NAME)).toEqual([
        ['TestLab1', STORED_LABORATORY_DETAILS],
        ['TestLab2', { addressLine1: 'Two' }]
      ])
    })

    test('Should keep nothing for a user without a lab', async () => {
      const h = createToolkit()

      await saveLabDetails(createRequest({ lab: null }), h, LABORATORY_DETAILS)

      expect(h.state).not.toHaveBeenCalled()
    })
  })

  describe('registerLabDiagnosticTestsStore', () => {
    test.each([COOKIE_NAME, LABORATORY_DETAILS_COOKIE_NAME])(
      'Should register %s as an encrypted, long-lived, HTTP-only cookie',
      (cookieName) => {
        const server = { state: vi.fn() }

        registerLabDiagnosticTestsStore(server)

        expect(server.state).toHaveBeenCalledWith(
          cookieName,
          expect.objectContaining({
            ttl: 31536000000,
            encoding: 'iron',
            password: expect.any(String),
            path: '/',
            isHttpOnly: true,
            isSameSite: 'Lax',
            clearInvalid: true
          })
        )
      }
    )
  })
})
