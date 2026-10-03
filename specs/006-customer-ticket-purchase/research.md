# Research: Customer Ticket Purchase

Decisions for feature `006`, planned under constitution v2.2.0 on top of `005`.

## R1: Tickets left come from a separate availability read

`GET /events/{id}/availability` (any signed-in user) returns the event's tickets left, each
tier's tickets left, and whether sales are closed and why (`CANCELLED`, `STARTED`, or `null`).
Counts are valid tickets only, the same `ticketsSold` helper ordering uses: event left =
`totalTicketCapacity − sold`; tier left = `min(quantity − tierSold, eventLeft)`, floored at 0.
It is a plain read with no lock: the numbers are guidance (spec FR-003), and the order's own
locked check decides.

`salesClosed` is computed by the Backend with the Backend's clock, so a customer whose computer
clock is wrong still sees the same answer the order would get.

**Alternatives rejected**: adding `ticketsLeft` to `Event` and `TicketTier` would make every
existing event and tier response pay for a count, change two schemas every Admin test fixture
builds, and still leave the sales-closed reason nowhere. One small read touches nothing that
exists.

## R2: Sales close at the start time, under the event lock

`lockEvent` also selects `startsAt`. After the cancelled check, an order is refused when
`now >= startsAt` with `409 SALES_CLOSED` ("Sales for {name} closed when it started."). The
check runs inside the locked transaction, like every other ordering rule (Constitution IV). The
half-open convention holds: an order at exactly `startsAt` is refused.

**Impact on `005`**: every test that places orders uses events in 2027 or later, and the demo
script uses events 14 to 30 days ahead, so nothing breaks today. Explicit 2027 dates would start
failing in 2027, so tests that place orders move to dates relative to now, as one of this
feature's tasks.

## R3: One confirmation, one order: a request id in the body

The Customer app creates a random UUID when the customer reaches the confirm step and sends it as
`requestId` in `OrderInput`. The Backend stores it on the order, with a unique index on
`(customerSub, requestId)`.

Inside the locked transaction, before any other rule, the Backend looks for an order by this
customer with this `requestId`:

- **Found, same event, tier, and quantity**: return it with `200` instead of `201`. No second
  order. This holds even if the event has since sold out, started, or been cancelled, because the
  customer is asking what happened to their earlier request.
- **Found, anything different**: `409 REQUEST_ID_REUSED`.
- **Not found**: continue as `005` does, storing `requestId`.

Repeats for the same event wait on the event lock, so the second always sees the first. Repeats
across different events cannot share the lock; the unique index is the guarantee, and its
violation (`P2002` on `requestId`) re-runs the lookup.

`requestId` stays optional, so `005`'s tests and the demo script are unchanged.

**Alternatives rejected**: an `Idempotency-Key` header is the common convention, but the Backend's
CORS allows only `authorization` and `content-type`, and a body field is validated and typed by
the contract like every other input. Disabling the button alone does not survive a retried request
(spec FR-005).

## R4: The customer's own orders

`GET /me/orders` (`customer` only) returns the caller's orders, newest first, matched on
`customerSub` from the validated token. There is no parameter that names a customer (spec FR-007).
Each item is an `Order` plus a small `event` summary (id, name, start, end, status, and venue id
and name), so My tickets needs no second request per order. An index on
`(customerSub, createdAt)` keeps it one indexed query. It sits beside `001`'s `GET /me`.

## R5: Customer app

- **Event page** gains a **Get tickets** section, loaded from availability. It shows each tier's
  name, price, and tickets left as radio choices (sold-out tiers disabled and marked), or the base
  price when there are no tiers; a quantity of 1 to `min(10, left)`; the exact total; and
  **Confirm**. It shows "Sold out", "This event has been cancelled", or "Sales closed" instead of
  the form when sales are closed.
- **Confirming** disables the button while the request runs. Success replaces the form with the
  confirmation (event, tier, quantity, unit price, total charged, every code) and a link to My
  tickets. `SOLD_OUT`, `EVENT_CANCELLED`, and `SALES_CLOSED` show the Backend's message, reload
  availability, and keep the choice editable with a new `requestId`. No answer or a `5xx` shows
  "We couldn't confirm whether your order went through" with **Check again** (same `requestId`,
  so it is safe) and a link to My tickets.
- **My tickets** at `/my-tickets`, linked in the header after Events and Venues: one block per
  order, newest first (event linking to its page, venue, start, tier, quantity, total, placed
  time, Confirmed or Refunded), with each ticket's code and Valid, Void, or "Used {time}". A
  cancelled event is marked. No orders: "You have no tickets yet" and a link to Events.
- **Totals** are computed in integer cents from the decimal strings, never floating point
  (Constitution, Money), next to `usd()` in `format.ts`.

## R6: Contract 1.4.0

Additive only:

- `GET /me/orders` → `listMyOrders` (`customer`), returns `MyOrder[]`.
- `GET /events/{id}/availability` → `getEventAvailability` (any signed-in), returns
  `Availability`.
- `OrderInput.requestId` (optional UUID); `createOrder` gains a `200` (replayed) response.
- Schemas `MyOrder`, `OrderEvent`, `Availability`, `TierAvailability`.
- Error codes `SALES_CLOSED` and `REQUEST_ID_REUSED`, with `Conflict` examples.

`packages/shared/src/api-schema.ts` is regenerated, and `errors.ts` and `order.ts` mirror the
additions, in this plan PR.

## R7: Tests

Backend (Jest, Supertest, Testcontainers, contract validation): availability counts and
`salesClosed` values; sales closed at and after start, open just before; request-id replay,
mismatch, and 10 simultaneous identical requests yielding exactly one order; own-orders
isolation between two customers, newest-first order, the event summary, and role refusals. The
route-coverage test picks up both new operations automatically.

Customer app (Vitest, React Testing Library, stubbed fetch): tier choice and base price, totals,
quantity cap, sold-out, cancelled, and sales-closed states, each refusal message, double-click
sending one request, unknown outcome with Check again reusing the `requestId`, and every My
tickets state.
