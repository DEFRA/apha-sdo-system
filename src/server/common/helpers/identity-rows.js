/**
 * Laboratory and reporting person, in the order every page shows them. A
 * missing value is left out rather than shown blank. The laboratory is the
 * lab code from the app role (`organisationId`): the token carries no
 * display name.
 * @param {{ organisationId?: string | null, name?: string } | null} [user]
 */
export function identityRows(user) {
  return [
    user?.organisationId
      ? {
          key: { text: 'Laboratory name' },
          value: { text: user.organisationId }
        }
      : null,
    user?.name
      ? {
          key: { text: 'Reporting person' },
          value: { text: user.name }
        }
      : null
  ].filter(Boolean)
}
