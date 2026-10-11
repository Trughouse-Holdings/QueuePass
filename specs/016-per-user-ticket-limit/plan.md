# Implementation Plan: Per-Customer Ticket Limit

**Branch**: `016-per-user-ticket-limit-spec` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#28](https://github.com/Trughouse-Holdings/QueuePass/issues/28)

**Input**: Feature specification from `specs/016-per-user-ticket-limit/spec.md`

## Summary

- **Storage**: one nullable column, `Event.maxTicketsPerCustomer`, with a CHECK keeping it from 1 to
  the event's capacity. Existing events have no limit (research R1).
- **Rule**: the order path counts the customer's valid tickets for the event under the event row
  lock it already takes, and refuses an order that would exceed the limit with
  `409 TICKET_LIMIT_REACHED`. The refusal always names the smaller of the limit and the tickets
  left (R2, R3, R4).
- **Customer standing**: the availability read gains `customerLimit` (`limit`, `held`, `remaining`)
  for the signed-in customer (R5).
- **Event writes**: the limit is refused above the event's capacity on create and edit, and a
  venue layout that would drop a seated event's capacity below its limit is refused (R6).
- **Admin app**: a "Tickets per customer" field in the event form, and a "Per customer" row on the
  event page (R7).
- **Customer app**: Get tickets offers no more than the smallest of the per-order cap, the tickets
  left, and the customer's remaining limit, and says when the limit is reached (R8).

Contract **1.6.0** lands in this spec and plan PR with types regenerated. Its new response fields
are optional, so `main` stays green before the implementation merges (R9).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies.**

**Storage**: PostgreSQL 17. One column and one CHECK in one migration
([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, including 50
simultaneous orders from one customer. Admin and Customer apps Vitest + React Testing Library.
Browser round trip in [quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop.

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: one extra indexed count per order, inside the transaction that already
counts tickets; no measurable change.

**Constraints**: a customer never holds more valid tickets than the limit, guaranteed under the
event row lock (Constitution IV); every existing order rule and refusal unchanged; `requestId`
replays count once.

**Scale/Scope**: 0 new routes; 4 changed operations (`createEvent`, `updateEvent`, `replaceLayout`,
`getEventAvailability`) and 1 changed rule in `createOrder`; 1 new error code.

## Constitution Check

Evaluated against constitution **v3.0.0**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.6.0 and regenerated types in this PR, before any code. One new code in the standard envelope. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, or dependency. One migration applied by the existing startup. |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #28; spec and plan on `016-per-user-ticket-limit-spec`, reviewed by a second Claude session before the PR; implementation on `016-per-user-ticket-limit-impl` in a fresh session, closing #28. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | The limit is checked under the event's `FOR UPDATE` row lock, which already serializes every order for an event; a CHECK keeps the stored limit in range. The Customer app's caps are a preview only (FR-016). |
| **V. Sign-In Everywhere** | PASS | **PASS** | Limit writes stay `queuepass-admin`. `customerLimit` describes only the caller, and is `null` for non-customers. No route or role changes. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in `tasks.md`; the guarantee is tested with genuinely simultaneous requests; the boundary is tested on both sides (exactly at the limit, one over). The 80% coverage floor is a recorded deferral until `010` and `011`; this feature reports its coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | One number field and plain text, reusing existing form and card markup. No new styles. |
| **VIII. Staged Simplicity** | PASS | **PASS** | One column; no per-type limits, no admin "near the limit" view, no multi-account detection (spec Out of Scope). No security or correctness control deferred. |

## Project Structure

```text
specs/016-per-user-ticket-limit/
├── spec.md, plan.md, research.md (R1–R10), data-model.md, quickstart.md (S1–S8), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                       # 1.6.0 (this PR)
packages/shared/src/~ api-schema.ts            # regenerated (this PR)
packages/shared/src/~ errors.ts, ~ event.ts, ~ order.ts   # implementation PR (order.ts: Availability)
backend/
├── prisma/~ schema.prisma, migrations/+ 20261011000000_per_customer_ticket_limit/migration.sql
├── src/
│   ├── common/~ event-lock.ts                 # LockedEvent + SELECT gain the column
│   ├── orders/~ orders.service.ts             # the limit rule (R2, R3, R4)
│   ├── events/~ dto/create-event.dto.ts, ~ dto/update-event.dto.ts, ~ events.service.ts (R6)
│   ├── events/~ events.controller.ts, ~ availability.service.ts      # customerLimit (R5)
│   ├── seating/~ layout.service.ts            # a layout below a seated event's limit (R6)
│   └── scripts/~ demo-data.ts                 # one demo event with a limit (R10)
└── test/
    ├── integration/+ orders.ticket-limit.e2e-spec.ts, + orders.ticket-limit.concurrency.e2e-spec.ts,
    │               + events.ticket-limit.e2e-spec.ts; ~ availability.e2e-spec.ts
    └── setup/~ fixtures.ts                    # event() takes a limit
admin-app/src/pages/~ EventForm.tsx, ~ EventDetail.tsx
admin-app/test/+ ticket-limit.test.tsx
customer-app/src/components/~ GetTickets.tsx, ~ SeatPicker.tsx
customer-app/test/+ ticket-limit.test.tsx; ~ helpers.tsx
~ README.md
```

**Structure Decision**: the existing monorepo layout. Every change sits next to the code it
extends; no new module.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| New response fields optional in the contract | The spec and plan PR merges before the implementation, and the suite must stay green (R9) | Required fields would fail the Backend's contract validation on `main` until the implementation merges. |
| A cross-column CHECK (`BETWEEN 1 AND "totalTicketCapacity"`) | FR-001's range must hold whichever path writes the capacity | A `>= 1` CHECK alone would let a capacity change leave a limit no event could reach. |
