import { createReportJourney } from './report-journey.js'
import { reportTypes } from '../report-types.js'

const journeys = reportTypes.map((reportType) => ({
  reportType,
  ...createReportJourney(reportType)
}))

// Everything a report type is allowed to change. Stripping these leaves the
// journey structure, which must be identical for every report type.
function structureOf({ metadata, definition }) {
  return {
    metadata: { ...metadata, id: undefined, slug: undefined, title: undefined },
    definition: {
      ...definition,
      name: undefined,
      pages: definition.pages.map((page) => ({
        ...page,
        id: undefined,
        components: page.components?.map((component) => ({
          ...component,
          id: undefined,
          hint: undefined
        }))
      }))
    }
  }
}

function idsOf({ metadata, definition }) {
  return [
    metadata.id,
    ...definition.pages.flatMap((page) => [
      page.id,
      ...(page.components ?? []).map((component) => component.id)
    ])
  ]
}

describe('#createReportJourney', () => {
  test('Should build a journey for every report type', () => {
    expect(journeys).toHaveLength(reportTypes.length)
    expect(journeys.length).toBeGreaterThan(1)
  })

  test.each(journeys)(
    'Should serve $metadata.slug with the report date, upload and summary pages',
    ({ definition }) => {
      expect(definition.startPage).toBe('/report-date')
      expect(definition.pages.map((page) => page.path)).toEqual([
        '/report-date',
        '/files-upload',
        '/summary'
      ])
    }
  )

  test('Should give every journey an identical structure', () => {
    const [first, ...rest] = journeys.map(structureOf)

    for (const journey of rest) {
      expect(journey).toEqual(first)
    }
  })

  test.each(journeys)(
    'Should label $metadata.slug with its report type title throughout',
    ({ reportType, metadata, definition }) => {
      expect(metadata.title).toBe(reportType.title)
      expect(definition.name).toBe(reportType.title)
    }
  )

  test('Should keep the field names consistent across journeys', () => {
    for (const { definition } of journeys) {
      const names = definition.pages.flatMap((page) =>
        (page.components ?? [])
          .filter((component) => component.name)
          .map((component) => component.name)
      )

      expect(names).toEqual(['reportDate', 'supportingDocuments'])
    }
  })

  test.each(journeys)(
    'Should introduce every question page of $metadata.slug with guidance',
    ({ definition }) => {
      const questionPages = definition.pages.filter((page) => page.components)

      expect(questionPages).toHaveLength(2)

      for (const page of questionPages) {
        const [guidance] = page.components

        expect(guidance.type).toBe('Markdown')
        expect(guidance.content).toBeTruthy()
      }
    }
  )

  test('Should not reuse an identifier across journeys', () => {
    const ids = journeys.flatMap(idsOf)

    expect(new Set(ids).size).toBe(ids.length)
  })

  test('Should give every journey a distinct slug', () => {
    const slugs = journeys.map(({ metadata }) => metadata.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
