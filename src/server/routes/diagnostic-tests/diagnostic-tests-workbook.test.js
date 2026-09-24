import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'

import {
  DIAGNOSTIC_TESTS_FILE_NAME,
  NOT_IN_USE_ACCREDITATION,
  XLSX_CONTENT_TYPE,
  buildDiagnosticTestsWorkbook
} from './diagnostic-tests-workbook.js'
import { ACCREDITATION_OPTIONS, tests, testsByKey } from './qualifying-tests.js'

const TEMPLATE_PATH = new URL(
  './templates/diagnostic-tests-template.xlsx',
  import.meta.url
)
const SHEET_PART = 'xl/worksheets/sheet1.xml'
const WORKBOOK_PART = 'xl/workbook.xml'
const VML_PART = 'xl/drawings/vmlDrawing1.vml'

// The rows of the template's first sheet, as the design has them
const TEMPLATE_TEST_NAMES_BY_ROW = [
  'PCR',
  'DGGE/PCR',
  'Culture',
  'Culture of Campylobacter foetus subsp venerealis',
  'Antigen ELISA',
  'PCR differentiating BVDV-1 and BVDV-2 ',
  'PCR not differentiating BVDV-1 and BVDV-2',
  'Virus isolation',
  'Immunohistochemistry',
  'PCR (including gE PCR)',
  'Virus isolation',
  'Immunohistochemistry',
  'FAT',
  'gE ELISA (used for cattle vaccinated with marker live vaccine)',
  'PCR',
  'Histology',
  'ZN smear',
  'Liquid culture',
  'Indirect antibody ELISA',
  'Complement-fixation test',
  'PCR differentiating PRRSV-1 and PRRSV-2 ',
  'PCR not differentiating PRRSV-1 and PRRSV-2',
  'Virus isolation',
  'Immunohistochemistry',
  'Culture & microscopy of Tritrichomonas foetus',
  'PCR'
]

const templateBytes = readFileSync(TEMPLATE_PATH)

function unzip(bytes) {
  return unzipSync(new Uint8Array(bytes))
}

function part(entries, name) {
  return strFromU8(entries[name])
}

function decodeXml(text) {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

// The shared string table as an array, so a cell's <v> index can be read
function sharedStrings(entries) {
  return [
    ...part(entries, 'xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)
  ].map(([, item]) =>
    decodeXml(
      [...item.matchAll(/<t(?: [^>]*)?>(.*?)<\/t>/gs)]
        .map(([, text]) => text)
        .join('')
    )
  )
}

// The text of a shared-string cell, or the raw value of any other cell
function cellValue(entries, ref) {
  const match = new RegExp(
    `<c r="${ref}"([^>]*)>(?:<f[^>]*>.*?</f>|<f[^>]*/>)?<v>([^<]*)</v></c>`
  ).exec(part(entries, SHEET_PART))

  if (!match) {
    return undefined
  }

  const [, attributes, value] = match

  return attributes.includes('t="s"')
    ? sharedStrings(entries)[Number(value)]
    : value
}

// The control part linked to a row, and whether it is checked
function controlOf(entries, row) {
  const name = Object.keys(entries).find(
    (entry) =>
      /^xl\/ctrlProps\/ctrlProp\d+\.xml$/.test(entry) &&
      part(entries, entry).includes(`fmlaLink="$G$${row}"`)
  )

  return name
    ? { name, checked: part(entries, name).includes('checked="Checked"') }
    : null
}

// The VML shape linked to a row, and whether it is checked
function shapeOf(entries, row) {
  const clientData = [
    ...part(entries, VML_PART).matchAll(
      /<x:ClientData ObjectType="Checkbox">[\s\S]*?<\/x:ClientData>/g
    )
  ]
    .map(([block]) => block)
    .find((block) => block.includes(`<x:FmlaLink>$G$${row}</x:FmlaLink>`))

  return clientData
    ? { checked: clientData.includes('<x:Checked>1</x:Checked>') }
    : null
}

const mycoplasmaPcr = testsByKey.get('mycoplasma-pcr')
const bhvFat = testsByKey.get('bhv-fat')
const mapZnSmear = testsByKey.get('map-zn-smear')

const selections = [
  { test: mycoplasmaPcr, accreditation: 'Yes' },
  { test: bhvFat, accreditation: 'Unknown' },
  { test: mapZnSmear, accreditation: 'No' }
]

describe('diagnostic tests workbook template', () => {
  const entries = unzip(templateBytes)

  test('Should be the "Define diagnostic tests in use" workbook', () => {
    expect(part(entries, WORKBOOK_PART)).toEqual(
      expect.stringContaining('<sheet name="Define diagnostic tests in use"')
    )
    expect(cellValue(entries, 'A1')).toBe('Define diagnostic tests in use')
  })

  test('Should hold one row per catalogue test, in catalogue order', () => {
    expect(tests.map((test) => cellValue(entries, `C${test.xlsRow}`))).toEqual(
      TEMPLATE_TEST_NAMES_BY_ROW
    )
  })

  test('Should have an accreditation cell, an in-use cell, a control and a shape for every test row', () => {
    for (const { xlsRow } of tests) {
      expect(cellValue(entries, `E${xlsRow}`)).toBeDefined()
      expect(['0', '1']).toContain(cellValue(entries, `G${xlsRow}`))
      expect(controlOf(entries, xlsRow)).not.toBeNull()
      expect(shapeOf(entries, xlsRow)).not.toBeNull()
    }
  })

  test('Should offer every accreditation the page does, and the not-in-use value', () => {
    const strings = sharedStrings(entries)

    for (const option of [...ACCREDITATION_OPTIONS, NOT_IN_USE_ACCREDITATION]) {
      expect(strings).toContain(option)
    }
  })

  test('Should start with nothing ticked and every row not applicable', () => {
    for (const { xlsRow } of tests) {
      expect(cellValue(entries, `G${xlsRow}`)).toBe('0')
      expect(cellValue(entries, `E${xlsRow}`)).toBe(NOT_IN_USE_ACCREDITATION)
      expect(controlOf(entries, xlsRow).checked).toBe(false)
      expect(shapeOf(entries, xlsRow).checked).toBe(false)
    }
    expect(part(entries, VML_PART)).not.toEqual(
      expect.stringContaining('<x:Checked>')
    )
  })

  test('Should carry no personal metadata', () => {
    expect(part(entries, 'docProps/core.xml')).toEqual(
      expect.stringContaining('<dc:creator></dc:creator>')
    )
    expect(part(entries, 'docProps/core.xml')).toEqual(
      expect.stringContaining('<cp:lastModifiedBy></cp:lastModifiedBy>')
    )
    expect(part(entries, WORKBOOK_PART)).not.toEqual(
      expect.stringContaining('absPath')
    )
  })
})

describe('buildDiagnosticTestsWorkbook', () => {
  test('Should name the file and its content type', () => {
    expect(DIAGNOSTIC_TESTS_FILE_NAME).toBe('diagnostic-tests.xlsx')
    expect(XLSX_CONTENT_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  })

  test('Should return the bytes of a zip', () => {
    const workbook = buildDiagnosticTestsWorkbook(selections)

    expect(Buffer.isBuffer(workbook)).toBe(true)
    // PK\x03\x04: a local file header
    expect(workbook.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    )
  })

  test('Should write each ticked test as in use with its accreditation', () => {
    const entries = unzip(buildDiagnosticTestsWorkbook(selections))

    for (const { test, accreditation } of selections) {
      expect(cellValue(entries, `E${test.xlsRow}`)).toBe(accreditation)
      expect(cellValue(entries, `G${test.xlsRow}`)).toBe('1')
      expect(controlOf(entries, test.xlsRow).checked).toBe(true)
      expect(shapeOf(entries, test.xlsRow).checked).toBe(true)
    }
  })

  test('Should write every other test as not in use and not applicable', () => {
    const entries = unzip(buildDiagnosticTestsWorkbook(selections))
    const tickedRows = new Set(selections.map(({ test }) => test.xlsRow))

    for (const { xlsRow } of tests.filter(
      (test) => !tickedRows.has(test.xlsRow)
    )) {
      expect(cellValue(entries, `E${xlsRow}`)).toBe(NOT_IN_USE_ACCREDITATION)
      expect(cellValue(entries, `G${xlsRow}`)).toBe('0')
      expect(controlOf(entries, xlsRow).checked).toBe(false)
      expect(shapeOf(entries, xlsRow).checked).toBe(false)
    }
  })

  test('Should not carry a tick over from one build to the next', () => {
    // Every row is written on every build, so a row ticked in one workbook
    // is not in use in the next unless ticked again
    buildDiagnosticTestsWorkbook(selections)
    const entries = unzip(buildDiagnosticTestsWorkbook([]))

    for (const { xlsRow } of tests) {
      expect(cellValue(entries, `G${xlsRow}`)).toBe('0')
      expect(cellValue(entries, `E${xlsRow}`)).toBe(NOT_IN_USE_ACCREDITATION)
      expect(controlOf(entries, xlsRow).checked).toBe(false)
    }
    expect(part(entries, VML_PART)).not.toEqual(
      expect.stringContaining('<x:Checked>')
    )
  })

  test('Should mark exactly the ticked shapes checked, on their own line before the link', () => {
    const vml = part(unzip(buildDiagnosticTestsWorkbook(selections)), VML_PART)

    expect(vml.match(/<x:Checked>1<\/x:Checked>/g)).toHaveLength(
      selections.length
    )
    expect(vml).toEqual(
      expect.stringContaining(
        `<x:Checked>1</x:Checked>\n   <x:FmlaLink>$G$${bhvFat.xlsRow}</x:FmlaLink>`
      )
    )
  })

  test('Should keep each cell its style', () => {
    const before = part(unzip(templateBytes), SHEET_PART)
    const after = part(
      unzip(buildDiagnosticTestsWorkbook(selections)),
      SHEET_PART
    )
    const stylesOf = (xml) =>
      [...xml.matchAll(/<c r="([EG]\d+)" s="(\d+)"/g)].map(([, ref, style]) => [
        ref,
        style
      ])

    expect(stylesOf(after)).toEqual(stylesOf(before))
  })

  test('Should ask Excel to recalculate on open, so the check formulas show', () => {
    const workbook = part(
      unzip(buildDiagnosticTestsWorkbook(selections)),
      WORKBOOK_PART
    )

    expect(workbook).toMatch(/<calcPr calcId="\d+" fullCalcOnLoad="1"\/>/)
    expect(workbook.match(/fullCalcOnLoad/g)).toHaveLength(1)
  })

  test('Should leave every other part of the template byte for byte', () => {
    const templateEntries = unzip(templateBytes)
    const entries = unzip(buildDiagnosticTestsWorkbook(selections))
    const edited = new Set([SHEET_PART, WORKBOOK_PART, VML_PART])

    expect(Object.keys(entries)).toEqual(Object.keys(templateEntries))

    for (const name of Object.keys(templateEntries)) {
      if (edited.has(name) || /^xl\/ctrlProps\//.test(name)) {
        continue
      }
      expect(
        Buffer.from(entries[name]).equals(Buffer.from(templateEntries[name]))
      ).toBe(true)
    }
  })

  test('Should keep the template itself untouched between builds', () => {
    const first = buildDiagnosticTestsWorkbook(selections)
    buildDiagnosticTestsWorkbook([{ test: mapZnSmear, accreditation: 'Yes' }])
    const again = buildDiagnosticTestsWorkbook(selections)

    expect(again.equals(first)).toBe(true)
    expect(readFileSync(TEMPLATE_PATH).equals(templateBytes)).toBe(true)
  })

  test('Should refuse an accreditation the workbook does not know', () => {
    expect(() =>
      buildDiagnosticTestsWorkbook([{ test: bhvFat, accreditation: 'Maybe' }])
    ).toThrow('Workbook template has no shared string "Maybe"')
  })
})
