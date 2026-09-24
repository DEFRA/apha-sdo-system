import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { tests } from './qualifying-tests.js'

/**
 * APHA's "Define diagnostic tests in use" workbook, filled in from the tests
 * a lab ticked. The workbook is delivered alongside submission.json and is
 * what the tests are read from downstream, so the record itself no longer
 * carries them.
 *
 * The template (templates/diagnostic-tests-template.xlsx) has one row per
 * test on its first sheet: A the disease, C the test, E the accreditation
 * (a dropdown), F a check formula and, hidden, G TRUE/FALSE, which is the
 * cell a form-control checkbox in B is linked to. Filling it means, for each
 * row, writing E and G and setting the checkbox's own checked state, which
 * Excel keeps in two more places: the control's part
 * (xl/ctrlProps/ctrlPropN.xml, `checked="Checked"`) and its legacy VML shape
 * (xl/drawings/vmlDrawing1.vml, `<x:Checked>1</x:Checked>`).
 *
 * Spreadsheet libraries do not round-trip form controls, so rather than load
 * the workbook into one, the template is treated as the zip it is: the few
 * XML parts above are edited as text and every other part is copied through
 * unchanged, so the styles, the dropdown validation, the check formulas, the
 * sheet protection and the hidden lookup sheet survive exactly as designed.
 */

export const DIAGNOSTIC_TESTS_FILE_NAME = 'diagnostic-tests.xlsx'
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** What column E reads for a test that is not in use */
export const NOT_IN_USE_ACCREDITATION = 'Not applicable'

const TEMPLATE_PATH = new URL(
  './templates/diagnostic-tests-template.xlsx',
  import.meta.url
)

const SHEET_PART = 'xl/worksheets/sheet1.xml'
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml'
const WORKBOOK_PART = 'xl/workbook.xml'
const VML_PART = 'xl/drawings/vmlDrawing1.vml'
const CTRL_PROP_PART = /^xl\/ctrlProps\/ctrlProp\d+\.xml$/

const ACCREDITATION_COLUMN = 'E'
const IN_USE_COLUMN = 'G'

// The `checked` attribute of a control part and the element of a VML shape
const CTRL_PROP_CHECKED = ' checked="Checked"'
const VML_CHECKED = '<x:Checked>1</x:Checked>'
// The element as it sits in the template: on its own line, so the line break
// and indentation that follow it go with it
const VML_CHECKED_LINE = /<x:Checked>1<\/x:Checked>\s*/

// Shared strings are stored as <si><t>text</t></si> in order; a cell of type
// "s" holds the index of its string
const SHARED_STRING_ITEM = /<si>(.*?)<\/si>/gs
const SHARED_STRING_TEXT = /<t(?: [^>]*)?>(.*?)<\/t>/gs

const XML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'"
}

function decodeXml(text) {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) => XML_ENTITIES[entity]
  )
}

/**
 * The index of every string in the shared string table, by its text
 * @param {string} xml - xl/sharedStrings.xml
 * @returns {Map<string, number>}
 */
function sharedStringIndexes(xml) {
  return new Map(
    [...xml.matchAll(SHARED_STRING_ITEM)].map(([, item], index) => [
      decodeXml(
        [...item.matchAll(SHARED_STRING_TEXT)].map(([, text]) => text).join('')
      ),
      index
    ])
  )
}

let templateCache

/**
 * The template's parts, read once. Shared between builds: a build only ever
 * replaces entries in its own shallow copy, never the arrays themselves.
 */
function template() {
  templateCache ??= (() => {
    const entries = unzipSync(new Uint8Array(readFileSync(TEMPLATE_PATH)))
    const strings = sharedStringIndexes(strFromU8(entries[SHARED_STRINGS_PART]))
    const ctrlPropParts = Object.keys(entries).filter((name) =>
      CTRL_PROP_PART.test(name)
    )

    return { entries, strings, ctrlPropParts }
  })()

  return templateCache
}

/**
 * The index of a shared string the template already carries
 * @param {Map<string, number>} strings - the shared string table
 * @param {string} text - an accreditation value
 */
function sharedStringIndex(strings, text) {
  const index = strings.get(text)

  if (index === undefined) {
    throw new Error(`Workbook template has no shared string "${text}"`)
  }

  return index
}

/**
 * The XML of the cell with the given reference, with its value replaced.
 * The cell's other attributes (its style, its type) are kept.
 * @param {string} xml - a worksheet part
 * @param {string} ref - e.g. "E6"
 * @param {number} value - the new <v> content
 */
function withCellValue(xml, ref, value) {
  const cell = new RegExp(`(<c r="${ref}"[^>]*>)<v>[^<]*</v>(</c>)`)

  if (!cell.test(xml)) {
    throw new Error(`Workbook template has no value cell ${ref}`)
  }

  return xml.replace(cell, `$1<v>${value}</v>$2`)
}

/**
 * The row a control part or a VML shape is linked to, from its `$G$row`
 * reference
 * @param {string} link - e.g. "$G$10"
 */
function linkedRow(link) {
  const match = /^\$G\$(\d+)$/.exec(link)

  return match ? Number(match[1]) : null
}

/**
 * A control part with its checked state set
 * @param {string} xml - xl/ctrlProps/ctrlPropN.xml
 * @param {(row: number) => boolean} isTicked - whether the linked row is in use
 */
function withControlChecked(xml, isTicked) {
  const link = /fmlaLink="([^"]*)"/.exec(xml)?.[1]
  const row = link ? linkedRow(link) : null

  if (row === null) {
    throw new Error('Workbook template has a checkbox not linked to column G')
  }

  const unchecked = xml.replace(/ checked="[^"]*"/, '')

  return isTicked(row)
    ? unchecked.replace(
        'objectType="CheckBox"',
        `objectType="CheckBox"${CTRL_PROP_CHECKED}`
      )
    : unchecked
}

/**
 * The VML drawing with every checkbox shape's checked state set
 * @param {string} vml - xl/drawings/vmlDrawing1.vml
 * @param {(row: number) => boolean} isTicked - whether the linked row is in use
 */
function withShapesChecked(vml, isTicked) {
  return vml.replace(
    /<x:ClientData ObjectType="Checkbox">[\s\S]*?<\/x:ClientData>/g,
    (clientData) => {
      const link = /<x:FmlaLink>([^<]*)<\/x:FmlaLink>/.exec(clientData)?.[1]
      const row = link ? linkedRow(link) : null

      if (row === null) {
        throw new Error(
          'Workbook template has a checkbox shape not linked to column G'
        )
      }

      // The element sits on its own line just before the link
      const unchecked = clientData.replace(VML_CHECKED_LINE, '')

      return isTicked(row)
        ? unchecked.replace('<x:FmlaLink>', `${VML_CHECKED}\n   <x:FmlaLink>`)
        : unchecked
    }
  )
}

/**
 * The workbook part asking Excel to recalculate on open: the check formulas
 * in column F have no cached values, so without this they would show blank
 * until something else triggered a recalculation
 * @param {string} xml - xl/workbook.xml
 */
function withFullCalcOnLoad(xml) {
  // `[^>]*` cannot run past the element, so the match is a single pass
  return xml.replace(/<calcPr\b([^>]*)\/>/, (match, attributes) =>
    attributes.includes('fullCalcOnLoad')
      ? match
      : `<calcPr${attributes.trimEnd()} fullCalcOnLoad="1"/>`
  )
}

/**
 * The template filled in from the ticked tests, as the bytes of a .xlsx.
 *
 * Every test row is written: a ticked test gets TRUE and its accreditation,
 * any other row FALSE and "Not applicable". The template itself has nothing
 * ticked, and writing every row keeps that true whatever it may carry.
 * @param {{ test: { xlsRow: number }, accreditation: string }[]} selections - the ticked tests with their accreditations
 * @returns {Buffer}
 */
export function buildDiagnosticTestsWorkbook(selections) {
  const { entries, strings, ctrlPropParts } = template()
  const accreditationByRow = new Map(
    selections.map(({ test, accreditation }) => [test.xlsRow, accreditation])
  )
  const isTicked = (row) => accreditationByRow.has(row)

  let sheet = strFromU8(entries[SHEET_PART])

  for (const { xlsRow } of tests) {
    const accreditation =
      accreditationByRow.get(xlsRow) ?? NOT_IN_USE_ACCREDITATION

    sheet = withCellValue(
      sheet,
      `${ACCREDITATION_COLUMN}${xlsRow}`,
      sharedStringIndex(strings, accreditation)
    )
    sheet = withCellValue(
      sheet,
      `${IN_USE_COLUMN}${xlsRow}`,
      isTicked(xlsRow) ? 1 : 0
    )
  }

  const filled = { ...entries }

  filled[SHEET_PART] = strToU8(sheet)
  filled[VML_PART] = strToU8(
    withShapesChecked(strFromU8(entries[VML_PART]), isTicked)
  )
  filled[WORKBOOK_PART] = strToU8(
    withFullCalcOnLoad(strFromU8(entries[WORKBOOK_PART]))
  )

  for (const part of ctrlPropParts) {
    filled[part] = strToU8(
      withControlChecked(strFromU8(entries[part]), isTicked)
    )
  }

  return Buffer.from(zipSync(filled, { level: 6 }))
}
