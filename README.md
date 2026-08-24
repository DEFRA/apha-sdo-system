# apha-sdo-system

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_apha-sdo-system&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_apha-sdo-system)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_apha-sdo-system&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_apha-sdo-system)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_apha-sdo-system&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_apha-sdo-system)

Frontend service for APHA SDO submissions, built with Hapi and the DEFRA forms engine.

## Requirements

- Node.js 24 (use the version in `.nvmrc`)
- npm
- Docker

## Run it locally

You need Node.js, npm and Docker. Use the Node version in `.nvmrc`.

```bash
nvm use
npm install
cp .env.example .env
npm run docker:up
npm run dev
```

Open <http://localhost:3000>.

`docker:up` starts the local dependencies, including LocalStack, Redis,
Azurite, cdp-uploader and the OIDC stub.

## Authentication

Internal Defra and APHA users sign in with Microsoft Entra ID using the
authorization-code flow with PKCE.

- Local development uses the OIDC stub on `http://localhost:5556`.
- DEV uses the real `apha-sdo-system-dev` Entra registration.
- External authentication is not implemented yet.

Authentication is required for the form journeys. Health checks, static
assets, the uploader callback, the home page and authentication routes remain
public.

Only a random session ID is stored in the browser. Tokens and identity claims
are stored in the server-side cache: memory locally and Redis when deployed.

### Test authentication locally

The local `.env` should use the values from `.env.example`. Do not put the DEV
client ID, tenant ID or secret in it.

```dotenv
AUTH_ENTRA_ID_CREDENTIAL_MODE=mock
AUTH_ENTRA_ID_OIDC_CONFIGURATION_URL=http://localhost:5556/.well-known/openid-configuration
AUTH_ENTRA_ID_CLIENT_ID=local-stub-client
AUTH_ENTRA_ID_AUTHORIZATION_MODE=groups
AUTH_ENTRA_ID_ALLOWED_GROUP_IDS=local-dev-group
APP_BASE_URL=http://localhost:3000
```

Run `npm run docker:up`, start the app and select **Defra Single Sign-on**.
Successful authentication lands on `/submission-welcome`.

## First DEV authentication test

The tenant, client ID and callback combination has been checked against Entra:

- Tenant ID: `6f504113-6b64-43f2-ade9-242e05780007`
- Client ID: `de586797-a50f-4b14-b777-e5889a37e4f8`
- Callback:
  `https://apha-sdo-system.dev.cdp-int.defra.cloud/signin-entra-id`

`Assignment required` is currently set to **No**. For the first smoke test we
will deliberately allow any user authenticated by the fixed DefraDev tenant.
This is temporary and must be replaced with group authorization before wider
testing.

The remaining checks before deployment are:

1. Add the temporary DEV client secret to CDP Secrets.
2. Add a new cookie password to CDP Secrets.

### DEV environment variables

```dotenv
APP_BASE_URL=https://apha-sdo-system.dev.cdp-int.defra.cloud
AUTH_ENTRA_ID_CREDENTIAL_MODE=client-secret
AUTH_ENTRA_ID_TENANT_ID=6f504113-6b64-43f2-ade9-242e05780007
AUTH_ENTRA_ID_CLIENT_ID=de586797-a50f-4b14-b777-e5889a37e4f8
AUTH_ENTRA_ID_AUTHORIZATION_MODE=tenant-only
AUTH_ENTRA_ID_TENANT_WIDE_ACCESS_CONFIRMED=true
SESSION_COOKIE_SECURE=true
SESSION_CACHE_ENGINE=redis
```

Do not set `AUTH_ENTRA_ID_OIDC_CONFIGURATION_URL` in DEV. CDP must also supply
`NODE_USE_ENV_PROXY=1` with its normal proxy settings.

### DEV secrets

```dotenv
AUTH_ENTRA_ID_CLIENT_SECRET=<temporary-dev-secret>
SESSION_COOKIE_PASSWORD=<unique-random-value-at-least-32-characters>
```

Do not put these values in source control, logs or tickets.

### Smoke-test steps

1. Open <https://apha-sdo-system.dev.cdp-int.defra.cloud>.
2. Select **Defra Single Sign-on**.
3. Sign in with a Defra or APHA account in the DefraDev tenant.
4. Confirm you land on `/submission-welcome`.
5. Open `/sdo-test` and confirm the protected form is available.
6. In a private browser window, open `/sdo-test` directly and confirm it
   redirects to sign-in.
7. Check the application logs. Cookies, authorization codes, secrets and
   tokens must not be present.

If sign-in fails, record the Entra `AADSTS` code, callback error and
application correlation ID.

After this first test succeeds, complete the logout, denied-user, token
refresh and multi-instance Redis tests. Then change authorization to `groups`,
set `AUTH_ENTRA_ID_ALLOWED_GROUP_IDS` to the approved group object IDs and
configure Entra to include group claims in the ID token. Environment variables
alone cannot provide group membership. DEV can move from a client secret to
web identity once its federated credential is available.

## Sessions and Redis

Sessions use Catbox memory locally and Redis in deployed environments. Set
`SESSION_CACHE_ENGINE` to `memory` or `redis` when an override is needed.

Memory sessions must not be used in CDP because they are not shared between
application instances and are lost when an instance restarts.

## File uploads

File uploads are handled by `@defra/forms-engine-plugin` and
[cdp-uploader](https://github.com/DEFRA/cdp-uploader). The uploader scans each
file, stores clean files in S3 and calls this service at `/file`.

Local configuration is in `.env.example`. The local mock scanner rejects
filenames containing `virus`.

## CDP proxy

CDP injects its HTTP proxy settings and `NODE_USE_ENV_PROXY=1`. OIDC
discovery, sign-in and token refresh use the Node proxy support. The future
web-identity STS client is configured to use the same proxy.

No proxy configuration is needed when running against the local OIDC stub.

## Useful commands

```bash
npm run dev              # start the app with file watching
npm run auth:stub        # run only the local OIDC provider
npm run docker:up        # start local dependencies
npm run docker:down      # stop local dependencies
npm test                 # run tests with coverage
npm run lint             # run JavaScript and SCSS linting
npm run format:check     # check formatting
npm run build:frontend   # build frontend assets
npm start                # run the production build locally
```

## Docker

`npm run docker:up` starts the dependencies used by an app running on the
host. The local OIDC stub advertises `localhost`, so authentication is tested
with `npm run dev` on the host rather than the `your-frontend` Compose service.

Build the development image with:

```bash
docker build --target development --tag apha-sdo-system:development .
```

Build the production image with:

```bash
docker build --tag apha-sdo-system .
```

## Licence

This project is licensed under the
[Open Government Licence v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
