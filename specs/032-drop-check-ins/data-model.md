# Data Model: Drop Check-in Details a Week After the Event

**Feature**: `032-drop-check-ins` | **Spec**: [spec.md](./spec.md)

One migration, `backend/prisma/migrations/20261110000000_check_in_retention/migration.sql`, in the
implementation PR (`backend/prisma/` is shared surface: every team member approves it there). Two
nullable columns and one CHECK on `Event`; no table, no index, no change to `Ticket`.

## `Event` (changed)

| Column | Type | Meaning |
| --- | --- | --- |
| `checkInDetailsRemovedAt` | `TIMESTAMPTZ(6)` NULL | When the job removed this event's tickets' check-in details (spec FR-004); NULL until then |
| `keptCheckedInCount` | `INTEGER` NULL | Its valid tickets that had an admission time at that moment (research R4); NULL until then |

```sql
ALTER TABLE "Event" ADD COLUMN "checkInDetailsRemovedAt" TIMESTAMPTZ(6);
ALTER TABLE "Event" ADD COLUMN "keptCheckedInCount" INTEGER;
-- Spec 032 FR-015: removed with a count, or neither; never a negative count.
ALTER TABLE "Event" ADD CONSTRAINT "event_check_ins_removed_together"
  CHECK (("checkInDetailsRemovedAt" IS NULL AND "keptCheckedInCount" IS NULL)
    OR ("checkInDetailsRemovedAt" IS NOT NULL AND "keptCheckedInCount" IS NOT NULL
        AND "keptCheckedInCount" >= 0));
```

Existing rows start NULL: every event is "not removed", and the job removes the past-cutoff ones on its
first run after the migration (every event that ended more than 7 days before it).

Prisma (`schema.prisma`, `model Event`):

```prisma
  // Spec 032 (research R4): when the check-in details of this event's tickets were removed, and
  // how many of its valid tickets had been admitted then; both or neither
  // (event_check_ins_removed_together, migration SQL). Only CheckInRetention writes them.
  checkInDetailsRemovedAt DateTime? @db.Timestamptz(6)
  keptCheckedInCount      Int?
```

## `Ticket` (unchanged schema)

`checkedInAt`, `checkedInBySub`, `checkedInByUsername` stay. At the cutoff all three are set to NULL
together, which `ticket_entry_agent` (spec `017` R3) allows. The `schema.prisma` comment on them gains
"emptied at the event's cutoff (spec 032)".

## State of an event's check-in details

| State | `checkInDetailsRemovedAt` | Tickets' details | Times editable | Report `checkedIn` |
| --- | --- | --- | --- | --- |
| Kept (before `endsAt` + 7 d, or before the next run) | NULL | as admitted | yes; the cutoff follows `endsAt` | live count (0 if cancelled) |
| Removed | set (≥ cutoff) | all NULL | no (`409 CHECK_IN_DETAILS_REMOVED`) | `keptCheckedInCount` (0 if cancelled) |

Kept → Removed only, by the job, under the event lock; never back.

## Constant

| Name | Where | Value |
| --- | --- | --- |
| `CHECK_IN_RETENTION_DAYS` | `packages/shared/src/event.ts`, exported from `@queuepass/shared` | `7` (days of 24 hours) |
| `CHECK_IN_RETENTION_INTERVAL_MS` | `backend/src/entry/check-in-retention.ts` (a Nest provider token) | `3_600_000` in `EntryModule`; the timer runs only after `main.ts` calls `start()` |
