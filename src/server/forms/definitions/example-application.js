/**
 * Example application form.
 *
 * Demonstrates the pattern we will use for the real Applications journeys:
 * a form definition (engine V2) plus metadata, registered with the
 * forms-engine-plugin through src/server/forms/services/forms-service.js
 * and served at /{slug} (e.g. /example-application).
 *
 * A FileUploadField page (backed by cdp-uploader) will be added once the
 * uploader integration is in place.
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
  id: 'c7f1a2b3-d4e5-4f60-8a1b-2c3d4e5f6a70',
  slug: 'example-application',
  title: 'Example application',
  organisation: 'Defra',
  teamName: 'APHA SDO',
  teamEmail: 'sdo@apha.gov.uk',
  submissionGuidance:
    'Thank you for your application. We will process your submission and contact you if additional information is required.',
  notificationEmail: 'sdo@apha.gov.uk',
  ...author,
  live: author
}

export const definition = {
  engine: 'V2',
  schema: 2,
  name: 'Example application',
  startPage: '/applicant-details',
  sections: [
    {
      name: 'applicant',
      title: 'Applicant details'
    },
    {
      name: 'application',
      title: 'Application details'
    }
  ],
  pages: [
    {
      id: '9f8d7c6b-5a4e-4d3c-8b2a-1f0e9d8c7b6a',
      path: '/applicant-details',
      title: 'Applicant details',
      section: 'applicant',
      components: [
        {
          id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          type: 'TextField',
          name: 'applicantFullName',
          title: 'Full name',
          shortDescription: 'Full name',
          hint: 'Enter your full name as it appears on official documents',
          options: {
            required: true
          },
          schema: {
            max: 100
          }
        },
        {
          id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
          type: 'EmailAddressField',
          name: 'applicantEmail',
          title: 'Email address',
          shortDescription: 'Email address',
          hint: 'We will use this to contact you about your application',
          options: {
            required: true
          },
          schema: {}
        }
      ],
      next: [{ path: '/application-details' }]
    },
    {
      id: '8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b',
      path: '/application-details',
      title: 'Application details',
      section: 'application',
      components: [
        {
          id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
          type: 'RadiosField',
          name: 'applicationType',
          title: 'What type of application are you making?',
          shortDescription: 'Application type',
          hint: 'Select one option',
          options: {
            required: true
          },
          list: '7d6c5b4a-3f2e-4d1c-9b0a-8f7e6d5c4b3a'
        },
        {
          id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a',
          type: 'MonthYearField',
          name: 'reportingPeriod',
          title: 'Reporting period',
          shortDescription: 'Reporting period',
          hint: 'Month and year this application covers',
          options: {
            required: true,
            maxDaysInFuture: 0
          },
          schema: {}
        }
      ],
      next: [{ path: '/summary' }]
    },
    {
      id: '6f5e4d3c-2b1a-4f0e-8d9c-7b6a5f4e3d2c',
      path: '/summary',
      title: 'Check your answers before submitting',
      controller: 'SummaryPageController'
    }
  ],
  lists: [
    {
      id: '7d6c5b4a-3f2e-4d1c-9b0a-8f7e6d5c4b3a',
      name: 'applicationTypes',
      title: 'Application types',
      type: 'string',
      items: [
        {
          id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
          text: 'New application',
          value: 'new'
        },
        {
          id: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c',
          text: 'Renewal',
          value: 'renewal'
        },
        {
          id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
          text: 'Amendment to an existing application',
          value: 'amendment'
        }
      ]
    }
  ],
  conditions: []
}
