# Implementation Plan: Venue Time Zones

**Branch**: `020-venue-time-zones-spec` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#42](https://github.com/Trughouse-Holdings/QueuePass/issues/42)

**Input**: Feature specification from `specs/020-venue-time-zones/spec.md`

## Summary

- **Where the zone comes from**: the Census answer `013` already reads carries the matched place's
  coordinates (checked live, 2026-10-24); the Backend maps them to one of eight US zones with
  `geo-tz` 8.1.10's offline "now" dataset (MIT code, ODbL boundary data, Backend-only), behind a
  `TimeZoneFinder` interface. Without a usable place (an address saved anyway), the state decides
  when it has one zone; in the 15 split states the admin must choose (`400 TIME_ZONE_REQUIRED`). An
  admin can always choose explicitly (`timeZone`), recorded as `ADMIN` (research R1–R4, R7).
- **Storage**: `Location.timeZone` (one of eight IANA names, CHECK) and `timeZoneSource` (enum
  `ADDRESS | STATE | ADMIN | DEFAULT`). Event instants stay UTC `timestamptz`. The migration gives
  existing venues `America/New_York`/`DEFAULT`, moves no event, and makes `event_no_overlap`
  deferrable (R5, R6).
- **Zone change**: under the existing venue lock, refused on any order (`409 TIME_ZONE_HAS_ORDERS`),
  on a skipped or repeated local time (`409 EVENT_TIME_NOT_IN_ZONE`), or on a broken 60-minute rule
  (`409 SCHEDULING_CONFLICT`); otherwise every event keeps its local times and all move in one
  transaction, checked by the deferred constraint at commit (R8).
- **Event times in the API**: still RFC 3339 with an offset; the offset must be the venue's at that
  local time (`400 UTC_OFFSET_MISMATCH`, which also refuses `Z`), a skipped local time is
  `400 LOCAL_TIME_SKIPPED`, a repeated one is chosen by its offset. Moving an event to a venue in
  another zone must send both times. Event writes lock the venue row `FOR SHARE` first, so the zone
  checked is the zone saved (R9, R10).
- **One shared time module** (`packages/shared/src/time-zone.ts`, `Intl` only, no date library):
  the zone list, the state table, local↔instant conversion with DST gaps and overlaps, and the
  formatters ("Oct 1, 2026, 7:00 PM EDT") used by the Backend and all three apps (R11).
- **Apps**: every event time shown in its venue's zone with the abbreviation; the event form reads
  `datetime-local` in the venue's zone, refuses skipped times, and asks about repeated ones; the
  venue form and pages show and correct the zone; date filters use the venue's local day
  (`fromDate`/`toDate`); the booth formats in the event's zone; countdowns unchanged (R12–R17).
- **Contract 1.13.0** in this PR (rebased onto `019`'s 1.12.0): `UsTimeZone`, `TimeZoneSource`, `timeZone` on `Location`,
  `LocationInput`, `LocationUpdate`, `OrderEvent.location`, `EventSales`, `EntryTicket.event`;
  `fromDate`/`toDate`; `EventTimeRejected`; five codes (also in `ERROR_CODES`). New response
  fields not `required`, so `main` stays green; no new operation, so no `x-planned` (R16, R18).
- **Testing several times** (Mahdi, 2026-10-24): exhaustive DST conversion tests for seven zones;
  every app suite and the Backend's unit tests run under four device zones (`npm run test:tz`);
  CI reruns the time tests in America/Los_Angeles; each affected suite run three times in a row
  before the PR; two independent review rounds at least; the migration run on a copy of real data;
  the browser check repeated for two zones and a DST date (R20, R21, tasks.md ground rules).

**Merge order with `019`**: `019`'s spec PR (#82) merged first (`main` 17ad895, contract 1.12.0,
`address` added to `OrderEvent.location`). This branch is rebased onto it, takes **1.13.0**, keeps
both `OrderEvent.location` additions (`address` from `019`, `timeZone` from this feature), and
reran `npm run generate:api` and `node scripts/check-contract-drift.mjs` (research R18). `019`'s
Customer app `TZ` pin stays; the multi-zone runs override it with `QP_TEST_TZ` (research R20).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: one new Backend dependency, `geo-tz` 8.1.10 (research R1, Principle VIII
justification in Complexity Tracking). Everything else uses what is there: `Intl` (Node 22 full
ICU, browsers), Prisma 6, NestJS 11, `openapi-fetch`.

**Storage**: PostgreSQL 17. Two columns, one enum type, one CHECK, and the overlap constraint
re-created as deferrable, in one migration ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation (zone decisions,
zone changes, event time refusals, date filters, concurrency, the migration on a pre-020 database);
Backend unit tests for `GeoTzFinder` (real data, offline), `CensusGeocoder` coordinates, and the
three lists agreeing; shared Vitest exhaustive conversion and formatting tests; Admin, Customer,
and Booth Vitest + React Testing Library with fixtures in several zones and exact strings. A root
`scripts/test-tz.mjs` runs the suites per device zone. Browser checks in
[quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop.

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: a zone lookup under 1 ms after the first (measured, R1); one extra row lock
(`FOR SHARE`) per event write; a zone change moves a venue's events in one transaction (tens of
rows).

**Constraints**: event instants never move except through a zone change with no orders
(Constitution IV, FR-027); the viewer's device zone never affects a shown or stored time (SC-002);
no outside call beyond `013`'s existing address lookup; no new theme values (`012` drift check).

**Scale/Scope**: 0 new operations; 6 changed schemas; 2 new schemas; 1 new response; 2 new query
parameters; 5 new error codes; 1 migration; 1 new Backend dependency; 1 new shared module; 1 root
test script; 0 new environment variables or services.

## Constitution Check

Evaluated against constitution **v3.4.1**. No amendment: the `020` roadmap row ("Every venue has a
time zone, worked out from its checked address; event times are shown and entered in the venue's
local time, with the zone made clear, in every app") already describes this feature, and its
dependencies (`002`, `003`, `013`) are on `main`.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.13.0 and regenerated types in this PR, before any code; drift check passes. Every changed operation declares its new errors (`AddressRejected` example, `EventTimeRejected`, `updateLocation` `409` examples). Five codes in the standard envelope and in `ERROR_CODES`. Apps call through the generated types; no new operation, so the route-coverage test is unaffected. |
| **Quality gate 2 (contract before code)** | — | **PASS** | `contracts/openapi.yaml`, `api-schema.ts`, and `errors.ts` change in this PR only; the implementation does not change the contract except the follow-up in R18, a separate PR. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, volume, or variable. `geo-tz`'s data ships in the package, so the Backend image works offline. The migration runs at startup. Seed unchanged; demo data works offline (R19). |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #42; spec and plan on `020-venue-time-zones-spec`, independently reviewed (at least two rounds, Mahdi 2026-10-24) before the PR; implementation on `020-venue-time-zones-impl` in a fresh session, `fixes #42`. Commits cite `Spec 020`/`Plan 020`/`Tasks 020`. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | The Backend decides every zone and refuses every bad event time; the apps' checks are previews using the same shared code. Guarantees: CHECK on the zone, enum on the source, NOT NULL with no default; the zone change under `lockVenueAndEvents` (orders lock their event, so none slips in); event writes lock the venue `FOR SHARE` (R10); the 60-minute rule by `event_no_overlap`, now checked at commit during a zone change (R8). Refusals keep every entered value in the apps. |
| **V. Sign-In Everywhere** | PASS | **PASS** | No new route; roles unchanged (`queuepass-admin` for venue and event writes). |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in tasks.md and are seen to fail. Persistence, migration, and constraints on real PostgreSQL; boundaries on both sides (every minute of DST days; 59/60-minute gaps after a zone change); concurrency with genuinely concurrent requests (zone change vs order, zone change vs event create). Every affected suite three times in a row, and under four device zones, before the PR; CI reruns the time tests in a second zone. Coverage floor per workspace (`010`): new code is covered by its tests; the PR reports coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | Text only: zone names, abbreviations, a radio group for a repeated time, a select for the zone. Existing classes (`.field`, `.note`, `.pill`, banners); no new CSS values. |
| **VIII. Staged Simplicity** | PASS | **PASS** | One dependency, justified (Complexity Tracking). No coordinates stored, no per-event zone, no viewer-zone preference, no bulk re-derivation (spec Out of Scope). One internal-only option (`fallbackToDefaultTimeZone` for demo data, next to `013`'s `whenServiceUnavailable`) that no request can set. No control deferred. |
| **Security** | PASS | **PASS** | No secret or key. Coordinates are used once and not stored or logged. The new dependency runs offline on data inside the package. |
| **Shared surface** | — | **Needs every member's approval** | This PR touches `contracts/openapi.yaml`, `packages/shared/src/api-schema.ts`, and `packages/shared/src/errors.ts`. The implementation touches `packages/shared/` (the time module), `backend/prisma/` (migration), and the root `package.json` (`test:tz`, and `npm test`'s extra step). |

## Project Structure

```text
specs/020-venue-time-zones/
├── spec.md, plan.md, research.md (R1–R21), data-model.md, quickstart.md (S1–S12), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                                     # 1.13.0 (this PR)
packages/shared/src/~ api-schema.ts, ~ errors.ts              # this PR (R18)
```

Implementation (`020-venue-time-zones-impl`; `+` new, `~` changed):

```text
package.json~                                   # test:tz; npm test reruns the time tests in LA (R20)
scripts/+ test-tz.mjs                           # runs suites per device zone, from Node (R20)
scripts/test/+ test-tz.test.mjs                 # the script's own tests (zones, build step, exit codes)
scripts/test/+ seed-image.test.mjs              # the seed image installs only its workspaces (R1)
scripts/seed/~ Dockerfile                       # npm ci for the seed only; no shared; geo-tz guard (R1)
scripts/+ run-host.mjs                          # quickstart path B: Backend + apps from the host (R21)
scripts/test/+ run-host.test.mjs                # its --print output (T058)
README.md~                                      # 020 row; zones; test:tz; geo-tz/ODbL attribution

packages/shared/src/+ time-zone.ts              # R2, R3, R11
packages/shared/src/~ index.ts                  # export it
packages/shared/test/+ time-zone.test.ts        # R20 exhaustive DST tests

backend/package.json~                           # geo-tz 8.1.10
backend/+ jest.unit.config.ts                   # unit tests without Testcontainers (R20)
backend/prisma/~ schema.prisma                  # TimeZoneSource, Location.timeZone/Source
backend/prisma/migrations/+ <ts>_venue_time_zones/migration.sql   # R6
backend/src/address/~ address-geocoder.ts, ~ census-geocoder.ts   # match.location (R1)
backend/src/address/+ time-zone-finder.ts       # TIME_ZONE_FINDER, GeoTzFinder (R1)
backend/src/address/~ address.module.ts         # provide the finder
backend/src/locations/~ locations.service.ts    # R3, R4, R7, R8
backend/src/locations/+ venue-time-zone.ts      # decideZone, moveEventsToZone (R3, R8)
backend/src/locations/dto/~ create-location.dto.ts, ~ update-location.dto.ts   # timeZone
backend/src/events/~ events.service.ts          # R9, R10, R15
backend/src/events/+ event-time.ts              # checkEventTime (R9)
backend/src/events/~ scheduling-conflict.exception.ts   # venue-local message, details.event
backend/src/events/dto/~ list-events.query.ts   # fromDate, toDate
backend/src/common/~ venue-lock.ts              # zone under the lock, all events in one
                                                #   ordered lock, lockVenueShared (R8, R10)
backend/src/orders/~ orders.service.ts         # my orders: OrderEvent.location.timeZone (R16)
backend/src/reports/~ reports.service.ts        # EventSales.timeZone (R16)
backend/src/entry/~ entry.service.ts            # EntryTicket.event.timeZone, details.event (R16)
backend/src/scripts/~ demo-data.ts              # atLocal, fallbackToDefaultTimeZone (R19)
backend/test/setup/~ fake-geocoder.ts, ~ fixtures.ts    # coordinates; windowAt with offsets
backend/test/unit/+ time-zone-finder.spec.ts, + time-zone-lists.spec.ts, ~ census-geocoder.spec.ts
backend/test/integration/+ venues.time-zone.e2e-spec.ts, + venues.time-zone-change.e2e-spec.ts,
    + venues.time-zone-change.concurrency.e2e-spec.ts, + events.time-zone.e2e-spec.ts,
    + events.date-filter.e2e-spec.ts, + migration.time-zones.e2e-spec.ts, ~ (tests sending Z)

admin-app/src/~ format.ts; pages/~ EventForm.tsx, EventList.tsx, EventDetail.tsx,
    LocationForm.tsx, LocationList.tsx, LocationDetail.tsx, Attendees.tsx, Reports.tsx
admin-app/test/+ event-form.tz.test.tsx, + venue-time-zone.test.tsx, + times.tz.test.tsx
customer-app/src/~ format.ts, filters.ts; components/~ EventCard.tsx, GetTickets.tsx;
    pages/~ EventDetail.tsx, MyTickets.tsx, PrintTicket.tsx, EntryCode.tsx
customer-app/~ vitest.config.ts                 # TZ: QP_TEST_TZ || America/New_York (R20)
admin-app/~, booth-app/~, packages/shared/~ vitest.config.ts   # TZ from QP_TEST_TZ when set (R20)
customer-app/test/+ times.tz.test.tsx; ~ format.test.ts, filters.test.ts
booth-app/src/~ format.ts, EntryResult.tsx, EventPicker.tsx, App.tsx
booth-app/test/+ times.tz.test.tsx
```

**Structure Decision**: the existing monorepo layout. The time module lives in `packages/shared`
because the Backend's refusals and the apps' previews must agree (Constitution IV), as `013`'s
`US_STATES` and `formatAddress` do.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| `geo-tz` dependency (72 MB in the Backend image only, 29 packages; the seed image installs only its own workspaces, with a guard and a test, R1) | FR-002: the zone is worked out from the address (Mahdi). Official boundaries matter at US county-line borders, some near Louisville (R1). | `tz-lookup` is 88 KB but its own README reports 5–10% disagreement on inhabited points, worst near borders; a hand-kept county table is maintenance we would own; the state alone is wrong in 15 states. |
| `event_no_overlap` made `DEFERRABLE INITIALLY IMMEDIATE` | A zone change moves all of a venue's events; checked per statement, an intermediate state can overlap though the final one does not (R8). | Ordering the updates fails when shifts differ across DST dates; a temporary status flip would weaken the rule mid-transaction. Behavior for every other write is unchanged. |
| Event writes lock the venue `FOR SHARE` | The zone used to check an event time must be the zone it is saved under, under concurrency (Constitution IV, R10). | No lock leaves a race with a zone change; `FOR UPDATE` would serialize all event writes at a venue. |
| `fromDate`/`toDate` on `listEvents` | Date filters must agree with the dates shown when venues are in different zones (FR-020). | Converting the viewer's day to instants is wrong for venues in other zones (US1 scenario 6). |
| CI reruns time tests in America/Los_Angeles | CI is UTC, the one zone where "local time read as UTC" bugs pass (R20). | A full four-zone CI matrix quadruples CI time for tests that do not depend on the device zone. |
