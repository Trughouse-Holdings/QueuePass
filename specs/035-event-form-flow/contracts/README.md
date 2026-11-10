# Contract Changes: Event Form Flow

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.25.0 to 1.26.0** (MINOR: optional request fields and an optional
`id` on `EventTierInput`; no response, operation, or error code changes), with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passing.

**Version order**: `main` is 1.25.0 (spec `033`'s contract, merged with its spec PR). Open PR
#153 (spec `034`) also takes 1.26.0. If that PR merges first, this branch rebases and takes
1.27.0 on top, keeping both changes (research R10, R12). Feature 032's existing text on
`updateEvent` (the `CHECK_IN_DETAILS_REMOVED` rule) is left as it is.

No new operation, so no `x-planned` marker. Until the implementation is on `main`, the Backend
refuses `tiers` and `reservedSeating` on `updateEvent`, and `id` on a ticket type, as unknown
fields (`400 VALIDATION_FAILED`). No client sends them before then, so `main` stays green.

| Where | Change |
| --- | --- |
| `info.version` | 1.25.0 → 1.26.0 |
| `updateEvent` description | New paragraphs **Feature 035**: optional `reservedSeating` and `tiers`, the complete new set, all or nothing; without them, exactly as before; `id` on a type keeps it; a type without `id` is created; an existing type left out is removed; sold-ticket and hold rules as today's separate operations; the order of checks (details as today, then seating and ticket types as `031`, then sold-ticket rules); which field a refusal is about, the same paths as `031`, plus `tiers.<i>.id` and a removal on `tiers` |
| `createEvent` description | A sentence: `EventTierInput.id` is not allowed on a schedule (`400`, `tiers.<i>.id`) |
| `EventUpdate` | New optional `reservedSeating` (boolean; left out with `tiers` is `false`) and `tiers` (array of `EventTierInput`, at most 50); neither may be sent as `null` |
| `EventTierInput` | New optional `id` (UUID); only on `updateEvent`; not `null` |
| `responses.EventTimeRejected` examples | New `tierIdOnCreate` and `unknownTierIdOnUpdate` |
| `responses.Conflict` examples | New `updateTierHasOrders` (`TIER_HAS_ORDERS`, `details.field: tiers`) and `updateSeatingHasSold` (`EVENT_HAS_ORDERS`, `details.field: reservedSeating` or `tiers.<i>.sectionIds`) |

Unchanged: the path (`PATCH /events/{id}`), `x-required-roles: [queuepass-admin]`, the response
schemas and status codes, `ErrorEnvelope`'s codes, `createTier`, `updateSeating`, `createEvent`'s
existing fields, and every other operation.

## Examples

```http
PATCH /events/{id}
{
  "name": "Season Opener (rescheduled)",
  "reservedSeating": true,
  "tiers": [
    { "id": "<floor-id>", "name": "Floor", "price": "80.00", "sectionIds": ["<front>"] },
    { "name": "Balcony", "price": "60.00", "sectionIds": ["<middle>", "<back>"] }
  ]
}
```

→ `200`, the event; Floor kept and remapped if no sold seats block it; Balcony created; any
previous type not listed removed if it has no orders.

```http
PATCH /events/{id}
{ "name": "Season Opener (rescheduled)" }
```

→ `200`, only the name changes, as today.

```http
PATCH /events/{id}
{ "name": "New name", "tiers": [
    { "id": "<floor-id>", "name": "Floor", "price": "80.00", "quantity": 300 },
    { "name": "floor", "price": "60.00", "quantity": 200 }
  ] }
```

→ `409 TIER_NAME_TAKEN`, `details.field: tiers.1.name`; the name, Floor, and the rest of the
event are unchanged.

```http
POST /events
{ …, "tiers": [ { "id": "<any>", "name": "Floor", "price": "80.00", "quantity": 300 } ] }
```

→ `400`, nothing saved; an entry starting with `tiers.0.id`.
