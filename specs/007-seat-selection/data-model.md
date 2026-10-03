# Data Model: Seat Selection

## Section (new)

A venue's layout is its sections (research R1).

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | primary key |
| `locationId` | `uuid` | FK → `Location`, `ON DELETE CASCADE`, indexed |
| `name` | `text` | 1–50 characters; unique per venue ignoring case (`lower(name)` index) |
| `rows` | `integer` | 1–100 (CHECK) |
| `seatsPerRow` | `integer` | 1–200 (CHECK) |
| `position` | `integer` | display order within the venue, from 0; unique per venue |
| `createdAt`, `updatedAt` | `timestamptz` | |

Total seats (`sum(rows × seatsPerRow)`) `<=` `Location.seatingCapacity`, checked by the Backend
under the venue lock (R3).

## SectionTier (new)

For one seated event with tiers, which tier one section belongs to.

| Column | Type | Rules |
|---|---|---|
| `eventId` | `uuid` | FK → `Event`, `ON DELETE CASCADE` |
| `sectionId` | `uuid` | FK → `Section`, `ON DELETE CASCADE` |
| `tierId` | `uuid` | FK → `TicketTier`, `ON DELETE CASCADE`, indexed |

Primary key `(eventId, sectionId)`: a section has at most one tier per event.

## Event (changed)

| Column | Type | Rules |
|---|---|---|
| `reservedSeating` | `boolean` | default `false`; existing events become `false` |

## Ticket (changed)

| Column | Type | Rules |
|---|---|---|
| `seatSection` | `text` null | the section's name when sold |
| `seatRow` | `integer` null | `>= 1` |
| `seatNumber` | `integer` null | `>= 1` |

CHECK `ticket_seat_all_or_none`: all three null, or all three set.

Partial unique index `ticket_one_valid_per_seat` on `("eventId", "seatSection", "seatRow",
"seatNumber") WHERE "status" = 'VALID' AND "seatSection" IS NOT NULL` (R2).

## Rules enforced under locks

| Rule | Where |
|---|---|
| One valid ticket per seat per event | partial unique index (and checked first under the event lock to name taken seats) |
| Layout total seats `<=` seating capacity | layout writes, venue lock |
| No layout change while a scheduled seated event has valid tickets | layout writes, venue lock + every scheduled event's lock |
| No layout removal while a scheduled event has reserved seating on | layout delete, same locks |
| Reserved seating switches only without valid tickets, and on only with a layout | seating write, event lock |
| A section with valid tickets keeps its tier | seating write, event lock |
| Seated orders name `quantity` distinct seats inside the layout, in the order's tier | order, event lock |
| A seated event cannot move venue | event update, event lock |
| Seating capacity cannot drop below the layout's seats | venue update |

## Migration `20261005000000_seat_selection`

Creates `Section` and `SectionTier` with their FKs, indexes, and CHECKs; adds
`Event.reservedSeating`; adds the three `Ticket` seat columns, `ticket_seat_all_or_none`, and
`ticket_one_valid_per_seat`.
