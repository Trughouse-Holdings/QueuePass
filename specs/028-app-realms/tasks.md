---
description: "Task list for A Separate Sign-in for Each App"
---

# Tasks: A Separate Sign-in for Each App

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (text only, 1.21.0),
[quickstart.md](./quickstart.md) (S0–S7)

**Issue**: [#138](https://github.com/Trughouse-Holdings/QueuePass/issues/138). The implementation
PR's **description** says `fixes #138` on its own line. No commit message on either branch may
contain "fixes #138", "closes #138", or "resolves #138".

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks and
confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `028-app-realms-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `028-app-realms-spec` and carry in every change that PR's review makes; once it merges, bring it
  up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 028: realm table (T003, #138)`.
- **One independent review** (Constitution III) of the implementation branch before its PR (T030).
- **`npm run ci` locally** before pushing (T031), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge (T034).
- **Docker**: do not stop or change another session's running stack, and **never touch the team
  stack's Keycloak data** (compose project `queuepass-team`) until the walk in T032: use your own
  Compose project name (`-p qp028`) and its own volumes.
- **Nothing is deleted from Keycloak** (FR-007): no test, script or manual step deletes realm
  `queuepass` or a user in it. Throwaway realms made by a probe are the only exception, and are named
  `probe…`.
- **Shared surface**: `packages/shared/`, `docker-compose.yml`, `.env.example`, `.github/workflows/`
  (if touched) need every team member's approval in the PR.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `028-app-realms-impl` from `028-app-realms-spec` (or from `main` once the spec PR has
  merged); `npm ci`; `npm run ci` green before any change, so a later failure is this feature's.
- [ ] T002 Start a stack of your own from `main` (`docker compose -p qp028 up --build -d`), with demo
  data (`docker compose -p qp028 exec backend node backend/dist/scripts/demo-data.js`) and one order
  for `customer1` and one check-in by `agent1` made through the apps. This is the **pre-028
  database** for US3 (T026–T028, T032). Record `customer1`'s subject and ticket codes.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the realm table everything reads.

### Tests first

- [ ] T003 `packages/shared/test/realms.test.ts`: `APP_REALMS` has exactly the three rows of
  data-model.md (realm, clientId, role, prefix, count); realm names are unique and none equals a
  role name or `LEGACY_REALM`; every `role` is a `Role`; the counts add to 235.

### Implementation

- [ ] T004 `packages/shared/src/realms.ts` and its export from `packages/shared/src/index.ts`
  (data-model.md, research R4). `npm run build --workspace @queuepass/shared`.

---

## Phase 3: User Story 4 - Each role only counts in its own app (P2, built first)

**Why first**: the Backend must accept the new realms before any app or seed uses them (plan, Order
of work).

### Tests first

- [ ] T005 `backend/test/setup/keys.ts`, `tokens.ts`, `test-app.ts`: a trusted key pair **per app
  realm** (plus the existing rogue key); `tokenFor` signs with the key of the realm it is given, and
  when no realm is given picks the realm of the first role in `roles` (so every existing test keeps
  passing unchanged); `TEST_ISSUER` replaced by `issuerFor(realm)`; the test app overrides the
  per-realm key sets with local ones (research R10).
- [ ] T006 [US4] `backend/test/integration/auth.realms.e2e-spec.ts`, against `GET /me` and one
  endpoint per role (`queuepass-admin`, `customer`, `gate-agent`):
  1. each realm's token with its own role: allowed; `GET /me` returns only that role;
  2. each realm's token listing **all three** roles: allowed only on its own role's endpoint, 403 on
     the others; `GET /me` lists only its own role (FR-011);
  3. a token with `iss` = realm B, signed with realm A's key: 401 (R8);
  4. `iss` = `http://localhost:8080/realms/queuepass` (the retired realm), signed with any trusted
     key: 401 (FR-010);
  5. an unknown issuer: 401, and no key set is fetched (assert the per-realm key-set providers are
     not called);
  6. a token without `iss`: 401.
- [ ] T007 [US4] `backend/test/unit/oidc-config.spec.ts` (new; match the folder's file naming): the Backend
  refuses to start without `OIDC_ISSUER_BASE`, `OIDC_JWKS_BASE` or `OIDC_AUDIENCE`, naming the
  missing ones; trailing slashes on the bases are tolerated.

### Implementation

- [ ] T008 [US4] `backend/src/auth/jwks.provider.ts`: `oidcConfig()` reads `OIDC_ISSUER_BASE`,
  `OIDC_JWKS_BASE`, `OIDC_AUDIENCE`; the provider builds one cached remote key set per realm in
  `APP_REALMS` (same cooldown and timeout as today), keyed by realm (research R8, data-model.md).
- [ ] T009 [US4] `backend/src/auth/auth.guard.ts`: `decodeJwt` to read `iss` (untrusted); an
  issuer not exactly `${OIDC_ISSUER_BASE}/${realm}` for one of the three realms is a 401 before any
  key is fetched; `jwtVerify` with that realm's key set and `issuer`, the audience and expiry rules
  unchanged; roles = `realm_access.roles` filtered to that realm's one role (FR-010, FR-011). Keep
  the refusal message the same for every failure (contract `Unauthenticated`).
- [ ] T010 [US4] Every other reader of `OIDC_ISSUER` / `OIDC_JWKS_URL` in the Backend (grep), the
  Backend's `.env`-style defaults, and its Dockerfile if it names them.

**Checkpoint**: `npm test --workspace @queuepass/backend` green, the existing suites unchanged.

---

## Phase 4: User Story 3 - Existing accounts and their data carry over (P1)

### Tests first

- [ ] T011 [US3] `scripts/seed/test/fake-keycloak.ts` (+ its unit test): several realms; realm
  `enabled` read and update; `realms.partialImport` with `ifResourceExists: SKIP` that keeps a given
  `id`, applies `realmRoles` and a password credential, and reports `ADDED`/`SKIPPED` per user;
  refuse a realm delete or user delete with a test failure (Ground rules: nothing deleted).
- [ ] T012 [P] [US3] `scripts/seed/test/realms.test.ts` (clean system): one seed run creates the
  three realms (display name "QueuePass", login theme `queuepass`, enabled), each with its one role,
  the `queuepass-api` audience scope and mapper, its one client (`desiredClient`), and exactly its
  users (5 / 200 / 30) with the right role and the seed password; no realm `queuepass` is created.
- [ ] T013 [P] [US3] `scripts/seed/test/move.test.ts` (over a shared realm with the 235 users and
  known ids): after one run every user is in its app realm **with the same id**, username, email and
  names, its role, and the seed password; realm `queuepass` is **disabled** and still holds all 235
  users unchanged; a second run makes no change (no `ADDED`, no update to any realm or user).
- [ ] T014 [P] [US3] `scripts/seed/test/move-edge.test.ts`: (a) a run stopped after N users (the
  fake throws on user N+1) leaves realm `queuepass` **enabled**; the next run finishes the move and
  then disables it; (b) a username already in an app realm with a different id from the shared
  realm's is reported as a clash, left as it is, and the shared realm is still disabled once every
  username is present; (c) a username missing from the shared realm is created new (no id) (R6).
- [ ] T015 [US3] Move every existing seed test off `KEYCLOAK_REALM` / realm `queuepass`
  (`provision-realm`, `realm-roles`, `users`, `clients`, `provision-clients`, `index`,
  `keycloak-client`, `seed-idempotence`, `sign-in-screens`, `login-theme-files`): each now checks
  its realm-level behaviour once per app realm.

### Implementation

- [ ] T016 [US3] `scripts/seed/src/keycloak-client.ts`: `loadConfig` without `realm`;
  `KEYCLOAK_REALM` no longer read.
- [ ] T017 [US3] `scripts/seed/src/provision-realm.ts`: `provisionRealm(kc, realm, role)`, the same
  check-then-create and login-theme convergence as today, per realm.
- [ ] T018 [US3] `scripts/seed/src/provision-clients.ts`: `provisionClient(kc, realm, client)`: the
  audience scope and the one client in its own realm (`desiredClient` unchanged).
- [ ] T019 [US3] `scripts/seed/src/retire-legacy-realm.ts` (new): `legacyUsers(kc)` returns the
  shared realm's users by username when it exists and is enabled, else none; `retireLegacyRealm(kc)`
  sets `enabled: false` only when every username in `APP_REALMS` is present in its app realm (R6).
- [ ] T020 [US3] `scripts/seed/src/provision-users.ts`: per realm, for each username: skip if present
  (clash check against the shared realm's id, R6 step 3); else `kc.realms.partialImport` with
  `SKIP`, moved (id and profile from the shared realm) or new (data-model.md). Log per realm: added,
  moved, already present, clashes.
- [ ] T021 [US3] `scripts/seed/src/index.ts`: for each app realm: realm, client, users; then
  `retireLegacyRealm`. The final log line names the three realms and the counts.

**Checkpoint**: `npm test --workspace @queuepass/seed` green; the live seed tests run against your
`qp028` Keycloak.

---

## Phase 5: User Stories 1 and 2 - Three apps, three users; logging out of one (P1) 🎯 MVP

### Tests first

- [ ] T022 [US1] [US2] `e2e/tests/028-app-realms.spec.ts` (quickstart S1, S2; Automation table), in
  **one** browser context:
  1. sign in to Admin as `admin1`, then open Customer: its own sign-in page (not the wrong-role
     page); sign in as `customer1`; then Booth as `agent1` (FR-003);
  2. each app makes an authorized call (`GET /me` through the app, or a visible signed-in page whose
     data came from the API), as its own user (FR-001);
  3. each app's renewal still works after the others signed in: drive one renewal per app (from the
     page, through the app's `UserManager.signinSilent`, or at Keycloak's token endpoint with the
     app's refresh token) and assert success as the same user (FR-002; R10: no 4-minute wait);
  4. log out of Customer: Customer shows its sign-in page; Admin and Booth renew and call the API
     again successfully; sign in to Customer as `customer2` (US2);
  5. repeat step 4 for Admin and for Booth (SC-002).
- [ ] T023 [P] `e2e/fixtures/apps.ts`, `sign-in.ts`, `api.ts` and the `027` spec: every place that
  names realm `queuepass` or builds a Keycloak URL from it uses the app's own realm.

### Implementation

- [ ] T024 [US1] `admin-app/Dockerfile`, `customer-app/Dockerfile`, `booth-app/Dockerfile`: the
  default `VITE_OIDC_AUTHORITY` for each app's own realm (data-model.md).
- [ ] T025 [US1] `docker-compose.yml`: the Backend's `OIDC_ISSUER_BASE` / `OIDC_JWKS_BASE` in place
  of `OIDC_ISSUER` / `OIDC_JWKS_URL`; each app's build arg from `VITE_ADMIN_OIDC_AUTHORITY`,
  `VITE_CUSTOMER_OIDC_AUTHORITY`, `VITE_BOOTH_OIDC_AUTHORITY` with its own default; the seed's
  `KEYCLOAK_REALM` removed. `.env.example` to match, with the comments brought up to date.
  `scripts/run-host.mjs` (+ `scripts/test/run-host.test.mjs`): the same, per app.

**Checkpoint**: on `qp028` (clean volumes), `docker compose -p qp028 up --build` seeds three realms;
`npx playwright test 028` passes three times in a row.

---

## Phase 6: The move on a real pre-028 database (US3)

- [ ] T026 [US3] On T002's stack, rebuild from this branch (`docker compose -p qp028 up --build`):
  the seed log shows 235 users moved and realm `queuepass` turned off. Record the log lines.
- [ ] T027 [US3] Quickstart S3 steps 1–4 on that stack: `customer1` sees the same ticket codes and
  has the same subject (Keycloak admin console, Users); Admin shows the same orders and check-in;
  `agent1` signs in. Record the results.
- [ ] T028 [US3] Run the seed again on that stack: nothing changes (S3 step 5). Record the log.

---

## Phase 7: Polish, review, pull request

- [ ] T029 README: service URLs (each app's realm; the admin console note says the three app realms
  and that `queuepass` is the retired one, disabled), the **Today** paragraph (each app has its own
  sign-in; three users in one browser window), the troubleshooting row about `401` with a valid
  login (now the issuer **base**), the `028` status row (status and task count). The constitution
  reference already reads v3.9.0.
- [ ] T030 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, and research.md; fix the findings; record the round, its findings, and
  any left open here.
- [ ] T031 `npm run ci` locally, green, with your `qp028` Keycloak up so the live seed tests run;
  `npm run test:tz`; record the counts per workspace and each workspace's line coverage (80% floor).
- [ ] T032 Running-system walk on the **team stack** (`queuepass-team`), after Mahdi agrees: rebuild
  from this branch, then quickstart S1–S3 and S5–S7 by hand in one browser window, **15 minutes**
  for S1 (SC-001); record each scenario's result. Mahdi walks S1 and S2 in his own browser and
  approves; record it.
- [ ] T033 Run `npx playwright test` (the whole e2e suite) three times in a row, green; record the
  counts and the `028` spec's time.
- [ ] T034 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #138`, lists the review, the walk, the test counts, and
  the shared surface touched (`packages/shared/`, `docker-compose.yml`, `.env.example`; Nate
  requested). Wait for CI green on GitHub (`test` and `e2e`) on the final commit; merge only when
  green and approved.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T004)** → every story.
- **US4 (T005–T010)** before the seed and the apps change, so the Backend accepts the new realms.
- **US3 seed (T011–T021)** after T004. T011 before T012–T015.
- **US1/US2 (T022–T025)** after T010 and T021.
- **The move on a real database (T026–T028)** after T025.
- **Polish (T029–T034)** last; T032 needs Mahdi's go-ahead to touch the team stack.

### Parallel opportunities

- T012, T013, T014 (three seed test files) once T011 is done.
- T023 alongside T022.

## Implementation Strategy

- **MVP**: Setup, Foundational, US4, US3's seed, US1/US2 (T001–T025): three realms, the Backend
  accepts them, the apps use them. Not shippable without Phase 6: a laptop with data must keep it.
- Then the move on a real database, the README, the review, the walk, and the PR.

## Review record (spec branch)

- (to be filled by the independent review of the spec PR)
