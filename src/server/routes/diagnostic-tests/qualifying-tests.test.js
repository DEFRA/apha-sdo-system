import { definition } from '#/server/forms/definitions/animal-health-regulations-web-form.js'
import {
  ACCREDITATION_OPTIONS,
  pathogens,
  tests,
  testsByKey
} from './qualifying-tests.js'

const ahrPathogenNames = definition.lists
  .find((list) => list.name === 'pathogens')
  .items.map((item) => item.value)

describe('qualifying tests catalogue', () => {
  test('Should offer the accreditations of a test in use, in order', () => {
    expect(ACCREDITATION_OPTIONS).toEqual(['Yes', 'No', 'Unknown'])
  })

  test('Should not offer "Not applicable": a test not in use is not ticked', () => {
    expect(ACCREDITATION_OPTIONS).not.toContain('Not applicable')
  })

  test('Should list the pathogens of the Animal Health Regulations report, by name', () => {
    expect(pathogens.map((pathogen) => pathogen.name)).toEqual(ahrPathogenNames)
  })

  test('Should give every pathogen at least one test', () => {
    for (const pathogen of pathogens) {
      expect(pathogen.tests.length).toBeGreaterThan(0)
    }
  })

  test("Should carry APHA's qualifying tests, in its order", () => {
    expect(tests).toHaveLength(26)
    expect(
      pathogens.map((pathogen) => [
        pathogen.key,
        pathogen.tests.map((test) => test.name)
      ])
    ).toEqual([
      ['mycoplasma', ['PCR', 'DGGE/PCR', 'culture']],
      ['campylobacter', ['Culture of Campylobacter foetus subsp venerealis']],
      [
        'bvdv',
        [
          'Antigen ELISA',
          'PCR differentiating BVDV-1 and BVDV-2',
          'PCR not differentiating BVDV-1 and BVDV-2',
          'Virus isolation',
          'immunohistochemistry'
        ]
      ],
      [
        'bhv',
        [
          'PCR (including gE PCR)',
          'Virus isolation',
          'Immunohistochemistry',
          'FAT',
          'gE ELISA (used for cattle vaccinated with marker live vaccine)'
        ]
      ],
      [
        'map',
        [
          'PCR',
          'Histology',
          'ZN smear',
          'Liquid culture',
          'Indirect antibody ELISA',
          'Complement Fixation Test'
        ]
      ],
      [
        'prrsv',
        [
          'PCR differentiating PRRSV-1 and PRRSV-2',
          'PCR not differentiating PRRSV-1 and PRRSV-2',
          'Virus isolation',
          'immunohistochemistry'
        ]
      ],
      [
        'tritrichomonas',
        ['Culture & microscopy of Tritrichomonas foetus', 'PCR']
      ]
    ])
  })

  test('Should give every test a key that is unique across pathogens', () => {
    const keys = tests.map((test) => test.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(testsByKey.size).toBe(keys.length)
  })

  test('Should name each test key after its pathogen, so ids read naturally', () => {
    for (const test of tests) {
      expect(test.key.startsWith(`${test.pathogen.key}-`)).toBe(true)
      expect(test.key).toMatch(/^[a-z0-9-]+$/)
    }
  })

  test('Should resolve a key to its test and pathogen', () => {
    expect(testsByKey.get('bhv-fat')).toEqual({
      key: 'bhv-fat',
      name: 'FAT',
      pathogen: { key: 'bhv', name: 'Bovine Herpes Virus 1 (BHV-1)' }
    })
    expect(testsByKey.get('not-a-test')).toBeUndefined()
  })

  test('Should keep the tests in catalogue order', () => {
    expect(tests.slice(0, 4).map((test) => test.key)).toEqual([
      'mycoplasma-pcr',
      'mycoplasma-dgge-pcr',
      'mycoplasma-culture',
      'campylobacter-culture'
    ])
  })
})
