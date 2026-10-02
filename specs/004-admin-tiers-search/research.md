# Research: Admin Ticket Tiers and Search

Decisions for feature `004`, planned under constitution v2.1.0 on top of `002` and `003`.

## R1: Tiers are a child table, and `basePrice` stays

**Decision**: a `TicketTier` table with `eventId` (FK, `ON DELETE CASCADE`), `name`, `price`
(`numeric(10,2)`), `quantity`. The event keeps `totalTicketCapacity` and `basePrice`. An event
with no tiers sells one admission type at `basePrice`; one with tiers sells only its tiers (used
by `005`).

**Alternatives rejected**: replacing `basePrice` with tiers would break `003`'s Customer app and
every existing event; embedding tiers as JSON on the event loses the per-tier constraints.

**Cascade on event delete**: tiers have no meaning without their event. `005` adds orders, whose
foreign keys are `RESTRICT`, so an event with orders still cannot be deleted.

## R2: The capacity rule needs a row lock

FR-003 compares a sum over rows (the tiers) with a value on another row (the event). A CHECK
constraint cannot do that, and a read-then-insert races. **Decision**: every tier create or
update, and every event update that changes `totalTicketCapacity`, runs in a transaction that
first executes `SELECT … FROM "Event" WHERE id = $1 FOR UPDATE`. Concurrent writers for the same
event serialize on that lock; writers for different events do not block each other. The refusal
is `409 CAPACITY_EXCEEDED` with `details: { totalTicketCapacity, allocated, requested,
remaining }` for tiers, and `{ proposedTicketCapacity, tierTotal }` for event edits.

`events.update` moves into the same kind of transaction. Its scheduling pre-check and the
`event_no_overlap` constraint are unchanged, and the deadlock retry wraps the whole transaction.

## R3: Case-insensitive unique names

**Decision**: a unique index `ticket_tier_event_name_unique ON "TicketTier" ("eventId",
lower("name"))` in hand-written migration SQL, like `002`'s exclusion constraint. The service
checks first so the refusal can name the tier (`409 TIER_NAME_TAKEN`); if a concurrent insert wins,
Prisma's `P2002` is mapped to the same code by the exception filter. Names are trimmed.

CHECK constraints: `price >= 0`, `quantity > 0`, `length(trim(name)) between 1 and 100`.

## R4: Search parameters

| Operation | Parameter | Meaning |
|---|---|---|
| `GET /events` | `q` | `name ILIKE %q%` after trimming; blank ignored |
| `GET /events` | `from` | `startsAt >= from` |
| `GET /events` | `to` | `startsAt < to`; `from >= to` is `400` |
| `GET /locations` | `q` | `name ILIKE %q% OR address ILIKE %q%` |

Validated by query DTOs (`ListEventsQuery`, `ListLocationsQuery`) so malformed values are `400`
through the existing global `ValidationPipe`, which also starts rejecting unknown query keys and a
malformed `locationId` (previously a `500`). Orders are unchanged: events by `startsAt`, venues by
`name`. `%` and `_` in `q` are matched literally (Prisma's `contains` escapes them).

## R5: Admin filters live in the URL

The event list renders a search form (text, venue select, from date, to date, **Search**,
**Clear**). Submitting writes the filters to the query string with `useSearchParams`, and the
list fetches from the query string, so reload and shared links keep them (FR-008). Dates are the
admin's local calendar days: `from` = local midnight of the from-date, `to` = local midnight of
the day after the to-date, both sent as ISO instants. The venue list does the same with `q`.

## R6: Contract 1.2.0

Additive only: two paths (`/events/{id}/tiers`, `/events/{id}/tiers/{tierId}`), three schemas
(`TicketTier`, `TicketTierInput`, `TicketTierUpdate`), one error code (`TIER_NAME_TAKEN`), new
query parameters, and a `400` on `listLocations`. `api-schema.ts` is regenerated in this PR.

## R7: Admin tier UI

A **Ticket tiers** card on the event page: a table (name, price, quantity, Edit, Remove), an
"Allocated N of M" line, and an add form. Editing turns a row into inputs with Save and Cancel.
Remove asks `window.confirm`, like `002`'s deletes. Backend refusals show in the existing
`ErrorBanner`, keeping the typed values (Constitution IV).
