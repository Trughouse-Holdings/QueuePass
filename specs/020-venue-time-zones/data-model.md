# Data Model: Venue Time Zones

One migration, `backend/prisma/migrations/<timestamp>_venue_time_zones/migration.sql`, applied by
the existing `prisma migrate deploy` at startup. No new table. No event row is changed.

## `Location` (venue): two new columns

| Column | Type | Null | Rule |
|---|---|---|---|
| `timeZone` | `VARCHAR(40)` | NOT NULL | One of the eight names in `US_TIME_ZONES` (CHECK `location_time_zone_known`). No default after the migration. |
| `timeZoneSource` | `"TimeZoneSource"` enum | NOT NULL | `ADDRESS`, `STATE`, `ADMIN`, or `DEFAULT`. No default after the migration. |

```prisma
enum TimeZoneSource {
  ADDRESS // worked out from the verified address's place (research R1)
  STATE   // worked out from the state, which has one zone (R3)
  ADMIN   // chosen by an admin (R4)
  DEFAULT // America/New_York by default: existing venues (R6), and demo data offline (R19)
}

model Location {
  // … unchanged fields …
  // Spec 020 FR-001, FR-007: one of US_TIME_ZONES (CHECK location_time_zone_known), and how it
  // was set. Both have no default: the Backend always decides (FR-008).
  timeZone       String         @db.VarChar(40)
  timeZoneSource TimeZoneSource
}
```

The eight names, in `US_TIME_ZONES` order (research R2): `America/New_York`, `America/Chicago`,
`America/Denver`, `America/Phoenix`, `America/Los_Angeles`, `America/Anchorage`, `America/Adak`,
`Pacific/Honolulu`.

| Kind of venue | `timeZone` | `timeZoneSource` |
|---|---|---|
| Verified address, place in one of the eight zones | the zone at the place | `ADDRESS` |
| Saved anyway (or no usable place) in a one-zone state | the state's zone | `STATE` |
| Any venue with an admin's explicit choice | the choice | `ADMIN` |
| Existing before `020`, not changed since; or demo data created offline (R19) | `America/New_York` | `DEFAULT` |

Not stored: coordinates (used once, at save, to find the zone; spec Out of Scope), local times of
events, and the abbreviation (computed for each instant).

## `Event`: unchanged columns, one constraint re-created

`startsAt` and `endsAt` stay `timestamptz` in UTC. An event's local date and time are
`toLocalDateTime(startsAt, location.timeZone)` (research R11); they are never stored.

`event_no_overlap` is re-created identically, plus `DEFERRABLE INITIALLY IMMEDIATE`, so a zone
change (research R8) can move every event of a venue in one transaction and have the rule checked
on the final state at commit. Every other write is checked at each statement, as before.

## Migration SQL (outline)

```sql
-- Spec 020 (data-model.md): every venue gets a time zone. Existing venues get Eastern, recorded as
-- DEFAULT (decided by Mahdi, 2026-10-24). No event row changes; no network call.
CREATE TYPE "TimeZoneSource" AS ENUM ('ADDRESS', 'STATE', 'ADMIN', 'DEFAULT');

ALTER TABLE "Location"
  ADD COLUMN "timeZone" VARCHAR(40) NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN "timeZoneSource" "TimeZoneSource" NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE "Location"
  ALTER COLUMN "timeZone" DROP DEFAULT,
  ALTER COLUMN "timeZoneSource" DROP DEFAULT;

ALTER TABLE "Location" ADD CONSTRAINT "location_time_zone_known"
  CHECK ("timeZone" IN ('America/New_York', 'America/Chicago', 'America/Denver',
    'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Adak',
    'Pacific/Honolulu'));

-- The scheduling rule, unchanged, made deferrable so a zone change can move all of a venue's
-- events and be checked once, at commit (research R8). INITIALLY IMMEDIATE: every other write is
-- still checked at each statement.
ALTER TABLE "Event" DROP CONSTRAINT "event_no_overlap";
ALTER TABLE "Event"
    ADD CONSTRAINT "event_no_overlap"
    EXCLUDE USING gist (
        "locationId" WITH =,
        queuepass_event_window("startsAt", "endsAt") WITH &&
    ) WHERE ("status" = 'SCHEDULED')
    DEFERRABLE INITIALLY IMMEDIATE;
```

The CHECK's list, the contract's `UsTimeZone` enum, and `US_TIME_ZONES` must be equal; a Backend
unit test reads the migration file and the contract and fails if they differ (research R2).

## Shared data (not stored): `packages/shared/src/time-zone.ts`

- `US_TIME_ZONES`: `{ id, name }` for the eight zones (research R2).
- `STATE_TIME_ZONES`: each of `013`'s 51 state codes → its zones, most populous first; 15 have two
  (research R3).
- `DEFAULT_TIME_ZONE = 'America/New_York'`.

## Rules and where they are guaranteed

| Rule | Backend check | Database guarantee |
|---|---|---|
| A venue's zone is on the list (FR-001, FR-008) | DTO `IsIn(US_TIME_ZONES)` (`400`) | CHECK `location_time_zone_known`; NOT NULL |
| How it was set is recorded (FR-007) | the service sets it on every create and zone change | enum type; NOT NULL |
| A split state's address saved anyway needs a choice (FR-003) | `TIME_ZONE_REQUIRED` (`400`) | n/a (the database has no notion of states' zones) |
| No zone change once a venue's event has an order (FR-010) | `TIME_ZONE_HAS_ORDERS` (`409`) under `lockVenueAndEvents` | row locks: orders lock their event, which the zone change holds (research R8) |
| Moved events keep the 60-minute rule (FR-012) | `SCHEDULING_CONFLICT` pre-check on the new moments | `event_no_overlap`, checked at commit |
| An event time is valid in its venue's zone (FR-018) | `LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH` (`400`) | the venue row `FOR SHARE` during the event write (research R10) |
