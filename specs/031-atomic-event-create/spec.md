# Feature Specification: All-or-Nothing Event Scheduling

**Feature Branch**: `031-atomic-event-create-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#127](https://github.com/Trughouse-Holdings/QueuePass/issues/127) (scheduling an event
shows an error but still creates the event: create isn't all-or-nothing)

**Input**: User description: issue #127, also on Nate's list for the week of Nov 8: "resolve the bug
where failed UI validations write partial event records to the database". Scheduling an event in
the Admin app is all or nothing for the event, its ticket types, and its seating: if any part is
refused, nothing is saved, and the form keeps what the admin entered and shows the error so they can
fix it and resubmit. The likely approach is for the Backend to take the ticket types and the seating
in the scheduling request and save everything in one transaction, a contract change. Pictures stay
as they are. If partial creation stays anywhere, the message says plainly that the event was created
and links to it. Done when Backend tests show a refused create leaves no event, ticket type, or
seating rows, an Admin app test shows a refused ticket type keeps the form filled and creates no
event, and a browser test walks the same. The roadmap number is reserved by this PR's amendment
(Constitution 3.9.3).

## Context

Builds on `002` (events and the 60-minute rule; FR-030, the form keeps the admin's values when a
save is refused, which the form's code cites as FR-035), `004` (ticket types, called tiers in the
API: a name unique within the event, a price, a quantity, together within the event's capacity),
`007` (reserved seating: a venue's sections, each mapped to one ticket type of the event, the type's
amount following its sections' seats, the event's capacity the layout's total), `008` (US6, US7: the
Schedule event form sets up ticket types and seating; research R10), `014` (pictures uploaded after
the event exists; FR-018), `016` (tickets per customer), `020` and `025` (event times and doors).

Today the Schedule event form (`008` FR-018, research R10) sends, in order:

1. a request that creates the event, which is saved at once;
2. at a venue with a layout and reserved seating chosen, a request that turns reserved seating on;
3. one request per ticket type;
4. with reserved seating, a request that maps each section to its ticket type.

If any request after the first is refused (a ticket type named like another, ticket types over the
event's capacity, a seating refusal, a dropped connection), the form says "Seating setup not
finished" and links to the event, which already exists without some of its ticket types or seating.
The admin reads it as a failed save. Scheduling again creates a second event, or is refused as a
scheduling conflict with the first one. Customers can see the half-made event in the meantime.

This feature makes scheduling one step: the event, its ticket types, and its seating are saved
together or not at all, and a refusal points at the field at fault.

## Clarifications

### Session 2026-11-09

The issue settles what scheduling must do. Every question it leaves open below took the recommended
answer, written unattended and recorded here as **recommended answer, open to review**, so Mahdi and
the team can overturn it in review of the spec PR.

- Q: A new operation, or the existing scheduling request? → A: **The existing scheduling request
  takes the ticket types and the seating as optional parts** (the issue's suggestion). A request
  without them is answered exactly as today, so every existing caller (the demo data, the browser
  test helpers) is unaffected. A new operation would duplicate every event rule and leave two ways to
  schedule (recommended answer, open to review) (FR-001, FR-002; research R1).
- Q: How does a request say which section sells which ticket type, before the types exist? → A:
  **Each ticket type lists the sections it sells.** No identifiers are needed for things not yet
  made, and a section listed under two types is a refusal the request can name (recommended answer,
  open to review) (FR-003; research R2).
- Q: How does a refusal reach the right field? → A: **Every refusal about one ticket type names it
  by its position in the request and the field at fault** (its name, price, quantity, or sections),
  in a machine-readable form the contract states; a refusal about the ticket types together (over
  capacity) or about seating as a whole names that group. The form shows the message beside that
  ticket type or group, and in its error banner as today (recommended answer, open to review)
  (FR-006, FR-010; research R3).
- Q: Which problem is reported first when there are several? → A: **Malformed fields all at once;
  otherwise the first rule broken, in a fixed order**: the event's own checks as today (venue,
  times, capacity, tickets per customer, scheduling conflict), then seating, then the ticket types
  in the order sent. One refusal per attempt is how every other save works today (recommended answer,
  open to review) (FR-005; research R4).
- Q: Is editing in scope? → A: **No.** Saving an edit has the same weakness (the details are saved,
  then each ticket type and the seating separately, so a refused ticket type leaves the details
  changed, and saving again can be refused for a ticket type it already added), but the issue is
  about scheduling, and editing must also handle sold tickets, removed types, and switching seating,
  which make it a larger contract change. Issue #134 (the event form rework, not yet specced) already
  asks for saving to create **or update** the whole event or nothing; this spec records the gap for
  it (recommended answer, open to review) (Out of scope; research R7).
- Q: Pictures? → A: **Unchanged** (the issue). They upload after the event exists; when one is
  refused, the form says "Event created. These pictures were not added: …" and becomes the new
  event's edit form, as `014` FR-018 says. That message already says plainly that the event was
  created, and the form it opens is that event's, so it meets the issue's last bullet (FR-012;
  research R8).
- Q: What if the connection drops while scheduling? → A: **The form cannot know whether the event was
  saved**, so it says exactly that, keeps every value, and links to the events list to check before
  scheduling again. Because the event and its setup are saved together, an event that was saved is
  complete. A request key that would let the Backend recognize a repeat (like orders' `requestId`)
  is not added: the Backend's scheduling conflict already refuses a second copy at the same venue and
  time, naming the first (recommended answer, open to review) (FR-011, Edge Cases; research R6).
- Q: Do the separate ticket type and seating operations stay? → A: **Yes, unchanged.** The event page
  and the Edit form still use them (research R1).
- Q: What happens to `008`'s "create the event, then its seating and ticket types"? → A: **Superseded
  for scheduling only.** `008` FR-018 and research R10 and `014` research R9 get a note pointing
  here; their editing and picture parts stand (research R10).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Refused Schedule Saves Nothing and Points at the Problem (Priority: P1)

Mahdi schedules "Season Opener" at Demo Riverside Hall, a venue without a layout, with ticket types
Floor ($80, 300) and floor ($60, 200). He clicks Schedule event. The form says that another ticket
type is already named Floor, beside the second ticket type and in the error banner; everything he
typed, and the picture he chose, is still there. The Events list has no Season Opener. He renames
the second type Balcony and schedules again: the event opens with both ticket types, once.

**Why this priority**: it is the bug. A failed save must mean nothing was saved.

**Independent Test**: schedule an event whose second ticket type repeats the first one's name;
the form shows the refusal beside that type and keeps every value; the database has no new event,
ticket type, or seating rows; fix it and schedule again; exactly one event exists, with both types.

**Acceptance Scenarios**:

1. **Given** a schedule with a ticket type the Backend refuses (a repeated name, a price or quantity
   it does not accept), **When** the admin clicks Schedule event, **Then** no event, ticket type, or
   seating is saved, the error shows beside that ticket type and in the banner, and every value the
   admin entered stays in the form, the chosen pictures included.
2. **Given** a general-admission schedule whose ticket types together exceed the event's ticket
   capacity, **When** it is sent, **Then** nothing is saved and the error shows beside the ticket
   types, saying the capacity and the total asked for.
3. **Given** a refused schedule, **When** the admin fixes the field and schedules again, **Then**
   the event is created once, with its ticket types and seating, and opens; it is not refused as a
   conflict with itself.
4. **Given** a schedule refused for a reason that is not about the ticket types (a scheduling
   conflict, a time outside the venue's day, doors out of range), **Then** nothing is saved and the
   error shows as today.

---

### User Story 2 - A Seated Event Is Scheduled Whole (Priority: P1)

At QueuePass Demo Arena, a venue with sections front, middle, and back, Mahdi chooses reserved
seating, ticket types Front ($120) and Standard ($70), front selling Front, middle and back selling
Standard. He schedules it. The event opens with reserved seating on, its capacity the layout's
total, Front with front's seats and Standard with the other two sections' seats. If anything in that
setup is refused, none of it is saved.

**Why this priority**: seated events are where the half-made event hurts most: an event with
reserved seating on and no ticket types mapped sells nothing.

**Independent Test**: schedule a seated event with two ticket types and three sections; the event,
both types with their seat counts, and the three mappings exist; repeat with a refused part; nothing
exists.

**Acceptance Scenarios**:

1. **Given** a venue with a layout and reserved seating chosen, **When** the admin schedules with
   ticket types and a ticket type per section, **Then** the event is saved with reserved seating on,
   its capacity the layout's total, each ticket type's amount the seats of its sections, and each
   section selling its type; a section set to Not for sale sells nothing.
2. **Given** the same schedule with a part the Backend refuses (a section that is not in the venue's
   layout, a section under two ticket types, a quantity typed for a seated type), **When** it is
   sent, **Then** nothing is saved and the error names the section or ticket type at fault.
3. **Given** the venue's layout changes while the form is open, **When** the admin schedules with
   the old sections, **Then** the schedule is refused as naming a section not in the layout, and
   nothing is saved; the admin reloads the form to see the new sections.

---

### User Story 3 - The Same Rules, Whoever Calls (Priority: P2)

A teammate's script schedules events through the API, some with their ticket types and seating,
some without. A request without them behaves exactly as before. A request with them obeys every rule
that adding ticket types and seating one by one obeys, and is refused whole when one is broken. Two
admins scheduling at the same venue and time at once, each with ticket types, end with one whole event
and one refusal, and no ticket types of a refused event anywhere.

**Why this priority**: the Backend owns the rules (Constitution IV); the form is one client.

**Independent Test**: send scheduling requests through the API with and without ticket types and
seating, valid and broken, and two at once; compare the database before and after each.

**Acceptance Scenarios**:

1. **Given** a scheduling request without ticket types or seating, **Then** the response and the
   saved event are what they are today.
2. **Given** a request with ticket types and seating that break any rule `004` or `007` sets for
   adding them one by one, **Then** it is refused with that rule's error code, the field at fault
   named, and nothing saved.
3. **Given** two requests for overlapping windows at one venue, each with ticket types, sent at the
   same moment, **Then** exactly one event is saved, with all of its ticket types and seating, and
   the other request is refused as a scheduling conflict with nothing of it saved.

---

### Edge Cases

- **The connection drops after the request was sent.** The form cannot tell whether the event was
  saved. It keeps every value and says it could not get an answer, that the event may have been
  scheduled, and to check the Events list (linked) before scheduling again. A saved event is
  complete. Scheduling the same event again at the same venue and time is refused as a scheduling
  conflict naming the saved one.
- **The Backend fails partway** (an unexpected error, the database connection lost): nothing is
  saved; the form shows the error and keeps every value.
- **A picture is refused after the event was saved**: as today (`014` FR-018): "Event created.
  These pictures were not added: …", and the form becomes that event's edit form with the pictures
  not yet added.
- **Ticket types that differ only in letter case or surrounding spaces** ("Floor", " floor "): the
  same name, refused at the second one, as when they are added one by one.
- **A seated ticket type that sells no section**: allowed, with an amount of 0, as today; it sells
  nothing until a section is mapped to it on the event page.
- **Reserved seating with no ticket types**: allowed through the API, as turning reserved seating on
  without mappings is today. The form always sends at least one ticket type (`008` FR-019).
- **Reserved seating at a venue without a layout**: refused, naming seating; nothing saved.
- **A ticket capacity typed with reserved seating**: refused, as on an edit today (`007` FR-018).
- **Tickets per customer above the layout's total** with reserved seating: refused as today (`016`).
- **Malformed parts** (a missing name, a price with three decimals, a section that is not an
  identifier, an unknown field): all reported at once, each naming its ticket type and field, as
  malformed event fields are today.
- **The venue's layout changes while scheduling**: the layout change and the schedule do not
  interleave; whichever runs second sees the other's result (User Story 2, scenario 3).
- **Spec `030`** (past events left out of lists, not yet merged): a past-dated schedule is refused or
  accepted exactly as today; this feature changes no list.

## Requirements *(mandatory)*

### Functional Requirements

**Scheduling, in the Backend**

- **FR-001**: The scheduling request MUST accept, besides the event's own fields, its ticket types
  (each with a name, a price, and, without reserved seating, a quantity) and whether it uses reserved
  seating, with the sections each ticket type sells.
- **FR-002**: A scheduling request without ticket types and without reserved seating MUST be checked,
  saved, and answered exactly as before this feature.
- **FR-003**: Scheduling MUST save the event, its ticket types, its reserved seating choice, and each
  section's ticket type together, all or nothing: when any part is refused, or anything fails before
  the whole is saved, no event, ticket type, or section mapping from that request may remain.
- **FR-004**: The parts MUST obey every rule they obey when added one by one (`004`, `007`, `016`):
  ticket type names 1 to 100 characters after trimming, unique within the event ignoring case; prices
  non-negative with at most two decimals; without reserved seating, every type has a whole positive
  quantity and together they fit the event's ticket capacity; with reserved seating, the venue has a
  layout, no ticket capacity is typed, no type has a typed quantity, every section listed is in the
  venue's layout and under one type at most, each type's amount is its sections' seats, the event's
  capacity is the layout's total, and tickets per customer fit that total. Sections may be listed only
  with reserved seating.
- **FR-005**: Malformed fields MUST all be reported in one refusal. Otherwise the refusal MUST be the
  first rule broken in this order: the event's checks as today, then seating, then each ticket type in
  the order sent.
- **FR-006**: A refusal about one ticket type MUST name, in a machine-readable form the contract
  states, its position in the request and the field at fault (name, price, quantity, or sections); a
  refusal about the ticket types together, or about reserved seating, MUST name that group. The error
  codes are the existing ones (`VALIDATION_FAILED`, `TIER_NAME_TAKEN`, `CAPACITY_EXCEEDED`).
- **FR-007**: Under concurrency the rules MUST still hold, guaranteed by the database (Constitution
  IV): two schedules at one venue that conflict save at most one event, and nothing of the other;
  a layout change and a schedule at that venue never interleave.

**Scheduling, in the Admin app**

- **FR-008**: The Schedule event form MUST save the event, its ticket types, and its seating in one
  scheduling request, then upload its pictures as today.
- **FR-009**: When scheduling is refused, the form MUST keep every value the admin entered (the
  ticket types, the seating choices, and the chosen pictures included; `002` FR-030), show the
  Backend's message in its error banner as today, and create nothing.
- **FR-010**: A refusal that names one ticket type MUST also be shown beside that ticket type, and
  one that names the ticket types together or the seating, beside that group, associated with the
  field so assistive technology announces it with the field; it clears when the admin schedules
  again.
- **FR-011**: When the scheduling request gets no answer (the connection dropped, the Backend
  unreachable), the form MUST keep every value and say that it could not tell whether the event was
  scheduled, with a link to the Events list to check before scheduling again.
- **FR-012**: Pictures MUST keep `014`'s behavior: uploaded after the event is saved; a refused one
  gives "Event created. These pictures were not added: …" and the new event's edit form. The "Seating
  setup not finished" message goes, since nothing can be half-saved any more.
- **FR-013**: The Edit event form, and the event page's ticket type and seating controls, MUST behave
  as before this feature.

**Documentation**

- **FR-014**: The contract MUST describe the new parts of the scheduling request, the order of its
  checks, and how a refusal names its field; `008` FR-018 and research R10 and `014` research R9 MUST
  say that scheduling is now one request, pointing here.

**Tests**

- **FR-015**: Tests against a real database MUST show, for each refusal of FR-004 and for a failure
  after the event row is written, that no event, ticket type, or section mapping remains; and that two
  conflicting schedules with ticket types save one whole event. An Admin app test MUST show a refused
  ticket type keeps the form filled, shows the error beside it, and sends one scheduling request and
  nothing else. A browser test MUST walk the same against the running system.

### Key Entities

- **Event**: as today; scheduling now saves it together with its ticket types and seating.
- **Ticket type** (tier): name, price, amount; on a seated event, the amount is its sections' seats.
- **Section mapping**: which ticket type a section of the venue's layout sells at this event.
- **Scheduling request**: the event's fields, optionally its ticket types, whether it uses reserved
  seating, and the sections each type sells.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every refusal of a schedule (each rule of FR-004, a scheduling conflict, malformed
  fields, a failure partway), the number of events, ticket types, and section mappings in the database
  is the same after the request as before it, in 100% of tries.
- **SC-002**: After a refused schedule, the admin fixes one field and schedules again without
  retyping anything, and exactly one event results, with all its ticket types and seating.
- **SC-003**: Every refusal that names a ticket type or the seating shows beside that field in the
  form, as well as in the banner.
- **SC-004**: Scheduling from the form sends one request for the event and its setup (plus one per
  picture), where it sent up to 3 plus one per ticket type before.
- **SC-005**: Every existing Backend, Admin app, and browser test of scheduling without ticket types
  passes unchanged; the ones written against the old request sequence are updated to the one request
  and still check the same outcomes.
- **SC-006**: Two conflicting schedules sent at once, each with ticket types, end with exactly one
  event and only its ticket types, in 100% of tries.

## Assumptions

- **The issue's "FR-035"** is the form's rule that a refused save keeps the admin's values: `002`
  FR-030 and Constitution IV, cited in `EventForm.tsx` as FR-035.
- **The exact error seen on 2026-11-03** is not recorded (the issue). Any refusal after the first
  request produced the same half-made event, so the fix does not depend on which one it was.
- **Ticket type order**: the form sends the types in the order shown; the event page lists them by
  price, as today.
- **The base price** stays what the form sends, the lowest ticket type price (`008` R10); the
  Backend does not work it out.
- **No limit on how many ticket types** one request may carry beyond the request size limit the
  Backend already has; the form adds them one at a time.
- **Coordination with work in flight**: spec `030` (#133, not merged) changes the event list
  (`findAll`) and the Admin events page; this feature changes scheduling (`create`) and the event
  form, different code, but both raise the contract's version, so whichever merges second rebases
  (030 to 1.22.0, this to 1.23.0). Issue #130 (doors open as hours before the start, not specced)
  changes how the form picks `doorsOpenAt` but not what it sends. Issue #134 (the event form rework,
  not specced) will restructure the form and show errors as they happen; it can place server errors
  on fields by the names FR-006 defines, and it carries editing's all-or-nothing.

## Out of scope

- **Editing an event all or nothing**: the Edit form still saves the details, then each ticket type
  and the seating, through separate requests, as `008` R10 says. A refused part leaves the earlier
  parts saved. Recorded here as a known gap (Principle VIII); issue #134 asks for "create or update
  the whole event or nothing" and is where it closes. No control that exists today is removed.
- Pictures in the scheduling request (`014` keeps them separate on purpose).
- A request key to recognize a repeated schedule (research R6).
- Showing errors as the admin types, seat totals that help match the layout, and a new form layout
  (#134); doors open as hours before the start (#130).
- The Customer app and the Ticket Booth: unchanged.
- The demo data: it keeps creating events, ticket types, and seating step by step through the
  Backend's services, which is correct for a script that stops on the first error.
