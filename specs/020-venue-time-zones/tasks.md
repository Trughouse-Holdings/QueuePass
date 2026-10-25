---
description: "Task list for Venue Time Zones"
---

# Tasks: Venue Time Zones

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.13.0, already applied),
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
- **Do not change the contract** (1.13.0, on top of `019`'s 1.12.0; types regenerated; the five
  codes already in `ERROR_CODES`). There is no `x-planned` marker to remove:
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
  change takes `lockVenueAndEvents`, reads the venue's zone **from that lock** (never from a row
  read before it), and then locks every event of the venue, any status, in id order (R8).
- **Device zones in tests** (R20): the Customer app's `TZ` pin (America/New_York) **stays**, as `019`
  requires; every Vitest config takes `QP_TEST_TZ` when it is set (the Customer app's default stays
  New York), and `scripts/test-tz.mjs` sets it. Never add another pin. Code that changes `TZ` and
  restores it MUST `delete process.env.TZ` when the saved value was `undefined`, never assign
  `undefined` (Node then reads the zone as `Etc/Unknown`). `019`'s `CALENDAR_TEST_TZ` keeps
  working. On Windows, `TZ=… npm test` in Git Bash does **not** reach Node; use `npm run test:tz`
  or PowerShell's `$env:TZ`.
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
     and the browser walk for two venues in different zones and DST-boundary dates (S2–S12),
     with the second browser zones set by Mahdi by hand (T052, T053). Where images cannot be
     built, the quickstart's host-run path B is used, with the Backend in America/Los_Angeles.
- **Nothing else changes**: every existing test keeps its meaning. Tests that send event times
  change only to state them in the venue's offset (T015).

## Phase 1: Setup

- [x] T001 Cut `020-venue-time-zones-impl` (ground rules), run `npm ci` and `npm run ci` from the
  repository root, and confirm everything is green before any change (baseline). Record the test
  counts per workspace here.
  **Done 2026-10-24** on main 7858ebd: `npm ci` was blocked (EPERM) by a leftover customer-app Vite
  dev server from the 019 walk holding rollup's native module, and had already emptied part of
  `node_modules`; the tree was restored with `npm install` (the session could not stop that
  process). `npm run ci` then passed in 4 min 55 s: scripts/test 22, shared 468 (92.00% lines),
  backend 744 in 84 suites (97.02%), admin-app 200 (96.88%), customer-app 296 (97.47%), booth-app 67
  (92.33%), seed 8 (71.25%).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared time module, the device-zone test runner, storage, the address service's
coordinates, the zone finder, and the test helpers every story uses.

- [x] T002 [P] **Test first.** Create `packages/shared/test/time-zone.test.ts` (research R11, R20):
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
  - `toLocalDateTime` of local midnight is `…T00:00`, never `…T24:00` (`hourCycle: 'h23'`, R11).
  - `formatEventTime(2026-10-01T23:00Z, America/New_York)` is `Oct 1, 2026, 7:00 PM EDT`;
    `formatTimeOfDay` `7:00 PM EDT`; `formatEventDate` `Oct 1, 2026`; an event 22:00–01:00 local
    formats two different dates; `zoneName('America/Phoenix')` is R2's name;
    `formatViewerTime` ends with the process zone's abbreviation.
  - Every assertion above holds whatever the process's `TZ` is (T050 runs it under four).
  **Done**: 119 tests; failed first because `src/time-zone.ts` did not exist (commit f02c1de).
- [x] T003 Create `packages/shared/src/time-zone.ts` (R2, R3, R11) and export it from
  `packages/shared/src/index.ts`. Run T002 until it passes, then the shared suite.
  **Done**: T002 passes (119), also with `TZ` Pacific/Honolulu, UTC, and America/Los_Angeles set
  from PowerShell; the shared suite passes.
- [x] T004 [P] **Test first.** Create `scripts/test/test-tz.test.mjs` (`node --test`): with a stub
  command, `scripts/test-tz.mjs` runs it once per zone with both `QP_TEST_TZ` and `TZ` set in the
  child's environment (the child prints `Intl.DateTimeFormat().resolvedOptions().timeZone` and the
  test sees each of the four zones); it runs the `@queuepass/shared` build and then the Backend's
  `prisma:generate` before the first suite (stub commands record the order); `CALENDAR_TEST_TZ`
  set in the parent is absent from every child's environment; the Backend run uses
  `backend/jest.unit.config.ts`; `--zones A,B` limits the zones; `--quick` selects only the time
  test files; `--backend-full` adds the Backend's full suite; it exits non-zero when any run fails
  and prints a zone × workspace table.
  **Done**: 10 tests; failed first because `scripts/test-tz.mjs` did not exist (commit 501c0ce).
- [x] T005 Create `scripts/test-tz.mjs` (R20): default zones America/New_York, UTC,
  America/Los_Angeles, Pacific/Honolulu; it first runs `npm run build --workspace
  @queuepass/shared` (the Backend's Jest maps `@queuepass/shared` to `dist/cjs`) and `npm run
  prisma:generate --workspace @queuepass/backend` (a unit test imports `@prisma/client`); it removes
  `CALENDAR_TEST_TZ` from the children's environment (R20); then, per zone,
  the `packages/shared`, `admin-app`, `customer-app`, and `booth-app` suites (`vitest run`) and the
  Backend's unit tests with a new `backend/jest.unit.config.ts` (the main config's settings,
  `roots`/`testMatch` limited to `test/unit`, and **no `globalSetup`**, so no Testcontainers
  PostgreSQL and no Docker are needed; the main `jest.config.ts` is unchanged); `--quick` runs
  only `packages/shared/test/time-zone.test.ts` and each app's `test/**/*.tz.test.tsx`;
  `--backend-full` adds the Backend's full suite in that zone. Add `"test:tz": "node
  scripts/test-tz.mjs"` to the root `package.json`, and append `&& node scripts/test-tz.mjs --zones
  America/Los_Angeles --quick` to the root `test` script (CI's extra zone; the workflow is
  unchanged, `011` R12; `scripts/test/ci-workflow.test.mjs` still passes). Run T004 until it
  passes.
  **Done**: T004 passes. `--quick` runs no Backend suite, so it skips the build and generate steps,
  and passes `--passWithNoTests` to the apps' `.tz.test.tsx` filter (until Phases 7–9 add them). The
  root `npm test` ends with the Los Angeles quick run; `ci-workflow.test.mjs` still passes.
- [x] T006 Make each Vitest config take the override (R20): `customer-app/vitest.config.ts`
  `env: { TZ: process.env.QP_TEST_TZ || 'America/New_York' }` (the `019` pin stays as the default);
  `admin-app`, `booth-app`, and `packages/shared` `env: { ...(process.env.QP_TEST_TZ ? { TZ:
  process.env.QP_TEST_TZ } : {}) }`. If `019`'s implementation has merged, check its
  `customer-app/test/calendar.test.ts`: its restore
  of `TZ` deletes the variable when the saved value was `undefined` (fix it if it assigns), and it
  still passes with `CALENDAR_TEST_TZ` set to `UTC`, `America/New_York`, and
  `America/Los_Angeles`. Run `npm run test:tz` and record, per zone, which existing tests fail
  outside their old zone: those are today's viewer-zone dependencies, fixed in Phases 7–9. Every
  suite stays green in its default zone throughout (the pin is kept), so each commit's
  `npm test` is green.
  **Done**: 019's `calendar.test.ts` already restores `TZ` by deleting it when it was unset, and
  passes (80) with `CALENDAR_TEST_TZ` set to UTC, America/New_York, and America/Los_Angeles. `npm
  run test:tz` on 2026-10-24: shared, admin-app, and booth-app pass in all four zones; backend
  (unit) fails only T009 (no migration yet, expected); customer-app fails outside New York: in UTC 4
  tests, `format.test.ts` "when > shows the local date and time", `filters.test.tsx` "filters by
  whole days in the customer's time zone, the end day included" and "fills the controls from the
  address and sends every filter in one request", `browse.test.tsx` "gives an event that crosses
  midnight both of its dates"; in America/Los_Angeles and Pacific/Honolulu those 4 plus
  `format.test.ts` "gives an event crossing midnight its own end date". These are today's
  viewer-zone dependencies, fixed in Phase 8.
- [x] T007 [P] **Test first.** Create `backend/test/integration/migration.time-zones.e2e-spec.ts`
  (R6, US7, SC-001): on a fresh Testcontainers database migrated up to the migration **before**
  `venue_time_zones` (`prisma migrate deploy` against a copy of the migrations folder without it),
  insert three venues (one pre-`013`, one verified, one not verified) and five events (one
  cancelled, one across midnight, microsecond instants); apply the remaining migration; assert
  every venue is `America/New_York`/`DEFAULT`, every event's `startsAt`/`endsAt` is byte-for-byte
  unchanged, `location_time_zone_known` refuses `'America/Kentucky/Louisville'` and `'UTC'`, an
  insert without `timeZone` fails (no default), and `event_no_overlap` is deferrable and still
  refuses an overlapping insert immediately.
  **Done**: 6 tests; failed first because no `*_venue_time_zones` migration existed (commit after
  f4677e6).
- [x] T008 Add the `TimeZoneSource` enum and `Location.timeZone`/`timeZoneSource` to
  `backend/prisma/schema.prisma` and the migration `backend/prisma/migrations/<timestamp>_venue_time_zones/migration.sql`
  exactly as data-model.md. Run T007 until it passes.
  **Done**: migration `20261024120000_venue_time_zones`. T007 passes after two fixes to the test
  itself (a cancelled row needs `cancelledAt`; a NOT NULL refusal names no column, so the test
  asserts SQLSTATE 23502). T009 passes. Until T019, `LocationsService.create` writes
  America/New_York/`DEFAULT`, and the two tests that insert a `Location` directly
  (`locations.legacy-address`, `me-orders`) set both columns, so the Backend suite stays green: 86
  suites, 753 tests.
- [x] T009 [P] **Test first, written before T003 and T008** (so it is seen failing: neither list
  nor migration exists yet). Create `backend/test/unit/time-zone-lists.spec.ts` (R2): the
  contract's `UsTimeZone` enum, `US_TIME_ZONES` ids, and the CHECK list parsed from the
  `venue_time_zones` migration file are equal; `TimeZoneSource` in the contract equals the Prisma
  enum's values. Run it again after T008: it passes.
  **Done**: written before T003 and T008 and seen failing (no `US_TIME_ZONES`, no Prisma
  `TimeZoneSource`; commit f02c1de); passes after T008.
- [x] T010 [P] **Test first.** Extend `backend/test/unit/census-geocoder.spec.ts` (R1): a one-match
  answer with `coordinates: { x: -84.500968562869, y: 38.049429848416 }` returns `location:
  { latitude: 38.0494…, longitude: -84.5009… }`; two entries with the same `matchedAddress` and
  different coordinates give the **first** entry's; missing `coordinates`, a string, `NaN`, or
  `null` gives `location: null` and is still a match (not "unavailable").
  **Done**: 10 new tests failed first (no `location` on the match; commit e227170).
- [x] T011 Add `location` to the `match` result in `backend/src/address/address-geocoder.ts` and
  read it in `census-geocoder.ts`. Run T010 until it passes.
  **Done**: T010 passes (36); one more existing exact-match assertion (the 200-character street)
  gained the location its stub sends.
- [x] T012 [P] **Test first.** Create `backend/test/unit/time-zone-finder.spec.ts` (R1): with the
  real `geo-tz` data (offline), `GeoTzFinder.zoneAt` returns R1's table for the eight Census
  addresses and the border towns (Indianapolis, Tell City, Pensacola, El Paso, Boise, Ontario OR,
  Window Rock, West Wendover, Juneau, Adak); `null` for (30, -70) in the Atlantic (`Etc/GMT+5`),
  Mexico City (`America/Mexico_City`), and San Juan PR (`America/Caracas`), zones not on the list
  (not Toronto: `find-now` merges it into America/New_York); `null`, not an exception, for latitude
  91, longitude -181, and `NaN` (R1, review round 1 m6).
  **Done**: 25 tests; failed first (no `time-zone-finder` module; commit e227170).
- [x] T013 Add `geo-tz` 8.1.10 to `backend/package.json` (exact version), create
  `backend/src/address/time-zone-finder.ts` (`TIME_ZONE_FINDER`, `TimeZoneFinder`, `GeoTzFinder`
  importing `geo-tz/dist/find-now`, with R1's range check and `try`/`catch`), and provide it in
  `address.module.ts`. Run T012 until it passes.
  - **Seed image** (R1, review round 1 S3), test first: create `scripts/test/seed-image.test.mjs`
    (`node --test`) that reads `scripts/seed/Dockerfile` and fails unless its `npm ci` line
    installs only `@queuepass/seed` (plus the workspace root), `packages/shared`'s sources are
    neither copied nor built, and a later `RUN` fails the build when `node_modules/geo-tz` exists.
    It allows (and the Dockerfile keeps) the `COPY <workspace>/package.json` lines for every
    workspace: `npm ci` needs all the workspace manifests to check the lock file (review round 3,
    q2). See it fail; then change the Dockerfile to `npm ci --ignore-scripts --workspace @queuepass/seed
    --include-workspace-root` followed by `RUN test ! -e node_modules/geo-tz`, and drop the
    `packages/shared` copy and build (the seed imports nothing from it, R1). Run it until it
    passes.
  - Where images build, check `docker compose build backend seed` succeeds and the seed image has
    no `geo-tz`; where they cannot (quickstart path B), record "to do where images build" and
    check the seed install on the host instead: in a scratch copy of the repository, run that same
    `npm ci` line and confirm `node_modules/geo-tz` is absent and `npm run build --workspace
    @queuepass/seed` (its `tsc --noEmit`) passes.
  **Done**: `geo-tz` 8.1.10 exact (npm: 19 packages added, the `text-encoding` deprecation warning
  as R1 says); T012 passes with the real data, R1's whole table. Seed image: `seed-image.test.mjs`
  failed first (3 of 4), passes after the Dockerfile change. Images cannot build on this machine
  (TLS interception): `docker compose build backend seed` and the image's missing `geo-tz` are **to
  do where images build**. Host check instead, 2026-10-24: in a scratch copy (root and every
  workspace's `package.json`, the lock file, `scripts/seed`), `npm ci --ignore-scripts --workspace
  @queuepass/seed --include-workspace-root` installed 313 packages with no `node_modules/geo-tz`,
  and `npm run build --workspace @queuepass/seed` (`tsc --noEmit`) exited 0.
- [x] T014 [P] Update `backend/test/setup/fake-geocoder.ts`: the default `match` carries Lexington's
  coordinates (38.0494, -84.5010); a test can set a match with any `location` or `null`.
  `createTestApp()` keeps the real `GeoTzFinder`.
  **Done** with T011 (the match type now needs `location`): default place Lexington; `placeAt(place
  | null)`; `PLACES`; `createTestApp()` keeps the real `GeoTzFinder` (only `ADDRESS_GEOCODER` is
  overridden).
- [x] T015 Update `backend/test/setup/fixtures.ts`: `windowAt(days, hour = 18, zone =
  'America/New_York')` returns the venue's local `hour`:00 on that day with its offset
  (`toOffsetDateTime`), 3 hours long; add `atInstant(date, zone = 'America/New_York')`, which
  turns a computed instant ("now + 2 hours" for sales close and entry windows) into the venue's
  offset form. Then change every test that sends an event time (R20, review round 1 S7). Found by
  searching `backend/test` for `toISOString()`, `Z'`, `` Z` ``, and `windowAt(` on 2026-10-24
  (each match is checked: only event times sent to `createEvent`/`updateEvent` change, never
  `serverTime` or `from`/`to` query instants unless the test is about event times):
  `availability`, `cancel`, `entry-key`, `entry.live-refusals`, `entry.lookup`,
  `events.conflict-update`, `events.crud`, `events.search`, `events.ticket-limit`,
  `locations.crud`, `locations.delete` (template literal), `locations.legacy-address`,
  `locations.validation`, `orders.sales-closed`, `orders.seats`, `reports`, `reservations`,
  `seating.capacity`, `seating`, `seats.concurrency`, `venues-events.authz` (all
  `backend/test/integration/*.e2e-spec.ts`). Tests that insert a `Location` directly
  (`locations.legacy-address`, and any of `event-images.storage`, `events.crud`,
  `gate-check-in.constraints`, `live-codes.constraints`, `seat-holds.constraints`, and
  `setup/reset-db.ts` that do) set `timeZone: 'America/New_York'` and `timeZoneSource: 'DEFAULT'`
  (required after T008). Rerun the search afterwards: every remaining match is recorded here as
  not an event time. Run the whole Backend suite: green (the Backend still accepts any offset at
  this point).
  **Done**: `windowAt` and `atInstant` as above (a fall-back night takes the first of a repeated
  hour, a spring-forward night the next hour). Changed: `availability`, `orders.sales-closed`,
  `reservations` (`atInstant` for "now + 2 hours"), `events.search` (the same four instants in
  Eastern offsets), `locations.delete` (template literal), `seating.capacity`,
  `venues-events.authz`; the rest of the listed files send event times only through
  `windowAt`/`event()`, or already in `-04:00`. Direct `Location` inserts: only
  `locations.legacy-address` and `me-orders` (done in T008); `reset-db` truncates only. Search rerun
  2026-10-24, every remaining match is not an event time sent to `createEvent`/`updateEvent`:
  `entry-key` (`serverTime`), `entry.live-refusals` and `entry.lookup` (codes with Z),
  `events.conflict-update` and `events.crud` (assertions on stored instants), `events.search`
  (`from`/`to` query instants, unchanged), `locations.validation` (state ZZ), `orders.seats`,
  `seating`, `seats.concurrency` (section or ticket code Z), `demo-data` (SQL). Backend suite: 87
  suites, 786 tests, green.

**Checkpoint**: shared module, runner, storage, coordinates, finder, and seed image in place;
`npm test` green (T006's recorded multi-zone failures are fixed in Phases 7–9).

---

## Phase 3: User Story 4 - A Venue's Time Zone Is Worked Out From Its Address (P1)

**Goal**: FR-001 to FR-008, SC-006. **Independent Test**: spec US4.

### Tests for User Story 4 (write first, confirm they fail)

- [x] T016 [P] [US4] Create `backend/test/integration/venues.time-zone.e2e-spec.ts`:
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
  - an `ADMIN` venue whose address changes to one that derives the **same** zone keeps its zone
    and becomes `ADDRESS` (R7, review round 1 m1); with `timeZone` sent too, it stays `ADMIN`;
  - every response validates against the contract and carries `timeZone` and `timeZoneSource`.
  **Done**: failed first, 70 of 77 (commit 02045be; the 7 passing held already: an unknown
  `timeZone` property was refused as not whitelisted, an unmatched Kentucky address was
  `ADDRESS_NOT_FOUND`, and the 15/36 count of the shared table).
- [x] T017 [P] [US4] Create `backend/test/unit/venue-time-zone.spec.ts`: `decideZone` (pure,
  table-driven) for every row of R7's order: sent zone; verified match with a zone; match with
  `location: null`; finder `null`; save anyway in a one-zone and in a split state; and the update
  cases (no address change, same address, changed address, zone alone).
  **Done**: failed first (no `venue-time-zone` module; commit 02045be).

### Implementation for User Story 4

- [x] T018 [US4] Add `timeZone` (`IsOptional`, `IsIn(US_TIME_ZONES ids)`) to
  `create-location.dto.ts` and `update-location.dto.ts`; allow `timeZone` alone as a valid update.
  **Done**: `timeZone` on both DTOs, `@ValidateIf(!== undefined)` + `@IsIn` of the eight, so `null`
  is refused too; no rule stops `timeZone` alone on an update.
- [x] T019 [US4] Create `backend/src/locations/venue-time-zone.ts` (`decideZone`, R3, R4, R7) and
  use it in `LocationsService.create` and `update`, after `checkAddress`, which now returns
  `{ address, location }` with `location` beside the `CheckedAddress` spread into Prisma's `data`,
  never inside it (R1). Write `timeZone` and `timeZoneSource` on create, and on update only when
  R7 says so. Moving events comes in Phase 5; until then, an update that would change the zone of
  a venue that has events fails closed (an internal error, nothing written), so no event is ever
  left with a different local time; T026 replaces that branch. Run T016 and T017 until they
  pass.
  **Done**: T016 and T017 pass (88). Ten spec 013 tests saved a Kentucky address anyway, which
  FR-003 now refuses without a zone; they now send `timeZone: 'America/New_York'` (the service-level
  test passes R19's `fallbackToDefaultTimeZone`), as the Admin form will. Demo data passes
  `fallbackToDefaultTimeZone` already (T043 finishes R19). Backend suite then green (874 tests
  before that fix: only those 10 failed).

**Checkpoint**: every new venue has a zone, decided by the rules.

---

## Phase 4: User Stories 2 and 3 - Entering Times, and Daylight Saving, in the Backend (P1)

**Goal**: FR-018, FR-019, SC-007, and the conflict message of FR-022. **Independent Test**: spec
US2 scenario 7, US3 scenarios 6–8.

### Tests (write first, confirm they fail)

- [x] T020 [P] [US2] [US3] Create `backend/test/integration/events.time-zone.e2e-spec.ts`, at an
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
  - no offset (`2026-10-01T19:00:00`) and a date only (`2026-10-01`), for `startsAt` and for
    `endsAt`, on create and update → `400 VALIDATION_FAILED` naming the field, "must include a UTC
    offset" (R9, review round 1 S6), before the venue is looked up;
  - refusal order: a bad `locationId` is `404` before any zone check; `endsAt <= startsAt` is
    `400 VALIDATION_FAILED` first; a zone refusal comes before `CAPACITY_EXCEEDED` and
    `SCHEDULING_CONFLICT`; nothing is saved on any refusal;
  - `updateEvent`: only the sent time is checked; moving to a venue in another zone without both
    times → `400 VALIDATION_FAILED` with R9's message; with both, in the destination's offset →
    `200`; moving within the same zone without times → `200`, instants unchanged;
  - `SCHEDULING_CONFLICT`'s message reads "This venue is already committed from Oct 1, 2026,
    7:00 PM EDT to 10:00 PM EDT by 'X'…" (and MST at Phoenix), and for a conflicting event across
    midnight "… from Oct 1, 2026, 10:00 PM EDT to Oct 2, 2026, 1:00 AM EDT …" (R9, review round 1
    m12); `details` unchanged.
  **Done**: failed first, 23 of 33 (commit 428da28; the 10 passing check accepted times and the
  existing refusal order). Three cases had an end equal to the start, so the earlier window check
  answered first; their test data was fixed.
- [x] T021 [P] [US2] Update `backend/test/integration/events.conflict-contract.e2e-spec.ts` and
  any test asserting the old `UTC` conflict message to the new message.
  **Done**: `events.conflict-contract` asserts the exact new message; no other Backend test asserted
  the old one (the Admin app's conflict fixture is updated in Phase 7). Failed first.

### Implementation

- [x] T022 [US2] [US3] Add the offset-presence pattern to the `startsAt`/`endsAt` DTO checks
  (`create-event.dto.ts`, `update-event.dto.ts`, R9). Create `backend/src/events/event-time.ts`
  (`checkEventTime(field, sent, zone, venueName)`, R9) and call it from `EventsService` create and
  update in R9's order; add the venue-move rule. Run T020 until it passes.
  **Done**: the DTO pattern refuses a time without an offset (`must include a UTC offset`);
  `checkEventTime` runs after the 404 and before capacity; the shared module gained
  `skippedTimeMessage`, `formatLocalTime`, `formatLocalDateTime`, and `formatEventEnd` (tested
  first, in T020's commit). T020 passes.
- [x] T023 [US2] Change `SchedulingConflictException` to take the venue's zone and format the
  start with `formatEventTime` and the end with `formatTimeOfDay`, or `formatEventTime` when its
  local date differs (R9); add optional `details.event` (used in Phase 5). Run T020 and T021 until
  they pass, then the whole Backend suite.
  **Done**: T020 and T021 pass. Whole Backend suite: only `demo-data` failed (6), because demo data
  still sent `toISOString()`; it now states the same instants in the demo venues' Eastern offset
  (T043 makes them local times), and passes (8). 90 suites, 904 tests otherwise green.

**Checkpoint**: the Backend refuses every event time not stated in its venue's zone.

---

## Phase 5: User Story 5 - Changing a Venue's Time Zone (P2)

**Goal**: FR-009 to FR-013, SC-005. **Independent Test**: spec US5.

### Tests (write first, confirm they fail)

- [x] T024 [P] [US5] Create `backend/test/integration/venues.time-zone-change.e2e-spec.ts`:
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
  **Done**: 13 tests, all failed first (commit 78688a7). Two test bugs fixed while making them pass:
  a refunded order needs `refundedAt` (CHECK `order_refunded_at_matches_status`), and the deferred
  case's expected hour overflowed past 24.
- [x] T025 [P] [US5] Create `backend/test/integration/venues.time-zone-change.concurrency.e2e-spec.ts`
  (genuinely concurrent requests, each case repeated 10 times):
  - a zone change racing `createOrder` on one of the venue's events: either the order succeeds and
    the change is `409 TIME_ZONE_HAS_ORDERS`, or the change succeeds and the order is placed against
    the new instants; never both against the old state (check the stored rows);
  - a zone change racing `createEvent` at the same venue (time stated in the old zone's offset):
    either the event is created and moved with the others (its local time kept), or it is refused
    `UTC_OFFSET_MISMATCH` against the new zone; never an event saved with the old zone's reading
    after the change;
  - a zone change racing `updateEvent` of one of its events: no deadlock surfaces as `500`;
  - **two zone changes racing at one venue** (review round 1 M2): an explicit `timeZone:
    America/Chicago` against an address change that derives America/Denver, on a New York venue
    with a 7:00 PM event and no orders: whichever commits second converts from the zone the first
    one left, so the event's stored local time is 19:00 in the final zone, never 20:00 (and never
    left unmoved); the final `timeZone`/`timeZoneSource` are the second request's;
  - **two explicit zone changes racing** (Chicago and Denver): the same, 19:00 local in the final
    zone;
  - a zone change racing an event **delete** of a cancelled event without orders at the venue: no
    `404`/`500` from the zone change (review round 1 m2).
  **Done**: 7 cases, each 10 times, all failed first (commit 78688a7). Before T027, the event-create
  race failed for the reason R10 gives: an event created at the old offset was saved after the zone
  change without being moved (stored 18:00 in Central, not 19:00).

### Implementation

- [x] T026 [US5] Make `lockVenueAndEvents` also return `timeZone` and `timeZoneSource` from its
  locked `SELECT`, and take an option `{ allStatuses: true }` that locks every event of the venue,
  any status, in **one** query in id order; `LocationsService.update` uses it, layout saves keep
  the scheduled-only default; say in `backend/src/common/venue-lock.ts` why (R8, review round 2
  n5). Implement `moveEventsToZone` in
  `venue-time-zone.ts` and call it inside `LocationsService.update`'s transaction after
  `lockVenueAndEvents`, comparing with and converting from the **locked** zone (R8: orders, new moments, pairwise 60-minute check, `SET CONSTRAINTS "event_no_overlap"
  DEFERRED`, the writes); add the pre-lookup orders check for an explicit `timeZone`; remove T019's
  guard. Run T024 until it passes.
  **Done**: `lockVenueAndEvents` returns `timeZone`/`timeZoneSource` from its locked SELECT and
  takes `{ allStatuses: true }` (one query, id order; why in `venue-lock.ts`); `assertNoOrders` and
  `moveEventsToZone` in `venue-time-zone.ts`; the update compares with and converts from the locked
  zone; the explicit-zone orders check runs before the lookup; T019's guard is removed. T024 passes
  (13).
- [x] T027 [US5] Add `lockVenueShared(tx, ids)` to `backend/src/common/venue-lock.ts` (`FOR SHARE`
  in id order) and make `EventsService.create`/`update` run in one `LOCKING_TX` transaction that
  takes it first (R10: both venues on a move; re-read `locationId` after `lockEvent` and retry once
  if it changed). Make sure a `23P01` raised at commit maps to `409 SCHEDULING_CONFLICT` with
  `conflictingEvent: null`. Run T025 until it passes, then the whole Backend suite (including the
  existing `events.concurrency` and `seats.concurrency` tests).
  **Done**: `lockVenueShared` (FOR SHARE, id order); create and update in one `LOCKING_TX`
  transaction that takes it first (on update both venues, then `lockEvent`; retried when the event
  moved meanwhile, at most three attempts in all). A test added to T024's file commits two
  overlapping rows with the constraint deferred and passes the commit's error to
  `AllExceptionsFilter`: `409 SCHEDULING_CONFLICT`, `conflictingEvent: null` (it passed at once: the
  filter already matches `event_no_overlap` in the message). T024 and T025 pass (21); whole Backend
  suite green, `events.concurrency` and `seats.concurrency` included: 92 suites, 925 tests.

**Checkpoint**: zone changes keep local times and never move a sold event.

---

## Phase 6: User Stories 1 and 6 - Responses Carry the Zone; Filters by Venue Day (P1, P2)

**Goal**: FR-020, FR-021 (Backend side), R15, R16.

### Tests (write first, confirm they fail)

- [x] T028 [P] [US1] Create `backend/test/integration/events.date-filter.e2e-spec.ts`: with a 9:00
  PM PDT event on Oct 1 at a Los Angeles venue (Oct 2 04:00Z), a 7:00 PM EDT event on Oct 1, and an
  00:30 EDT event on Oct 2: `fromDate=2026-10-01&toDate=2026-10-01` returns the first two;
  `fromDate=2026-10-02` the third (and not the LA one); Honolulu and Anchorage cases; `fromDate`
  after `toDate` → `400`; `fromDate` with `from` → `400`; `from`/`to` unchanged.
  **Done**: 10 tests, 5 failed first (the parameters were unknown, so every query was refused; the 5
  refusal cases passed for that reason; commit 9e5a091). One test-data fix: the `from`/`to` window
  also caught the 04:30Z event.
- [x] T029 [P] [US1] [US6] Extend `me-orders.e2e-spec.ts`, `reports.e2e-spec.ts`,
  `entry.lookup.e2e-spec.ts`, and `entry.admit.e2e-spec.ts`: `OrderEvent.location.timeZone`,
  `EventSales.timeZone`, `EntryTicket.event.timeZone`, and `ENTRY_REFUSED` `OTHER_EVENT`'s
  `details.event.timeZone` are the venue's zone (a Phoenix venue in at least one case).
  **Done**: the 7 new or changed assertions failed first (commit 9e5a091). Two more existing exact
  assertions gained the field when the zone was sent: `me-orders` (each order's venue) and
  `entry.live-code` (the EntryTicket).

### Implementation

- [x] T030 [US1] Add `fromDate`/`toDate` to `list-events.query.ts` (`IsISO8601` date-only) and R15's
  wide window plus `localDate` filter in `EventsService.findAll`. Run T028 until it passes.
  **Done**: T028 passes.
- [x] T031 [US1] [US6] Add the zone to the my-orders mapping in `orders.service.ts`, to
  `reports.service.ts`, and to `entry.service.ts` (lookup query and refusal details). Run T029
  until it passes, then the whole Backend suite.
  **Done**: T029 passes; whole Backend suite: 93 suites, 938 tests, green after the
  `entry.live-code` assertion gained the zone (it was the one failure).

**Checkpoint**: the Backend side is complete; every response validates against the contract.

---

## Phase 7: User Stories 2, 3, 4, 5 - Admin App (P1)

**Goal**: FR-014 to FR-017, FR-020 to FR-024, FR-026. Fixtures use venues in Eastern, Arizona, and
Hawaii zones. Name each new file that asserts formatted times `*.tz.test.tsx` (R20 `--quick`).

### Tests (write first, confirm they fail)

- [x] T032 [P] [US2] [US3] Create `admin-app/test/event-form.tz.test.tsx` (mocked API): choosing an
  Eastern venue shows "Times are in the venue's time zone: Eastern Time (EDT)." (EST for a December
  date); typing 2026-10-01T19:00–22:00 sends `2026-10-01T19:00:00-04:00` and `…22:00:00-04:00`;
  switching to the Phoenix venue keeps the inputs and sends `-07:00`; 2027-03-14T02:30 shows R9's
  message and sends nothing; 2027-11-07T01:30 shows "Which 1:30 AM?" with the two options, refuses
  Save until chosen, and sends `-05:00` for EST; editing an event stored at `2027-11-07T06:30Z`
  shows 01:30 with EST chosen; editing any event shows its venue-local values; `LOCAL_TIME_SKIPPED`
  and `UTC_OFFSET_MISMATCH` from the API appear in the banner with every value kept; the conflict
  line shows "7:00 PM EDT – 10:00 PM EDT".
  **Done**: 12 tests; failed first (commit 5c86de4), pass after T035.
- [x] T033 [P] [US2] Create `admin-app/test/times.tz.test.tsx`: the event list, event page, venue
  page events, attendees' "checked in" time, and Reports' event dates show the exact venue-local
  strings with abbreviations for venues in three zones; Reports' "as of" ends with the process
  zone's abbreviation; the event search sends `fromDate`/`toDate` exactly as typed.
  **Done**: 9 tests; failed first (commit 5c86de4); one test-path fix (attendees are
  `/events/{id}/attendees`); pass after T036.
- [x] T034 [P] [US4] [US5] Create `admin-app/test/venue-time-zone.test.tsx`: the venue list's Time
  zone column and the venue page's "Time zone: Eastern Time, from the address." (all four sources);
  the form's select sends `timeZone` only when picked; after `ADDRESS_NOT_FOUND` in KY, Save anyway
  is refused by the form until Eastern or Central is chosen and then sends `timeZone`; in OH no
  question; `TIME_ZONE_REQUIRED` from the API shows the state's zones; on edit, picking another
  zone shows R14's note; `TIME_ZONE_HAS_ORDERS` (events listed as links), `EVENT_TIME_NOT_IN_ZONE`,
  and `SCHEDULING_CONFLICT` appear in the banner with every value kept; the saved notice names the
  zone and source; on edit, the select's first option reads "Keep Eastern Time (from the address)"
  and changes to "Work it out from the new address" once any address field differs (R14, review
  round 1 m3); on an edit of a KY venue stored in Eastern that is saved anyway, the state's radio
  group starts with Eastern selected (m4).
  **Done**: 18 tests; failed first except the 3 noted in commit 5c86de4; pass after T037.

### Implementation

- [x] T035 [US2] [US3] Change `admin-app/src/format.ts` (`when(iso, zone)`) and `EventForm.tsx`
  (R13). Run T032 until it passes.
  **Done**: `when(iso, zone)` and `until(start, end, zone)` (shared formatters); the form keeps
  local strings, resolves them in the chosen venue's zone (Eastern until one is chosen), shows the
  zone line, the skipped message (`data-testid=startsAt-skipped`), and the "Which 1:30 AM?" radio
  group, refuses Save before sending, and sends `toOffsetDateTime`; changing the venue keeps the
  strings and asks a repeated hour again. T032 passes.
- [x] T036 [US2] Change `EventList.tsx`, `EventDetail.tsx`, `LocationDetail.tsx`, `Attendees.tsx`,
  and `Reports.tsx` (R12, R15). Run T033 until it passes.
  **Done**: the event list (`formatEventDate`, `formatTimeOfDay` – `until`), event page, venue page,
  attendees, and Reports (event dates in `EventSales.timeZone`, "as of" `formatViewerTime` with the
  date); the search sends `fromDate`/`toDate`. T033 passes. Existing tests updated to the new
  behavior: `EventDetail.test` (the page's formatter), `search.test` (`fromDate`/`toDate`).
- [x] T037 [US4] [US5] Change `LocationForm.tsx`, `LocationList.tsx`, `LocationDetail.tsx`, and
  `ErrorBanner` if needed (R14), with existing classes only. Run T034 until it passes, then the
  whole Admin suite and the theme drift check.
  **Done**: Time zone select, split-state radio group (stored zone preselected on edit), the R14
  note, the saved notice's zone, the list column, the venue page line, and `TIME_ZONE_HAS_ORDERS`
  events as links in `ErrorBanner`; existing classes only (`field`, `field__hint`, `choice`,
  `note`). T034 passes; four `venue-address.test` cases now choose Eastern before saving a Kentucky
  address anyway, and expect the notice's zone. Whole Admin suite 239 tests green, the theme drift
  test included.

---

## Phase 8: User Story 1 - Customer App (P1)

**Goal**: FR-020 to FR-023 in the Customer app; SC-002, SC-003.

- [x] T038 [P] [US1] **Test first.** Create `customer-app/test/times.tz.test.tsx` and update
  `format.test.ts`, `filters.test.ts`, and every test T006 recorded: event cards (Events list and
  venue page), the event page, My tickets (start, ordered at, used at), the live entry code page,
  and the printable ticket show the exact venue-local strings with abbreviations for venues in
  three zones; a missing `location.timeZone` falls back to Eastern; the seat-cooldown message ends
  with the process zone's abbreviation; the filters send `fromDate`/`toDate` exactly as chosen.
  **Done**: 9 new tests, all failed first (commit 0da7a91), with `format.test`, `filters.test`, and
  `seat-holds.test` updated (the cooldown assertion lives there: it needs the seat flow).
  `browse.test`'s midnight case asserts dates only, which pass in every zone once formatting is the
  venue's, so it is unchanged.
- [x] T039 [US1] Change `customer-app/src/format.ts`, `filters.ts`, `EventCard.tsx`,
  `GetTickets.tsx`, `EventDetail.tsx`, `MyTickets.tsx`, `PrintTicket.tsx`, and `EntryCode.tsx`
  (R12, R15). Run T038 until it passes, then the whole Customer suite under the four zones
  (`npm run test:tz -- --zones …`): every T006 failure is gone.
  **Done**: T038 passes. Customer suite with `QP_TEST_TZ` set to America/New_York, UTC,
  America/Los_Angeles, and Pacific/Honolulu, 2026-10-24: 306 passed in each; every T006 failure is
  gone.

---

## Phase 9: User Story 6 - Ticket Booth App (P2)

- [x] T040 [P] [US6] **Test first.** Create `booth-app/test/times.tz.test.tsx`: the event picker,
  "Already used at", "Entry opens at", "For {event} on …, not this event" (with another venue's
  zone from `EntryTicket.event.timeZone` and from `details.event.timeZone`), and admit results show
  the exact venue-local strings with abbreviations; live code windows and countdowns unchanged
  (existing tests still pass).
  **Done**: 6 tests, all failed first (commit dc81176). Existing live code window and countdown
  tests unchanged and passing.
- [x] T041 [US6] Change `booth-app/src/format.ts`, `EntryResult.tsx`, `EventPicker.tsx`, and
  `App.tsx` (R12, R16). Run T040 until it passes, then the Booth suite.
  **Done**: `when(iso, zone)`; the picker uses each event's venue zone; `refusalText` takes the
  ticket's event zone (`EntryTicket.event.timeZone` or `details.event.timeZone`) for OTHER_EVENT and
  the gate event's zone for USED and NOT_OPEN; `EntryResult` takes the gate zone for an admit's
  already-used times. T040 passes; Booth suite 73 tests green.

---

## Phase 10: Demo data, docs, and cross-cutting checks

- [x] T042 **Test first.** Extend `backend/test/integration/demo-data.e2e-spec.ts` (R19): with the
  fake geocoder matching, both demo venues are `America/New_York`/`ADDRESS`; with it unavailable,
  both are `America/New_York`/`DEFAULT` and the run succeeds; the concert, comedy night, and gala
  start at 19:00, 20:00, and 19:00 local Eastern on their dates and end 3 hours later; "Demo
  Tonight" still starts about an hour after the run; a controller request can never use the
  fallback (a KY save anyway through the API is still `TIME_ZONE_REQUIRED`).
  **Done**: failed first on the local times (commit after bd13abd); the zone cases passed already
  through T019's internal option.
- [x] T043 Change `backend/src/scripts/demo-data.ts` (`atLocal`, `fallbackToDefaultTimeZone`, and
  every time, Demo Tonight's included, sent as `toOffsetDateTime(instant, venueZone)`, never
  `toISOString()`, R19) and `LocationsService.create`'s internal options. Run T042 until it
  passes.
  **Done**: `atLocal(days, 'HH:mm', zone)` (first of a repeated time, next hour if skipped) and
  every time sent as `toOffsetDateTime` in the venue's zone; Demo Tonight is now + 1 hour to + 4
  hours, an instant. `fallbackToDefaultTimeZone` has been passed since T019. T042 passes (10).
- [x] T044 [P] Update `README.md`: the `020` status row; "Today": every venue has a time zone from
  its address and every app shows event times in the venue's local time; `npm run test:tz`
  (`QP_TEST_TZ`), its relation to `019`'s `CALENDAR_TEST_TZ`, and why `TZ=` in Git Bash does not
  work on Windows; quickstart path B (host-run) for machines whose images do not build; the boundary data attribution ("Time zone boundaries:
  timezone-boundary-builder, © OpenStreetMap contributors, ODbL 1.0, via geo-tz").
  **Done**: the `020` status row and status line, a "Today" sentence, `npm run test:tz` with
  `QP_TEST_TZ`, its relation to `CALENDAR_TEST_TZ`, and why `TZ=` in Git Bash does not reach Node on
  Windows (under Run the tests), the host-run path (under Start the system), and a "Venue time
  zones" section with the boundary data attribution.
- [x] T045 [P] Grep app sources for `toLocaleString(`, `toLocaleDateString(`,
  `toLocaleTimeString(`, `getTimezoneOffset(`, and `new Date(` with a local string or
  `(y, m, d)` arguments (ground rules); each remaining use is not an event time (record which) or is
  replaced.
  **Done** (2026-10-24, `admin-app/src`, `customer-app/src`, `booth-app/src`, `packages/shared/src`,
  `backend/src`): nothing to replace. Every remaining `toLocaleString(` formats a number (counts,
  capacities, seats); no `toLocaleDateString(`, `toLocaleTimeString(`, or `getTimezoneOffset(`
  remains; every remaining `new Date(` is the current time, an instant from the API or a DTO already
  required to carry an offset, milliseconds, or `Date.UTC` arithmetic (customer `filters.ts` day
  check, demo data, the shared module). The calendar files (`019`) take instants only.
- [x] T058 (added in spec review round 2, N2) **Test first.** Create
  `scripts/test/run-host.test.mjs` (`node --test`): `node scripts/run-host.mjs --print
  --backend-tz America/Los_Angeles` prints, without starting anything, the setup steps in order
  (shared build, `prisma generate`, `migrate deploy`, seed; demo data only with `--demo-data`),
  each with its environment: the seed step `KEYCLOAK_URL=http://localhost:8080` and
  `KEYCLOAK_HEALTH_URL=http://localhost:9000`; the `migrate deploy` and demo-data steps the same
  `DATABASE_URL` and `ADDRESS_GEOCODER_URL` as the Backend (review round 3, q1). With
  `--geocoder-url http://127.0.0.1:9`, the Backend and the demo-data step get that
  `ADDRESS_GEOCODER_URL` instead of the Census default (quickstart S11, path B; review round 3,
  P1). Then the four children: the Backend with `DATABASE_URL`, `OIDC_ISSUER`, `OIDC_JWKS_URL` (localhost),
  `OIDC_AUDIENCE`, `CORS_ORIGINS`, `ADDRESS_GEOCODER_URL`, and `TZ=America/Los_Angeles`, and each app
  with `VITE_API_BASE_URL`, `VITE_OIDC_AUTHORITY`, and its own `VITE_OIDC_CLIENT_ID` on its own
  port (5173, 5174, 5175); every value matches `docker-compose.yml`'s defaults with `localhost` in
  place of service names. See it fail, then create `scripts/run-host.mjs` (explicit environment per
  child; output prefixed by name; waits for `/health`; Ctrl+C stops all four; `--demo-data`;
  `--geocoder-url`) and run it until it passes. Run it for real once in quickstart path B and record the result here.
  **Done**: the test failed first (7 of 8; commit 2ec303f) and passes (8). The real run in path B is
  part of the running-system gate (T053), **left for Mahdi's walk**: it needs `main`'s stack stopped
  at an agreed time.
- [x] T046 Run `npm run ci` and `npm run test:tz`; everything passes. Fix before the reviews.
  **Done** 2026-10-24 (at a78c00e): `npm run ci` green in 404 s (scripts/test 44, shared 590,
  backend 940 in 93 suites, admin 239, customer 306, booth 73, seed 8; the closing Los Angeles
  `--quick` run passed in all four front-end workspaces). Then one more change (f7c9747, R14's note
  only at a venue with events, test first), and `npm run test:tz`: every run passed: shared 590,
  backend unit 139, admin 241, customer 306, booth 73, in each of America/New_York, UTC,
  America/Los_Angeles, and Pacific/Honolulu.

---

## Phase 11: Independent reviews (at least two rounds, Mahdi 2026-10-24)

- [ ] T047 **Review round 1**: a Claude session that did not write the code reviews the branch
  locally against the spec, plan, constitution 3.4.1, and #42 (Constitution III), including the
  quality-gate 7 list. Fix every finding in `Review 020:` commits. Record the findings (must,
  should, minor), fixes, and anything left open with the reason, here.
  **Left for Mahdi** (the independent review rounds are run outside the implementing session).
- [ ] T048 **Review round 2**, by another session that did not write the code (and not the round 1
  reviewer if possible), on the fixed branch. Fix and record as T047. **If round 2 finds anything
  more than minor issues, run round 3, and so on, until a round finds only minor issues**; record
  each round here.
  **Left for Mahdi**, as T047.

---

## Phase 12: Verification, several times (after the last code change)

- [x] T049 Run `npm run ci` locally from a clean `npm ci`; green. Record the date, the commit, and
  each workspace's test count and coverage.
  **Done** 2026-10-24, commit c6b6b73, in a fresh clone of the branch (this checkout's `npm ci` is
  blocked by the leftover Vite server, T001): `npm ci` 22 s, then `npm run ci` green in 407 s.
  Tests: scripts/test 44, shared 590, backend 940 (93 suites), admin 241, customer 306, booth 73,
  seed 8; the closing Los Angeles `--quick` run: shared 122, admin 21, customer 9, booth 6, all
  passed. Line coverage: shared 93.13%, backend 97.01%, admin 97.05%, customer 97.46%, booth 92.28%,
  seed 71.25% (unchanged; the floor is not enforced until `010`).
- [ ] T050 **Three times in a row** (flake check), with no change in between, run each affected
  suite and record the three results (passed/failed, counts, duration) in a table here:
  `npm run test --workspace @queuepass/shared`, `… @queuepass/backend`, `… @queuepass/admin-app`,
  `… @queuepass/customer-app`, `… @queuepass/booth-app`, and `node --test "scripts/test/*.test.mjs"`.
  Then run `npm run test:tz` (four zones) and record its zone × workspace table, and run the
  Backend's **full** suite once more in America/Los_Angeles (`node scripts/test-tz.mjs --zones
  America/Los_Angeles --backend-full`, or PowerShell `$env:TZ='America/Los_Angeles'; npm run test
  --workspace @queuepass/backend`), because locally it otherwise runs in New York, the demo
  venues' zone, and in CI in UTC (R20, review round 1 m13). Any failure, even once: find the
  cause, fix it, and restart T049–T050.
  **Run 2026-10-24/25, same clone, commit c6b6b73, no change in between.** Three runs in a row,
  every one passed: shared 590/590/590 (19 s, 20 s, 19 s); backend 940/940/940 in 93 suites (135 s,
  134 s, 137 s); admin 241 ×3 (29 s each); customer 306 ×3 (26 s, 25 s, 25 s); booth 73 ×3 (33 s
  each); `node --test scripts/test/*.test.mjs` 44 ×3 (44 s, 44 s, 43 s). `npm run test:tz`: all 20
  runs passed (shared 590, backend unit 139, admin 241, customer 306, booth 73 in each of
  America/New_York, UTC, America/Los_Angeles, Pacific/Honolulu). `node scripts/test-tz.mjs --zones
  America/Los_Angeles --backend-full`: **run 1 failed one test**, `CORS and API documentation ›
  serves the committed contract byte for byte` (`cors-docs.e2e-spec.ts`), with `read ECONNRESET` on
  `GET /docs/openapi.yaml` (939 of 940 passed; full log kept in the session scratchpad,
  `logs/t050/backend-full-la-run1-FAIL-ECONNRESET.log`). It did not reproduce: that file passed 5
  times in a row in Los Angeles, and run 2 of the full suite passed, 940/940 in 93 suites (124 s).
  The test reads a static file the feature does not touch; a connection reset while reading the 138
  KB answer points at the test transport, not at time zones, but the cause was not found. **Left
  open for Mahdi**: the ground rule says to fix and restart T049–T050 after any failure.
- [ ] T051 Report coverage for every workspace in the PR description; each new file is covered by
  its tests, and each workspace stays at or above 80% lines (Constitution VI, `010`).
  Coverage at c6b6b73 (T049): shared 93.13%, backend 97.01%, admin 97.05%, customer 97.46%, booth
  92.28%. New files: `time-zone.ts` 100%, `venue-time-zone.ts` 100%, `event-time.ts` 100%,
  `venue-lock.ts` 100%, `time-zone-finder.ts` 83% (the logged `catch`), demo data 84%; the changed
  front-end files 97.8–100%. **Left for the PR description** (T056).
- [ ] T052 Running-system gate, part 1: quickstart **S1**, the migration on a copy of the running
  stack's real data. Record the event count and checksums before and after, the venue zone query,
  and `condeferrable`.
  **Left for Mahdi** (running-system gate, quickstart S1, at a time agreed for `main`'s stack).
- [ ] T053 Running-system gate, part 2. Path A where images build (`docker compose up --build`
  from a fresh clone of the branch); otherwise quickstart **path B**: at a time agreed with whoever
  uses `main`'s stack, stop it, start the gate's own `docker compose -p qp020gate up -d database
  keycloak`, and run `node scripts/run-host.mjs --backend-tz America/Los_Angeles --demo-data`
  (T058); at the end `docker compose -p qp020gate down -v` and restart `main`'s stack. Record
  T013's image checks as "to do where images build", and S2's container ICU check from a cached
  `node:22-alpine`, or "to do" if none is cached. Walk quickstart **S2–S12** in the
  browser for the **two venues in different zones** (Eastern and Arizona or Mountain) and the
  **DST dates** (2027-03-14 2:30 AM, 2027-11-07 1:30 AM), in the laptop's zone; sign in, use, and
  sign out of all three apps. Then **Mahdi** repeats the steps marked **(two zones)** by hand with
  Chrome DevTools → Sensors → time zone override, in UTC and America/Los_Angeles; record his
  results here. Record everything, with anything unexpected.
  **Left for Mahdi** (browser walk and the second browser zones; `scripts/run-host.mjs` is ready,
  T058). T013's image checks are "to do where images build".

---

## Phase 13: Pull request

- [ ] T054 Mark every task done here, with its results, and update the README status row.
  Tasks recorded as they were done; the README status row says 47/58 done, reviews and walk pending.
  **Left for Mahdi** to finish after the reviews and the walk.
- [ ] T055 Open the follow-up issue (research R18): "Contract: make the 020 time-zone fields
  required" (`Location.timeZone`, `Location.timeZoneSource`, `OrderEvent.location.timeZone`,
  `EventSales.timeZone`, `EntryTicket.event.timeZone`), to do after this PR merges.
  **Left for Mahdi** (opens an issue on GitHub).
- [ ] T056 Push `020-venue-time-zones-impl` and open the PR (only after the spec and plan PR has
  merged and the branch is rebased onto `main`, ground rules). The description says `fixes #42`,
  lists the review rounds with their findings and anything left open, the three-run and four-zone
  results (T050), the running-system results (T052, T053), coverage (T051), and the shared surface
  touched (every member approves).
  **Left for Mahdi** (push and pull request).
- [ ] T057 Wait for **CI green on GitHub** for the PR's last commit (the required `test` check,
  `011`); a red run is fixed, never skipped (quality gate 4). Merge only when green and approved.
  **Left for Mahdi** (CI on GitHub).

## Dependencies

- T058 (the host-run script) comes before T053, which uses it.
- Phase 2 blocks everything. Phase 3 before Phase 5 (zone decisions before zone changes); Phase 4
  before Phase 5 (event times and the conflict message before moving events). Phase 6 after
  Phase 2. Phases 7–9 after Phases 3–6 (they need the response fields and refusals); they are
  independent of each other. Phase 10 after Phases 3–9. Phases 11–13 in order, last.
- [P] tasks touch different files and can run in parallel.
