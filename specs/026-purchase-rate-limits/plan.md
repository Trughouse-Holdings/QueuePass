# Implementation Plan: Purchase Rate Limits

**Branch**: `026-purchase-rate-limits-spec` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#56](https://github.com/Trughouse-Holdings/QueuePass/issues/56)

**Input**: Feature specification from `specs/026-purchase-rate-limits/spec.md`

## Summary

- **One guard, two operations** (research R1): `AttemptLimitGuard`, the third global guard after
  `AuthGuard` and `RolesGuard`, acts on handlers marked `@AttemptLimit('BUY')` (`createOrder`) and
  `@AttemptLimit('HOLD')` (`reserveSeats`), keyed by the token's `sub`. It runs before validation and
  the handler, so every request past sign-in and the role check counts and a refused one does nothing.
- **Rolling windows in memory** (R2, R3): `AttemptLimitsService` keeps each account's handled attempt
  times for the last minute per kind and decides synchronously (no `await`, so concurrent requests
  cannot interleave): at most 10 in 60 seconds and 3 in 5 seconds; refused attempts are not recorded;
  the wait is exact, rounded up to whole seconds. Counts live in the one Backend; a restart forgets
  them; nothing in PostgreSQL.
- **The refusal** (R4): `429 RATE_LIMITED`, "Too many tries. You can try again in N seconds." (one
  shared helper), `details: { action, retryAfterSeconds }`, and `Retry-After: N`. CORS unchanged: the
  app reads the body.
- **Configuration** (R5): `RATE_LIMIT_PER_MINUTE` (10) and `RATE_LIMIT_PER_5_SECONDS` (3), in
  `docker-compose.yml` and `.env.example`; anything but a whole number of at least 1 stops the Backend;
  no "off". Backend tests default to 1000 through `createTestApp`; this feature's tests and the
  browser tests use the defaults.
- **The Customer app** (R6): the message above the disabled button, counting down every second from
  the Backend's N, announced once; buy and hold counted down separately; picks, holds, and the
  `requestId` kept.
- **Logging** (R8): one line each time an account goes over.
- **Contract 1.17.0** (R4, R13, contracts/README.md): `RATE_LIMITED`, the `TooManyAttempts` response
  on two operations, `x-attempt-limit`; `api-schema.ts` regenerated and `ERROR_CODES` updated in
  this PR.
- **Browser test** (R11): `e2e/tests/026-rate-limits.spec.ts`, one test.
- **Constitution 3.6.3** (R14): the `026` roadmap row, in this PR.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11 (Backend); React 19 and
Vite 6 (Customer app).

**Primary Dependencies**: none new. `@queuepass/shared` (the generated API types, the new
`rateLimitMessage`); Nest's `Reflector` and `APP_GUARD`; the existing `CLOCK` provider
(`backend/src/common/clock.ts`); Playwright for the browser test (`022`).

**Storage**: none. No migration; `backend/prisma/` unchanged. The counts are in the Backend's memory
(research R3; data-model.md).

**Testing**: Jest (Backend unit tests with a `FakeClock`; integration tests with Testcontainers
PostgreSQL and genuinely concurrent requests); Vitest with React Testing Library and fake timers
(Customer app, shared); Playwright against the `qpe2e` Compose stack with the default limits
(`npm run e2e`). Research R10, R11.

**Target Platform**: the Backend in the Compose stack (one instance); the Customer app in desktop
browsers and at phone width (360 px), light and dark.

**Project Type**: web application (Backend and the Customer app).

**Performance Goals**: a refusal does no database work and no `await` (FR-015); the check is a few
array operations on at most 10 numbers. Memory: at most 10 numbers per account and kind active in the
last minute.

**Constraints**: Constitution I (contract 1.17.0 in this PR, before the code), II (defaults in the
repository; nothing set by hand), IV (see Complexity Tracking), V (the account is the token's `sub`;
roles checked first), VI (tests first; boundaries to the millisecond; concurrency with genuinely
concurrent requests against real PostgreSQL; browser test), VII (theme classes only), VIII (two
settings, no "off", no new service).

**Scale/Scope**: one new Backend module (service, guard, decorator, config), two decorated handlers,
one shared helper, one Customer app component, one contract version, one browser test.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | 1.17.0 in this PR: `RATE_LIMITED`, `TooManyAttempts` (`429`, `Retry-After`) on `createOrder` and `reserveSeats`, `x-attempt-limit`, the descriptions; `api-schema.ts` regenerated; drift check passes; the route-coverage test ties `@AttemptLimit` to the contract (R4, R10); the refusal uses the standard envelope with structured details | Pass |
| II. One command | Two variables with defaults in `docker-compose.yml`, `.env.example`, and the code; no new service; the e2e stack uses the defaults (R5) | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row, independent review, fresh implementer; commits cite `026` and #56; `fixes #56` only in the implementation PR's description. Both PRs change shared surface (`.specify/memory/constitution.md`, `contracts/openapi.yaml`, `packages/shared/`; the implementation also `docker-compose.yml`, `.env.example`), so both need every team member's approval | Pass |
| IV. Server-authoritative | Enforced in the Backend for every caller before any other work; the Customer app's countdown is a convenience from the Backend's number. Not guaranteed by the database: see Complexity Tracking (R3) | Pass, with the justification below |
| V. Least privilege | Keyed by the validated token's `sub`; `AuthGuard` and `RolesGuard` run first, unchanged; no role exempt; no operation's roles change | Pass |
| VI. Test-first, browser tests | Unit, integration, Customer app, and browser tests written first and seen to fail (R10, R11); boundaries on both sides on a test clock; 20 concurrent requests per kind against Testcontainers PostgreSQL; the quickstart's Automation table marks every scenario | Pass |
| VII. Shared look | `banner banner--error`, `.visually-hidden` from the shared theme; no new style | Pass |
| VIII. Simplicity | Two settings (one pair for both kinds), fixed window lengths, no "off" and so no bypass; no new dependency or service; no deferral of a control (one Backend is a stated constraint, R3) | Pass |

Post-design: unchanged. Constitution amended to 3.6.3 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/026-purchase-rate-limits/
├── spec.md, plan.md, research.md (R1–R14), data-model.md, quickstart.md (S0–S7)
├── contracts/README.md          # 1.16.0 → 1.17.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
contracts/openapi.yaml                          # 1.17.0 (this PR)
packages/shared/src/api-schema.ts               # regenerated (this PR)
packages/shared/src/errors.ts                   # RATE_LIMITED (this PR)
.specify/memory/constitution.md                 # 3.6.3, the 026 row (this PR)

packages/shared/src/rate-limit.ts               # rateLimitMessage, RateLimitedAction (R4)
packages/shared/src/index.ts                    # exports it
packages/shared/test/rate-limit.test.ts         # new
backend/
├── src/attempt-limits/
│   ├── attempt-limits.module.ts                # provides the service and ATTEMPT_LIMITS
│   ├── attempt-limits.config.ts                # ATTEMPT_LIMITS factory: env, defaults, checks (R5)
│   ├── attempt-limits.service.ts               # tryAttempt, sweepOnce, the log (R2, R3, R8)
│   ├── attempt-limit.decorator.ts              # @AttemptLimit('BUY' | 'HOLD'), ATTEMPT_LIMIT_KEY (R1)
│   └── attempt-limit.guard.ts                  # the guard: 429, Retry-After (R1, R4)
├── src/auth/auth.module.ts                     # third APP_GUARD; imports AttemptLimitsModule
├── src/orders/orders.controller.ts             # @AttemptLimit('BUY') on create
├── src/reservations/reservations.controller.ts # @AttemptLimit('HOLD') on reserve
└── test/
    ├── setup/test-app.ts                       # options.attemptLimits; 1000 by default (R5)
    ├── unit/attempt-limits.spec.ts             # new: the rule, the log, the config
    ├── integration/rate-limits.buy.e2e-spec.ts       # new
    ├── integration/rate-limits.hold.e2e-spec.ts      # new
    ├── integration/rate-limits.ordinary.e2e-spec.ts  # new
    └── contract/route-coverage.e2e-spec.ts     # @AttemptLimit ⇔ x-attempt-limit and 429
customer-app/
├── src/components/GetTickets.tsx               # the waits, the messages, the disabled buttons (R6)
└── test/rate-limit.test.tsx                    # new
docker-compose.yml                              # backend: the two variables with defaults (R5)
.env.example                                    # the two variables, documented (R5)
e2e/
├── stack/docker-compose.e2e.yml                # a comment only: the defaults apply (R5)
└── tests/026-rate-limits.spec.ts               # new: 026 S2 (R11)
specs/026-purchase-rate-limits/quickstart.md    # Automation row S2 → Automated (R12)
README.md                                       # the 026 row, the limits, the two settings (R14)
```

The exact test file names follow what exists on the implementation branch; `tasks.md` names the ones
to extend and lets the implementer add a file where none fits.

**Structure Decision**: a module of its own, `backend/src/attempt-limits/`, because the guard serves
two other modules (orders, reservations) and belongs to neither; it is registered next to the other
global guards in `AuthModule` so their order is in one list. The message lives in the shared package
so the Backend and the Customer app say the same words. No change to `OrdersService`,
`ReservationsService`, or the database.

## Complexity Tracking

| Deviation | Why it is needed | Simpler alternative rejected because |
| --- | --- | --- |
| Principle IV asks that a rule which must hold under concurrency also be guaranteed by the database. The attempt limits are kept and decided in the Backend's memory (research R3). | The rule has no stored data and no transaction: its check and its record are one synchronous step in the only process holding the counts, so concurrent requests cannot interleave (R2); the concurrency test proves it with 20 genuinely concurrent requests per kind. Deciding a refusal without the database is what keeps QueuePass responsive while an account floods it (FR-015, the issue's last requirement). | Counts in PostgreSQL with a lock per account: a transaction, a lock, and a pooled connection for every attempt, including each one of a flood, queueing on that account's lock and taking connections other customers need; it would satisfy IV's letter by defeating FR-015. It also survives restarts, which the spec accepts losing (Assumptions). Reviewers are asked to confirm this reading in the spec PR. |
