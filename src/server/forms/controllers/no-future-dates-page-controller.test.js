// Imported ahead of FormModel, which cannot be the first engine module a
// module loads. See no-future-dates-page-controller.js.
import { NoFutureDatesPageController } from '#/server/forms/controllers/no-future-dates-page-controller.js'
import { FormModel } from '@defra/forms-engine-plugin/engine/models/FormModel.js'

import { controllers } from '#/server/forms/controllers/index.js'
import { forms } from '#/server/forms/services/forms-service.js'

const DATE_FIELD_TYPES = new Set(['DatePartsField', 'MonthYearField'])

/**
 * The pages of a form that ask for a date, as the service builds them
 * @param {{ metadata: object, definition: object }} form - a registered form
 */
function datePagesOf({ metadata, definition }) {
  const model = new FormModel(
    definition,
    { basePath: metadata.slug },
    undefined,
    controllers
  )

  return model.pages.filter((page) =>
    page.collection.fields.some((field) => DATE_FIELD_TYPES.has(field.type))
  )
}

describe('NoFutureDatesPageController', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('Should refuse a date in the future on its page', () => {
    const exampleApplication = forms.find(
      ({ metadata }) => metadata.slug === 'example-application'
    )
    const [page] = datePagesOf(exampleApplication)
    const translator = page.model.createTranslator()

    const thisMonth = page.collection.validate(
      {
        applicationType: 'new',
        reportingPeriod__month: '10',
        reportingPeriod__year: '2026'
      },
      translator
    )
    expect(thisMonth.errors).toBeUndefined()

    const nextMonth = page.collection.validate(
      {
        applicationType: 'new',
        reportingPeriod__month: '11',
        reportingPeriod__year: '2026'
      },
      translator
    )
    expect(nextMonth.errors).toEqual([
      expect.objectContaining({
        href: '#reportingPeriod__month',
        text: 'Reporting period must be this month or in the past'
      })
    ])
  })

  test.each(forms.map((form) => [form.metadata.slug, form]))(
    'Should be the controller of every page of %s that asks for a date',
    (_slug, form) => {
      const unguarded = datePagesOf(form)
        .filter((page) => !(page instanceof NoFutureDatesPageController))
        .map((page) => page.path)

      expect(unguarded).toEqual([])
    }
  )
})
