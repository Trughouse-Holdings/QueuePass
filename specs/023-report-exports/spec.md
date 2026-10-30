# Feature Specification: Report Exports

**Feature Branch**: `023-report-exports-spec`

**Created**: 2026-10-30

**Status**: Draft

**Issue**: [#52](https://github.com/Trughouse-Holdings/QueuePass/issues/52) (export attendee lists
and sales reports as CSV, XLSX and PDF)

**Input**: User description: "023" (the roadmap entry reserved for #52 in Constitution 3.4.2). From
the issue: admins can see attendee lists and sales reports in the Admin app but cannot take them
anywhere else. Each can be downloaded as CSV, XLSX (Excel), or PDF, with the same figures as the
screen at the moment it was made, saying when it was made; only admins can export; the CSV and XLSX
files are usable as data in a spreadsheet; the PDF is readable when printed.

## Context

Builds on `005` (an event's **Attendees** page: every order, oldest first, refunded ones included,
with its customer, tier, quantity, total, status, ticket codes, and check-ins; the **Reports** page:
totals and one row per event with venue, date, sold of capacity, revenue, and checked in), `007`
(seats on tickets), `017` (the name on the tickets, check-in times), and `020` (every event time in
its venue's time zone).

Today the two pages can only be read on screen. This feature adds a **Download** control to each
with three choices, CSV, Excel (XLSX), and PDF, that saves a file of what the page shows.

## Clarifications

### Session 2026-10-30

Nate asked for this spec to be written unattended: each question below took the recommended answer,
recorded here so the team can overturn it in review of the spec PR.

- Q: Which columns go in each export: the same as the screen, or more? (issue open question 1) → A:
  **The screen's figures, laid out as data.** The attendee list has **one row per ticket** (the
  screen groups tickets by order), carrying its order's details, so a spreadsheet can sort, filter,
  and count tickets; each row's price is the ticket's own price, so the column adds up to the orders'
  totals. The sales report has one row per event with the screen's columns, plus each event's status
  and time zone, and a final **Total** row with the screen's totals (FR-004, FR-005).
- Q: Do filters or searches on the screen apply to the export? (open question 2) → A: The two pages
  have no filters or searches today, so the export is always the whole list or report. When a later
  feature adds one, its export follows what the screen shows (Assumptions).
- Q: What's the largest export that must be supported, and how long may it take? (open question 3)
  → A: An attendee list of **25,000 tickets** (larger than the largest seeded venue's capacity) in
  every format; up to 5,000 tickets, every format is ready within 10 seconds on a laptop (SC-003,
  SC-004).
- Q: Attendee lists contain personal data. Does an export need to be recorded? (open question 4) →
  A: **Not in this feature.** Recording who exported what belongs to the audit log (#51), which does
  not exist yet; this is a recorded deferral to that issue (Constitution VIII). Meanwhile the
  attendee list's download says the file contains customers' names (FR-011).
- Q: Where are the files made? → A: In the Admin app, from the same data the page already shows, so
  the file can never differ from the screen (plan). No new Backend operation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Admin Downloads an Event's Attendee List (Priority: P1)

The day before the Season Opener, an admin opens its **Attendees** page and chooses **Download →
Excel**. A file named after the event and the time it was made is saved. Opened in Excel, it has one
row per ticket: when the order was placed, the customer, the name on the tickets, the tier, the
seat, the ticket code, the ticket's status, when it was checked in, the order's status, and the
ticket's price, with dates as dates and prices as numbers. A second sheet says what the file is,
which event, when it was made, and that times are in the venue's time zone.

**Why this priority**: The attendee list is the one the issue leads with, and the one used away from
the screen (a door list, a hand-off to a venue).

**Independent Test**: For an event with orders in two tiers, a seated order, a refunded order, and a
checked-in ticket, download all three formats and compare each with the page.

**Acceptance Scenarios**:

1. **Given** an event with orders, **When** an admin chooses Download → CSV, Excel, or PDF on its
   Attendees page, **Then** a file in that format is saved, named
   `attendees-<event name>-<YYYY-MM-DD-HHmm>.<csv|xlsx|pdf>` with the time it was made.
2. **Given** that file, **When** it is opened, **Then** every ticket on the page is in it once, with
   the same customer, name on tickets, tier, seat, code, status, check-in, and order status as the
   page, and the price column adds up to the page's order totals.
3. **Given** the Excel file, **When** opened in a spreadsheet, **Then** the date-time columns are
   date-times and the price column is a number shown with two decimals, and summing it gives the
   exact total.
4. **Given** the CSV file, **When** imported into a spreadsheet, **Then** the first row is the column
   names, every following row is one ticket, the date-times are in a form spreadsheets read as dates,
   and prices are plain numbers with two decimals.
5. **Given** an event with no orders, **When** an admin looks for Download, **Then** it is not
   offered, as the page says no one has tickets yet.

---

### User Story 2 - An Admin Downloads the Sales Report (Priority: P1)

After a weekend of events, an admin opens **Reports** and chooses **Download → PDF**. The PDF has the
report's title, when it was made, the totals, and the table of events, and prints readably on letter
paper with page numbers and the column names repeated on every page.

**Why this priority**: The second report the issue names; it is what gets shared with people who do
not use QueuePass.

**Independent Test**: With scheduled and cancelled events in two time zones, download all three
formats and compare each with the page.

**Acceptance Scenarios**:

1. **Given** the Reports page, **When** an admin downloads CSV, Excel, or PDF, **Then** the file is
   named `sales-report-<YYYY-MM-DD-HHmm>.<ext>` and has one row per event on the page, in the same
   order, with its name, venue, date and start time in its venue's zone, the zone, status, tickets
   sold, ticket capacity, revenue, and checked in, and a final **Total** row with the page's totals.
2. **Given** a cancelled event, **When** exported, **Then** its row says Cancelled, as the page does.
3. **Given** the PDF, **When** printed on letter paper, **Then** every column fits the page width, the
   column names repeat on each page, each page shows "Page n of m", and text is at least 9 points.

---

### User Story 3 - The File Says When It Was Made (Priority: P1)

An admin finds two attendee files for the same event on their laptop. Each says when it was made, so
they know which is current.

**Why this priority**: The issue requires it; figures change as people buy and check in.

**Acceptance Scenarios**:

1. **Given** any exported file, **When** read, **Then** it states the date and time it was made, with
   the time zone: in the PDF's heading, on the Excel file's About sheet, and in the CSV as a last
   column `Exported at` on every row, and in every file name.
2. **Given** a sale made after the page loaded, **When** the admin downloads without reloading,
   **Then** the file matches the page (it is made from the page's data), and its made-at time is the
   moment the page's data was loaded, not the click (FR-003).

---

### User Story 4 - Only Admins, and Safe to Open (Priority: P2)

A customer cannot get these files; a name typed onto an order that looks like a spreadsheet formula
is shown as text, not run.

**Acceptance Scenarios**:

1. **Given** someone without the admin role, **When** they try to reach either page or its data,
   **Then** they are refused as today (the Admin app and the Backend both require the admin role),
   so they cannot export.
2. **Given** a name on tickets that starts with `=`, `+`, `-`, `@`, a tab, or a carriage return,
   **When** exported to CSV or Excel and opened, **Then** the cell shows the text as typed and no
   formula runs.

---

### Edge Cases

- **Refunded orders and void tickets**: included, with their statuses, as on the page; a void
  ticket's price is still the ticket's price, and its row says Void, so a sum of valid tickets is a
  filter away. The Total row of the sales report uses the page's totals, which already exclude them.
- **No name on the tickets** (orders from before `017`): the cell says "No name on ticket", as the
  page.
- **General admission**: Tier says "General admission", Seat is empty.
- **Commas, quotes, line breaks, and non-English letters** in names: CSV quoting per RFC 4180, UTF-8
  with a byte-order mark so Excel reads the letters right; Excel and PDF show them as typed.
- **Events in several time zones** (sales report): each row's date and time in its own venue's zone,
  with the zone named in its own column.
- **A very long event or venue name**: the PDF wraps it within its column.
- **The page failed to load or is still loading**: no Download is offered.
- **A slow export** (a large PDF): the control says it is preparing the file and cannot be pressed
  twice; the page stays usable.
- **A download the browser blocks**: the admin sees an error naming the format, and can try again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Attendees page MUST offer a Download control with three choices, CSV, Excel
  (XLSX), and PDF, whenever it shows at least one order.
- **FR-002**: The Reports page MUST offer the same control whenever it shows the report.
- **FR-003**: Each file MUST be made from the data the page is showing, so its figures match the page
  exactly, and MUST state the time that data was loaded as the time it was made.
- **FR-004**: The attendee export MUST have one row per ticket with these columns, in order: Order
  placed (date-time), Customer, Name on tickets, Tier, Seat, Ticket code, Ticket status (Valid, Void),
  Checked in (date-time, empty if not), Order status (Confirmed, Refunded), Price (the order's unit
  price), Order (a short order reference shared by its tickets). Orders oldest first, tickets in the
  page's order.
- **FR-005**: The sales report export MUST have one row per event with these columns, in order:
  Event, Venue, Starts (date-time), Time zone, Status (Scheduled, Cancelled), Tickets sold, Ticket
  capacity, Revenue, Checked in; in the page's order; then one row **Total** with the page's totals
  (scheduled events, their capacity, tickets sold, checked in, revenue).
- **FR-006**: Every date-time MUST be in its event's venue time zone (`020`), the zone named in the
  file (a column or the About sheet and PDF heading).
- **FR-007**: CSV files MUST follow RFC 4180, be UTF-8 with a byte-order mark, have one header row,
  write date-times as `YYYY-MM-DD HH:MM` in the venue's zone, money as plain decimals with two places
  (`45.00`), counts as plain integers, and end every row with `Exported at` (the made-at time with its
  offset).
- **FR-008**: Excel files MUST store date-times as date-time cells, money as number cells formatted
  with two decimals and a dollar sign, counts as number cells, and text as text; the first sheet is
  the table with a frozen header row; a second sheet, **About**, states the report, the event (for
  attendees), when it was made, by which admin, and that times are in the venue's zone.
- **FR-009**: PDF files MUST be letter size, landscape when needed to fit the columns, with a heading
  (report, event, made at), the table with its header repeated on every page, "Page n of m" on each
  page, text at least 9 points, and no text cut off.
- **FR-010**: CSV and Excel cells whose text starts with `=`, `+`, `-`, `@`, a tab, or a carriage
  return MUST be written so that a spreadsheet shows the text and never evaluates it.
- **FR-011**: The attendee list's Download control MUST say the file contains customers' names and
  usernames.
- **FR-012**: File names MUST be `attendees-<event name>-<YYYY-MM-DD-HHmm>.<ext>` and
  `sales-report-<YYYY-MM-DD-HHmm>.<ext>`, with the event name reduced to letters, digits, and
  hyphens, the time in the admin's own zone.
- **FR-013**: Only signed-in admins can export: the Download control exists only in the Admin app,
  which requires the admin role, and the data comes only from operations the Backend restricts to
  admins.
- **FR-014**: While a file is being made, the control MUST say so and MUST NOT start a second one; a
  failure MUST be shown as an error naming the format, with the page left usable.
- **FR-015**: The Download control MUST be reachable and usable by keyboard and screen reader, at
  phone width, in light and dark schemes (as `008`, `012`).

### Key Entities

- **Attendee export row**: one ticket with its order's details (FR-004).
- **Sales export row**: one event's figures (FR-005), plus the Total row.
- **Export file**: a format, a file name (FR-012), a made-at time (FR-003), and its rows.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a test event with every edge case above, every value in each of the six files (two
  reports × three formats) equals the page's value: 100% match.
- **SC-002**: Opening the CSV and Excel files in a spreadsheet, summing the price column gives the sum
  of the page's order totals to the cent, and sorting by date-time sorts chronologically.
- **SC-003**: For an event with 5,000 tickets, each of the three formats is saved within 10 seconds of
  the click on a laptop.
- **SC-004**: An attendee list of 25,000 tickets exports in every format without error.
- **SC-005**: A printed PDF of the sales report with 60 events is readable: no cut-off text, header on
  every page, page numbers.
- **SC-006**: A name on tickets of `=1+1` shows as `=1+1` in CSV and Excel, never `2`.

## Assumptions

- **Recorded deferral** (Constitution VIII): exports are not recorded; the audit log (#51) closes it.
  Until then, only admins can export (FR-013).
- The pages have no filters or searches today; a later feature that adds one makes its export follow
  the screen.
- The made-at time is when the page's data was loaded (FR-003); reloading the page refreshes both.
- The admin's own browser saves the file; nothing is stored on the server.
- English only; dollars only (Constitution: USD).
