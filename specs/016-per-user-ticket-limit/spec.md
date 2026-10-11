# Feature Specification: Per-Customer Ticket Limit

**Feature Branch**: `016-per-user-ticket-limit-spec`

**Created**: 2026-10-11

**Status**: Draft

**Issue**: [#28](https://github.com/Trughouse-Holdings/QueuePass/issues/28)

**Input**: User description: "The admin sets a maximum number of tickets per customer for each
event. The limit is per customer, not per order: a customer who bought 8 of an 8-ticket limit
can't buy 8 more in a second order. Purchases over the limit are refused by the Backend with a
clear message, including when two orders are placed at the same moment (Constitution IV). Admins
set and edit the limit when creating or editing an event."

## Context

Builds on `005` (orders, tickets, and refunds), `006` (customers get tickets), `007` (customers
choose seats), and `008` (admins set up an event, its ticket types, and its sections in one form).

Today the only cap is per order: a customer chooses 1 to 10 tickets each time they confirm. Nothing
stops the same customer from confirming again, and again, until an event is sold out. An admin
running a popular event has no way to spread tickets across many customers.

This feature adds an optional limit to each event: the most tickets one customer account may hold
for it, counted across all of that customer's orders. The per-order rule of 1 to 10 stays as it is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Customer Cannot Go Over the Limit (Priority: P1)

A customer gets tickets for an event that has a limit of 8 per customer. They buy 5, then come back
and try to buy 5 more. The second order is refused with a message that says the limit is 8, that
they already hold 5, and that they can get at most 3 more. Nothing is recorded, and what they
entered is kept so they can lower the quantity and try again.

**Why this priority**: This is the rule itself. Without it, the limit is only a number on a page.

**Independent Test**: Give an event a limit of 8 directly in test setup, buy 5 tickets as one
customer, then try to buy 5 more as the same customer and confirm the refusal and its numbers. Buy
3 and confirm it succeeds. Try 1 more and confirm it is refused.

**Acceptance Scenarios**:

1. **Given** an event with a limit of 8 and a customer holding 0 tickets for it, **When** they
   order 8, **Then** the order is confirmed.
2. **Given** a customer holding 5 tickets for an event with a limit of 8, **When** they order 5,
   **Then** the order is refused, the message names the limit (8), what they hold (5), and what
   they can still get (3), and no order or ticket is recorded.
3. **Given** the same customer, **When** they order 3, **Then** the order is confirmed, and any
   further order for that event is refused because they hold 8.
4. **Given** a customer holding 8 tickets for an event with a limit of 8, **When** a different
   customer orders tickets for that event, **Then** the first customer's tickets do not count
   against the second customer.
5. **Given** a customer at the limit for one event, **When** they order tickets for a different
   event, **Then** that order is judged only against the other event's limit.

---

### User Story 2 - Two Orders at the Same Moment Cannot Beat the Limit (Priority: P1)

A customer opens the event in two browser tabs, holding 0 tickets for an event with a limit of 8,
and confirms 6 tickets in each tab at the same moment. Exactly one order succeeds. The other is
refused with the same limit message, as if it had come second.

**Why this priority**: A limit that a double-click or a second tab can get around is not enforced.
Constitution IV requires a rule that must hold under concurrency to be guaranteed by the database.

**Independent Test**: Send several genuinely concurrent orders for the same customer and event,
whose total exceeds the limit, and confirm the customer never holds more than the limit and every
refused order gets the limit message.

**Acceptance Scenarios**:

1. **Given** a limit of 8 and a customer holding 0, **When** two orders of 6 are confirmed at the
   same moment, **Then** exactly one succeeds and the customer holds 6.
2. **Given** a limit of 8 and a customer holding 0, **When** ten orders of 1 are confirmed at the
   same moment, **Then** exactly 8 succeed.
3. **Given** a confirmation repeated with the same request (the existing double-submit protection
   from `006`), **When** it arrives again, **Then** the original order is returned and the
   customer's count does not grow.

---

### User Story 3 - Admins Set and Change the Limit (Priority: P2)

When an admin creates or edits an event, they can enter a limit per customer, or leave it blank for
no limit. The event's detail page shows the limit. An admin can raise, lower, or remove it later.
Lowering it below what a customer already holds is allowed: that customer keeps all their tickets
but cannot get more.

**Why this priority**: Admins need a way to set the limit for the rule to apply to real events, but
the rule (US1, US2) can be built and tested first.

**Independent Test**: Create an event with a limit of 4, confirm it is shown, edit it to 6, then
clear it, and confirm each change is shown and applied to the next order.

**Acceptance Scenarios**:

1. **Given** the event form, **When** an admin leaves the limit blank, **Then** the event is saved
   with no per-customer limit.
2. **Given** the event form, **When** an admin enters 4, **Then** the event is saved with a limit of
   4, and the event's detail page says "Per customer: 4 tickets" ("No limit" when blank).
3. **Given** the event form, **When** an admin enters 0, a negative number, a fraction, or a number
   above the event's total ticket capacity, **Then** the event is not saved, the form explains the
   allowed range, and the other values entered are kept.
4. **Given** a customer holding 6 tickets, **When** an admin lowers the limit to 4, **Then** the
   change is saved, the customer keeps all 6 tickets, and any further order from them is refused.
5. **Given** an event with a limit, **When** an admin clears it, **Then** the event has no limit and
   customers can order again under the per-order rule alone.
6. **Given** a cancelled event, **Then** its limit cannot be changed, like every other field of a
   cancelled event.

---

### User Story 4 - Customers See the Limit Before They Buy (Priority: P2)

On an event with a limit, the Get tickets form tells the customer the limit and how many more they
can get, and does not offer a quantity, or let them choose seats, beyond that. A customer at the
limit sees that they have reached it instead of the form.

**Why this priority**: The Backend refusal (US1) keeps the rule correct, but a customer should not
have to be refused to learn the rule exists.

**Independent Test**: As a customer holding 5 of a limit of 8, open the event and confirm the form
says they can get 3 more and the largest quantity offered is 3. Buy 3, return, and confirm the form
is replaced by a "you have reached the limit" message.

**Acceptance Scenarios**:

1. **Given** an event with a limit of 8 and a customer holding 0, **When** they open Get tickets,
   **Then** they see "Limit: 8 tickets per customer" and may choose up to 8.
2. **Given** a customer holding 5 of a limit of 8, **When** they open Get tickets, **Then** they see
   that they can get 3 more, and the largest quantity offered is 3.
3. **Given** a reserved-seating event and a customer who can get 3 more, **When** they choose seats,
   **Then** they cannot choose a fourth seat, and are told why.
4. **Given** a customer holding as many tickets as the limit, **When** they open the event, **Then**
   they are told they have reached the limit for this event, and no confirm control is offered.
5. **Given** an event with no limit, **Then** the Get tickets form is unchanged from today.

---

### Edge Cases

- **Refunds**: Tickets on a refunded order are void and do not count toward the limit. If an
  event's orders are refunded when it is cancelled, the event is closed to sales anyway.
- **Every ticket type counts**: The limit covers the whole event, across all ticket types and
  sections. Holding 5 standard and 3 VIP tickets is holding 8.
- **Smaller of the two caps**: When the limit leaves fewer tickets than the per-order cap of 10,
  the smaller number applies; when the limit is above 10, a single order still cannot exceed 10.
- **Tickets left**: The quantity offered is also never more than the tickets left for the chosen
  ticket type or event, as today. The smallest of the three applies.
- **Two refusal reasons at once**: When an order would break both the limit and the tickets left,
  the customer is told the smaller number they can actually get.
- **Capacity lowered below the limit**: An edit that would leave the limit above the event's total
  ticket capacity is refused, and the admin is told to lower the limit in the same edit. A change
  to a venue's seating layout that would lower a reserved-seating event's capacity below its limit
  is refused the same way, naming the event.
- **Limit changed while a customer is on the form**: The Backend applies the limit in force when
  the order arrives. The customer sees the refusal message with the current numbers.
- **Who is "one customer"**: One signed-in customer account. The limit does not try to detect one
  person using several accounts.
- **Admins and gate agents**: They cannot buy tickets today, so the limit only affects customers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each event MUST have an optional per-customer ticket limit: either no limit, or a
  whole number from 1 up to the event's total ticket capacity.
- **FR-002**: The Backend MUST refuse an order when the customer's valid tickets for that event plus
  the quantity ordered would exceed the event's limit. A refused order records no order and no
  ticket.
- **FR-003**: The count toward the limit MUST include every valid ticket the customer holds for the
  event, across all of their orders, ticket types, and sections, and MUST NOT include void tickets.
- **FR-004**: FR-002 MUST hold when several orders from the same customer for the same event arrive
  at the same moment, guaranteed by the database (Constitution IV), so the customer never holds more
  valid tickets than the limit allowed when each order was accepted.
- **FR-005**: A refusal for the limit MUST use the standard error shape with its own stable code, and
  MUST state the limit, how many valid tickets the customer already holds, and how many more they
  may get.
- **FR-006**: The existing per-order rule (1 to 10 tickets) and the tickets-left rule MUST continue
  to apply unchanged, alongside the limit.
- **FR-007**: The repeat-confirmation protection from `006` MUST still return the original order
  without counting it twice.
- **FR-008**: Admins MUST be able to set, change, or clear the limit when creating or editing an
  event, in the existing event form. Values outside FR-001's range, including an edit that lowers the
  capacity below the limit, MUST be refused with a message stating the allowed range, keeping the
  other values entered.
- **FR-009**: Lowering or clearing the limit MUST be allowed at any time before the event is
  cancelled, and MUST NOT void, refund, or change any existing order or ticket.
- **FR-010**: The limit of a cancelled event MUST NOT be changeable, consistent with every other
  field of a cancelled event.
- **FR-011**: The Admin app's event detail page MUST show the limit, or that there is none.
- **FR-012**: For an event with a limit, the Customer app MUST show the limit and how many more
  tickets the signed-in customer can get, before they confirm.
- **FR-013**: The Customer app MUST NOT offer a quantity, or allow choosing more seats, than the
  smallest of: the per-order cap, the tickets left, and how many more the customer can get.
- **FR-014**: A customer who holds as many valid tickets as the limit MUST be told they have
  reached it, and MUST NOT be offered a confirm control for that event.
- **FR-015**: The Customer app MUST show a Backend limit refusal as an explicit error with the
  numbers from FR-005, keeping the customer's choices (Constitution IV).
- **FR-016**: Only the Backend enforces the limit. The Customer app's display (FR-012 to FR-014) is a
  convenience and MUST NOT be the only check.
- **FR-017**: Events that exist before this feature MUST have no limit, and behave exactly as they
  do today.

### Key Entities

- **Event**: gains a **per-customer ticket limit**: no limit, or a whole number from 1 to its total
  ticket capacity.
- **Customer's holding for an event**: not stored; it is the number of valid tickets that customer
  account holds for that event, across all their orders. Used to judge each new order against the
  limit and to tell the customer how many more they can get.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test of 50 concurrent orders from one customer for one event with a limit of 8,
  the customer ends up holding exactly 8 tickets, every time the test is run.
- **SC-002**: 100% of orders that would put a customer over the limit are refused, and 100% of those
  refusals state the limit, the customer's current count, and how many more they may get.
- **SC-003**: An admin can set, change, or clear an event's limit in under 30 seconds from the
  event's edit form.
- **SC-004**: A customer can tell how many more tickets they can get for an event without placing an
  order, on the event's page.
- **SC-005**: Every event created before this feature still accepts the same orders it accepted
  before.

## Assumptions

- The limit is optional, and blank means no limit (decided by the user, 2026-10-11).
- Lowering the limit below what a customer already holds keeps their tickets and only blocks new
  orders (decided by the user, 2026-10-11).
- The limit is capped at the event's total ticket capacity, because a larger limit could never
  apply.
- One customer is one signed-in account, identified the same way each order already records its
  customer.
- Void tickets, which today come only from refunds when an event is cancelled, do not count.
- Seat holds (`015`, issue #27) are not built yet. When they are, that spec decides how held seats
  count toward this limit.

## Out of Scope

- Detecting one person using several customer accounts.
- A different limit for each ticket type or section.
- A limit across several events, or across a whole venue.
- Showing admins which customers are at or near the limit.
- Limits in the Ticket Booth app, which does not sell tickets.
