# Contract Changes: Seat Holds with Live Updates

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.8.0 to 1.9.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`).

The five new operations carry `x-planned: '015'` until the implementation PR removes the marker
(research R12). `backend/test/contract/route-coverage.e2e-spec.ts` lets a planned operation be
missing as a route, and fails if one is implemented while still marked.

## New operations

| Operation | Route | Role | Answers |
|---|---|---|---|
| `reserveSeats` | `POST /events/{id}/reservation` | `customer` | `201` new reservation, `200` seats added; `400`, `404`, `409 SEAT_TAKEN`, `SEAT_COOLDOWN`, `TICKET_LIMIT_REACHED`, `EVENT_CANCELLED`, `SALES_CLOSED`. No `tierId` in the request: the tier is the seats' sections' tier. |
| `releaseSeats` | `POST /events/{id}/reservation/release` | `customer` | `200 { reservation }` (`null` once nothing is left); `400` for a seat not in it |
| `listMyReservations` | `GET /me/reservations` | `customer` | `200 Reservation[]`, active only, every event |
| `releaseAllMyReservations` | `POST /me/reservations/release` | `customer` | `200 { released }`, used on logout |
| `streamSeatMap` | `GET /events/{id}/seats/stream` | any signed-in | `200 text/event-stream`: `snapshot` (`SeatMap`), `seats` (`SeatMapChange`), `ping`, named in `x-sse-events` |

## Changed operations (descriptions only)

| Operation | Change |
|---|---|
| `getSeatMap` | Each section's `reserved` lists seats in active reservations, never whose. |
| `createOrder` | A seated order's seats must all be in the caller's active reservation: `409 RESERVATION_REQUIRED` (`details.seats`, `details.expired`); another customer's reserved seat is `409 SEAT_TAKEN` with `details.reserved`. A `requestId` replay is returned first. A `tierId` other than the reservation's is `400`. This tightens `createOrder` on purpose (spec FR-018). |
| `updateSeating` | Turning reserved seating off ends the event's reservations; moving a section to another tier ends its reserved seats. |
| `replaceLayout` | Ends every reservation at the venue's events. (`deleteLayout` is unchanged: it is already refused while an event at the venue has reserved seating on.) |
| `createTicketTier` | Adding the first tier to a seated event ends its tierless reservations. |
| `deleteTicketTier` | The tier's reservations are deleted with it; their seats are published open. |
| `cancelEvent` | Ends the event's reservations, and publishes every freed seat (held or sold) as open. |
| `deleteEvent` | Its reservations are deleted with it, and its open streams end. |

## Schemas

| Schema | Change |
|---|---|
| `SeatMapSection` | `reserved: SeatPosition[]`. Not in `required` until the implementation PR, which adds it (as spec 016 R9). |
| `Reservation` | new: `eventId`, `tierId`, `seats` (`ReservedSeat[]`, 1–10), `createdAt`, `expiresAt`, `secondsLeft` (0–300). |
| `ReservedSeat` | new: `sectionId`, `section`, `row`, `seat`. |
| `ReservationInput` | new: `seats` (`SeatChoice[]`, 1–10). |
| `ReservationRelease` | new: optional `seats` (`SeatChoice[]`, 1–10). |
| `ReservationReleaseResult` | new: `reservation: Reservation \| null`. |
| `ReleasedSeats` | new: `released` (integer ≥ 0). |
| `SeatMapChange` | new: `eventId`, `changes` (`SeatStateChange[]`, ≥ 1). The `data` of a `seats` stream event. |
| `SeatStateChange` | new: `sectionId`, `row`, `seat`, `state` (`open` \| `reserved` \| `sold`). |
| `ErrorEnvelope.code` | adds `SEAT_COOLDOWN` and `RESERVATION_REQUIRED`, also added to `packages/shared/src/errors.ts` in this PR. |
| `Conflict` examples | adds `seatReserved`, `seatCooldown`, `reservationRequired`. |

The info description gains a "Live streams" note: a `text/event-stream` operation is a plain
`GET`, its events' `data` is JSON, and `x-sse-events` maps each event name to its schema. The
"Planned operations" note is spec 014's, unchanged.

## Example stream

```text
event: snapshot
data: {"eventId":"7c2f…","reservedSeating":true,"sections":[{"sectionId":"5b0d…","name":"A","rows":3,"seatsPerRow":10,"tierId":null,"sold":1,"taken":[{"row":1,"seat":1}],"reserved":[]}]}

event: seats
data: {"eventId":"7c2f…","changes":[{"sectionId":"5b0d…","row":1,"seat":3,"state":"reserved"},{"sectionId":"5b0d…","row":1,"seat":4,"state":"reserved"}]}

event: ping
data: {}
```

## Example refusals

```json
{
  "error": {
    "code": "SEAT_COOLDOWN",
    "message": "You released Section A, Row 1, Seat 5 less than 2 minutes ago. You can reserve it again at 19:02:30.",
    "details": { "seats": [{ "section": "A", "row": 1, "seat": 5 }], "availableAt": "2026-10-20T19:02:30-04:00" }
  }
}
```

```json
{
  "error": {
    "code": "RESERVATION_REQUIRED",
    "message": "Your reservation for Season Opener ran out. Reserve the seats again to get them.",
    "details": { "seats": [{ "section": "A", "row": 1, "seat": 5 }], "expired": true }
  }
}
```

## Merging with other PRs

- **#35 (014 event images)** merged first and took 1.8.0, so this feature is 1.9.0. The branch was
  rebased onto it: one "Planned operations" paragraph (014's feature-neutral wording), both tags'
  descriptions, both features' `ErrorEnvelope` codes in the contract and in `ERROR_CODES`, and
  `api-schema.ts` regenerated.
- **#33 (012)** and **#34 (013)** are merged. 012's drift check applies to this feature's styles
  now; 013's `us-states.spec.ts` is why the new codes are in `ERROR_CODES` already.
