# Contract Changes: All-or-Nothing Event Scheduling

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it to **1.23.0** in the spec and plan PR (MINOR: two optional request fields and
a new request schema; no response, operation, or error code changes), with
`packages/shared/src/api-schema.ts` regenerated (`node node_modules/openapi-typescript/bin/cli.js
contracts/openapi.yaml -o packages/shared/src/api-schema.ts`, the same as `npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passing.

**Version order**: `main` is at 1.21.0. Spec `030` (branch `030-hide-past-events-spec`, not merged)
takes 1.22.0. This branch, cut from `main`, goes 1.21.0 → 1.23.0 directly; once `030` merges it is
rebased onto `main`, keeping `030`'s `listEvents` change and this version, and `api-schema.ts` is
regenerated (research R12).

No new operation, so no `x-planned` marker. Until the implementation merges, `main`'s Backend
refuses `tiers` and `reservedSeating` as unknown fields (`400 VALIDATION_FAILED`, the global pipe's
`forbidNonWhitelisted`); no client sends them before then, so `main` stays green. The generated
types make both fields optional (no `default`), so the Admin app's existing `createEvent` call
compiles unchanged.

| Where | Change |
| --- | --- |
| `info.version` | 1.21.0 → 1.23.0 |
| `createEvent` description | New paragraphs **Feature 031**: the event, its ticket types, and its reserved seating are saved together or not at all; without `tiers` and `reservedSeating` (or with `tiers: []` and `false`) exactly as before; the order of checks (seating right after the times and doors, then capacity, limit, conflict, then each ticket type in order, then their total); seated quantities from the sections; the venue held for the whole transaction; **which field a refusal is about**: the path `tiers.<index>.<field>`, `tiers`, `reservedSeating`, or `totalTicketCapacity`, in `details.field` on a `409` and at the start of each `details.fields` entry on a `400`. |
| `EventInput` | New optional `reservedSeating` (boolean; left out is `false`) and `tiers` (array of `EventTierInput`). |
| `EventTierInput` | New schema: `name` and `price` required (as `TicketTierInput`), `quantity` (integer ≥ 1, without reserved seating only), `sectionIds` (unique UUIDs, with reserved seating only). |
| `responses.EventTimeRejected` examples | New `tierFieldsFailed` (two ticket type fields at once, with paths) and `sectionNotInLayout`. |
| `responses.Conflict` examples | New `tierNameRepeatedInRequest` (`TIER_NAME_TAKEN`, `details.field: tiers.1.name`) and `tiersOverCapacityInRequest` (`CAPACITY_EXCEEDED`, `details.field: tiers`, `totalTicketCapacity`, `tierTotal`). |

Unchanged: the path, `x-required-roles: [queuepass-admin]`, the response schemas and status codes
(`201` `Event`; `400`, `401`, `403`, `404`, `409`), `ErrorEnvelope`'s codes, `TicketTierInput`,
`SeatingInput`, `createTier`, `updateSeating`, `updateEvent`, and every other operation.

`api-schema.ts` gains `EventInput.reservedSeating?: boolean`, `EventInput.tiers?:
EventTierInput[]`, the `EventTierInput` schema, and the new descriptions.

## Examples

```http
POST /events
{
  "name": "Season Opener", "locationId": "6c0e…", "basePrice": "60.00",
  "startsAt": "2026-12-05T19:00:00-05:00", "endsAt": "2026-12-05T22:00:00-05:00",
  "doorsOpenAt": "2026-12-05T18:00:00-05:00",
  "tiers": [
    { "name": "Floor", "price": "80.00", "quantity": 300 },
    { "name": "Balcony", "price": "60.00", "quantity": 200 }
  ]
}
```

→ `201`, the event; it has both ticket types.

```http
POST /events
{ …, "reservedSeating": true,
  "tiers": [
    { "name": "Front", "price": "120.00", "sectionIds": ["<front>"] },
    { "name": "Standard", "price": "70.00", "sectionIds": ["<middle>", "<back>"] }
  ] }
```

→ `201`, the event with `reservedSeating: true` and `totalTicketCapacity` the layout's total; Front's
quantity is front's seats, Standard's the other two sections'.

```http
POST /events
{ …, "tiers": [
    { "name": "Floor", "price": "80.00", "quantity": 300 },
    { "name": "floor", "price": "60.00", "quantity": 200 }
  ] }
```

→ `409`, nothing saved:

```json
{
  "error": {
    "code": "TIER_NAME_TAKEN",
    "message": "Ticket type 2, 'floor', has the same name as ticket type 1, 'Floor'. Give each ticket type its own name.",
    "details": { "field": "tiers.1.name" }
  }
}
```

```http
POST /events
{ …, "tiers": [ { "name": "Floor", "price": "80.001" }, { "name": "", "price": "60.00", "quantity": 0 } ] }
```

→ `400`, nothing saved; every malformed field at once, each starting with its path (the exact wording
is the validation pipe's, from the DTO messages):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed.",
    "details": {
      "fields": [
        "tiers.0.price must be a non-negative decimal string with at most 2 decimal places",
        "tiers.1.name must be between 1 and 100 characters",
        "tiers.1.quantity must be a positive whole number"
      ]
    }
  }
}
```

A missing `quantity` without reserved seating (`tiers.0` above) is not a shape error: it is the
service's `400`, `tiers.0.quantity is required for a tier` (`TiersService`'s message with the path in
front), reported only when the shape is valid (research R4).
