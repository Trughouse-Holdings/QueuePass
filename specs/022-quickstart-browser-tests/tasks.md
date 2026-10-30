---
description: "Task list for Quickstart Browser Tests"
---

# Tasks: Quickstart Browser Tests

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R15),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (no API change),
[quickstart.md](./quickstart.md) (B1–B5)

**Issue**: [#93](https://github.com/Trughouse-Holdings/QueuePass/issues/93). The implementation
PR's **description** says `fixes #93` on its own line. No commit message on either branch may contain
"fixes #93", "closes #93", or "resolves #93".

**Tests**: this feature is tests. The scripts it adds (the marks check, the runner's port check, the
workflow shape) are written test-first; each browser test is seen to fail once against a deliberate
break before it is trusted (T031).

## Ground rules

- **Fresh session** (Constitution III): implement on `022-quickstart-browser-tests-impl` in a Claude
  session that starts from these files only, cut from the spec branch while its PR is open.
- **Commits**: `Impl 022: <what> (T0xx, #93)`.
- **No retries, ever** (R13): never set `retries` above 0, never `test.fixme`/`test.skip` a flaky test,
  never raise a timeout to hide a race. Find the cause in the trace and fix the test or the app.
- **Docker**: the runner uses the standard ports; stop any other stack first (`docker ps`), and leave
  nothing running when done.
- **One independent review** (T033); `npm run ci` green (T034); CI green on GitHub (T036).

---

## Phase 1: Setup

- [ ] T001 Cut the branch; `npm ci`; `npm run ci` green before any change. Add `@playwright/test` as
  a root `devDependency` at the newest 1.x (exact version, no `^`), record the version here; `npx
  playwright install chromium` works locally (R1).
- [ ] T002 Create `e2e/` per research R2: `e2e/tsconfig.json` (strict, `module`/`target` like
  `scripts/seed`, `types: ["node"]`, includes `**/*.ts`), and add `e2e/playwright-report/`,
  `e2e/test-results/` to `.gitignore` and `.prettierignore`; make `eslint.config.mjs` lint `e2e/**/*.ts`
  with the TypeScript rules the apps use (no React rules). `npm run lint` and `npm run
  format:check` green.

---

## Phase 2: Foundational (blocks every story)

### Tests first

- [ ] T003 [P] `scripts/test/e2e-ports.test.mjs` (`node --test`): the runner's exported
  `busyPorts(ports, connect)` returns exactly the ports whose connect succeeds (a fake `connect`);
  `portsMessage(busy)` names each port and says to run `docker compose down` (or `docker compose -p
  <name> down`) first (FR-013). Must fail (no runner yet).
- [ ] T004 [P] `scripts/test/check-quickstart-marks.test.mjs` (`node --test`) on small in-memory
  inputs (R10): labels found by `^#{2,3} ([A-Z]{1,2}\d+)\b`; a quickstart without an `## Automation`
  table fails, naming the file; a label with no row, a row whose label is not a heading, and a label
  with two rows each fail; `Automated: \`<title>\`` with no such test title fails; a test title with no
  Automated row fails; `Manual:` with an empty reason fails; a clean set passes. Must fail.

### Implementation

- [ ] T005 `scripts/e2e.mjs` (R3): exports `busyPorts` and `portsMessage` (T003 passes); `main()`:
  port check for 5173, 5174, 5175, 3000, 8080, 9000, 5432; `COMPOSE = ['-p', 'qpe2e', '-f',
  'docker-compose.yml', '-f', 'e2e/stack/docker-compose.e2e.yml']`; `down -v --remove-orphans`;
  `up --build --detach --wait`; `wait seed` and check exit 0 (on failure print `logs seed`, exit 1);
  demo data with `exec -T backend node backend/dist/scripts/demo-data.js`; `npx playwright install
  chromium` (`--with-deps` when `CI` is set); `npx playwright test -c e2e/playwright.config.ts` with
  `process.argv.slice(2)`; in `finally` and on SIGINT/SIGTERM: on failure write each service's
  `docker compose logs --no-color <service>` to `e2e/test-results/stack-logs/<service>.log`, then
  `down -v --remove-orphans`. Spawns with inherited stdio; exit code as R3. Root `package.json`:
  `"e2e": "node scripts/e2e.mjs"`.
- [ ] T006 [P] `e2e/stack/geocoder-stub/` (R4): `server.mjs` (Node `http`, port 8081, `GET
  /health` → 200, `GET /geocoder/locations/address` → 200 JSON `{ result: { addressMatches: [...] } }`
  with one match `{ matchedAddress, coordinates: { x, y } }` when `street`, `city`, `state`, `zip`
  equal an entry of `addresses.json` case-insensitively, else `[]`; anything else 404);
  `addresses.json` with four real addresses and coordinates: Louisville KY, Chicago IL, Phoenix AZ,
  Los Angeles CA, `matchedAddress` in the Census form `"<STREET>, <CITY>, <ST>, <ZIP>"` that
  `census-geocoder.ts`'s `splitMatched` accepts (check it); `Dockerfile` `FROM node:22-alpine`,
  copy the two files, `CMD ["node", "server.mjs"]`.
- [ ] T007 `e2e/stack/docker-compose.e2e.yml` (R4): service `geocoder-stub` (build context
  `e2e/stack/geocoder-stub`, health check `wget -qO- http://127.0.0.1:8081/health`); `backend:
  environment: ADDRESS_GEOCODER_URL: http://geocoder-stub:8081`, `depends_on: geocoder-stub: condition:
  service_healthy`. `docker compose -f docker-compose.yml -f e2e/stack/docker-compose.e2e.yml config`
  is valid; `docker-compose.yml` unchanged (FR-010).
- [ ] T008 `scripts/check-quickstart-marks.mjs` (R10): reads every `specs/*/quickstart.md` and
  `e2e/tests/*.spec.ts` (titles from `test('…'` and `test("…"` first arguments), exports the pure
  check used by T004, prints each problem as `<file>: <problem>` and exits 1 on any. T004 passes. Add
  `node scripts/check-quickstart-marks.mjs` to the root `test` script right after
  `check-contract-drift.mjs` (FR-015); it fails until Phase 5 writes the tables, so add it to `test` in
  T037, not now.
- [ ] T009 `e2e/playwright.config.ts` (R7): `testDir: 'tests'`, `fullyParallel: true`, `workers:
  process.env.CI ? 2 : 3`, `retries: 0`, `forbidOnly: !!process.env.CI`, `timeout: 60_000`,
  `expect: { timeout: 10_000 }`, `outputDir: 'test-results'`, reporters `[['list'], ['html', {
  outputFolder: 'playwright-report', open: 'never' }]]` plus `['github']` in CI, `use: { trace:
  'retain-on-failure', screenshot: 'only-on-failure', video: 'off', locale: 'en-US', timezoneId:
  'America/New_York' }`, one project `chromium` (`devices['Desktop Chrome']`).
- [ ] T010 `e2e/fixtures/apps.ts`: the three app URLs (`http://localhost:5173`, `5174`, `5175`), the
  API base `http://localhost:3000`, password `test123`, and account pickers by `testInfo.workerIndex`
  exactly as research R8 and data-model.md (`admin{2 + w}`, `agent{10 + w * 5 + n}`, `customer{100 +
  w * 20 + n}`; throw if `w > 2`).
- [ ] T011 `e2e/fixtures/sign-in.ts` (R5): `signIn(page, app, username)` and `signOut(page)`, by labels
  and roles only (Keycloak's "Username or email", "Password", "Sign In"; the app's "Sign out"), waiting
  for the app's signed-in content.
- [ ] T012 `e2e/fixtures/api.ts` (R6): `apiAs(page)` captures the `authorization` header of the app's
  first request to the API base and returns an `APIRequestContext` with it; on a 401 it reloads the
  page once to capture a fresh token. Helpers, each returning the created resource and failing the
  test with the response body on a non-2xx: `createVenue(api, place, name)`, `createEvent(api, venue,
  { name, startsAt, endsAt, capacity, basePrice, reservedSeating? })` (times as RFC 3339 in the
  venue's zone with its offset, using `toOffsetDateTime` from `@queuepass/shared`'s built output or a
  local copy), `addTier`, `setTicketLimit`, `buyTickets` (customer). Read each request shape from
  `contracts/openapi.yaml`; do not guess.
- [ ] T013 `e2e/fixtures/data.ts` (R8): `uniqueName(testInfo, what)` → `e2e <worker>-<test id
  short> <what> <4 random chars>`; the four places of `addresses.json`; `startsInHours(h)`.
- [ ] T014 A smoke test `e2e/tests/000-stack.spec.ts`: the API's `/health` answers 200 and the
  Customer app's page loads Keycloak's sign-in. Run `npm run e2e`: the stack starts, the smoke test
  passes, the stack is removed (`docker ps -a --filter name=qpe2e` empty). Then delete this file (it is
  not a quickstart scenario) before Phase 3's first test lands, or name it after `001 V1` if it fits.

**Checkpoint**: `npm run e2e` brings up a clean stack and tears it down; `npm test` green.

---

## Phase 3: User Story 2 - The main journeys (P1) 🎯 MVP

**Goal**: the journeys of FR-005, each named after its quickstart scenario. Before writing each
test, read that feature's `quickstart.md` and use its scenario label and wording in the title.

- [ ] T015 [P] [US2] `e2e/tests/001-sign-in.spec.ts`: for each app, sign in as its role, see the
  signed-in page, sign out, and a reload shows Keycloak's sign-in page (`001` V3); a customer signing
  in to the Admin app sees the wrong-role page with Sign out and no data (`001` V4).
- [ ] T016 [P] [US2] `e2e/tests/002-003-venue-event.spec.ts`: an admin creates a venue (a stub place)
  and an event in the Admin UI; a customer finds the event in the Customer app by name, with its venue
  and time (`002`/`003` scenarios).
- [ ] T017 [P] [US2] `e2e/tests/006-007-tickets.spec.ts`: an event with a tier (set up by API); a
  customer gets 2 tickets in the tier in the UI and sees them in My tickets (`006`); a seated event
  (by API); the customer chooses 2 seats and gets them; My tickets lists those seats (`007`).
- [ ] T018 [P] [US2] `e2e/tests/015-seat-holds.spec.ts`: two customer contexts on one seated event;
  customer A reserves 2 seats; on B's already-open page those seats show as unavailable within 2
  seconds with no reload (`expect(locator).toHave…({ timeout: 2_000 })` on the seat's accessible
  state, FR-006) (`015` S2).
- [ ] T019 [P] [US2] `e2e/tests/016-ticket-limit.spec.ts`: an event with a per-customer limit of 2 (by
  API); the customer gets 2; asking for 1 more is refused with the limit message (`016`).
- [ ] T020 [P] [US2] `e2e/tests/017-check-in.spec.ts`: an event starting in 1 hour at its own venue
  (by API, so the entry window is open); the customer gets 1 ticket (by API) and the test reads its
  code from the customer's My tickets page; an agent signs in to the Ticket Booth, chooses the event,
  types the code, confirms the ID check, Admits; typing the code again shows it as already used
  (`017`).
- [ ] T021 [P] [US2] `e2e/tests/019-calendar.spec.ts`: a customer with tickets (by API) opens My
  tickets, chooses **Add to Apple Calendar or Outlook**, the download's file name ends `.ics`, and its
  unfolded text has the event's `SUMMARY`, `DTSTART`/`DTEND` in UTC matching the event, and a
  `LOCATION` with the venue's name and address (`019`).
- [ ] T022 [P] [US2] `e2e/tests/020-time-zones.spec.ts`: a Phoenix venue and an event at 7:00 PM
  local (by API); the Customer event page shows 7:00 PM with Arizona's abbreviation in contexts with
  `timezoneId` `America/New_York` and `Asia/Tokyo`; in the Admin event form for an Eastern venue, a
  start of 2:30 AM on the next spring-forward Sunday is refused with the skipped-time message (`020`).
- [ ] T023 [US2] Run `npm run e2e`; every test passes. Fix tests that rely on timing, on order, or on
  another test's data (R8). Then `npm run e2e -- --repeat-each=3`: all pass; record counts here.

**Checkpoint**: about 12 tests pass three times in a row.

---

## Phase 4: User Story 1 - A broken journey turns the check red (P1)

- [ ] T024 [US1] `scripts/test/ci-workflow.test.mjs` (R11), test first: "two jobs, test and e2e";
  every existing assertion on `test` kept; the same checks for `e2e` (`ubuntu-24.04`, 30 minutes,
  only GitHub's own actions, checkout without credentials, Node from `.nvmrc` with the npm cache,
  every run step named, the first run step `npm ci`, none skippable or allowed to fail), its run steps
  exactly `npm ci`, `npx playwright install --with-deps chromium`, `npm run e2e`, and one
  `actions/upload-artifact` step with `if: failure()`, paths `e2e/playwright-report` and
  `e2e/test-results`, `retention-days: 14`. Must fail.
- [ ] T025 [US1] `.github/workflows/ci.yml`: the `e2e` job as T024 (same `on`, `permissions`,
  `concurrency` as the workflow already has; the `test` job unchanged). Use the same major version of
  `actions/checkout` and `actions/setup-node` as `test`, and the current major of
  `actions/upload-artifact`. T024 passes.
- [ ] T026 [US1] Prove a red check (quickstart B3) on a throwaway branch and draft PR: break one wire
  the unit tests stub (for example the API path My tickets calls); `e2e` fails naming the scenario,
  with the report and trace as artifacts; `test` passes. Revert; close the draft PR unmerged and delete
  its branch. Record the run links here.

---

## Phase 5: User Story 3 - Every quickstart is marked (P2)

- [ ] T027 [US3] For every `specs/*/quickstart.md` (18 files), append the `## Automation` table of
  research R10 with one row per scenario heading label: `Automated: \`<exact test title>\`` for the
  scenarios T015–T022 cover, `Manual: <reason>` for the rest, using research R15's reasons
  (camera, printing, screen reader, real device, timing measured with a person, a wait of minutes, a
  stack restart, covered by Backend tests, needs the Keycloak admin console). A quickstart whose
  scenarios have no `##`/`###` label headings (check each) gets one row per numbered step it does
  have, or, if it has no scenarios at all, a single row `| — | Manual: <why> |` that the checker
  accepts (add that case to T004 first).
- [ ] T028 [US3] Add `node scripts/check-quickstart-marks.mjs` to the root `test` script after
  `check-contract-drift.mjs` (FR-015); `npm test` green. Prove it: rename one test title by a
  character, `npm test` fails naming it; revert (quickstart B4).

---

## Phase 6: User Story 4 - One command on a laptop (P2)

- [ ] T029 [US4] Quickstart B1 by hand: with a default stack up, `npm run e2e` refuses and names the
  ports; with it down, a full run passes and leaves no `qpe2e` container or volume; `npm run e2e -- -g
  "015 S2"` runs one test. Record here.
- [ ] T030 [US4] README: a "Browser tests" section (what they cover, `npm run e2e`, `-g` for one
  scenario, `--repeat-each=3`, where the report and traces go, that the default stack must be down,
  that the address stand-in is used only there, how to add a test for a new feature and its Automation
  row per Constitution VI as amended).

---

## Phase 7: Polish, review, pull request

- [ ] T031 For each test file, break the app once locally (a wrong label, a wrong path, a removed
  live update) and see that file's test fail with a readable message and trace; revert. Record which
  break proved which test.
- [ ] T032 README: the `022` status row and "Today" paragraph.
- [ ] T033 Independent review by a separate Claude session (Constitution 3.3.0) against spec.md,
  plan.md, research.md; fix the findings; record the round here.
- [ ] T034 `npm run ci` locally, green (the marks check included); `npm run e2e -- --repeat-each=3`
  green once more after the review fixes; record both.
- [ ] T035 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #93`; lists the journeys, the three-in-a-row result, the
  red-check proof (T026), the CI durations of `test` and `e2e`, and the review.
- [ ] T036 CI green on GitHub for the final commit, both `test` and `e2e`, with `e2e` under 30 minutes
  (SC-003); merge only when green and approved. After merge, when `main`'s push run of `e2e` passes,
  ask a repository admin to add `e2e` to the "main: CI must pass" ruleset (R12, FR-012); record who
  and when.

---

## Dependencies & Execution Order

- Setup (T001–T002) → Foundational (T003–T014) → US2 (T015–T023) → US1 (T024–T026) and US3
  (T027–T028) → US4 (T029–T030) → Polish (T031–T036).
- T015–T022 are separate files and can be written in parallel; T023 runs them together.
- T027 needs the final test titles from T015–T022.

## Implementation Strategy

- **MVP**: Foundational + US2 (T001–T023): the journeys pass locally three times in a row.
- Then CI (US1), the marks (US3), the local-run polish (US4), and the PR.
