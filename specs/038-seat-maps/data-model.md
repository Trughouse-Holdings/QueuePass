# Data Model: Seat Maps

**Feature**: `038-seat-maps` | **Research**: [research.md](./research.md) R1, R7, R8, R10, R16

One migration, `backend/prisma/migrations/<timestamp>_seat_maps/migration.sql`, hand-written, carries
today's data over (R16). Constraints Prisma can't express (partial unique indexes, CHECKs,
case-insensitive uniqueness) live in that SQL, as in every earlier migration. Never `prisma db push`.

## New tables

### Layout

One seating configuration of a venue (FR-001).

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | primary key |
| `locationId` | UUID → `Location` | `ON DELETE CASCADE` (a venue with events can't be deleted, `002`) |
| `name` | VARCHAR(50) | 1–50 characters, trimmed; unique per venue ignoring case (`layout_name_unique_per_venue`, on `(locationId, lower(name))`) |
| `source` | enum `LayoutSource`: `FILE`, `LINES` | how it was made; only `LINES` takes section lines (R6) |
| `floorKind` | enum `FloorKind`: `COURT`, `END_STAGE`, `CENTER_STAGE`, `RING`, `NONE` | |
| `floorOutline` | JSONB, nullable | `[[x, y], …]`, 3–64 points; `NULL` with `NONE` (CHECK) |
| `width`, `height` | INT | 1–5,000 map units (CHECK) |
| `seatCount` | INT | the number of its seats, 1–30,000 (CHECK), written by every layout write in the same transaction |
| `createdAt`, `updatedAt` | TIMESTAMPTZ | |

### PriceLevel

A group of seats of similar desirability (FR-003).

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | |
| `layoutId` | UUID → `Layout` | `ON DELETE CASCADE` |
| `name` | VARCHAR(50) | unique per layout ignoring case (`price_level_name_unique`) |
| `rank` | INT | 1 = most desirable; unique per layout (`price_level_rank_unique`); 1–50 (CHECK) |
| `color` | VARCHAR(10) | one of the 12 level color names (CHECK `price_level_color_known`) |

A layout has 1–12 levels, enforced by the Backend on import and lines (R5, R6); a carried-over
"Standard" layout may have up to 50 (R16).

### Section (changed)

Moves from the venue to a layout (FR-002). Existing ids are kept (R16).

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | kept from `007` |
| `layoutId` | UUID → `Layout` | `ON DELETE CASCADE`; replaces `locationId` |
| `name` | VARCHAR(50) | unique per layout ignoring case (`section_name_unique_per_layout`, replaces `section_name_unique_per_venue`) |
| `levelId` | UUID → `PriceLevel` | required; the default level of its rows and seats; `RESTRICT` |
| `outline` | JSONB | `[[x, y], …]`, 3–64 points |
| `labelX`, `labelY` | REAL | where its name is drawn (the outline's centroid unless the file says) |
| `position` | INT | drawing and list order; unique per layout |

Dropped: `locationId`, `rows`, `seatsPerRow`. The `(levelId)` must belong to the same layout: a
composite foreign key `(layoutId, levelId) → PriceLevel(layoutId, id)`.

### SeatRow

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | |
| `sectionId` | UUID → `Section` | `ON DELETE CASCADE` |
| `number` | INT | 1 = front; 1–100; unique per section (`seat_row_number_unique`) |
| `label` | VARCHAR(5) | 1–5 characters; unique per section (`seat_row_label_unique`) |
| `levelId` | UUID → `PriceLevel`, nullable | the row's own level, overriding its section's |

### Seat

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | |
| `rowId` | UUID → `SeatRow` | `ON DELETE CASCADE` |
| `sectionId` | UUID → `Section` | denormalised for lookups by `{sectionId, row, seat}`; equals the row's section (composite foreign key `(rowId, sectionId) → SeatRow(id, sectionId)`) |
| `number` | INT | 1–200; order in the row; unique per row (`seat_number_unique`) |
| `label` | VARCHAR(5) | 1–5 characters; unique per row (`seat_label_unique`) |
| `x`, `y` | REAL | place in map units, inside the layout's size |
| `levelId` | UUID → `PriceLevel`, nullable | the seat's own level |
| `accessible` | BOOLEAN | default `false`; no behavior until #57 |

Index `(sectionId)`. **A seat's level** is `COALESCE(Seat.levelId, SeatRow.levelId,
Section.levelId)` (FR-003, R1); the Backend computes it in SQL, in one helper (`seat-levels.ts`).
Levels on rows and seats must belong to the seat's layout (checked by the Backend on every write;
the layout write locks the layout).

### EventLevelPrice

An event's price for one level (FR-011).

| Field | Type | Rules |
| --- | --- | --- |
| `eventId` | UUID → `Event` | `ON DELETE CASCADE` |
| `levelId` | UUID → `PriceLevel` | `ON DELETE CASCADE` (a level removed by a line edit takes its prices, R6) |
| `price` | DECIMAL(10,2) | ≥ 0 (CHECK) |

Primary key `(eventId, levelId)`. That the level is of the event's layout is checked by the Backend
under the event lock.

### EventOffSaleSeat

A seat one event does not sell (FR-013).

| Field | Type | Rules |
| --- | --- | --- |
| `eventId` | UUID → `Event` | `ON DELETE CASCADE` |
| `seatId` | UUID → `Seat` | `ON DELETE CASCADE` |

Primary key `(eventId, seatId)`.

## Changed tables

### Location

`seatingCapacity` is the largest layout's `seatCount` while the venue has a layout (FR-009), written
by every layout write; typed by admins otherwise (`002`). Relation `sections` becomes `layouts`.

### Event

| Field | Change |
| --- | --- |
| `layoutId` | **new**, UUID → `Layout`, nullable, `ON DELETE RESTRICT`; `NULL` is general admission |
| `reservedSeating` | kept as a column for every query that reads it; CHECK `event_seating_matches_layout`: `reservedSeating = (layoutId IS NOT NULL)` |
| `totalTicketCapacity` | on a seated event, the layout's seats minus its off-sale seats, written by the Backend (R9); ≥ 1 (existing CHECK) |
| `basePrice` | on a seated event, the lowest price of a level with seats on sale (R9) |
| `sectionTiers` | removed (table dropped) |
| `levelPrices`, `offSaleSeats` | new relations |

That `layoutId`'s venue is the event's venue is checked by the Backend under the event and venue
locks (spec edge case "An event's layout from another venue").

### Ticket

| Field | Change |
| --- | --- |
| `seatId` | **new**, UUID → `Seat`, nullable, `ON DELETE SET NULL` |
| `seatSection` | VARCHAR(50), the section's name as sold (unchanged meaning) |
| `seatRow` | INT, the row's **number** as sold (unchanged type) |
| `seatNumber` | INT, the seat's **number** in its row as sold (unchanged type) |
| `seatRowLabel`, `seatLabel` | **new**, VARCHAR(5), the labels as sold |
| `levelName` | **new**, VARCHAR(50), nullable: the price level's name as sold (seated tickets only) |
| `price` | **new**, DECIMAL(10,2), required: what this ticket cost (backfilled from its order's `unitPrice`) |

CHECKs: the five seat fields and `seatId` are all set or all `NULL` when the ticket is created
(`ticket_seat_all_or_none`, on the five labels); `ticket_valid_has_seat`: a `VALID` ticket with a
`seatSection` has a `seatId` (so deleting a sold seat fails, R10). Index `ticket_one_valid_per_seat`
becomes `UNIQUE (eventId, seatId) WHERE status = 'VALID'` (FR-025).

### Order

| Field | Change |
| --- | --- |
| `tierId` | `NULL` for every seated order (R16) |
| `unitPrice` | **nullable**: the price every ticket has, or `NULL` when they differ (R10) |

### SeatReservation

`tierId` is `NULL` for every seated event (R10, R16). Otherwise unchanged.

### SeatHold

| Field | Change |
| --- | --- |
| `seatId` | **new**, UUID → `Seat`, nullable, `ON DELETE SET NULL`; CHECK `seat_hold_live_has_seat`: `releasedAt IS NOT NULL OR seatId IS NOT NULL` |
| `seatSection`, `seatRow`, `seatNumber` | kept, as on Ticket (numbers) |

Index `seat_hold_one_live_per_seat` becomes `UNIQUE (eventId, seatId) WHERE releasedAt IS NULL`
(FR-025).

### TicketTier

Unchanged; only general-admission events have them (FR-012). The Backend refuses a tier on a seated
event.

## Dropped

`SectionTier`; `Section.locationId`, `rows`, `seatsPerRow`; the label-based
`ticket_one_valid_per_seat` and `seat_hold_one_live_per_seat`; `section_name_unique_per_venue`.

## States

A seat of a seated event is in exactly one state, decided under the event lock:

| State | When |
| --- | --- |
| `offSale` | an `EventOffSaleSeat` row exists |
| `sold` | a `VALID` ticket points at it |
| `reserved` (held) | a live hold of an active reservation points at it (`015`) |
| `open` | none of these |

Transitions: `open ↔ offSale` (the event's seating save; refused for `sold`/`reserved`); `open →
reserved → open` (hold, release, expiry, logout, admin change); `reserved → sold` (purchase); `sold
→ open` (refund or cancellation voids the ticket, `005`, `009`). Every transition publishes a
`SeatStateChange` with `from`, `state` and `levelId` after commit (R12).

## Carry-over (R16)

| Before | After |
| --- | --- |
| A venue's sections | One layout "Standard", `LINES`, `NONE`; sections keep their ids; one level per section named after it (rank = position + 1, colors in order, repeating after 12); rows and seats generated, labels = numbers, places on the R6 grid |
| A seated event | `layoutId` = Standard; a mapped section's level priced at its type's price; on an event without types, every level at its base price; an unmapped section on an event with types, its seats off sale |
| A seated event with types and no mapped section | general admission, keeping its types |
| Its ticket types | deleted, after its orders, tickets and reservations drop `tierId` |
| A seated ticket | `seatId` by section id, row and seat; labels = numbers; `price` = its order's `unitPrice`; `levelName` = its type's name, else its section's |
| A hold | `seatId` as above (ended holds whose section is gone keep `NULL`) |
| Capacity, limit, base price | seats on sale; the limit lowered to it where higher; the lowest on-sale price |
