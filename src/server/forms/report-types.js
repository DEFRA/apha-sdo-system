/**
 * The report types a signed-in user can submit. This is the single source of
 * truth: the Submission Welcome radios are built from it, and each entry is
 * turned into a form journey served at /{slug} by
 * src/server/forms/definitions/report-journey.js.
 *
 * The journeys are identical in structure, so an entry only carries what
 * differs: the URL slug, the copy, and the identifiers.
 *
 * `title` is the report type's one label, used for the radio option, the form
 * title and the breadcrumb, so those cannot disagree with each other.
 *
 * IDs are hardcoded rather than generated so that form and page identifiers
 * stay stable across restarts and deployments.
 */
export const reportTypes = [
  {
    slug: 'bat-rabies',
    title: 'Bat rabies report',
    optionHint: 'Upload a data file (CSV, XLS or XLSX)',
    ids: {
      form: 'b4c2d8e1-7f3a-4b96-9d05-8e6f1a2c3d40',
      reportDatePage: 'd06a6bbe-d570-4348-aec8-4b454bea9c1b',
      reportDateGuidance: '3a48b8fb-f9b7-434d-a75f-f95b94c78fee',
      reportDateField: 'bf2ebb57-b089-4103-9208-f68669dd7daf',
      filesUploadPage: '7bbc42ea-da26-410b-ad7a-ad3d0ff9e22f',
      filesUploadGuidance: 'ec8b0f37-44a9-4abe-9544-f61ffaa3d9bd',
      filesUploadField: '7cba6106-28d6-41fd-989f-fe81f009fcd1',
      summaryPage: '449a45f6-4541-4a46-91bd-8b8931b07b50'
    }
  },
  {
    slug: 'animal-health-regulations',
    title: 'Animal Health Regulations report',
    optionHint: 'Upload a data file (CSV, XLS or XLSX)',
    ids: {
      form: '2f9a5c17-3b48-4e0d-9a61-c5d7e8f01234',
      reportDatePage: '5c1e7a92-8d34-4b6f-a0c8-1e2f3a4b5c6d',
      reportDateGuidance: 'b5f6b2b5-9dc9-4ff3-9ea7-677d82759eeb',
      reportDateField: 'a71b4d38-6e29-4c05-8f1a-9b0c1d2e3f40',
      filesUploadPage: '38e6c05a-1f47-4d92-b8e3-6a5f4c3b2a19',
      filesUploadGuidance: 'b8fdd1e3-dbc9-463a-9103-2b912952d451',
      filesUploadField: 'c02d9f65-4a83-4e17-9b52-7d8e9f0a1b2c',
      summaryPage: '9b4f2e81-7c56-4a3d-8e09-2f1a0b9c8d7e'
    }
  }
]

export const reportTypesBySlug = new Map(
  reportTypes.map((reportType) => [reportType.slug, reportType])
)
