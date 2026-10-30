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

- [x] T001 Cut the branch; `npm ci`; `npm run ci` green before any change. Add `@playwright/test` as
  a root `devDependency` at the newest 1.x (exact version, no `^`), record the version here; `npx
  playwright install chromium` works locally (R1).
  **Result**: worktree branch `022-quickstart-browser-tests-impl` cut from `origin/main` at 35895f1 (the spec PR #97 had merged); `npm ci` clean; `npm run ci` before any change: format, lint, build green; scripts 45, shared 681, backend 943, admin 249, customer 308, booth 76, seed 37 passed (20 skipped, Keycloak down), test:tz quick run passed. `@playwright/test` **1.64.1** (npm's `latest`, the newest 1.x on 2026-10-30), exact, as a root devDependency; `npx playwright install chromium` downloaded Chrome Headless Shell 156.0.8078.4.
- [x] T002 Create `e2e/` per research R2: `e2e/tsconfig.json` (strict, `module`/`target` like
  `scripts/seed`, `types: ["node"]`, includes `**/*.ts`), and add `e2e/playwright-report/`,
  `e2e/test-results/` to `.gitignore` and `.prettierignore`; make `eslint.config.mjs` lint `e2e/**/*.ts`
  with the TypeScript rules the apps use (no React rules). `npm run lint` and `npm run
  format:check` green.
  **Result**: `e2e/tsconfig.json` (strict, `module`/`target` as `scripts/seed`, `types: ["node"]`); `e2e/playwright-report/` and `e2e/test-results/` in `.gitignore`, `.prettierignore`, and ESLint's ignores; ESLint lints `e2e/**/*.ts` with the root TypeScript rules and Node globals (no React rules), and `e2e/stack/**/*.mjs` as Node scripts. `npm run lint` and `npm run format:check` green; `npx tsc -p e2e/tsconfig.json` clean (run by hand; not part of `npm run ci`).

---

## Phase 2: Foundational (blocks every story)

### Tests first

- [x] T003 [P] `scripts/test/e2e-ports.test.mjs` (`node --test`): the runner's exported
  `busyPorts(ports, connect)` returns exactly the ports whose connect succeeds (a fake `connect`);
  `portsMessage(busy)` names each port and says to run `docker compose down` (or `docker compose -p
  <name> down`) first (FR-013). Must fail (no runner yet).
  **Result**: 4 tests (the port list, `busyPorts` with a fake connect, none busy, `portsMessage` naming the ports, `docker compose down` and `docker compose -p <name> down`); failed (no `scripts/e2e.mjs`) until T005.
- [x] T004 [P] `scripts/test/check-quickstart-marks.test.mjs` (`node --test`) on small in-memory
  inputs (R10): labels found by `^#{2,3} ([A-Z]{1,2}\d+)\b`; a quickstart without an `## Automation`
  table fails, naming the file; a label with no row, a row whose label is not a heading, and a label
  with two rows each fail; `Automated: \`<title>\`` with no such test title fails; a test title with no
  Automated row fails; `Manual:` with an empty reason fails; a clean set passes. Must fail.
  **Result**: 15 tests on in-memory inputs: labels (with R16.1's letter suffix), titles from `test('…')`/`test("…")` only, every failure case of the task, a title not named `NNN <label>: …`, a title looked for in its own feature's quickstart, a row neither Automated nor Manual, and the `| — | Manual: … |` row (accepted only where a quickstart has no scenario headings, T027). Failed (no checker) until T008.

### Implementation

- [x] T005 `scripts/e2e.mjs` (R3): exports `busyPorts` and `portsMessage` (T003 passes); `main()`:
  port check for 5173, 5174, 5175, 3000, 8080, 9000, 5432; `COMPOSE = ['-p', 'qpe2e', '-f',
  'docker-compose.yml', '-f', 'e2e/stack/docker-compose.e2e.yml']`; `down -v --remove-orphans`;
  `up --build --detach --wait --wait-timeout 600` (on a non-zero exit print `logs seed`, exit 1; no
  separate `wait seed`, which fails once the seed has exited, R3);
  demo data with `exec -T backend node backend/dist/scripts/demo-data.js`; `npx playwright install
  chromium` (`--with-deps` when `CI` is set); `npx playwright test -c e2e/playwright.config.ts` with
  `process.argv.slice(2)`; in `finally` and on SIGINT/SIGTERM: on failure write each service's
  `docker compose logs --no-color <service>` to `e2e/test-results/stack-logs/<service>.log`, then
  `down -v --remove-orphans`. Spawns with inherited stdio; exit code as R3. Root `package.json`:
  `"e2e": "node scripts/e2e.mjs"`.
  **Result**: `scripts/e2e.mjs` as the task, exporting `E2E_PORTS`, `busyPorts`, `portsMessage`, `tcpConnect`, `main`; the stack-start time and total time are printed; a SIGINT/SIGTERM is passed to the running child and the `finally` still removes the stack. Root `"e2e": "node scripts/e2e.mjs"`. T003 passes.
- [x] T006 [P] `e2e/stack/geocoder-stub/` (R4): `server.mjs` (Node `http`, port 8081, `GET
  /health` → 200, `GET /geocoder/locations/address` → 200 JSON `{ result: { addressMatches: [...] } }`
  with one match `{ matchedAddress, coordinates: { x, y } }` when `street`, `city`, `state`, `zip`
  equal an entry of `addresses.json` case-insensitively, else `[]`; anything else 404);
  `addresses.json` with real addresses and coordinates: the two demo-data venues exactly as
  `backend/src/scripts/demo-data.ts` creates them (`430 W Vine St, Lexington, KY 40507`; `937 Phillips
  Ln, Louisville, KY 40209`) so the demo data loads, plus Louisville KY, Chicago IL, Phoenix AZ, and
  Los Angeles CA for the tests, `matchedAddress` in the Census form `"<STREET>, <CITY>, <ST>, <ZIP>"` that
  `census-geocoder.ts`'s `splitMatched` accepts (check it); `Dockerfile` `FROM node:22-alpine`,
  copy the two files, `CMD ["node", "server.mjs"]`.
  **Result**: `e2e/stack/geocoder-stub/` (`server.mjs`, `addresses.json`, `Dockerfile` from `node:22-alpine`): the two demo-data venues plus `1 Arena Plz, Louisville, KY 40202` (Eastern), `1901 W Madison St, Chicago, IL 60612` (Central), `201 E Jefferson St, Phoenix, AZ 85004` (Arizona), `1111 S Figueroa St, Los Angeles, CA 90015` (Pacific), each with real coordinates and `matchedAddress` as `STREET, CITY, ST, ZIP`, which `splitMatched` accepts. The demo data loads with both venues verified (the stand-in logged one match each).
- [x] T007 `e2e/stack/docker-compose.e2e.yml` (R4): service `geocoder-stub` (build context
  `e2e/stack/geocoder-stub`, health check `wget -qO- http://127.0.0.1:8081/health`); `backend:
  environment: ADDRESS_GEOCODER_URL: http://geocoder-stub:8081`, `depends_on: geocoder-stub: condition:
  service_healthy`. `docker compose -f docker-compose.yml -f e2e/stack/docker-compose.e2e.yml config`
  is valid; `docker-compose.yml` unchanged (FR-010).
  **Result**: `e2e/stack/docker-compose.e2e.yml` as the task (health check every 2 s); `docker compose -p qpe2e -f docker-compose.yml -f e2e/stack/docker-compose.e2e.yml config` valid, with the Backend's `ADDRESS_GEOCODER_URL=http://geocoder-stub:8081`; `docker-compose.yml` unchanged.
- [x] T008 `scripts/check-quickstart-marks.mjs` (R10): reads every `specs/*/quickstart.md` and
  `e2e/tests/*.spec.ts` (titles from `test('…'` and `test("…"` first arguments), exports the pure
  check used by T004, prints each problem as `<file>: <problem>` and exits 1 on any. T004 passes. Add
  `node scripts/check-quickstart-marks.mjs` to the root `test` script right after
  `check-contract-drift.mjs` (FR-015) in T028, not now: it fails until Phase 5 writes the tables.
  **Result**: `scripts/check-quickstart-marks.mjs` (exports `scenarioLabels`, `testTitles`, `checkMarks`, `readFiles`); prints `<file>: <problem>` and exits 1 on any. Label pattern and the per-feature name check per research R16.1, R16.2. T004 passes. Added to `npm test` in T028.
- [x] T009 `e2e/playwright.config.ts` (R7): `testDir: 'tests'`, `fullyParallel: true`, `workers:
  process.env.CI ? 2 : 3`, `retries: 0`, `forbidOnly: !!process.env.CI`, `timeout: 60_000`,
  `expect: { timeout: 10_000 }`, `outputDir: 'test-results'`, reporters `[['list'], ['html', {
  outputFolder: 'playwright-report', open: 'never' }]]` plus `['github']` in CI, `use: { trace:
  'retain-on-failure', screenshot: 'only-on-failure', video: 'off', locale: 'en-US', timezoneId:
  'America/New_York' }`, one project `chromium` (`devices['Desktop Chrome']`).
  **Result**: `e2e/playwright.config.ts` exactly as the task; `actionTimeout: 10_000` added after T031 (research R16.10).
- [x] T010 `e2e/fixtures/apps.ts`: the three app URLs (`http://localhost:5173`, `5174`, `5175`), the
  API base `http://localhost:3000`, password `test123`, and account pickers by
  `testInfo.parallelIndex` (not `workerIndex`, R8) exactly as research R8 and data-model.md
  (`admin{2 + p}`, `agent{10 + p * 5 + n}`, `customer{100 + p * 20 + n}`; throw if `p > 2`).
  **Result**: `e2e/fixtures/apps.ts`: URLs, API base, Keycloak, password, and `adminFor`, `agentFor(n 0-4)`, `customerFor(n 0-19)` by `parallelIndex`, throwing above 2. Each test file takes its own customer `n` (R16.8).
- [x] T011 `e2e/fixtures/sign-in.ts` (R5): `signIn(page, app, username)` and `signOut(page)`, by labels
  and roles only (Keycloak's "Username or email", "Password", "Sign In"; the app's "Sign out"), waiting
  for the app's signed-in content.
  **Result**: `e2e/fixtures/sign-in.ts`: `signIn(page, app, username, path)` waits for Keycloak's heading "Sign in to <app name>", fills "Username or email" and "Password", presses "Sign In", then waits for **Log out** and the app's address; `signOut(page, app)` presses **Log out** and waits for Keycloak's heading. The control is **Log out**, not "Sign out" (R16.3).
- [x] T012 `e2e/fixtures/api.ts` (R6): `apiAs(page, signInFn)` starts `page.waitForRequest` for the
  API base with an `authorization` header **before** calling the sign-in, awaits it after (reloading
  once if none came), captures the header of the app's first request to the API base and returns an `APIRequestContext` with it; on a 401 it reloads the
  page once to capture a fresh token. Helpers, each returning the created resource and failing the
  test with the response body on a non-2xx: `createVenue(api, place, name)`, `createEvent(api, venue,
  { name, startsAt, endsAt, capacity, basePrice, reservedSeating? })` (times as RFC 3339 in the
  venue's zone with its offset, from a small local helper in `e2e/fixtures/` built on
  `Intl.DateTimeFormat` (not `@queuepass/shared`, whose `dist` the `e2e` CI job never builds)), `addTier`, `setTicketLimit`, `buyTickets` (customer). Read each request shape from
  `contracts/openapi.yaml`; do not guess.
  **Result**: `e2e/fixtures/api.ts`: `Api.as` / `apiAs(page, signInFn)` listens before sign-in, reloads once if no authorized request came, and refreshes the token once on a 401; `createVenue` (optionally with a layout), `createEvent` (times from `e2e/fixtures/time.ts`, built on `Intl.DateTimeFormat`, sent with the venue's offset), `addTier`, `setSeating`, `setTicketLimit` (PATCH), `buyTickets`, plus `apiFor` (a signed-in user's API in its own context) and `seatedEvent`. Bodies typed from the contract by a type-only import of the generated `api-schema.ts` (R16.7); every non-2xx fails the test with the response body.
- [x] T013 `e2e/fixtures/data.ts` (R8): `uniqueName(testInfo, what)` → `e2e <worker>-<test id
  short> <what> <4 random chars>`; the test places of `addresses.json`; `startsInHours(h)`.
  **Result**: `e2e/fixtures/data.ts`: `uniqueName` (`e2e <parallelIndex>-<test id 6> <what> <4 random>`), `PLACES` from `addresses.json` (the four test addresses, not the demo data's), `startsInHours`.
- [x] T014 A smoke test `e2e/tests/000-stack.spec.ts`: the API's `/health` answers 200 and the
  Customer app's page loads Keycloak's sign-in. Run `npm run e2e`: the stack starts, the smoke test
  passes, the stack is removed (`docker ps -a --filter name=qpe2e` empty). Then delete this file (it is
  not a quickstart scenario) before Phase 3's first test lands, or name it after `001 V1` if it fits.
  **Result**: `000 X1: the stack answers` (API `/health` 200; the Customer app shows Keycloak's "Sign in to QueuePass Tickets"). `npm run e2e -- e2e/tests/000-stack.spec.ts`: stack healthy after 1.9 min, demo data loaded, 1 passed, stack removed; `docker ps -a --filter name=qpe2e` and `docker volume ls --filter name=qpe2e` empty. `up --wait` returned 0 once the seed had exited 0 (R3 confirmed). Deleted in the commit that added the journeys.

**Checkpoint**: `npm run e2e` brings up a clean stack and tears it down; `npm test` green.

---

## Phase 3: User Story 2 - The main journeys (P1) 🎯 MVP

**Goal**: the journeys of FR-005, each named after its quickstart scenario. Before writing each
test, read that feature's `quickstart.md` and use its scenario label and wording in the title.

- [x] T015 [P] [US2] `e2e/tests/001-sign-in.spec.ts`: one test `001 V3: …` that, for each app in
  turn, signs in as its role, sees the signed-in page, signs out, and a reload shows Keycloak's sign-in
  page (one test per label, R9, R10); a customer signing
  in to the Admin app sees the wrong-role page with Sign out and no data (`001` V4).
  **Result**: `e2e/tests/001-sign-in.spec.ts`: `001 V3: sign in, the signed-in page, and logout in each app` (per app in its own context: Keycloak first, signed in with the app's name and page (the Admin hello page's greeting with the username), a reload stays signed in, Log out reaches Keycloak's page, reopening asks to sign in); `001 V4: a customer is refused in the Admin app` (the wrong-role text, "You are signed in as …", Log out, no Venues or Events links).
- [x] T016 [P] [US2] `e2e/tests/003-venue-event.spec.ts`: `003 C1: …`: an admin creates a venue (a
  stub place) and an event in the Admin UI; a customer finds the event in the Customer app by name,
  with its venue and time.
  **Result**: `e2e/tests/003-venue-event.spec.ts`: `003 C1: an admin adds a venue and an event; a customer finds it with its venue and times`: Admin **Venues → Add venue** at the stand-in's Louisville address ("Venue saved. Address: 1 ARENA PLZ, LOUISVILLE, KY 40202.", Eastern Time), **Events → Schedule event** tomorrow 6:00–9:00 PM with a $45.50 type; the customer's landing page is Events, the search finds the card with the venue link, both times ("…, 6:00 PM EDT"), and $45.50. Plus `e2e/tests/002-delete-event.spec.ts`: `002 D1: an admin deletes an event, and its time at the venue is free again` (Cancel sends no DELETE; OK shows `Deleted "…".` on the event list; the same slot is accepted again) (R16.4).
- [x] T017 [P] [US2] `e2e/tests/006-007-tickets.spec.ts`: an event with a tier (set up by API); a
  customer gets 2 tickets in the tier in the UI and sees them in My tickets (`006`); a seated event
  (by API); the customer chooses 2 seats and gets them; My tickets lists those seats (`007`).
  **Result**: `e2e/tests/006-007-tickets.spec.ts`: `006 P1/P4: a customer gets 2 tickets in a tier and sees them in My tickets` (tier "Balcony, $30.00, 40 left", Total $60.00, confirmation with 2 distinct 12-character codes, My tickets lists them Valid); `007 S3: a customer chooses seats and gets them` (VIP $120, Section A, Row 1 Seats 5 and 6, $240.00, Reserve seats then Confirm purchase (015), confirmation and My tickets list "Section A, Row 1, Seat 5/6").
- [x] T018 [P] [US2] `e2e/tests/015-seat-holds.spec.ts`: two customer contexts on one seated event;
  customer A reserves 2 seats; on B's already-open page those seats show as unavailable within 2
  seconds with no reload (`expect(locator).toHave…({ timeout: 2_000 })` on the seat's accessible
  state, FR-006) (`015` S2).
  **Result**: `e2e/tests/015-seat-holds.spec.ts`: `015 S2: live gray-out, seats one customer reserves turn unavailable for another within 2 seconds`: two contexts; within 2 s of Customer 1's Reserve seats press, Customer 2's never-reloaded seats are named "Row 2, Seat 3, reserved" / "Row 2, Seat 4, reserved" and disabled; after Release seats they are open again within 2 s (R16.9).
- [x] T019 [P] [US2] `e2e/tests/016-ticket-limit.spec.ts`: an event with a per-customer limit of 2 (by
  API); the customer gets 2; asking for 1 more is refused with the limit message (`016`).
  **Result**: `e2e/tests/016-ticket-limit.spec.ts`: `016 S2: buy up to the per-customer limit; more is refused with the reason` (limit 3 by PATCH: "You can get 3 more", quantities 1–3; get 2; "1 more", quantity 1; get 1; "You have reached the limit of 3 tickets for this event." and no Confirm control) (R16.6).
- [x] T020 [P] [US2] `e2e/tests/017-check-in.spec.ts`: an event starting in 1 hour at its own venue
  (by API, so the entry window is open); the customer gets 1 ticket (by API) and the test reads its
  code from the customer's My tickets page; an agent signs in to the Ticket Booth, chooses the event,
  types the code, confirms the ID check, Admits; typing the code again shows it as already used
  (`017`).
  **Result**: `e2e/tests/017-check-in.spec.ts`: `017 S3: a gate agent types a code and admits it once; again, it is already used`: event 1 hour ahead; 1 ticket bought through the API; its code read from My tickets; the agent chooses the event, types it lower case with a dash, sees the event, Floor, "Check a government-issued photo ID that shows: Jordan Lee", Admit; Refuse gives "✕ Not admitted"; again, Admit gives "✓ Admitted"; a third look-up gives "✕ Already used at …" and no Admit.
- [x] T021 [P] [US2] `e2e/tests/019-calendar.spec.ts`: a customer with tickets (by API) opens My
  tickets, chooses **Add to Apple Calendar or Outlook**, the download's file name ends `.ics`, and its
  unfolded text has the event's `SUMMARY`, `DTSTART`/`DTEND` in UTC matching the event, and a
  `LOCATION` with the venue's name and address (`019`).
  **Result**: `e2e/tests/019-calendar.spec.ts`: `019 S2: a customer downloads the calendar file, with the event, its times, and its venue` (the name carries `, ; \`; the `.ics` download has CRLF lines; unfolded, `SUMMARY` escaped, `DTSTART`/`DTEND` in UTC for tomorrow 7:30–10:45 PM Eastern, `LOCATION:<venue>\, 1 ARENA PLZ\, LOUISVILLE\, KY 40202`).
- [x] T022 [P] [US2] `e2e/tests/020-time-zones.spec.ts`: a Phoenix venue and an event at 7:00 PM
  local (by API); the Customer event page shows 7:00 PM with Arizona's abbreviation in contexts with
  `timezoneId` `America/New_York` and `Asia/Tokyo`; in the Admin event form for an Eastern venue, a
  start of 2:30 AM on the next spring-forward Sunday is refused with the skipped-time message (`020`).
  **Result**: `e2e/tests/020-time-zones.spec.ts`, two tests (R16.5): `020 S6: a customer sees event times in the venue zone, whatever the browser zone` (a Phoenix venue, 7:00 PM local; in `America/New_York` and `Asia/Tokyo` contexts the event page and its card say "…, 7:00 PM MST"); `020 S7: a start time the venue zone skips is refused, and nothing is sent` (an Eastern venue; 2:30 AM on the next second Sunday of March: "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time." under the field and again on Schedule event, values kept, no `POST /events`).
- [x] T023 [US2] Run `npm run e2e`; every test passes. Fix tests that rely on timing, on order, or on
  another test's data (R8). Then `npm run e2e -- --repeat-each=3`: all pass; record counts here.
  **Result**: On a running `qpe2e` stack, every test passed alone, then all together, then `--repeat-each=3` (36/36); no test needed a timing, order, or data fix. Then from scratch: `npm run e2e`: **12 passed** (10.3 s of tests, 1.9 min in all); `npm run e2e -- --repeat-each=3`: **36 passed, 0 failed, 0 flaky, no retries** (27.9 s of tests, 1.3 min in all); no `qpe2e` container or volume left after either.

**Checkpoint**: about 12 tests pass three times in a row.

---

## Phase 4: User Story 1 - A broken journey turns the check red (P1)

- [x] T024 [US1] `scripts/test/ci-workflow.test.mjs` (R11), test first: "two jobs, test and e2e";
  every existing assertion on `test` kept; the same checks for `e2e` (`ubuntu-24.04`, 30 minutes,
  only GitHub's own actions, checkout without credentials, Node from `.nvmrc` with the npm cache,
  every run step named, the first run step `npm ci`, no step allowed to fail and none skippable
  except the upload step below), its run steps exactly `npm ci` and `npm run e2e` (the runner
  installs the browser, R3), and one
  `actions/upload-artifact` step with `if: failure()`, paths `e2e/playwright-report` and
  `e2e/test-results`, `retention-days: 14`. Must fail.
  **Result**: `scripts/test/ci-workflow.test.mjs`: "two jobs, test and e2e"; the action, checkout, setup-node, named-step, and first-step-`npm ci` checks run for both jobs; `test`'s exact-shape and ci-script checks kept; new: `e2e` is checkout, setup-node, `npm ci`, `npm run e2e`, then one `actions/upload-artifact@vN` step with a name, `if: failure()`, paths `e2e/playwright-report` and `e2e/test-results`, `retention-days: 14`, nothing else conditional or allowed to fail; and `e2e` uses `test`'s checkout and setup-node versions. 5 failed before T025.
- [x] T025 [US1] `.github/workflows/ci.yml`: the `e2e` job as T024 (same `on`, `permissions`,
  `concurrency` as the workflow already has; the `test` job unchanged). Use the same major version of
  `actions/checkout` and `actions/setup-node` as `test`, and the current major of
  `actions/upload-artifact`. T024 passes.
  **Result**: `.github/workflows/ci.yml`: job `e2e` (ubuntu-24.04, 30 minutes, `actions/checkout@v7` without credentials, `actions/setup-node@v7` from `.nvmrc` with the npm cache, `npm ci`, `npm run e2e`, and on failure `actions/upload-artifact@v7` (current major, v7.0.2) named `e2e-results`); `on`, `permissions`, `concurrency`, and `test` unchanged. 17/17 workflow tests pass.
- [x] T026 [US1] Prove a red check (quickstart B3) on a throwaway branch and draft PR: break one wire
  the unit tests stub (for example the API path My tickets calls); `e2e` fails naming the scenario,
  with the report and trace as artifacts; `test` passes. Revert; close the draft PR unmerged and delete
  its branch. Record the run links here.
  **Result**: Draft PR **#105** (branch `022-e2e-red-check-throwaway`, from this branch). First break, the Customer app's `VITE_API_BASE_URL` in `docker-compose.yml` (run [41127139753](https://github.com/Trughouse-Holdings/QueuePass/actions/runs/41127139753)): `e2e` failed, but so did `test`, because `scripts/test/run-host.test.mjs` checks that build argument; B3's own example (a wrong path in `MyTickets.tsx`) also fails the Customer app's component tests, which assert the path. Second break, a wire no unit test reads: the Customer app's `main.tsx` passing `apiBaseUrl` `…/api` (run [41127979410](https://github.com/Trughouse-Holdings/QueuePass/actions/runs/41127979410)): **`test` passed; `e2e` failed** (6 min 18 s), the log naming 9 scenarios (`003 C1`, `006 P1/P4`, `007 S3`, `015 S2`, `016 S2`, `017 S3`, `019 S2`, `020 S6`; `001 V3`, `001 V4`, `002 D1`, `020 S7` passed, as they use no Customer-app API call), with GitHub annotations, and artifact `e2e-results` (11.2 MB: report, traces, screenshots, stack logs). Reverted, with this branch's later commits merged in (run [41129055010](https://github.com/Trughouse-Holdings/QueuePass/actions/runs/41129055010)): **both passed**, `e2e` 12 passed with 2 workers in 4 min 05 s (stack healthy after 2.4 min), `test` 6 min 09 s. PR #105 closed unmerged and its branch deleted (research R16.11).

---

## Phase 5: User Story 3 - Every quickstart is marked (P2)

- [x] T027 [US3] For every `specs/*/quickstart.md` (19 on this branch, this feature's own B1–B5
  included, and any that merged since), append the `## Automation` table of
  research R10 with one row per scenario heading label: `Automated: \`<exact test title>\`` for the
  scenarios T015–T022 cover, `Manual: <reason>` for the rest, using research R15's reasons
  (camera, printing, screen reader, real device, timing measured with a person, a wait of minutes, a
  stack restart, covered by Backend tests, needs the Keycloak admin console). A quickstart whose
  scenarios have no `##`/`###` label headings (check each) gets one row per numbered step it does
  have, or, if it has no scenarios at all, a single row `| — | Manual: <why> |` that the checker
  accepts (add that case to T004 first).
  **Result**: All **22** quickstarts on this branch (`010`, `021`, `023` merged after the spec, `022`'s own included) end with `## Automation`: **173** scenario rows, **13** Automated (`001` V3, V4; `002` D1; `003` C1; `006` P1, P4; `007` S3; `015` S2; `016` S2; `017` S3; `019` S2; `020` S6, S7) and 160 Manual with R15's kinds of reason, or "outside the main journey the browser tests walk (spec 022 FR-005); walked by hand". Every quickstart has label headings, so no `—` row was needed. `023` is not built here: its rows are Manual for its implementation PR to replace (R16.12).
- [x] T028 [US3] Add `node scripts/check-quickstart-marks.mjs` to the root `test` script after
  `check-contract-drift.mjs` (FR-015); `npm test` green. Prove it: rename one test title by a
  character, `npm test` fails naming it; revert (quickstart B4).
  **Result**: `node scripts/check-quickstart-marks.mjs` in the root `test` script right after `check-contract-drift.mjs`: "22 quickstarts marked; every browser test has its row". Proof (B4): `016 S2`'s title changed by one character, `npm test` exited 1 within seconds naming `specs/016-per-user-ticket-limit/quickstart.md` (row S2 names no test) and `e2e/tests/016-ticket-limit.spec.ts` (no Automated row); reverted.

---

## Phase 6: User Story 4 - One command on a laptop (P2)

- [x] T029 [US4] Quickstart B1 by hand: with a default stack up, `npm run e2e` refuses and names the
  ports; with it down, a full run passes and leaves no `qpe2e` container or volume; `npm run e2e -- -g
  "015 S2"` runs one test. Record here.
  **Result**: B1 by hand. 1: a default-style stack up (`docker compose -p qp022own up -d`, all six services healthy): `npm run e2e` exited 1 at once naming ports 5173, 5174, 5175, 3000, 8080, 9000, 5432 and how to free them; the stack kept running, nothing `qpe2e` created. 2: `docker compose -p qp022own down` (no `-v`): the full run is T023's (12 passed, nothing left behind); that stack's two volumes were still there afterwards (then removed, it was this session's own). 3: `npm run e2e -- -g "015 S2"`: "Running 1 test", 1 passed, 0.8 min, no `qpe2e` container or volume left.
- [x] T030 [US4] README: a "Browser tests" section (what they cover, `npm run e2e`, `-g` for one
  scenario, `--repeat-each=3`, where the report and traces go, that the default stack must be down,
  that the address stand-in is used only there, how to add a test for a new feature and its Automation
  row per Constitution VI as amended).
  **Result**: README "Browser tests" under "Run the tests": what they cover and how they are named, the Automation tables and their check, `npm run e2e`, `-g`, `--repeat-each=3`, the port refusal, the `qpe2e` stack and clean-up, the address stand-in (browser-test stack only), the report and traces (`e2e/playwright-report/`, `e2e/test-results/`, CI's artifact for 14 days), no retries, and how a new feature adds its test and rows (Constitution VI). The repository layout lists `e2e/` and both checks.

---

## Phase 7: Polish, review, pull request

- [x] T031 For each test file, break the app once locally (a wrong label, a wrong path, a removed
  live update) and see that file's test fail with a readable message and trace; revert. Record which
  break proved which test.
  **Result**: One break per test, all at once in the apps (rebuilt by `npm run e2e`), then reverted; each test failed at its own break with a named locator, a screenshot, and a trace: `001 V3` the Booth header renamed ("QueuePass Ticket Booth" not found, step `booth: agent10`); `001 V4` the wrong-role sentence reworded; `002 D1` Delete ignoring Cancel (a DELETE was sent); `003 C1` the card's venue no longer a link; `006 P1/P4` "40 left" reworded; `007 S3` seat labels "Sec. A" (received text shown); `015 S2` reserved seats not passed to the seat picker (still "Row 2, Seat 3" after 2 s: the live update removed); `016 S2` "You can get" reworded; `017 S3` "Already used at" reworded; `019 S2` the address left unescaped in `LOCATION`; `020 S6` times in the browser's zone (`…7:00 PM MST` not found); `020 S7` the skipped-time hint removed. A first attempt, the Admin hello page calling the Booth greeting, failed every admin set-up too (the wrong-role page inside the app shell has a second Log out), so `001 V3`'s break was moved to the Booth. `006` then waited 60 s on its missing radio, which led to `actionTimeout: 10_000` (R16.10).
- [x] T032 README: the `022` status row and "Today" paragraph.
  **Result**: README: the `022` row (33/36 tasks, "Built (review pending)"), a sentence in the status lead, and the "Today" paragraph's browser-test sentence.
- [ ] T033 Independent review by a separate Claude session (Constitution 3.3.0) against spec.md,
  plan.md, research.md; fix the findings; record the round here.
- [x] T034 `npm run ci` locally, green (the marks check included); `npm run e2e -- --repeat-each=3`
  green once more after the review fixes; record both.
  **Result**: `npm run ci` green: format, lint, build; scripts 68 (45 before, plus 4 port, 15 marks, and 4 more workflow tests), "22 quickstarts marked; every browser test has its row", shared 681, backend 943, admin 249, customer 308, booth 76, seed 37 passed (20 skipped, Keycloak down), test:tz quick passed; coverage unchanged (shared 93.13%, backend 97.03%, admin 97.06%, customer 97.46%, booth 92.28%, seed 39.39%). `npm run e2e -- --repeat-each=3` on the final code: **36 passed**, 0 failed, 0 flaky (24.5 s of tests, 1.3 min in all), no `qpe2e` container or volume left. To be run once more after T033's fixes, if they change code.
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

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-10-30; it ran a throwaway Compose project to test
  `wait`): 2 must-fix, 6 should-fix, 6 minor; all fixed in the `Review 022` commit:
  - must: `docker compose wait seed` returns 1 once the seed has exited, so the runner relies on
    `up --wait --wait-timeout 600` (R3, T005); the demo data's two venue addresses were not in the
    stand-in, so demo data would fail with `ADDRESS_NOT_FOUND` (R4, T006).
  - should: accounts keyed on `parallelIndex`, not `workerIndex`, which grows after a failure (R8,
    T010); `apiAs` listens before sign-in (R6, T012); one `001 V3` test so one label names one test
    (R9, T015); no `@queuepass/shared` build in the `e2e` job, so a local time helper (T012); T008 no
    longer points at a missing task; the constitution clause applies to features whose
    implementation PR opens after `022`'s implementation merges, not "from 023 on".
  - minor: 19 quickstarts, not 18, and `022`'s own included (T027); one browser install, in the
    runner (R3, T024); the upload step is the one allowed conditional step (T024); SC-002 says 10
    features; plan says 8 files; US1's example label `006 P1`; `003 C1` instead of a `002` label (R9).
- **Open findings**: none.

## Implementation record

- **2026-10-30** (implementation session, from these files only): T001–T032 and T034 done; 12
  browser tests over 10 features in 9 files, three in a row green locally and green on GitHub (via
  the throwaway PR #105, T026). Decisions taken during the work are research R16. Left for others:
  T033 (the independent review, a separate session), T035 (the implementation PR), T036 (its CI
  and, after merge, the ruleset).
