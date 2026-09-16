import { definition, metadata } from './animal-health-regulations-web-form.js'
import { createReportJourney } from './report-journey.js'
import { reportTypes, reportTypesBySlug } from '../report-types.js'
import { formsService } from '../services/forms-service.js'

const ahr = reportTypesBySlug.get('animal-health-regulations')

const SUMMARY_PATH = '/summary'
const OTHER_SPECIES_PATH = '/enter-other-species'

// Every identifier a form definition carries: form, pages, components, lists,
// list items and their hints, conditions and their items.
function idsOf({ metadata, definition }) {
  return [
    metadata.id,
    ...definition.pages.flatMap((page) => [
      page.id,
      ...(page.components ?? []).map((component) => component.id)
    ]),
    ...(definition.lists ?? []).flatMap((list) => [
      list.id,
      ...list.items.map((item) => item.id),
      ...list.items.map((item) => item.hint?.id).filter(Boolean)
    ]),
    ...(definition.conditions ?? []).flatMap((condition) => [
      condition.id,
      ...(condition.items ?? []).map((item) => item.id)
    ])
  ]
}

function findPage(path) {
  return definition.pages.find((page) => page.path === path)
}

function questionComponents() {
  return definition.pages.flatMap((page) =>
    (page.components ?? []).filter((component) => component.name)
  )
}

describe('animal health regulations web form', () => {
  test('Should be the web form journey of the AHR report type', () => {
    expect(metadata.slug).toBe(ahr.webFormSlug)
    expect(metadata.title).toBe(ahr.title)
    expect(definition.name).toBe(ahr.title)
    expect(reportTypesBySlug.get(metadata.slug)).toBe(ahr)
  })

  test('Should be served by the forms service under its slug', async () => {
    await expect(formsService.getFormMetadata(metadata.slug)).resolves.toBe(
      metadata
    )
    await expect(formsService.getFormDefinition(metadata.id)).resolves.toBe(
      definition
    )
  })

  test('Should be an engine V2 form', () => {
    expect(definition.engine).toBe('V2')
    expect(definition.schema).toBe(2)
  })

  test('Should ask the designed questions in order, then check answers', () => {
    const paths = definition.pages.map((page) => page.path)

    expect(paths).toEqual([
      '/what-month-does-your-report-cover',
      '/which-pathogen-was-tested',
      '/which-species-was-tested',
      OTHER_SPECIES_PATH,
      '/which-country-were-the-samples-collected-in',
      '/number-of-submissions-of-diagnostic-tests',
      SUMMARY_PATH
    ])
    expect(definition.startPage).toBe(paths[0])
  })

  test('Should name the report date answer as the upload journey does', () => {
    const [firstPage] = definition.pages
    const reportDate = firstPage.components.find(
      (component) => component.type === 'MonthYearField'
    )

    // The output service reads this answer to fill reportMonthYear
    expect(reportDate).toEqual(
      expect.objectContaining({
        name: 'reportDate',
        options: expect.objectContaining({ required: true })
      })
    )
  })

  test('Should use readable answer names rather than generated ones', () => {
    expect(questionComponents().map((component) => component.name)).toEqual([
      'reportDate',
      'pathogen',
      'species',
      'otherSpecies',
      'country',
      'submissionsWithQualifyingTest',
      'submissionsWithPositiveSamples',
      'positiveSamples'
    ])
  })

  test('Should require every answer', () => {
    for (const component of questionComponents()) {
      expect(component.options.required).toBe(true)
    }
  })

  test('Should bind every list field to a list of the form', () => {
    const listIds = new Set(definition.lists.map((list) => list.id))
    const listFields = questionComponents().filter(
      (component) => component.list
    )

    expect(listFields).toHaveLength(3)

    for (const field of listFields) {
      expect(listIds.has(field.list)).toBe(true)
    }
  })

  test('Should only ask for another species when Other is selected', () => {
    const otherSpeciesPage = findPage(OTHER_SPECIES_PATH)
    const condition = definition.conditions.find(
      ({ id }) => id === otherSpeciesPage.condition
    )
    const speciesField = questionComponents().find(
      (component) => component.name === 'species'
    )
    const speciesList = definition.lists.find(
      (list) => list.id === speciesField.list
    )
    const otherItem = speciesList.items.find((item) => item.text === 'Other')

    expect(condition).toBeDefined()
    expect(condition.items).toEqual([
      expect.objectContaining({
        componentId: speciesField.id,
        operator: 'is',
        type: 'ListItemRef',
        value: { itemId: [otherItem.id], listId: speciesList.id }
      })
    ])

    // No other page is conditional
    const conditionalPages = definition.pages.filter((page) => page.condition)

    expect(conditionalPages).toEqual([otherSpeciesPage])
  })

  test('Should introduce every question page with guidance', () => {
    const questionPages = definition.pages.filter((page) => page.components)

    expect(questionPages).toHaveLength(6)

    for (const page of questionPages) {
      const [guidance] = page.components

      expect(guidance.type).toBe('Markdown')
      expect(guidance.content).toBeTruthy()
    }
  })

  test('Should check answers with the report summary controller', () => {
    expect(findPage(SUMMARY_PATH)).toEqual(
      expect.objectContaining({
        title: 'Check your answers before submitting',
        controller: 'SummaryPageWithConfirmationEmailController'
      })
    )
  })

  test('Should not share an identifier with the upload journeys or itself', () => {
    const ids = [
      ...idsOf({ metadata, definition }),
      ...reportTypes.flatMap((reportType) =>
        idsOf(createReportJourney(reportType))
      )
    ]

    expect(new Set(ids).size).toBe(ids.length)
  })
})
