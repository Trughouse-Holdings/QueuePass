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
audience scope (`provisionClients`).

**Where the table lives.** `packages/shared/src/realms.ts` (`APP_REALMS`, `LEGACY_REALM`) is the
source for the Backend and the apps' tests. The seed **cannot** import it: the seed image never
copies or builds `packages/shared` on purpose (spec `020` review round 2, n6; asserted by
`scripts/test/seed-image.test.mjs`), and `scripts/seed/package.json` has no dependency on it. The
e2e tests do not build it either (`e2e/fixtures/time.ts`). So the seed keeps its own copy,
`scripts/seed/src/app-realms.ts`, and the e2e tests theirs, `e2e/fixtures/realms.ts`, both
import-free. One test in `packages/shared/test/realms.test.ts` imports both copies by relative path
(Vitest transpiles them) and fails when either differs from `APP_REALMS`. Adding the dependency to
the seed image was rejected: it reverses a reviewed decision of `020` for three short rows.

## R5. Keeping identifiers: rename, not copy

**Question**: QueuePass stores Keycloak subjects: `Order.customerSub`,
`SeatReservation.customerSub`, the in-memory attempt limits, keyed by subject (all customers), and
`Ticket.checkedInBySub` (the agent, next to `checkedInByUsername`). A user made in a new realm gets a new random subject. How do existing users
keep theirs?

**Observed** (throwaway realms, all deleted afterwards; realm `queuepass` never touched):

- `POST /admin/realms/{realm}/users` with an `id` → 201, but the `id` is **ignored** (a random one).
- `POST /admin/realms/{realm}/partialImport` with a user carrying `id`, a role and a password → 200,
  `ADDED`, that `sub` in the token; again → `SKIPPED`.
- **But user identifiers are unique across the whole server.** Importing a user whose `id` already
  exists in **another** realm → **409 "Duplicate resource error"**, even with that other realm
  disabled (spec review round 2, confirmed). So a copy with the same identifier is impossible while
  the original exists: keeping subjects and never deleting an account cannot both hold for a copy.
- **Renaming a realm** (`PUT /admin/realms/{old}` with `realm: <new>`) → 204; the old name is gone
  (404), every user keeps its `id`, password and roles, the login theme and display name stay, and
  a sign-in on the new name issues a token with the **same `sub`** and the new issuer.

**What depends on whose identifier** (code read, 2026-11-09): customers: orders, tickets (through
the order), seat holds, attempt limits; gate agents: only `Ticket.checkedInBySub`, written at
admission and never read back (every screen shows `checkedInByUsername`); admins: nothing.

**Decision** (Mahdi, 2026-11-09): **rename** realm `queuepass` to `queuepass-customer-app`. The 200
customers keep everything. Admins and gate agents get **new** accounts (new subjects, same usernames
and seed password) in their own realms, created as `provisionUsers` creates users today. Their old
copies stay in the customer realm, **disabled**. Past check-ins keep the old agent subject beside
the agent's username, which is what is shown.

**Rejected**:
- *Copy, then delete each original*: keeps every subject, but deletes accounts (against the
  constitution's spirit and FR-007), and a half-done run is harder to reason about.
- *New identifiers and a database rewrite by username*: touches QueuePass data on every laptop,
  the riskiest option before a demo.

## R6. The rename: order, safety, convergence

**Decision**, per run of the seed:

1. **Rename** if realm `queuepass` exists and realm `queuepass-customer-app` does not. If **both**
   exist, fail with a message naming both realms, change nothing (FR-009), and say how to recover:
   rename the extra `queuepass` aside in the admin console (for example `queuepass-recreated`),
   never delete it, then run the seed again. Merging is not attempted. Both exist when code from
   before 028 runs against an upgraded Keycloak: its seed recreates `queuepass` with 235 new
   accounts (R13). If only the customer realm exists (clean system after its first run, or after the
   rename), go on.
2. Converge the three app realms as on a clean system: realm settings, the app's role, the audience
   scope, the app's client, and the app's users (created when missing; an existing user is left
   alone). In the renamed customer realm the customers are already there, so nothing is created
   for them.
3. **In the customer realm only**, disable (never delete) every user who is enabled and lacks the
   `customer` role (the old `admin1`–`5` and `agent1`–`30`), and the clients `admin-app` and
   `booth-app` (`enabled: false`). The roles `queuepass-admin` and `gate-agent` stay defined there,
   unused; the Backend ignores them from this realm anyway (FR-011).

**Why this is safe**: the rename is one atomic call; a run stopped before it changed nothing, and a
run stopped after it is finished by the next run's convergence (step 2 and step 3 are idempotent).
Nothing is ever deleted. A Keycloak admin who needs the old realm back can rename it back in the
admin console.

## R7. Subjects across realms

Keycloak makes every user identifier unique across the server (R5), so QueuePass, which keys data by
subject alone, never sees two users with one subject, even across realms. No change to the
database.

## R8. The Backend: three issuers, one role each

**Decision**: replace the single `OIDC_ISSUER` / `OIDC_JWKS_URL` with two bases:

- `OIDC_ISSUER_BASE` = `http://localhost:8080/realms` (the browser-facing address, as `001` R4)
- `OIDC_JWKS_BASE` = `http://keycloak:8080/realms` (the Compose network address)

and `OIDC_AUDIENCE` unchanged. For each realm in `APP_REALMS` the issuer is
`${OIDC_ISSUER_BASE}/${realm}` and the key set
`${OIDC_JWKS_BASE}/${realm}/protocol/openid-connect/certs`,
one cached remote key set per realm (same cooldown and timeout as today).

The guard reads the token's `iss` **without trusting it** (jose `decodeJwt`), only to pick the
realm: an issuer that is not exactly one of the three is a 401 before any key is fetched. Then
`jwtVerify` checks the token against **that realm's** keys with `issuer` set to that realm's issuer,
the audience and expiry as today. A token signed by one realm's key but claiming another realm's
issuer fails signature verification. Roles: of `realm_access.roles`, keep only the realm's own role
(`APP_REALMS[*].role`); everything else is dropped, so `RolesGuard` answers 403 where another role
is needed (FR-011).

**Startup**: the Backend refuses to start without `OIDC_ISSUER_BASE`, `OIDC_JWKS_BASE` and
`OIDC_AUDIENCE` (as `001` FR-019 does for today's three).

**Rejected**: accepting any issuer under `/realms/` and mapping roles by name only. It would accept
tokens from any realm a Keycloak admin creates later.

## R9. The front ends

The shared `AuthProvider` already takes `authority` and `clientId` as props; each app passes
`VITE_OIDC_AUTHORITY`. Only the defaults change: each app's Dockerfile, `docker-compose.yml` and
`scripts/run-host.mjs` point it at its own realm
(`http://localhost:8080/realms/queuepass-admin-app`,
…). No change to `auth-provider.tsx` is needed: renewal, logout (`signoutRedirect` with the ID
token, which ends only that realm's session), the back-button rule and `beforeLogout` work per
realm as they did for the shared one. `.env.example`'s single `VITE_OIDC_AUTHORITY` becomes three,
one per app.

## R10. Tests

- **Backend** (`backend/test/setup/tokens.ts` mints tokens with a local key pair; `test-app.ts`
  wires a local key set): a key pair and issuer per realm. `tokenFor` picks the realm of the first
  QueuePass role in `roles`, and the **customer** realm when `roles` has none (as in
  `me.e2e-spec.ts`'s `roles: []`), unless a realm is given. New integration tests: each realm's
  token on each role's endpoint (allowed only for its own role); a token whose `iss` is another
  realm's but signed by this realm's key (401); the old realm's issuer (401); an unknown issuer
  (401, no key fetch). **Changed by design**: `hello.e2e-spec.ts`'s "a user holding two roles calls
  both greetings" (one token with `customer` and `gate-agent`) becomes FR-011's case: the token's
  realm's role works, the other is 403. `auth.e2e-spec.ts` builds the issuer literally; it uses
  `issuerFor(realm)`.
- **Seed** (`scripts/seed/test/fake-keycloak.ts` fakes the admin API): add several realms, realm
  rename (`realms.update` with a new `realm` keeps the users), user and client enable/disable, and
  make user identifiers unique across **all** realms as Keycloak does (R5). Tests: a clean run
  creates three realms and 235 users in the right realms; a run over a shared realm renames it to
  the customer realm with every customer's id unchanged, creates the admins and agents in their own
  realms, and disables the old admin and agent copies and the other two clients in the customer
  realm; a second run changes nothing; both realms present fails and changes nothing.
- **Browser (e2e)**: one browser context, three pages, three users (quickstart S1, S2); each app
  makes an authorized API call after the others sign in and after one logs out. **The app's own
  renewal** is driven with Playwright's clock, which belongs to the **browser context** (all pages
  share it): `context.clock.install()` **once**, before the first page loads (installing again
  resets every page's time). Before moving the clock, wait on each realm's refresh:
  `page.waitForResponse` for `POST /realms/<realm>/protocol/openid-connect/token` with
  `grant_type=refresh_token` answering 200. Then `context.clock.runFor('04:05')`, started right
  after the **last** sign-in: renewal is due 240 s after each app's sign-in (60 s before the 300 s
  token expires; each app's timer checks every 5 s), so one `runFor` renews every signed-in app at
  once. (oidc-client-ts 3.5.0's background renewal sets no request timeout, so the real request is
  not aborted by the fake clock.) The limit: if more than about 55 s pass between the **first**
  sign-in and the `runFor`, the first app's token also passes its 300 s expiry during the `runFor`
  and `accessTokenExpired` triggers a second refresh; keep the sign-ins quick, or tolerate a second
  refresh in the assertions. Assert that each realm's
  refresh answered 200, and that the next API request's `Authorization` header carries the **new**
  access token: the Backend checks expiry in real time, so an API call alone would pass with the
  old token and prove nothing. A call to Keycloak's token endpoint from the test would only prove
  Keycloak accepts the token, not that the app renews and stays signed in.
- **Another app's account** (FR-012): `001`'s browser test V4 signed in to each app with another
  app's account and expected the wrong-role page. After `028` those accounts are not in that realm:
  V4 becomes "each app's sign-in page refuses another app's account" (on CI's clean stack,
  Keycloak's "Invalid username or password"; the app not signed in). The wrong-role page itself
  stays covered without a browser sign-in by `packages/shared/test/web/require-role.test.tsx`,
  which gives the page a user without the role.
- **Existing tests and files that name realm `queuepass`**:
  `packages/shared/test/web/auth-provider.test.tsx` (the authority, twice),
  `backend/test/setup/tokens.ts` (`TEST_ISSUER`), `backend/test/integration/auth.e2e-spec.ts` (a
  literal issuer), the seed tests and `scripts/seed/vitest.config.ts` (a comment),
  `scripts/test/run-host.test.mjs`, and the README. The e2e fixtures do not name it (they use the
  `KEYCLOAK` origin and the `.qp-realm` class only).

## R11. Documentation and configuration

`README.md` (service URLs: three realm sign-in pages and the admin console; the note that each app
has its own sign-in), `.env.example` (the new Backend bases, three authorities, `KEYCLOAK_REALM`
retired), `docker-compose.yml` (Backend env, each app's build arg, the seed's env). The seed's
`KEYCLOAK_REALM` is retired: the app realms come from `APP_REALMS`, and the shared realm's name
`queuepass` is a constant (`LEGACY_REALM`) used only by the rename (R6).

## R12. Constitution

Principle V and "Security and Data Constraints" speak of one realm ("the realm's published keys",
"its issuer"). Amendment 3.9.0 (MINOR: guidance materially changed) in this PR:

- Principle V: each front end signs in through its own Keycloak realm, so signing in or out of one
  app never changes another's sign-in; the Backend accepts tokens only from the three app realms,
  checks each against its own realm's keys and issuer, and honours from each realm only that app's
  role; logging out ends the app's own session and its realm's Keycloak session.
- Security and Data Constraints, "Roles and test accounts": each group of test accounts lives in
  its app's realm.
- Principle II ("The Keycloak realms … are created by a deterministic, idempotent seed") and
  Language and Stack (Identity: one realm per front end; Backend token validation against the
  JWKS of the token's own app realm), so the stack table does not still say one realm.
- Roadmap: row `028-app-realms`; the next free number is `029`.

The constitution, the contract, `packages/shared`, `docker-compose.yml` and `.env.example` are
shared surface: every team member approves this PR and the implementation PR.

## R13. Keeping the team stack safe while building and testing

**Problem**: the live seed tests run against whatever Keycloak answers on `localhost:8080` / `9000`
whenever it is up. `scripts/seed/test/seed-idempotence.test.ts` runs `seed()`, which would rename
the team stack's realm `queuepass` and create accounts without anyone agreeing to it;
`sign-in-screens.test.ts` fetches the sign-in pages of the new realms, which do not exist on an
un-upgraded Keycloak, so it would fail. A second stack cannot run beside the team stack: the ports
(5432, 8080, 9000, 3000, 5173–5175) and `KC_HOSTNAME` are fixed. And on this machine the app images
cannot be built (a network that intercepts TLS; README "When the images can't be built", path B):
the team stack runs only `database` and `keycloak` in Docker, and the Backend and the three apps
from the host with `node scripts/run-host.mjs`.

**Decision**:

1. **Guard in the live tests**: before anything else, a live test checks the Keycloak it reaches.
   If realm `queuepass` exists, the test is skipped with the reason "this Keycloak still has the
   shared realm; set QP_SEED_ALLOW_RENAME=1 to let the tests rename it", unless
   `QP_SEED_ALLOW_RENAME=1`. A clean Keycloak (CI, a fresh `-p` stack) has no such realm, so the
   tests run there unchanged.
2. **One stack at a time, path B**: the implementer stops the team stack only during the stretches
   that need a running stack, with Mahdi's agreement (given 2026-11-09 for the test stretches):
   stop the host-run processes holding ports 3000 and 5173–5175, then
   `docker compose -p queuepass-team stop` (never `down`, never `-v`: its volumes and data stay).
   Their own stack: for the clean stretches a throwaway
   `docker compose -p qp028clean up -d --build database keycloak` (removed afterwards with
   `down -v`); for the pre-028 database only (tasks T002, T026–T028) `qp028`, stopped, never
   removed, in between; each with `node scripts/run-host.mjs` from the right checkout. Between
   stretches, and at the end, the team stack comes back (from the main checkout until the walk,
   T032; from 028's code after it): stop the stretch's own stack,
   `docker compose -p queuepass-team start database keycloak` (**only those two**: the project also
   holds old, exited `backend`, `seed` and app containers from weeks ago, which a bare `start` would
   run, taking the ports and running a pre-028 seed), and `node scripts/run-host.mjs` from the main
   checkout (`C:\Users\mahdi\hello_world\QueuePass-team`).
3. The team stack is upgraded from the branch only in the walk (T032), after Mahdi says go, and
   that is the moment its realm is renamed. **From then on it runs only from 028's code** (the
   branch until it merges, then `main`): code from before 028 (an older `run-host.mjs`, or the
   live seed test from another branch) would recreate `queuepass` (R6). If T032 cannot be held
   until the merge, the team-stack upgrade waits until after the merge.
4. **The `028` browser test needs built bundles** (found in implementation, Phase 5 checkpoint):
   `run-host.mjs` serves the apps from Vite's dev server, where React's `StrictMode` runs the
   sign-in callback effect twice, so each sign-in exchanges its authorization code twice. Keycloak
   refuses the second ("Code not valid") and drops the client from the user's session, so the
   app's first refresh is refused ("Session doesn't have required client") and the app signs in
   again through Keycloak instead of renewing. The test waits for each realm's refresh to answer
   200 (R10), so it runs against built bundles: CI's `e2e` job (Compose, `npm run e2e`), or locally
   `vite build` and `vite preview` on 5173–5175 beside `run-host.mjs`'s Backend. The double
   exchange is a development-only behaviour from before 028 (one realm too); FR-013 keeps the
   sign-in code out of 028's scope.
