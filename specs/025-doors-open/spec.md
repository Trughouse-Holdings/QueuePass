# Feature Specification: Doors Open

**Feature Branch**: `025-doors-open-spec`

**Created**: 2026-11-02

**Status**: Draft

**Issue**: [#91](https://github.com/Trughouse-Holdings/QueuePass/issues/91) (doors-open time on
events; Ticket Booth access opens an hour before doors). Takes over the doors-open item of
[#49](https://github.com/Trughouse-Holdings/QueuePass/issues/49), which keeps its other items (a
description, an age restriction, a category).

**Input**: User description: "025" (the roadmap entry reserved for #91 in Constitution 3.6.2). From
Mahdi's testing of the apps together: an event has no doors-open time and admins can't set one; a
gate agent can choose any event that isn't cancelled and hasn't ended, days or weeks ahead; check-in
opens 2 hours before the start, a stand-in until events had a doors-open time. Every event gets a
doors-open time, set by admins in the venue's time zone, no more than 6 hours before the start and
not after it; the Ticket Booth works an event only from 1 hour before its doors open until it ends;
customers and the Admin app show the doors-open time with the event.

## Context

Builds on `017` (gate check-in: the Ticket Booth app's choice of event, FR-007, and the entry
window, FR-019, "2 hours before the start until the end", whose assumption already said "A
doors-open time on events (#49) can narrow it later"), `018` (live QR codes, accepted only inside
the same entry window), and `020` (every event time is entered and shown in its venue's time zone
with the zone's abbreviation; the offset sent must be the venue's; a local time skipped by a
daylight-saving change is refused, and a repeated one is chosen by its offset; when a venue's zone
changes, its events keep their local times).

Today:

- An event has a name, a start, an end, and a venue, but no time its doors open. Customers can't
  see when to arrive, and admins have nowhere to say it.
- In the Ticket Booth app a gate agent can choose any scheduled event that has not ended, days or
  weeks before it, and then sees every ticket refused as "not open yet".
- Check-in opens 2 hours before every event's start, whatever the venue does.

This feature gives every event a **doors-open time**, which admins set (1 hour before the start
unless they change it), and makes one entry rule from it: tickets, by any code, are admitted from
**1 hour before doors open until the event ends**. The Ticket Booth app lists events that are not
open yet greyed out, with when they open, so agents can see what is coming but work only what is
open. Customers and admins see the doors-open time with the event.

It changes `017`'s entry window and the Booth's choice of event, and so the window `018`'s live codes
are checked in; it does not rewrite those specs. Requirements this spec supersedes are listed under
**Superseded requirements**; `017`'s and `018`'s spec files get a one-line note at the top pointing
here (research R13). Constitution 3.6.2 reserves the number; no principle changes.

## Clarifications

### Session 2026-11-02

Mahdi took the decisions marked "decided by Mahdi". Every other question below took the
recommended answer, written unattended and recorded here as **recommended answer, open to review**,
so the team can overturn it in review of the spec PR.

- Q: Does every event have a doors-open time, and who sets it? → A: **Yes, every event; admins set
  it** when creating or editing the event, entered and shown in the venue's time zone with the zone's
  abbreviation, under `020`'s rules: the offset must be the venue's at that time, a skipped local
  time is refused, and a repeated one is chosen by its offset (decided by Mahdi, 1).
- Q: Required, or optional with a default? → A: **Required.** The Admin form fills it in with the
  start time minus 1 hour, and the admin may change it (decided by Mahdi, 2).
- Q: What range is allowed? → A: **No more than 6 hours before the start, and not after the
  start**; doors at the start time itself are allowed. Anything else is refused by the Backend with a
  clear message, checked in the form too, and guaranteed by the database (decided by Mahdi, 3;
  Constitution IV) (FR-004, FR-005).
- Q: What do existing events get? → A: **The start time minus 1 hour**, so their check-in window
  stays exactly what it is today, 2 hours before the start (decided by Mahdi, 4) (FR-024).
- Q: Does the check-in window become "1 hour before doors open until the end", replacing the 2-hour
  rule? → A: **Yes, one rule everywhere**: typed codes, printed QR codes, and `018`'s live codes.
  Before it the Backend refuses with "not open yet" and when it opens (decided by Mahdi, 5)
  (FR-011 to FR-013).
- Q: Does the Booth hide events that are not open yet, or show them? → A: **Listed but not
  choosable**: greyed out, with when they open in the venue's zone ("Opens 6:00 PM EDT"). An event
  already chosen whose window has not opened, such as one remembered from earlier in the tab, cannot
  be worked. The Backend is the authority; the Booth's list is a convenience (decided by Mahdi, 6)
  (FR-014 to FR-018).
- Q: Where is the doors-open time shown? → A: **With the event, in the Customer app and the Admin
  app** (decided by Mahdi, 7). Recommended answer, open to review, for exactly where: in the Customer
  app on event cards, the event page, My tickets, and the printed ticket; in the Admin app on the
  event page and in the event form. Not in the Admin event list, the reports, or the exports
  (FR-019 to FR-021).
- Q: Does this replace the doors-open item of #49? → A: **Yes**; #49 keeps its other items
  (decided by Mahdi, 8).
- Q: Do the doors-open time and the hour before it count toward the venue's 60-minute rule
  (`002`)? → A: **No** (recommended answer, open to review). Scheduling stays on the start and end
  only. A 6-hour doors-open allowance would otherwise block a venue for an afternoon before every
  evening event, and the 60-minute buffer already stands for set-up. The consequence: one event's
  doors, and its check-in window, may open while the venue's previous event is still on; a venue
  that cannot do that sets its doors later (FR-006; research R3).
- Q: When an admin moves the start in an edit, what happens to doors-open? → A: **It keeps the
  same time before the start** (recommended answer, open to review). In the form, the doors-open
  field follows the start, keeping its gap, until the admin changes the doors-open field themselves;
  the admin sees the new value before saving. In the API, an edit that sends a new start without a
  doors-open time moves doors-open by the same amount, so it is never pushed out of range; an edit
  that sends a doors-open time has it checked against the start in force after the edit (FR-007,
  FR-008; research R4).
- Q: When a venue's time zone changes (`020` FR-009), what happens to doors-open? → A: **It keeps
  its local time, like the start and end** (recommended answer, open to review). A doors-open local
  time that is skipped or repeated in the new zone refuses the change, as for a start or end, and so
  does one that would then fall out of range because a daylight-saving change sits between doors and
  start in only one of the zones (FR-009; research R5).
- Q: And when an event moves to a venue in another zone (`020` FR-019: the start and end must be
  sent)? → A: **Doors-open is not required in that request**; left out, it keeps its gap to the new
  start (recommended answer, open to review) (FR-008).
- Q: Cancelled events, and events already under way? → A: **No special rule** (recommended answer,
  open to review). A cancelled event keeps its doors-open time on record and shows it, cannot be
  edited (as today), and is never offered at the Booth (as today). An event under way, or already
  over, can still be edited within the range; a doors-open time in the past is allowed. Moving
  doors-open later can close an open check-in window again; entries already recorded stay
  (Edge Cases).
- Q: What does the API look like? → A: (recommended answer, open to review; plan research R6)
  every event carries `doorsOpenAt` (stored) and `entryOpensAt` (1 hour before `doorsOpenAt`,
  worked out by the Backend), and My tickets' event carries `doorsOpenAt`. On create and update,
  `doorsOpenAt` is optional in the API: the Admin app always sends it on create; another caller that
  leaves it out (the demo-data script, the browser tests' set-up) gets the start minus 1 hour. An
  out-of-range time is refused with a new code, `DOORS_OPEN_OUT_OF_RANGE`. The doors-open time is
  still required in the sense that matters: every stored event has one (FR-001, FR-010).
- Q: How does the Booth know when an event's window opens? → A: **From the events list**, which
  now carries each event's `entryOpensAt`, so the rule "1 hour before doors open" lives only in the
  Backend (recommended answer, open to review). The Booth compares it with the device's clock to grey
  events out, and refreshes the list and checks again every 30 seconds, so an event becomes
  choosable when its window opens, or when an admin moves its doors earlier, without reloading; the
  Backend's clock decides every lookup and admit (FR-015, FR-016; research R8).
- Q: Do the demo data, the seed, `019`'s calendar, `023`'s exports, and `022`'s browser tests need
  changes? → A: (recommended answer, open to review) **Demo data and seed: no.** Demo events are
  created through the Backend, so they get start minus 1 hour, and "Demo Tonight" (starts 1 hour after
  loading) is open for entry at once, as `017` FR-006 requires. **Calendar and exports: unchanged**;
  the calendar entry stays start to end. **Browser tests**: `017 S3` still passes unchanged (its
  event starts in 1 hour, so doors open now and check-in opened an hour ago); only its comment
  changes. One new browser test covers this feature's main journey (research R10, R11).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Admin Sets When Doors Open (Priority: P1)

An admin schedules "Fall Concert" at Freedom Hall (Eastern Time) from 7:00 PM to 10:00 PM on Nov 20.
As they type the start, the **Doors open** field fills in 6:00 PM, in the venue's zone, with the
same zone line as the other times. The venue opens doors at 5:30 PM for this show, so they change it
to 5:30 PM and save. The event page says "Doors open 5:30 PM EST". Later they move the start to 8:00
PM; the doors-open field moves to 6:30 PM as they type, and they save. They try doors at 12:30 PM:
the form says doors must open no more than 6 hours before the start, from 2:00 PM, and sends nothing.

**Why this priority**: the issue's first requirement; every other story reads this time.

**Independent Test**: create an event at a venue with the default doors-open time, then with 5:30
PM; edit its start and see doors-open follow; try 12:30 PM and 8:30 PM (after the start) and see
both refused in the form and, sent directly, by the Backend.

**Acceptance Scenarios**:

1. **Given** the New event form with a venue chosen, **When** the admin enters a start of Nov 20,
   7:00 PM, **Then** the Doors open field shows Nov 20, 6:00 PM, in the venue's local time.
2. **Given** that form, **When** the admin changes Doors open to 5:30 PM and saves, **Then** the
   event is saved with doors at 5:30 PM local time, and its page shows "Doors open" "5:30 PM EST".
3. **Given** an event with doors 1 hour 30 minutes before its 7:00 PM start, **When** the admin
   edits the start to 8:00 PM without touching Doors open, **Then** Doors open shows 6:30 PM before
   saving, and the saved event has doors at 6:30 PM.
4. **Given** the admin has changed Doors open themselves, **When** they then change the start,
   **Then** Doors open keeps what they typed.
5. **Given** a start of 7:00 PM, **When** the admin enters doors at 12:59 PM, or at 7:01 PM,
   **Then** the form names the problem next to the field and sends nothing; at 1:00 PM or at 7:00 PM
   it saves.
6. **Given** a direct API request with doors more than 6 hours before the start or after it,
   **Then** the Backend refuses it with a clear message naming the allowed range in the venue's local
   time, and nothing is saved.
7. **Given** a venue in Eastern Time and a doors-open local time skipped by the spring-forward
   change, or one that happens twice in the fall-back change, **Then** the form and the Backend treat
   it exactly as `020` treats a start or end (refused; or the admin chooses which one).
8. **Given** an event created through the API without a doors-open time (by the demo data or a
   test), **Then** it is saved with doors 1 hour before the start.

---

### User Story 2 - Check-In Opens 1 Hour Before Doors (Priority: P1)

The 7:00 PM concert has doors at 5:30 PM, so check-in opens at 4:30 PM. At 4:20 PM a gate agent
types a ticket's code: it is refused as not open yet, "Entry opens at 4:30 PM EST". At 4:31 PM the
same code can be admitted. A customer showing a live QR code (`018`) at 4:20 PM gets the same answer.

**Why this priority**: the issue's rule for entry, enforced where it cannot be bypassed.

**Independent Test**: with events whose doors are 1 hour, 3 hours, and 0 minutes before their start,
look up and admit tickets just before and just after 1 hour before doors open, by typed code and by
live code, and before and after the end.

**Acceptance Scenarios**:

1. **Given** an event whose doors open at 5:30 PM, **When** a ticket of it is looked up or admitted
   at 4:29 PM, **Then** it is refused as not open yet, with the time entry opens (4:30 PM), and
   nothing is recorded.
2. **Given** the same event, **When** it is looked up at 4:30 PM or later and before the end,
   **Then** it can be admitted (unless used, void, or for another event, as today).
3. **Given** an event whose doors open at its start (7:00 PM), **Then** check-in opens at 6:00 PM;
   **Given** doors 6 hours before a 7:00 PM start, **Then** check-in opens at noon.
4. **Given** a live code (`018`), a printed QR code, or a typed code for the same ticket, **Then**
   all three get the same answer at the same moment.
5. **Given** an event created before this feature, **Then** its check-in still opens 2 hours before
   its start.
6. **Given** an admin moves an event's doors-open time while gates are working it, **Then** the next
   lookup and admit use the new time.

---

### User Story 3 - The Ticket Booth Lists What Is Coming, and Works What Is Open (Priority: P1)

At 3:00 PM a gate agent signs in to the Ticket Booth app. The list shows the 7:00 PM concert greyed
out, "Opens 4:30 PM EST", and tomorrow's matinee greyed out with its date. Neither can be chosen. At
4:30 PM, without reloading, the concert becomes choosable and the agent starts checking tickets in.

**Why this priority**: Mahdi's finding; agents working an event that cannot be checked in yet see
nothing but refusals.

**Independent Test**: with one event open for entry and one not, sign in to the Booth: the open one
can be chosen; the other is shown greyed with when it opens and cannot be chosen; wait until it opens
and choose it without reloading.

**Acceptance Scenarios**:

1. **Given** scheduled events that have not ended, **When** the agent opens the Booth, **Then** each
   is listed, soonest start first; those whose check-in window is open can be chosen, and the others
   are shown as not open, with "Opens" and when, in the event's venue zone (the time alone when it is
   today there, with its date otherwise), and cannot be chosen by pointer, keyboard, or touch.
2. **Given** a not-open event, **When** its window opens while the list is on screen, **Then**
   within 30 seconds it can be chosen, without a reload.
3. **Given** an event chosen earlier in this tab whose window has not opened (for example, its doors
   were moved later since), **When** the Booth loads, **Then** that choice is not restored and the
   list is shown, with the event greyed.
4. **Given** the agent is working an event, **When** the Backend refuses a ticket as not open yet
   (its doors were moved later meanwhile), **Then** the refusal says when entry opens, as today.
5. **Given** a cancelled event or one that has ended, **Then** it is not listed, as today.
6. **Given** no event has an open window, **Then** the list says no event is open for entry yet,
   and still shows the greyed ones.

---

### User Story 4 - Customers and Admins See When Doors Open (Priority: P2)

A customer looking at the concert's card sees "Doors open 5:30 PM EST" under its start. On My
tickets and on the printed ticket the doors-open time is next to the start, so they know when to
arrive.

**Why this priority**: the issue's last requirement; useful, but nothing breaks without it.

**Independent Test**: open an event with doors at 5:30 PM in each place listed and read the time.

**Acceptance Scenarios**:

1. **Given** an event, **When** a customer views its card, its page, its order on My tickets, or
   its printed ticket, **Then** the doors-open time is shown next to the start, in the venue's zone
   with its abbreviation: the time alone when it is on the start's local date ("5:30 PM EST"), with
   its date otherwise ("Nov 19, 2026, 11:30 PM EST").
2. **Given** an event, **When** an admin views its page, **Then** the doors-open time is shown the
   same way next to the start.
3. **Given** a cancelled event, **Then** its doors-open time is still shown where its start is.

---

### Edge Cases

- **Doors open while the venue's previous event is on**: allowed (Clarifications). Events at 1:00
  to 4:00 PM and 5:00 to 8:00 PM at one venue may have the second event's doors at 3:00 PM and its
  check-in from 2:00 PM. The 60-minute rule is unchanged.
- **Doors at the start**: allowed; check-in opens 1 hour before the start.
- **Doors exactly 6 hours before the start**: allowed; 1 minute more is refused. Measured in real
  elapsed time, so across a daylight-saving change the local clock difference may read 5 or 7
  hours.
- **The admin clears the Doors open field**: the form names it as missing ("Enter when doors open.")
  and sends nothing.
- **The start is a repeated local time not yet chosen, or a skipped one**: the doors-open field does
  not follow it until the start names one moment (`020` FR-016, FR-017).
- **An edit that sends only a doors-open time**: checked against the stored start.
- **An edit that sends a new start and an end only**: doors-open keeps its gap to the start (FR-008).
- **Moving doors-open later while the window is open**: the window may close again. Tickets already
  admitted stay admitted; the next lookup is refused as not open yet, with the new time.
- **An event whose window has opened but whose doors time is in the past**: nothing special; the
  window lasts until the end.
- **The Booth device's clock is wrong**: the list may offer an event a little early or late; the
  Backend, on the database's clock, still refuses a ticket outside the window (FR-013, FR-016).
- **A remembered choice that is no longer open, after an admin moved doors later**: not restored
  (US3 scenario 3). A choice made while open stays chosen if doors move later; lookups are then
  refused with when entry opens (US3 scenario 4).
- **A venue zone change with events**: each event's doors keep their local time, as the start and
  end do; a skipped or repeated doors local time, or one that would fall out of range, refuses the
  change with nothing saved (FR-009).
- **Cancelled events**: keep their doors-open time; not listed at the Booth; read-only (as today).
- **An event whose start is less than 1 hour away when created**: the default doors time is already
  past; it is allowed, and check-in is open at once.
- **Ticket for another event**: `017`'s order of reasons is unchanged; "another event" comes before
  "not open yet".

## Requirements *(mandatory)*

### Functional Requirements

**The doors-open time (US1)**

- **FR-001**: Every event MUST have exactly one doors-open time, an instant like its start and end.
- **FR-002**: The Admin event form MUST have a required **Doors open** date-and-time field, read
  and shown in the venue's local time like the start and end (`020` FR-014 to FR-017). On a new
  event it MUST be empty until a start is entered and then show the start minus 1 hour; on an edit
  it MUST show the stored time.
- **FR-003**: While the admin has not changed the Doors open field themselves in this form, a
  change to the start MUST move it by the same amount, keeping its gap to the start (on a new event,
  1 hour). Once the admin changes it, it MUST keep what they typed. It follows only a start that names
  one moment.
- **FR-004**: A doors-open time MUST be no earlier than 6 hours before the event's start and no
  later than the start (both ends allowed), measured in elapsed time.
- **FR-005**: The Backend MUST refuse a create or update that would break FR-004 with a clear
  message naming the allowed range in the venue's local time, and save nothing; the database MUST
  also refuse any stored event that breaks it (Constitution IV). The Admin form MUST check FR-004
  before sending and show the same message next to the field, keeping every value.
- **FR-006**: The doors-open time MUST NOT take part in the venue's 60-minute scheduling rule
  (`002`); the rule stays on the start and end.
- **FR-007**: A doors-open time sent to the Backend MUST state the venue's local time with the
  venue's offset, under `020` FR-018's rules (skipped refused; repeated chosen by the offset).
- **FR-008**: A create that sends no doors-open time MUST store the start minus 1 hour. An update
  that changes the start and sends no doors-open time MUST move doors-open by the same amount
  (including a move to another venue). An update that sends a doors-open time MUST check it against
  the start in force after the update.
- **FR-009**: When a venue's zone changes (`020` FR-009 to FR-013), each event's doors-open time
  MUST keep its local date and time, like its start and end. The change MUST be refused, with
  nothing saved, when an event's doors-open local time is skipped or repeated in the new zone, or
  when the moved doors-open time would break FR-004; the refusal names the event and says it is the
  doors-open time.
- **FR-010**: Every event the Backend returns MUST carry its doors-open time and when its check-in
  window opens, and every order on My tickets MUST carry its event's doors-open time.

**The check-in window (US2)**

- **FR-011**: A ticket MUST be admittable only from 1 hour before its event's doors-open time until
  its event's end (`[doors open - 1 hour, end)`), replacing `017` FR-019's 2 hours before the start.
- **FR-012**: FR-011 MUST apply to every way a ticket is presented: typed code, printed QR code, and
  live code (`018`). Outside it, the lookup and the admit MUST say "not open yet" with when entry
  opens, or that the event has ended, as `017` FR-011 does today.
- **FR-013**: The window MUST be decided by the Backend on one clock for every gate, and the admit
  MUST never record an entry outside it, including when the doors-open time changes at the same
  moment (Constitution IV).

**The Ticket Booth list (US3)**

- **FR-014**: The Ticket Booth app MUST list every scheduled event that has not ended, soonest start
  first, as today, and MUST let the agent choose only those whose check-in window has opened.
- **FR-015**: Each event not open yet MUST be shown as not available, by more than color alone
  (`017` FR-023), with "Opens" and when its window opens, in its venue's local time with the zone's
  abbreviation: the time alone when that is today in the venue's zone ("Opens 4:30 PM EST"), with
  the date otherwise ("Opens Nov 21, 2026, 11:00 AM EST").
  It MUST NOT be choosable by pointer, keyboard, or touch, and assistive technology MUST hear that
  it is not available and when it opens.
- **FR-016**: The Booth MUST take when each window opens from the Backend, not work it out, and,
  while the list is shown, MUST refresh it from the Backend and re-check it against the time at least
  every 30 seconds, so an event becomes choosable without a reload, also after an admin moves its
  doors-open time.
- **FR-017**: A choice remembered in the tab (`017` FR-007) MUST be restored only when that event's
  window is open; otherwise the list is shown.
- **FR-018**: When no listed event is open, the Booth MUST say so ("No event is open for entry yet.")
  above the greyed list; when none is listed, as today ("No event is open for entry.").

**Shown with the event (US4)**

- **FR-019**: The Customer app MUST show the doors-open time next to the start on event cards, the
  event page, each order on My tickets, and the printed ticket (`017` FR-012).
- **FR-020**: The Admin app MUST show the doors-open time next to the start on the event page.
- **FR-021**: Every doors-open time shown MUST be in the venue's zone with its abbreviation
  (`020` FR-021), as the time alone when it falls on the start's local date and with its date
  otherwise, labelled "Doors open".

**Unchanged**

- **FR-022**: The 60-minute rule, `017`'s order of refusal reasons, the once-only admit, `018`'s
  live-code window and grace, `019`'s calendar entry (start to end), `023`'s exports, the Admin
  reports, and the Admin event list MUST be unchanged.
- **FR-023**: A cancelled event MUST keep its doors-open time and show it where its start is shown.

**Existing events**

- **FR-024**: Every event that exists before this feature, scheduled or cancelled, MUST get a
  doors-open time of its start minus 1 hour, so its check-in window is unchanged.

### Superseded requirements

This spec changes these requirements of earlier specs; the earlier text stays as their record.

| Spec | Requirement | Now |
| --- | --- | --- |
| `017` | FR-019 (admittable from 2 hours before the start until the end) | From 1 hour before doors open until the end (FR-011, FR-012) |
| `017` | FR-007 (the agent chooses from events not cancelled and not ended) | Those are listed; only those whose window has opened can be chosen (FR-014 to FR-018) |
| `017` | FR-011 ("outside the entry window (FR-019, …)") | The window of FR-011 here |
| `017` | Assumption "Entry window" (2 hours before the start; "A doors-open time on events (#49) can narrow it later") | This feature (FR-011) |
| `017` | Research R5 (`[startsAt - 2 hours, endsAt)`), R11 item 1 (the list of events), data-model `NOT_OPEN` row | Research R7, R8 here |
| `018` | FR-005, FR-011's refusal list, the Clarification and Assumption on when a live code can be shown, and the Edge Case "Outside the entry window" (each names `017`'s window, FR-019 there) | The same check, now with this spec's window (FR-012); a live code can still be shown at any time |

### Key Entities

- **Event**: gains its **doors-open time** (an instant, shown in the venue's zone), always between
  6 hours before its start and its start, and, worked out from it, **when check-in opens** (1 hour
  before doors open).
- **Check-in window**: `[doors open - 1 hour, end)`, on the Backend's clock.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of events, old and new, have a doors-open time from 6 hours before their start
  to their start; a create or update that would break that is refused in 100% of attempts, by the
  Backend and by the database.
- **SC-002**: A new event's doors-open time is filled in as the start minus 1 hour with no extra
  step; changing it takes one field.
- **SC-003**: For every event, a lookup or admit 30 seconds before 1 hour before doors open is
  refused as not open yet with when it opens, and one 30 seconds after is not refused for the
  window, by typed and by live code alike.
- **SC-004**: Every event that existed before this feature has the same check-in opening time after
  it as before (2 hours before its start).
- **SC-005**: In the Booth, 0 not-open events can be chosen, and a not-open event becomes choosable
  within 30 seconds of its window opening without a reload.
- **SC-006**: The doors-open time is shown in all 5 places of FR-019 and FR-020, in the venue's
  zone with its abbreviation.
- **SC-007**: Every Backend test of `002`'s scheduling rule, `017`'s and `018`'s refusals other than
  the window, `019`, and `023` passes unchanged.

## Assumptions

- "1 hour before doors open" and "6 hours before the start" are fixed rules, not settings
  (Constitution VIII); a venue that needs a different check-in lead time sets doors accordingly.
- The 6-hour and 1-hour lengths are elapsed time, like every length of time in `020` FR-025.
- Only the Admin app sets doors-open times on purpose; the demo-data script and the browser tests'
  set-up create events through the API and take the default (research R6, R11).
- The Booth's list uses the device's clock only to grey events out; a device clock a few minutes off
  can offer an event a little early or late, never admit outside the window (FR-013).
- English only; US venues only, as `020`.
- No deferral of a security or correctness control: the window and the range are enforced by the
  Backend and guaranteed by the database (research R2, R7).
