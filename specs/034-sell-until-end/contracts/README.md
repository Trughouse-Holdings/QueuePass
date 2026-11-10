# Contract Changes: Sell Tickets Until the Event Ends

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.25.0 (spec `033`, merged as `17b3b88`) to 1.26.0** in the spec and
plan PR (MINOR: a new response field and a new enum value, and the sales rule of two operations moves
from `startsAt` to `endsAt`), with `packages/shared/src/api-schema.ts` regenerated (`node
node_modules/openapi-typescript/bin/cli.js contracts/openapi.yaml -o
packages/shared/src/api-schema.ts`, the same as `npm run generate:api`) and `node
scripts/check-contract-drift.mjs` passing (research R2, R12).

No operation is added or removed, no request shape changes, and no error code is added: `409
SALES_CLOSED` stays, refused at a different instant.

| Where | Change |
| --- | --- |
| `info.version` | 1.25.0 → 1.26.0 |
| `info.description` | New paragraph **Sales window** (feature 034): orders and seat reservations until `endsAt`, half-open, then `409 SALES_CLOSED`; a cancelled event is `409 EVENT_CANCELLED` first; `startsAt` plays no part in whether sales are open; from `startsAt` until `endsAt` the event is in progress (`Availability.inProgress`); open reservations end at `endsAt` within a few seconds, their `expiresAt` never shortened. |
| `createOrder` description | "Feature 006, as changed by feature 034: sales close when the event ends; an order at or after `endsAt` is refused (`409 SALES_CLOSED`), and one after `startsAt` but before `endsAt` is placed like any other." A repeated `requestId` is returned "even if the event has since sold out, ended, or been cancelled". |
| `reserveSeats` description | "…is cancelled (`409 EVENT_CANCELLED`), or has ended (`409 SALES_CLOSED`; feature 034, before which it was refused once started)…" |
| `getEventAvailability` description | New paragraph **Feature 034**: `salesClosed` is `ENDED` from `endsAt` (`STARTED` no longer sent); `inProgress` from `startsAt` until `endsAt`, by the same clock in the same answer; the Customer app's notice comes from these two values. |
| `Availability` | Description names `inProgress`. `salesClosed.enum`: `[CANCELLED, ENDED, STARTED, null]`, described (`CANCELLED` whatever the time, else `ENDED` from `endsAt`; `STARTED` only before 034 is implemented). New property `inProgress` (`boolean`), not in `required` yet. |
| `responses.Conflict` example `salesClosed` | summary "The event has ended, so sales are closed (features 006, 034)"; message "Sales for Season Opener closed when it ended." |

## Two steps, as PR #151 proposes for `032`

Every response the Backend's tests receive is checked against the contract
(`backend/test/setup/authed-request.ts`), so `main` must accept the Backend as it is until the
implementation merges:

1. **This PR**: `STARTED` stays in the enum, and `inProgress` is optional. `main`'s Backend, which sends
   `STARTED` and no `inProgress`, still matches.
2. **The implementation PR** (tasks T014): `STARTED` leaves the enum and the `salesClosed` description;
   `inProgress` is added to `Availability.required`, and its description's last sentence ("Always sent
   once 034 is implemented …") becomes "Always sent."; `api-schema.ts` regenerated; the version stays
   **1.26.0**. A shared-surface change in that PR, approved there by every team member.

Keeping 1.26.0 in the implementation is acceptable under Principle I because the contract text
approved in this PR already announces the final shape: `STARTED` is described as never sent once
`034` is implemented and to be removed by that implementation, and `inProgress` as always sent and
required then. The implementation changes no behavior the reviewed contract does not already state.
`032`'s merged contract README says only that its implementation "always sends" its fields; making
them required at 1.24.0 is what its implementation PR (#151, open) proposes, so this is not yet a
merged precedent.

`packages/shared/src/order.ts` (hand-written types, shared surface) changes in this PR too:
`SalesClosedReason` is `'CANCELLED' | 'ENDED' | 'STARTED'` and `Availability` gains `inProgress?:
boolean`, because the Customer and Admin apps assign the generated availability response to that type
(`GetTickets.tsx`, `admin-app/src/api/seating.ts`) and would not build otherwise. The implementation
narrows them to `'CANCELLED' | 'ENDED'` and `inProgress: boolean`.

## Examples

```http
GET /events/{id}/availability      (an event that started 15 minutes ago, ends in 2 hours)
```

→ `200`:

```json
{
  "eventId": "6c0e…",
  "ticketsLeft": 42,
  "salesClosed": null,
  "inProgress": true,
  "tiers": [],
  "customerLimit": null
}
```

The same event after its end: `"salesClosed": "ENDED", "inProgress": false`. Cancelled while in
progress: `"salesClosed": "CANCELLED", "inProgress": true`.

```http
POST /events/{id}/orders           (the event ended a second ago)
```

→ `409`:

```json
{ "error": { "code": "SALES_CLOSED", "message": "Sales for Season Opener closed when it ended." } }
```

`reserveSeats` for that event answers the same.

## Coordination

`032`'s implementation (PR #151) also edits the contract (it makes `checkInDetailsRemovedAt`
required, still 1.24.0) and regenerates `api-schema.ts`. Whichever lands second keeps both changes,
regenerates `api-schema.ts`, and reruns `check-contract-drift`. `033`'s implementation makes no
contract change.
