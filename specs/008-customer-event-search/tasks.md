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

- [ ] T001 Run `npm test --workspace @queuepass/customer-app` and record the count in this line.

## Phase 2: Foundational (blocks every story)

- [ ] T002 Write `customer-app/test/contrast.test.ts`: parse the `:root` and dark-mode token
  blocks of `customer-app/src/styles.css`, and assert WCAG contrast of at least 4.5:1 for every
  text pair the stylesheet uses (`--text`, `--text-muted`, `--accent`, `--danger`, `--warn`,
  `--ok` on `--surface` and `--bg`; `--accent-text` on `--accent`) and at least 3:1 for state
  boundaries (`--border-strong` and `--accent` on `--surface`), in light and dark; and assert no
  rule sets `color: var(--text-faint)`.
- [ ] T003 Create `customer-app/src/styles.css`: copy from `admin-app/src/styles.css` the tokens
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

- [ ] T004 [P] [US1] Write `customer-app/test/filters.test.tsx`: typing "open" sends `GET /events`
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

- [ ] T005 [P] [US1] Create `customer-app/src/filters.ts`: read filters from `URLSearchParams`
  with validation per data-model.md ("`venue`: a UUID among the venues listed"; "`from`, `to`:
  `YYYY-MM-DD`, a real calendar date; `to` not before `from`"; "`hideCancelled`: `1`"); write them
  back; and build the `GET /events` query (`q`, `locationId`, `from`, `to` per research R1).
- [ ] T006 [US1] Create `customer-app/src/components/EventFilters.tsx` (search box with a 300 ms
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

- [ ] T007 [P] [US2] Write `customer-app/test/cards.test.tsx`: the Events page shows one `article`
  per event, in the Backend's order, each with the name linking to `/events/{id}`, the local date
  and time, the venue linking to `/venues/{id}`, the base price, and a "Cancelled" badge only on
  cancelled events; a venue's page shows the same cards; the cards come from `GET /events` alone
  (no per-event requests); an event's page shows "from $X" with the lowest tier price when the
  event has tiers; each card's links carry the class that gives them a 44-pixel tap area.
- [ ] T008 [P] [US2] Update `customer-app/test/browse.test.tsx` so its event-list and venue-page
  cases read cards (`article`s) instead of table rows, keeping every assertion about content,
  links, order, dates, prices, empty and error states, and the Cancelled marker.

### Implementation for User Story 2

- [ ] T009 [US2] Create `customer-app/src/components/EventCard.tsx` per spec FR-005 (the badge a
  `.pill` with the danger tokens) and a card grid in `customer-app/src/styles.css`
  (`repeat(auto-fill, minmax(260px, 1fr))`, one column below 640 pixels); render the cards in
  `customer-app/src/pages/EventList.tsx` and `customer-app/src/pages/VenueDetail.tsx`.
- [ ] T010 [US2] Show "from $X" (the lowest tier price) on `customer-app/src/pages/EventDetail.tsx`
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

- [ ] T011 [P] [US3] Add to `customer-app/test/seats.test.tsx`: a chosen seat shows "✓" before its
  number and has `aria-pressed="true"`; a taken seat shows "✕" instead of its number and is
  `disabled`; an open seat shows only its number; seat names stay "Row R, Seat S"; each section's
  seats sit in a region named "Section {name} seats" that is scrollable on its own.
- [ ] T012 [P] [US3] Write `customer-app/test/keyboard.test.tsx` (with `@testing-library/user-event`):
  tabbing from the page start on Events reaches the search box, venue select, start date, end
  date, Hide cancelled, and the first card's link, in that order; on a seated event, Tab and Space
  choose a tier, Tab reaches the section select and then the first open seat, Space chooses it
  (`aria-pressed="true"`), and Tab skips taken seats (spec FR-009, SC-004).
- [ ] T013 [P] [US3] Add to `customer-app/test/purchase-unavailable.test.tsx`: sold-out tiers, a
  cancelled event, and closed sales show their status as a badge element (class `pill`) as well
  as the existing text.

### Implementation for User Story 3

- [ ] T014 [US3] In `customer-app/src/components/SeatPicker.tsx`, render the glyphs and state
  classes per research R5 and wrap the grid in a labelled `overflow-x: auto` region; add
  `.seat`, `.seat--chosen` (accent fill, thicker border), and `.seat--taken` (hatched stripes,
  dashed border) to `customer-app/src/styles.css`.
- [ ] T015 [US3] In `customer-app/src/components/GetTickets.tsx`, show sold-out, cancelled, and
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

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T003)** → stories.
- **US1** (filters) and **US2** (cards) both change `EventList.tsx`: do US1 first, then US2.
- **US3** needs only Foundational; its tests and `SeatPicker.tsx` work can run alongside US1, but
  T015 edits `GetTickets.tsx` after US2's T010 does.
- **Polish (T016–T019)** after all stories.

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
