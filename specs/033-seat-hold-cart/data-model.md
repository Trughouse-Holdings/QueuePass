# Data Model: Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends

**Feature**: `033-seat-hold-cart` | **Spec**: [spec.md](./spec.md)

**No schema change.** `backend/prisma/` is unchanged: no table, column, constraint, index, or
migration. The cart is not stored: it is the customer's active `SeatReservation` rows, read through
`listMyReservations` (research R1).

## What each click writes (unchanged from `015`)

| Click | Rows | Values |
| --- | --- | --- |
| An open seat, no active reservation | `SeatReservation` 1, `SeatHold` 1 | `createdAt = now()`, `expiresAt = now() + 5 minutes` (CHECK `seat_reservation_five_minutes`), `tierId` the seat's section's |
| An open seat, an active reservation | `SeatHold` 1 | the reservation's `expiresAt` unchanged |
| A held seat, others still held | `SeatHold` 1 updated | `releasedAt = now()`, `endReason = RELEASED` |
| The last held seat | `SeatHold` 1 updated, `SeatReservation` 1 updated | as above; `endedAt = greatest(now(), createdAt)` (`endHolds`) |
| Buy tickets (from the cart) | `Order`, `Ticket` per seat; `SeatHold` updated | `endReason = BOUGHT`; the reservation ends when no hold is left |
| The 5 minutes end | `SeatReservation`, its live `SeatHold`s | `endedAt = expiresAt`, `releasedAt = expiresAt`, `endReason = EXPIRED` (`closeRunOut`) |

## The 2-minute wait (research R4)

A customer may not hold seat *s* of event *e* when a `SeatHold` of theirs for *e* and *s* has:

| | Before (`015` research R6) | Now (`033` FR-006) |
| --- | --- | --- |
| `endReason` | `EXPIRED`, `RELEASED`, `LOGOUT` | the same |
| its reservation | any | **ended** (`endedAt IS NOT NULL`) |
| until | `releasedAt + 2 minutes` | **`endedAt` of its reservation + 2 minutes** |
| bound on the hold | `now() < releasedAt + 2 minutes` | `releasedAt > now() - 8 minutes` (safe: a hold is released at most 5 minutes plus one transaction's length, under 15 seconds, before its reservation ends) |

`availableAt` in the refusal is the latest such end + 2 minutes over the refused seats. A hold
released from the customer's active reservation therefore blocks nothing; the reservation's end
blocks every seat that left it released, run out, or by logout. For `EXPIRED` and `LOGOUT` holds, and
the last released seat, `releasedAt` equals the reservation's `endedAt`, so their waits are as
before. Reads `SeatHold` joined to `SeatReservation` as today's query does; served by
`SeatHold`'s `(eventId, releasedAt)` index, narrowed by the 7-minute bound, and
`SeatReservation`'s primary key.

The sold-or-taken check (`409 SEAT_TAKEN`) now runs before the wait, so a seat this customer
released, held again, and bought is refused later as taken, not as `SEAT_COOLDOWN` (research R4).

## What guarantees what (Constitution IV)

| Rule | Checked by | Guaranteed under concurrency by |
| --- | --- | --- |
| One live hold per seat | `reserveLocked` step 4 (renumbered, research R4) | `seat_hold_one_live_per_seat` unique index (unchanged) |
| One active reservation per customer per event | `reserveLocked` step 3 | `seat_reservation_one_active` unique index (unchanged) |
| Exactly 5 minutes, never extended | the insert | `seat_reservation_five_minutes` CHECK (unchanged) |
| The 2-minute wait | `assertNoWait`, under the event's row lock | the event lock: every hold write, release, sweep, and order for the event serializes on it, so the query sees every committed end |
| 10 seats, the per-customer limit | `reserveLocked` step 6, under the event lock | the lock, as today |
| Seated orders only from the caller's holds | `OrdersService.seatsFor` | the event lock, as today |
| Hold attempts per account | `AttemptLimitsService.tryAttempt` (synchronous) | the Backend's one thread; in memory (`026`'s accepted deviation) |

## The attempt allowances (research R5)

| Kind | Settings | Defaults | Operation |
| --- | --- | --- | --- |
| `BUY` | `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_5_SECONDS` | 10, 3 | `createOrder` |
| `HOLD` | `RATE_LIMIT_HOLD_PER_MINUTE`, `RATE_LIMIT_HOLD_PER_5_SECONDS` | 30, 10 | `reserveSeats` |

Each pair: whole numbers of at least 1, the 5-second number not above the minute's; otherwise the
Backend refuses to start, naming the setting. Releasing is never counted.

## The cart (Customer app, not stored)

| Shown | From |
| --- | --- |
| Each entry | a `Reservation` of `GET /me/reservations`, newest first |
| Event name, date, venue zone | `GET /events/{id}` |
| Ticket type and price | `GET /events/{id}/tiers`, the one with `tierId`; the event's `basePrice` when `tierId` is `null` |
| Seats | `Reservation.seats` |
| Countdown | `Reservation.secondsLeft` against `performance.now()` |
| Live changes | `GET /me/reservations` again about every second while the page is visible, and on focus or becoming visible; nothing while hidden; one read at a time; no seat stream (research R8) |
| Why an entry vanished | `GET /me/orders` once: an order for that event since the cart loaded → "bought", else "ended" |
| Name on tickets | typed in the cart, kept in the page's state, sent with each Buy tickets |
