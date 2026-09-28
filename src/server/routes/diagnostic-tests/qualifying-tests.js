/**
 * The qualifying tests a lab can declare on the "Define your qualifying tests
 * in use" page, grouped by the pathogen they diagnose. The pathogens are the
 * ones an Animal Health Regulations report is made for, named exactly as in
 * that web form's pathogen list (see
 * src/server/forms/definitions/animal-health-regulations-web-form.js), so a
 * declared test can be matched to the reports that follow.
 *
 * The tests are APHA's qualifying diagnostic tests for these pathogens, in
 * the order APHA lists them. Test names are reproduced from the design as
 * they were given, including their capitalisation; where the design had one
 * PCR for BVDV and for PRRSV, APHA's list has two (differentiating or not the
 * -1 and -2 strains), and those two are offered.
 *
 * `key` identifies a test in the form (the checkbox value and the element
 * ids) and is unique across pathogens, so a posted value resolves to its
 * pathogen without ambiguity.
 */

/**
 * The accreditations a ticked test can be given. "Not applicable" is not one:
 * a test that is not in use is simply not ticked.
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

/**
 * Every test with its pathogen, in catalogue order: the order the page lists
 * them in and the order they are recorded in.
 * @type {{ key: string, name: string, pathogen: { key: string, name: string } }[]}
 */
export const tests = pathogens.flatMap(
  ({ tests: pathogenTests, ...pathogen }) =>
    pathogenTests.map((test) => ({ ...test, pathogen }))
)

/** A posted checkbox value resolved to its test, or undefined when unknown */
export const testsByKey = new Map(tests.map((test) => [test.key, test]))
