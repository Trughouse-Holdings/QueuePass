-- Spec 025 (research R1, R2): every event has a doors-open time.
ALTER TABLE "Event" ADD COLUMN "doorsOpenAt" TIMESTAMPTZ(6);
-- Spec 025 FR-024 (decided by Mahdi): every existing event, scheduled or cancelled, past or future,
-- opens its doors 1 hour before its start, so its check-in window stays [startsAt - 2 hours, endsAt).
UPDATE "Event" SET "doorsOpenAt" = "startsAt" - interval '1 hour';
ALTER TABLE "Event" ALTER COLUMN "doorsOpenAt" SET NOT NULL;
-- Spec 025 FR-004, FR-005 (research R2): no more than 6 hours before the start, and not after it.
ALTER TABLE "Event" ADD CONSTRAINT "event_doors_open_range"
  CHECK ("doorsOpenAt" <= "startsAt" AND "doorsOpenAt" >= "startsAt" - interval '6 hours');
