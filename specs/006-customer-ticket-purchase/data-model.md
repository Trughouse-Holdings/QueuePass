# Data Model: Customer Ticket Purchase

## Order (changed)

| Column | Type | Rules |
|---|---|---|
| `requestId` | `uuid` null | the client's id for one confirmation (research R3) |

New indexes:

- `Order_customerSub_requestId_key`: unique on `(customerSub, requestId)`. PostgreSQL treats
  `NULL`s as distinct, so orders without a `requestId` (`005`'s tests, the demo script) never
  collide.
- `Order_customerSub_createdAt_idx` on `(customerSub, createdAt)` for My tickets (research R4).

No other table changes. `Ticket`, `TicketTier`, and `Event` are unchanged.

## Derived: availability (not stored)

| Value | Rule |
|---|---|
| Event tickets left | `max(0, Event.totalTicketCapacity − valid tickets for the event)` |
| Tier tickets left | `max(0, min(TicketTier.quantity − valid tickets for the tier, event tickets left))` |
| Sales closed | `CANCELLED` if `Event.status = CANCELLED`; else `STARTED` if `now ≥ Event.startsAt`; else `null` |

## Rules enforced under the event-row lock (order placement)

In this order:

1. A repeat `requestId` from the same customer returns the earlier order, or is refused as
   `REQUEST_ID_REUSED` if its event, tier, or quantity differ.
2. A cancelled event refuses (`EVENT_CANCELLED`, from `005`).
3. An event at or past its start time refuses (`SALES_CLOSED`, new).
4. Tier rules and no-oversell (from `005`).

## Migration `20261004000000_order_request_id`

Adds `Order.requestId` and the two indexes above. Existing orders keep `requestId = NULL`.
