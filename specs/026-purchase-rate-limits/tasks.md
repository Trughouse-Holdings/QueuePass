---
description: "Task list for Purchase Rate Limits"
---

# Tasks: Purchase Rate Limits

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R14),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (1.17.0, already on
this branch), [quickstart.md](./quickstart.md) (S0–S8)

**Issue**: [#56](https://github.com/Trughouse-Holdings/QueuePass/issues/56). The implementation PR's
**description** says `fixes #56` on its own line. No commit message on either branch may contain
"fixes #56", "closes #56", or "resolves #56".

**Tests**: **REQUIRED and written first** (Constitution VI). Write each phase's tests and see them
fail before the implementation below them. Boundaries are tested on both sides, concurrency with
genuinely concurrent requests against real PostgreSQL. Browser tests are required (Constitution VI):
`026`'s implementation PR opens after `022`'s merged.

## Ground rules

- **Fresh session** (Constitution III) on `026-purchase-rate-limits-impl`, cut from the spec branch
  while its PR is open (rebased onto `main` once it merges).
- **Commits**: `Impl 026: <what> (T0xx, #56)`; the body names the `FR-…` and `R…` it rests on.
- **No database change**: nothing under `backend/prisma/` changes (data-model.md). If a task seems to
  need one, the plan is wrong: stop and fix the plan.
- **Docker**: `npm run e2e` uses the standard ports; stop any other stack first (`docker ps`) and
  leave nothing running when done.
- One independent review (T023), `npm run ci` green (T024), `npm run e2e` green (T022), the walk
  (T025), CI green on GitHub (T026).

---

## Phase 1: Setup

- [x] T001 Cut the branch; `npm ci`; `npm run ci` green before any change; record the counts per
  workspace here. Confirm the contract is 1.17.0 and `node scripts/check-contract-drift.mjs` passes
  (both on the spec branch already). If `main` has moved the contract past 1.16.0 since (for example
  `025`'s 1.16.1), rebase, keep this feature's minor bump above it (research R13), run `npm run
  generate:api`, and check the drift again.
  **Done 2026-11-02**: `026-purchase-rate-limits-impl` cut from `origin/main` c87837a (spec PR #113
  merged); `npm ci` clean; baseline `npm run ci` green: scripts 75, shared 735 (93.06% lines),
  backend 94 suites / 955 (97.05%), admin-app 337 (97.23%), customer-app 312 (97.46%), booth-app
  79 (92.28%), seed 91 + 20 skipped (100%), test-tz quick green. Contract 1.17.0 on `main`; drift
  check passes. `main` has not moved since (025 not merged), so no rebase.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared message, the rule, and the test set-up every story uses.

### Tests first

- [x] T002 [P] New `packages/shared/test/rate-limit.test.ts` (research R4, R10). Must fail (nothing
  exists): `rateLimitMessage(1)` → exactly "Too many tries. You can try again in 1 second.";
  `rateLimitMessage(3)` → "Too many tries. You can try again in 3 seconds."; `rateLimitMessage(60)`
  → "… in 60 seconds.".
  **Done 2026-11-02**: 3 tests (also: exported from the package); seen failing (no `../src/rate-limit`).
- [x] T003 [P] New `backend/test/unit/attempt-limits.spec.ts` (research R2, R3, R5, R8, R10), with a
  hand-moved clock stub (`{ now: () => t }`, which this unit test may move backwards) and the service
  built directly with `{ perMinute: 10, perFiveSeconds: 3 }`. Must fail:
  - 3 attempts at `t` → the 4th at `t` refused, `retryAfterSeconds: 5`; at `t + 4001` and `t + 4999`
    refused with `1`; at `t + 5000` let through (half-open window);
  - 3, 3, 3, 1 attempts at `t`, `t + 5 s`, `t + 10 s`, `t + 15 s` → the 11th at `t + 59_999` refused
    with `1`; at `t + 60_000` let through; when both windows bind, the larger wait is given;
  - 20 refused attempts during a wait, then the wait → let through (refusals not recorded);
  - the clock going backwards (research R2): 3 attempts at `t`, the stub moved to `t - 30_000` → the
    next attempt is let through (the "future" times are dropped); 10 attempts at `t`, the stub moved
    to `t - 3_600_000` → no refusal ever has `retryAfterSeconds` above 60; `AttemptLimitsModule`
    provides `ATTEMPT_CLOCK` as `performance.now()`, not `Date.now()`;
  - `BUY` and `HOLD`, and two `sub`s, never affect each other;
  - a key with no time left after pruning is deleted; `sweepOnce()` deletes keys whose newest time is
    a minute old and keeps the others;
  - the log (`jest.spyOn(Logger.prototype, 'warn')`): one line on the first refusal of a wait, naming
    the `sub`, the kind, the window, and N, and not the username; none for further refusals in that wait; one
    again for a refusal after it; no line contains the string passed as a token anywhere in the test;
  - `attemptLimitsFromEnv(env)` (`attempt-limits.config.ts`): both unset → `{ perMinute: 10,
    perFiveSeconds: 3 }`; `'7'` → 7; each of `'0'`, `'-1'`, `'1.5'`, `'abc'`, `''`, `' 3'`, `'03'`
    throws an `Error` whose message names the variable and quotes the value; per-5-seconds `'11'`
    with per-minute `'10'` throws naming both; `'10'` and `'10'` is allowed.
  **Done 2026-11-02**: 30 tests, seen failing (modules missing). Added: `'1e3'` and a 20-digit value
  refused; `RATE_LIMIT_PER_MINUTE='2'` alone refused against the default 3; two guard cases
  (unmarked handler untouched; a marked handler without a principal throws). A 31st test (exact
  waits on fractional clock times) came with T010.

### Implementation

- [x] T004 `packages/shared/src/rate-limit.ts`: `rateLimitMessage(seconds)` and `type RateLimitedAction
  = 'BUY' | 'HOLD'`; export from `index.ts`. T002 passes.
  **Done 2026-11-02**: T002 passes (3/3).
- [x] T005 `backend/src/attempt-limits/`: `attempt-limits.config.ts` (`ATTEMPT_LIMITS` token,
  `attemptLimitsFromEnv`, the defaults and the check, research R5), `attempt-limits.service.ts`
  (`tryAttempt(sub, kind)` → `{ ok: true } | { ok: false, retryAfterSeconds }`, synchronous
  with no `await`, exactly research R2's steps, including dropping times after `now` and the
  60-second cap; `sweepOnce()`; the 60-second `unref`'d interval
  started in `onModuleInit` and cleared in `onModuleDestroy`; the log, R8), and
  `attempt-limits.clock.ts` (`ATTEMPT_CLOCK`, `{ now: () => performance.now() }`), and
  `attempt-limits.module.ts` (provides and exports the service; provides `ATTEMPT_LIMITS` from
  `process.env` and `ATTEMPT_CLOCK` itself: the existing `CLOCK` is provided only inside `EntryModule`
  and is wall-clock time, research R2). Doc comments cite spec 026 and the FRs. T003 passes.
  **Done 2026-11-02**: T003 passes (30/30). The guard and decorator (T010's files) landed here too,
  for T003's guard cases; they were registered only in T010.
- [x] T006 `backend/test/setup/test-app.ts` (research R5): `createTestApp(options?: { attemptLimits?:
  'defaults' | { perMinute: number; perFiveSeconds: number } })`; with no option it **assigns**
  `RATE_LIMIT_PER_MINUTE` and `RATE_LIMIT_PER_5_SECONDS` = `'1000'` before compiling; with numbers,
  those; with `'defaults'`, deletes both. It also overrides `ATTEMPT_CLOCK` with a new
  `FakeAttemptClock` (`backend/test/setup/fake-attempt-clock.ts`: starts at `performance.now()`,
  `advance(ms)` only, no way to go back) and returns it as `attemptClock`; check that
  `overrideProvider(ATTEMPT_CLOCK)` reaches the provider inside `AttemptLimitsModule`. Update its doc
  comment (a sixth substitution). Every existing caller is unchanged.
  **Done 2026-11-02**: as written; the override reaches `AttemptLimitsModule`'s provider (T007's
  boundary case passes only on the fake clock: `advance(4999)` then `advance(1)`). The doc comment
  counts five substitutions plus the limits as configuration.

**Checkpoint**: the rule works on its own; nothing is limited yet.

---

## Phase 3: User Story 1 - No One Account Can Flood Buying or Holding (P1) 🎯 MVP

**Goal**: `createOrder` and `reserveSeats` refused with `429 RATE_LIMITED` over the allowances, for
every caller, before anything else.

**Independent Test**: spec US1's Independent Test; quickstart S4.

### Tests first

- [x] T007 [P] [US1] New `backend/test/integration/rate-limits.buy.e2e-spec.ts` (research R1, R2, R4,
  R10), `createTestApp({ attemptLimits: 'defaults' })`, every response validated against the
  contract (`expectToMatchContract`, so the `429` must be declared). The counts live in the app's
  memory and are shared by every `it` in the file, so **each case uses customers of its own**
  (`tokenFor({ username: 'rl-buy-<case>', roles: ['customer'] })`), never `CUSTOMER`; time moves only
  with `ctx.attemptClock.advance(ms)`, never with the live-code `ctx.clock`. Must fail:
  - 20 genuinely concurrent `POST /events/{id}/orders` from one customer for a general-admission
    event with 100 tickets, distinct `requestId`s (`Promise.all`) → exactly 3 `201` and 17 `429`;
    each `429` has `code: RATE_LIMITED`, the message `rateLimitMessage(n)`, `details: { action:
    'BUY', retryAfterSeconds: n }` with `1 <= n <= 5`, and `Retry-After` equal to `String(n)`;
    exactly 3 orders in the database;
  - while a first customer sends 200 concurrent orders, a second customer's order → `201`; a spy on
    `OrdersService.prototype.create` is called exactly once per answer that is not `429`, so no refused
    request reaches the code that uses the database (SC-005; the guard and `AttemptLimitsService`
    take no `PrismaService`, as T005's constructors show);
  - on the attempt clock: 3 orders, then the 4th `429` with `retryAfterSeconds` 5; `advance(4999)` →
    `429` with 1; `advance(1)` → handled (FR-002);
  - refusal order (FR-003, FR-009): 5 requests without a token → `401`; 5 with an admin token → `403`;
    then the customer still has 3 handled; 3 malformed bodies (`400`) then a valid order → `429`; a
    repeated `requestId` counts (2 new orders, the repeat of one → `200`, then a new order → `429`);
  - a refused order leaves the customer's active seat reservation unchanged (FR-007).
  **Done 2026-11-02**: 8 cases, all seen failing for the right reason (200/201 where 429 was
  expected). The sign-in-and-role case uses the same `sub` for an expired token and an admin-role
  token, so "not counted" is about that account; an unknown event (404) counts too; the 20-at-once
  case also checks FR-019's one log line (the `sub`, not the username or the token); a seated event
  gets a venue of its own (a layout cannot change under a venue's existing events).
- [x] T008 [P] [US1] New `backend/test/integration/rate-limits.hold.e2e-spec.ts` (research R7, R10),
  the same set-up and the same rule of one customer per case (`rl-hold-<case>`), a seated event with
  30 open seats. Must fail:
  - 20 genuinely concurrent `POST /events/{id}/reservation`, each for its own seat → exactly 3 answers
    that are not `429` and 17 `429` with `action: 'HOLD'`; the reservation holds only the seats of the
    handled requests;
  - a customer holding 2 seats who is then refused keeps both with the same `expiresAt`
    (`GET /me/reservations`), and a `SeatEventsService.publish` spy sees no change from the refused
    request (FR-007);
  - 10 `POST /events/{id}/reservation/release` and 3 `POST /me/reservations/release` within one second
    → never `429` (FR-004);
  - the buy allowance used up → a hold is handled; the hold allowance used up → an order is handled
    (FR-001).
  **Done 2026-11-02**: 4 cases, seen failing (no 429). The releases case first uses up the hold
  allowance, so a counted release would be refused, and checks the wait is unchanged afterwards.
- [x] T009 [P] [US1] `backend/test/contract/route-coverage.e2e-spec.ts` (research R4, R10): the routes
  whose handler has `ATTEMPT_LIMIT_KEY` metadata are exactly the contract operations with
  `x-attempt-limit`, with the same kind, and each of those declares a `'429'` response. Must fail (no
  route has the metadata yet).
  **Done 2026-11-02**: seen failing (no route marked); also asserts the two kinds are present, so an
  empty match on both sides cannot pass.

### Implementation

- [x] T010 [US1] `backend/src/attempt-limits/attempt-limit.decorator.ts` (`@AttemptLimit(kind)`,
  `ATTEMPT_LIMIT_KEY`) and `attempt-limit.guard.ts` (research R1, R4): reads the metadata with
  `Reflector`; none → `true`; otherwise `tryAttempt(request.principal.sub, kind)`; refused → sets
  `Retry-After` on the response and throws `HttpException({ error: { code: 'RATE_LIMITED', message:
  rateLimitMessage(n), details: { action: kind, retryAfterSeconds: n } } }, 429)`. Register it in
  `backend/src/auth/auth.module.ts` as the third `APP_GUARD`, after `RolesGuard`, importing
  `AttemptLimitsModule`; a comment says the order is the order of refusals (FR-009). Mark
  `OrdersController.create` `@AttemptLimit('BUY')` and `ReservationsController.reserve`
  `@AttemptLimit('HOLD')`, nothing else. T007–T009 pass; every other Backend test passes unchanged
  (T006's large numbers).
  **Done 2026-11-02**: T007–T009 pass (15/15); full Backend suite 97 suites / 999 tests green. Found:
  `t + 5000 - now` on fractional `performance.now()` came out a hair over 5000 and said 6 seconds;
  the rule now works from ages (`now - t`), with a failing-first unit test on fractional times;
  research R2 and data-model.md updated. A marked route with no principal throws (AuthGuard makes
  that impossible), rather than letting the request through.
- [x] T011 [US1] Configuration (research R5, FR-017): `docker-compose.yml` backend `environment`
  gains `RATE_LIMIT_PER_MINUTE: ${RATE_LIMIT_PER_MINUTE:-10}` and `RATE_LIMIT_PER_5_SECONDS:
  ${RATE_LIMIT_PER_5_SECONDS:-3}` with a comment (spec 026); `.env.example` gains a "Purchase rate
  limits (spec 026)" section with both and a line that a demo may raise them and nothing switches them
  off; `e2e/stack/docker-compose.e2e.yml`'s `backend` `environment` sets `RATE_LIMIT_PER_MINUTE: '10'`
  and `RATE_LIMIT_PER_5_SECONDS: '3'` literally, with a comment, so a developer's `.env` or shell
  cannot change the browser tests' limits (FR-018, research R5); check with `docker compose -f
  docker-compose.yml -f e2e/stack/docker-compose.e2e.yml config` and `RATE_LIMIT_PER_MINUTE=99` in the
  environment that the backend still gets `'10'`, and record it here. `npx prettier --check` on the
  three files.
  **Done 2026-11-02**: with `RATE_LIMIT_PER_MINUTE=99 RATE_LIMIT_PER_5_SECONDS=50` in the shell, the
  merged e2e config gives the backend `"10"` and `"3"`; `docker-compose.yml` alone gives `"99"` (the
  override works), and `"10"`/`"3"` with nothing set. Prettier passes on both YAML files
  (`.env.example` has no Prettier parser and is skipped by `format:check`).

**Checkpoint**: US1 works: quickstart S4 passes against the running stack.

---

## Phase 4: User Story 2 - A Customer Over a Limit Is Told When to Try Again (P1)

**Goal**: the message above the disabled button, counting down, nothing lost.

**Independent Test**: spec US2's Independent Test; quickstart S2, S3.

### Tests first

- [x] T012 [US2] New `customer-app/test/rate-limit.test.tsx` (research R6, R10), with the stubbed API
  (as `seat-holds.test.tsx` and `purchase.test.tsx`) and Vitest's fake timers. Must fail:
  - a `429 RATE_LIMITED` (`action: HOLD`, `retryAfterSeconds: 3`) on **Reserve seats** → "Too many
    tries. You can try again in 3 seconds." directly before Reserve seats, which has
    `aria-disabled="true"`, keeps focus (`document.activeElement`), and sends nothing when clicked or
    activated with Enter; the picked seat still chosen; the held seats, **Confirm purchase**, and **Release** still there and
    enabled; advancing 1 s → "… 2 seconds", then "… 1 second", then the message gone and Reserve
    seats no longer `aria-disabled` and still focused; Enter sends the hold again;
  - exactly one `role="alert"` for the refusal, whose text stays "… 3 seconds." while the visible
    text counts down; the visible text is not in a live region;
  - a `429` (`action: BUY`) on **Confirm order** → the message before Confirm order, Confirm order
    `aria-disabled` and focused again (it was natively disabled while confirming, so focus had gone
    to `body`; research R6), quantity and name kept, no `refresh` of availability; on **Confirm purchase** → Confirm
    purchase disabled and Reserve seats still enabled;
  - **Check again** after an unknown outcome refused with `429` → still "We couldn't confirm whether
    your order went through", the countdown before Check again, Check again disabled until it ends,
    and the next press sends the same `requestId` as the first;
  - the hold's own countdown keeps going during a buy wait;
  - a `429` without a numeric `details.retryAfterSeconds`, or another code → today's refusal
    message, nothing disabled.
  **Done 2026-11-02**: 7 tests; the 4 countdown cases seen failing (no message), the 3 "not a
  refusal for the limit" cases pass as today's behavior. jsdom does not move focus off a button
  that becomes disabled, so the Confirm order case blurs it inside the stubbed reply, as a browser
  would.

### Implementation

- [x] T013 [US2] `customer-app/src/components/GetTickets.tsx` per research R6: the `waits` state and
  250 ms tick, the recognition in `reserve()` and `confirm()` (returning to the phase it came from,
  keeping `requestId`), `aria-disabled` with ignored clicks for a waiting kind and focus restored to
  the pressed button when it had gone to `body`, the message (`rateLimitMessage`, `banner
  banner--error`, `aria-live="off"`) with its one-time `.visually-hidden` `role="alert"`, in the four
  places. Doc comments cite spec 026. T012 passes; every other Customer app test passes unchanged
  (`seat-holds`, `purchase`, `ticket-limit`, `keyboard`, `theme-classes`).
  **Done 2026-11-02**: T012 passes (7/7); the whole Customer app suite passes, 24 files / 319 tests;
  no new line or branch of `GetTickets` uncovered. The hidden alert comes first and the visible
  countdown last, so the countdown is directly above its button.

**Checkpoint**: quickstart S2 and S3 pass in the browser.

---

## Phase 5: User Story 3 - Ordinary Customers Never Notice (P1)

**Goal**: the proof that ordinary use is untouched and refusals are cheap.

### Tests first, then the check

- [x] T014 [P] [US3] New `backend/test/integration/rate-limits.ordinary.e2e-spec.ts` (research R9,
  R10), `'defaults'`, one customer of its own, on `ctx.attemptClock` advanced 2 seconds between
  actions, except the two releases, which come back to back (with 2 seconds between every action,
  counted releases could never reach 4 in 5 seconds; research R10): hold 2 seats, add 1,
  release 1, release 1, hold 1, buy the held seats, then buy 2 general-admission tickets on a second
  event, then repeat the buy's `requestId` → no `429` anywhere (FR-016). Passes once T010 is in; it
  must fail if the guard counted releases (check by temporarily marking `release` and seeing it fail;
  record that here, then remove the mark).
  **Done 2026-11-02**: passes (statuses 201, 200, 200, 200, 200, 201, 201, 200). With `release`
  temporarily marked `@AttemptLimit('HOLD')` it failed: the second back-to-back release answered
  `429` ("releaseSeats returned 429, which the contract does not declare"); mark removed. Plan gap
  fixed in this task and research R10: with 2 seconds between every action, counted releases could
  never reach 4 in 5 seconds, so the releases are back to back.
- [x] T015 [US3] Search every browser test that buys or holds seats (`e2e/tests/`) and record here, per
  test, its customer account (`customerFor(testInfo, n)`) and how many buy and hold requests it sends
  within any 5 seconds; each must be at most 3 for one account, or the test is changed to use another
  account (never larger limits, FR-018). Confirm no two tests share an `n`, and choose this feature's
  (T016): the lowest `n` no test on the branch uses (the highest on `main` at the time of writing is
  10; `025`'s browser tests may take more).
  **Done 2026-11-02** (most buy / hold requests of one account in any 5 seconds; no retries, R13 of
  `022`): `006 P1/P4` n=0: 2 buys (API set-up, Confirm order), 0 holds; `007 S3` n=1: 1 hold, 1 buy;
  `015 S2` n=2: 1 hold, n=3: none; `016 S2` n=4: 2 buys (two Confirm orders); `017 S3` n=5: 1 buy
  (API); `019 S2` n=6: 1 buy (API); `020 S6` n=7: 1 buy (API); `003 C1` n=8, `001 V3` n=9, `001 V4`
  n=10: none; `002`, `020 S7`, `024`: no customer. All at most 3; no two tests share an `n`. `026`
  takes n=11, the lowest unused (025's tests are not on `main` yet; if they take 11, 026 moves).

---

## Phase 6: Browser test (Constitution VI)

- [x] T016 `e2e/tests/026-rate-limits.spec.ts`, test `'026 S2: a customer over the hold limit sees a
  countdown and keeps their seats'`, exactly as research R11, with a `customerFor` index no other test
  uses (T015). Fill **Name on tickets** before the first hold (Confirm purchase needs a valid name to
  be enabled). Assert each of step 3's three API answers is `400` or `429`, nothing more precise. Read
  N from the page; assert it is 1 to 5 and that Reserve seats has `aria-disabled="true"`; wait for the
  message to go with a 10-second timeout; add the second seat. No fixed sleeps.
  **Done 2026-11-02**: written as R11, `customerFor(testInfo, 11)`; the API attempts use the page's
  own token (`apiAs` on the test page) through a new `Api.status`, which returns a status without
  asserting it. `tsc -p e2e` and ESLint clean. **Not run here**: this machine cannot build the
  stack's images (TLS interception), so it runs first in CI's `e2e` check.
- [ ] T017 See the test fail once against a deliberate break, then restore it (as `022` T031): with
  the guard's `HOLD` mark removed from `reserve` (no refusal: the message never appears), and with
  the Customer app's wait never cleared (Reserve seats stays `aria-disabled`). Record both failures (the
  assertion that failed) here.
  **Left for the orchestrator**: needs the `qpe2e` stack, which cannot be built on this machine.
- [x] T018 `specs/026-purchase-rate-limits/quickstart.md` Automation table: row S2 exactly as research
  R12 lists it (every other row unchanged), and the paragraph above the table loses its "On the spec
  branch …" sentence. `node scripts/check-quickstart-marks.mjs` passes.
  **Done 2026-11-02**: as written; "25 quickstarts marked; every browser test has its row".

---

## Phase 7: Polish & cross-cutting

- [x] T019 [P] `README.md` (research R14): the features table's `026` row (spec link, "Each customer
  account may try to buy, and separately to hold seats, at most 10 times a minute and 3 times in any 5
  seconds; over a limit, the Customer app counts down until they can try again", "Draft", "Done (N/26
  tasks)", the code status); the Status paragraph names `026`; one line in "What the system does" on
  the limits; the two settings with their defaults where the README lists configuration (next to
  `.env.example`). `npx prettier --check README.md`.
  **Done 2026-11-02**: as written ("Done (20/26 tasks)", "Built (review pending)"); the settings
  paragraph sits after the start command's address-service note; Prettier passes.
- [x] T020 Coverage: every workspace stays at or above 80% line coverage; `attempt-limits/` and the new
  `GetTickets` branches have no untested branch; record each workspace's figure here.
  **Done 2026-11-02**: shared 96.67%, backend 97.17%, admin-app 97.23%, customer-app 97.60%,
  booth-app 92.28%, seed 100%. `attempt-limits/` 100% of lines and branches (a dead branch, "forget
  a key left with none" after a check, was removed; the sweep does it, research R2 and data-model
  updated; one config branch got a test). No new `GetTickets` line or branch uncovered. The
  repeat runs found two flakes, both fixed: `FakeAttemptClock` now starts in whole milliseconds
  (a fractional start made five advances totalling 60 000 ms land a hair short; Backend 2 of 3
  runs failed on the minute boundary), and the Customer app's refocus is a layout effect (a
  passive one could run after the commit `waitFor` saw; Check again's focus check failed twice in
  `test:tz`).
- [x] T021 `npx tsc --noEmit -p e2e` and `npm run lint` clean for the new and changed files.
  **Done 2026-11-02**: `tsc -p e2e` clean; `npm run lint` (ESLint and `tsc -p e2e`) clean;
  `npm run format:check` clean.
- [ ] T022 `npm run e2e` locally, green: every test, `026`'s included, with the default limits (no
  `RATE_LIMIT_…` in the environment); record the count and time here; the stack left stopped. Any
  browser test refused with `429` is a finding against FR-016, not a reason to raise the limits.
  **Left for the orchestrator / CI**: this machine cannot build the stack's images (TLS
  interception), so the browser tests, `026 S2` included, run first in CI's `e2e` check.
- [x] T023 Independent review by a separate Claude session (Constitution III) of the branch against
  spec, plan, research, and contract 1.17.0; fix the findings, tests first where a finding is a
  defect; record the round here (counts by severity, each fix, and any finding left open with the
  reason). The reviewer is asked to confirm the plan's Complexity Tracking entry (Principle IV).
  **Done 2026-11-02**, one round on b6d15bb: **0 must, 1 should, 6 minor**, nothing left open. The
  reviewer confirmed concurrency, the window math and rounding, the guard order, and memory.
  - S1 (browser test under `--repeat-each`, one account over 10 a minute by the third run): each
    repeat signs in as `customerFor(testInfo, 11 + repeatEachIndex)`, checked below 20 (`022` R8;
    at most 9 repeats), research R11.
  - M1 (step 4 could slip in on a slow runner): step 3 sends attempts until one is refused with
    `Retry-After` of at least 3; `Api.attempt` returns the status and `Retry-After`.
  - M2 (Check again's message could be announced twice): one live region at the top of Get
    tickets says each refusal once; the unknown-outcome banner stays mounted while Check again is
    sent. Tests first (failed: no live region).
  - M3 (a wait re-announced when its button comes back): the same live region; test first.
  - M4: a test that the countdown's interval is cleared on unmount.
  - M5: two app-level tests that a wrong setting stops `createTestApp` (the whole app) from starting.
  - M6: research R2 and data-model.md give the formulas as ages, not sums with a note.
- [x] T024 `npm run ci` locally green after the review's fixes and the latest merge of `origin/main`;
  record the counts per workspace and the coverage figures.
  After T023's fixes (head 6ae57b8, `main` unmoved since c87837a): root `npm run ci` green; customer-app
  321 ×3, backend 026 specs 50 ×3 and full backend 1003, shared 738; every workspace at or above 92%
  line coverage. Before the review, at 2b27c58 (`main` unmoved since
  c87837a), `npm run ci` was green: scripts 75, shared 738 (96.67%), backend 98 suites / 1001
  (97.17%), admin-app 337 (97.23%), customer-app 319 (97.60%), booth-app 79 (92.28%), seed 91 +
  20 skipped (100%), test-tz quick green. Each changed workspace green 3 times in a row after the
  last change to it (shared 738 ×3, backend 1001 ×3, customer-app 319 ×3); `format:check` and
  `lint` clean. Full `npm run test:tz`: green once; two other runs failed only in tests this branch
  does not touch, under load: admin-app `reports-export.test.tsx` (R13a, "made by") and
  customer-app `app.test.tsx` ("offers no change control at /events/e1": the Name on tickets
  textbox had already loaded), both timing flakes that predate `026`.
- [x] T025 Running-system walk, quickstart S0–S8, on a stack built from this branch. Mahdi walks it
  (S7 needs VoiceOver); record each scenario's result as he reports it; his "pass" closes the walk.
  - 2026-11-02, path B (images can't build here): a throwaway `qp026walk` database and Keycloak,
    `run-host.mjs --demo-data` from this branch, real limits (10 per minute, 3 per 5 seconds). The demo
    data has no seated event, so a "Seat Test" event (Demo Arena, section A 5 × 10, reserved seating)
    was added to that database for the walk.
  - **S2 passed (Mahdi)**: four Reserve seats presses within 5 seconds; the fourth showed "Too many
    tries. You can try again in N seconds." with the countdown, held seats kept, and Reserve seats
    worked again when it ended.
  - Not walked by hand: S1, S3 to S8 (covered by the automated tests: T007 to T016, and `026 S2` in
    CI's `e2e`); the VoiceOver pass in S7 is to do.
- [ ] T026 Push; open the implementation PR after the spec PR has merged and the branch is rebased
  onto `main`: its description says `fixes #56` on its own line and carries the review (T023), the
  counts and coverage (T024), the browser test and its deliberate failures (T017, T022), the browser
  tests' accounts (T015), and the walk (T025). Review gate 7: the description also states the
  Principle IV deviation recorded in plan.md's Complexity Tracking (counts in the Backend's memory),
  Mahdi's acceptance on 2026-11-02, and what is given up (a restart grants a fresh allowance; more
  than one Backend would multiply it). CI green on GitHub (the `test` and `e2e` checks); merge
  when green and approved by every team member (shared surface: `packages/shared/`,
  `docker-compose.yml`, `.env.example`, and `contracts/openapi.yaml` if the rebase renumbered it).
  **Left for the orchestrator** (push, PR, CI).

---

## Dependencies & Execution Order

- T001 → Foundational (T002 → T004; T003 → T005; T006 after T005) → US1 (T007, T008, T009 in
  parallel → T010 → T011) → US2 (T012 → T013; needs T004 only, so it may run beside US1) → US3 (T014
  after T010; T015 any time) → browser test (T016 after T010, T011, T013 → T017 → T018) → polish
  (T019–T021 in parallel; T022; T023 → T024 → T025 → T026).
- T006 must land before T010: without it, the existing concurrency tests (20 orders from one customer
  at once) would be refused by the new guard.

## Parallel Examples

- Foundational tests: T002 (shared) and T003 (Backend unit).
- US1's tests: T007 (buy), T008 (hold), T009 (route coverage).
- Polish: T019 (README), T020 (coverage), T021 (lint).

## Implementation Strategy

- **MVP**: T001–T011: the Backend enforces the limits for every caller (US1), the heart of #56.
- Then US2 (the Customer app's countdown), US3's proof, the browser test, and the polish.
- Each story's checkpoint is a quickstart walk of its scenarios; the full walk (T025) is Mahdi's.
