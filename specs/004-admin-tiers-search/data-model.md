# Data Model: Admin Ticket Tiers and Search

One new table. `Location` and `Event` are unchanged ([`002` data model](../002-admin-venues-events/data-model.md)).

## TicketTier

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | primary key |
| `eventId` | `uuid` | FK → `Event.id`, `ON DELETE CASCADE`, indexed |
| `name` | `text` | trimmed, 1–100 characters (CHECK); unique per event ignoring case (index) |
| `price` | `numeric(10,2)` | `>= 0` (CHECK); exchanged as a `"0.00"` string |
| `quantity` | `integer` | `> 0` (CHECK) |
| `createdAt`, `updatedAt` | `timestamptz` | |

## Cross-row rule

For every event: `SUM(TicketTier.quantity) <= Event.totalTicketCapacity`. Enforced by the Backend
under an event-row lock (research R2); every write that can change either side takes the lock.

## Migration `20261001000000_ticket_tiers`

Creates the table, FK, index on `eventId`, the three CHECK constraints, and
`ticket_tier_event_name_unique ON "TicketTier" ("eventId", lower("name"))`. Applied by
`prisma migrate deploy` at Backend start.
