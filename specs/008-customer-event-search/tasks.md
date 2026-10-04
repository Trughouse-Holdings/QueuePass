---
description: "Task list for Customer Event Search and Usability"
---

# Tasks: Customer Event Search and Usability

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (no contract
change), [quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first** (spec FR-013, Constitution VI). In each phase, write the
test tasks and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **No Backend, database, or contract change** (FR-012). Only `customer-app/` and `README.md`
  change.
- **Behavior from `003`, `006`, and `007` stays the same** (FR-011): same data, rules, messages,
  and flows. Existing tests change only where they read markup that this feature replaces (the
  event table becomes cards), never their assertions about content, order, or behavior.
- **Seat button names stay "Row R, Seat S"**; state comes from `aria-pressed` and `disabled`
  (research R5).
- **`--text-faint` is never used for text** (research R2).

---

## Phase 1: Setup

- [X] T001 Run `npm test --workspace @queuepass/customer-app` and record the count in this line. **Baseline 2026-10-03: 75 Customer tests pass.**

## Phase 2: Foundational (blocks every story)

- [X] T002 Write `customer-app/test/contrast.test.ts`: parse the `:root` and dark-mode token
  blocks of `customer-app/src/styles.css`, and assert WCAG contrast of at least 4.5:1 for every
  text pair the stylesheet uses (`--text`, `--text-muted`, `--accent`, `--danger`, `--warn`,
  `--ok` on `--surface` and `--bg`; `--accent-text` on `--accent`) and at least 3:1 for state
  boundaries (`--border-strong` and `--accent` on `--surface`), in light and dark; and assert no
  rule sets `color: var(--text-faint)`.
- [X] T003 Create `customer-app/src/styles.css`: copy from `admin-app/src/styles.css` the tokens
  (light and dark), base, `.app`/`.topbar`/`.brand`/`.navlinks`/`.navlink`, `.main`, `.page-head`,
  `.page-title`, `.btn` variants, `.card`, `.pill`, `.price`, form `input`/`select`/checkbox,
  `.field`, `.field-row`, `.form__actions`, `.note`, `.empty`, `.loading`, `.visually-hidden`, and
  the 640-pixel breakpoint, each block marked with its source; add `:focus-visible` outlines and
  `min-height: 44px; min-width: 44px` for buttons, fields, and choice labels, and padding that
  gives nav links and links inside cards and lists a tap area at least 44 pixels tall (research
  R4; spec FR-006); import
  it in `customer-app/src/main.tsx`; give `customer-app/src/App.tsx`'s header and nav the Admin
  classes, keeping its link names and order.

**Checkpoint**: T002 passes; every existing Customer test still passes.

---

## Phase 3: User Story 1 - Find Events (Priority: P1) 🎯 MVP

**Goal**: Name, venue, date, and hide-cancelled filters on the Events page, in the address.

**Independent test**: Filter by one venue and one month, reload, and see the same filters and
results (quickstart E1).

### Tests for User Story 1 (write first, confirm they fail)

- [X] T004 [P] [US1] Write `customer-app/test/filters.test.tsx`: typing "open" sends `GET /events`
  with `q=open` after the pause and shows the results; choosing a venue sends `locationId`; start
  and end dates send `from` (local midnight of the start) and `to` (local midnight of the day
  after the end); filters combine in one request; each filter appears in the address; rendering
  at `/events?q=open&venue=v1&from=2026-12-01&to=2026-12-31&hideCancelled=1` fills every control
  and sends that query; "Hide cancelled" removes cancelled events without a new request; invalid
  address parameters (`venue=nope`, an unknown venue id, `from=2026-13-45`, `to` before `from`)
  are dropped from the request with no error shown; with filters and no results, "No events match
  your filters" and a **Clear filters** button that empties the address and the controls; with
  no filters and no events, `003`'s "Nothing is scheduled yet."

### Implementation for User Story 1

- [X] T005 [P] [US1] Create `customer-app/src/filters.ts`: read filters from `URLSearchParams`
  with validation per data-model.md ("`venue`: a UUID among the venues listed"; "`from`, `to`:
  `YYYY-MM-DD`, a real calendar date; `to` not before `from`"; "`hideCancelled`: `1`"); write them
  back; and build the `GET /events` query (`q`, `locationId`, `from`, `to` per research R1).
- [X] T006 [US1] Create `customer-app/src/components/EventFilters.tsx` (search box with a 300 ms
  pause, venue select from `GET /locations`, start and end date inputs, Hide cancelled checkbox,
  Clear filters) and use it in `customer-app/src/pages/EventList.tsx`, which reads filters from
  `useSearchParams`, loads `GET /events` with the built query, applies hide-cancelled, and shows
  the two empty states.

**Checkpoint**: T004 passes; quickstart E1 and E2 work in the browser.

---

## Phase 4: User Story 2 - Read and Use the App on a Phone (Priority: P1)

**Goal**: Events as cards on the Events and venue pages; a one-column, tappable layout.

**Independent test**: At 375 pixels wide, nothing scrolls sideways (quickstart E4).

### Tests for User Story 2 (write first, confirm they fail)

- [X] T007 [P] [US2] Write `customer-app/test/cards.test.tsx`: the Events page shows one `article`
  per event, in the Backend's order, each with the name linking to `/events/{id}`, the local date
  and time, the venue linking to `/venues/{id}`, the base price, and a "Cancelled" badge only on
  cancelled events; a venue's page shows the same cards; the cards come from `GET /events` alone
  (no per-event requests); an event's page shows "from $X" with the lowest tier price when the
  event has tiers; each card's links carry the class that gives them a 44-pixel tap area.
- [X] T008 [P] [US2] Update `customer-app/test/browse.test.tsx` so its event-list and venue-page
  cases read cards (`article`s) instead of table rows, keeping every assertion about content,
  links, order, dates, prices, empty and error states, and the Cancelled marker.

### Implementation for User Story 2

- [X] T009 [US2] Create `customer-app/src/components/EventCard.tsx` per spec FR-005 (the badge a
  `.pill` with the danger tokens) and a card grid in `customer-app/src/styles.css`
  (`repeat(auto-fill, minmax(260px, 1fr))`, one column below 640 pixels); render the cards in
  `customer-app/src/pages/EventList.tsx` and `customer-app/src/pages/VenueDetail.tsx`.
- [X] T010 [US2] Show "from $X" (the lowest tier price) on `customer-app/src/pages/EventDetail.tsx`
  when the event has tiers, from the tiers `GetTickets` already loads; give
  `customer-app/src/pages/VenueList.tsx`, `customer-app/src/pages/MyTickets.tsx`, and
  `customer-app/src/components/GetTickets.tsx` the copied card, button, field, and note classes,
  changing no text or behavior.

**Checkpoint**: T007–T008 pass; quickstart E3 and E4 work in the browser.

---

## Phase 5: User Story 3 - Tell States Apart at a Glance (Priority: P2)

**Goal**: Seat and status states that differ beyond color, with keyboard access and visible focus.

**Independent test**: Open, chosen, and taken seats differ in grayscale (quickstart E5).

### Tests for User Story 3 (write first, confirm they fail)

- [X] T011 [P] [US3] Add to `customer-app/test/seats.test.tsx`: a chosen seat shows "✓" before its
  number and has `aria-pressed="true"`; a taken seat shows "✕" instead of its number and is
  `disabled`; an open seat shows only its number; seat names stay "Row R, Seat S"; each section's
  seats sit in a region named "Section {name} seats" that is scrollable on its own.
- [X] T012 [P] [US3] Write `customer-app/test/keyboard.test.tsx` (with `@testing-library/user-event`):
  tabbing from the page start on Events reaches the search box, venue select, start date, end
  date, Hide cancelled, and the first card's link, in that order; on a seated event, Tab and Space
  choose a tier, Tab reaches the section select and then the first open seat, Space chooses it
  (`aria-pressed="true"`), and Tab skips taken seats (spec FR-009, SC-004).
- [X] T013 [P] [US3] Add to `customer-app/test/purchase-unavailable.test.tsx`: sold-out tiers, a
  cancelled event, and closed sales show their status as a badge element (class `pill`) as well
  as the existing text.

### Implementation for User Story 3

- [X] T014 [US3] In `customer-app/src/components/SeatPicker.tsx`, render the glyphs and state
  classes per research R5 and wrap the grid in a labelled `overflow-x: auto` region; add
  `.seat`, `.seat--chosen` (accent fill, thicker border), and `.seat--taken` (hatched stripes,
  dashed border) to `customer-app/src/styles.css`.
- [X] T015 [US3] In `customer-app/src/components/GetTickets.tsx`, show sold-out, cancelled, and
  sales-closed statuses as badges alongside their existing text.

**Checkpoint**: T011–T013 pass; quickstart E5 works in the browser.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T016 Update `README.md`: the status table (008 built), the "Today" paragraph, the features
  list (finding events; the Customer app on a phone), and the Customer app row.
- [ ] T017 Run lint, build, Prettier, `node scripts/check-boundary.mjs`, and
  `node scripts/check-contract-drift.mjs`; all pass. Record the result in this line.
- [ ] T018 Run `npm test` from the repo root; every suite passes, including all `003`, `006`, and
  `007` Customer tests. Record the counts per workspace in this line.
- [ ] T019 Run `docker compose up --build -d`, the demo-data command, and quickstart E1–E5 in a
  browser, including device mode at 375 × 812. Record the result in this line.

---

## Phase 7: User Story 4 - Detail Pages Match the Top Bar, in Both Apps (Priority: P3)

**Goal**: Shared layout rules, identical in both apps (spec FR-014–FR-016; research R7).

**Independent test**: An event's page in each app and My tickets show aligned label/value pairs
in padded cards and styled actions.

### Tests for User Story 4 (write first, confirm they fail)

- [ ] T020 [P] [US4] Write `customer-app/test/shared-look.test.ts`: read `customer-app/src/styles.css`
  and `admin-app/src/styles.css`, extract the block between `/* >>> shared detail layout` and
  `/* <<< shared detail layout */`, and assert it exists in both, is identical, and contains rules
  for `a`, `.btn` with a `background`, `.topbar button`, `dl` with `display: grid`, `dt`, `.card`
  child spacing, `.card + .card`, and `.page-head .form__actions`.
- [ ] T021 [P] [US4] Add to `customer-app/test/my-tickets.test.tsx`: the Tickets list has the
  `ticket-list` class (its rows' text is unchanged); and to `customer-app/test/browse.test.tsx`:
  the event page's and venue page's details sit inside an element with the `card` class.

### Implementation for User Story 4

- [ ] T022 [US4] Add the shared block per research R7 to `admin-app/src/styles.css` and the same
  block to `customer-app/src/styles.css`, plus `.ticket-list` rows in the Customer stylesheet.
- [ ] T023 [US4] Customer markup: `customer-app/src/pages/MyTickets.tsx` gives the Tickets list the
  `ticket-list` class; `customer-app/src/pages/EventDetail.tsx` and
  `customer-app/src/pages/VenueDetail.tsx` wrap their details in a `card`; give their titles the
  `page-title` class. No text or behavior changes.
- [ ] T024 Re-run T017's checks and T018's full test suite, then T019's browser check including an
  Admin event page. Record the results in this line.

**Checkpoint**: T020–T021 pass; both apps' detail pages match the top bar in the browser.

---

## Phase 8: User Story 5 - Create a Seated Venue in One Step (Priority: P3)

**Goal**: Seated or General admission on the New venue form (spec FR-017; research R8).

**Independent test**: Create a seated venue with A (3 × 10) and B (2 × 20); it has that layout
and capacity 70, with no capacity typed.

### Tests for User Story 5 (write first, confirm they fail)

- [ ] T025 [P] [US5] Write `admin-app/test/venue-create.test.tsx`: the New venue form defaults to
  General admission with the Seating capacity field; choosing Seated hides it and shows section
  lines (Add section, Remove section N) and "Total: N seats"; creating a seated venue sends
  `POST /locations` with `seatingCapacity` equal to the total, then `PUT
  /locations/{id}/layout` with the sections in order, and returns to the venue list; a refused
  layout shows the Backend's message, says the venue was created without its layout, and links to
  the venue's page; General admission still sends the typed capacity and no layout request.

### Implementation for User Story 5

- [ ] T026 [US5] Extract the section lines editor from `admin-app/src/components/LayoutCard.tsx`
  into `admin-app/src/components/SectionLines.tsx` and use it in both places; `LayoutCard` keeps
  its behavior and its tests.
- [ ] T027 [US5] In `admin-app/src/pages/LocationForm.tsx`, add the Seated / General admission
  choice on create (not edit), the sections and total for Seated, and the two-step create per
  research R8.
- [ ] T028 Re-run T017's checks and T018's full suite, then a browser check of US4 and US5 with
  T019's. Record the results in this line.

**Checkpoint**: T025 passes; a seated venue is created in one step in the browser.

---

## Phase 9: User Story 6 - Set Up Ticket Types and Sections While Scheduling (Priority: P3)

**Goal**: One form schedules a seated event with its ticket types and section mapping (spec
FR-018; research R9).

**Independent test**: Schedule an event at a three-section venue with Floor (front) and Balcony
(middle, back); it opens with Floor 10 and Balcony 20.

### Tests for User Story 6 (write first, confirm they fail)

- [ ] T029 [P] [US6] Write `admin-app/test/event-seating-create.test.tsx`: choosing a venue with a
  layout shows Reserved seating (checked) and General admission, ticket type lines (name, price,
  Add ticket type, Remove), one select per section ("Section front ticket type") listing the types
  and Not for sale, each type's seat total, and no Total tickets field; scheduling sends, in order,
  `POST /events` without `totalTicketCapacity`, `PUT /events/{id}/seating` with
  `reservedSeating: true` and no sections, one `POST /events/{id}/tiers` per type with name and
  price only, and `PUT /events/{id}/seating` with each section's new tier id, then shows the event
  page; a refused tier shows the Backend's message and a link to the event page; choosing General
  admission keeps the plain form; a venue without a layout shows no Tickets and seating section.

### Implementation for User Story 6

- [ ] T030 [US6] In `admin-app/src/pages/EventForm.tsx` (create only), load the chosen venue's
  layout, render the Tickets and seating section, and run the steps per research R9 through
  `admin-app/src/api/events.ts`, `admin-app/src/api/tiers.ts`, and `admin-app/src/api/seating.ts`.
- [ ] T031 Re-run T017's checks and T018's full suite, then the browser check with T019, T024, and
  T028. Record the results in this line.

**Checkpoint**: T029 passes; an event at a laid-out venue is fully set up from one form.

---

## Phase 10: User Story 7 - Price by Ticket Types, and Edit Them With the Event (Priority: P3)

**Goal**: No base price field; ticket types in both forms; editing applies them (spec FR-019;
research R10).

### Tests for User Story 7 (write first, confirm they fail)

- [ ] T032 [P] [US7] Write `admin-app/test/event-types-edit.test.tsx`: neither form has a Base price
  field; scheduling a general-admission event requires a ticket type with a quantity and sends
  `basePrice` as the lowest type price then one `POST .../tiers` per type with its quantity;
  editing a seated event shows its tiers and section types prefilled, and saving after renaming
  and repricing a type, adding one, and moving an unsold section sends `PATCH /events/{id}`, the
  new tier's `POST`, the changed tier's `PATCH` (no quantity), and `PUT .../seating` with the new
  mapping, then opens the event; a refused step shows its reason and keeps the form's values.
- [ ] T033 [P] [US7] Update `admin-app/test/EventForm.conflict.test.tsx`,
  `admin-app/test/delete-flows.event.test.tsx`, `admin-app/test/pages.live-fixtures.test.tsx`,
  `admin-app/test/capacity.test.tsx`, and `admin-app/test/event-seating-create.test.tsx` to fill
  ticket type 1 instead of the base price, keeping every other assertion.

### Implementation for User Story 7

- [ ] T034 [US7] In `admin-app/src/pages/EventForm.tsx`, remove the base price field, make ticket
  types part of both forms (quantity for general admission), load and apply them on edit, and
  send the lowest type price as `basePrice`, per research R10.
- [ ] T035 Re-run T017's checks and T018's full suite, then the browser check with T019, T024,
  T028, and T031. Record the results in this line.

**Checkpoint**: T032–T033 pass; both forms price by ticket types in the browser.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T003)** → stories.
- **US1** (filters) and **US2** (cards) both change `EventList.tsx`: do US1 first, then US2.
- **US3** needs only Foundational; its tests and `SeatPicker.tsx` work can run alongside US1, but
  T015 edits `GetTickets.tsx` after US2's T010 does.
- **Polish (T016–T019)** after all stories; **US4 (T020–T024)** was added during T019's browser
  check and closes with its own re-run of the checks (T024).

## Parallel Opportunities

- **US1**: T004 (tests) alongside T005 (`filters.ts`).
- **US2**: T007 and T008.
- **US3**: T011, T012, and T013; T014 alongside US1.

## Implementation Strategy

1. **MVP**: Setup, Foundational, US1. Customers can find events, and the app already uses the
   Admin look.
2. **Then US2**: cards and the phone layout.
3. **Then US3**: seat and status states.
4. **Polish** and the running-system gate (T019) before the implementation PR.
