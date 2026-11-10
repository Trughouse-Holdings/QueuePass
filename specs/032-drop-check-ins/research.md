# Research: Drop Check-in Details a Week After the Event

**Feature**: `032-drop-check-ins` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-09

The issue (#129) and its comment settle the job, the 7 days, and that counts are kept. Every decision
below that they leave open takes the recommended option and records the alternatives, for Mahdi and
the team to overturn in review of the spec PR. Code references are to `main` at `10bd53f`.

## R1. What is stored today, and who reads it

**Findings** (read-only inspection):

- `backend/prisma/schema.prisma`, `Ticket`: `checkedInAt` (spec `005`), `checkedInBySub` and
  `checkedInByUsername` (spec `017` research R3, migration `20261022210000_gate_check_in`).
- One CHECK ties them: `ticket_entry_agent`: both agent columns null, or both set **and**
  `checkedInAt` set. An admission time with no agent is allowed (pre-`017` demo check-ins). Setting all
  three to NULL together satisfies it, so **no constraint changes** for the removal.
- Writers: `EntryService.tryAdmit` (the one `UPDATE … RETURNING`, `backend/src/entry/entry.service.ts`)
  and the demo data (`backend/src/scripts/demo-data.ts`, `demo-agent1` / `agent1`).
- Readers of `checkedInAt`: the entry state `CASE` (`backend/src/entry/ticket-state.ts`, `USED`), the
  lookup and refusal (`usedAt`), `entryKey` (`getTicketEntryKey`, refuses a used ticket), `alreadyUsed` (whole-order
  admit), `toOrderResponse` (`Ticket.checkedInAt` in `listAttendees`, `listMyOrders`), the sales
  report's `groupBy` (`backend/src/reports/reports.service.ts`), the demo reset's removed count (`029`).
- Readers of `checkedInBySub` / `checkedInByUsername`: **none**. They are written and never read,
  returned, or shown.
- Front ends: Admin `pages/Attendees.tsx` (summary count, per-order "n of m checked in", per-ticket "✓
  checked in ⟨time⟩"), `components/SalesCard.tsx` and `pages/Reports.tsx` (`checkedIn` from the
  report), `export/attendee-rows.ts` ("Checked in" date-time column), `export/sales-rows.ts` (counts);
  Customer `pages/MyTickets.tsx` ("Used ⟨time⟩", links only while unused) and `pages/PrintTicket.tsx`
  (refuses a used ticket); Ticket Booth `usedAt` in refusals only.

**Decision**: remove all three columns' values (spec FR-002). Nothing reads the agent columns, so
removing them changes no screen; removing `checkedInAt` changes the readers above, each handled below.

## R2. Holder names: dropped with the details

**Decision**: the comment's first option. Only per-event counts survive the cutoff; nothing records
which ticket or order entered. Names on orders (`Order.holderName`, `017`) stay: they are what was
bought, for the gate's ID check, and the issue is about check-in.

**Alternatives**: the second option, keep a per-ticket "entered" flag with the names and drop only the
agent and the time. It keeps exactly "who walked through the door", which the issue calls personal data
with no purpose, and it would keep `USED` working at the gate, which nothing needs after the window.

## R3. The constant and the cutoff

**Decision**: `export const CHECK_IN_RETENTION_DAYS = 7;` in `packages/shared/src/event.ts`, beside
`ENTRY_OPENS_BEFORE_DOORS_MINUTES` (`025`), exported from `@queuepass/shared`. The Backend's job and the
Admin app's sentence both import it. The cutoff is `endsAt + CHECK_IN_RETENTION_DAYS × 24 h`, compared
as instants (UTC); due when `cutoff <= now` (half-open, Constitution "Time").

**Why the Backend's clock, not the database's `now()`**: the job compares against the Backend's
injected `CLOCK` (`backend/src/common/clock.ts`, spec `018` R3; `030` uses it for "past"), passed to
`removeDue(now)`. Tests set `FakeClock` to the exact minute (`endsAt + 7 d − 1 min`, `endsAt + 7 d`),
which the issue asks for; with `now()` a test can only approach the boundary. The entry window stays on
the database's `now()` (`017` R5); the two never meet, a week apart.

**Alternatives**: an environment variable (an unused configuration surface, Principle VIII; the issue
asks for a constant); calendar days in the venue's zone (adds zone arithmetic for an hour nobody sees).

## R4. Keeping the count: two columns on `Event`

**Decision**: `Event.checkInDetailsRemovedAt TIMESTAMPTZ NULL` and `Event.keptCheckedInCount INTEGER
NULL`, written in the same transaction that empties the tickets. The count is `count(*)` of the event's
tickets with `status = 'VALID' AND checkedInAt IS NOT NULL` at that moment: exactly the figure the
report shows today, so the report is unchanged (SC-004).

**The report** (`ReportsService.sales`): per event, `checkedIn` =
- `0` when the event is `CANCELLED` (as today: its tickets are void),
- else `keptCheckedInCount` when `checkInDetailsRemovedAt` is set,
- else the live count, as today.
Totals add these. Each row gains `checkInDetailsRemovedAt`.

**Per tier**: not kept (spec Clarifications). Adding it later needs a `TicketTier` column and a new
report field; an untiered event's tickets have `tierId` NULL, so it would need an event-level remainder
too.

**Alternatives**: a separate `EventCheckInSummary` table (one more relation for two values); computing
the count from an audit log (there is none); not keeping counts (refused by the comment).

## R5. The job: `CheckInRetention`, shaped like the hold sweeper

**Decision**: `backend/src/entry/check-in-retention.ts`, a provider of `EntryModule` (which already
provides `CLOCK`), modelled on `backend/src/reservations/hold-sweeper.ts`:

- `CHECK_IN_RETENTION_INTERVAL_MS` (a `Symbol` provider, `3_600_000` in `EntryModule`).
- **Started only by the HTTP Backend** (spec FR-006, SC-007): `start()` runs once right away (not
  awaited, errors logged), then arms `setInterval`; `onModuleDestroy()` clears it. `backend/src/main.ts`
  calls `app.get(CheckInRetention).start()` after `app.listen(…)`. There is **no lifecycle hook** that
  runs it: the demo data (`backend/src/scripts/demo-data.ts`, `main()`) and the demo reset
  (`demo-reset.ts`, `main()`) build the whole `AppModule` with `NestFactory.createApplicationContext`,
  which calls every `onModuleInit` and `onApplicationBootstrap`, so a hook would run a removal inside
  "reset to demo", racing its `TRUNCATE` and `app.close()` (CI's e2e harness runs the reset on every
  pull request). `createTestApp` never calls `start()`, so tests need no override either.
  **Why not an interval of 0 in the scripts**: `createApplicationContext(AppModule)` cannot override a
  provider, so the scripts would need an environment variable or a second module, a configuration
  surface for one case (Principle VIII); one call in `main.ts`, the only entry point that serves the
  API, keeps every other entry point out by construction. A Backend unit test reads the sources and
  fails if `start()` on `CheckInRetention` is called anywhere but `src/main.ts` (R11).
- `removeDue(now = new Date(this.clock.now())): Promise<{ eventIds: string[] }>`: guarded by a
  `running` flag like `sweepOnce`. The bound is computed in JavaScript, in exact hours (R3), never with
  SQL interval arithmetic (`timestamptz + interval 'N days'` adds calendar days in the session's zone,
  an hour off across a daylight-saving change):
  ```ts
  const bound = new Date(now.getTime() - CHECK_IN_RETENTION_DAYS * 86_400_000);
  ```
  ```sql
  SELECT "id" FROM "Event"
  WHERE "checkInDetailsRemovedAt" IS NULL AND "endsAt" <= ${bound}
  ORDER BY "endsAt", "id"
  ```
  then calls `removeEvent(id, now)` for each; one event failing never holds up the others (logged, as
  in `sweepOnce`).
- `removeEvent(eventId, now): Promise<boolean>` (public, so tests can run it twice at once), in its own
  `$transaction(…, LOCKING_TX)`:
  1. `lockEvent(tx, id)` (`backend/src/common/event-lock.ts`, `SELECT … FOR UPDATE`): every event
     write, `updateLocked` and `cancel` included, takes it, so the removal and a time edit or a
     cancellation run one at a time (Constitution IV: a row lock).
  2. Re-read `endsAt` and `checkInDetailsRemovedAt` under the lock and apply the same test, `endsAt <=
     bound` with the bound computed from `now` in JavaScript as above; return `false` if removed
     meanwhile or no longer due (its end moved later). FR-005.
  3. `count` as R4.
  4. `UPDATE "Ticket" SET "checkedInAt" = NULL, "checkedInBySub" = NULL, "checkedInByUsername" = NULL
     WHERE "eventId" = $id AND ("checkedInAt" IS NOT NULL OR "checkedInBySub" IS NOT NULL)`.
  5. `UPDATE "Event" SET "checkInDetailsRemovedAt" = $now, "keptCheckedInCount" = $count`; return
     `true`.
  `removeDue` returns the ids removed (for tests and one log line: "Removed check-in details of N
  events").
- A deleted event (404 from `lockEvent`) is skipped.

The due query reads `Event` only; at proof-of-concept size (tens of events) no index is needed. An
event without tickets is marked too (count 0), so the rule and the sentence are uniform.

**Alternatives**: `@nestjs/schedule` cron (a new dependency for one timer; the hold sweeper shows the
pattern); a database job (`pg_cron` is not in the image); running only at startup (the Compose stack
runs for days); daily (lag up to a day; hourly costs one query an hour); `onApplicationBootstrap` or
`onModuleInit` (they run inside the demo commands, above); an interval of 0 in the scripts (above).

## R6. Entry after removal, and why a removed event's times are locked

**Findings**: `stateCase` orders `VOID, OTHER_EVENT, USED, NOT_OPEN, ENDED`; `tryAdmit` requires
`checkedInAt IS NULL AND now() >= entryOpens AND now() < endsAt`. The Ticket Booth lists only events
whose window has not closed (`025`). `updateLocked` (`events.service.ts`) lets an admin change any
scheduled event's times, past ones included, and the Admin form sends `startsAt`, `endsAt`, and
`doorsOpenAt` on every save (`admin-app/src/pages/EventForm.tsx`, `sent`).

**Consequence**: after removal, a used ticket looks unused. With the end fixed in the past, no admit
can match (`now() < endsAt` is false for 7 days already). If the end could move into the future, a used
ticket would be admittable again, and the event on sale again (sales close at `startsAt`, `006`).

**Decision**: in `updateLocked`, **after `doorsOpenAt` is resolved and before the capacity checks
and `assertNoConflict`**: if `existing.checkInDetailsRemovedAt` is set and the resolved `startsAt`,
`endsAt`, or `doorsOpenAt` differs (by instant) from the stored one, throw `409 CHECK_IN_DETAILS_REMOVED` with `details:
{ removedAt }` and the message "The check-in details of ⟨name⟩ were removed on ⟨date⟩, so its times can
no longer change." (the date in the venue's zone, as `020` words its other refusals; the instant
in `details.removedAt`). Sending the same instants passes, so the
form's save of a renamed event works. A venue move is a time change only if a time changes (a move to
another zone must send both times, `020`, which then must equal the stored instants).

**Which error wins**: the checks that run before it in `updateLocked` still come first, so a request
that is also malformed gets their `400` (`endsAt` not after `startsAt`, a time not in the venue's zone,
a skipped local time, a wrong offset, doors out of range, a zone move without both times), and a
cancelled event its `409 EVENT_CANCELLED`; this `409` comes before `CAPACITY_EXCEEDED`,
`maxTicketsPerCustomer`'s `400`, and `SCHEDULING_CONFLICT`. A test pins one case each way (R11).

**The venue time-zone change** (`backend/src/locations/venue-time-zone.ts`, `020` and `024`) moves the
instants of a venue's events to keep their local times, without `updateLocked`, and is refused when
any of them has orders (`TIME_ZONE_HAS_ORDERS`). A removed event it moves therefore has no orders and
no tickets, and still ended more than a week before (zones differ by hours), so nothing can be
admitted or sold. It is left as is and named as the one exception in spec FR-008.

**Overrides `030`**: `030`'s edge case "an event moved later … brings it back into the lists" does not
apply to a removed event (spec FR-008; R10).

No other change to entry: a lookup with a removed event as gate answers `ENDED` (unused) as for any
ended event; `getTicketEntryKey` hands out a key for a valid ticket of a removed event (was `USED`), whose
codes the gate refuses as `ENDED`. Both are recorded in the spec's Edge Cases; neither is reachable from
the apps. **Decided: `getTicketEntryKey` is not changed to refuse it** (review round 1, N9): a refusal
would add an `ENDED` reason to `018`'s operation in the contract, and a test, for a key that opens
nothing; it already hands out keys for unused tickets of any ended event (`030` Out of scope).

**Alternatives**: add `AND e."checkInDetailsRemovedAt" IS NULL` to `tryAdmit` and a `REMOVED` state to
the CASE (a second guard for a state the lock already prevents, and a new refusal reason in the
contract); a CHECK `checkInDetailsRemovedAt >= endsAt + interval '7 days'` (puts the constant in SQL, so
changing it needs a migration, against the issue's "easy to change"; the row lock already serialises
the only writers); allowing the move and clearing the removal (the details are gone; nothing to
restore).

## R7. The Admin app

**Decision**:

- A shared helper `removedNote(removedAt, timeZone)` in `admin-app/src/format.ts`: "Check-in details
  removed on Nov 10, 2026 (kept for 7 days after the event)." The date by `Intl.DateTimeFormat('en-US',
  { dateStyle: 'medium', timeZone })`; "7" from `CHECK_IN_RETENTION_DAYS`.
- **Attendees** (`pages/Attendees.tsx`): when `event.checkInDetailsRemovedAt` is set, the sentence as a
  `<p className="note">` under the title; the summary's "K checked in" reads the kept count from the
  sales report row (`getSalesReport()`, fetched only for a removed event, as `SalesCard` does; if it
  fails the summary leaves the checked-in part out); no "✓ checked in" per ticket; the per-order cell
  reads "—" in place of "n of m checked in".
- **Sales card**: the count as today (the report already holds the kept count) and the sentence under
  it when the row's `checkInDetailsRemovedAt` is set.
- **Reports**: in the event's "Checked in" cell, the count, then on its own line the sentence's short
  form "Details removed Nov 10, 2026" (a `<span className="note">`); the totals stat unchanged.
- **Edit form**: a `409 CHECK_IN_DETAILS_REMOVED` is shown as the form's error banner with the
  Backend's message, values kept (Constitution IV).

**Why the attendee count comes from the report**: `Event` is returned to every role; the count is an
admin figure and is already in the admin-only report.

## R8. Exports (spec `023`)

**Decision**: `attendeeTable(event, orders, madeAt, madeBy, adminZone, keptCheckedIn?)`: for a removed
event every row's "Checked in" cell is an empty date-time (as for a void ticket today), and the subtitle
gains, after the made lines, the sentence plus "K tickets were checked in." (left out when the count
could not be read). The column stays, so a file's columns never depend on the date it was made.
`salesTable` is unchanged: its counts are the report's (R4).

**Alternatives**: drop the column (files change shape after a week); a text "Removed" in a date-time
column (breaks XLSX typing, `023` R5).

## R9. The Customer app

**Decision**: `OrderEvent` (the event summary on `MyOrder`) gains `checkInDetailsRemovedAt`. In
`pages/MyTickets.tsx`, `ticketState` returns "Event over" for a valid ticket when it is set; the "Show
entry code" and "Print ticket" links appear only for a valid, unused ticket of an event not removed.
`pages/PrintTicket.tsx` refuses such a ticket as it refuses a used one ("This ticket can't be
printed."). Without it, a used ticket would read "Valid" and offer a printable ticket a week later.

**Amends `030` FR-016 for removed events**: `030` keeps a past ticket's state and its printable
ticket under Past. After removal a used ticket can no longer truthfully show "Used", and printing it
would present it as unused, so for a removed event's valid tickets "Event over" and no printable
ticket replace that (spec FR-014). Before removal `030` FR-016 holds unchanged, and `030`'s Past
section, its order, and its other rules are untouched. Decided by the orchestrating session on Mahdi's
standing approval (review round 1, M2); a dated note in `specs/030-hide-past-events/spec.md` points
here.

## R10. Other specs

- **`029` (demo checkpoint, merged)**: the demo data writes check-ins on Fall Concert (14 days ahead)
  and nothing on Season Opener (7 days before the run, no tickets). Season Opener reaches its cutoff at
  its own end + 7 days, the run's local date at 10:00 PM, and is then marked removed (count 0); nothing
  in `029`'s tests asserts its new columns, and `createTestApp` never starts the job. The demo data and
  demo reset commands never run it (R5), so a reset never removes anything as a side effect. The e2e stack's Backend
  runs the job; `029 S2`'s browser test checks the Customer app's "Sales closed" and the Ticket Booth,
  which this feature does not change. The demo reset's `TRUNCATE` covers the new columns (they are on
  `Event`). `demo-reset.e2e-spec.ts`'s fingerprint: T011 checks it ignores or compares the new columns
  consistently (both null after a reset).
- **`030` (merged spec, implementation pending)**: Attendees, Sales, and Reports stay reachable for past
  events, where this feature's sentence appears. **Two amendments, for removed events only**, noted
  in `030`'s spec with the date and a pointer here: FR-016 (a Past ticket keeps its state and its
  printable ticket) is replaced by spec FR-014 ("Event over", no printable ticket; R9); and its edge
  case "an event moved later … brings it back" no longer applies, since a removed event's times cannot
  change (spec FR-008; R6). Whichever implementation lands second (`030`'s or `032`'s) builds on the
  other's My tickets.
- **`031` (open, `031-atomic-event-create-spec`)**: changes `EventsService.create`; this feature changes
  `updateLocked` and `toResponse`. Different functions in one file; whichever merges second rebases.
  Its contract `1.23.0` and constitution `3.9.3` precede this branch's `1.24.0` and `3.9.4`.
- **`028` (realms, merged)**: agent subjects written before it belong to the retired realm; nothing
  reads them; removed at each event's cutoff.

## R11. Tests (Constitution VI)

Backend (Jest, Testcontainers PostgreSQL, `createTestApp`, `FakeClock`):

- `check-in-retention.e2e-spec.ts` (new): an event E ended at a fixed `endsAt`, tickets admitted by
  direct update (`checkedInAt`, sub, username; one with time only, as pre-`017`), one void ticket with
  an admission time; a second event F ending later, a third G not ended:
  - clock at `E.endsAt + 7 d − 1 min`: `removeDue()` removes nothing; every row equal.
  - clock at `E.endsAt + 7 d`: E's tickets have all three NULL; E has `checkInDetailsRemovedAt` = the
    clock and `keptCheckedInCount` = its valid admitted tickets; F's and G's tickets and events equal.
  - a second `removeDue()` at `+ 8 d`: every row equal (removal instant unchanged).
  - a cancelled event past its cutoff: removed, kept count 0.
  - an event with no tickets past its cutoff: marked, count 0.
  - an end moved later before the cutoff: not removed at the old cutoff, removed at the new.
  - two removals of one event at once: `removeEvent(E, now)` twice with `Promise.all` (the `running`
    flag guards only `removeDue`, so both reach the lock): exactly one returns `true`, and E's removal
    instant and count are those of one removal; and, separately, a second `CheckInRetention` instance's
    `removeDue()` beside the first's, with the same result.
  - the bound in exact hours across a daylight-saving change: `endsAt` 2026-10-31T23:00Z (the week holds
    the US fall-back of 2026-11-01): kept at `endsAt + 7 × 86 400 000 ms − 1 min`, removed at `endsAt +
    7 × 86 400 000 ms`, with the session's zone set to `America/New_York` for the test (`SET TIME
    ZONE`), where SQL calendar-day arithmetic would differ by an hour.
  - the sales report deep-equal before and after E's removal, but `generatedAt` and E's
    `checkInDetailsRemovedAt`; E cancelled after removal: `checkedIn` 0.
  - `start()` runs once at once (a due event is removed without calling `removeDue`, polled for at most
    2 s) and arms the timer; `app.close()` clears it.
  - **never in the demo commands** (SC-007): with a due event that has check-ins, an application
    context built as the demo scripts build it (`NestFactory.createApplicationContext(AppModule)`
    against the test database, `init()` called), then `runDemoData(app)`, leaves that event's
    check-ins and its NULL removal columns untouched.
- `backend/test/unit/check-in-retention-start.spec.ts` (new): reads every `.ts` under `backend/src`
  and fails if `CheckInRetention`'s `start()` is called from any file but `src/main.ts`, or if
  `main.ts` does not call it.
- `check-in-retention.constraints.e2e-spec.ts` (new): raw SQL: removal instant without count, count
  without instant, and a negative count each fail with `event_check_ins_removed_together`.
- `events.check-ins-removed.e2e-spec.ts` (new): on a removed event, `PATCH` changing `startsAt`,
  `endsAt`, or `doorsOpenAt` → `409 CHECK_IN_DETAILS_REMOVED` with `details.removedAt`, nothing
  changed; `PATCH` with the same three instants and a new name → `200`; a not-removed event's times
  change as before. Precedence (R6): a removed event with `endsAt` before `startsAt` → `400`; a removed
  event with a changed `endsAt` and a capacity below its sold tickets → `409 CHECK_IN_DETAILS_REMOVED`.
  Responses match the contract (`expectToMatchContract`).
- Existing `reports.e2e-spec.ts`, `attendees.e2e-spec.ts`, `me-orders.e2e-spec.ts`: the new nullable
  fields are `null`; contract conformance covers their shapes.

Admin app (Vitest + RTL): Attendees, SalesCard, Reports, EventForm 409, `attendeeTable`, and
`salesTable` with a removed event and one not removed. Customer app: MyTickets and PrintTicket with a
removed event. No browser test: a removal needs a week to pass or the database written directly, which
the e2e harness does not do (quickstart Automation).

## R12. Constitution, contract, and README

Constitution 3.9.4 (PATCH): roadmap row `032`, on top of `031`'s 3.9.3 (unmerged); rebased once it
merges. Contract 1.24.0 (MINOR): new response fields and one new error code (contracts/README.md), on
top of `031`'s 1.23.0; `packages/shared/src/api-schema.ts` regenerated. README: the `032` status row and
version reference (this PR); a "Check-in retention" paragraph in the implementation PR.
