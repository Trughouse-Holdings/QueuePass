# Research: Admin Venue and Event Management

Decisions for feature `002`, planned under constitution v2.0.0 on top of the built feature `001`.
The stack is fixed by the constitution; sign-in, token validation, and role enforcement already
exist (spec `001`). This plan's centre of gravity is **delete for venues and events in the Admin
app**, plus the view screens and contract updates the spec requires around it.

## R1: What already exists and is kept

`001` carried the venue and event API forward, protected by tokens and roles (research `001`
R14). Verified against the code and its 113 passing Backend tests:

| Spec 002 requirement | Already satisfied by | Evidence |
|---|---|---|
| FR-001–FR-003, FR-007–FR-009 create, read, update | `/locations`, `/events` controllers | `locations.crud`, `events.crud` specs |
| FR-004 delete a venue; refuse while it has events | `DELETE /locations/{id}`; FK `ON DELETE RESTRICT` → `409 VENUE_HAS_EVENTS` | `locations.delete` spec, including a direct-SQL bypass attempt |
| FR-005, FR-011 field validation | DTOs + `ValidationPipe` | `locations.validation`, `events.validation` |
| FR-006 capacity lowering refused, naming the event | `LocationsService.update` | `locations.capacity` |
| FR-010 delete an event; window freed | `DELETE /events/{id}` | `events.crud` "deletes an event and frees the window" |
| FR-012 UTC, half-open windows | `timestamptz`; contract description | `events.buffer-boundary` |
| FR-013–FR-018 the 60-minute rule, including races | `event_no_overlap` exclusion constraint + pre-check (R2) | `events.conflict*`, `events.concurrency` |
| FR-019–FR-021 tokens and roles | `001` guards; `@Roles('queuepass-admin')` on writes | `carried-over.authz`, `route-coverage` |
| FR-028, FR-030 conflict banner, kept values | `EventForm`, `ErrorBanner` | `EventForm.conflict.test.tsx` |
| FR-031 local time shown, UTC sent | `EventForm` `toIso` / `toLocalInput`; `EventList` `toLocale*` | code |

**Decision**: keep all of it unchanged. The gaps are delete and view screens in the Admin app,
a richer venue-delete refusal, and contract housekeeping.

## R2: The 60-minute rule (carried forward, unchanged)

**Decision**: the rule stays a PostgreSQL exclusion constraint, with the service pre-check only
naming the conflicting event:

```sql
EXCLUDE USING gist ("locationId" WITH =, tstzrange("startsAt" - interval '60 minutes', "endsAt", '[)') WITH &&)
```

Shifting only the lower bound gives exactly 60 minutes of clearance (not 120). Against an event
from 18:00 to 21:00, a start at 21:59 overlaps `[17:00, 21:00)` and is refused, while a start at
22:00 does not. Only a database constraint closes the race between a read and a write
(FR-017). The full derivation is in the constraint migration
`backend/prisma/migrations/20260920000001_scheduling_constraints/migration.sql` and its tests.

**Relevance to delete**: deleting an event removes its row, so its buffered range leaves the
index and the window is free immediately (FR-010). No extra work is needed.

## R3: Where delete lives in the Admin app

**Decision**: delete lives on the new **detail pages** (`/locations/:id` and `/events/:id`,
R6), next to Edit. List rows link their name to the detail page and keep their Edit link. There
is no delete button in list rows.

**Rationale**: the admin sees exactly what they are about to delete, including a venue's events,
before choosing Delete. It also puts a destructive control one deliberate click away from a
list, where a mis-click is likeliest.

**Rejected**

- *Delete in every list row*: fastest, but it is the easiest place to delete the wrong record,
  and a venue row cannot show why the venue cannot be deleted.
- *Delete on the edit form*: it mixes a destructive action into a form whose Save button is the
  primary action.

## R4: Confirmation before delete (FR-026)

**Decision**: use the browser's native `window.confirm`, with a message that names the record,
for example `Delete the venue "Freedom Hall"? This cannot be undone.` The request is sent only
if the admin confirms. Cancel does nothing and sends nothing.

**Rationale**: it is accessible by default (keyboard, screen readers, focus trapping), needs no
code to build, and is trivially testable with `vi.spyOn(window, 'confirm')`. Constitution VII
rules out spending effort on a custom dialog.

**Rejected**: *a custom modal or a `<dialog>` element*. It is more code, and it needs focus
management, Escape handling, and styling, for no functional gain at this stage.

## R5: What the admin sees after a delete (FR-027, FR-029)

| API result | Admin app behavior |
|---|---|
| `204` | Navigate to the list, which shows a success state: `Deleted "<name>".` The message travels in router navigation state, so a reload does not repeat it. |
| `409 VENUE_HAS_EVENTS` | Stay on the venue page. Show an error banner with the API's message, for example `Cannot delete "Freedom Hall": 3 events are still scheduled there. Delete or move them first.` The venue's event list stays visible directly below, so the admin can act on it. |
| `404 NOT_FOUND` (another admin deleted it first) | Navigate to the list, which is fetched fresh, with the message `"<name>" no longer exists. The list has been refreshed.` |
| `401` | Sign in again, as `001` already does for every API call. |
| `403` | Cannot happen for an admin. If it does, show the API's message; never retry silently. |
| Network error | Error banner: `Can't reach the QueuePass service.` Stay on the page. |

The Delete button is disabled while its request is in flight, so a double click cannot send two
deletes.

## R6: Detail pages (FR-024, FR-025; US1-2)

**Decision**: add two read-only pages.

- **`/locations/:id`, venue detail**: name, address, seating capacity, and that venue's events
  from `GET /events?locationId=<id>`, soonest first, each linking to its event page. Buttons:
  Edit and Delete. When the venue has no events, the page says so plainly.
- **`/events/:id`, event detail**: name, a venue link, start and end in the admin's local time
  with dates on both, ticket capacity, and price. Buttons: Edit and Delete.

A missing record (`404`) shows `This venue no longer exists.` (or event) with a link back to
the list, never a blank page.

**Rejected**: *reusing the edit form in a read-only mode*. It is a different job, and a form
invites accidental edits.

## R7: A clearer venue-delete refusal

**Problem**: the database path returns the generic `Cannot delete this venue; events are still
scheduled at it.` Spec US1-7 asks that the admin be told the venue still has events. The
contract's own example promises `details.eventCount`, but the implementation never sends it.

**Decision**: `LocationsService.remove` counts the venue's events first. If there are any, it
throws `409 VENUE_HAS_EVENTS` with message `Cannot delete "<name>": 1 event is still scheduled
there. Delete or move them first.` (or `3 events are …` when plural) and
`details: { eventCount: n }`. The FK
`ON DELETE RESTRICT` remains the enforcement: an event inserted between the count and the
delete still makes the database refuse, and that path keeps the generic message, with
`details.eventCount` omitted.

This is the same two-layer pattern as the scheduling rule (R2). The pre-check exists for the
message; the constraint is the guarantee (Constitution IV).

## R8: Paths stay `/locations`, not `/venues`

**Decision**: keep `/locations` and `/events`, and their operation IDs. The spec says "venue"
in its prose; the contract documents that `Location` is the venue.

**Rationale**: renaming breaks nothing for users and gains nothing for them. It would change 10
contract operations, the generated types, every Backend and Admin test, and feature `003`'s
future calls. Constitution VIII (YAGNI) applies.

**Rejected**: *renaming to `/venues`*. It is cosmetic, it touches shared surface, and `003`
would need it merged first.

## R9: Contract changes in this plan

These are made to [`contracts/openapi.yaml`](../../contracts/openapi.yaml) now, before
implementation (Constitution I):

1. Retag the 10 `carried-over` operations as `venues` or `events`, and delete the
   `carried-over` tag. `002` now owns them.
2. Add a `VenueHasEvents` schema (`ErrorEnvelope` whose `details.eventCount` is an optional
   integer ≥ 1), used by `deleteLocation`'s `409`.
3. State in the descriptions that `listLocations` is ordered by name and `listEvents` by
   `startsAt`. Feature `003` relies on both orders (its FR-002, FR-003).
4. Document on both delete operations that they are irreversible and that clients must confirm
   first.

No operation is added, removed, or reshaped, so the `001` route-coverage test is unaffected.
`api-schema.ts` is regenerated.

## R10: Tests

| Layer | New tests |
|---|---|
| Backend | `locations.delete`: the refusal includes `eventCount` and the venue name; the count is correct for 1 and for 3 events; deleting an unknown id is `404`; deleting twice is `204` then `404`. `events.crud`: deleting twice is `204` then `404`. All responses are contract-validated automatically by the `001` helper. |
| Admin app | Venue and event detail pages: render, missing record, and a venue with no events. Delete flows: confirm → `204` → list shows the success state; cancel sends no request; `409` shows the banner and keeps the page; `404` goes back to a refreshed list; the button is disabled in flight; a network error shows the banner. |
| Browser (manual, [quickstart.md](./quickstart.md)) | The full delete round trip in real Chrome, including the refusal for a venue with events and the freed event window. |

Existing tests for create, edit, conflict, and kept values stay as they are (FR-037).
