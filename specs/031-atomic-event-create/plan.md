# Implementation Plan: All-or-Nothing Event Scheduling

**Branch**: `031-atomic-event-create-spec` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#127](https://github.com/Trughouse-Holdings/QueuePass/issues/127)

**Input**: Feature specification from `specs/031-atomic-event-create/spec.md`

## Summary

- **`createEvent` takes the setup** (research R1, R2): optional `reservedSeating` and `tiers`
  (`EventTierInput`: name, price, quantity, `sectionIds`) in `POST /events`; without them, unchanged.
  Contract 1.22.0 → 1.23.0, on top of spec `030`'s 1.22.0.
- **One transaction** (R4): inside the existing `createLocked` (venue `FOR SHARE`, then the checks),
  seating checks after the times, the event's capacity, limit, and conflict checks as today, then each
  ticket type and their total; all checks before the first write; then the event, its ticket types,
  and its mappings. Database guarantees: `event_no_overlap`, the tier name index, `SectionTier`'s key,
  the venue lock against layout saves.
- **Refusals name their field** (R3): `tiers.<i>.<field>`, `tiers`, `reservedSeating`,
  `totalTicketCapacity`; in `details.field` on a `409`, at the start of each `details.fields` entry
  on a `400`, the format the validation pipe already writes for nested fields. No new error code.
- **The Admin form sends one request** (R5): `scheduleEvent` builds `tiers` (with `sectionIds` from
  the per-section selects) and `reservedSeating`; a refusal shows in the banner and beside the ticket
  type or group it names; every value stays; a dropped connection says it cannot tell and links to
  Events (R6). "Seating setup not finished" goes. Pictures unchanged (R8); editing unchanged (R7, to
  #134).
- **Tests** (R11): Backend integration on real PostgreSQL, every refusal leaving no rows, a failure
  after the event row, concurrency; a unit test of the planner; Admin tests; one browser test.
- **Constitution 3.9.3** (R12): roadmap row `031`, on top of `030`'s 3.9.2.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11 and Prisma 6 (Backend);
React 19 with Vite 6 (Admin app).

**Primary Dependencies**: none new. `class-validator`/`class-transformer` (`@ValidateNested`,
`@Type`, `@ArrayUnique`, `@IsUUID({ each: true })`) already used by the Backend's DTOs;
`openapi-fetch` and the generated `api-schema.ts` in the Admin app.

**Storage**: PostgreSQL 17. No schema change (data-model.md): `Event`, `TicketTier`, `SectionTier`
as they are, written in one transaction.

**Testing**: Jest with Testcontainers PostgreSQL (Backend integration, concurrency) and Jest unit
tests; Vitest with React Testing Library (Admin app); Playwright against the `qpe2e` Compose stack
(`npm run e2e`). Research R11.

**Target Platform**: the Compose stack (path A) or the database and Keycloak in Docker with the
Backend and apps on the host (path B, this machine).

**Project Type**: web application: the Backend's event scheduling, the contract, and the Admin app's
event form. No Customer app, Ticket Booth, seed, or Compose change.

**Performance Goals**: scheduling stays one round trip; a schedule with ticket types and seating
answers within the same time as today's first request plus one insert per ticket type (well under a
second at any venue size the project has).

**Constraints**: Constitution I (the contract in this PR, `info.version` raised, `api-schema.ts`
regenerated; the Admin app types the body from it), III (two PRs, independent review, fresh
implementer, commit citations), IV (the Backend enforces every rule; the database guarantees what
must hold under concurrency; the form keeps every value and shows the refusal), VI (tests first, real
PostgreSQL, concurrent requests), VII (the shared theme's existing classes), VIII (no request key, no
new operation; editing's gap named with #134).

**Scale/Scope**: one DTO changed and one new, one new helper file, one service method changed; the
event form's create path and its error placement; one Admin API function; four new test files and
the existing create tests updated; one browser test.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | `createEvent`'s request gains two optional fields and `EventTierInput`; its description gives the order of checks and the field paths; two new examples on each of its `400` and `409` responses; `info.version` 1.22.0 → 1.23.0; `api-schema.ts` regenerated with `openapi-typescript`, drift check green. Responses and error codes unchanged. The Admin app types the request from the generated schema (contracts/README.md) | Pass |
| II. One command | No Compose, seed, or environment change; `docker compose up --build` unchanged | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row (3.9.3, on top of `030`'s 3.9.2, rebased onto it), independent review, fresh implementer; commits cite `031` and #127; `fixes #127` only in the implementation PR's description. Shared surface in this PR: the constitution, the contract, `api-schema.ts` (every member approves). The implementation PR touches none (research R9) | Pass |
| IV. Server-authoritative | Every rule of `004`, `007`, `016` applied by the Backend inside the scheduling transaction; under concurrency guaranteed by `event_no_overlap`, the tier name unique index, `SectionTier`'s primary key, and the venue row lock (research R4); the form keeps every value, shows the refusal as an explicit error beside its field, and a dropped connection as its own message (FR-009 to FR-011) | Pass |
| V. Least privilege | `createEvent` stays `queuepass-admin` only; no role, token, or realm change; the route coverage test unchanged | Pass |
| VI. Test-first, real database | Integration tests on Testcontainers PostgreSQL written first: each refusal leaves no rows, a failure after the first write leaves none, two concurrent schedules save one whole event; planner unit tests; Admin tests; a browser test (research R11) | Pass |
| VII. Shared look | Messages beside fields use the theme's `field__hint` and the existing banner; no new style | Pass |
| VIII. Simplicity | Two optional fields on the existing operation; no new operation, error code, column, or dependency; no request key (research R6); editing's all-or-nothing is a known gap named with #134 (spec Out of scope; research R7); no control removed | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.9.3 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/031-atomic-event-create/
├── spec.md, plan.md, research.md (R1–R12), data-model.md, quickstart.md (S0–S10)
├── contracts/README.md          # createEvent's new fields, 1.23.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
.specify/memory/constitution.md                # 3.9.3, the 031 row (this PR)
contracts/openapi.yaml                         # 1.23.0: EventInput.reservedSeating, .tiers,
                                               # EventTierInput, createEvent text, examples (this PR)
packages/shared/src/api-schema.ts              # regenerated (this PR)
README.md                                      # 031 status row, v3.9.3 (this PR)
specs/008-customer-event-search/spec.md        # FR-018: superseded-for-scheduling note (this PR)
specs/008-customer-event-search/research.md    # R10 Create: note (this PR)
specs/014-event-images/research.md             # R9 "After creating": note (this PR)

backend/
├── src/events/dto/create-event.dto.ts         # reservedSeating?, tiers? (R9)
├── src/events/dto/event-tier.dto.ts           # new: EventTierDto extends CreateTierDto + sectionIds
├── src/events/event-setup.ts                  # new: planEventSetup (pure), writeEventSetup (R4, R9)
├── src/events/events.service.ts               # createLocked: seating checks, plan, writes (R4)
└── test/
    ├── unit/event-setup.spec.ts               # new (R11)
    └── integration/
        ├── events.create-setup.e2e-spec.ts            # new: success, refusals leave no rows,
        │                                              # failure after the first write (R11)
        └── events.create-setup.concurrency.e2e-spec.ts # new: two schedules; schedule vs layout
admin-app/
├── src/api/events.ts                          # createEvent typed by the generated EventInput (R5)
├── src/api/client.ts                          # ApiError.enveloped, set by unwrap (R5)
├── src/pages/EventForm.tsx                    # scheduleEvent: one request; fieldErrors; no-answer
│                                              # message; setupRefused removed (R5)
└── test/
    ├── event-create-atomic.test.tsx           # new (R11)
    └── (existing create-flow tests)           # updated to the one request (T007)
e2e/tests/031-atomic-event-create.spec.ts      # new: 031 S3
specs/031-atomic-event-create/quickstart.md    # Automation row S3 → Automated (impl)
```

**Structure Decision**: the setup is planned and written by the events module, beside the event
insert it must share a transaction with. `TiersService` and `SeatMapService` stay as they are for
existing events; the planner restates only the rules that apply to a new event, with the same
messages, as a pure function so each branch is unit-tested. The Admin app takes the request type from
the generated contract types, so `packages/shared` (shared surface) is not touched by the
implementation.

## Complexity Tracking

None.
