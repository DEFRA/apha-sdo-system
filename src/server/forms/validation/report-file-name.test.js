import {
  expectedReportFileName,
  matchesReportFileName,
  partitionFilesByName,
  reportDateFromState,
  reportFileNameErrorText,
  reportMonthYearLabel,
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
    [1, '2024-01'],
    [2, '2024-02'],
    [3, '2024-03'],
    [4, '2024-04'],
    [5, '2024-05'],
    [6, '2024-06'],
    [7, '2024-07'],
    [8, '2024-08'],
    [9, '2024-09'],
    [10, '2024-10'],
    [11, '2024-11'],
    [12, '2024-12']
  ])('Should name month %i as %s', (month, expected) => {
    expect(expectedReportFileName({ month, year: 2024 })).toBe(expected)
  })

  test('Should accept the month and year as strings', () => {
    expect(expectedReportFileName({ month: '03', year: '2024' })).toBe(
      '2024-03'
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

describe('#reportMonthYearLabel', () => {
  test('Should format the report date as the engine displays it', () => {
    expect(reportMonthYearLabel(MARCH_2024)).toBe('March 2024')
    expect(reportMonthYearLabel({ month: '11', year: '2023' })).toBe(
      'November 2023'
    )
  })

  test('Should have no label for an unusable report date', () => {
    expect(reportMonthYearLabel(undefined)).toBeUndefined()
    expect(reportMonthYearLabel({ month: 13, year: 2024 })).toBeUndefined()
  })
})

describe('#reportDateFromState', () => {
  test('Should recover the report date from the flat MonthYearField state', () => {
    const state = { reportDate__month: 3, reportDate__year: 2024 }

    expect(reportDateFromState(state)).toEqual({ month: 3, year: 2024 })
    expect(expectedReportFileName(reportDateFromState(state))).toBe('2024-03')
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
    '2024-03.xlsx',
    '2024-03.XLSX',
    '2024-03.csv',
    '2024-03.xls',
    '2024-03',
    ' 2024-03.xlsx ',
    '2024-03 .xlsx',
    '2024-03-1.xls',
    '2024-03-part2.xls',
    '2024-03_v2.xlsx',
    '2024-03.final.xlsx',
    '2024-03 BR Report.xls',
    '2024-03-BR-Report.xls',
    'BatRabies_2024-03.xlsx'
  ])('Should accept %s for 03/2024', (filename) => {
    expect(matchesReportFileName(filename, MARCH_2024)).toBe(true)
  })

  test.each([
    'March2024.xlsx',
    'March 2024.xlsx',
    'March-2024.xlsx',
    '2024-3.xlsx',
    '202403.xlsx',
    '03-2024.xlsx',
    '2024/03.xlsx',
    '2024_03.xlsx',
    '2024 03.xlsx',
    '2024-04.xlsx',
    '2023-03.xlsx',
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
    const matching = buildFile('2024-03 BR Report.xls')
    const suffixed = buildFile('2024-03-BR-Report.xls')
    const wrongMonth = buildFile('2024-04.xlsx')
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
    expect(reportFileNameErrorText('2024-04.xlsx', '2024-03')).toBe(
      '‘2024-04.xlsx’ must include ‘2024-03’'
    )
  })

  test('Should fall back to the selected file when the name is unknown', () => {
    expect(reportFileNameErrorText(undefined, '2024-03')).toBe(
      'The selected file must include ‘2024-03’'
    )
  })
})
