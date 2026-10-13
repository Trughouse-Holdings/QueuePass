# Data Model: Seat Holds with Live Updates

Two new tables, one enum, and their indexes and CHECKs, in one migration:
`backend/prisma/migrations/<timestamp>_seat_holds/`. No existing table changes.

## SeatReservation (new)

One customer's 5-minute claim on seats of one event (research R1).

| Field | Type | Rule |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `eventId` | `UUID` | → `Event.id`, `ON DELETE CASCADE` (an event that can be deleted has no orders). |
| `customerSub` | `TEXT` | The Keycloak subject identifier (Constitution V), as on `Order`. |
| `tierId` | `UUID?` | → `TicketTier.id`, `ON DELETE CASCADE`. `NULL` for an event without tiers. Every hold is in a section mapped to it (FR-003). |
| `createdAt` | `TIMESTAMPTZ` | `now()` in the creating transaction (research R3). |
| `expiresAt` | `TIMESTAMPTZ` | Exactly `createdAt + 5 minutes`; never changed (FR-004). |
| `endedAt` | `TIMESTAMPTZ?` | `NULL` while it hasn't ended. Set when its last live hold ends; `expiresAt` when it ran out (R3). |

```sql
ALTER TABLE "SeatReservation" ADD CONSTRAINT "seat_reservation_five_minutes"
  CHECK ("expiresAt" = "createdAt" + interval '5 minutes');
ALTER TABLE "SeatReservation" ADD CONSTRAINT "seat_reservation_ended_after_start"
  CHECK ("endedAt" IS NULL OR "endedAt" >= "createdAt");

-- FR-003: at most one active reservation per customer per event.
CREATE UNIQUE INDEX "seat_reservation_one_active"
  ON "SeatReservation"("eventId", "customerSub") WHERE "endedAt" IS NULL;
-- Research R4: the sweep finds run-out reservations by their end.
CREATE INDEX "seat_reservation_open_by_expiry"
  ON "SeatReservation"("expiresAt") WHERE "endedAt" IS NULL;
CREATE INDEX "SeatReservation_customerSub_idx" ON "SeatReservation"("customerSub");
```

**Active** means `endedAt IS NULL AND now() < expiresAt`. A reservation past `expiresAt` that the
sweep hasn't closed yet is not active anywhere: locked paths close it first (R3), and the seat map
ignores it.

## SeatHold (new)

One seat in a reservation, kept after it ends (research R1, R6).

| Field | Type | Rule |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `reservationId` | `UUID` | → `SeatReservation.id`, `ON DELETE CASCADE`. |
| `eventId` | `UUID` | → `Event.id`, `ON DELETE CASCADE`. The reservation's event, repeated so the unique index can use it. |
| `seatSection` | `TEXT` | The section's name: the seat's label, as on `Ticket` (spec 007 research R1). |
| `seatRow` | `INT` | ≥ 1. |
| `seatNumber` | `INT` | ≥ 1. |
| `createdAt` | `TIMESTAMPTZ` | When the seat was added (it may be later than the reservation's `createdAt`). |
| `releasedAt` | `TIMESTAMPTZ?` | `NULL` while live. |
| `endReason` | `SeatHoldEnd?` | Set exactly when `releasedAt` is. |

```sql
CREATE TYPE "SeatHoldEnd" AS ENUM ('EXPIRED', 'RELEASED', 'LOGOUT', 'BOUGHT', 'CLOSED');

ALTER TABLE "SeatHold" ADD CONSTRAINT "seat_hold_seat_positive"
  CHECK ("seatRow" >= 1 AND "seatNumber" >= 1);
ALTER TABLE "SeatHold" ADD CONSTRAINT "seat_hold_end_all_or_none"
  CHECK (("releasedAt" IS NULL) = ("endReason" IS NULL));

-- FR-009 (Constitution IV): no seat has two live holds for an event, whatever any client does.
CREATE UNIQUE INDEX "seat_hold_one_live_per_seat"
  ON "SeatHold"("eventId", "seatSection", "seatRow", "seatNumber") WHERE "releasedAt" IS NULL;
CREATE INDEX "SeatHold_reservationId_idx" ON "SeatHold"("reservationId");
-- Research R6: the 2-minute wait looks up recently ended holds.
CREATE INDEX "SeatHold_eventId_releasedAt_idx" ON "SeatHold"("eventId", "releasedAt");
```

**End reasons**:

| `endReason` | Set by | Starts the 2-minute wait (FR-004a) |
|---|---|---|
| `EXPIRED` | Closing a run-out reservation; `releasedAt = expiresAt` (R3) | Yes |
| `RELEASED` | `releaseSeats`: deselect, Release seats, or a tier switch (R8) | Yes |
| `LOGOUT` | `releaseAllMyReservations` (R8) | Yes |
| `BOUGHT` | `createOrder`, with the tickets (R7) | No |
| `CLOSED` | Cancellation, seating and layout changes, tier deletion, sales closing (R11) | No |

## Rules across tables (enforced under the event row lock)

These span tables, so no constraint can state them. Every path that writes a hold or a seated
ticket takes `lockEvent` first (research R2), so they hold under concurrency:

- **No live hold on a seat with a valid ticket**: the reserve path refuses such seats (R5), and
  the order path issues a ticket only for a seat with the caller's own live hold and ends that
  hold in the same transaction (R7).
- **A reservation's holds share its tier**: every seat resolves to a section mapped to
  `SeatReservation.tierId` (R5).
- **At most 10 live holds per reservation, and no more than the `016` limit allows**: checked when
  seats are added (R5).

## Seat state, derived (not stored)

For a seat of a seated event, at a given moment:

```text
sold      if a Ticket with status VALID has the seat's label
reserved  else if a SeatHold with releasedAt NULL has the label
               and its SeatReservation has endedAt NULL and now() < expiresAt
open      otherwise
```

`SeatMapSection.reserved` lists the `reserved` seats (research R10). The stream's `changes` carry
these three states (R9).

## The 2-minute wait, derived

```text
cooling(customer, event, seat) =
  exists SeatHold h join SeatReservation r on h.reservationId = r.id
  where h.eventId = event and r.customerSub = customer
    and h has the seat's label
    and h.endReason in (EXPIRED, RELEASED, LOGOUT)
    and now() < h.releasedAt + 2 minutes
```

## State transitions

```text
SeatReservation:  (none) --reserveSeats--> active --last hold ends--> ended
                                             |  (released, bought, logout, closed)
                                             +--now() >= expiresAt--> run out --closed (R3)--> ended

SeatHold:         live --deselect / Release seats / tier switch--> RELEASED
                  live --logout-----------------------------------> LOGOUT
                  live --createOrder------------------------------> BOUGHT
                  live --reservation runs out---------------------> EXPIRED  (releasedAt = expiresAt)
                  live --cancel / seating / layout / tier / start-> CLOSED
```

Nothing ever returns to live. Reserving the seat again creates a new hold row.

## Prisma

`SeatReservation` and `SeatHold` models with the fields above. `Event` and `TicketTier` gain the
back-relations. The partial unique indexes, the CHECKs, and the partial expiry index are written in
the migration SQL, as spec 007 did for `ticket_one_valid_per_seat`, because Prisma can't express
them.
