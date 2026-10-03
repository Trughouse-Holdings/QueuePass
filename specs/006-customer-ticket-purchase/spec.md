# Feature Specification: Customer Ticket Purchase

**Feature Branch**: `006-customer-ticket-purchase`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "In the Customer app, a signed-in customer gets tickets for an event:
choose one of its ticket tiers (or the event's base price if it has none), choose a quantity of
1–10, see the total, confirm, and see their ticket codes. A 'My tickets' page lists every order the
customer has made, with its tickets, codes and status, and marks refunded orders and cancelled
events. Sold-out tiers and cancelled events can't be bought and say why. Payment is simulated."

## Context

Builds on `003` (the Customer app shows venues and events) and `005` (orders and tickets). `005`
gave the Backend orders, with an API for a signed-in customer to get tickets that never oversells,
but no screen calls it: customers can browse and cannot buy, and every order so far comes from the
demo script. This feature adds the Customer app screens to get tickets and see them, and the Backend
reads those screens need. Payment stays simulated, as the requirements emails allow ("Money - just
fake it").

It narrows `003`'s read-only rule (`003` FR-009) for placing orders only. Customers still cannot
create, change, or delete venues, events, or tiers.

The requirements emails motivate it: customers must "NEVER get an order messed up", and "not
everyone gets to see or do everything", so a customer sees only their own orders.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get Tickets for an Event (Priority: P1)

On an event's page, a customer chooses a tier if the event has tiers, chooses how many tickets
(1 to 10), sees the total, and confirms. They then see a confirmation with one ticket code per
ticket.

**Why this priority**: It is the only way for a customer to get tickets. Without it, orders exist
only in the demo script.

**Independent Test**: As `customer1`, get 2 tickets in a tier for an event. Confirm the
confirmation shows 2 distinct codes and twice the tier price, and the order appears on that event's
attendee list in the Admin app.

**Acceptance Scenarios**:

1. **Given** an event with tiers, **When** a customer opens its page, **Then** they see each tier's
   name, price, and tickets left, and must choose a tier before confirming.
2. **Given** an event without tiers, **When** a customer opens its page, **Then** the event's base
   price is used and no tier choice is shown.
3. **Given** a tier and quantity chosen, **When** the customer reviews the order, **Then** the total
   shown is the price times the quantity, in USD.
4. **Given** a reviewed order, **When** the customer confirms, **Then** they see the event, tier,
   quantity, unit price, and total actually charged, and one code per ticket.
5. **Given** a reviewed order, **When** the customer leaves without confirming, **Then** nothing is
   recorded.

---

### User Story 2 - Sold Out and Cancelled Are Explained (Priority: P2)

A customer can tell, before trying, when tickets cannot be had and why: sold out, cancelled, or
sales closed because the event has started. When tickets run out
between viewing and confirming, the customer is told what happened and nothing is recorded.

**Why this priority**: The Backend already refuses these orders (`005`). This story makes the
refusal clear instead of a dead end.

**Independent Test**: Sell a tier down to 0 and cancel another event. Confirm the first shows the
tier as sold out and the second shows as cancelled, and neither can be confirmed.

**Acceptance Scenarios**:

1. **Given** a tier with no tickets left, **When** a customer opens the event, **Then** the tier is
   marked sold out and cannot be chosen.
2. **Given** an event with no tickets left in total, **When** a customer opens it, **Then** it says
   sold out and offers no way to get tickets.
3. **Given** 3 tickets left in a tier, **When** a customer chooses that tier, **Then** they cannot
   choose more than 3.
4. **Given** tickets sell out after the page loaded, **When** the customer confirms, **Then** they
   are told the order was refused and how many tickets remain, nothing is recorded, and they can
   change their choice and try again.
5. **Given** a cancelled event, **When** a customer opens it, **Then** it is marked cancelled and
   offers no way to get tickets.
6. **Given** an event that has started, **When** a customer opens it, **Then** it shows "Sales
   closed" and offers no way to get tickets; an order sent anyway is refused by the Backend.

---

### User Story 3 - My Tickets (Priority: P2)

A customer opens **My tickets** and sees every order they have made, newest first: the event, its
venue and start time, the tier, quantity, total, whether the order is confirmed or refunded, and
each ticket's code and state. They never see anyone else's orders.

**Why this priority**: A customer needs their codes after leaving the confirmation page, and needs
to learn when an event they hold tickets for is cancelled.

**Independent Test**: `customer1` and `customer2` each get tickets. Confirm each sees only their
own order, with its codes.

**Acceptance Scenarios**:

1. **Given** a customer with orders, **When** they open My tickets, **Then** every one of their
   orders appears, newest first, with all its ticket codes.
2. **Given** a customer with no orders, **When** they open My tickets, **Then** a plain message says
   so and links to the event list.
3. **Given** an event cancelled after a customer bought tickets, **When** the customer opens My
   tickets, **Then** the order shows as refunded, the event as cancelled, and the tickets as void.
4. **Given** a ticket that has been checked in, **When** the customer opens My tickets, **Then** that
   ticket shows as used.
5. **Given** two customers, **When** either opens My tickets or calls the Backend, **Then** they get
   only their own orders, and there is no way to ask for another customer's.
6. **Given** an admin or gate agent, **When** they ask the Backend for "my orders", **Then** they are
   refused.

---

### Edge Cases

- **Confirming twice**: clicking confirm repeatedly, or a retried request, still records exactly one
  order.
- **Unknown outcome**: if the connection drops after confirming, the app does not claim the order
  failed. It says the result is unknown and points to My tickets, where the order appears if it was
  recorded.
- **Price changed after loading**: the order uses the price at the moment it is placed (`005`
  FR-004); the confirmation shows the amount actually charged.
- **Free tickets**: a tier or base price of $0.00 can be ordered and shows a $0.00 total.
- **Demo orders**: orders made by the demo script belong to stand-in identities, so they never
  appear in a real customer's My tickets (`005` assumptions).
- **Event starts while a customer is confirming**: the Backend decides by the time the order
  arrives; an order at or after the start time is refused as sales closed (FR-014).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Customer app's event page MUST let a customer get tickets for an event that is
  not cancelled and has tickets left: choose a tier (required when the event has tiers; otherwise
  the base price applies), choose a quantity from 1 to 10, and see the total before confirming.
- **FR-002**: The Backend MUST tell signed-in users how many tickets are left for each event and
  each of its tiers, counting only valid tickets. The Customer app MUST show these counts, mark
  sold-out tiers and events, and not allow a quantity above what is left.
- **FR-003**: Confirming MUST place the order through the existing ordering rules (`005`), which
  stay the only enforcement of capacity, tier, cancellation, quantity, and price rules
  (Constitution IV). Counts shown in the app are guidance, not a guarantee.
- **FR-004**: After a successful order, the Customer app MUST show the event, tier, quantity, unit
  price and total actually charged, and every ticket code.
- **FR-005**: One confirmation MUST record at most one order, even if the confirm control is used
  repeatedly or the request is retried.
- **FR-006**: A refused order MUST be explained in plain words using the Backend's reason (sold out
  with the number left, event cancelled, invalid quantity), and nothing is recorded. When the
  outcome is unknown, the app MUST say so and direct the customer to My tickets rather than report
  a failure.
- **FR-007**: The Backend MUST give a signed-in customer their own orders, newest first, each with
  its event (name, venue, start time, status), tier, quantity, unit price, total, order status, and
  tickets (code, valid or void, check-in time). "Own" MUST be decided by the Keycloak subject in the
  validated token; no request input may name another customer. It MUST require the `customer` role.
- **FR-008**: The Customer app MUST show those orders on a **My tickets** page, marking refunded
  orders, cancelled events, void tickets, and checked-in tickets, and MUST link My tickets from the
  main navigation alongside Events and Venues.
- **FR-009**: The Customer app MUST still offer no control that creates, changes, or deletes a
  venue, event, or tier. Placing an order is the only write it performs.
- **FR-010**: Payment is simulated: the app MUST NOT ask for or store payment details.
- **FR-011**: The contract MUST be updated first. Changes MUST be additive: the customer's own-orders
  read, the tickets-left counts, a sales-closed refusal reason, and what FR-005 needs to recognize
  a repeated confirmation (an optional confirmation id on orders, a response for a repeat, and a
  refusal when the id is reused for a different order).
- **FR-012**: The constitution's Feature Roadmap MUST reserve `007-seat-selection`,
  `008-customer-event-search`, and `009-admin-order-management`, and give `010` as the next free
  number.
- **FR-013**: Automated tests MUST cover, against real PostgreSQL: own-orders isolation between
  customers, role refusals, ordering, and tickets-left counts; and the Customer app screens: tier
  choice, totals, sold-out and cancelled states, refusal messages, repeated confirmation, and every
  My tickets state; and the Backend's sales-closed refusal at and after an event's start time.
- **FR-014**: Sales MUST close when an event starts. The Backend MUST refuse an order placed at or
  after the event's start time, with a reason saying sales have closed, and the Customer app MUST
  show such events as "Sales closed" with no way to get tickets. This replaces `005`'s "no sales
  window yet" assumption for start time only.

### Key Entities

- **Order** (from `005`): one customer's purchase for one event, optionally one tier; confirmed or
  refunded. Unchanged in meaning; this feature lets customers place and read their own.
- **Ticket** (from `005`): one seat in an order, with a unique code; valid or void; optionally
  checked in.
- **Tickets left**: for an event, its capacity minus its valid tickets; for a tier, its quantity
  minus its valid tickets. Derived, never stored by hand.

## Success Criteria *(mandatory)*

- **SC-001**: A customer goes from an event's page to their ticket codes in under 60 seconds.
- **SC-002**: 0 duplicate orders result from one confirmation, including repeated clicks and retried
  requests.
- **SC-003**: My tickets shows 100% of a customer's own orders and 0 of anyone else's.
- **SC-004**: On 100% of sold-out, cancelled, or started events, the customer can tell why tickets are
  unavailable without attempting to buy.
- **SC-005**: 0 events or tiers are ever oversold through the Customer app.
- **SC-006**: The full test suite passes from a clean checkout.

## Assumptions

- **No per-customer limit**: beyond 1 to 10 tickets per order, a customer may place several orders.
- **Customers cannot cancel or refund their own orders**: refunds remain an admin action (single
  orders arrive in `009`).
- **Tickets-left counts can be stale**: another customer may buy in between; the Backend decides at
  confirmation (FR-003).
- **Display conventions carry over from `003`**: local time zone, USD prices, plain messages for
  empty lists and missing records.
- **Sales open as soon as an event exists**: only the closing rule (at start) is added; scheduled
  sale openings belong to a later lifecycle feature.
- **Codes are shown as text**: no QR codes, printing, or email.

## Out of Scope

- Choosing seats (`007`), searching and filtering events (`008`), and admin refunds of single
  orders (`009`).
- Customer cancellations, refunds, transfers, and order changes.
- QR codes, emailed or printable tickets, and gate check-in (later specs).
- Real payment.
