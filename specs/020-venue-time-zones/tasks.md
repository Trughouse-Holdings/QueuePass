---
description: "Task list for Venue Time Zones"
---

# Tasks: Venue Time Zones

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.12.0, already applied),
[quickstart.md](./quickstart.md)

**Issue**: [#42](https://github.com/Trughouse-Holdings/QueuePass/issues/42). The implementation PR
says `fixes #42`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `020-venue-time-zones-impl`, in a Claude
  session that starts from these files only. While the spec PR is open, cut it from
  `020-venue-time-zones-spec`, carry in any change its review makes, and rebase onto `main` once it
  merges; do not open the implementation PR before then. A gap in the spec or plan is fixed there,
  not worked around in code.
- **Do not change the contract** (1.12.0, or 1.13.0 if `019`'s spec PR merged first; types
  regenerated; the five codes already in `ERROR_CODES`). There is no `x-planned` marker to remove:
  this feature adds no operation. Raise any gap. The `required` lists are tightened in a separate
  PR after merge (T055).
- **Always send the new fields**: `Location.timeZone` and `timeZoneSource` on every venue and
  embedded venue; `timeZone` on `OrderEvent.location`, `EventSales`, `EntryTicket.event`, and
  `ENTRY_REFUSED`'s `details.event`. They are optional in the contract only so the plan PR could
  merge with `main` green (research R18).
- **Instants never move** except through a zone change of a venue with no orders (FR-027, R8).
  Responses keep sending UTC.
- **One time module**: every conversion and every formatted event time goes through
  `packages/shared/src/time-zone.ts` (R11). No `toLocaleString`, `toLocaleDateString`,
  `toLocaleTimeString`, `getTimezoneOffset`, `new Date(y, m, d)`, or `new Date('<local, no
  offset>')` in app code for event times; T045 greps for them.
- **No date library** (R11). The only new dependency is `geo-tz` 8.1.10 in `backend` (R1).
- **Lock order**: venue, then event. Event writes take the venue row `FOR SHARE` first (R10); a zone
  change takes `lockVenueAndEvents` (R8).
- **Device zones in tests**: never pin `TZ` in a Vitest or Jest config; set it only through
  `scripts/test-tz.mjs` (R20). On Windows, `TZ=… npm test` in Git Bash does **not** reach Node;
  use `npm run test:tz` or PowerShell's `$env:TZ`.
- **Testing several times** (Mahdi, 2026-10-24), all recorded in this file with dates and numbers:
  1. **At least two independent review rounds** (T047, T048), each by a Claude session that did
     not write the code; keep going with further rounds until a round finds only minor issues.
     Constitution III requires one; Mahdi requires two.
  2. **Every affected workspace's suite three times in a row**, after the last code change, with
     results recorded (T050): `packages/shared`, `backend`, `admin-app`, `customer-app`,
     `booth-app`, and the root `scripts/test`.
  3. **The time tests and the apps' suites under four device zones** (America/New_York, UTC,
     America/Los_Angeles, Pacific/Honolulu) with `npm run test:tz` (T050); CI reruns the time
     tests in America/Los_Angeles on every run (R20, T005).
  4. **`npm run ci` locally** before pushing (T049), then **CI green on GitHub** before merge
     (T057).
  5. **The running-system check repeated**: the migration on a copy of real data (quickstart S1),
     and the browser walk for two venues in different zones and DST-boundary dates under two
     browser zones (S2–S12) (T052, T053).
- **Nothing else changes**: every existing test keeps its meaning. Tests that send event times
  change only to state them in the venue's offset (T015).

## Phase 1: Setup

- [ ] T001 Cut `020-venue-time-zones-impl` (ground rules), run `npm ci` and `npm run ci` from the
  repository root, and confirm everything is green before any change (baseline). Record the test
  counts per workspace here.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared time module, the device-zone test runner, storage, the address service's
coordinates, the zone finder, and the test helpers every story uses.

- [ ] T002 [P] **Test first.** Create `packages/shared/test/time-zone.test.ts` (research R11, R20):
  - `US_TIME_ZONES` is exactly R2's eight ids in order, each with R2's `name`;
    `DEFAULT_TIME_ZONE` is `America/New_York`; `isUsTimeZone` accepts the eight and refuses
    `America/Kentucky/Louisville`, `UTC`, `''`.
  - `STATE_TIME_ZONES` has exactly `US_STATES`' 51 codes; the codes with two zones are exactly
    AK, AZ, FL, ID, IN, KS, KY, MI, NE, NV, ND, OR, SD, TN, TX, with R3's zones in R3's order;
    every zone in it is on `US_TIME_ZONES`.
  - For each of America/New_York, America/Chicago, America/Denver, America/Phoenix,
    America/Los_Angeles, America/Anchorage, Pacific/Honolulu: for **every minute** of 2027-03-14
    and 2027-11-07 (local), `resolveLocal` gives `ok` with `toLocalDateTime(moment.instant)` equal
    to the input, or `skipped` exactly for 02:00–02:59 on 2027-03-14 (not Phoenix or Honolulu), with
    `skippedFrom: '02:00'`, `skippedTo: '03:00'`, or `repeated` exactly for 01:00–01:59 on
    2027-11-07 (not Phoenix or Honolulu), with `first` and `second` one hour apart, `first` the
    daylight abbreviation (`EDT`, `CDT`, `MDT`, `PDT`, `AKDT`) and `second` the standard one.
    Boundaries named explicitly: 01:59 ok, 02:00 skipped, 02:59 skipped, 03:00 ok (spring); 00:59
    ok, 01:00 repeated, 01:59 repeated, 02:00 ok (fall).
  - America/Adak: abbreviations `HADT`/`HAST`, and one skipped and one repeated minute.
  - `offsetAt` and `abbreviationAt` for July and December instants in all eight zones match R2's
    table (`MST` all year in Phoenix, `HST` all year in Honolulu).
  - `toOffsetDateTime(2026-10-01T23:00Z, America/New_York)` is `2026-10-01T19:00:00-04:00`; for
    both 1:30 AM moments of 2027-11-07 it ends `-04:00` and `-05:00`.
  - `parseOffsetDateTime`: `2026-10-01T19:00:00-04:00`, `…19:00-04:00` (no seconds),
    `…19:00:00.123-04:00`, `…19:00:00Z` (offset 0), `…19:00:00+05:30`; `null` for no offset, a
    space instead of `T`, `24:00`, and garbage.
  - `formatEventTime(2026-10-01T23:00Z, America/New_York)` is `Oct 1, 2026, 7:00 PM EDT`;
    `formatTimeOfDay` `7:00 PM EDT`; `formatEventDate` `Oct 1, 2026`; an event 22:00–01:00 local
    formats two different dates; `zoneName('America/Phoenix')` is R2's name;
    `formatViewerTime` ends with the process zone's abbreviation.
  - Every assertion above holds whatever the process's `TZ` is (T050 runs it under four).
- [ ] T003 Create `packages/shared/src/time-zone.ts` (R2, R3, R11) and export it from
  `packages/shared/src/index.ts`. Run T002 until it passes, then the shared suite.
- [ ] T004 [P] **Test first.** Create `scripts/test/test-tz.test.mjs` (`node --test`): with a stub
  command, `scripts/test-tz.mjs` runs it once per zone with `TZ` set in the child's environment
  (the child prints `Intl.DateTimeFormat().resolvedOptions().timeZone` and the test sees each of
  the four zones); `--zones A,B` limits the zones; `--quick` selects only the time test files;
  it exits non-zero when any run fails and prints a zone × workspace table.
- [ ] T005 Create `scripts/test-tz.mjs` (R20): default zones America/New_York, UTC,
  America/Los_Angeles, Pacific/Honolulu; workspaces `packages/shared`, `admin-app`,
  `customer-app`, `booth-app` (their `vitest run`) and `backend` unit tests only
  (`jest test/unit`, which need no Testcontainers; adjust its global setup so unit-only runs do not
  start PostgreSQL if needed, without changing what the full suite does); `--quick` runs only
  `packages/shared/test/time-zone.test.ts` and each app's `test/**/*.tz.test.tsx`. Add
  `"test:tz": "node scripts/test-tz.mjs"` to the root `package.json`, and append
  `&& node scripts/test-tz.mjs --zones America/Los_Angeles --quick` to the root `test` script (CI's
  extra zone; the workflow is unchanged, `011` R12). Run T004 until it passes.
- [ ] T006 Remove `env: { TZ: 'America/New_York' }` from `customer-app/vitest.config.ts` (R20).
  Run the customer suite under America/New_York, UTC, and America/Los_Angeles with
  `npm run test:tz -- --zones … ` and record which tests fail outside New York: those are today's
  viewer-zone dependencies, fixed in Phase 8 (they may stay red only until then).
- [ ] T007 [P] **Test first.** Create `backend/test/integration/migration.time-zones.e2e-spec.ts`
  (R6, US7, SC-001): on a fresh Testcontainers database migrated up to the migration **before**
  `venue_time_zones` (`prisma migrate deploy` against a copy of the migrations folder without it),
  insert three venues (one pre-`013`, one verified, one not verified) and five events (one
  cancelled, one across midnight, microsecond instants); apply the remaining migration; assert
  every venue is `America/New_York`/`DEFAULT`, every event's `startsAt`/`endsAt` is byte-for-byte
  unchanged, `location_time_zone_known` refuses `'America/Kentucky/Louisville'` and `'UTC'`, an
  insert without `timeZone` fails (no default), and `event_no_overlap` is deferrable and still
  refuses an overlapping insert immediately.
- [ ] T008 Add the `TimeZoneSource` enum and `Location.timeZone`/`timeZoneSource` to
  `backend/prisma/schema.prisma` and the migration `backend/prisma/migrations/<timestamp>_venue_time_zones/migration.sql`
  exactly as data-model.md. Run T007 until it passes.
- [ ] T009 [P] **Test first.** Create `backend/test/unit/time-zone-lists.spec.ts` (R2): the
  contract's `UsTimeZone` enum, `US_TIME_ZONES` ids, and the CHECK list parsed from the T008
  migration file are equal; `TimeZoneSource` in the contract equals the Prisma enum's values.
- [ ] T010 [P] **Test first.** Extend `backend/test/unit/census-geocoder.spec.ts` (R1): a one-match
  answer with `coordinates: { x: -84.500968562869, y: 38.049429848416 }` returns `location:
  { latitude: 38.0494…, longitude: -84.5009… }`; missing `coordinates`, a string, `NaN`, or `null`
  gives `location: null` and is still a match (not "unavailable").
- [ ] T011 Add `location` to the `match` result in `backend/src/address/address-geocoder.ts` and
  read it in `census-geocoder.ts`. Run T009 and T010 until they pass.
- [ ] T012 [P] **Test first.** Create `backend/test/unit/time-zone-finder.spec.ts` (R1): with the
  real `geo-tz` data (offline), `GeoTzFinder.zoneAt` returns R1's table for the eight Census
  addresses and the border towns (Indianapolis, Tell City, Pensacola, El Paso, Boise, Ontario OR,
  Window Rock, West Wendover, Juneau, Adak), and `null` for (30, -70) in the Atlantic and for a
  point in Mexico City and in Toronto (zones not on the list).
- [ ] T013 Add `geo-tz` 8.1.10 to `backend/package.json` (exact version), create
  `backend/src/address/time-zone-finder.ts` (`TIME_ZONE_FINDER`, `TimeZoneFinder`, `GeoTzFinder`
  importing `geo-tz/dist/find-now`), and provide it in `address.module.ts`. Run T012 until it
  passes. Check that `docker compose build backend` still succeeds.
- [ ] T014 [P] Update `backend/test/setup/fake-geocoder.ts`: the default `match` carries Lexington's
  coordinates (38.0494, -84.5010); a test can set a match with any `location` or `null`.
  `createTestApp()` keeps the real `GeoTzFinder`.
- [ ] T015 Update `backend/test/setup/fixtures.ts`: `windowAt(days, hour = 18, zone =
  'America/New_York')` returns the venue's local `hour`:00 on that day with its offset
  (`toOffsetDateTime`), 3 hours long. Change the tests that send `Z` or a non-Eastern offset for an
  Eastern venue (`events.search.e2e-spec.ts`, `seating.capacity.e2e-spec.ts`, and any other
  `grep -rn "Z'" backend/test` finds for event times) to the venue's offset, keeping each test's
  meaning. Run the whole Backend suite: green (the Backend still accepts any offset at this point).

**Checkpoint**: shared module, runner, storage, coordinates, and finder in place; suite green
(except T006's recorded customer-app tests).

---

## Phase 3: User Story 4 - A Venue's Time Zone Is Worked Out From Its Address (P1)

**Goal**: FR-001 to FR-008, SC-006. **Independent Test**: spec US4.

### Tests for User Story 4 (write first, confirm they fail)

- [ ] T016 [P] [US4] Create `backend/test/integration/venues.time-zone.e2e-spec.ts`:
  - verified match at Lexington → `America/New_York`, `ADDRESS`; at Phoenix (33.4465, -112.0706)
    → `America/Phoenix`, `ADDRESS`; at Honolulu → `Pacific/Honolulu`;
  - verified match with `location: null`, and one at (30, -70), in OH → `America/New_York`,
    `STATE`; in KY → `400 TIME_ZONE_REQUIRED` with `details` `{ state: 'KY', timeZones:
    ['America/New_York', 'America/Chicago'] }`, nothing saved;
  - save anyway (`acceptUnverifiedAddress`, fake answers `none`) in OH → `STATE`; in KY without
    `timeZone` → `TIME_ZONE_REQUIRED`; with `timeZone: 'America/New_York'` → saved, `ADMIN`; for
    each of the 15 split states once (table-driven) → `TIME_ZONE_REQUIRED` listing that state's
    zones; for each one-zone state once → its zone, `STATE`;
  - without save anyway, an unmatched KY address is still `ADDRESS_NOT_FOUND` (not
    `TIME_ZONE_REQUIRED`);
  - `timeZone` sent with a verified Lexington address `America/Chicago` → `America/Chicago`,
    `ADMIN`; `timeZone: 'America/Kentucky/Louisville'` → `400 VALIDATION_FAILED`;
  - update: name-only and capacity-only edits never change the zone or source, and do not call the
    finder (spy); an address change re-derives (Lexington → Phoenix gives Arizona, then US5's rules
    apply; on a venue without events it simply changes); `timeZone` alone on a venue without events
    → changed, `ADMIN`; the same zone as stored → no event moves, `ADMIN`; `timeZone` with an
    address change → the sent zone wins;
  - a pre-`013` venue (`DEFAULT`) keeps its zone on a name edit and re-derives when given four
    parts;
  - every response validates against the contract and carries `timeZone` and `timeZoneSource`.
- [ ] T017 [P] [US4] Create `backend/test/unit/venue-time-zone.spec.ts`: `decideZone` (pure,
  table-driven) for every row of R7's order: sent zone; verified match with a zone; match with
  `location: null`; finder `null`; save anyway in a one-zone and in a split state; and the update
  cases (no address change, same address, changed address, zone alone).

### Implementation for User Story 4

- [ ] T018 [US4] Add `timeZone` (`IsOptional`, `IsIn(US_TIME_ZONES ids)`) to
  `create-location.dto.ts` and `update-location.dto.ts`; allow `timeZone` alone as a valid update.
- [ ] T019 [US4] Create `backend/src/locations/venue-time-zone.ts` (`decideZone`, R3, R4, R7) and
  use it in `LocationsService.create` and `update`, after `checkAddress`. Write `timeZone` and
  `timeZoneSource` on create, and on update only when R7 says so. Moving events comes in Phase 5;
  until then, an update that would change the zone of a venue that has events fails closed (an
  internal error, nothing written), so no event is ever left with a different local time; T026
  replaces that branch. Run T016 and T017 until they pass.

**Checkpoint**: every new venue has a zone, decided by the rules.

---

## Phase 4: User Stories 2 and 3 - Entering Times, and Daylight Saving, in the Backend (P1)

**Goal**: FR-018, FR-019, SC-007, and the conflict message of FR-022. **Independent Test**: spec
US2 scenario 7, US3 scenarios 6–8.

### Tests (write first, confirm they fail)

- [ ] T020 [P] [US2] [US3] Create `backend/test/integration/events.time-zone.e2e-spec.ts`, at an
  Eastern venue and a Phoenix venue (fake match coordinates):
  - `2026-10-01T19:00:00-04:00` → `201`, stored `23:00Z`; `…19:00:00-07:00` → `400
    UTC_OFFSET_MISMATCH` with `details` `{ field: 'startsAt', localTime: '2026-10-01T19:00',
    timeZone, sentOffset: '-07:00', expectedOffsets: ['-04:00'] }`; `2026-10-01T23:00:00Z` → `400
    UTC_OFFSET_MISMATCH`; the same for `endsAt` (field `endsAt`);
  - `2027-03-14T02:30:00-05:00` and `-04:00` → `400 LOCAL_TIME_SKIPPED`, `skippedFrom: '02:00'`,
    `skippedTo: '03:00'`; boundaries `01:59:00-05:00` → `201`, `03:00:00-04:00` → `201`;
  - `2027-11-07T01:30:00-04:00` → `201` at `05:30Z`; `-05:00` → `201` at `06:30Z` (separate
    venues, or far enough apart); `2027-11-07T01:30:00-06:00` → `UTC_OFFSET_MISMATCH` with
    `expectedOffsets: ['-04:00', '-05:00']`;
  - Phoenix: `2027-03-14T02:30:00-07:00` → `201`; `-06:00` → `UTC_OFFSET_MISMATCH`;
  - an event 01:00 EST to 03:00 EDT on 2027-03-14 → `201`, one hour long;
  - refusal order: a bad `locationId` is `404` before any zone check; `endsAt <= startsAt` is
    `400 VALIDATION_FAILED` first; a zone refusal comes before `CAPACITY_EXCEEDED` and
    `SCHEDULING_CONFLICT`; nothing is saved on any refusal;
  - `updateEvent`: only the sent time is checked; moving to a venue in another zone without both
    times → `400 VALIDATION_FAILED` with R9's message; with both, in the destination's offset →
    `200`; moving within the same zone without times → `200`, instants unchanged;
  - `SCHEDULING_CONFLICT`'s message reads "This venue is already committed from 7:00 PM EDT to
    10:00 PM EDT by 'X'…" (and MST at Phoenix); `details` unchanged.
- [ ] T021 [P] [US2] Update `backend/test/integration/events.conflict-contract.e2e-spec.ts` and
  any test asserting the old `UTC` conflict message to the new message.

### Implementation

- [ ] T022 [US2] [US3] Create `backend/src/events/event-time.ts` (`checkEventTime(field, sent,
  zone, venueName)`, R9) and call it from `EventsService` create and update in R9's order; add
  the venue-move rule. Run T020 until it passes.
- [ ] T023 [US2] Change `SchedulingConflictException` to take the venue's zone and format with
  `formatTimeOfDay`; add optional `details.event` (used in Phase 5). Run T020 and T021 until they
  pass, then the whole Backend suite.

**Checkpoint**: the Backend refuses every event time not stated in its venue's zone.

---

## Phase 5: User Story 5 - Changing a Venue's Time Zone (P2)

**Goal**: FR-009 to FR-013, SC-005. **Independent Test**: spec US5.

### Tests (write first, confirm they fail)

- [ ] T024 [P] [US5] Create `backend/test/integration/venues.time-zone-change.e2e-spec.ts`:
  - Eastern → Central with two events at 7:00 PM local and no orders: both move one hour later in
    UTC and still read 19:00 locally; a cancelled event without orders moves too; changing back
    restores the original instants exactly;
  - an order in each state (confirmed; refunded; on a cancelled event) on one event → `409
    TIME_ZONE_HAS_ORDERS` naming it, `eventCount`, nothing changed (venue and every event);
  - Phoenix → Denver with an event at 2027-03-14 02:30 local → `409 EVENT_TIME_NOT_IN_ZONE`,
    `reason: 'SKIPPED'`; Phoenix → Denver with an event at 2027-11-07 01:30 local → `REPEATED`;
    nothing changed;
  - Phoenix → Denver with "Late A" ending 01:30 and "Late B" starting 03:00 on 2027-03-14 → `409
    SCHEDULING_CONFLICT`, `conflictingEvent` A and `event` B, message in Mountain time; the
    boundary pair exactly 60 minutes apart after the move → `200` and 59 minutes → `409`;
  - when every event moves an hour later and consecutive events are exactly 60 minutes apart, the
    change succeeds (proves the deferred constraint);
  - an explicit `timeZone` change on a venue with orders is refused **before** the address lookup
    (the fake geocoder is not called) when sent with an address change;
  - an address change that re-derives a different zone follows the same rules.
- [ ] T025 [P] [US5] Create `backend/test/integration/venues.time-zone-change.concurrency.e2e-spec.ts`
  (genuinely concurrent requests, each case repeated 10 times):
  - a zone change racing `createOrder` on one of the venue's events: either the order succeeds and
    the change is `409 TIME_ZONE_HAS_ORDERS`, or the change succeeds and the order is placed against
    the new instants; never both against the old state (check the stored rows);
  - a zone change racing `createEvent` at the same venue (time stated in the old zone's offset):
    either the event is created and moved with the others (its local time kept), or it is refused
    `UTC_OFFSET_MISMATCH` against the new zone; never an event saved with the old zone's reading
    after the change;
  - a zone change racing `updateEvent` of one of its events: no deadlock surfaces as `500`.

### Implementation

- [ ] T026 [US5] Implement `moveEventsToZone` in `venue-time-zone.ts` and call it inside
  `LocationsService.update`'s transaction after `lockVenueAndEvents` (R8: orders, new moments,
  pairwise 60-minute check, `SET CONSTRAINTS "event_no_overlap" DEFERRED`, the writes); add the
  pre-lookup orders check for an explicit `timeZone`; remove T019's guard. Run T024 until it
  passes.
- [ ] T027 [US5] Add `lockVenueShared(tx, ids)` to `backend/src/common/venue-lock.ts` (`FOR SHARE`
  in id order) and make `EventsService.create`/`update` run in one `LOCKING_TX` transaction that
  takes it first (R10: both venues on a move; re-read `locationId` after `lockEvent` and retry once
  if it changed). Make sure a `23P01` raised at commit maps to `409 SCHEDULING_CONFLICT` with
  `conflictingEvent: null`. Run T025 until it passes, then the whole Backend suite (including the
  existing `events.concurrency` and `seats.concurrency` tests).

**Checkpoint**: zone changes keep local times and never move a sold event.

---

## Phase 6: User Stories 1 and 6 - Responses Carry the Zone; Filters by Venue Day (P1, P2)

**Goal**: FR-020, FR-021 (Backend side), R15, R16.

### Tests (write first, confirm they fail)

- [ ] T028 [P] [US1] Create `backend/test/integration/events.date-filter.e2e-spec.ts`: with a 9:00
  PM PDT event on Oct 1 at a Los Angeles venue (Oct 2 04:00Z), a 7:00 PM EDT event on Oct 1, and an
  00:30 EDT event on Oct 2: `fromDate=2026-10-01&toDate=2026-10-01` returns the first two;
  `fromDate=2026-10-02` the third (and not the LA one); Honolulu and Anchorage cases; `fromDate`
  after `toDate` → `400`; `fromDate` with `from` → `400`; `from`/`to` unchanged.
- [ ] T029 [P] [US1] [US6] Extend `me-orders.e2e-spec.ts`, `reports.e2e-spec.ts`,
  `entry.lookup.e2e-spec.ts`, and `entry.admit.e2e-spec.ts`: `OrderEvent.location.timeZone`,
  `EventSales.timeZone`, `EntryTicket.event.timeZone`, and `ENTRY_REFUSED` `OTHER_EVENT`'s
  `details.event.timeZone` are the venue's zone (a Phoenix venue in at least one case).

### Implementation

- [ ] T030 [US1] Add `fromDate`/`toDate` to `list-events.query.ts` (`IsISO8601` date-only) and R15's
  wide window plus `localDate` filter in `EventsService.findAll`. Run T028 until it passes.
- [ ] T031 [US1] [US6] Add the zone to the my-orders mapping in `orders.service.ts`, to
  `reports.service.ts`, and to `entry.service.ts` (lookup query and refusal details). Run T029
  until it passes, then the whole Backend suite.

**Checkpoint**: the Backend side is complete; every response validates against the contract.

---

## Phase 7: User Stories 2, 3, 4, 5 - Admin App (P1)

**Goal**: FR-014 to FR-017, FR-020 to FR-024, FR-026. Fixtures use venues in Eastern, Arizona, and
Hawaii zones. Name each new file that asserts formatted times `*.tz.test.tsx` (R20 `--quick`).

### Tests (write first, confirm they fail)

- [ ] T032 [P] [US2] [US3] Create `admin-app/test/event-form.tz.test.tsx` (mocked API): choosing an
  Eastern venue shows "Times are in the venue's time zone: Eastern Time (EDT)." (EST for a December
  date); typing 2026-10-01T19:00–22:00 sends `2026-10-01T19:00:00-04:00` and `…22:00:00-04:00`;
  switching to the Phoenix venue keeps the inputs and sends `-07:00`; 2027-03-14T02:30 shows R9's
  message and sends nothing; 2027-11-07T01:30 shows "Which 1:30 AM?" with the two options, refuses
  Save until chosen, and sends `-05:00` for EST; editing an event stored at `2027-11-07T06:30Z`
  shows 01:30 with EST chosen; editing any event shows its venue-local values; `LOCAL_TIME_SKIPPED`
  and `UTC_OFFSET_MISMATCH` from the API appear in the banner with every value kept; the conflict
  line shows "7:00 PM EDT – 10:00 PM EDT".
- [ ] T033 [P] [US2] Create `admin-app/test/times.tz.test.tsx`: the event list, event page, venue
  page events, attendees' "checked in" time, and Reports' event dates show the exact venue-local
  strings with abbreviations for venues in three zones; Reports' "as of" ends with the process
  zone's abbreviation; the event search sends `fromDate`/`toDate` exactly as typed.
- [ ] T034 [P] [US4] [US5] Create `admin-app/test/venue-time-zone.test.tsx`: the venue list's Time
  zone column and the venue page's "Time zone: Eastern Time, from the address." (all four sources);
  the form's select sends `timeZone` only when picked; after `ADDRESS_NOT_FOUND` in KY, Save anyway
  is refused by the form until Eastern or Central is chosen and then sends `timeZone`; in OH no
  question; `TIME_ZONE_REQUIRED` from the API shows the state's zones; on edit, picking another
  zone shows R14's note; `TIME_ZONE_HAS_ORDERS` (events listed as links), `EVENT_TIME_NOT_IN_ZONE`,
  and `SCHEDULING_CONFLICT` appear in the banner with every value kept; the saved notice names the
  zone and source.

### Implementation

- [ ] T035 [US2] [US3] Change `admin-app/src/format.ts` (`when(iso, zone)`) and `EventForm.tsx`
  (R13). Run T032 until it passes.
- [ ] T036 [US2] Change `EventList.tsx`, `EventDetail.tsx`, `LocationDetail.tsx`, `Attendees.tsx`,
  and `Reports.tsx` (R12, R15). Run T033 until it passes.
- [ ] T037 [US4] [US5] Change `LocationForm.tsx`, `LocationList.tsx`, `LocationDetail.tsx`, and
  `ErrorBanner` if needed (R14), with existing classes only. Run T034 until it passes, then the
  whole Admin suite and the theme drift check.

---

## Phase 8: User Story 1 - Customer App (P1)

**Goal**: FR-020 to FR-023 in the Customer app; SC-002, SC-003.

- [ ] T038 [P] [US1] **Test first.** Create `customer-app/test/times.tz.test.tsx` and update
  `format.test.ts`, `filters.test.ts`, and every test T006 recorded: event cards (Events list and
  venue page), the event page, My tickets (start, ordered at, used at), the live entry code page,
  and the printable ticket show the exact venue-local strings with abbreviations for venues in
  three zones; a missing `location.timeZone` falls back to Eastern; the seat-cooldown message ends
  with the process zone's abbreviation; the filters send `fromDate`/`toDate` exactly as chosen.
- [ ] T039 [US1] Change `customer-app/src/format.ts`, `filters.ts`, `EventCard.tsx`,
  `GetTickets.tsx`, `EventDetail.tsx`, `MyTickets.tsx`, `PrintTicket.tsx`, and `EntryCode.tsx`
  (R12, R15). Run T038 until it passes, then the whole Customer suite under the four zones
  (`npm run test:tz -- --zones …`): every T006 failure is gone.

---

## Phase 9: User Story 6 - Ticket Booth App (P2)

- [ ] T040 [P] [US6] **Test first.** Create `booth-app/test/times.tz.test.tsx`: the event picker,
  "Already used at", "Entry opens at", "For {event} on …, not this event" (with another venue's
  zone from `EntryTicket.event.timeZone` and from `details.event.timeZone`), and admit results show
  the exact venue-local strings with abbreviations; live code windows and countdowns unchanged
  (existing tests still pass).
- [ ] T041 [US6] Change `booth-app/src/format.ts`, `EntryResult.tsx`, `EventPicker.tsx`, and
  `App.tsx` (R12, R16). Run T040 until it passes, then the Booth suite.

---

## Phase 10: Demo data, docs, and cross-cutting checks

- [ ] T042 **Test first.** Extend `backend/test/integration/demo-data.e2e-spec.ts` (R19): with the
  fake geocoder matching, both demo venues are `America/New_York`/`ADDRESS`; with it unavailable,
  both are `America/New_York`/`DEFAULT` and the run succeeds; the concert, comedy night, and gala
  start at 19:00, 20:00, and 19:00 local Eastern on their dates and end 3 hours later; "Demo
  Tonight" still starts about an hour after the run; a controller request can never use the
  fallback (a KY save anyway through the API is still `TIME_ZONE_REQUIRED`).
- [ ] T043 Change `backend/src/scripts/demo-data.ts` (`atLocal`, `fallbackToDefaultTimeZone`) and
  `LocationsService.create`'s internal options. Run T042 until it passes.
- [ ] T044 [P] Update `README.md`: the `020` status row; "Today": every venue has a time zone from
  its address and every app shows event times in the venue's local time; `npm run test:tz` and why
  `TZ=` in Git Bash does not work on Windows; the boundary data attribution ("Time zone boundaries:
  timezone-boundary-builder, © OpenStreetMap contributors, ODbL 1.0, via geo-tz").
- [ ] T045 [P] Grep app sources for `toLocaleString(`, `toLocaleDateString(`,
  `toLocaleTimeString(`, `getTimezoneOffset(`, and `new Date(` with a local string or
  `(y, m, d)` arguments (ground rules); each remaining use is not an event time (record which) or is
  replaced.
- [ ] T046 Run `npm run ci` and `npm run test:tz`; everything passes. Fix before the reviews.

---

## Phase 11: Independent reviews (at least two rounds, Mahdi 2026-10-24)

- [ ] T047 **Review round 1**: a Claude session that did not write the code reviews the branch
  locally against the spec, plan, constitution 3.4.1, and #42 (Constitution III), including the
  quality-gate 7 list. Fix every finding in `Review 020:` commits. Record the findings (must,
  should, minor), fixes, and anything left open with the reason, here.
- [ ] T048 **Review round 2**, by another session that did not write the code (and not the round 1
  reviewer if possible), on the fixed branch. Fix and record as T047. **If round 2 finds anything
  more than minor issues, run round 3, and so on, until a round finds only minor issues**; record
  each round here.

---

## Phase 12: Verification, several times (after the last code change)

- [ ] T049 Run `npm run ci` locally from a clean `npm ci`; green. Record the date, the commit, and
  each workspace's test count and coverage.
- [ ] T050 **Three times in a row** (flake check), with no change in between, run each affected
  suite and record the three results (passed/failed, counts, duration) in a table here:
  `npm run test --workspace @queuepass/shared`, `… @queuepass/backend`, `… @queuepass/admin-app`,
  `… @queuepass/customer-app`, `… @queuepass/booth-app`, and `node --test "scripts/test/*.test.mjs"`.
  Then run `npm run test:tz` (four zones) and record its zone × workspace table. Any failure,
  even once: find the cause, fix it, and restart T049–T050.
- [ ] T051 Report coverage for every workspace in the PR description; each new file is covered by
  its tests, and each workspace stays at or above 80% lines (Constitution VI, `010`).
- [ ] T052 Running-system gate, part 1: quickstart **S1**, the migration on a copy of the running
  stack's real data. Record the event count and checksums before and after, the venue zone query,
  and `condeferrable`.
- [ ] T053 Running-system gate, part 2: `docker compose up --build` from a fresh clone of the
  branch; walk quickstart **S2–S12** in the browser, each of S5–S10 under **two browser zones**
  (UTC and America/Los_Angeles), for the **two venues in different zones** (Eastern and Arizona or
  Mountain) and the **DST dates** (2027-03-14 2:30 AM, 2027-11-07 1:30 AM); sign in, use, and sign
  out of all three apps. Record the results here, with anything unexpected.

---

## Phase 13: Pull request

- [ ] T054 Mark every task done here, with its results, and update the README status row.
- [ ] T055 Open the follow-up issue (research R18): "Contract: make the 020 time-zone fields
  required" (`Location.timeZone`, `Location.timeZoneSource`, `OrderEvent.location.timeZone`,
  `EventSales.timeZone`, `EntryTicket.event.timeZone`), to do after this PR merges.
- [ ] T056 Push `020-venue-time-zones-impl` and open the PR (only after the spec and plan PR has
  merged and the branch is rebased onto `main`, ground rules). The description says `fixes #42`,
  lists the review rounds with their findings and anything left open, the three-run and four-zone
  results (T050), the running-system results (T052, T053), coverage (T051), and the shared surface
  touched (every member approves).
- [ ] T057 Wait for **CI green on GitHub** for the PR's last commit (the required `test` check,
  `011`); a red run is fixed, never skipped (quality gate 4). Merge only when green and approved.

## Dependencies

- Phase 2 blocks everything. Phase 3 before Phase 5 (zone decisions before zone changes); Phase 4
  before Phase 5 (event times and the conflict message before moving events). Phase 6 after
  Phase 2. Phases 7–9 after Phases 3–6 (they need the response fields and refusals); they are
  independent of each other. Phase 10 after Phases 3–9. Phases 11–13 in order, last.
- [P] tasks touch different files and can run in parallel.
