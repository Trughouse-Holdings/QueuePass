# Contracts for 006

The contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml), moved to **1.4.0**
in this plan PR with `packages/shared/src/api-schema.ts` regenerated.

| Method | Path | `x-required-roles` | Operation | Change in 006 |
|---|---|---|---|---|
| GET | `/me/orders` | `customer` | `listMyOrders` | **new** |
| GET | `/events/{id}/availability` | any signed-in | `getEventAvailability` | **new** |
| POST | `/events/{id}/orders` | `customer` | `createOrder` | + optional `requestId`; + `200` for a repeated request; + `409 SALES_CLOSED`, `409 REQUEST_ID_REUSED` |

New schemas: `MyOrder` (`Order` plus `event`), `OrderEvent`, `Availability`, `TierAvailability`.
New error codes: `SALES_CLOSED`, `REQUEST_ID_REUSED`. Nothing existing is removed or narrowed.
