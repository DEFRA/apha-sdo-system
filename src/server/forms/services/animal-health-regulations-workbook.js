import {
  WORKBOOK_PART,
  inlineString,
  partBytes,
  partText,
  readTemplate,
  withCell,
  withFullCalcOnLoad,
  zipTemplate
} from '#/server/common/helpers/xlsx-template.js'

import {
  expectedReportFileName,
  reportMonthName
} from '../validation/report-file-name.js'

/**
 * APHA's "Monthly disease reporting for labs" workbook, filled in from an
 * Animal Health Regulations report entered as a web form. A lab that uploads
 * its report sends this workbook filled in by hand; a lab that uses the web
 * form gets the same workbook built for it, so downstream reads one format
 * whichever way the report came. It is delivered alongside submission.json,
 * which names it (fileName) and carries the same entries (see
 * output-service.js).
 *
 * The template (../templates/animal-health-regulations-template.xlsx, APHA's
 * v4.0-beta) has, on its MonthlyReport sheet, the report details (B4 who
 * prepared the report, B5 the month by name, C5 the year) and one row per
 * entry from row 11 to row 60: A the pathogen (a dropdown of APHA's list),
 * C the species (a dropdown that depends on the pathogen), D the other
 * species when C is "Other (please specify)", F the country and G, H and I
 * the three counts. B (the disease) and E (the qualifying tests) are
 * formulas looking the pathogen up on the hidden DataValidationValues sheet,
 * so they are left to Excel, which is asked to recalculate on open.
 *
 * The web form's pathogen, species and country values are the template's own
 * (the form was built from it), so they are written as given; the one
 * difference is the species "Other", which the template spells out. Text is
 * written as inline strings, so the shared string table is left as it is.
 */

const TEMPLATE_PATH = new URL(
  '../templates/animal-health-regulations-template.xlsx',
  import.meta.url
)

const SHEET_PART = 'xl/worksheets/sheet1.xml'

export const PREPARED_BY_CELL = 'B4'
export const MONTH_CELL = 'B5'
export const YEAR_CELL = 'C5'

/** The first row an entry is written to; the entries follow in order */
export const FIRST_ENTRY_ROW = 11

/** The rows the template has for entries (11 to 60) */
export const ENTRY_ROWS = 50

/** The column each answer of an entry is written to */
export const ENTRY_COLUMNS = {
  pathogen: 'A',
  species: 'C',
  otherSpecies: 'D',
  country: 'F',
  submissionsWithQualifyingTest: 'G',
  submissionsWithPositiveSamples: 'H',
  positiveSamples: 'I'
}

/** The species value of the web form that stands for one not on the list */
export const OTHER_SPECIES = 'Other'
/** ... and how the template's species dropdown spells it */
export const OTHER_SPECIES_CELL_VALUE = 'Other (please specify)'

// The answers that are counts, written as numbers
const COUNT_NAMES = [
  'submissionsWithQualifyingTest',
  'submissionsWithPositiveSamples',
  'positiveSamples'
]

/**
 * The name the filled-in workbook is delivered under, alongside
 * submission.json. An uploaded report's file has to carry the report month
 * as YYYY-MM (see ../validation/report-file-name.js), so the built one
 * does too, after the reference number that keeps it distinct downstream.
 * @param {string} referenceNumber - the submission's reference
 * @param {{ month?: number|string, year?: number|string }} [reportDate] - the report date from form state
 */
export function animalHealthRegulationsFileName(referenceNumber, reportDate) {
  return `${[referenceNumber, expectedReportFileName(reportDate), 'animal-health-regulations'].filter(Boolean).join('-')}.xlsx`
}

/**
 * The worksheet with a text cell written as an inline string
 * @param {string} sheet
 * @param {string} ref
 * @param {string} text
 */
function withText(sheet, ref, text) {
  return withCell(sheet, ref, { type: 'inlineStr', body: inlineString(text) })
}

/**
 * The worksheet with a count written: as a number when it is one (the form
 * holds them as text), otherwise as the text given, so nothing is lost
 * @param {string} sheet
 * @param {string} ref
 * @param {unknown} value
 */
function withCount(sheet, ref, value) {
  const number = Number(value)

  return Number.isFinite(number)
    ? withCell(sheet, ref, { type: null, body: `<v>${number}</v>` })
    : withText(sheet, ref, String(value))
}

function isGiven(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

/**
 * The worksheet with one entry written to one row. Only the answers the
 * entry has are written (otherSpecies is only asked when the species is
 * "Other"), so a cell with nothing to say stays as the template has it.
 * @param {string} sheet
 * @param {number} row
 * @param {Record<string, unknown>} entry - an entry of the record (see output-service.js entriesOf)
 */
function withEntry(sheet, row, entry) {
  let filled = sheet

  if (isGiven(entry.pathogen)) {
    filled = withText(filled, `${ENTRY_COLUMNS.pathogen}${row}`, entry.pathogen)
  }

  if (isGiven(entry.species)) {
    filled = withText(
      filled,
      `${ENTRY_COLUMNS.species}${row}`,
      entry.species === OTHER_SPECIES ? OTHER_SPECIES_CELL_VALUE : entry.species
    )
  }

  if (entry.species === OTHER_SPECIES && isGiven(entry.otherSpecies)) {
    filled = withText(
      filled,
      `${ENTRY_COLUMNS.otherSpecies}${row}`,
      entry.otherSpecies
    )
  }

  if (isGiven(entry.country)) {
    filled = withText(filled, `${ENTRY_COLUMNS.country}${row}`, entry.country)
  }

  for (const name of COUNT_NAMES) {
    if (isGiven(entry[name])) {
      filled = withCount(filled, `${ENTRY_COLUMNS[name]}${row}`, entry[name])
    }
  }

  return filled
}

/**
 * The template filled in from a web form report, as the bytes of a .xlsx.
 * @param {object} report
 * @param {string} [report.preparedBy] - who prepared the report: the signed-in user's name
 * @param {{ month?: number|string, year?: number|string }} [report.reportDate] - the report date from form state
 * @param {Record<string, unknown>[]} report.entries - the entries of the record, in order
 * @returns {Buffer}
 */
export function buildAnimalHealthRegulationsWorkbook({
  preparedBy,
  reportDate,
  entries
}) {
  if (entries.length > ENTRY_ROWS) {
    throw new Error(
      `Animal Health Regulations workbook template has ${ENTRY_ROWS} entry rows; the report has ${entries.length} entries`
    )
  }

  const { entries: parts } = readTemplate(TEMPLATE_PATH)
  let sheet = partText(parts, SHEET_PART)

  if (isGiven(preparedBy)) {
    sheet = withText(sheet, PREPARED_BY_CELL, preparedBy)
  }

  const monthName = reportMonthName(reportDate)

  if (monthName) {
    sheet = withText(sheet, MONTH_CELL, monthName)
    sheet = withCell(sheet, YEAR_CELL, {
      type: null,
      body: `<v>${Number(reportDate.year)}</v>`
    })
  }

  entries.forEach((entry, index) => {
    sheet = withEntry(sheet, FIRST_ENTRY_ROW + index, entry)
  })

  const filled = { ...parts }

  filled[SHEET_PART] = partBytes(sheet)
  filled[WORKBOOK_PART] = partBytes(
    withFullCalcOnLoad(partText(parts, WORKBOOK_PART))
  )

  return zipTemplate(filled)
}
