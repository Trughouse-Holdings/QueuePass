# Implementation Plan: Customer Ticket Purchase

**Branch**: `006-customer-ticket-purchase` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-customer-ticket-purchase/spec.md`

## Summary

- **Availability read** for an event: tickets left per event and tier, and whether sales are
  closed and why, computed by the Backend (research R1).
- **Sales close at start**, checked under `004`'s event-row lock like every ordering rule (R2).
- **One confirmation, one order**: an optional `requestId` on orders, unique per customer, so a
  repeated or retried confirmation returns the first order (R3).
- **The customer's own orders** at `GET /me/orders`, matched on the token's subject (R4).
- **Customer app**: a Get tickets section on the event page, a confirmation, and a My tickets
  page (R5).

Contract **1.4.0** lands in this plan PR with types regenerated (R6).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies** (`crypto.randomUUID()` in the
browser for request ids).

**Storage**: PostgreSQL 17. One nullable column and two indexes on `Order`, in one migration
([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, including 10
simultaneous identical confirmations. Customer app Vitest + React Testing Library. Browser round
trip in [quickstart.md](./quickstart.md).

**Constraints**: money exact end to end, including the total shown before confirming; a customer
reads only their own orders (identity from the token); every ordering rule decided by the Backend
under the event lock; `005` clients keep working unchanged.

**Scale/Scope**: 2 new reads, 1 changed write, 1 column; 1 Customer section, 1 page

## Constitution Check

Evaluated against constitution **v2.2.0**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.4.0 and regenerated types in this plan PR. Two new codes in the standard envelope. The Customer app reaches data only through the typed client. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, or dependency. |
| **III. Spec-Driven, by PR** | PASS | **PASS** | Spec, plan, implementation PRs in order. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | Sales-close and repeat checks run under the event lock; the unique `(customerSub, requestId)` index guarantees one order per confirmation across events. Counts in the app are guidance only. |
| **V. Sign-In Everywhere** | PASS | **PASS** | `listMyOrders` is `customer`-only and takes the subject from the token, with no customer parameter; availability is any signed-in user, like the event it describes. Route-coverage test enforces both. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests per rule precede code in `tasks.md`; repeat confirmations tested with simultaneous requests. |
| **VII. Function Over Finish** | PASS | **PASS** | Plain semantic forms, radio buttons, and lists; no new styling. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No payment provider, QR codes, email, customer refunds, or sales-opening window. No deferral of a security or correctness control. |

## Project Structure

```text
specs/006-customer-ticket-purchase/
├── spec.md, plan.md, research.md (R1–R7), data-model.md, quickstart.md (P1–P5), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                       # 1.4.0 (this PR)
packages/shared/src/~ api-schema.ts, ~ errors.ts, ~ order.ts
backend/
├── prisma/~ schema.prisma, migrations/+ 20261004000000_order_request_id/migration.sql
├── src/
│   ├── common/~ event-lock.ts                       # startsAt in the locked row
│   ├── orders/~ orders.{controller,service}.ts, dto/~ create-order.dto.ts
│   │          + me-orders.controller.ts             # GET /me/orders
│   └── events/~ events.controller.ts (+ GET :id/availability), + availability.service.ts
└── test/integration/+ availability.*, orders.sales-closed.*, orders.request-id.*, me-orders.*;
                     ~ order-placing suites moved to dates relative to now
customer-app/src/
├── components/+ GetTickets.tsx
├── pages/+ MyTickets.tsx, ~ EventDetail.tsx
├── ~ format.ts                                      # exact cents totals
└── ~ App.tsx                                        # My tickets route and link
customer-app/test/+ purchase.test.tsx, + my-tickets.test.tsx, ~ format.test.ts
~ README.md                                          # Customer app row, status table
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `requestId` column and unique index | FR-005: a retried confirmation must not create a second order | Disabling the button cannot stop a request the network retries, or a Check again after an unknown outcome. |
| Separate availability read | FR-002 needs tickets left and the sales-closed reason before confirming | Adding counts to `Event` and `TicketTier` would change every existing response and Admin fixture for one Customer section. |
| Moving `005` test dates relative to now | The new sales-close rule would fail fixed 2027 dates once they pass | Leaving them would plant failures that appear with no code change. |
