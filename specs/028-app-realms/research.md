# Research: A Separate Sign-in for Each App

All observations were made on the team stack on 2026-11-09: `main` at `276489a`, Keycloak 26.0.8
(the stack's image), Chromium from the repository's Playwright, seed password from `scripts/seed`.
The probe scripts were throwaway and are not committed; what they showed is recorded here.

## R1. The bug, reproduced

**Observed**: one Chromium context (one browser window), three steps:

| Time | Admin tab | Customer tab |
|---|---|---|
| 3 s | signed in as `admin1` | |
| 6 s | | opened: no sign-in form; "Your account can't use this app. You are signed in as admin1." |
| 7 s | still looks signed in | **Log out**: Keycloak's session for `admin1` ends, for every app |
| 8 s | still looks signed in | signed in as `customer1` |
| 248 s | renewal refused → signs in again → Keycloak hands it `customer1` → wrong-role page | signed in |

**Why**: the three clients share realm `queuepass`. Keycloak's browser session is a cookie per realm
(`KEYCLOAK_SESSION`, `KEYCLOAK_IDENTITY`, path `/realms/queuepass/`), shared by every client of the
realm in that browser. The apps renew with the refresh-token grant (`use.refresh.tokens`, `001`
research R6), and a refresh token belongs to the Keycloak user session it was issued in: when that
session ends, every app holding one of its refresh tokens is refused at its next renewal
(`auth-provider.tsx`'s `endSession`), and the sign-in that follows silently reuses whichever user
the browser's cookie now names.

The ~4-minute delay is the access token's lifespan (300 s, the realm default) less the renewal
margin; it is why the logouts look random.

## R2. Per-app tokens inside one realm cannot work

**Question**: could the apps keep one realm and avoid the conflict on their own (always show the
form with `prompt=login`, renew only with their own refresh tokens, log out by revoking their own
token instead of ending Keycloak's session)?

**Observed** (Authorization Code with PKCE through the real sign-in pages, then token-endpoint
calls):

```
admin    sign-in (prompt=login): admin1     session 11f9…
customer sign-in (prompt=login): customer1  session 8846…  (via "Restart login")
booth    sign-in (prompt=login): agent1     session 34d3…  (via "Restart login")
refresh admin:    REFUSED invalid_grant "Session not active"
refresh customer: REFUSED invalid_grant "Session not active"
refresh booth:    OK as agent1
```

With `prompt=login` and a session present, Keycloak shows "Please re-authenticate" locked to the
current user; "Restart login" lets another user sign in, and that **ends the previous user's
session**. Only the last user signed in can renew. Revoking one client's refresh token (`/revoke`,
200) leaves other sessions alone, but that does not help when the sessions are already gone.

**Decision**: one realm per app. Keycloak's cookies are scoped to the realm's path, so three realms
give the browser three independent sessions.

**Rejected**:
- *One realm, apps work around it*: impossible, as observed.
- *Different Keycloak host names per app* (`localhost`, `127.0.0.1`, …): separate cookies, but the
  issuer then depends on the host name, which `001` research R4 fixed to one public issuer, and the
  trick does not carry to a real deployment.
- *Password grant from the apps*: no browser session at all, but Constitution V forbids a front end
  from handling a password, and it would drop the sign-in pages of `021` and `027`.

## R3. The alternative the user turned down

**Option**: keep one realm; when an app opens while another user is signed in, say so plainly
("You're signed in as admin1 in another QueuePass app; signing in here will sign that one out"), and
notice a logout at once instead of at the next renewal (session-status checks).

**Why not**: it makes the conflict honest but keeps it. Three users in one window, the demo case,
would still be impossible. Mahdi chose separate realms (2026-11-09).

## R4. Realm names and what each holds

**Decision**:

| App | Realm | Client | Role | Users |
|---|---|---|---|---|
| Admin | `queuepass-admin-app` | `admin-app` | `queuepass-admin` | `admin1`–`admin5` |
| Customer | `queuepass-customer-app` | `customer-app` | `customer` | `customer1`–`customer200` |
| Ticket Booth | `queuepass-booth-app` | `booth-app` | `gate-agent` | `agent1`–`agent30` |

Realm names follow the client IDs, so they never read like role names (`queuepass-admin` is a role).
Client IDs, role names, usernames and the seed password are unchanged, so the apps' role checks,
the Backend's `x-required-roles`, every test account and the README credentials stay valid.

Each realm is created like the shared one today (`provisionRealm`): enabled, display name
"QueuePass", login theme `queuepass`, Keycloak's default token lifespans, and the `queuepass-api`
audience scope (`provisionClients`). The realm names are one constant in `packages/shared`
(`APP_REALMS`), used by the seed, the Backend and the tests, so they are written down once.

## R5. Moving users with their identifiers

**Question**: QueuePass stores Keycloak subjects (`Order.customerSub`, `Ticket.checkedInBySub`, seat
reservations, attempt-limit records). Users made in a new realm get new random subjects, which would
cut every existing customer off from their orders. Can a user be created with a chosen subject?

**Observed** in a throwaway realm (`probe138`, deleted afterwards):

- `POST /admin/realms/{realm}/users` with an `id` → 201, but the `id` is **ignored** (a random one).
- `POST /admin/realms/{realm}/partialImport` with `ifResourceExists: SKIP` and a user carrying `id`,
  `realmRoles: ["customer"]` and a plain-text password credential → 200, `ADDED`; the user signs in
  with that password and the access token has that `sub` and `realm_access.roles: ["customer"]`.
- The same import again → 200, `SKIPPED`: nothing changed.

Keycloak's admin API never returns password hashes, so a moved user's password is set again from
the seed password. That is safe because every account in the shared realm is a seeded one
(Constitution: no self-enrollment, no password reset). The keycloak-admin-client in the lockfile
exposes partial import as `kc.realms.partialImport({ realm, rep })`.

**Decision**: the seed creates **every** app-realm user through partial import with `SKIP`:

- **Moved user** (the shared realm exists and has the username): `id`, `username`, `email`,
  `emailVerified`, `firstName`, `lastName`, `enabled` copied from the shared realm; `realmRoles`
  the app's role; `credentials` the seed password.
- **New user** (clean clone, or a username missing from the shared realm): the same fields as
  `provisionUsers` writes today, no `id` (Keycloak picks one).

## R6. The move: order, safety, and turning the old realm off

**Decision**, per run of the seed:

1. Create or converge the three app realms, their role, the audience scope and their client
   (as today, per realm).
2. If realm `queuepass` exists **and is enabled**, read each seeded username from it (`admin1`–`5`,
   `agent1`–`30`, `customer1`–`200`).
3. For each app-realm user (R5): skip it if the app realm already has that username; otherwise
   import it, moved or new. A username present in the app realm with a **different** subject from
   the shared realm's is reported as a clash and left alone (never overwritten, never deleted).
4. When all 235 are present in their app realms, turn realm `queuepass` off
   (`enabled: false`). It is never deleted, and nothing in it is changed or removed.

**Why this order**: the old realm stays usable until the new realms are complete, so a seed stopped
half way leaves a system that still works the old way; the next run finishes the move (users
already moved are skipped). A turned-off realm refuses every sign-in and token request, and its
tokens fail the Backend's issuer check anyway (FR-010).

**Why not delete**: deleting is irreversible and the spec forbids it (FR-007). A team member who
needs the old realm back can turn it on in the admin console.

## R7. Subjects across realms

A Keycloak subject is unique within a realm. QueuePass keys data by subject alone. Moved users keep
their (random, version 4 UUID) subjects, which were unique in the shared realm; new users get fresh
random UUIDs. A collision between realms has the probability of a UUID collision. Scoping every
stored subject by realm would change the database for no practical gain (Constitution VIII).
Recorded, not built.

## R8. The Backend: three issuers, one role each

**Decision**: replace the single `OIDC_ISSUER` / `OIDC_JWKS_URL` with two bases:

- `OIDC_ISSUER_BASE` = `http://localhost:8080/realms` (the browser-facing address, as `001` R4)
- `OIDC_JWKS_BASE` = `http://keycloak:8080/realms` (the Compose network address)

and `OIDC_AUDIENCE` unchanged. For each realm in `APP_REALMS` the issuer is
`${OIDC_ISSUER_BASE}/${realm}` and the key set `${OIDC_JWKS_BASE}/${realm}/protocol/openid-connect/certs`,
one cached remote key set per realm (same cooldown and timeout as today).

The guard reads the token's `iss` **without trusting it** (jose `decodeJwt`), only to pick the
realm: an issuer that is not exactly one of the three is a 401 before any key is fetched. Then
`jwtVerify` checks the token against **that realm's** keys with `issuer` set to that realm's issuer,
the audience and expiry as today. A token signed by one realm's key but claiming another realm's
issuer fails signature verification. Roles: of `realm_access.roles`, keep only the realm's own role
(`APP_REALMS[*].role`); everything else is dropped, so `RolesGuard` answers 403 where another role is
needed (FR-011).

**Startup**: the Backend refuses to start without `OIDC_ISSUER_BASE`, `OIDC_JWKS_BASE` and
`OIDC_AUDIENCE` (as `001` FR-019 does for today's three).

**Rejected**: accepting any issuer under `/realms/` and mapping roles by name only. It would accept
tokens from any realm a Keycloak admin creates later.

## R9. The front ends

The shared `AuthProvider` already takes `authority` and `clientId` as props; each app passes
`VITE_OIDC_AUTHORITY`. Only the defaults change: each app's Dockerfile, `docker-compose.yml` and
`scripts/run-host.mjs` point it at its own realm (`http://localhost:8080/realms/queuepass-admin-app`,
…). No change to `auth-provider.tsx` is needed: renewal, logout (`signoutRedirect` with the ID
token, which ends only that realm's session), the back-button rule and `beforeLogout` work per
realm as they did for the shared one. `.env.example`'s single `VITE_OIDC_AUTHORITY` becomes three,
one per app.

## R10. Tests

- **Backend** (`backend/test/setup/tokens.ts` mints tokens with a local key pair; `test-app.ts`
  wires a local key set): a key pair and issuer per realm. New integration tests: each realm's token
  on each role's endpoint (allowed only for its own role); a token whose `iss` is another realm's
  but signed by this realm's key (401); the old realm's issuer (401); an unknown issuer (401, no
  key fetch).
- **Seed** (`scripts/seed/test/fake-keycloak.ts` fakes the admin API): add partial import with
  `SKIP` and ids, realm enable/disable, and several realms. Tests: clean run creates three realms
  and 235 users in the right realms; a run over a shared realm moves every user with the same
  subject and turns the shared realm off; a second run changes nothing; a clash is reported and
  left alone; a run stopped after N users finishes on the next run.
- **Browser (e2e)**: one browser context, three pages, three users (S1 below in quickstart); each
  app makes an authorized API call after the others sign in and after one logs out; and each app's
  refresh token still renews after the others signed in (the renewal is driven through Keycloak's
  token endpoint from the test, so the test does not wait 4 minutes for the timer).
- **Existing tests** that name realm `queuepass` (seed tests, `e2e/fixtures/backdrop.ts`, `027`'s
  e2e, `scripts/test/run-host.test.mjs`) move to the app realms.

## R11. Documentation and configuration

`README.md` (service URLs: three realm sign-in pages and the admin console; the note that each app
has its own sign-in), `.env.example` (the new Backend bases, three authorities, `KEYCLOAK_REALM`
retired), `docker-compose.yml` (Backend env, each app's build arg, the seed's env). The seed's
`KEYCLOAK_REALM` is retired: the app realms come from `APP_REALMS`, and the shared realm's name
`queuepass` is a constant (`LEGACY_REALM`) used only by the move.

## R12. Constitution

Principle V and "Security and Data Constraints" speak of one realm ("the realm's published keys",
"its issuer"). Amendment 3.9.0 (MINOR: guidance materially changed) in this PR:

- Principle V: each front end signs in through its own Keycloak realm, so signing in or out of one
  app never changes another's sign-in; the Backend accepts tokens only from the three app realms,
  checks each against its own realm's keys and issuer, and honours from each realm only that app's
  role; logging out ends the app's own session and its realm's Keycloak session.
- Security and Data Constraints, "Roles and test accounts": each group of test accounts lives in
  its app's realm.
- Roadmap: row `028-app-realms`; the next free number is `029`.

The constitution, the contract, `packages/shared`, `docker-compose.yml` and `.env.example` are
shared surface: every team member approves this PR and the implementation PR.
