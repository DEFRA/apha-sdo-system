import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

/**
 * Filling in an APHA .xlsx template without a spreadsheet library.
 *
 * The templates carry what such libraries drop or rewrite: form controls,
 * data validation lists, sheet protection, hidden lookup sheets. So a
 * template is treated as the zip it is: the few XML parts a submission
 * changes are edited as text with the helpers below and every other part is
 * copied through unchanged. Shared by the diagnostic tests workbook (see
 * src/server/routes/diagnostic-tests/diagnostic-tests-workbook.js) and the
 * Animal Health Regulations web form workbook (see
 * src/server/forms/services/animal-health-regulations-workbook.js).
 */

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const WORKBOOK_PART = 'xl/workbook.xml'
export const SHARED_STRINGS_PART = 'xl/sharedStrings.xml'

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

const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
}

/**
 * The text of an XML text node, entities decoded
 * @param {string} text
 */
export function decodeXml(text) {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) => XML_ENTITIES[entity]
  )
}

/**
 * A value as the content of an XML text node or attribute
 * @param {string} text
 */
export function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (character) => XML_ESCAPES[character])
}

/**
 * The index of every string in a shared string table, by its text
 * @param {string} xml - xl/sharedStrings.xml
 * @returns {Map<string, number>}
 */
export function sharedStringIndexes(xml) {
  return new Map(
    [...xml.matchAll(SHARED_STRING_ITEM)].map(([, item], index) => [
      decodeXml(
        [...item.matchAll(SHARED_STRING_TEXT)].map(([, text]) => text).join('')
      ),
      index
    ])
  )
}

const templates = new Map()

/**
 * A template's parts, read once per template and shared between builds: a
 * build only ever replaces entries in its own shallow copy of `entries`,
 * never the arrays themselves.
 * @param {URL} url - the template file
 * @returns {{ entries: Record<string, Uint8Array>, strings: Map<string, number> }} the zip entries by name and the shared string table
 */
export function readTemplate(url) {
  const key = url.href

  if (!templates.has(key)) {
    const entries = unzipSync(new Uint8Array(readFileSync(url)))
    const sharedStrings = entries[SHARED_STRINGS_PART]
    const strings = sharedStrings
      ? sharedStringIndexes(strFromU8(sharedStrings))
      : new Map()

    templates.set(key, { entries, strings })
  }

  return templates.get(key)
}

/**
 * The text of a part of the template
 * @param {Record<string, Uint8Array>} entries - the template's parts
 * @param {string} name - e.g. "xl/worksheets/sheet1.xml"
 */
export function partText(entries, name) {
  return strFromU8(entries[name])
}

/**
 * A part's text as the bytes of the part
 * @param {string} text
 */
export function partBytes(text) {
  return strToU8(text)
}

/**
 * The XML of an inline string cell's content, for a cell of type "inlineStr"
 * @param {string} text
 */
export function inlineString(text) {
  return `<is><t xml:space="preserve">${escapeXml(text)}</t></is>`
}

/**
 * A worksheet with the content of one cell replaced. The cell must exist in
 * the template, empty (`<c r="A11" s="21"/>`) or not; its other attributes
 * (its style, above all) are kept. The cell's type attribute is kept when
 * `type` is undefined, set when it is a string and removed when it is null,
 * as a number cell carries none.
 * @param {string} xml - a worksheet part
 * @param {string} ref - e.g. "E6"
 * @param {{ type?: string | null, body: string }} content - the cell's type and the XML of its content, e.g. `<v>1</v>`
 */
export function withCell(xml, ref, { type, body }) {
  const cell = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
  const match = cell.exec(xml)

  if (!match) {
    throw new Error(`Workbook template has no cell ${ref}`)
  }

  let attributes = match[1]

  if (type !== undefined) {
    attributes = attributes.replace(/ t="[^"]*"/, '')

    if (type !== null) {
      attributes = `${attributes} t="${type}"`
    }
  }

  return xml.replace(cell, `<c r="${ref}"${attributes}>${body}</c>`)
}

/**
 * The workbook part asking Excel to recalculate on open: a template's
 * formulas have no cached values for the cells a submission fills, so
 * without this they would show stale until something else triggered a
 * recalculation
 * @param {string} xml - xl/workbook.xml
 */
export function withFullCalcOnLoad(xml) {
  // `[^>]*` cannot run past the element, so the match is a single pass
  return xml.replace(/<calcPr\b([^>]*)\/>/, (match, attributes) =>
    attributes.includes('fullCalcOnLoad')
      ? match
      : `<calcPr${attributes.trimEnd()} fullCalcOnLoad="1"/>`
  )
}

/**
 * The parts zipped back into the bytes of a .xlsx
 * @param {Record<string, Uint8Array>} entries - the parts by name
 * @returns {Buffer}
 */
export function zipTemplate(entries) {
  return Buffer.from(zipSync(entries, { level: 6 }))
}
