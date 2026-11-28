# Implementation Plan: Season Setup (Admin Side) and the Shared Season Contract

**Branch**: `041-season-setup-spec` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#192](https://github.com/Trughouse-Holdings/QueuePass/issues/192)

**Input**: Feature specification from `specs/041-season-setup/spec.md`; the Season Pass proposal
(Nate and Mahdi); Nate's decisions of 2026-11-27 (presale window, even split, the shared contract
in this PR).

## Summary

- **Shared contract, in this spec PR** (research R1, R7, R14): one migration adds `Season`,
  `SeasonEvent`, `SeasonPrice`, `SeasonPass`, `SeasonPassHold`, `Order.seasonPassId` and
  `SeatReservation.passHoldId`, with every single-row rule as a CHECK and "an event in one Season"
  as a primary key; contract **2.2.0** declares 041's seven operations (`x-planned: '041'`) and
  042's six (`x-planned: '042'`), the new fields on `Event`, `Order`, `EventSales` and the report
  totals (optional until the implementation), and eight error codes; the fixture
  `seasonWithSoldPass` gives both specs a Season with 3 events, prices and one sold pass split as
  R6 says. `npm test` stays green with nothing served.
- **Backend** (R2–R6, R9, R10, R16): a `seasons` module (controller, service, DTOs) with the lock
  order venue share → Season → events in id order; create, update (whole Season, all or nothing),
  delete a draft, publish, cancel (refund every pass in one step); reads for everyone (customers see
  Seasons on sale); `Event.season` and `Event.singleSalesOpenAt` on every event read; the event and
  ticket-type locks (`EVENT_IN_SEASON`); pass figures in the sales report and the pass on each
  order.
- **Admin app** (R11): a Seasons page (list, new, edit with Put on sale, Cancel, Delete), the form's
  pure checks in `season-form-checks.ts`, the event form's Season notice and lock, Pass columns in
  Reports and Attendees and their exports.
- **Rust Admin app** (R12): the same, in `core` (ops, `forms/season.rs`, page logic, export rows)
  and `app` (views, routes, nav); S11's route list gains the Seasons routes.
- **Demo data** (R13): three men's basketball games and the "Louisville Cardinals Basketball
  2026–27" Season on sale with a presale, through the services.
- **Constitution 3.12.1** (R15): roadmap rows `041` and `042`; next free `043`.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11, Prisma 6 (Backend);
React 19, Vite 6 (Admin app); Rust stable with Leptos (Rust Admin app, `037`).

**Primary Dependencies**: none new.

**Storage**: PostgreSQL 17. Five new tables, two new columns, one replaced partial unique index
(`seat_reservation_one_active`, now per kind), in one hand-checked migration
(`20261127120000_seasons`, data-model.md).

**Testing**: Jest with a real PostgreSQL per run (Testcontainers) for the Backend; Vitest and
Testing Library for the Admin app; `cargo test` / `cargo llvm-cov` (80% lines) for the Rust core;
Playwright for browser tests (`022`), `@admin` tests run against both Admin apps.

**Target Platform**: Docker Compose locally; GitHub Actions CI.

**Project Type**: web application (Backend + several front ends, one repository).

**Performance Goals**: a Season of up to 50 events saves, publishes or cancels in one transaction
within `LOCKING_TX` (15 s); in practice under a second for 16 events.

**Constraints**: React and Rust Admin pages match box for box (S11, 1280 and 375 px); every refusal
names its field (`031`); times in the venue's zone (`020`); 042's files untouched (proposal's
parallel rules): the hold service, customer controllers, `customer-app/`, `customer-rust-app/`.

**Scale/Scope**: 7 operations served, 6 declared for 042; 2 Admin apps × (1 list, 1 form) plus
report, attendee and event-form changes; one demo Season.

## Constitution Check

*Gate: before Phase 0 and again after Phase 1.*

| Principle / rule | Status | How |
|---|---|---|
| I. API only, contract first | ✅ | Every operation, field and code is in `openapi.yaml` 2.2.0 in this PR, marked planned until served (R3, R14). Both Admin apps call the API only. |
| II. One command, reproducible | ✅ | The migration runs with `docker compose up --build`; the demo reset loads the Season (R13). No new service. |
| III. Two PRs, reviews, citations | ⚠️ deviation | Two PRs (`041-season-setup-spec`, `041-season-setup-impl`), one independent review each, a fresh implementer, commits citing `041` and `#192`. The spec PR also carries the migration and the test fixture (Complexity Tracking). |
| IV. Server-authoritative, database-guaranteed | ✅ | One Season per event is a primary key; single-row rules are CHECKs; FR-005 and FR-007 serialize on row locks in one order (R1, R2). Form checks are previews; refusals shown beside fields, values kept. |
| V. Sign-in, least privilege | ✅ | Writes `queuepass-admin` only; reads any signed-in role, customers see only Seasons on sale (R3); the route-coverage test checks the roles. |
| VI. Test-first, real database, 80% | ✅ | Constraint tests and the fixture in this PR; Backend tests for every rule and both races, React and Rust form tests, a browser test, before each piece of code (tasks). |
| VII. One shared look | ✅ | Existing theme classes; the Rust app reuses `admin-app/src/styles.css` class names (R12). |
| VIII. YAGNI | ✅ | No pass-only sections, no adding events after a sale, no late prices, no Seasons section in the report (R8). 042's model is the minimum it needs (R7). |
| Roadmap | ✅ | Rows `041-season-setup` and `042-season-pass-purchase` reserved here (3.12.1); next free `043` (R15). |
| Shared-surface approval | ⚠️ | `constitution.md`, `openapi.yaml`, `backend/prisma/` and `packages/shared/` change: every team member approves this PR. |

**Result**: passes, with the Principle III deviation justified below.

**Re-check after Phase 1**: unchanged. The data model adds no rule an application-only check
carries under concurrency (R2), and no role.

## Project Structure

### Documentation (this feature)

```text
specs/041-season-setup/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R16
├── data-model.md         # tables, CHECKs, indexes, derived values
├── quickstart.md         # S0–S11 and the Automation table
├── contracts/README.md   # 2.1.0 → 2.2.0: operations, schemas, codes
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── prisma/schema.prisma                                   # spec PR: Season models (R1, R7)
├── prisma/migrations/20261127120000_seasons/migration.sql # spec PR
├── src/seasons/                                           # impl: module, controller, service, DTOs, season-rules.ts
├── src/events/events.service.ts, event-setup.ts           # impl: Event.season, singleSalesOpenAt, EVENT_IN_SEASON (R5, R9)
├── src/tiers/tiers.service.ts                             # impl: priced ticket type names locked (R9)
├── src/orders/ (serializer only)                          # impl: Order.seasonPass (R8); not the purchase paths (042)
├── src/reports/reports.service.ts                         # impl: pass figures (R8)
├── src/scripts/demo-data.ts                               # impl: demo Season (R13)
└── test/
    ├── setup/season-fixtures.ts, reset-db.ts              # spec PR: the shared fixture (R14)
    ├── integration/seasons.constraints.e2e-spec.ts        # spec PR
    └── integration/seasons*.e2e-spec.ts                   # impl
contracts/openapi.yaml                                      # spec PR: 2.2.0
packages/shared/src/{api-schema.ts,errors.ts}               # spec PR
admin-app/src/
├── App.tsx                                                 # impl: routes, nav
├── api/seasons.ts                                          # impl
├── pages/Seasons.tsx, SeasonForm.tsx, season-form-checks.ts # impl (R11)
├── pages/EventForm.tsx, Reports.tsx, Attendees.tsx         # impl: Season lock; Pass columns
└── export/sales-rows.ts, attendee-rows.ts                  # impl: Pass columns
admin-rust-app/
├── core/src/api/client.rs, forms/season.rs, forms/event.rs # impl (R12)
├── core/src/pages/seasons.rs, pages/attendees_reports.rs   # impl
├── core/src/export/rows.rs                                 # impl
└── app/src/{routes.rs,shell.rs,pages/seasons.rs,pages/season_form.rs} # impl
e2e/tests/041-season-setup.spec.ts, 037-rust-admin-app.spec.ts # impl: browser test; S11 routes
.specify/memory/constitution.md                             # spec PR: 3.12.1
```

**Structure Decision**: the existing web-application layout; one new Backend module, two new
pages per Admin app. Nothing in `customer-app/`, `customer-rust-app/`, `booth-app/`, the hold
service, or the customer purchase paths.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Principle III: the spec PR carries a migration, `schema.prisma`, and test code (the fixture and its constraint test), not only the data model in prose and the OpenAPI changes | Nate's decision (2026-11-27): the proposal's shared contract (models, migration, fixture) merges first so `042` can be built in parallel against real tables and a real sold pass, without waiting for 041's implementation | A separate contract PR (#191, closed at Nate's request); or the model in prose only, which leaves 042 unable to run a test until 041's implementation merges, and two specs writing the same migration |
