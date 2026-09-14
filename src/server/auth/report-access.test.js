import { vi } from 'vitest'

import {
  canSubmitReportType,
  getAllowedReportTypes,
  getReportAccess,
  parseLabRole,
  restrictReportJourneys
} from './report-access.js'
import {
  AUTH_PATHS,
  NO_ACCESS_REPORT_TYPE_FLASH_KEY
} from './auth-constants.js'
import { reportTypesBySlug } from '#/server/forms/report-types.js'

const batRabies = reportTypesBySlug.get('bat-rabies')
const ahr = reportTypesBySlug.get('animal-health-regulations')

describe('parseLabRole', () => {
  test('splits a lab role into lab and report type code', () => {
    expect(parseLabRole('Lab.TestLab1.BR')).toEqual({
      lab: 'TestLab1',
      code: 'BR'
    })
    expect(parseLabRole('Lab.Weybridge.AHR')).toEqual({
      lab: 'Weybridge',
      code: 'AHR'
    })
  })

  test.each([
    ['another app role', 'Viewer'],
    ['an unknown report type code', 'Lab.TestLab1.XYZ'],
    ['a different prefix', 'Site.TestLab1.BR'],
    ['a missing lab', 'Lab..BR'],
    ['too many parts', 'Lab.Test.Lab1.BR'],
    ['a non-string', 42],
    ['undefined', undefined]
  ])('ignores %s', (_label, role) => {
    expect(parseLabRole(role)).toBeNull()
  })
})

describe('getReportAccess', () => {
  test('grants one journey for a single lab role', () => {
    expect(getReportAccess({ roles: ['Lab.TestLab1.BR'] })).toEqual({
      organisationId: 'TestLab1',
      journeys: ['BR']
    })
  })

  test('grants both journeys, in registry order, for two roles of one lab', () => {
    expect(
      getReportAccess({ roles: ['Lab.TestLab1.AHR', 'Lab.TestLab1.BR'] })
    ).toEqual({
      organisationId: 'TestLab1',
      journeys: ['BR', 'AHR']
    })
  })

  test('ignores roles that are not lab roles', () => {
    expect(
      getReportAccess({ roles: ['Viewer', 'Lab.TestLab1.AHR', 'Lab.X.NOPE'] })
    ).toEqual({
      organisationId: 'TestLab1',
      journeys: ['AHR']
    })
  })

  test('grants nothing without lab roles', () => {
    const none = { organisationId: null, journeys: [] }

    expect(getReportAccess({})).toEqual(none)
    expect(getReportAccess({ roles: [] })).toEqual(none)
    expect(getReportAccess({ roles: ['Viewer'] })).toEqual(none)
    expect(getReportAccess({ roles: 'Lab.TestLab1.BR' })).toEqual(none)
    expect(getReportAccess()).toEqual(none)
  })

  test('fails closed when roles span more than one lab', () => {
    const logger = { warn: vi.fn() }

    expect(
      getReportAccess(
        { roles: ['Lab.TestLab1.BR', 'Lab.TestLab2.BR'] },
        { logger }
      )
    ).toEqual({ organisationId: null, journeys: [] })

    expect(logger.warn).toHaveBeenCalledWith(
      { labs: ['TestLab1', 'TestLab2'] },
      expect.stringContaining('more than one lab')
    )
  })

  test('stays quiet about several labs when no logger is given', () => {
    expect(() =>
      getReportAccess({ roles: ['Lab.TestLab1.BR', 'Lab.TestLab2.BR'] })
    ).not.toThrow()
  })
})

describe('getAllowedReportTypes', () => {
  test('returns the report types the user holds journeys for', () => {
    expect(getAllowedReportTypes({ journeys: ['AHR'] })).toEqual([ahr])
    expect(getAllowedReportTypes({ journeys: ['BR', 'AHR'] })).toEqual([
      batRabies,
      ahr
    ])
  })

  test('returns nothing for a user without journeys', () => {
    expect(getAllowedReportTypes({ journeys: [] })).toEqual([])
    expect(getAllowedReportTypes({})).toEqual([])
    expect(getAllowedReportTypes(undefined)).toEqual([])
  })
})

describe('canSubmitReportType', () => {
  test('is true only for a journey the user holds', () => {
    const user = { journeys: ['BR'] }

    expect(canSubmitReportType(user, batRabies)).toBe(true)
    expect(canSubmitReportType(user, ahr)).toBe(false)
  })

  test('is false without a user, journeys or report type', () => {
    expect(canSubmitReportType(undefined, batRabies)).toBe(false)
    expect(canSubmitReportType({}, batRabies)).toBe(false)
    expect(canSubmitReportType({ journeys: ['BR'] }, undefined)).toBe(false)
  })
})

describe('restrictReportJourneys', () => {
  function createRequest({ slug, isAuthenticated = true, user } = {}) {
    return {
      params: slug === undefined ? {} : { slug },
      auth: { isAuthenticated, credentials: user ? { user } : undefined },
      yar: { flash: vi.fn() },
      logger: { warn: vi.fn() }
    }
  }

  function createToolkit() {
    const response = { takeover: vi.fn() }
    response.takeover.mockReturnValue(response)

    return {
      continue: Symbol('continue'),
      redirect: vi.fn().mockReturnValue(response),
      response
    }
  }

  test('lets a user into a journey their roles grant', () => {
    const request = createRequest({
      slug: 'bat-rabies',
      user: { id: 'user-id', journeys: ['BR'] }
    })
    const h = createToolkit()

    expect(restrictReportJourneys(request, h)).toBe(h.continue)
    expect(h.redirect).not.toHaveBeenCalled()
  })

  test('sends a user to /no-access for a journey their roles do not grant', () => {
    const request = createRequest({
      slug: 'animal-health-regulations',
      user: { id: 'user-id', journeys: ['BR'] }
    })
    const h = createToolkit()

    expect(restrictReportJourneys(request, h)).toBe(h.response)
    expect(request.yar.flash).toHaveBeenCalledWith(
      NO_ACCESS_REPORT_TYPE_FLASH_KEY,
      ahr.title
    )
    expect(h.redirect).toHaveBeenCalledWith(AUTH_PATHS.NO_ACCESS)
    expect(h.response.takeover).toHaveBeenCalled()
    expect(request.logger.warn).toHaveBeenCalledWith(
      { userId: 'user-id', reportType: 'AHR' },
      expect.any(String)
    )
  })

  test('sends a user with no journeys to /no-access', () => {
    const request = createRequest({
      slug: 'bat-rabies',
      user: { id: 'user-id', journeys: [] }
    })
    const h = createToolkit()

    expect(restrictReportJourneys(request, h)).toBe(h.response)
  })

  test('ignores routes that are not report journeys', () => {
    const h = createToolkit()

    expect(
      restrictReportJourneys(createRequest({ user: { journeys: [] } }), h)
    ).toBe(h.continue)
    expect(
      restrictReportJourneys(
        createRequest({ slug: 'help', user: { journeys: [] } }),
        h
      )
    ).toBe(h.continue)
  })

  test('leaves unauthenticated requests to the cookie strategy', () => {
    const request = createRequest({
      slug: 'bat-rabies',
      isAuthenticated: false
    })
    const h = createToolkit()

    expect(restrictReportJourneys(request, h)).toBe(h.continue)
    expect(h.redirect).not.toHaveBeenCalled()
  })
})
