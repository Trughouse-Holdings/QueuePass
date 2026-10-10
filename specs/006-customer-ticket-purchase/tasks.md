---
description: "Task list for Customer Ticket Purchase"
---

# Tasks: Customer Ticket Purchase

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.4.0, already applied),
[quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first** (spec FR-013, Constitution VI). In each phase, write the
test tasks and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Do not change the contract** (1.4.0, types regenerated, `errors.ts` and `order.ts` mirrored).
  Raise any gap.
- Every ordering rule runs inside `005`'s locked transaction, in the order data-model.md gives:
  repeat `requestId` first, then cancelled, then sales closed, then tier and no-oversell rules.
- Money is exact: `Prisma.Decimal` in the Backend; integer cents from decimal strings in the
  Customer app. Never a floating-point price.
- The customer is always the token's subject. No request input names a customer.
- Backend tests go through `backend/test/setup/authed-request.ts`, so every response is checked
  against the contract.
- **Green gate (constitution, Development Workflow 4)**: contract 1.4.0 lands in the plan PR
  before its routes exist, so route coverage fails on the plan PR alone. Merge the plan and
  implementation PRs back to back, in order, and say so in the plan PR description, as `005` did.

---

## Phase 1: Setup

- [X] T001 Run `npm test` from the repo root and record the baseline in this line. Expect
  `backend/test/contract/route-coverage.e2e-spec.ts` to fail for `listMyOrders` and
  `getEventAvailability` until they are implemented, because contract 1.4.0 is already applied.
  **Baseline 2026-10-03: shared 22, Backend 202 of 204 (the 2 failures are route coverage for
  exactly those two operations), Admin 70, Customer 33, Booth 3, seed 3.**

## Phase 2: Foundational (blocks every story)

- [X] T002 Add `requestId String? @db.Uuid` to `model Order` in `backend/prisma/schema.prisma`, with
  `@@unique([customerSub, requestId])` and `@@index([customerSub, createdAt])`, and write migration
  `backend/prisma/migrations/20261004000000_order_request_id/migration.sql` per data-model.md:
  "`requestId` `uuid` null"; unique index `Order_customerSub_requestId_key` on
  `(customerSub, requestId)`; index `Order_customerSub_createdAt_idx` on `(customerSub, createdAt)`.
  Existing orders keep `requestId = NULL`. Run `npx prisma generate` in `backend/`.
- [X] T003 Move order-placing tests to dates relative to now (research R2): in
  `backend/test/setup/fixtures.ts`, base `nextWindow()` on midnight UTC 365 days from now instead
  of `Date.UTC(2027, 0, 1, 18)`, and export a `windowAt(daysFromNow: number, hour = 18)` helper;
  replace the fixed 2027 windows and timestamps in
  `backend/test/integration/reports.e2e-spec.ts`, `backend/test/integration/cancel.e2e-spec.ts`,
  and `backend/test/integration/attendees.e2e-spec.ts` with `windowAt(...)` values that keep each
  test's relative ordering. Every one of these suites must still pass unchanged otherwise.
- [X] T004 Select `"startsAt"` in the `lockEvent` query and add `startsAt: Date` to `LockedEvent`
  in `backend/src/common/event-lock.ts`. No behavior changes yet.

**Checkpoint**: `npm test --workspace @queuepass/backend` matches the T001 baseline.

---

## Phase 3: User Story 1 - Get Tickets for an Event (Priority: P1) 🎯 MVP

**Goal**: A customer chooses a tier (or the base price), a quantity of 1 to 10, sees the exact
total, confirms once, and sees their ticket codes; repeating the confirmation never places a
second order.

**Independent test**: As `customer1`, get 2 tickets in a tier; the confirmation shows 2 distinct
codes and twice the tier price, and the order appears on the event's Admin attendee list
(quickstart P1, P2).

### Tests for User Story 1 (write first, confirm they fail)

- [X] T005 [P] [US1] Write `backend/test/integration/availability.e2e-spec.ts` for
  `GET /events/{id}/availability`: an event without tiers reports `ticketsLeft = capacity − valid
  tickets` and `tiers: []`; an event with tiers reports each tier as `min(quantity − tier valid
  tickets, event left)`, in `listTicketTiers` order; void tickets from a cancelled event do not
  count; `salesClosed` is `null` for a future scheduled event, `STARTED` for an event that started
  one minute ago, and `CANCELLED` for a cancelled event (even one that has started); unknown event
  `404`; malformed id `400`; admin, agent, and customer all `200`; no token `401`.
- [X] T006 [P] [US1] Write `backend/test/integration/orders.request-id.e2e-spec.ts`: the same
  `requestId` sent twice by `customer1` returns `201` then `200` with the same order id, and only
  one order and its tickets exist; **10 simultaneous identical requests → exactly one order, one
  `201` and nine `200`, all with the same id**; the same `requestId` with a different quantity,
  tier, or event → `409 REQUEST_ID_REUSED`; `customer1` and `customer2` using the same `requestId`
  each get their own order; a repeat after the event has sold out still returns `200` with the
  original order; two requests without `requestId` place two orders (`005` behavior); a
  non-UUID `requestId` → `400`.
- [X] T007 [P] [US1] Add exact-total cases to `customer-app/test/format.test.ts` for a new
  `totalUsd(price: string, quantity: number): string`: `('19.99', 3)` → `$59.97`, `('0.10', 3)` →
  `$0.30`, `('1250.00', 10)` → `$12,500.00`, `('0.00', 4)` → `$0.00`.
- [X] T008 [P] [US1] Write `customer-app/test/purchase.test.tsx` (stubbed fetch via
  `customer-app/test/helpers.tsx`): an event with tiers lists each tier's name, price, and tickets
  left as radio choices and Confirm stays disabled until one is chosen; an event without tiers
  shows the base price and no tier choice; the quantity offers 1 to `min(10, tickets left)`; the
  total updates exactly (3 × $19.99 = $59.97); Confirm sends `POST /events/{id}/orders` with
  `tierId` (when tiered), `quantity`, and a UUID `requestId`; success replaces the form with the
  event, tier, quantity, unit price, total charged, every ticket code, and a link to My tickets;
  clicking Confirm twice quickly sends one request; leaving before confirming sends no order.
  Also update `customer-app/test/app.test.tsx` "Customer app is read-only (spec 003 ...)": retitle
  it for spec 006 FR-009 (placing an order is the only write), stub
  `GET /events/{id}/availability` and `GET /events/{id}/tiers` in its `everyRoute()`, and keep
  its assertions that no control creates, edits, or deletes a venue, event, or tier and that
  loading a page sends only GETs.

### Implementation for User Story 1

- [X] T009 [US1] Add optional `requestId` to `backend/src/orders/dto/create-order.dto.ts`
  (`@IsOptional()`, `@IsUUID('all', { message: 'requestId must be a UUID' })`).
- [X] T010 [US1] In `backend/src/orders/orders.service.ts`, inside `createLocked` and before the
  cancelled check, look up the caller's order by `(customerSub, requestId)` when `requestId` is
  given: same event, tier, and quantity → return it marked as replayed; anything different →
  `conflict('REQUEST_ID_REUSED', ...)`. Store `requestId` on new orders. In `create`, treat a
  `P2002` on `requestId` (concurrent repeat across events) by re-running the lookup, alongside the
  existing ticket-code retry. Return `{ order, replayed }` to the controller.
- [X] T011 [US1] In `backend/src/orders/orders.controller.ts`, respond `200` for a replayed order
  and `201` for a new one (`@Res({ passthrough: true })` setting the status).
- [X] T012 [US1] Create `backend/src/events/availability.service.ts` computing `Availability` per
  data-model.md (valid tickets via `ticketsSold` or one grouped count; tier left capped by event
  left, floored at 0; `salesClosed` from status, then `new Date() >= startsAt`), register it in
  `backend/src/events/events.module.ts`, and add `GET :id/availability` (no `@Roles`, so any
  signed-in user; `ParseUUIDPipe`) to `backend/src/events/events.controller.ts`.
- [X] T013 [P] [US1] Add `totalUsd(price, quantity)` to `customer-app/src/format.ts`: convert the
  decimal string to integer cents, multiply, and format through `usd()`.
- [X] T014 [US1] Create `customer-app/src/components/GetTickets.tsx`: load
  `GET /events/{id}/availability` and `GET /events/{id}/tiers`; render tier radios (or the base
  price), a quantity select, the `totalUsd` total, and Confirm; create a `requestId` with
  `crypto.randomUUID()` when Confirm is first pressed and keep it for that confirmation; disable
  Confirm while the request runs; on success show the confirmation with every code and a
  `Link` to `/my-tickets`.
- [X] T015 [US1] Render `<GetTickets event={e} />` in `customer-app/src/pages/EventDetail.tsx`
  below the details, and update its doc comment (no longer read-only: spec 006 FR-009 allows
  ordering only).

**Checkpoint**: T005–T008 pass; quickstart P1 and P2 work in the browser.

---

## Phase 4: User Story 2 - Sold Out and Cancelled Are Explained (Priority: P2)

**Goal**: The customer sees sold-out, cancelled, and sales-closed states before trying; a refusal
at confirmation is explained and nothing is recorded; an unknown outcome is never reported as a
failure.

**Independent test**: A sold-out tier, a cancelled event, and a started event each show why
tickets are unavailable and cannot be confirmed (quickstart P3).

### Tests for User Story 2 (write first, confirm they fail)

- [X] T016 [P] [US2] Write `backend/test/integration/orders.sales-closed.e2e-spec.ts`: an order
  for an event that started one minute ago (and ends later) → `409 SALES_CLOSED` with nothing
  recorded; an event starting in one hour → `201`; a cancelled event that has started still
  answers `409 EVENT_CANCELLED` (cancelled is checked first); a repeat of an earlier order's
  `requestId` after the event started → `200` with the original order.
- [X] T017 [P] [US2] Write `customer-app/test/purchase-unavailable.test.tsx`: a tier with 0 left is
  disabled and marked "Sold out"; an event with `ticketsLeft: 0` shows "Sold out" and no form;
  with 3 left the quantity stops at 3; `salesClosed: 'CANCELLED'` shows "This event has been
  cancelled" and no form; `salesClosed: 'STARTED'` shows "Sales closed" and no form; a `409
  SOLD_OUT`, `EVENT_CANCELLED`, or `SALES_CLOSED` on Confirm shows the Backend's message, reloads
  availability, and the next Confirm sends a **new** `requestId`; a `400 VALIDATION_FAILED` on
  Confirm shows its message the same way; a `401` on Confirm sends the customer back through
  sign-in (`signIn()` from `useAuth`) and shows no outcome; a network error or `500` on
  Confirm shows "We couldn't confirm whether your order went through" with a link to My tickets
  and a Check again button that resends the **same** `requestId`.

### Implementation for User Story 2

- [X] T018 [US2] In `backend/src/orders/orders.service.ts`, after the cancelled check and before
  the tier rules, refuse when `new Date() >= event.startsAt` with
  `conflict('SALES_CLOSED', ...)` and the message "Sales for {event name} closed when it
  started." (the contract's `salesClosed` example).
- [X] T019 [US2] In `customer-app/src/components/GetTickets.tsx`, add the unavailable states
  (sold out, cancelled, sales closed) in place of the form, disable and mark sold-out tiers, cap
  the quantity at what is left, show refusal messages from `error.message` with a new
  `requestId` and an availability reload, and the unknown-outcome message with Check again
  (same `requestId`) and a link to `/my-tickets`. A `401` on Confirm calls `signIn()`, as
  `customer-app/src/use-load.ts` does: the Backend checks the token before any ordering rule, so
  nothing was recorded.

**Checkpoint**: T016–T017 pass; quickstart P3 works in the browser.

---

## Phase 5: User Story 3 - My Tickets (Priority: P2)

**Goal**: A customer sees every order they placed, newest first, with codes and states, and never
anyone else's.

**Independent test**: `customer1` and `customer2` each get tickets; each sees only their own
(quickstart P4, P5).

### Tests for User Story 3 (write first, confirm they fail)

- [X] T020 [P] [US3] Write `backend/test/integration/me-orders.e2e-spec.ts` for
  `GET /me/orders`: `customer1`'s orders newest first, each with tickets and an `event` summary
  (id, name, start, end, status, venue id and name); `customer2` gets none of them; after an admin
  cancels the event, the order is `REFUNDED`, `event.status` is `CANCELLED`, and its tickets are
  `VOID`; a checked-in ticket carries `checkedInAt`; a customer with no orders gets `[]`; orders
  made with a stand-in subject (as the demo script does) never appear; admin and agent `403`; no
  token `401`.
- [X] T021 [P] [US3] Write `customer-app/test/my-tickets.test.tsx`: the header shows a My tickets
  link after Events and Venues; `/my-tickets` lists orders newest first with the event linking to
  `/events/{id}`, venue, start, tier, quantity, total, placed time, and Confirmed or Refunded;
  each ticket shows its code and Valid, Void, or "Used {time}"; a cancelled event is marked;
  no orders shows "You have no tickets yet" with a link to Events; an unreachable Backend shows
  the shared service-unreachable message.

### Implementation for User Story 3

- [X] T022 [US3] Add `mine(sub: string)` to `backend/src/orders/orders.service.ts`: orders where
  `customerSub = sub`, `orderBy [{ createdAt: 'desc' }, { id: 'desc' }]`, including tier, tickets,
  and event with location; map with `toOrderResponse` plus the `event` summary (`MyOrder`).
- [X] T023 [US3] Create `backend/src/orders/me-orders.controller.ts` (`@Controller('me')`,
  `@Get('orders')`, `@Roles('customer')`, subject from `@CurrentPrincipal()`) and register it in
  `backend/src/orders/orders.module.ts`.
- [X] T024 [P] [US3] Create `customer-app/src/pages/MyTickets.tsx` using `useLoad` with
  `GET /me/orders`, per T021.
- [X] T025 [US3] In `customer-app/src/App.tsx`, add the `/my-tickets` route and a
  `<NavLink to="/my-tickets">My tickets</NavLink>` after Venues, and update the doc comment.

**Checkpoint**: T020–T021 pass; quickstart P4 and P5 work in the browser.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T026 Update `README.md`: the status table (006 built), the "Today" paragraph, and the
  Customer app row ("browse, get tickets, My tickets") in the services table.
- [X] T027 Run lint, build, Prettier, `node scripts/check-boundary.mjs`, and
  `node scripts/check-contract-drift.mjs`; all pass. Record the result in this line.
  **2026-10-03: lint, build, Prettier, boundary, and drift checks pass.**
- [X] T028 Run `npm test` from the repo root; all suites pass, including route coverage. Record
  the counts per workspace in this line. **2026-10-03: 389 tests pass — shared 22, Backend 228,
  Admin 70, Customer 63, Booth 3, seed 3.**
- [X] T029 Run `docker compose up --build -d` and the demo-data command, then quickstart P1–P5 in
  a browser. Record the result in this line. **2026-10-03: all six services healthy and migration
  `20261004000000_order_request_id` applied against `docker compose up --build`; P1–P5 pass in a
  browser (checked by the user).**

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T004)** → stories.
- **US1** first (MVP). **US2** extends US1's order service and `GetTickets.tsx`, so it follows
  US1. **US3** needs only Foundational: its Backend test places orders through the existing API,
  and its Customer test stubs the API, so it can run alongside US1.
- **Polish (T026–T029)** after all stories.
- Within each story: tests → Backend → Customer app.

## Parallel Opportunities

- **US1 tests**: T005, T006, T007, T008 are four different files.
- **US1 implementation**: T013 (`format.ts`) runs alongside the Backend tasks T009–T012.
- **US2 tests**: T016 and T017.
- **US3**: T020 and T021 together; then T024 alongside T022–T023.
- **Across stories**: US3 (T020–T025) alongside US1 once Foundational is done.

## Implementation Strategy

1. **MVP**: Setup, Foundational, US1. Customers can get tickets, and a repeated confirmation is
   safe. Stop and run quickstart P1–P2.
2. **Then US2**: clear unavailable states and refusals, and sales closing at start.
3. **Then US3**: My tickets.
4. **Polish** and the running-system gate (T029) before the implementation PR.
