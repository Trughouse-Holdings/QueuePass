# Contract Changes: Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.24.0 to 1.25.0** in the spec and plan PR (MINOR: two rules stated
anew in descriptions, the 2-minute wait and the hold allowance's numbers; no operation, schema,
field, status, or error code changes), with `packages/shared/src/api-schema.ts` regenerated (`node
node_modules/openapi-typescript/bin/cli.js contracts/openapi.yaml -o
packages/shared/src/api-schema.ts`, the same as `npm run generate:api`; only its comments change)
and `node scripts/check-contract-drift.mjs` passing.

**Version order**: on top of `main` at `796e9a9` (1.24.0, spec `032`). `030`'s implementation, in
flight, does not change the contract. `032`'s implementation, in flight, does: it makes
`checkInDetailsRemovedAt` required (still 1.24.0) and regenerates `api-schema.ts`. Whichever of it
and this feature lands second keeps both changes, regenerates `api-schema.ts`, and reruns `node
scripts/check-contract-drift.mjs`.

No new operation, so no `x-planned` marker. Until the implementation merges, `main`'s Backend still
starts each seat's wait at its own release and uses 10 and 3 for holds; no client relies on the new
rule before then, so `main` stays green.

| Where | Change |
| --- | --- |
| `info.version` | 1.24.0 → 1.25.0 |
| `info.description`, **Attempt limits** | Buying: 10 in any 60 seconds, 3 in any 5 (`RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_5_SECONDS`). Holding seats: **30** in any 60 seconds, **10** in any 5 (`RATE_LIMIT_HOLD_PER_MINUTE`, `RATE_LIMIT_HOLD_PER_5_SECONDS`), because the Customer app holds each seat as it is clicked. |
| `reserveSeats` description | **Feature 033**: the Customer app sends one seat per request, one at a time. `SEAT_COOLDOWN` is for seats that left one of the caller's reservations released, run out, or on logout, when that **reservation** ended less than 2 minutes ago; `details.availableAt` is the reservation's end plus 2 minutes; a seat released from the active reservation while it keeps other seats can be reserved again at once, into it, with `expiresAt` unchanged; bought seats and seats ended by an admin change or cancellation never wait; a seat both taken and waiting is refused as `SEAT_TAKEN` (the sold check runs first). |
| `releaseSeats` description | Releasing the last seat ends the reservation, after which its seats that left released, run out, or on logout wait 2 minutes from that end (bought and admin-closed seats never wait); a seat released as others stay reserved can be reserved again at once. |
| `releaseAllMyReservations` description | The wait counts from each reservation's end (the same instant here). |
| `listMyReservations` description | **Feature 033**: the Customer app's cart is this list; nothing else is stored for it; each entry is bought with one `createOrder` for its event. |
| `responses.TooManyAttempts` description | The numbers per kind: `BUY` 10 / 3, `HOLD` 30 / 10. |
| `responses.Conflict` example `seatCooldown` | Summary "Seats of this customer's reservation that ended less than 2 minutes ago"; message "Your reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago. You can reserve it again at 23:02:30 UTC." (the Backend's message format, `HH:MM:SS UTC`). |

Unchanged: every path, `x-required-roles`, `x-attempt-limit`, request and response schemas
(`ReservationInput`, `ReservationRelease`, `Reservation`, `ReservationReleaseResult`,
`ReleasedSeats`, `OrderInput`), status codes, and `ErrorEnvelope`'s codes (`SEAT_COOLDOWN`,
`SEAT_TAKEN`, `RESERVATION_REQUIRED`, `RATE_LIMITED`, …). Clients branch on `error.code` and read
`details.seats` and `details.availableAt` as before; the message's wording is not part of the
contract.

## Examples

A customer holds Seats 5 and 6, then clicks Seat 6 (released, Seat 5 still held), then Seat 6 again:

```http
POST /events/{id}/reservation/release
{ "seats": [ { "sectionId": "<A>", "row": 1, "seat": 6 } ] }
```

→ `200`, `{ "reservation": { …, "seats": [ { "section": "A", "row": 1, "seat": 5, … } ], "expiresAt": "…T19:05:00Z" } }`

```http
POST /events/{id}/reservation
{ "seats": [ { "sectionId": "<A>", "row": 1, "seat": 6 } ] }
```

→ `200` (feature 033; before, `409 SEAT_COOLDOWN`): Seats 5 and 6, the same `expiresAt`.

Then Seats 5 and 6 are released (the reservation ends at 19:02:30 UTC), and Seat 6 is clicked:

```http
POST /events/{id}/reservation
{ "seats": [ { "sectionId": "<A>", "row": 1, "seat": 6 } ] }
```

→ `409`:

```json
{
  "error": {
    "code": "SEAT_COOLDOWN",
    "message": "Your reservation of Section A, Row 1, Seat 6 ended less than 2 minutes ago. You can reserve it again at 19:04:30 UTC.",
    "details": {
      "seats": [{ "section": "A", "row": 1, "seat": 6 }],
      "availableAt": "2026-12-05T19:04:30.000Z"
    }
  }
}
```

The eleventh hold attempt within 5 seconds (or the 31st within a minute):

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many tries. You can try again in 2 seconds.",
    "details": { "action": "HOLD", "retryAfterSeconds": 2 }
  }
}
```
