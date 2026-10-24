# Contract Changes: Add to Calendar

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.11.0 to 1.12.0** in the spec and plan PR (or to the next minor
version if `020` merges a contract change first; see Merging with other PRs), with
`packages/shared/src/api-schema.ts` updated to match (`npm run generate:api`; the drift check,
`scripts/check-contract-drift.mjs`, confirms it in CI).

The change is one additive field. The new field is declared but not yet in `required`; the
implementation PR sends it and adds it to `required` (research R2, the pattern of 018's
`verifiedBy`).

## New operations

None. The calendar file and the Google Calendar link are made in the Customer app (research R1).

## Changed operations

| Operation | Change |
|---|---|
| `listMyOrders` (`GET /me/orders`, `customer`) | Each order's `event.location` also carries `address`. Role, parameters, status codes, and errors are unchanged. |

## Schemas

| Schema | Change |
|---|---|
| `OrderEvent.location` | `address`: string, `minLength: 1`, `maxLength: 500`, the venue's `Location.address`. Not in `required` until the implementation PR. |

No new error code. No change to `Location`, `Event`, `Order`, or any request body.

## Example

```json
{
  "id": "b4e1…",
  "event": {
    "id": "6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21",
    "name": "Season Opener",
    "startsAt": "2026-10-31T23:30:00.000Z",
    "endsAt": "2026-11-01T02:45:00.000Z",
    "status": "SCHEDULED",
    "location": {
      "id": "0d6f…",
      "name": "KFC Yum! Center",
      "address": "1 ARENA PLAZA, LOUISVILLE, KY 40202"
    }
  },
  "…": "the rest of the order, unchanged"
}
```

## The implementation PR

1. Sends `address` from `OrdersService.mine()` (the venue row is already loaded).
2. Adds `address` to `OrderEvent.location`'s `required`, and deletes the sentence "Always sent once
   feature 019 is implemented, which adds it to `required`." from its description.
3. Regenerates `api-schema.ts` (`npm run generate:api`) and makes `OrderEvent.location.address` a
   required `string` in `packages/shared/src/order.ts`.

The contract version stays the one this spec PR merged with for those steps (they finish this
feature's change).

## Merging with other PRs

Spec `020-venue-time-zones` (#42) is specified in parallel and may also change the contract,
possibly `Location` or `OrderEvent.location` (a venue's time zone). 1.12.0 holds unless 020 merges
its contract change first. Then this branch is rebased onto `main`, takes the next minor version
(1.13.0), keeps both changes where they meet in `OrderEvent.location`, and regenerates
`api-schema.ts` with `npm run generate:api` rather than merging it by hand; the drift check must
pass. If 019 merges first, 020 does the same. There is no conflict in meaning: 019 reads only
`address`, and its calendar times are UTC instants (research R5).
