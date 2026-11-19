import { strFromU8, unzipSync } from 'fflate'

import {
  SHARED_STRINGS_PART,
  WORKBOOK_PART,
  XLSX_CONTENT_TYPE,
  decodeXml,
  escapeXml,
  inlineString,
  partBytes,
  partText,
  readTemplate,
  sharedStringIndexes,
  withCell,
  withFullCalcOnLoad,
  zipTemplate
} from './xlsx-template.js'

// A template this service ships, as a real workbook to read
const DIAGNOSTIC_TESTS_TEMPLATE = new URL(
  '../../routes/diagnostic-tests/templates/diagnostic-tests-template.xlsx',
  import.meta.url
)

const SHEET = [
  '<sheetData>',
  '<row r="11"><c r="A11" s="21"/><c r="B11" s="23" t="str"><f>IF(A11="","---","x")</f><v>---</v></c><c r="G11" s="10"/></row>',
  '<row r="12"><c r="A12" s="21"/><c r="E12" s="11" t="s"><v>11</v></c><c r="G12" s="2" t="b"><v>0</v></c></row>',
  '</sheetData>'
].join('')

describe('xlsx template helpers', () => {
  test('Should name the content type of a workbook', () => {
    expect(XLSX_CONTENT_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  })

  describe('escapeXml and decodeXml', () => {
    test('Should escape the five XML characters and decode them back', () => {
      const text = 'Culture & microscopy <of> "Tritrichomonas" \'foetus\''

      expect(escapeXml(text)).toBe(
        'Culture &amp; microscopy &lt;of&gt; &quot;Tritrichomonas&quot; &apos;foetus&apos;'
      )
      expect(decodeXml(escapeXml(text))).toBe(text)
    })

    test('Should leave other text as it is', () => {
      expect(escapeXml('PCR (including gE PCR)')).toBe('PCR (including gE PCR)')
      expect(decodeXml('PCR (including gE PCR)')).toBe('PCR (including gE PCR)')
    })

    test('Should escape a number as its text', () => {
      expect(escapeXml(12)).toBe('12')
    })
  })

  describe('sharedStringIndexes', () => {
    test('Should index every string by its decoded text, joining rich text runs', () => {
      const xml =
        '<sst><si><t>Yes</t></si><si><t xml:space="preserve">No </t></si>' +
        '<si><r><t>Culture &amp; </t></r><r><t>microscopy</t></r></si></sst>'

      expect(sharedStringIndexes(xml)).toEqual(
        new Map([
          ['Yes', 0],
          ['No ', 1],
          ['Culture & microscopy', 2]
        ])
      )
    })
  })

  describe('inlineString', () => {
    test('Should wrap the escaped text as an inline string, keeping its spaces', () => {
      expect(inlineString('Other & more ')).toBe(
        '<is><t xml:space="preserve">Other &amp; more </t></is>'
      )
    })
  })

  describe('withCell', () => {
    test('Should fill an empty cell, keeping its style, with the type given', () => {
      expect(
        withCell(SHEET, 'A11', {
          type: 'inlineStr',
          body: inlineString('England')
        })
      ).toEqual(
        expect.stringContaining(
          '<c r="A11" s="21" t="inlineStr"><is><t xml:space="preserve">England</t></is></c>'
        )
      )
    })

    test('Should fill an empty cell with a number, which has no type', () => {
      expect(withCell(SHEET, 'G11', { type: null, body: '<v>12</v>' })).toEqual(
        expect.stringContaining('<c r="G11" s="10"><v>12</v></c>')
      )
    })

    test('Should replace the value of a typed cell, keeping its type when none is given', () => {
      const sheet = withCell(SHEET, 'E12', { body: '<v>17</v>' })

      expect(sheet).toEqual(
        expect.stringContaining('<c r="E12" s="11" t="s"><v>17</v></c>')
      )
      expect(sheet).not.toEqual(expect.stringContaining('<v>11</v>'))
    })

    test('Should replace the type of a typed cell when one is given, or drop it when null', () => {
      expect(
        withCell(SHEET, 'G12', { type: 'inlineStr', body: inlineString('x') })
      ).toEqual(
        expect.stringContaining(
          '<c r="G12" s="2" t="inlineStr"><is><t xml:space="preserve">x</t></is></c>'
        )
      )
      expect(withCell(SHEET, 'G12', { type: null, body: '<v>1</v>' })).toEqual(
        expect.stringContaining('<c r="G12" s="2"><v>1</v></c>')
      )
    })

    test('Should replace the whole content of a cell holding a formula', () => {
      const sheet = withCell(SHEET, 'B11', { type: null, body: '<v>5</v>' })

      expect(sheet).toEqual(
        expect.stringContaining('<c r="B11" s="23"><v>5</v></c>')
      )
      expect(sheet).not.toEqual(expect.stringContaining('<f>'))
    })

    test('Should touch only the cell named: A11 is not A110', () => {
      const sheet =
        '<row r="110"><c r="A110" s="1"/></row><row r="11"><c r="A11" s="2"/></row>'

      expect(withCell(sheet, 'A11', { type: null, body: '<v>1</v>' })).toBe(
        '<row r="110"><c r="A110" s="1"/></row><row r="11"><c r="A11" s="2"><v>1</v></c></row>'
      )
    })

    test('Should refuse a cell the template does not have', () => {
      expect(() =>
        withCell(SHEET, 'Z99', { type: null, body: '<v>1</v>' })
      ).toThrow('Workbook template has no cell Z99')
    })
  })

  describe('withFullCalcOnLoad', () => {
    test('Should ask for a full recalculation on open', () => {
      expect(
        withFullCalcOnLoad('<workbook><calcPr calcId="191028"/></workbook>')
      ).toBe(
        '<workbook><calcPr calcId="191028" fullCalcOnLoad="1"/></workbook>'
      )
    })

    test('Should not ask twice', () => {
      const once = withFullCalcOnLoad('<calcPr calcId="1"/>')

      expect(withFullCalcOnLoad(once)).toBe(once)
      expect(once.match(/fullCalcOnLoad/g)).toHaveLength(1)
    })
  })

  describe('readTemplate', () => {
    test('Should read the parts of a template and index its shared strings', () => {
      const { entries, strings } = readTemplate(DIAGNOSTIC_TESTS_TEMPLATE)

      expect(Object.keys(entries)).toEqual(
        expect.arrayContaining([WORKBOOK_PART, SHARED_STRINGS_PART])
      )
      expect(strings.get('Not applicable')).toEqual(expect.any(Number))
    })

    test('Should read a template once', () => {
      expect(readTemplate(DIAGNOSTIC_TESTS_TEMPLATE)).toBe(
        readTemplate(DIAGNOSTIC_TESTS_TEMPLATE)
      )
    })
  })

  describe('partText, partBytes and zipTemplate', () => {
    test('Should round-trip a part through text and back into a zip', () => {
      const { entries } = readTemplate(DIAGNOSTIC_TESTS_TEMPLATE)
      const workbook = partText(entries, WORKBOOK_PART)
      const zipped = zipTemplate({
        ...entries,
        [WORKBOOK_PART]: partBytes(withFullCalcOnLoad(workbook))
      })

      expect(Buffer.isBuffer(zipped)).toBe(true)

      const unzipped = unzipSync(new Uint8Array(zipped))

      expect(Object.keys(unzipped)).toEqual(Object.keys(entries))
      expect(strFromU8(unzipped[WORKBOOK_PART])).toEqual(
        expect.stringContaining('fullCalcOnLoad="1"')
      )
      // The template's own parts were not touched
      expect(partText(entries, WORKBOOK_PART)).toBe(workbook)
    })
  })
})
