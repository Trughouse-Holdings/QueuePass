# Data Model: All-or-Nothing Event Scheduling

**Feature**: `031-atomic-event-create` | **Spec**: [spec.md](./spec.md)

**No schema change.** `backend/prisma/` is unchanged: no table, column, constraint, index, or
migration. Scheduling writes the same rows it wrote before, through the same tables, but in one
transaction instead of up to four requests.

## What one schedule writes (research R4)

In one transaction, after every check has passed, in this order:

| Table | Rows | Values |
| --- | --- | --- |
| `Event` | 1 | as today, plus `reservedSeating` from the request (default `false`); with reserved seating, `totalTicketCapacity` is the layout's total seats |
| `TicketTier` | one per entry of `tiers`, in request order | `name` (trimmed), `price`; `quantity`: the typed one without reserved seating, else the seats of its `sectionIds` (`rows × seatsPerRow` summed; 0 for none) |
| `SectionTier` | one per section listed, over all ticket types | `eventId`, `sectionId`, `tierId` of the type that lists it |

Nothing else is written: no seat reservation, hold, order, or image. The response is the `Event`, as
today. Pictures are uploaded afterwards by separate requests (`014`, unchanged).

A refusal or a failure at any point leaves none of these rows (FR-003).

## What guarantees what (Constitution IV)

| Rule | Checked by | Guaranteed under concurrency by |
| --- | --- | --- |
| 60 minutes between events at a venue | `assertNoConflict` (names the event) | `event_no_overlap` exclusion constraint |
| Ticket type names unique per event, ignoring case | the planner, across the request | unique index `("eventId", lower("name"))` on `TicketTier` |
| A section sells one ticket type per event | the planner, across the request | primary key `("eventId", "sectionId")` on `SectionTier` |
| Sections belong to the event's venue's current layout | the planner, against the sections read in the transaction | the venue row held `FOR SHARE` for the whole transaction; a layout save needs it `FOR UPDATE` |
| Ticket types fit the capacity (general admission) | the planner | the event is not visible to any other transaction until it commits |
| Seated: capacity = layout total; type quantity = its sections' seats | the planner, from the sections read under the venue lock | as above |
| Tickets per customer within the capacity | `assertLimitWithinCapacity` with the layout's total when seated | `event_max_tickets_per_customer_range` CHECK, as today |
| Doors within 6 hours before the start | as today (`025`) | `event_doors_open_range` CHECK, as today |

## The request (contract `EventInput`, 1.23.0)

| Field | New | Meaning |
| --- | --- | --- |
| `name`, `locationId`, `startsAt`, `endsAt`, `doorsOpenAt`, `totalTicketCapacity`, `maxTicketsPerCustomer`, `basePrice` | no | as today; `totalTicketCapacity` must be left out with `reservedSeating: true` |
| `reservedSeating` | yes | optional boolean, left out = `false` |
| `tiers[]` | yes | optional; each an `EventTierInput` |
| `tiers[i].name`, `.price`, `.quantity` | as `TicketTierInput` | quantity required without reserved seating, left out with it |
| `tiers[i].sectionIds[]` | yes | only with reserved seating; distinct section ids of the venue's layout |

## Field paths in refusals (research R3)

| Path | About |
| --- | --- |
| `tiers.<i>.name` | ticket type *i*'s name: malformed, or the same as an earlier type's |
| `tiers.<i>.price` | ticket type *i*'s price: malformed |
| `tiers.<i>.quantity` | ticket type *i*'s quantity: malformed, missing without reserved seating, sent with it |
| `tiers.<i>.sectionIds` | ticket type *i*'s sections: malformed, sent without reserved seating, not in the layout, or listed under an earlier type |
| `tiers` | the ticket types together: over the event's capacity; or `tiers` itself malformed |
| `reservedSeating` | reserved seating at a venue without a layout; or malformed |
| `totalTicketCapacity` | sent with reserved seating |

*i* is the zero-based index in the request's `tiers`; the Admin form shows ticket type *i + 1*.
