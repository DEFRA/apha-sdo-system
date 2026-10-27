/**
 * No date answered on a form may be in the future: not a day after today, and
 * for a month and year, not a month after this one.
 *
 * The forms engine cannot express this for a MonthYearField. It only takes a
 * fixed latest month, and it keeps each form model it builds for the life of
 * the server, so a month written into a definition would go stale when the
 * month turned. The rule is added to each page's form schema instead, and
 * judges the date against today at the moment it is validated.
 *
 * Today is today in the UK. The service runs in UTC, so for the first hour of
 * a day in British Summer Time the server's own date is still yesterday's.
 */

import { isExists } from 'date-fns'

const UK_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
})

function ukToday() {
  const parts = UK_DATE.formatToParts(new Date())
  const part = (type) => Number(parts.find((item) => item.type === type).value)

  return { year: part('year'), month: part('month'), day: part('day') }
}

// 27 October 2026 as 20261027, so that dates compare as numbers
function dateNumber(year, month, day) {
  return year * 10000 + month * 100 + day
}

// Worded as the GOV.UK date input guidance words a date that must be in the
// past, after the engine's own date errors ("{{#title}} must be a real date")
const FUTURE_DATE_RULES = {
  DatePartsField: {
    message: '{{#title}} must be today or in the past',
    isInFuture: ({ day, month, year }, today) =>
      // A date that does not exist is the engine's to report
      isExists(year, month - 1, day) &&
      dateNumber(year, month, day) >
        dateNumber(today.year, today.month, today.day)
  },
  MonthYearField: {
    message: '{{#title}} must be this month or in the past',
    isInFuture: ({ month, year }, today) =>
      dateNumber(year, month, 1) > dateNumber(today.year, today.month, 1)
  }
}

/**
 * Adds a rule to a page's form schema for each date field on the page.
 * @param {object} formSchema - the page's Joi form schema
 * @param {object[]} fields - the page's form components
 */
export function rejectFutureDates(formSchema, fields) {
  return fields.reduce((schema, field) => {
    const rule = FUTURE_DATE_RULES[field.type]

    if (!rule) {
      return schema
    }

    return schema.custom((payload, helpers) => {
      const value = field.getFormValueFromState(
        field.getStateFromValidForm(payload)
      )

      // The context the engine gives its own date errors, which links the
      // error summary to the first of the date's inputs
      return value && rule.isInFuture(value, ukToday())
        ? helpers.message(rule.message, {
            key: field.name,
            missing: field.collection.keys
          })
        : payload
    })
  }, formSchema)
}
