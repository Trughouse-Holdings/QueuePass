# Feature Specification: Customer Venue and Event Browsing

**Feature Branch**: `003-customer-venues-events`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "In the customer app, show all the venues and events. The front-end
apps can only communicate with the database through OpenAPI-style REST APIs to the back-end app."

## Context

This feature builds on `001-bare-bones-system` (sign-in and the stub Customer app) and
`002-admin-venues-events` (the venue and event API). It is front-end only: it uses the read
endpoints `002` defines, which are open to any signed-in user, and adds no Backend endpoints,
schema changes, or contract changes. If it turns out the API is missing something, that change is
made in its own shared-surface pull request first.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse All Events (Priority: P1)

A signed-in customer opens the Customer app and sees every scheduled event: its name, its venue,
when it starts and ends in their own local time, and its base ticket price. Events are listed
soonest first, so what is coming up next is at the top.

**Why this priority**: Events are what a customer comes to see. This is the smallest slice that
gives them value.

**Independent Test**: With at least two events scheduled by an admin, sign in to the Customer app
as `customer1` and confirm both appear, soonest first, with name, venue, local times, and price.

**Acceptance Scenarios**:

1. **Given** scheduled events, **When** a signed-in customer opens the Customer app, **Then** they
   see every event with its name, venue name, start and end times in their local time zone, and
   base price in USD.
2. **Given** events on different dates, **When** the list is shown, **Then** it is ordered by
   start time, soonest first.
3. **Given** no events, **When** the customer opens the list, **Then** they see a plain message
   that nothing is scheduled, not a blank page.
4. **Given** an admin changed or added an event, **When** the customer reloads the page,
   **Then** they see the current data.

---

### User Story 2 - Browse All Venues and What Is On at Each (Priority: P2)

A signed-in customer switches to the venue list and sees every venue with its name, address, and
seating capacity. Opening a venue shows its details and the events scheduled there.

**Why this priority**: It answers "what is on at this place", which the event list alone does not.

**Independent Test**: With two venues, one of them with events, sign in as `customer1`, open the
venue list, confirm both venues appear, open the one with events, and confirm its events are
listed.

**Acceptance Scenarios**:

1. **Given** venues on file, **When** a signed-in customer opens the venue list, **Then** they see
   each venue's name, address, and seating capacity, in alphabetical order by name.
2. **Given** a venue with events, **When** the customer opens it, **Then** they see its details
   and its events, soonest first.
3. **Given** a venue with no events, **When** the customer opens it, **Then** they see its details
   and a plain message that nothing is scheduled there.
4. **Given** an event in the event list, **When** the customer opens it, **Then** they see its
   details and can go to its venue.

---

### User Story 3 - The Customer App Is Read-Only and Signed-In Only (Priority: P3)

The Customer app shows venues and events but offers no way to change them, and it keeps the
sign-in, role check, and logout from `001` on every page.

**Why this priority**: It protects the boundary the rest of the system relies on, and it is
verified by checking the absence of controls and the presence of sign-in.

**Independent Test**: Signed in as `customer1`, confirm no page offers create, edit, or delete.
Log out, open a venue's address directly, and confirm the login page appears.

**Acceptance Scenarios**:

1. **Given** any Customer app page, **When** a customer looks at it, **Then** it has no create,
   edit, or delete controls.
2. **Given** a visitor who is not signed in, **When** they open any list or detail page directly,
   **Then** they are sent to the login page and shown no data.
3. **Given** a signed-in admin or gate agent, **When** they open the Customer app, **Then** they
   see the wrong-role message from `001` and no venue or event data.
4. **Given** any signed-in page, **When** the customer clicks logout, **Then** they are signed out
   as described in `001`.

---

### Edge Cases

- **Event or venue removed while being viewed**: Opening a detail page for a record that no
  longer exists shows a plain "no longer available" message with a way back to the list.
- **Backend unreachable**: The page says the service cannot be reached instead of showing a blank
  or stale list.
- **Session expires while browsing**: The next data load renews sign-in silently or returns the
  customer to the login page.
- **Events crossing midnight**: Shown with both dates, so an event from 22:00 to 02:00 is not
  mistaken for one that ends before it starts.
- **Past events**: Shown along with future ones, since the requirement is "all events"; ordering
  puts them last only if a later spec asks.
- **Long names and addresses**: Wrap rather than overflow or truncate silently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Customer app MUST show a list of all events with each event's name, venue name,
  start and end times, and base price.
- **FR-002**: The event list MUST be ordered by start time, soonest first.
- **FR-003**: The Customer app MUST show a list of all venues with each venue's name, address, and
  seating capacity, ordered by name.
- **FR-004**: The Customer app MUST show a venue detail page with the venue's details and its
  events, soonest first.
- **FR-005**: The Customer app MUST show an event detail page with the event's details and a way
  to reach its venue.
- **FR-006**: The Customer app MUST show times in the viewer's local time zone, including the date
  on both start and end.
- **FR-007**: The Customer app MUST show prices as USD amounts.
- **FR-008**: Empty lists and missing records MUST show a plain message, never a blank page.
- **FR-009**: The Customer app MUST NOT offer any control that creates, changes, or deletes a
  venue or event.
- **FR-010**: The Customer app MUST obtain all data only through the Backend API's venue and event
  read endpoints, using the signed-in customer's token, and MUST NOT contain database access code.
- **FR-011**: The Customer app MUST keep `001`'s sign-in requirement, `customer` role check, and
  logout control on every page.
- **FR-012**: This feature MUST NOT add or change Backend endpoints, the database schema, or the
  API contract.
- **FR-013**: Automated tests MUST cover the event list, its ordering, the venue list, both detail
  pages, the empty and missing-record messages, local-time display, and the absence of change
  controls.
- **FR-014**: The smoke test MUST confirm that an event an admin creates in the Admin app appears
  in the Customer app after a reload.

### Key Entities

- **Venue** and **Event**: As defined in `002`. The Customer app only reads them.
- **Customer**: A signed-in user with the customer role.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in customer can find when and where a named event happens in under 30
  seconds on first use.
- **SC-002**: 100% of venues and events stored in the system appear in the Customer app.
- **SC-003**: 0 Customer app pages offer a create, edit, or delete control.
- **SC-004**: 100% of Customer app pages opened while signed out, or signed in with a role other
  than customer, show no venue or event data.
- **SC-005**: An event created in the Admin app appears in the Customer app on the next reload.
- **SC-006**: The full test suite passes from a clean checkout using the documented test command.

## Assumptions

- **All means all**: Past and future events are both shown, because the requirement says "all".
  Hiding past events is a later decision.
- **No lifecycle states yet**: Every stored event is shown. Once a later spec adds draft or
  cancelled states, it decides what customers see.
- **No live updates**: Reloading the page shows the latest data; automatic refresh is out of
  scope.
- **Scale**: A few hundred venues and events, so everything is listed on one page without
  pagination.

## Out of Scope

- Ticket purchase, carts, orders, payment, and ticket codes.
- Search, filtering, sorting controls, and pagination.
- Maps, images, and venue seating charts.
- Any Backend, schema, or contract change.
- Visual design, branding, and theming.
