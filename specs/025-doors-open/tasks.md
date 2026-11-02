---
description: "Task list for Doors Open"
---

# Tasks: Doors Open

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R15),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (1.16.0, already on
this branch), [quickstart.md](./quickstart.md) (S0–S10)

**Issue**: [#91](https://github.com/Trughouse-Holdings/QueuePass/issues/91). The implementation PR's
**description** says `fixes #91` on its own line. No commit message on either branch may contain
"fixes #91", "closes #91", or "resolves #91".

**Tests**: **REQUIRED and written first** (Constitution VI). Write each phase's tests and see them
fail before the implementation below them. Boundaries are tested on both sides. Browser tests are
required (Constitution VI): `025`'s implementation PR opens after `022`'s merged.

## Ground rules

- **Fresh session** (Constitution III) on `025-doors-open-impl`, cut from the spec branch while its
  PR is open (rebased onto `main` once it merges).
- **Commits**: `Impl 025: <what> (T0xx, #91)`; the body names the `FR-…` and `R…` it rests on.
- **Prisma**: the migration changes the schema, so run `npm run prisma:generate --workspace
  @queuepass/backend` after T005. On Windows, stop any Backend running from `scripts/run-host.mjs`
  first: it locks Prisma's engine file.
- **Docker**: `npm run e2e` uses the standard ports; stop any other stack first (`docker ps`) and
  leave nothing running when done.
- One independent review (T038), `npm run ci` green (T039), `npm run e2e` green (T037), the walk
  (T040), CI green on GitHub (T041).

---

## Phase 1: Setup

- [x] T001 Cut the branch; `npm ci`; `npm run ci` green before any change; record the counts per
  workspace here. Confirm the contract is 1.16.0 and `node scripts/check-contract-drift.mjs` passes
  (both on the spec branch already).
  **Done 2026-11-02** on `025-doors-open-spec` d95f07b: `npm ci` clean (Node 22.20.0). Root `npm run
  ci` stopped at `eslint .` on an untracked `.claude/worktrees/` (another session's worktree, not
  in ESLint's ignores); the same steps with `eslint . --ignore-pattern ".claude/**"` passed in 7 min
  52 s: scripts/test 75, shared 681 (93.08% lines), backend 955 in 94 suites (97.05%), admin-app
  335 (97.23%), customer-app 308 (97.46%), booth-app 76 (92.28%), seed 91 + 20 skipped (100%),
  test:tz --quick (Los Angeles) pass. Contract 1.16.0; the drift check passes.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared rule and the column every story reads.

### Tests first

- [x] T002 [P] Shared tests (research R2, R9) in `packages/shared/test/` (next to the existing
  `time-zone` tests). Must fail (nothing exists):
  - `DEFAULT_DOORS_BEFORE_START_MINUTES === 60`, `DOORS_OPEN_MAX_BEFORE_START_MINUTES === 360`,
    `ENTRY_OPENS_BEFORE_DOORS_MINUTES === 60`;
  - `doorsOpenProblem(start, doors)`: doors = start → `null`; start − 6 h → `null`; start − 6 h −
    1 min → `'TOO_EARLY'`; start + 1 min → `'AFTER_START'`; start − 6 h across the 2027-03-14
    spring-forward night in `America/New_York` (local clocks 7 hours apart) → `null` (elapsed time);
  - `doorsOpenRangeMessage('2026-11-21T00:00:00Z', 'America/New_York')` → exactly "Doors must open
    no more than 6 hours before the start and not after it: between Nov 20, 2026, 1:00 PM EST and
    7:00 PM EST."; for a 3:00 AM start, the range crosses midnight and the latest end shows its date
    ("…between Nov 20, 2026, 9:00 PM EST and Nov 21, 2026, 3:00 AM EST.");
  - `formatDoorsOpen(start, doors, zone)`: "5:30 PM EST" on the start's local date; "Nov 19, 2026,
    11:30 PM EST" for doors the day before.
  **Done**: `packages/shared/test/doors-open.test.ts`, 12 tests; failed first with
  "doorsOpenProblem / doorsOpenRangeMessage / formatDoorsOpen is not a function".

### Implementation

- [x] T003 `packages/shared/src/event.ts`: the three constants, `doorsOpenProblem`,
  `doorsOpenRangeMessage` (research R2); `packages/shared/src/time-zone.ts`: `formatDoorsOpen` as a
  documented alias of `formatEventEnd` (R9); export them from `index.ts`. T002 passes.
  **Done**: T002 passes (12); `index.ts` already re-exports both modules. `Event` and `EventInput`
  in `event.ts` gain optional `doorsOpenAt`/`entryOpensAt` (the hand-written mirror of the
  contract).

### The column

- [x] T004 New `backend/test/integration/migration.doors-open.e2e-spec.ts` (research R1, R15), in the
  style of `migration.time-zones.e2e-spec.ts`: a database migrated up to the migration before
  `doors_open`, with a scheduled future event, a scheduled past event, and a cancelled event; then the
  migration. Must fail (no migration):
  - every event's `doorsOpenAt` equals its `startsAt` minus exactly 1 hour (FR-024, SC-004);
  - the column is `NOT NULL` with no default;
  - raw `UPDATE`s setting `doorsOpenAt` to `startsAt + 1 second` and to `startsAt - 6 hours - 1
    second` fail with `event_doors_open_range`; `startsAt` and `startsAt - 6 hours` succeed;
  - `pg_get_constraintdef` of `event_doors_open_range` mentions `'06:00:00'` and agrees with
    `DOORS_OPEN_MAX_BEFORE_START_MINUTES` (R2).
  **Done**: 5 tests; all failed first on `expect(NEW_MIGRATION).toBeDefined()` (no migration).
- [x] T005 `backend/prisma/migrations/20261102000000_doors_open/migration.sql` exactly as research R1,
  with its comments; `backend/prisma/schema.prisma` `Event.doorsOpenAt` (data-model.md); `npm run
  prisma:generate --workspace @queuepass/backend`. Then every direct write of an event keeps the
  column valid (research R1): `backend/test/setup/fixtures.ts` `eventAroundNow` gains
  `doorsBeforeStartSeconds` (default 3600) and inserts `"doorsOpenAt"`; the raw insert and
  `prisma.event.create` in `venues.time-zone-change.e2e-spec.ts`; the two `prisma.event.create` in
  `events.concurrency.e2e-spec.ts`; and the three writes that move a start move `doorsOpenAt` by the
  same interval in the same statement: `orders.sales-closed.e2e-spec.ts` (the start moved into the
  past), `reservations.admin-changes.e2e-spec.ts` (the raw `UPDATE` before the sweep), and
  `entry.window.e2e-spec.ts` (the raw `UPDATE` inside the mocked `select`); and
  `migration.time-zones.e2e-spec.ts` leaves out `020`'s migration and every later one from its
  copy of `prisma/`, and its last insert gives `"doorsOpenAt"` (research R1). In the service, so the
  CHECK is never hit as a `500`: `EventsService.createLocked` sets `doorsOpenAt: startsAt - 60
  minutes`; `updateLocked` applies research R4's keep-the-gap rule when the start changes (`doorsOpenAt
  = stored doorsOpenAt + (new startsAt - stored startsAt)`); `moveEventsToZone` moves `doorsOpenAt` by
  the same interval as each event's start (T009 and T010 complete both). T004 passes; `npm run test
  --workspace @queuepass/backend` green apart from tests that are still to be written.
  **Done**: T004 passes. The first full run failed only `migration.time-zones` (6 tests, `23502` on
  its raw inserts: its copy of `prisma/` also deployed `doors_open`), a gap in research R1 fixed
  there and in this task's text; then the backend suite passed, 960 in 95 suites (97.05%).

**Checkpoint**: every event has a doors-open time; nothing visible has changed yet.

---

## Phase 3: User Story 1 - An Admin Sets When Doors Open (P1) 🎯 MVP

**Goal**: the Backend stores, defaults, keeps, and checks `doorsOpenAt`; the Admin form sets it.

**Independent Test**: spec US1's Independent Test; quickstart S1–S3.

### Tests first

- [x] T006 [P] [US1] New `backend/test/integration/events.doors-open.e2e-spec.ts` (research R4, R6,
  R15), every response validated against the contract. Must fail:
  - create without `doorsOpenAt` → `201`, `doorsOpenAt = startsAt - 1 h`, `entryOpensAt = startsAt -
    2 h`; with it at `startsAt` and at `startsAt - 6 h` → `201` as sent; `get` and `list` carry both;
  - create with it 6 h 1 min before, and 1 min after → `400 DOORS_OPEN_OUT_OF_RANGE`, the exact
    `doorsOpenRangeMessage`, `details` `{ field: 'doorsOpenAt', doorsOpenAt, startsAt, earliest,
    latest, timeZone }`, no row;
  - `doorsOpenAt` in `Z` at an Eastern venue → `400 UTC_OFFSET_MISMATCH` with `field: 'doorsOpenAt'`;
    at 2:30 AM on 2027-03-14 Eastern → `400 LOCAL_TIME_SKIPPED` with `field: 'doorsOpenAt'`; at 1:30
    AM on 2026-11-01 Eastern with each offset → the first or second moment (`020` FR-018);
  - refusal order: a bad `endsAt` offset and an out-of-range doors → the `endsAt` refusal; an
    out-of-range doors and a capacity above the venue → `DOORS_OPEN_OUT_OF_RANGE`;
  - update with only `startsAt` and `endsAt` 2 h later → doors 2 h later (gap kept, a 90-minute gap
    too); with only `doorsOpenAt` → checked against the stored start (in range `200`, out `400`);
    with `startsAt` and an out-of-range `doorsOpenAt` → `400`, nothing changed; a name-only update →
    doors unchanged; a move to a venue in another zone sending both times and no doors → doors keep
    the gap;
  - a cancelled event → `409 EVENT_CANCELLED` for a doors update, as today;
  - two events at one venue 1:00–4:00 PM and 5:00–8:00 PM, the second's doors at 3:00 PM → `201`
    (FR-006); the 60-minute rule's own tests (`events.buffer-boundary`, `events.conflict*`) pass
    unchanged.
  **Done**: 22 tests; all failed first (no `entryOpensAt`; `doorsOpenAt` refused by the whitelist as
  400). The 60-minute tests pass unchanged.
- [x] T007 [P] [US1] `backend/test/integration/venues.time-zone-change.e2e-spec.ts` and
  `backend/test/unit/venue-time-zone.spec.ts` (research R5). Must fail:
  - a zone change moves each event's `doorsOpenAt` to the same local time in the new zone;
  - an event in Arizona Time on 2027-03-14 at 3:30 AM with doors at 2:30 AM, changed to Central →
    `409 EVENT_TIME_NOT_IN_ZONE`, `field: 'doorsOpenAt'`, `reason: 'SKIPPED'`, the message "…'s
    doors-open time, Mar 14, 2027, 2:30 AM, doesn't exist in Central Time.", nothing saved;
  - repeated doors (fall-back night) → `reason: 'REPEATED'`;
  - an event in Arizona Time on 2027-11-07 from 6:30 AM, doors at 12:30 AM (6 hours), changed to
    Central, where clocks fall back at 2:00 AM that night (12:30 AM CDT to 6:30 AM CST is 7 hours) →
    `reason: 'DOORS_OUT_OF_RANGE'`, nothing saved.
  **Done**: 4 tests in the integration file (the unit file has no `moveEventsToZone` tests; it needs
  a database); `snapshot()` now also reads `doorsOpenAt`. All 4 failed first (doors refused by the
  DTO).
- [x] T008 [P] [US1] New `admin-app/test/event-doors-open.test.tsx` (research R4), with the stubbed
  API and a Central venue. Must fail:
  - New event: a **Doors open** field (label "Doors open"), before **Starts**, empty; typing a start
    of 2026-11-20T19:00 → Doors open `2026-11-20T18:00`; changing the start to 20:00 → 19:00; typing
    Doors open 17:30 then changing the start → stays 17:30;
  - Edit of an event stored with doors 90 minutes before a 7:00 PM start: Doors open shows 17:30;
    start to 20:00 → 18:30;
  - Doors open 12:59 with a 19:00 start, Create event → the range message (exactly
    `doorsOpenRangeMessage`) under the field and in the banner, values kept, **no** `POST /events`;
    19:01 → the same; 13:00 and 19:00 → sent; empty → "Enter when doors open.", nothing sent;
  - a skipped doors local time → `020`'s skipped message for Doors open; a repeated one → the
    occurrence question for Doors open, sent only once chosen;
  - the create body has `doorsOpenAt` with the venue's offset (`2026-11-20T17:30:00-06:00`); an edit
    body has it too;
  - a `400 DOORS_OPEN_OUT_OF_RANGE` from the Backend is shown in the error banner with every value
    kept.
  **Done**: 15 tests; all failed first ("Unable to find a label with the text of: Doors open"). The
  submit button is **Schedule event**, not "Create event".

### Implementation

- [x] T009 [US1] Backend (research R4, R6): `CreateEventDto` and `UpdateEventDto` gain optional
  `doorsOpenAt` (`@IsISO8601`, `@Matches(OFFSET_DATE_TIME)`, `needsOffset('doorsOpenAt')`);
  `event-time.ts` `EventTimeField` gains `'doorsOpenAt'`; `EventsService.createLocked` checks a sent
  `doorsOpenAt` after `endsAt` with `checkEventTime`, else defaults it, then
  `assertDoorsInRange(startsAt, doorsOpenAt, zone)` (throwing `400 DOORS_OPEN_OUT_OF_RANGE` with R2's
  details) before the capacity checks; `updateLocked` adds the rest of R4's rule to T005's gap (sent →
  checked against the start in force; start changed and not sent → same gap, from T005; else
  unchanged) and writes it;
  `toResponse` adds `entryOpensAt`. Update the doc comments (spec 025). T006 passes.
  **Done**: T006 passes (22). `EventResponse` gains `entryOpensAt`; `assertDoorsInRange` throws the
  R2 details. Backend 986 in 96 suites green.
- [x] T010 [US1] `backend/src/locations/venue-time-zone.ts` `moveEventsToZone` (research R5),
  replacing T005's interim same-interval move: select `doorsOpenAt`; move it with `at('doorsOpenAt')` (`FIELD_WORD` gains `doorsOpenAt:
  'doors-open time'`); after moving, `doorsOpenProblem` → `EVENT_TIME_NOT_IN_ZONE` with `reason:
  'DOORS_OUT_OF_RANGE'` and R5's message; write `doorsOpenAt` with the others. T007 passes; every
  other `venues.time-zone-change*` test passes with no change to its assertions. Two set-ups give
  doors at the start (research R5, found by the implementation): "Late A and Late B" and "the
  boundary pair" move Phoenix events starting at 3:00 and 3:29/3:30 AM on 2027-03-14 to Denver,
  where their default doors (2:00, 2:29, 2:30 AM) are skipped and would be refused first.
  **Done**: T007 passes; venues.time-zone* 103 green, with the two set-ups above (a gap found by the
  implementation, fixed in research R5 and here).
- [x] T011 [US1] `admin-app/src/pages/EventForm.tsx` (research R4): the `doorsOpenAt` field, its
  occurrence, `doorsTouched`, the gap, the follow rule, the checks before sending (empty, skipped,
  unchosen repeated, `doorsOpenProblem` → `doorsOpenRangeMessage`, shown under the field and in the
  banner), and `doorsOpenAt` in every payload. T008 passes.
  **Done**: T008 passes (15). The range note shows under the field as soon as both times name one
  moment, with `role="alert"` once a save was tried.
- [x] T012 [US1] Admin tests that assert an exact create or update body or fill the event form now
  include or fill Doors open, nothing else: `admin-app/test/event-form.tz.test.tsx`,
  `EventForm.conflict.test.tsx`, `event-seating-create.test.tsx`, `event-types-edit.test.tsx`, and any
  other the workspace's run names. `npm run test --workspace @queuepass/admin-app` and `npm run test
  --workspace @queuepass/backend` green.
  **Done**: `fixtures-005.ts` `EVENT` gains `doorsOpenAt`/`entryOpensAt` (start minus 1 and 2
  hours), which fixes every edit test using it (capacity, event-types-edit, images-field,
  ticket-limit); `event-form.tz.test.tsx` `editForm` gives an overridden start doors 1 hour before
  it, and its repeated-time choices are found within `startsAt-occurrence` (doors 1 hour before a
  1:30 AM EST start are the repeated 1:30 AM EDT, so the label appears twice). No assertion changed.
  Admin 350 in 41 files (97.24%); backend 986 in 96 (97.07%).

**Checkpoint**: US1 works on its own: quickstart S1–S3 pass in the browser.

---

## Phase 4: User Story 2 - Check-In Opens 1 Hour Before Doors (P1)

**Goal**: `[doorsOpenAt - 1 hour, endsAt)` for every kind of code.

**Independent Test**: spec US2's Independent Test.

### Tests first

- [x] T013 [P] [US2] `backend/test/integration/entry.window.e2e-spec.ts` (research R7): rewrite its
  `startsAt - 2 hours` boundaries to `doorsOpenAt - 1 hour`, and add events with doors 0 and 180
  minutes before the start (`eventAroundNow`'s `doorsBeforeStartSeconds`): for each, a lookup and an
  admit 30 seconds before `doorsOpenAt - 1 hour` → `NOT_OPEN` / `409 ENTRY_REFUSED` `NOT_OPEN` with
  `entryOpensAt = doorsOpenAt - 1 hour`, nothing recorded; 30 seconds after → `ADMITTABLE` /
  admitted. An event open for entry whose doors an update moves 2 hours later → the next lookup is
  `NOT_OPEN` with the new `entryOpensAt`; its already admitted ticket stays admitted. Must fail for the
  0- and 180-minute events (today's window is 2 hours before the start).
  **Done**: the two default-doors boundary tests renamed (same instants), 4 new boundary tests
  (doors 0 and 180 minutes) and the doors-moved test; 4 failed first (doors 0 minutes, 30 s after,
  already passed under the 2-hour rule, as expected). `entryOpensAt` is compared with the stored
  `doorsOpenAt` minus 1 hour.
- [x] T014 [P] [US2] `backend/test/integration/entry.live-boundaries.e2e-spec.ts`: a live code for a
  ticket of an event with doors 180 minutes before its start, 30 seconds before and after
  `doorsOpenAt - 1 hour` → `NOT_OPEN` then `ADMITTABLE` with `verifiedBy: LIVE_CODE` (FR-012). Must
  fail.
  **Done**: 2 tests; both failed first (NOT_OPEN was ADMITTABLE and back, on the 2-hour rule).
- [x] T015 [P] [US2] `entry.lookup.e2e-spec.ts`, `entry.live-code.e2e-spec.ts`, `entry-key.e2e-spec.ts`:
  every expectation of `entryOpensAt` becomes `doorsOpenAt - 1 hour` (the same instant for their
  default doors); add one lookup of an event with doors at the start whose `entryOpensAt` is 1 hour
  before the start. Must fail on that one.
  **Done**: `entry.lookup` and `entry.live-code` compare `entryOpensAt` with the stored doors minus
  1 hour (`entry-key` has no `entryOpensAt`); the new doors-at-start lookup failed first.

### Implementation

- [x] T016 [US2] `backend/src/entry/ticket-state.ts`: the exported `entryOpens` fragment (research
  R7) with `ENTRY_OPENS_BEFORE_DOORS_MINUTES`; `stateCase` uses it; `entry.service.ts` `tryAdmit` and
  `select` use it; doc comments say spec 025. No `'2 hours'` left in `backend/src`. T013–T015 pass;
  `entry.concurrency`, `entry.live-race`, and every other entry test pass with no change to their
  assertions (`entry.window`'s retry test passes because T005 made its mocked `UPDATE` shift
  `doorsOpenAt` with the start).
  **Done**: T013–T015 pass; every entry test passes (82 in the entry files), backend 994 in 96
  suites. The fragment needs `::int` on the minutes parameter (else 500: `make_interval` with an
  untyped parameter), now in research R7. The only "2 hours" left in `backend/src` is the doc
  comment naming what 025 replaced.

**Checkpoint**: the window is enforced; quickstart S4's API steps pass.

---

## Phase 5: User Story 3 - The Ticket Booth Lists What Is Coming (P1)

**Goal**: greyed, not-choosable events with "Opens …"; a 30-second refresh; the remembered choice
only when open.

**Independent Test**: spec US3's Independent Test; quickstart S5.

### Tests first

- [x] T017 [US3] New `booth-app/test/event-picker.test.tsx` (research R8), with Vitest's fake timers
  and the stubbed `listEvents`; events carry `entryOpensAt`. Must fail:
  - an open event is a button "{name} · {start}"; a not-open one is not a button
    (no button whose name starts with its name), and its item reads "{name} · {start}",
    "Not open yet", and "Opens 4:30 PM EST" when that is today in the venue's zone, or "Opens Nov 21,
    2026, 11:00 AM EST" otherwise (system time set with `vi.setSystemTime`);
  - Tab reaches open events only;
  - advancing 30 seconds past its `entryOpensAt` makes it a button without a reload, and
    `listEvents` was called again; a list response in which an admin moved doors earlier makes it a
    button at the next tick; a failed refetch keeps the list;
  - a remembered id (`sessionStorage`) of a not-open event is not restored and is removed; of an open
    one, restored as today;
  - "No event is open for entry yet." when every listed event is not open; "No event is open for
    entry." when none is listed;
  - **Change event** fetches the list again;
  - an event without `entryOpensAt` is a button (today's behavior).
  Update `booth-app/test/app.test.tsx` and `check-in.test.tsx` fixtures to carry `entryOpensAt` in
  the past where they choose an event.
  **Done**: `booth-app/test/event-picker.test.tsx`, 11 tests with fake timers; 8 failed first (the 3
  that passed describe behavior kept from 017: an event without `entryOpensAt`, an open remembered
  choice, the empty list). Tab order is checked as the page's buttons (Log out and the open event
  only) and no focusable element in a waiting item. `check-in.test.tsx` and `scanner.test.tsx` give
  Demo Tonight `entryOpensAt` an hour ago; `app.test.tsx` lists no event, so it needs none.

### Implementation

- [x] T018 [US3] `booth-app/src/EventPicker.tsx` and `booth-app/src/App.tsx` per research R8:
  `forTheGate(events, now)`, the waiting item, the two messages, the 30-second interval (refetch and
  `now`), the restore rule, the refetch on **Change event**; doc comments say spec 025. T017 passes.
  **Done**: T017 passes; booth 87 tests green. `openForEntry` is replaced by `forTheGate`; the list
  effect runs while no event is chosen, so Change event refetches by clearing the choice (no
  `reloads` bump needed); the interval is cleared on choosing and on unmount.
- [x] T019 [US3] `booth-app/src/styles.css`: `.event-choice--waiting` with theme tokens only
  (muted text, dashed border, the same size as a choice); the shared theme's drift test and the
  Booth's theme test pass. Check at 360 px that nothing scrolls sideways (record here).
  **Done**: theme tokens only; the shared theme suites (drift included) pass, 330. The 360 px check
  needs the running stack (the Booth shows the list only after Keycloak sign-in), which this machine
  cannot build: left for the walk (quickstart S9); the item has no fixed width and wraps
  (`overflow-wrap: anywhere`).

**Checkpoint**: quickstart S5 passes in the browser.

---

## Phase 6: User Story 4 - Customers and Admins See When Doors Open (P2)

**Goal**: **Doors open** next to the start in the five places.

**Independent Test**: spec US4's Independent Test; quickstart S6.

### Tests first

- [x] T020 [P] [US4] `backend/test/integration/me-orders.e2e-spec.ts`: each order's `event` has
  `doorsOpenAt`, validated against the contract. Must fail.
  **Done**: 1 test (every response is contract-checked by the customer client); failed first
  (`doorsOpenAt` undefined).
- [x] T021 [P] [US4] New `customer-app/test/doors-open.test.tsx` and an added case in
  `admin-app/test/EventDetail.test.tsx` (research R9): the event card, the event page, My tickets,
  and the printed ticket (Customer) and the event page (Admin) show a "Doors open" term before
  "Starts", "5:30 PM EST" on the start's date, "Nov 19, 2026, 11:30 PM EST" the day before, and
  nothing for a response without `doorsOpenAt`; a cancelled event still shows it. Must fail.
  **Done**: `customer-app/test/doors-open.test.tsx` (14: the four places × same day, day before,
  none; cancelled page and card) and 4 cases in `admin-app/test/EventDetail.test.tsx`; the 12
  showing doors failed first ("Doors open" term not found), the "nothing without it" cases passed
  (nothing to show yet).

### Implementation

- [x] T022 [US4] `backend/src/orders/orders.service.ts` `mine()`: `event.doorsOpenAt`. T020 passes.
  **Done**: T020 passes; `MyOrderResponse.event` gains `doorsOpenAt`; the shared `OrderEvent` gains
  optional `doorsOpenAt`.
- [x] T023 [US4] The five views (research R9) with `formatDoorsOpen`. T021 passes; the Customer
  app's `theme-classes` and phone-width tests pass.
  **Done**: a `doorsOpen()` helper beside `when()` in each app's `format.ts` (over
  `formatDoorsOpen`, venue zone or the default); the five views show the pair only when
  `doorsOpenAt` is sent. T021 passes; customer 322 (97.51%), admin 354 (97.25%), `theme-classes` and
  phone-width tests included.

---

## Phase 7: Demo data, and the contract's required lists

- [x] T024 `backend/test/integration/demo-data.e2e-spec.ts`: every demo event has `doorsOpenAt =
  startsAt - 1 hour`, and "Demo Tonight" is open for entry when loaded (`entryOpensAt` before now)
  (research R11). Passes with no change to `demo-data.ts`; if it does not, fix the data, not the test.
  **Done**: one new test, passing with no change to `demo-data.ts`; the existing "Demo Tonight open"
  test's SQL now states the window as `doorsOpenAt - 1 hour` (same instant for default doors).
- [x] T025 `contracts/openapi.yaml` 1.17.1 (research R6, contracts/README.md): `Event.required`
  gains `doorsOpenAt` and `entryOpensAt`, `OrderEvent.required` gains `doorsOpenAt`; their
  descriptions lose "not listed as required …" and say "Required from 1.17.1"; `npm run generate:api`;
  `node scripts/check-contract-drift.mjs` passes; the Backend's contract tests pass (every event and
  order response now has them).
  **Done**: 1.17.1; `npm run generate:api`; the drift check passes; backend 996 in 96 suites green
  with every event and order response validated against the new required lists; the four apps and
  `e2e` type-check.

---

## Phase 8: Browser tests (Constitution VI)

- [x] T026 [P] `e2e/fixtures/api.ts`: `EventSetup` gains optional `doorsOpenAt: Date`, sent with
  `zoned(…, venue.timeZone)` when given (research R10).
  **Done**: done; `e2e/fixtures/time.ts` gains `localDateOf(instant, zone)` for T029.
- [x] T027 [P] `e2e/tests/017-check-in.spec.ts`: the header comment's "from 2 hours before the
  start" becomes "from 1 hour before doors open, which default to 1 hour before the start (spec 025)";
  nothing else.
  **Done**: the header comment only.
- [x] T028 `e2e/tests/025-doors-open.spec.ts`, test `'025 S1/S2/S6: an admin sets when doors open,
  and customers see it'` exactly as research R10 item 1; record `POST /events` with
  `page.on('request')` and assert none while the range message shows, then exactly one whose
  `doorsOpenAt` is `zoned(atLocal('{day}T17:30', zone), zone)`. Every expected time, abbreviation,
  and offset is built with `e2e/fixtures/time.ts`, never written out, so the test passes in standard
  and daylight time.
  **Done**: written as research R10 item 1; `npx tsc -p e2e/tsconfig.json` and ESLint clean. Not run
  here: no Playwright browsers and no Compose images on this machine (image builds fail on TLS); to
  run in CI (`e2e` check).
- [x] T029 Same file, test `'025 S4/S5: the Ticket Booth works an event only from an hour before its
  doors open'` exactly as research R10 item 2, its "Opens {when}" built by FR-015's today-or-date
  rule (add `localDateOf(instant, zone)` to `e2e/fixtures/time.ts` if needed).
  **Done**: written as research R10 item 2 (agent slot 1, customer slot 4); type-checks. To run in
  CI, as T028.
- [ ] T030 See each `025` test fail once against a deliberate break, then restore it (as `022`
  T031): T028 with the form's prefill removed; T029 with `forTheGate` treating every event as open.
  Record both failures (the assertion that failed) here.
  **Left for the orchestrator**: the deliberate breaks need `npm run e2e`, which cannot run on this
  machine (no stack images, no Playwright browsers); run them where the stack runs and record the
  failing assertions here.
- [x] T031 `specs/025-doors-open/quickstart.md` Automation table: rows S1, S2, S4, S5, S6 exactly as
  research R12 lists them (S0, S3, S7–S10 unchanged), and the paragraph above the table loses its
  "On the spec branch …" sentence. `node scripts/check-quickstart-marks.mjs` passes.
  **Done**: rows S1, S2, S4, S5, S6 as research R12; the "On the spec branch …" sentence removed;
  `node scripts/check-quickstart-marks.mjs` passes (24 quickstarts).

---

## Phase 9: Polish & cross-cutting

- [x] T032 [P] `README.md` (research R14): the features table's `025` row (spec link, "Every event
  has a doors-open time, set by admins (1 hour before the start by default, up to 6 hours before);
  customers and admins see it; check-in opens 1 hour before doors, and the Ticket Booth greys out
  events not open yet", "Draft", "Done (N/41 tasks)", the code status); the `017` row's check-in
  wording if it names the 2-hour window; the Status paragraph names `025`; the check-in and Ticket
  Booth sections of "What the system does". `npx prettier --check README.md`.
  **Done**: the `025` row ("Done (35/41 tasks)", "Built (review pending)"), the Status paragraph,
  the feature summary, the demo-data note on Demo Tonight's window, and the Gate check-in section
  (the greyed list and the window). The `017` row names no window, so it is unchanged. `npx prettier
  --check README.md` passes.
- [x] T033 [P] Search for the old rule in user-facing text and comments: `rg -n "2 hours|two hours|interval '2"`
  over `backend/src/`, `booth-app/src/`, `customer-app/src/`, `admin-app/src/`, `e2e/`, `README.md`,
  `contracts/openapi.yaml`. Each hit is updated to the new rule, or is a record (specs `017`, `018`,
  the contract's "until feature 025" wording) and is listed here with why it stays.
  **Done**: the hits left are records: `README.md` "starts within the next 2 hours" (still true with
  default doors, and the note now says so) and "events from before `025` keep their window of 2
  hours before the start"; the contract's "until feature 025, `[startsAt - 2 hours, endsAt)`" and
  "until then, 2 hours before its start"; `ticket-state.ts`'s doc comment naming what 025 replaced.
  `reservations.service.ts`'s `interval '2 minutes'` is another rule. Nothing in `booth-app/src`,
  `customer-app/src`, `admin-app/src`, or `e2e/`.
- [x] T034 [P] Confirm `specs/017-gate-check-in/{spec,quickstart}.md` and
  `specs/018-rotating-qr-codes/{spec,quickstart}.md` carry the "Superseded in part by `025`" note and
  that its requirement and scenario numbers match what was built; fix the note only.
  **Done**: all four notes present; their requirement and scenario numbers (017 FR-007, FR-011,
  FR-019, the Entry window assumption, S0, S3, S6; 018 FR-005, FR-011, S0) match what was built. No
  change.
- [x] T035 Coverage: every workspace stays at or above 80% line coverage; the new form branches
  (follow, touched, the four checks) and the picker's waiting item have no untested branch; record
  each workspace's figure here.
  **Done**: after tests for the last form and picker branches (repeated doors to the second
  occurrence, a cleared start, an edit without `doorsOpenAt`, a waiting event with no zone): shared
  93.27%, backend 97.08%, admin-app 97.31%, customer-app 97.51%, booth-app 93.08%, seed 100%. Each
  suite green 3 times before the rebase onto `origin/main` (shared 693, backend 996 in 96 suites,
  admin 354, customer 322, booth 87, seed 91 + 20 skipped) and 3 times after it (`npm run ci` and
  two more rounds: shared 747, backend 996, admin 359, customer 326, booth 91, seed 91 + 20 skipped;
  the new counts are 026's spec-PR tests). `npm run test:tz` (four zones): every run passed except
  `reports-export.test.tsx` "names the signed-in admin as made by" (`023`, untouched here), which
  timed out on its XLSX save in 3 of 8 admin-app runs under load and passes alone in Los Angeles 3
  of 3.
- [x] T036 `npx tsc --noEmit -p e2e` and `npm run lint` clean for the new and changed files.
  **Done**: `npx tsc -p e2e/tsconfig.json` clean; `eslint . --ignore-pattern ".claude/**"` clean
  (the root `eslint .` also scans an untracked `.claude/worktrees/` from another session, so `npm
  run lint` fails on this machine for that reason only); `npm run format:check` clean.
- [ ] T037 `npm run e2e` locally, green: every test, `025`'s two included; record the count and time
  here; the stack left stopped.
  **Left for the orchestrator**: `npm run e2e` cannot run on this machine (images do not build
  behind TLS interception; no Playwright browsers); to run in CI and record here.
- [ ] T038 Independent review by a separate Claude session (Constitution III) of the branch against
  spec, plan, research, and contract 1.16.0/1.17.1; fix the findings, tests first where a finding is
  a defect; record the round here (counts by severity, each fix, and any finding left open with the
  reason).
  **Left for the orchestrator**: the independent review by a separate session.
- [ ] T039 `npm run ci` locally green after the review's fixes and the latest merge of `origin/main`;
  record the counts per workspace and the coverage figures.
  **Left for the orchestrator** (after the review's fixes). Run so far, on the branch rebased onto
  `origin/main` c87837a (`026`'s spec PR, contract 1.17.0, so this branch ships **1.17.1**): the
  root `npm run ci` steps green in 7 min 22 s with lint ignoring `.claude/**`: scripts/test 75,
  shared 747, backend 996 in 96 suites, admin 359, customer 326, booth 91, seed 91 + 20 skipped;
  coverage as T035.
- [ ] T040 Running-system walk, quickstart S0–S10, on a stack built from this branch, with S7 on a
  volume that `main` created first. Mahdi walks it (S9 needs VoiceOver); record each scenario's
  result as he reports it; his "pass" closes the walk.
  **Left for the orchestrator**: Mahdi's walk.
- [ ] T041 Push; open the implementation PR after the spec PR has merged and the branch is rebased
  onto `main`: its description says `fixes #91` on its own line and carries the review (T038), the
  counts and coverage (T039), the browser tests and their deliberate failures (T030, T037), and the
  walk (T040). CI green on GitHub (the `test` and `e2e` checks); merge when green and approved by
  every team member (shared surface: `backend/prisma/`, `packages/shared/`, `contracts/openapi.yaml`).
  **Left for the orchestrator**: push, PR, CI on GitHub.

---

## Dependencies & Execution Order

- T001 → Foundational (T002 → T003; T004 → T005) → US1 (T006, T007, T008 in parallel → T009 → T010;
  T011 after T003 → T012) → US2 (T013, T014, T015 in parallel → T016) → US3 (T017 → T018 → T019) →
  US4 (T020, T021 in parallel → T022, T023) → T024, T025 → browser tests (T026, T027 in parallel →
  T028, T029 → T030 → T031) → polish (T032–T034 in parallel; T035–T037; T038 → T039 → T040 → T041).
- US2 needs only the column (T005), not US1's service work, and may run beside it; US3 needs
  `entryOpensAt` in responses (T009); US4's Backend part needs the column only.
- T025 needs every response to carry the new fields: after T009 and T022.

## Parallel Examples

- US1's tests: T006 (`events.doors-open.e2e-spec.ts`), T007 (zone change), T008 (Admin form).
- US2's tests: T013 (`entry.window`), T014 (`entry.live-boundaries`), T015 (the other entry files).
- US4's tests: T020 (`me-orders`) and T021 (Customer and Admin views).
- Polish: T032 (README), T033 (search), T034 (the notes).

## Implementation Strategy

- **MVP**: T001–T012: every event has a doors-open time that admins set (US1), the first item of
  #91.
- Then US2 (the window; the issue's rule), US3 (the Booth), US4 (display), the required lists, the
  browser tests, and the polish.
- Each story's checkpoint is a quickstart walk of its scenarios; the full walk (T040) is Mahdi's.
