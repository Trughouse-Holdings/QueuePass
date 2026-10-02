# Research: Admin Orders, Reporting, Attendees, and Safe Cancellation

Decisions for feature `005`, planned under constitution v2.1.0 on top of `004`.

## R1: Data model

Two tables and two event columns ([data-model.md](./data-model.md)):

- `Order`: `eventId` (FK `RESTRICT`), `tierId` (nullable FK `RESTRICT`), `customerSub`,
  `customerUsername`, `quantity` (1–10), `unitPrice`, `totalPrice` (`numeric(10,2)`), `status`
  (`CONFIRMED` | `REFUNDED`), `createdAt`, `refundedAt`.
- `Ticket`: `orderId` (FK `RESTRICT`), `eventId`, `tierId`, `code` (unique), `status` (`VALID` |
  `VOID`), `checkedInAt`.
- `Event.status` (`SCHEDULED` | `CANCELLED`, default `SCHEDULED`) and `Event.cancelledAt`.

`eventId` and `tierId` are copied onto tickets so counting sold tickets per event and tier is one
indexed query. The customer is identified by the token's `sub` and `preferred_username`
(Constitution V: QueuePass stores at most the subject identifier, plus the username for display).

## R2: No overselling, under the same event lock as 004

An order runs in one transaction that first takes `004`'s event-row lock (`SELECT … FOR UPDATE`),
then counts valid tickets for the event (and the tier), then inserts. Orders for the same event
serialize; the count is always current. Every write that can change availability takes the same
lock: orders, tier writes, capacity edits, and cancellation. This is the database guarantee
Constitution IV requires for FR-002. Refusal: `409 SOLD_OUT` with `details: { available,
requested }`.

**Alternatives rejected**: a `sold` counter column with a CHECK (`sold <= quantity`) would also be
safe, but needs two counters (event and tier) kept in step on every refund; counting under the
lock is simpler and exact at this scale.

## R3: Ticket codes

12 characters from a 32-symbol alphabet without look-alikes (`A–Z` minus `I`, `O`; `2–9`), drawn
with `crypto.randomInt`: 60 bits, unguessable for a proof of concept. A unique index guarantees
uniqueness; a collision (vanishingly rare) aborts the transaction and the order is retried once.
QR rendering is a later spec.

## R4: Cancellation is one transaction

`POST /events/{id}/cancel` locks the event, refuses if already cancelled (`409
EVENT_CANCELLED`), then updates tickets `VALID → VOID`, orders `CONFIRMED → REFUNDED` with
`refundedAt`, and the event to `CANCELLED` with `cancelledAt`, and returns the counts. A
concurrent second cancel waits on the lock and then sees `CANCELLED`.

**Venue time**: `event_no_overlap` is recreated with `WHERE (status = 'SCHEDULED')`, so a
cancelled event no longer blocks its slot (FR-009). The service's conflict pre-check gets the same
filter. Every existing scheduling test must still pass.

**Read-only after cancel**: event updates, tier writes, and orders check status under the lock
and refuse with `409 EVENT_CANCELLED`.

## R5: Deleting with orders

`DELETE /events/{id}` counts orders first (`409 EVENT_HAS_ORDERS`, `details.orderCount`); the
`Order.eventId` FK (`RESTRICT`) is the guarantee. `TicketTier` deletion likewise
(`409 TIER_HAS_ORDERS`). The exception filter's `P2003` mapping becomes specific to the
constraint that fired instead of always saying "venue". Shrinking rules (FR-011) run under the
lock: event capacity `>= ticketsSold`, tier quantity `>= tier ticketsSold`, and no first tier when
tierless tickets exist (`409 EVENT_HAS_ORDERS`).

## R6: The report is computed on request

`GET /reports/sales` runs three grouped queries (valid tickets by event and tier; checked-in valid
tickets by event; confirmed order revenue by event and tier) and joins them with events, venues,
and tiers in memory. Sums use `Prisma.Decimal`, serialized as two-decimal strings. At a few
hundred events this is milliseconds; no cache, so it is never stale (SC-001).

## R7: Admin app

- **Reports** in the top navigation: four totals (events, tickets sold of capacity, revenue,
  checked in) and a table of events (name linking to the event, venue, date, status, sold of
  capacity with percent, revenue, checked in).
- **Event page**: a "Cancelled" marker; Edit and Delete hidden when cancelled; a **Sales** card
  (sold, revenue, checked in, and per-tier sold), from the report; links to **Attendees**; a
  **Cancel event** button that confirms with `window.confirm`, then shows the counts. The tier form
  is hidden when cancelled.
- **Attendees** page `/events/:id/attendees`: one row per order (customer, tier, quantity, total,
  status, placed) with its ticket codes and check-in state, plus a summary line.
- **Event list**: a "Cancelled" pill.

## R8: Customer app

Event list and event page show "Cancelled" next to a cancelled event's name, and the venue page's
event list does the same (FR-012). Nothing else changes until `006`.

## R9: Demo data

`backend/src/scripts/demo-data.ts`, built with the Backend, run on demand:

```bash
docker compose exec backend node backend/dist/scripts/demo-data.js
```

It boots the Nest application context and uses the real services, so every rule applies. It
creates two venues, three events with tiers, orders from `customer1`…`customer25` (stand-in
subjects `demo-<username>`), checks in part of one event's tickets, and cancels one event. It does
nothing if the demo venue already exists. Check-ins are written directly because no check-in
operation exists yet; the Ticket Booth spec replaces that. It is never run by `docker compose up`
(Constitution VIII: no demo data in normal start).

## R10: Contract 1.3.0

Additive: four operations (`createOrder` for `customer`; `listAttendees`, `cancelEvent`,
`getSalesReport` for `queuepass-admin`), schemas `Order`, `OrderInput`, `Ticket`, `Cancellation`,
`SalesReport`, `EventSales`, `TierSales`, `Event.status` and `Event.cancelledAt`, four error codes
(`SOLD_OUT`, `EVENT_CANCELLED`, `EVENT_HAS_ORDERS`, `TIER_HAS_ORDERS`), and `409` on `deleteEvent`
and `deleteTicketTier`. `api-schema.ts` regenerated in this PR.
