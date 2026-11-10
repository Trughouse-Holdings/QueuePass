# Feature Specification: Drop Check-in Details a Week After the Event

**Feature Branch**: `032-drop-check-ins-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#129](https://github.com/Trughouse-Holdings/QueuePass/issues/129) (drop who checked in
one week after the event ends)

**Input**: User description: issue #129. Every ticket keeps, forever, when it was admitted and which
Ticket Booth agent admitted it (spec `017` research R3). Once an event is over that is personal data
with no purpose. A scheduled Backend job, idempotent like the seat hold sweep, clears the check-in
details of every event whose end was 7 or more days ago, cancelled events included; the 7 days are one
named constant; the Admin app's Attendees page, Sales card, and Reports say "Check-in details removed
on …" instead of everyone suddenly reading "not checked in"; attendee exports made after the cutoff
leave the check-in out or mark it removed; if the end time changes, the cutoff follows it. The issue's
comment (jsquyres) settles the counts: **each event keeps how many tickets were used to enter it**, so
its report reads the same on day 8 as on day 1, optionally by tier; and asks the spec to decide whether
the names of the ticket holders who entered are kept. The roadmap number is reserved by this PR's
amendment (Constitution 3.9.4).

## Context

Builds on `005` (orders, tickets, the attendee list, the sales report, cancellation), `017` (gate
check-in: `checkedInAt`, and who admitted it, `checkedInBySub` and `checkedInByUsername`, research R3),
`018` (live entry codes), `023` (attendee and sales exports), `025` (the entry window, from 1 hour
before doors open until the event ends), and, for the Customer app's My tickets, `030` (past orders
under a **Past** heading, no "Show entry code" there).

**Amends spec `030` (merged) for removed events only** (decided by the orchestrating session on Mahdi's
standing approval; research R10): `030` FR-016 keeps a past ticket's state and its printable ticket
under Past; once its event's details are removed a used ticket can no longer truthfully show "Used",
so FR-014 here replaces it ("Event over", no printable ticket). And `030`'s edge case "an event moved
later … brings it back into the lists" no longer applies to a removed event, whose times cannot change
(FR-008). Both are noted in `030`'s spec, pointing here.

Today:

- A ticket admitted at the gate keeps its admission time, the admitting agent's Keycloak subject, and
  that agent's username, for as long as the database exists. Nothing in QueuePass ever reads the agent
  columns back: they are written by the admit and by the demo data, and never shown or returned.
- The admission time is shown in the Admin app (Attendees, per ticket, "✓ checked in …", and per order
  "n of m checked in"), in the attendee export's "Checked in" column, and in the Customer app (My
  tickets, "Used …"). The sales report's per-event and total "Checked in" counts are computed from it
  on every request, so clearing it would change every report.
- Admission is possible only inside the entry window, which closes at the event's end (`025`). A week
  after the end, nothing needs the per-ticket details to admit or refuse anyone.

This feature adds a retention rule for those details: one week after an event ends, a Backend job
removes them from every ticket of that event, after keeping the event's checked-in count, and records
when it did so. The apps show the count as before and say the details were removed.

## Clarifications

### Session 2026-11-09

The issue and its comment settle the job, the 7 days, and that counts are kept. Every question they
leave open below took the recommended answer, written unattended and recorded here as **recommended
answer, open to review**, so Mahdi and the team can overturn it in review of the spec PR.

- Q: Which details are removed? → A: **All three per-ticket check-in details**: when the ticket was
  admitted, the admitting agent's identifier, and the agent's username. A ticket of such an event then
  looks, in its own data, like a ticket nobody used (FR-002; research R1).
- Q: Keep the names of the ticket holders who entered (the comment's two options)? → A: **No: the
  record of which holders entered is dropped with the other details; only the counts are kept** (the
  comment's first option). Keeping "who entered" means keeping a per-ticket record of who walked
  through the door, which is what the issue removes. Buyer names stay on orders as purchase data
  (`Order.holderName`, `017`, for the ID check), as do the orders' tickets, but nothing says any longer
  which of them entered (recommended answer, open to review) (FR-002; research R2).
- Q: What is kept? → A: **One checked-in count per event**, taken the moment its details are removed:
  the number of its valid tickets that had been admitted, the figure the sales report shows today. Not
  per tier: no screen or file shows check-ins per tier today, and adding one is not needed for the
  report to read the same (the comment: "fine to also break down by tier", not required) (recommended
  answer, open to review) (FR-004; research R4).
- Q: When exactly? → A: **From the instant `endsAt` + 7 × 24 hours**, half-open as every QueuePass
  window: at `endsAt` + 7 days − 1 minute the details are kept, at `endsAt` + 7 days they are due. The
  job runs every hour and once when the Backend starts, so they are gone within about an hour of that
  instant while the Backend runs, or at its next start. 7 days is exact hours, not calendar days in the
  venue's zone. It runs only in the Backend serving the API, never in the demo data or demo reset
  commands, which start the Backend's code without serving it (FR-001, FR-006; research R3, R5).
- Q: The constant? → A: **`CHECK_IN_RETENTION_DAYS = 7`**, one constant beside `025`'s entry-window
  constant, read by the Backend's job and by the Admin app's "kept for 7 days after the event" (FR-007;
  research R3).
- Q: Cancelled events? → A: **The same rule, from their `endsAt`.** Their tickets are void, so their
  kept count is 0, as their report shows today (FR-001, FR-005).
- Q: The end time is edited? → A: **Before the cutoff, the cutoff follows it**: moved later, the
  details stay longer; moved earlier, past the cutoff, they go at the next run. **After the details
  were removed, the event's start, end, and doors-open times can no longer change**: such a change is
  refused, naming the date the details were removed. Moving a removed event into the future would put
  tickets that look unused back inside an entry window, and on sale again. This overrides `030`'s "an
  event moved later … brings it back" for removed events. The one way times still move is a venue's
  time-zone change (`020`), which moves only events without orders, so no ticket is affected
  (recommended answer, open to review) (FR-008; research R6).
- Q: Can a removed event's ticket be admitted again? → A: **No.** Its entry window closed a week
  before (`025`), and its times can no longer change (FR-008), so the window cannot reopen. A lookup at
  the gate says the event has ended, as for an unused ticket (`017`'s "already used" is no longer
  known) (Edge Cases; research R6).
- Q: What does the Admin app show? → A: **The kept count where a count is shown, and the sentence
  "Check-in details removed on Nov 10, 2026 (kept for 7 days after the event)."**, the date in the
  venue's time zone: on the Attendees page (under its title; no per-ticket or per-order check-in), on
  the event page's Sales card, and on the Reports page next to that event's count (FR-009 to FR-011;
  research R7).
- Q: Exports? → A: **The attendee export keeps its "Checked in" column, empty for every row, and adds
  the sentence, with the kept count, to its heading lines.** The sales export is unchanged: its figures
  are the kept counts, the same as before the cutoff (recommended answer, open to review) (FR-012,
  FR-013; research R8).
- Q: Does the Customer app change? → A: **Only so it never misleads.** A valid ticket of an event whose
  details were removed reads "Event over" in place of "Used …" or "Valid", with no entry code and no
  printable ticket, so a used ticket never turns back into one that looks usable. This replaces `030`
  FR-016 ("keep its state and its printable ticket") for removed events only. Nothing else changes for
  customers. A live entry key asked for through the API is still handed out (its codes are refused at
  the gate as ended); refusing it would add a refusal to `018`'s contract for no reachable case
  (recommended answer, open to review) (FR-014; research R6, R9).
- Q: The Ticket Booth? → A: **Unchanged.** It offers only events whose entry window has not closed
  (`025`), so it never reaches a removed event (research R6).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check-in Details Disappear a Week After the Event (Priority: P1)

The Fall Concert ended on Monday, November 2 at 10:00 PM. On Monday, November 9 at 10:00 PM, with the
Backend running, the retention job removes from each of its 160 admitted tickets the time it was
admitted and the gate agent who admitted it. Nobody does anything. A query of the Fall Concert's
tickets afterwards finds no admission time and no agent on any of them; the Comedy Night, which ended
on Tuesday, still has all of its own.

**Why this priority**: it is the feature. Personal data with no purpose stops being kept.

**Independent Test**: tickets of an event admitted in its window; move the clock to the event's end
plus 7 days minus 1 minute and run the job: everything kept; move it to the end plus 7 days and run it:
every ticket's three details are empty, and every other event's are as they were.

**Acceptance Scenarios**:

1. **Given** an event with admitted tickets that ended 7 days minus 1 minute ago, **When** the job
   runs, **Then** every ticket keeps its admission time and agent.
2. **Given** the same event at its end plus exactly 7 days, **When** the job runs, **Then** no ticket
   of it has an admission time, an agent identifier, or an agent username.
3. **Given** other events (ended less than 7 days ago, not started, in progress), **When** the job
   runs, **Then** their tickets are unchanged.
4. **Given** the job has run, **When** it runs again, **Then** nothing changes, including the removal
   date and the kept count.
5. **Given** a cancelled event whose end was 7 days ago, **When** the job runs, **Then** its tickets'
   details are removed the same way.
6. **Given** an event due for removal while the Backend was stopped, **When** the Backend starts,
   **Then** the details are removed without waiting an hour.

---

### User Story 2 - The Report Reads the Same on Day 8 (Priority: P1)

Mahdi opens Reports on November 3: the Fall Concert shows 160 checked in. On November 10 he opens it
again: still 160, with "Check-in details removed on Nov 9, 2026 (kept for 7 days after the event)." The
total checked in across events has not moved, and the sales export he downloads says 160 as well.

**Why this priority**: the comment makes the counts a requirement; a report that changes after a week
is wrong.

**Independent Test**: the sales report before and after the job removes an event's details: equal in
every figure; the event's row says when the details were removed.

**Acceptance Scenarios**:

1. **Given** an event's report figures, **When** its details are removed, **Then** its checked-in
   count, every other figure, and the totals are unchanged.
2. **Given** a removed event, **When** its event page's Sales card is opened, **Then** it shows the
   same count and says when the details were removed.
3. **Given** a removed event and one not removed, **When** the sales export is made, **Then** both
   counts are as on the Reports page.
4. **Given** a removed event that is later cancelled, **Then** its checked-in count is 0, as for any
   cancelled event today.

---

### User Story 3 - Admins See Removed, Not "Not Checked In" (Priority: P1)

On November 10 Mahdi opens the Fall Concert's attendees. Under the title: "Check-in details removed on
Nov 9, 2026 (kept for 7 days after the event)." The summary still says 160 checked in. No ticket says
"checked in", and no order says "0 of 4 checked in". The attendee file he downloads has an empty
"Checked in" column and the same sentence, with the count, at the top.

**Why this priority**: without it every attendee would suddenly read as not checked in, which is false.

**Independent Test**: the Attendees page and its export for a removed event show the sentence and the
kept count and no per-ticket check-in; for an event not removed they are as today.

**Acceptance Scenarios**:

1. **Given** a removed event, **When** its Attendees page opens, **Then** it shows the sentence, the
   kept count in its summary, and no per-ticket or per-order check-in state.
2. **Given** that page, **When** the attendee list is downloaded in any format, **Then** its "Checked
   in" column is empty in every row and its heading lines include the sentence and the kept count.
3. **Given** an event not yet removed, **Then** Attendees, the Sales card, Reports, and both exports
   are exactly as today.

---

### User Story 4 - A Removed Event Stays Closed (Priority: P2)

Nate notices a typo in the Fall Concert's end time two weeks after it. He edits the event and changes
only the name: it saves. He changes the end time: it is refused, "The check-in details of Fall Concert
were removed on Nov 9, 2026, so its times can no longer change.", and the form keeps what he typed.

**Why this priority**: a removed event moved into the future would sell tickets and admit tickets that
had already been used.

**Independent Test**: on a removed event, an update that changes start, end, or doors-open is refused
and changes nothing; one that sends the same times, or changes only other fields, succeeds.

**Acceptance Scenarios**:

1. **Given** a removed event, **When** an update changes its start, end, or doors-open time, **Then**
   it is refused with the removal date and nothing changes.
2. **Given** a removed event, **When** an update sends its times unchanged with a new name, **Then** it
   succeeds.
3. **Given** an event not removed whose end is moved later, **When** the job runs at the old cutoff,
   **Then** its details stay until the new one.

---

### Edge Cases

- **An event with no tickets, or none admitted.** It is marked removed with a kept count of 0, like
  any event past its cutoff, so its pages say so uniformly. Spec `029`'s demo **Season Opener** (ended 7
  days before the demo data loads, no tickets) reaches its cutoff on the day the demo data loads, at its
  10:00 PM local end: from then its Admin pages carry the sentence and its times no longer change. The
  demo reset makes it again, not removed.
- **Spec `029`'s demo check-ins.** The demo's admitted tickets are on Fall Concert, 14 days ahead, and
  those admitted while demoing Demo Tonight; both are removed only 7 days after those events end. A
  demo state is never changed by this feature on the day it loads, apart from Season Opener above.
- **A ticket of a removed event at the gate.** The Ticket Booth never offers the event. A lookup
  through the API with that event as the gate says the event has ended, for used and unused tickets
  alike (`017`'s "already used" can no longer be told).
- **A live entry key** (`018`) for a valid ticket of a removed event is still handed out to its owner
  when asked through the API (it was refused as used before); its codes are refused at the gate as the
  event has ended. The Customer app offers no link to it (FR-014, and `030`).
- **The Backend down at the cutoff.** The removal happens at its next start.
- **Two Backends, or two runs at once.** Each event is removed under its event lock, and a run checks
  again under the lock that it is still due and not yet removed, so an event is removed once; the
  second run changes nothing.
- **The clock moves back** (a corrected system clock). A removal already made stays; nothing restores
  details.
- **Spec `028`'s realm move.** Admitting agents' identifiers written before `028` belong to the retired
  shared realm. They are never read; this feature removes them with the rest at each event's cutoff.
- **A failing run** (the database unreachable, a lock timeout on one event). It is logged; other events
  are still processed; the next run tries again. It never stops the Backend.

## Requirements *(mandatory)*

### Functional Requirements

**Removal**

- **FR-001**: For every event, scheduled or cancelled, whose end plus the retention period
  (`CHECK_IN_RETENTION_DAYS`, 7 days of 24 hours) is at or before the current time, the Backend MUST
  remove its tickets' check-in details, without any person acting.
- **FR-002**: Removing MUST empty, on every ticket of the event, the admission time, the admitting
  agent's identifier, and the agent's username, together. Nothing else on the ticket or its order
  changes; no ticket or order is deleted.
- **FR-003**: Removing MUST NOT happen for an event before its cutoff (at `endsAt` + 7 days − 1 minute
  everything is kept), and MUST NOT touch any other event's tickets.
- **FR-004**: In the same step, all or nothing, the event MUST record the instant of removal and its
  kept checked-in count: the number of its valid tickets that had an admission time.
- **FR-005**: Removing MUST be idempotent: an event already removed is never removed again, and its
  removal instant and kept count never change.
- **FR-006**: The removal MUST run when the Backend starts serving the API and then every hour while
  it runs. A run that fails for one event MUST go on with the others, log the failure, and never stop
  the Backend. The demo data and demo reset commands (`005`, `029`) MUST NOT run it.
- **FR-007**: The retention period MUST be one named constant, shared by the Backend and the Admin
  app.
- **FR-008**: Once an event's details have been removed, a change to its start, end, or doors-open
  time MUST be refused, naming the removal date, and change nothing. Sending a time equal to the
  stored one is not a change. Before removal, editing an event's times is as today, and the cutoff
  follows its end. This overrides, for removed events, `030`'s edge case of an event moved later coming
  back into the lists. A venue's time-zone change (`020`) still moves the local-time-preserved instants
  of its events without orders, removed ones included; they have no tickets, so nothing is affected.

**Admin app**

- **FR-009**: For a removed event, the sales report MUST give its kept count as its checked-in figure
  (0 once it is cancelled, as for every cancelled event), and the totals MUST include it, so every
  figure is the same as before removal. Each event in the report MUST say when its details were
  removed, or that they were not.
- **FR-010**: The Attendees page of a removed event MUST show, under its title, "Check-in details
  removed on ⟨date⟩ (kept for 7 days after the event).", the date in the venue's time zone; its summary
  MUST give the kept count as checked in; and it MUST show no check-in state per ticket or per order.
- **FR-011**: The event page's Sales card and the Reports page MUST show a removed event's kept count
  as today's count, with the same sentence (on Reports, beside that event's count).
- **FR-012**: The attendee export (CSV, XLSX, PDF) of a removed event MUST keep its "Checked in" column,
  empty in every row, and add the sentence and the kept count to its heading lines.
- **FR-013**: The sales export MUST be unchanged in shape; its checked-in figures are the report's.

**Customer app**

- **FR-014**: On My tickets, a valid ticket of a removed event MUST read "Event over", with no entry
  code link and no printable ticket; the printable ticket page MUST refuse it as it refuses a used one.
  Void tickets read "Void" as today. For removed events this replaces `030` FR-016's "keep its state
  and its printable ticket"; before removal `030` FR-016 holds unchanged.

**Data guarantees**

- **FR-015**: The database MUST guarantee that an event's removal instant and kept count are both set
  or both empty, the count never negative, and (as today) that a ticket's agent details never exist
  without its admission time.

### Key Entities

- **Check-in details**: per ticket, when it was admitted and which agent admitted it (identifier and
  username). Removed at the cutoff.
- **Cutoff**: an event's `endsAt` + `CHECK_IN_RETENTION_DAYS` (7 × 24 hours).
- **Removal record**: per event, when its details were removed and its kept checked-in count.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At an event's cutoff minus 1 minute, 100% of its tickets' check-in details are present;
  after a run at the cutoff, 0% are, and every other event's are unchanged.
- **SC-002**: With the Backend running, an event's details are removed no later than 1 hour (plus one
  run's duration) after its cutoff.
- **SC-003**: A second run changes no row.
- **SC-004**: The sales report, field by field, is identical before and after an event's removal
  (apart from its generated time and the event's removal date).
- **SC-005**: For a removed event, Attendees, the Sales card, Reports, and the attendee export each
  show the removal sentence, and none shows any ticket as checked in or not checked in.
- **SC-006**: A change to a removed event's times through the event's update is refused in 100% of
  tries and changes nothing.
- **SC-007**: Loading the demo data or resetting the demo never removes any check-in details, even
  with events past their cutoff in the database.

## Assumptions

- **No other per-attendee data.** The issue covers check-in only. Names on orders, customers'
  usernames, and seats stay as they are (Out of scope).
- **Exact hours.** "One week after the event ends" is 7 × 24 hours from `endsAt`, in UTC, as every
  QueuePass instant; a daylight-saving change in that week shifts the local hour of the cutoff by one,
  which no one sees, since the job runs hourly.
- **Hourly is enough.** "Hourly or daily" in the issue; hourly keeps the lag under an hour (SC-002) at
  the cost of one small indexed query an hour.
- **One Backend.** The proof of concept runs one Backend; FR-005's event lock and re-check make a second
  one harmless anyway.
- **Reading the date.** "Removed on" is a date in the venue's zone, as other event dates are (`020`);
  "kept for 7 days" is read from the constant.

## Out of scope

- Removing or shortening other per-attendee data: names on orders, usernames, seats, orders, tickets.
- Check-in counts per tier (the comment makes them optional; no screen shows them today).
- A setting to change the retention period at run time (it is a constant; Principle VIII).
- Restoring removed details, or a manual "remove now" control.
- Changing the Ticket Booth app, the entry window, or live codes (`017`, `018`, `025`).
