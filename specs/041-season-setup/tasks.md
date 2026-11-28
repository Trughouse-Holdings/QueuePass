# Tasks: Season Setup (Admin Side) and the Shared Season Contract

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R16),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (contract 2.2.0),
[quickstart.md](./quickstart.md) (S0–S11). 55 tasks (three added by the spec review: T011a, T029a,
T029b); T001–T005 are done in the spec PR.

**Issue**: [#192](https://github.com/Trughouse-Holdings/QueuePass/issues/192). The implementation
PR's **description** says `fixes #192`. No commit message on either branch, and not the spec PR,
may contain "fixes #192", "closes #192", or "resolves #192". Cite it as plain `#192`.

**Tests**: **REQUIRED and written first** (Constitution VI). Write each task marked *(test first)*
and see it **fail** before the task it covers. Backend tests use the real database
(Testcontainers) and the shared fixture `seasonWithSoldPass` (`backend/test/setup/
season-fixtures.ts`) wherever a sold pass is needed; never 042's checkout.

## Ground rules

- **Commits**: `Impl 041: <what> (T0xx–T0yy, #192)`; the body names the FR or R it rests on.
- **Do not change** 042's files: `backend/src/reservations/` (the hold service),
  `backend/src/orders/orders.service.ts`'s purchase paths (`createLocked`), the customer
  controllers, `customer-app/`, `customer-rust-app/`. Don't serve any `x-planned: '042'` operation.
  `schema.prisma`, the migration and `openapi.yaml` change only to fix a defect in the shared
  contract, noted in the impl PR for 042's author.
- **Contract markers**: remove an operation's `x-planned: '041'` in the commit that serves it;
  regenerate `packages/shared/src/api-schema.ts` (`npm run generate:api`) and rebuild the shared
  package (backend tests read its `dist`).
- **Both Admin apps**: every page and column lands in the React app and the Rust app in the same
  task group (FR-022). Same element structure, `class` values and accessible names, so the shared
  styles apply and the `@admin` browser tests drive both.
- **Form behaviour**: copy the event form as it is on `main` when you start (`event-form-checks.ts`,
  `fieldErrors`, focus on the first field at fault, values kept; #189's red outline and "Required"
  if merged by then).
- **Two pull requests** (Constitution III): this spec PR (contract, migration, fixture, constitution
  3.12.1) and `041-season-setup-impl`, cut from this spec branch while it is open and rebased on
  `main` once it merges, written in a fresh session from the spec and plan only. One independent
  review of each branch. No merge, no push to `main`.

## Phase 1: Shared contract (spec PR)

- [X] T001 Contract 2.2.0 in `contracts/openapi.yaml`: the 14 Season operations (041's
  `x-planned: '041'`, 042's `x-planned: '042'`), the new schemas, optional new fields on `Event`,
  `Order`, `EventSales`, `SalesReport.totals`, eight error codes, the **Seasons** paragraph;
  regenerate `packages/shared/src/api-schema.ts`; add the codes to `packages/shared/src/errors.ts`;
  the same new fields, optional, on the hand-written `packages/shared/src/event.ts` and `order.ts`
  (R3, R4, R14)
- [X] T002 `backend/prisma/schema.prisma` and `backend/prisma/migrations/20261127120000_seasons/
  migration.sql`: `Season`, `SeasonEvent`, `SeasonPrice`, `SeasonPass`, `SeasonPassHold`,
  `Order.seasonPassId`, `SeatReservation.passHoldId`, every CHECK and partial unique index in
  data-model.md, `seat_reservation_one_active` per kind (R1, R7)
- [X] T003 The shared fixture `backend/test/setup/season-fixtures.ts` (`seasonWithSoldPass`,
  `splitPassPrice`), `rowLabel` and `testTicketCode` exported from `fixtures.ts`, the Season tables
  in `reset-db.ts`, and `backend/test/integration/seasons.constraints.e2e-spec.ts` (R6, R14); the
  demo reset's summary words for the new tables in `backend/src/scripts/demo-reset.ts` and
  `demo-reset.e2e-spec.ts` (commit c892e2a), so `main` stays green
- [X] T004 `backend/test/contract/route-coverage.e2e-spec.ts`: planned operations declare
  `x-attempt-limit` and `429` but aren't matched to `@AttemptLimit` routes until served
- [X] T005 Constitution 3.12.1 (roadmap rows `041`, `042`; next free `043`) and the README's version
  reference (R15)

## Phase 2: Foundational (blocks every story)

- [X] T006 *(test first)* Pure rules in `backend/test/unit/season-rules.spec.ts`: name trimmed
  1–100, sport and team "both or neither", passes per customer 1–10, `singleSalesOpenAt <=
  salesEndAt`, `salesEndAt` no later than the earliest event not cancelled, the event checks (venue,
  layout or general admission, scheduled, not started), publish readiness (at least 2 events not
  cancelled; every level of the layout priced; at least one name priced; each priced name on every
  event), each returning the field path the contract names (`eventIds.<i>`, `prices.<levelId>`,
  `prices.<tierName>`, R4)
- [X] T007 `backend/src/seasons/season-rules.ts` to pass T006 (pure functions, no Prisma)
- [X] T008 `backend/src/seasons/dto/season-input.dto.ts` (class-validator, as `SeasonInput`:
  `name` 1–100, `sport` a `Sport` or null, `team` 1–100 or null, `locationId` uuid, `layoutId` uuid
  or null (key required), `salesEndAt` and `singleSalesOpenAt` with an offset (`OFFSET_DATE_TIME`),
  `maxPassesPerCustomer` 1–10 or null, `eventIds` ≤ 50 unique uuids, `prices` ≤ 50
  `SeasonPriceInput` with exactly one of `levelId`/`tierName`)
- [X] T009 `backend/src/seasons/season-lock.ts`: `lockSeasonWrite(tx, {locationId, seasonId?,
  eventIds})` takes the venue `FOR SHARE` (`lockVenueShared`; on update both the stored and the
  requested venue), the Season `FOR UPDATE`, then every event `FOR UPDATE` in id order; re-reads the
  Season's venue under the lock and retries once if it moved, as `updateEvent`'s `VenueMoved` (R2);
  widen `checkEventTime`'s field type in `backend/src/events/event-time.ts` to accept `salesEndAt`
  and `singleSalesOpenAt` (R16)
- [X] T010 `backend/src/seasons/season-view.ts`: `toSeason(row, {admin})` building the contract's
  `Season` (venue name and zone, layout name, events by `startsAt`, prices by level rank or name,
  `passesSold` = active passes, `passRevenue` = sum of confirmed pass orders, both `null` unless
  `admin`; `salesOpen` by the database's clock; lists by earliest event start, then name, Seasons
  with no events last)
- [X] T011 `backend/src/seasons/seasons.module.ts`, `seasons.controller.ts` (empty handlers wired),
  registered in `backend/src/app.module.ts`
- [X] T011a *(test first)* Error mapping in `backend/src/common/filters/prisma-exception.filter.ts`
  (R1): a violation of `SeasonEvent_eventId_fkey` is `409 EVENT_IN_SEASON` and of
  `Season_layoutId_fkey` `409 LAYOUT_IN_USE`, for Prisma `P2003` and raw-query `23503`, not the
  venue fallback; unit test beside the filter's existing tests

**Checkpoint**: the module loads; route coverage still passes (no marker removed yet).

## Phase 3: User Story 1 — Create a Season and put it on sale (P1) 🎯 MVP

**Goal**: an admin creates, saves and publishes a Season in either Admin app.
**Independent test**: quickstart S1–S4; `listSeasons` shows it on sale to a customer token.

- [X] T012 [US1] *(test first)* `backend/test/integration/seasons.e2e-spec.ts`: `createSeason` as
  admin saves a draft with events and prices (`201`); as customer `403`; each FR-003/FR-004/FR-006
  refusal names its field (`400 VALIDATION_FAILED`, `details.fields`); an event in another Season is
  `409 EVENT_IN_SEASON` with `details.field: eventIds.<i>`; times with the wrong offset are
  `UTC_OFFSET_MISMATCH`; `listSeasons`/`getSeason` give admins drafts and customers only `ON_SALE`
  (`404` for a draft by id)
- [X] T013 [US1] *(test first)* in the same file: two concurrent `createSeason` naming one event:
  exactly one `201`, the other `409 EVENT_IN_SEASON` (FR-004, SC-002)
- [X] T014 [US1] *(test first)* `publishSeason`: refused with fewer than 2 events, a level unpriced
  (`prices.<levelId>`), no name priced or an event without the name (general admission), sales end
  past; `409 SEASON_NOT_DRAFT` when on sale; success sets `ON_SALE` and `publishedAt`
- [X] T015 [US1] `backend/src/seasons/seasons.service.ts` `create`, `list`, `get`, `publish` under
  `lockSeasonWrite` in one `LOCKING_TX` transaction; map the `SeasonEvent_pkey` unique violation to
  `409 EVENT_IN_SEASON`; controller handlers with `@Roles` as the contract; remove the
  `x-planned: '041'` markers of `listSeasons`, `createSeason`, `getSeason`, `publishSeason`
- [ ] T016 [P] [US1] `admin-app/src/api/seasons.ts` (typed calls from `api-schema.ts`)
- [ ] T017 [P] [US1] *(test first)* `admin-app/test/season-form-checks.test.ts`: the same rules as
  T006 as previews, keyed by the Backend's field paths
- [ ] T018 [US1] `admin-app/src/pages/season-form-checks.ts` to pass T017
- [ ] T019 [US1] *(test first)* `admin-app/test/SeasonForm.test.tsx` and `Seasons.test.tsx`: the
  list shows name, venue, sport and team, events, status text (Draft, On sale, Presale until …,
  Sales ended, Cancelled), passes sold, pass revenue; the form's picker lists only upcoming
  scheduled events at the venue on the layout (or general admission) not in another Season; a price
  box per level (or per name); missing fields marked and the first focused; a Backend refusal placed
  beside its field with every value kept; Save then Put on sale
- [ ] T020 [US1] `admin-app/src/pages/Seasons.tsx`, `SeasonForm.tsx`; routes `/seasons`,
  `/seasons/new`, `/seasons/:id` and a Seasons nav link between Events and Reports in
  `admin-app/src/App.tsx` (R11); date-and-time controls as the event form (`036`)
- [ ] T021 [P] [US1] *(test first)* `admin-rust-app/core/tests/season_form.rs`: T017's cases
- [ ] T022 [US1] `admin-rust-app/core/src/forms/season.rs`, `core/src/pages/seasons.rs` (status
  text, picker filter), the Season ops in `core/src/api/client.rs` (`pub mod ops`) to pass T021
- [ ] T023 [US1] `admin-rust-app/app/src/pages/seasons.rs`, `season_form.rs`, routes in
  `app/src/routes.rs`, nav in `app/src/shell.rs`, with the React markup and class names (R12)

**Checkpoint**: S1–S4 pass in both Admin apps.

## Phase 4: User Story 2 — Edit, delete, cancel; events in a Season (P1)

**Goal**: FR-005, FR-007, FR-008, FR-011, FR-014, FR-015, FR-019.
**Independent test**: quickstart S5–S8 with the fixture's sold pass.

- [ ] T024 [US2] *(test first)* `backend/test/integration/seasons.update.e2e-spec.ts`:
  `updateSeason` replaces fields, events and prices; with the fixture's pass, changing events, venue
  or layout is `409 SEASON_HAS_PASSES` (`details.field`, `passesSold`), a price change saves and the
  sold orders keep `33.34/33.33/33.33`; a save of a Season on sale keeps its pricing and event rules
  but succeeds after its sales end has passed and with one of two events cancelled (R3); a cancelled
  one is `409 SEASON_CANCELLED`; a customer token reads `passesSold`/`passRevenue` as `null`;
  `deleteSeason` of a draft frees its events, of one on sale is `409 SEASON_NOT_DRAFT`
- [ ] T025 [US2] *(test first)* in the same file: an `updateSeason` removing an event racing a pass
  row inserted under the Season `FOR SHARE` lock (as 042 will): the update is either refused as
  `SEASON_HAS_PASSES` or completes before the insert, never both (FR-005, R2, SC-002)
- [ ] T026 [US2] *(test first)* `backend/test/integration/seasons.cancel.e2e-spec.ts`:
  `cancelSeason` refunds every pass order, voids its tickets, sets the pass `REFUNDED` with
  `refundedAt`, ends live pass holds (rows written directly) with `endReason CLOSED`, sets the
  Season `CANCELLED`, leaves the events `SCHEDULED`, returns the counts; a failure part way leaves
  nothing changed; a draft is `409 SEASON_NOT_ON_SALE` (FR-014, SC-006)
- [ ] T027 [US2] *(test first)* `backend/test/integration/events.season-lock.e2e-spec.ts`: for an
  event in the fixture's Season, `updateEvent` changing `locationId`, `layoutId` or
  `reservedSeating`, or moving `startsAt` before `salesEndAt`, and (general-admission fixture)
  renaming (case-insensitive match) or deleting the priced ticket type are `409 EVENT_IN_SEASON`
  naming the Season; `deleteEvent` is refused for an event of a cancelled Season too; `cancelEvent`
  refunds the pass order like any order and the pass stays `ACTIVE` (FR-007, FR-015, R9)
- [ ] T028 [US2] `seasons.service.ts` `update`, `remove`, `cancel` (R10: publish freed seats after
  commit through the path `EventsService.cancel` uses); remove the markers of `updateSeason`,
  `deleteSeason`, `cancelSeason`
- [ ] T029 [US2] Event-side locks in `backend/src/events/events.service.ts` (before
  `assertLayoutFree`) and `backend/src/tiers/tiers.service.ts`, under the event lock (R9)
- [ ] T029a [US2] *(test first)* `backend/test/integration/layouts.season-lock.e2e-spec.ts`: a
  layout used by an on-sale Season (fixture, `sold: false`) refuses edits that add or remove levels
  (and every other edit `039` refuses for a layout with tickets sold) with `409 LAYOUT_IN_USE`
  naming the Season; a draft Season's layout stays editable; deleting a layout any Season uses is
  refused
- [ ] T029b [US2] `backend/src/layouts/layouts.service.ts` (`assertUnlocked` / `lockingEvents`,
  about line 1341): a layout is locked while an on-sale Season uses it; delete refused while any
  Season does (R9, review S5)
- [ ] T030 [US2] *(test first)* Admin app: `SeasonForm.test.tsx` cases for the picker locked after a
  sale with its reason, Delete (draft only, confirmed), Cancel season with the confirmation naming
  the passes to refund, read-only when cancelled; `EventForm` test: "In season: …" and the layout
  and seating controls locked with that reason
- [ ] T031 [US2] `admin-app/src/pages/SeasonForm.tsx` actions and locks; `EventForm.tsx` and the
  event page read `event.season` (FR-019)
- [ ] T032 [US2] Rust Admin app: the same in `core/src/forms/season.rs`, `core/src/forms/event.rs`
  (with `core/tests` cases first) and the views

**Checkpoint**: S5–S8 pass in both Admin apps.

## Phase 5: User Story 3 — Pass sales in reports (P1)

**Goal**: FR-020, FR-021.
**Independent test**: quickstart S9 with the fixture's sold pass.

- [ ] T033 [US3] *(test first)* `backend/test/integration/reports.seasons.e2e-spec.ts`: for the
  fixture's pass, each event's `passTicketsSold` 1 and `passRevenue` its share, totals 3 and
  `100.00`; after `cancelSeason` all zero; `listAttendees` orders carry `seasonPass` with the
  Season's name, single orders `null`; `listMyOrders` shows it too
- [ ] T034 [US3] `backend/src/reports/reports.service.ts` pass figures; the order serializer adds
  `seasonPass` (R8); make `EventSales.passTicketsSold`, `passRevenue`, the totals' two fields, and
  `Order.seasonPass` required in `contracts/openapi.yaml`
- [ ] T035 [P] [US3] *(test first)* Admin app export row tests: sales rows gain "Pass tickets" and
  "Pass revenue" after "Revenue" (and in the total row), attendee rows gain "Pass" after "Order
  status"; extend `pdf.fit.test` so both PDFs (the sales report's two new number columns, the
  attendee list's wrapping Pass column) still fit letter landscape (R8)
- [ ] T036 [US3] `admin-app/src/export/sales-rows.ts`, `attendee-rows.ts`, `pages/Reports.tsx` (Pass
  tickets column and the total row's pass figures), `pages/Attendees.tsx` (Pass column)
- [ ] T037 [US3] Rust Admin app: `core/src/export/rows.rs` and `core/src/pages/attendees_reports.rs`
  (tests first in `core/tests`, including the Rust PDF fit test for both tables), the report and
  attendee views

**Checkpoint**: S9 passes in both Admin apps; the six exports match the screen (SC-003).

## Phase 6: User Story 4 — The presale on events (P2)

**Goal**: FR-013 (041's part: the time and its display; 042 serves the refusal).
**Independent test**: quickstart S10.

- [ ] T038 [US4] *(test first)* `backend/test/integration/events.season-read.e2e-spec.ts`:
  `getEvent` and `listEvents` (admin and customer tokens) give `season` and `singleSalesOpenAt` (the
  Season's time while `ON_SALE` and in the future; `null` for a draft, cancelled, past, or no
  presale); clearing the time shows `null` at once
- [ ] T039 [US4] `backend/src/events/events.service.ts` event reads add `season` and
  `singleSalesOpenAt` (database clock, R5); make both required on `Event` in `openapi.yaml`
- [ ] T040 [US4] Admin event page "Single tickets on sale from …" in the venue's zone, both apps
  (React test and Rust core test first)

## Phase 7: User Story 5 — The demo Season (P2)

**Goal**: FR-023.
**Independent test**: quickstart S0; two resets give the same Season.

- [ ] T041 [US5] *(test first)* `backend/test/integration/demo-reset.e2e-spec.ts` and
  `demo-data.e2e-spec.ts`: update the "Created: … 9 events" line (now 12 events and a Season) and,
  after the reset, "Louisville Cardinals Basketball 2026–27" is `ON_SALE` at the KFC Yum!
  Center on Basketball with 3 games ("Cardinals Men vs. Miami", "vs. Virginia", "vs. Syracuse", 10,
  17 and 24 days after the run, 19:00 local), every level priced, sales ending at the first game's
  start, single tickets on sale 3 days after the run; identical on a second run
- [ ] T042 [US5] `backend/src/scripts/demo-data.ts`: the games through `EventsService`, the Season
  through `SeasonsService` (create, publish), after `createSeatedDemo` (R13); the reset's summary
  names the Season. Update `e2e/tests/038-seat-maps.spec.ts` S0, which expects the Basketball
  layout "used by 2 events" (now 5)

## Phase 8: Browser tests, parity, and the gates

- [ ] T043 *(test first)* `e2e/tests/041-season-setup.spec.ts`, tagged `@admin`: `041 S0: after the
  reset, the Basketball Season is on sale with its three games and a price for every level`; `041
  S1: an admin creates a seated Season, prices every level and puts it on sale`; `041 S8: an event
  in a Season shows its Season and locks its layout`
- [ ] T044 S11 in `e2e/tests/037-rust-admin-app.spec.ts` builds its own data through the API (about
  line 298): have its setup create and publish a Season through the API, add `/seasons`,
  `/seasons/new` and `/seasons/<that id>` to its `routes`, and give the Seasons list the same
  reload-until-equal handling Reports has (parallel tests add Seasons); both apps match at 1280 and
  375 px (FR-022, SC-004)
- [ ] T045 `specs/041-season-setup/quickstart.md`: rows S0, S1, S8 Automated with T043's exact
  titles; `node scripts/check-quickstart-marks.mjs` passes
- [ ] T046 `README.md`: Seasons in the Admin app's feature list and "Today"; 041 in the built-and-
  verified list
- [ ] T047 Confirm no `x-planned: '041'` marker is left, every `'042'` marker is, and the route-
  coverage, contract-drift and boundary checks pass
- [ ] T048 Full `npm test`, `npm run lint`, `npm run format:check`; every workspace at or above 80%
  lines (SC-007); record the coverage figures for the PR
- [ ] T049 Running-system gate (Constitution gate 5): fresh clone, `docker compose up --build`,
  seed succeeds the first time, demo reset, sign in, use and log out of every front end
- [ ] T050 Browser walk of quickstart S0–S11 by Nate in both Admin apps (S5 with a pass inserted by
  the fixture or SQL until 042 merges); record it here with the date
- [ ] T051 Independent review by a Claude session that did not write the implementation; fix the
  findings; record the review and any finding left open in the impl PR description
- [ ] T052 Open the implementation PR from `041-season-setup-impl` with `fixes #192` in its
  description (not in any commit), the coverage figures, the walk, and any shared-contract fix for
  042's author

## Dependencies

- Phase 1 is done in the spec PR. Phase 2 blocks everything else.
- US1 (Phase 3) before US2 (Phase 4): US2 edits the Seasons US1 creates and adds actions to the same
  form. US3 (Phase 5) and US4 (Phase 6) need only Phase 2 and the fixture, so they can run beside
  US1/US2. US5 (Phase 7) needs US1's service (create, publish).
- Phase 8 needs all stories; T043's S0 needs US5, S8 needs US2.

## Parallel opportunities

- Within US1: T016, T017 and T021 touch different apps and run together; the Backend tasks T012–T015
  run beside them.
- US3's Backend (T033–T034) and its React (T035–T036) and Rust (T037) parts run in parallel once
  T034's contract fields are agreed.
- US4 and US5 are independent of each other.

## Implementation strategy

1. **MVP**: Phase 2 + US1 (Backend, both Admin apps): an admin can put a Season on sale, and 042
   can read it.
2. US2 (edits, cancel, event locks), then US3 (reports): the issue's "done when" (a pass sale in the
   report, with the fixture's pass until 042 merges).
3. US4 and US5, then Phase 8: browser tests, S11 parity, the gates, the review, the PR.
