import { vi } from 'vitest'

import {
  assertAllowedEntraGroups,
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
