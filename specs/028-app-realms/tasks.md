---
description: "Task list for A Separate Sign-in for Each App"
---

# Tasks: A Separate Sign-in for Each App

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R13),
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
- **Docker and the team stack, path B** (research R13): this machine cannot build the app images,
  so every stack runs `database` and `keycloak` in Docker and the Backend and apps from the host
  (`node scripts/run-host.mjs`). The team stack (compose project `queuepass-team`, its host
  processes started from `C:\Users\mahdi\hello_world\QueuePass-team`) holds every fixed port.
  **Mahdi agreed (2026-11-09)** to stopping it during the stretches that need a running stack, and
  restarting it between them: stop the host processes holding ports 3000 and 5173–5175 (Ctrl+C in
  `run-host.mjs`'s terminal stops all four; if it runs in the background, stop that process), then
  `docker compose -p queuepass-team stop` (never `down`, never `-v`: its volumes and data must
  stay). Restore it after every stretch: `docker compose -p qp028 stop`,
  `docker compose -p queuepass-team start database keycloak` (**only those two**: the project also
  holds old exited `backend`, `seed` and app containers that a bare `start` would run), and
  `node scripts/run-host.mjs` from the main checkout **until T032**, and from this branch from
  T032 on (then `main` after the merge: pre-028 code would recreate `queuepass`, research R13),
  then check http://localhost:5173 answers. Its realm is renamed only in T032, after Mahdi says go.
- **Live seed tests**: they reach whatever Keycloak is up. T015a's guard lands **before** T019–T021,
  so no `npm test` / `npm run ci` can rename a stack's realm unless `QP_SEED_ALLOW_RENAME=1` is set.
  Run them against a **clean** `qp028clean` Keycloak (no realm `queuepass`, so no switch is needed;
  `docker compose -p qp028clean down -v` afterwards: its own throwaway volumes only). Set the switch
  only on a throwaway pre-028 project such as `qp028scratch`, never on `qp028` or the team stack.
- **`qp028` holds T002's pre-028 database** for T026: it is started only in T002 and T026–T028, and
  stopped (never `down`) in between.
- **Tools on this machine**: Node is portable
  (`C:\Users\mahdi\AppData\Local\Temp\claude\C--Users-mahdi-hello-world\bb4be332-7a80-48b1-bcc8-df6f8f8ff81d\scratchpad\node22`,
  prepend it to `PATH`); its `npx` works (repaired 2026-11-09), so `npm run ci` runs. Run Playwright
  with the repository's config: `node node_modules/@playwright/test/cli.js test -c
  e2e/playwright.config.ts …` (it caps workers at 3 and sets the
  locale and time zone that the fixtures need).
- **Nothing is deleted from Keycloak** (FR-007): no test, script or manual step deletes a realm,
  client or user (old copies are disabled). Throwaway realms made by a probe are the only exception,
  and are named `probe…`.
- **Shared surface**: `packages/shared/`, `docker-compose.yml`, `.env.example`, `.github/workflows/`
  (if touched) need every team member's approval in the PR.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `028-app-realms-impl` from `028-app-realms-spec` (or from `main` once the spec PR has
  merged); `npm ci`; `npm run ci` green before any change, so a later failure is this feature's.
- [ ] T002 Stretch 1 (Ground rules): stop the team stack, then make the **pre-028 database** from
  a worktree of `main` (with the Keycloak image built: `docker compose -p qp028 build keycloak`):
  `docker compose -p qp028 up -d database keycloak`, then
  `node scripts/run-host.mjs --demo-data` from that worktree; through the apps, one order for
  `customer1` and one check-in by `agent1`. Record `customer1`'s subject (Keycloak admin console)
  and ticket codes. Stop the host processes and `docker compose -p qp028 stop` (never `down`: T026
  needs this data), and restore the team stack.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the realm table everything reads.

### Tests first

- [ ] T003 `packages/shared/test/realms.test.ts`: `APP_REALMS` has exactly the three rows of
  data-model.md (realm, clientId, role, prefix, count); realm names are unique and none equals a
  role name or `LEGACY_REALM`; every `role` is a `Role`; the counts add to 235; and the seed's copy
  (`../../../scripts/seed/src/app-realms`) and the e2e copy (`../../../e2e/fixtures/realms`),
  imported by relative path, are deep-equal to `APP_REALMS` and `LEGACY_REALM` (research R4).

### Implementation

- [ ] T004 `packages/shared/src/realms.ts` and its export from `packages/shared/src/index.ts`; the
  import-free copies `scripts/seed/src/app-realms.ts` and `e2e/fixtures/realms.ts` (data-model.md,
  research R4). The seed keeps importing nothing from `packages/shared`
  (`scripts/test/seed-image.test.mjs` unchanged). `npm run build --workspace @queuepass/shared`.

---

## Phase 3: User Story 4 - Each role only counts in its own app (P2, built first)

**Why first**: the Backend must accept the new realms before any app or seed uses them (plan, Order
of work).

### Tests first

- [ ] T005 `backend/test/setup/keys.ts`, `tokens.ts`, `test-app.ts`: a trusted key pair **per app
  realm** (plus the existing rogue key); `tokenFor` signs with the key of the realm it is given, and
  when no realm is given picks the realm of the first QueuePass role in `roles`, or the customer
  realm when there is none (`me.e2e-spec.ts`'s `roles: []`); `TEST_ISSUER` replaced by
  `issuerFor(realm)`, also in `auth.e2e-spec.ts`'s literal issuer; the test app overrides the
  per-realm key sets with local ones (research R10). Existing tests keep passing unchanged
  **except** `hello.e2e-spec.ts`'s "a user holding two roles calls both greetings", which changes by
  design to FR-011's rule: only the token's realm's role works, the other greeting is 403.
- [ ] T006 [US4] `backend/test/integration/auth.realms.e2e-spec.ts`, against `GET /me` and one
  endpoint per role (`queuepass-admin`, `customer`, `gate-agent`):
  1. each realm's token with its own role: allowed; `GET /me` returns only that role;
  2. each realm's token listing **all three** roles: allowed only on its own role's endpoint, 403 on
     the others; `GET /me` lists only its own role (FR-011); include the `hello` greetings;
  3. a token with `iss` = realm B, signed with realm A's key: 401 (R8);
  4. `iss` = `http://localhost:8080/realms/queuepass` (the retired realm), signed with any trusted
     key: 401 (FR-010);
  5. an unknown issuer: 401, and no key set is fetched (assert the per-realm key-set providers are
     not called);
  6. a token without `iss`: 401.
- [ ] T007 [US4] `backend/test/unit/oidc-config.spec.ts` (new; match the folder's file naming): the
  Backend
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
  rename through `realms.update({ realm: old }, { realm: new })` (the minimal call; observed to
  work) keeping every user, client, role and scope, and the default-roles composite under its old
  name (`default-roles-queuepass`: Keycloak does not rename it);
  user and client `enabled` read and update; user ids **unique across all realms**, as Keycloak
  makes them (a create or import with an id that exists in any realm fails with 409, research R5);
  a realm, client or user delete fails the test (Ground rules: nothing deleted).
- [ ] T012 [P] [US3] `scripts/seed/test/realms.test.ts` (clean system): one seed run creates the
  three realms (display name "QueuePass", login theme `queuepass`, enabled), each with its one role,
  the `queuepass-api` audience scope and mapper, its one client (`desiredClient`), and exactly its
  users (5 / 200 / 30) with the right role and the seed password; no realm `queuepass` is created.
- [ ] T013 [P] [US3] `scripts/seed/test/rename.test.ts` (over a realm `queuepass` holding the 235
  users with known ids and the three clients): after one run there is no realm `queuepass`;
  `queuepass-customer-app` holds the 200 customers **with the same ids**, enabled, and the 35 old
  admin and agent copies **disabled**, and its `admin-app` and `booth-app` clients **disabled**, its
  `customer-app` client converged; the Admin and Booth realms hold new accounts for `admin1`–`5`
  and `agent1`–`30`; nothing was deleted; a second run makes no change at all.
- [ ] T014 [P] [US3] `scripts/seed/test/rename-edge.test.ts`: (a) realms `queuepass` **and**
  `queuepass-customer-app` both present: the seed fails with a message naming both and changes
  nothing (FR-009); (b) a run that stops right after the rename (the fake throws on the next call)
  is finished by the next run: the old copies get disabled, the other realms built; (c) a customer
  deleted by hand from the customer realm after the rename is recreated (a new id: expected, and
  logged); (d) the both-present error message tells how to recover (rename the extra `queuepass`
  aside, never delete it).
- [ ] T015 [US3] Move every existing seed test off `KEYCLOAK_REALM` / realm `queuepass`
  (`provision-realm`, `realm-roles`, `users`, `clients`, `provision-clients`, `index`,
  `keycloak-client`, `seed-idempotence`, `sign-in-screens`, `login-theme-files`, and the comment in
  `scripts/seed/vitest.config.ts`): each now checks its realm-level behaviour once per app realm.
- [ ] T015a [US3] **Before T019–T021**: the live seed tests (`seed-idempotence`, which runs
  `seed()`, and `sign-in-screens`, which fetches the new realms' sign-in pages) skip, with the
  reason of research R13, when the Keycloak they reach has a realm `queuepass`, unless
  `QP_SEED_ALLOW_RENAME=1`; a unit test covers the guard both ways (R13).

### Implementation

- [ ] T016 [US3] `scripts/seed/src/keycloak-client.ts`: `loadConfig` without `realm`;
  `KEYCLOAK_REALM` no longer read.
- [ ] T017 [US3] `scripts/seed/src/provision-realm.ts`: `provisionRealm(kc, realm, role)`, the same
  check-then-create and login-theme convergence as today, per realm.
- [ ] T018 [US3] `scripts/seed/src/provision-clients.ts`: `provisionClient(kc, realm, client)`: the
  audience scope and the one client in its own realm (`desiredClient` unchanged).
- [ ] T019 [US3] `scripts/seed/src/legacy-realm.ts` (new): `renameLegacyRealm(kc)`: if `queuepass`
  exists and `queuepass-customer-app` does not, rename it; if both exist, throw naming both;
  otherwise do nothing. `disableOldCopies(kc)`: in the customer realm only, set `enabled: false` on
  every enabled user without the `customer` role, and on the clients `admin-app` and `booth-app`
  when present; never delete (R6). Log what was renamed and disabled.
- [ ] T020 [US3] `scripts/seed/src/provision-users.ts`: the users of one realm (from the seed's
  table), created when missing exactly as today, an existing user left alone. Log per realm:
  created, already present.
- [ ] T021 [US3] `scripts/seed/src/index.ts`: `renameLegacyRealm`; then for each app realm: realm,
  client, users; then `disableOldCopies`. The final log line names the three realms and the counts.

**Checkpoint** (stretch, Ground rules): `npm test --workspace @queuepass/seed` green, with the live
seed tests running against a clean `qp028clean` Keycloak (`docker compose -p qp028clean up -d
keycloak`, no switch needed), then `docker compose -p qp028clean down -v` and restore the team
stack. `qp028` is not started.

---

## Phase 5: User Stories 1 and 2 - Three apps, three users; logging out of one (P1) 🎯 MVP

### Tests first

- [ ] T022 [US1] [US2] `e2e/tests/028-app-realms.spec.ts` (quickstart S1, S2), one test titled
  exactly `028 S1/S2: three apps signed in as three users in one browser window stay signed in
  through their own renewals, and logging out of one leaves the others signed in`. Accounts from
  the per-worker fixtures of `e2e/fixtures/apps.ts` (spec `022` R8), never `admin1` (kept for
  people): `adminFor(testInfo)`, `customerFor(testInfo, n)` for two values of n, `agentFor(testInfo,
  n)`. Then change the quickstart's rows to exactly
  ``| S1 | Automated: `<title>`; rest Manual: Safari and the 15-minute run by hand |`` and
  ``| S2 | Automated: `<title>`; rest Manual: the back button by hand |`` (`npm test`'s
  quickstart-marks check accepts only that form). In **one** browser context:
  1. `context.clock.install()` **once**, before the first page (the clock is the context's; a second
     install resets every page's time, research R10);
  2. sign in to Admin, then open Customer: its own sign-in page (not the wrong-role page); sign in;
     then Booth (FR-003);
  3. each app makes an authorized call as its own user (FR-001);
  4. each app's **own** renewal: set up `page.waitForResponse` on each realm's
     `/protocol/openid-connect/token` request with `grant_type=refresh_token` answering 200, then
     `context.clock.runFor('04:05')`, started right after the **last** sign-in and within about 55 s
     of the **first** (research R10: otherwise the first app's token also expires during the run
     and refreshes twice); assert all three refreshes answered 200, and that each app's next API
     request
     carries a **new** `Authorization` token (the Backend checks expiry in real time, so a call
     alone proves nothing) (FR-002);
  5. log out of Customer: Customer shows its sign-in page; run the clock again as in step 4: Admin
     and Booth renew and call the API with new tokens; sign in to Customer as the second customer
     (US2);
  6. repeat step 5 for Admin and for Booth (SC-002).
- [ ] T023 [P] [US4] `e2e/tests/001-sign-in.spec.ts` V4 rewritten for FR-012: each app's sign-in
  page refuses another app's account (a customer at Admin, an agent at Customer, an admin at the
  Booth): on CI's clean stack, Keycloak's "Invalid username or password", the app not signed in, no
  wrong-role page. (On an upgraded stack the old copies in the customer realm are refused as
  disabled instead; walked in T027.)
  The wrong-role page stays covered by `packages/shared/test/web/require-role.test.tsx`; confirm it
  still gives the page a user without the role, and add that case if it does not.
  If the test's title changes, change its row in `specs/001-bare-bones-system/quickstart.md` to
  match (`npm test` checks every title has its row).
- [ ] T023a [P] `packages/shared/test/web/auth-provider.test.tsx`: its two authorities move to an
  app realm. (The e2e fixtures name no realm; they use the `KEYCLOAK` origin only.)

### Implementation

- [ ] T024 [US1] `admin-app/Dockerfile`, `customer-app/Dockerfile`, `booth-app/Dockerfile`: the
  default `VITE_OIDC_AUTHORITY` for each app's own realm (data-model.md).
- [ ] T025 [US1] `docker-compose.yml`: the Backend's `OIDC_ISSUER_BASE` / `OIDC_JWKS_BASE` in place
  of `OIDC_ISSUER` / `OIDC_JWKS_URL`; each app's build arg from `VITE_ADMIN_OIDC_AUTHORITY`,
  `VITE_CUSTOMER_OIDC_AUTHORITY`, `VITE_BOOTH_OIDC_AUTHORITY` with its own default; the seed's
  `KEYCLOAK_REALM` removed. `.env.example` to match, with the comments brought up to date.
  `scripts/run-host.mjs` (+ `scripts/test/run-host.test.mjs`): the same, per app.
- [ ] T025a `e2e/playwright.config.ts`: an opt-in `webkit` project (`devices['Desktop Safari']`),
  run only when asked (`--project=webkit`), so the default `npm run e2e` and CI stay Chromium-only;
  install its browser with `node node_modules/playwright/cli.js install webkit`. The Safari stand-in
  for quickstart S1/S2 until a Mac walk (T032).

**Checkpoint** (stretch 2, Ground rules): with `qp028` **stopped, not removed** (T026 needs its
data), a clean stack of its own: `docker compose -p qp028clean up -d database keycloak` and
`node scripts/run-host.mjs` from this branch: the seed creates three realms;
`node node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts 028 001` passes three
times in a row, and once more in WebKit
as the Safari stand-in (T025a). Then `docker compose -p qp028clean down -v` (its own throwaway
volumes only) and restore the team stack.

---

## Phase 6: The rename on a real pre-028 database (US3)

- [ ] T026 [US3] Stretch 3: stop the team stack; `docker compose -p qp028 start`; then
  `node scripts/run-host.mjs` from **this branch** (it seeds first): the seed log shows realm
  `queuepass` renamed, 35 accounts created in the Admin and Booth realms, and 35 old copies and 2
  clients disabled. Record the log lines.
- [ ] T027 [US3] Quickstart S3 steps 1–5 on that stack: `customer1` sees the same ticket codes and
  has the same subject; Admin shows the same orders and check-in, which still names `agent1`;
  `agent1` signs in; `admin1` with the seed password is refused on the Customer app's sign-in page
  as a disabled account ("Account is disabled, contact your administrator."). Reload any tab left
  open from before. Record the results.
- [ ] T028 [US3] Run the seed again on that stack: nothing changes (S3 step 6). Record the log. Then
  stop it (`docker compose -p qp028 stop`) and restore the team stack (Ground rules: `start
  database keycloak` only).

---

## Phase 7: Polish, review, pull request

- [ ] T029 README: service URLs (each app's realm; the admin console note names the three app
  realms), the **Today** paragraph (each app has its own
  sign-in; three users in one browser window; another app's account is refused on the sign-in
  page; an upgraded system's old realm becomes the Customer app's), the troubleshooting row about
  `401` with a valid login (now the issuer **base**), the `QP_SEED_ALLOW_RENAME` switch for the live
  seed tests, a warning that once a Keycloak is upgraded it must only be run with 028's code or
  later (an older seed recreates `queuepass`, and that includes old built images and their exited
  `seed` container, and any `up` without `--build`; the both-present error says how to recover), the
  `028` status row (status and its 36 tasks). The constitution reference already
  reads v3.9.0.
- [ ] T030 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, and research.md; fix the findings; record the round, its findings, and
  any left open here.
- [ ] T031 `npm run ci` locally, green, three times, during a stretch with a clean `qp028clean`
  Keycloak up so the live seed tests run (not the team stack's); `npm run test:tz`; record the
  counts per workspace and each workspace's line coverage (80% floor).
- [ ] T032 Running-system walk on the **team stack** (`queuepass-team`), **after Mahdi says go**
  (this renames its realm): restart its host processes from this branch (path B). **From then until
  the merge, the team stack runs only from this branch**, and no pre-028 `npm test` or
  `run-host.mjs` runs while it is up (research R13); if that cannot hold, do this walk after the
  merge instead. Then quickstart
  S1–S3 and S5–S7 by hand in one browser window, **15 minutes** for S1 (SC-001); record each
  scenario's result. Mahdi walks S1 and S2 in his own browser and approves; record it. Safari: Nate
  or Mahdi walks S1 and S2 on a Mac running the branch if one is available before merge; otherwise
  record it as open, with the Phase 5 checkpoint's WebKit run as the stand-in.
- [ ] T033 The whole e2e suite needs the Compose stack's geocoder stub and images, so it runs in
  CI's `e2e` check on the PR (record the run, its counts and the `028` test's time); locally,
  `028` and `001` three times in a row, and once in WebKit (the Phase 5 checkpoint).
- [ ] T034 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #138`, lists the review, the walk, the test counts, and
  the shared surface touched (`packages/shared/`, `docker-compose.yml`, `.env.example`; Nate
  requested). Wait for CI green on GitHub (`test` and `e2e`) on the final commit; merge only when
  green and approved.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T004)** → every story.
- **US4 (T005–T010)** before the seed and the apps change, so the Backend accepts the new realms.
- **US3 seed (T011–T021)** after T004. T011 before T012–T015; **T015a before T019–T021**.
- **US1/US2 (T022–T025)** after T010 and T021.
- **The rename on a real database (T026–T028)** after T025.
- **Polish (T029–T034)** last. **T032 comes after T031, T033's local runs and every other stretch**
  (and after T030's fixes are re-run): from T032 on the team stack runs only from this branch.
  T032 needs Mahdi's go-ahead to touch the team stack.

### Parallel opportunities

- T012, T013, T014 (three seed test files) once T011 is done.
- T023 and T023a alongside T022.

## Implementation Strategy

- **MVP**: Setup, Foundational, US4, US3's seed, US1/US2 (T001–T025): three realms, the Backend
  accepts them, the apps use them. Not shippable without Phase 6: a laptop with data must keep it.
- Then the rename on a real database, the README, the review, the walk, and the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-11-09): 4 must-fix, 6 should-fix, 3 nits; all fixed
  in the `Review 028` commit that follows it.
  - M1: `001` V4 signs in with another app's accounts, which no longer exist in that realm; FR-012
    could not be reached → FR-012 and an Edge Case say another app's account is refused on the
    sign-in page; T023 rewrites V4; the wrong-role page is covered by `require-role.test.tsx`.
  - M2: the seed cannot import `packages/shared` (its image never builds it, by design in `020`)
    → import-free copies for the seed and e2e, checked equal by T003 (R4).
  - M3: the live seed tests would move the team stack's users, and a `qp028` stack cannot run beside
    it → R13, Ground rules, T002, T015a (`QP_SEED_ALLOW_MOVE`).
  - M4: the constitution's stack table and Principle II still said one realm → amended, and listed
    in the Sync Impact Report.
  - S1: `hello.e2e-spec.ts`'s two-role token and `me.e2e-spec.ts`'s `roles: []` → T005 names both.
  - S2: a clash silently cut a user off → the seed fails naming the user and leaves the old realm on
    (FR-009, R6, T014, T020).
  - S3: R6's reasoning was wrong, and the old realm was read only while enabled → corrected; read
    whenever it exists (T014(d), T019).
  - S4: no real way to drive an app's own renewal in e2e → Playwright's clock (R10, T022).
  - S5: no Safari check → quickstart S1/S2 and T032.
  - S6: the new Principle V rules lacked MUST → added.
  - N1: the list of files naming realm `queuepass` was wrong → corrected (R10, T015, T023a).
  - N2: an over-long constitution line → rewrapped. N3: quickstart S7's row → fixed with M1.
- **Round 2** (independent Claude session, 2026-11-09): 3 must-fix, 4 should-fix, 3 nits; all fixed
  in the `Review 028` and `Constitution` commits that follow it.
  - M1: Keycloak user ids are unique across the server (409 on import into a second realm, even
    with the first disabled; confirmed): the copy-with-same-id move cannot work → **Mahdi chose to
    rename** realm `queuepass` to the customer realm; admins and agents get new accounts, their
    old copies disabled (spec Clarifications, FR-006, FR-007, FR-009, R5–R7, data model, T011–T021,
    T026–T028, roadmap row).
  - M2: the clock design could pass with no renewal (context-wide clock, re-install resets it,
    `runFor('04:30')` past the 10 s request timeout, real-time expiry on the Backend) → one
    install, wait for each refresh, `runFor('04:05')`, assert a new token (R10, T022).
  - M3: the Phase 5 checkpoint wiped T002's database → a separate `qp028clean` project.
  - S1: path B (images cannot be built here) → R13, Ground rules, T002, T026–T028, T031–T033.
  - S2: T022 used `admin1` and fixed accounts → the per-worker fixtures.
  - S3: the quickstart rows' exact form spelled out in T022.
  - S4: no Safari on this machine → a Mac walk by Nate or Mahdi, WebKit as the stand-in.
  - N1: `sign-in-screens` does not run `seed()` → R13, T015a reworded. N2: T019's retire rule →
    gone with the rename. N3: R13 moved to the end; "R1–R13".
- **Round 3** (independent Claude session, 2026-11-09): 2 must-fix, 4 should-fix, 4 nits; the
  rename itself verified on Keycloak 26.0.8 with the minimal call (ids, passwords, roles, clients,
  scopes, mapper, theme, signing keys kept). All fixed in the `Review 028` commit that follows it.
  - M1: pre-028 code against an upgraded Keycloak recreates `queuepass` → Edge Case, R6's error
    says how to recover, R13 step 3 and T032 (team stack runs only from 028's code), T029 warning.
  - M2: a bare `start` wakes old exited containers in the team project (confirmed) → `start
    database keycloak` only, everywhere.
  - S1: an old tab lands on Keycloak's 404, not its sign-in page → Edge Case reworded; reload old
    tabs (S0, T027).
  - S2: `runFor('04:05')` reasoning wrong (no request timeout in background renewal) → corrected,
    with the real 55 s limit (R10, T022).
  - S3: a disabled copy is refused as "Account is disabled" → S3, S4, T027.
  - S4: plan said "enabled" realm → "exists".
  - N1: FR-012 rewrapped. N2: attempt limits are in memory → R5. N3: `default-roles-queuepass`
    keeps its name → T011. N4: how to stop the host processes → Ground rules.
- **Round 4** (independent Claude session, 2026-11-09): 1 must-fix, 3 should-fix, 4 nits; all fixed
  in the `Review 028` commit that follows it.
  - M1: the Phase 4 checkpoint ran the live seed tests on `qp028`, T002's pre-028 database → a
    clean `qp028clean` for them; the switch only on a throwaway `qp028scratch`; `qp028` started
    only in T002 and T026–T028.
  - S1: the restore step still ran `main`'s pre-028 code after T032 → from T032 on, this branch;
    T032 after every other stretch (Dependencies).
  - S2: the Playwright command lacked the repository's config, and there was no `webkit` project →
    the full command, and T025a adds an opt-in `webkit` project.
  - S3: `npx` was broken on this machine (a missing `node-gyp` file in the portable npm) → repaired;
    Ground rules say where Node is and how to run Playwright.
  - N1: old built images count as pre-028 code (T029). N2: a "moving" leftover in plan.md. N3: long
    lines rewrapped. N4: the README row's count is 36 tasks (T029).
