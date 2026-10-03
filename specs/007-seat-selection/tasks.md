---
description: "Task list for Seat Selection"
---

# Tasks: Seat Selection

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.5.0, already applied),
[quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first** (spec FR-016, Constitution VI). In each phase, write the
test tasks and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Do not change the contract** (1.5.0, types regenerated, `packages/shared` mirrored). Raise
  any gap.
- **Locks** (research R3): layout writes lock the venue row, then every scheduled event at the
  venue in id order; seating writes, orders, and event edits lock one event. Nothing locks an
  event and then a venue.
- **One valid ticket per seat** is the partial unique index `ticket_one_valid_per_seat`; the
  Backend checks first only so it can name taken seats (research R2).
- **Tickets store seat labels** (`seatSection`, `seatRow`, `seatNumber`), never a `Section`
  foreign key (research R1).
- **One tier per order** (spec Clarifications): seats in a tiered order all belong to sections
  mapped to the order's tier.
- **General admission is untouched**: every `006` test must keep passing.
- **Green gate**: contract 1.5.0 makes `reservedSeating` and `seat` required in responses, so
  Backend contract validation fails on the plan PR until T005. Merge the plan and implementation
  PRs back to back, in order, after the `006` PRs.

---

## Phase 1: Setup

- [X] T001 Run `npm test` from the repo root (and each front-end workspace separately if the
  Backend fails first) and record the baseline in this line. Expect Backend failures only from
  contract validation of `Event.reservedSeating` and `Ticket.seat`, and from route coverage for
  `getLayout`, `replaceLayout`, `deleteLayout`, `getSeatMap`, and `updateSeating`.
  **Baseline 2026-10-03: shared 22, Admin 70, Customer 63, Booth 3, seed 3 pass. Backend 73 of
  228 pass; every contract failure is "must have required property 'reservedSeating'" (306
  times), plus route coverage for the five new operations.**

## Phase 2: Foundational (blocks every story)

- [X] T002 Add `Section` and `SectionTier` models, `Event.reservedSeating Boolean @default(false)`,
  and `Ticket.seatSection String?`, `seatRow Int?`, `seatNumber Int?` to
  `backend/prisma/schema.prisma`, and write
  `backend/prisma/migrations/20261005000000_seat_selection/migration.sql` per data-model.md:
  `Section.locationId` FK → `Location` `ON DELETE CASCADE`, indexed; `name` "1–50 characters;
  unique per venue ignoring case (`lower(name)` index)"; `rows` "1–100 (CHECK)"; `seatsPerRow`
  "1–200 (CHECK)"; `position` "unique per venue"; `SectionTier` primary key `(eventId,
  sectionId)` with FKs to `Event`, `Section`, and `TicketTier`, all `ON DELETE CASCADE`, and an
  index on `tierId`; CHECK `ticket_seat_all_or_none` ("all three null, or all three set") and
  `seatRow >= 1`, `seatNumber >= 1`; and the partial unique index `ticket_one_valid_per_seat` on
  `("eventId", "seatSection", "seatRow", "seatNumber") WHERE "status" = 'VALID' AND
  "seatSection" IS NOT NULL`. Run `npx prisma generate` in `backend/`.
- [X] T003 [P] Add `"SectionTier"` and `"Section"` to the `TRUNCATE` list in
  `backend/test/setup/reset-db.ts`, children first.
- [X] T004 [P] Select `"reservedSeating"` and `"locationId"` in `lockEvent` and add them to
  `LockedEvent` in `backend/src/common/event-lock.ts`.
- [X] T005 Return each ticket's seat in `toOrderResponse` in `backend/src/orders/orders.service.ts`
  (`seat: { section, row, seat }` from the three columns, or `null`), and confirm event responses
  include `reservedSeating` (Prisma spreads it in `backend/src/events/events.service.ts`). Add
  `reservedSeating: false` to events and `seat: null` to tickets in
  `admin-app/test/fixtures-005.ts` and `admin-app/test/fixtures/events.json`.

**Checkpoint**: the Backend suite matches the T001 baseline except that only route coverage still
fails (for the five new operations).

---

## Phase 3: User Story 1 - Admins Lay Out a Venue's Seats (Priority: P1) 🎯 MVP

**Goal**: An admin gives a venue sections of rows and seats, within its seating capacity, and
cannot change them while seated sales depend on them.

**Independent test**: Sections A (3×10) and B (2×20) show 70 seats; 30×20 more is refused
(quickstart S1).

### Tests for User Story 1 (write first, confirm they fail)

- [X] T006 [P] [US1] Write `backend/test/integration/layout.e2e-spec.ts`: `GET` returns
  `{ totalSeats: 0, sections: [] }` for a venue without one; `PUT` with A (3×10) and B (2×20)
  returns them in order with `totalSeats: 70`, and `GET` agrees; a second `PUT` replaces them;
  total seats above seating capacity → `409 CAPACITY_EXCEEDED`; names `A` and `a` → `400`;
  name of 0 or 51 characters, rows 0 or 101, seats per row 0 or 201, no sections, or 51 sections
  → `400`; with a scheduled event at the venue whose `reservedSeating` is set and which holds a
  valid seated ticket (both written directly with `ctx.prisma`), `PUT` and `DELETE` → `409
  LAYOUT_IN_USE` with `details.events` naming it, and after the event is cancelled both succeed;
  `DELETE` while a scheduled event has `reservedSeating` on but no tickets → `409 LAYOUT_IN_USE`;
  otherwise `DELETE` → `204` and `GET` is empty; `PATCH /locations/{id}` lowering
  `seatingCapacity` below the layout's seats → `409 CAPACITY_EXCEEDED`; customer and agent can
  `GET` but get `403` on `PUT` and `DELETE`; no token `401`.
- [X] T007 [P] [US1] Write `admin-app/test/layout.test.tsx` (stubbed fetch via
  `admin-app/test/helpers/api-stub.ts`): the venue page shows a Seating layout card listing each
  section's name, "3 rows × 10 seats", its seats, and the total; without a layout it says "No
  seating layout"; **Edit layout** shows one line per section (name, rows, seats per row) with
  Add section and Remove controls, and Save sends `PUT /locations/{id}/layout` with the sections
  in order; a `409 LAYOUT_IN_USE` or `409 CAPACITY_EXCEEDED` shows the Backend's message;
  **Remove layout** asks for confirmation, sends `DELETE` only when confirmed, and dismissing
  sends nothing.

### Implementation for User Story 1

- [X] T008 [US1] Create `backend/src/seating/` with `seating.module.ts`, `dto/layout-input.dto.ts`
  (nested `SectionInputDto`: `name` trimmed 1–50, `rows` 1–100, `seatsPerRow` 1–200; 1–50
  sections), `layout.service.ts` (get; replace and remove in one transaction that locks the venue
  row, then every scheduled event at the venue in id order; case-insensitive duplicate names →
  `400`; total seats above `seatingCapacity` → `conflict('CAPACITY_EXCEEDED', ...)`; any locked
  event with `reservedSeating` and a valid seated ticket → `conflict('LAYOUT_IN_USE', ...)` with
  `details.events`; for remove, also any locked event with `reservedSeating` on; replace deletes
  then inserts sections with `position` 0..n−1), and `layout.controller.ts`
  (`@Controller('locations/:id/layout')`: `GET` with no `@Roles`, `PUT` and `DELETE`
  `@Roles('queuepass-admin')`, `DELETE` `@HttpCode(204)`, `ParseUUIDPipe`). Register the module
  in `backend/src/app.module.ts`.
- [X] T009 [US1] In `backend/src/locations/locations.service.ts` `update`, refuse a
  `seatingCapacity` below the venue's layout seats with `conflict('CAPACITY_EXCEEDED', ...)`.
- [X] T010 [US1] Create `admin-app/src/api/seating.ts` (`getLayout`, `replaceLayout`,
  `deleteLayout`) and `admin-app/src/components/LayoutCard.tsx` (card, edit form, remove with
  `window.confirm`), and render it on `admin-app/src/pages/LocationDetail.tsx`.

**Checkpoint**: T006–T007 pass; quickstart S1 works in the browser.

---

## Phase 4: User Story 2 - Customers Choose Their Seats (Priority: P1)

**Goal**: An admin turns reserved seating on and maps sections to tiers; a customer picks a tier,
a section, and seats, sees the total, confirms, and sees each ticket's seat.

**Independent test**: As `customer1`, pick A-1-5 and A-1-6 and confirm; both seats appear on the
confirmation and My tickets (quickstart S2, S3).

### Tests for User Story 2 (write first, confirm they fail)

- [X] T011 [P] [US2] Write `backend/test/integration/seating.e2e-spec.ts`: `PUT
  /events/{id}/seating` turning reserved seating on at a venue with a layout returns the seat map
  with `reservedSeating: true`; at a venue without one → `400`; switching either way after a
  ticket is sold → `409 EVENT_HAS_ORDERS`; a section of another venue or a tier of another event
  → `400`; moving a section with valid tickets to another tier → `409 EVENT_HAS_ORDERS`, while
  mapping an unsold section succeeds; a cancelled event → `409 EVENT_CANCELLED`; `GET
  /events/{id}/seats` lists every section with `tierId`, `sold`, and `taken` positions and has
  exactly the contract's keys (no customer or order fields); replacing the venue's layout leaves
  the event's sections unmapped; deleting an unsold tier unmaps its sections; `PATCH
  /events/{id}` with a new `locationId` while reserved seating is on → `400`; customer and agent
  `GET` the seat map but get `403` on `PUT`; no token `401`.
- [X] T012 [P] [US2] Write `backend/test/integration/orders.seats.e2e-spec.ts`: a tiered seated
  order with 2 seats in its tier's section → `201`, tickets carry `seat` labels with the
  section's name; missing `seats`, a count different from `quantity`, `seats` on a
  general-admission event, a repeated seat, row or seat outside the section, a section of
  another venue, a section mapped to another tier, and an unmapped section → each `400`; a
  seated event without tiers sells any section's seats at the base price; a taken seat → `409
  SEAT_TAKEN` with `details.seats: [{ section, row, seat }]` and nothing recorded; the tier's
  quantity still stops sales (`409 SOLD_OUT`) with seats open; a repeated `requestId` with the same
  seats → `200`, with different seats → `409 REQUEST_ID_REUSED`; `GET /me/orders` and `GET
  /events/{id}/attendees` show the seats; a general-admission order still has `seat: null`.
- [X] T013 [P] [US2] Write `customer-app/test/seats.test.tsx` (stubbed fetch): for a seat map with
  `reservedSeating: true`, the form offers tiers, then a section select listing only the chosen
  tier's sections, then that section's seats as toggle buttons named "Row R, Seat S" with
  `aria-pressed`; taken seats are disabled; chosen seats are listed ("Section A, Row 1, Seat 5")
  with a Remove control; seats chosen in one section stay chosen after switching to another
  section of the same tier; changing tier clears them; no more than `min(10, tickets left)` seats
  can be chosen; the total is the tier price times the seats; Confirm sends `seats` (each
  `sectionId`, `row`, `seat`) and `quantity`; a `409 SEAT_TAKEN` names the taken seats in an
  alert, reloads the seat map, unchooses those seats, and keeps the rest; the confirmation lists
  each code with its seat; a general-admission event still shows the `006` form.
- [X] T014 [P] [US2] Add to `customer-app/test/my-tickets.test.tsx`: a seated ticket reads
  "CODE, Section A, Row 3, Seat 7: Valid"; general-admission tickets keep "CODE: Valid".

### Implementation for User Story 2

- [X] T015 [US2] Create `backend/src/seating/seat-map.service.ts` and `seat-map.controller.ts`
  (`@Controller('events/:id')`: `GET seats` with no `@Roles`; `PUT seating`
  `@Roles('queuepass-admin')`, with `dto/seating-input.dto.ts`) per research R5: the write locks
  the event, refuses cancelled, refuses switching with valid tickets, refuses turning on without
  sections, validates each section belongs to the venue and each tier to the event, refuses
  moving a section with valid tickets to another tier, and replaces the event's `SectionTier`
  rows; the read returns sections in `position` order with `tierId`, `sold`, and `taken` from
  valid tickets grouped by seat label. Register both in `seating.module.ts`.
- [X] T016 [US2] In `backend/src/events/events.service.ts` `updateLocked`, refuse a `locationId`
  change while `reservedSeating` is on with a `400` ("Turn reserved seating off before moving
  this event to another venue.").
- [X] T017 [US2] Add `seats` to `backend/src/orders/dto/create-order.dto.ts` (`@IsOptional`,
  `@IsArray`, `@ArrayMinSize(1)`, `@ArrayMaxSize(10)`, `@ValidateNested({ each: true })` of
  `SeatChoiceDto`: `sectionId` UUID, `row` and `seat` integers `>= 1`). In
  `backend/src/orders/orders.service.ts` `createLocked`, after the sales-closed check apply
  research R6 steps 1–4 against the venue's sections and the event's `SectionTier` rows, then
  `005`'s tier and capacity checks; create tickets with `seatSection` (the section's name),
  `seatRow`, and `seatNumber`; include seats in the repeat comparison (as a set of labels); map a
  `P2002` on `ticket_one_valid_per_seat` to `409 SEAT_TAKEN`.
- [X] T018 [P] [US2] Add `seatLabel(seat)` → "Section A, Row 3, Seat 7" to
  `customer-app/src/format.ts`, with cases in `customer-app/test/format.test.ts`.
- [X] T019 [US2] Create `customer-app/src/components/SeatPicker.tsx` (section select and seat grid
  per research R8) and, in `customer-app/src/components/GetTickets.tsx`, load `GET
  /events/{id}/seats` and use the seat picker when `reservedSeating` is true: send `seats` and
  `quantity`, handle `409 SEAT_TAKEN` (reload, unchoose, name the seats), and list each code with
  `seatLabel` on the confirmation.
- [X] T020 [US2] Show `seatLabel` for seated tickets in `customer-app/src/pages/MyTickets.tsx`.

**Checkpoint**: T011–T014 pass. Quickstart S2 and S3 need US4's Seating card to turn reserved
seating on in the browser, so they run at the US4 checkpoint.

---

## Phase 5: User Story 3 - No Seat Is Ever Sold Twice (Priority: P1)

**Goal**: Concurrent orders for one seat never both succeed, and cancellation frees seats.

**Independent test**: 10 simultaneous orders for one seat → exactly 1 succeeds (SC-001).

### Tests for User Story 3 (write first)

- [ ] T021 [P] [US3] Write `backend/test/integration/seats.concurrency.e2e-spec.ts`: **10
  simultaneous orders from 10 customers for the same seat → exactly one `201`, nine `409
  SEAT_TAKEN`, and one valid ticket for that seat**; simultaneous orders for A-1-1+A-1-2 and
  A-1-2+A-1-3 → exactly one succeeds; after the event is cancelled, its seat map shows 0 sold;
  inserting a second valid ticket for a sold seat directly with `ctx.prisma` violates
  `ticket_one_valid_per_seat`, while a valid ticket for a seat whose only ticket is void is
  accepted (the guarantee holds below the Backend).

### Implementation for User Story 3

- [ ] T022 [US3] Run T021 against the US2 code. If any case surfaces a `500` from the index,
  extend the `P2002` mapping in `backend/src/orders/orders.service.ts` so it answers `409
  SEAT_TAKEN` naming the seats; record in this line whether a change was needed.

**Checkpoint**: T021 passes; quickstart S5 (cancellation frees seats) works.

---

## Phase 6: User Story 4 - Admins See the Seat Map and Map Sections to Tiers (Priority: P2)

**Goal**: On the event page, an admin turns reserved seating on, maps sections to tiers, and sees
every seat sold or open with counts; attendees show seats.

**Independent test**: Map A → VIP and B → General, sell 3 seats in A, and see them sold with
matching counts (quickstart S2, S4).

### Tests for User Story 4 (write first, confirm they fail)

- [ ] T023 [P] [US4] Write `admin-app/test/seating.test.tsx`: the event page shows a Seating card
  with a "Reserved seating" checkbox, disabled with "This venue has no seating layout" or "Seats
  can't change after tickets are sold" as applicable; for an event with tiers, one tier select
  per section (including "Not for sale"); Save seating sends `PUT /events/{id}/seating` with
  `reservedSeating` and the mapped sections only; a refusal shows its message; the seat map shows
  one section at a time (a section select), each row as a line of seats marked sold or open, and
  "2 sold, 28 open" for that section.
- [ ] T024 [P] [US4] Add to `admin-app/test/attendees.test.tsx`: a seated ticket shows
  "Section A, Row 1, Seat 5" next to its code; general-admission tickets show no seat.

### Implementation for User Story 4

- [ ] T025 [US4] Add `getSeatMap` and `updateSeating` to `admin-app/src/api/seating.ts`; create
  `admin-app/src/components/SeatingCard.tsx` and `admin-app/src/components/SeatGrid.tsx`; render
  the card on `admin-app/src/pages/EventDetail.tsx` (hidden for cancelled events, as the tier form
  is).
- [ ] T026 [US4] Show each ticket's seat in `admin-app/src/pages/Attendees.tsx`.

**Checkpoint**: T023–T024 pass; quickstart S2, S3, and S4 work in the browser.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T027 Update `README.md`: the status table (007 built), the "Today" paragraph, the features
  list (venue layouts, reserved seating, choosing seats), and the scope boundaries.
- [ ] T028 Run lint, build, Prettier, `node scripts/check-boundary.mjs`, and
  `node scripts/check-contract-drift.mjs`; all pass. Record the result in this line.
- [ ] T029 Run `npm test` from the repo root; all suites pass, including route coverage and every
  `006` suite. Record the counts per workspace in this line.
- [ ] T030 Run `docker compose up --build -d`, then quickstart S1–S6 in a browser. Record the
  result in this line.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T005)** → stories.
- **US1** first: layouts must exist before seats can be chosen.
- **US2** needs US1 (its tests build layouts through the API).
- **US3** needs US2 (it orders seats). **US4** needs US2's Backend (T015) for its data; its UI
  tasks can start once T015 is done.
- **Polish (T027–T030)** after all stories.
- Within each story: tests → Backend → front ends.

## Parallel Opportunities

- **Foundational**: T003 and T004 alongside T002's migration writing.
- **US1**: T006 and T007 together; T010 (Admin) alongside T008–T009 (Backend).
- **US2**: T011–T014 are four different files; T018 alongside T015–T017.
- **US3** test T021 alongside US4 tests T023–T024 once US2 is done.

## Implementation Strategy

1. **MVP**: Setup, Foundational, US1 (layouts), then US2 (choosing seats), since layouts alone
   sell nothing. Stop and run quickstart S1–S3.
2. **Then US3**: prove the guarantee under concurrency.
3. **Then US4**: the admin seating card and seat map.
4. **Polish** and the running-system gate (T030) before the implementation PR.
