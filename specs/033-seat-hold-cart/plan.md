# Implementation Plan: Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends

**Branch**: `033-seat-hold-cart-spec` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#135](https://github.com/Trughouse-Holdings/QueuePass/issues/135) (supersedes #131)

**Input**: Feature specification from `specs/033-seat-hold-cart/spec.md`

## Summary

- **No new operation, field, table, or error code.** The Backend already holds one seat per
  request, adds to the active reservation with its end unchanged, and ends the reservation with its
  last seat (research "What exists").
- **Two Backend rule changes** (contract 1.25.0 in this PR, `api-schema.ts` regenerated):
  - the 2-minute wait counts from the **reservation's** end and covers every seat that left it
    unbought; a seat released while the reservation keeps others can be held again at once (R4):
    one query in `ReservationsService.assertNoWait`, and its message;
  - seat holds get **their own attempt allowance**, 30 a minute and 10 in any 5 seconds, read from
    `RATE_LIMIT_HOLD_PER_MINUTE` and `RATE_LIMIT_HOLD_PER_5_SECONDS`; buying keeps 10 and 3 (R5).
    `.env.example` and `docker-compose.yml` gain the two settings in this PR.
- **Customer app** (most of the work): `GetTickets` for seated events loses picks, Reserve seats,
  Remove, Release, Release seats, and Confirm purchase; a click queue sends one hold or release per
  click, in order (R6); other ticket types are locked while seats are held (R7); a **Your seats**
  box below the map has a large countdown, the seats, the total, and **Add to cart** (R9); every hold
  and release is announced (R10). A new **Cart** page lists the active reservations, each with its
  countdown and **Buy tickets**, one **Name on tickets** field, and live updates (R8); a **Cart**
  link in the top bar; the cart reads the reservations about once a second while visible and opens
  no seat stream (R8). General admission is unchanged.
- **Specs 007, 015, 026**: dated notes in this PR (R11).
- **Tests** (R12): Backend first (the wait's new rule on both sides, the hold pair); Customer app
  first (two new files, existing ones moved from Reserve seats to clicks and the cart); browser: one
  new file, three updated.
- **Constitution 3.9.5** (R13): roadmap row `033`, on top of 3.9.4. `032`'s implementation (in
  flight) also edits the contract and regenerates `api-schema.ts`; whichever lands second keeps both
  and reruns `check-contract-drift`.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11, Prisma 6 (Backend); React
19, Vite 6, React Router (Customer app).

**Primary Dependencies**: none new. `useSeatStream` from `@queuepass/shared/web` (unchanged, on the
event page only); `openapi-fetch` and the generated `api-schema.ts`.

**Storage**: PostgreSQL 17. **No schema change** (data-model.md): `SeatReservation.endedAt` and
`SeatHold.endReason` already say what the new wait needs; the query joins them as today's does.

**Testing**: Jest with Testcontainers PostgreSQL (Backend); Vitest with React Testing Library
(Customer app); Playwright against the `qpe2e` Compose stack (`npm run e2e`); `npm run test:tz`.

**Target Platform**: the Compose stack; path B (host-run Backend and apps) on this machine.

**Project Type**: web application: one Backend query, the attempt limits' configuration, the
Customer app's ticket flow and a new page, the contract's descriptions.

**Performance Goals**: a click answered as today's Reserve seats (one locked transaction); the cart
opens with one `listMyReservations` plus two reads per listed event (made once), then reads
`listMyReservations` about once a second while visible, never while hidden (research R8).
**Connection budget**: the cart opens no seat stream, so it holds no long-lived connection however
many events it lists or tabs show it; the event page keeps its single stream, as today. (A stream per
listed event would fill the browser's six HTTP/1.1 connections per host with three events in two
tabs, and Buy tickets would then wait.)

**Constraints**: Constitution I (contract 1.25.0 in this PR), III (two PRs; shared surface in this
one: the constitution, the contract, `api-schema.ts`, `.env.example`, `docker-compose.yml`), IV (the
wait and the limits in the Backend; the app's countdown, locks, and queue are guidance), VI (tests
first, real PostgreSQL), VII (theme tokens only; text, not color, says state), VIII (no cart table,
no new operation, no batching, no multi-event checkout, no nav countdown; each named in Out of
scope).

**Scale/Scope**: Backend: `reservations.service.ts` (one query and message),
`attempt-limits.config.ts`, `.service.ts`, `.module.ts`, `test/setup/test-app.ts`; Customer app:
`GetTickets.tsx` (rewritten seated half), `SeatPicker.tsx` (pending states), `App.tsx` (route and
link), new `pages/Cart.tsx`, `components/HoldCountdown.tsx`, `components/OrderConfirmation.tsx`,
`use-buy.ts`, `use-hold-queue.ts`, `styles.css`; tests; e2e; README.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | `reserveSeats`, `releaseSeats`, `releaseAllMyReservations`, `listMyReservations`, the attempt limits, `TooManyAttempts`, and the `seatCooldown` example described in this PR; 1.25.0; `api-schema.ts` regenerated, drift check passes; no operation or schema changes, so the app's calls compile unchanged (contracts/README.md) | Pass |
| II. One command | `docker compose up --build` unchanged; the two new settings have defaults in `docker-compose.yml` and `.env.example`, so nothing is set by hand; no new service | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row (3.9.5), independent review, fresh implementer; commits cite `033` and #135; `fixes #135` only in the implementation PR's description. Shared surface in this PR: the constitution, `contracts/openapi.yaml`, `packages/shared/src/api-schema.ts`, `.env.example`, `docker-compose.yml` (every member approves). The implementation touches no shared surface (`useSeatStream` and the theme are used as they are) | Pass |
| IV. Server-authoritative | Every hold rule is the Backend's, under the event lock, on each click (FR-019); the wait is a query under that lock (R4); the limits stay in the Backend (`026`'s accepted in-memory deviation, unchanged). The app's countdown is from `secondsLeft`; its ticket-type lock, `full` seats, and queue are guidance only | Pass |
| V. Least privilege | No role change; every operation keeps `x-required-roles: [customer]`; the cart reads only the caller's own reservations (the token's subject) | Pass |
| VI. Test-first, real database | Backend integration tests on Testcontainers PostgreSQL for the wait (both sides of the 2 minutes, to the second with the database clock as `reservations.boundaries` does) and the hold pair (genuinely concurrent requests), written first; Customer app tests first; browser tests updated, never skipped (R12) | Pass |
| VII. Shared look | `.hold-countdown` in `customer-app/src/styles.css` from theme tokens (the drift scan passes); existing `card`, `note`, `banner`, `btn` classes; held, holding, and releasing seats named in text and `aria-pressed`, not by color | Pass |
| VIII. Simplicity | The cart is a read of what exists; Add to cart is a link; one request per click; deferred and named: multi-event checkout, general admission in the cart, batching, a nav countdown, an "in cart" state | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.9.5 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/033-seat-hold-cart/
├── spec.md, plan.md, research.md (R1–R13), data-model.md, quickstart.md (S0–S11)
├── contracts/README.md          # descriptions and numbers; 1.24.0 → 1.25.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
.specify/memory/constitution.md                # 3.9.5, the 033 row (this PR)
contracts/openapi.yaml                         # 1.25.0 (this PR)
packages/shared/src/api-schema.ts              # regenerated (this PR)
.env.example, docker-compose.yml               # RATE_LIMIT_HOLD_PER_MINUTE / _PER_5_SECONDS (this PR)
specs/007-…/spec.md, specs/015-…/spec.md, research.md, specs/026-…/spec.md  # dated notes (this PR)
README.md                                      # 033 row, v3.9.5 (this PR); settings, flow, row (impl)

backend/
├── src/reservations/reservations.service.ts   # assertNoWait: from the reservation's end (R4)
├── src/attempt-limits/attempt-limits.config.ts # a pair per kind; the HOLD settings (R5)
├── src/attempt-limits/attempt-limits.service.ts # the pair by kind
└── test/
    ├── setup/test-app.ts                      # attemptLimits sets both pairs
    ├── integration/reservations.boundaries.e2e-spec.ts # the wait's cases (R4, R12)
    ├── integration/rate-limits.hold.e2e-spec.ts # the hold defaults 30 / 10
    ├── integration/rate-limits.ordinary.e2e-spec.ts # the start-up checks of the new settings
    └── unit/attempt-limits.spec.ts            # four settings

customer-app/
├── src/App.tsx                                # /cart, the Cart link
├── src/pages/Cart.tsx                         # new (R8)
├── src/components/GetTickets.tsx              # seated: clicks, Your seats, Add to cart (R6, R7, R9, R10)
├── src/components/SeatPicker.tsx              # holding / releasing seats (R6)
├── src/components/HoldCountdown.tsx           # new (R9)
├── src/components/OrderConfirmation.tsx       # moved from GetTickets (R8)
├── src/use-buy.ts                             # new: confirm()'s logic, shared (R8)
├── src/use-hold-queue.ts                      # new: the click queue (R6)
├── src/styles.css                             # .hold-countdown (R9)
└── test/                                      # seat-hold-click, cart (new); updated files (R12)

e2e/tests/033-seat-hold-cart.spec.ts           # new: 033 S1/S2/S6
e2e/tests/006-007-tickets.spec.ts, 015-seat-holds.spec.ts, 026-rate-limits.spec.ts # clicks, cart
e2e/stack/docker-compose.e2e.yml               # the hold pair, literally 30 and 10
specs/033-seat-hold-cart/quickstart.md         # Automation rows → Automated (impl)
```

**Structure Decision**: the Backend keeps its operations and changes two rules where they live; the
Customer app's seated flow is split so the event page only holds and releases, and the cart only
buys. `use-buy.ts` and `OrderConfirmation.tsx` come out of `GetTickets.tsx` so the cart buys exactly
as the event page did; general admission keeps using them on the event page.

## Order of work

1. Every test first (T002 to T009), each seen to fail: the Backend's wait and limits, the Customer
   app's click and cart tests and the updated ones, and the browser tests. The contract is already
   in place from this PR.
2. The Backend: the wait's query and message (T010), the hold pair (T011, T012), the whole suite
   (T013).
3. The Customer app: the buy hook and confirmation out of `GetTickets` (T014), the queue and seat
   states (T015, T016), the event page (T017, T018), the cart and its link (T019, T020), the whole
   suite (T021).
4. The e2e stack's settings and the browser tests (T022), the quickstart's Automation rows and the
   README (T023, T024), `npm run ci`, the three runs, review, walk, PR (T025 to T029).

## Complexity Tracking

None. `026`'s in-memory limits (a recorded deviation from Constitution IV that Mahdi accepted) are
unchanged; this feature only gives the `HOLD` kind its own numbers.
