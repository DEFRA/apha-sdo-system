import { OAuth2Server } from 'oauth2-mock-server'

/**
 * Local Entra stand-in. It exercises discovery, PKCE, code exchange, signed
 * tokens, claims, refresh and provider logout without tenant credentials.
 */
const port = Number(process.env.OIDC_STUB_PORT ?? 5556)
const host = process.env.OIDC_STUB_HOST ?? 'localhost'
const issuerUrl = process.env.OIDC_STUB_ISSUER_URL ?? `http://localhost:${port}`
const groups = parseList(process.env.OIDC_STUB_GROUP_IDS ?? 'local-dev-group')

// App roles as Entra emits them for assigned groups: Lab.<LAB>.<BR|AHR>.
// The default grants both journeys for one lab; set OIDC_STUB_ROLES to
// Lab.LocalLab.BR to see the BR-only view, or to an empty string for a user
// with no report access.
const roles = parseList(
  process.env.OIDC_STUB_ROLES ?? 'Lab.LocalLab.BR,Lab.LocalLab.AHR'
)

const stubUser = {
  oid: '00000000-0000-4000-8000-000000000001',
  sub: '00000000-0000-4000-8000-000000000001',
  name: 'Local Stub User',
  email: 'local.stub@defra.gov.uk',
  preferred_username: 'local.stub@defra.gov.uk',
  sid: 'local-stub-session',
  groups,
  roles
}

function parseList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const server = new OAuth2Server()
await server.issuer.keys.generate('RS256')
server.issuer.url = issuerUrl

server.service.on('beforeTokenSigning', (token) => {
  Object.assign(token.payload, stubUser)
})

await server.start(port, host)

console.log('Local Entra OIDC stub started')
console.log(`Discovery: ${issuerUrl}/.well-known/openid-configuration`)
console.log(`User: ${stubUser.email}`)
console.log(`Roles: ${roles.length ? roles.join(', ') : '(none)'}`)
