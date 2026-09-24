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
- External authentication (Defra Customer Identity) is being built on a
  separate branch and is not on `main` yet.

Authentication is required for the form journeys. Health checks, static
assets, the uploader callback, the home page and authentication routes remain
public.

Only a random session ID is stored in the browser. Tokens and identity claims
are stored in the server-side cache: memory locally and Redis when deployed.

### Session behaviour

- Signing in returns the user to the page that sent them to sign in, rather
  than always to `/submission-welcome`. The requested page is carried as a
  `redirect` query parameter and, across the round trip to Entra, in a
  short-lived `signInReturnTo` cookie. It is checked by `getSafeRedirect`
  before use, so it can only ever point at a page within this service.
- The sign-in pages and `/signed-out` send an already signed-in user on to
  their destination instead of starting a second handshake.
- Signing out is a `POST` carrying a CSRF crumb, so another site cannot end a
  user's session by linking to it.
- Pages are served `no-store`, so a signed-out user cannot use the browser's
  back button to redisplay a previous user's name or report data.
- The session cookie is `SameSite=Lax`. Only the OIDC state cookie is
  `SameSite=None`, which it needs to survive Entra's cross-site `form_post`
  callback on CDP.
- `keepAlive` extends the cookie on each request, so the four hour lifetime
  runs from the last request rather than from sign-in.
- A user who authenticates but is not in an allowed group is sent to
  `/no-access`, which names the account used and offers a sign-out so they can
  try another one.
- A failed token refresh only ends the session once the access token itself
  has expired, so a brief Entra outage does not sign everyone out mid-report.

### Report access (Entra app roles)

Which lab a user belongs to and which report types they may submit come from
Entra **app roles** on the app registration, named:

```text
Lab.<LAB>.<CODE>      e.g. Lab.TestLab1.BR, Lab.TestLab1.AHR
```

`<LAB>` is the lab code and `<CODE>` is a report type code from
`src/server/forms/report-types.js` (`BR` for Bat rabies, `AHR` for Animal
Health Regulations). One security group per lab per report type is assigned
to the matching role, so a person who does both journeys for a lab is in two
groups and receives two roles. Entra emits assigned app roles in the ID
token's `roles` claim without any token-configuration change.

On every request the session user is rebuilt from the token claims
(`getUserProfile` in `src/server/auth/authorization.js`), which parses the
roles into:

- `organisationId`: the lab code (`TestLab1`)
- `journeys`: the report type codes granted (`['BR']`, `['BR', 'AHR']` or `[]`)

The same two fields will be filled from Defra Customer Identity claims for
external users, so nothing downstream depends on the identity provider.

What the user sees:

- `/submission-welcome` only offers the report types in `journeys`. With none,
  it explains that no report type is assigned to the account.
- Bat rabies continues straight into its upload journey (`/bat-rabies`).
  Animal Health Regulations can be submitted either as a data file or as a web
  form, so it first asks "How would you like to report?" at
  `/animal-health-regulations/how-to-report`, then continues into
  `/animal-health-regulations` (upload) or
  `/animal-health-regulations-web-form` (web form). A report type gets this
  screen by naming a `webFormSlug` in `report-types.js`; the web form journey
  itself is `src/server/forms/definitions/animal-health-regulations-web-form.js`.
- Opening a journey URL directly (`/bat-rabies`, `/animal-health-regulations`,
  `/animal-health-regulations-web-form`, the how-to-report screen and their
  pages) without the matching role is caught by an `onPostAuth` extension
  (`restrictReportJourneys` in `src/server/auth/report-access.js`) and lands
  on `/no-access`, naming the report type. The session stays valid. Both AHR
  journeys are guarded by the same `Lab.<LAB>.AHR` role.
- Roles for more than one lab are refused (no lab, no journeys) and logged as a
  warning at sign-in; choosing a lab is not supported yet.
- **Update diagnostic tests** is offered to every signed-in user, whatever
  their roles, and opens `/diagnostic-tests` (see
  [Diagnostic tests](#diagnostic-tests)).

A group membership change takes effect at the next token refresh. The
successful sign-in log line records `organisationId` and `journeys`, so a DEV
sign-in confirms from the logs that the groups are wired to the right roles.

Adding a report type means adding an entry with a new `code` to
`report-types.js` and a matching `Lab.<LAB>.<CODE>` role per lab in Entra.
Adding a lab means two app roles and two groups; no code or configuration
change.

#### DEV test setup

The `apha-sdo-system-dev` registration defines `Lab.TestLab1.BR` and
`Lab.TestLab1.AHR`, assigned from the groups `AG-APHA-SDO-DEV-TESTLAB1-BR` and
`AG-APHA-SDO-DEV-TESTLAB1-AHR`. Real labs follow `AG-APHA-SDO-<LAB>-<BR|AHR>`
without the environment in the name. Group members must be direct members;
Entra does not honour nested groups for app assignment. "Assignment required"
stays on, so anyone outside the groups is refused by Entra before reaching the
service.

#### Report access locally

The OIDC stub signs its user in with the roles in `OIDC_STUB_ROLES` (default
`Lab.LocalLab.BR,Lab.LocalLab.AHR`, both journeys). To see the other cases:

```bash
OIDC_STUB_ROLES=Lab.LocalLab.BR npm run auth:stub   # BR only
OIDC_STUB_ROLES= npm run auth:stub                  # no report access
```

With `npm run docker:up`, set `OIDC_STUB_ROLES` in `.env` instead (Compose
reads it) and recreate the `oidc-stub` service.

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

`Assignment required` is set to **Yes** on the Enterprise Application, so only
members of the groups assigned to it (the `AG-APHA-SDO-DEV-TESTLAB1-*` lab
groups) can sign in. The service itself runs in `tenant-only` mode and does
not check group membership again; report access comes from the app roles.

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
5. Select **Bat rabies report** and confirm the protected form at
   `/bat-rabies` is available. Repeat for **Animal Health Regulations report**
   at `/animal-health-regulations`.
6. In a private browser window, open `/bat-rabies` directly and confirm it
   redirects to sign-in.
7. Check the application logs. Cookies, authorization codes, secrets and
   tokens must not be present.

If sign-in fails, record the Entra `AADSTS` code, callback error and
application correlation ID.

After this first test succeeds, complete the logout, denied-user, token
refresh and multi-instance Redis tests.

Who may sign in is decided by Entra's "Assignment required" setting on the
Enterprise Application, and what they may submit by the app roles described
in [Report access](#report-access-entra-app-roles). Neither needs
`AUTH_ENTRA_ID_AUTHORIZATION_MODE=groups` or a groups claim; `groups` mode
remains available as an additional allow-list if ever needed. DEV can move
from a client secret to web identity once its federated credential is
available.

## Sessions and Redis

Sessions use Catbox memory locally and Redis in deployed environments. Set
`SESSION_CACHE_ENGINE` to `memory` or `redis` when an override is needed.

Memory sessions must not be used in CDP because they are not shared between
application instances and are lost when an instance restarts.

## File uploads

File uploads are handled by `@defra/forms-engine-plugin` and
[cdp-uploader](https://github.com/DEFRA/cdp-uploader). The uploader scans the
file, stores it in S3 when clean and calls this service at `/file`.

A report is one data file. The upload page takes a single file (`schema.max`
of 1 on the `FileUploadField` in `src/server/forms/definitions/report-journey.js`):
the file picker is single-file and the engine stops offering an upload once
one is attached, so a user who chose the wrong file removes it and uploads
again.

Local configuration is in `.env.example`. The local mock scanner rejects
filenames containing `virus`.

### Submission output

On submit, the confirmation page shows the user their reference number (the
`showReferenceNumber` option of every journey definition), and
`src/server/forms/services/output-service.js` copies the scanned file from S3
to the Azure container as `{referenceNumber}/{filename}` and writes
`{referenceNumber}/submission.json` alongside:

```json
{
  "referenceNumber": "AB12-CD34-EF56",
  "form": "bat-rabies",
  "processName": "BR",
  "userId": "<Entra object ID>",
  "organisationId": "TestLab1",
  "submittedAt": "2026-09-09T10:30:00.000Z",
  "fileName": "March2025.csv",
  "reportMonthYear": "March 2025",
  "answers": [
    { "name": "reportDate", "title": "Report date", "value": "March 2025" },
    {
      "name": "supportingDocuments",
      "title": "Supporting documents",
      "value": "Uploaded 1 file"
    }
  ],
  "entries": []
}
```

- `processName` is the report type `code` for the journey slug in `form`.
- `userId` and `organisationId` come from the signed-in user's session:
  the Entra object ID and the lab code from the app roles. For external users
  they will be the Defra Customer Identity contact ID and organisation ID.
- `fileName` is the data file the uploader completed, or `null` when the
  report has none.
- `reportMonthYear` is the report date exactly as shown on check your answers.
- `entries` carries the entries of a web-form report (below) and is empty for
  an uploaded one, so the record has the same shape for every journey.
- No notification email is recorded or sent. The journey definitions still
  name one (`notificationEmail` in their metadata) because the forms engine
  only runs a live form's submission when it is set.

An Animal Health Regulations report entered as a web form goes through the
same output service and produces the same record, so `userId`,
`organisationId`, `processName` (`AHR`) and `reportMonthYear` are filled in
the same way. What differs is that there is no data file: only
`submission.json` is written, `fileName` is `null`,
`form` is `animal-health-regulations-web-form`, `answers` holds only the
`reportDate`, and the report itself is in `entries`.

A web-form report covers one month but any number of entries, one per
pathogen, species and country. After the report date, the user answers the
pathogen, species, country and count pages for an entry, then reaches the
report entries page (`/animal-health-regulations-web-form/report-entries`),
which lists the entries added so far and offers **Add another entry to the
report** or **Continue**. Entries can be changed and removed there and from
check your answers. The species offered depend on the pathogen chosen (the
conditions on the species list items in the definition), and the counts must
be whole numbers that are not negative. Each entry page lists the answers
given so far (the report date and the entry's earlier answers) above its
question, each with a Change link, and has a back link to the entry's
previous page; changing an earlier answer drops the answers that followed it
in that entry, so those questions are asked again. The page's caption says
whether the entry is being added ("Adding entry 2") or, once it has been
completed before, edited ("Editing entry 2/3"). Beside **Continue**, **Save
and exit** returns to Submission Welcome without saving the page being left
(earlier pages are already saved), and while adding, **Abort new entry**
(a form post, so it cannot be triggered from another site) drops the entry
and returns to the report entries page; when it was the only one the whole
report is abandoned, report date included, and the user returns to
Submission Welcome. Each entry is one object in
`entries`, keyed by answer name and holding the value shown on check your
answers; `otherSpecies` is only present when that entry's species is "Other":

```json
{
  "form": "animal-health-regulations-web-form",
  "processName": "AHR",
  "fileName": null,
  "reportMonthYear": "August 2026",
  "answers": [
    { "name": "reportDate", "title": "Report Date", "value": "August 2026" }
  ],
  "entries": [
    {
      "pathogen": "Tritrichomonas foetus",
      "species": "Other",
      "otherSpecies": "Alpaca",
      "country": "England",
      "submissionsWithQualifyingTest": "12",
      "submissionsWithPositiveSamples": "3",
      "positiveSamples": "5"
    },
    {
      "pathogen": "Bovine Herpes Virus 1 (BHV-1)",
      "species": "Cattle",
      "country": "Wales",
      "submissionsWithQualifyingTest": "1",
      "submissionsWithPositiveSamples": "1",
      "positiveSamples": "0"
    }
  ]
}
```

The forms engine only repeats single pages, so the entry pages are served by
`ReportEntryPageController` and the report entries page by
`ReportEntriesPageController` (see `src/server/forms/controllers/report-entries.js`
for how entries are kept in form state and validated). A report needs at least
one entry and every entry complete before it can continue or be submitted;
`MAX_ENTRIES` in that module caps how many can be added.

Locally, Azurite receives the same blobs (see `AZURE_*` in `.env.example`).

## Diagnostic tests

Before a lab reports, it defines the qualifying tests it uses for each
pathogen and whether each is UKAS accredited. **Update diagnostic tests** on
Submission Welcome opens `/diagnostic-tests` ("Define your qualifying tests
in use"), a plain page served by `src/server/routes/diagnostic-tests` rather
than a forms-engine journey. The pathogens are the ones of the Animal Health
Regulations report; the tests are those of APHA's "Define diagnostic tests in
use" workbook, in its row order, listed in
`src/server/routes/diagnostic-tests/qualifying-tests.js`.

Each pathogen is a collapsed accordion section of checkboxes, one per test.
Ticking a test reveals an **Accreditation** select (Yes, No, Unknown), which
must be answered for every ticked test; at least one test must be ticked. On
an error the page comes back with the sections holding a tick or an error
opened. **Go back** returns to Submission Welcome.

**Continue** delivers the declaration the way a report is delivered: the
workbook, filled in from the ticks, is written to the Azure container as
`{referenceNumber}/diagnostic-tests.xlsx`, with the record below alongside
as `{referenceNumber}/submission.json`
(`src/server/routes/diagnostic-tests/diagnostic-tests-output.js`, reusing the
output service's `uploadSubmissionJson`). When `AZURE_STORAGE_ENABLED` is off
the submission is only logged (`Diagnostic tests submission received`). The
page is then shown again with the answers kept.

The workbook is APHA's template
(`src/server/routes/diagnostic-tests/templates/diagnostic-tests-template.xlsx`)
with one row per test: the disease, the test, an **Accreditation** dropdown
and, hidden, a `TRUE`/`FALSE` cell driven by a form-control checkbox. Filling
it means writing that cell and the accreditation for every row and setting
the checkbox's state; a ticked test gets `TRUE` and its accreditation, every
other row `FALSE` and `Not applicable`, which is why the page does not offer
`Not applicable` for a test in use. Spreadsheet libraries drop form controls,
so `diagnostic-tests-workbook.js` edits the workbook's XML parts inside the
zip (with `fflate`) and copies everything else through unchanged, keeping the
template's styles, dropdowns, check formulas and protection intact.

The record follows the shape of `submission.json` with just the fields that
apply; the tests themselves are in the workbook it names:

```json
{
  "referenceNumber": "ABC-DEF-GHJ",
  "form": "diagnostic-tests",
  "processName": "DT",
  "userId": "<Entra object ID>",
  "organisationId": "TestLab1",
  "submittedAt": "2026-09-24T14:04:00.000Z",
  "fileName": "diagnostic-tests.xlsx"
}
```

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
