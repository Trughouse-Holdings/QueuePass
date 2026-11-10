# Data Model: Event Form Flow

**Feature**: `035-event-form-flow` | **Spec**: [spec.md](./spec.md)

**No schema change.** `backend/prisma/` is unchanged: no table, column, constraint, index, or
migration. An update that includes the setup writes the same rows today's separate requests write
(`updateEvent`, `createTier` / `updateTier` / `deleteTier`, `updateSeating`), in one transaction.

## What one setup-update writes (research R8)

In one transaction, after every check has passed, in this order:

| Table | Rows | Values |
| --- | --- | --- |
| `Event` | the existing row, updated | details as today, plus `reservedSeating` from the request; with reserved seating, `totalTicketCapacity` is the layout's total seats |
| `TicketTier` | update each entry that sent an `id`; insert each entry without one; delete each existing type not listed | `name` (trimmed), `price`; `quantity`: the typed one without reserved seating, else the seats of its `sectionIds` |
| `SectionTier` | replaced for the event | `eventId`, `sectionId`, `tierId` of the type that lists it; previous mappings for the event are removed first |
| Reservations | closed, as `updateSeating` does today, when reserved seating is turned off or a section's type changes (`015` FR-016) | existing close helpers; seats published as open after commit |

Nothing else is written: no image, order, or ticket change. Pictures are uploaded afterwards by
separate requests (`014`, unchanged).

A refusal or a failure at any point leaves the event, its ticket types, its mappings, and its
holds as they were before the request (FR-018).

A request without `tiers` and `reservedSeating` writes only what today's `updateEvent` writes.

## What guarantees what (Constitution IV)

| Rule | Checked by | Guaranteed under concurrency by |
| --- | --- | --- |
| 60 minutes between events at a venue | `assertNoConflict`, as today | `event_no_overlap` exclusion constraint |
| Ticket type names unique per event, ignoring case | the planner, across the request, treating kept ids as themselves | unique index `("eventId", lower("name"))` on `TicketTier` |
| A section sells one ticket type per event | the planner | primary key `("eventId", "sectionId")` on `SectionTier` |
| Sections belong to the event's venue's current layout | the planner, against the sections read in the transaction | the venue row held `FOR SHARE` |
| A type is not removed if it has orders | count of `Order` for that `tierId`, as today | `Order.tierId` ON DELETE RESTRICT |
| A type's quantity is not below tickets sold | `ticketsSold` for that type | the event row lock, the same one sales take |
| Reserved seating is not switched, and a section with sold seats is not remapped | counts of valid tickets, as `SeatMapService.update` does today | the event row lock |
| Ticket types fit the capacity (general admission) | the planner | the event is locked for the transaction |
| Tickets per customer within the capacity | `assertLimitWithinCapacity` | `event_max_tickets_per_customer_range` CHECK, as today |
| Doors within 6 hours before the start | as today (`025`) | `event_doors_open_range` CHECK, as today |
| A seated event does not change venue while reserved seating is on | as today, using the reserved-seating value in force after this request | the event and venue locks |

## The request (contract `EventUpdate` / `EventTierInput`, 1.26.0)

| Field | New | Meaning |
| --- | --- | --- |
| today's `EventUpdate` fields | no | as today |
| `reservedSeating` | yes | optional boolean; not `null`; when `tiers` is sent and this is left out, `false` |
| `tiers[]` | yes | optional, at most 50, the complete new set; not `null` |
| `tiers[i].id` | yes | optional UUID; required to keep an existing type; refused on `createEvent`; must be a type of this event on `updateEvent` |
| `tiers[i].name`, `.price`, `.quantity`, `.sectionIds` | as `031` | the same rules as scheduling |

## Field paths in refusals

| Path | About |
| --- | --- |
| `tiers.<i>.id` | missing, foreign, repeated, or sent on create |
| `tiers.<i>.name`, `.price`, `.quantity`, `.sectionIds` | as `031`, plus quantity below sold |
| `tiers` | the ticket types together (capacity; a removal that is refused, naming the type in the message) |
| `reservedSeating` | cannot switch because tickets are sold; or reserved seating at a venue with no layout |
| `totalTicketCapacity` | as today / `031` |
| `name`, `locationId`, `startsAt`, `endsAt`, `doorsOpenAt`, `maxTicketsPerCustomer` | as today's detail refusals, now also placed beside those fields in the form |
