# Feature Specification: Seat Selection

**Feature Branch**: `007-seat-selection`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "Admins give a venue a seating layout: sections, each with rows, each
row with a number of seats (simple rectangular rows; no drawn floor plans). For an event with
tiers, the admin maps each section to one tier (e.g. VIP is section A). Admins see a seat map for
an event showing which seats are sold and which are open. Customers pick their exact seats inside
the 006 Get tickets form, and each ticket is for one seat. No seat can ever be sold twice, even
when two customers pick the same seat at the same moment. Cancelling an event (005) frees its
seats."

## Context

Builds on `004` (ticket tiers), `005` (orders and tickets), and `006` (customers get tickets).
Today a ticket is a code and nothing more: a customer buys "2 VIP tickets" and has no seat. This
feature gives venues a seating layout and lets an event sell specific seats, so every ticket can
name the seat it is for.

The requirements emails motivate it: customers must "NEVER get an order messed up", and two
people holding tickets for the same seat is the clearest way to mess one up. The system must
"remain flexible" because "different events may have different operational needs".

## Clarifications

### Session 2026-10-03

- Q: Can one order include seats from different tiers? → A: No. One tier per order: the customer
  picks a tier, then seats only from that tier's sections; mixing tiers takes two orders. `005`'s
  order model (one tier, one price per order) is unchanged.
- Q: Should the customer's seat map show every seat at once, or one section at a time? → A: One
  section at a time: pick a tier, then one of its sections, then seats; picks in other sections of
  the same tier are kept when switching.
- Q: After using the seated flow, the user found typed capacities confusing: venue capacity, event
  capacity, and tier quantities all had to agree with the layout. Where should capacity be
  calculated instead of typed? → A: The seated flow only. A venue with a layout gets its seating
  capacity from the layout; a reserved-seating event gets its ticket capacity from that layout.
  General-admission events and venues without a layout keep typed capacities.
- Q: On a reserved-seating event, how should each tier's ticket amount work? → A: Calculated: a
  tier's amount is the seats in the sections mapped to it. Admins type only its name and price.
  (Supersedes the earlier FR-006, where tiers kept a typed quantity.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admins Lay Out a Venue's Seats (Priority: P1)

An admin gives a venue a seating layout: named sections (such as "A" or "Floor"), each with
numbered rows, each row with a number of seats. The venue's seating capacity becomes the layout's
total seats, with no number to type or keep in agreement. The admin can view and change the layout
while no seated sales depend on it.

**Why this priority**: Nothing can be chosen until seats exist.

**Independent Test**: Give a venue sections A (3 rows of 10) and B (2 rows of 20). Confirm the
venue's seating capacity is 70, with no capacity typed.

**Acceptance Scenarios**:

1. **Given** a venue without a layout, **When** an admin adds sections with rows and seats per
   row, **Then** the venue shows its layout and its total seats, and its seating capacity becomes
   that total.
2. **Given** a venue with a layout, **When** an admin edits the venue, **Then** its seating
   capacity is shown, not editable, as set by its layout.
3. **Given** a layout, **When** two sections would share a name, **Then** it is refused.
4. **Given** a layout that a seated event with sold tickets depends on, **When** an admin tries
   to change or remove it, **Then** it is refused, naming the events that block it.
5. **Given** a customer or gate agent, **When** they try to change a layout, **Then** they are
   refused.

---

### User Story 2 - Customers Choose Their Seats (Priority: P1)

For a seated event, the 006 Get tickets form shows a seat map instead of a plain quantity: the
customer picks the exact seats they want, sees the total, and confirms. Their confirmation and My
tickets show each ticket's seat.

**Why this priority**: It is the customer-facing point of the feature.

**Independent Test**: As `customer1`, pick seats A-1-5 and A-1-6 for a seated event and confirm.
The confirmation shows both seats, and the admin seat map shows them sold.

**Acceptance Scenarios**:

1. **Given** an event with reserved seating, **When** a customer opens it and chooses a section,
   **Then** they see that section's rows and seats, with taken seats marked and not choosable.
2. **Given** an event with tiers, **When** a customer picks a tier, **Then** only seats in that
   tier's sections can be chosen, each at the tier's price, and the total is the price times the
   number of seats.
3. **Given** chosen seats, **When** the customer confirms, **Then** one ticket is issued per seat
   and the confirmation lists each ticket's code and seat (section, row, seat number).
4. **Given** a confirmed order, **When** the customer opens My tickets, **Then** each ticket shows
   its seat.
5. **Given** a customer choosing more than 10 seats, **Then** they cannot confirm (the `005`
   per-order limit).

---

### User Story 3 - No Seat Is Ever Sold Twice (Priority: P1)

Two customers who pick the same seat at the same moment never both get it. The first confirmation
wins; the other is told which seats were taken, and nothing is recorded for them.

**Why this priority**: It is the guarantee the requirements emails demand.

**Independent Test**: Send 10 simultaneous orders for the same seat. Exactly 1 succeeds.

**Acceptance Scenarios**:

1. **Given** two customers who chose the same seat, **When** both confirm at once, **Then**
   exactly one order succeeds, and the other is refused, naming the taken seat.
2. **Given** a refused order, **When** the customer reopens the seat map, **Then** the taken seat
   is marked and their other choices are kept where still open.
3. **Given** an event that is cancelled, **When** its tickets are voided (`005`), **Then** its
   seats are no longer taken.
4. **Given** a seat in a section mapped to no tier, **When** a customer tries to order it,
   **Then** it is refused.

---

### User Story 4 - Admins See the Seat Map and Map Sections to Tiers (Priority: P2)

On an event's page, an admin turns reserved seating on (while nothing is sold yet), maps each
section to one of the event's tiers, and sees a seat
map with every seat marked sold or open, with counts per section.

**Why this priority**: Customers can buy without it once mapping exists, but admins need to set
prices by section and see what is selling.

**Independent Test**: Map section A to VIP and B to General, sell 3 seats in A, and confirm the
map shows those 3 seats sold and the section counts match.

**Acceptance Scenarios**:

1. **Given** an event at a venue with a layout and no sales, **When** an admin turns reserved
   seating on, **Then** customers see a seat map instead of a plain quantity; turning it on is
   refused for a venue without a layout or an event with valid tickets.
2. **Given** a seated event with tiers, **When** an admin maps each section to a tier, **Then**
   each section shows its tier, and customers see seats priced accordingly.
3. **Given** a section with sold seats, **When** an admin tries to map it to a different tier,
   **Then** it is refused.
4. **Given** sold seats, **When** an admin opens the event's seat map, **Then** every sold seat is
   marked, and each section shows sold and open counts.
5. **Given** a customer or gate agent, **When** they try to change seating or a mapping, **Then**
   they are refused; the seat map they can read shows sold and open seats, never who holds them.

---

### Edge Cases

- **Choosing for two**: a customer may pick any seats, adjacent or not, up to 10 per order, all in
  one tier, across that tier's sections.
- **Large venues**: only one section's seats are shown at a time; a section holds at most 100 rows
  of 200 seats (FR-001).
- **Moving a seated event**: an event with reserved seating cannot move to another venue, whose
  sections are different; turn reserved seating off first.
- **Shrinking a layout below a general-admission event**: a layout whose total is less than the
  ticket capacity of a scheduled general-admission event at the venue is refused, naming the
  event, since that event would exceed its venue (`002`).
- **Removing a layout**: the venue keeps the last total as a typed capacity again.
- **Turning reserved seating off**: the event and its tiers keep their last calculated amounts,
  which become typed again.
- **Seat taken while choosing**: no seat is held while a customer chooses; the first confirmation
  wins (US3).
- **Repeated confirmation**: `006`'s confirmation id still applies; a repeat returns the earlier
  order, seats included.
- **Capacity**: a seated event never sells more than its ticket capacity (`005`), nor more seats
  than its layout has.
- **Unmapped sections**: when an event has tiers, a section mapped to no tier is not for sale.
- **Events that started or were cancelled**: no seats can be chosen (`006` FR-014, `005`).
- **General admission at a venue with a layout**: allowed; the event sells tickets without seats,
  exactly as in `006` (FR-002).
- **A tier with no sections**: its amount is 0, so it sells nothing (FR-006).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Admins MUST be able to create, view, change, and remove a venue's seating layout:
  sections with names unique ignoring case (1–50 characters), each with 1–100 rows, each row with
  1–200 seats. Rows are numbered from 1 and seats from 1 within each row.
- **FR-002**: An admin MUST choose for each event whether it sells seats (reserved seating) or
  not (general admission, as in `006`). Reserved seating MAY be turned on only when the event's
  venue has a layout, and MAY be switched either way only while the event has no valid tickets.
  New events default to general admission.
- **FR-003**: A layout MUST NOT be changed or removed while any scheduled event that sells seats
  from it has valid tickets; the refusal MUST name those events. A layout MUST NOT be removed
  while any scheduled event at the venue has reserved seating on, even without sales. Replacing a
  layout MUST leave every event's sections at that venue unmapped, so admins remap them.
- **FR-004**: For a seated event with tiers, an admin MUST be able to map each section to exactly
  one of the event's tiers. A section with valid tickets MUST NOT be moved to another tier.
- **FR-005**: A seated event without tiers sells every seat at its base price.
- **FR-006**: On a seated event, each tier's amount MUST be the number of seats in the sections
  mapped to it, recalculated whenever the mapping or the layout changes; admins MUST NOT type it.
  A tier with no section mapped to it has an amount of 0 and sells nothing.
- **FR-007**: For a seated event, the Customer app's Get tickets form MUST show a seat map one
  section at a time (the chosen section's rows and seats, taken seats marked and not choosable)
  and let the customer choose 1 to 10 seats, showing the exact total and every chosen seat before
  confirming. For an event with tiers, the customer picks a tier first, and only that tier's
  sections are offered. Seats chosen in one section stay chosen when the customer switches to
  another section of the same tier.
- **FR-008**: An order for a seated event MUST name its seats; the Backend MUST issue one ticket
  per seat and MUST refuse a seat that is taken, outside the layout, in a section not for sale or
  mapped to a different tier than the order's, or repeated in the same order. A refusal for taken
  seats MUST name them.
- **FR-009**: A seat MUST be held by at most one valid ticket for an event, including under
  concurrent orders. This MUST be guaranteed by the database, not only checked by the Backend
  (Constitution IV).
- **FR-010**: A void ticket MUST NOT hold its seat, so cancelling an event (`005`) frees every
  seat.
- **FR-011**: The confirmation, My tickets, and the Admin attendee list MUST show each ticket's
  seat as section, row, and seat number.
- **FR-012**: The Admin app MUST show a seated event's seat map with every seat marked sold or
  open, and each section's sold and open counts.
- **FR-013**: Layout, reserved-seating, and mapping changes MUST require `queuepass-admin`. The seat
  map (each seat sold or open, and section counts) MUST be readable by any signed-in user and MUST
  NOT reveal who holds a seat; who bought which seat is visible only to admins, on the attendee
  list.
- **FR-014**: Events that do not sell seats MUST keep working exactly as in `006`.
- **FR-015**: The contract MUST be updated first; changes MUST be additive.
- **FR-016**: Automated tests MUST cover, against real PostgreSQL: layout rules, mapping rules,
  seat ordering rules, the concurrent same-seat guarantee (10 simultaneous orders for one seat →
  exactly 1 succeeds), seats freed by cancellation, and the Admin and Customer screens.
- **FR-017**: A venue with a layout MUST take its seating capacity from the layout's total seats,
  set whenever the layout is saved; admins MUST NOT type it while the layout exists. Saving a
  layout whose total is below a scheduled general-admission event's ticket capacity at the venue
  MUST be refused, naming the event.
- **FR-018**: A seated event MUST take its ticket capacity from its venue's layout total, set when
  reserved seating is turned on and whenever the layout changes; admins MUST NOT type it while
  reserved seating is on.
- **FR-019**: A new event's ticket capacity MAY be left out, in which case it is the venue's
  seating capacity. General-admission events and venues without a layout otherwise keep typed
  capacities and tier quantities exactly as in `002`, `004`, and `006`.

### Key Entities

- **Seating layout**: a venue's sections; at most one per venue.
- **Section**: a named block of a layout, with a number of rows and seats per row.
- **Seat**: one position, identified by section, row, and seat number.
- **Section mapping**: for one seated event with tiers, which tier each section belongs to.
- **Event** (from `002`): gains whether it sells seats (reserved seating); one that does is a
  "seated event" throughout this spec.
- **Ticket** (from `005`): gains the seat it is for, on seated events.

## Success Criteria *(mandatory)*

- **SC-001**: 0 seats are ever held by two valid tickets for the same event, including in a test
  of 10 simultaneous orders for one seat.
- **SC-002**: A customer picks seats and confirms in under 90 seconds.
- **SC-003**: An admin lays out a venue of 3 sections in under 3 minutes.
- **SC-004**: 100% of tickets for seated events show their seat on the confirmation, My tickets,
  and the attendee list.
- **SC-005**: Every `006` scenario still passes for events that do not sell seats.
- **SC-006**: The full test suite passes from a clean checkout.

## Assumptions

- **No seat holds**: seats are not reserved while a customer chooses; the first confirmation wins
  and others are told which seats were taken. Timed holds belong to a later feature
  (Constitution VIII).
- **Calculated numbers are stored**: the venue's capacity, a seated event's capacity, and its
  tiers' amounts are saved as they are calculated, so reports, availability, and ordering rules
  from `004`–`006` keep working unchanged.
- **Rectangular sections**: every row in a section has the same number of seats; no aisles,
  curves, accessible-seating flags, or drawn floor plans.
- **One layout per venue**: a venue's layout is shared by its events that sell seats.
- **Seat labels**: rows are numbers, not letters, to keep labels unambiguous.
- **Demo data unchanged**: the demo script keeps creating events that do not sell seats.

## Out of Scope

- Seat holds or timers, best-available auto-assignment, and moving a customer to another seat.
- Single-order refunds that free seats (`009`).
- Drawn floor plans, accessible-seating flags, and price per individual seat.
- Gate check-in by seat.
