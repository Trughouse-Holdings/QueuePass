# Feature Specification: Admin Orders, Reporting, Attendees, and Safe Cancellation

**Feature Branch**: `005-admin-orders-reporting`

**Created**: 2026-10-01

**Status**: Ready for review

**Input**: User description: "Add to the admin app: a reporting dashboard (tickets sold against
capacity, revenue, and check-ins, per event and overall); an attendee list per event (who bought
tickets, their ticket codes, and whether they've checked in); and cancelling an event safely (void
its tickets, mark the orders refunded, and show customers it was cancelled)."

## Context

Builds on `002` (events) and `004` (ticket tiers). All three requested Admin features describe
tickets that people hold, and QueuePass has none yet. So this feature first gives the Backend
**orders and tickets**, with an API for a signed-in customer to get tickets. The Customer app
screens that call that API are reserved as `006-customer-ticket-purchase`; until then, tests and a
demo-data script create orders. Payment is simulated, as the requirements emails allow ("Money -
just fake it").

The requirements emails motivate each part: Chaz wants "to know what's going on at any point"
instead of waiting a day for Paul's report; customers must "NEVER get an order messed up"; and
"not everyone gets to see or do everything".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Orders and Tickets Exist and Never Oversell (Priority: P1)

A signed-in customer asks for a number of tickets for an event, in one of its tiers if it has any.
The Backend records an order with its price and issues one ticket per seat, each with a unique
code. It never sells more tickets than a tier holds or than the event's capacity, even when many
customers ask at the same moment.

**Why this priority**: Without orders, there is nothing to report, list, or refund.

**Independent Test**: For an event with capacity 10, send 20 simultaneous one-ticket orders and
confirm exactly 10 succeed and 10 are refused as sold out.

**Acceptance Scenarios**:

1. **Given** an event without tiers, **When** a customer orders 2 tickets, **Then** one order at
   the event's base price and 2 tickets with distinct codes are recorded.
2. **Given** an event with tiers, **When** a customer orders 3 VIP tickets, **Then** the order uses
   the VIP price, and the total is 3 times that price.
3. **Given** an event with tiers, **When** an order names no tier, **Then** it is refused; and an
   order naming a tier for an event without tiers is refused.
4. **Given** 1 ticket left, **When** a customer orders 2, **Then** the order is refused as sold out,
   saying 1 is available, and nothing is recorded.
5. **Given** an order, **When** an admin later changes the tier's price, **Then** the order keeps
   the price it was placed at.
6. **Given** an admin or gate agent, **When** they try to place an order, **Then** they are refused.

---

### User Story 2 - Sales Dashboard (Priority: P1)

An admin opens **Reports** and sees, at once and up to date, the totals across all events
(tickets sold against capacity, revenue, and check-ins) and the same figures for each event, with
each event's tiers broken out.

**Why this priority**: It is the reporting need the requirements emails single out.

**Independent Test**: With orders on two events and some tickets checked in, compare the dashboard
with counts taken directly from the data.

**Acceptance Scenarios**:

1. **Given** orders, **When** an admin opens Reports, **Then** they see total tickets sold, total
   capacity, total revenue, and total check-ins, and one row per event with the same figures.
2. **Given** a refunded order, **Then** its tickets and money are not counted as sold or revenue.
3. **Given** an event with tiers, **When** the admin opens that event, **Then** each tier shows its
   tickets sold and revenue.
4. **Given** a new order, **When** the admin reloads Reports, **Then** it is included.

---

### User Story 3 - Attendee List (Priority: P2)

An admin opens an event's attendee list and sees every order: the customer's username, the tier,
how many tickets, the amount, whether it was refunded, each ticket's code, and whether each ticket
has been checked in.

**Independent Test**: Place three orders by different customers and confirm all three appear with
their ticket codes.

**Acceptance Scenarios**:

1. **Given** orders, **When** an admin opens the attendee list, **Then** every order appears, oldest
   first, with its tickets and their codes and check-in state.
2. **Given** no orders, **Then** the page says no one has tickets yet.
3. **Given** a customer or gate agent, **When** they request an attendee list, **Then** they are
   refused.

---

### User Story 4 - Cancel an Event Safely (Priority: P2)

An admin cancels an event. After confirming, every ticket for it becomes void, every order is
marked refunded (refunds are simulated), and the event is marked cancelled for good: it can no
longer be edited, sold, or given new tiers, and its venue time becomes free again. Customers see
it as cancelled. An event that has orders can no longer be deleted outright, so its records are
never lost.

**Independent Test**: Cancel an event with 3 orders, confirm the counts reported, then confirm the
orders are refunded, the tickets void, the dashboard excludes them, and a new event can be booked
in the same slot.

**Acceptance Scenarios**:

1. **Given** an event with orders, **When** an admin cancels it and confirms, **Then** all its
   tickets are void, all its orders refunded, and the admin is told how many of each.
2. **Given** a cancelled event, **When** anyone tries to edit it, add or change tiers, order
   tickets, or cancel it again, **Then** they are refused with a reason.
3. **Given** a cancelled event, **When** an admin schedules a new event at the same venue and time,
   **Then** it is accepted.
4. **Given** an event with orders, **When** an admin tries to delete it, **Then** it is refused and
   cancelling is suggested instead. A tier with orders likewise cannot be removed.
5. **Given** a cancelled event, **When** a customer views it in the Customer app, **Then** it is
   clearly marked cancelled.
6. **Given** the admin dismisses the confirmation, **Then** nothing changes.

---

### Edge Cases

- **Shrinking after sales**: an event's capacity cannot drop below its tickets sold, nor a tier's
  quantity below that tier's tickets sold.
- **Tiers after general sales**: an event that already sold tickets without tiers cannot get tiers,
  because those tickets would belong to no tier.
- **Order size**: 1 to 10 tickets per order.
- **Two admins cancel at once**: one succeeds and the other is told it is already cancelled.
- **Check-ins**: the Ticket Booth app does not check tickets in yet; reports and attendee lists
  show check-in state from the data, which the demo script sets.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Backend MUST record orders (event, optional tier, customer identity, quantity,
  unit price, total, status, time) and one ticket per seat with a unique, unguessable code.
- **FR-002**: Ticket sales MUST NOT exceed any tier's quantity or the event's capacity, including
  under concurrent requests. A refusal MUST state how many tickets are available.
- **FR-003**: Only users with the customer role MAY place orders, for themselves only; payment is
  simulated and always succeeds.
- **FR-004**: Prices MUST be fixed on the order when placed; amounts are exact decimals.
- **FR-005**: The Backend MUST provide admins a sales report: totals and per-event tickets sold,
  capacity, revenue, and check-ins, with per-tier sold and revenue; refunded orders excluded.
- **FR-006**: The Admin app MUST show the report on a Reports page, and per-tier sales on the event
  page.
- **FR-007**: The Backend MUST provide admins each event's orders with their tickets; the Admin app
  MUST show them as the event's attendee list.
- **FR-008**: Admins MUST be able to cancel an event after confirming. Cancelling MUST, in one
  all-or-nothing step, void its tickets, refund its orders, and mark it cancelled, and MUST report
  the counts.
- **FR-009**: A cancelled event MUST refuse edits, tier changes, new orders, and repeat
  cancellation, and MUST NOT block its venue's time.
- **FR-010**: An event with orders MUST NOT be deletable; a tier with orders MUST NOT be removable.
- **FR-011**: Capacity and tier quantity MUST NOT be reduced below tickets sold; tiers MUST NOT be
  added to an event with tierless sales.
- **FR-012**: The Customer app MUST mark cancelled events as cancelled wherever events appear.
- **FR-013**: A repeatable demo-data command MUST populate sample venues, events, tiers, orders,
  check-ins, and one cancelled event for local demonstration, without being part of normal start.
- **FR-014**: The contract MUST be updated first; reports, attendee lists, and cancellation MUST
  require `queuepass-admin`.
- **FR-015**: Automated tests MUST cover every rule above against real PostgreSQL, including the
  concurrent-ordering guarantee, and the Admin and Customer app screens.

### Key Entities

- **Order**: one customer's purchase for one event, optionally one tier; confirmed or refunded.
- **Ticket**: one seat in an order; a unique code; valid or void; optionally checked in.
- **Event**: gains a status, scheduled or cancelled, and when it was cancelled.

## Success Criteria *(mandatory)*

- **SC-001**: An admin sees current sales totals in under 5 seconds from opening Reports, instead
  of waiting a day.
- **SC-002**: 0 events or tiers ever have more valid tickets than their capacity.
- **SC-003**: After a cancellation, 100% of the event's tickets are void and orders refunded.
- **SC-004**: An admin finds a named customer's ticket codes for an event in under 30 seconds.
- **SC-005**: The full test suite passes from a clean checkout.

## Assumptions

- **Customers order through the API until `006`**: the Customer app screens are a later spec.
- **Refunds are simulated**: marking an order refunded is the whole refund.
- **No sales window yet**: an event can be ordered until it is cancelled; opening and closing sales
  belong to a later lifecycle feature.
- **Demo orders use stand-in customer identities**: they are made by the demo script, not by real
  sign-ins, so they will not appear in a customer's own ticket list in `006`.
- **Report scale**: a few hundred events, computed on request; no caching.

## Out of Scope

- Customer purchase screens and "my tickets" (`006`), QR codes and gate check-in (later specs).
- Partial refunds, transfers, and order changes by admins.
- Exports, charts, and date-range reports.
