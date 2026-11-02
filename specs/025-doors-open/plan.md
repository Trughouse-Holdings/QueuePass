# Implementation Plan: Doors Open

**Branch**: `025-doors-open-spec` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#91](https://github.com/Trughouse-Holdings/QueuePass/issues/91)

**Input**: Feature specification from `specs/025-doors-open/spec.md`

## Summary

- **A doors-open time on every event** (research R1, R2, R4–R6): `Event.doorsOpenAt timestamptz NOT
  NULL`, backfilled to `startsAt - 1 hour` by one migration, with the `event_doors_open_range` CHECK
  (6 hours before the start to the start). `EventsService` defaults it on create, keeps its gap when
  an edit moves the start without it, checks a sent one against the venue's zone (`020`) and the
  range (`400 DOORS_OPEN_OUT_OF_RANGE`, one shared message), and leaves the 60-minute rule alone
  (R3). A venue's zone change keeps its local time (R5). Responses add `doorsOpenAt` and
  `entryOpensAt`; My tickets adds `doorsOpenAt`.
- **One entry window** (R7): `[doorsOpenAt - 1 hour, endsAt)` replaces `[startsAt - 2 hours,
  endsAt)` in the one SQL `CASE`, the admit's `WHERE`, and `entryOpensAt`, through one fragment and
  one shared constant. Typed, printed, and live codes all go through it.
- **The Admin form** (R4): a required **Doors open** field before Starts, in the venue's local time,
  prefilled at the start minus 1 hour and following the start (same gap) until the admin changes it;
  the range checked before sending with the Backend's message.
- **The Ticket Booth list** (R8): events not open yet are listed greyed, "Not open yet · Opens …",
  not choosable; the list is refreshed every 30 seconds; a remembered choice is restored only when
  open.
- **Shown with the event** (R9): **Doors open** on the Customer event card, event page, My tickets,
  and printed ticket, and on the Admin event page.
- **Contract 1.16.0** (R6, contracts/README.md): new optional properties and a new code;
  `api-schema.ts` regenerated and `ERROR_CODES` updated in this PR; the implementation moves the new
  response properties into `required` (1.18.1).
- **Browser tests** (R10, R12): `e2e/tests/025-doors-open.spec.ts`, two tests; `017 S3` unchanged
  but its comment.
- **Constitution 3.6.2** (R14): the `025` roadmap row, in this PR. `017`'s and `018`'s specs and
  quickstarts get a one-line "Superseded in part by `025`" note (R13).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11 and Prisma 6 (Backend);
React 19 and Vite 6 (Admin, Customer, and Ticket Booth apps).

**Primary Dependencies**: none new. `@queuepass/shared` (`resolveLocal`, `toOffsetDateTime`,
`toLocalDateTime`, `formatEventEnd`, `formatTimeOfDay`, `formatEventTime`, `localDate`, the generated
API types); Playwright for the browser tests (`022`).

**Storage**: PostgreSQL 17; one migration (`20261102000000_doors_open`): a column, a backfill, a
CHECK (data-model.md).

**Testing**: Jest with Testcontainers PostgreSQL (Backend: migration, events, zone change, entry,
orders, demo data); Vitest with React Testing Library (Admin, Customer, Booth, shared); Playwright
against the `qpe2e` Compose stack (`npm run e2e`). Research R15.

**Target Platform**: the three web apps in desktop browsers and at phone width (360 px), light and
dark; the Backend in the Compose stack.

**Project Type**: web application (Backend and all three front ends).

**Performance Goals**: none new. One `listEvents` per Booth screen every 30 seconds while no event is
chosen (R8).

**Constraints**: Constitution I (contract 1.16.0 in this PR, before the code), IV (the range and the
window in the Backend and the database: a CHECK, and the window inside the admit's `UPDATE`), VI
(tests first; boundaries both sides; browser tests), VII (shared theme values only; the Booth's
greyed item uses theme tokens), VIII (no settings for the 1-hour and 6-hour lengths; the API keeps
`doorsOpenAt` optional rather than breaking every caller, R6).

**Scale/Scope**: one migration, two Backend services and the entry module, one shared module, five
front-end views and one form, one picker, one contract version, two browser tests.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | 1.16.0 in this PR: `Event.doorsOpenAt`, `Event.entryOpensAt`, `OrderEvent.doorsOpenAt`, optional `EventInput`/`EventUpdate.doorsOpenAt`, `DOORS_OPEN_OUT_OF_RANGE`, the window in the entry operations' descriptions; `api-schema.ts` regenerated; drift check passes; front ends use the generated types | Pass |
| II. One command | No new service or variable; the migration runs with `prisma migrate deploy` at start-up as every other; the seed and demo data are unchanged (R11) | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row, independent review, fresh implementer; commits cite `025` and #91; `fixes #91` only in the implementation PR's description. The spec PR changes shared surface (`.specify/memory/constitution.md`, `contracts/openapi.yaml`, `packages/shared/`), and the implementation PR does too (`backend/prisma/`, `packages/shared/`, the contract's 1.18.1), so both need every team member's approval | Pass |
| IV. Server-authoritative | The range is refused by the Backend with a clear message and guaranteed by a CHECK; the window is decided on the database's clock inside the admit's `UPDATE` (R7); the Booth's greying and the form's check are conveniences; every refusal is shown with values kept | Pass |
| V. Least privilege | No operation or role change: events stay `queuepass-admin` to write and any signed-in user to read; entry stays `gate-agent` | Pass |
| VI. Test-first, browser tests | Backend, shared, and front-end tests written first and seen to fail (R15); boundaries 30 seconds either side; the quickstart's Automation table marks every scenario, Automated rows added with the tests (R12) | Pass |
| VII. Shared look | `.field`, `.field__hint`, `.note`, the `dl` styles each view already uses; the Booth's `event-choice--waiting` uses theme tokens only (`012`'s drift check scans `booth-app/src`) | Pass |
| VIII. Simplicity | Fixed lengths, no settings; one column, no stored `entryOpensAt`; the API default instead of a required field (R6); demo data untouched (R11); no deferral of a control | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.6.2 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/025-doors-open/
├── spec.md, plan.md, research.md (R1–R15), data-model.md, quickstart.md (S0–S10)
├── contracts/README.md          # 1.15.0 → 1.16.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
contracts/openapi.yaml                         # 1.16.0 (this PR); 1.18.1 required lists (impl)
packages/shared/src/api-schema.ts              # regenerated (this PR, and again in the impl)
packages/shared/src/errors.ts                  # DOORS_OPEN_OUT_OF_RANGE (this PR)
.specify/memory/constitution.md                # 3.6.2, the 025 row (this PR)
specs/017-gate-check-in/{spec,quickstart}.md   # "Superseded in part by 025" (this PR)
specs/018-rotating-qr-codes/{spec,quickstart}.md   # the same (this PR)

packages/shared/src/event.ts                   # constants, doorsOpenProblem, doorsOpenRangeMessage (R2)
packages/shared/src/time-zone.ts               # formatDoorsOpen (R9)
backend/
├── prisma/schema.prisma                       # Event.doorsOpenAt
├── prisma/migrations/20261102000000_doors_open/migration.sql
├── src/events/event-time.ts                   # EventTimeField gains 'doorsOpenAt'
├── src/events/events.service.ts               # default, gap, checks, toResponse entryOpensAt
├── src/events/dto/{create,update}-event.dto.ts   # optional doorsOpenAt
├── src/locations/venue-time-zone.ts           # moveEventsToZone moves and checks doors (R5)
├── src/entry/ticket-state.ts                  # entryOpens fragment; stateCase uses it (R7)
├── src/entry/entry.service.ts                 # tryAdmit, select use it
├── src/orders/orders.service.ts               # mine(): event.doorsOpenAt
└── test/
    ├── setup/fixtures.ts                      # eventAroundNow: doorsBeforeStartSeconds
    └── integration/
        ├── migration.doors-open.e2e-spec.ts   # new: backfill, the CHECK, matches the constants
        ├── events.doors-open.e2e-spec.ts      # new: default, range, zone checks, gap, contract
        ├── venues.time-zone-change.e2e-spec.ts   # doors kept local; refusals
        ├── entry.window.e2e-spec.ts           # rewritten to doors: R7 boundaries (typed)
        ├── entry.live-boundaries.e2e-spec.ts  # the window for live codes
        ├── entry.lookup.e2e-spec.ts, entry.live-code.e2e-spec.ts, entry-key.e2e-spec.ts
        │                                      # their entryOpensAt expectations: doors - 1 hour
        ├── me-orders.e2e-spec.ts              # My tickets doorsOpenAt
        └── demo-data.e2e-spec.ts              # doors at start minus 1 hour
admin-app/
├── src/pages/EventForm.tsx                    # Doors open field, follow, checks, payload
├── src/pages/EventDetail.tsx                  # Doors open
└── test/event-doors-open.test.tsx             # new; event-form.tz.test.tsx and other form tests'
                                               # bodies gain doorsOpenAt
customer-app/
├── src/components/EventCard.tsx, src/pages/{EventDetail,MyTickets,PrintTicket}.tsx
└── test/doors-open.test.tsx                   # new
booth-app/
├── src/EventPicker.tsx                        # forTheGate, the waiting item, the messages
├── src/App.tsx                                # 30-second refresh, restore only open, refetch on Change event
├── src/styles.css                             # .event-choice--waiting (theme tokens)
└── test/event-picker.test.tsx                 # new, fake clock; app.test.tsx, check-in.test.tsx
                                               # fixtures gain entryOpensAt
e2e/
├── fixtures/api.ts                            # EventSetup.doorsOpenAt
└── tests/
    ├── 025-doors-open.spec.ts                 # new: 025 S1/S2/S6, 025 S4/S5
    └── 017-check-in.spec.ts                   # comment only
specs/025-doors-open/quickstart.md             # Automation rows S1, S2, S4–S6 → Automated (R12)
README.md                                      # the 025 row, status, check-in and Booth text (R14)
```

The exact Backend and front-end test file names follow what exists on the implementation branch;
`tasks.md` names the ones to extend and lets the implementer add a file where none fits.

**Structure Decision**: each behavior stays where it lives today: event rules in `EventsService`, the
zone change in `venue-time-zone.ts`, the window in the entry module, the message and constants in the
shared package so the Backend and the Admin form say the same thing, display in each app's existing
views. No new module or operation.

## Complexity Tracking

None.
