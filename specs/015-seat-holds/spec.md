# Feature Specification: Seat Holds with Live Updates

**Feature Branch**: `015-seat-holds-spec`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Seat holds with live updates (GitHub issue #27; depends on
007-seat-selection). Seats a customer selects in the reserved-seating picker are held for that
customer so another customer can't take them before checkout. A hold is released when the
customer deselects the seat or logs out. Updates are live: if one customer holds seats 3 and 4,
they gray out in a second customer's browser without a refresh. No seat can be held by two
customers at once, guaranteed by the database (Constitution IV)."

## Context

Builds on `007` (seat selection). Today no seat is held while a customer chooses: two customers
can pick the same seat, and the first to confirm wins while the other learns at the last step
that it was taken (007 Assumptions, "No seat holds"). This feature lets a customer reserve the
seats they picked for a short, fixed time, so nobody else can take them while they finish, and
shows every customer looking at the event which seats are reserved or sold, as it happens.

Issue #27 lists three open decisions. The user settled them on 2026-10-12 (see Clarifications).

## Clarifications

### Session 2026-10-12

- Q: When does a seat count as held: on click, or on an explicit reserve action? → A: On an
  explicit action. The customer picks seats, then presses **Reserve seats**. Picking alone holds
  nothing and is not shown to anyone else.
- Q: How long does a hold last if the customer closes the tab without logging out? → A: A
  reservation lasts 5 minutes from the moment **Reserve seats** succeeds. The customer must press
  **Confirm purchase** within those 5 minutes, or the seats are released. The 5 minutes do not
  restart.
- Q: How should seats another customer has reserved look to everyone else? → A: As a distinct
  **Reserved** state, different from sold, and named as such for screen readers, so customers can
  tell they may free up. The Admin seat map also shows reserved seats and counts.
- Q: When a customer's reservation ends without a purchase, can they reserve the same seats again
  at once? → A: No. For 2 minutes after a reservation of theirs ends unbought (it runs out, they
  release it, they deselect a seat, or they log out), that customer can't reserve those seats
  again; other customers can. So that releasing never forces this wait, a customer adds seats to
  their active reservation instead of releasing it and reserving again.
- Q: Should the Admin app's event seat map update live too, or only the Customer app's? → A: Both.
  The Admin seat map, including its section counts, gets the same live updates as customers.
- Q: Must a seated order come from the customer's own active reservation, or may it still name
  open seats with no reservation, as in `007`? → A: It must come from a reservation. The Backend
  refuses a seated order that names any seat not in the customer's active reservation, so the
  5-minute rule holds for direct API calls too (Constitution IV).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reserve Seats, Then Confirm Within 5 Minutes (Priority: P1)

On a seated event, a customer picks seats as in `007`, presses **Reserve seats**, and the seats
are theirs for 5 minutes. A countdown shows the time left. They press **Confirm purchase** before
it runs out and get their tickets. If they don't, the seats are released and they are told.

**Why this priority**: It is the point of the feature: a customer who has reserved seats can't
lose them to someone else while finishing.

**Independent Test**: As `customer1`, pick A-1-5 and A-1-6 and reserve them. As `customer2`, try
to reserve A-1-5: it is refused. As `customer1`, confirm within 5 minutes: the order succeeds with
both seats.

**Acceptance Scenarios**:

1. **Given** a customer with picked seats on a seated event, **When** they press Reserve seats,
   **Then** the seats are reserved for them for 5 minutes, a countdown shows the time left, and
   Confirm purchase becomes available.
2. **Given** picked seats one of which another customer has reserved or bought, **When** the
   customer presses Reserve seats, **Then** nothing is reserved, the refusal names the seats that
   are no longer available, and their other picks are kept.
3. **Given** a reservation, **When** the customer presses Confirm purchase within 5 minutes,
   **Then** one ticket is issued per reserved seat, as in `007`, and the reservation ends.
4. **Given** a reservation, **When** 5 minutes pass without Confirm purchase, **Then** the seats
   are released, the customer is told the reservation ran out, Confirm purchase is no longer
   offered, and their picks are kept; they can reserve those seats again 2 minutes later if they
   are still open (FR-004a).
5. **Given** a reservation, **When** the customer deselects one of its seats, **Then** that seat is
   released at once, the rest stay reserved, and the countdown does not change.
6. **Given** a reservation, **When** the customer presses Release seats, **Then** every seat in it
   is released at once.
7. **Given** a reservation, **When** the customer logs out, **Then** every seat they have reserved,
   for any event, is released.

---

### User Story 2 - No Seat Is Reserved by Two Customers at Once (Priority: P1)

Two customers who press Reserve seats for the same seat at the same moment never both get it.
Exactly one reservation succeeds; the other is refused, naming the seat, and nothing is reserved
for them.

**Why this priority**: A reservation that two customers both hold protects neither. This is the
guarantee the issue requires from the database (Constitution IV).

**Independent Test**: Send 10 simultaneous reservations for the same seat from 10 customers.
Exactly 1 succeeds.

**Acceptance Scenarios**:

1. **Given** two customers who picked the same seat, **When** both reserve at once, **Then**
   exactly one reservation succeeds, and the other is refused, naming the seat.
2. **Given** a seat reserved by one customer, **When** another customer tries to buy it, **Then**
   the order is refused, naming the seat, exactly as for a sold seat in `007`.
3. **Given** a seat with a valid ticket, **When** a customer tries to reserve it, **Then** it is
   refused.
4. **Given** a reservation that ran out, **When** another customer reserves one of its seats,
   **Then** it succeeds.

---

### User Story 3 - Other Customers See Reserved and Sold Seats Live (Priority: P1)

Every customer looking at a seated event's seat map sees seats change state without refreshing:
when someone reserves seats 3 and 4, those seats turn to Reserved; when the reservation is
released or runs out, they turn back to open; when they are bought, they turn to sold.

**Why this priority**: The issue names this behavior, and without it customers keep picking seats
that are already gone.

**Independent Test**: Open the same seated event as `customer1` and `customer2` in two browsers.
As `customer1`, reserve A-1-3 and A-1-4. Within 2 seconds, without a refresh, `customer2` sees
both seats as Reserved and cannot pick them. As `customer1`, release them: `customer2` sees them
open again.

**Acceptance Scenarios**:

1. **Given** two customers viewing the same seated event, **When** one reserves seats, **Then** the
   other sees those seats as Reserved within 2 seconds, without refreshing, and cannot pick them.
2. **Given** reserved seats, **When** the reservation is released, runs out, or is bought, **Then**
   every viewer sees those seats as open (released or run out) or sold (bought) within 2 seconds.
3. **Given** a customer who has picked, but not reserved, a seat, **When** someone else reserves or
   buys it, **Then** the pick is removed and the customer is told that seat is no longer
   available; their other picks are kept.
4. **Given** a customer whose live updates stop (for example, the connection drops), **When** they
   come back, **Then** their seat map catches up to the current state without a page reload, and
   until then the Backend still refuses any seat that is no longer available.

---

### User Story 4 - Reserved Seats Look Different from Sold Seats (Priority: P2)

On the customer and admin seat maps, a reserved seat is shown as **Reserved**, distinct from both
open and sold, and not by color alone. The admin seat map's section counts include reserved
seats.

**Why this priority**: Customers can tell which seats may free up soon; admins can see demand that
hasn't turned into sales. The feature works without it, so it is P2.

**Independent Test**: Reserve 2 seats in section A as `customer1`. As another customer, the 2 seats
show as Reserved (not sold, and announced as Reserved by a screen reader). As an admin, the event's
seat map shows them Reserved, and section A's counts show 2 reserved.

**Acceptance Scenarios**:

1. **Given** a reserved seat, **When** another customer views the seat map, **Then** it is shown as
   Reserved, visibly different from open and sold without relying on color alone, and named
   Reserved to assistive technology.
2. **Given** a customer's own reservation, **When** they view the seat map, **Then** their reserved
   seats are shown as theirs, distinct from other customers' reserved seats.
3. **Given** reserved seats, **When** an admin opens the event's seat map, **Then** each reserved
   seat is marked Reserved, and each section shows its sold, reserved, and open counts.
4. **Given** an admin viewing an event's seat map, **When** a customer reserves, releases, or buys
   seats, **Then** the seats and the section counts change within 2 seconds, without refreshing.
5. **Given** any viewer other than the customer holding it, **When** they view a reserved seat,
   **Then** nothing reveals who reserved it.

---

### Edge Cases

- **Adding seats**: a customer has at most one reservation per event. While it is active they can
  pick more seats and press Reserve seats again to add them to it, within the caps below; the
  added seats end with the rest, and the 5 minutes don't restart.
- **Reserving again after it ends**: for 2 minutes after a reservation ends unbought, the same
  customer can't reserve any of its seats again. They can reserve other seats at once, and other
  customers can reserve those seats at once.
- **Confirming after the 5 minutes**: no longer offered in the Customer app, and refused by the
  Backend, which says the reservation ran out (FR-006).
- **Clock edge**: a reservation covers exactly 5 minutes from when it was made, `[reservedAt,
  reservedAt + 5 min)`. A Confirm purchase the Backend receives at or after the end is refused.
- **Ordering without reserving**: a seated order sent straight to the API, naming seats the
  customer hasn't reserved, is refused (FR-006). General-admission orders don't change.
- **Closing the tab**: the reservation stays until its 5 minutes end; nothing else releases it.
- **Two tabs, one customer**: the reservation belongs to the customer, not to the tab. Both tabs
  show it as theirs, and confirming or releasing in one is reflected in the other.
- **Per-order cap**: a reservation holds 1 to 10 seats, the `005` per-order limit.
- **Per-customer limit (`016`)**: a reservation can't hold more seats than the customer may still
  get. A reservation counts as no tickets held; only confirmed tickets count toward the limit.
- **One tier per reservation**: as with orders (`007`), all seats in a reservation belong to one
  tier. Picking another tier releases the active reservation.
- **Sales closed**: no seats can be reserved for an event that has started or is cancelled. When an
  event is cancelled or starts, its reservations end.
- **Admin seating changes**: if an admin turns reserved seating off, replaces the venue's layout,
  moves a section to another tier, adds the first tier to a seated event, or removes a tier,
  reservations on the affected seats end. The customer sees it through the live update, and is
  told when they next try to confirm. Removing a layout can't meet a reservation: it is refused
  while any scheduled event at the venue has reserved seating on (`007`).
- **Event deleted**: only an event without orders can be deleted (`005`). Its reservations go with
  it, and every viewer's live updates end; the seat map then says the event no longer exists.
- **Logging out with a dropped connection**: if the release can't reach the Backend, the seats stay
  reserved until their 5 minutes end.
- **General-admission events**: unchanged. There are no seats, so nothing is reserved (`006`).
- **Repeated confirmation**: `006`'s confirmation id still applies; a repeat returns the earlier
  order.
- **Many viewers**: every viewer of an event sees the same state; a slow or dropped viewer never
  delays the reservation itself.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On a seated event, the Customer app MUST let a customer pick seats as in `007` and
  then press **Reserve seats** to reserve them. Picking alone MUST NOT reserve a seat or be visible
  to anyone else.
- **FR-002**: A reservation MUST be all-or-nothing: if any picked seat is reserved by another
  customer, has a valid ticket, is outside the layout, is in a section not for sale or of another
  tier, or is repeated, nothing MUST be reserved, and the refusal MUST name the unavailable seats.
- **FR-003**: A reservation MUST hold 1 to 10 seats, all of one tier, and MUST NOT hold more seats
  than the customer may still get under the event's per-customer limit (`016`). A customer MUST
  have at most one active reservation per event. Reserving more seats while it is active MUST add
  them to it, all-or-nothing as in FR-002, without changing when it ends.
- **FR-004**: A reservation MUST last exactly 5 minutes from when it is made, and MUST NOT be
  extended or restarted. When it ends without a purchase, its seats MUST be released.
- **FR-004a**: For 2 minutes after a seat leaves a customer's reservation without being bought
  (the reservation runs out, is released, or loses the seat by deselect or logout), that customer
  MUST NOT be able to reserve that seat for the same event; the refusal MUST name the seat and say
  when it can be reserved again. Other customers MUST be able to reserve it at once. Seats ended by
  an admin change or cancellation (FR-016) are not affected.
- **FR-005**: While a reservation is active, the Customer app MUST show a countdown of the time
  left, a **Confirm purchase** control, and a **Release seats** control. When the 5 minutes end,
  it MUST tell the customer, stop offering Confirm purchase, and keep their picks.
- **FR-006**: Confirm purchase MUST order the reserved seats as in `007`. The Backend MUST accept a
  seated order only if every seat it names is in the ordering customer's active reservation for
  that event; otherwise it MUST refuse the whole order, naming the seats that aren't, and saying
  when the reservation has run out. A seat reserved by another customer MUST be refused as it is
  for a seat with a valid ticket. A successful order MUST end the reservation for the seats it
  bought; any of its seats left unbought stay reserved until it ends.
- **FR-007**: A customer MUST be able to release their own reservation, all of it with Release
  seats or one seat at a time by deselecting it. A released seat MUST be open to others at once.
  Releasing seats MUST NOT change the time left on the rest.
- **FR-008**: Logging out of the Customer app MUST release every reservation the customer holds,
  for every event, before the session ends. If that release can't be completed, the reservations
  MUST still end when their 5 minutes do.
- **FR-009**: A seat MUST be covered by at most one active reservation or valid ticket for an
  event at any time, including under concurrent requests. This MUST be guaranteed by the database,
  not only checked by the Backend (Constitution IV). A reservation that has ended MUST NOT block
  anyone.
- **FR-010**: Every customer viewing a seated event's seat map in the Customer app, and every admin
  viewing it in the Admin app (with its section counts), MUST see seats become Reserved, open, or
  sold within 2 seconds of the change, without refreshing the page. A viewer whose updates were
  interrupted MUST catch up to the current state when they resume, without a page reload.
- **FR-011**: A seat a customer has picked but not reserved MUST be removed from their picks, with a
  message naming it, when another customer reserves or buys it.
- **FR-012**: The customer and admin seat maps MUST show a reserved seat as Reserved, distinct from
  open and sold without relying on color alone, and named Reserved to assistive technology; a sold
  seat MUST be named sold. A customer's own reserved seats MUST be shown as theirs. Assistive
  technology MUST hear about live changes that affect the customer:
  - a seat that becomes unavailable while it has keyboard focus MUST keep focus (it is marked
    unavailable, not removed from the focus order);
  - the FR-011 "no longer available" message and the "ran out" message MUST be announced (a
    status region, and an alert region for "ran out");
  - the countdown MUST announce once when 1 minute is left, through its own status region (a
    timer alone is not announced).
- **FR-013**: The Admin seat map MUST show each section's sold, reserved, and open counts.
- **FR-014**: The seat map and its live updates MUST NOT reveal who has reserved a seat, to anyone
  but the customer holding it (`007` FR-013).
- **FR-015**: Only a signed-in user with the `customer` role MUST be able to reserve or release
  seats, and only their own. Live seat updates MUST require sign-in, like the seat map.
- **FR-016**: Reservations MUST end when their event is cancelled or starts, when reserved seating
  is turned off, when the venue's layout is replaced, when the first tier is added to an event
  whose reservations have no tier, and, for a section, when it is moved to another tier. Removing a
  tier or deleting the event removes its reservations with it. Every seat these changes free,
  including seats whose tickets a cancellation voids, MUST reach viewers as open. No seat MUST be
  reservable while the event's sales are closed.
- **FR-017**: Events that do not sell seats MUST keep working exactly as in `006`, and every `007`
  rule for seated orders MUST still hold, with the reservation required by FR-006 added.
- **FR-018**: The contract MUST be updated first; changes to existing operations MUST be additive,
  with one deliberate exception: FR-006 tightens `createOrder`, since a seated order now needs a
  reservation. The only client that sends seated orders, the Customer app, changes in the same
  implementation PR, so no released client breaks. The minor version follows the `016` precedent.
- **FR-019**: Automated tests MUST cover, against real PostgreSQL: reserving, all-or-nothing
  refusals, the 5-minute end on both sides of the boundary, releasing by deselect, Release seats,
  and logout, adding seats to a reservation, the 2-minute wait on both sides of its boundary,
  orders against another customer's reservation, seated orders refused without a reservation or
  after it runs out, the per-order and per-customer caps,
  the concurrent same-seat guarantee (10 simultaneous reservations for one seat → exactly 1
  succeeds), the database rules on their own (rows written directly, below the Backend),
  reservations ended by admin changes and cancellation, live updates reaching a second
  viewer, and the Customer and Admin screens.

### Key Entities

- **Seat reservation**: one customer's hold on 1 to 10 seats of one tier for one event, with the
  moment it was made and the moment it ends (5 minutes later). It is active until it ends, is
  released, or is bought. It stores the customer only as their Keycloak subject identifier
  (Constitution V).
- **Seat** (from `007`): now open, reserved, or sold for a given event.
- **Seat map** (from `007`): gains each seat's Reserved state and, for admins, each section's
  reserved count.
- **Live seat update**: a notice to every viewer of an event that some of its seats changed state;
  it names seats and states, never customers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 seats are ever covered by two active reservations, or by an active reservation and
  a valid ticket, for the same event, including in a test of 10 simultaneous reservations for one
  seat.
- **SC-002**: When a customer reserves, releases, or buys seats, a second customer and an admin
  viewing the same event see the change within 2 seconds, without refreshing, in at least 95% of trials.
- **SC-003**: 100% of reservations not confirmed within 5 minutes release their seats, and other
  viewers see those seats open within 2 seconds after the 5 minutes end.
- **SC-004**: After logout, the customer's reserved seats show as open to other viewers within 2
  seconds.
- **SC-005**: A customer picks, reserves, and confirms seats in under 90 seconds.
- **SC-006**: Every `006` scenario still passes; every `007` scenario passes with a reserve step
  before confirming; and the full test suite passes from a clean checkout.

## Assumptions

- **Existing seated-order tests gain a reserve step.** Because a seated order now needs a
  reservation (FR-006), `007`'s tests and scenarios reserve the seats before ordering them; what
  they check is otherwise unchanged.
- **A reservation is not a ticket.** It doesn't count toward capacity reports, sales, or the
  `016` per-customer limit, and nothing is charged until Confirm purchase (payment remains
  simulated, `006`).
- **5 minutes and 2 minutes are fixed** for every event, not something an admin sets
  (Constitution VIII).
- **Picks are private.** Only reservations and sales are shared live; seats a customer has merely
  picked are not.
- **Live updates cover seated events only**, and only the seat map (in the Customer and Admin apps);
  availability counts and other pages keep loading as they do today.
- **Laptop scale.** The proof of concept needs live updates for the seeded 200 customers, not for
  public-sale traffic.
- **The Ticket Booth app is unchanged.** Gate agents don't reserve seats.
- **The 5-minute limit is not adjustable (WCAG 2.2.1).** It meets the success criterion's
  real-time exception: the seats are a contested resource that other customers are waiting to
  reserve, so letting one customer extend the limit would take the seats from others, which is the
  point of the limit. The customer is warned at 1 minute left, and can reserve other seats at once,
  or the same seats 2 minutes after the limit ends.

## Out of Scope

- Holding seats on click, before Reserve seats; extending or restarting a reservation; a timer or
  wait an admin can set.
- Holds for general-admission tickets.
- Waiting lists, queues for sold-out events, or notifying a customer when a reserved seat frees up.
- Showing who holds a reservation, to admins or anyone else.
- Admin tools to release or override a customer's reservation.
- Live updates outside the seat map (event lists, availability counts, reports).
- **Hoarding (accepted risk)**: the 2-minute wait is per seat, so a customer could keep 10
  different seats reserved at all times by rotating through them every 5 minutes. A per-customer
  limit is not needed at laptop scale; a real sale would add one.
