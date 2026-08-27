import {
  expectedReportFileName,
  matchesReportFileName,
  partitionFilesByName,
  reportDateFromState,
  reportFileNameErrorText,
  uploadedFileName
} from '#/server/forms/validation/report-file-name.js'

const MARCH_2024 = { month: 3, year: 2024 }

function buildFile(filename) {
  return {
    uploadId: `upload-${filename}`,
    status: { form: { file: { fileId: filename, filename } } }
  }
}

describe('#expectedReportFileName', () => {
  test.each([
    [1, 'January2024'],
    [2, 'February2024'],
    [3, 'March2024'],
    [4, 'April2024'],
    [5, 'May2024'],
    [6, 'June2024'],
    [7, 'July2024'],
    [8, 'August2024'],
    [9, 'September2024'],
    [10, 'October2024'],
    [11, 'November2024'],
    [12, 'December2024']
  ])('Should name month %i as %s', (month, expected) => {
    expect(expectedReportFileName({ month, year: 2024 })).toBe(expected)
  })

  test('Should accept the month and year as strings', () => {
    expect(expectedReportFileName({ month: '03', year: '2024' })).toBe(
      'March2024'
    )
  })

  test.each([
    ['no report date', undefined],
    ['an empty report date', {}],
    ['a month below range', { month: 0, year: 2024 }],
    ['a month above range', { month: 13, year: 2024 }],
    ['a fractional month', { month: 3.5, year: 2024 }],
    ['a missing year', { month: 3 }],
    ['a non-numeric month', { month: 'March', year: 2024 }],
    ['a non-numeric year', { month: 3, year: 'twenty' }]
  ])('Should not expect a name for %s', (_description, reportDate) => {
    expect(expectedReportFileName(reportDate)).toBeUndefined()
  })
})

describe('#reportDateFromState', () => {
  test('Should recover the report date from the flat MonthYearField state', () => {
    const state = { reportDate__month: 3, reportDate__year: 2024 }

    expect(reportDateFromState(state)).toEqual({ month: 3, year: 2024 })
    expect(expectedReportFileName(reportDateFromState(state))).toBe('March2024')
  })

  test('Should produce a date the other helpers treat as unanswered', () => {
    expect(expectedReportFileName(reportDateFromState({}))).toBeUndefined()
    expect(
      expectedReportFileName(reportDateFromState(undefined))
    ).toBeUndefined()
  })
})

describe('#matchesReportFileName', () => {
  test.each([
    'March2024.xlsx',
    'march2024.xlsx',
    'MARCH2024.XLSX',
    'March2024.csv',
    'March2024.xls',
    'March2024',
    ' March2024.xlsx ',
    'March2024 .xlsx',
    'March2024-1.xls',
    'March2024-part2.xls',
    'March2024_v2.xlsx',
    'March2024.final.xlsx',
    'BatRabies_March2024.xlsx'
  ])('Should accept %s for 03/2024', (filename) => {
    expect(matchesReportFileName(filename, MARCH_2024)).toBe(true)
  })

  test.each([
    'March 2024.xlsx',
    'March_2024.xlsx',
    'March-2024.xlsx',
    'Mar2024.xlsx',
    'March24.xlsx',
    'April2024.xlsx',
    'March2023.xlsx',
    'report.xlsx',
    '',
    undefined
  ])('Should reject %s for 03/2024', (filename) => {
    expect(matchesReportFileName(filename, MARCH_2024)).toBe(false)
  })

  test('Should accept any name when there is no report date to check against', () => {
    expect(matchesReportFileName('anything.xlsx', undefined)).toBe(true)
  })
})

describe('#uploadedFileName', () => {
  test('Should read the file name from a file state entry', () => {
    expect(uploadedFileName(buildFile('March2024.xlsx'))).toBe('March2024.xlsx')
  })

  test('Should return undefined for an incomplete file state', () => {
    expect(uploadedFileName({ uploadId: 'upload-1' })).toBeUndefined()
    expect(uploadedFileName(undefined)).toBeUndefined()
  })
})

describe('#partitionFilesByName', () => {
  test('Should split a batch into matching and misnamed files', () => {
    const matching = buildFile('march2024.CSV')
    const suffixed = buildFile('March2024-part2.xls')
    const wrongMonth = buildFile('April2024.xlsx')
    const missingToken = buildFile('report.xlsx')

    const { kept, rejected } = partitionFilesByName(
      [matching, suffixed, wrongMonth, missingToken],
      MARCH_2024
    )

    expect(kept).toEqual([matching, suffixed])
    expect(rejected).toEqual([wrongMonth, missingToken])
  })

  test('Should keep every file when there is no report date', () => {
    const files = [buildFile('April2024.xlsx')]

    expect(partitionFilesByName(files, undefined)).toEqual({
      kept: files,
      rejected: []
    })
  })

  test('Should cope with no files', () => {
    expect(partitionFilesByName(undefined, MARCH_2024)).toEqual({
      kept: [],
      rejected: []
    })
  })
})

describe('#reportFileNameErrorText', () => {
  test('Should name the rejected file', () => {
    expect(reportFileNameErrorText('April2024.xlsx', 'March2024')).toBe(
      '‘April2024.xlsx’ must include ‘March2024’'
    )
  })

  test('Should fall back to the selected file when the name is unknown', () => {
    expect(reportFileNameErrorText(undefined, 'March2024')).toBe(
      'The selected file must include ‘March2024’'
    )
  })
})
