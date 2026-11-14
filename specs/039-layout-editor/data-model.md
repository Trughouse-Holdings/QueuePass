# Data Model: Layout Editor

**Feature**: `039-layout-editor` | **Research**: [research.md](./research.md) R4–R9

No new tables. One hand-written migration,
`backend/prisma/migrations/<timestamp>_layout_editor/migration.sql`, changes `038`'s tables
([038 data model](../038-seat-maps/data-model.md)). Never `prisma db push`.

## Changed tables

### Layout

| Field | Change |
| --- | --- |
| `source` | enum `LayoutSource` gains `DRAWN` (`ALTER TYPE … ADD VALUE`). A drawing save of a `LINES` layout sets `DRAWN`; `createLayoutDrawing` makes `DRAWN`; `FILE` stays `FILE` (R4) |
| `revision` | **new** INT NOT NULL DEFAULT 1, CHECK ≥ 1; raised by one in the same transaction as every change to the layout: rename, lines edit, drawing save (R9). A duplicate starts at 1 |

`width`, `height`, `seatCount` and `floorOutline` are unchanged in meaning; a drawing save computes
the size from what is drawn (R5).

### Section

| Field | Change |
| --- | --- |
| `originX`, `originY` | **new** REAL NOT NULL: the point the section moves and turns about, in map units, 0–5,000 (CHECK). The migration sets them to `labelX`, `labelY`; import, section lines and the carry-over write the label point; duplicate copies them; a generated section's origin is the middle of its front row (R6, R7) |
| `angle` | **new** REAL NOT NULL DEFAULT 0, CHECK `angle > -180 AND angle <= 180`: degrees clockwise the editor has turned it (R6) |
| `generator` | **new** JSONB, nullable: the `SectionGenerator` it was made from (contract), `NULL` when it was not generated in the editor; CHECK `generator IS NULL OR jsonb_typeof(generator) = 'object'`. Duplicate copies it (R7) |
| `outline`, `labelX`, `labelY` | unchanged columns; a drawing save writes them from `outlineAround` and the outline's centroid (R5) |

### Unique constraints made deferrable

The migration replaces these unique **indexes** with unique **constraints** of the same names,
`DEFERRABLE INITIALLY IMMEDIATE`, so every existing write still checks at once and a drawing save
checks them at commit after `SET CONSTRAINTS … DEFERRED` (R8):

| Name | Columns |
| --- | --- |
| `price_level_rank_unique` | `PriceLevel(layoutId, rank)` |
| `Section_layoutId_position_key` | `Section(layoutId, position)` |
| `seat_row_number_unique` | `SeatRow(sectionId, number)` |
| `seat_row_label_unique` | `SeatRow(sectionId, label)` |
| `seat_number_unique` | `Seat(rowId, number)` |
| `seat_label_unique` | `Seat(rowId, label)` |

Unchanged (they can't be deferred, or nothing needs it): the case-insensitive name indexes
`layout_name_unique_per_venue`, `price_level_name_unique`, `section_name_unique_per_layout` (a
drawing save parks a changing name first, R8); `price_level_layout_id` and `seat_row_id_section`,
which composite foreign keys reference and which must stay immediate. No `ON CONFLICT` uses any of
the six. `schema.prisma`'s `@@unique` lines keep their `map:` names; Prisma does not model
deferrability, and no check compares the schema with the migrations.

## Rules a drawing save enforces (Backend)

| Rule | Where | Refusal |
| --- | --- | --- |
| `038`'s limits: 1–100 sections, 1–100 rows a section, 1–200 seats a row, 1–30,000 seats, 1–12 levels | check (R16) | `400 LAYOUT_FILE_INVALID` |
| Names 1–50 unique ignoring case (sections in the layout, levels in the layout); labels 1–5 unique in the section (rows) or row (seats); no control characters | check | `400 LAYOUT_FILE_INVALID` |
| Every level `key` named by a section, row or seat exists | check | `400 LAYOUT_FILE_INVALID` |
| Every place (seat, origin, floor point) from 0 to 5,000 | check | `400 LAYOUT_FILE_INVALID` |
| Every sent id is of this layout and of the right kind; a row's id belongs to its section, a seat's to its row | check, after the lock | `400 LAYOUT_FILE_INVALID` |
| `revision` equals the layout's | after the lock | `409 LAYOUT_CHANGED` |
| The layout is not locked (038 FR-006) | after the lock | `409 LAYOUT_IN_USE` |
| The layout's name is free at the venue | after the lock | `409 LAYOUT_NAME_TAKEN` |
| Each scheduled event using it still sells (every on-sale level priced, a seat on sale, its limit within its seats) | after the change | `409 LAYOUT_IN_USE` |
| The venue's capacity stays at least each scheduled general-admission event's capacity (038 FR-009) | `setCapacity` | `409 CAPACITY_EXCEEDED` |

## What a save does to what points at the layout

| Thing | Kept seat / level | Deleted seat / level | New seat |
| --- | --- | --- | --- |
| `EventOffSaleSeat` | kept | deleted (cascade) | added for every scheduled event using the layout |
| `EventLevelPrice` | kept | deleted (cascade) | — |
| `Event.totalTicketCapacity`, `basePrice`, `priceMax` | recomputed for every scheduled event using it | | |
| `Ticket.seatId` (void tickets of cancelled events only; valid ones lock the layout) | kept | `SET NULL`; the ticket keeps its label copy (038 FR-026) | — |
| `streamSeatMap` of those events | ends; viewers reload | | |

## The editor's document (Admin app, not stored)

`admin-app/src/layout-editor/editor-doc.ts` (R10):

| Part | Fields |
| --- | --- |
| Document | `name`, `floor` (`kind`, `outline` or none), `levels`, `sections`, `revision` (`null` for a new layout), `layoutId` |
| Level | `id` (a UUID, or `new:<n>`), `name`, `color`; rank by order |
| Section | `id`, `name`, `levelId`, `origin`, `angle`, `generator` or `null`, `outline` (from `outlineAround`), `rows` |
| Row | `id`, `label`, `levelId` or `null` |
| Seat | `id`, `label`, `at`, `levelId` or `null`, `accessible` |
| Editor state | `doc`, `selection` (sections; or one section's rows or seats; or the floor), `zoomed` section or none, `history` (≤ 100 documents) and its cursor, `saved` (the document as last loaded or saved, for `dirty`) |
