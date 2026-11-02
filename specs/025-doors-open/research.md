# Research: Doors Open

**Feature**: `025-doors-open` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-02

R1, R2, R7, and R8 carry the decisions Mahdi took on #91 (Clarifications, "decided by Mahdi"). Every
other decision takes the recommended option and records the alternatives, for the team to overturn
in review of the spec PR.

## R1. Storage: one `doorsOpenAt` column, backfilled, then `NOT NULL`

**Decision** (decided by Mahdi, items 1, 2, 4): `Event` gains `doorsOpenAt timestamptz(6) NOT NULL`
(Prisma `doorsOpenAt DateTime @db.Timestamptz(6)`), an instant like `startsAt` and `endsAt`
(Constitution, Time). One migration, `backend/prisma/migrations/20261102000000_doors_open/migration.sql`:

```sql
ALTER TABLE "Event" ADD COLUMN "doorsOpenAt" TIMESTAMPTZ(6);
-- Spec 025 FR-024 (decided by Mahdi): every existing event, scheduled or cancelled, past or future,
-- opens its doors 1 hour before its start, so its check-in window stays [startsAt - 2 hours, endsAt).
UPDATE "Event" SET "doorsOpenAt" = "startsAt" - interval '1 hour';
ALTER TABLE "Event" ALTER COLUMN "doorsOpenAt" SET NOT NULL;
-- Spec 025 FR-004, FR-005 (research R2): no more than 6 hours before the start, and not after it.
ALTER TABLE "Event" ADD CONSTRAINT "event_doors_open_range"
  CHECK ("doorsOpenAt" <= "startsAt" AND "doorsOpenAt" >= "startsAt" - interval '6 hours');
```

No column default: a default cannot refer to `startsAt`, and a constant one would be wrong. Only the
Backend decides the value (R6), as `020` did for a venue's zone. No index: nothing filters on it
(the Booth filters the event list it already fetches, R8).

Every direct write of an event outside `EventsService` into a database at the latest migration
must now keep the column valid, all in Backend tests, updated in the implementation (tasks T005):

- **Inserts** must give it: `backend/test/setup/fixtures.ts` `eventAroundNow` (gains an optional
  `doorsBeforeStartSeconds`, default 3600, so every existing caller keeps today's window), the raw
  insert and the `prisma.event.create` of `backend/test/integration/venues.time-zone-change.e2e-spec.ts`,
  and the two `prisma.event.create` of `backend/test/integration/events.concurrency.e2e-spec.ts`.
- **Updates that move `startsAt`** must move `doorsOpenAt` by the same interval, or the CHECK
  refuses them once the start passes the doors: `orders.sales-closed.e2e-spec.ts` (the
  `prisma.event.update` that moves the start 1 minute into the past, "as if the hour had passed"),
  `reservations.admin-changes.e2e-spec.ts` (the raw `UPDATE "Event" SET "startsAt" = now() -
  interval '1 minute'` before the sweep), and `entry.window.e2e-spec.ts` (the raw `UPDATE` inside the
  mocked `select` that shifts `startsAt` and `endsAt` 1 minute earlier to open the window between the
  admit's `UPDATE` and its re-read: with the window on doors it must shift `doorsOpenAt` too, or the
  window never opens and the retry test fails). Each sets `"doorsOpenAt"` in the same statement
  (`"doorsOpenAt" = "doorsOpenAt" - interval '1 minute'`, or, for an absolute new start, the new
  start minus the event's gap). An implementer finding another such write applies the same rule.
- `backend/test/integration/migration.time-zones.e2e-spec.ts` (found by the implementation): its
  copy of `prisma/` leaves out only `020`'s migration, so its first deploy also applied every later
  one, `doors_open` included, and its raw inserts then failed `NOT NULL`. Its copy now leaves out
  `020`'s migration **and every later one**, so the inserts run on the database as it was before
  `020` and the second deploy backfills them; its last insert ("still refuses an overlapping
  insert at once"), which runs after every migration, gives `"doorsOpenAt"`.

The same task also gives `EventsService.updateLocked` R4's keep-the-gap rule for an update that moves
the start without sending doors (the rest of R4, sent doors and their checks, comes with US1), and
`moveEventsToZone` an interim rule moving doors by the same interval as the start (R5's local-time
rule replaces it in US1): without them an edit or a zone change that moves a start earlier than its
stored doors would hit the CHECK as a `500`, and the suite would not be green after the migration.

**Rationale**: FR-001, FR-024. A required column says "every event has one" in the place no caller
can bypass. Backfilling with `startsAt - 1 hour` keeps every existing window (SC-004).

**Alternatives considered**: a nullable column meaning "start minus 1 hour" (two rules for one
time, and every reader must apply the default); storing a gap in minutes instead of an instant (every
time in the system is an instant shown in the venue's zone, `020`; an offset of minutes would be the
one exception, and the zone-change rule, R5, keeps local times, not gaps); a trigger filling it in
(hidden behavior, and Prisma's types would still require it).

## R2. The range, in the database and the Backend, with one message

**Decision** (decided by Mahdi, item 3):

- **Database**: the `event_doors_open_range` CHECK (R1). A single-row rule, so a CHECK guarantees
  it under any concurrency (Constitution IV): no write, from any path, can store doors outside the
  range.
- **Backend**: `EventsService` checks the range after the time-zone checks (R6's refusal order) and
  refuses with `400 DOORS_OPEN_OUT_OF_RANGE` before writing, so the CHECK is never what an admin
  sees. Details: `{ field: 'doorsOpenAt', doorsOpenAt, startsAt, earliest, latest, timeZone }`, the
  instants in UTC like every response.
- **One message**, made by a new shared helper in `packages/shared/src/event.ts`, used by the
  Backend and the Admin form (as `skippedTimeMessage` is, `020` R9):
  `doorsOpenRangeMessage(startsAt, zone)` → "Doors must open no more than 6 hours before the start
  and not after it: between Nov 20, 2026, 1:00 PM EST and 7:00 PM EST." (the earliest with
  `formatEventTime`, the latest with `formatEventEnd(earliest, latest, zone)`, so the date is
  repeated only when the range crosses midnight).
- **Constants**, in the same file: `DOORS_OPEN_MAX_BEFORE_START_MINUTES = 360`,
  `DEFAULT_DOORS_BEFORE_START_MINUTES = 60`, `ENTRY_OPENS_BEFORE_DOORS_MINUTES = 60`, and
  `doorsOpenProblem(startsAt, doorsOpenAt)` → `'TOO_EARLY' | 'AFTER_START' | null`, the one
  function both sides call. The migration's SQL states the same numbers; a Backend integration test
  reads the constraint's definition from `pg_constraint` and fails if it differs from the constants
  (as `time-zone-lists.spec.ts` does for the zone CHECK, `020`).

Both ends are inclusive (FR-004): `doorsOpenAt = startsAt` and `doorsOpenAt = startsAt - 6 hours`
are allowed. Elapsed time, not wall-clock time (spec Assumptions).

**Rationale**: FR-004, FR-005, Constitution IV (Backend first for the message, database as the
guarantee).

**Alternatives considered**: refusing with `VALIDATION_FAILED` and a field message (an admin form and
a test can't tell this rule from a malformed time; every other rule with its own meaning has its own
code); only a CHECK, mapped from the database error (the message could not name the range in the
venue's local time).

## R3. Doors-open is not part of the 60-minute rule

**Decision** (recommended, open to review): `event_no_overlap`, `queuepass_event_window`, the
service's pre-check, and the zone change's FR-012 check stay on `startsAt` and `endsAt` only. No
check that doors open after the venue's previous event ends.

**Rationale**: FR-006. The issue does not ask for it, and `002`'s buffer already stands for set-up
and teardown. Counting doors (up to 6 hours) would make the venue look busy for an afternoon before
every evening event, and would make the same two events conflict or not depending on a time customers
rarely care about. The consequence (spec Edge Cases): an event's check-in can open while the venue's
previous event is still on; the admin sets doors later when the venue can't do that.

**Alternatives considered**: widening the exclusion window to `[doorsOpenAt - 60 min, endsAt)`
(above, and a change to `002`'s rule that every scheduling test pins); refusing doors before the
previous event's end (a cross-row rule needing the venue lock on every doors change, for a case no
one has reported).

## R4. Edits: doors keep their gap to the start unless sent

**Decision** (recommended, open to review):

- **Backend** (`EventsService.updateLocked`): the start in force after the update is `startsAt`
  (sent, else stored). Then: `doorsOpenAt` sent → checked against it (R6); not sent and the start
  changed → `existing.doorsOpenAt + (startsAt - existing.startsAt)`, the same gap, so it is always in
  range and needs no check; neither → unchanged. A move to another venue that sends both times
  (`020` FR-019) follows the same rule; doors-open is not required in it.
- **Create** (`createLocked`): `doorsOpenAt` sent → checked; not sent → `startsAt - 60 minutes`
  (`DEFAULT_DOORS_BEFORE_START_MINUTES`).
- **Admin form** (`admin-app/src/pages/EventForm.tsx`): a third time field, `doorsOpenAt`, with the
  same local string, zone line, skipped message, and repeated-time choice as the start and end (`020`
  R13), labelled **Doors open**, placed before **Starts**. A `doorsTouched` flag, false on load,
  becomes true when the admin changes the Doors open field (typing, or its repeated-time choice).
  While it is false, every change of the start that resolves to one moment (`ok`, or `repeated` with
  its occurrence chosen) sets Doors open to `newStartInstant - gap`, where `gap` is 60 minutes on a
  new event and `storedStart - storedDoors` on an edit; the instant is turned back into the venue's
  local string (`toLocalDateTime`) and, when that local time is repeated, its occurrence is set from
  the instant's own offset (as the edit form already does on load, `020` review round 2, m1). A
  change of venue keeps the typed local strings (`020` FR-015), Doors open included. The form sends
  `doorsOpenAt` on every create and every edit, like `startsAt` and `endsAt`, with the venue's
  offset (`toOffsetDateTime`).
- **Form checks before sending** (FR-005), after the start and end checks and with their banner: an
  empty Doors open → "Enter when doors open."; skipped or unchosen repeated → `020`'s messages; out of
  range → `doorsOpenRangeMessage`. Also shown under the field as soon as both times resolve, so the
  admin sees it while typing (a `field__hint` with `role="alert"` only on submit, as `024` R1).

**Rationale**: FR-002, FR-003, FR-007, FR-008. Keeping the gap is what an admin moving a show by an
hour expects, and in the API it means an edit that worked before this feature (a start moved alone,
as the browser tests' and Backend tests' callers do) still works. Instants, not local clock times,
so the gap is real elapsed time and never lands on a skipped local time.

**Alternatives considered**: keep the stored doors and refuse an out-of-range result (a start moved
by more than 6 hours, or past the doors, would be refused for a field the caller did not send);
reset doors to start minus 1 hour on every start change (loses an admin's 90-minute doors silently);
in the form, always follow the start even after the admin typed doors (overwrites their input).

## R5. A venue's zone change keeps doors' local time

**Decision** (recommended, open to review): `moveEventsToZone` (`backend/src/locations/venue-time-zone.ts`)
treats `doorsOpenAt` as a third field next to `startsAt` and `endsAt`: it keeps its local date and
time. Every refusal is `409 EVENT_TIME_NOT_IN_ZONE` with `details.field: 'doorsOpenAt'` and the
message word "doors-open time" (`FIELD_WORD`), and one `details.reason` from a single list:

| `reason` | When | Since |
| --- | --- | --- |
| `SKIPPED` | the local time does not exist in the new zone | `020` |
| `REPEATED` | the local time happens twice in the new zone | `020` |
| `OUT_OF_RANGE` | the local time is from before standard time, so no whole-minute offset states it (the time itself can't be placed) | `#88` |
| `DOORS_OUT_OF_RANGE` | the doors-open time can be placed, but once moved it is more than 6 hours before the moved start, or after it (a daylight-saving change between them in one zone only: for example doors 6 hours before the start in Arizona Time, moved to Central Time across the fall-back night, where the same local times are 7 hours apart) | `025` |

The first three apply to `startsAt`, `endsAt`, and `doorsOpenAt` alike; the last only to
`doorsOpenAt`, checked after the three are moved, with the message "Can't change the time zone:
{name}'s doors-open time, {local}, would be more than 6 hours before its start in {zone}." (or
"after its start"). All before any write, so nothing is saved; the CHECK is the guarantee if this
check were wrong. The contract's `updateLocation` description lists the four in one sentence.

An existing `020` test whose event starts less than an hour after a skipped hour in the new zone now
meets the doors refusal first, since its default doors (start minus 1 hour) fall in that hour; such
a test's set-up gives doors at the start, and its assertions stay (SC-007; found by the
implementation: two in `venues.time-zone-change.e2e-spec.ts`, tasks T010).

**Rationale**: FR-009, `020` FR-009 (local times are what the admin entered). A zone change is
already refused once any event has an order (`020` FR-010), so this touches only unsold events.

**Alternatives considered**: keep the gap instead of the local time (then doors and start would
follow different rules in one change); a new error code (the existing one already means "an event's
time can't move to the new zone"; one more `reason` keeps clients' handling in one place).

## R6. The API: `doorsOpenAt` and `entryOpensAt`; contract 1.16.0

**Decision** (recommended, open to review; contracts/README.md):

- `Event` gains `doorsOpenAt` (stored) and `entryOpensAt` (`doorsOpenAt - 60 minutes`, set in
  `EventsService.toResponse`, so every event response has it: list, get, create, update, cancel).
  `OrderEvent` (My tickets) gains `doorsOpenAt` (`OrdersService.mine`). Names mirror `startsAt` and
  `EntryTicket.entryOpensAt`.
- `EventInput.doorsOpenAt` and `EventUpdate.doorsOpenAt`: optional `date-time`, stated like
  `startsAt` (the venue's local time and offset, `020`). Left out: R4's defaults; `null` is
  treated as left out (`@IsOptional`, as for every other optional field; review M5). The Admin app
  always sends it (the "required" of Mahdi's item 2 is the form's and the database's, not the
  API's): the demo-data script (`backend/src/scripts/demo-data.ts`), the browser tests' `createEvent`, and every
  Backend test that schedules an event keep working unchanged, as `024` R2 kept `timeZone` optional.
- **Refusal order** on create and update: request shape; unknown venue; `startsAt`, `endsAt`, then
  `doorsOpenAt` against the venue's zone (`LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH`, with
  `details.field: doorsOpenAt`; `checkEventTime`'s `EventTimeField` gains `'doorsOpenAt'`); then
  `DOORS_OPEN_OUT_OF_RANGE`; then capacity, the limit, and the scheduling conflict, as today. The
  existing `endsAt must be later than startsAt` check (`assertWindowOrdered`) keeps its place:
  it runs first, before the venue lookup and every zone check, on the instants as sent (create) or
  in force (update), so a request with the end before the start is refused for that before any
  doors-open check.
- **New code** `DOORS_OPEN_OUT_OF_RANGE` (`400`, in the `EventTimeRejected` response), added to
  `ErrorEnvelope.code` and to `packages/shared/src/errors.ts`'s `ERROR_CODES` in this PR, after
  `UTC_OFFSET_MISMATCH` (the Backend's list test fails when they differ).
- **main stays green** (`020` R18): the three new response properties are documented as always sent
  but **not** in `required` in 1.16.0, because the Backend on `main` does not send them until the
  implementation merges and the contract tests validate responses. New request properties are
  optional. No new operation, so no `x-planned` marker. **The implementation PR** moves
  `Event.doorsOpenAt`, `Event.entryOpensAt`, and `OrderEvent.doorsOpenAt` into `required` and sets
  **1.17.1** (not 1.16.1: `026`'s spec PR took 1.17.0 on `main` first, `026` research R13), in the
  same PR that makes the Backend send them, so no follow-up issue is left (the
  gap `#88` closed for `020`).
- **Minor version** 1.15.0 → 1.16.0: new properties, a new refusal, and a narrower window for
  `lookupEntryTicket` and `admitTicket` (their descriptions), one minor per feature (`013` R11,
  `020` R18, `024` R5).

**Rationale**: FR-001, FR-007, FR-008, FR-010, FR-016, Constitution I and VIII.

**Alternatives considered**: `doorsOpenAt` required in `EventInput` (breaks the demo data, the
browser tests' set-up, and dozens of Backend tests for no gain to an admin; a caller that does not
know about doors gets the same window as before); no `entryOpensAt` on `Event` (the Booth would have
to know "1 hour before doors", a second copy of the rule, R8); a `doorsOpenOffsetMinutes` field (R1).

## R7. The entry window: one SQL fragment, one constant

**Decision** (decided by Mahdi, item 5): in `backend/src/entry/`, the window becomes
`[doorsOpenAt - 1 hour, endsAt)` on the database's `now()` (`017` R5 unchanged otherwise). The three
places that say `e."startsAt" - interval '2 hours'` today (`ticket-state.ts` `stateCase`,
`entry.service.ts` `tryAdmit`'s `WHERE`, and `select`'s `"entryOpensAt"`) use one exported fragment,
`entryOpens = Prisma.sql\`(e."doorsOpenAt" - make_interval(mins => ${ENTRY_OPENS_BEFORE_DOORS_MINUTES}::int))\``
in `ticket-state.ts` (the `::int` cast is needed: a bare parameter fails `make_interval`, found by the
implementation), with the constant from `@queuepass/shared` (R2), so the SQL, `Event.entryOpensAt`
(R6), and the contract say the same thing. Typed codes, printed codes, and live codes all go through
`select` and `tryAdmit`, so FR-012 needs no live-code change (`018`'s own 30-second window and grace
are untouched).

**Under concurrency** (FR-013): the admit is still the one `UPDATE … RETURNING` of `017` R4, with the
window in its `WHERE`. An event update that moves doors commits either before the admit's statement
starts (the admit sees the new doors) or after (the admit is ordered before the change); no entry is
ever recorded outside the window as it stood when its statement ran. The lookup and the refusal read
use the same `now()` per statement, as today; `017`'s one retry for NOT_OPEN → ADMITTABLE stays.

**Tests** (Constitution VI, boundaries on both sides): events placed relative to the database's
`now()` with doors 0, 60, and 180 minutes before the start, each 30 seconds before and after
`doorsOpenAt - 1 hour`, for a typed-code lookup, an admit, and a live-code lookup; `entryOpensAt` in
the lookup and in `ENTRY_REFUSED`'s details equals `doorsOpenAt - 1 hour`; an event whose doors move
later while it is open is refused at the next lookup; the existing `[startsAt - 2 hours]` boundary
tests are rewritten to doors (their events get doors at start minus 1 hour, so the instants are the
same).

**Alternatives considered**: a computed `entryOpensAt` column (a stored copy of a rule; a `GENERATED`
column would work but adds a column the CHECK already constrains); keeping the window in
application code (two clocks, `017` R5).

## R8. The Ticket Booth list: greyed, with "Opens …", re-checked every 30 seconds

**Decision** (decided by Mahdi, item 6; the mechanism recommended, open to review), in
`booth-app/src/EventPicker.tsx` and `booth-app/src/App.tsx`:

- `openForEntry(events)` becomes `forTheGate(events, now)`: scheduled events not ended, soonest start
  first, each `{ event, open: entryOpensAt <= now }`; an event without `entryOpensAt` (a Backend
  before this feature) counts as open, today's behavior.
- An open event is today's button. A not-open one is **not a button**: an item with the event's name
  and start, the words "Not open yet", and "Opens {when}" (`event-choice--waiting`, theme values only,
  muted text and a dashed border, so the state is in words and shape, not color alone, `017` FR-023).
  Not focusable, not clickable; a screen reader reads it as text in the list. `{when}` is
  `formatTimeOfDay(entryOpensAt, zone)` when `localDate(entryOpensAt, zone) === localDate(now, zone)`,
  else `formatEventTime(entryOpensAt, zone)` (FR-015).
- While the picker is shown, an interval (cleared on unmount) every 30 seconds sets `now` from the
  device's clock and fetches the list again, so an event becomes a button within 30 seconds of its
  window opening, and a doors-open time an admin moved meanwhile is picked up (SC-005). A failed
  refetch keeps the list shown and tries again at the next tick; only a failed first load shows
  today's "Can't reach QueuePass right now" with **Try again**. A `401` on any fetch, the first or a
  refetch, signs in again as today's code does (the session expired; the remembered choice is kept
  per tab, so the agent comes back to the same screen); "a failed refetch" means a network error or
  any other non-2xx. The list is also fetched after
  **Change event** (new: `changeEvent` bumps `reloads`).
- The remembered choice (`savedEventId`) is restored only when its event is in the list and open;
  otherwise the stored id is cleared and the picker is shown (FR-017).
- When the list is not empty but nothing is open: "No event is open for entry yet." above it; when
  empty: "No event is open for entry." as today (FR-018).
- Once chosen, the event stays chosen until **Change event** or sign-out, as today; a later NOT_OPEN
  refusal shows "Entry opens at …" as today (`EntryResult`).

**Rationale**: FR-014 to FR-018. The Booth never works out the rule (it reads `entryOpensAt`), and
the device clock only greys items out; every lookup and admit is decided on the database's clock
(FR-013). One `listEvents` call per Booth screen every 30 seconds while nobody has chosen an event
is negligible for 30 gate agents.

**Alternatives considered**: hiding not-open events (Mahdi chose to show them); a disabled button
(still in the tab order in some browsers' accessibility trees and reads as a control that does
nothing); a Backend filter (`listEvents?openForEntry=true`, a new parameter to hide what Mahdi wants
shown); syncing to the Backend's clock with the live-code key's `serverTime` (only a ticket owner can
read it; the Backend refuses outside the window anyway).

## R9. Where doors-open is shown, and how

**Decision** (decided by Mahdi, item 7; the places recommended, open to review): a **Doors open**
`dt`/`dd` pair before **Starts** in each `dl` that shows the start: Customer
`components/EventCard.tsx`, `pages/EventDetail.tsx`, `pages/MyTickets.tsx` (from `OrderEvent`), and
`pages/PrintTicket.tsx`; Admin `pages/EventDetail.tsx`. The value is
`formatEventEnd(startsAt, doorsOpenAt, zone)`, which already shows the time alone when the local date
matches the start's and the full date and time otherwise (FR-021; a shared alias
`formatDoorsOpen = formatEventEnd` with its own doc comment, so the call reads right). A response
without `doorsOpenAt` (a Backend before this feature) shows nothing for it.

Not shown: the Admin event list (its columns stay), reports and their exports (`023`), the calendar
entry (`019`, start to end), the Booth (it shows when check-in opens, R8).

**Rationale**: FR-019 to FR-021. My tickets and the printed ticket are what a customer looks at on
the day.

## R10. Browser tests: one file, two tests

**Decision**: `025`'s implementation PR opens after `022`'s merged, so it adds browser tests for its
main journey (Constitution VI). One file, `e2e/tests/025-doors-open.spec.ts`, two tests (titles
exactly):

1. `025 S1/S2/S6: an admin sets when doors open, and customers see it` — set-up through the API: a
   venue (`createVenue`, `PLACES.chicago`). As `adminFor(testInfo)`: New event, the venue, a start 3
   days ahead at 7:00 PM local; **Expected**: Doors open shows 6:00 PM that day. Change Doors open to
   5:30 PM; Doors open 12:30 PM shows the range message and sends no `POST /events` (request listener,
   as `024 V1/V2/V3`); back to 5:30 PM; save; the event page's Doors open reads "5:30 PM CST". Edit:
   start to 8:00 PM; Doors open shows 6:30 PM; save. As a customer (`customerFor`), the event's card
   and page show "Doors open" "6:30 PM CST".
2. `025 S4/S5: the Ticket Booth works an event only from an hour before its doors open` — set-up
   through the API: event A starting in 1 hour (doors left out: start minus 1 hour, so check-in opened
   an hour ago) and event B, at a second venue, starting in 5 hours with `doorsOpenAt` start minus 1 hour
   (check-in opens in 3 hours). As `agentFor`: A is a button; B's item says "Not open yet" and
   "Opens {when}", where `{when}` follows FR-015's rule, built with `e2e/fixtures/time.ts`: with
   `opens = doorsOpenAt - 1 hour`, `timeOfDay(opens, zone)` when the venue's local date of `opens`
   equals `localDate(zone)` (today there; a small `localDateOf(instant, zone)` helper beside
   `localDate` gives the first), else `eventTime(opens, zone)` (a run late in the
   evening opens after local midnight); no time or abbreviation is written in the test; B is
   not a button (`getByRole('button', { name: … B … })` has count 0); choose A; look up a ticket of A
   bought through the API: admittable.

`e2e/fixtures/api.ts` `EventSetup` gains an optional `doorsOpenAt: Date`, sent with `zoned()` when
given. `e2e/tests/017-check-in.spec.ts` keeps its test and title; its header comment changes from
"from 2 hours before the start" to "from 1 hour before doors open, which default to 1 hour before the
start".

**Not automated, and why** (the quickstart's Automation table): the window boundaries to the second
and live codes (Backend tests; a live code needs the customer's device); waiting for a window to open
in the Booth (a 30-second wait on a real clock; the Booth's Vitest tests move a fake clock); the venue
zone change and daylight-saving cases (Backend and Admin tests); keyboard, screen reader, phone width,
dark mode, printing (by a person).

## R11. Demo data, seed, and other callers: unchanged

**Decision**: no change to `backend/src/scripts/demo-data.ts` or `scripts/seed/`. Demo events are
created through `EventsService.create` without `doorsOpenAt`, so they get the start minus 1 hour;
"Demo Tonight" starts 1 hour after loading, so its doors are at load time and its check-in opened an
hour before: open at once, as `017` FR-006 requires. The `demo-data.e2e-spec.ts` test gains one
assertion that every demo event has doors at its start minus 1 hour.

**Rationale**: Constitution VIII. A demo event with other doors would show nothing the Admin form
cannot.

## R12. The Automation table on the spec branch

**Decision**: as `024` R11. `scripts/check-quickstart-marks.mjs` fails on an `Automated` row whose
test does not exist, so on this branch every row of [quickstart.md](./quickstart.md)'s table is
`Manual:` with its reason; S1, S2, S4, S5, and S6 name the test that will automate them. The
implementation PR, with the tests, changes those rows to exactly:

| Scenario | Browser test |
| --- | --- |
| S1 | Automated: `025 S1/S2/S6: an admin sets when doors open, and customers see it`; rest Manual: the skipped and repeated local times, covered by the Admin app's tests |
| S2 | Automated: `025 S1/S2/S6: an admin sets when doors open, and customers see it` |
| S4 | Automated: `025 S4/S5: the Ticket Booth works an event only from an hour before its doors open`; rest Manual: the boundary to the second and live codes, covered by Backend tests |
| S5 | Automated: `025 S4/S5: the Ticket Booth works an event only from an hour before its doors open`; rest Manual: an event becoming choosable when its window opens, covered by the Booth's tests with a fake clock |
| S6 | Automated: `025 S1/S2/S6: an admin sets when doors open, and customers see it`; rest Manual: My tickets and the printed ticket, by a person |

## R13. Notes on `017`'s and `018`'s specs and quickstarts

**Decision**: as `024` R12. A "**Superseded in part by `025`**" paragraph under the **Issue** line of
`specs/017-gate-check-in/spec.md` and `specs/018-rotating-qr-codes/spec.md` (spec commit), and one
line at the top of their `quickstart.md` files (plan commit): `017` S0 ("create an event that starts
within 2 hours") and `018` S0 say the same, which still works with default doors but no
longer explains why. Nothing else in those files changes. `020` is extended, not superseded (its rules
now also apply to doors), so it gets no note.

## R14. Constitution 3.6.2; README

**Decision**: a PATCH amendment in this PR, as `024`'s 3.6.1: the roadmap row `025-doors-open` (#91,
depends on `017`, `018`, `020`), the next free number `026`, the Sync Impact Report replaced, the
README's version reference. The `017` and `018` rows are not reworded (`024` R13). The README's
features table gains the `025` row in the implementation PR, with the status paragraph and the
check-in and Booth text, as `024` R14 did (tasks T032).

## R15. Testing

**Decision** (Constitution VI, written first and seen to fail):

- **Shared** (Vitest): `doorsOpenProblem` at 6 h, 6 h + 1 min, 0, and 1 minute after; the message for
  a range within one date and one crossing midnight; `formatDoorsOpen`.
- **Backend** (Jest, Testcontainers PostgreSQL): the migration (existing rows get start minus 1 hour,
  cancelled and past ones too; the CHECK refuses both sides; the constraint matches the constants);
  create and update (default; sent at both ends; out of range both sides with the exact message and
  details; skipped and wrong-offset doors with `field: doorsOpenAt`; the gap kept on a start-only
  edit, a venue move with both times, and a doors-only edit checked against the stored start; a
  cancelled event still refused as cancelled; responses validated against the contract with
  `doorsOpenAt` and `entryOpensAt`); the zone change (doors moved with local time; skipped, repeated,
  and out-of-range doors refused with nothing saved); the entry window (R7's boundaries for typed and
  live codes, `entryOpensAt` in lookup and refusal); My tickets' `doorsOpenAt`; demo data.
- **Admin app** (Vitest, RTL): the field, its prefill and following, the touched rule, the checks and
  messages, the body sent, the event page.
- **Customer app**: the four places. **Booth app**: the list with a fake clock (greyed, "Opens", a
  date when not today, becoming a button after 30 seconds, the refetch every 30 seconds and after
  Change event, a failed refetch keeping the list, the remembered choice, the two empty messages).
- **Browser tests**: R10.
