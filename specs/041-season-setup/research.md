# Research: Season Setup (Admin Side) and the Shared Season Contract

**Feature**: `041-season-setup` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

Each decision below is cited by the plan, the data model, the contract notes, and the tasks as
`R<n>`. Paths are relative to the repository root.

## What exists

- **Events** (`backend/src/events/`): `events.controller.ts` (`@Controller('events')`, admin
  handlers `@Roles('queuepass-admin')`), `events.service.ts` (`update` checks the layout lock at
  about line 425; `cancel` at 569–605 voids valid tickets, refunds confirmed orders, closes holds
  and publishes freed seats, all under `lockEvent`), `event-setup.ts` (the local `refuse` for field
  400s), `event-time.ts` (`checkEventTime`: a time in the venue's zone with its offset).
- **Locks** (`backend/src/common/`): `lockEvent` (`event-lock.ts`, `SELECT … FOR UPDATE` of one
  event, `LOCKING_TX`), `lockVenue`, `lockVenueAndEvents`, `lockVenueShared` (`venue-lock.ts`). The
  order everywhere is venue first, then layout, then events in id order; event writes take the venue
  `FOR SHARE` first (spec 020 R10).
- **Refusals**: the envelope `{error:{code,message,details?}}` (`common/filters/
  prisma-exception.filter.ts`); a 400 becomes `VALIDATION_FAILED` with `details.fields`, each
  starting with the field path; a 409 is `conflict(code, message, details)` (`common/conflict.ts`)
  with `details.field`. The Admin app places both beside fields (`admin-app/src/pages/
  event-form-checks.ts`, `fieldErrors`).
- **Seating** (`backend/src/seating/event-seating.ts`): `assertLayoutFree` (294–306) refuses a
  layout change once there is a valid ticket or a live hold (`409 EVENT_HAS_ORDERS`, `field:
  'layoutId'`); `planSeating` refuses taking a sold or held seat off sale (`409 SEAT_TAKEN`).
- **Purchase paths** (042's): `OrdersService.createLocked` (`orders/orders.service.ts:213`, the
  `SALES_CLOSED` check at 250–256) and `ReservationsService.reserveLocked`
  (`reservations/reservations.service.ts:87`, `salesClosed` at 351–355).
- **Reports**: `reports/reports.service.ts` (`EventSales` with `tiers` and `levels`); Admin app
  `pages/Reports.tsx`, `pages/Attendees.tsx`, exports in `admin-app/src/export/` (`sales-rows.ts`,
  `attendee-rows.ts`, one table model for CSV, XLSX and PDF); the Rust Admin app mirrors them in
  `admin-rust-app/core/src/export/rows.rs`.
- **Rust Admin app** (`admin-rust-app/`): `core` (rules, API ops in `core/src/api/client.rs`,
  forms in `core/src/forms/`, page logic in `core/src/pages/`, `cargo llvm-cov` 80% floor) and
  `app` (Leptos views, `app/src/routes.rs`, nav in `app/src/shell.rs`, pages in `app/src/pages/`).
- **Cross-app check**: `e2e/tests/037-rust-admin-app.spec.ts` S11, `const routes = [...]` at about
  line 299, compares every listed route at 1280 and 375 px; every `@admin` test also runs against
  the Rust app (`e2e/playwright.config.ts` project `admin-rust`).
- **Test fixtures**: `backend/test/setup/fixtures.ts` (`venue`, `event`, `tier`, `customer`,
  `seatedLayout`, `seatedEvent`, `sellSeats`, `orderWithTickets`, …).
- **Demo data** (`backend/src/scripts/demo-data.ts`): the KFC Yum! Center, its `Basketball` layout
  (`yum-center-basketball.json`), `createSeatedDemo` creating events through the services.
- **Contract**: `contracts/openapi.yaml` 2.1.0; `npm run generate:api` writes
  `packages/shared/src/api-schema.ts`; `scripts/check-contract-drift.mjs` and the route-coverage
  test (`backend/test/contract/route-coverage.e2e-spec.ts`: an `x-planned` operation must not be
  served, every other one must, with the same roles). `ERROR_CODES` in `packages/shared/src/
  errors.ts`.

## R1. Four new tables and two new columns; constraints in the database

**Decision**: `Season`, `SeasonEvent`, `SeasonPrice`, `SeasonPass` and, for `042`,
`SeasonPassHold`; `Order.seasonPassId` and `SeatReservation.passHoldId`. Every rule that a single
row or a unique index can state is a constraint in the migration SQL (data-model.md):

- `SeasonEvent.eventId` is the table's primary key: an event is in at most one Season (FR-004),
  whatever two admins do at once.
- `Season`: sport and team both or neither (`season_sport_team_together`); passes per customer 1–10;
  `singleSalesOpenAt <= salesEndAt`; status and its times agree (`publishedAt` set unless DRAFT,
  `cancelledAt` set exactly when CANCELLED); name trimmed, 1–100.
- `SeasonPrice`: exactly one of `levelId`, `tierName`; unique per Season per level and per Season
  per name ignoring case; price `>= 0`.
- `SeasonPass`: a seated pass has its seat's labels as sold (`seatSection`, `seatRowLabel`,
  `seatLabel`, as `Ticket` copies them), a general-admission pass a `tierName`, never both
  (`season_pass_one_target`); an active seated pass keeps its `seatId`
  (`season_pass_active_has_seat`); the name on tickets trimmed, as `Order.holderName`;
  `(customerSub, requestId)` unique; `refundedAt` set exactly when REFUNDED.
- Foreign keys: `SeasonEvent`, `SeasonPrice` → `Season` CASCADE (deleting a draft takes them);
  `SeasonPass` → `Season` RESTRICT (a Season with a pass can't be deleted, below the Backend's own
  refusal); `SeasonEvent.eventId` → `Event` RESTRICT (an event in a Season can't be deleted);
  `SeasonPrice.levelId` → `PriceLevel` CASCADE (a removed level takes its price, spec edge case);
  `Order.seasonPassId` → `SeasonPass` RESTRICT; `Season.layoutId` → `Layout` RESTRICT;
  `SeasonPass.seatId` and `SeasonPassHold.seatId` → `Seat` SET NULL (review S1, M1), as `Ticket` and
  `SeatHold` are, so the `039` editor can remove a seat whose passes are all refunded, and ended
  holds stay on record; an active pass and a live hold keep their seat (CHECKs), and their seats'
  layout is locked anyway (an active pass has valid tickets).
- **Error mapping** (review S1): the exception filter maps a violation of `SeasonEvent_eventId_fkey`
  to `409 EVENT_IN_SEASON` and of `Season_layoutId_fkey` to `409 LAYOUT_IN_USE`, for both Prisma's
  `P2003` and a raw query's `23503`, instead of today's fallback ("Cannot delete this venue"). The
  services refuse first with a named message; the mapping only covers what slips past them.

**Rationale**: Constitution IV. The proposal's model table, plus what the current schema needs
(`SeasonPassHold` for 042's one-timer holds, R7).

**Alternatives**: a `Season.layoutId` composite key to `Layout(id, locationId)` so the layout is of
the venue: needs a new unique on `Layout`; the Backend checks it under the venue lock instead, and
layouts never change venue. Rejected for now.

## R2. Lock order: venue (share), Season, then its events in id order

**Decision**: every Season write (create, update, publish, cancel, delete) runs in one transaction
that takes, in this order: the venue `FOR SHARE` (`lockVenueShared`, for the zone its times are
checked against), the Season row `FOR UPDATE` (not on create), then every event involved, old and
new, `FOR UPDATE` in id order. An update locks both the Season's stored venue and the requested
one (`lockVenueShared` takes several, in id order); the stored venue is read before any lock, so the
service re-reads it under the Season lock and, if it changed, rolls back and retries once, as
`updateEvent` does with `VenueMoved` (review S8). `042`'s pass hold and pass confirm take the Season
row `FOR SHARE`,
then the Season's events in id order. Event writes never lock a Season: they read `SeasonEvent`,
`Season` and `SeasonPrice` under their own event lock.

Consequences:

- **FR-005** (events locked after the first sale): an update that changes events holds the Season
  `FOR UPDATE` and counts active passes; a pass confirm holds it `FOR SHARE`. One waits for the
  other, so a pass is never sold against a changing event list, and a change never lands after a
  sale it didn't see.
- **FR-004** under a race: the primary key on `SeasonEvent.eventId` refuses the second insert; the
  service maps the unique violation to `409 EVENT_IN_SEASON` naming the event.
- **FR-007** (layout, seating kind, start, ticket type names): the event write holds the event lock
  and reads the Season; a Season write that adds the event holds the same lock. They serialize.

**Rationale**: the existing rule "venue first, then events in id order, nothing locks an event then
a venue" (spec 007 R3, spec 020 R10, spec 038 R7) extended with one rule: Season before its events.

**Alternatives**: a trigger refusing `SeasonEvent` changes once a pass exists. Stronger, but a
second place for the rule and a harder error to name; the row lock is what Constitution IV allows.

## R3. The API: one Season resource, read by everyone, written by admins

**Decision** (contracts/README.md): `listSeasons` and `getSeason` (any signed-in role; admins see
every Season, others only Seasons on sale, as `listEvents` does for events), `createSeason`,
`updateSeason` (`PUT`, the whole Season with its event ids and prices, all or nothing, like `035`'s
event update), `deleteSeason` (drafts without passes), `publishSeason`, `cancelSeason`. `042`'s
operations are declared now with `x-planned: '042'` (R7). The Season reads are 041's even though
customers call them: 041 owns the `seasons` module, and 042 then needs no read endpoint of its own.

A draft saves with prices or events missing; `publishSeason` applies the full rules (FR-010). A save
of a Season on sale (review S2) applies the rules that keep it sellable (prices complete, events
valid, sales end no later than the earliest event not cancelled) but not the publish-only ones (at
least 2 events, sales end in the future), so it can still be renamed or repriced after its sales
end or an event's cancellation. A save of a cancelled Season is `409 SEASON_CANCELLED`.
`passesSold` and `passRevenue` are `null` for callers who are not admins (review S3): business
figures stay with admins. Lists order Seasons by their earliest event's start, then name; Seasons
with no events last.

**Rationale**: matches the existing event pattern (`listEvents`/`getEvent` for all, writes for
admins); a whole-resource `PUT` keeps the form one request and its refusals per field (`031`).

**Alternatives**: separate customer paths (`/season-tickets`): two serializers for one thing.
`PATCH` with partial bodies: the form always sends everything.

## R4. Refusals

**Decision**: 400 `VALIDATION_FAILED` with `details.fields` for shape and missing values, and for
publish rules: `name`, `locationId`, `layoutId`, `salesEndAt`, `singleSalesOpenAt`, `sport`, `team`,
`maxPassesPerCustomer`, `eventIds` (fewer than 2), `eventIds.<i>` (wrong venue, layout or seating
kind; cancelled; started), `prices.<i>` for a sent entry at fault (by its index in `prices`: not of
the layout, repeated, or a name an event lacks, the message naming the event; review M5, since a
name may contain dots), `prices.<levelId>` for a level with no entry (ids have no dots). Names match
ignoring case, here and in R9. Times use
`checkEventTime`'s rules (`LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH`, with `field`). New 409 codes,
added to `ERROR_CODES` and the contract:

| Code | When | `details` |
| --- | --- | --- |
| `EVENT_IN_SEASON` | adding an event that is in another Season; an event write that would change the venue, layout, seating kind, a priced ticket type's name or its deletion, or move the start before the sales end; deleting an event in any Season | `field`, `seasonId`, `seasonName` |
| `LAYOUT_IN_USE` (existing) | editing a layout an on-sale Season uses; deleting a layout any Season uses | `seasonId`, `seasonName` (added beside the existing details) |
| `SEASON_HAS_PASSES` | changing events, venue or layout, or deleting, once a pass is sold | `field`, `passesSold` |
| `SEASON_CANCELLED` | any write to a cancelled Season | none |
| `SEASON_NOT_DRAFT` | publishing a Season on sale; deleting one on sale or cancelled | `status` |
| `SEASON_NOT_ON_SALE` | cancelling a draft (it is deleted instead); `042`: holding or buying a pass of a Season not on sale | `status` |
| `SEASON_PRESALE` (`042`) | a single-ticket hold or order during the presale | `singleSalesOpenAt` |
| `SEASON_SALES_CLOSED` (`042`) | a pass hold or buy at or after the sales end | `salesEndAt` |
| `PASS_LIMIT_REACHED` (`042`) | buying more passes than `maxPassesPerCustomer` | `limit`, `held` |

The 042 codes are added to `ERROR_CODES` now, ahead of their implementation, as earlier specs did,
so the list matches the contract.

## R5. The presale: one Season field, one Event field, enforced by 042

**Decision**: `Season.singleSalesOpenAt` (nullable). Every event read (`listEvents`, `getEvent`)
gains `season: {id, name} | null` and `singleSalesOpenAt`: the Season's time while the Season is
ON_SALE and that time is in the future, else `null`. 041 serves both fields (the events read is the
events module, admin side). The contract's "Sales window" note gains: while an event's
`singleSalesOpenAt` is in the future, `createOrder` and `reserveSeats` for it are refused with
`409 SEASON_PRESALE` (after `EVENT_CANCELLED` and `SALES_CLOSED`), by the database's clock, as
`salesClosed` is. `042` implements it in `OrdersService.createLocked` and
`ReservationsService.reserveLocked` (and adds the field to `lockEvent`'s select or reads it beside
it), because those files are 042's.

The admin sees it on the Seasons list ("Presale until …"), the Season page, and the event page
("Single tickets on sale from …", FR-019).

**Rationale**: Nate's decision (spec Clarifications); a field on the event read lets every client
show it without knowing about Seasons; the refusal sits beside the other sales-window refusals.

**Alternatives**: a per-event `salesOpenAt` set by the Season on publish: copies, which drift when
the Season's time changes. Enforcing it in 041: edits 042's files.

## R6. The price split, stated once for 042

**Decision**: the contract's `buySeasonPass` says: with `N` events not cancelled, ordered by
`startsAt` then id, each order's `totalPrice` (and its one ticket's `price`, and `unitPrice`) is
`floor(passPrice × 100 / N) / 100`, and the first event's adds the remainder, so the orders sum to
the pass price exactly. `SeasonPass.totalPrice` is the pass price. The fixture (R14) writes a sold
pass this way, so 041's report tests see real split figures.

## R7. 042's pass hold, declared in the shared model

**Decision**: `SeasonPassHold {id, seasonId, customerSub, seatId, createdAt, expiresAt, endedAt}`
(one live per customer per Season: partial unique where `endedAt IS NULL`; `expiresAt = createdAt +
5 minutes`, as `seat_reservation_five_minutes`), and `SeatReservation.passHoldId` (nullable,
CASCADE). The partial unique `seat_reservation_one_active` (one live reservation per customer per
event) becomes "per customer per event per kind": `(customerSub, eventId, (passHoldId IS NULL))
WHERE endedAt IS NULL`, so a customer can hold single seats and a pass seat for the same event at
once; one live hold per seat (`seat_hold_one_live_per_seat`) still keeps the seats apart. Operations
(`x-planned: '042'`): `getSeasonVenueMap` and `getSeasonVenueMapSection` (the `038` venue map
schemas, a seat open only if open at every event, priced at the pass price), `holdSeasonSeat`
(`x-attempt-limit: HOLD`, one attempt), `releaseSeasonSeat`, `buySeasonPass` (`x-attempt-limit:
BUY`, one attempt), `getMyPassHold` (the caller's live pass hold, so its countdown survives a
reload; review S6), `listMyPasses`. General-admission passes hold nothing (general admission has no
holds today) and are bought directly. The hold sweep ends a run-out pass hold's `SeasonPassHold`
row (`endedAt`) with its reservations, so `season_pass_hold_one_live` never keeps a dead hold.

**Single-ticket paths ignore pass reservations** (review B1). Allowing two live reservations per
customer per event (one of each kind) breaks today's assumption of one, so the contract states, and
`042` implements in the change that first writes a pass reservation:

- `ReservationsService` `reserveLocked` and the release path (`reservations.service.ts`, about lines
  108 and 264: `findFirst({eventId, customerSub, endedAt: null})`) add `passHoldId: null`;
- `listMine` (`listMyReservations`, the cart) lists single reservations only; `releaseAllMine`
  (logout) ends pass holds too, whole (reservations and `SeasonPassHold` together);
- `assertNoWait` (the 2-minute wait, about line 190) counts single reservations only;
- `OrdersService.seatsFor` (`orders.service.ts`, about line 437, `mine = held.filter(h =>
  h.customerSub === buyer.sub)`) treats a seat in a pass hold as taken even for its own customer,
  and `reservationRanOut` (about line 465) looks at single reservations only.

Nothing writes a pass reservation until `042`, so these paths behave as today after this PR.

**Rationale**: the proposal's "one `SeatReservation` per event under one 5-minute timer"; the sweep
and `closeHolds` already end reservations, so a pass hold is N ordinary reservations with a group.
`042` may revise this in a small contract PR that 041's author reviews (spec Assumptions).

## R8. Reports and exports: per-event pass columns; Season totals on the Seasons pages

**Decision**: `EventSales` gains `passTicketsSold` and `passRevenue` (valid tickets and confirmed
order totals of orders with a `seasonPassId`); `SalesReport.totals` gains the same two. `Order`
gains `seasonPass: {id, seasonId, seasonName} | null`. The sales report screen shows a Pass tickets
column and the total row's pass figures; the attendee list a Pass column with the Season's name.
Exports: sales rows add "Pass tickets" and "Pass revenue" after "Revenue"; attendee rows add "Pass"
after "Order status". Season totals (`passesSold`, `passRevenue`) are fields of `Season`, shown on
the Seasons list and page (FR-018, FR-020).

**Rationale**: one table per export keeps `023`'s single table model (CSV, XLSX and PDF from one
`ExportColumn` list). The PDF's letter-landscape width (`attendee-rows.ts:23`) must still fit: text
columns wrap (`pdf.ts`, `MIN_PT_PER_CHAR`), so the Pass column wraps a long Season name like the
others; the sales PDF gains two number columns sized to content. The PDF fit tests
(`pdf.fit.test` and the Rust equivalent) cover both tables with the new columns (review S8).

**Alternatives**: a Seasons section in the sales report: a second table in every export format.

## R9. Event-side locks

**Decision**: under the event lock, the events and tiers services read the event's Season (not
cancelled, except for deletes) and refuse with `409 EVENT_IN_SEASON`:

- `updateEvent` changing `locationId` (review S4), `layoutId` or `reservedSeating` (field
  `locationId`, `layoutId` or `reservedSeating`); checked before `assertLayoutFree`, so the Season
  is named even when tickets are sold;
- `updateEvent` moving `startsAt` before the Season's `salesEndAt` (field `startsAt`);
- a ticket type rename or delete when the old name is priced in its general-admission Season
  (field `name`, or the tier for delete);
- `deleteEvent` of an event in any Season, cancelled Seasons included (field `id`; review S1), below
  which the RESTRICT key also holds.

**Layouts** (review S5): `LayoutsService`'s lock check (`assertUnlocked` / `lockingEvents`,
`layouts.service.ts` about line 1341) also treats a layout as locked while an on-sale Season uses
it (`409 LAYOUT_IN_USE`, naming the Season), so a level can't be removed (taking its pass price) or
added (unpriced) under a Season customers can buy. A draft's layout stays editable; publishing then
re-checks the prices. Deleting a layout any Season uses is refused the same way.

Cancelling an event is unchanged (FR-015): it refunds pass orders as any order, and ends any live
pass-hold reservation for that event; `042` treats a pass hold with an ended reservation as gone.

## R10. Cancelling a Season

**Decision**: `cancelSeason`, in one `LOCKING_TX` transaction, R2's locks, then: end every live
`SeasonPassHold` and its reservations (`closeHolds`, `endReason CLOSED`, no 2-minute wait); refund
every confirmed order with a `seasonPassId` of the Season (`REFUNDED`, `refundedAt`), void its valid
tickets; set every active pass REFUNDED with `refundedAt`; set the Season CANCELLED with
`cancelledAt`; after commit, publish the freed seats per event on `streamSeatMap` (the
`SeatEventsService` path `cancel` uses). Response: `{season, passesRefunded, ordersRefunded,
ticketsVoided}`. Every pass order is refunded, games already played and tickets already used
included (spec Clarifications, review M7). A draft is deleted, not cancelled (`409
SEASON_NOT_ON_SALE`).

## R11. The Admin app (React)

**Decision**: routes `/seasons` (list), `/seasons/new`, `/seasons/:id` (the form plus Put on sale,
Cancel season, Delete; read-only when cancelled) in `admin-app/src/App.tsx`, a Seasons nav link
between Events and Reports. Files: `admin-app/src/pages/Seasons.tsx`, `SeasonForm.tsx`,
`season-form-checks.ts` (pure: required fields, both-or-neither, times, prices; field keys matching
the Backend's `details.fields` paths, so `fieldErrors` places both), `admin-app/src/api/seasons.ts`.
The form reuses the event form's field-error, focus and date-and-time controls (`036`). The event
picker lists `listEvents` filtered to the venue, layout or general admission, upcoming, scheduled,
and not in another Season (`season` null or this one). The event form and event page read
`event.season` for the notice and the lock (FR-019).

## R12. The Rust Admin app, in the same implementation

**Decision**: `admin-rust-app/core/src/api/client.rs` gains the Season ops;
`core/src/forms/season.rs` (the same checks as `season-form-checks.ts`, `cargo test`);
`core/src/pages/seasons.rs` (list status text, picker filter); `app/src/pages/seasons.rs` and
`season_form.rs` with the React class names; routes in `app/src/routes.rs`, nav in
`app/src/shell.rs`; report and attendee Pass columns in `core/src/pages/attendees_reports.rs` and
`core/src/export/rows.rs`; the event-form lock in `core/src/forms/event.rs`. S11's `routes` gains
`/seasons`, `/seasons/new` and the demo Season's page.

## R13. Demo data

**Decision**: `demo-data.ts` adds three men's basketball games on the Yum! Center's Basketball
layout ("Cardinals Men vs. Miami", "vs. Virginia", "vs. Syracuse", 10, 17 and 24 days after the run,
19:00 local), each priced like the existing Basketball event, created through `EventsService`, and a
Season "Louisville Cardinals Basketball 2026–27" (Basketball, Louisville Cardinals) through
`SeasonsService`: every level priced, sales ending at the first game's start, single tickets on sale
3 days after the run, put on sale. The layout is already imported, so no new seats load (#179's
slow import is not made worse).

## R14. What this spec PR ships, and what the implementation does

**Decision**: the spec PR carries the shared contract (Nate, 2026-11-27): `schema.prisma` and one
migration (R1, R7); `contracts/openapi.yaml` 2.2.0 with every new operation marked
`x-planned: '041'` or `'042'` and new response fields optional; regenerated `api-schema.ts`; the
new `ERROR_CODES`; the fixture `backend/test/setup/season-fixtures.ts` (`seasonWithSoldPass(ctx,
{kind: 'seated' | 'ga'})`: a venue, a layout or ticket types, 3 events, a Season ON_SALE with
prices, and one sold pass written as R6 splits it); and a migration test of the constraints and the
fixture. `npm test` stays green on `main` after it merges: nothing serves the new operations, and
nothing reads the new tables.

The implementation removes the `'041'` markers as it serves each operation, makes `Event.season`,
`Event.singleSalesOpenAt`, `Order.seasonPass`, `EventSales.passTicketsSold`/`passRevenue` and the
totals' pass fields required, and builds everything else.

**Rationale**: the proposal's "shared contract first", so `042` can build against the model and
the fixture as soon as this PR merges.

**Deviation**: Principle III lists the data model and contract changes in the spec PR, not a
migration or test code. Recorded in the plan's Complexity Tracking.

## R15. Versions

**Decision**: contract 2.1.0 → **2.2.0** (additions only). Constitution 3.12.0 → **3.12.1**
(PATCH): roadmap rows `041-season-setup` and `042-season-pass-purchase` (reserved here, since the
contract marks 042's operations), next free `043`.

## R16. Times

**Decision**: `salesEndAt` and `singleSalesOpenAt` are sent and checked as event times are (the
venue's local time with its offset, `checkEventTime`, widened to the field names `salesEndAt` and
`singleSalesOpenAt`), shown in the venue's zone with its abbreviation (`020`). "Now" comparisons
(sales end in the future on publish, presale active) use the database's clock, as `salesClosed`
does.
