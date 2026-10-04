# Feature Specification: Customer Event Search and Usability

**Feature Branch**: `008-customer-event-search`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "In the Customer app, customers find events: a search box for event
names, a venue filter, a date range, and a toggle to hide cancelled events, with the filters kept
in the page address so a filtered list can be reloaded or shared, and a plain 'no events match'
message with a way to clear the filters. It uses the event search the Backend already has. The
same feature makes the Customer app usable on a phone and easy to read: it adopts the Admin app's
existing look, shows events as cards with date, venue, price, and status, gives the Get tickets
form and the seat picker clear visual states, and keeps keyboard access and accessible contrast."

## Context

Builds on `003` (the Customer app lists events and venues), `004` (the Backend's event search),
`006` (getting tickets), and `007` (choosing seats). Today the Customer app shows every event in
one long table with no way to narrow it, and it has no styling at all: plain browser defaults, a
table that runs off a phone screen, and seat buttons that look alike whether chosen, taken, or
open.

The user originally planned a Customer app restyle as its own feature, then folded it into this
one, because both change the same pages. Constitution VII rules out branding and custom visual
design, so this spec states the restyle as **usability**: what a customer must be able to read,
tell apart, and reach, each testable. It reuses the look the Admin app already has rather than
designing a new one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find Events (Priority: P1)

On the Events page, a customer narrows the list by typing part of an event's name, choosing a
venue, setting a date range, or hiding cancelled events. The filters combine. The page address
records them, so reloading or sharing the link shows the same list.

**Why this priority**: The event list grows with every event an admin schedules; without a way to
narrow it, finding one event means scrolling.

**Independent Test**: With events at two venues across two months, filter by one venue and one
month, and confirm only matching events show; reload and confirm the same list and filter values.

**Acceptance Scenarios**:

1. **Given** events named "Season Opener" and "Comedy Night", **When** the customer types "open",
   **Then** only "Season Opener" shows, ignoring case.
2. **Given** events at two venues, **When** the customer chooses one venue, **Then** only that
   venue's events show.
3. **Given** a date range, **When** the customer sets it, **Then** only events starting within it
   show, still soonest first.
4. **Given** a cancelled event, **When** the customer turns on "Hide cancelled", **Then** it no
   longer shows; with the toggle off, it shows, marked cancelled.
5. **Given** filters set, **When** the customer reloads or opens the same address elsewhere,
   **Then** the same filters and results show.
6. **Given** filters that match nothing, **Then** the page says no events match and offers a
   control that clears every filter.

---

### User Story 2 - Read and Use the App on a Phone (Priority: P1)

A customer on a phone reads events as cards (name, date and time, venue, price from, and a
cancelled, sold-out, or sales-closed status), and can use every control, including the filters,
the Get tickets form, the seat picker, and My tickets, without zooming or scrolling sideways.

**Why this priority**: Customers buy tickets on their phones; a page that only works on a wide
screen loses them.

**Independent Test**: At a 375-pixel-wide viewport, open Events, an event, its seat picker, and My
tickets; confirm nothing scrolls sideways and every control can be tapped.

**Acceptance Scenarios**:

1. **Given** the event list, **When** viewed at 375 pixels wide, **Then** each event is a card
   showing its name, date and time, venue, lowest price, and status, and nothing scrolls sideways.
2. **Given** the Get tickets form or the seat picker at 375 pixels wide, **Then** every control is
   at least 44 by 44 pixels and nothing scrolls sideways.
3. **Given** a wide screen, **Then** cards sit side by side in a grid instead of one long column.

---

### User Story 3 - Tell States Apart at a Glance (Priority: P2)

In the seat picker and Get tickets form, a customer can tell, without reading every label, which
seats are open, chosen, and taken, and which tiers or events are sold out, cancelled, or closed.
The difference never depends on color alone.

**Why this priority**: In `007`'s seat picker, open, chosen, and taken seats look nearly the same.

**Independent Test**: In a section with open, chosen, and taken seats, confirm each state differs
in at least one way besides color (a mark, border, or pattern) and is announced to screen readers.

**Acceptance Scenarios**:

1. **Given** a seat map, **Then** open, chosen, and taken seats each look different, and the
   difference holds in grayscale.
2. **Given** a sold-out tier, a cancelled event, or closed sales, **Then** the status shows as a
   labelled badge, not only as plain text in a sentence.
3. **Given** any page, **Then** every control can be reached and used with the keyboard alone,
   and the focused control is visibly marked.

---

### Edge Cases

- **Filters in the address that make no sense** (an unknown venue, an end date before the start,
  a malformed date): the page ignores the bad filter, shows the rest, and does not break.
- **No events at all**: the page says there are no events yet, distinct from "no events match".
- **Typing quickly**: the list updates after the customer pauses typing, not on every keystroke.
- **Hide cancelled with everything cancelled**: shows the "no events match" message.
- **Prices**: an event with tiers shows its lowest tier price as "from $X"; one without shows its
  base price.
- **Venue page**: its list of events uses the same cards.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Customer app's Events page MUST offer a name search (ignoring case and
  surrounding spaces), a venue choice listing every venue, a start date and end date, and a "Hide
  cancelled" toggle. Filters MUST combine, and results MUST stay soonest first.
- **FR-002**: Name, venue, and dates MUST be applied by the Backend's existing event search
  (`004`), not by downloading every event; "Hide cancelled" MAY be applied in the app, since it
  changes only what is shown.
- **FR-003**: Every filter MUST be reflected in the page address, so reloading, going back, or
  opening the address elsewhere restores it. Invalid filters in the address MUST be ignored.
- **FR-004**: When filters match nothing, the page MUST say so and offer one control that clears
  every filter; when no events exist at all, it MUST say that instead.
- **FR-005**: Events MUST appear as cards with the name, local date and time, venue, lowest
  price ("from $X" with tiers, the base price without), and a status badge (Cancelled, Sold out,
  or Sales closed) when one applies. The same cards MUST appear on a venue's page.
- **FR-006**: At a 375-pixel-wide viewport, no Customer app page MUST scroll sideways, and every
  interactive control MUST be at least 44 by 44 pixels.
- **FR-007**: Text and controls MUST meet WCAG 2.1 AA contrast (4.5:1 for text, 3:1 for control
  boundaries and states).
- **FR-008**: In the seat picker, open, chosen, and taken seats MUST each differ by more than
  color, and each seat's state MUST be announced to assistive technology.
- **FR-009**: Every control MUST be operable by keyboard alone, with a visible focus indicator.
- **FR-010**: The Customer app MUST reuse the Admin app's existing visual language (colors, type,
  spacing, cards, buttons, form fields, badges) rather than introduce a new one (Constitution
  VII).
- **FR-011**: Every behavior from `003`, `006`, and `007` MUST be unchanged: the same data, rules,
  messages, and flows.
- **FR-012**: This feature MUST NOT change the Backend, the database, or the contract.
- **FR-013**: Automated tests MUST cover each filter alone and combined, the address round trip,
  invalid address filters, both empty states, the cards' content and badges, and the seat states'
  non-color differences and announcements; the 375-pixel and contrast checks MUST be verified in
  the running-system check.

### Key Entities

No new data. The Events page reads events and venues as `003` and `004` do; tickets left and sales
status come from `006`'s availability read.

## Success Criteria *(mandatory)*

- **SC-001**: A customer finds a named event among 50 in under 15 seconds.
- **SC-002**: 0 Customer app pages scroll sideways at 375 pixels wide.
- **SC-003**: 100% of seat states (open, chosen, taken) are distinguishable in grayscale.
- **SC-004**: 100% of interactive controls are reachable and usable by keyboard alone.
- **SC-005**: Every `003`, `006`, and `007` Customer test still passes.
- **SC-006**: The full test suite passes from a clean checkout.

## Assumptions

- **Search updates as you type**, after a short pause (about 300 ms), with no Search button.
- **Dates are whole days** in the customer's own time zone: an event matches if it starts on or
  after the start date and before the day after the end date.
- **"From" prices** need each event's tiers; the event page already loads them, and the list loads
  them per card only if the plan finds no cheaper way. The plan decides.
- **The Admin app's look is reused as-is**; nothing in this feature changes the Admin app.
- **No new pages**: filters live on the existing Events page.

## Out of Scope

- Sorting other than soonest first, saved searches, and full-text search of descriptions.
- Any change to the Admin app or the Booth app.
- Branding, logos, images, animation, and a dark/light theme switch beyond what the reused styles
  already do.
- Search by price, tier, or seat availability.
