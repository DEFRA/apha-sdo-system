/**
 * SDO test form, served at /sdo-test. Exercises the file upload journey
 * (FileUploadPageController backed by cdp-uploader).
 */

const now = new Date()
const user = { id: 'system', displayName: 'System' }

const author = {
  createdAt: now,
  createdBy: user,
  updatedAt: now,
  updatedBy: user
}

export const metadata = {
  id: 'b4c2d8e1-7f3a-4b96-9d05-8e6f1a2c3d40',
  slug: 'sdo-test',
  title: 'SDO test',
  organisation: 'Defra',
  teamName: 'APHA SDO',
  teamEmail: 'sdo@apha.gov.uk',
  submissionGuidance:
    'Thank you for your submission. We will process it and contact you if additional information is required.',
  notificationEmail: 'sdo@apha.gov.uk',
  ...author,
  live: author
}

export const definition = {
  engine: 'V2',
  schema: 2,
  name: 'SDO test',
  startPage: '/report-date',
  sections: [],
  pages: [
    {
      id: 'd06a6bbe-d570-4348-aec8-4b454bea9c1b',
      path: '/report-date',
      title: 'Report date',
      components: [
        {
          id: 'bf2ebb57-b089-4103-9208-f68669dd7daf',
          type: 'MonthYearField',
          name: 'reportDate',
          title: 'Report date',
          shortDescription: 'Report date',
          hint: 'Month and year when bat submissions were tested',
          options: {
            required: true
          },
          schema: {}
        }
      ],
      next: [{ path: '/files-upload' }]
    },
    {
      id: '7bbc42ea-da26-410b-ad7a-ad3d0ff9e22f',
      path: '/files-upload',
      title: 'Upload supporting documents',
      controller: 'FileUploadPageController',
      components: [
        {
          id: '7cba6106-28d6-41fd-989f-fe81f009fcd1',
          type: 'FileUploadField',
          name: 'supportingDocuments',
          title: 'Files upload',
          shortDescription: 'Supporting documents',
          hint: 'Upload laboratory results spreadsheet. Only csv, xls and xlsx files are supported.',
          options: {
            required: true,
            accept:
              'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
          },
          schema: {}
        }
      ],
      next: [{ path: '/summary' }]
    },
    {
      id: '449a45f6-4541-4a46-91bd-8b8931b07b50',
      path: '/summary',
      title: 'Check your answers before submitting',
      controller: 'SummaryPageWithConfirmationEmailController'
    }
  ],
  lists: [],
  conditions: []
}
