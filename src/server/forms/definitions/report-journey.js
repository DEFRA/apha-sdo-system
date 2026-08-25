/**
 * Builds a report submission journey (engine V2) from a report type defined in
 * src/server/forms/report-types.js. Every report type gets the same pages in
 * the same order — report date, file upload, check your answers — so the only
 * differences are the slug, the copy and the identifiers.
 *
 * Served at /{slug} by the forms-engine-plugin, e.g. /bat-rabies/report-date.
 */

const now = new Date()
const user = { id: 'system', displayName: 'System' }

const author = {
  createdAt: now,
  createdBy: user,
  updatedAt: now,
  updatedBy: user
}

const SPREADSHEET_MIME_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
].join(',')

export function createReportJourney(reportType) {
  const { slug, title, reportDateHint, ids } = reportType

  const metadata = {
    id: ids.form,
    slug,
    title,
    organisation: 'Defra',
    teamName: 'APHA SDO',
    teamEmail: 'sdo@apha.gov.uk',
    submissionGuidance:
      'Thank you for your submission. We will process it and contact you if additional information is required.',
    notificationEmail: 'sdo@apha.gov.uk',
    ...author,
    live: author
  }

  const definition = {
    engine: 'V2',
    schema: 2,
    name: title,
    startPage: '/report-date',
    sections: [],
    pages: [
      {
        id: ids.reportDatePage,
        path: '/report-date',
        title: 'Report date',
        components: [
          {
            id: ids.reportDateField,
            type: 'MonthYearField',
            name: 'reportDate',
            title: 'Report date',
            shortDescription: 'Report date',
            hint: reportDateHint,
            options: {
              required: true
            },
            schema: {}
          }
        ],
        next: [{ path: '/files-upload' }]
      },
      {
        id: ids.filesUploadPage,
        path: '/files-upload',
        title: 'Upload supporting documents',
        controller: 'FileUploadPageController',
        components: [
          {
            id: ids.filesUploadField,
            type: 'FileUploadField',
            name: 'supportingDocuments',
            title: 'Files upload',
            shortDescription: 'Supporting documents',
            hint: 'Upload laboratory results spreadsheet. Only csv, xls and xlsx files are supported.',
            options: {
              required: true,
              accept: SPREADSHEET_MIME_TYPES
            },
            schema: {}
          }
        ],
        next: [{ path: '/summary' }]
      },
      {
        id: ids.summaryPage,
        path: '/summary',
        title: 'Check your answers before submitting',
        controller: 'SummaryPageWithConfirmationEmailController'
      }
    ],
    lists: [],
    conditions: []
  }

  return { metadata, definition }
}
