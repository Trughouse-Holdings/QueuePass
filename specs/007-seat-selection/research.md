# Research: Seat Selection

Decisions for feature `007`, planned under constitution v2.2.0 on top of `006`.

## R1: Data model

A venue's layout is its set of `Section` rows; there is no separate layout table
([data-model.md](./data-model.md)):

- `Section`: `locationId`, `name` (1–50, unique per venue ignoring case), `rows` (1–100),
  `seatsPerRow` (1–200), `position` (display order).
- `Event.reservedSeating` (boolean, default `false`).
- `SectionTier`: for one event, the tier one section belongs to; primary key `(eventId,
  sectionId)`.
- `Ticket` gains `seatSection` (the section's name), `seatRow`, and `seatNumber`, all set or all
  null.

**Tickets store the seat's label, not a foreign key to `Section`.** A ticket is a record of what
was sold and must read the same forever, and a void ticket from a cancelled event must not stop a
venue's layout from being replaced (spec FR-003 only protects layouts with valid seated sales).
The seat's existence is checked by the Backend under the locks in R3, and the layout cannot
change while valid seated tickets depend on it, so a label can never point at a seat that was not
there when sold.

**Alternatives rejected**: `Ticket.sectionId` with `RESTRICT` would make void tickets block
layout changes forever; a `Seat` row per seat (up to 22,090 per venue) would be generated and
deleted on every layout change for no rule it enables.

## R2: No seat sold twice: a partial unique index

```sql
CREATE UNIQUE INDEX "ticket_one_valid_per_seat"
  ON "Ticket" ("eventId", "seatSection", "seatRow", "seatNumber")
  WHERE "status" = 'VALID' AND "seatSection" IS NOT NULL;
```

This is the database guarantee FR-009 and Constitution IV require: two valid tickets for the
same seat of the same event cannot both exist, whatever the Backend does. Because only `VALID`
rows are indexed, voiding tickets (cancellation, `005`) frees their seats with no extra step
(FR-010). Prisma cannot express a partial index, so it lives in the migration's SQL, as `005`'s
filtered exclusion constraint does.

Orders still take `004`'s event-row lock, so the Backend sees taken seats before inserting and
can refuse with the seats' names (`409 SEAT_TAKEN`, `details.seats`). The index catches anything
the lock does not; its violation is mapped to the same `409`.

## R3: Locks for layout and seating changes

- **Layout writes** (`PUT` and `DELETE /locations/{id}/layout`) lock the venue row, then every
  scheduled event at the venue (`SELECT … FOR UPDATE`, in id order). Orders, seating changes, and
  event edits for those events wait; the layout check (no valid seated tickets; no reserved
  seating left on when removing) is therefore current. Every other path locks a single event and
  never the venue, so there is no lock cycle.
- **Seating writes** (`PUT /events/{id}/seating`) and **orders** take the event lock only.
- **Event edits** refuse a venue change while reserved seating is on (turn it off first), so a
  seated event never points at another venue's sections.
- **Venue edits** refuse a seating capacity below the layout's total seats
  (`409 CAPACITY_EXCEEDED`).

## R4: Layout API

- `GET /locations/{id}/layout` (any signed-in): `{ locationId, totalSeats, sections }`, sections
  in `position` order; empty `sections` when the venue has none.
- `PUT /locations/{id}/layout` (`queuepass-admin`): replaces the whole layout with the given
  sections, in order. Refused when total seats exceed seating capacity (`409
  CAPACITY_EXCEEDED`), when names repeat ignoring case (`400`), or when a scheduled seated event
  at the venue has valid tickets (`409 LAYOUT_IN_USE`, `details.events` naming them). Replacing
  deletes the old sections, so every event's section mappings at this venue are dropped
  (`ON DELETE CASCADE`); events must be remapped.
- `DELETE /locations/{id}/layout` (`queuepass-admin`): as `PUT`, and also refused while any
  scheduled event at the venue has reserved seating on (`409 LAYOUT_IN_USE`).

**Alternatives rejected**: per-section endpoints would need every rule checked across several
requests; the layout is small and edited as a whole on one page.

## R5: Seating API and seat map

- `GET /events/{id}/seats` (any signed-in): `{ eventId, reservedSeating, sections }`, where each
  section has its id, name, rows, seats per row, `tierId` (or `null`), `sold`, and `taken: [{
  row, seat }]`. It never says who holds a seat (FR-013). Both apps read it: the Customer app to
  choose, the Admin app for the seat map with sold and open counts (FR-012).
- `PUT /events/{id}/seating` (`queuepass-admin`): `{ reservedSeating, sections: [{ sectionId,
  tierId }] }`. Under the event lock: cancelled refuses (`409 EVENT_CANCELLED`); switching
  reserved seating either way with valid tickets refuses (`409 EVENT_HAS_ORDERS`); turning it on
  without a layout refuses (`400`); each `sectionId` must belong to the venue and each `tierId`
  to the event (`400`); moving a section that has valid tickets to another tier refuses (`409
  EVENT_HAS_ORDERS`). Mappings are replaced as given. Returns the seat map.
- A tier deleted while unsold takes its mappings with it (`ON DELETE CASCADE`), leaving those
  sections unmapped (spec clarify note).

## R6: Ordering seats

`OrderInput` gains `seats: [{ sectionId, row, seat }]`. Inside `006`'s locked order, after the
repeat, cancelled, and sales-closed checks:

1. A seated event requires `seats`, with exactly `quantity` entries; a general-admission event
   forbids them (`400`).
2. No seat repeats in the order; each `sectionId` is a section of the event's venue, `row` is
   1–`rows`, `seat` is 1–`seatsPerRow` (`400`).
3. For an event with tiers, every seat's section is mapped to the order's tier (`400`, naming the
   seat); without tiers, every section is for sale at the base price (FR-005).
4. Taken seats → `409 SEAT_TAKEN` with `details.seats: [{ section, row, seat }]`.
5. Then `005`'s tier quantity and capacity checks (FR-006 keeps tier quantities).

Tickets are created with their seat labels. A repeated `requestId` also compares seats (as a
set), so a repeat with different seats is `409 REQUEST_ID_REUSED`.

`Ticket` in responses gains `seat: { section, row, seat } | null`, so the confirmation, My
tickets, and the attendee list show it with no extra request (FR-011).

## R7: Admin app

- **Venue page**: a **Seating layout** card listing sections (name, rows × seats, seats) and the
  total; **Edit layout** opens a form of section lines (name, rows, seats per row; add, remove,
  reorder by position) saved with `PUT`; **Remove layout** confirms first. Refusals show their
  messages, including the blocking events.
- **Event page**: a **Seating** card. A "Reserved seating" checkbox (disabled with a reason when
  the venue has no layout or the event has sales), a tier select per section for events with
  tiers, and **Save seating**. Below it, the seat map: one section at a time, each row a line of
  seats marked sold or open, with sold and open counts per section.
- **Attendees**: each ticket shows its seat.

## R8: Customer app

`GetTickets` branches on `reservedSeating` from `GET /events/{id}/seats`:

- **General admission**: unchanged from `006`.
- **Seated**: pick a tier (when the event has tiers), then a section of that tier (a select),
  then seats in that section's grid. Each seat is a toggle button named "Row R, Seat S" with
  `aria-pressed`; taken seats are disabled. Chosen seats stay chosen across sections of the same
  tier and are listed with a remove control; changing tier clears them. Up to `min(10, tier or
  event tickets left)` seats. The total is the tier (or base) price times the seats chosen. Confirm
  sends `seats` and `quantity`. A `409 SEAT_TAKEN` reloads the seat map, unchooses the taken
  seats, keeps the rest, and names the taken seats in the alert.
- **Confirmation** and **My tickets** show each ticket's seat as "Section A, Row 3, Seat 7".

A section can be as large as 100 rows × 200 seats; only the chosen section is drawn.

## R9: Contract 1.5.0

Additive:

- `GET`, `PUT`, `DELETE /locations/{id}/layout` → `getLayout` (any signed-in), `replaceLayout`,
  `deleteLayout` (`queuepass-admin`).
- `GET /events/{id}/seats` → `getSeatMap` (any signed-in).
- `PUT /events/{id}/seating` → `updateSeating` (`queuepass-admin`).
- `Event.reservedSeating` (required boolean); `OrderInput.seats`; `Ticket.seat` (required,
  nullable).
- Schemas `SeatingLayout`, `Section`, `SectionInput`, `LayoutInput`, `SeatMap`, `SeatMapSection`,
  `SeatPosition`, `SeatChoice`, `SeatLabel`, `SeatingInput`.
- Error codes `SEAT_TAKEN`, `LAYOUT_IN_USE`, with `Conflict` examples. `updateEvent` and
  `updateLocation` document their new refusals.

## R10: Tests

Backend (Jest, Supertest, Testcontainers, contract validation): layout rules (capacity, names,
in-use, removal with reserved seating on, mappings dropped on replace); seating rules (no layout,
sales, foreign section or tier, retier with sales, cancelled); order rules (missing or extra
seats, duplicates, outside the layout, wrong tier, unmapped, taken with names, tier quantity
still enforced, repeat with different seats); **10 simultaneous orders for one seat → exactly
1**; cancellation frees seats; a venue move refused while seated; seating capacity below the
layout refused; seat map never names holders; role refusals via route coverage and authz suites.

Admin and Customer apps (Vitest, React Testing Library, stubbed fetch): the layout card and form,
the seating card and seat map, attendee seats; the seated Get tickets flow (tier, section, seats,
total, kept picks, cap, taken refusal), and seats on the confirmation and My tickets.
