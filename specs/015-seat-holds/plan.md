# Implementation Plan: Seat Holds with Live Updates

**Branch**: `015-seat-holds-spec` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#27](https://github.com/Trughouse-Holdings/QueuePass/issues/27)

**Input**: Feature specification from `specs/015-seat-holds/spec.md`

## Summary

- **Storage**: `SeatReservation` (one customer's 5-minute claim on an event) and `SeatHold` (one
  row per seat, kept after it ends, with why). A partial unique index allows one live hold per
  seat; another allows one active reservation per customer per event (research R1, R2).
- **Time**: the database's clock. `expiresAt` is exactly 5 minutes after `createdAt` (a CHECK).
  Locked paths close run-out reservations first, and a 1-second sweep ends them on idle events and
  tells viewers. The sweep interval is a provider, off in tests (R3, R4).
- **Reserve**: `reserveSeats` locks the event and applies the order's seat rules, then the
  2-minute wait, then taken seats, then the 10-seat and `016` caps. All or nothing. A second call
  adds seats without changing `expiresAt` (R5, R6).
- **Order**: a seated `createOrder` must name only seats in the caller's own active reservation
  (`409 RESERVATION_REQUIRED`). Bought holds end in the transaction that issues the tickets (R7).
- **Release**: `releaseSeats` (one seat or all), `releaseAllMyReservations` (called by the
  Customer app's logout through a new `beforeLogout` hook in the shared `AuthProvider`), and
  `listMyReservations` (R8).
- **Live**: `streamSeatMap`, a Server-Sent Events stream read with `fetch` and the bearer token.
  It sends a snapshot on connect, then changes from an in-process bus published after each commit,
  and ends at token expiry (R9). The seat map gains `reserved` (R10).
- **Admin changes** (cancel, seating, layout replace, first tier on a tierless seated event) and
  sales closing end reservations without the 2-minute wait; tier and event delete remove them by
  cascade (R11).
- **Customer app**: Reserve seats, Confirm purchase, Release seats, a countdown, four seat states,
  live updates. **Admin app**: a reserved mark, counts, live updates (R13–R15).

Contract **1.9.0** lands in this spec and plan PR with types regenerated, and the two new error
codes are added to `ERROR_CODES`. The five new operations are marked `x-planned: '015'`, and the
route-coverage test (spec 014's strict rule, now on `main`) allows that until the implementation,
which must remove the markers. `main` stays green (R12).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. Nest's `@Sse()` and RxJS (already a dependency) for the
stream; `fetch` and `ReadableStream` in the browser. **No new dependencies.**

**Storage**: PostgreSQL 17. Two tables, one enum, partial unique indexes and CHECKs in one
migration ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, including 10
simultaneous reservations for one seat and a two-reader stream test on a listening app. Admin and
Customer apps Vitest + React Testing Library, with a stubbed streaming `fetch`. Browser round trip
in [quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop (one Backend container).

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: a change reaches every viewer within 2 seconds (SC-002); a run-out
reservation is seen open within 2 seconds of its end (SC-003). The sweep is one indexed query per
second when nothing has run out.

**Constraints**: no seat in two active reservations, or in one and on a valid ticket, under
concurrency (FR-009, Constitution IV); exactly 5 minutes, never extended (FR-004); no customer
identity in the seat map or stream (FR-014); tokens only in memory and in the `Authorization`
header (Constitution V); every `006`/`007`/`016` rule still holds.

**Scale/Scope**: 5 new operations; 8 changed operations (`getSeatMap`, `createOrder`,
`updateSeating`, `replaceLayout`, `createTicketTier`, `deleteTicketTier`, `cancelEvent`,
`deleteEvent`); 2 new error codes; laptop scale (200 seeded customers).

## Constitution Check

Evaluated against constitution **v3.0.1**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.9.0 and regenerated types in this PR, before any code. Every new operation declares its request, response, role and errors. New codes use the standard envelope and are in `ERROR_CODES`. The `x-planned` marker (R12) keeps the route-coverage test meaningful. **SSE and "REST over HTTP/JSON"**: the stream is a plain HTTP `GET` in the contract, and each event's `data` is JSON; `x-sse-events` names the schema of each event, so T028 validates payloads from the operation. `seat-stream.ts` can't use `openapi-fetch` (it doesn't read streams), so it takes its path from the generated `paths` and its payload types from `components['schemas']`: still typed by the contract, not hand-written (see Complexity Tracking). |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, or dependency. One migration applied by the existing startup. The sweep runs inside the Backend. |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #27; spec, clarifications, and plan on `015-seat-holds-spec`, reviewed by a second Claude session before the PR; implementation on `015-seat-holds-impl` in a fresh session, closing #27. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | `seat_hold_one_live_per_seat` (partial unique index) and the event `FOR UPDATE` lock guarantee FR-009; the 5 minutes are a CHECK and the database clock; seated orders require a reservation on the server (R7). The countdown and live states are guidance only, and every refusal is shown with the picks kept. |
| **V. Sign-In Everywhere** | PASS | **PASS** | Reservation operations are `customer` only and act on the caller alone; the stream needs a valid token like the seat map, is sent with the `Authorization` header (not a URL or storage), and ends at token expiry. Logout releases reservations before ending the session. No identity in the stream. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in `tasks.md`; the guarantee is tested with 10 genuinely simultaneous requests; both 5-minute and 2-minute boundaries tested on each side; the stream tested over real HTTP. The 80% floor is a recorded deferral until `010` and `011`; this feature reports its coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | Two seat styles in the Customer app's own stylesheet, using theme values only, and existing `note`/`banner` classes. Text marks (`R`, `◩`) and spoken labels, not color alone. No new theme value. |
| **VIII. Staged Simplicity** | PASS | **PASS** | Fixed 5- and 2-minute values; an in-process bus for the one Backend instance (R9 names `LISTEN/NOTIFY` as the path to several); no admin overrides, waiting lists, or general-admission holds (spec Out of Scope). No security or correctness control is deferred. |

## Project Structure

```text
specs/015-seat-holds/
├── spec.md, plan.md, research.md (R1–R16), data-model.md, quickstart.md (S0–S11), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                                     # 1.9.0, x-planned, x-sse-events (this PR)
packages/shared/src/~ api-schema.ts                          # regenerated (this PR)
packages/shared/src/~ errors.ts                              # SEAT_COOLDOWN, RESERVATION_REQUIRED (this PR)

# Implementation PR:
packages/shared/src/
├── ~ seating.ts                      # SeatMapSection.reserved (required), Reservation, SeatMapChange, …
└── web/~ auth-provider.tsx           # beforeLogout (R8)
    web/+ seat-stream.ts, + use-seat-stream.ts               # fetch-based SSE client and hook (R9)
backend/
├── prisma/~ schema.prisma, migrations/+ <timestamp>_seat_holds/migration.sql
├── src/
│   ├── reservations/+ reservations.module.ts, + reservations.controller.ts,
│   │                + me-reservations.controller.ts, + reservations.service.ts,
│   │                + hold-sweeper.ts, + dto/reservation-input.dto.ts, + dto/reservation-release.dto.ts
│   ├── seating/+ seat-events.service.ts                     # the bus (R9)
│   │          + seat-rules.ts                               # seat resolution shared with orders (R5)
│   │          + seat-stream.controller.ts                   # streamSeatMap
│   │          ~ seat-map.service.ts                         # reserved (R10); seating changes end holds (R11)
│   │          ~ layout.service.ts                           # replace ends holds (R11)
│   ├── orders/~ orders.service.ts                           # reservation required (R7)
│   ├── events/~ events.service.ts                           # cancel ends holds; delete locks, ends streams (R11)
│   ├── tiers/~ tiers.service.ts                             # first tier ends holds; delete publishes (R11)
│   └── ~ app.module.ts                                      # HOLD_SWEEP_INTERVAL_MS provider (R4)
└── test/
    ├── integration/+ reservations.e2e-spec.ts, + reservations.boundaries.e2e-spec.ts,
    │               + reservations.concurrency.e2e-spec.ts, + reservations.admin-changes.e2e-spec.ts,
    │               + orders.reservation.e2e-spec.ts, + seat-stream.e2e-spec.ts,
    │               + seat-holds.constraints.e2e-spec.ts;
    │               ~ seated order tests from 007 and 016 (reserve first)
    ├── contract/~ route-coverage.e2e-spec.ts                # no x-planned left
    │            ~ expect-to-match-contract.ts               # expectSseEvent() from x-sse-events
    └── setup/~ fixtures.ts, ~ test-app.ts                   # reserveThenOrder(); sweeper off
admin-app/src/components/~ SeatGrid.tsx, ~ SeatingCard.tsx
admin-app/test/+ seat-holds.test.tsx
customer-app/src/~ main.tsx (beforeLogout), components/~ GetTickets.tsx, ~ SeatPicker.tsx, ~ styles.css
customer-app/test/+ seat-holds.test.tsx, + seat-stream.test.tsx; ~ helpers.tsx
packages/shared/test/web/+ seat-stream.test.ts
~ README.md
```

**Structure Decision**: the existing monorepo layout. Reservations get their own Backend module,
since they have their own routes and lifecycle. The seat rules, the bus and the stream sit in
`seating/`, next to the seat map they extend.

## Merging with other PRs

All three PRs this plan first named are merged: #33 (012) and #34 (013) on 2026-10-12, and #35
(014) on 2026-10-13. The branch is rebased onto `main` with all three.

- **#35 (014)** merged first and took contract 1.8.0, so this feature is **1.9.0**. The rebase kept
  014's feature-neutral "Planned operations" paragraph and its strict `x-planned` rule in
  `route-coverage.e2e-spec.ts` (this branch's own change to that test is gone), added 015's "Live
  streams" paragraph and tag description, merged both features' `ErrorEnvelope` codes, and
  regenerated `api-schema.ts`.
- **#33 (012)**: the drift check applies now. The new seat styles use theme values only (R15).
- **#34 (013)**: `us-states.spec.ts` checks `ERROR_CODES` against the contract, so the two new
  codes are added to `errors.ts` in this PR.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `x-planned` on contract operations | Constitution I needs the contract on `main` before code; Principle III needs `main` green; the route-coverage test fails on any unimplemented operation (R12) | Spec 014 made the same change to the route-coverage test and merged first, so this PR now only uses it. A contract fragment merged later breaks Constitution I; stub routes put code in a spec PR. |
| A Server-Sent Events stream read with `fetch`, outside the stack table's "REST over HTTP/JSON" | FR-010 needs updates within 2 seconds without a refresh, and `EventSource` can't send the bearer token (R9). The stream is still a plain HTTP `GET` with JSON `data`, declared in the contract with `x-sse-events`, and the client is typed from the generated schema | Polling meets 2 seconds only by every viewer polling every second forever; WebSockets add a protocol, an auth handshake, and a dependency. A PATCH clarification to the constitution's stack table ("REST over HTTP/JSON, including `text/event-stream` responses whose events carry JSON") is proposed if reviewers prefer it written there. |
| A background sweep in the Backend | Viewers must see a run-out reservation open within 2 seconds even when no one else acts (SC-003, R4). Its interval is a provider, `0` (off) in the test app, so tests call `sweepOnce()` and stay deterministic | Without it, rules stay correct (closing under the lock), but nobody would be told when 5 minutes run out. |
| Ended hold rows kept, with a reason | The 2-minute wait is per customer and seat, from when their hold ended (FR-004a, R6) | Deleting ended rows loses that; a separate cooldown table records the same fact twice. |
