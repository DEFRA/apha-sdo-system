import { createReportJourney } from './report-journey.js'
import { reportTypes } from '../report-types.js'

const journeys = reportTypes.map((reportType) => ({
  reportType,
  ...createReportJourney(reportType)
}))

// Everything a report type is allowed to change, the report date guidance
// included. Stripping these leaves the journey structure, which must be
// identical for every report type.
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
          hint: undefined,
          content: page.path === '/report-date' ? undefined : component.content
        }))
      }))
    }
  }
}

function guidanceOf(definition, path) {
  const [guidance] = definition.pages.find(
    (page) => page.path === path
  ).components

  return guidance
}

const journeyOf = (slug) =>
  journeys.find(({ metadata }) => metadata.slug === slug)

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

  test.each(journeys)(
    'Should give $metadata.slug a submission kind for check your answers',
    ({ reportType }) => {
      expect(reportType.kind).toEqual(expect.any(String))
      expect(reportType.kind.length).toBeGreaterThan(0)
    }
  )

  test.each(journeys)(
    'Should apply the report file name rule throughout $metadata.slug',
    ({ definition }) => {
      const controllers = new Map(
        definition.pages.map((page) => [page.path, page.controller])
      )

      expect(controllers.get('/report-date')).toBe('ReportDatePageController')
      expect(controllers.get('/files-upload')).toBe(
        'ReportFileUploadPageController'
      )
      expect(controllers.get('/summary')).toBe(
        'SummaryPageWithConfirmationEmailController'
      )
    }
  )

  test.each(journeys)(
    'Should take a single required file on the upload page of $metadata.slug',
    ({ definition }) => {
      const uploadPage = definition.pages.find(
        (page) => page.path === '/files-upload'
      )
      const [guidance, fileUpload] = uploadPage.components

      expect(fileUpload.type).toBe('FileUploadField')
      expect(fileUpload.options.required).toBe(true)
      // max 1 makes the engine's picker single-file and stops it offering a
      // second upload once one file is attached
      expect(fileUpload.schema).toEqual({ max: 1 })
      expect(guidance.content).not.toMatch(/multiple/i)
      expect(guidance.content).toBe(
        'To upload the file, drag and drop it or choose it from your documents folder.'
      )
    }
  )

  test.each(journeys)(
    'Should explain the month covered on the report date page of $metadata.slug as its report type does',
    ({ reportType, definition }) => {
      expect(guidanceOf(definition, '/report-date').content).toBe(
        reportType.reportDateGuidance
      )
    }
  )

  test('Should count bat rabies samples by when they were received, with no deadline', () => {
    const { content } = guidanceOf(
      journeyOf('bat-rabies').definition,
      '/report-date'
    )

    expect(content).toContain(
      'The month your report covers is the month in which your lab received the samples.'
    )
    expect(content).toContain(
      "it will replace the one you've already uploaded."
    )
    expect(content).not.toMatch(/30 days/)
  })

  test('Should count Animal Health Regulations samples by when they were tested, within 30 days', () => {
    const { content } = guidanceOf(
      journeyOf('animal-health-regulations').definition,
      '/report-date'
    )

    expect(content).toContain(
      'The month your report covers is the month in which your lab tested the samples.'
    )
    expect(content).toContain(
      'You must submit the report within the 30 days that follow the end of the month your report covers.'
    )
    expect(content).toContain("you'll need to upload your whole report again.")
  })

  test.each(journeys)(
    'Should thank the user for the report once $metadata.slug is submitted',
    ({ metadata }) => {
      expect(metadata.submissionGuidance).toBe(
        'This reference number will be emailed to you. Please use it if you need to contact us about your report.\n\nThank you for your report.\n\nWe will contact you if we need more information.'
      )
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

  test.each(journeys)(
    'Should show the reference number, and no feedback link, when $metadata.slug is submitted',
    ({ definition }) => {
      expect(definition.options).toEqual({
        showReferenceNumber: true,
        disableUserFeedback: true
      })
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
