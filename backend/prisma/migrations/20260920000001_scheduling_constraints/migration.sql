-- ============================================================================
-- Scheduling constraints — the feature's central invariant.
--
-- Hand-written because Prisma's schema language cannot express EXCLUDE
-- constraints or CHECK constraints. See:
--   specs/001-venue-event-management/research.md   (R3 — full derivation)
--   specs/001-venue-event-management/data-model.md (constraint rationale)
--
-- WARNING: `prisma db push` bypasses migration SQL entirely and would silently
-- omit everything below, leaving FR-029 unenforced. Always use
-- `prisma migrate deploy`.
-- ============================================================================

-- Required for the exclusion constraint below: btree_gist lets a GiST index mix
-- an equality operator (on locationId) with a range overlap operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Field-level CHECK constraints (FR-012, FR-018, FR-021)
-- These duplicate request validation on purpose: validation produces readable
-- errors, the constraints guarantee no client can write invalid rows.
-- ---------------------------------------------------------------------------

ALTER TABLE "Location"
    ADD CONSTRAINT "location_seating_capacity_positive"
    CHECK ("seatingCapacity" > 0);

ALTER TABLE "Event"
    ADD CONSTRAINT "event_ends_after_starts"
    CHECK ("endsAt" > "startsAt");

ALTER TABLE "Event"
    ADD CONSTRAINT "event_ticket_capacity_positive"
    CHECK ("totalTicketCapacity" > 0);

ALTER TABLE "Event"
    ADD CONSTRAINT "event_base_price_non_negative"
    CHECK ("basePrice" >= 0);

-- ---------------------------------------------------------------------------
-- The scheduling rule (FR-023, FR-024, FR-025, FR-026, FR-029)
--
-- Each event occupies the half-open interval [startsAt - 60 minutes, endsAt).
-- Two events at the same venue conflict exactly when those intervals overlap,
-- which expands to:
--
--     (A.startsAt - 60min) < B.endsAt  AND  (B.startsAt - 60min) < A.endsAt
--
-- That is the spec's predicate term for term, and it yields a required
-- clearance of exactly 60 minutes between consecutive events.
--
-- CRITICAL: buffer only the LOWER bound. Expanding both bounds would demand a
-- 120-minute gap — double the specified buffer. Verified against the spec's own
-- boundary cases, for an event running 18:00-21:00 (interval [17:00, 21:00)):
--
--     next starts 21:00 (adjacent) -> [20:00, ...) overlaps -> REJECTED
--     next starts 21:59            -> [20:59, ...) overlaps -> REJECTED
--     next starts 22:00            -> [21:00, ...) no overlap -> ACCEPTED
--
-- This constraint — not the service-layer pre-check — is the enforcement
-- mechanism. It is the only thing that makes FR-029 true: a read-then-write
-- check in application code has a window between SELECT and INSERT in which two
-- concurrent transactions both pass and both commit.
-- ---------------------------------------------------------------------------

-- The arithmetic must live in an IMMUTABLE function. PostgreSQL requires index
-- expressions to be IMMUTABLE, and the built-in `timestamptz - interval` operator
-- (timestamptz_mi_interval) is marked STABLE, so inlining it fails with
-- `ERROR: functions in index expression must be marked IMMUTABLE` (SQLSTATE 42P17).
--
-- Marking this wrapper IMMUTABLE is sound, not a workaround: `interval '60 minutes'`
-- carries months=0 and days=0, so the subtraction is a fixed microsecond offset that
-- never consults the TimeZone setting. The built-in operator is STABLE only because an
-- interval MAY contain months or days, whose meaning does depend on the session zone.
--
-- If the buffer is ever changed to a value containing days or months, this function is
-- NO LONGER safely immutable and the approach must be revisited.
CREATE OR REPLACE FUNCTION queuepass_event_window(starts_at timestamptz, ends_at timestamptz)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT tstzrange(starts_at - interval '60 minutes', ends_at, '[)');
$$;

ALTER TABLE "Event"
    ADD CONSTRAINT "event_no_overlap"
    EXCLUDE USING gist (
        "locationId" WITH =,
        queuepass_event_window("startsAt", "endsAt") WITH &&
    );
