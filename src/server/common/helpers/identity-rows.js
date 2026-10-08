/**
 * Laboratory and reporting person, in the order every page shows them. A
 * missing value is left out rather than shown blank. The laboratory is its
 * name when the token carries one (Defra Customer Identity), otherwise the
 * lab code from the Entra app role (`organisationId`).
 * @param {{ organisationId?: string | null, organisationName?: string | null, name?: string } | null} [user]
 */
export function identityRows(user) {
  const laboratory = user?.organisationName || user?.organisationId

  return [
    laboratory
      ? {
          key: { text: 'Laboratory name' },
          value: { text: laboratory }
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
