/**
 * A report must be uploaded under a file name that includes the report date
 * the user entered, so a report for 03/2024 has to include March2024. Extra
 * text around that token is allowed (March2024-1, March2024-part2), as is any
 * casing or file extension. Separators inside the token and abbreviations are
 * not: March 2024, March-2024 and Mar2024 all fail.
 *
 * The rule is applied wherever an uploaded file meets a report date — on
 * upload, when the report date changes, and again at submit — so it lives here
 * rather than in any one controller.
 */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

// Every report journey names its MonthYearField this (see report-journey.js)
const REPORT_DATE_FIELD_NAME = 'reportDate'

/**
 * The report date as entered, recovered from form state. A MonthYearField
 * holds its two inputs flat in state (reportDate__month and reportDate__year);
 * the combined { month, year } object never exists there, so reading
 * state.reportDate finds nothing.
 * @param {object} [state] - the form state
 */
export function reportDateFromState(state) {
  return {
    month: state?.[`${REPORT_DATE_FIELD_NAME}__month`],
    year: state?.[`${REPORT_DATE_FIELD_NAME}__year`]
  }
}

/**
 * The month-year token a report file name must include, or undefined when the
 * date is missing or unusable. Callers treat undefined as "nothing to validate
 * against", which is what happens on preview URL direct access or if the
 * report date page has not been answered yet.
 * @param {{ month?: number|string, year?: number|string }} [reportDate] - the MonthYearField value from form state
 */
export function expectedReportFileName(reportDate) {
  const month = Number(reportDate?.month)
  const year = Number(reportDate?.year)

  if (!Number.isInteger(month) || month < 1 || month > MONTH_NAMES.length) {
    return undefined
  }

  if (!Number.isInteger(year)) {
    return undefined
  }

  return `${MONTH_NAMES[month - 1]}${year}`
}

/**
 * @param {string} [filename] - the uploaded file name, with or without extension
 * @param {{ month?: number|string, year?: number|string }} [reportDate] - the MonthYearField value from form state
 */
export function matchesReportFileName(filename, reportDate) {
  const expected = expectedReportFileName(reportDate)

  if (!expected) {
    return true
  }

  return String(filename ?? '')
    .toLowerCase()
    .includes(expected.toLowerCase())
}

/**
 * The file name held in a forms-engine FileState entry.
 * @param {{ status?: { form?: { file?: { filename?: string } } } }} [fileState] - an entry of a FileUploadField value
 */
export function uploadedFileName(fileState) {
  return fileState?.status?.form?.file?.filename
}

/**
 * Splits uploaded files into those whose name includes the report date and
 * those that do not.
 * @param {object[]} [files] - a FileUploadField value from form state
 * @param {{ month?: number|string, year?: number|string }} [reportDate] - the MonthYearField value from form state
 */
export function partitionFilesByName(files, reportDate) {
  const kept = []
  const rejected = []

  for (const file of files ?? []) {
    if (matchesReportFileName(uploadedFileName(file), reportDate)) {
      kept.push(file)
    } else {
      rejected.push(file)
    }
  }

  return { kept, rejected }
}

/**
 * Error message shown for a rejected file, worded to match the file upload
 * errors the forms engine raises itself ("The selected file must be smaller
 * than 100MB"). Several files can be uploaded at once, so name the offending
 * one whenever we know it.
 * @param {string} [filename] - the rejected file name
 * @param {string} expected - the month-year token the report date requires
 */
export function reportFileNameErrorText(filename, expected) {
  const subject = String(filename ?? '').trim()

  return subject
    ? `‘${subject}’ must include ‘${expected}’`
    : `The selected file must include ‘${expected}’`
}
