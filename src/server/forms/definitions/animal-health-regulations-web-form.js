/**
 * Animal Health Regulations report entered as a web form.
 *
 * The second way of submitting an AHR report: instead of uploading a data
 * file (see report-journey.js), the user answers the questions below and the
 * answers themselves are the report. Reached from the "How would you like to
 * report" screen and served at /{webFormSlug} by the forms-engine-plugin.
 *
 * The pages, lists and conditions were designed in the Defra Forms Designer
 * (form "sdo-web-report") and are reproduced here with their identifiers, so
 * the journey can be compared with the design. The generated field and list
 * names were replaced with readable ones; the conditions refer to components
 * and list items by id, so they are unaffected. The report date field is
 * named `reportDate` because the output service reads that answer to fill
 * `reportMonthYear` in submission.json, the same as the upload journey.
 *
 * Where this file goes beyond the design, it says so at the place: the
 * "Important" notification banner, the species offered per pathogen (extra
 * species and conditions), the counts being whole non-negative numbers, and
 * the report entries page.
 *
 * A report can carry several entries (one per pathogen, species and country),
 * so the five pages from pathogen to counts are answered once per entry. The
 * engine only repeats single pages, so those pages belong to the `entries`
 * section and are served by ReportEntryPageController, which keeps each
 * entry's answers under `state.entries[]` (see
 * src/server/forms/controllers/report-entries.js). The report entries page
 * that follows them is not in the design: it lists the entries added so far
 * and offers "Add another entry to the report".
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

const PATHOGEN_FIELD_ID = '895fc55c-4e8f-4658-8a33-b55806b5f080'
const SPECIES_FIELD_ID = '49552cdb-d6f9-431f-bf5a-21f6948f5b94'
const OTHER_SPECIES_ITEM_ID = 'ffd982a8-ac55-452a-aa1a-623cf0dec234'
const SPECIES_IS_OTHER_CONDITION_ID = '7105cc0a-1561-4582-96a4-cdf277acebc8'

// The pathogens, by list item id, and the conditions that show a species
// only for the pathogens it is reported for
const PATHOGENS = {
  mycoplasma: '57faaaa0-0121-4027-bd2f-39e04ff336bf',
  campylobacter: '0feaa881-d0cb-4cff-9a08-df66c90ee2d0',
  bvdv: 'f41b569c-e86e-4661-9545-2df884d7a22a',
  bhv: '693b205b-7805-457e-83eb-f9f565326a87',
  map: 'ed795271-43c8-4040-8f50-bff84ed35be6',
  prrsv: 'cbdb34fe-4990-4c21-a3e6-d06802732ae2',
  tritrichomonas: '67fec981-093e-4d7d-9565-9e290316dfa6'
}

// Designed as "Is Avian mycoplasmosis" (form "sdo-web-report")
const PATHOGEN_IS_MYCOPLASMA_CONDITION_ID =
  'db827126-c5d6-4751-957d-9800f0f7c68c'
const PATHOGEN_IS_BOVINE_CONDITION_ID = '4f2b8d1c-6a3e-4c7f-9b0d-2e5a8c1f6d3b'
const PATHOGEN_IS_MAP_CONDITION_ID = '8c1d5e2a-3f7b-4a9c-8d6e-1b4f7a2c9e5d'
const PATHOGEN_IS_PRRSV_CONDITION_ID = 'a7e3c9f1-2d8b-4e6a-b5c0-9f1d3a7e8b2c'

// The pages answered once per entry. The section title, numbered, is the
// caption of each of them ("Entry 1"), and names an entry on the report
// entries page and on check your answers.
const ENTRIES_SECTION_ID = 'e4a1c6d2-5b7f-4e38-9a0c-2d6f8b1e3c57'
const ENTRY_PAGE_CONTROLLER = 'ReportEntryPageController'

const NUMBER_FIELD_OPTIONS = {
  required: true,
  classes: 'govuk-input--width-4',
  prefix: '',
  suffix: ''
}

// The counts are whole numbers of submissions and samples, never negative.
// The design leaves this open; precision 0 makes the engine require an
// integer.
const COUNT_SCHEMA = { min: 0, precision: 0 }

/**
 * A condition that holds when the selected pathogen is one of the given ones
 * @param {string} id - condition id
 * @param {string} itemId - id of the condition's single item
 * @param {string} displayName - how the designer names it
 * @param {string[]} pathogenItemIds - ids of the pathogen list items
 */
function pathogenCondition(id, itemId, displayName, pathogenItemIds) {
  return {
    id,
    displayName,
    items: [
      {
        id: itemId,
        componentId: PATHOGEN_FIELD_ID,
        operator: 'is',
        type: 'ListItemRef',
        value: { itemId: pathogenItemIds, listId: PATHOGENS_LIST_ID }
      }
    ]
  }
}

/**
 * A species offered only while the given condition holds
 * @param {string} id - list item id
 * @param {string} name - the species, shown and stored as is
 * @param {string} condition - id of the pathogen condition
 */
function speciesItem(id, name, condition) {
  return { id, text: name, value: name, condition }
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
  sections: [
    {
      id: ENTRIES_SECTION_ID,
      name: 'entries',
      title: 'Entry'
    }
  ],
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
      section: ENTRIES_SECTION_ID,
      controller: ENTRY_PAGE_CONTROLLER,
      components: [
        {
          // Designed as Markdown headed "Important"; shown as a GOV.UK
          // notification banner above the page heading instead
          id: 'b99a0dee-ff66-4b9a-be20-582b1f8aa204',
          type: 'NotificationBanner',
          title: 'Important',
          content:
            'Do not include PRRSV-2 or BVDV-2 in this report if they have been differenciated from PRRSV-1 or BVBV-1.\n' +
            'Report them separately using the [immediate reporting protocol](https://www.gov.uk/example){:target="_blank"}',
          options: {},
          schema: {}
        },
        {
          id: PATHOGEN_FIELD_ID,
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
      section: ENTRIES_SECTION_ID,
      controller: ENTRY_PAGE_CONTROLLER,
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
          hint: 'Start typing the name of the species. If the species is not on the list, select "Other" and enter it on the next page.',
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
      section: ENTRIES_SECTION_ID,
      controller: ENTRY_PAGE_CONTROLLER,
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
      section: ENTRIES_SECTION_ID,
      controller: ENTRY_PAGE_CONTROLLER,
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
      section: ENTRIES_SECTION_ID,
      controller: ENTRY_PAGE_CONTROLLER,
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
          // Designed as "(optional)", but required like the other counts
          title: 'Total submissions with at least one qualifying test',
          shortDescription: 'Submissions with at least one qualifying test',
          hint: '',
          options: NUMBER_FIELD_OPTIONS,
          schema: COUNT_SCHEMA
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
          schema: COUNT_SCHEMA
        },
        {
          id: 'e7b8d99b-8572-438b-a6bc-514577d0a1d7',
          type: 'NumberField',
          name: 'positiveSamples',
          title: 'Total number of positive samples identified',
          shortDescription: 'Total positive submissions',
          hint: '',
          options: NUMBER_FIELD_OPTIONS,
          schema: COUNT_SCHEMA
        }
      ]
    },
    {
      // Not in the design: lists the entries added so far, with "Add another
      // entry to the report" and "Continue" (see ReportEntriesPageController)
      id: '3c9d7e5f-1a2b-4c8d-9e0f-6b5a4d3c2e1f',
      path: '/report-entries',
      title: 'Report entries',
      controller: 'ReportEntriesPageController',
      components: []
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
    },
    // Which species are offered depends on the pathogen: several pathogen
    // ids in one condition means "any of them"
    pathogenCondition(
      PATHOGEN_IS_MYCOPLASMA_CONDITION_ID,
      'ef85f195-c4d1-4501-9cc6-06c76e536e34',
      'Is Avian mycoplasmosis',
      [PATHOGENS.mycoplasma]
    ),
    pathogenCondition(
      PATHOGEN_IS_BOVINE_CONDITION_ID,
      'c2d9f4a6-1e7b-4b3c-8a5d-6f0e2b9c4d1a',
      'Pathogen is reported for cattle, bison and buffalo',
      [
        PATHOGENS.campylobacter,
        PATHOGENS.bvdv,
        PATHOGENS.bhv,
        PATHOGENS.map,
        PATHOGENS.tritrichomonas
      ]
    ),
    pathogenCondition(
      PATHOGEN_IS_MAP_CONDITION_ID,
      '5b8e2c7d-9a1f-4d6b-b3e8-7c4a0f2d9e6b',
      'Pathogen is Mycobacterium avium subsp. paratuberculosis',
      [PATHOGENS.map]
    ),
    pathogenCondition(
      PATHOGEN_IS_PRRSV_CONDITION_ID,
      'e6a1d8b3-4c2f-4e9a-a7d5-0b3c8f1e2a9d',
      'Pathogen is PRRSV',
      [PATHOGENS.prrsv]
    )
  ],
  lists: [
    {
      id: PATHOGENS_LIST_ID,
      name: 'pathogens',
      title: 'Pathogens',
      type: 'string',
      items: [
        {
          id: '57faaaa0-0121-4027-bd2f-39e04ff336bf',
          text: 'Mycoplasma gallisepticum / M. meleagridis',
          value: 'Mycoplasma gallisepticum / M. meleagridis'
        },
        {
          id: '0feaa881-d0cb-4cff-9a08-df66c90ee2d0',
          text: 'Campylobacter fetus subsp. venerealis',
          value: 'Campylobacter fetus subsp. venerealis'
        },
        {
          id: 'f41b569c-e86e-4661-9545-2df884d7a22a',
          text: 'Bovine Virus Diarrhoea Virus 1 (BVDV-1) or BVDV (-1 and -2 not differentiated)',
          value:
            'Bovine Virus Diarrhoea Virus 1 (BVDV-1) or BVDV (-1 and -2 not differentiated)'
        },
        {
          id: '693b205b-7805-457e-83eb-f9f565326a87',
          text: 'Bovine Herpes Virus 1 (BHV-1)',
          value: 'Bovine Herpes Virus 1 (BHV-1)'
        },
        {
          id: 'ed795271-43c8-4040-8f50-bff84ed35be6',
          text: 'Mycobacterium avium subsp. paratuberculosis (Map)',
          value: 'Mycobacterium avium subsp. paratuberculosis (Map)'
        },
        {
          id: 'cbdb34fe-4990-4c21-a3e6-d06802732ae2',
          text: 'Porcine reproductive and respiratory syndrome virus - 1 (PRRSV-1) or PRRSV (-1 and -2 not differentiated)',
          value:
            'Porcine reproductive and respiratory syndrome virus - 1 (PRRSV-1) or PRRSV (-1 and -2 not differentiated)'
        },
        {
          id: '67fec981-093e-4d7d-9565-9e290316dfa6',
          text: 'Tritrichomonas foetus',
          value: 'Tritrichomonas foetus'
        }
      ]
    },
    {
      // Each species is offered for the pathogens it is reported for (see
      // the pathogen conditions); "Other" is offered for every pathogen
      id: SPECIES_LIST_ID,
      name: 'species',
      title: 'Species',
      type: 'string',
      items: [
        speciesItem(
          'b21f9fc1-fd1d-456a-81a4-27049096e57b',
          'Chicken',
          PATHOGEN_IS_MYCOPLASMA_CONDITION_ID
        ),
        speciesItem(
          '4f3337dd-1047-4255-bca0-00c1bd183f2b',
          'Turkey',
          PATHOGEN_IS_MYCOPLASMA_CONDITION_ID
        ),
        speciesItem(
          '5d2ef6cb-dfee-4a16-9ad8-369213b80eb3',
          'Domestic cattle',
          PATHOGEN_IS_BOVINE_CONDITION_ID
        ),
        speciesItem(
          '2f7c4a9e-8d1b-4e5f-a6c3-9b0d7e2f1a8c',
          'Sheep',
          PATHOGEN_IS_MAP_CONDITION_ID
        ),
        speciesItem(
          '9d3e1b6f-2a8c-4f7d-b4e9-1c5a8d0f3b7e',
          'Goat',
          PATHOGEN_IS_MAP_CONDITION_ID
        ),
        speciesItem(
          '6a2f8e4c-5b9d-4c1a-8f3e-7d0b2c9a5e1f',
          'Deer',
          PATHOGEN_IS_MAP_CONDITION_ID
        ),
        speciesItem(
          '3c9b7d2e-1f4a-4b8c-9e6d-5a2f0c8b4d7a',
          'Camelid',
          PATHOGEN_IS_MAP_CONDITION_ID
        ),
        speciesItem(
          '1243cb40-c6e8-463a-9302-15bffda800c7',
          'Bison',
          PATHOGEN_IS_BOVINE_CONDITION_ID
        ),
        speciesItem(
          'd0ef001e-24b2-4df8-a90d-51917a6880bf',
          'Buffalo',
          PATHOGEN_IS_BOVINE_CONDITION_ID
        ),
        speciesItem(
          'b8f5c3a1-7e2d-4a9f-8c6b-0d4e1f9a3c2b',
          'Domestic pig',
          PATHOGEN_IS_PRRSV_CONDITION_ID
        ),
        speciesItem(
          '7e4d2b9c-3a6f-4d1e-9b8a-2c5f0e7d4a1b',
          'Wild boar',
          PATHOGEN_IS_PRRSV_CONDITION_ID
        ),
        {
          id: OTHER_SPECIES_ITEM_ID,
          text: 'Other (please specify on the next page)',
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
