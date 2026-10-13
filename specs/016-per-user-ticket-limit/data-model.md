# Data Model: Per-Customer Ticket Limit

One new column and one CHECK, in one migration: `backend/prisma/migrations/20261011000000_per_customer_ticket_limit/`.

## Event (changed)

| Field | Type | Rule |
|---|---|---|
| `maxTicketsPerCustomer` | `Int?` | `NULL` = no limit. Otherwise 1 to `totalTicketCapacity` (FR-001). |

```sql
ALTER TABLE "Event" ADD COLUMN "maxTicketsPerCustomer" INTEGER;
ALTER TABLE "Event" ADD CONSTRAINT "event_max_tickets_per_customer_range"
  CHECK ("maxTicketsPerCustomer" IS NULL
         OR "maxTicketsPerCustomer" BETWEEN 1 AND "totalTicketCapacity");
```

- No default and no backfill: every existing event has no limit (FR-017).
- Writes that can break the range are refused by the Backend first, with a message (research R6).
  The CHECK is the backstop.
- A cancelled event is read-only, as today (FR-010).

## A customer's holding for an event (derived, not stored)

```text
held(customer, event) = count of Ticket
                        where Ticket.eventId = event
                          and Ticket.status = VALID
                          and Ticket.order.customerSub = customer
```

- Counts every ticket type and section (FR-003).
- Void tickets (from a refund when an event is cancelled) are excluded (FR-003).
- Computed inside the order transaction, after the event row lock (research R2), and in the
  availability read without a lock (guidance only, as today).

## Order acceptance rule (changed)

For an order of `quantity` by customer `c` for event `e` with a limit:

```text
accept only if  held(c, e) + quantity <= e.maxTicketsPerCustomer
```

in addition to every existing rule (per-order 1–10, tickets left, tier, seats, sales open). The
refusal is `TICKET_LIMIT_REACHED` when the limit is the smaller cap, `SOLD_OUT` otherwise
(research R3).

## Availability (changed response)

| Field | Type | Meaning |
|---|---|---|
| `customerLimit` | `{ limit, held, remaining } \| null` | The caller's standing; `null` without a limit or for a non-customer. `remaining = max(0, limit - held)`. |

## Shared types

- `packages/shared/src/event.ts`: `Event.maxTicketsPerCustomer?: number | null`;
  `EventInput.maxTicketsPerCustomer?: number | null`. `Event`'s field is optional, like
  `Availability.customerLimit`, because the contract lists it as optional (research R9) and the
  front ends check their API responses against these types; a required field would not accept the
  generated type. The Backend still always sends it. (Corrected during implementation.)
- `packages/shared/src/order.ts`: new `CustomerLimit { limit: number; held: number; remaining:
  number }`, and `Availability.customerLimit?: CustomerLimit | null`. The Backend's
  `AvailabilityService` and the Customer app's `GetTickets` use this hand-written type, not
  `api-schema.ts`.
- `packages/shared/src/errors.ts`: `TICKET_LIMIT_REACHED` added to `ERROR_CODES`.
- `packages/shared/src/api-schema.ts`: regenerated from contract 1.6.0 (in this PR).
