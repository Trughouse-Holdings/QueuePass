ALTER TABLE "Event" ADD COLUMN "checkInDetailsRemovedAt" TIMESTAMPTZ(6);
ALTER TABLE "Event" ADD COLUMN "keptCheckedInCount" INTEGER;
-- Spec 032 FR-015: removed with a count, or neither; never a negative count.
ALTER TABLE "Event" ADD CONSTRAINT "event_check_ins_removed_together"
  CHECK (("checkInDetailsRemovedAt" IS NULL AND "keptCheckedInCount" IS NULL)
    OR ("checkInDetailsRemovedAt" IS NOT NULL AND "keptCheckedInCount" IS NOT NULL
        AND "keptCheckedInCount" >= 0));
