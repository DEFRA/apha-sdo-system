import { vi } from 'vitest'

import {
  assertAllowedEntraGroups,
  formatPersonName,
  getAllowedGroupIds,
  getUserProfile
} from './authorization.js'

describe('getAllowedGroupIds', () => {
  test('uses groups only when group authorization is enabled', () => {
    expect(
      getAllowedGroupIds({
        authorizationMode: 'groups',
        allowedGroupIds: ['group-id']
      })
    ).toEqual(['group-id'])
    expect(
      getAllowedGroupIds({
        authorizationMode: 'assignment-only',
        allowedGroupIds: ['group-id']
      })
    ).toEqual([])
    expect(
      getAllowedGroupIds({
        authorizationMode: 'tenant-only',
        allowedGroupIds: ['group-id']
      })
    ).toEqual([])
  })
})

describe('assertAllowedEntraGroups', () => {
  test('allows any authenticated user when no group list is configured', () => {
    expect(() => assertAllowedEntraGroups({}, [])).not.toThrow()
  })

  test('allows a user in one of the configured groups', () => {
    expect(() =>
      assertAllowedEntraGroups({ groups: ['group-one', 'group-two'] }, [
        'group-two'
      ])
    ).not.toThrow()
  })

  test('rejects a user outside the configured groups', () => {
    expect(() =>
      assertAllowedEntraGroups({ groups: ['other-group'] }, ['allowed-group'])
    ).toThrow('You do not have permission')
  })

  test('fails closed for an Entra group overage claim', () => {
    expect(() =>
      assertAllowedEntraGroups({ _claim_names: { groups: 'src1' } }, [
        'allowed-group'
      ])
    ).toThrow('could not be evaluated')
  })
})

describe('formatPersonName', () => {
  test('uses given name then surname when both claims are present', () => {
    expect(
      formatPersonName({
        name: 'Surname, George',
        given_name: 'George',
        family_name: 'Surname'
      })
    ).toBe('George Surname')
  })

  test('turns a "Surname, Given" display name round when the part claims are absent', () => {
    expect(formatPersonName({ name: 'Surname, George' })).toBe('George Surname')
    expect(formatPersonName({ name: '  Surname,   George Middle  ' })).toBe(
      'George Middle Surname'
    )
  })

  test('drops a trailing directory tag such as "(Other)"', () => {
    expect(formatPersonName({ name: 'Brais Gil (Other)' })).toBe('Brais Gil')
    expect(formatPersonName({ name: 'Gil, Brais (Other)' })).toBe('Brais Gil')
    expect(formatPersonName({ name: 'Brais (Other) Gil' })).toBe(
      'Brais (Other) Gil'
    )
    expect(
      formatPersonName({ given_name: 'Brais', family_name: 'Gil (Other)' })
    ).toBe('Brais Gil')
  })

  test('keeps a display name that is already "Given Surname"', () => {
    expect(formatPersonName({ name: 'George Surname' })).toBe('George Surname')
    expect(formatPersonName({ name: 'A Person' })).toBe('A Person')
  })

  test('returns an empty string when no name claim is present', () => {
    expect(formatPersonName({})).toBe('')
    expect(formatPersonName({ given_name: 'George' })).toBe('')
    expect(formatPersonName({ family_name: 'Surname' })).toBe('')
  })
})

describe('getUserProfile', () => {
  test('normalises identity claims', () => {
    expect(
      getUserProfile({
        oid: 'user-id',
        name: 'A Person',
        preferred_username: 'person@example.gov.uk',
        groups: ['group-id'],
        roles: ['Lab.TestLab1.BR']
      })
    ).toEqual({
      id: 'user-id',
      name: 'A Person',
      email: 'person@example.gov.uk',
      groups: ['group-id'],
      roles: ['Lab.TestLab1.BR'],
      organisationId: 'TestLab1',
      journeys: ['BR']
    })
  })

  test('uses fallback claims and safe defaults', () => {
    expect(
      getUserProfile({ sub: 'subject', email: 'email@example.gov.uk' })
    ).toEqual({
      id: 'subject',
      name: '',
      email: 'email@example.gov.uk',
      groups: [],
      roles: [],
      organisationId: null,
      journeys: []
    })
  })

  test('reports roles spanning several labs through the given logger', () => {
    const logger = { warn: vi.fn() }

    const profile = getUserProfile(
      { oid: 'user-id', roles: ['Lab.TestLab1.BR', 'Lab.TestLab2.AHR'] },
      { logger }
    )

    expect(profile.organisationId).toBeNull()
    expect(profile.journeys).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      { labs: ['TestLab1', 'TestLab2'] },
      expect.stringContaining('more than one lab')
    )
  })
})
