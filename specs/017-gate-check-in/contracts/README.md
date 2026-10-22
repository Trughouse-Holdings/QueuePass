# Contract Changes: Names on Tickets and Gate Check-In

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.9.0 to 1.10.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and the three new error
codes added to `ERROR_CODES` in `packages/shared/src/errors.ts`.

The two new operations carry `x-planned: '017'` until the implementation PR removes the marker
(research R7). Two new fields are declared but not yet in `required`; the implementation adds them.

## New operations

| Operation | Route | Role | Answers |
|---|---|---|---|
| `lookupEntryTicket` | `POST /events/{id}/entry/lookup` | `gate-agent` | `200 EntryTicket` for any ticket that exists, with its `state`; `404 TICKET_NOT_FOUND` for an unknown or malformed code; `404 NOT_FOUND` for an unknown event; `400` for a missing code |
| `admitTicket` | `POST /events/{id}/entry/admit` | `gate-agent` | `200 EntryResult` when at least one ticket was admitted; `409 ENTRY_REFUSED` (`details.reason`: `USED`, `VOID`, `OTHER_EVENT`, `NOT_OPEN`, `ENDED`); `404 TICKET_NOT_FOUND`; `404 NOT_FOUND` |

A new tag, `entry`, groups them.

## Changed operations

| Operation | Change |
|---|---|
| `createOrder` | `holderName`: the buyer's name for every ticket of the order, trimmed, then 1–100 characters, at least one letter, no control characters; otherwise `400 HOLDER_NAME_INVALID` (`details.reason`). A repeated `requestId` must name the same `holderName`. Its `400` now points at the new `OrderRejected` response. |
| `listAttendees`, `listMyOrders`, `createOrder` responses | Each `Order` carries `holderName` (`null` before 017). |

## Schemas

| Schema | Change |
|---|---|
| `OrderInput` | `holderName` (string, at most 400 characters as sent). Not in `required` until the implementation PR, which adds it (as spec 016 R9). |
| `Order` | `holderName` (string 1–100, or `null`). Not in `required` until the implementation PR. |
| `EntryLookupInput` | new: `code` (1–64 characters; case, spaces, and dashes ignored). |
| `EntryTicket` | new: `ticketId`, `code`, `orderId`, `state`, `event` (`id`, `name`, `startsAt`, `endsAt`), `tierName`, `seat`, `holderName`, `usedAt`, `entryOpensAt`, `unusedOnOrder` (0–10). |
| `AdmitInput` | new: `ticketId`, `wholeOrder`. |
| `EntryResult` | new: `admitted` (`EntryTicketRef[]`, 1–10), `alreadyUsed` (`EntryTicketRef[]`, 0–9). |
| `EntryTicketRef` | new: `ticketId`, `code`, `usedAt`. |
| `ErrorEnvelope.code` | adds `HOLDER_NAME_INVALID`, `TICKET_NOT_FOUND`, `ENTRY_REFUSED`. |
| responses | new `OrderRejected` (400) and `EntryNotFound` (404); `Conflict` gains the examples `entryRefusedUsed` and `entryRefusedNotOpen`. |

`Ticket` does not change: its `checkedInAt` becomes the time of the entry. Who admitted a ticket is
stored (data-model.md) but not returned by any operation in this feature.

## Example lookup

```json
{
  "ticketId": "3b8e…",
  "code": "7KQ2M9XWAB4C",
  "orderId": "a1f0…",
  "state": "ADMITTABLE",
  "event": { "id": "7c2f…", "name": "Season Opener", "startsAt": "2026-10-24T19:00:00-04:00", "endsAt": "2026-10-24T22:00:00-04:00" },
  "tierName": "General",
  "seat": null,
  "holderName": "Jordan Lee",
  "usedAt": null,
  "entryOpensAt": "2026-10-24T17:00:00-04:00",
  "unusedOnOrder": 4
}
```

## Example admit

Request `{ "ticketId": "3b8e…", "wholeOrder": true }`, after another gate admitted one of the four:

```json
{
  "admitted": [
    { "ticketId": "3b8e…", "code": "7KQ2M9XWAB4C", "usedAt": "2026-10-24T18:31:07-04:00" },
    { "ticketId": "9d21…", "code": "QX4TR8MN2PLE", "usedAt": "2026-10-24T18:31:07-04:00" },
    { "ticketId": "c7aa…", "code": "HB6W3ZK9DUFJ", "usedAt": "2026-10-24T18:31:07-04:00" }
  ],
  "alreadyUsed": [
    { "ticketId": "e450…", "code": "M2Y7CS5GVRXT", "usedAt": "2026-10-24T18:30:52-04:00" }
  ]
}
```

## Example refusals

```json
{
  "error": {
    "code": "ENTRY_REFUSED",
    "message": "This ticket was already used at 19:42 on Oct 24.",
    "details": { "reason": "USED", "usedAt": "2026-10-24T19:42:10-04:00" }
  }
}
```

```json
{
  "error": {
    "code": "HOLDER_NAME_INVALID",
    "message": "The name on the tickets must contain at least one letter.",
    "details": { "reason": "NO_LETTER" }
  }
}
```

## Verified on 2026-10-22

With contract 1.10.0, the regenerated types, and the new `ERROR_CODES` on this branch: the drift
check passes, `packages/shared` passes (358 tests), and the full Backend suite passes (69 suites,
639 tests), including the route-coverage test with the two `x-planned` operations unserved, and
`us-states.spec.ts`.
