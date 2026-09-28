# Data Model: Admin Venue and Event Management

**Feature**: `002-admin-venues-events` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md) |
**Research**: [research.md](./research.md)

**No schema change and no new migration.** Both tables, their constraints, and the exclusion
constraint already exist in `backend/prisma/schema.prisma` and its migrations. This document
states the model `002` relies on, with emphasis on **deletion**, which is what `002` exposes in
the Admin app.

In the API and the database a venue is a `Location` (research R8).

## Entity: Location (venue)

| Field | Type | Constraints | Requirement |
|---|---|---|---|
| `id` | `uuid` | PK, generated | — |
| `name` | `text` | NOT NULL, 1–200 characters after trimming | FR-001, FR-005 |
| `address` | `text` | NOT NULL, 1–500 characters after trimming | FR-001, FR-005 |
| `seatingCapacity` | `integer` | NOT NULL, `CHECK (> 0)` | FR-001, FR-005 |
| `createdAt`, `updatedAt` | `timestamptz` | NOT NULL, managed | — |

**Validation**

- `name` and `address` are refused when empty or whitespace-only (FR-005).
- `seatingCapacity` must be a positive whole number (FR-005).
- Lowering `seatingCapacity` below any of the venue's events' `totalTicketCapacity` is refused
  with `409 CAPACITY_EXCEEDED`, naming the event (FR-006).

## Entity: Event

| Field | Type | Constraints | Requirement |
|---|---|---|---|
| `id` | `uuid` | PK, generated | — |
| `name` | `text` | NOT NULL, 1–200 characters after trimming | FR-007, FR-011 |
| `locationId` | `uuid` | NOT NULL, FK → `Location.id`, **`ON DELETE RESTRICT`** | FR-004, FR-011 |
| `startsAt` | `timestamptz` | NOT NULL | FR-007, FR-012 |
| `endsAt` | `timestamptz` | NOT NULL, `CHECK ("endsAt" > "startsAt")` | FR-011 |
| `totalTicketCapacity` | `integer` | NOT NULL, `CHECK (> 0)`, ≤ venue `seatingCapacity` (service) | FR-011 |
| `basePrice` | `numeric(10,2)` | NOT NULL, `CHECK (>= 0)`; exchanged as a decimal string | FR-011 |
| `createdAt`, `updatedAt` | `timestamptz` | NOT NULL, managed | — |

**Index**: `locationId`, used by the venue detail page's event list
(`GET /events?locationId=`).

**Scheduling constraint** (FR-013–FR-018): the database refuses any overlap of the windows
below, using the exclusion constraint `event_no_overlap`
([research R2](./research.md#r2-the-60-minute-rule-carried-forward-unchanged)):

```sql
EXCLUDE USING gist ("locationId" WITH =, tstzrange("startsAt" - interval '60 minutes', "endsAt", '[)') WITH &&)
```

## Relationship

```text
Location 1 ───< N Event        ON DELETE RESTRICT
```

## Deletion

Both deletes are **hard deletes**, which cannot be undone. There is no soft-delete flag and no
trash (spec: no lifecycle states in `002`).

### Deleting an event (FR-010)

| Precondition | Result |
|---|---|
| The event exists | Row deleted, `204`. Its buffered window leaves the exclusion index at once, so the slot is free for scheduling (US2-8). |
| The event does not exist (for example, already deleted) | `404 NOT_FOUND` |

Nothing references an event in `002`, so an event can always be deleted.

### Deleting a venue (FR-004)

| Precondition | Result |
|---|---|
| The venue exists and has no events | Row deleted, `204` |
| The venue has ≥ 1 event | `409 VENUE_HAS_EVENTS`, with `details.eventCount` and a message naming the venue and the count (research R7). The venue and its events are unchanged. |
| An event is added between the service's count and the delete (race) | The FK refuses. `409 VENUE_HAS_EVENTS` with the generic message and no `eventCount`. Still refused; never orphaned. |
| The venue does not exist | `404 NOT_FOUND` |

**Two layers, one guarantee**: the service's event count exists only so the message can be
specific. The foreign key's `ON DELETE RESTRICT` is what makes orphaned events impossible for
every writer, including one that bypasses the service. There is no cascade: silently deleting
scheduled events would be unrecoverable (spec Assumptions).

**Order for an admin who wants a venue gone**: delete (or move) its events first, then delete
the venue. The venue detail page lists those events directly under the refusal message
(research R5, R6).

## Identity

Users live in Keycloak, not in PostgreSQL. `002` adds no user columns. Who may delete is decided
per request from the validated token's roles: only `queuepass-admin` (FR-020, enforced by the
`001` roles guard). No audit record of *who* deleted is kept. The spec does not ask for one,
and adding it would be a new table no requirement reads (Constitution VIII).

## Admin app view state (new pages)

| Page | Loads | States |
|---|---|---|
| Venue detail `/locations/:id` | `getLocation`, `listEvents?locationId` | loading · shown (with events, or "Nothing is scheduled here.") · not found · unreachable |
| Event detail `/events/:id` | `getEvent` (venue embedded) | loading · shown · not found · unreachable |
| Delete (both pages) | `deleteLocation` / `deleteEvent` after `window.confirm` | idle · confirming (native dialog) · deleting (button disabled) · done (navigate) · refused (banner) |
