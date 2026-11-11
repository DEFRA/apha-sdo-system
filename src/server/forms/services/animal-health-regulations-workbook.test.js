import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'

import { definition } from '#/server/forms/definitions/animal-health-regulations-web-form.js'
import { MAX_ENTRIES } from '#/server/forms/controllers/report-entries.js'
import {
  ENTRY_COLUMNS,
  ENTRY_ROWS,
  FIRST_ENTRY_ROW,
  MONTH_CELL,
  OTHER_SPECIES,
  OTHER_SPECIES_CELL_VALUE,
  PREPARED_BY_CELL,
  YEAR_CELL,
  animalHealthRegulationsFileName,
  buildAnimalHealthRegulationsWorkbook
} from './animal-health-regulations-workbook.js'

const TEMPLATE_PATH = new URL(
  '../templates/animal-health-regulations-template.xlsx',
  import.meta.url
)
const SHEET_PART = 'xl/worksheets/sheet1.xml'
const LOOKUP_SHEET_PART = 'xl/worksheets/sheet3.xml'
const WORKBOOK_PART = 'xl/workbook.xml'

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

/**
 * What a cell holds: the text of a shared or inline string, the raw value
 * of any other cell, or null for a cell with no value
 */
function cellValue(entries, ref, sheetPart = SHEET_PART) {
  const match = new RegExp(
    `<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`
  ).exec(part(entries, sheetPart))

  if (!match) {
    return undefined
  }

  const [, attributes, content = ''] = match

  if (attributes.includes('t="inlineStr"')) {
    return decodeXml(/<t[^>]*>(.*?)<\/t>/s.exec(content)?.[1] ?? '')
  }

  const value = /<v>([^<]*)<\/v>/.exec(content)?.[1]

  if (value === undefined) {
    return null
  }

  return attributes.includes('t="s"')
    ? sharedStrings(entries)[Number(value)]
    : value
}

// The cell's attributes as written, to check the type and style
function cellTag(entries, ref) {
  return new RegExp(`<c r="${ref}"[^>]*?/?>`).exec(part(entries, SHEET_PART))[0]
}

function listValues(name) {
  return definition.lists.find((list) => list.name === name).items
}

const AUGUST_2026 = { month: 8, year: 2026 }

const entries = [
  {
    pathogen: 'Tritrichomonas foetus',
    species: OTHER_SPECIES,
    otherSpecies: 'Alpaca & friends',
    country: 'England',
    submissionsWithQualifyingTest: '12',
    submissionsWithPositiveSamples: '3',
    positiveSamples: '5'
  },
  {
    pathogen: 'Bovine Herpes Virus 1 (BHV-1)',
    species: 'Domestic cattle',
    country: 'Wales',
    submissionsWithQualifyingTest: '1',
    submissionsWithPositiveSamples: '1',
    positiveSamples: '0'
  }
]

const report = { preparedBy: 'A Person', reportDate: AUGUST_2026, entries }

describe('Animal Health Regulations workbook template', () => {
  const template = unzip(templateBytes)

  test('Should be the "Monthly laboratory report" workbook, v4.0-beta', () => {
    expect(part(template, WORKBOOK_PART)).toEqual(
      expect.stringContaining('<sheet name="MonthlyReport"')
    )
    expect(cellValue(template, 'A1')).toBe('Monthly laboratory report')
    expect(cellValue(template, 'C1')).toBe('4.0-beta')
  })

  test('Should ask who prepared the report and for the month and year', () => {
    expect(cellValue(template, 'A4')).toBe('Report prepared by (optional):')
    expect(cellValue(template, PREPARED_BY_CELL)).toBeNull()
    expect(cellValue(template, 'A5')).toBe(
      'Reporting period (enter month and year):'
    )
    expect(cellValue(template, MONTH_CELL)).toBeNull()
    expect(cellValue(template, YEAR_CELL)).toBeNull()
  })

  test('Should have an empty cell for every answer on every entry row, and no more rows', () => {
    const lastRow = FIRST_ENTRY_ROW + ENTRY_ROWS - 1

    for (let row = FIRST_ENTRY_ROW; row <= lastRow; row++) {
      for (const column of Object.values(ENTRY_COLUMNS)) {
        expect(cellValue(template, `${column}${row}`)).toBeNull()
      }
    }
    expect(cellValue(template, `A${lastRow + 1}`)).toBeUndefined()
    expect(part(template, SHEET_PART)).toEqual(
      expect.stringContaining(`<dimension ref="A1:I${lastRow}"/>`)
    )
  })

  test('Should look the disease and qualifying tests up from the pathogen on every entry row', () => {
    const sheet = part(template, SHEET_PART)
    const lastRow = FIRST_ENTRY_ROW + ENTRY_ROWS - 1

    for (let row = FIRST_ENTRY_ROW; row <= lastRow; row++) {
      expect(sheet).toMatch(new RegExp(`<c r="B${row}"[^>]*t="str"><f`))
      expect(sheet).toMatch(new RegExp(`<c r="E${row}"[^>]*t="str"><f`))
    }
    expect(sheet).toEqual(
      expect.stringContaining('VLOOKUP(A11,agent_condition_lut,2,FALSE)')
    )
  })

  test("Should offer the web form's pathogens, by name and in order", () => {
    const pathogens = [5, 6, 7, 8, 9, 10, 11].map((row) =>
      cellValue(template, `A${row}`, LOOKUP_SHEET_PART)
    )

    expect(pathogens).toEqual(listValues('pathogens').map((item) => item.value))
    expect(part(template, WORKBOOK_PART)).toEqual(
      expect.stringContaining(
        '<definedName name="agent">DataValidationValues!$A$5:$A$11</definedName>'
      )
    )
  })

  test("Should offer the web form's species, spelling out the other one", () => {
    const lookup = part(template, LOOKUP_SHEET_PART)
    const strings = sharedStrings(template)

    for (const { value } of listValues('species')) {
      if (value === OTHER_SPECIES) {
        continue
      }
      expect(strings).toContain(value)
      expect(lookup).toEqual(
        expect.stringContaining(`<v>${strings.indexOf(value)}</v>`)
      )
    }
    expect(cellValue(template, 'A14', LOOKUP_SHEET_PART)).toBe(
      OTHER_SPECIES_CELL_VALUE
    )
    expect(part(template, SHEET_PART)).toEqual(
      expect.stringContaining('<formula1>FIND("Other",C11)&gt;=1</formula1>')
    )
  })

  test("Should offer the web form's countries", () => {
    const countries = [52, 53, 54, 55].map((row) =>
      cellValue(template, `A${row}`, LOOKUP_SHEET_PART)
    )

    expect(countries.toSorted()).toEqual(
      listValues('countries')
        .map((item) => item.value)
        .toSorted()
    )
  })

  test('Should carry no personal metadata', () => {
    expect(part(template, 'docProps/core.xml')).toEqual(
      expect.stringContaining('<dc:creator></dc:creator>')
    )
    expect(part(template, 'docProps/core.xml')).toEqual(
      expect.stringContaining('<cp:lastModifiedBy></cp:lastModifiedBy>')
    )
    expect(part(template, WORKBOOK_PART)).not.toEqual(
      expect.stringContaining('absPath')
    )
  })

  test('Should have a row for every entry the web form allows', () => {
    expect(MAX_ENTRIES).toBeLessThanOrEqual(ENTRY_ROWS)
  })
})

describe('animalHealthRegulationsFileName', () => {
  test('Should name the file after the reference number and the report month, as an uploaded report must', () => {
    expect(animalHealthRegulationsFileName('ABC-DEF-GHJ', AUGUST_2026)).toBe(
      'ABC-DEF-GHJ-2026-08-animal-health-regulations.xlsx'
    )
    expect(
      animalHealthRegulationsFileName('ABC-DEF-GHJ', {
        month: '11',
        year: '2023'
      })
    ).toBe('ABC-DEF-GHJ-2023-11-animal-health-regulations.xlsx')
  })

  test('Should leave the month out when the report date is unusable', () => {
    expect(animalHealthRegulationsFileName('ABC-DEF-GHJ', undefined)).toBe(
      'ABC-DEF-GHJ-animal-health-regulations.xlsx'
    )
  })
})

describe('buildAnimalHealthRegulationsWorkbook', () => {
  test('Should return the bytes of a zip', () => {
    const workbook = buildAnimalHealthRegulationsWorkbook(report)

    expect(Buffer.isBuffer(workbook)).toBe(true)
    // PK\x03\x04: a local file header
    expect(workbook.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    )
  })

  test('Should write who prepared the report, and the month and year', () => {
    const built = unzip(buildAnimalHealthRegulationsWorkbook(report))

    expect(cellValue(built, PREPARED_BY_CELL)).toBe('A Person')
    expect(cellValue(built, MONTH_CELL)).toBe('August')
    expect(cellValue(built, YEAR_CELL)).toBe('2026')
    // The month is text for the dropdown, the year a number for the range
    expect(cellTag(built, MONTH_CELL)).toBe('<c r="B5" s="58" t="inlineStr">')
    expect(cellTag(built, YEAR_CELL)).toBe('<c r="C5" s="47">')
  })

  test('Should write each entry to its row, in order', () => {
    const built = unzip(buildAnimalHealthRegulationsWorkbook(report))

    expect(cellValue(built, 'A11')).toBe('Tritrichomonas foetus')
    expect(cellValue(built, 'C11')).toBe(OTHER_SPECIES_CELL_VALUE)
    expect(cellValue(built, 'D11')).toBe('Alpaca & friends')
    expect(cellValue(built, 'F11')).toBe('England')
    expect(cellValue(built, 'G11')).toBe('12')
    expect(cellValue(built, 'H11')).toBe('3')
    expect(cellValue(built, 'I11')).toBe('5')

    expect(cellValue(built, 'A12')).toBe('Bovine Herpes Virus 1 (BHV-1)')
    expect(cellValue(built, 'C12')).toBe('Domestic cattle')
    expect(cellValue(built, 'D12')).toBeNull()
    expect(cellValue(built, 'F12')).toBe('Wales')
    expect(cellValue(built, 'G12')).toBe('1')
    expect(cellValue(built, 'H12')).toBe('1')
    expect(cellValue(built, 'I12')).toBe('0')
  })

  test('Should write the counts as numbers and the rest as text, keeping each cell its style', () => {
    const built = unzip(buildAnimalHealthRegulationsWorkbook(report))

    expect(cellTag(built, 'A11')).toBe('<c r="A11" s="21" t="inlineStr">')
    expect(cellTag(built, 'C11')).toBe('<c r="C11" s="8" t="inlineStr">')
    expect(cellTag(built, 'D11')).toBe('<c r="D11" s="8" t="inlineStr">')
    expect(cellTag(built, 'F11')).toBe('<c r="F11" s="71" t="inlineStr">')
    expect(cellTag(built, 'G11')).toBe('<c r="G11" s="10">')
    expect(cellTag(built, 'H11')).toBe('<c r="H11" s="10">')
    expect(cellTag(built, 'I11')).toBe('<c r="I11" s="14">')
  })

  test('Should leave the rows after the last entry as the template has them', () => {
    const built = unzip(buildAnimalHealthRegulationsWorkbook(report))
    const lastRow = FIRST_ENTRY_ROW + ENTRY_ROWS - 1

    for (let row = FIRST_ENTRY_ROW + entries.length; row <= lastRow; row++) {
      for (const column of Object.values(ENTRY_COLUMNS)) {
        expect(cellValue(built, `${column}${row}`)).toBeNull()
      }
    }
  })

  test('Should leave the disease and qualifying tests formulas to Excel, recalculated on open', () => {
    const built = unzip(buildAnimalHealthRegulationsWorkbook(report))
    const sheet = part(built, SHEET_PART)

    expect(sheet).toMatch(/<c r="B11"[^>]*t="str"><f/)
    expect(sheet).toMatch(/<c r="E11"[^>]*t="str"><f/)
    expect(part(built, WORKBOOK_PART)).toMatch(
      /<calcPr calcId="\d+" fullCalcOnLoad="1"\/>/
    )
  })

  test('Should fill every row the template has, and no more', () => {
    const full = Array.from({ length: ENTRY_ROWS }, (_, index) => ({
      ...entries[1],
      submissionsWithQualifyingTest: String(index + 1)
    }))
    const built = unzip(
      buildAnimalHealthRegulationsWorkbook({ ...report, entries: full })
    )

    expect(cellValue(built, `G${FIRST_ENTRY_ROW}`)).toBe('1')
    expect(cellValue(built, `G${FIRST_ENTRY_ROW + ENTRY_ROWS - 1}`)).toBe(
      String(ENTRY_ROWS)
    )

    expect(() =>
      buildAnimalHealthRegulationsWorkbook({
        ...report,
        entries: [...full, entries[1]]
      })
    ).toThrow(
      `Animal Health Regulations workbook template has ${ENTRY_ROWS} entry rows; the report has ${ENTRY_ROWS + 1} entries`
    )
  })

  test('Should write only what the report has', () => {
    const built = unzip(
      buildAnimalHealthRegulationsWorkbook({
        preparedBy: undefined,
        reportDate: undefined,
        entries: [
          {
            pathogen: 'Tritrichomonas foetus',
            species: 'Bison',
            // Left over from a species that was "Other": not written
            otherSpecies: 'Alpaca',
            country: '',
            submissionsWithQualifyingTest: 'twelve'
          }
        ]
      })
    )

    expect(cellValue(built, PREPARED_BY_CELL)).toBeNull()
    expect(cellValue(built, MONTH_CELL)).toBeNull()
    expect(cellValue(built, YEAR_CELL)).toBeNull()
    expect(cellValue(built, 'C11')).toBe('Bison')
    expect(cellValue(built, 'D11')).toBeNull()
    expect(cellValue(built, 'F11')).toBeNull()
    // A count that is not a number is kept as the text it is
    expect(cellValue(built, 'G11')).toBe('twelve')
    expect(cellTag(built, 'G11')).toBe('<c r="G11" s="10" t="inlineStr">')
    expect(cellValue(built, 'H11')).toBeNull()
  })

  test('Should write an empty report as the template with its details', () => {
    const built = unzip(
      buildAnimalHealthRegulationsWorkbook({ ...report, entries: [] })
    )

    expect(cellValue(built, MONTH_CELL)).toBe('August')
    expect(cellValue(built, 'A11')).toBeNull()
  })

  test('Should leave every other part of the template byte for byte', () => {
    const template = unzip(templateBytes)
    const built = unzip(buildAnimalHealthRegulationsWorkbook(report))
    const edited = new Set([SHEET_PART, WORKBOOK_PART])

    expect(Object.keys(built)).toEqual(Object.keys(template))

    for (const name of Object.keys(template)) {
      if (edited.has(name)) {
        continue
      }
      expect(Buffer.from(built[name]).equals(Buffer.from(template[name]))).toBe(
        true
      )
    }
  })

  test('Should keep the template itself untouched between builds', () => {
    const first = buildAnimalHealthRegulationsWorkbook(report)
    buildAnimalHealthRegulationsWorkbook({ ...report, entries: [entries[1]] })
    const again = buildAnimalHealthRegulationsWorkbook(report)

    expect(again.equals(first)).toBe(true)
    expect(readFileSync(TEMPLATE_PATH).equals(templateBytes)).toBe(true)
  })
})
