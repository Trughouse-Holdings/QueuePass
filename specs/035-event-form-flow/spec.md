# Feature Specification: Event Form Flow

**Feature Branch**: `035-event-form-flow-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#134](https://github.com/Trughouse-Holdings/QueuePass/issues/134) (event form: rework
the flow, help match the venue's seats, and show errors as they happen)

**Input**: User description: issue #134. Creating or editing an event in the Admin app is painful:
errors appear only after the admin presses the button, and the first problem is shown in one banner
at the top of the page, so they have to scroll up to read it, scroll back down to find the field,
fix it, and try again; matching ticket types, quantities, and each section's ticket type to the
venue's seats is hard, with no running total of what is still unassigned; the form is one long
page whose parts appear or change depending on earlier choices; and a save can still half-succeed
on an edit (scheduling was made all or nothing in `031`, which left editing to this issue). What
we want: a form that is significantly easier to use — each problem shown next to its field as soon
as it happens, a live total of seats assigned versus the venue's seats, a flow that follows how
admins think, and a save that creates or updates the whole event or nothing. The roadmap number is
reserved by this PR's amendment (Constitution 3.9.7). Number 034 is already reserved by merged
PR #153 (spec `034-sell-until-end`).

## Context

Builds on `002` (events, the 60-minute rule, the form keeps the admin's values when a save is
refused), `004` (ticket types), `007` (reserved seating and a venue's layout), `008` (the Schedule
event and Edit event form), `014` (pictures uploaded after the event exists), `016` (tickets per
customer), `020` and `025` (event times and doors in the venue's zone), and `031` (scheduling the
event, its ticket types, and its seating in one request, all or nothing; a refusal names the
ticket type or group at fault).

Today the form (`admin-app/src/pages/EventForm.tsx`, named in the issue) checks almost everything
only when the admin presses Schedule event or Save changes. The first problem goes into one error
banner at the top. Ticket types, quantities, and section mappings have to add up to the venue's
layout, but the form does not say how many seats are still unassigned as the admin works. Venue,
times, doors, ticket types, seating, and pictures are one long page. Scheduling is already all or
nothing (`031`). Editing is not: the form still sends the details, then each ticket type and the
seating, through separate requests (`031` research R7, Out of scope, left to this issue). A
refused later step leaves the earlier ones saved.

This feature reworks that form: it is grouped into clear sections; each problem shows beside its
field as soon as it is wrong, and clears when it is fixed; a live total names how many of the
venue's seats are assigned; a known problem is never sent; a server refusal focuses the field at
fault; and an edit of the event, its ticket types, and its seating is saved all or nothing, as
scheduling already is. Pictures stay as they are in `014`.

## Clarifications

### Session 2026-11-09

The issue settles what the form must do. Every question it leaves open below took the recommended
answer, written unattended and recorded here as **recommended answer, open to review**, so Nathan
and the team can overturn it in review of this pull request.

- Q: One page with sections, or a step-by-step wizard with Back/Next and a review step? → A: **One
  page with three sections**, in this order: venue and times; tickets and seating; details
  (tickets per customer, and pictures). A wizard would hide the seat total from the times, and
  would hide a locked field's reason from the rest of an edit. The issue's own example is sections
  in a sensible order. Show only what the choices so far make relevant: ticket types and seating
  once a venue is chosen; section mapping only with reserved seating at a venue that has a layout;
  a typed quantity only for general admission; a typed total tickets only when reserved seating is
  off (recommended answer, open to review) (FR-001, FR-002; research R1).
- Q: Fold in #128 (Safari has no time picker), #130 (doors open as hours before the start), #49
  (description, age restriction, category), or #44 (draft/published, on-sale times)? → A: **No.
  They stay their own issues.** #127's scheduling half-save is already closed by `031`; this
  feature closes the edit half-save `031` left here, and the form rework the issue asks for.
  #130 and #128 change how times are picked, not this form's sections, errors, or seat totals.
  #49's doors-open item is already `025`. #44 is a new event lifecycle (recommended answer, open
  to review) (Out of scope; research R2).
- Q: Which checks run in the browser, and which can only come from the Backend? → A: **The browser
  previews every rule it can evaluate from what is on the form**, as a convenience (Constitution
  IV): required fields, a well-formed price and quantity, doors in range, the end after the start,
  a skipped or repeated local time, a repeated ticket type name, ticket types over the event's
  capacity, and tickets per customer outside 1 to the capacity. The Backend still decides, and
  only it can refuse a name clash with a type already stored, a scheduling conflict at the venue,
  a sold-ticket rule the form has not yet loaded, a rate limit, or a dropped connection. The
  form never sends a request it already knows is wrong (recommended answer, open to review)
  (FR-006 to FR-009; research R3).
- Q: How do server errors map back onto fields? → A: **The same field names `031` already
  defines**, plus the event's own fields (`name`, `locationId`, `startsAt`, `endsAt`,
  `doorsOpenAt`, `totalTicketCapacity`, `maxTicketsPerCustomer`). The message is shown only beside
  that field (or group), not also in a banner at the top, and focus moves to the field. A
  scheduling conflict keeps its distinctive treatment, placed with the times. An error that names
  no field, and the "no answer" case from `031` FR-011, are shown next to the submit button, not
  at the top of the page (recommended answer, open to review) (FR-010, FR-011; research R4).
- Q: When is an error shown, and how is it announced without flooding a screen reader? → A: **When
  the admin leaves the field, or as they type once that field has already been left or the form
  has been submitted.** Leaving an empty required field shows its error; typing to fix it clears
  the error as they type. Errors are tied to the field (`aria-invalid`, `aria-describedby`). A
  polite live region announces when an error first appears and when the admin leaves a field that
  is still wrong, not on every keystroke. The form works by keyboard alone (recommended answer,
  open to review) (FR-007, FR-012; research R5).
- Q: Is "N of M seats assigned" a hard block, or guidance? → A: **Guidance when seats are left
  unassigned** (a section set to Not for sale is allowed today, and stays allowed). The total
  says exactly what is left, for example "12 seats not assigned to a ticket type." **A general-
  admission total over the event's capacity is a problem**, shown beside the ticket types, and
  submit does not send it (recommended answer, open to review) (FR-013, FR-014; research R6).
- Q: The same flow for create and edit? What is locked when tickets are sold? → A: **The same
  three sections for both.** When tickets have been sold, the form locks the controls the Backend
  already refuses to change, and shows why next to each: reserved seating cannot be switched;
  a ticket type cannot be removed if it has orders, or have its quantity set below the tickets it
  has sold; a section with sold seats stays in its ticket type; a seated event cannot move to
  another venue while reserved seating is on. The counts come from the event's availability and
  seat map, which already exist; the Backend still enforces the rules (recommended answer, open to
  review) (FR-015, FR-016; research R7).
- Q: How is an edit saved all or nothing? → A: **The existing update request takes the ticket
  types and the seating as optional parts**, the same idea as `031` for scheduling. A request
  without them is answered exactly as today, so every existing caller is unaffected. When they are
  sent, they are the complete new set: each existing ticket type is named by its id; a type
  without an id is new; an existing type left out is removed. The Backend saves the event's
  details, the ticket types, and the seating in one step, or saves none of that request. Pictures
  still upload afterwards (`014`). The Edit form always sends the types and the seating when it
  has loaded them (recommended answer, open to review) (FR-017 to FR-020; research R8).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Errors appear beside the field as they happen (Priority: P1)

An admin is scheduling or editing an event. As soon as a field is wrong — they leave it empty,
type a price the form cannot read, put the end before the start, or give two ticket types the same
name — the problem appears next to that field. When they fix it, the message goes away at once.
Pressing the button with a known problem does not send anything; focus moves to the first field
at fault.

**Why this priority**: This is the issue's first complaint and the main source of friction today
(one banner at the top, one problem at a time, only after submit).

**Independent Test**: On Schedule event, leave the name empty and leave the field: the error is
next to Event name, and Schedule event sends no request. Type a name: the error clears. A test
can drive the same without a running Backend for the preview cases.

**Acceptance Scenarios**:

1. **Given** the Schedule event form, **When** the admin leaves Event name empty, **Then** "Enter
   the event's name." appears next to that field, and the button does not send a request.
2. **Given** a wrong price on a ticket type, **When** the admin leaves that price field, **Then**
   the problem appears next to that price, and **When** they correct it, **Then** the message
   clears as they type.
3. **Given** two ticket types with the same name (ignoring case), **When** the admin leaves the
   second name, or presses the button, **Then** the existing repeated-name message appears next to
   the second name, and nothing is sent.
4. **Given** known problems on several fields, **When** the admin presses the button, **Then**
   nothing is sent, every known problem is shown next to its field, and focus moves to the first
   one in page order.
5. **Given** the same form on Edit event, **When** the admin makes the same mistakes, **Then** the
   same messages, clearing, and focus apply.

---

### User Story 2 - A live total of seats assigned (Priority: P1)

An admin is setting up tickets for a venue. As they type quantities or choose which section sells
which ticket type, a running total tells them how many of the venue's seats (or the event's total
tickets) are assigned, per ticket type and overall, and says exactly what is left, for example
"12 seats not assigned to a ticket type."

**Why this priority**: The issue's second complaint; without this, filling a seated venue's layout
is trial and error.

**Independent Test**: At a venue whose layout has 30 seats in three sections of 10, assign two
sections to Floor and leave one Not for sale: the total reads "20 of 30 seats assigned" and
"10 seats not assigned to a ticket type." Assign the last section: it reads that all 30 seats are
assigned. No save is required.

**Acceptance Scenarios**:

1. **Given** reserved seating at a venue with a layout, **When** the admin changes a section's
   ticket type, **Then** the overall total and that type's seat count update at once, and the
   leftover wording names how many seats are not assigned to a ticket type (or that all seats are
   assigned).
2. **Given** general admission, **When** the admin types ticket type quantities, **Then** the total
   is those quantities against the event's total tickets (the typed total, or the venue's capacity
   when it is blank), and a sum over the capacity is a problem next to the ticket types (US1).
3. **Given** a venue with no layout, **When** the admin types quantities, **Then** the same
   general-admission total applies, against the venue's capacity or the typed total tickets.

---

### User Story 3 - A form that follows how admins think (Priority: P2)

An admin opening Schedule event or Edit event sees three clear sections in a sensible order:
venue and times first, then tickets and seating, then details (tickets per customer, and
pictures). Only the parts that the choices so far make relevant are shown.

**Why this priority**: The issue asks for a flow that matches how admins work; it is usable once
errors and seat totals work, even on today's single page, so it follows them.

**Independent Test**: Choose no venue: ticket types and seating are not shown. Choose a venue with
a layout: the tickets and seating section appears, with reserved seating chosen and each section
offered a ticket type. Switch to general admission: the section selects go, and each type has a
quantity. The headings are present on Edit event too.

**Acceptance Scenarios**:

1. **Given** Schedule event, **When** no venue is chosen, **Then** the venue and times section is
   shown, and tickets and seating is not.
2. **Given** a venue with a layout, **When** the admin chooses it, **Then** tickets and seating
   appears, reserved seating is the starting choice, and each section can be given a ticket type
   or Not for sale.
3. **Given** reserved seating, **When** the admin chooses general admission, **Then** section
   mapping is hidden and each ticket type has a quantity; the live total follows US2.
4. **Given** Edit event, **When** the form loads, **Then** the same three sections are shown, with
   the event's values, including its seating choice and ticket types.

---

### User Story 4 - An edit is all or nothing (Priority: P1)

An admin is changing an event that already exists: its name, a ticket type's price, a new ticket
type, and a section's ticket type, in one save. If any part is refused, none of those changes are
saved, the form keeps every value, and the refusal is shown beside the field at fault (US1, US6).
Scheduling stays the one-request save from `031`.

**Why this priority**: The issue requires "creates or updates the whole event or nothing." `031`
closed this for scheduling and recorded the edit gap as belonging here. A half-saved edit is the
same class of bug, just on an event customers may already hold tickets for.

**Independent Test**: On Edit event, change the name and add a ticket type whose name clashes with
one already on the event: the request is refused, the event's name and ticket types in the
database are unchanged, and the form still holds the new name and the new type.

**Acceptance Scenarios**:

1. **Given** an event with two ticket types, **When** the admin changes the event's name and sends
   a new type with a repeated name, **Then** the event's name and types are unchanged, and the
   message appears beside the new type's name.
2. **Given** a seated event, **When** the admin remaps a section and the Backend refuses (a section
   with sold seats, or a bad section), **Then** no section mapping and no other field from that
   save is changed.
3. **Given** a request that does not include ticket types or reserved seating, **When** a caller
   updates only the event's details, **Then** the answer is exactly as before this feature.
4. **Given** Schedule event, **When** the admin saves, **Then** the event, its ticket types, and
   its seating are still sent in one request, as in `031`.

---

### User Story 5 - Locked fields say why (Priority: P2)

An admin opens Edit event for an event that has already sold tickets. Controls the Backend will
refuse to change are not offered as if they could be changed. Each locked control has a short
reason next to it, so the admin does not have to press Save to find out.

**Why this priority**: The issue asks for this on edit; it prevents a class of refused saves the
form can already see coming.

**Independent Test**: An event with reserved seating and sold seats in section A: the reserved
seating choice is locked, with the existing "has sold tickets, so reserved seating can no longer
be switched" reason; section A's ticket type cannot be changed, with "Section A has sold seats, so
it stays in its tier." A type with sold tickets cannot be removed, and its quantity cannot be set
below the number sold.

**Acceptance Scenarios**:

1. **Given** sold tickets on the event, **When** the form loads, **Then** the reserved seating
   choice is locked and the reason is shown next to it.
2. **Given** a ticket type with sold tickets, **When** the admin views it, **Then** Remove is not
   offered for that type, and the reason is shown; a typed quantity below the number sold is a
   problem next to the quantity (US1).
3. **Given** a section with sold seats, **When** the admin views its ticket type, **Then** the
   select is locked and the reason is shown next to it.
4. **Given** reserved seating, **When** the admin views the venue, **Then** the venue cannot be
   changed while reserved seating is on, and the form says so (the existing rule).
5. **Given** an event with no tickets sold, **When** the form loads, **Then** none of these locks
   apply.

---

### User Story 6 - A server refusal lands on its field (Priority: P2)

An admin has a form that looks right, presses the button, and the Backend refuses (a scheduling
conflict, a ticket type name already stored, tickets sold the form had not yet loaded). The
message appears next to the field at fault, that field is focused, and there is no banner at the
top for that problem. Every value is kept. If the form cannot tell whether a schedule was saved
(`031` FR-011), that message is next to the button, with a link to the Events list.

**Why this priority**: The issue requires that a problem that slips past the browser still does not
send the admin to a banner at the top.

**Independent Test**: Schedule an event that conflicts with one already at the venue: the conflict
treatment appears with the times, focus is on Starts (or Venue, if that is what the refusal
names), and there is no error banner at the top of the page. The typed values remain.

**Acceptance Scenarios**:

1. **Given** a scheduling conflict, **When** the Backend refuses, **Then** the existing conflict
   treatment is shown with the times, focus moves to Starts, and every value is kept.
2. **Given** a refusal that names a ticket type (for example `tiers.1.name`), **When** it arrives,
   **Then** the message is next to that type's field, that field is focused and marked invalid, and
   there is no banner at the top for it.
3. **Given** no answer from QueuePass when scheduling, **When** the request fails that way,
   **Then** the existing "could not tell" message, with its link to Events, is shown next to the
   button, and every value is kept.
4. **Given** an error that names no field, **When** it arrives, **Then** it is shown next to the
   button, and focus moves there.

### Edge Cases

- The admin leaves a required field empty, then returns and types: the error, if shown, clears as
  they type; an empty field they have not left yet does not show an error until they leave it or
  press the button.
- Doors open still follow the start until the admin changes doors themselves (`025`); a doors
  range problem appears next to Doors open as soon as both times name a moment and doors have been
  left or a save has been tried, as the range note does today once a save was tried, and earlier
  once doors have been left.
- A repeated local time still asks which occurrence (`020`); that question is not an error, but
  leaving it unanswered is, next to that time, and submit does not send.
- A skipped local time's message stays next to that time; submit does not send.
- Ticket types could not be loaded on edit: the form says so, as today, and saving changes only
  the details (no ticket types are sent; the Backend leaves them alone).
- Pictures are still saved after the event (`014`). A picture refusal on create still hands the
  admin the new event's edit form with the notice. That notice stays visible (it is not a field
  error).
- A cancelled event stays read-only (`005`); this feature does not add a new way to edit one.
- Two admins edit the same event at once: the Backend's existing locks and sold-ticket rules
  decide; a refusal lands on its field. No new request key is added (same choice as `031` R6).
- General admission over capacity is a problem even if the admin has not left every quantity
  field, once they press the button, and as they type once any quantity has been left.
- Closing the last ticket type is not allowed (the form already keeps at least one).
- An edit that only changes pictures, with ticket types loaded, still sends the current types and
  seating so the save stays one request for the event and its setup (pictures remain separate).

## Requirements *(mandatory)*

### Functional Requirements

**The form's shape**

- **FR-001**: The Schedule event and Edit event forms MUST use the same three sections, in this
  order, each with a visible heading: **Venue and times** (name, venue, doors open, start, end,
  and the venue's time zone line); **Tickets and seating** (the reserved-or-general choice when
  the venue has a layout, the ticket types, section mapping when reserved seating is on, the live
  seat total, and total tickets when reserved seating is off); **Details** (tickets per customer,
  and pictures).
- **FR-002**: The form MUST show only what the choices so far make relevant: tickets and seating
  once a venue is chosen; section mapping only with reserved seating at a venue that has a layout;
  a typed quantity on each ticket type only for general admission (or at a venue with no layout);
  a typed total tickets only when reserved seating is off. A seated event's total tickets remain
  the layout's total, as today, shown in the tickets and seating section.

**Errors as they happen**

- **FR-003**: Each problem the browser can already see (Clarifications, the browser checks) MUST
  appear next to its field as soon as it is wrong: when the admin leaves the field, or as they
  type once that field has been left or a save has been tried. It MUST clear as soon as the field
  is right again.
- **FR-004**: A required field the admin has not yet left MUST NOT show an empty-field error until
  they leave it or press the button.
- **FR-005**: The submit button MUST NOT send a form that has a known problem. If the admin presses
  it while one remains, nothing is sent, every known problem is shown next to its field, and focus
  moves to the first such field in page order.
- **FR-006**: The browser's checks are a preview. The Backend remains the authority for every
  rule, including those the browser also previews (Constitution IV).
- **FR-007**: A field with a problem MUST be marked invalid and associated with its message so
  assistive technology announces the message with the field (`aria-invalid`, `aria-describedby`).
  A polite live region MUST announce when a problem first appears and when the admin leaves a
  field that is still wrong, and MUST NOT announce on every keystroke. The form MUST be usable by
  keyboard alone: every control is reachable, and a section heading is a heading.

**Seat totals**

- **FR-008**: With reserved seating, a live total MUST show how many of the layout's seats are
  assigned to a ticket type, overall and per ticket type, and MUST say exactly what is left
  ("12 seats not assigned to a ticket type") or that all seats are assigned. It updates as section
  choices change, without a save.
- **FR-009**: With general admission, a live total MUST show the ticket types' quantities against
  the event's total tickets (the typed total, or the venue's capacity when it is blank), and MUST
  say exactly what is left or how many seats the types are over the capacity. A total over the
  capacity is a known problem (FR-005) shown next to the ticket types.

**Server refusals**

- **FR-010**: A Backend refusal that names a field or group (`details.field`, or a
  `details.fields` entry, including `031`'s `tiers.<index>.<field>`, `tiers`, `reservedSeating`,
  and `totalTicketCapacity`, and the event's own fields) MUST be shown next to that field or
  group, not in a banner at the top of the page. Focus MUST move to the field at fault. Every
  value the admin entered MUST be kept (`002` FR-030, Constitution IV).
- **FR-011**: A scheduling conflict MUST keep its distinctive treatment (the conflicting event's
  name and times), placed with the times, with focus on Starts. The "no answer" case (`031`
  FR-011) and a refusal that names no field MUST be shown next to the submit button, not at the
  top of the page. The no-answer message and its link to the Events list are unchanged in wording.
- **FR-012**: `031` FR-009 and FR-010's rule that a scheduling refusal is also shown in the error
  banner at the top is superseded for this form: the message belongs next to the field (FR-010).
  The banner at the top is not used for a problem that has a field.

**Locked fields**

- **FR-013**: On Edit event, once the form has the event's sold-ticket counts (from the
  availability already published for the event) and, with reserved seating, each section's sold
  count (from the seat map the form already loads), it MUST lock the controls the Backend would
  refuse, and MUST show the existing reason next to each: reserved seating cannot be switched when
  the event has sold tickets; a ticket type with orders cannot be removed; a quantity cannot be
  set below the tickets that type has sold; a section with sold seats stays in its ticket type; a
  seated event cannot change venue while reserved seating is on. The Backend still enforces every
  rule if those counts are stale or missing.
- **FR-014**: An event with no tickets sold MUST leave those controls unlocked, as today.

**All or nothing, including edit**

- **FR-015**: Scheduling MUST stay one request for the event, its ticket types, and its seating,
  all or nothing, as in `031` (FR-001 to FR-012 of `031`). Pictures still follow (`014`).
- **FR-016**: An Edit event save, when the form has loaded the event's ticket types, MUST send the
  event's details, its complete ticket types, and its seating in one update request. Pictures
  still follow, as today.
- **FR-017**: The update request MUST accept optional ticket types and reserved seating. A request
  without them MUST be checked, saved, and answered exactly as before this feature. When they are
  sent, they are the complete new set: an existing ticket type is named by its id; a type without
  an id is new; an existing type left out is removed. `id` on a ticket type is allowed only on an
  update; a schedule that sends one is refused.
- **FR-018**: When ticket types or reserved seating are sent on an update, the Backend MUST save
  the event's details, the ticket types, and the seating together, all or nothing: when any part
  is refused, or anything fails before the whole is saved, none of that request's changes to the
  event, its ticket types, or its section mappings may remain. The parts MUST obey every rule they
  obey when changed one by one today (`004`, `005`, `007`, `015`, `016`, `031`), including sold-
  ticket and hold rules, and a refusal MUST name its field in the same machine-readable form as
  `031` (and `TIER_HAS_ORDERS` / `EVENT_HAS_ORDERS` as today). Under concurrency those rules MUST
  still hold, guaranteed by the database (Constitution IV).
- **FR-019**: The Edit form MUST place a refusal from that request as FR-010 and FR-011 require,
  including on edit (this supersedes `031` FR-013's "the Edit form shows refusals in the banner
  only").

**Documentation and tests**

- **FR-020**: The contract MUST describe the new parts of the update request, that `id` on a
  ticket type is only for an update, the order of checks (the event's details as today, then the
  same seating and ticket type order as `031`, then the sold-ticket rules), and how a refusal
  names its field. Spec `031`'s FR-013 and Out of scope MUST say that editing is now all or
  nothing, pointing here, with a dated note.
- **FR-021**: Admin-app tests MUST show: each field's preview error appears next to it as soon as
  it is wrong and clears when fixed; the seat totals update live and name what is left; submit
  does not send a form with a known problem, and moves focus to the first field at fault; a server
  error lands on its field and that field is focused; an edit refusal leaves the event, types, and
  seating unchanged in what the form sent. Backend tests against a real database MUST show, for a
  refused update that included ticket types, that the event, its ticket types, and its section
  mappings are unchanged, including when a write fails after the first change. A browser test MUST
  walk creating a seated event that exactly fills a venue's layout, using the live total, without
  a submit-time error.

### Key Entities

- **Event, ticket type, section mapping, pictures**: as today; an edit can now save the first
  three together, as scheduling already does.
- **Update request**: the event's fields, optionally its complete ticket types (each with an id
  when it already exists), whether it uses reserved seating, and the sections each type sells.
- **Seat total**: a live count of seats assigned versus the layout total or the event's total
  tickets, for the admin's guidance (and a problem when general admission is over capacity).
- **Locked field**: a control the form will not change because tickets already sold make the
  Backend refuse that change, with the reason shown next to it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can schedule a seated event that assigns every seat of a venue's layout
  (each section given a ticket type, the live total reading that all seats are assigned) and save
  it without ever seeing a problem only after pressing the button, and without scrolling to find a
  problem, in a browser test.
- **SC-002**: For every preview problem in FR-003, the message is next to its field at the first
  leave or, once touched, as the admin types, and is gone once the field is right, in 100% of the
  Admin-app cases this feature's tests cover.
- **SC-003**: Pressing the button with a known problem sends no request, in 100% of those cases,
  and focus is on the first field at fault.
- **SC-004**: For every refusal of an update that included ticket types (each sold-ticket rule,
  a repeated name, a bad section, malformed fields, a failure partway), the event's details, ticket
  types, and section mappings in the database are the same after the request as before it, in
  100% of tries.
- **SC-005**: After a refused edit, the admin fixes one field and saves again without retyping
  anything, and the event reflects the whole intended change.
- **SC-006**: A server refusal that names a field is shown next to that field, that field is
  focused, and no error banner appears at the top of the page for it.
- **SC-007**: Every existing Backend, Admin-app, and browser test of scheduling and of editing
  without this feature's new request parts still passes, or is updated to the new placement and
  the one update request and still checks the same outcomes.

## Assumptions

- **Usability, not custom visual design** (Principle VII): the three sections, the live total, and
  messages next to fields reuse the shared theme's headings, field hints, and status styles. No
  new branding or decoration.
- **The "Seating setup not finished" banner** is already gone on Schedule event (`031`). This
  feature does not bring it back.
- **Ticket type order**: the form still sends the types in the order shown; the event page still
  lists them by price.
- **The base price** stays what the form sends, the lowest ticket type price, as today.
- **Availability and the seat map** are enough to show sold counts; this feature does not add
  `ticketsSold` to the event or ticket type in the contract.
- **Coordination with work in flight**: specs `033` and `034` are on `main` (merged PRs #152 and
  #153, constitution 3.9.6, contract 1.26.0). This feature uses 035 and takes constitution 3.9.7
  and contract 1.27.0 on top, keeping both rows and both contract changes. Spec `032` has an open
  implementation PR (#151) this feature does not touch; it does not change the event form's save
  path. This work also does not touch PR #154 (impl 033), PR #151, or branch
  `034-sell-until-end-impl`.
- **#130** may later change how doors are picked; this form still sends `doorsOpenAt` as today.

## Out of scope

- Safari's missing time picker in the calendar popup (#128). **Note (2026-11-10, spec `036`)**:
  now in `036`, with #130.
- Picking doors open as a number of hours before the start (#130). **Note (2026-11-10, spec
  `036`)**: now in `036`, with #128.
- Event description, age restriction, and category (#49; doors open is already `025`).
- Draft and published events, on-sale and off-sale times (#44).
- Pictures in the scheduling or update request (`014` keeps them separate on purpose).
- A request key to recognize a repeated save (`031` research R6, same choice).
- The event page's separate ticket type and seating controls, if any remain outside this form:
  unchanged, still their own operations. The Edit event form is the all-or-nothing path.
- The Customer app, the Ticket Booth, and the demo data: unchanged. The demo data may still create
  events, types, and seating step by step through the Backend's services.
- Changing the 60-minute rule, doors range, or sold-ticket rules themselves; this feature only
  surfaces them sooner and saves an edit atomically.

## Superseded requirements

- **`031` FR-013**, and **`031` Out of scope** ("Editing an event all or nothing"): editing the
  event, its ticket types, and its seating through this form is now all or nothing (FR-016 to
  FR-019). A dated note is added to `031`.
- **`031` FR-009, FR-010, and SC-003**, for the Admin event form only: a refusal that names a
  field is shown next to that field, not also in the banner at the top (FR-010, FR-012). The
  no-answer message remains, moved next to the button (FR-011). A dated note is added to `031`.
- **`008` research R10** (edit applies through existing operations, stopping at the first
  refusal): superseded for the Edit event form, which now sends one update request (FR-016). A
  dated note is added if that research file still states the old sequence as current.
