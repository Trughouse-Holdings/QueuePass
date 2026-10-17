---
description: "Task list for Seat Holds with Live Updates"
---

# Tasks: Seat Holds with Live Updates

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.9.0, already applied, new operations
marked `x-planned: '015'`), [quickstart.md](./quickstart.md)

**Issue**: [#27](https://github.com/Trughouse-Holdings/QueuePass/issues/27). The implementation PR
says `fixes #27`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them. Record which failed first in
the PR description.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `015-seat-holds-impl`, cut from `main`
  after the spec and plan PR merges, in a Claude session that starts from these files only. A gap in
  the spec or plan is fixed there, not worked around in code.
- **The contract is fixed** (1.9.0, types regenerated, `SEAT_COOLDOWN` and `RESERVATION_REQUIRED`
  already in `ERROR_CODES`), with one planned edit: when an operation
  is implemented, remove its `x-planned: '015'` line in `contracts/openapi.yaml` **in the same
  commit**, then run `npm run generate:api` and `node scripts/check-contract-drift.mjs`. The
  route-coverage test fails on an implemented operation that is still marked (research R12). Raise
  any other gap.
- **Always send `SeatMapSection.reserved`** (an empty array when nothing is reserved). It is optional
  in the contract only so the spec and plan PR could merge with the suite green; this PR makes it
  required (T049).
- **The sweeper is off in tests**: `createTestApp` provides `HOLD_SWEEP_INTERVAL_MS = 0`, and tests
  call `HoldSweeper.sweepOnce()` themselves (research R4).
- **Time is the database's** (research R3): `now()` in SQL for `createdAt`, every "active" test,
  the 2-minute wait, and the sales close. Never decide a rule with `new Date()`. `secondsLeft` is
  computed in SQL too.
- **One lock order**: every reserve, release, order and admin change takes `lockEvent` (the event's
  `FOR UPDATE` row lock) first, and the layout paths keep their venue-then-events order. Add no new
  lock, isolation level, advisory lock or trigger.
- **Close run-out reservations first** in every locked path: `closeRunOut(tx, eventId)` sets
  `endedAt = "expiresAt"` and, on their live holds, `releasedAt = "expiresAt"`,
  `endReason = 'EXPIRED'` (data-model.md).
- **Publish after commit**: call `SeatEventsService.publish` only after the transaction resolves,
  never inside it.
- **No customer identity** in the seat map, the stream, or any refusal sent to another customer
  (FR-014).
- **Everything else keeps working**: general-admission orders are unchanged. Seated-order tests
  from `007` and `016` gain a reserve step through `reserveThenOrder()` and otherwise check the same
  things (spec Assumptions).

## Phase 1: Setup

- [X] T001 Cut `015-seat-holds-impl` from an up-to-date `main`, run `npm install`, `npx prisma
  generate` in `backend/`, and `npm test` from the repository root, and confirm the suite is green
  before any change (baseline).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the tables, the shared types, the shared seat rules, the bus, and `reserved` in the
seat map, with no new route yet.

- [X] T050 Write `backend/test/integration/seat-holds.constraints.e2e-spec.ts` first (numbered
  after the original tasks so references stay stable; it comes before T002). Insert rows directly
  with Prisma or SQL, never through the API, so each rule is proven below the Backend
  (Constitution IV, research R2, R16):
  - a second live hold on the same seat of the same event is refused
    (`seat_hold_one_live_per_seat`); a live hold on a seat whose earlier hold has ended is
    accepted;
  - a second active reservation for the same customer and event is refused
    (`seat_reservation_one_active`); one beside an ended reservation is accepted;
  - `seat_reservation_five_minutes` refuses an `expiresAt` that isn't `createdAt` + 5 minutes;
  - `seat_hold_end_all_or_none` refuses `releasedAt` without `endReason`, and the reverse;
  - `seat_hold_reservation_event` refuses a hold whose `eventId` differs from its reservation's.
- [X] T002 Add `model SeatReservation`, `model SeatHold`, and `enum SeatHoldEnd { EXPIRED RELEASED
  LOGOUT BOUGHT CLOSED }` to `backend/prisma/schema.prisma`, with the fields, types, and
  `ON DELETE CASCADE` relations of data-model.md (`SeatReservation.tierId` → `TicketTier`,
  nullable; `SeatHold` → `SeatReservation` through `fields: [reservationId, eventId],
  references: [id, eventId]` with `@@unique([id, eventId])` on `SeatReservation`; both `eventId`
  → `Event`), and the back-relations on `Event` and `TicketTier`. Comment each model with spec 015
  and research R1.
- [X] T003 Create `backend/prisma/migrations/<timestamp>_seat_holds/migration.sql` (a timestamp
  after the newest migration on `main`), generated by `prisma migrate dev --create-only` and then
  extended by hand with exactly the SQL in data-model.md:
  - `seat_reservation_five_minutes`: `CHECK ("expiresAt" = "createdAt" + interval '5 minutes')`;
  - `seat_reservation_ended_after_start`;
  - `seat_reservation_one_active`: `UNIQUE (eventId, customerSub) WHERE "endedAt" IS NULL`;
  - `seat_reservation_open_by_expiry`: on `("expiresAt") WHERE "endedAt" IS NULL`;
  - `seat_reservation_id_event`: `UNIQUE ("id", "eventId")`;
  - `seat_hold_seat_positive`;
  - `seat_hold_end_all_or_none`: `CHECK (("releasedAt" IS NULL) = ("endReason" IS NULL))`;
  - `seat_hold_reservation_event`: `FOREIGN KEY ("reservationId", "eventId")` →
    `SeatReservation("id", "eventId")`, `ON DELETE CASCADE`;
  - `seat_hold_one_live_per_seat`: `UNIQUE (eventId, seatSection, seatRow, seatNumber) WHERE
    "releasedAt" IS NULL`;
  - `SeatHold_eventId_releasedAt_idx`.

  Apply it with `prisma migrate deploy` (never `db push`). Make T050 pass.
- [X] T004 [P] (`SEAT_COOLDOWN` and `RESERVATION_REQUIRED` are already in `ERROR_CODES`, from the
  spec and plan PR.) In `packages/shared/src/seating.ts`, add:
  - `reserved?: SeatPosition[]` to `SeatMapSection`, optional to match the contract until T049;
  - `ReservedSeat`, `Reservation`, `ReservationInput`, `ReservationRelease`,
    `ReservationReleaseResult`, `ReleasedSeats`, `SeatStateChange`
    (`state: 'open' | 'reserved' | 'sold'`) and `SeatMapChange`, mirroring the contract's schemas;
  - `RESERVATION_LIMITS = { minutes: 5, waitMinutes: 2, maxSeats: 10 } as const`.

  Export them from `packages/shared/src/index.ts`.
- [X] T005 [P] Write `backend/test/unit/seat-events.spec.ts` first:
  - `publish(eventId, changes)` reaches every subscriber of that event, and none of another event;
  - a subscriber that unsubscribes stops receiving;
  - `publish` with no subscribers does nothing;
  - a throwing subscriber doesn't stop the others.
- [X] T006 Implement `backend/src/seating/seat-events.service.ts` (research R9): an injectable with
  `publish(eventId: string, changes: SeatStateChange[]): void` (no-op for an empty list) and
  `changes(eventId: string): Observable<SeatMapChange>`, backed by one RxJS `Subject` per event
  that is deleted when its last subscriber leaves. Provide and export it from
  `backend/src/seating/seating.module.ts`.
- [X] T007 Move the seat resolution from `OrdersService.resolveSeats` into
  `backend/src/seating/seat-rules.ts`, as `resolveSeats(tx, event, tier, choices)`, returning labels
  with `sectionId`. Move `SeatLabel`, `seatText` and `seatKey` with it. `orders.service.ts` calls it
  with no change in behavior: `orders.seats.e2e-spec.ts` passes unchanged (research R5).
- [X] T008 [P] Add to `backend/test/setup/fixtures.ts`:
  - `holdSeats(prisma, { eventId, customerSub, tierId, seats, createdAt? })`, which inserts a
    reservation and its holds directly by SQL so tests can place one in the past;
  - `endHold(prisma, holdId, reason, releasedAt)`.
- [X] T009 Write the test first in `backend/test/integration/seating.e2e-spec.ts` (new `describe`,
  spec 015 FR-012, research R10):
  - `getSeatMap` returns `reserved: []` for each section with nothing reserved;
  - it lists a seat held by a live hold of an active reservation (via `holdSeats`);
  - it omits a hold whose reservation ran out but isn't closed (`createdAt` 6 minutes ago) and an
    ended hold;
  - it never contains a customer's `sub` or username anywhere in the body;
  - it validates against the contract.
- [X] T010 Implement T009 in `SeatMapService.forEvent` (`backend/src/seating/seat-map.service.ts`):
  one query for live holds joined to reservations with `"endedAt" IS NULL AND now() <
  "expiresAt"`, grouped into each section's `reserved`, ordered by row and seat.

**Checkpoint**: migration applied; the seat map reports reserved seats; `npm test` green.

---

## Phase 3: User Story 1 - Reserve Seats, Then Confirm Within 5 Minutes (Priority: P1) 🎯 MVP

**Goal**: a customer reserves picked seats for exactly 5 minutes, adds to them, deselects or
releases them, confirms within the time, and loses them when it runs out or they log out, with a
2-minute wait before reserving their own released seats again.

**Independent Test**: spec US1. As `customer1`, reserve A-1-5 and A-1-6; `customer2` can't reserve
A-1-5; `customer1` confirms within 5 minutes and gets both seats.

### Tests for User Story 1 (write first, confirm they fail)

- [X] T011 [P] [US1] `backend/test/integration/reservations.e2e-spec.ts`, `reserveSeats`:
  - `201` with `expiresAt` exactly `createdAt` + 5 minutes and `secondsLeft` 299–300;
  - a second call adds seats with `200` and the same `expiresAt`;
  - all or nothing (nothing is stored after any refusal), with `400` for: a seat outside the
    layout, a section not for sale or of another tier, a repeat, an event without reserved
    seating, more than 10 seats in total, an added seat of another tier than the reservation's,
    and an added seat already in it;
  - `404` for an unknown event; `409 EVENT_CANCELLED`; `409 SALES_CLOSED` (`startsAt` in the past);
  - `409 TICKET_LIMIT_REACHED` when valid tickets + the reservation's seats would pass
    `maxTicketsPerCustomer` (`details.requested` is the seats it would then hold), and a
    reservation never counts as held;
  - `403` for `admin1` and `agent1`, and `401` without a token;
  - every response checked with `expectToMatchContract('reserveSeats', …)`.
- [X] T012 [P] [US1] `backend/test/integration/reservations.e2e-spec.ts`, release and list:
  - `releaseSeats` with one seat leaves the rest with the same `expiresAt`, and the hold ends
    `RELEASED`;
  - with no body it releases all and returns `{ reservation: null }`, and the reservation ends;
  - a seat not in the reservation is `400`; with no active reservation it is `200` with `null`;
  - `listMyReservations` returns only the caller's active reservations, for every event, newest
    first, excluding ended and run-out ones;
  - `releaseAllMyReservations` ends every one with `LOGOUT` and returns `{ released }` (the seat
    count), and is `0` when repeated;
  - roles and contract checks as T011.
- [X] T013 [P] [US1] `backend/test/integration/reservations.boundaries.e2e-spec.ts` (move
  `createdAt`/`expiresAt`/`releasedAt` with SQL, research R3):
  - **5 minutes**: at `expiresAt` − 1 s the reservation is active (listed, orderable); at
    `expiresAt` it is not (`createOrder` → `409 RESERVATION_REQUIRED` with
    `details.expired: true`; another customer can reserve its seats; `closeRunOut` sets
    `releasedAt = expiresAt` and `endReason = 'EXPIRED'`);
  - **2 minutes**: the same customer re-reserving a seat at its `releasedAt` + 2 min − 1 s gets
    `409 SEAT_COOLDOWN` with `details.seats` and `details.availableAt` = `releasedAt` + 2 min, and
    at + 2 min succeeds;
  - the wait applies after `EXPIRED`, `RELEASED` and `LOGOUT`, but not after `BOUGHT` or `CLOSED`,
    and another customer can reserve the seat at once;
  - `HoldSweeper.sweepOnce()` closes a run-out reservation the same way.
- [X] T014 [P] [US1] `backend/test/integration/orders.reservation.e2e-spec.ts` (research R7):
  - a seated order without a reservation is `409 RESERVATION_REQUIRED` (`details.expired: false`);
  - with the caller's reservation it is `201`, its holds end `BOUGHT`, and the reservation ends
    when no live hold is left;
  - a partial order leaves the other seats reserved until `expiresAt`;
  - a seat in another customer's reservation is `409 SEAT_TAKEN` with `details.reserved`;
  - a `requestId` replay after the reservation has ended returns the earlier order with `200`;
  - a general-admission order is unchanged.

### Implementation for User Story 1

- [X] T015 [US1] Add `reserveThenOrder(ctx, token, eventId, { tierId, seats, requestId? })` to
  `backend/test/setup/fixtures.ts`. Update the seated orders in `orders.seats.e2e-spec.ts`,
  `orders.ticket-limit.e2e-spec.ts` and `seating.e2e-spec.ts` to reserve first, with assertions
  unchanged. Rewrite `seats.concurrency.e2e-spec.ts` as 10 simultaneous orders, with distinct
  `requestId`s, from the one customer holding the seat's reservation: exactly 1 succeeds, the
  others are refused, and the seat has one valid ticket. The many-customer race moves to T026.
  Keep `007`'s "holds below the Backend" test in that file unchanged: it proves
  `ticket_one_valid_per_seat` by inserting tickets directly, which no reservation path replaces.
- [X] T016 [US1] Create `backend/src/reservations/dto/reservation-input.dto.ts` and
  `reservation-release.dto.ts` (class-validator): `seats` an array of 1–10 `SeatChoice`
  (`sectionId` UUID, `row` and `seat` integers ≥ 1), required in the first and optional in the
  second, `forbidNonWhitelisted` as elsewhere.
- [X] T017 [US1] Create `backend/src/reservations/reservations.service.ts`:
  - **`closeRunOut(tx, eventId)`**, per the ground rules;
  - **`reserve(principal, eventId, dto)`**, in one transaction following research R5 step by step:
    lock, close run-out, cancelled / sales closed / no reserved seating, `resolveSeats` from
    `seat-rules.ts`, the active reservation's tier and duplicates, the 2-minute wait (data-model.md
    "The 2-minute wait"), seats with a valid ticket or another live hold (`SEAT_TAKEN` with
    `details.seats` and `details.reserved`), at most 10 seats, the `016` limit counting valid
    tickets only, then insert or add.
  - Refusal messages name seats as "Section A, Row 1, Seat 5". `SEAT_COOLDOWN`'s message gives
    the local time from `availableAt`.
  - It returns `{ status: 200 | 201, reservation }`, with `secondsLeft` from SQL
    (`greatest(0, floor(extract(epoch from "expiresAt" - now())))`).
- [X] T018 [US1] In `reservations.service.ts`, add:
  - `release(principal, eventId, dto)`: listed seats or all; `RELEASED`; ends the reservation when
    no live hold is left;
  - `listMine(principal)`;
  - `releaseAllMine(principal)`: `LOGOUT`, every event, one transaction per event in event-id
    order, each taking `lockEvent` first.
- [X] T019 [US1] Create `backend/src/reservations/reservations.controller.ts`
  (`POST events/:id/reservation`, `POST events/:id/reservation/release`) and
  `me-reservations.controller.ts` (`GET me/reservations`, `POST me/reservations/release`), all
  `@Roles('customer')`, setting `201`/`200` as returned. Wire `reservations.module.ts` into
  `backend/src/app.module.ts`. Remove `x-planned` from `reserveSeats`, `releaseSeats`,
  `listMyReservations` and `releaseAllMyReservations` in `contracts/openapi.yaml`, then regenerate
  (ground rules).
- [X] T020 [US1] In `OrdersService.createLocked` (`backend/src/orders/orders.service.ts`), after the
  `requestId` replay and the cancelled and sales-closed checks, call `closeRunOut`, then for a
  seated order (research R7):
  - require each resolved seat to have a live hold in the caller's active reservation;
  - otherwise refuse with `SEAT_TAKEN` (valid ticket or another's hold, with `details.reserved`)
    or `RESERVATION_REQUIRED` (`details.seats`, and `details.expired` when the caller's last
    reservation for the event ran out);
  - in the same transaction as the ticket inserts, end the order's holds `BOUGHT`, and end the
    reservation when none is left.
- [X] T021 [US1] Create `backend/src/reservations/hold-sweeper.ts`: `sweepOnce()` finds events with
  run-out active reservations through `seat_reservation_open_by_expiry`, and for each, in its own
  transaction, locks the event and calls `closeRunOut`. Its interval comes from the
  `HOLD_SWEEP_INTERVAL_MS` provider (1000 in `reservations.module.ts`); `onModuleInit` starts a
  timer only when it is above 0, and `onModuleDestroy` clears it. In
  `backend/test/setup/test-app.ts`, override the provider with `0` (research R4). A failing sweep
  is logged and never crashes the Backend. Publishing and the sales close come in T031 and T041.
- [X] T022 [P] [US1] Write `packages/shared/test/web/auth-provider.test.tsx` cases first:
  - `logout()` awaits `beforeLogout(api)` before `removeUser`;
  - it still signs out when `beforeLogout` rejects, and after 2 seconds (fake timers) when it never
    resolves;
  - without the prop, behavior is unchanged.

  Then implement `beforeLogout?: (api: ApiClient) => Promise<void>` on `AuthProvider` in
  `packages/shared/src/web/auth-provider.tsx` (research R8).
- [X] T023 [P] [US1] Write `customer-app/test/seat-holds.test.tsx` first (stubbed API, fake timers):
  - Reserve seats sends the picks and shows the countdown from `secondsLeft` as `m:ss` in a
    `role="timer"`, plus Confirm purchase and Release seats;
  - Confirm purchase posts the reserved seats with a `requestId`, and the confirmation shows them;
  - at 1:00 a `role="status"` region (not the timer) announces 1 minute left, once;
  - at 0:00 a `role="alert"` region says the reservation ran out, Confirm purchase is hidden, and
    the picks are kept;
  - deselecting a reserved seat calls `releaseSeats` with just that seat, and the countdown is
    unchanged;
  - picking more and pressing Reserve seats adds them;
  - Release seats releases all; choosing another tier releases first;
  - on load, an active reservation from `listMyReservations` is shown;
  - each refusal is an error state with the picks kept: `SEAT_TAKEN` (reserved vs sold wording),
    `SEAT_COOLDOWN` (shows when, from `availableAt`), `RESERVATION_REQUIRED` (with `expired`) and
    `TICKET_LIMIT_REACHED`.
- [X] T024 [US1] Implement T023 in `customer-app/src/components/GetTickets.tsx` and
  `SeatPicker.tsx`:
  - the three states and controls of research R13, with the countdown from `secondsLeft` against
    `performance.now()`, and the 1:00 warning and "ran out" message in their own live regions;
  - Confirm purchase reuses the existing order call and `requestId` handling;
  - general-admission events are untouched.
- [X] T025 [US1] In `customer-app/src/main.tsx`, pass `beforeLogout` calling
  `releaseAllMyReservations`. Add a test in `customer-app/test/seat-holds.test.tsx`: logout calls it
  first, and still logs out when it fails.

**Checkpoint**: US1 works end to end in tests. Seated orders need a reservation, and reservations
run out at 5 minutes.

---

## Phase 4: User Story 2 - No Seat Is Reserved by Two Customers at Once (Priority: P1)

**Goal**: FR-009 under genuine concurrency (SC-001).

**Independent Test**: 10 simultaneous reservations for one seat from 10 customers; exactly 1
succeeds.

- [X] T026 [US2] Write `backend/test/integration/reservations.concurrency.e2e-spec.ts` first:
  - 10 customers (`customer1`–`customer10` tokens) reserve the same seat with `Promise.all`:
    exactly one `201`, nine `409 SEAT_TAKEN` naming it, and one live hold in the database;
  - 10 simultaneous reservations from one customer for 10 different seats leave exactly one active
    reservation (`seat_reservation_one_active`) holding all of them, or refusals, never two;
  - a reservation and an order racing for a seat leave it either reserved or sold, never both;
  - repeat each case 5 times.
- [X] T027 [US2] In `reservations.service.ts`, treat a unique violation of
  `seat_hold_one_live_per_seat` or `seat_reservation_one_active` (which, under the event lock, only
  a write from outside the Backend can cause) like `isSeatCollision` in `orders.service.ts`: retry
  the transaction once, so the retry's checks name the seat. Make T026 pass.

**Checkpoint**: SC-001 proven.

---

## Phase 5: User Story 3 - Other Customers See Reserved and Sold Seats Live (Priority: P1)

**Goal**: every viewer, Customer and Admin, sees changes within 2 seconds without refreshing, and
catches up after a drop (FR-010, FR-011).

**Independent Test**: spec US3, quickstart S2, S3 and S10.

### Tests for User Story 3 (write first, confirm they fail)

- [X] T028 [P] [US3] Write `backend/test/integration/seat-stream.e2e-spec.ts` (a real `listen(0)`,
  read with `fetch`):
  - the first event is `snapshot` with the `SeatMap`;
  - after `customer1` reserves, a second reader (`customer2`) gets `seats` with those seats
    `reserved` within 2 seconds;
  - after a release, `open`; after an order, `sold`; after `sweepOnce()` on a run-out reservation,
    `open`;
  - a reconnect gets a fresh `snapshot`;
  - no event contains a `sub` or username;
  - `401` at connect without a token, and with an expired, a wrongly signed, and a wrong-audience
    token (the new auth path, Constitution VI); `404` for an unknown event;
  - a CORS preflight from the Customer app's origin, requesting only `authorization`, succeeds,
    and the response allows that origin;
  - the stream ends within 1 second after the token's `exp` (a token expiring in 3 seconds);
  - deleting the event ends the stream, and a reconnect is `404`;
  - every payload is validated against the schema that the operation's `x-sse-events` names for
    its event. Add `expectSseEvent(operationId, event, data)` to
    `backend/test/contract/expect-to-match-contract.ts`, reading the schema from `x-sse-events`.
- [X] T029 [P] [US3] Write `packages/shared/test/web/seat-stream.test.ts` first, with a stubbed
  `fetch` whose body is a `ReadableStream`:
  - it parses `event:`/`data:` lines across chunk boundaries and ignores `ping`;
  - it sends `Authorization: Bearer <token>` from the getter at each connect, and `Accept:
    text/event-stream`, and no other header;
  - when the server ends the stream normally (token expiry), it reconnects at once with the current
    token;
  - it reconnects after a drop or a `401`, waiting 1, 2, then 5 seconds (fake timers), with the
    current token; after a `404` it stops;
  - a new `snapshot` replaces the state;
  - `close()` aborts the request and it stops; `useSeatStream` closes it on unmount and when the
    event changes.
- [X] T030 [P] [US3] Write the live cases in `customer-app/test/seat-stream.test.tsx` and
  `admin-app/test/seat-holds.test.tsx` first:
  - a `seats` event greys out another customer's reservation without a refresh;
  - a picked seat that another customer reserves is dropped, with a message naming it in a
    `role="status"` region (FR-011);
  - a focused seat that becomes reserved or sold keeps keyboard focus, gets
    `aria-disabled="true"`, and ignores activation (FR-012);
  - a change touching the customer's own reserved seat reloads `listMyReservations`;
  - the Admin seat map and counts update on a `seats` event.

### Implementation for User Story 3

- [X] T031 [US3] Publish after commit (ground rules), as `SeatStateChange`s carrying the section's
  `sectionId`. Add `end(eventId)` to `SeatEventsService`, which completes every stream of the event
  (used by event delete, T041):
  - `reserved` from `ReservationsService.reserve`;
  - `open` from `release`, `releaseAllMine` and `HoldSweeper` (per event);
  - `sold` from `OrdersService` for seated orders.
- [X] T032 [US3] Add `expiresAt: number` (the token's `exp`, in seconds) to `Principal` in
  `backend/src/auth/principal.ts`, set in `auth.guard.ts`.
- [X] T033 [US3] Create `backend/src/seating/seat-stream.controller.ts`:
  - `@Sse('events/:id/seats/stream')` with `@Roles()` (any signed-in user), with a 404 for an
    unknown event before streaming;
  - it emits `snapshot` from `SeatMapService.forEvent`, then `seats` from
    `SeatEventsService.changes`, and `ping` (`data: {}`) every 15 seconds;
  - it completes at `principal.expiresAt`.

  Remove `x-planned` from `streamSeatMap` and regenerate (ground rules). Make T028 pass.
- [X] T034 [US3] Create `packages/shared/src/web/seat-stream.ts` (`openSeatStream(eventId,
  getToken, onSnapshot, onChange) → { close }`, research R9), taking its path from the generated
  `paths['/events/{id}/seats/stream']` and its payload types from `components['schemas']['SeatMap']`
  and `['SeatMapChange']`, with no hand-written payload type, and `use-seat-stream.ts`
  (`useSeatStream(eventId)` → `{ map, mine, status }`, where `mine` comes from
  `listMyReservations` for a customer, and reloads when a change touches it). Export both from
  `packages/shared/src/web/index.ts`. Make T029 pass.
- [X] T035 [US3] Use `useSeatStream` in `customer-app/src/components/GetTickets.tsx` in place of the
  one-off seat map load, dropping taken picks with a message (FR-011). Use it in
  `admin-app/src/components/SeatingCard.tsx` for the seat map. Make T030 pass.

**Checkpoint**: quickstart S2, S3 and S10 pass locally.

---

## Phase 6: User Story 4 - Reserved Seats Look Different from Sold Seats (Priority: P2)

**Goal**: a distinct, accessible Reserved state in both apps, and reserved counts for admins
(FR-012, FR-013).

**Independent Test**: spec US4.

- [X] T036 [P] [US4] Write the cases first in `customer-app/test/seat-holds.test.tsx`:
  - another customer's reserved seat has class `seat--reserved`, an `R` mark, the accessible name
    "Row N, Seat M, reserved", and is disabled;
  - the customer's own has `seat--mine` and "Row N, Seat M, reserved by you";
  - sold stays `seat--taken` and is named "Row N, Seat M, sold".
- [X] T037 [P] [US4] Write the cases first in `admin-app/test/seat-holds.test.tsx`:
  - `SeatGrid` marks a reserved seat `◩`, with the label "Row N, Seat M, reserved";
  - `SeatingCard` shows each section's sold, reserved, and open counts.
- [X] T038 [US4] Implement T036 in `customer-app/src/components/SeatPicker.tsx` and
  `customer-app/src/styles.css` (research R15): `.seat--reserved` and `.seat--mine` using theme
  values only: `.seat--reserved` is a dashed outline with no fill pattern, unlike `.seat--taken`'s
  stripe. `012`'s drift check must pass.
- [X] T039 [US4] Implement T037 in `admin-app/src/components/SeatGrid.tsx` and `SeatingCard.tsx`.

---

## Phase 7: Admin Changes and Closed Sales End Reservations (FR-016)

- [X] T040 Write `backend/test/integration/reservations.admin-changes.e2e-spec.ts` first. Each of
  these ends the affected live holds `CLOSED`, starts no 2-minute wait for their customers, and
  publishes the seats as `open` (subscribe to `SeatEventsService` in the test):
  - `cancelEvent`, which also publishes the seats of the tickets it voids as `open`;
  - `updateSeating` turning reserved seating off, and moving one section to another tier (only
    that section's holds end);
  - `replaceLayout` at the venue;
  - `createTicketTier` adding the first tier to a seated event with a tierless reservation;
  - `HoldSweeper.sweepOnce()` after the event's `startsAt` is moved into the past.

  And these remove the rows by cascade instead:
  - `deleteTicketTier` of the reservation's tier: the reservation and holds are gone, and the
    seats are published `open`;
  - `deleteEvent` of an event without orders but with a live reservation: the rows are gone, and
    every stream of the event completes.

  `deleteLayout` needs no case: it is already refused while an event at the venue has reserved
  seating on (`007`).
- [X] T041 Implement T040 in:
  - `backend/src/events/events.service.ts`: cancel (publish held and voided seats); remove, now
    in a transaction that takes `lockEvent` before the order count and the delete, then
    `SeatEventsService.end(eventId)` after the commit;
  - `backend/src/seating/seat-map.service.ts` (`update`);
  - `backend/src/seating/layout.service.ts` (replace);
  - `backend/src/tiers/tiers.service.ts`: create (end tierless holds `CLOSED` when the first tier
    is added to a seated event); delete (read the live holds before deleting, publish after);
  - `hold-sweeper.ts` (sales close, through the same partial index plus a join on `Event`).

  Each runs inside the transaction and lock the path already takes, with the publish after the
  commit.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T042 Confirm no `x-planned: '015'` remains in `contracts/openapi.yaml`, that
  `route-coverage.e2e-spec.ts` passes with every operation implemented, and that
  `check-contract-drift.mjs` passes.
- [X] T043 [P] Update `README.md`:
  - the status row for `015`;
  - a short "Seat reservations" section: Reserve seats, 5 minutes, the 2-minute wait, live
    updates, logout releases.

  No new URL, command, or credential.
- [X] T044 [P] Run `npm run lint`, `npx prettier --check .`, and `npm test` from the root; all
  green.
- [ ] T045 Report coverage for the files this feature changed (`npx jest --coverage` in `backend`;
  the front ends' if a provider is installed) in the PR description. The 80% floor is not yet
  blocking (Constitution VI deferral until `010` and `011`).
- [ ] T046 Running-system gate: `docker compose up --build`, then walk quickstart.md S0–S11 in the
  browser, and sign in, use, and sign out of each front end. Record the results in this file.
- [X] T047 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md and plan.md; fix the findings; repeat until only minor findings remain (2–3
  rounds). Record the number of rounds and any open finding in the PR description.
- [ ] T048 Open the implementation PR against `main` with `fixes #27` in its description, and the
  shared-surface note (`backend/prisma/`, `packages/shared/`, `contracts/openapi.yaml`) asking for
  both approvals.
- [X] T049 Before the PR, make `SeatMapSection.reserved` required: add it to `required` in
  `contracts/openapi.yaml` (and drop "Not in `required` until…" from its description), make it
  non-optional in `packages/shared/src/seating.ts`, regenerate, and run the drift check. The
  Backend always sends it from T010 on.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** is the MVP and comes first. Within it, T015 (fixtures) lands with T020 (the
  order rule), since that is when seated orders start needing a reservation.
- **US2 (Phase 4)** needs US1's reserve path (T017–T019).
- **US3 (Phase 5)** needs US1's writes to publish. Its client pieces (T029, T034) can start after
  Phase 2.
- **US4 (Phase 6)** needs Phase 2's `reserved` (T010), and US1's own-reservation state for
  `seat--mine`.
- **Phase 7** needs US3's bus wiring (T031) for its publish assertions.
- **Phase 8** after every story.

## Parallel Opportunities

- **Phase 2**: T050 first, then T002 and T003. T004, T005 and T008 in parallel. T007 is
  independent of T006.
- **US1**:
  - tests T011–T014 in parallel, plus T022 and T023;
  - T016 alongside the tests;
  - T024 and T025 after T022.
- **US3**: T028, T029 and T030 in parallel; T034 alongside T032 and T033.
- **US4**: T036 and T037 in parallel, then T038 and T039 in parallel.
- **Polish**: T043 and T044.

## Implementation Strategy

1. **MVP**: Phases 1–3. Reserve, confirm, release, run out and logout, with orders needing a
   reservation.
2. **Race-free**: Phase 4 proves FR-009 (SC-001).
3. **Live**: Phase 5, the gray-out the issue asks for (SC-002, SC-003, SC-004).
4. **Readable**: Phase 6's distinct Reserved state.
5. **Admin changes**: Phase 7 (FR-016).
6. **Ship**: Phase 8, with the independent review before the PR.
