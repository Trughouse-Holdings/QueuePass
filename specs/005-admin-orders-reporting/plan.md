# Implementation Plan: Admin Orders, Reporting, Attendees, and Safe Cancellation

**Branch**: `005-admin-orders-reporting` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-admin-orders-reporting/spec.md`

## Summary

- **Backend orders and tickets** that never oversell: ordering takes `004`'s event-row lock and
  counts valid tickets before inserting (research R1–R3).
- **Cancellation** as one transaction that voids tickets, refunds orders, and marks the event
  cancelled; the scheduling exclusion constraint ignores cancelled events (R4).
- **Protection** against deleting events or tiers with orders, and against shrinking below sales
  (R5).
- **Sales report** computed on request (R6).
- **Admin app**: Reports page, Sales card, Attendees page, Cancel button (R7). **Customer app**:
  "Cancelled" marker (R8).
- **Demo-data command** for local demonstrations (R9).

Contract **1.3.0** lands in this plan PR with types regenerated (R10).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies** (`node:crypto` for codes).

**Storage**: PostgreSQL 17. Two tables, two event columns, one recreated constraint, in one
migration ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, including 20
simultaneous orders against capacity 10. Admin and Customer apps: Vitest + React Testing Library.
Browser round trip in [quickstart.md](./quickstart.md).

**Constraints**: money exact end to end; customers order only for themselves (identity from the
token); cancellation all-or-nothing; no demo data in normal start.

**Scale/Scope**: 2 tables, 4 operations, 3 Admin pages or cards, 1 Customer marker, 1 script

## Constitution Check

Evaluated against constitution **v2.1.0**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.3.0 and regenerated types in this plan PR. Four new codes in the standard envelope. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service. The demo script ships inside the Backend image and runs only on request. |
| **III. Spec-Driven, by PR** | PASS | **PASS** | Spec, plan, implementation PRs in order. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | No-oversell under the event-row lock; unique ticket codes by index; deletion guarded by `RESTRICT` FKs; venue time by the (filtered) exclusion constraint; CHECKs on quantity and money. |
| **V. Sign-In Everywhere** | PASS | **PASS** | `createOrder` is `customer`-only and uses the caller's own identity; attendees, cancel, and reports are `queuepass-admin`. Route-coverage test enforces it. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests per rule precede code in `tasks.md`; concurrency tested with simultaneous requests. |
| **VII. Function Over Finish** | PASS | **PASS** | Existing CSS classes; no charts. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No payment provider, no QR, no check-in operation, no caching. The direct check-in write in the demo script is recorded as a deferral closed by the Ticket Booth spec. |

## Project Structure

```text
specs/005-admin-orders-reporting/
├── spec.md, plan.md, research.md (R1–R10), data-model.md, quickstart.md (O1–O6), tasks.md
└── contracts/README.md

contracts/~ openapi.yaml                       # 1.3.0 (this PR)
packages/shared/src/~ api-schema.ts, ~ errors.ts, ~ event.ts, + order.ts
backend/
├── prisma/~ schema.prisma, migrations/+ 20261002000000_orders_tickets/migration.sql
├── src/
│   ├── orders/+ orders.{module,controller,service}.ts, dto/, ticket-code.ts
│   ├── reports/+ reports.{module,controller,service}.ts
│   ├── events/~ events.{controller,service}.ts     # cancel, status, sold checks, delete guard
│   ├── tiers/~ tiers.service.ts                     # cancelled, sold, tierless-sales guards
│   ├── common/filters/~ prisma-exception.filter.ts  # P2003 by constraint
│   ├── scripts/+ demo-data.ts
│   └── ~ app.module.ts
└── test/integration/+ orders.*, cancel.*, reports.*, attendees.*; setup/~ reset-db.ts
admin-app/src/
├── api/+ orders.ts, + reports.ts
├── pages/+ Reports.tsx, + Attendees.tsx, ~ EventDetail.tsx, ~ EventList.tsx
├── components/+ SalesCard.tsx, ~ TierSection.tsx
└── ~ App.tsx
admin-app/test/+ reports.test.tsx, + attendees.test.tsx, + cancel.test.tsx
customer-app/src/pages/~ EventList.tsx, ~ EventDetail.tsx, ~ VenueDetail.tsx; test/~ browse.test.tsx
~ README.md
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Ordering API before the Customer app screens | All three requested Admin features need real orders | Admin-only fake rows would test nothing the real flow does. |
| Filtered exclusion constraint | A cancelled event must free its venue time (FR-009) | Deleting cancelled events would lose the order history FR-010 protects. |
| Demo-data script | The Admin screens are empty until `006` ships | Seeding orders at every start would put fake sales in every environment. |
