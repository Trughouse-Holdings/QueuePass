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

## Clarifications

### Session 2026-10-03

- Q: On the event list, should each card show the "from $X" price and the Sold out / Sales closed
  badges, given the list doesn't include that information? → A: No. Cards show what the list
  already has: name, date and time, venue, base price, and a Cancelled badge. The event page,
  which already loads tiers and availability, shows tier prices and the Sold out and Sales closed
  badges. No extra requests per card and no Backend change.
- Q: (During the browser check) Should detail pages in both apps match the top bar's look? → A:
  Yes. The user found label/value lists, links in browser-default blue, plain gray buttons, and
  edge-to-edge text inside cards inconsistent with the top bar in both apps. Added as US4; the
  Admin app is now in scope for these shared layout rules only.
- Q: (During the browser check) A new venue still asks for a seating capacity that its layout
  will replace. How should creating a venue work? → A: The form asks Seated or General admission.
  Seated: define sections in the form, and the capacity is calculated, never typed. General
  admission: type a capacity, as before. Added as US5.
- Q: (During the browser check) Setting up ticket types and sections took two cards on the event
  page after scheduling. Should it happen while scheduling? → A: Yes, in one place: the Schedule
  event form sets up reserved seating, ticket types (name and price), and each section's ticket
  type, then opens the new event. Added as US6.

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

A customer on a phone reads events as cards (name, date and time, venue, base price, and a
Cancelled badge when it applies), and can use every control, including the filters,
the Get tickets form, the seat picker, and My tickets, without zooming or scrolling sideways.

**Why this priority**: Customers buy tickets on their phones; a page that only works on a wide
screen loses them.

**Independent Test**: At a 375-pixel-wide viewport, open Events, an event, its seat picker, and My
tickets; confirm nothing scrolls sideways and every control can be tapped.

**Acceptance Scenarios**:

1. **Given** the event list, **When** viewed at 375 pixels wide, **Then** each event is a card
   showing its name, date and time, venue, base price, and a Cancelled badge when cancelled, and
   nothing scrolls sideways.
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
2. **Given** a cancelled event in the list, or a sold-out tier, a cancelled event, or closed sales
   on an event's page, **Then** the status shows as a labelled badge, not only as plain text in a
   sentence.
3. **Given** any page, **Then** every control can be reached and used with the keyboard alone,
   and the focused control is visibly marked.

---

### User Story 4 - Detail Pages Match the Top Bar, in Both Apps (Priority: P3)

In both apps, detail pages read as tidy panels: labels and values sit side by side inside cards
with inner spacing, links and action buttons look like the top bar's controls, and lists of
ticket codes read as a list of codes rather than bullet points.

**Why this priority**: Added by the user during the browser check; it changes no behavior.

**Independent Test**: Open an event's page in each app and My tickets in the Customer app; confirm
labels and values align in two columns inside padded cards and every action is a styled button.

**Acceptance Scenarios**:

1. **Given** a detail page in either app, **Then** each label and its value sit on one line, the
   label muted, inside a card whose content does not touch its edges.
2. **Given** an action such as Attendees, Edit, Cancel event, Delete, or Log out, **Then** it looks
   like the app's buttons, never a browser-default link or gray system button.
3. **Given** any link in dark mode, **Then** it uses the app's accent color, never browser-default
   blue or purple.
4. **Given** My tickets, **Then** each ticket code reads as a row with its state, without bullets.

---

### User Story 5 - Create a Seated Venue in One Step (Priority: P3)

On the Admin app's New venue form, an admin chooses Seated or General admission. For a seated
venue they add its sections (name, rows, seats per row) right there; the form shows the total
seats as the venue's capacity, with no capacity to type. For general admission they type a
capacity as before.

**Why this priority**: Added by the user during the browser check; it removes a number that the
layout would immediately replace.

**Independent Test**: Create a seated venue with sections A (3 × 10) and B (2 × 20); confirm it
exists with that layout and a capacity of 70, and no capacity was typed.

**Acceptance Scenarios**:

1. **Given** the New venue form, **When** the admin chooses Seated, **Then** the capacity field is
   replaced by section lines and a running total of seats.
2. **Given** a seated venue with sections, **When** the admin creates it, **Then** the venue
   exists with that layout and its capacity is the layout's total.
3. **Given** General admission, **Then** the form asks for a capacity exactly as before.
4. **Given** the venue is created but its layout is refused, **Then** the admin is told so, with a
   way to the venue's page to add the layout there.

---

### User Story 6 - Set Up Ticket Types and Sections While Scheduling (Priority: P3)

When an admin schedules an event at a venue that has a seating layout, the Schedule event form
also asks for reserved seating or general admission, the event's ticket types (name and price),
and which ticket type each section sells, showing each type's seats as they choose. Scheduling
creates the event with all of it and opens the event's page.

**Why this priority**: Added by the user during the browser check; the same setup otherwise
takes two cards on the event page after scheduling.

**Independent Test**: At a venue with sections front, middle, and back, schedule an event with
Floor (front) and Balcony (middle and back) in one form; the event opens with reserved seating,
Floor at 10 seats and Balcony at 20, and nothing else to set up.

**Acceptance Scenarios**:

1. **Given** a venue with a layout, **When** the admin chooses it, **Then** the form shows
   Reserved seating (chosen) or General admission, ticket type lines, and one row per section with
   a ticket type choice, and no Total tickets field while reserved seating is chosen.
2. **Given** ticket types and section choices, **Then** the form shows each type's seat count.
3. **Given** the admin schedules it, **Then** the event exists with reserved seating, its tiers,
   and its section mappings, and its page opens.
4. **Given** the event is created but a later step is refused, **Then** the admin is told what
   was refused and is offered the event's page to finish there.
5. **Given** a venue without a layout, or editing an event, **Then** the form is as before.

---

### Edge Cases

- **Filters in the address that make no sense** (an unknown venue, an end date before the start,
  a malformed date): the page ignores the bad filter, shows the rest, and does not break.
- **No events at all**: the page says there are no events yet, distinct from "no events match".
- **Typing quickly**: the list updates after the customer pauses typing, not on every keystroke.
- **Hide cancelled with everything cancelled**: shows the "no events match" message.
- **Prices**: cards show the event's base price; an event's page shows each tier's price and, for
  an event with tiers, its lowest as "from $X".
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
- **FR-005**: Events MUST appear as cards with the name, local date and time, venue, base price,
  and a Cancelled badge when cancelled, using only what the event list already provides (no
  per-card requests). The same cards MUST appear on a venue's page. An event's page MUST show its
  tier prices (with the lowest as "from $X" when it has tiers) and Sold out or Sales closed
  badges when they apply.
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
- **FR-014**: In both apps, label/value lists MUST show each label beside its value, the label in
  the muted text color, and content placed directly in a card MUST have inner spacing.
- **FR-015**: In both apps, links and buttons that perform actions (including Log out) MUST use
  the app's button styles, and every link MUST use the accent color in light and dark mode.
- **FR-016**: These shared layout rules MUST be identical in both apps' stylesheets, checked by a
  test, and MUST NOT change any text, control, or behavior.
- **FR-017**: The Admin app's New venue form MUST offer Seated and General admission, defaulting
  to General admission. Seated MUST take sections in the form (as on the venue page), show their
  total, and ask for no capacity; creating it MUST create the venue and then save its layout, so
  the Backend sets the capacity (`007` FR-017). Editing a venue is unchanged.
- **FR-018**: The Admin app's Schedule event form MUST, for a venue with a layout, offer reserved
  seating (chosen by default) or general admission; with reserved seating, ticket types (name
  and price, at least one) and a ticket type (or Not for sale) per section, with each type's seat
  total, and no ticket capacity to type. Scheduling MUST create the event, turn reserved seating
  on, create the ticket types, and map the sections, through the existing operations, then open
  the event's page. A refusal after the event exists MUST say what failed and link to the event.
  Venues without a layout and editing an event are unchanged.

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

- **"Hide cancelled" starts off**, so cancelled events still show, marked, as `005` FR-012
  requires; the customer turns it on.
- **Search updates as you type**, after a short pause (about 300 ms), with no Search button.
- **Dates are whole days** in the customer's own time zone: an event matches if it starts on or
  after the start date and before the day after the end date.
- **The Admin app's look is reused as-is**; nothing in this feature changes the Admin app.
- **No new pages**: filters live on the existing Events page.

## Out of Scope

- Sorting other than soonest first, saved searches, and full-text search of descriptions.
- Any change to the Booth app, and any Admin change beyond FR-014–FR-018.
- Branding, logos, images, animation, and a dark/light theme switch beyond what the reused styles
  already do.
- Search by price, tier, or seat availability.
