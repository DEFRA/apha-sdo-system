/**
 * Seeds the local cdp-defra-id-stub with laboratory test identities so
 * external (Defra Customer Identity) sign-in works straight after
 * `npm run docker:up`. The stub keeps registrations in memory, so this runs
 * on every stack start and is safe to re-run.
 *
 * The stub issues tokens in the real Customer Identity shape (colon-delimited
 * `relationships` and `roles`) but allows one role per relationship, so the
 * identities cover one case each. Role names must match AUTH_DEFRA_ID_ROLE_BR
 * and AUTH_DEFRA_ID_ROLE_AHR, which default to the names GIO configured
 * ("BR", "AHR", with "Default" as the placeholder); status 3 is "Complete
 * (approved)". A user holding both roles is covered by the tests.
 */
const stubBaseUrl =
  process.env.DEFRA_ID_STUB_BASE_URL ??
  'http://localhost:3200/cdp-defra-id-stub'

// One lab for all three identities. The stub takes the organisation ID from
// `relationshipId` (it ignores `organisationId`), so the relationship is
// given the lab's ID; relationships are stored per user, so sharing it is fine.
const laboratory = {
  relationshipId: '7f2f65e0-4858-11f0-afd0-f3af378128f9',
  organisationId: '7f2f65e0-4858-11f0-afd0-f3af378128f9',
  organisationName: 'Local Test Laboratory'
}

function identity({ userId, email, firstName, lastName, roleName }) {
  return {
    userId,
    email,
    firstName,
    lastName,
    loa: '1',
    aal: '1',
    enrolmentCount: 1,
    // The stub requires a positive number here; the value is informational
    enrolmentRequestCount: 1,
    relationships: [
      {
        ...laboratory,
        relationshipRole: 'Employee',
        roleName,
        roleStatus: '3'
      }
    ]
  }
}

const testIdentities = [
  identity({
    userId: '86a7607c-a1e7-41e5-a0b6-a41680d05a2a',
    email: 'br.reporter@example.com',
    firstName: 'Bryony',
    lastName: 'Rabies',
    roleName: process.env.AUTH_DEFRA_ID_ROLE_BR ?? 'BR'
  }),
  identity({
    userId: '2c5d1e4e-6c2f-4e3b-9b6e-1b9a7a2f7d11',
    email: 'ahr.reporter@example.com',
    firstName: 'Alex',
    lastName: 'Regulations',
    roleName: process.env.AUTH_DEFRA_ID_ROLE_AHR ?? 'AHR'
  }),
  identity({
    userId: '9d0b3c5a-0f6e-4a1c-8e7d-5f4a3b2c1d00',
    email: 'default.only@example.com',
    firstName: 'Dee',
    lastName: 'Placeholder',
    roleName: 'Default'
  })
]

async function waitForStub(retries = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(
        `${stubBaseUrl}/.well-known/openid-configuration`
      )

      if (response.ok) {
        return
      }
    } catch {
      // stub still starting up
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  throw new Error(`Defra ID stub is not reachable at ${stubBaseUrl}`)
}

async function register(testIdentity) {
  const response = await fetch(`${stubBaseUrl}/API/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(testIdentity)
  })

  if (!response.ok) {
    throw new Error(
      `Defra ID stub registration failed for ${testIdentity.email} (${response.status}): ${await response.text()}`
    )
  }

  console.log(
    `Defra ID stub identity registered: ${testIdentity.email} (${testIdentity.relationships[0].roleName})`
  )
}

await waitForStub()

for (const testIdentity of testIdentities) {
  await register(testIdentity)
}
