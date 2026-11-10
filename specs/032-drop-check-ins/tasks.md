---
description: "Task list for Drop Check-in Details a Week After the Event"
---

# Tasks: Drop Check-in Details a Week After the Event

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (1.24.0),
[quickstart.md](./quickstart.md) (S0–S6)

**Issue**: [#129](https://github.com/Trughouse-Holdings/QueuePass/issues/129). The implementation
PR's **description** says `fixes #129` on its own line. No commit message on either branch may
contain "fixes #129", "closes #129", or "resolves #129".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks of Phase 3.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `032-drop-check-ins-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `032-drop-check-ins-spec` and carry in every change that PR's review makes; once it merges, bring it
  up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 032: the retention job (T008, T009,
  #129)`.
- **One independent review** (Constitution III) of the implementation branch before its PR (T020).
- **`npm run ci` locally** before pushing (T018), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge.
- **Never run the job against a database you did not create.** Its first start removes the details of
  every event that ended more than a week ago, for good. Walk it on a Compose project of your own
  (`-p qp032`). The team stack (compose project `queuepass-team`, its Backend and apps run from
  `C:\Users\mahdi\hello_world\QueuePass-team` with `run-host.mjs`) holds every fixed port and the team's
  data: do not start this branch's Backend against it, and do not stop it, without Mahdi saying so in
  the session (T019). If it must be stopped for a stretch, use `docker compose -p queuepass-team stop`
  (never `down`, never `-v`).
- **Spec `031`** (PR #147, merged as `f9d083b`) changed the contract (1.23.0) and its implementation
  changes `EventsService.create`; this feature changes `updateLocked`, `toResponse`, and the contract
  (1.24.0, on top of 1.23.0). If `031`'s implementation merges first, rebase and keep both (research
  R10).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [x] T001 Cut `032-drop-check-ins-impl` from `032-drop-check-ins-spec` (or from `main` once the spec
  PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's.
  **Done** (2026-11-10): cut from `main` at `10802fe` (the spec PR merged); `npm ci`; `npm run ci`
  on the untouched branch green through format, lint, build, root scripts (85), shared (793), and the
  Backend's 1233 existing tests; its only failure was T003's new file, written meanwhile (the columns
  did not exist yet), as intended.

---

## Phase 2: Tests first (all must fail before Phase 3)

- [x] T002 [US1] [US2] `backend/test/integration/check-in-retention.e2e-spec.ts` (new; FR-001 to
  FR-006, FR-009, SC-001 to SC-004, research R4, R5, R11), with `createTestApp()` (which never starts the job) and
  its `FakeClock`; fixtures made through the services, then times and check-ins set directly with
  `prisma` (an event E ended at a fixed instant; its tickets admitted with all three columns, one with
  `checkedInAt` only, one void with an admission time; F ending 1 day after E; G not ended):
  - clock at `E.endsAt + 7 d − 1 min`: `app.get(CheckInRetention).removeDue()` returns no ids; every
    `Ticket` and `Event` row equal to before;
  - clock at `E.endsAt + 7 d`: E's tickets all have the three columns NULL (void one included); E has
    `checkInDetailsRemovedAt` = the clock and `keptCheckedInCount` = its valid admitted tickets; F's and
    G's rows equal to before;
  - a second `removeDue()` with the clock at `+ 8 d`: E unchanged (instant and count);
  - a cancelled event past its cutoff: removed, count 0; an event with no tickets: removed, count 0;
  - E's end moved 2 days later (through `PATCH`) before the cutoff: not removed at the old cutoff,
    removed at the new;
  - two removals at once, past the `running` flag (review round 1, S4): `removeEvent(E, now)` twice
    with `Promise.all`: exactly one returns `true`, E's instant and count are one removal's; and a
    second `CheckInRetention` instance's `removeDue()` beside the first's: the same;
  - the bound in exact hours (review rounds 1 S3, 2 S1): `endsAt` 2026-10-31T23:00Z, on its own
    `PrismaClient` (the test database's URL with `connection_limit=1`) with `SET TIME ZONE
    'America/New_York'` and `new CheckInRetention(thatClient, clock, 0)`: kept at `endsAt + 7 × 86 400
    000 ms − 1 min`, removed at `endsAt + 7 × 86 400 000 ms`; the client disconnected afterwards;
  - `GET /reports/sales` before and after E's removal: deep-equal but `generatedAt` and E's
    `checkInDetailsRemovedAt`; then E cancelled: its `checkedIn` 0 and the total down by its count;
  - `start()` on the test app's `CheckInRetention`: a due event is removed without calling `removeDue`
    (polled for at most 2 s); `app.close()` clears the timer;
  - no lifecycle hook runs it (SC-007, review rounds 1 M1, 2 S2): a due event with check-ins, then a
    second `createTestApp()` (every `onModuleInit` and `onApplicationBootstrap` runs, as in the demo
    commands' application context) and a 500 ms wait: its check-ins and NULL removal columns
    untouched; that app closed afterwards. (Not `createApplicationContext(AppModule)`: its real address
    services would use the network, spec `013` R9.)
  And `backend/test/unit/check-in-retention-start.spec.ts` (new): `CheckInRetention.prototype` has no
  `onModuleInit` and no `onApplicationBootstrap`; `backend/src/main.ts` calls its `start()`;
  `retentionBound(now)` is `now − 604 800 000 ms` exactly for weeks holding the 2026-11-01 fall-back
  and the 2027-03-14 spring-forward.
  Must fail (no module yet).
  **Done**: written first; failed (no module, no `CHECK_IN_RETENTION_DAYS`). Two cases corrected
  after the first green run, not the code: F, which ends a day after E, is itself due at `+ 8 d` and at
  the moved end's cutoff minus 1 minute, so those runs remove F and leave E as it was.
- [x] T003 [P] [US1] `backend/test/integration/check-in-retention.constraints.e2e-spec.ts` (new;
  FR-015): raw SQL updates on an event: an instant without a count, a count without an instant, and a
  count of −1 each fail naming `event_check_ins_removed_together`; both set with 0 succeeds. Must fail
  (no columns yet).
  **Done**: failed (no columns), then green.
- [x] T004 [P] [US4] `backend/test/integration/events.check-ins-removed.e2e-spec.ts` (new; FR-008,
  SC-006, research R6): on an event marked removed (set directly): `PATCH` with a later `endsAt`, an
  earlier `startsAt`, or a different `doorsOpenAt` → `409 CHECK_IN_DETAILS_REMOVED`,
  `details.removedAt` its instant, the message naming the date in the venue's zone, the event unchanged;
  `PATCH` with the stored three instants and a new name → `200`, name changed; on an event not removed,
  a time change → `200`. Precedence (research R6): a removed event with `endsAt` before `startsAt` →
  `400`; with a changed `endsAt` and a capacity below its sold tickets → `409 CHECK_IN_DETAILS_REMOVED`.
  Each response passes `expectToMatchContract(res, 'updateEvent')`. Also
  `getEvent`, `listMyOrders`, and `getSalesReport` include `checkInDetailsRemovedAt` (`null`, then the
  instant) and match the contract. Must fail.
  **Done**: failed (no columns), then green; also asserts the kept count is never on `Event`.
- [x] T005 [P] [US2] [US3] Admin app (Vitest; FR-009 to FR-013, research R7, R8):
  - `admin-app/test/check-ins-removed.test.tsx` (new): a removed event (fixture with
    `checkInDetailsRemovedAt` `2026-11-10T03:00:00Z`, venue `America/New_York`, report row `checkedIn`
    3): Attendees shows "Check-in details removed on Nov 9, 2026 (kept for 7 days after the event).",
    the summary "3 checked in", no "checked in" per ticket, "—" per order; with the report failing, the
    summary has no checked-in part; the Sales card shows 3 and the sentence; Reports shows 3 and
    "Details removed Nov 9, 2026" in that row only; EventForm shows a `409 CHECK_IN_DETAILS_REMOVED`
    message as its error banner with the values kept. A not-removed event: all as today.
  - `admin-app/test/export/attendee-rows.test.ts`: a removed event's table has every "Checked in" cell
    empty and the subtitle lines include the sentence and "3 tickets were checked in."; without a count,
    the sentence only. `sales-rows.test.ts`: a removed event's row has the report's `checkedIn`.
  Must fail.
  **Done**: 8 page and 3 export cases failed. `sales-rows.test.ts`'s new case passed from the start,
  as R8 leaves `salesTable` unchanged; it stays as the guard.
- [x] T006 [P] Customer app (Vitest; FR-014, research R9): `customer-app/test/check-ins-removed.test.tsx`
  (new): an order whose event has `checkInDetailsRemovedAt` set: each valid ticket reads "Event over",
  with no "Show entry code" or "Print ticket" link; a void ticket "Void"; `/my-tickets/<id>/print` for
  such a ticket shows "This ticket can't be printed."; an order whose event is not removed: as today.
  Must fail.
  **Done**: 2 of 3 failed (the not-removed case is today's behaviour).

---

## Phase 3: Implementation

- [x] T007 Shared (research R3; contracts/README.md): `CHECK_IN_RETENTION_DAYS = 7` in
  `packages/shared/src/event.ts` (exported), `Event.checkInDetailsRemovedAt?: string | null`;
  `packages/shared/src/order.ts`: the same on the My tickets order event and `EventSales`. Keep
  `api-schema.ts` as generated in the spec PR (`node scripts/check-contract-drift.mjs`).
  **Done**.
- [x] T008 Migration and schema (data-model.md): `20261110000000_check_in_retention/migration.sql`
  exactly as data-model.md; `schema.prisma` fields and comments; `npx prisma generate`. Makes T003
  pass.
  **Done**: the migration sorts after `20261102000000_doors_open`, the newest on `main`; `030` and `031`
  add none.
- [x] T009 [US1] `backend/src/entry/check-in-retention.ts` (research R5): `CHECK_IN_RETENTION_INTERVAL_MS`
  token, `CheckInRetention` with `start()` (one run, then the timer), `onModuleDestroy`, and **no
  lifecycle hook that runs it**; `removeDue(now?)` with the running flag, the bound computed in
  JavaScript by the exported `retentionBound(now)` (`now − CHECK_IN_RETENTION_DAYS × 86 400 000 ms`,
  never SQL interval arithmetic), passed as `${bound}::timestamptz`, the due query; public `removeEvent(id, now)`, the locked transaction (lock, re-check against the same bound,
  count, empty the tickets, mark the event); each event's failure logged and skipped; one log line per
  run that removed anything. `EntryModule` provides it with `{ provide: CHECK_IN_RETENTION_INTERVAL_MS,
  useValue: 3_600_000 }`. `backend/src/main.ts` calls `app.get(CheckInRetention).start()` after
  `app.listen`, the only call. Makes T002's removal cases and the start-up unit test pass.
  **Done**: the removal's two writes are the SQL of R5 (so `Event.updatedAt` is not bumped by the job).
- [x] T010 [US2] `ReportsService.sales` (research R4): `checkedIn` is 0 for a cancelled event, else the
  kept count once removed, else the live count; `checkInDetailsRemovedAt` on each event row. Makes T002's
  report cases pass.
  **Done**.
- [x] T011 [US4] `EventsService` (research R6): in `updateLocked`, after `doorsOpenAt` is resolved and
  before the capacity checks and `assertNoConflict`, the `409 CHECK_IN_DETAILS_REMOVED` for a changed resolved `startsAt`, `endsAt`, or `doorsOpenAt` on a
  removed event (message date in the venue's zone, `details.removedAt`); `toResponse` sends
  `checkInDetailsRemovedAt`; `OrdersService.mine` adds it to the event summary. Check
  `backend/test/integration/demo-reset.e2e-spec.ts`'s fingerprint still passes (the new columns are
  NULL after every reset, research R10). Makes T004 pass.
  **Done**: `demo-reset.e2e-spec.ts` passes unchanged (its fingerprint names fields, the new ones
  NULL after every reset).
- [x] T012 [US3] Admin app (research R7, R8): `removedNote()` in `format.ts`; Attendees, SalesCard,
  Reports, EventForm's 409 banner; `attendeeTable` with the optional kept count; Attendees passes it.
  Makes T005 pass.
  **Done**: no change to `EventForm` was needed; its existing banner shows the 409 with the values
  kept. The export's count line reads "1 ticket was checked in." for one.
- [x] T013 Customer app (research R9): `MyTickets.tsx` state and links; `PrintTicket.tsx` refusal.
  Makes T006 pass.
  **Done**.

---

## Phase 4: Documentation, review, pull request

- [x] T014 README: a short "Check-in retention" paragraph (what is removed, when, the constant, that a
  Backend start removes every event past its cutoff, what admins see); the `032` status row updated.
  **Done**: README "Check-in retention" under What the system does; status row Done (18/21 tasks).
- [x] T015 `contracts/openapi.yaml`: list `checkInDetailsRemovedAt` as required on `Event`,
  `OrderEvent`, and `EventSales` now that the Backend sends it (as `014`, `016` did; still 1.24.0, a
  note in the field descriptions "Required from 1.24.0 once implemented"); regenerate `api-schema.ts`.
  **Done**: `checkInDetailsRemovedAt` required on `Event`, `OrderEvent`, `EventSales`;
  `api-schema.ts` regenerated; `check-contract-drift` green.
- [x] T016 Quickstart: confirm the Automation table (all Manual, with reasons) still holds.
  **Done**: still all Manual; nothing in `e2e/tests` for `032`; `check-quickstart-marks` green.
- [x] T017 Backend coverage: the job's error paths (one event failing, a deleted event) have tests, so
  the Backend stays above 80%.
  **Done**: one event failing (logged, the others removed), a deleted event (`false`), a run already
  going, and a failing run at `start()` (logged) are tested; `check-in-retention.ts` 97.82% lines,
  Backend 97.03%.
- [x] T018 `npm run ci` locally, three times, with `npm run test:tz` once; all green.
  **Done** (2026-11-10, head after `f3bd624`): `npm run ci` green, exit 0, with `KEYCLOAK_URL` and
  `KEYCLOAK_HEALTH_URL` set to `http://127.0.0.1:9` (seed: 262 passed, 28 live tests skipped). Counts:
  root scripts 85; shared 793; Backend 1269 (110 suites); admin-app 377; customer-app 338; booth-app
  94; seed 262 + 28 skipped. Lines: shared 96.77%, Backend 97.03%, admin-app 97.32%, customer-app
  97.66%, booth-app 93.44%, seed 99.41%. Then each affected workspace three times in a row, identical
  each time: shared 793/793, Backend 1269/1269, admin-app 377/377, customer-app 338/338. `npm run
  test:tz`: all pass in America/New_York, UTC, America/Los_Angeles, Pacific/Honolulu for shared,
  Backend, admin, customer, booth. A second `npm run ci` with the README and tasks changes: green, the same counts.
- [ ] T019 Walk the quickstart S0–S6 on `-p qp032` (or path B with Mahdi's go), recording each
  Expected as seen.
  **Pending**: not walked by the implementing session. `-p qp032` needs the fixed ports the team
  stack holds, and the ground rules allow stopping it only with Mahdi's go in the session; no browser
  test covers `032` (quickstart Automation), so there was no CI-only path to it either.
- [ ] T020 Independent review (Constitution III) of the implementation branch by a Claude session that
  did not write it; fix the findings; record them below.
- [ ] T021 Open the PR (`fixes #129` in the description, the review record, the walk), after the spec
  PR has merged; CI green.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Tests (T002–T006)** → **Shared and schema (T007, T008)** → **Backend
  (T009–T011)** → **Admin (T012)** and **Customer (T013)** → **Docs and review (T014–T021)**.
- T008 before T009–T011. T010 needs T009's columns only. T012 and T013 need T007's types.
- T015 after T009–T011 (the Backend sends the fields).

### Parallel opportunities

- T003, T004, T005, T006 beside T002 (different workspaces and files).
- T012 and T013 once T007 is done.

## Implementation Strategy

- **MVP**: T001–T011: the Backend removes the details at the cutoff, keeps the counts, and locks the
  times. On its own it meets US1, US2 (report figures), and US4.
- Then the Admin app's sentence and attendee export (US3), the Customer app's labels, the README, and
  the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-11-09): 2 must-fix, 3 should-fix, 4 nits; all fixed
  in the `Review 032: spec review round 1` commit, and the roadmap row and Impact line in their own
  `Constitution:` commit.
  - M1: the removal ran from `onApplicationBootstrap`, which `NestFactory.createApplicationContext`
    also calls, so the demo data and demo reset commands (`demo-data.ts`, `demo-reset.ts`, run by CI's
    e2e harness) would have run it beside their `TRUNCATE` and `app.close()` → the job has no
    lifecycle hook; `main.ts` calls `start()` after `listen`, the one call (chosen over an interval of
    0 in the scripts, which cannot override a provider without a new variable); spec FR-006, SC-007;
    a T002 case (the demo context leaves a due event untouched) and a unit test (only `main.ts` calls
    `start()`) (research R5, R10, R11, plan, T002, T009).
  - M2: spec `030` (merged) was amended without saying so → declared, for removed events only:
    `030` FR-016 (a Past ticket keeps its state and printable ticket) is replaced by FR-014, and
    `030`'s edge case of an event moved later coming back is overridden by FR-008 (decided by the
    orchestrating session on Mahdi's standing approval); in the spec's Context, Clarifications,
    FR-008, FR-014; research R6, R9 (its "Past section unchanged" corrected), R10; a dated note in
    `specs/030-hide-past-events/spec.md`; the roadmap row depends on `018` and `030`, and the
    constitution's Impact line names both amendments.
  - S3: the due query added `make_interval(days => 7)` in SQL, calendar days in the session's zone (an
    hour off across daylight saving) → the bound is computed in JavaScript and the re-check under the
    lock uses it; a T002 case across the 2026-11-01 fall-back (research R5, T002, T009).
  - S4: "two `removeDue()` at once" was stopped by the `running` flag before reaching the lock →
    `removeEvent` is public and the test runs it twice at once, plus two instances (research R5, R11,
    T002).
  - S5: a venue time-zone change moves events without `updateLocked` → named as the one exception in
    FR-008 (only events without orders move, so no ticket is affected); the check sits after
    `doorsOpenAt` is resolved and before the capacity and conflict checks, with the error precedence
    stated and tested (research R6, T004, T011).
  - N6: US1's and US4's weekdays: Nov 2 and Nov 9, 2026 are Mondays.
  - N7: Clarifications and R2 reworded: the record of which holders entered is dropped; buyer names
    stay on orders as purchase data.
  - N8: `018` in the roadmap row's Depends on (with M2).
  - N9: `getTicketEntryKey` for a removed event's ticket: decided not to refuse it (a contract change
    for a key that opens nothing; it already serves unused tickets of any ended event); research R6,
    spec Clarifications.
  - After the fixes, three runs each: `prettier --check .`, `check-quickstart-marks`,
    `check-contract-drift`, root script tests.
- **Round 2** (independent Claude session, 2026-11-09): no must-fix, 2 should-fix, 4 nits; the
  reviewer's verdict: only minor findings remain. All fixed in the `Review 032: spec review round 2`
  commit.
  - S1: `SET TIME ZONE` through the pooled `PrismaService` reaches one connection only, so the
    daylight-saving case could not catch interval arithmetic → it runs on its own `PrismaClient` with
    `connection_limit=1` and a `CheckInRetention` built on it; `retentionBound(now)` is exported and
    unit-tested; the bound is passed as `${bound}::timestamptz` (research R5, R11, T002, T009).
  - S2: the SC-007 case built `createApplicationContext(AppModule)`, whose real address services would
    use the network (spec `013` R9), and a removal it started would not be awaited → a second
    `createTestApp()` (every lifecycle hook runs) and a 500 ms wait leave a due event untouched; the
    unit test asserts `CheckInRetention.prototype` has no `onModuleInit` or `onApplicationBootstrap`
    and that `main.ts` calls `start()`, without scanning every file (research R5, R11, T002).
  - N3: contracts/README.md said the hand-written shared types gain the fields in T013; it is T007.
  - N4: merge order decided: `032` waits for `031` (PR #147) to merge, then rebases (`031` takes 3.9.3
    and 1.23.0; `032` keeps 3.9.4 and 1.24.0) → ground rules, research R10 and R12 say so, as plan.md
    and the Sync Impact Report.
  - N5: `030`'s Clarification on My tickets and its US2 acceptance scenario 2 gain the same dated
    note as its FR-016.
  - N6: Assumptions' "One Backend" points to the Edge Cases and research R5, not FR-005.
  - After the fixes, three runs each: `prettier --check .`, `check-quickstart-marks`,
    `check-contract-drift`, root script tests.
- **Open findings**: none.

## Review record (implementation branch)

_Left for the implementation's review (T020)._
