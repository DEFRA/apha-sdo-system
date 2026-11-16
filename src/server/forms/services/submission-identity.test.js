import { AUTH_PROVIDERS } from '#/server/auth/auth-constants.js'
import { submissionIdentity } from './submission-identity.js'

const internalUser = {
  provider: AUTH_PROVIDERS.ENTRA_ID,
  id: 'entra-oid',
  name: 'An Internal Person',
  email: 'person@apha.gov.uk',
  organisationId: 'TestLab1',
  journeys: ['AHR']
}

const externalUser = {
  provider: AUTH_PROVIDERS.DEFRA_ID,
  id: 'defra-id-contact-id',
  name: 'An External Person',
  email: 'person@lab.example.com',
  organisationId: '6b2a1c0e-0000-4000-8000-000000000000',
  organisationName: 'Local Test Laboratory',
  journeys: ['BR', 'AHR']
}

describe('#submissionIdentity', () => {
  test('records an external user with their lab named and identified by Customer Identity', () => {
    expect(submissionIdentity(externalUser)).toEqual({
      userId: 'defra-id-contact-id',
      userEmail: 'person@lab.example.com',
      organisationId: 'Local Test Laboratory',
      organisationName: 'Local Test Laboratory',
      organisationUniqueId: '6b2a1c0e-0000-4000-8000-000000000000'
    })
  })

  test('records an internal user with the name of the lab in their role and no organisationUniqueId', () => {
    expect(submissionIdentity(internalUser, { labNames: [] })).toEqual({
      userId: 'entra-oid',
      userEmail: 'person@apha.gov.uk',
      organisationId: 'Test Lab 1',
      organisationName: 'Test Lab 1'
    })
  })

  test("uses a configured name for an internal user's lab", () => {
    expect(
      submissionIdentity(internalUser, {
        labNames: ['TestLab1=The%20First%20Test%20Lab']
      })
    ).toEqual(
      expect.objectContaining({
        organisationId: 'The First Test Lab',
        organisationName: 'The First Test Lab'
      })
    )
  })

  test('treats a user without a provider as internal, as sessions are', () => {
    expect(
      submissionIdentity(
        { ...internalUser, provider: undefined },
        { labNames: [] }
      )
    ).toEqual(expect.objectContaining({ organisationId: 'Test Lab 1' }))
  })

  test('never offers an internal lab code as a Customer Identity organisation', () => {
    expect(
      submissionIdentity(
        { ...internalUser, organisationName: 'Not From Entra' },
        { labNames: [] }
      )
    ).not.toHaveProperty('organisationUniqueId')
  })

  test('writes nulls, and no organisationUniqueId, without a user or lab', () => {
    const none = {
      userId: null,
      userEmail: null,
      organisationId: null,
      organisationName: null
    }

    expect(submissionIdentity(null)).toEqual(none)
    expect(submissionIdentity(undefined)).toEqual(none)
    expect(
      submissionIdentity({
        ...externalUser,
        id: undefined,
        email: '',
        organisationId: null,
        organisationName: null
      })
    ).toEqual(none)
    expect(
      submissionIdentity({ ...internalUser, organisationId: null })
    ).toEqual(expect.objectContaining({ organisationId: null }))
  })
})
