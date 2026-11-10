# Implementation Plan: Sell Tickets Until the Event Ends

**Branch**: `034-sell-until-end-spec` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#126](https://github.com/Trughouse-Holdings/QueuePass/issues/126)

**Input**: Feature specification from `specs/034-sell-until-end/spec.md`

## Summary

- **One instant moves in the Backend** (research R1): the order check (`orders.service.ts`), the
  reservation check (`salesClosed()` in `reservations.service.ts`), the hold sweep
  (`hold-sweeper.ts`), and availability (`availability.service.ts`) compare the current time with
  `endsAt` instead of `startsAt`, each with the clock it reads today; `LockedEvent` carries `endsAt`
  in place of `startsAt`. The refusal says "Sales for {event} closed when it ended."
- **Availability** (R2): `salesClosed` says `ENDED` in place of `STARTED`, and a new `inProgress`
  says the event is between its start and its end, in the same answer. Contract 1.25.0 → 1.26.0 in
  this PR (`STARTED` kept and `inProgress` optional until the implementation tightens both, as PR
  #151 proposes for `032`), with `api-schema.ts` regenerated and `packages/shared/src/order.ts`
  widened so the apps still build (contracts/README.md).
- **Holds** (R3): end at the event's end through the sweep; `expiresAt` unchanged.
- **Customer app** (R4, R5): the Get tickets panel shows the "already started" notice at its top
  from `inProgress`, with only its first sentence when the customer cannot buy, and "Sales closed:
  this event has ended." once ended; once availability has loaded, the page's `030` "This event has
  ended." line follows it rather than the browser's clock (FR-017); the confirmation of an order
  placed after the start says so; one helper in `format.ts` builds the text, times in the venue's
  zone.
- **Unchanged** (R6, R7): the Ticket Booth, lists, My tickets, Add to calendar, the Admin app, reports,
  exports, the per-customer and attempt limits, the demo data's events.
- **Tests** (R11): Backend integration first, both sides of the end; Customer Vitest; one browser test;
  existing tests that assume a close at the start updated (R8).
- **Constitution 3.9.6** (R12): roadmap row `034`, on top of `033`'s 3.9.5, merged to `main` as
  `17b3b88`. `033`'s implementation (branch `033-seat-hold-cart-impl`) is in flight and reworks
  `GetTickets.tsx` and the reservation code; this branch was rebased onto `main` after `033`'s spec
  merged, and the implementation is expected to follow `033`'s (R10).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11, Prisma 6 (Backend); React
19, Vite 6 (Customer app).

**Primary Dependencies**: none new. `formatEventEnd` from `@queuepass/shared` (spec `020`) for the
notice's times; `openapi-fetch` and the generated `api-schema.ts` in the apps.

**Storage**: PostgreSQL 17. No schema change (data-model.md). The sweep's query compares
`Event."endsAt"` where it compared `"startsAt"`; the index `seat_reservation_open_by_expiry` serves it as
before.

**Testing**: Jest with Testcontainers PostgreSQL (Backend); Vitest with React Testing Library
(Customer app); Playwright against the `qpe2e` Compose stack (`npm run e2e`); `npm run test:tz` for
several time zones (the notice's times).

**Target Platform**: the Compose stack; path B (host-run Backend and apps) on this machine.

**Project Type**: web application: four Backend files, the Customer app, the contract and shared types.

**Performance Goals**: none new; availability stays one query plus a count, the sweep one indexed query
a second.

**Constraints**: Constitution I (contract and shared types in this PR, tightened in the
implementation), III (two PRs), IV (the Backend decides sales and "in progress"; the app shows them), VI
(tests first, both sides of the end, real PostgreSQL), VII (a plain paragraph, the existing badge and
classes, no new style), VIII (no new setting, no stored state, each path keeps its clock), "Time"
(half-open at `endsAt`, UTC instants, venue-zone display).

**Scale/Scope**: Backend `orders.service.ts`, `reservations.service.ts`, `hold-sweeper.ts`,
`availability.service.ts`, `common/event-lock.ts`; the demo data's comment; Customer
`GetTickets.tsx` (or, after `033`, `GetTickets.tsx` and `OrderConfirmation.tsx`), `EventDetail.tsx`,
and `format.ts`; `packages/shared/src/order.ts`; six Backend test files, two or three Customer test
files, one new browser test and one updated; the README.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | `createOrder`, `reserveSeats`, `getEventAvailability`, `Availability`, the example, and a Sales window paragraph change in this PR; 1.26.0; `api-schema.ts` regenerated, drift check passes; `order.ts` widened so the apps build against it; the implementation removes `STARTED` and requires `inProgress` at 1.26.0, as PR #151 proposes for `032`; acceptable because the contract approved here already announces that final shape (contracts/README.md) | Pass |
| II. One command | `docker compose up --build` unchanged; no new service, variable, or seed step | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row (3.9.6, on top of 3.9.5, `033` merged), independent review, fresh implementer; commits cite `034` and #126; `fixes #126` only in the implementation PR's description. Shared surface in the spec PR: the constitution, `contracts/openapi.yaml`, `packages/shared/src/api-schema.ts`, `packages/shared/src/order.ts`; in the implementation PR: the contract's tightening, `api-schema.ts`, `order.ts` (every member approves each) | Pass |
| IV. Server-authoritative | Sales open or closed, and in progress, are decided by the Backend under the event lock (orders, holds) and in availability; the sweep ends holds in the database; the app only shows `salesClosed` and `inProgress` and the order's and event's own instants | Pass |
| V. Least privilege | No role or endpoint change | Pass |
| VI. Test-first, real database | Backend integration tests on Testcontainers PostgreSQL first: an order and a hold a few seconds before the end succeed (T002, T003), the end just reached and after it refused, holds kept past the start and swept at the end, availability on each side, a late ticket admitted; Customer tests first, including the page's ended line following availability against a fast browser clock (T007); one browser test buys after the start; existing tests changed, never skipped (R8, R11) | Pass |
| VII. Shared look | The notice is a plain paragraph with the theme's existing note style; the existing `pill pill--danger` badge; no new style or color | Pass |
| VIII. Simplicity | One instant changes; one boolean added; no configurable offset, no stored state, no new endpoint, no capped `expiresAt`; nothing deferred that is a control | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.9.6 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/034-sell-until-end/
├── spec.md, plan.md, research.md (R1–R12), data-model.md, quickstart.md (S0–S8)
├── contracts/README.md          # salesClosed ENDED, inProgress, the sales window; 1.25.0 → 1.26.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
.specify/memory/constitution.md                # 3.9.6, the 034 row (this PR)
contracts/openapi.yaml                         # 1.26.0 (this PR); STARTED out, inProgress required (impl)
packages/shared/src/api-schema.ts              # regenerated (this PR and impl)
packages/shared/src/order.ts                   # widened (this PR); narrowed (impl)
README.md                                      # 034 status row, v3.9.6 (this PR); Getting tickets text, row status (impl)
specs/006-…/spec.md, 015-…/spec.md,
specs/030-…/spec.md, 033-…/spec.md            # dated notes (this PR)

backend/
├── src/common/event-lock.ts                   # LockedEvent.endsAt in place of startsAt (R1)
├── src/orders/orders.service.ts               # now >= endsAt → SALES_CLOSED "closed when it ended"
├── src/reservations/reservations.service.ts   # salesClosed(): now() >= "endsAt"; the message
├── src/reservations/hold-sweeper.ts           # e."endsAt" <= now(); comments (R3)
├── src/events/availability.service.ts         # ENDED, inProgress (R2)
├── src/scripts/demo-data.ts                   # Season Opener's comment (R8)
└── test/integration/                          # orders.sales-closed, reservations, reservations.admin-changes,
                                               # availability, entry (late ticket admitted) (R11)

customer-app/
├── src/format.ts                              # startedNotice(…) (R4, R5)
├── src/components/GetTickets.tsx              # the notice, ENDED's closed message, reports availability (R4)
├── src/pages/EventDetail.tsx                  # "This event has ended." follows availability once loaded (FR-017)
├── src/components/OrderConfirmation.tsx       # after 033's impl; else Confirmation in GetTickets.tsx (R5)
└── test/                                      # started-notice.test.tsx (new), purchase-unavailable, format

e2e/tests/034-sell-until-end.spec.ts           # new: 034 S1/S2
e2e/tests/029-demo-checkpoint.spec.ts          # "Sales closed: this event has ended." (R8)
specs/034-sell-until-end/quickstart.md         # Automation rows → Automated (impl)
```

**Structure Decision**: each rule stays in the file that enforces it today, with only its instant
changed; the one new fact (`inProgress`) is computed beside `salesClosed`, in the one read the panel
already makes. The notice's text lives in one Customer helper used by the panel and the confirmation.

## Order of work

1. Every test first (T002 to T008), each seen to fail: the Backend's, the Customer app's, and the
   browser test. The contract is already in place from this PR.
2. The Backend (T009 to T013): the lock's `endsAt`, the order check, the reservation check and the
   sweep, availability, the demo comment.
3. The contract's tightening and shared types (T014).
4. The Customer app (T015 to T017).
5. The `029` browser test, the quickstart's Automation rows, the README (T018 to T020); `npm run ci`, the
   three runs, review, walk, PR (T021 to T025).

## Complexity Tracking

None.
