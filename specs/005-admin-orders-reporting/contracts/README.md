# Contracts for 005

The contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml), moved to **1.3.0**
in this plan PR with `packages/shared/src/api-schema.ts` regenerated.

| Method | Path | `x-required-roles` | Operation | Change in 005 |
|---|---|---|---|---|
| POST | `/events/{id}/orders` | `customer` | `createOrder` | **new** |
| GET | `/events/{id}/attendees` | `queuepass-admin` | `listAttendees` | **new** |
| POST | `/events/{id}/cancel` | `queuepass-admin` | `cancelEvent` | **new** |
| GET | `/reports/sales` | `queuepass-admin` | `getSalesReport` | **new** |
| DELETE | `/events/{id}` | `queuepass-admin` | `deleteEvent` | + `409 EVENT_HAS_ORDERS` |
| DELETE | `/events/{id}/tiers/{tierId}` | `queuepass-admin` | `deleteTicketTier` | + `409 TIER_HAS_ORDERS` |
| PATCH | `/events/{id}` | `queuepass-admin` | `updateEvent` | `409` also for sold tickets and cancelled (described) |
| POST, PATCH | `/events/{id}/tiers…` | `queuepass-admin` | tier writes | `409` also for cancelled and tierless sales (described) |

`Event` gains required `status` and `cancelledAt`. New schemas: `Order`, `OrderInput`, `Ticket`,
`Cancellation`, `SalesReport`, `EventSales`, `TierSales`. New error codes: `SOLD_OUT`,
`EVENT_CANCELLED`, `EVENT_HAS_ORDERS`, `TIER_HAS_ORDERS`.
