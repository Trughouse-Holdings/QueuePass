# Implementation Plan: Seat Selection

**Branch**: `007-seat-selection` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-seat-selection/spec.md`

## Summary

- **Venue layouts** as sections (name, rows, seats per row), replaced as a whole under a venue
  lock that also locks the venue's scheduled events (research R1, R3, R4).
- **Reserved seating per event** and **section-to-tier mapping**, under the event lock (R5).
- **Seat orders**: `006`'s order gains seats, checked under the event lock and guaranteed by a
  partial unique index on valid tickets per seat, so voiding frees seats (R2, R6).
- **One seat map read** for both apps, never naming holders (R5).
- **Admin app**: layout card and form, seating card and seat map, seats on attendees (R7).
  **Customer app**: tier → section → seats in Get tickets; seats on the confirmation and My
  tickets (R8).

Contract **1.5.0** lands in this plan PR with types regenerated (R9).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies.**

**Storage**: PostgreSQL 17. Two tables, one event column, three ticket columns, one partial unique
index, in one migration ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, including 10
simultaneous orders for one seat. Admin and Customer apps Vitest + React Testing Library.
Browser round trip in [quickstart.md](./quickstart.md).

**Constraints**: no seat ever held by two valid tickets, guaranteed by the database; every
general-admission flow from `006` unchanged; `005`'s one-tier order model unchanged; money exact.

**Scale/Scope**: 5 new operations, 1 changed write; up to 22,090 seats per venue, 20,000 per
section, drawn one section at a time.

## Constitution Check

Evaluated against constitution **v2.2.0**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.5.0 and regenerated types in this plan PR. Two new codes in the standard envelope. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, or dependency. |
| **III. Spec-Driven, by PR** | PASS | **PASS** | Spec, plan, implementation PRs in order, stacked on `006`. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | One valid ticket per seat by a partial unique index; layout and seating rules under the venue and event locks; CHECKs on sizes and seat columns. |
| **V. Sign-In Everywhere** | PASS | **PASS** | Layout and seating writes are `queuepass-admin`; layout and seat map reads are any signed-in and carry no holder identity. Route-coverage test enforces it. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests per rule precede code in `tasks.md`; the seat guarantee tested with simultaneous requests. |
| **VII. Function Over Finish** | PASS | **PASS** | Seat maps are rows of plain toggle buttons and lists; no drawn floor plans. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No seat holds, auto-assignment, or per-seat pricing (spec assumptions). No deferral of a security or correctness control. |

## Project Structure

```text
specs/007-seat-selection/
├── spec.md, plan.md, research.md (R1–R10), data-model.md, quickstart.md (S1–S6), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                       # 1.5.0 (this PR)
packages/shared/src/~ api-schema.ts, ~ errors.ts, ~ event.ts, ~ order.ts, + seating.ts
backend/
├── prisma/~ schema.prisma, migrations/+ 20261005000000_seat_selection/migration.sql
├── src/
│   ├── seating/+ seating.module.ts, layout.{controller,service}.ts, seat-map.{controller,service}.ts
│   ├── orders/~ orders.service.ts, dto/~ create-order.dto.ts      # seats in orders
│   ├── events/~ events.service.ts                                 # reservedSeating, venue move guard
│   ├── locations/~ locations.service.ts                           # capacity vs layout
│   ├── common/~ event-lock.ts                                     # reservedSeating, locationId
│   └── ~ app.module.ts
└── test/integration/+ layout.*, seating.*, orders.seats.*, seats.concurrency.*; setup/~ reset-db.ts
admin-app/src/
├── api/+ seating.ts
├── components/+ LayoutCard.tsx, SeatingCard.tsx, SeatGrid.tsx
├── pages/~ LocationDetail.tsx, ~ EventDetail.tsx, ~ Attendees.tsx
admin-app/test/+ layout.test.tsx, + seating.test.tsx; ~ fixtures-005.ts, ~ attendees.test.tsx
customer-app/src/
├── components/~ GetTickets.tsx, + SeatPicker.tsx
├── pages/~ MyTickets.tsx
└── ~ format.ts                                                    # seat labels
customer-app/test/+ seats.test.tsx; ~ helpers.tsx, ~ my-tickets.test.tsx
~ README.md
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Partial unique index on valid tickets per seat | FR-009 needs a database guarantee, and FR-010 needs void tickets to free seats | A plain unique index would keep cancelled events' seats taken; a Backend-only check is not a guarantee (Constitution IV). |
| Seat label on tickets instead of a `Section` foreign key | A sold ticket must keep its seat, and void tickets must not lock a layout forever | A foreign key with `RESTRICT` blocks every later layout change at that venue. |
| Layout writes lock every scheduled event at the venue | A layout change must see current seated sales and reserved-seating flags | Locking only the venue would let a first sale or a seating switch slip in between the check and the write. |
| One seat map read for both apps | The admin and customer maps show the same facts | A second, admin-only read would duplicate the query with nothing extra to protect. |
