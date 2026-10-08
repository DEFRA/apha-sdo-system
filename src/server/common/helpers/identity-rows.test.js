import { identityRows } from './identity-rows.js'

describe('identityRows', () => {
  test('shows the Entra lab code when the token carries no lab name', () => {
    expect(
      identityRows({ organisationId: 'TestLab1', name: 'A Person' })
    ).toEqual([
      { key: { text: 'Laboratory name' }, value: { text: 'TestLab1' } },
      { key: { text: 'Reporting person' }, value: { text: 'A Person' } }
    ])
  })

  test('prefers the lab name Defra Customer Identity provides', () => {
    expect(
      identityRows({
        organisationId: '7f2f65e0-4858-11f0-afd0-f3af378128f9',
        organisationName: 'Anytown Veterinary Laboratory',
        name: 'Susan Example'
      })[0]
    ).toEqual({
      key: { text: 'Laboratory name' },
      value: { text: 'Anytown Veterinary Laboratory' }
    })
  })

  test('leaves out what is missing', () => {
    expect(identityRows({ name: 'A Person' })).toEqual([
      { key: { text: 'Reporting person' }, value: { text: 'A Person' } }
    ])
    expect(identityRows(null)).toEqual([])
  })
})
