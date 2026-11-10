# Implementation Plan: Drop Check-in Details a Week After the Event

**Branch**: `032-drop-check-ins-spec` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#129](https://github.com/Trughouse-Holdings/QueuePass/issues/129)

**Input**: Feature specification from `specs/032-drop-check-ins/spec.md`

## Summary

- **A retention job beside entry** (research R5): `backend/src/entry/check-in-retention.ts`,
  `CheckInRetention`, shaped like `HoldSweeper`, started only by `main.ts` after `listen` (never by a
  lifecycle hook, so the demo data and demo reset commands never run it): once at start and every
  hour, it finds events with `endsAt ≤ now − CHECK_IN_RETENTION_DAYS × 24 h` (the Backend's `CLOCK`,
  the bound computed in JavaScript) not yet removed and, per event under
  `lockEvent`, counts its valid admitted tickets, empties the three check-in columns on all its
  tickets, and sets `Event.checkInDetailsRemovedAt` and `Event.keptCheckedInCount`.
- **One constant** (R3): `CHECK_IN_RETENTION_DAYS = 7` in `packages/shared/src/event.ts`.
- **Schema** (data-model.md): two nullable `Event` columns and the CHECK
  `event_check_ins_removed_together`; `Ticket` unchanged (`ticket_entry_agent` already allows all
  three NULL).
- **Report keeps the count** (R4): `ReportsService.sales` reads `keptCheckedInCount` for a removed
  event (0 if cancelled) and sends `checkInDetailsRemovedAt` per event.
- **Times locked once removed** (R6): `EventsService.updateLocked` refuses a changed `startsAt`,
  `endsAt`, or `doorsOpenAt` with `409 CHECK_IN_DETAILS_REMOVED`; a venue's time-zone change, which
  moves only events without orders, is the stated exception.
- **Amends spec `030` for removed events** (R9, R10): its FR-016 (Past tickets keep their state and
  printable ticket) gives way to FR-014 here, and its "event moved later comes back" to FR-008; a dated
  note in `030`'s spec points here.
- **Admin app** (R7, R8): the sentence on Attendees, the Sales card, and Reports; Attendees' summary
  from the report's kept count; the attendee export's empty column and heading line; the edit form's
  409 banner. **Customer app** (R9): "Event over", no links, PrintTicket refuses.
- **Contract 1.24.0** (contracts/README.md), **Constitution 3.9.4** (R12): on top of spec `031`'s
  1.23.0 and 3.9.3 (branch `031-atomic-event-create-spec`, unmerged; spec `030` has merged). This branch
  is rebased onto `main` once `031` merges; the version lines, the roadmap row, the next free number, and
  the README's status table conflict until then and are resolved by keeping both.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11, Prisma 6 (Backend); React 19
with Vite 6 (Admin, Customer apps).

**Primary Dependencies**: none new. `@queuepass/shared` for the constant and types; the Backend's
`CLOCK`, `lockEvent`, `LOCKING_TX`.

**Storage**: PostgreSQL 17; one migration (data-model.md).

**Testing**: Jest with Testcontainers PostgreSQL and `FakeClock` (Backend); Vitest with React Testing
Library (Admin, Customer apps). No browser test (research R11; quickstart Automation).

**Target Platform**: the Compose stack (path A) or path B, as every feature.

**Project Type**: web application: Backend, Admin app, Customer app, shared package.

**Performance Goals**: one indexed-free query on `Event` an hour at proof-of-concept size; a removal of
an event's tickets in one `UPDATE`; details gone within 1 hour of the cutoff (SC-002).

**Constraints**: Constitution I (contract 1.24.0 in this PR, before the code), IV (the removal and
time edits serialised by the event row lock; the pair CHECK in the database), V (QueuePass keeps less:
the agent subject and username go at the cutoff), VI (tests first, real PostgreSQL, both sides of the
boundary, concurrency), VIII (one constant, no setting; no deferral).

**Scale/Scope**: one new Backend provider, one migration, changes to `ReportsService`,
`EventsService` (`updateLocked`, `toResponse`), `OrdersService.mine` (the event summary);
four Admin app files and two export builders; two Customer app pages; shared constant and types.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | `contracts/openapi.yaml` 1.24.0 in this PR: three response fields (optional until implemented), one error code with an example, the `updateEvent` rule; `api-schema.ts` regenerated; `errors.ts` in step with the enum | Pass |
| II. One command | `docker compose up --build` unchanged; the migration runs with the others; the job starts with the Backend, no new service or variable | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row (3.9.4, on top of `031`'s 3.9.3), independent review, fresh implementer; commits cite `032` and #129; `fixes #129` only in the implementation PR's description. Shared surface in this PR: the constitution, `contracts/openapi.yaml`, `packages/shared/` (every member approves); in the implementation PR: `backend/prisma/`, `packages/shared/` | Pass |
| IV. Server-authoritative | The removal and the time lock are the Backend's; both take `lockEvent` (`SELECT … FOR UPDATE`), so a removal and a time edit or cancellation never interleave; the pair CHECK guarantees count and instant together; the admit's `now() < endsAt` with the locked end keeps a removed event closed (R6). The Admin app shows the 409 and keeps the form's values | Pass |
| V. Least privilege | No role or token change. Less identity data kept: `checkedInBySub` and `checkedInByUsername` emptied at the cutoff. The count is in the admin-only report, not on `Event` (R7) | Pass |
| VI. Test-first, real database | Integration tests on Testcontainers PostgreSQL written first: both sides of the cutoff to the minute (`FakeClock`, also across a daylight-saving change), other events untouched, a second run, two removals of one event at once past the run flag, the demo commands never removing, kept counts and the report unchanged, the CHECK, the 409; Admin and Customer Vitest tests (R11) | Pass |
| VII. Shared look | New text uses existing `note` and banner styles; no new style | Pass |
| VIII. Simplicity | One constant, no setting; no per-tier counts, no trigger, no new dependency (R4, R5, R6); no deferred control | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.9.4 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/032-drop-check-ins/
├── spec.md, plan.md, research.md (R1–R12), data-model.md, quickstart.md (S0–S6)
├── contracts/README.md          # 1.24.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
.specify/memory/constitution.md                       # 3.9.4, row 032 (this PR)
README.md                                             # 032 status row, v3.9.4 (this PR); retention paragraph (impl)
contracts/openapi.yaml                                # 1.24.0 (this PR)
packages/shared/src/api-schema.ts                     # regenerated (this PR)
packages/shared/src/errors.ts                         # CHECK_IN_DETAILS_REMOVED (this PR)
packages/shared/src/event.ts                          # CHECK_IN_RETENTION_DAYS; Event.checkInDetailsRemovedAt
packages/shared/src/order.ts                          # OrderEvent / EventSales field

backend/
├── prisma/schema.prisma                              # Event: two columns
├── prisma/migrations/20261110000000_check_in_retention/migration.sql
├── src/entry/check-in-retention.ts                   # new: CheckInRetention, interval token
├── src/entry/entry.module.ts                         # provides it, interval 3_600_000
├── src/main.ts                                       # start() after listen: the only call
├── src/reports/reports.service.ts                    # kept count, checkInDetailsRemovedAt
├── src/events/events.service.ts                      # updateLocked: 409; toResponse: field
├── src/orders/orders.service.ts                      # mine(): the event summary's field
└── test/
    ├── unit/check-in-retention-start.spec.ts         # new: only main.ts calls start()
    └── integration/
        ├── check-in-retention.e2e-spec.ts            # new
        ├── check-in-retention.constraints.e2e-spec.ts # new
        └── events.check-ins-removed.e2e-spec.ts      # new
admin-app/src/
├── format.ts                                         # removedNote()
├── pages/Attendees.tsx, components/SalesCard.tsx, pages/Reports.tsx, pages/EventForm.tsx
└── export/attendee-rows.ts
admin-app/test/check-ins-removed.test.tsx             # new (pages)
admin-app/test/export/attendee-rows.test.ts, sales-rows.test.ts  # removed event
customer-app/src/pages/MyTickets.tsx, pages/PrintTicket.tsx
customer-app/test/check-ins-removed.test.tsx          # new
specs/032-drop-check-ins/quickstart.md                # Automation unchanged (all Manual)
```

**Structure Decision**: the job lives in `EntryModule` because check-in is entry's data and the module
already provides `CLOCK`; it reuses `lockEvent` like every event writer. No new module, service, or
operation.

## Complexity Tracking

None.
