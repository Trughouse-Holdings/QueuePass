# Contract Changes: Rotating QR Codes

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.10.0 to 1.11.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and the two new error codes
added to `ERROR_CODES` in `packages/shared/src/errors.ts`.

The new operation carries `x-planned: '018'` until the implementation PR removes the marker. The
new `EntryTicket.verifiedBy` is declared but not yet in `required`; the implementation adds it
(research R7).

## New operation

| Operation | Route | Role | Answers |
|---|---|---|---|
| `getTicketEntryKey` | `GET /me/tickets/{ticketId}/entry-key` | `customer` | `200 TicketEntryKey` (with `Cache-Control: no-store`) for the caller's own valid, unused ticket; `404 NOT_FOUND` for another customer's ticket or none; `400 VALIDATION_FAILED` for an id that is not a UUID; `409 ENTRY_REFUSED` (`USED` with `usedAt`, or `VOID`) |

It is tagged `entry`.

## Changed operations

| Operation | Change |
|---|---|
| `lookupEntryTicket` | `code` may be a live code (`QP1:…`). A live code QueuePass did not make, or naming no ticket, is `404 LIVE_CODE_INVALID`; a genuine one outside its window and 5 seconds of grace is the new `409 LIVE_CODE_EXPIRED`, with no ticket details. Otherwise the answer is spec 017's, plus `verifiedBy`. |

`admitTicket` does not change (research R6).

## Schemas

| Schema | Change |
|---|---|
| `EntryLookupInput.code` | `maxLength` 64 → 80; the description names both kinds of code. |
| `EntryTicket` | `verifiedBy`: `LIVE_CODE` or `TICKET_CODE`. Not in `required` until the implementation PR. |
| `TicketEntryKey` | new: `ticketId`, `key` (base64url of 32 bytes, 43 characters), `serverTime` (date-time with milliseconds). |
| `ErrorEnvelope.code` | adds `LIVE_CODE_INVALID`, `LIVE_CODE_EXPIRED`. |
| responses | `EntryNotFound` gains the `liveCodeInvalid` example; `lookupEntryTicket` gains a `409` with the `LIVE_CODE_EXPIRED` example. |

## Example entry key

```json
{
  "ticketId": "3b8e5f0a-6c1d-4b7e-9a2f-1d0c3e4b5a69",
  "key": "q3J8b0xQm1vT9yZ2cE4hK7nR5sW1aD6fG8jL0pU3iO_",
  "serverTime": "2026-10-24T22:31:07.412Z"
}
```

## Example live-code lookup

Request body:

```json
{ "code": "QP1:3B8E5F0A6C1D4B7E9A2F1D0C3E4B5A69:58773103:KX4N2Q7WZB3T5RYM" }
```

Answer: spec 017's `EntryTicket` for that ticket, with `"verifiedBy": "LIVE_CODE"`.

## Example refusals

```json
{ "error": { "code": "LIVE_CODE_EXPIRED", "message": "This live code has expired." } }
```

```json
{ "error": { "code": "LIVE_CODE_INVALID", "message": "This is not a valid QueuePass code." } }
```

The key and live code above are illustrative: they have the right shape and length, but the MAC is
not computed from the key.

## Verified on 2026-10-23

With contract 1.11.0, the regenerated types, and the two new `ERROR_CODES` on this branch:
`packages/shared` passes (380 tests), the full Backend suite passes (76 suites, 703 tests),
including the route-coverage test with `getTicketEntryKey` unserved and `us-states.spec.ts`, and
the Customer, Ticket Booth, and Admin apps type-check against the new types.
