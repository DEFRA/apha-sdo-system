import { definition, metadata } from './animal-health-regulations-web-form.js'
import { createReportJourney } from './report-journey.js'
import { reportTypes, reportTypesBySlug } from '../report-types.js'
import { formsService } from '../services/forms-service.js'
import {
  ENTRIES_KEY,
  ENTRIES_PAGE_CONTROLLER,
  ENTRY_PAGE_CONTROLLER
} from '../controllers/report-entries.js'

const ahr = reportTypesBySlug.get('animal-health-regulations')

const SUMMARY_PATH = '/summary'
const OTHER_SPECIES_PATH = '/enter-other-species'
const REPORT_ENTRIES_PATH = '/report-entries'

const ENTRY_PAGE_PATHS = [
  '/which-pathogen-was-tested',
  '/which-species-was-tested',
  OTHER_SPECIES_PATH,
  '/which-country-were-the-samples-collected-in',
  '/number-of-submissions-of-diagnostic-tests'
]

// Every identifier a form definition carries: form, sections, pages,
// components, lists, list items and their hints, conditions and their items.
function idsOf({ metadata, definition }) {
  return [
    metadata.id,
    ...(definition.sections ?? []).map((section) => section.id),
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

  test('Should ask the designed questions in order, list the entries, then check answers', () => {
    const paths = definition.pages.map((page) => page.path)

    expect(paths).toEqual([
      '/what-month-does-your-report-cover',
      ...ENTRY_PAGE_PATHS,
      REPORT_ENTRIES_PATH,
      SUMMARY_PATH
    ])
    expect(definition.startPage).toBe(paths[0])
  })

  test('Should answer the pages from pathogen to counts once per entry', () => {
    const entryPages = definition.pages.filter(
      (page) => page.controller === ENTRY_PAGE_CONTROLLER
    )
    const [section] = definition.sections

    expect(entryPages.map((page) => page.path)).toEqual(ENTRY_PAGE_PATHS)

    // The section names an entry on its pages and on the summaries
    expect(section).toEqual(
      expect.objectContaining({ name: ENTRIES_KEY, title: 'Entry' })
    )

    for (const page of entryPages) {
      expect(page.section).toBe(section.id)
    }

    // The report date is answered once, for the whole report
    const [reportDatePage] = definition.pages

    expect(reportDatePage.controller).toBeUndefined()
    expect(reportDatePage.section).toBeUndefined()
  })

  test('Should list the entries after the last entry page and before check answers', () => {
    expect(findPage(REPORT_ENTRIES_PATH)).toEqual({
      id: expect.any(String),
      path: REPORT_ENTRIES_PATH,
      title: 'Report entries',
      controller: ENTRIES_PAGE_CONTROLLER,
      components: []
    })
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
      expect(component.title).not.toContain('(optional)')
    }
  })

  test('Should only accept whole, non-negative counts', () => {
    const counts = questionComponents().filter(
      (component) => component.type === 'NumberField'
    )

    expect(counts).toHaveLength(3)

    for (const count of counts) {
      expect(count.schema).toEqual({ min: 0, precision: 0 })
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

  test('Should offer the designed pathogens', () => {
    const pathogenField = questionComponents().find(
      (component) => component.name === 'pathogen'
    )
    const pathogens = definition.lists.find(
      (list) => list.id === pathogenField.list
    )

    expect(pathogens.items.map((item) => item.text)).toEqual([
      'Mycoplasma gallisepticum / M. meleagridis',
      'Campylobacter fetus subsp. venerealis',
      'Bovine Virus Diarrhoea Virus 1 (BVDV-1) or BVDV (-1 and -2 not differentiated)',
      'Bovine Herpes Virus 1 (BHV-1)',
      'Mycobacterium avium subsp. paratuberculosis (Map)',
      'Porcine reproductive and respiratory syndrome virus - 1 (PRRSV-1) or PRRSV (-1 and -2 not differentiated)',
      'Tritrichomonas foetus'
    ])

    // Submitted as shown
    for (const item of pathogens.items) {
      expect(item.value).toBe(item.text)
    }
  })

  test('Should offer each species for the pathogens it is reported for', () => {
    const speciesField = questionComponents().find(
      (component) => component.name === 'species'
    )
    const pathogenField = questionComponents().find(
      (component) => component.name === 'pathogen'
    )
    const speciesList = definition.lists.find(
      (list) => list.id === speciesField.list
    )
    const pathogens = definition.lists.find(
      (list) => list.id === pathogenField.list
    )

    // The pathogens a species item's condition names
    const pathogensFor = (item) => {
      if (!item.condition) {
        return 'all'
      }

      const condition = definition.conditions.find(
        ({ id }) => id === item.condition
      )
      const [ref] = condition.items

      expect(ref).toEqual(
        expect.objectContaining({
          componentId: pathogenField.id,
          operator: 'is',
          type: 'ListItemRef',
          value: expect.objectContaining({ listId: pathogens.id })
        })
      )

      return ref.value.itemId
        .map((itemId) => pathogens.items.find((p) => p.id === itemId).text)
        .map((text) => text.split(' ')[0])
    }

    const bovine = [
      'Campylobacter',
      'Bovine',
      'Bovine',
      'Mycobacterium',
      'Tritrichomonas'
    ]

    expect(
      Object.fromEntries(
        speciesList.items.map((item) => [item.text, pathogensFor(item)])
      )
    ).toEqual({
      Chicken: ['Mycoplasma'],
      Turkey: ['Mycoplasma'],
      'Domestic cattle': bovine,
      Sheep: ['Mycobacterium'],
      Goat: ['Mycobacterium'],
      Deer: ['Mycobacterium'],
      Camelid: ['Mycobacterium'],
      Bison: bovine,
      Buffalo: bovine,
      'Domestic pig': ['Porcine'],
      'Wild boar': ['Porcine'],
      'Other (please specify on the next page)': 'all'
    })
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
    const otherItem = speciesList.items.find((item) => item.value === 'Other')

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
    const questionPages = definition.pages.filter(
      (page) => page.components?.length
    )

    expect(questionPages).toHaveLength(6)

    for (const page of questionPages) {
      const [guidance] = page.components

      expect(['Markdown', 'NotificationBanner']).toContain(guidance.type)
      expect(guidance.content).toBeTruthy()
    }
  })

  test('Should flag what not to include as an Important notification banner', () => {
    const [banner] = findPage('/which-pathogen-was-tested').components

    expect(banner).toEqual(
      expect.objectContaining({
        type: 'NotificationBanner',
        title: 'Important',
        content: expect.stringContaining('Do not include PRRSV-2 or BVDV-2')
      })
    )
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
