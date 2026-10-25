-- Spec 020 (data-model.md, research R5, R6): every venue gets a time zone. Existing venues get
-- Eastern, recorded as DEFAULT (decided by Mahdi, 2026-10-24). No event row changes; no network
-- call.
CREATE TYPE "TimeZoneSource" AS ENUM ('ADDRESS', 'STATE', 'ADMIN', 'DEFAULT');

-- A constant default is a metadata-only change in PostgreSQL 17. Both defaults are then dropped,
-- so every later row must say its zone and source: only the Backend decides (FR-008).
ALTER TABLE "Location"
  ADD COLUMN "timeZone" VARCHAR(40) NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN "timeZoneSource" "TimeZoneSource" NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE "Location"
  ALTER COLUMN "timeZone" DROP DEFAULT,
  ALTER COLUMN "timeZoneSource" DROP DEFAULT;

-- The eight zones of US_TIME_ZONES, in order (research R2). The contract's UsTimeZone, the shared
-- list, and this CHECK are kept equal by backend/test/unit/time-zone-lists.spec.ts.
ALTER TABLE "Location" ADD CONSTRAINT "location_time_zone_known"
  CHECK ("timeZone" IN ('America/New_York', 'America/Chicago', 'America/Denver',
    'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Adak',
    'Pacific/Honolulu'));

-- The scheduling rule, unchanged, made deferrable so a zone change can move all of a venue's
-- events and be checked once, at commit (research R8). INITIALLY IMMEDIATE: every other write is
-- still checked at each statement. Everything 20260920000001_scheduling_constraints says about why
-- this constraint, not the service's pre-check, is the enforcement still holds.
ALTER TABLE "Event" DROP CONSTRAINT "event_no_overlap";
ALTER TABLE "Event"
    ADD CONSTRAINT "event_no_overlap"
    EXCLUDE USING gist (
        "locationId" WITH =,
        queuepass_event_window("startsAt", "endsAt") WITH &&
    ) WHERE ("status" = 'SCHEDULED')
    DEFERRABLE INITIALLY IMMEDIATE;
