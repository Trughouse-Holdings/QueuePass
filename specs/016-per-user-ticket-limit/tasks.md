---
description: "Task list for the Per-Customer Ticket Limit"
---

# Tasks: Per-Customer Ticket Limit

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.6.0, already applied),
[quickstart.md](./quickstart.md)

**Issue**: [#28](https://github.com/Trughouse-Holdings/QueuePass/issues/28). The implementation PR
says `fixes #28`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `016-per-user-ticket-limit-impl`, cut
  from `main` after the spec and plan PR merges, in a Claude session that starts from these files
  only. A gap in the spec or plan is fixed there, not worked around in code.
- **Do not change the contract** (1.6.0, types regenerated). Raise any gap.
- **Always send the new response fields**: `Event.maxTicketsPerCustomer` (`null` for no limit) and
  `Availability.customerLimit` (`null` when it does not apply). They are optional in the contract
  only so the plan PR could merge with the suite green (research R9).
- **One lock**: the limit is checked inside `createLocked`, after `lockEvent`, which already
  serializes every order for an event (research R2). Add no new lock, isolation level, or trigger.
- **Order of checks** (research R3): `requestId` replay → cancelled → sales closed → tier → seats →
  tickets left **and** limit together → create. The refusal names the smaller cap; on a tie,
  `SOLD_OUT`.
- **Count** = valid tickets for the event whose order's `customerSub` is the caller
  (data-model.md). Void tickets never count.
- **Nothing else changes**: every existing test keeps passing unchanged, apart from fixtures that
  gain the new field.

## Phase 1: Setup

- [ ] T001 Cut `016-per-user-ticket-limit-impl` from an up-to-date `main`, run `npm install` and
  `npm test` from the repository root, and confirm the suite is green before any change (baseline).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: store the limit, accept it on event writes, and expose it, without any rule yet.

- [ ] T002 Add `maxTicketsPerCustomer Int?` to `model Event` in `backend/prisma/schema.prisma`, next
  to `totalTicketCapacity`, with a comment citing spec 016 FR-001.
- [ ] T003 Create `backend/prisma/migrations/20261011000000_per_customer_ticket_limit/migration.sql`
  exactly as in data-model.md: `ADD COLUMN "maxTicketsPerCustomer" INTEGER` (no default, no
  backfill) and `CONSTRAINT "event_max_tickets_per_customer_range" CHECK ("maxTicketsPerCustomer"
  IS NULL OR "maxTicketsPerCustomer" BETWEEN 1 AND "totalTicketCapacity")`. Apply it with
  `prisma migrate deploy` (never `db push`).
- [ ] T004 [P] Add `maxTicketsPerCustomer` to the `LockedEvent` interface and to the
  `SELECT ... FOR UPDATE` column list in `backend/src/common/event-lock.ts`.
- [ ] T005 [P] In `packages/shared/src/event.ts`, add `maxTicketsPerCustomer: number | null` to
  `Event` and `maxTicketsPerCustomer?: number | null` to `EventInput` (so `EventUpdate` gains it).
- [ ] T006 [P] Add `'TICKET_LIMIT_REACHED'` to `ERROR_CODES` in `packages/shared/src/errors.ts`, in
  the same position as the contract's `ErrorEnvelope` enum (last). Without it, the exception filter
  rewrites the refusal as `VENUE_HAS_EVENTS` (research R4).
- [ ] T007 [P] Add `maxTicketsPerCustomer` to `backend/src/events/dto/create-event.dto.ts` and
  `backend/src/events/dto/update-event.dto.ts`: `@IsOptional() @IsInt() @Min(1)`, accepting
  `null`, with the message `'maxTicketsPerCustomer must be a whole number of at least 1, or empty
  for no limit'`.
- [ ] T008 In `backend/src/events/events.service.ts`, persist `maxTicketsPerCustomer` on create
  (`?? null`) and on update (set when the key is present, including `null`, using
  `!== undefined`). Confirm `toResponse` sends it as `null` when unset.
- [ ] T009 [P] Let `event()` in `backend/test/setup/fixtures.ts` take an optional
  `maxTicketsPerCustomer`, sent only when given. Add the field (`null`) to the event factory in
  `customer-app/test/helpers.tsx` and to hand-built `EVENT` objects in admin-app tests that are
  typed as `Event`.
- [ ] T010 Run `npm test`: everything still passes, and event responses carry
  `maxTicketsPerCustomer: null`.

**Checkpoint**: the limit can be stored and read; nothing enforces it yet.

---

## Phase 3: User Story 1 - A Customer Cannot Go Over the Limit (Priority: P1) 🎯 MVP

**Goal**: the Backend refuses an order that would put a customer over the event's limit, with the
numbers (FR-002, FR-003, FR-005, FR-006, FR-007).

**Independent Test**: limit 8 set in setup; buy 5, try 5 → refused with 8/5/3; buy 3 → ok; buy 1
→ refused.

### Tests for User Story 1 (write first, confirm they fail)

- [ ] T011 [US1] Create `backend/test/integration/orders.ticket-limit.e2e-spec.ts` covering, each as
  its own test:
  - limit 8, holding 0, order 8 → `201`;
  - holding 5, order 5 → `409 TICKET_LIMIT_REACHED`, `details` `{ limit: 8, held: 5, remaining:
    3, requested: 5 }`, message naming the event, and no new order or ticket in the database;
  - then order 3 → `201`, then order 1 → `409` with `remaining: 0`;
  - exactly at the limit is accepted and one over is refused (both sides of the boundary);
  - a second customer is unaffected by the first (`customer(ctx, 2)`);
  - a customer at the limit for one event can still buy for another event;
  - tickets of every tier count together (5 in one tier + 3 in another = 8);
  - void tickets do not count (set a ticket's `status` to `VOID` with `ctx.prisma`, then buy);
  - an event with no limit accepts repeated orders as before;
  - the limit and tickets left both bind: holding 5 of 8 with 1 ticket left, order 2 →
    `SOLD_OUT` with `available: 1`; holding 7 of 8 with 50 left, order 2 →
    `TICKET_LIMIT_REACHED` with `remaining: 1`; a tie → `SOLD_OUT`;
  - a repeated `requestId` returns the original order with `200` and the count does not grow,
    even when the customer is now at the limit;
  - a reserved-seating event counts the seats ordered toward the limit.

### Implementation for User Story 1

- [ ] T012 [US1] In `backend/src/orders/orders.service.ts` `createLocked`, after the seat
  resolution and with the existing tickets-left computation, count the caller's valid tickets for
  the event (`tx.ticket.count({ where: { eventId, status: 'VALID', order: { customerSub:
  buyer.sub } } })`) only when `event.maxTicketsPerCustomer` is not `null`, and apply research R3:
  refuse with `conflict('TICKET_LIMIT_REACHED', message, { limit, held, remaining, requested })`
  when the limit is the smaller cap, else keep the existing `SOLD_OUT`. Messages exactly as
  research R4.
- [ ] T013 [US1] Run T011 until it passes, then the whole Backend suite.

**Checkpoint**: the rule holds for orders one at a time.

---

## Phase 4: User Story 2 - Two Orders at the Same Moment Cannot Beat the Limit (Priority: P1)

**Goal**: FR-004 under genuinely concurrent requests.

**Independent Test**: concurrent orders from one customer never leave them above the limit.

### Tests for User Story 2 (write first)

- [ ] T014 [US2] Create `backend/test/integration/orders.ticket-limit.concurrency.e2e-spec.ts`
  using one client (one customer) firing requests with `Promise.all`, each with its own
  `requestId`, against an event with capacity 100:
  - limit 8, 50 simultaneous orders of 1 → exactly 8 `201`, 42 `409 TICKET_LIMIT_REACHED`, and 8
    valid tickets for that customer in the database (SC-001);
  - limit 8, 2 simultaneous orders of 6 → exactly one `201`, and 6 valid tickets;
  - 10 identical requests with the same `requestId` → one `201`, nine `200`, and the count is the
    order's quantity once (FR-007).

### Implementation for User Story 2

- [ ] T015 [US2] Run T014. It should pass with T012 alone because of the event row lock (research
  R2). If it does not, fix the cause in `orders.service.ts` without adding a new lock mechanism,
  and record why in research.md.

**Checkpoint**: the P1 rule is complete and race-free.

---

## Phase 5: User Story 3 - Admins Set and Change the Limit (Priority: P2)

**Goal**: FR-001, FR-008 to FR-011 on the Backend and in the Admin app.

**Independent Test**: create with 4, see it, edit to 6, clear it; invalid values refused.

### Tests for User Story 3 (write first, confirm they fail)

- [ ] T016 [P] [US3] Create `backend/test/integration/events.ticket-limit.e2e-spec.ts`:
  - create with `maxTicketsPerCustomer: 4` → stored and returned; without it → `null`;
  - `0`, `-1`, `2.5`, and `"4"` → `400 VALIDATION_FAILED`, field named;
  - above `totalTicketCapacity` on create, and on update → `400`, message naming the capacity;
  - an update that lowers `totalTicketCapacity` below the stored limit → `400`;
  - `PATCH` with `null` clears it;
  - lowering it below what a customer holds succeeds, and their orders and tickets are unchanged
    (FR-009);
  - a cancelled event's `PATCH` with the field → `409 EVENT_CANCELLED` (FR-010);
  - `PUT /events/{id}/seating` turning reserved seating on when the venue's layout total is below
    the limit → `409 CAPACITY_EXCEEDED`, and nothing changes;
  - the database CHECK refuses an out-of-range value written directly with `ctx.prisma`
    (backstop).
- [ ] T017 [P] [US3] Create `admin-app/test/ticket-limit.test.tsx` with `stubApi`:
  - the form shows "Tickets per customer" with the hint "Leave blank for no limit.";
  - create sends the number when entered and omits it when blank;
  - edit prefills it, and sends `null` when cleared;
  - `0` or a value above the typed capacity is refused before sending, and the other values stay;
  - a `400` from the Backend is shown through the error banner;
  - the event page shows "Per customer: 4 tickets", or "Per customer: No limit".

### Implementation for User Story 3

- [ ] T018 [US3] In `backend/src/events/events.service.ts`, after merging the update in
  `updateLocked` (and on create), refuse `maxTicketsPerCustomer > totalTicketCapacity` with a
  `400` whose message names the field and the capacity (research R6). Lowering or clearing changes
  nothing else.
- [ ] T019 [US3] In `backend/src/seating/seat-map.service.ts`, when reserved seating turns on and
  the layout total is below the event's `maxTicketsPerCustomer`, refuse with
  `conflict('CAPACITY_EXCEEDED', ...)` telling the admin to lower the limit first, before any
  write.
- [ ] T020 [US3] In `admin-app/src/pages/EventForm.tsx`, add the "Tickets per customer" field under
  "Total tickets", reusing its `.field`, `<label htmlFor>`, `type="number" min={1}`, and
  `.field__hint` markup; prefill on edit; send per research R7; add the client-side preview check.
- [ ] T021 [US3] In `admin-app/src/pages/EventDetail.tsx`, add a "Per customer" row to the details
  `<dl>`: "N tickets" or "No limit".
- [ ] T022 [US3] Run T016 and T017 until they pass, then the Backend and Admin app suites.

**Checkpoint**: admins control the limit end to end.

---

## Phase 6: User Story 4 - Customers See the Limit Before They Buy (Priority: P2)

**Goal**: FR-012 to FR-015 through `customerLimit` (research R5, R8).

**Independent Test**: holding 5 of 8, the form says 3 more and offers at most 3; at 8, the form is
replaced by the reached message.

### Tests for User Story 4 (write first, confirm they fail)

- [ ] T023 [P] [US4] Extend `backend/test/integration/availability.e2e-spec.ts`: for a customer on
  an event with a limit, `customerLimit` is `{ limit, held, remaining }` with void tickets
  excluded and `remaining` never below 0 (after lowering the limit under `held`); `null` for an
  event with no limit, and for an admin or gate agent caller; one customer never sees another's
  count.
- [ ] T024 [P] [US4] Create `customer-app/test/ticket-limit.test.tsx`, adding `customerLimit`
  (default `null`) to the `availability` factory in `customer-app/test/helpers.tsx`:
  - with a limit and `remaining` 8: "Limit: 8 tickets per customer. You can get 8 more.", quantity
    up to 8;
  - `remaining` 3: the largest quantity offered is 3;
  - `remaining` 0: "You have reached the limit of 8 tickets for this event." and no confirm
    control;
  - the smallest cap wins when tickets left or the per-order cap of 10 is smaller;
  - a seated event stops seat selection at `remaining`, with a line saying why;
  - a `409 TICKET_LIMIT_REACHED` shows the Backend's message in the alert, keeps the choices, and
    reloads availability;
  - `customerLimit: null`, and a response without it, leave the form exactly as today.

### Implementation for User Story 4

- [ ] T025 [US4] In `backend/src/events/events.controller.ts`, pass `@CurrentPrincipal()` to the
  availability handler; in `backend/src/events/availability.service.ts`, compute `customerLimit`
  for a caller with the `customer` role on an event with a limit, using the same count as T012,
  and `null` otherwise. Always include the key.
- [ ] T026 [US4] In `customer-app/src/components/GetTickets.tsx`, apply research R8: `maxQuantity`
  is the smallest of `ORDER_LIMITS.maxQuantity`, the tickets left, and `customerLimit.remaining`;
  show the limit line; replace the form with the reached message at 0. Treat a missing
  `customerLimit` as `null`.
- [ ] T027 [US4] In `customer-app/src/components/SeatPicker.tsx` (or its caller), show why no more
  seats can be chosen when the cap is the customer's limit.
- [ ] T028 [US4] Run T023 and T024 until they pass, then the Backend and Customer app suites.

**Checkpoint**: every story works on its own and together.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T029 [P] In `backend/src/scripts/demo-data.ts`, give one demo event `maxTicketsPerCustomer: 4`
  (research R10).
- [ ] T030 [P] Update `README.md`: add the `016` row to the Status table, mention the limit in
  "Today", and keep the reserved-features line accurate.
- [ ] T031 Run `npm run lint` and `npm test` from the repository root; everything passes, including
  `check-contract-drift`.
- [ ] T032 Report coverage for the files this feature changed (`npx jest --coverage` in `backend`;
  the front ends' coverage if a provider is installed) in the PR description. The 80% floor is not
  yet blocking (Constitution VI deferral until `010` and `011`).
- [ ] T033 Running-system gate: `docker compose up --build`, then walk quickstart.md S1–S8 in the
  browser, and sign in, use, and sign out of each front end. Record the results in this file.
- [ ] T034 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md and plan.md; fix the findings; repeat until only minor findings remain (2–3
  rounds). Record the number of rounds and any open finding in the PR description.
- [ ] T035 Open the implementation PR against `main` with `fixes #28` in its description.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** is the MVP and comes first. **US2** depends on US1's rule (T012).
- **US3** and **US4** depend only on Phase 2 and can run in either order after US1; US4's Backend
  count reuses T012's query.
- **Phase 7** after every story.

## Parallel Opportunities

- Phase 2: T004, T005, T006, T007, T009 touch different files.
- US3: T016 (Backend) and T017 (Admin app) tests in parallel; T020/T021 alongside T018/T019.
- US4: T023 and T024 in parallel; T026/T027 alongside T025.
- Polish: T029 and T030.

## Implementation Strategy

1. **MVP**: Phases 1–3. The Backend enforces the limit; the limit is set in tests.
2. **Race-free**: Phase 4 proves FR-004 (SC-001).
3. **Admin control**: Phase 5 makes the limit usable on real events.
4. **Customer clarity**: Phase 6 shows it before buying.
5. **Ship**: Phase 7, with the independent review before the PR.
