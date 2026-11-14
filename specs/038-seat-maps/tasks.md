---
description: "Task list for Seat Maps: Venue Layouts, Prices by Level, Seats Off Sale, and the Customer Venue Map"
---

# Tasks: Seat Maps: Venue Layouts, Prices by Level, Seats Off Sale, and the Customer Venue Map

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R21),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (contract 1.28.0 now,
2.0.0 in step 2), [quickstart.md](./quickstart.md) (S0–S21)

**Issue**: [#165](https://github.com/Trughouse-Holdings/QueuePass/issues/165). The implementation
PR's **description** says `fixes #165` on its own line. No commit message on either branch may
contain "fixes #165", "closes #165", or "resolves #165".

**Tests**: **REQUIRED and written first** (Constitution VI). In every phase, write its test tasks and
confirm they **fail** before its implementation tasks.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `038-seat-maps-impl` in a Claude session
  that starts from these files only. While the spec and plan PR is open, cut it from
  `038-seat-maps-spec` and carry in every change that PR's review makes; once it merges, bring it up
  to `main`. A gap in the spec or plan is fixed there (a commit on the spec branch), not worked
  around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 038: layout import (T021–T024, #165)`.
  The body names the FR or R it rests on.
- **Contract**: 1.28.0 and `api-schema.ts` come from the spec PR. The implementation changes the
  contract only to (a) apply `specs/038-seat-maps/contracts/step2.diff` unchanged with `git apply`
  (T009, Constitution 3.10.0 Principle I), and (b) remove each `x-planned: '038'` marker in the change
  that serves its route. Anything else it finds it needs goes to the spec PR first; if `main`'s
  contract changes so the patch no longer applies, the patch is remade on the spec branch.
- **Shared surface the implementation touches** (every member approves the PR): the contract's
  step 2, `api-schema.ts`, `backend/prisma/`, `packages/shared/src/seating.ts`,
  `packages/shared/src/web/venue-map/`, `use-seat-stream.ts`, `seat-stream.ts`, `theme.css`.
- **Work in flight**: PR #164 (`037` Rust Admin) also amends the constitution to 3.10.0; whichever
  lands second takes 3.11.0 and keeps both. Its Rust Admin app ports the seating screens this feature
  retires: this implementation merges **before** 037's, and 037's seating parity rows follow 038
  (research R22). If 037's implementation is on `main` first, stop and add the Rust app's move to
  this task list on the spec branch before merging.
- **Lock order** (R7): **the venue first, always.** Layout writes: venue `FOR UPDATE`, then the
  layout, then its scheduled events by id (`layout-lock.ts`). Event saves: venue `FOR SHARE`
  (`lockVenueShared`), then the event, then the layout read (its foreign key takes `KEY SHARE`).
  Holds, orders and the sweep: the event only, never a layout or a venue.
- **One independent review** (Constitution III) of the implementation branch before its PR (T060).
- **`npm run ci` locally** before pushing (T058), then **CI green on GitHub** (`test` and `e2e`)
  before merge (T062).
- **The team stack** (Compose project `queuepass-team`) holds the fixed ports and the team's data.
  Walk on a Compose project of your own (`-p qp038`); stop the team stack only with Mahdi's go, with
  `docker compose -p queuepass-team stop` (never `down`, never `-v`), and restore it afterwards.
- **EDIS demo 2026-11-20** (R21): the MVP is Phases 1–5 plus US5 (Phase 7). Keep `main`-ready
  order: nothing is merged until the whole PR is green.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 from spec.md

---

## Phase 1: Setup

- [X] T001 Cut `038-seat-maps-impl` from `038-seat-maps-spec` (or from `main` once the spec PR has
  merged); `npm ci`; `npm run ci` green before any change, so a later failure is this feature's.
  Record any test that already fails on the untouched branch.
  **Done** (2026-11-13): cut from `038-seat-maps-spec` at `49d1a39`; `npm ci`. `npm run ci` on the
  untouched branch: Prettier, ESLint, every build, the root scripts' tests and `@queuepass/shared`
  (25 files, 793 tests) pass; the Backend 114 of 115 suites, 1,370 of 1,371 tests (lines 97.17%).
  The one failure is `rate-limits.buy.e2e-spec.ts`, "lets another account buy while one sends 200"
  (`connect ECONNRESET`), and it fails the same way run alone: 200 connections at once overflow this
  Mac's listen queue, before any QueuePass code runs. Since `npm test` stops there, the rest was run
  by hand on the untouched branch: Admin app 50 files, 464 tests; Customer app 30, 435; Booth app 7,
  94; seed 16 files, 262 tests (28 skipped); `test-tz` in America/Los_Angeles, all pass.
- [X] T002 [P] Add the test fixtures `backend/test/fixtures/layouts/small.json` (a `LayoutFile`,
  `format: 1`, `floor.kind: "COURT"`, 3 sections of 3 rows, one row as a seat run and one as listed
  seats, 2 levels, one row-level and one seat-level override, one `accessible` seat: about 60 seats)
  and `backend/test/fixtures/layouts/bad.json` (a seat label repeated in a row, a section level key
  not in `levels`, a row of 201 seats, two sections named "104" and "104 " ignoring case after trim,
  an outline point outside `size`), each documented in a one-line `README.md` beside them.
  **Done** (2026-11-13): `small.json` (61 seats: runs, one listed row, a bent run, a row-level and a
  seat-level override, one accessible seat, `labelAt` on one section only) validates against the
  contract's `LayoutFile` with Ajv; `bad.json` has the five problems, the 201-seat row also failing
  the schema's `count` maximum. `floor.kind` is upper case, as the contract's `FloorKind` (R5's
  example says `court`).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the schema, the carry-over, the shared types, and the helpers every story uses.

### Tests first

- [X] T003 [P] `backend/test/integration/migration.seat-maps.e2e-spec.ts` (R16, FR-031, FR-032,
  SC-006), on the pattern of `migration.time-zones.e2e-spec.ts` (a fresh database migrated to the
  migration before `_seat_maps`, rows inserted with SQL, then the migration): a venue with 3
  sections; a seated event with 2 ticket types mapping 2 sections and leaving 1 unmapped, with
  VALID, VOID and REFUNDED tickets, a live hold and an ended one; a seated event without types; a
  seated event with types and no mapping; a general-admission event with types; a CANCELLED event with `reservedSeating = true` at a venue with
  no sections; a venue of 40,000 seats (two sections of 100 × 200) with one seated event. After: one layout
  "Standard", `source = 'LINES'`, `floorKind = 'NONE'`; sections keep their ids; one level per
  section named after it, rank = position + 1; rows `1…n` labelled `'1'…'n'`, seats `1…m`
  labelled `'1'…'m'`; the first event's mapped levels priced at their types' prices, the unmapped
  section's seats in `EventOffSaleSeat`, capacity = seats on sale, `maxTicketsPerCustomer` lowered
  where higher, `basePrice` = lowest on-sale price, its types deleted and its orders', tickets' and
  reservations' `tierId` NULL; the no-type event priced at its base price everywhere; the
  no-mapping event `reservedSeating = false`, `layoutId` NULL, types kept; every ticket keeps
  `seatSection`, `seatRow`, `seatNumber`, status, gets `seatId`, `seatRowLabel`, `seatLabel`, `price`
  = its order's `unitPrice` and `levelName` = its type's name (else the section's); the live hold
  has `seatId`; the GA event unchanged; the cancelled event at the venue without sections is general admission
  (`reservedSeating = false`, `layoutId` NULL); the 40,000-seat venue's Standard layout has all
  40,000 seats (`seatCount` 40,000); `Event.seatSeq` is 0 everywhere. Then: two VALID tickets for one `seatId` fail
  (`ticket_one_valid_per_seat`), two live holds for one `seatId` fail (`seat_hold_one_live_per_seat`),
  deleting a sold seat fails (`ticket_valid_has_seat`), `reservedSeating` without `layoutId` fails
  (`event_seating_matches_layout`). Must fail (no migration yet).
  **Done** (2026-11-13): written first and seen failing for the right reason (no `_seat_maps`
  migration: `expect(NEW_MIGRATION).toBeDefined()`); 18 tests, all pass after T005 and T006. Beyond
  the list: a seated event's ticket sold without a type (level = its section's name), an ended hold
  in a section that is gone (no seat), every section's outline, label point and every seat's place
  checked against `layout-lines.ts`. A raw unique violation names its key, not its index, so the two
  index cases check `pg_indexes` for the definition and the error for SQLSTATE 23505 on
  `("eventId", "seatId")`.
- [X] T004 [P] `backend/test/unit/seat-levels.spec.ts` (R1, FR-003): the resolution helper picks the
  seat's own level, else the row's, else the section's; and `backend/test/unit/layout-lines.spec.ts`
  (R6): `n` section lines placed in `ceil(√n)` columns in order, each cell as large as the largest
  section, each rectangle `seatsPerRow × 2 + 4`
  units wide and `rows × 2 + 4` high with 8 units between, seats 2 units apart, `size` the grid's
  bounds; and `backend/test/unit/seat-runs.spec.ts` (R5): a run `{first, count, from, to}` gives
  `count` seats labelled `first…first+count−1` evenly from `from` to `to`, with `bend` on a quadratic
  curve through it, `count: 1` at `from`. Must fail.
  **Done** (2026-11-13): the three files written first and seen failing (modules missing); 22 tests
  pass after T008. The tests fix what R6 and R5 leave open: grid cells are all as large as the largest
  section (8 units between cells), sections go left to right then down, seats are 3 units in from the
  rectangle's edges with row 1 at the top; a run is spaced evenly in the curve's parameter, and `bend`
  is the point the quadratic curve passes halfway (control point `2·bend − (from + to)/2`).

### Implementation

- [X] T005 Schema in `backend/prisma/schema.prisma` exactly as data-model.md: new models `Layout`
  (`name` "1–50 characters, trimmed; unique per venue ignoring case", `source` enum `FILE | LINES`,
  `floorKind` enum `COURT | END_STAGE | CENTER_STAGE | RING | NONE`, `floorOutline` JSONB nullable
  "`NULL` with `NONE`", `width`/`height` "1–5,000", `seatCount` "≥ 1" (30,000 is the Backend's limit for new layouts)), `PriceLevel` (`name`
  VARCHAR(50) unique per layout ignoring case, `rank` "1–50" unique per layout, `color` VARCHAR(10)
  one of the 12 names), `SeatRow` (`number` "1–100", `label` VARCHAR(5) "1–5 characters", both
  unique per section, `levelId` nullable), `Seat` (`rowId`, `sectionId` denormalised, `number`
  "1–200", `label` VARCHAR(5), both unique per row, `x`/`y` REAL, `levelId` nullable, `accessible`
  default false), `EventLevelPrice` (PK `(eventId, levelId)`, `price` DECIMAL(10,2) "≥ 0"),
  `EventOffSaleSeat` (PK `(eventId, seatId)`); `Section` with `layoutId`, `levelId` (required),
  `outline` JSONB, `labelX`/`labelY` REAL, without `locationId`/`rows`/`seatsPerRow`; `Event.layoutId`
  (nullable, RESTRICT), `Event.seatSeq` (BIGINT, default 0, "≥ 0"); `Ticket.seatId` (nullable, SET NULL), `seatRowLabel`, `seatLabel` VARCHAR(5),
  `levelName` VARCHAR(50) nullable, `price` DECIMAL(10,2) required; `Order.unitPrice` nullable;
  `SeatHold.seatId` (nullable, SET NULL); `SectionTier` removed. The level foreign keys: `SeatRow.levelId` and `Seat.levelId` `onDelete: SetNull`;
  `Section.levelId` `NoAction`, made `DEFERRABLE INITIALLY DEFERRED` in the migration SQL (R7). Comments cite 038 and data-model.md.
  **Done** (2026-11-13): every model, field, type, limit and `onDelete` as data-model.md.
  `prisma migrate diff --from-migrations … --to-schema-datamodel` against a fresh PostgreSQL 17 is
  empty. The composite foreign keys need unique targets: `PriceLevel (layoutId, id)`
  (`price_level_layout_id`) and `SeatRow (id, sectionId)` (`seat_row_id_section`); the Seat → row
  key is `seat_row_section`. Indexes beside them for the cascades and lookups: `Event (layoutId)`,
  `Ticket (seatId)`, `SeatHold (seatId)`, `Seat (levelId)`, `SeatRow (levelId)`,
  `EventLevelPrice (levelId)`, `EventOffSaleSeat (seatId)`, `Layout (locationId)`.
- [X] T006 The migration `backend/prisma/migrations/<timestamp>_seat_maps/migration.sql`, by hand
  (R16 steps 1–6, data-model.md "Carry-over"): tables, the carry-over in SQL (`generate_series` for
  rows and seats on the R6 grid), every CHECK and index named in data-model.md
  (`layout_name_unique_per_venue`, `price_level_name_unique`, `price_level_rank_unique`,
  `price_level_color_known`, `section_name_unique_per_layout`, `seat_row_number_unique`,
  `seat_row_label_unique`, `seat_number_unique`, `seat_label_unique`, the composite foreign keys
  `(layoutId, levelId)` and `(rowId, sectionId)`, `event_seating_matches_layout`,
  `ticket_seat_all_or_none`, `ticket_valid_has_seat`, `seat_hold_live_has_seat`, the new partial
  unique `ticket_one_valid_per_seat` on `(eventId, seatId) WHERE status = 'VALID'` and
  `seat_hold_one_live_per_seat` on `(eventId, seatId) WHERE "releasedAt" IS NULL`), then the drops.
  `npx prisma migrate dev --create-only` is not used; `prisma migrate diff` may help check the
  schema matches. T003 passes.
  **Done** (2026-11-13): `20261113000000_seat_maps/migration.sql`, R16 steps 1–6 in order; every
  name in this task as given. data-model.md states some rules as "(CHECK)" without a name; they are
  `layout_name_valid` (1–50 characters, trimmed), `layout_floor_outline_matches_kind`,
  `layout_floor_outline_points` and `section_outline_points` (3–64 points), `layout_size_range`,
  `layout_seat_count_positive`, `price_level_name_length`, `price_level_rank_range` (1–50),
  `seat_row_number_range`, `seat_row_label_length`, `seat_number_range`, `seat_label_length`,
  `event_level_price_non_negative`, `event_seat_seq_non_negative`. Decided here: a level's rank is the
  section's place in position order (= position + 1 for `007`'s positions 0, 1, 2…); tickets and holds
  find their section by name ignoring case (names are unique so); `levelName` is set on every ticket
  with a seat label, `price` on every ticket; `Location.seatingCapacity` is left as it is (`007` kept it
  equal to the layout's seats). T003 passes; the 40,000-seat venue takes under a second.
- [X] T007 [P] Shared types in `packages/shared/src/seating.ts`: `LAYOUT_LIMITS` (`maxSections:
  100`, `maxRows: 100`, `maxSeatsPerRow: 200`, `maxSeats: 30_000`, `maxLevels: 12`,
  `maxCarriedLevels: 50`, `nameMaxLength: 50`, `labelMaxLength: 5`, `maxOutlinePoints: 64`,
  `maxMapUnits: 5_000`, `maxOffSaleSelectors: 5_000`, `maxImportBytes: 4 * 1024 * 1024`),
  `LEVEL_COLORS` (the 12 names in the contract's `LevelColor` order), and type aliases from
  `api-schema.ts` for the new schemas (`LayoutSummary`, `LayoutDetail`, `VenueMap`,
  `VenueMapSection`, `SeatState`, `OffSaleSelector`, …). `SEATING_LIMITS` goes in T009. Unit test
  `packages/shared/test/seating.test.ts` that `LEVEL_COLORS` equals the contract's enum.
  **Done** (2026-11-13): `packages/shared/test/seating.test.ts` written first and seen failing (4
  tests); then `LAYOUT_LIMITS`, `LEVEL_COLORS` (checked against `LevelColor` at compile time with
  `satisfies`) and 30 aliases of the contract's 038 schemas; 4 tests pass, `tsc` clean.
- [X] T008 Backend helpers: `backend/src/seating/seat-levels.ts` (the `COALESCE(seat, row, section)`
  SQL fragment and a function giving a seat's level; counts per section and level by state for one
  event, in one grouped query, R11), `backend/src/layouts/seat-runs.ts` (run expansion, R5),
  `backend/src/layouts/layout-lines.ts` (grid placement, R6), `backend/src/layouts/layout-lock.ts`
  (lock venue, then layout `FOR UPDATE`, then every scheduled event using it in id order, R7, built
  on `common/venue-lock.ts`). T004 passes.
  **Done** (2026-11-13): T004 passes (22 tests). `seat-levels.ts` also has `countSeatStates` (per
  section and resolved level: `open`, `reserved`, `sold`, `offSale`, the contract's
  `LevelSeatCounts` names, and `seq` from the same statement); `layout-lock.ts` has `lockLayout` and
  `lockVenueForLayouts` (create, import, duplicate), built on a new `lockVenue` in
  `common/venue-lock.ts` that `lockVenueAndEvents` now calls. Neither had a test in this task, so
  `backend/test/integration/seat-levels.e2e-spec.ts` (7 tests: counts by state and level with `seq`,
  a GA event, a 404; the lock's events in id order, its 404, and an event save's `FOR SHARE` on the
  venue waiting for a layout write) was written first, seen failing, and passes.

- [X] T009 Contract **step 2** and the retired code, together (R3, Constitution I): `git apply
  specs/038-seat-maps/contracts/step2.diff` (unchanged; it applies to 1.28.0 with every `x-planned`
  marker still in place), `npm run generate:api`, `node scripts/check-contract-drift.mjs`; the
  contract is 2.0.0 with no `x-retired` marker. Remove the retired Backend code:
  `backend/src/seating/layout.service.ts`, `layout.controller.ts`, `seat-map.service.ts`,
  `seat-map.controller.ts`, `tier-seats.ts`, `dto/layout-input.dto.ts`, `dto/seating-input.dto.ts`,
  the `updateSeating` route, the `snapshot` message in `seat-stream.controller.ts` (the stream sends
  nothing first until T037), and seated `reservedSeating`/`sectionIds` handling in
  `backend/src/events/event-setup.ts`; their tests `layout.e2e-spec.ts`, `seating.e2e-spec.ts`,
  `seating.capacity.e2e-spec.ts` (replaced by Phases 3–5's). `SEATING_LIMITS` and the old types in
  `packages/shared/src/seating.ts` go. From here the Admin and Customer apps' seating screens and
  their tests do not compile or pass until their phases move them (US1, US2, US3, US6); nothing is
  pushed for review before Phase 10 is green. The route-coverage test passes (the 2.0.0 contract has
  no retired operation, and every new one is still `x-planned`).
  **Done** (2026-11-13): `step2.diff` applied unchanged with `git apply` (clean); contract 2.0.0, no
  `x-retired` marker, 12 `x-planned: '038'` markers left (11 operations and `venueMap`);
  `api-schema.ts` regenerated; drift check passes. The listed files and tests are removed; the stream
  sends no `snapshot`; `event-setup.ts` and `events.service.ts` lose `reservedSeating` and
  `sectionIds` (and the DTOs their fields); `SEATING_LIMITS` and `007`'s types are gone from
  `seating.ts`. For the Backend to compile on the new schema, the least change elsewhere, each
  marked for its later task: `LockedEvent.layoutId`; `toChanges` and `resolveSeats` find sections by
  the event's layout and a seat by its row and seat numbers, with no tier rule (T035); reservations
  get no tier (R10); every ticket gets its order's price, `unitPrice` may be `null` (T036);
  `updateLocation` counts layouts (T017); event responses leave out `seatSeq` (a BigInt);
  `test/setup/reset-db.ts` truncates the new tables, `fixtures.ts` gives a ticket its price,
  `orders.e2e-spec.ts` reads a nullable `unitPrice`. Backend builds; ESLint and Prettier clean;
  route coverage passes; shared 26 files, 797 tests pass; Admin, Customer, Booth and seed tests pass
  (Vitest does not type-check).
  **Red after T009, as planned or reported**: Backend 78 of 117 suites. 57 fail only on 2.0.0's
  required response fields that later tasks serve: `Event.priceMax` (T023), `EntryTicket.levelName`
  and `Ticket.levelName` (T036, T050–T051), `EventSales.levels`; 10 set up seats through the removed
  `PUT /locations/{id}/layout` (404) and are rewritten by T027–T030; 7 do not compile because they
  test retired seating and no task lists them (`test/unit/event-setup.spec.ts`,
  `events.create-setup`, `events.create-setup.concurrency`, `events.update-setup`,
  `orders.holder-name`, `seats.concurrency`, `demo-reset`); `entry.lookup` writes a seat without
  labels (`ticket_seat_all_or_none`); `rate-limits.buy` as T001. Builds: Admin and Customer apps (as
  planned), and the Booth app, whose type check includes `packages/shared/src/web/seat-stream.ts`
  and `use-seat-stream.ts` (`SeatMap`, `getSeatMap`; T039).
- [X] T009a Keep the branch's general-admission suites green after step 2, and give every retired-
  seating test an owner (added after T009, 2026-11-13):
  - **Level foreign keys** in `backend/prisma/migrations/<timestamp>_seat_maps/migration.sql` and
    `schema.prisma` as data-model.md now says: `SeatRow.levelId` and `Seat.levelId` `ON DELETE SET
    NULL`; `Section.levelId` `NO ACTION DEFERRABLE INITIALLY DEFERRED` (R7). Add to T003's test: a
    layout whose rows and seats have levels of their own is deleted in one statement, and so is its
    venue.
  - **Serve the required 2.0.0 fields that need no new behavior**, so every general-admission suite
    passes: `Event.priceMax` (`null` for general admission; for a seated event the highest price of a
    level with seats on sale, read from `EventLevelPrice` and `EventOffSaleSeat`); `Ticket.price`,
    `Ticket.levelName` and `SeatLabel.rowLabel`/`seatLabel` (from the ticket's columns, in every
    response that has a ticket); `EntryTicket.levelName`; `EventSales.levels` (`[]` for general
    admission; for a seated event its levels, tickets sold and revenue grouped by `Ticket.levelName`
    as sold, R17). `Event.seatSeq` is never sent (a BigInt).
  - **Retired-seating tests**: delete the cases that test the section-to-type mapping from
    `backend/test/unit/event-setup.spec.ts`, `events.create-setup.e2e-spec.ts`,
    `events.create-setup.concurrency.e2e-spec.ts` and `events.update-setup.e2e-spec.ts` (T020 adds
    their layout versions); move `orders.holder-name.e2e-spec.ts`'s seated cases to T028's
    `seatedEvent` helper (or delete them here and add them back in T028); `seats.concurrency` is
    rewritten by T029; `demo-reset.ts`'s `LABELS` list the new tables in place of `Section` and
    `SectionTier`; `entry.lookup.e2e-spec.ts` writes its seated ticket with labels and a `seatId`.
  - After it: every Backend suite passes except those whose seated setup a later task rewrites
    (each named in that task), listed in this task's Done note with their owner.
  **Done** (2026-11-13): the two delete cases added to T003's test first and seen failing
  (`SeatRow_levelId_fkey`); then `SeatRow.levelId` and `Seat.levelId` `ON DELETE SET NULL`,
  `Section_layoutId_levelId_fkey` `DEFERRABLE INITIALLY DEFERRED` (Prisma's `onDelete: SetNull` and
  `NoAction`); T003's 20 tests pass, `prisma migrate diff` from the migrations to the schema is
  empty. Tests for the fields written first and seen failing on the missing fields, then served:
  `events.price-max.e2e-spec.ts` (new: `null` for GA in create, get and list; a seated event's
  highest priced level with a seat on sale, a level reached only by a row's or a seat's own level,
  a priced level with no seats ignored, one taken off sale); `reports.e2e-spec.ts` (`levels: []`
  for GA; a seated event's current levels by rank with price, `null` when unpriced, and seats not
  off sale, tickets sold and revenue from VALID tickets by `levelName` as sold, matched by name, then
  a name no level has with `levelId` and `price` `null`; `tiers: []`); `attendees.e2e-spec.ts`
  (each ticket's `price`, `levelName`, `seat.rowLabel`/`seatLabel`; GA `null`s; `unitPrice` `null`
  when prices differ); `entry.lookup`/`entry.live-code` (`levelName`, seat labels). Served by
  `events/price-range.ts` (one grouped statement for any number of events, on every event
  response), `common/ticket-seat.ts` (orders, attendees, My orders, the gate), `ReportsService`'s
  `levelSales`; `EntryTicket` in `packages/shared/src/entry.ts` gains `levelName` and the labelled
  seat (`SoldSeat`, the contract's `SeatLabel`). Test helpers in `test/setup/fixtures.ts` until the
  routes serve them: `insertLayout`, `seatEventOn`, `sellSeats` (T027's `seatedEvent` goes through
  the API); `holdSeats` takes a `seatId`. Retired tests: the mapping cases deleted from the four
  files named (`event-setup.spec.ts` keeps 12 GA tests; the first-broken-rule case now on names and
  quantities); `events.create-setup`'s FR-015 rollback now fails the second ticket type's insert (the
  mapping insert was the last write) and the update-setup GA test no longer sends
  `reservedSeating`; `orders.holder-name`'s seated case deleted, for T028 to add back on its
  `seatedEvent` (T028's text does not yet say so); `seats.concurrency` compiles (a ticket `price`)
  and stays red for T029; `demo-reset.ts`'s `LABELS` list `Layout`, `PriceLevel`, `Section`,
  `SeatRow`, `Seat`, `EventLevelPrice`, `EventOffSaleSeat` (no `SectionTier`), and
  `demo-reset.e2e-spec.ts`'s extra data now puts its seated event on an inserted layout with a sold
  seat, an off-sale seat and both holds by SQL, so it passes (T046 still adds the Yum! Center data);
  `entry.lookup` sells its seated ticket with labels and a `seatId`; `gate-check-in.constraints` and
  `live-codes.constraints` insert their tickets with a `price`. `npx tsc --noEmit -p backend` clean
  (tests included); ESLint and Prettier clean; shared 26 files, 797 tests pass.
  **Backend after T009a** (`jest --runInBand`): 15 of 118 suites red, 109 of 1,363 tests (before:
  80 of 117 suites, 577 of 1,293 tests, with T003's two new cases). Red, with owner: T027
  `reservations`, `reservations.boundaries`, `reservations.admin-changes`,
  `seat-holds.constraints`; T028 `orders.seats`, `orders.reservation`; T029 `seats.concurrency`;
  T030 `seat-stream` (all set up seats through the removed `PUT /locations/{id}/layout`, `404`).
  **Red with no owner in this list** (the same `404` setup; not named by any task):
  `reservations.concurrency` (3 tests; T029's race is its 038 form), `rate-limits.hold` (5),
  `rate-limits.ordinary` (1 of 6), `rate-limits.buy` (its seated case, 1 of 8, beside T001's
  200-connection case), `orders.ticket-limit` ("counts the seats of a reserved-seating event", 1 of
  16), `events.ticket-limit` ("a venue layout below a seated event's limit", 2 of 19; T010's lines
  edit refused above `maxTicketsPerCustomer` is its 038 form), `locations.address-edit` (3 of 46:
  a typed capacity on a laid-out venue and its races with a layout save; T017's rule).

**Checkpoint**: the database carries today's data over; one seating model, contract 2.0.0; the
helpers pass their tests.

---

## Phase 3: User Story 1 - A venue has several layouts, each a map with price levels (P1) 🎯 MVP

**Goal**: admins import layout files and make layouts from section lines; the venue page lists them
with a preview; locked layouts refuse changes but duplicate (FR-001–FR-009).

**Independent test**: quickstart S2–S5; Backend `layouts` tests; Admin `LayoutsCard` test.

### Tests first

- [ ] T010 [P] [US1] `backend/test/integration/layouts.e2e-spec.ts` (FR-001–FR-009, R5–R7;
  contracts/README.md): `importVenueLayout` with `small.json` → `201`, counts, `source: FILE`, levels
  by rank, every section's `outline`, `labelAt` (the centroid when the file has none), `levelIds`;
  `getVenueLayoutSection` gives rows front first and each seat's resolved level and `accessible`;
  `bad.json` → `400 LAYOUT_FILE_INVALID`, every problem in `details.problems` with `path` and a
  message naming section, row and seat ("Section 104, row F: seat 7 appears twice"), nothing saved;
  each limit on both sides (100/101 sections, 100/101 rows, 200/201 seats a row, 30,000/30,001 seats,
  12/13 levels, 64/65 outline points, a name of 50/51 characters, a label of 5/6); a body over 4 MB
  refused and one just under accepted; another route still refusing a 200 kB body; a request `name`
  replacing the file's; `409 LAYOUT_NAME_TAKEN` ignoring case; `createVenueLayout` "Floor A, 10 × 20,
  Front" + "Floor B, 10 × 20, Back" → 400 seats, rows `1…10`, seats `1…20`, the R6 grid; a section
  level not in `levels` and repeated names → `400`; `updateVenueLayout` rename; lines on a `FILE`
  layout → `400`; a lines edit keeps the ids of unchanged levels, sections, rows and seats and an
  event's prices and off-sale seats on them, and deletes what is gone with theirs; a layout used by a
  scheduled event with a VALID ticket, or with a live hold → rename, edit and delete `409
  LAYOUT_IN_USE` naming the event; after that event is cancelled → rename and edit allowed, delete
  still `409` (a cancelled or past event uses it, FR-006); a layout used by a scheduled event with no
  sales → delete `409`; a layout no event uses, with levels, sections, rows and seats → delete
  `204` (the cascade is not refused by the level foreign keys); a delete that would lower the
  venue's capacity below a scheduled GA event's → `409 CAPACITY_EXCEEDED`; a lines edit of a layout
  used by an unsold scheduled event puts the new seats off sale for it and recomputes its capacity,
  `basePrice` and `priceMax`, and is refused (`409 LAYOUT_IN_USE`, naming the event and why) when a
  section moves to a level the event has no price for, when no seat would be on sale, or when its
  `maxTicketsPerCustomer` would exceed its seats on sale; a carried-over layout with 20 levels takes
  a lines edit with 20 levels and refuses 21 (`400`), while a new layout refuses 13; `duplicateVenueLayout` always `201`, "(copy)", then
  "(copy 2)", new ids, unlocked; `seatingCapacity` = largest layout, recomputed on create, import,
  edit, duplicate and delete, kept after the last delete; a layout write that would drop it below a
  scheduled GA event's capacity → `409 CAPACITY_EXCEEDED` naming it; `listVenueLayouts` ordered by
  name with `eventsUsing` and `locked`; `getVenueLayout.latestPrices` from the latest-starting
  scheduled event, `null` with none; every response `expectToMatchContract`. Must fail.
- [ ] T011 [P] [US1] `backend/test/integration/layouts.authz.e2e-spec.ts`: for each of the eight
  layout operations, missing, expired, wrong-signed, wrong-audience and wrong-role tokens (`401`,
  `403`), as `event-images.authz.e2e-spec.ts` does; reads allowed to a customer and a gate agent.
  Must fail.
- [ ] T012 [P] [US1] `backend/test/integration/layouts.concurrency.e2e-spec.ts`: a lines edit and a
  hold of a seat of an event on the layout, started together 10 times: either the hold succeeds and
  the edit is refused (`409 LAYOUT_IN_USE`), or the edit succeeds and the hold sees the new layout,
  never a hold on a seat the edit deleted; two imports with one name at once: exactly one `201`.
  Must fail.
- [ ] T013 [P] [US1] `admin-app/test/layouts-card.test.tsx` (R15, FR-007, FR-009): the Layouts card
  lists each layout's name, seats, sections, levels, "used by N events", "Locked: seats sold at
  {event}" when locked, and a preview (an `svg` with one outline per section, no seat circles);
  Import layout file reads a chosen JSON file and sends it; `LAYOUT_FILE_INVALID` lists every
  problem under the input and keeps the file chosen; New layout from section lines with a level
  column and level names; Rename, Duplicate, Delete (confirm), each refusal shown beside its
  control; the venue's capacity field read-only with "From the largest layout (22,090 seats)".
  `admin-app/test/section-lines.test.tsx` and `layout.test.tsx` updated to the level column. Must
  fail.

### Implementation

- [ ] T014 [US1] `backend/src/layouts/layout-file.ts`: check a `LayoutFile` as a whole (R5): shape
  and every `LAYOUT_LIMITS` limit, trimmed unique names and labels ignoring case, level keys
  and level ranks unique, level keys resolve, `kind: NONE` ⇔ no outline, every point inside `size`, at most 50 problems plus `more`;
  expand runs; give the rows to save with numbers by order and seats with numbers by order. Messages
  name places as people read them ("Section 104, row F: seat 7 appears twice").
- [ ] T015 [US1] `backend/src/layouts/layouts.service.ts`, `layouts.controller.ts`,
  `layouts.module.ts`, DTOs for `LayoutLinesInput`, `LayoutUpdate`, `LayoutDuplicate`,
  `LayoutImport` (the file itself checked by T014, not by the global pipe): list, get, section,
  create, import (`createMany` in batches of 5,000 inside one transaction), update (rename; lines
  keeping ids by label, new seats off sale for unsold events using it, their capacity and prices
  recomputed, the refusals of R6), duplicate, delete (refused while any event uses it; capacity
  checked); the lock and capacity rules (R7) under `layout-lock.ts`; `seatingCapacity` written in the same transaction; after commit, `end()` the
  seat streams of events on a changed layout. Register in `app.module.ts`; remove the `x-planned`
  markers of the eight operations in `contracts/openapi.yaml` and regenerate `api-schema.ts`.
- [ ] T016 [US1] `backend/src/configure-app.ts`: a JSON body limit of `LAYOUT_LIMITS.maxImportBytes`
  on `POST /locations/:id/layouts/import` only; every other route keeps the default.
- [ ] T017 [US1] `backend/src/locations/`: `updateLocation` refuses a typed `seatingCapacity` while
  the venue has layouts (as `007` did with its layout); `deleteLocation` unchanged (layouts cascade
  with a venue that has no events).
- [ ] T018 [P] [US1] Shared map drawing for previews: `packages/shared/src/web/venue-map/map-geometry.ts`
  (outline to SVG path, bounds, centroid, `viewBox` of a section) and
  `packages/shared/src/web/venue-map/layout-preview.tsx` (sections and floor object only, each
  section's name, no seats, `role="img"` with an accessible name "Basketball: 54 sections"), with
  `packages/shared/test/venue-map/layout-preview.test.tsx` written first.
- [ ] T019 [US1] Admin app: `admin-app/src/api/layouts.ts` (the eight operations, typed from
  `api-schema.ts`), `admin-app/src/components/LayoutsCard.tsx` (replaces `LayoutCard.tsx`; R15),
  `SectionLines.tsx` (a level column and a levels list), `pages/LocationForm.tsx` and
  `pages/LocationDetail.tsx` (the card, the read-only capacity). Remove `LayoutCard.tsx` and its
  uses. T010–T013 pass.

**Checkpoint**: layouts can be made, listed, previewed, locked and duplicated.

---

## Phase 4: User Story 2 - An admin schedules a seated event: a layout, a price per level, seats off sale (P1)

**Goal**: an event uses a layout, prices each level, takes seats off sale, all in the event save
(FR-010–FR-015, R8, R9).

**Independent test**: quickstart S6–S9; Backend `event-seating` tests; Admin `SeatingSection` test.

### Tests first

- [ ] T020 [P] [US2] `backend/test/integration/event-seating.e2e-spec.ts` (FR-010–FR-015, R8, R9):
  `createEvent` with `layoutId`, `levelPrices` for every level with seats on sale and `offSale`
  selectors (a whole section, two rows, two seats) → `201`, `reservedSeating: true`,
  `totalTicketCapacity` = seats − off sale, `basePrice` = lowest on-sale price, `priceMax` = highest,
  a sent `basePrice` ignored; a level with seats on sale and no price → `400` `details.field:
  levelPrices` naming it, nothing saved; a level whose seats are all off sale needs no price; a level
  of another layout, a level twice, a selector naming no seat, `seat` without `row` → `400`; a
  layout of another venue → `400`; `layoutId` with `tiers` → `400`; `layoutId` with
  `totalTicketCapacity` → `400`; every seat off sale → `400`; `maxTicketsPerCustomer` above the seats
  on sale → `409 CAPACITY_EXCEEDED` `details.field`; `updateEvent` changing the layout with no sales
  clears prices and off-sale seats; with a VALID ticket or a live hold → `409 EVENT_HAS_ORDERS`, as
  is clearing it; taking a sold or held seat off sale (by seat, row or section) → `409 SEAT_TAKEN`
  `details.seats`; a price change keeps sold tickets' prices; `updateEvent` without the three fields
  leaves them; `updateEvent` with `layoutId: null` makes the event general admission keeping its
  capacity and base price unless sent; a new `layoutId` with `levelPrices` and `offSale` in the same
  request saves those for the new layout; `locationId` and a `layoutId` of the new venue together →
  `200`, of the old venue → `400`; moving the event to another venue with a layout and no sales clears the layout;
  `getEventSeating` compacts selectors (section, then rows, then seats) and gives each level's
  seats, seats on sale and price; a GA event gives `layoutId: null` and empty lists;
  `createTicketTier` on a seated event → `400`; the event list and `getEvent` carry `layoutId` and
  `priceMax` (`null` for GA); every response `expectToMatchContract`. Must fail.
- [ ] T021 [P] [US2] `backend/test/integration/event-seating.authz.e2e-spec.ts`: `getEventSeating`
  and the seating fields of `createEvent`/`updateEvent` for each token case; `401`/`403`. Must fail.
- [ ] T022 [P] [US2] `admin-app/test/seating-section.test.tsx` (FR-015, R15; `035`'s rules):
  reserved seating offers the venue's layouts with a preview; picking one shows the price table
  (level, color swatch, seats on sale, empty price box) started from `latestPrices`; the off-sale tool
  in a zoomed section (Whole section off sale / on sale, a checkbox per row, a seat click) updates
  "N seats on sale · M off sale" at once; a level with every seat off sale drops its price box;
  sold or held seats disabled with the reason; submit with an empty on-sale price box shows the
  problem beside it and focuses it, sending nothing; a Backend `400 levelPrices`, `409 SEAT_TAKEN`
  and `409 EVENT_HAS_ORDERS` each shown beside its field and focused, every value kept; the request
  sends `layoutId`, `levelPrices` and `offSale` (and no `reservedSeating`, `tiers` or
  `totalTicketCapacity`); on Edit, the section loads `getEventSeating` and locks the layout select
  when sales exist. Update `event-seating-create.test.tsx`, `seating.test.tsx`,
  `event-form-flow.test.tsx` and `event-types-edit.test.tsx` from section-to-type mapping to layouts.
  Must fail.

### Implementation

- [ ] T023 [US2] `backend/src/seating/event-seating.ts`: validate and save `layoutId`, `levelPrices`,
  `offSale` inside the event's transaction under its lock (R8): expand selectors to seat ids, refuse
  sold or held seats, write `EventLevelPrice` and `EventOffSaleSeat`, set `reservedSeating`,
  `totalTicketCapacity`, `basePrice`; compaction for reads; `latestPrices` (the most recently
  created scheduled event on the layout). The venue is locked first (`lockVenueShared`, as
  `events.service.ts` does today), then the event; never the layout. Called from
  `backend/src/events/event-setup.ts` (`createEvent`, `updateEvent`; refusal order: fields, then
  layout, then prices, then off-sale, then capacity and limit, as `031` orders its checks) and
  `events.service.ts` (`priceMax` on every event read, the venue-change rule, `layoutId: null`). An
  off-sale change publishes `seats` changes with a new `seatSeq`; a layout or price change ends the
  event's streams (R12).
- [ ] T024 [US2] `GET /events/:id/seating` (`getEventSeating`) in
  `backend/src/seating/event-seating.controller.ts`; `backend/src/tiers/` refuses a tier on a seated
  event (`400`); remove the `x-planned` marker of `getEventSeating`; regenerate `api-schema.ts`.
- [ ] T025 [US2] Admin app: `admin-app/src/components/SeatingSection.tsx` (R15) in
  `pages/EventForm.tsx`'s Seating section (replacing the section-to-type mapping and the seat totals
  of `035` FR-008 for seated events); the price table; the off-sale tool on the shared map (the
  tool's state is a set of selectors, compacted as the Backend does); the line; refusals beside their
  fields (`035` FR-010). T020–T022 pass.

**Checkpoint**: a seated event can be scheduled on a layout with prices and seats off sale.

---

## Phase 5: User Story 3 - A customer chooses seats on the venue map (P1)

**Goal**: the venue map with a price filter and zoom; holds and orders across levels, each ticket at
its own price; live changes (FR-016–FR-026, FR-029, R10–R14).

**Independent test**: quickstart S10–S15, S19; Backend `venue-map`, `holds.levels`, `orders.levels`,
`seats.concurrency`, `seat-stream` tests; shared and Customer map tests.

### Tests first

- [ ] T026 [P] [US3] `backend/test/integration/venue-map.e2e-spec.ts` (R11, FR-016, FR-028,
  FR-029): `getVenueMap` gives the layout's drawing, levels with this event's prices (`null` for a
  level with nothing on sale) and per section and level `open`, `reserved`, `sold`, `offSale` that
  add up to the section's seats, after holds, a sale, a void ticket and off-sale seats;
  `getVenueMapSection` gives each seat's state and resolved level; both carry the event's `seq`,
  read in the same statement as the states; a section of another layout →
  `404`; a GA event → `404`; no response contains a customer's sub, username, order or holder name;
  the same answer for an admin and a customer; authorization cases for both operations; contract
  matches. Must fail.
- [ ] T027 [P] [US3] `backend/test/integration/holds.levels.e2e-spec.ts` (FR-021, R10): one
  reservation holds seats of three levels, still at most 10 (`400` at 11 as before);
  `Reservation.tierId` is `null`; each `ReservedSeat` has `rowLabel`, `seatLabel`, `levelName` and the
  current `price`; an off-sale seat → `409 SEAT_OFF_SALE` `details.seats`, nothing held; a seat of
  the layout that does not exist (`row` or `seat` too high) → `400`; the `016` limit and `033`'s wait
  unchanged. Update `reservations.e2e-spec.ts`, `reservations.boundaries.e2e-spec.ts`,
  `reservations.admin-changes.e2e-spec.ts`, `seat-holds.constraints.e2e-spec.ts` and the test
  fixtures (`backend/test/setup/fixtures.ts`: a `seatedEvent` helper that makes a lines layout and
  prices it) from section-to-tier setups to layouts. Must fail.
- [ ] T028 [P] [US3] `backend/test/integration/orders.levels.e2e-spec.ts` (FR-022, FR-026, R10):
  buying held seats of two levels makes one ticket per seat at its level's price **at purchase**
  (a price changed after the hold applies), `totalPrice` the sum, `unitPrice` the one price when all
  equal and `null` when they differ, each ticket's `price`, `levelName`, `seat.rowLabel`,
  `seat.seatLabel`; `tierId` on a seated order → `400`; an off-sale seat → `409 SEAT_OFF_SALE`;
  `listMyOrders` and `listAttendees` show the same. Update `orders.seats.e2e-spec.ts`,
  `orders.reservation.e2e-spec.ts`, `orders.e2e-spec.ts` seated cases. Must fail.
- [ ] T029 [P] [US3] `backend/test/integration/seats.concurrency.e2e-spec.ts` (FR-025, SC-001): 10
  customers hold the same seat at once → exactly one `2xx`, nine `409 SEAT_TAKEN`; the holder sends
  10 orders for that seat at once, each with its own `requestId` → exactly one `201` and one VALID
  ticket, the rest refused; with the application check bypassed (two VALID tickets for one `seatId`
  inserted at once by SQL) the database refuses one (`ticket_one_valid_per_seat`); an admin taking a
  seat off sale while 10 customers try to hold it → either a hold or the off-sale save wins, never
  both. Genuinely concurrent (`Promise.all` on separate connections). Must fail.
- [ ] T030 [P] [US3] `backend/test/integration/seat-stream.e2e-spec.ts` (R12, FR-023, SC-004): the
  stream begins with `event: venueMap` (a `VenueMap` with `seq`), no `snapshot`; hold, release,
  purchase, expiry and an off-sale save each send `seats` with a `seq` one greater than the last and
  `state`, `from` and `levelId` per seat; a change made while the map is being read (hold during the
  connect, many times) is either in the map or has a `seq` above the map's, never both, so the first
  map plus the changes with greater `seq` equals a fresh `getVenueMap` every time; an off-sale save
  keeps the stream, a layout or price change and a layout edit end it; every message matches
  `x-sse-events`; 20 trials of a hold with a second viewer connected, at least 19 delivered within 2
  seconds (SC-004). Must fail.
- [ ] T031 [P] [US3] `packages/shared/test/venue-map/use-pan-zoom.test.ts` (R13): zoom at a point
  keeps that point under the cursor; zoom bounded (fit … 40×); pan by a drag; two pointers pinch;
  `+`, `−`, arrows; zoom-to-section gives the section's bounds with a margin; reduced motion skips the
  animation. `packages/shared/test/venue-map/map-state.test.ts`: the reducer applies a snapshot,
  then deltas to counts (−1 `from`, +1 `state` for `levelId`), then to a loaded section's seats;
  a change whose `seq` is not above the map's is skipped for counts, and not above a section's for
  its seats; deltas in either order give the same counts; a reconnect replaces the map and reloads
  the open section; a section's color is its cheapest level with open
  seats inside the filter, else unavailable; the filter's range from the levels' prices. Must fail.
- [ ] T032 [P] [US3] `packages/shared/test/venue-map/venue-map.test.tsx` (FR-016–FR-019, SC-007):
  the overview draws every section with its name and fill, the floor object, and a legend naming
  each level with its color and price; the price filter (two range inputs, whole dollars) fades
  sections with no open seats inside it and marks levels outside it in the legend, and "No open seats
  between $X and $Y" with Reset when nothing matches; clicking or pressing Enter on a section zooms
  in and draws its rows and seats with row labels and Back to map; each seat state has its mark
  (open filled, held hollow, sold cross, off sale dash, mine check) and an accessible name "Row F,
  Seat 7, Courtside, $95, open"; hover and focus show "Sec 115, Row F, Seat 7 · Courtside · $95"; faded seats still clickable; the overview never renders seat elements. Must fail.
- [ ] T033 [P] [US3] `customer-app/test/venue-map-flow.test.tsx` (R14, FR-021, FR-022, FR-024): a
  seated event shows "$35–$95" and Choose seats (no ticket-type step); Choose seats opens the map;
  zoom into a section, click seats of two levels: each sends one hold (`033`'s queue), Your seats
  lists each with its level and price and the sum; Back to map; Add to cart; the cart lists each seat
  with level and price from `listMyReservations` (`levelName`, `price`; no venue-map read) and shows
  a changed price after the next poll; Buy tickets; the
  confirmation and My tickets say "Section 115, Row F, Seat 7"; live `seats` messages recolor a
  section. Update `seats.test.tsx`, `seat-holds.test.tsx`, `seat-stream.test.tsx`, `cart.test.tsx`,
  `keyboard.test.tsx`, `purchase` tests from the section-and-grid flow to the map. Must fail.

### Implementation

- [ ] T034 [US3] `backend/src/seating/venue-map.service.ts` and `venue-map.controller.ts`:
  `getVenueMap` (one grouped count query, R11) and `getVenueMapSection`; remove their `x-planned`
  markers; regenerate `api-schema.ts`.
- [ ] T035 [US3] `backend/src/seating/seat-rules.ts`: `resolveSeats` returns seat ids with labels and
  resolved levels from `{sectionId, row, seat}` on the event's layout; no tier rule; refuses off-sale
  seats (`409 SEAT_OFF_SALE`); `soldSeats` by seat id. Every transaction that changes a seat's state
  (hold, release, the sweep, purchase, refund, cancellation, off-sale save) increments
  `Event.seatSeq` once under the event lock and publishes that `seq` (R12).
  `backend/src/reservations/`: holds and releases by seat id, `tierId` null on seated events, `ReservedSeat` labels, level and price,
  the `016` limit and `033`'s wait unchanged; `holds.ts` `toChanges` with `from` and `levelId`.
- [ ] T036 [US3] `backend/src/orders/orders.service.ts`: seated orders without `tierId`; each ticket
  `seatId`, `price` (the level price read under the event lock), `levelName`, `seatSection`,
  `seatRow`, `seatNumber`, `seatRowLabel`, `seatLabel`; `totalPrice` the sum; `unitPrice` null when
  prices differ; responses with `price`, `levelName`, `rowLabel`, `seatLabel`. General admission
  unchanged (each ticket's `price` = `unitPrice`).
- [ ] T037 [US3] `backend/src/seating/seat-stream.controller.ts` and `seat-events.service.ts`: send
  `venueMap` first (with its `seq`; changes that arrive while it is read are still sent, the client
  skips the ones the map already has); changes with `from` and `levelId` from holds, releases, the sweep, purchases,
  refunds, cancellations and off-sale saves; `end()` on seating and layout saves; remove the
  `x-planned` marker of the `venueMap` event. T026–T030 pass.
- [ ] T038 [US3] Theme tokens in `packages/shared/src/web/theme.css`: `--level-violet` …
  `--level-brown` (the 12 names), `--seat-unavailable`, `--seat-mine`, `--map-floor`, `--map-bg`,
  each level color ≥ 3:1 against `--map-bg`; the theme's contrast tests cover them
  (`packages/shared/test/theme*.test.ts`); `admin-app/test/theme-drift.test.ts` and the Customer
  app's still pass.
- [ ] T039 [US3] `packages/shared/src/web/venue-map/`: `use-pan-zoom.ts`, `map-state.ts`,
  `venue-map.tsx` (overview and zoomed section, `colorBy: 'price' | 'state'`, `onSeat` callback),
  `section-view.tsx`, `legend.tsx`, `price-filter.tsx`, exported from `web/index.ts`; styles in the
  shared theme's classes only. `packages/shared/src/web/use-seat-stream.ts` and `seat-stream.ts`:
  the `venueMap` snapshot, the delta reducer, loaded sections kept current. T031, T032 pass.
- [ ] T040 [US3] Customer app: `components/GetTickets.tsx` seated half → Choose seats and the shared
  map (R14) with `033`'s `use-hold-queue.ts` and Your seats (per-seat level and price, the sum);
  `pages/Cart.tsx` (each seat's level and price from `listMyReservations`' `ReservedSeat`, refreshed
  with its poll); `OrderConfirmation.tsx`, `pages/MyTickets.tsx`,
  `pages/PrintTicket.tsx` (labels "Section 115, Row F, Seat 7", level, price);
  `pages/EventList.tsx`, `EventDetail.tsx` ("$20–$95" from `basePrice` and `priceMax`). Remove
  `SeatPicker.tsx`. T033 passes.

**Checkpoint**: the EDIS demo path works end to end on any layout.

---

## Phase 6: User Story 4 - Seats can be chosen without the map (P2)

**Goal**: a Sections list with the same choices and state as the map (FR-020, SC-007).

**Independent test**: quickstart S16; shared and Customer `SectionsList` tests.

- [ ] T041 [P] [US4] `packages/shared/test/venue-map/sections-list.test.tsx` and
  `customer-app/test/sections-list.test.tsx` (FR-020): reachable by keyboard; each section's name,
  price range of its open seats and open count under the filter; choosing one lists its rows as
  groups of seat buttons named "Row F, Seat 7, Lower sideline, $60, open" with `aria-pressed` for
  held-by-me; Enter or Space holds and releases exactly as a map click (the same queue); a hold in
  either view shows in the other at once; the whole flow to buying by keyboard only. Must fail.
- [ ] T042 [US4] `packages/shared/src/web/venue-map/sections-list.tsx` on the same `map-state`;
  beside the map at laptop width and below it under 640 px; used by `GetTickets.tsx`. T041 passes.

---

## Phase 7: User Story 5 - The demo resets to the Yum! Center events John showed (P2)

**Goal**: the four layouts from committed files made by a generator from a traced plan, and four demo
events with sold seats, in the reset (FR-033, R18). The generator and files (T043–T045)
need only Phase 2's `LayoutFile` checks and can start right after Phase 2.

**Independent test**: quickstart S0, S1; Backend `demo-data` test; generator test.

- [X] T043 [P] [US5] `scripts/test/layouts.test.mjs` (node:test, run by `npm test`'s
  `scripts/test/*.test.mjs`): the generator's output for each of the four layouts is valid against
  the contract's `LayoutFile` (Ajv 2020 with the contract, as `expect-to-match-contract.ts`), has 54
  sections for Basketball, exactly 22,090 seats for Basketball and 17,500 for End-stage concert,
  Center stage and Wrestling within ±5% of 19,500 and 18,000, the lower rows `D…Z, AA…` and upper
  rows `A…W`; Basketball's four levels exactly as research R18 pins them (Courtside = rows D–G of
  104–108 and 113–117; Lower sideline = their other rows and terrace 209–212; Lower end = 101–103,
  109–112, 118–120; Upper = 301–330), the other layouts' three (Floor, Lower, Upper); running it
  twice gives byte-identical files; the committed files equal a fresh run. Must fail.
  **Done** (2026-11-13): written first and seen failing (the generator did not exist). 14 tests:
  the four files valid against `LayoutFile` (Ajv 2020 from the Backend's dependency, the contract
  loaded as `expect-to-match-contract.ts` does), R5's other limits, every seat (each run expanded
  as T004 states) inside its own section; the totals, row letters, levels, seat 1 on the right;
  two runs into temporary directories byte-identical; `--check` passes on the committed files and
  fails on a changed one.
- [X] T044 [P] [US5] `scripts/layouts/yum-center/plan.json`: the section plan traced by hand from
  the venue's public seating charts (D6; no ticket seller's data): for each layout, the floor object,
  each section's name, outline, row line (front edge and back edge), row labels and level; floor
  sections for the concert (1–5), center stage and wrestling layouts. A header note in
  `scripts/layouts/yum-center/README.md` names the sources (the venue's published charts), the
  published capacities, and what is our estimate.
  **Done** (2026-11-13): a geometric approximation, not a trace of any chart: the venue's public
  facts (capacities, section numbers, row letters, seat 1 on the right, the end-stage cut) on a
  superellipse bowl in map units of about a foot. No ticket seller's data. The README says what is
  ours: the shape, seats per row, depths, the floor sections, Center stage's and Wrestling's cuts and
  totals, and how the published cut sits on R18's axis (one section wider on the 101 side).
- [X] T045 [US5] `scripts/layouts/generate-yum-center.mjs` (plain Node ES module, like
  `scripts/*.mjs`): reads the plan, spreads seats per row so each layout's total matches its target,
  writes `backend/src/scripts/layouts/yum-center-basketball.json`, `-end-stage.json`,
  `-center-stage.json`, `-wrestling.json` as seat runs (R5), sorted and formatted deterministically;
  `node scripts/layouts/generate-yum-center.mjs --check` exits non-zero when a committed file differs.
  T043 passes.
  **Done** (2026-11-13): Basketball 22,090 (54 sections), End-stage concert 17,500 (1,504 on the
  floor), Center stage 19,500 and Wrestling (ring) 18,000 (our estimates; 1,422 and 548 on the
  floor). Each file checked against `LayoutFile` before it is written; written one row a line, places
  to 0.1, so the files are in `.prettierignore` beside `api-schema.ts`. T043's 14 tests pass; ESLint
  and Prettier clean.
- [ ] T046 [P] [US5] `backend/test/integration/demo-data.e2e-spec.ts` and `demo-reset.e2e-spec.ts`
  updated (FR-033, SC-008, US5): after the demo data, the venue "KFC Yum! Center" (1 Arena Plaza,
  Louisville, KY 40202) has exactly four layouts with those seat counts, `seatingCapacity` 22,090;
  the four upcoming events of research R18's table with exactly those layouts, prices and off-sale
  seats; each with about 40 sold seats and **no** live hold; Basketball used by 2 events and locked,
  End-stage concert and Wrestling by 1 and locked, Center stage by none and unlocked; the other demo
  venues unchanged (they have no layout); two resets end in the same layouts, prices, off-sale seats
  and seat states (times relative to the run). Must fail.
- [ ] T047 [US5] `backend/src/scripts/demo-data.ts`: the Yum! Center venue, its four layouts through
  the layouts service's import (the JSON modules), the four events through `EventsService` with
  `layoutId`, `levelPrices`, `offSale` (research R18's table), then sold seats through
  `ReservationsService` and `OrdersService` (a hold, then an order, as a customer does); no seat is
  left held (a hold lasts 5 minutes; the held state is shown live in the demo); `DemoSummary` gains
  `layouts`.
  `backend/src/scripts/demo-reset.ts` prints them. T046 passes. *Demo data usable from here.*

---

## Phase 8: User Story 6 - The admin watches a seated event on the same map (P3)

**Goal**: the Admin event page's live map by seat state with counts (FR-027).

**Independent test**: quickstart S17; Admin `EventSeatMap` test.

- [ ] T048 [P] [US6] `admin-app/test/event-seat-map.test.tsx` (FR-027, FR-028): the event page
  shows the map colored by state with a state legend (open, held, sold, off sale) and each section's
  "sold / open" counts; zoom into a section; a live `seats` message changes a seat and its section's
  counts; no buyer shown (the attendee list link stays). Update `seat-holds.test.tsx` and
  `EventDetail.test.tsx` from the grid to the map. Must fail.
- [ ] T049 [US6] `admin-app/src/components/EventSeatMap.tsx` on the shared map (`colorBy: 'state'`)
  and `useSeatStream`, in `pages/EventDetail.tsx`; remove `SeatingCard.tsx` and `SeatGrid.tsx`.
  T048 passes.

---

## Phase 9: Reports, attendee lists, the gate (FR-026, FR-030, R17)

- [ ] T050 [P] `backend/test/integration/reports.e2e-spec.ts`, `attendees.e2e-spec.ts`,
  `entry.lookup.e2e-spec.ts`: a seated event's `EventSales.levels` (name, price, seats on sale,
  tickets sold, revenue) and empty `tiers`; attendees with each ticket's level and price; the entry
  ticket's `levelName` and seat labels. `admin-app/test/attendees.test.tsx`,
  `attendees-export.test.tsx`, `reports.test.tsx`, `reports-export.test.tsx`: a Price level column
  and a Price per ticket in the list, CSV, Excel and PDF. `booth-app/test/` entry result: "Section
  115, Row F, Seat 7" and "Lower sideline". Must fail.
- [ ] T051 `backend/src/reports/`, attendee list, `backend/src/entry/`: the fields above.
  `admin-app/src/pages/Attendees.tsx`, `export/attendee-rows.ts`, the report page and its exports;
  `booth-app/src/EntryResult.tsx`. T050 passes.

---

## Phase 10: Contract step 2, browser tests, polish

- [ ] T052 [P] `e2e/tests/038-seat-maps.spec.ts` (quickstart S0, S5, S6, S10–S14, S16, S17), each
  test titled `038 <labels>: <description>` (spec `022`): S0 (the Yum! Center's four layouts after
  the e2e stack's reset); S5 (locked Basketball refuses rename; Duplicate works); S6 (schedule on
  Basketball, the upper level and rows D–F of 104 off sale, Upper's price box gone, price $95, $60,
  $35, save, the event price "$35–$95"); S10–S13 (filter $50–$100 fades the end sections, zoom 115,
  hold Row F 7 and 8 at $95 and Row P 7 at $60, total $250, Back to map, Add to cart, buy, My
  tickets labels) at laptop and phone width (zoom buttons and tap); S14 (a second customer sees
  a hold within 2 s); S16 (the Sections list by keyboard to a hold); S17 (the admin map shows a
  customer's hold). Must fail.
- [ ] T053 [P] Update the browser tests that set up seating, titles unchanged: `006-007-tickets`,
  `015-seat-holds`, `031-atomic-event-create`, `033-seat-hold-cart`, `035-event-form-flow`
  (`e2e/tests/*.spec.ts`), and `e2e/helpers` (a layout helper through the API) from
  section-to-type mappings to layouts.
- [ ] T054 Contract check: `grep -n "x-planned: '038'\|x-retired" contracts/openapi.yaml` finds
  nothing; `info.version` is 2.0.0; `node scripts/check-contract-drift.mjs` passes; the
  route-coverage test passes; no app imports a type step 2 removed (`tsc` in every workspace);
  `admin-app/src/api/seating.ts` has no old calls left; Customer `OrderConfirmation.tsx` and
  `MyTickets.tsx` and Admin `attendee-rows.ts` and `Attendees.tsx` show each ticket's `price` when
  `unitPrice` is `null`.
- [ ] T055 `specs/038-seat-maps/quickstart.md`: the Automation rows of S0, S5, S6, S10–S14, S16,
  S17 → `Automated: \`<exact test title>\``; the rest Manual with their reason;
  `node scripts/check-quickstart-marks.mjs` passes.
- [ ] T056 [P] `README.md`: the 038 row (Plan and tasks "Done (N/62 tasks)", Code "Built (review
  pending)"), seat maps in the feature list, the demo's Yum! Center, the layout file format pointer
  (`contracts/openapi.yaml` `LayoutFile`), `scripts/layouts/generate-yum-center.mjs`.
- [ ] T057 Coverage: each workspace ≥ 80% lines (`npm test`); add tests where a new file falls short,
  no exclusions.
- [ ] T058 `npm run ci` green locally; `npm run e2e` green; record the run.
- [ ] T059 Timing checks (quickstart "Timing checks"; SC-002, SC-003, SC-005) on the demo state on a
  laptop; record the times in the PR description.
- [ ] T060 Independent review of the implementation branch by a Claude session that did not write it
  (Constitution III), against the merged spec and plan; fix the findings; record the review and any
  open finding in the PR description.
- [ ] T061 Walk the quickstart on a Compose project of your own (`-p qp038`): S0–S21 and the
  Constitution VI smoke test (sign in, use, sign out of each front end); Nate's "pass" closes it.
- [ ] T062 Push `038-seat-maps-impl` (ask first); open the implementation PR (ask first) assigned to
  `nathan-707`, its description with `fixes #165` on its own line, the review record, the timing
  checks, and the shared surface touched; CI `test` and `e2e` green before merge.

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** (blocks everything).
- **US1 (Phase 3)** needs Phase 2. **US2 (Phase 4)** needs US1 (an event picks a layout). **US3
  (Phase 5)** needs US2 (prices and off-sale seats) for its Backend; its shared map tasks (T031,
  T032, T038, T039) need only T018 and can run beside US2.
- **US4 (Phase 6)** needs T039. **US5 (Phase 7)**: T043–T045 need only Phase 2 (run beside US1);
  T046–T047 need US1, US2 and US3's Backend (T035–T036, holds and orders for the sold seats). **US6 (Phase 8)**
  needs T039 and T037.
- **Phase 9** needs T036. **Phase 10** needs all. Step 2 is T009, in Phase 2: from then on the
  branch has one seating model, and each app's seating tests come back as its phase moves it.

```text
Phase 2 ─┬─ US1 ── US2 ── US3 (Backend) ─┬─ US5 (T046–T047) ── Phase 9 ── Phase 10
         │                               └─ US6
         ├─ US5 generator (T043–T045)
         └─ T018 ── shared map (T031, T032, T038, T039) ─┬─ US3 (Customer) ── US4
                                                         └─ US6
```

## Parallel examples

- **Phase 2**: T003 and T004 together; then T005 → T006 while T007 runs; T008; then T009, T009a.
- **US1**: T010, T011, T012, T013 together; T018 beside T014–T017.
- **US2**: T020, T021, T022 together.
- **US3**: T026–T033 together (eight test files in four workspaces); T038 beside T034–T037.
- **Across stories**: the generator (T043–T045) by itself any time after Phase 2.

## Implementation Strategy

1. **MVP for EDIS (2026-11-20)**: Phases 1–2, US1, US2, US3, then US5. Stop and walk S0, S6,
   S10–S13 on the demo state: John's demo is the women's game on the Yum! Center map, filtered by
   price, zoomed into a section, holding seats of two levels and buying them.
2. **Then** US4 (accessibility of the same flow), US6 (the admin's live map), Phase 9 (reports,
   attendees, gate).
3. **Then** Phase 10: contract step 2 and the retired code removed, browser tests, coverage, review,
   walk, PR. Nothing merges until the whole PR is green; a partial demo runs from the branch.
