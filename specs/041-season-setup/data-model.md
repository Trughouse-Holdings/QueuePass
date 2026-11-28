# Data Model: Season Setup and the Shared Season Contract

**Feature**: `041-season-setup` | **Date**: 2026-11-27 | **Research**: R1, R2, R5–R7, R10, R14

One migration, `backend/prisma/migrations/20261127120000_seasons/`, ships in the spec PR (R14).
Prisma states the tables, keys and indexes; the CHECK constraints and partial unique indexes are
hand-written in the migration SQL, as in earlier migrations. Names in `snake_case` are constraint
names, so tests and error mapping can refer to them.

## Enums

```prisma
enum SeasonStatus { DRAFT ON_SALE CANCELLED }

// Assumption in the spec: a fixed list, so the customer's Season tickets tab groups cleanly.
enum Sport { BASKETBALL FOOTBALL BASEBALL SOCCER HOCKEY VOLLEYBALL }

enum SeasonPassStatus { ACTIVE REFUNDED }
```

## Season

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | primary key |
| `name` | varchar(100) | trimmed, 1–100 (`season_name_length`) |
| `sport` | `Sport?` | both or neither with `team` (`season_sport_team_together`) |
| `team` | varchar(100)? | trimmed, 1–100 when set (`season_team_length`) |
| `locationId` | uuid → `Location` RESTRICT | the venue; indexed |
| `layoutId` | uuid? → `Layout` RESTRICT | a layout of the venue (Backend, R1); `null` = general admission |
| `status` | `SeasonStatus` | default `DRAFT` |
| `salesEndAt` | timestamptz | pass sales end (FR-006) |
| `singleSalesOpenAt` | timestamptz? | presale end; `<= salesEndAt` (`season_presale_before_sales_end`) |
| `maxPassesPerCustomer` | int? | 1–10 (`season_max_passes_range`) |
| `publishedAt` | timestamptz? | set when it went on sale; `NULL` exactly when `DRAFT` (`season_published_when_not_draft`) |
| `cancelledAt` | timestamptz? | set exactly when `CANCELLED` (`season_cancelled_together`) |
| `createdAt`, `updatedAt` | timestamptz | |

Relations: `events SeasonEvent[]`, `prices SeasonPrice[]`, `passes SeasonPass[]`,
`passHolds SeasonPassHold[]`. Indexes: `locationId`, `status`.

**State transitions**: `DRAFT → ON_SALE` (`publishSeason`, FR-010), `ON_SALE → CANCELLED`
(`cancelSeason`, FR-014). A `DRAFT` is deleted, never cancelled; `CANCELLED` is final. "Sales
ended" and "Presale until …" are derived from the times, not statuses.

## SeasonEvent

| Field | Type | Rules |
| --- | --- | --- |
| `eventId` | uuid → `Event` RESTRICT | **primary key**: an event is in at most one Season (FR-004) |
| `seasonId` | uuid → `Season` CASCADE | indexed |

Backend rules under R2's locks: the event is at the Season's venue, on its layout (seated) or
general admission (FR-003), scheduled and not started when added (FR-004); the set doesn't change
once a pass is active (FR-005).

## SeasonPrice

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | primary key |
| `seasonId` | uuid → `Season` CASCADE | |
| `levelId` | uuid? → `PriceLevel` CASCADE | seated Season; a level of its layout (Backend) |
| `tierName` | varchar(100)? | general-admission Season; trimmed, 1–100 |
| `price` | decimal(10,2) | `>= 0` (`season_price_non_negative`) |

Exactly one of `levelId`, `tierName` (`season_price_one_target`). Unique `(seasonId, levelId)`
(`season_price_level_unique`) and `(seasonId, lower(tierName))` (`season_price_tier_unique`,
partial, `WHERE tierName IS NOT NULL`).

## SeasonPass (written by `042`)

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | primary key |
| `seasonId` | uuid → `Season` RESTRICT | indexed |
| `customerSub` | text | Keycloak subject, as on `Order` |
| `customerUsername` | text | as on `Order` |
| `holderName` | varchar(100) | the name on every ticket (`017`), 1–100, trimmed, as `Order` |
| `seatId` | uuid? → `Seat` SET NULL | seated pass; kept while `ACTIVE` (`season_pass_active_has_seat`) |
| `seatSection`, `seatRowLabel`, `seatLabel` | varchar(50), varchar(5), varchar(5) | seated pass: the seat's labels as sold, as `Ticket` copies them |
| `levelId` | uuid? → `PriceLevel` SET NULL | the seat's level when bought (seated) |
| `tierName` | varchar(100)? | general-admission pass |
| `totalPrice` | decimal(10,2) | the pass price when bought, `>= 0` |
| `status` | `SeasonPassStatus` | default `ACTIVE` |
| `requestId` | uuid? | idempotent confirm; unique `(customerSub, requestId)` |
| `createdAt` | timestamptz | |
| `refundedAt` | timestamptz? | set exactly when `REFUNDED` (`season_pass_refunded_together`) |

Exactly one kind (`season_pass_one_target`): the three seat labels and no `tierName`, or a
`tierName` and no seat or labels. Indexes: `seasonId`, `seatId`, `levelId`, `(customerSub,
createdAt)`.

## SeasonPassHold (written by `042`, R7)

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | primary key |
| `seasonId` | uuid → `Season` CASCADE | |
| `customerSub` | text | |
| `seatId` | uuid? → `Seat` SET NULL | the one seat held at every event; kept while live (`season_pass_hold_live_has_seat`) |
| `createdAt` | timestamptz | database clock |
| `expiresAt` | timestamptz | `= createdAt + 5 minutes` (`season_pass_hold_five_minutes`) |
| `endedAt` | timestamptz? | `NULL` while live |

One live hold per customer per Season: partial unique `(customerSub, seasonId) WHERE endedAt IS
NULL` (`season_pass_hold_one_live`). Partial index on `expiresAt WHERE endedAt IS NULL` for the
sweep, which ends the pass hold with its reservations (R7).

## Changes to existing tables

- **`Order.seasonPassId`** uuid? → `SeasonPass` RESTRICT, indexed. One order per event per pass:
  partial unique `(seasonPassId, eventId) WHERE seasonPassId IS NOT NULL`
  (`order_one_per_event_per_pass`).
- **`SeatReservation.passHoldId`** uuid? → `SeasonPassHold` CASCADE, indexed. One live reservation
  per pass hold per event: partial unique `(passHoldId, eventId) WHERE passHoldId IS NOT NULL AND
  endedAt IS NULL` (`seat_reservation_one_per_pass_hold_event`).
- **`seat_reservation_one_active`** is replaced by the same index over `(eventId, customerSub,
  (passHoldId IS NULL)) WHERE endedAt IS NULL`: one live single reservation and one live pass
  reservation per customer per event (R7). Every single-ticket path filters `passHoldId IS NULL`
  (R7's list, implemented by `042`).

## Derived values (no columns)

- **Passes sold** of a Season: its `SeasonPass` rows with `status = ACTIVE`. **Pass revenue**: the
  sum of `totalPrice` of its confirmed orders with a `seasonPassId` (an event cancelled after a sale
  refunds that event's share, so the revenue drops by it).
- **Event's `singleSalesOpenAt`** (R5): its Season's `singleSalesOpenAt` when the Season is
  `ON_SALE` and the time is after `now()`, else `null`.
- **Event's pass figures** (R8): valid tickets and confirmed order totals of its orders with a
  `seasonPassId`.
- **Pass share** (R6): per event, `floor(totalPrice × 100 / N) / 100`, the first event by
  `startsAt`, then id, adding the remainder.
