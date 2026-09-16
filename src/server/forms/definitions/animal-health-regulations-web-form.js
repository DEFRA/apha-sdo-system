/**
 * Animal Health Regulations report entered as a web form.
 *
 * The second way of submitting an AHR report: instead of uploading a data
 * file (see report-journey.js), the user answers the questions below and the
 * answers themselves are the report. Reached from the "How would you like to
 * report" screen and served at /{webFormSlug} by the forms-engine-plugin.
 *
 * The pages, lists and condition were designed in the Defra Forms Designer
 * (form "sdo-web-report") and are reproduced here with their identifiers, so
 * the journey can be compared with the design. Only the generated field and
 * list names were replaced with readable ones; the condition refers to
 * components and list items by id, so it is unaffected. The report date field
 * is named `reportDate` because the output service reads that answer to fill
 * `reportMonthYear` in submission.json, the same as the upload journey.
 *
 * Engine V2: the first page is the start page, pages follow in array order,
 * and a page with a `condition` is skipped unless the condition holds.
 */

import { reportTypesBySlug } from '../report-types.js'

const reportType = reportTypesBySlug.get('animal-health-regulations')

const now = new Date()
const user = { id: 'system', displayName: 'System' }

const author = {
  createdAt: now,
  createdBy: user,
  updatedAt: now,
  updatedBy: user
}

const PATHOGENS_LIST_ID = 'ddb93155-a4da-4c4e-997d-97304502ecce'
const SPECIES_LIST_ID = '66349b4d-1e7a-4df9-92f9-0e350623aa83'
const COUNTRIES_LIST_ID = '8bb3b2d3-48d7-42cb-82d8-0b693612cb71'

const SPECIES_FIELD_ID = '49552cdb-d6f9-431f-bf5a-21f6948f5b94'
const OTHER_SPECIES_ITEM_ID = 'ffd982a8-ac55-452a-aa1a-623cf0dec234'
const SPECIES_IS_OTHER_CONDITION_ID = '7105cc0a-1561-4582-96a4-cdf277acebc8'

const NUMBER_FIELD_OPTIONS = {
  required: true,
  classes: 'govuk-input--width-4',
  prefix: '',
  suffix: ''
}

export const metadata = {
  id: '17b14d64-0388-4057-b7d2-629169037f05',
  slug: reportType.webFormSlug,
  title: reportType.title,
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
  name: reportType.title,
  startPage: '/what-month-does-your-report-cover',
  sections: [],
  pages: [
    {
      id: '25512f3f-899f-44fe-87a9-621eceee7d67',
      path: '/what-month-does-your-report-cover',
      title: 'What month does your report cover?',
      components: [
        {
          id: '686b276a-fdd5-4c35-8d2e-01755b5f0f83',
          type: 'Markdown',
          content:
            'Submit results received during the reporting month and within 30 days of the month end.\n' +
            'You can submit older reports retrospectively, using this form\n' +
            '\n' +
            '## Reporting period\n' +
            'Enter the month and year your report covers.\n' +
            'For example, for results from August 2026, enter 08 2026',
          options: {},
          schema: {}
        },
        {
          id: 'c3f80afa-be88-4aad-af06-b762c8a4d72b',
          type: 'MonthYearField',
          name: 'reportDate',
          title: 'Add report date',
          shortDescription: 'Report Date',
          hint: '',
          options: {
            required: true
          },
          schema: {}
        }
      ]
    },
    {
      id: 'cf6d478e-37f4-45d3-a534-1be5662f7dd0',
      path: '/which-pathogen-was-tested',
      title: 'Which pathogen was tested?',
      components: [
        {
          id: 'b99a0dee-ff66-4b9a-be20-582b1f8aa204',
          type: 'Markdown',
          content:
            '## Important\n' +
            'Do not include PRRSV-2 or BVDV-2 in this report if they have been differenciated from PRRSV-1 or BVBV-1.\n' +
            'Report them separately using the [immediate reporting protocol](https://www.gov.uk/example){:target="_blank"}',
          options: {},
          schema: {}
        },
        {
          id: '895fc55c-4e8f-4658-8a33-b55806b5f080',
          type: 'SelectField',
          name: 'pathogen',
          title: 'Select the pathogen that was tested',
          shortDescription: 'Selected pathogen',
          hint: '',
          list: PATHOGENS_LIST_ID,
          options: {
            required: true
          },
          schema: {}
        }
      ]
    },
    {
      id: '0111e9e9-36d5-4d53-afbf-e8f954fd736a',
      path: '/which-species-was-tested',
      title: 'Which species was tested?',
      components: [
        {
          id: 'a16fd9e2-9178-41ce-ad63-4d3043fcc666',
          type: 'Markdown',
          content:
            'A submission may contain samples from multiple individual animals from the same premises as part of the investigation.\n' +
            'You can add another country or species report after completing this one.',
          options: {},
          schema: {}
        },
        {
          id: SPECIES_FIELD_ID,
          type: 'AutocompleteField',
          name: 'species',
          title: 'What species is the report for?',
          shortDescription: 'Species the report is for',
          hint: 'Start typing the name of the species. If the species is not on the list, select "Other" and enter it on the next screen.',
          list: SPECIES_LIST_ID,
          options: {
            required: true
          },
          schema: {}
        }
      ]
    },
    {
      id: 'a5d6bb63-ed7d-4dde-81a9-1d06ac125608',
      path: '/enter-other-species',
      title: 'Enter other species',
      condition: SPECIES_IS_OTHER_CONDITION_ID,
      components: [
        {
          id: 'b4f085e8-62ae-47c5-884c-59423e5416b2',
          type: 'Markdown',
          content: 'Enter the name of the species the report is for',
          options: {},
          schema: {}
        },
        {
          id: 'db751722-9009-4940-be55-f13eb3524444',
          type: 'TextField',
          name: 'otherSpecies',
          title: 'Other species',
          shortDescription: 'Other species',
          hint: 'Type the name of the species the report is for',
          options: {
            required: true,
            classes: ''
          },
          schema: {}
        }
      ]
    },
    {
      id: '65f121f0-c164-4d7c-ac5f-fadd1308c219',
      path: '/which-country-were-the-samples-collected-in',
      title: 'Which country were the samples collected in?',
      components: [
        {
          id: '34b90c01-403a-4456-ba65-aec254f9ee1e',
          type: 'Markdown',
          content:
            "Select where the samples were collected. Choose England, Scotland, Wales or Unknown (if you don't know where the samples were collected)",
          options: {},
          schema: {}
        },
        {
          id: 'e2b41ec2-71d2-455a-bf50-a65fa478bada',
          type: 'SelectField',
          name: 'country',
          title: 'Country',
          shortDescription: 'Country',
          hint: 'Select where the samples were collected.',
          list: COUNTRIES_LIST_ID,
          options: {
            required: true
          },
          schema: {}
        }
      ]
    },
    {
      id: 'f2925d3e-3d7a-43e5-9876-fad2177f3cf0',
      path: '/number-of-submissions-of-diagnostic-tests',
      title: 'Number of submissions of diagnostic tests',
      components: [
        {
          id: '925f35f5-e94f-46ca-952d-0edc7d5868a0',
          type: 'Markdown',
          content:
            'A submission may contain samples from multiple individual animals from the same premises as part of the investigation. You can add another country or species report after completing this one.\n' +
            '\n' +
            '# Enter number of submissions',
          options: {},
          schema: {}
        },
        {
          id: '54acf930-ea5e-40d1-bed5-1e50ce6cf676',
          type: 'NumberField',
          name: 'submissionsWithQualifyingTest',
          title:
            'Total submissions with at least one qualifying test (optional)',
          shortDescription: 'Submissions with at least one qualifying test',
          hint: '',
          options: NUMBER_FIELD_OPTIONS,
          schema: {}
        },
        {
          id: '3df02d89-99a3-44ed-a9fe-f029fe7268b3',
          type: 'NumberField',
          name: 'submissionsWithPositiveSamples',
          title:
            'Totals submissions that contained one or more positive samples',
          shortDescription: 'Submissions with at least one positive result',
          hint: '',
          options: NUMBER_FIELD_OPTIONS,
          schema: {}
        },
        {
          id: 'e7b8d99b-8572-438b-a6bc-514577d0a1d7',
          type: 'NumberField',
          name: 'positiveSamples',
          title: 'Total number of positive samples identified',
          shortDescription: 'Total positive submissions',
          hint: '',
          options: NUMBER_FIELD_OPTIONS,
          schema: {}
        }
      ]
    },
    {
      id: 'd6d1f2f3-3b76-457c-ab65-204c6ff85e50',
      path: '/summary',
      title: 'Check your answers before submitting',
      controller: 'SummaryPageWithConfirmationEmailController'
    }
  ],
  conditions: [
    {
      id: SPECIES_IS_OTHER_CONDITION_ID,
      displayName: 'Selected Species is "Other"',
      items: [
        {
          id: 'b5c812e8-cde0-438f-8ffe-853b5a5eed64',
          componentId: SPECIES_FIELD_ID,
          operator: 'is',
          type: 'ListItemRef',
          value: {
            itemId: [OTHER_SPECIES_ITEM_ID],
            listId: SPECIES_LIST_ID
          }
        }
      ]
    }
  ],
  lists: [
    {
      id: PATHOGENS_LIST_ID,
      name: 'pathogens',
      title: 'Pathogens',
      type: 'string',
      items: [
        {
          id: '39d43b06-3b12-427f-aa57-5c77580dbf4b',
          text: 'Pathogen 1',
          value: 'Pathogen 1',
          hint: {
            id: 'b98205b9-a2d4-4872-bd2f-e531ec8598e3',
            text: 'I am pathogen 1'
          }
        },
        {
          id: 'b15e31da-416d-4a00-8669-522149978441',
          text: 'Pathogen 2',
          value: 'Pathogen 2',
          hint: {
            id: 'f643b044-af78-4e8a-a2ca-d8eb5185f232',
            text: 'I am pathogen 2'
          }
        }
      ]
    },
    {
      id: SPECIES_LIST_ID,
      name: 'species',
      title: 'Species',
      type: 'string',
      items: [
        {
          id: 'b21f9fc1-fd1d-456a-81a4-27049096e57b',
          text: 'Chicken',
          value: 'Chicken'
        },
        {
          id: '4f3337dd-1047-4255-bca0-00c1bd183f2b',
          text: 'Turkey',
          value: 'Turkey'
        },
        {
          id: '1243cb40-c6e8-463a-9302-15bffda800c7',
          text: 'Bisson',
          value: 'Bisson'
        },
        {
          id: '5d2ef6cb-dfee-4a16-9ad8-369213b80eb3',
          text: 'Cattle',
          value: 'Cattle'
        },
        {
          id: 'd0ef001e-24b2-4df8-a90d-51917a6880bf',
          text: 'Buffalo',
          value: 'Buffalo'
        },
        {
          id: OTHER_SPECIES_ITEM_ID,
          text: 'Other',
          value: 'Other'
        }
      ]
    },
    {
      id: COUNTRIES_LIST_ID,
      name: 'countries',
      title: 'Countries',
      type: 'string',
      items: [
        {
          id: '06de1592-cd9c-424b-9dd0-12b1ac5c23db',
          text: 'England',
          value: 'England'
        },
        {
          id: 'b35b2953-3ade-41d4-b147-9ad709d5544f',
          text: 'Scotland',
          value: 'Scotland'
        },
        {
          id: 'a859acca-3f22-4658-8109-b27777b65321',
          text: 'Wales',
          value: 'Wales'
        },
        {
          id: 'fdf5348b-1387-4b19-ac0f-a3a00c741b90',
          text: 'Unknown',
          value: 'Unknown'
        }
      ]
    }
  ],
  options: {
    showReferenceNumber: true,
    disableUserFeedback: true
  }
}
