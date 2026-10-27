// Import order matters here. The engine's page controllers form a cycle
// through its component barrel, so its models throw unless a module that
// pulls the components in first has already been evaluated.
import '@defra/forms-engine-plugin/engine/components/helpers/components.js'
import { FormModel } from '@defra/forms-engine-plugin/engine/models/FormModel.js'

import { rejectFutureDates } from '#/server/forms/validation/no-future-dates.js'

// One page with a date of each kind, on the engine's own question page
const definition = {
  engine: 'V2',
  schema: 2,
  name: 'Dates',
  startPage: '/dates',
  sections: [],
  pages: [
    {
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      path: '/dates',
      title: 'Dates',
      components: [
        {
          id: 'a1b2c3d4-0000-4000-8000-000000000002',
          type: 'DatePartsField',
          name: 'sampleDate',
          title: 'Date the sample was taken',
          options: { required: false },
          schema: {}
        },
        {
          id: 'a1b2c3d4-0000-4000-8000-000000000003',
          type: 'MonthYearField',
          name: 'reportDate',
          title: 'Reporting period',
          options: { required: false },
          schema: {}
        }
      ],
      next: [{ path: '/summary' }]
    },
    {
      id: 'a1b2c3d4-0000-4000-8000-000000000004',
      path: '/summary',
      title: 'Check your answers',
      controller: 'SummaryPageController'
    }
  ],
  lists: [],
  conditions: []
}

// Linked to the first input of the date, as the engine's own date errors are
const SAMPLE_DATE_ERROR = {
  href: '#sampleDate__day',
  text: 'Date the sample was taken must be today or in the past'
}

const REPORT_DATE_ERROR = {
  href: '#reportDate__month',
  text: 'Reporting period must be this month or in the past'
}

const model = new FormModel(definition, { basePath: 'dates' })
const page = model.pages.find(({ path }) => path === '/dates')
const translator = model.createTranslator()

page.collection.formSchema = rejectFutureDates(
  page.collection.formSchema,
  page.collection.fields
)

// As the browser posts the date inputs
function sampleDate(day, month, year) {
  return {
    sampleDate__day: String(day),
    sampleDate__month: String(month),
    sampleDate__year: String(year)
  }
}

function reportDate(month, year) {
  return {
    reportDate__month: String(month),
    reportDate__year: String(year)
  }
}

// A browser posts every date input, empty when it is not answered
const UNANSWERED = { ...sampleDate('', '', ''), ...reportDate('', '') }

function errorsFor(payload) {
  const { errors = [] } = page.collection.validate(
    { ...UNANSWERED, ...payload },
    translator
  )

  return errors.map(({ href, text }) => ({ href, text }))
}

describe('#rejectFutureDates', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('Should accept today and this month', () => {
    expect(
      errorsFor({ ...sampleDate(27, 10, 2026), ...reportDate(10, 2026) })
    ).toEqual([])
  })

  test('Should accept dates in the past', () => {
    expect(
      errorsFor({ ...sampleDate(26, 10, 2026), ...reportDate(9, 2026) })
    ).toEqual([])
    expect(
      errorsFor({ ...sampleDate(31, 12, 1999), ...reportDate(12, 1999) })
    ).toEqual([])
  })

  test('Should leave unanswered dates alone', () => {
    expect(errorsFor({})).toEqual([])
  })

  test.each([
    ['tomorrow', 28, 10, 2026],
    ['next month', 1, 11, 2026],
    ['next year', 1, 1, 2027]
  ])('Should refuse a date in the future (%s)', (_when, day, month, year) => {
    expect(errorsFor(sampleDate(day, month, year))).toEqual([SAMPLE_DATE_ERROR])
  })

  test.each([
    ['next month', 11, 2026],
    ['next year', 1, 2027]
  ])(
    'Should refuse a month and year in the future (%s)',
    (_when, month, year) => {
      expect(errorsFor(reportDate(month, year))).toEqual([REPORT_DATE_ERROR])
    }
  )

  test('Should report every date on the page that is in the future', () => {
    expect(
      errorsFor({ ...sampleDate(28, 10, 2026), ...reportDate(11, 2026) })
    ).toEqual([SAMPLE_DATE_ERROR, REPORT_DATE_ERROR])
  })

  test('Should leave a date that does not exist to the engine', () => {
    expect(errorsFor(sampleDate(31, 2, 2027))).toEqual([
      {
        href: '#sampleDate__day',
        text: 'Date the sample was taken must be a real date'
      }
    ])
  })

  test('Should go by the date in the UK rather than on the server', () => {
    // 00:30 on 1 September in British Summer Time, still 31 August in UTC
    vi.setSystemTime(new Date('2026-08-31T23:30:00Z'))

    expect(
      errorsFor({ ...sampleDate(1, 9, 2026), ...reportDate(9, 2026) })
    ).toEqual([])
    expect(
      errorsFor({ ...sampleDate(2, 9, 2026), ...reportDate(10, 2026) })
    ).toEqual([SAMPLE_DATE_ERROR, REPORT_DATE_ERROR])
  })
})
