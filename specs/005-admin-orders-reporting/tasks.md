---
description: "Task list for Admin Orders, Reporting, Attendees, and Safe Cancellation"
---

# Tasks: Admin Orders, Reporting, Attendees, and Safe Cancellation

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.3.0, already applied),
[quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first** (FR-015, Constitution VI). In each phase, write the test
tasks and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Do not change the contract** (1.3.0, types regenerated). Raise any gap.
- Every write that changes availability takes `004`'s event-row lock first (research R2).
- Money is exact: `numeric(10,2)` and `Prisma.Decimal`, strings on the wire.
- The demo script is never wired into `docker compose up`.

---

## Phase 1: Setup

- [X] T001 Run `npm test` and record the baseline in this line. **Baseline 2026-10-01: all 280 existing tests pass; after the 1.3.0 contract, route coverage and the new suites fail until implemented, as expected.**

## Phase 2: Foundational

- [X] T002 Shared: add the four error codes to `packages/shared/src/errors.ts`; `status` and `cancelledAt` to `Event` in `event.ts`; new `order.ts` (`Order`, `OrderInput`, `Ticket`, `SalesReport`, `EventSales`, `TierSales`, `Cancellation`).
- [X] T003 Prisma schema and migration `20261002000000_orders_tickets` per data-model.md, including the filtered `event_no_overlap`.
- [X] T004 `reset-db.ts`: truncate `Ticket`, `Order` first.
- [X] T005 Events service: include `status` and `cancelledAt` in responses; conflict pre-check ignores cancelled events.

## Phase 3: User Story 1 - Orders and Tickets (P1)

- [X] T006 [P] [US1] `backend/test/integration/orders.e2e-spec.ts`: tierless order at base price with 2 distinct 12-character codes; tiered order at tier price with exact total; `tierId` required/forbidden (`400`); tier of another event `404`; quantity 0 and 11 `400`; exact fill accepted, one more `409 SOLD_OUT` with `details.available`; tier limit and event limit both enforced; price change later leaves the order's price; **20 simultaneous one-ticket orders against capacity 10 → exactly 10 succeed and 10 valid tickets exist**; customer identity taken from the token.
- [X] T007 [P] [US1] `backend/test/integration/orders.authz.e2e-spec.ts`: admin and agent `403` on `createOrder`; customer and agent `403` on attendees, cancel, and reports; no token `401` on all four.
- [X] T008 [US1] `backend/src/orders/` module, controller (`POST /events/:id/orders`, `@Roles('customer')`, principal from the token), DTO, service under the lock, `ticket-code.ts`.

## Phase 4: User Story 2 - Sales Dashboard (P1)

- [X] T009 [P] [US2] `backend/test/integration/reports.e2e-spec.ts`: totals and per-event sold, capacity, revenue, check-ins; per-tier sold and revenue; refunded orders excluded; cancelled events excluded from total capacity; ordered by start.
- [X] T010 [P] [US2] `admin-app/test/reports.test.tsx`: Reports page shows totals and rows with percent; event page Sales card shows per-tier sold.
- [X] T011 [US2] `backend/src/reports/` module, controller, service (research R6).
- [X] T012 [US2] `admin-app/src/api/reports.ts`, `pages/Reports.tsx`, `components/SalesCard.tsx`; Reports nav link and route in `App.tsx`; Sales card on `EventDetail.tsx`.

## Phase 5: User Story 3 - Attendee List (P2)

- [X] T013 [P] [US3] `backend/test/integration/attendees.e2e-spec.ts`: orders oldest first with tickets, codes, check-in state, tier names; refunded included; unknown event `404`.
- [X] T014 [P] [US3] `admin-app/test/attendees.test.tsx`: rows with codes and checked-in marks; summary line; empty message.
- [X] T015 [US3] `GET /events/:id/attendees` in the orders module; `admin-app/src/api/orders.ts`, `pages/Attendees.tsx`, route, link from the event page.

## Phase 6: User Story 4 - Cancel Safely (P2)

- [X] T016 [P] [US4] `backend/test/integration/cancel.e2e-spec.ts`: cancel voids, refunds, returns counts, sets status; second cancel `409 EVENT_CANCELLED`; cancelled refuses PATCH, tier writes, orders; a new event in the same slot is accepted; delete with orders `409 EVENT_HAS_ORDERS`; delete tier with orders `409 TIER_HAS_ORDERS`; capacity below sold and tier quantity below tier sold `409 CAPACITY_EXCEEDED`; first tier after tierless sales `409 EVENT_HAS_ORDERS`; an event without orders still deletes.
- [X] T017 [P] [US4] `admin-app/test/cancel.test.tsx`: dismiss sends nothing; confirm posts, shows counts and Cancelled, hides Edit, Delete, tier form; event list shows the Cancelled pill. Added during T025: the Sales card must reload after a cancel (bug found in the browser, test written first, then fixed).
- [X] T018 [P] [US4] `customer-app/test/browse.test.tsx`: cancelled marker on list, event page, venue page.
- [X] T019 [US4] Events: `POST /events/:id/cancel`, cancelled guard on update, delete guard, sold checks; tiers: cancelled, sold, tierless guards; filter `P2003` by constraint.
- [X] T020 [US4] Admin: cancel button, Cancelled marker, hidden controls, list pill. Customer: Cancelled marker.

## Phase 7: Demo data and Polish

- [X] T021 `backend/src/scripts/demo-data.ts` (research R9) and `demo-data` npm script. Also covered by `backend/test/integration/demo-data.e2e-spec.ts` (rules obeyed; second run changes nothing).
- [X] T022 README: status, features, the demo-data command.
- [X] T023 Lint, build, Prettier, boundary, drift pass. **2026-10-01: lint, build, Prettier, boundary, and drift checks pass.**
- [X] T024 `npm test` passes. Record counts. **2026-10-01: 335 tests pass — Backend 204, shared 22, Admin 70, Customer 33, Booth 3, seed 3.**
- [X] T025 `docker compose up --build -d`, quickstart O1–O6 pass. Record the result. **2026-10-01: O1–O6 pass in a browser against `docker compose up --build`.**

## Dependencies

1 → 2 → US1 → (US2, US3, US4 in any order) → 7. US2–US4 need orders from US1.
