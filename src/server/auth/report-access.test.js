import { vi } from 'vitest'

import {
  canSubmitReportType,
  getAllowedReportTypes,
  getDefraIdReportAccess,
  getReportAccess,
  parseDefraIdRelationship,
  parseDefraIdRole,
  parseLabRole,
  restrictReportJourneys
} from './report-access.js'
import {
  AUTH_PATHS,
  NO_ACCESS_REPORT_TYPE_FLASH_KEY
} from './auth-constants.js'
import {
  journeySlugsOf,
  reportTypes,
  reportTypesBySlug
} from '#/server/forms/report-types.js'

const batRabies = reportTypesBySlug.get('bat-rabies')
const ahr = reportTypesBySlug.get('animal-health-regulations')

describe('reportTypesBySlug', () => {
  test('resolves the upload and the web form journey to the same report type', () => {
    expect(ahr.webFormSlug).toBe('animal-health-regulations-web-form')
    expect(reportTypesBySlug.get(ahr.webFormSlug)).toBe(ahr)
    expect(journeySlugsOf(ahr)).toEqual([ahr.slug, ahr.webFormSlug])
  })

  test('has one entry per journey slug', () => {
    const slugs = reportTypes.flatMap(journeySlugsOf)

    expect(batRabies.webFormSlug).toBeUndefined()
    expect(journeySlugsOf(batRabies)).toEqual([batRabies.slug])
    expect(new Set(slugs).size).toBe(slugs.length)
    expect([...reportTypesBySlug.keys()]).toEqual(slugs)
  })
})

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

  test('guards the web form journey with the same role as the upload journey', () => {
    const granted = createRequest({
      slug: ahr.webFormSlug,
      user: { id: 'user-id', journeys: ['AHR'] }
    })
    const refused = createRequest({
      slug: ahr.webFormSlug,
      user: { id: 'user-id', journeys: ['BR'] }
    })

    const grantedToolkit = createToolkit()

    expect(restrictReportJourneys(granted, grantedToolkit)).toBe(
      grantedToolkit.continue
    )

    const h = createToolkit()

    expect(restrictReportJourneys(refused, h)).toBe(h.response)
    expect(refused.yar.flash).toHaveBeenCalledWith(
      NO_ACCESS_REPORT_TYPE_FLASH_KEY,
      ahr.title
    )
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

describe('parseDefraIdRelationship', () => {
  test('splits the colon-delimited fields', () => {
    expect(
      parseDefraIdRelationship(
        'rel-1:org-1:Anytown Veterinary Laboratory:1:Employee:2'
      )
    ).toEqual({
      relationshipId: 'rel-1',
      organisationId: 'org-1',
      organisationName: 'Anytown Veterinary Laboratory',
      organisationLoa: '1',
      relationship: 'Employee',
      relationshipLoa: '2'
    })
  })

  test('keeps a colon inside the organisation name', () => {
    expect(
      parseDefraIdRelationship('rel-1:org-1:Labs: North Site:0:Agent:0')
        .organisationName
    ).toBe('Labs: North Site')
  })

  test('reads a citizen relationship with no organisation', () => {
    expect(parseDefraIdRelationship('rel-1:::0:Citizen:0')).toMatchObject({
      organisationId: '',
      organisationName: '',
      relationship: 'Citizen'
    })
  })

  test('rejects values that are not relationships', () => {
    expect(parseDefraIdRelationship('rel-1:org-1')).toBeNull()
    expect(parseDefraIdRelationship(42)).toBeNull()
    expect(parseDefraIdRelationship(undefined)).toBeNull()
  })
})

describe('parseDefraIdRole', () => {
  test('splits relationship, role name and status', () => {
    expect(parseDefraIdRole('rel-1:Bat rabies reporter:3')).toEqual({
      relationshipId: 'rel-1',
      roleName: 'Bat rabies reporter',
      status: '3'
    })
  })

  test('keeps a colon inside the role name', () => {
    expect(parseDefraIdRole('rel-1:Reporter: AHR:3').roleName).toBe(
      'Reporter: AHR'
    )
  })

  test('rejects values that are not roles', () => {
    expect(parseDefraIdRole('rel-1:Reporter')).toBeNull()
    expect(parseDefraIdRole(null)).toBeNull()
  })
})

describe('getDefraIdReportAccess', () => {
  const roleNames = {
    BR: 'Bat rabies reporter',
    AHR: 'Animal Health Regulations reporter'
  }
  const lab = 'rel-1:org-1:Anytown Veterinary Laboratory:0:Employee:0'

  test('grants the journey of an approved role for the current organisation', () => {
    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-1',
          relationships: [lab],
          roles: ['rel-1:Bat rabies reporter:3']
        },
        { roleNames }
      )
    ).toEqual({
      organisationId: 'org-1',
      organisationName: 'Anytown Veterinary Laboratory',
      journeys: ['BR']
    })
  })

  test('grants both journeys to a user holding both roles, in registry order', () => {
    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-1',
          relationships: [lab],
          roles: [
            'rel-1:Animal Health Regulations reporter:3',
            'rel-1:Bat rabies reporter:3'
          ]
        },
        { roleNames }
      ).journeys
    ).toEqual(['BR', 'AHR'])
  })

  test('grants nothing for the placeholder role', () => {
    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-1',
          relationships: [lab],
          roles: ['rel-1:Default:3']
        },
        { roleNames }
      )
    ).toEqual({
      organisationId: 'org-1',
      organisationName: 'Anytown Veterinary Laboratory',
      journeys: []
    })
  })

  test('ignores roles that are not approved', () => {
    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-1',
          relationships: [lab],
          roles: [
            'rel-1:Bat rabies reporter:2',
            'rel-1:Animal Health Regulations reporter:6'
          ]
        },
        { roleNames }
      ).journeys
    ).toEqual([])
  })

  test('ignores roles held for an organisation other than the current one', () => {
    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-1',
          relationships: [lab, 'rel-2:org-2:Other Lab:0:Agent:0'],
          roles: ['rel-2:Bat rabies reporter:3']
        },
        { roleNames }
      )
    ).toEqual({
      organisationId: 'org-1',
      organisationName: 'Anytown Veterinary Laboratory',
      journeys: []
    })
  })

  test('matches role names forgivingly', () => {
    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-1',
          relationships: [lab],
          roles: ['rel-1:  bat RABIES reporter :3']
        },
        { roleNames }
      ).journeys
    ).toEqual(['BR'])
  })

  test('uses the only relationship when none is marked current', () => {
    expect(
      getDefraIdReportAccess(
        { relationships: [lab], roles: ['rel-1:Bat rabies reporter:3'] },
        { roleNames }
      )
    ).toMatchObject({ organisationId: 'org-1', journeys: ['BR'] })
  })

  test('withholds access and reports when no current organisation can be found', () => {
    const logger = { warn: vi.fn() }

    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-9',
          relationships: [lab, 'rel-2:org-2:Other Lab:0:Agent:0'],
          roles: ['rel-1:Bat rabies reporter:3']
        },
        { roleNames, logger }
      )
    ).toEqual({ organisationId: null, organisationName: null, journeys: [] })
    expect(logger.warn).toHaveBeenCalledWith(
      { currentRelationshipId: 'rel-9' },
      expect.stringContaining('no current organisation')
    )
  })

  test('copes with missing or malformed claims', () => {
    expect(getDefraIdReportAccess()).toEqual({
      organisationId: null,
      organisationName: null,
      journeys: []
    })
    expect(
      getDefraIdReportAccess(
        {
          currentRelationshipId: 'rel-1',
          relationships: 'rel-1:org-1:Lab:0:Employee:0',
          roles: [42, 'broken']
        },
        { roleNames }
      ).journeys
    ).toEqual([])
  })
})
