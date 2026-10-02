# Data Model: Admin Orders, Reporting, Attendees, and Safe Cancellation

## Event (changed)

| Column | Type | Rules |
|---|---|---|
| `status` | enum `EventStatus` (`SCHEDULED`, `CANCELLED`) | default `SCHEDULED` |
| `cancelledAt` | `timestamptz` null | set exactly when `status = CANCELLED` (CHECK) |

`event_no_overlap` is recreated as `EXCLUDE USING gist (…) WHERE (status = 'SCHEDULED')`.

## Order (new)

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | primary key |
| `eventId` | `uuid` | FK → `Event`, `ON DELETE RESTRICT`, indexed |
| `tierId` | `uuid` null | FK → `TicketTier`, `ON DELETE RESTRICT`, indexed |
| `customerSub` | `text` | the token's `sub` |
| `customerUsername` | `text` | the token's `preferred_username` |
| `quantity` | `integer` | 1–10 (CHECK) |
| `unitPrice`, `totalPrice` | `numeric(10,2)` | `>= 0`; `totalPrice = unitPrice * quantity` (CHECK) |
| `status` | enum `OrderStatus` (`CONFIRMED`, `REFUNDED`) | default `CONFIRMED` |
| `createdAt` | `timestamptz` | |
| `refundedAt` | `timestamptz` null | set exactly when `REFUNDED` (CHECK) |

## Ticket (new)

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | primary key |
| `orderId` | `uuid` | FK → `Order`, `ON DELETE RESTRICT`, indexed |
| `eventId` | `uuid` | FK → `Event`, `ON DELETE RESTRICT`; indexed with `status` |
| `tierId` | `uuid` null | FK → `TicketTier`, `ON DELETE RESTRICT` |
| `code` | `text` | unique; `^[A-Z2-9]{12}$` (CHECK) |
| `status` | enum `TicketStatus` (`VALID`, `VOID`) | default `VALID` |
| `checkedInAt` | `timestamptz` null | |

## Rules enforced under the event-row lock

- Valid tickets for an event `<=` `Event.totalTicketCapacity`.
- Valid tickets for a tier `<=` `TicketTier.quantity`.
- An event with tiers only sells tiered tickets; one without tiers only tierless tickets.

## Migration `20261002000000_orders_tickets`

Enums, columns, tables, FKs, indexes, CHECKs above, and the exclusion constraint recreated with
its `WHERE` clause. Existing events become `SCHEDULED`.
