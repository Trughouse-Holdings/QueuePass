# Implementation Plan: Admin Ticket Tiers and Search

**Branch**: `004-admin-tiers-search` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-admin-tiers-search/spec.md`

## Summary

Two independent capabilities for the Admin app, both backed by the Backend:

- **Ticket tiers**: a new `TicketTier` table (one event, many tiers) with four operations under
  `/events/{id}/tiers`. The rule "tier quantities never exceed the event's ticket capacity" is
  enforced in the Backend inside a transaction that **locks the event row** (`SELECT … FOR
  UPDATE`), which is the database guarantee Constitution IV asks for. Lowering an event's
  capacity takes the same lock. Names are unique per event ignoring case, guaranteed by a unique
  index on `("eventId", lower("name"))` (research R1–R3).
- **Search**: optional `q`, `from`, `to` query parameters on `GET /events` and `q` on
  `GET /locations`, validated by query DTOs. The Admin app keeps filters in the URL (R4, R5).

The contract moves to **1.2.0** in this plan PR, with types regenerated (R6). Both changes are
additive, so the Customer app (`003`) is unaffected.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies.**

**Storage**: PostgreSQL 17. One new table and one migration ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers, every response validated against the
contract by `001`'s helper; concurrency proven with simultaneous requests. Admin app Vitest +
React Testing Library with `fetch` stubbed. Browser round trip in [quickstart.md](./quickstart.md).

**Target Platform**: Developer laptop with Docker Desktop and a desktop browser

**Project Type**: Web system: one REST API and three single-page front ends (Backend and Admin app
change)

**Constraints**: money as decimal strings end to end; route-coverage test must list the new
operations with their roles; no change to `003`'s behavior.

**Scale/Scope**: 1 table, 4 operations, 3 query parameters, 1 new Admin section, 2 filter bars

## Constitution Check

Evaluated against constitution **v2.1.0**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.2.0 and regenerated types land in this plan PR, before code (R6). One new error code, `TIER_NAME_TAKEN`, in the standard envelope. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service or configuration. The migration runs at Backend start as today. |
| **III. Spec-Driven, by PR** | PASS | **PASS** | Spec PR, this plan PR, then the implementation PR. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | Capacity rule under an event-row lock; name uniqueness by a unique index; CHECK constraints on price and quantity (R2, R3). |
| **V. Sign-In Everywhere** | PASS | **PASS** | Tier writes require `queuepass-admin`; reads any signed-in user; enforced by `@Roles` and the route-coverage test. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tier and search tests against Testcontainers PostgreSQL precede code in `tasks.md`, including a concurrent over-allocation test. |
| **VII. Function Over Finish** | PASS | **PASS** | Existing Admin CSS classes only. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No sold counts, no pagination, no full-text search. |

## Project Structure

```text
specs/004-admin-tiers-search/
├── spec.md, plan.md, research.md (R1–R7), data-model.md, quickstart.md (T1–T4), tasks.md
└── contracts/README.md

contracts/~ openapi.yaml                       # 1.2.0 (this PR)
packages/shared/src/
├── ~ api-schema.ts                             # regenerated (this PR)
├── ~ errors.ts                                 # + TIER_NAME_TAKEN
└── + tier.ts                                   # TicketTier types
backend/
├── prisma/
│   ├── ~ schema.prisma                         # + TicketTier
│   └── migrations/+ 20261001000000_ticket_tiers/migration.sql
├── src/
│   ├── tiers/+ tiers.{module,controller,service}.ts, dto/
│   ├── events/~ events.service.ts              # capacity vs tier total under lock; filters
│   ├── events/+ dto/list-events.query.ts
│   ├── locations/~ locations.{controller,service}.ts, + dto/list-locations.query.ts
│   ├── common/filters/~ prisma-exception.filter.ts  # P2002 → TIER_NAME_TAKEN
│   └── ~ app.module.ts
└── test/
    ├── setup/~ reset-db.ts
    └── integration/+ tiers.crud, tiers.capacity, tiers.authz, events.search, locations.search
admin-app/
├── src/api/+ tiers.ts, ~ events.ts, ~ locations.ts
├── src/components/+ TierSection.tsx
├── src/pages/~ EventDetail.tsx, ~ EventList.tsx, ~ LocationList.tsx
└── test/+ tiers.test.tsx, + search.test.tsx
~ README.md
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Event-row lock for tier writes and capacity edits | FR-003 must hold under concurrency (Constitution IV) | A plain check-then-insert lets two admins each add the last 200 tickets. A CHECK constraint cannot sum across rows. |
| Hand-written expression index | Case-insensitive unique names (FR-002) | Prisma's `@@unique` cannot express `lower(name)`; an application-only check races. |
