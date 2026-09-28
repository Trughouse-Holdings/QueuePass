# Feature Specification: Admin Venue and Event Management

**Feature Branch**: `002-admin-venues-events`

**Created**: 2026-09-20

**Last Revised**: 2026-09-28 (rewritten for constitution v2.0.0; formerly
`001-venue-event-management`)

**Status**: Draft

**Input**: User description: "In the admin app, add the venues and events functionality. Make sure
you can create, read, update, and delete everything in each. The front-end apps can only
communicate with the database through OpenAPI-style REST APIs to the back-end app."

## Context

This feature builds on `001-bare-bones-system`, which delivers sign-in, token validation, role
enforcement, and a stub Admin app. It adds the Backend venue and event API, including the
60-minute double-booking rule, and the Admin app screens that use it. Feature `003` reuses the
read endpoints defined here.

**Revision note**: The earlier version of this spec (under constitution v1.0.0) left the API open
and kept delete out of the Admin app. Both are reversed: every endpoint requires a valid token,
changes require the QueuePass Admin role, and the Admin app offers delete for venues and events.
Environment and identity seeding moved to `001`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Maintain the Venue Catalog (Priority: P1)

A signed-in QueuePass Admin opens the Admin app and maintains the list of venues. They see every
venue on file, add one with its name, street address, and seating capacity, correct an existing
venue's details, and delete a venue that is no longer used. Invalid entries are refused with an
explanation of what is wrong.

**Why this priority**: Venues are the anchor every event hangs from. This story is useful on its
own as a venue registry before any event capability exists.

**Independent Test**: Sign in to the Admin app as `admin1`, create a venue, confirm it appears in
the list, edit its seating capacity, reload the page, and confirm the edit persisted. Delete it
and confirm it is gone. No event functionality is required.

**Acceptance Scenarios**:

1. **Given** a signed-in admin and an empty venue catalog, **When** they create a venue with a
   name, address, and seating capacity, **Then** it is saved, a success state is shown, and it
   appears in the venue list.
2. **Given** an existing venue, **When** the admin opens it, **Then** they see its name, address,
   seating capacity, and the events scheduled there.
3. **Given** an existing venue, **When** the admin edits its name, address, or seating capacity
   and saves, **Then** the new values are stored and shown in the list.
4. **Given** an existing venue, **When** the admin reloads the Admin app, **Then** the venue is
   still listed with its current values.
5. **Given** a venue form, **When** the admin submits a missing name, a missing address, or a
   seating capacity that is not a positive whole number, **Then** it is refused and the admin is
   shown which field is invalid.
6. **Given** a venue with no events, **When** the admin chooses delete and confirms, **Then** the
   venue is removed and no longer appears in the list.
7. **Given** a venue that still has events, **When** the admin tries to delete it, **Then** the
   deletion is refused, the admin is told the venue still has events, and the venue and its
   events remain.
8. **Given** a venue with events, **When** the admin lowers its seating capacity below one of its
   events' ticket capacity, **Then** the edit is refused and the message names that event.

---

### User Story 2 - Schedule Events at a Venue (Priority: P2)

A signed-in admin schedules an event at a catalogued venue, supplying its name, start and end
times, total ticket capacity, and base ticket price. They review all events, open one, adjust its
details (including moving it to another time or venue), and delete an event that is no longer
happening.

**Why this priority**: Events are the feature's main work product, but they cannot be created
until venues exist.

**Independent Test**: With at least one venue, create an event, confirm it appears in the event
list with its venue, times, capacity, and price, edit its end time and confirm the change
persisted, then delete it and confirm it is gone. All times are more than 60 minutes apart, so no
conflict handling is needed.

**Acceptance Scenarios**:

1. **Given** at least one venue, **When** the admin creates an event with a name, venue, start
   time, end time, total ticket capacity, and base price, **Then** it is saved, a success state
   is shown, and it appears in the event list with that venue.
2. **Given** existing events, **When** the admin opens the event list, **Then** each shows its
   name, venue, start and end times in the admin's local time, ticket capacity, and price.
3. **Given** an existing event, **When** the admin edits any of its details and saves, **Then**
   the new values are stored and shown.
4. **Given** an event form, **When** the admin submits an end time at or before the start time,
   **Then** it is refused with an explanation.
5. **Given** an event form, **When** the admin submits a ticket capacity above the chosen venue's
   seating capacity, **Then** it is refused with an explanation naming the venue's limit.
6. **Given** an event form, **When** the admin submits a negative price, **Then** it is refused
   with an explanation.
7. **Given** an event request naming a venue that does not exist, **When** it is submitted,
   **Then** it is refused rather than creating an orphaned event.
8. **Given** an existing event, **When** the admin chooses delete and confirms, **Then** the event
   is removed and the window it held at its venue is free for scheduling again.

---

### User Story 3 - Block Double-Bookings with Clear Feedback (Priority: P3)

An admin tries to schedule an event at a venue during a window another event at that venue
already claims, once the 60-minute setup and teardown buffer is counted. The system refuses it,
and the Admin app shows an explicit error that the venue is already committed and names the
conflicting event. The same protection applies to edits and to simultaneous submissions.

**Why this priority**: This is the business rule the feature exists to guarantee. It comes after
Story 2 only because it builds on event scheduling.

**Independent Test**: With one event at a venue, try to create a second overlapping one at the
same venue and confirm the Admin app shows a conflict error. Then try the same window at a
different venue and confirm it succeeds.

**Acceptance Scenarios**:

1. **Given** an event at a venue from 18:00 to 21:00, **When** the admin creates another there
   from 20:00 to 23:00, **Then** it is refused and no second event is created.
2. **Given** that refusal, **When** the admin looks at the Admin app, **Then** an explicit error
   banner names the conflict and the existing event, and the form keeps the admin's entries.
3. **Given** an event at Venue A from 18:00 to 21:00, **When** the admin creates one at Venue B
   from 18:00 to 21:00, **Then** it succeeds, because the rule is per venue.
4. **Given** an event at a venue from 18:00 to 21:00, **When** the admin creates one there
   starting at 21:59, **Then** it is refused, because less than 60 minutes separates them.
5. **Given** an event at a venue from 18:00 to 21:00, **When** the admin creates one there
   starting at 22:00, **Then** it succeeds, because exactly 60 minutes separates them.
6. **Given** two non-conflicting events at a venue, **When** the admin edits one into the other's
   window, **Then** the edit is refused and the original is unchanged.
7. **Given** an existing event, **When** the admin saves it without moving its time, **Then** it
   does not conflict with itself.
8. **Given** a conflicting request, **When** it is sent straight to the API with an admin's token
   instead of through the Admin app, **Then** it is refused identically.

---

### User Story 4 - Only Admins Can Change Venues and Events (Priority: P4)

Anyone signed in can read venues and events, because the Customer app (`003`) needs to show them.
Only a QueuePass Admin can create, update, or delete them. The Backend enforces this for every
caller, including one that bypasses the Admin app.

**Why this priority**: The screens of Stories 1 to 3 are only safe if the API behind them refuses
non-admins. It is listed last because it is verified directly at the API, not through a screen.

**Independent Test**: With a command-line HTTP client, list venues with a customer's token
(allowed), then try to create, update, and delete a venue and an event with a customer's token
and with a gate agent's token (each refused), and with no token (refused).

**Acceptance Scenarios**:

1. **Given** a signed-in customer, gate agent, or admin, **When** they list or retrieve venues or
   events, **Then** they receive the current records.
2. **Given** a signed-in customer or gate agent, **When** they attempt any create, update, or
   delete, **Then** it is refused with an authorization error and nothing changes.
3. **Given** no token or an invalid token, **When** any venue or event request is made, **Then**
   it is refused with an authentication error.
4. **Given** an admin whose session expires while a form is open, **When** they save, **Then**
   the Admin app renews their sign-in or returns them to the login page, and never reports a
   silent failure.

---

### Edge Cases

- **Exactly adjacent events**: One event ends at the moment the next begins (21:00 to 21:00).
  This conflicts, because the 60-minute buffer is not met.
- **Buffer boundary**: Against an event ending at 21:00, a next event starting at 21:59 is refused
  and one starting at 22:00 is accepted. Both sides MUST be tested.
- **Full containment and identical windows**: A short event inside a longer one, or two events
  with identical windows, at the same venue, conflict.
- **Zero-length or inverted windows**: An event whose end is at or before its start is refused
  before conflict checking.
- **Moving an event to a different venue**: The edit is checked against the destination venue.
- **Events crossing midnight**: An event from 22:00 to 02:00 the next day is one continuous
  window.
- **Simultaneous conflicting submissions**: Two admins submitting overlapping events at the same
  venue at the same instant MUST NOT both succeed.
- **Deleting something another admin just deleted**: The second delete is told the record no
  longer exists, and the list refreshes.
- **Accidental delete**: Delete asks for confirmation before sending the request.

## Requirements *(mandatory)*

### Functional Requirements

#### Venues (API)

- **FR-001**: Admins MUST be able to create a venue with a name, a street address, and a seating
  capacity.
- **FR-002**: Any signed-in user MUST be able to list all venues and retrieve one venue by its
  identifier.
- **FR-003**: Admins MUST be able to update any field of a venue.
- **FR-004**: Admins MUST be able to delete a venue that has no events. Deleting a venue that has
  events MUST be refused with an explanation, leaving the venue and its events unchanged.
- **FR-005**: The system MUST refuse a venue with an empty name, an empty address, or a seating
  capacity that is not a positive whole number, identifying the failing field.
- **FR-006**: The system MUST refuse lowering a venue's seating capacity below the ticket capacity
  of any of its events, naming the event.

#### Events (API)

- **FR-007**: Admins MUST be able to create an event with a name, exactly one venue, a start time,
  an end time, a total ticket capacity, and a base ticket price.
- **FR-008**: Any signed-in user MUST be able to list all events and retrieve one event by its
  identifier, with its venue's details included, and to list the events at one venue.
- **FR-009**: Admins MUST be able to update any field of an event, including its venue and time
  window.
- **FR-010**: Admins MUST be able to delete an event. Its window then becomes available.
- **FR-011**: The system MUST refuse an event whose end time is at or before its start time, whose
  venue does not exist, whose ticket capacity is not a positive whole number or exceeds its
  venue's seating capacity, or whose base price is negative, identifying the failing field.
- **FR-012**: The system MUST store and compare all event times in UTC, treat each window as
  half-open (including its start instant and excluding its end instant), and state this in the
  API contract.

#### Scheduling Conflicts

- **FR-013**: The system MUST refuse any event create or update that leaves less than 60 minutes
  of clear time between that event and any other event at the same venue. Two events A and B at
  the same venue conflict when `(A.start − 60 min) < B.end` **and** `(B.start − 60 min) < A.end`.
  The required clearance between consecutive events is 60 minutes, not 120.
- **FR-014**: An update MUST be checked against the event's destination venue and window, and MUST
  exclude the event itself.
- **FR-015**: Identical windows at different venues MUST be allowed.
- **FR-016**: A conflict MUST be refused with a machine-readable error that identifies it as a
  scheduling conflict and names the existing event.
- **FR-017**: Two conflicting requests submitted at the same instant MUST NOT both be accepted.
- **FR-018**: The conflict rule MUST be enforced by the API, so a client bypassing the Admin app is
  refused identically.

#### Authorization

- **FR-019**: Every venue and event endpoint MUST require a valid access token, as defined in
  `001`.
- **FR-020**: Every venue and event create, update, and delete MUST require the QueuePass Admin
  role, and MUST be refused with an authorization error otherwise.
- **FR-021**: Venue and event reads MUST be open to any signed-in user regardless of role.

#### API Contract

- **FR-022**: Every endpoint in this feature MUST be added to the shared API contract, with its
  request and response shapes, required role, and every error it can return, before it is
  implemented.

#### Admin App

- **FR-023**: The Admin app MUST obtain and change all data only through the API, using the
  signed-in admin's token.
- **FR-024**: The Admin app MUST provide screens to list, view, create, edit, and delete venues.
- **FR-025**: The Admin app MUST provide screens to list, view, create, edit, and delete events,
  with the venue chosen from the existing venues.
- **FR-026**: The Admin app MUST ask for confirmation before deleting a venue or an event.
- **FR-027**: The Admin app MUST show an explicit success state when a venue or event is saved or
  deleted.
- **FR-028**: The Admin app MUST show an explicit, visually distinct error banner when the API
  refuses a double-booking, stating the venue is already committed and naming the conflicting
  event.
- **FR-029**: The Admin app MUST show other refusals (invalid fields, a venue that still has
  events, a record that no longer exists) as visible, specific errors.
- **FR-030**: The Admin app MUST keep the admin's entered values when a save is refused.
- **FR-031**: The Admin app MUST show event times in the admin's local time zone and send them to
  the API as UTC instants.
- **FR-032**: The Admin app's existing sign-in, role check, and logout from `001` MUST remain on
  every screen.

#### Testing

- **FR-033**: Automated tests MUST verify venue and event records are written to and read back
  from a real database.
- **FR-034**: Automated tests MUST verify that an overlapping attempt at the same venue is
  refused, a non-overlapping one at the same venue is accepted, and an overlapping one at a
  different venue is accepted, across partial overlap at either end, containment, identical
  windows, and buffer encroachment.
- **FR-035**: Automated tests MUST cover both sides of the 60-minute boundary (21:59 refused and
  22:00 accepted, against an event ending at 21:00) and the simultaneous-submission case.
- **FR-036**: Automated tests MUST cover, for every venue and event endpoint, the no-token case,
  the wrong-role case (customer and gate agent), and the admin case.
- **FR-037**: Automated tests MUST cover the Admin app's create, edit, delete confirmation,
  conflict banner, and kept-values behavior.

### Key Entities

- **Venue**: A physical place where events are held. It has a name, a street address, and a
  seating capacity. It may host many events over time, but only one in any window once the buffer
  is counted. It cannot be removed while events reference it.
- **Event**: A scheduled happening at exactly one venue. It has a name, a start time, an end time,
  a total ticket capacity, and a base ticket price. Its buffered window must not overlap another
  event's at the same venue.
- **QueuePass Admin**: A signed-in user with the admin role; the only user who can change venues
  and events.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in admin can create a venue and schedule an event at it in under 3 minutes
  on first use of the Admin app.
- **SC-002**: A signed-in admin can create, read, update, and delete a venue and an event, all
  from the Admin app, without using any other tool.
- **SC-003**: 100% of venue and event records present before a full restart are present after it.
- **SC-004**: 100% of double-booking attempts at the same venue are refused across every overlap
  shape; 0 are accepted.
- **SC-005**: 0% of valid bookings are refused: same-venue bookings 60 or more minutes apart and
  same-window bookings at different venues are always accepted.
- **SC-006**: An admin who attempts a double-booking can tell from the screen alone that the venue
  is already committed and which event it conflicts with.
- **SC-007**: 100% of change requests from non-admins, and 100% of requests without a valid token,
  are refused.
- **SC-008**: Every refusal an admin can trigger in the Admin app produces a specific, readable
  explanation; none results in a blank screen, a silent no-op, or a generic failure.
- **SC-009**: The full test suite passes from a clean checkout using the documented test command,
  and covers every case in SC-004, SC-005, and SC-007.

## Assumptions

- **Time boundary convention**: Windows are half-open. An event from 18:00 to 21:00 holds the
  instant 18:00 and releases 21:00. Conflicts are checked on windows expanded by the buffer.
- **Buffer**: A fixed 60 minutes before and after every event, the same for all venues. A
  per-venue buffer is out of scope.
- **Capacity ceiling**: An event's ticket capacity may not exceed its venue's seating capacity.
- **Venue deletion with events**: Refused rather than cascading, because silently deleting
  scheduled events is unrecoverable. The admin deletes the events first.
- **Reads open to every signed-in role**: Customers need them for `003`, and gate agents will
  need them later.
- **Price**: A non-negative exact amount in USD.
- **Scale**: A few hundred venues and events; no throughput targets, but concurrent conflicting
  writes must still be safe.
- **Existing code**: The repository already implements the venue and event rules and the Admin
  app's list, create, and edit screens without sign-in. That behavior is the starting point, but
  this spec, not that code, is authoritative.

## Out of Scope

- Customer app screens (feature `003`) and any Ticket Booth functionality.
- Event lifecycle states (draft, published, cancelled), ticket sales, orders, payment, ticket
  codes, and check-in.
- Recurring or multi-day event series, and event templates.
- Search, filtering, and pagination beyond listing everything.
- Per-venue buffer configuration.
- Visual design, branding, and theming.
