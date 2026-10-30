# Research: Quickstart Browser Tests

**Feature**: `022-quickstart-browser-tests` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-10-30

Written unattended at Nate's request: each decision takes the recommended option and records the
alternatives, for the team to overturn in review of the spec PR.

## R1. Playwright Test, Chromium, a root folder that is not a workspace

**Decision**: `@playwright/test`, pinned to an exact version (the newest 1.x on the day T001 runs,
recorded there), as a **root `devDependency`**. The tests live in `e2e/` at the repository root
with their own `tsconfig.json`; `e2e/` is **not** an npm workspace, so the six workspaces and their
80% coverage floor (Constitution VI) are unchanged. Browsers are installed only by the browser-test
command (`npx playwright install chromium`, plus `--with-deps` in CI), never by `npm ci`. One
project: Chromium.

**Rationale**: Playwright drives several isolated browser contexts in one test (`015`'s two
customers), sets each context's time zone (`timezoneId`, `020`), captures downloads (`019`),
records traces and screenshots on failure, and runs headless in GitHub Actions. A root
devDependency is installed by the existing `npm ci`, linted and formatted by the existing root
config.

**Alternatives considered**: Cypress (one browser tab per test; two customers side by side needs
workarounds); WebdriverIO and Selenium (more setup, no built-in trace); a seventh workspace `e2e`
(would fall under the 80% coverage rule, which measures code under test, not tests).

## R2. Folder layout

```text
e2e/
├── playwright.config.ts      # R7
├── tsconfig.json
├── fixtures/
│   ├── apps.ts               # the three apps' URLs and test accounts
│   ├── sign-in.ts            # R5
│   ├── api.ts                # R6
│   └── data.ts               # unique venue/event/tier builders (R8)
├── tests/                    # one file per feature: 001-sign-in.spec.ts, 002-003-…, …
└── stack/
    ├── docker-compose.e2e.yml  # R4: the address stand-in and the Backend's URL for it
    └── geocoder-stub/          # R4: Dockerfile + server.mjs + addresses.json
scripts/e2e.mjs               # R3: the one command
scripts/check-quickstart-marks.mjs   # R10
```

## R3. The one command: `npm run e2e`

**Decision**: root script `"e2e": "node scripts/e2e.mjs"`. It:

1. Checks ports 5173, 5174, 5175, 3000, 8080, 9000, and 5432 with a TCP connect; if any answers,
   prints which and `docker compose down` (or the project name) as the fix, and exits 1 without
   starting anything (FR-013).
2. `docker compose -p qpe2e -f docker-compose.yml -f e2e/stack/docker-compose.e2e.yml down -v
   --remove-orphans` (a leftover from a killed run).
3. Same files: `up --build --detach --wait --wait-timeout 600`. `--wait` returns once every service
   is healthy and the one-shot seed has exited 0 (the apps start only after it completes); a seed
   that keeps failing (it has `restart: on-failure`) makes `--wait` time out instead of hanging. On a
   non-zero exit the runner prints `logs seed` and stops. No separate `wait seed`: once the seed has
   exited, `docker compose wait seed` finds no running container and returns 1 (review round 1,
   finding 1).
4. Loads the demo data: `docker compose ... exec -T backend node backend/dist/scripts/demo-data.js`
   (README's command) (FR-002).
5. `npx playwright install chromium` (`--with-deps` when `CI` is set; the CI job does not install
   the browser itself), then `npx playwright test -c
   e2e/playwright.config.ts` with any arguments passed through (a scenario name with `-g`, FR-013).
6. Always (in `finally`, and on SIGINT/SIGTERM): saves every service's log to
   `e2e/test-results/stack-logs/` when tests failed or the stack did not start, then `down -v
   --remove-orphans` (SC-006).

Exit code: Playwright's, or 1 if the stack did not start (the edge case "the stack fails to start").

**Rationale**: the same images and order as `docker compose up --build` (FR-001), from clean data
(FR-002), a fixed project name so a leftover is found and removed, and nothing touches the default
project a teammate uses day to day.

**Alternatives considered**: Playwright's `webServer` option (starts one process, not a Compose
stack); Testcontainers' Compose module (another layer over the same command, harder to debug).

## R4. The address stand-in

**Decision**: a ~40-line Node HTTP server, `e2e/stack/geocoder-stub/server.mjs`, in its own image
(`node:22-alpine`, the repository's Node version), serving `GET /geocoder/locations/address` the way
the Census Geocoder answers it (`backend/src/address/census-geocoder.ts`): a 200 with
`result.addressMatches`, one match with `matchedAddress` and `coordinates` for each address in
`addresses.json`, and an empty list for anything else. Addresses: the two demo-data venues (`430 W Vine St, Lexington, KY 40507` and `937 Phillips Ln, Louisville, KY 40209`, which `demo-data.ts` creates and which would otherwise get `ADDRESS_NOT_FOUND`, review round 1, finding 2), one in Louisville, KY (Eastern),
one in Chicago, IL (Central), one in Phoenix, AZ (Arizona), one in Los Angeles, CA (Pacific), with
real coordinates so the Backend's time-zone lookup (`GeoTzFinder`, offline) gives the right zone.
`docker-compose.e2e.yml` adds the service (with a health check) and sets the Backend's
`ADDRESS_GEOCODER_URL=http://geocoder-stub:8081` and `depends_on` it. `docker-compose.yml` is not
changed (FR-010).

**Rationale**: an outside service in the path makes the check fail when the Census site is slow or
down, which is not a QueuePass defect. The stand-in answers exactly the shape the Backend's own
geocoder tests use.

**Alternatives considered**: calling the real Census Geocoder (flaky, and rate-limited from shared
CI addresses); saving venues as "not verified" (skips `013`'s and `020`'s real path).

## R5. Signing in

**Decision**: `signIn(page, app, username)` in `e2e/fixtures/sign-in.ts`: opens the app's URL,
waits for Keycloak's page, fills the fields by their labels ("Username or email", "Password"),
presses "Sign In", and waits for the app's own signed-in content (the Sign out control). Every test
uses new browser contexts (Playwright's default), so no session leaks between tests. Users: each
test takes its own test accounts from the seed's numbered ranges by worker and test (R8), password
`test123` (FR-004).

**Rationale**: the sign-in is part of every journey; doing it through Keycloak's real page is what
catches broken wiring (US1). Labels, not CSS, so `021`'s new look does not break it.

**Alternatives considered**: Playwright `storageState` reuse: tokens are in memory only
(Constitution V), so only the Keycloak cookie would carry over, which hides sign-in breakage.

## R6. Setting up data through the API

**Decision**: `apiAs(page)` in `e2e/fixtures/api.ts`: starts listening **before** sign-in
(`page.waitForRequest` on `http://localhost:3000/` with an `authorization` header, created first and
awaited after `signIn`), because the app's first authorized call is usually sent before `signIn`
returns and tokens are in memory only (review round 1, finding 4); if none came, it reloads the page
and captures the reload's first call and builds a Playwright `APIRequestContext` with that `Authorization: Bearer …` header.
Helpers: `createVenue`, `createEvent`, `addTier`, `setTicketLimit`, `buyTickets` (for setup only,
when the scenario is not itself the purchase). On a 401 (an expired token), the helper reloads the
page to capture a fresh one, once.

**Rationale**: FR-004: the only credentials are the seed's test accounts, signed in through the
browser; no direct-grant client, no admin console token, no bypass. The API is the contract
(Constitution I), so setup through it is stable.

**Alternatives considered**: a test-only Keycloak client with password grants (a new client in the
realm, against the constitution's "direct-access grants disabled" rule for its intent); setting up
through the Admin UI every time (slow, and makes each test depend on the Admin pages).

## R7. Playwright configuration

**Decision**: `e2e/playwright.config.ts`: `testDir: 'tests'`, `fullyParallel: true`, `workers: 2` in
CI (`process.env.CI`) and 3 locally, **`retries: 0`** (FR-011), `forbidOnly: !!process.env.CI`,
`timeout: 60_000` per test, `expect.timeout: 10_000` (the `015` 2-second check sets its own),
`use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off', locale: 'en-US',
timezoneId: 'America/New_York' }`, reporters `list` plus `html` (`e2e/playwright-report`, never
opened automatically) plus `github` in CI. `outputDir: 'test-results'`. Both output folders in
`.gitignore` and `.prettierignore`.

**Rationale**: no retries keeps flakiness visible; traces only on failure keep artifacts small; a
fixed default zone makes non-`020` tests independent of the runner's zone.

## R8. Independent tests and unique data

**Decision**: every test creates its own venue (one of R4's addresses, name `e2e <test id> <short
random>`), its own events at that venue, and its own tiers, so tests never share an event and never
meet the 60-minute rule. Test accounts are picked so no two tests running at the same time share one:
customers `customer{100 + parallelIndex * 20 + n}`, agents `agent{10 + parallelIndex * 5 + n}`,
admins `admin{2 + parallelIndex}` (workers ≤ 3). `testInfo.parallelIndex` (0 to workers − 1), not
`workerIndex`, which grows each time Playwright replaces a worker after a failure (review round 1,
finding 3); `customer1`–`customer99`, `agent1`–`agent9`, and `admin1`
are left for people. The `016` limit counts per customer per event, so a new event per test resets
it. Demo data is loaded (FR-002) but no test changes or depends on it, except `003`'s browse test,
which only reads.

**Rationale**: order independence and parallel runs (spec edge cases), and repeatability: `--repeat-each=3`
runs every test three times in one stack (FR-011).

## R9. The journeys (FR-005)

| Test name | Walks |
| --- | --- |
| `001 V3: sign in, hello, and sign out of each app` (one test, the three apps in turn) | Keycloak sign-in, the app's page, Sign out ends the session (a reload shows Keycloak's page) |
| `001 V4: a customer is refused in the Admin app` | wrong-role page, no data, Sign out offered |
| `003 C1: an admin creates a venue and an event; a customer finds it` (`002`'s quickstart covers only deletion, D1–D7; its rules keep their Backend tests) | Admin UI venue + event; Customer search shows it with its venue and time |
| `006 P1/P4: a customer gets tickets in a tier and sees them in My tickets` | event set up by API; purchase in the Customer UI; My tickets |
| `007 …: a customer chooses seats and gets them` | seated event by API; seat map; purchase; My tickets lists the seats |
| `015 S2: live gray-out` | two customer contexts on one seated event; one reserves; the other's seats show unavailable within 2 s (`expect(...).toHaveAttribute(..., { timeout: 2_000 })`), no reload |
| `016 …: the per-customer limit refuses more tickets` | limit 2 set by API; buy 2; a third is refused with the limit message |
| `017 …: a gate agent admits a ticket by its typed code, once` | event starting in 1 h by API; ticket bought through the API as the customer; the booth: choose the event, type the code, ID check, Admit; the same code again → already used |
| `019 …: the calendar file` | `waitForEvent('download')`; the file's `SUMMARY`, `DTSTART`, `DTEND`, `LOCATION` |
| `020 …: times stay in the venue's zone` | a Phoenix venue and an event; Customer pages in `timezoneId` `America/New_York` and `Asia/Tokyo` show the Phoenix time with its abbreviation; the Admin event form refuses a start that a spring-forward night skips in an Eastern venue |

The exact scenario labels (`001` V3/V4, `003` C1, `006` P1/P4, `007` S3, `015` S2, `016` S2, `017`
S3, `019` S2, `020` S6/S7, checked in review round 1) are confirmed against each quickstart by
T015–T022, and T027 writes the marks
(R10). `018` (rotating code by camera) and `015` S5 (a hold running out after 5 minutes) stay manual
(spec Clarifications).

## R10. Marks in every quickstart, and the check

**Decision**: each `specs/*/quickstart.md` ends with a section:

```markdown
## Automation

| Scenario | Browser test |
| --- | --- |
| S1 | Automated: `015 S1: reserve, then confirm` |
| S5 | Manual: the hold runs out after 5 real minutes |
```

with one row per scenario label in that file. `scripts/check-quickstart-marks.mjs` (Node, no
dependencies) reads every quickstart's headings for scenario labels (`## S1`, `## P2:`, `## V3:`;
the pattern `^#{2,3} ([A-Z]{1,2}\d+)\b`), requires each label to have exactly one row, and collects
every Automated test name; then it reads `e2e/tests/*.spec.ts` for `test('…')` titles and fails when
a title has no Automated row or a row names no test (FR-008). It runs in `npm test` (the root
script, beside `check-contract-drift.mjs`) with a `node --test` file proving it on small inputs.
It takes well under a second (FR-015).

**Rationale**: one table per file is easy to read and to parse, whatever heading style an older
quickstart uses. Running in `npm test` catches a renamed test in the fast `test` check.

## R11. CI: a second job, `e2e`

**Decision**: `.github/workflows/ci.yml` gets a job `e2e` beside `test`, same triggers, same
permissions (read), same concurrency group: `runs-on: ubuntu-24.04`, `timeout-minutes: 30`, steps:
checkout (no credentials), setup-node from `.nvmrc` with the npm cache, `npm ci`, `npx playwright
install --with-deps chromium`, `npm run e2e`, and on failure `actions/upload-artifact` with
`e2e/playwright-report`, `e2e/test-results` (traces, screenshots, stack logs), kept 14 days. The
`test` job is unchanged (FR-015). `scripts/test/ci-workflow.test.mjs` changes from "one job, test" to
"two jobs, test and e2e", keeps every check on `test`, and adds the same checks for `e2e` (only
GitHub's own actions, named steps, nothing allowed to fail, the 30-minute limit).

**Rationale**: a separate job keeps `test`'s 30 minutes for the unit suites (FR-009, SC-003). Image
builds take most of the e2e time; if SC-003 is at risk, Docker's GitHub Actions cache is the next
step (left out until measured, Constitution VIII).

## R12. Required on `main`

**Decision**: after the implementation PR merges and the `e2e` check passes on `main`'s push run, a
repository admin adds `e2e` to the "main: CI must pass" ruleset beside `test` (FR-012). Recorded in
tasks as the last step, with who did it and when.

## R13. Flakiness rule

**Decision**: `retries: 0`. Before the implementation PR opens, `npm run e2e -- --repeat-each=3`
passes locally once (every test three times in one run) and the PR's CI run passes (FR-011, SC-004).
A failure in any of those is investigated: the trace shows whether the test or the app is wrong, and
one of them is fixed. No `test.fixme`, no `test.skip` for a flaky test, no longer timeouts to hide a
race.

## R14. Constitution amendment (FR-014)

**Decision**: in this spec PR. Principle VI gains a bullet: "For every feature whose implementation
PR opens after `022`'s implementation has merged, a feature's
implementation PR MUST include browser tests (`e2e/`, run by `npm run e2e` and the `e2e` check) for
its quickstart's main journey, and its quickstart MUST mark each scenario Automated or Manual (spec
`022`)." The Language and Stack table gains a row "Browser tests | Playwright (Chromium), in `e2e/`
at the repository root, against the Compose stack", and the "Continuous integration" row names the
`e2e` job. MINOR (a new requirement on future features).

Version: **3.5.0 → 3.6.0**. Written first as 3.4.2 → 3.5.0; `021`'s spec PR (#96, Principle VII)
merged first at 3.5.0, so this one was renumbered to **3.6.0** with its Sync Impact
Report, as `017`/3.2.1 did after `#67`.

## R15. What stays manual (FR-007)

Camera scanning on a real phone (`017`, `018`), printing (`017`), screen reader and contrast passes
(`008`, `012`, `021`), real-device layouts, timing goals measured with a person (`015`'s 90-second
purchase), waits of minutes (`015` S5), restarts of the stack (`001` V9), the contract browsing page
and token tampering already covered by Backend tests (`001` V6, V7), and anything that needs the
Keycloak admin console. Each gets its reason in its quickstart's table.

## R16. Decisions made during implementation (2026-10-30)

Recorded by the implementation session; each is the smallest change that matched what the code
and tools actually do.

1. **Scenario labels with a letter** (R10, T008): `012` (S5b) and `013` (S1b, S2b) label
   sub-scenarios with a trailing lower-case letter, which R10's pattern `^#{2,3} ([A-Z]{1,2}\d+)\b`
   does not match (no word boundary between `1` and `b`). The pattern is
   `^#{2,3} ([A-Z]{1,2}\d+[a-z]?)\b`, so those scenarios get rows too.
2. **Names checked by feature** (FR-003, FR-008): the marks check also fails a test title that
   does not start `NNN <label>: `, and looks for a title's Automated row in its own feature's
   quickstart (`specs/NNN-*/quickstart.md`), not in any quickstart.
3. **"Log out", not "Sign out"** (R5, T011): every app's control is **Log out** (spec `001`
   FR-015); the fixtures use that name. Keycloak's page is found by its heading, "Sign in to
   <app name>" (spec `021`), its fields by the labels "Username or email" and "Password", and its
   button "Sign In".
4. **A `002` test** (R9, SC-002): R9 walked `002`'s pages only inside `003 C1`, which leaves nine
   features. `002`'s quickstart D1 (delete an event, after cancelling the confirmation once; its
   time is free again) is a browser walk, so it has its own test: 12 tests over 10 features.
5. **`020` as two tests**, `020 S6` and `020 S7`, one label each, instead of one test over both.
6. **`016 S2` follows its quickstart**: limit 3, "You can get 3 more", the largest quantity offered,
   get 2, "1 more", get 1, then "You have reached the limit of 3 tickets for this event." with no
   confirm control. At the limit the Customer app offers no way to ask for more, so the refusal
   the test sees is that reason (the Backend's own refusal keeps its Backend tests).
7. **Request shapes from the contract**: the set-up helpers type their bodies with a type-only
   import of `packages/shared/src/api-schema.ts` (generated from `contracts/openapi.yaml`); it is
   erased when Playwright loads the tests, so nothing needs `@queuepass/shared` built (T012).
8. **Accounts per test**: each test file takes its own customer number `n` (`customerFor(testInfo,
   n)`), so one customer's seat reservation or ticket limit never meets another test's.
9. **The 2-second window of `015 S2`** starts at Customer 1's **Reserve seats** press; the test
   checks Customer 2's page before waiting for Customer 1's own confirmation.
10. **`actionTimeout: 10_000`** (R7, found by T031): a missing control made an action wait for the
    60-second test timeout; it now fails after 10 seconds, naming the control, like an expectation.
11. **The red-check break** (T026, quickstart B3): B3's example, a wrong API path in
    `MyTickets.tsx`, is caught by the Customer app's own component tests (their stub API answers by
    path, and they assert the path), and a wrong `VITE_API_BASE_URL` in `docker-compose.yml` is
    caught by `scripts/test/run-host.test.mjs`. The proof used a wire no unit test reads: the
    Customer app's `main.tsx` passing a wrong `apiBaseUrl` to the sign-in provider.
12. **Quickstarts merged after the spec**: `010` and `023` merged after this spec was written, so
    22 quickstarts are marked, not 19. `023` is not built on this branch; its rows are Manual, for
    its own implementation PR to replace (Constitution VI as amended).
