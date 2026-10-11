# Contract Changes: Per-Customer Ticket Limit

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.5.0 to 1.6.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`). No route is added or
removed, and no role changes.

| Where | Change |
|---|---|
| `Event` | `maxTicketsPerCustomer: integer \| null`, minimum 1. Not in `required` (research R9). |
| `EventInput` | optional `maxTicketsPerCustomer: integer \| null`; must not exceed `totalTicketCapacity` (`400`). |
| `EventUpdate` | optional `maxTicketsPerCustomer: integer \| null`; `null` clears. |
| `createEvent` | description: the limit is from 1 to the event's capacity (an omitted capacity is the venue's), `400`. |
| `updateEvent` | description: after the existing capacity checks, a limit sent above the capacity is `400`; a capacity cut below the stored limit is `409 CAPACITY_EXCEEDED`; lowering or clearing changes no order. |
| `replaceLayout` | description: a total below a seated event's limit is `409 CAPACITY_EXCEEDED`, naming the event. |
| `Availability` | `customerLimit: CustomerLimit \| null`. Not in `required` (research R9). |
| `CustomerLimit` | new schema: `limit`, `held`, `remaining`. |
| `createOrder` | description: the limit rule, `409 TICKET_LIMIT_REACHED`, which refusal wins, concurrency, replays count once. |
| `ErrorEnvelope.code` | adds `TICKET_LIMIT_REACHED`. |
| `Conflict` examples | adds `ticketLimitReached`. |

Example refusal:

```json
{
  "error": {
    "code": "TICKET_LIMIT_REACHED",
    "message": "Season Opener allows 8 tickets per customer. You already hold 5, so you can get 3 more; 5 were requested.",
    "details": { "limit": 8, "held": 5, "remaining": 3, "requested": 5 }
  }
}
```
