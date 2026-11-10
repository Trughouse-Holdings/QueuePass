# Implementation Plan: Hide Past Events

**Branch**: `030-hide-past-events-spec` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#133](https://github.com/Trughouse-Holdings/QueuePass/issues/133)

**Input**: Feature specification from `specs/030-hide-past-events/spec.md`

## Summary

- **One condition in the Backend's event list** (research R1): `EventsService.findAll` adds
  `endsAt > now` unless `includePast=true`, joined to the filters it already builds; the order is
  unchanged. `now` is the Backend's injectable `Clock` (spec `018`), so tests set it to the exact end
  (R2).
- **One query parameter** (R3): `ListEventsQuery.includePast`, `'true'` or `'false'`, anything else
  `400 VALIDATION_FAILED`; any signed-in caller. Contract 1.21.0 → 1.22.0 in this PR, with
  `api-schema.ts` regenerated (contracts/README.md).
- **Admin app** (R4 to R6): a **Show past events** checkbox on the Events page and the venue page, kept
  in the address as `past=1`, applied at once, kept by Clear; "past events hidden" said while off;
  an **Ended** pill on past events in both lists and on the event page; the venue form always asks for
  past events.
- **Customer app** (R6 to R8): no list code changes (the Backend leaves past events out); a past
  event's page says "This event has ended."; My tickets splits into upcoming and **Past**, with no
  entry code link under Past.
- **Ticket Booth**: unchanged (R4).
- **Tests** (R11): Backend integration first (boundary with the fake clock); Admin and Customer
  Vitest; one browser test file with two tests; existing tests on fixed past dates ask for past events
  (R10).
- **Constitution 3.9.2** (R12): roadmap row `030`, on top of 3.9.1 (spec `029`).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11, Prisma 6 (Backend); React
19, Vite 6, React Router (Admin and Customer apps).

**Primary Dependencies**: none new. `class-validator`'s `IsIn` (already a Backend dependency);
`openapi-fetch` and the generated `api-schema.ts` in the apps.

**Storage**: PostgreSQL 17. No schema change (data-model.md): `Event.endsAt` exists; the condition is a
`WHERE "endsAt" > $now` on a table of hundreds of rows. No index is added (Principle VIII; `#43` can add
one with pagination if a list ever needs it).

**Testing**: Jest with Testcontainers PostgreSQL (Backend); Vitest with React Testing Library (Admin,
Customer); Playwright against the `qpe2e` Compose stack (`npm run e2e`); `npm run test:tz` for several
Backend time zones.

**Target Platform**: the Compose stack; path B (host-run Backend and apps) on this machine.

**Project Type**: web application: the Backend's event list, two front ends, the contract.

**Performance Goals**: none new; the list stays one query.

**Constraints**: Constitution I (contract in this PR, types generated), III (two PRs), IV (the rule in
the Backend, the apps only decide whether to ask and how to label), VI (tests first, both sides of the
boundary, real PostgreSQL), VII (Ended in text, the existing pill, no new style), VIII (no new field,
no stored state, no index, no shared helper).

**Scale/Scope**: two Backend files and one module provider; one contract operation; four Admin pages
and its event API wrapper; two Customer pages; one new Backend test file and several updated; Admin and
Customer test files; one browser test file; the README.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | `listEvents` gains `includePast` and the rule in its description in this PR; 1.22.0; `api-schema.ts` regenerated, drift check passes; the apps call through the generated types (contracts/README.md) | Pass |
| II. One command | `docker compose up --build` unchanged; no new service, variable, or seed step | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row (3.9.2, on top of 3.9.1), independent review, fresh implementer; commits cite `030` and #133; `fixes #133` only in the implementation PR's description. Shared surface in the spec PR: the constitution, `contracts/openapi.yaml`, `packages/shared/src/api-schema.ts` (every member approves). The implementation PR touches no shared surface (R6: no helper in `packages/shared`) | Pass |
| IV. Server-authoritative | The past rule is decided by the Backend for every list (R1); the apps' Ended label and My tickets' sections are display, from the event's own `endsAt` | Pass |
| V. Least privilege | No role change; `listEvents` keeps `x-required-roles: []`; `includePast` exposes nothing a signed-in caller cannot already read (R3) | Pass |
| VI. Test-first, real database | Backend integration tests on Testcontainers PostgreSQL written first, the boundary on both sides with the fake clock; app tests first; one browser test file; existing date-fixed tests updated, never skipped (R10, R11) | Pass |
| VII. Shared look | The existing `pill` class for Ended; no new style, no app-defined color; text carries the state | Pass |
| VIII. Simplicity | One condition, one parameter, two one-line helpers; no stored flag, no new response field, no index, no saved preference; nothing deferred that is a control | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.9.2 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/030-hide-past-events/
├── spec.md, plan.md, research.md (R1–R12), data-model.md, quickstart.md (S0–S9)
├── contracts/README.md          # listEvents gains includePast; 1.21.0 → 1.22.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
.specify/memory/constitution.md                # 3.9.2, the 030 row (this PR)
contracts/openapi.yaml                         # includePast, 1.22.0 (this PR)
packages/shared/src/api-schema.ts              # regenerated (this PR)
README.md                                      # 030 status row, v3.9.2 (this PR); row status (impl)

backend/
├── src/common/clock.ts                        # comment: the event list reads it too
├── src/events/events.module.ts                # { provide: CLOCK, useValue: systemClock }
├── src/events/dto/list-events.query.ts        # includePast: 'true' | 'false' (R3)
├── src/events/events.service.ts               # @Inject(CLOCK); findAll's endsAt condition (R1, R2)
└── test/
    ├── integration/events.past.e2e-spec.ts    # new (R11)
    ├── integration/*.e2e-spec.ts              # list requests on fixed past dates: includePast=true (R10)
    └── unit/events.venue-moved.spec.ts        # the constructor's new argument

admin-app/
├── src/api/events.ts                          # EventFilters.includePast
├── src/format.ts                              # hasEnded (R6)
├── src/pages/EventList.tsx                    # Show past events, past=1, Ended, hidden note (R5)
├── src/pages/LocationDetail.tsx               # the same for the venue's events
├── src/pages/LocationForm.tsx                 # listEvents({ locationId, includePast: true })
├── src/pages/EventDetail.tsx                  # Ended pill
└── test/                                      # past-events.test.tsx (new), format, updated fixtures

customer-app/
├── src/format.ts                              # hasEnded (R6)
├── src/pages/EventDetail.tsx                  # "This event has ended." (R7)
├── src/pages/MyTickets.tsx                    # upcoming, then Past; no entry code under Past (R8)
└── test/                                      # past-events.test.tsx (new), my-tickets, format

e2e/tests/030-hide-past-events.spec.ts         # new: 030 S1/S2, 030 S4/S6
e2e/tests/029-demo-checkpoint.spec.ts          # GET /events?includePast=true (029 merged, R10)
specs/029-demo-checkpoint/spec.md, quickstart.md # Season Opener opened by its link (T012)
specs/030-hide-past-events/quickstart.md       # Automation rows → Automated (impl)
```

**Structure Decision**: the rule sits in the one service every list goes through, beside the filters it
combines with. The apps change only where they ask (Admin) or label (both); the Customer app's list
code and the Ticket Booth do not change at all.

## Order of work

1. Every test first (T002 to T007), each seen to fail: the Backend's, the Admin and Customer apps',
   and the browser tests. The contract is already in place from this PR.
2. The Backend: the parameter and the condition (T008, T009), then the existing tests on fixed past
   dates (T010) and the apps' fixtures (T011); the `029` browser test's request (T012).
3. The Admin app (T013 to T016), then the Customer app (T017, T018).
4. The quickstart's Automation rows and the README (T019, T020), `npm run ci`, the three runs, review,
   walk, PR (T021 to T025).

## Complexity Tracking

None.
