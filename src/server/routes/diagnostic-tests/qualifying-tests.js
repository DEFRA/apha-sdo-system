/**
 * The qualifying tests a lab can declare on the "Define your qualifying tests
 * in use" page, grouped by the pathogen they diagnose. The pathogens are the
 * ones an Animal Health Regulations report is made for, named exactly as in
 * that web form's pathogen list (see
 * src/server/forms/definitions/animal-health-regulations-web-form.js), so a
 * declared test can be matched to the reports that follow.
 *
 * The tests are those of APHA's "Define diagnostic tests in use" workbook
 * (templates/diagnostic-tests-template.xlsx), in its row order, because the
 * declaration is delivered as that workbook filled in (see
 * diagnostic-tests-workbook.js): the n-th test here is written to the n-th
 * test row of the sheet. Test names are reproduced from the design as they
 * were given, including their capitalisation; where the design had one PCR
 * and the workbook two (differentiating or not the -1 and -2 strains), the
 * workbook's two are offered.
 *
 * `key` identifies a test in the form (the checkbox value and the element
 * ids) and is unique across pathogens, so a posted value resolves to its
 * pathogen without ambiguity.
 */

/**
 * The accreditations a ticked test can be given. The workbook's fourth
 * value, "Not applicable", is what an un-ticked row carries, so it is not
 * offered for a test in use.
 */
export const ACCREDITATION_OPTIONS = ['Yes', 'No', 'Unknown']

// Test names several pathogens share
const VIRUS_ISOLATION = 'Virus isolation'

export const pathogens = [
  {
    key: 'mycoplasma',
    name: 'Mycoplasma gallisepticum / M. meleagridis',
    tests: [
      { key: 'mycoplasma-pcr', name: 'PCR' },
      { key: 'mycoplasma-dgge-pcr', name: 'DGGE/PCR' },
      { key: 'mycoplasma-culture', name: 'culture' }
    ]
  },
  {
    key: 'campylobacter',
    name: 'Campylobacter fetus subsp. venerealis',
    tests: [
      {
        key: 'campylobacter-culture',
        name: 'Culture of Campylobacter foetus subsp venerealis'
      }
    ]
  },
  {
    key: 'bvdv',
    name: 'Bovine Virus Diarrhoea Virus 1 (BVDV-1) or BVDV (-1 and -2 not differentiated)',
    tests: [
      { key: 'bvdv-antigen-elisa', name: 'Antigen ELISA' },
      {
        key: 'bvdv-pcr-differentiating',
        name: 'PCR differentiating BVDV-1 and BVDV-2'
      },
      {
        key: 'bvdv-pcr-not-differentiating',
        name: 'PCR not differentiating BVDV-1 and BVDV-2'
      },
      { key: 'bvdv-virus-isolation', name: VIRUS_ISOLATION },
      { key: 'bvdv-immunohistochemistry', name: 'immunohistochemistry' }
    ]
  },
  {
    key: 'bhv',
    name: 'Bovine Herpes Virus 1 (BHV-1)',
    tests: [
      { key: 'bhv-pcr', name: 'PCR (including gE PCR)' },
      { key: 'bhv-virus-isolation', name: VIRUS_ISOLATION },
      { key: 'bhv-immunohistochemistry', name: 'Immunohistochemistry' },
      { key: 'bhv-fat', name: 'FAT' },
      {
        key: 'bhv-ge-elisa',
        name: 'gE ELISA (used for cattle vaccinated with marker live vaccine)'
      }
    ]
  },
  {
    key: 'map',
    name: 'Mycobacterium avium subsp. paratuberculosis (Map)',
    tests: [
      { key: 'map-pcr', name: 'PCR' },
      { key: 'map-histology', name: 'Histology' },
      { key: 'map-zn-smear', name: 'ZN smear' },
      { key: 'map-liquid-culture', name: 'Liquid culture' },
      { key: 'map-indirect-antibody-elisa', name: 'Indirect antibody ELISA' },
      { key: 'map-complement-fixation-test', name: 'Complement Fixation Test' }
    ]
  },
  {
    key: 'prrsv',
    name: 'Porcine reproductive and respiratory syndrome virus - 1 (PRRSV-1) or PRRSV (-1 and -2 not differentiated)',
    tests: [
      {
        key: 'prrsv-pcr-differentiating',
        name: 'PCR differentiating PRRSV-1 and PRRSV-2'
      },
      {
        key: 'prrsv-pcr-not-differentiating',
        name: 'PCR not differentiating PRRSV-1 and PRRSV-2'
      },
      { key: 'prrsv-virus-isolation', name: VIRUS_ISOLATION },
      { key: 'prrsv-immunohistochemistry', name: 'immunohistochemistry' }
    ]
  },
  {
    key: 'tritrichomonas',
    name: 'Tritrichomonas foetus',
    tests: [
      {
        key: 'tritrichomonas-culture-microscopy',
        name: 'Culture & microscopy of Tritrichomonas foetus'
      },
      { key: 'tritrichomonas-pcr', name: 'PCR' }
    ]
  }
]

/** The sheet row of the first test in the workbook; the tests follow in order */
export const FIRST_XLS_ROW = 6

/**
 * Every test with its pathogen and its row in the workbook, in catalogue
 * order: the order the page lists them in and the order the sheet holds them.
 * @type {{ key: string, name: string, xlsRow: number, pathogen: { key: string, name: string } }[]}
 */
export const tests = pathogens
  .flatMap(({ tests: pathogenTests, ...pathogen }) =>
    pathogenTests.map((test) => ({ ...test, pathogen }))
  )
  .map((test, index) => ({ ...test, xlsRow: FIRST_XLS_ROW + index }))

/** A posted checkbox value resolved to its test, or undefined when unknown */
export const testsByKey = new Map(tests.map((test) => [test.key, test]))
