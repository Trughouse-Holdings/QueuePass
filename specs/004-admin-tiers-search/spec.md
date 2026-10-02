# Feature Specification: Admin Ticket Tiers and Search

**Feature Branch**: `004-admin-tiers-search`

**Created**: 2026-10-01

**Status**: Ready for review

**Input**: User description: "Add ticket tiers (several ticket types per event, such as General and
VIP, each with its own price and quantity) and search and filters (find events by name, venue, or
date range, and venues by name or city) to the admin app."

## Context

Builds on `002` (venues and events). Today an event has one ticket capacity and one base price.
The requirements emails ask the system to "remain flexible" because "different events may have
different operational needs", and Paul's team will run more and more events, so finding one by
scrolling stops working. This feature adds both. It does not sell tickets; `005` adds orders and
`006` lets customers buy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ticket Tiers (Priority: P1)

An admin opens an event and defines its ticket tiers, for example General at $45.00 for 15,000
tickets and VIP at $120.00 for 500. They can add, rename, reprice, resize, and remove tiers. The
tiers' quantities together can never exceed the event's ticket capacity.

**Why this priority**: Tiers are what later features sell (`005`, `006`). Getting them right
first means orders never need to be reworked.

**Independent Test**: Create an event with capacity 1,000. Add General (800 at $45.00) and VIP
(200 at $120.00). Try to add a third tier of 1 ticket and confirm it is refused, naming the
capacity left (0).

**Acceptance Scenarios**:

1. **Given** an event, **When** an admin adds a tier with a name, price, and quantity, **Then** it
   is saved and shown on the event page.
2. **Given** tiers whose quantities total the event's capacity, **When** an admin adds or enlarges
   a tier, **Then** it is refused with a message saying how many tickets remain unallocated.
3. **Given** tiers totaling 900, **When** an admin lowers the event's ticket capacity below 900,
   **Then** the change is refused, naming the tier total.
4. **Given** a tier named "VIP", **When** an admin adds another tier named "vip" to the same
   event, **Then** it is refused because names must be unique within an event, ignoring case.
5. **Given** a tier, **When** an admin edits or removes it, **Then** the change is saved and the
   event page shows the current tiers.
6. **Given** an event with no tiers, **Then** it behaves exactly as before: its base price and
   ticket capacity describe a single admission type.

---

### User Story 2 - Search and Filter Events (Priority: P2)

An admin narrows the event list by typing part of an event's name, choosing a venue, and setting
a date range. The list updates to show only matching events, still soonest first.

**Why this priority**: The event list grows fastest and is used most.

**Independent Test**: With five events across two venues and two months, filter by "show", by one
venue, and by a date range, and confirm each result set.

**Acceptance Scenarios**:

1. **Given** events, **When** an admin types text, **Then** only events whose name contains it,
   ignoring case, are listed.
2. **Given** events at several venues, **When** an admin picks a venue, **Then** only that venue's
   events are listed.
3. **Given** a from date and a to date, **When** the admin applies them, **Then** only events
   starting on or after the from date and before the end of the to date are listed.
4. **Given** filters that match nothing, **Then** the page says no events match and offers to
   clear the filters.
5. **Given** filters are applied, **When** the admin reloads or shares the page address, **Then**
   the same filters are still applied.

---

### User Story 3 - Search Venues (Priority: P3)

An admin types part of a venue's name or address, such as a city, and the venue list shows only
matching venues, still by name.

**Independent Test**: With venues in Louisville and Lexington, type "lexington" and confirm only
that venue is listed.

**Acceptance Scenarios**:

1. **Given** venues, **When** an admin types text, **Then** only venues whose name or address
   contains it, ignoring case, are listed.
2. **Given** text that matches nothing, **Then** the page says no venues match.

---

### Edge Cases

- **Tier price of zero**: allowed (complimentary tickets).
- **Concurrent tier edits**: two admins adding tiers to the same event at once can never push the
  total over capacity.
- **Deleting an event**: deletes its tiers with it.
- **Date range with from after to**: refused with a validation message.
- **Search text with only spaces**: treated as no search.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each event MUST support zero or more ticket tiers, each with a name (1–100
  characters), a non-negative price in USD with at most two decimal places, and a positive whole
  quantity.
- **FR-002**: Tier names MUST be unique within an event, ignoring case.
- **FR-003**: The sum of an event's tier quantities MUST NOT exceed its ticket capacity, including
  under concurrent requests. A refusal MUST say how many tickets remain unallocated.
- **FR-004**: Lowering an event's ticket capacity below the sum of its tier quantities MUST be
  refused, naming that sum.
- **FR-005**: Admins MUST be able to create, list, update, and delete an event's tiers. Any
  signed-in user MAY list them; only admins MAY change them.
- **FR-006**: The event list MUST be filterable by name text, venue, and a start-date range,
  combinable, keeping the soonest-first order.
- **FR-007**: The venue list MUST be filterable by text matched against name or address, keeping
  name order.
- **FR-008**: Filters MUST be reflected in the page address so reload and sharing keep them.
- **FR-009**: Text matching MUST ignore case and surrounding spaces.
- **FR-010**: All changes MUST go through the Backend API; the API contract MUST be updated before
  implementation (Constitution I).
- **FR-011**: Automated tests MUST cover tier persistence, the capacity rule on both sides of the
  boundary and under concurrency, name uniqueness, role enforcement, and every filter.

### Key Entities

- **Ticket tier**: belongs to one event; name, price, quantity.
- **Event** and **Venue**: as in `002`.

## Success Criteria *(mandatory)*

- **SC-001**: An admin can define three tiers for an event in under 2 minutes.
- **SC-002**: 0 events ever have tier quantities summing above their ticket capacity.
- **SC-003**: An admin can find a named event among 200 in under 10 seconds.
- **SC-004**: The full test suite passes from a clean checkout.

## Assumptions

- **Base price stays**: `basePrice` remains on the event as the price for events that have no
  tiers, so `003`'s Customer app keeps working unchanged.
- **Unallocated capacity is allowed**: tiers may total less than the event's capacity.
- **Date filtering uses the admin's local dates**, converted to instants by the Admin app.
- **No pagination**: a few hundred events still fit on one page.

## Out of Scope

- Selling tickets, orders, and sold counts (`005`).
- Customer-facing tiers (`006`).
- Saved searches, sorting controls, and full-text search.
