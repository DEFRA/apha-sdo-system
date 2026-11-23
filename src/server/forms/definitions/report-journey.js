/**
 * Builds a report submission journey (engine V2) from a report type defined in
 * src/server/forms/report-types.js. Every report type gets the same pages in
 * the same order — report date, file upload, check your answers — so the only
 * differences are the slug, the copy and the identifiers. A report is one
 * data file, so the upload page takes a single file.
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

const REPORT_DATE_PAGE_TITLE = 'What month does your report cover?'

const REPORT_DATE_TITLE = 'Month covered'

const REPORT_DATE_HINT = 'For example, 08 2026'

const FILE_UPLOAD_GUIDANCE =
  'To upload the file, drag and drop it or choose it from your documents folder.'

// Under "Report submitted" and the reference number on the confirmation page,
// shared with the web form
export const REPORT_SUBMISSION_GUIDANCE =
  'This reference number will be emailed to you. Please use it if you need to contact us about your report.\n' +
  '\n' +
  'Thank you for your report.\n' +
  '\n' +
  'We will contact you if we need more information.'

function createPages({ ids, reportDateGuidance }) {
  return [
    {
      id: ids.reportDatePage,
      path: '/report-date',
      title: REPORT_DATE_PAGE_TITLE,
      controller: 'ReportDatePageController',
      components: [
        {
          id: ids.reportDateGuidance,
          type: 'Markdown',
          content: reportDateGuidance,
          options: {},
          schema: {}
        },
        {
          id: ids.reportDateField,
          type: 'MonthYearField',
          name: 'reportDate',
          title: REPORT_DATE_TITLE,
          shortDescription: 'Month your report covers',
          hint: REPORT_DATE_HINT,
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
      title: 'Upload your report',
      controller: 'ReportFileUploadPageController',
      components: [
        {
          id: ids.filesUploadGuidance,
          type: 'Markdown',
          content: FILE_UPLOAD_GUIDANCE,
          options: {},
          schema: {}
        },
        {
          id: ids.filesUploadField,
          type: 'FileUploadField',
          name: 'supportingDocuments',
          title: 'File upload',
          shortDescription: 'File uploaded',
          errorDescription: 'a file',
          hint: 'Only CSV, XLS and XLSX files are accepted.',
          options: {
            required: true,
            accept: SPREADSHEET_MIME_TYPES
          },
          // One file per report: the file picker takes a single file and the
          // engine stops offering an upload once one is attached
          schema: {
            max: 1
          }
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
  ]
}

export function createReportJourney(reportType) {
  const { slug, title, ids } = reportType

  const metadata = {
    id: ids.form,
    slug,
    title,
    organisation: 'Defra',
    teamName: 'APHA SDO',
    teamEmail: 'sdo@apha.gov.uk',
    submissionGuidance: REPORT_SUBMISSION_GUIDANCE,
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
    pages: createPages(reportType),
    lists: [],
    conditions: [],
    options: {
      // The confirmation page names the reference so the user can quote it,
      // the same as the web form journey. The engine's feedback link points
      // at a route this service does not serve, so it is left out.
      showReferenceNumber: true,
      disableUserFeedback: true
    }
  }

  return { metadata, definition }
}
