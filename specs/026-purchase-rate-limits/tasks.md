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

- [ ] T001 Cut the branch; `npm ci`; `npm run ci` green before any change; record the counts per
  workspace here. Confirm the contract is 1.17.0 and `node scripts/check-contract-drift.mjs` passes
  (both on the spec branch already). If `main` has moved the contract past 1.16.0 since (for example
  `025`'s 1.16.1), rebase, keep this feature's minor bump above it (research R13), run `npm run
  generate:api`, and check the drift again.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared message, the rule, and the test set-up every story uses.

### Tests first

- [ ] T002 [P] New `packages/shared/test/rate-limit.test.ts` (research R4, R10). Must fail (nothing
  exists): `rateLimitMessage(1)` → exactly "Too many tries. You can try again in 1 second.";
  `rateLimitMessage(3)` → "Too many tries. You can try again in 3 seconds."; `rateLimitMessage(60)`
  → "… in 60 seconds.".
- [ ] T003 [P] New `backend/test/unit/attempt-limits.spec.ts` (research R2, R3, R5, R8, R10), with a
  `FakeClock` (`backend/test/setup/fake-clock.ts`) and the service built directly with `{ perMinute:
  10, perFiveSeconds: 3 }`. Must fail:
  - 3 attempts at `t` → the 4th at `t` refused, `retryAfterSeconds: 5`; at `t + 4001` and `t + 4999`
    refused with `1`; at `t + 5000` let through (half-open window);
  - 3, 3, 3, 1 attempts at `t`, `t + 5 s`, `t + 10 s`, `t + 15 s` → the 11th at `t + 59_999` refused
    with `1`; at `t + 60_000` let through; when both windows bind, the larger wait is given;
  - 20 refused attempts during a wait, then the wait → let through (refusals not recorded);
  - `BUY` and `HOLD`, and two `sub`s, never affect each other;
  - a key with no time left after pruning is deleted; `sweepOnce()` deletes keys whose newest time is
    a minute old and keeps the others;
  - the log (`jest.spyOn(Logger.prototype, 'warn')`): one line on the first refusal of a wait, naming
    the `sub`, the username, the kind, the window, and N; none for further refusals in that wait; one
    again for a refusal after it; no line contains the string passed as a token anywhere in the test;
  - `attemptLimitsFromEnv(env)` (`attempt-limits.config.ts`): both unset → `{ perMinute: 10,
    perFiveSeconds: 3 }`; `'7'` → 7; each of `'0'`, `'-1'`, `'1.5'`, `'abc'`, `''`, `' 3'`, `'03'`
    throws an `Error` whose message names the variable and quotes the value.

### Implementation

- [ ] T004 `packages/shared/src/rate-limit.ts`: `rateLimitMessage(seconds)` and `type RateLimitedAction
  = 'BUY' | 'HOLD'`; export from `index.ts`. T002 passes.
- [ ] T005 `backend/src/attempt-limits/`: `attempt-limits.config.ts` (`ATTEMPT_LIMITS` token,
  `attemptLimitsFromEnv`, the defaults and the check, research R5), `attempt-limits.service.ts`
  (`tryAttempt(principal, kind)` → `{ ok: true } | { ok: false, retryAfterSeconds }`, synchronous
  with no `await`, exactly research R2's steps; `sweepOnce()`; the 60-second `unref`'d interval
  started in `onModuleInit` and cleared in `onModuleDestroy`; the log, R8), and
  `attempt-limits.module.ts` (provides and exports the service; provides `ATTEMPT_LIMITS` from
  `process.env`; uses the existing `CLOCK`). Doc comments cite spec 026 and the FRs. T003 passes.
- [ ] T006 `backend/test/setup/test-app.ts` (research R5): `createTestApp(options?: { attemptLimits?:
  'defaults' | { perMinute: number; perFiveSeconds: number } })`; with no option it **assigns**
  `RATE_LIMIT_PER_MINUTE` and `RATE_LIMIT_PER_5_SECONDS` = `'1000'` before compiling; with numbers,
  those; with `'defaults'`, deletes both. Update its doc comment (a fifth substitution). Every existing
  caller is unchanged.

**Checkpoint**: the rule works on its own; nothing is limited yet.

---

## Phase 3: User Story 1 - No One Account Can Flood Buying or Holding (P1) 🎯 MVP

**Goal**: `createOrder` and `reserveSeats` refused with `429 RATE_LIMITED` over the allowances, for
every caller, before anything else.

**Independent Test**: spec US1's Independent Test; quickstart S4.

### Tests first

- [ ] T007 [P] [US1] New `backend/test/integration/rate-limits.buy.e2e-spec.ts` (research R1, R2, R4,
  R10), `createTestApp({ attemptLimits: 'defaults' })`, every response validated against the
  contract (`expectToMatchContract`, so the `429` must be declared). Must fail:
  - 20 genuinely concurrent `POST /events/{id}/orders` from one customer for a general-admission
    event with 100 tickets, distinct `requestId`s (`Promise.all`) → exactly 3 `201` and 17 `429`;
    each `429` has `code: RATE_LIMITED`, the message `rateLimitMessage(n)`, `details: { action:
    'BUY', retryAfterSeconds: n }` with `1 <= n <= 5`, and `Retry-After` equal to `String(n)`;
    exactly 3 orders in the database;
  - while a first customer sends 200 concurrent orders, a second customer's order → `201`; a spy on
    `OrdersService.prototype.create` is called exactly once per answer that is not `429`, so no refused
    request reaches the code that uses the database (SC-005; the guard and `AttemptLimitsService`
    take no `PrismaService`, as T005's constructors show);
  - on the test clock (`ctx.clock.set`, `useRealTime()` in `afterEach`): the 4th within 5 seconds
    `429` with `retryAfterSeconds` 5, at `+4999 ms` `429` with 1, at `+5000 ms` handled (FR-002);
  - refusal order (FR-003, FR-009): 5 requests without a token → `401`; 5 with an admin token → `403`;
    then the customer still has 3 handled; 3 malformed bodies (`400`) then a valid order → `429`; a
    repeated `requestId` counts (2 new orders, the repeat of one → `200`, then a new order → `429`);
  - a refused order leaves the customer's active seat reservation unchanged (FR-007).
- [ ] T008 [P] [US1] New `backend/test/integration/rate-limits.hold.e2e-spec.ts` (research R7, R10),
  the same set-up, a seated event with 30 open seats. Must fail:
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
- [ ] T009 [P] [US1] `backend/test/contract/route-coverage.e2e-spec.ts` (research R4, R10): the routes
  whose handler has `ATTEMPT_LIMIT_KEY` metadata are exactly the contract operations with
  `x-attempt-limit`, with the same kind, and each of those declares a `'429'` response. Must fail (no
  route has the metadata yet).

### Implementation

- [ ] T010 [US1] `backend/src/attempt-limits/attempt-limit.decorator.ts` (`@AttemptLimit(kind)`,
  `ATTEMPT_LIMIT_KEY`) and `attempt-limit.guard.ts` (research R1, R4): reads the metadata with
  `Reflector`; none → `true`; otherwise `tryAttempt(request.principal, kind)`; refused → sets
  `Retry-After` on the response and throws `HttpException({ error: { code: 'RATE_LIMITED', message:
  rateLimitMessage(n), details: { action: kind, retryAfterSeconds: n } } }, 429)`. Register it in
  `backend/src/auth/auth.module.ts` as the third `APP_GUARD`, after `RolesGuard`, importing
  `AttemptLimitsModule`; a comment says the order is the order of refusals (FR-009). Mark
  `OrdersController.create` `@AttemptLimit('BUY')` and `ReservationsController.reserve`
  `@AttemptLimit('HOLD')`, nothing else. T007–T009 pass; every other Backend test passes unchanged
  (T006's large numbers).
- [ ] T011 [US1] Configuration (research R5, FR-017): `docker-compose.yml` backend `environment`
  gains `RATE_LIMIT_PER_MINUTE: ${RATE_LIMIT_PER_MINUTE:-10}` and `RATE_LIMIT_PER_5_SECONDS:
  ${RATE_LIMIT_PER_5_SECONDS:-3}` with a comment (spec 026); `.env.example` gains a "Purchase rate
  limits (spec 026)" section with both and a line that a demo may raise them and nothing switches them
  off; `e2e/stack/docker-compose.e2e.yml` gains a comment only: the browser tests run with the
  defaults (FR-018). `npx prettier --check` on the three files.

**Checkpoint**: US1 works: quickstart S4 passes against the running stack.

---

## Phase 4: User Story 2 - A Customer Over a Limit Is Told When to Try Again (P1)

**Goal**: the message above the disabled button, counting down, nothing lost.

**Independent Test**: spec US2's Independent Test; quickstart S2, S3.

### Tests first

- [ ] T012 [US2] New `customer-app/test/rate-limit.test.tsx` (research R6, R10), with the stubbed API
  (as `seat-holds.test.tsx` and `purchase.test.tsx`) and Vitest's fake timers. Must fail:
  - a `429 RATE_LIMITED` (`action: HOLD`, `retryAfterSeconds: 3`) on **Reserve seats** → "Too many
    tries. You can try again in 3 seconds." directly before Reserve seats, which is disabled; the
    picked seat still chosen; the held seats, **Confirm purchase**, and **Release** still there and
    enabled; advancing 1 s → "… 2 seconds", then "… 1 second", then the message gone and Reserve
    seats enabled; pressing it sends the hold again;
  - exactly one `role="alert"` for the refusal, whose text stays "… 3 seconds." while the visible
    text counts down; the visible text is not in a live region;
  - a `429` (`action: BUY`) on **Confirm order** → the message before Confirm order, Confirm order
    disabled, quantity and name kept, no `refresh` of availability; on **Confirm purchase** → Confirm
    purchase disabled and Reserve seats still enabled;
  - **Check again** after an unknown outcome refused with `429` → still "We couldn't confirm whether
    your order went through", the countdown before Check again, Check again disabled until it ends,
    and the next press sends the same `requestId` as the first;
  - the hold's own countdown keeps going during a buy wait;
  - a `429` without a numeric `details.retryAfterSeconds`, or another code → today's refusal
    message, nothing disabled.

### Implementation

- [ ] T013 [US2] `customer-app/src/components/GetTickets.tsx` per research R6: the `waits` state and
  250 ms tick, the recognition in `reserve()` and `confirm()` (returning to the phase it came from,
  keeping `requestId`), the disabled conditions, the message (`rateLimitMessage`, `banner
  banner--error`, `aria-live="off"`) with its one-time `.visually-hidden` `role="alert"`, in the four
  places. Doc comments cite spec 026. T012 passes; every other Customer app test passes unchanged
  (`seat-holds`, `purchase`, `ticket-limit`, `keyboard`, `theme-classes`).

**Checkpoint**: quickstart S2 and S3 pass in the browser.

---

## Phase 5: User Story 3 - Ordinary Customers Never Notice (P1)

**Goal**: the proof that ordinary use is untouched and refusals are cheap.

### Tests first, then the check

- [ ] T014 [P] [US3] New `backend/test/integration/rate-limits.ordinary.e2e-spec.ts` (research R9,
  R10), `'defaults'`, on the test clock advanced 2 seconds between actions: hold 2 seats, add 1,
  release 1, release 1, hold 1, buy the held seats, then buy 2 general-admission tickets on a second
  event, then repeat the buy's `requestId` → no `429` anywhere (FR-016). Passes once T010 is in; it
  must fail if the guard counted releases (check by temporarily marking `release` and seeing it fail;
  record that here, then remove the mark).
- [ ] T015 [US3] Search every browser test that buys or holds seats (`e2e/tests/`) and record here, per
  test, its customer account (`customerFor(testInfo, n)`) and how many buy and hold requests it sends
  within any 5 seconds; each must be at most 3 for one account, or the test is changed to use another
  account (never larger limits, FR-018). Confirm no two tests share an `n`, including this feature's
  (T016).

---

## Phase 6: Browser test (Constitution VI)

- [ ] T016 `e2e/tests/026-rate-limits.spec.ts`, test `'026 S2: a customer over the hold limit sees a
  countdown and keeps their seats'`, exactly as research R11, with a `customerFor` index no other test
  uses (T015). Read N from the page; assert it is 1 to 5; wait for the message to go with a 10-second
  timeout; add the second seat. No fixed sleeps.
- [ ] T017 See the test fail once against a deliberate break, then restore it (as `022` T031): with
  the guard's `HOLD` mark removed from `reserve` (no refusal: the message never appears), and with
  the Customer app's wait never cleared (Reserve seats stays disabled). Record both failures (the
  assertion that failed) here.
- [ ] T018 `specs/026-purchase-rate-limits/quickstart.md` Automation table: row S2 exactly as research
  R12 lists it (every other row unchanged), and the paragraph above the table loses its "On the spec
  branch …" sentence. `node scripts/check-quickstart-marks.mjs` passes.

---

## Phase 7: Polish & cross-cutting

- [ ] T019 [P] `README.md` (research R14): the features table's `026` row (spec link, "Each customer
  account may try to buy, and separately to hold seats, at most 10 times a minute and 3 times in any 5
  seconds; over a limit, the Customer app counts down until they can try again", "Draft", "Done (N/26
  tasks)", the code status); the Status paragraph names `026`; one line in "What the system does" on
  the limits; the two settings with their defaults where the README lists configuration (next to
  `.env.example`). `npx prettier --check README.md`.
- [ ] T020 Coverage: every workspace stays at or above 80% line coverage; `attempt-limits/` and the new
  `GetTickets` branches have no untested branch; record each workspace's figure here.
- [ ] T021 `npx tsc --noEmit -p e2e` and `npm run lint` clean for the new and changed files.
- [ ] T022 `npm run e2e` locally, green: every test, `026`'s included, with the default limits (no
  `RATE_LIMIT_…` in the environment); record the count and time here; the stack left stopped. Any
  browser test refused with `429` is a finding against FR-016, not a reason to raise the limits.
- [ ] T023 Independent review by a separate Claude session (Constitution III) of the branch against
  spec, plan, research, and contract 1.17.0; fix the findings, tests first where a finding is a
  defect; record the round here (counts by severity, each fix, and any finding left open with the
  reason). The reviewer is asked to confirm the plan's Complexity Tracking entry (Principle IV).
- [ ] T024 `npm run ci` locally green after the review's fixes and the latest merge of `origin/main`;
  record the counts per workspace and the coverage figures.
- [ ] T025 Running-system walk, quickstart S0–S8, on a stack built from this branch. Mahdi walks it
  (S7 needs VoiceOver); record each scenario's result as he reports it; his "pass" closes the walk.
- [ ] T026 Push; open the implementation PR after the spec PR has merged and the branch is rebased
  onto `main`: its description says `fixes #56` on its own line and carries the review (T023), the
  counts and coverage (T024), the browser test and its deliberate failures (T017, T022), the browser
  tests' accounts (T015), and the walk (T025). CI green on GitHub (the `test` and `e2e` checks); merge
  when green and approved by every team member (shared surface: `packages/shared/`,
  `docker-compose.yml`, `.env.example`, and `contracts/openapi.yaml` if the rebase renumbered it).

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
