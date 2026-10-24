# Research: Venue Time Zones

Decisions for [plan.md](./plan.md). Each has a decision, its rationale, and the alternatives
considered. Facts marked "checked on 2026-10-24" were run in this session.

## R1. The zone comes from the address service's coordinates, looked up offline with `geo-tz`

**Decision**: The Census Geocoder answer that `013` already reads carries the matched place:
`addressMatches[i].coordinates = { x: <longitude>, y: <latitude> }`. `CensusGeocoder` stops
discarding it: a `match` result gains `location: { latitude, longitude } | null` (`null` when the
two numbers are missing or not finite; that is not a failure). When several entries share the one
distinct `matchedAddress`, the first entry's coordinates are used. Nothing else about the address
check changes, and the coordinates are never stored (spec Out of Scope, `013` Out of Scope):
`LocationsService.checkAddress` returns `{ address, location }`, with `location` **beside** the
`CheckedAddress` that is spread into `prisma.location.create`/`update`, never inside it (Prisma
refuses unknown fields).

The Backend turns the coordinates into a zone with a new dependency, **`geo-tz` 8.1.10**, using its
"same since now" dataset (`geo-tz/dist/find-now`), behind one interface:

```ts
export const TIME_ZONE_FINDER = Symbol('TIME_ZONE_FINDER');
export interface TimeZoneFinder {
  /** The US zone at this place, or null when the place has none on US_TIME_ZONES (R2). */
  zoneAt(latitude: number, longitude: number): UsTimeZone | null;
}
```

`GeoTzFinder` is the only implementation: it checks that latitude is within [-90, 90] and
longitude within [-180, 180] (`find` throws "Invalid latitude/longitude" otherwise), calls
`find(lat, lon)` inside `try`/`catch`, and returns the first result that is on `US_TIME_ZONES`
(R2), else `null`; any error is logged at `warn` and gives `null`, so the state rule (R3) applies
instead of a `500`. No network call: the boundary data ships inside the package. `find-now` reads
its data file with a synchronous `readSync` on a cache miss (a few milliseconds inside a request)
and keeps decoded tiles in an unbounded `Map`; venues are US-only, so the cache stays small
(an independent review measured RSS 33 → 48 MB after about 150 US lookups).

**Checked on 2026-10-24** (live Census service; `geo-tz` 8.1.10 installed in a scratch folder,
outside the repository):

| Address (Census match) | Coordinates (lat, lon) | `find-now` |
|---|---|---|
| 430 W VINE ST, LEXINGTON, KY 40507 | 38.0494, -84.5010 | America/New_York |
| 937 PHILLIPS LN, LOUISVILLE, KY 40209 | 38.1941, -85.7389 | America/New_York |
| 201 E JEFFERSON ST, PHOENIX, AZ 85004 | 33.4465, -112.0706 | America/Phoenix |
| 1701 BRYANT ST, DENVER, CO 80204 | 39.7459, -105.0190 | America/Denver |
| 111 S GRAND AVE, LOS ANGELES, CA 90012 | 34.0556, -118.2490 | America/Los_Angeles |
| 777 WARD AVE, HONOLULU, HI 96814 | 21.2997, -157.8520 | Pacific/Honolulu |
| 1 E GRAND AVE, CHICAGO, IL 60611 | 41.8916, -87.6266 | America/Chicago |
| 600 OCEAN DR, MIAMI BEACH, FL 33139 | 25.7757, -80.1317 | America/New_York |

Border and split-state points (coordinates of the town): Indianapolis, Detroit, Knoxville →
America/New_York; Tell City IN, Pensacola FL, Nashville TN, Menominee MI, Garden City KS,
Bismarck ND → America/Chicago; El Paso TX, Boise ID, Ontario OR, Rapid City SD, Window Rock AZ
(Navajo Nation, observes daylight saving), West Wendover NV → America/Denver; Anchorage, Juneau →
America/Anchorage; Adak → America/Adak; a point in the Atlantic (30, -70) → `Etc/GMT+5` (not on
the list, so `null`). The full dataset (`geo-tz/dist/find-1970`) returns America/Kentucky/Louisville,
America/Indiana/Tell_City, America/Boise, and so on for the same points; `find-now` merges zones
whose rules agree from now on into the most populous one, so every US land point we tried
(about 80, in review round 1) comes back as one of the eight zones in R2. Not every point does:
Toronto (43.6532, -79.3832) gives America/New_York (merged), a point by Lubec ME (44.86, -66.98)
gives America/Halifax, one near the Northwest Angle (49.36, -95.07) America/Winnipeg, and San Juan
PR America/Caracas; anything off the list falls back to the state (R3), and an admin can correct
a wrong-but-listed answer (R4). 100 lookups took under 1 ms after the first; the process used
about 53 MB.

**Package facts** (`npm view`, 2026-10-24): `geo-tz` 8.1.10, MIT, last published 2026-10-12, 4
direct dependencies (`pbf`, `geobuf`, `@turf/helpers`, `@turf/boolean-point-in-polygon`), 29
packages installed in all, 72 MB unpacked (three datasets; `find-now` reads only
`timezones-now.geojson.*`, 15.9 MB). The boundaries come from timezone-boundary-builder
(OpenStreetMap data, Open Database License 1.0): the README gains an attribution line (tasks.md).
`npm ci` prints `npm warn deprecated text-encoding@0.6.4` for one transitive dependency; it is
harmless (not loaded by `find-now`).

It is a **Backend-only** dependency: no front end imports it. The front-end images install every
workspace only in their discarded build stages. The **seed image** (`scripts/seed/Dockerfile`) is
one stage that runs `npm ci` for every workspace, so it would carry `geo-tz` too; it changes to
`npm ci --ignore-scripts --workspace @queuepass/seed --workspace @queuepass/shared
--include-workspace-root` (the root brings TypeScript, which builds `packages/shared`), and its next
line fails the build if `node_modules/geo-tz` exists. A `scripts/test` test reads the Dockerfile
and fails if the `npm ci` line installs any other workspace or the guard is missing. So the
Backend image grows by about 72 MB and no other image does, as Mahdi approved (review round 1,
S3).

**Rationale**: Mahdi decided the zone is worked out from the address (2026-10-24). The place is
already in the answer `013` reads, so no new outside call, key, or failure mode is added, and the
Backend still works offline for everything but new addresses (as in `013`). `geo-tz` uses the
official zone boundaries, which matter in the US exactly where it is hard: Kentucky, Indiana,
Tennessee, and Florida split along county lines that run through populated areas, some near
Louisville. Its `now` dataset answers with the eight zones the product shows, so no mapping table
of legacy names (America/Indiana/Knox …) is needed. Updates come through ordinary `npm` upgrades;
a unit test pins the table above, so an upgrade that changes an answer fails visibly.

**Approved by Mahdi** (2026-10-24): `geo-tz`, about 72 MB in the Backend image only, with the
ODbL attribution in the README.

**Principle VIII**: one dependency, justified by FR-002, with no configuration surface; the
lookup sits behind one small interface so a later feature can swap it.

**Alternatives considered**:

- `@photostructure/tz-lookup` (CC0, 88 KB, maintained): its own README says roughly 5 to 10% of
  inhabited points differ from `geo-tz`, worst near borders, and recommends `geo-tz` when accuracy
  matters and browsers are not a target. Ours is a Backend lookup where accuracy at county-line
  borders is the point.
- The Census "geographies" endpoint (county FIPS) plus a hand-kept county-to-zone table: a second
  call per save, and a table of about 1,000 split-state counties (several counties are themselves
  split) that we would have to maintain.
- Google Time Zone API: needs a key and billing (`013` chose a keyless service for the same reason).
- The state alone for every venue: wrong for 15 states (R3).
- An admin picks from a list: not what Mahdi decided; kept only as a correction (R4).

## R2. The eight zones, by their IANA names

**Decision**: `packages/shared/src/time-zone.ts` exports:

| `id` | `name` (shown) | Abbreviations (en-US, checked on 2026-10-24) |
|---|---|---|
| `America/New_York` | Eastern Time | EDT / EST |
| `America/Chicago` | Central Time | CDT / CST |
| `America/Denver` | Mountain Time | MDT / MST |
| `America/Phoenix` | Arizona Time (no daylight saving) | MST |
| `America/Los_Angeles` | Pacific Time | PDT / PST |
| `America/Anchorage` | Alaska Time | AKDT / AKST |
| `America/Adak` | Hawaii-Aleutian Time | HADT / HAST |
| `Pacific/Honolulu` | Hawaii Time | HST |

`US_TIME_ZONES` (in this order), `type UsTimeZone`, `DEFAULT_TIME_ZONE = 'America/New_York'`, and
`isUsTimeZone(s)`. The contract's `UsTimeZone` enum and the database CHECK (data-model.md) list the
same eight; a Backend unit test fails if any of the three differ (as `013` does for `UsState`).

**Rationale**: these are exactly what `find-now` returns for US land (R1), so a worked-out zone
and an admin's choice come from one list. IANA names carry the full daylight-saving history, and
every runtime we use (Node 22's full ICU, current browsers) knows them.

**Alternatives considered**: all ~29 current US IANA names (a longer list for the admin, with
names like America/Indiana/Vincennes that mean nothing to an admin, for no difference in future
times). Fixed offsets such as `-05:00` (cannot express daylight saving).

## R3. No coordinates: the state decides, or the admin does

**Decision**: `STATE_TIME_ZONES` in `packages/shared/src/time-zone.ts` maps each of `013`'s 51
codes to the zones in use there, most populous first:

- **More than one zone (15)**: AK [Anchorage, Adak], AZ [Phoenix, Denver], FL [New_York, Chicago],
  ID [Denver, Los_Angeles], IN [New_York, Chicago], KS [Chicago, Denver], KY [New_York, Chicago],
  MI [New_York, Chicago], NE [Chicago, Denver], NV [Los_Angeles, Denver], ND [Chicago, Denver],
  OR [Los_Angeles, Denver], SD [Chicago, Denver], TN [Chicago, New_York], TX [Chicago, Denver].
- **One zone (36)**: every other state and DC (HI → Pacific/Honolulu; CA, WA → Los_Angeles; CO,
  MT, NM, UT, WY → Denver; AL, AR, IA, IL, LA, MN, MO, MS, OK, WI → Chicago; the rest of the East
  and DC → New_York).

When the zone cannot come from the place (the address was saved anyway, so there is no match; or
the match had no coordinates; or `zoneAt` returned `null`), and the request did not send
`timeZone`:

- one zone → that zone, `timeZoneSource = STATE`;
- more than one → `400 TIME_ZONE_REQUIRED`, message "Kentucky has more than one time zone.
  Choose this venue's time zone: Eastern Time or Central Time.", `details: { state: 'KY',
  timeZones: ['America/New_York', 'America/Chicago'] }`. Nothing is saved.

The check runs after the address decision (`013` R2), so an unmatched address without "save
anyway" still gets `ADDRESS_NOT_FOUND` first, and the admin is asked for a zone only when the
address is going to be saved.

**Rationale**: decided in this spec, from Mahdi's suggestion. A state with one zone is never
wrong for any address in it; a split state could be, and guessing the most populous zone would
silently put some venues an hour off (Louisville's KFC Yum! Center, the `013` example of an address
saved anyway, is in a split state). Nevada is split because West Wendover keeps Mountain time
(R1); Arizona because the Navajo Nation keeps daylight saving. The table is testable: a unit test
asserts every one of the 51 codes is present and that the split list is exactly the 15 above.

**Alternatives considered**: the most populous zone for split states, correctable later (silent
errors, Mahdi asked us to choose and make it testable). Requiring a choice for every address saved
anyway (an extra step for the 36 states where there is nothing to choose). Geocoding the ZIP code
centroid instead (another lookup that can also fall on the wrong side of a county line).

## R4. An admin's correction is explicit and recorded

**Decision**: `LocationInput` and `LocationUpdate` gain optional `timeZone` (`UsTimeZone`). When it
is sent, it is used, whatever was worked out, and `timeZoneSource = ADMIN`. It may be sent:

- on create, with the address (the lookup still runs: the address is still checked);
- on update, alone (a correction), or with an address change (the explicit choice wins over the new
  address's zone).

Sending the zone the venue already has records `ADMIN` and moves nothing. The Admin app sends
`timeZone` only when the admin picks one (R14). Any of the eight is accepted for any state: a
correction is the admin's call, and the Backend refuses only names off the list (`400`).

**Rationale**: Mahdi recommended an override; a venue at a border can be placed on the wrong side
(spec Edge Cases). Recording the source lets the Admin app say "chosen by an admin", so a later
address change that re-derives the zone is not a surprise, and a reviewer can tell a looked-up zone
from a typed one.

**Alternatives considered**: restricting the choice to the state's zones (blocks the rare venue
whose state table is wrong). No override (a border error would be permanent). A separate
"override" field kept alongside the derived one (two zones per venue, one ignored).

## R5. Storage: two columns on `Location`; instants unchanged

**Decision**: `Location` gains `timeZone VARCHAR(40) NOT NULL` with a CHECK listing the eight names,
and `timeZoneSource "TimeZoneSource" NOT NULL`, a new enum `ADDRESS | STATE | ADMIN | DEFAULT`.
`Event.startsAt` and `endsAt` stay `timestamptz` instants in UTC (Constitution, Time). No
coordinates and no local times are stored. Details in data-model.md.

**Rationale**: one zone per venue is the only new fact. Instants stay the system of record, so the
60-minute exclusion constraint, sales close, entry windows, seat holds, live codes, reports, and
`019`'s calendar files keep working unchanged. A CHECK makes "every zone is on the list" a database
fact (Constitution IV), and an enum does the same for the source.

**Alternatives considered**: storing local date-times plus the zone (every instant rule would need
conversion in SQL, and the exclusion constraint would have to be rebuilt). A `TimeZone` lookup table
(a join for eight constant rows). Storing coordinates (unused after the lookup).

## R6. Migration: Eastern for existing venues, no event moves, a deferrable overlap constraint

**Decision**: one migration, `…_venue_time_zones`:

1. `CREATE TYPE "TimeZoneSource" AS ENUM ('ADDRESS', 'STATE', 'ADMIN', 'DEFAULT')`.
2. `ALTER TABLE "Location" ADD COLUMN "timeZone" VARCHAR(40) NOT NULL DEFAULT 'America/New_York',
   ADD COLUMN "timeZoneSource" "TimeZoneSource" NOT NULL DEFAULT 'DEFAULT'`, then `ALTER COLUMN …
   DROP DEFAULT` on both, so every later row must say its zone and source.
3. `ADD CONSTRAINT "location_time_zone_known" CHECK ("timeZone" IN (…eight…))`.
4. Drop and re-create `event_no_overlap` with the same expression and `WHERE`, plus
   `DEFERRABLE INITIALLY IMMEDIATE` (R8).

No `Event` row is touched. No network call. Re-creating the constraint re-validates existing rows,
which already satisfy it.

**Rationale**: Mahdi decided existing venues get Eastern (2026-10-24); every existing venue is in
Kentucky (demo data) or a test. Adding a column with a constant default is a metadata-only change in
PostgreSQL 17, so it is instant on any size of table. Dropping the defaults keeps the rule that the
Backend always decides (FR-008). `INITIALLY IMMEDIATE` keeps every existing write's behavior: the
constraint is still checked at each statement unless a transaction defers it.

**Alternatives considered**: deriving zones for existing venues in the migration (needs the address
service: a migration must not call the network, `013` R5). Keeping the column defaults (a row
inserted outside the service would silently get Eastern).

## R7. When a zone is worked out

**Decision**, in `LocationsService`:

- **Create**: after the address decision (`013` R2): `timeZone` sent → it (`ADMIN`); else a verified
  match with a usable place → `zoneAt` (`ADDRESS`); else the state rule (R3).
- **Update**: `timeZone` sent → it (`ADMIN`). Else, when the address is sent and differs from the
  stored one (`013` FR-008, so the lookup runs) → as for create. Otherwise the zone is not touched
  (name-only, capacity-only, or same-address edits).
- A venue from before `013` (no parts) is re-derived when an admin first gives it four parts, by
  the second rule.

The proposed zone is compared with the zone read **under the venue lock** (R8); only a different
zone triggers R8's move. `timeZoneSource` is written whenever the zone is decided in the request,
even when the zone itself is unchanged: an explicit `timeZone` gives `ADMIN`; an address change
without `timeZone` gives the new derivation's source (`ADDRESS` or `STATE`), so an `ADMIN` venue
whose new address derives the same zone becomes `ADDRESS` (the admin's choice was about the old
address; review round 1, m1).

**Rationale**: FR-002 to FR-005. Re-deriving only on an address change keeps edits that do not
touch the address from ever moving events, and keeps the lookup off name-only edits (which `013`
lets succeed while the address service is down, `013` SC-006).

**Alternatives considered**: re-deriving on every edit (moves zones without an address change).
Keeping an `ADMIN` zone across address changes (an admin who moves a venue's address to another
city would keep a zone chosen for the old place; a new address is a new place, and the zone-change
rules still protect sold events).

## R8. A zone change: refuse on orders, keep local times, re-check the 60-minute rule

**Decision**: inside `LocationsService.update`'s existing transaction (`013` R7), the venue lock
helper returns the venue's `timeZone` and `timeZoneSource` read **under the lock**
(`lockVenueAndEvents` gains them in its `SELECT … FOR UPDATE`). Everything below uses that zone: the
comparison with the proposed zone, the conversion of each event's instants to local times, and the
source written. The `existing` row read before the lock (for the address comparison of `013` R7)
is never used for the zone. When a zone change is needed, the transaction also locks **every**
event of the venue, scheduled or cancelled, in id order (`lockAllVenueEvents`, after the venue
row, so the lock order stays venue then events), because a cancelled event without orders can be
deleted or get an image write concurrently. Then, when the proposed zone differs from the locked
one:

1. **Orders** (FR-010): `SELECT` the venue's events (any status) that have at least one order (any
   status). Any → `409 TIME_ZONE_HAS_ORDERS`, message "Can't change the time zone of {venue}:
   tickets have been sold for {n} of its events. No customer's ticket time may move.",
   `details: { timeZone, proposedTimeZone, events: [{ id, name }] }` (at most 10 listed, plus
   `eventCount`).
2. **New moments** (FR-009, FR-011): for every event at the venue (scheduled and cancelled), take
   its local start and end in the old zone (`toLocalDateTime`, R11) and resolve each in the new zone
   (`resolveLocal`). Any `skipped` or `repeated` → `409 EVENT_TIME_NOT_IN_ZONE`, message "Can't
   change the time zone: {event}'s {start|end}, {Mar 14, 2027, 2:30 AM}, doesn't exist in Mountain
   Time." (or "happens twice in …"), `details: { event: { id, name }, field, localTime,
   proposedTimeZone, reason: 'SKIPPED' | 'REPEATED' }`. The first such event in start order is
   named.
3. **60-minute rule** (FR-012): among the venue's **scheduled** events at their new moments, find
   the first pair, in start order, whose windows `[start − 60 min, end)` overlap → `409
   SCHEDULING_CONFLICT` with the existing shape: `details.conflictingEvent` is the earlier event,
   and `details.event` (new, optional) is the later one; the message names both, in the new zone's
   local time.
4. **Write**: `SET CONSTRAINTS "event_no_overlap" DEFERRED`; update every event's `startsAt` and
   `endsAt` (each locked row exists, so no update misses); update the venue. The constraint is
   checked at commit, the guarantee.

**Why the zone is read under the lock** (review round 1, M2): two edits at one venue can race, for
example admin A sets `timeZone: America/Chicago` while admin B's address change derives Denver. B
read the venue before its address lookup, when it was still New York. If B converted from that
stale zone after A committed, a 7:00 PM CDT event would become 8:00 PM MDT, a local time no one
chose; or B could skip the move entirely when its derived zone equals the stale one. Reading the
zone under the lock serializes the two: B sees Chicago and converts 7:00 PM CDT to 7:00 PM MDT.

When `timeZone` is sent explicitly and differs from the stored zone, step 1 also runs as a fast
check **before** the address lookup, with no lock (as `013` R7's capacity check), so a refusal never
waits on the network. Under the lock it runs again.

**Why the constraint is deferred**: updating events one row at a time checks the exclusion
constraint at each statement. When every event moves by an hour, the first event moved can overlap
the next one's old window, though the final state is fine. Deferring to commit checks only the
final state, which steps 3 and 4 then guarantee; a genuine conflict still fails the commit with
`23P01`, which the existing filter maps to `409 SCHEDULING_CONFLICT` with `conflictingEvent: null`.

**Concurrency** (FR-013): orders lock their event row (`lockEvent`) and only scheduled events take
orders; `lockVenueAndEvents` holds every scheduled event of the venue, so an order either commits
before the zone change (which then sees it in step 1 and refuses) or waits and is placed against
the new moments (and its sales-close check uses them). Event writes take the venue row lock first
(R10).

**Rationale**: Mahdi's decisions (2026-10-24): local times kept, refused when tickets are sold,
conflicts re-checked. "Sold tickets" means any order in any state (confirmed by Mahdi,
2026-10-24): a refunded order and an order for a cancelled event still show their event's
time on My tickets, so moving it would change what a customer sees about something they bought.
`409` because the venue's saved data conflicts with the change, as `CAPACITY_EXCEEDED` on a venue
edit is.

**Alternatives considered**: keeping instants and letting local times shift (Mahdi chose local
times). Taking the earlier of a repeated time automatically (silently picks an hour; refusal is
rare and explicit). Moving events one by one in a computed order to avoid the deferral (the shift
differs per event across daylight-saving dates, so no single order always works). Counting only
valid tickets (a refunded customer still sees the order).

## R9. Event times in the API: RFC 3339 with the venue's offset, checked by the Backend

**Decision**: `EventInput` and `EventUpdate` keep `startsAt` and `endsAt` as RFC 3339 date-times
with an offset (Constitution, Time). The offset now means something: it states which local time
the client meant, and the Backend checks it against the venue's zone.

For each of `startsAt` and `endsAt` sent:

1. `parseOffsetDateTime` (R11) splits the string into its local date-time (`2027-11-07T01:30:00`)
   and its offset (`-05:00`; `Z` is `+00:00`).
2. `resolveLocal(local, venueZone)`:
   - `skipped` → `400 LOCAL_TIME_SKIPPED`, message "2:30 AM on Mar 14, 2027 doesn't exist in
     Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time.",
     `details: { field, localTime: '2027-03-14T02:30', timeZone, skippedFrom: '02:00',
     skippedTo: '03:00' }`.
   - `ok` or `repeated`, and the sent offset is not the offset of one of the 1 or 2 moments →
     `400 UTC_OFFSET_MISMATCH`, message "startsAt is stated with offset -07:00, but {venue} is in
     Eastern Time, which is -04:00 at that time. Send the venue's local time with its offset.",
     `details: { field, localTime, timeZone, sentOffset, expectedOffsets: ['-04:00'] }` (two for a
     repeated time).
   - Otherwise the instant is that moment. For a repeated time the offset chooses the first or
     second occurrence (FR-018).

**A time without an offset, or a date only** (`2026-10-01T19:00:00`, `2026-10-01`), which
`@IsISO8601({ strict: true })` accepts today and `new Date()` reads in the server's zone or as UTC,
is refused with `400 VALIDATION_FAILED`, "startsAt must include a UTC offset, for example
2026-10-01T19:00:00-04:00" (review round 1, S6). The DTO check is a pattern on the string
(`…T hh:mm[:ss[.fff]]` followed by `Z` or `±hh:mm`), so it runs with field validation.

Order of checks: field validation (including the offset presence); the window is ordered (`endsAt >
startsAt`, on instants); the venue exists (`404`); **these zone checks** (start, then end); then
the existing capacity, limit, and conflict checks unchanged. On `updateEvent`, the venue is the destination venue, and only the
times sent are checked.

**Moving venues** (FR-019): an `updateEvent` whose `locationId` names a venue in a different zone
from the event's current venue must send both `startsAt` and `endsAt`; otherwise `400
VALIDATION_FAILED`, "Send startsAt and endsAt when moving an event to a venue in another time zone,
so its local times are clear." Moving within the same zone without times keeps the instants, as
today.

**Responses are unchanged**: `startsAt` and `endsAt` are still sent as UTC (`…Z`), and every client
formats them in `event.location.timeZone` (R12). The contract's examples already use offsets.

**The scheduling conflict message** names the conflicting event's start with its date and the end
with its date only when it differs (review round 1, m12): "This venue is already committed from
Oct 1, 2026, 6:00 PM EDT to 9:00 PM EDT by 'Season Opener'." or "… from Oct 1, 2026, 10:00 PM EDT
to Oct 2, 2026, 1:00 AM EDT …".

**Rationale**: FR-018 needs the Backend to refuse a skipped time and a time in the wrong zone. An
RFC 3339 string with an offset already identifies both a local time and a moment, so no new field
is needed, the constitution's exchange rule holds, and a repeated time is unambiguous on the wire.
Refusing a mismatched offset turns the exact bug in #42 (a browser converting in its own zone, which
today sends `toISOString()`, a `Z`) into a refusal that names it, instead of a silently wrong hour.
No US venue is in UTC, so a `Z` is always refused.

**Alternatives considered**:

- New fields for a local date-time (`startsAtLocal`) plus a disambiguation choice: two ways to send
  one value, and the contract's exchange rule would need an exception.
- Accepting any offset (today's behavior): the Backend could not refuse a skipped time (an instant
  always exists) or a wrong-zone conversion; Mahdi asked for a server-authoritative check.
- Sending responses in the venue's offset: every serializer of an event time (events, orders,
  entry, reports, conflicts) would change for no consumer that needs it; clients already parse any
  offset.

## R10. Event writes lock the venue row first

**Decision**: `EventsService.create` and `update` run in one transaction (`LOCKING_TX`) that takes
`SELECT "timeZone" FROM "Location" WHERE "id" = $1 FOR SHARE` on the venue before anything else:

- **create**: the venue named in the request; the zone read under that lock is the one R9 checks
  against;
- **update**: read the event's `locationId` (no lock), lock **both** the current and the destination
  venue `FOR SHARE` in id order, then `lockEvent`; if the event's `locationId` changed meanwhile,
  retry once (as `retryOnDeadlock` does).

The lock order is then always venue, then event, the order `venue-lock.ts` documents ("Nothing locks
an event and then a venue"). `FOR SHARE` lets event writes at one venue run together, and conflicts
with the `FOR UPDATE` a venue update, layout save, or zone change takes, so an event is never
validated against one zone and saved against another (FR-013).

`createOnce`'s existing conflict pre-check and insert move into that transaction; the
`event_no_overlap` constraint and `retryOnDeadlock` are unchanged.

**Rationale**: Constitution IV: the zone used to validate a time must be the zone the event is
saved under, under concurrency. A row lock is a database guarantee and costs one row lock per event
write.

**Alternatives considered**: no lock (a zone change committing between an event's check and insert
would leave that event an hour off, unnoticed). `FOR UPDATE` on the venue (serializes every event
write at a venue for no benefit). Storing the zone on each event (duplicates the venue's fact).

## R11. One shared time module, built on `Intl`, no date library

**Decision**: `packages/shared/src/time-zone.ts` (exported from the package root, so the Backend
and all three apps use the same code) holds R2's list, R3's table, and:

| Function | Result |
|---|---|
| `offsetAt(instant, zone)` | minutes from UTC (`-240`), from `Intl.DateTimeFormat` `timeZoneName: 'longOffset'` (`GMT-04:00`) |
| `abbreviationAt(instant, zone)` | `EDT`, from `timeZoneName: 'short'`; ICU's own fallback is `GMT-4` |
| `toLocalDateTime(instant, zone)` | `2026-10-01T19:00` (also the `datetime-local` input value) |
| `localDate(instant, zone)` | `2026-10-01` |
| `resolveLocal(local, zone)` | `{ kind: 'ok', moment }`, `{ kind: 'skipped', skippedFrom, skippedTo }`, or `{ kind: 'repeated', first, second }`; a `moment` is `{ instant, offset: '-04:00', abbreviation: 'EDT' }` |
| `toOffsetDateTime(instant, zone)` | `2026-10-01T19:00:00-04:00`, what the Admin app sends |
| `parseOffsetDateTime(s)` | `{ local, offsetMinutes }` or `null` |
| `formatEventTime(instant, zone)` | `Oct 1, 2026, 7:00 PM EDT` |
| `formatTimeOfDay(instant, zone)` | `7:00 PM EDT` |
| `formatEventDate(instant, zone)` | `Oct 1, 2026` |
| `formatViewerTime(instant)` | `4:42 PM PDT` in the viewer's own zone (FR-023) |
| `zoneName(zone)` | `Eastern Time` |

`resolveLocal` reads `local` as if it were UTC (`t0`), takes the zone's offsets one day before and
one day after `t0` (a US zone changes at most once in two days), and keeps each `t0 − offset` whose
local date-time in the zone is `local` again. No candidate → skipped (the gap is between the two
offsets); one → ok; two → repeated, earlier first. Every formatter uses the locale `en-US` and
caches one `Intl.DateTimeFormat` per zone and style. The parts formatter behind `toLocalDateTime`
and `localDate` sets `hourCycle: 'h23'`, not `hour12: false`, because some ICU versions and
browsers render midnight as `24:00` with `hour12: false` (review round 1, m9); a test covers
midnight.

**Checked on 2026-10-24** with Node 22.20: `Oct 1, 2026, 7:00 PM EDT` for 23:00 UTC in
America/New_York, with the process zone set to Pacific/Honolulu; 05:30 and 06:30 UTC on Nov 1,
2026 both format as 1:30 AM, `EDT` and `EST`; the eight zones' abbreviations are R2's table. The
2026–2027 transitions are 2026-03-08, 2026-11-01, 2027-03-14, and 2027-11-07, at 2:00 AM local
time, in every zone but Phoenix and Honolulu.

**Rationale**: `Intl` with IANA zones is in Node 22 (full ICU) and every browser the apps support,
and covers everything above in about 200 lines that we test exhaustively (R20). One module means
the Backend's refusal and the form's preview cannot disagree (Constitution IV).

**Alternatives considered**: `date-fns-tz` or `luxon` (a dependency in four workspaces for what
`Intl` already does; Principle VIII). The `Temporal` API (not in Node 22 without a polyfill, which
is a larger dependency). Abbreviation tables of our own (ICU's are maintained for us).

## R12. How each app shows a time

**Decision**: each app's `format.ts` `when(iso)` becomes `when(iso, timeZone)`, calling
`formatEventTime`; every caller passes the event's venue zone. Where a range is shown, each end is
formatted on its own (FR-021, US3 scenario 8). The zone comes from:

| App | Place | Zone from |
|---|---|---|
| Admin | Event list (date and time columns), event page, venue page events, attendees' check-in times | `event.location.timeZone` / the venue's `timeZone` |
| Admin | Event form conflict detail | the form's venue's zone |
| Admin | Reports, each event's date | `EventSales.timeZone` (new) |
| Admin | Reports "as of" | viewer (`formatViewerTime`, with the date) |
| Customer | Event cards (Events list and venue page), event page | `event.location.timeZone` |
| Customer | My tickets (event start, ordered at, ticket used at), live entry code page, printable ticket | `order.event.location.timeZone` (new) |
| Customer | Seat cooldown "again at" | viewer (`formatViewerTime`) |
| Booth | Event picker; lookup and admit results ("Already used at", "Entry opens at") | the gate event's `location.timeZone` |
| Booth | `OTHER_EVENT` ("For {event} on …") | `EntryTicket.event.timeZone` (new), or `details.event.timeZone` of an `ENTRY_REFUSED` |
| Backend | `SCHEDULING_CONFLICT` message | the venue's zone (`formatEventTime`, R9) |

The Admin venue list gains a "Time zone" column (`zoneName`), and the venue page a line "Time
zone: Eastern Time, from the address." (FR-024). Admin `EventList.tsx`'s own `day`/`clock` helpers
call the shared formatters with the event's zone.

The `SEAT_COOLDOWN` and Reports "as of" times are not event times (kept in the viewer's zone,
labelled, confirmed by Mahdi, 2026-10-24): the customer acts on the
cooldown with their own clock, and "as of" is when the admin loaded the page (FR-023). They gain
the abbreviation so no time on screen is unlabeled.

**Rationale**: FR-021 to FR-023; a time is always shown with its zone. Formatting stays in the
clients, as today (`017` research R6).

**Alternatives considered**: showing both the venue time and the viewer's time (twice the text,
not asked for; spec Out of Scope).

## R13. The Admin event form

**Decision** (`admin-app/src/pages/EventForm.tsx`):

- The two `datetime-local` inputs keep their values as plain local strings. `toIso` and
  `toLocalInput` (which use the browser's zone) are removed; loading an event uses
  `toLocalDateTime(instant, event.location.timeZone)`.
- Under the inputs, once a venue is chosen: "Times are in the venue's time zone: Eastern Time
  (EDT)." The abbreviation is the one in force at the typed start (or today, while it is empty).
  With no venue chosen: "Choose a venue first: times are in the venue's local time."
- Changing the venue keeps both strings unchanged (FR-015); the line updates.
- On every change of venue or time, the form runs `resolveLocal` for each field:
  - `skipped` → that field is marked invalid, the message of R9 is shown under it, and Save
    refuses with the same message before sending (FR-016);
  - `repeated` → a radio group under the field, "Which 1:30 AM?" with "1:30 AM EDT (the first
    time)" and "1:30 AM EST (the second time)", nothing chosen; Save refuses with "Choose which
    1:30 AM you mean." until one is chosen (FR-017). Loading an event in a repeated hour selects
    the occurrence its stored instant is.
- The payload sends `toOffsetDateTime(moment.instant, zone)` for each field.
- `LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH`, and the venue-move `400` from the Backend are shown
  through `ErrorBanner` with every value kept (FR-026). `SCHEDULING_CONFLICT`'s detail line shows
  the conflicting event's times in the venue's zone.

**Rationale**: FR-014 to FR-017. The browser's `datetime-local` gives a zone-less local string,
which is exactly the input `resolveLocal` takes; reading it in the venue's zone is the fix for #42.

**Alternatives considered**: a time-zone selector per event (a venue has one zone). Disabling the
time inputs until a venue is chosen (would break the current field order and tests for no gain:
nothing is converted until save).

## R14. The Admin venue form and pages

**Decision** (`LocationForm.tsx`, `LocationList.tsx`, `LocationDetail.tsx`):

- A **Time zone** select after the address: first option "Work it out from the address" (create)
  or "Keep {Eastern Time} ({from the address})" (edit), then the eight zones by `name`. On edit,
  while any address field differs from the stored address, the first option reads "Work it out from
  the new address", because R7 then derives the zone again (review round 1, m3). `timeZone` is sent
  only when the admin picks a zone (R4).
- After a `TIME_ZONE_REQUIRED` refusal, or when "Save anyway" is offered and
  `STATE_TIME_ZONES[state]` has more than one zone, the form shows "{State} has more than one time
  zone. Choose this venue's time zone:" with a radio button per zone of that state, and Save anyway
  is refused by the form until one is chosen; the choice is sent as `timeZone`. Changing the state
  clears it. On edit, when the venue's stored zone is one of that state's zones, that radio button
  is selected at first (the admin can change it); otherwise none is (review round 1, m4).
- After saving, the existing notice adds "Time zone: {name}, {source}." (`013` R13's notice).
- On edit, choosing a different zone on a venue with events shows, before saving: "Changing the
  time zone keeps each event's local time (7:00 PM stays 7:00 PM), so their times move. Not
  possible once tickets are sold." `TIME_ZONE_HAS_ORDERS` (listing the events as links),
  `EVENT_TIME_NOT_IN_ZONE`, and `SCHEDULING_CONFLICT` are shown through `ErrorBanner` with every
  value kept.
- `LocationList` gains a "Time zone" column; `LocationDetail` shows "Time zone: Eastern Time, from
  the address." Sources read "from the address", "from the state", "chosen by an admin", and "the
  default". Existing classes only (`012` drift check).

**Rationale**: FR-003, FR-004, FR-024, FR-026; the same refusal-and-retry pattern `013` built for
"Save anyway".

## R15. Date filters use the venue's local day

**Decision**: `listEvents` gains optional `fromDate` and `toDate` (`format: date`, `YYYY-MM-DD`,
both inclusive): an event matches when `localDate(startsAt, location.timeZone)` is within them.
Sending either together with `from` or `to` is `400`; `fromDate` after `toDate` is `400`. `from`
and `to` (instants) are unchanged for other clients.

The Backend queries a wide instant window, `[fromDate 00:00Z, toDate + 1 day 12:00Z)`, which holds
every local day of every US zone (offsets −4 to −10 hours), then keeps the events whose local start
date is in range, in JavaScript with the shared `localDate`, before ordering. One time-zone source
(ICU) decides every local date in the system.

The Admin event search (`EventList.tsx`'s `localMidnight`) and the Customer filters (`filters.ts`'s
`eventQuery`) send `fromDate` and `toDate` straight from their date inputs, with no conversion.

**Confirmed by Mahdi** (2026-10-24): keep the venue-local-day filters with the new `fromDate`
and `toDate`.

**Rationale**: FR-020. With venues in several zones, a viewer's midnight is the wrong day boundary
for some events (US1 scenario 6). Filtering after the query keeps it to one `findMany` with no raw
SQL.

**Alternatives considered**: `("startsAt" AT TIME ZONE l."timeZone")::date` in raw SQL (a second
time-zone database, PostgreSQL's, deciding dates; raw SQL for a filter). Leaving the filters in the
viewer's zone (dates shown and dates filtered would disagree).

## R16. Responses that carry an event time without its venue gain the zone

**Decision**: the contract adds `timeZone` (`UsTimeZone`) to:

- `Location` (and so `Event.location`, every venue and event response);
- `OrderEvent.location` (My tickets, the live code page, the printable ticket);
- `EventSales` (Reports);
- `EntryTicket.event` (lookup), and `ENTRY_REFUSED`'s `details.event` for `OTHER_EVENT` (admit).

`Location` also gains `timeZoneSource`. The Backend's `SCHEDULING_CONFLICT` message uses the venue's
local time; its `details` gain an optional `event` (the second event of R8's pair).

**Rationale**: FR-021: every client needs the zone next to the instant it formats, without a second
request.

## R17. Countdowns, windows, and the Ticket Booth

**Decision**: unchanged: the seat-hold countdown and cooldown length (`015`), the live code's
30-second windows and the entry key's clock offset (`018`), the entry window `[startsAt − 2 h,
endsAt)` (`017`), sales close at `startsAt` (`006`). They are computed on instants and durations,
which a zone does not change (FR-025). The booth formats every time with R12's zones.

## R18. Contract 1.13.0, main green between the PRs, ERROR_CODES

**Decision**: the contract and regenerated `api-schema.ts` land in this PR at **1.13.0**. `019`'s
spec PR (#82) merged first at 1.12.0, adding `address` to `OrderEvent.location`; this branch was
rebased onto it (`main` 17ad895), keeps both `OrderEvent.location` additions (`019`'s `address`,
this feature's `timeZone`), takes the next minor, and reran `npm run generate:api` and the drift
check.

**Why a minor version although input narrows** (review round 1, m11): `createEvent` and
`updateEvent` now refuse a `Z` or any offset other than the venue's, and a time without an offset,
all accepted until now. Every client of the API is in this repository and changes in the same
implementation PR, and `013` set the precedent of a minor version for new refusals (it removed
`address` from venue input in 1.7.0). No outside client exists to warn with a major version.

To keep `main` green (as `013` R11 and `016` R9 did):

- New response fields (`timeZone`, `timeZoneSource`, the `EventSales` and `EntryTicket.event`
  ones) are documented as always sent but **not** in `required`, because the Backend on `main`
  does not send them until the implementation merges, and the contract tests validate responses.
- New request fields (`timeZone`) and query parameters (`fromDate`, `toDate`) are optional.
- No new operation, so no `x-planned` marker (the repository's rule applies to operations only).
- The five codes (`TIME_ZONE_REQUIRED`, `TIME_ZONE_HAS_ORDERS`, `EVENT_TIME_NOT_IN_ZONE`,
  `LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH`) are added to `ErrorEnvelope.code` and to
  `packages/shared/src/errors.ts`'s `ERROR_CODES` in this PR, in the contract's order.

**Follow-up**: once the implementation merges, a small contract PR moves the new response fields
into `required`; the implementation opens its issue as its last task (as `013`).

**Rationale**: Constitution I (contract before code) and III (`main` demo-ready at every merge).

## R19. Demo data

**Decision**: `backend/src/scripts/demo-data.ts`:

- The two demo venues stay in Kentucky. Online, both are verified and get Eastern from the address
  (R1). Offline (`013` R14's `saveUnverified` path), Kentucky is split (R3), so `LocationsService
  .create`'s internal options gain `fallbackToDefaultTimeZone: true`: when no zone can be worked
  out and none was sent, the venue gets `America/New_York` with `timeZoneSource = DEFAULT`, the
  same as an existing venue, instead of `TIME_ZONE_REQUIRED`. Only `demo-data` passes it; no
  request can set it (as `013` R14).
- `at(days, hour)` becomes `atLocal(days, 'HH:mm', zone)`: the local date `days` from today in the
  venue's zone at that local time, resolved with `resolveLocal` (taking the first occurrence if the
  date is a fall-back night, and the next hour if skipped, so the script never fails on a DST date).
  The concert, comedy night, and gala start at 7:00 PM, 8:00 PM, and 7:00 PM Eastern, and end 3
  hours later (today they start at 23:00 and 24:00 UTC, which is 7:00 or 8:00 PM Eastern only in
  summer).
- "Demo Tonight" stays at now + 1 hour (`017` research R13): an instant, not a local time. It is
  sent as `toOffsetDateTime(instant, venueZone)`, not `toISOString()` (which ends in `Z` and would
  be refused, R9): an instant always has exactly one offset in a zone, never a skipped local time,
  and that offset settles a repeated hour (review round 1, S5). Every other demo time is sent the
  same way.

**Rationale**: demo data must work offline (`013` R14) and show round local times in every season.
A third demo venue in another zone is not added: the running-system check creates one (quickstart),
which exercises the feature through the Admin app.

## R20. Tests: conversions exhaustively, every app under several device zones

**Decision**:

- **Shared conversion tests** (`packages/shared/test/time-zone.test.ts`, Vitest), for
  America/New_York, America/Chicago, America/Denver, America/Phoenix, America/Los_Angeles,
  America/Anchorage, and Pacific/Honolulu (and America/Adak in the table tests): every minute of the
  2027 spring-forward and fall-back days round-trips (`resolveLocal` ∘ `toLocalDateTime`), every
  skipped minute is `skipped` with the right `skippedFrom`/`skippedTo`, every repeated minute gives
  exactly two moments an hour apart with the two abbreviations, Phoenix and Honolulu never skip or
  repeat, and both sides of each boundary (1:59 / 2:00 / 3:00 AM; 0:59 / 1:00 / 1:59 / 2:00 AM).
  Plus `parseOffsetDateTime` (with and without seconds and fractions, `Z`, malformed), the
  formatters (R2's abbreviations; a range across midnight), `STATE_TIME_ZONES` (51 codes, the 15
  split states), and `US_TIME_ZONES`.
- **Backend**: unit tests of `GeoTzFinder` against R1's table (real data, offline), of
  `CensusGeocoder` reading `coordinates` (and `null` when missing), and of the three lists agreeing
  (R2); API tests on Testcontainers for every rule in R3, R4, R7–R10, R15, R16, including the
  migration (R6: a database migrated to the previous migration, seeded with venues and events, then
  migrated: every venue Eastern/`DEFAULT`, every event's instants equal, the constraint deferrable)
  and concurrency (a zone change racing an order, and racing an event create, 10 times each). The
  fake geocoder's default match gains Lexington's coordinates (Eastern); tests can set others.
  `windowAt` in `backend/test/setup/fixtures.ts` returns the venue's local 18:00 with its offset
  (`toOffsetDateTime`), and a new `atInstant(date, zone)` turns a computed instant ("now + 2
  hours", for sales close and entry windows) into the venue's offset form. Every test that sends an
  event time changes to one of them (review round 1, S7): today `windowAt` itself returns
  `toISOString()`, so every fixture-made event sends `Z`, and many tests build times with
  `.toISOString()` or a `` …Z` `` template literal. The files found by searching `backend/test` for
  `toISOString()`, `Z'`, `` Z` ``, and `windowAt(` are listed in tasks.md T015.
  `locations.legacy-address.e2e-spec.ts` inserts a `Location` directly and gains `timeZone` and
  `timeZoneSource` (both required after the migration).
- **Front ends**: the Customer app's `test.env.TZ` pin to `America/New_York` (spec 003 R6) **stays**:
  `019` (merged) relies on it, and its `calendar.test.ts` uses `CALENDAR_TEST_TZ` because the pin
  overrides a shell `TZ` (`019` research R5, tasks ground rule 3). Instead of removing it, each
  front-end and shared Vitest config reads one override variable (review round 1, S4):
  `customer-app`: `env: { TZ: process.env.QP_TEST_TZ || 'America/New_York' }` (the pin is the
  default); `admin-app`, `booth-app`, `packages/shared`: `env: { ...(process.env.QP_TEST_TZ ? { TZ:
  process.env.QP_TEST_TZ } : {}) }` (no pin today, none added). Vitest's default `forks` pool makes
  `test.env.TZ` effective, as `019` R5 checked. `CALENDAR_TEST_TZ` keeps working unchanged (it is
  applied inside the file after the config's zone), and `npm run test:tz` is documented as the
  general way. Code that restores `TZ` after changing it MUST `delete process.env.TZ` when the
  saved value was `undefined`, never assign it: `process.env.TZ = undefined` sets the string
  `"undefined"`, which Node reads as `Etc/Unknown` with offset 0 (checked in review round 1). With
  the pin as default, `TZ` is always set in the Customer app, so `019`'s restore is safe there; the
  rule applies to any new test. Fixtures cover venues in at least three zones (Eastern, Arizona,
  Hawaii), and every time assertion is an exact string with the abbreviation, so a viewer-zone leak
  fails under any device zone other than the venue's.
- **Several device zones** (Mahdi, 2026-10-24): a root script `scripts/test-tz.mjs` runs the
  `packages/shared`, `admin-app`, `customer-app`, and `booth-app` suites and the Backend's unit
  tests (no Testcontainers) once per zone in America/New_York, UTC, America/Los_Angeles, and
  Pacific/Honolulu, setting both `QP_TEST_TZ` and `TZ` in the child's environment from Node
  (`npm run test:tz`). It fails if any run fails and prints a table of zone × workspace results.
  It builds `@queuepass/shared` first (the Backend's Jest maps `@queuepass/shared` to its compiled
  `dist/cjs`, which only `npm test`'s `pretest` builds otherwise), and runs the Backend's unit tests
  with a separate `backend/jest.unit.config.ts` that has no `globalSetup`, so no Testcontainers
  PostgreSQL is started and the run works without Docker (review round 1, S8). The `019` calendar
  and component tests are part of the Customer app's run in every zone. **Checked on 2026-10-24**: on
  Windows, Git Bash does not pass a `TZ=… node` prefix to Node (Node still reports the system
  zone), while `TZ` set in a child's environment from Node, or in PowerShell, is honored. So the
  script, not a shell prefix, is the documented way.
- **CI runs one extra zone**: the root `npm test` gains a last step,
  `node scripts/test-tz.mjs --zones America/Los_Angeles --quick`, which reruns only the time tests
  (`packages/shared/test/time-zone.test.ts` and each app's `*.tz.test.tsx`) in America/Los_Angeles.
  CI's runner is UTC, and UTC is the one zone where a "local time read as UTC" bug (for example
  `new Date('2026-10-01T19:00')`, which is local time) gives the right answer, so a UTC-only CI
  would miss exactly that class of bug; Los Angeles has daylight saving and is the issue's example.
  Only the time tests are rerun, keeping CI's added time under a minute; the full matrix is a
  pre-PR task (tasks.md). The workflow file does not change (its steps mirror `npm run ci`, `011`
  R12).

**Rationale**: SC-002 and SC-004; Mahdi's instruction that everything is tested several times.

- **The Backend's integration suite in a non-Eastern zone** (review round 1, m13): locally it runs
  in the laptop's zone (America/New_York, also the demo venues' zone), and in CI in UTC, so a
  Backend `new Date('…T19:00')` bug could pass both. Before the PR it is run once more with
  `TZ=America/Los_Angeles` set from PowerShell or by `node scripts/test-tz.mjs --zones
  America/Los_Angeles --backend-full` (tasks.md T050).

**Alternatives considered**: pinning one non-UTC zone in every Vitest config (proves one zone, and
hides UTC-specific bugs locally). Removing the Customer app's pin (contradicts `019`'s ground rule,
which its tests rely on). A CI matrix of four zones over the whole suite (four times CI's
five minutes, mostly Testcontainers tests that do not depend on the device zone).

## R21. The running-system check, and the migration on real data

**Decision** (quickstart.md):

- **Migration on a copy of real data**: before switching the stack to the implementation branch,
  `pg_dump` the running stack's database (from `main`, with demo data and whatever the team
  created), restore it into a throwaway `postgres:17` container, run `prisma migrate deploy` from
  the implementation branch against it, and compare: every venue `America/New_York`/`DEFAULT`, and
  a checksum of every event's `(id, startsAt, endsAt)` identical before and after.
- **In the browser, twice**: for two venues in different zones (a Lexington venue, Eastern; a
  Phoenix or Denver venue created through the Admin app), and for a DST-boundary date (Nov 7, 2027,
  1:30 AM; Mar 14, 2027, 2:30 AM): schedule, view in the Admin, Customer, and Booth apps. The
  implementing session walks it in the browser in the laptop's own zone. The **second browser
  zone** (UTC and America/Los_Angeles) is set **by Mahdi, by hand**, with Chrome DevTools → Sensors
  → time zone override: the session's browser tools have no time-zone emulation, and changing
  Windows' zone is a system setting the session must not change (review round 1, S1). The automated
  multi-zone runs (R20) carry the main proof; the hand check confirms it on the running system.
- **Two ways to run the system** (review round 1, M1). Where images build: `docker compose up
  --build`, and `docker compose exec backend node -e …` prints "EDT" for an October instant in
  America/New_York, proving the Alpine image's ICU data has the zones. Where they cannot (this
  laptop: containers cannot reach package servers through TLS interception, `011` T028 recorded
  "TLS: server certificate not trusted" at `apk add`), a **host-run path**: the compose `database`
  and `keycloak` services from their existing images; `prisma migrate deploy` and the Keycloak seed
  from the host; the Backend from the host with `npm run start --workspace @queuepass/backend`,
  pointing at `localhost` for the database and Keycloak (`OIDC_JWKS_URL` too), and started with
  `TZ=America/Los_Angeles` (from PowerShell) so nothing can depend on the server's zone matching
  the venues'; and the three apps with `vite` on ports 5173–5175 (the exact redirect URIs of the
  OIDC clients). The image build check (T013) and the ICU check are then recorded as "to do where
  images build".

**Rationale**: Constitution VI's running-system gate, plus Mahdi's instruction (2026-10-24) to
repeat the check for two zones and a DST date and to run the migration on a copy of real data.
