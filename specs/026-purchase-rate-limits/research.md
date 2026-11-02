# Research: Purchase Rate Limits

**Feature**: `026-purchase-rate-limits` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-02

R1, R2, R5, and R6 carry the decisions Mahdi took on #56 (Clarifications, "decided by Mahdi"). Every
other decision takes the recommended option and records the alternatives, for the team to overturn
in review of the spec PR.

## R1. Where the check runs: a third global guard, on two operations

**Decision** (decided by Mahdi, items 1 and 3; FR-001, FR-003, FR-005 to FR-007, FR-009):

- A new `AttemptLimitGuard` (`backend/src/attempt-limits/attempt-limit.guard.ts`) registered as the
  **third** `APP_GUARD` in `AuthModule`, after `AuthGuard` and `RolesGuard`, so Nest runs it after
  the token and the role are checked and before any pipe, interceptor, or handler. A request it
  refuses is never validated, never reaches `OrdersService` or `ReservationsService`, and opens no
  transaction (FR-007, FR-015).
- It acts only on handlers marked with a new decorator, `@AttemptLimit('BUY' | 'HOLD')`
  (`attempt-limit.decorator.ts`, metadata key `ATTEMPT_LIMIT_KEY`), and lets every other request
  through untouched. Marked:
  - `OrdersController.create` (`createOrder`): `@AttemptLimit('BUY')`;
  - `ReservationsController.reserve` (`reserveSeats`, which both makes a hold and adds seats to one):
    `@AttemptLimit('HOLD')`.
  Not marked (FR-004): `releaseSeats`, `releaseAllMyReservations`, and every read.
- The key is the token's `sub` (`request.principal.sub`, set by `AuthGuard`) plus the kind. No
  network address (decided by Mahdi, 1). No role is skipped (decided by Mahdi, 3): both operations
  already require `customer`, so `RolesGuard` refuses every other role with `403` before this guard
  runs, and that refusal is not counted (FR-003, FR-009).
- Because guards run before the `ValidationPipe`, a malformed request counts and is then refused for
  its shape, as the spec requires (FR-003, Edge Cases). A repeated `requestId` counts; the handler
  then returns the earlier order as today (`006` FR-005).

**Rationale**: one place, ahead of every rule, for every caller of the API; the order of refusals in
FR-009 falls out of Nest's guard order (`AuthGuard` → `RolesGuard` → `AttemptLimitGuard` → pipes →
handler). A decorator mirrors `@Roles` and `@Public`, so the route-coverage test can check it against
the contract (R4, R10).

**Alternatives considered**: a check at the top of `OrdersService.create` and
`ReservationsService.reserve` (runs after the `ValidationPipe`, so malformed requests would not count,
and two copies of the same call); an Express middleware (runs before `AuthGuard`, so it has no
account); `@nestjs/throttler` (R3).

## R2. The rule: rolling windows over the handled attempts

**Decision** (decided by Mahdi, item 2; FR-002, FR-003, FR-008, FR-010): a new
`AttemptLimitsService` (`attempt-limits.service.ts`) keeps, per key `` `${sub}:${kind}` ``, the times
(milliseconds, from the injected `CLOCK`, `backend/src/common/clock.ts`) of the attempts it let
through in the last 60 seconds, oldest first. `tryAttempt(principal, kind)` runs **synchronously, with no
`await`**:

1. `now = clock.now()`. Drop the times `t` with `t <= now - 60_000` (an attempt counts in `[t, t +
   60 s)`, half-open like every window in QueuePass). Delete the key if none is left.
2. `waitMinute = times.length >= perMinute ? times[times.length - perMinute] + 60_000 - now : 0`.
3. `recent` = the times with `t > now - 5_000`; `waitBurst = recent.length >= perFiveSeconds ?
   recent[recent.length - perFiveSeconds] + 5_000 - now : 0`.
4. `wait = max(waitMinute, waitBurst)`. If `wait > 0`: refuse with `retryAfterSeconds =
   Math.ceil(wait / 1000)` (at least 1, since `wait > 0`); **record nothing** (FR-003). Otherwise
   append `now` and let the request through.

An attempt waited out exactly is let through: with 3 attempts at `t`, an attempt at `t + 5000` sees
none of them in `recent`. A refused attempt is not recorded, so `retryAfterSeconds` is exact: after
waiting it, with no other attempt of that kind, step 4 finds `wait <= 0` (SC-003). Rounding up
means an attempt 1 second before the wait ends is still refused.

**Concurrency (FR-010)**: Node runs one request's guard at a time on its single thread, and steps 1
to 4 have no `await`, so no other request can run between the check and the record. Of 20
simultaneous requests from one account, exactly the allowance left is let through, whatever order
they arrive in. The integration test sends them genuinely at once (R10).

**Rationale**: "no more than 3 in any 5 seconds" (Mahdi) is a rolling window; storing each handled
time (at most `perMinute`, 10, per key) gives it exactly, with an exact wait. Fixed windows would let
6 attempts through within a moment across a window's edge (spec Clarifications).

**Alternatives considered**: fixed windows per clock minute and per 5 seconds (bursts at edges, a wait
tied to the clock); a token bucket (refills continuously, so "10 a minute" becomes "10 at once, then
one every 6 seconds", which is not what Mahdi set, and its wait is harder to state); counting refused
attempts too (pressing early would lengthen the wait, and the wait told would be wrong).

## R3. Where the counts live: in the Backend's memory, not PostgreSQL

**Decision** (recommended, open to review; FR-015, spec Assumptions): the times live in a `Map` in
`AttemptLimitsService`, a singleton in the one Backend process. Nothing is stored in PostgreSQL;
`backend/prisma/` is unchanged.

- **Restart**: a restart (a deploy, `docker compose up --build`, a crash and Compose's
  `restart: unless-stopped`) empties the map, so every account starts with its whole allowance. A
  customer cannot cause a restart; a restart takes longer than the 5-second window; the most it gives
  is one extra minute's allowance. Accepted (spec Assumptions).
- **One Backend**: the Compose stack runs one Backend, which `015`'s seat stream already relies on
  (`backend/src/seating/seat-events.service.ts`: "The Compose stack runs one Backend, so this reaches
  every viewer; several would need Postgres `LISTEN/NOTIFY`"). Several Backends would each keep their
  own counts and multiply the allowance; they would need the counts in PostgreSQL. Not supported
  today, so this is a stated constraint, not a deferred control (Constitution VIII).
- **Memory**: at most `perMinute` numbers per key, and only for accounts that made an attempt in the
  last minute. A sweep every 60 seconds (an `unref`'d `setInterval`, cleared in `onModuleDestroy`;
  `sweepOnce()` callable by tests, as `015`'s `HoldSweeper`) deletes keys whose newest time is a
  minute old. The seed's 200 customers at 10 attempts each is under 2,000 numbers.
- **Constitution IV**: IV asks that a rule which must hold under concurrency be guaranteed by the
  database, because an application check-then-write across transactions races. This rule has no
  stored data and no transaction: its check and record are one synchronous step in the only process
  that holds the counts (R2), which no concurrent request can interleave, and the concurrency test
  proves it with genuinely concurrent requests (Constitution VI). Putting the counts in PostgreSQL
  would add a lock and a write to every attempt, including every attempt of a flood, which is exactly
  the load FR-015 keeps off the database. The plan records this in Complexity Tracking for the
  reviewers to confirm.

**Alternatives considered**:

- **A PostgreSQL table** (`AttemptLog(customerSub, kind, at)`, a transaction per attempt with
  `pg_advisory_xact_lock` on the key, count, insert, and a sweep): survives restarts and would work
  with several Backends, but costs a transaction, a lock, and a connection from Prisma's small pool
  per attempt; a flood of 1,000 attempts a second from one account would queue on that account's lock
  and hold connections other customers need. Fails "stays responsive" (FR-015).
- **Redis or another store**: a new service in the Compose stack for one feature (Constitution II,
  VIII).
- **`@nestjs/throttler`**: a new dependency whose stock storage counts from an account's first hit
  (a fixed window per key, not "any 5 seconds"), counts the blocked requests too, and answers with its
  own error, not our envelope; configuring it around those would be more code than R2's thirty lines.

## R4. The refusal: `429 RATE_LIMITED`, `Retry-After`, `details.retryAfterSeconds`

**Decision** (recommended, open to review; FR-008, FR-009; contract 1.17.0):

- Status **`429 Too Many Requests`**, code **`RATE_LIMITED`** (new; `ErrorEnvelope.code` and
  `packages/shared/src/errors.ts`'s `ERROR_CODES`, after `DOORS_OPEN_OUT_OF_RANGE`), the standard
  envelope:

  ```json
  {
    "error": {
      "code": "RATE_LIMITED",
      "message": "Too many tries. You can try again in 3 seconds.",
      "details": { "action": "HOLD", "retryAfterSeconds": 3 }
    }
  }
  ```

  `details.action` is `BUY` or `HOLD`; `details.retryAfterSeconds` an integer from 1 to 60.
- Header **`Retry-After: 3`** (RFC 9110, delay in seconds), the same number, for scripts and HTTP
  clients that honour it.
- **One message**, from a new shared helper `rateLimitMessage(seconds)` in
  `packages/shared/src/rate-limit.ts` ("Too many tries. You can try again in 1 second." / "… in 3
  seconds."), used by the Backend's message and the Customer app's countdown, so they always say the
  same thing (as `025`'s `doorsOpenRangeMessage`).
- **CORS unchanged**: the Customer app reads `details.retryAfterSeconds` from the body, which a
  browser always sees; it never reads `Retry-After`, which a cross-origin page could read only if the
  Backend listed it in `Access-Control-Expose-Headers`. The contract says so, so no other browser
  client builds on the header.
- **The contract** (contracts/README.md): a new response `TooManyAttempts` (`429`, the header, an
  example for each action); `'429'` on `createOrder` and `reserveSeats` only; a new vendor extension
  `x-attempt-limit: BUY` / `HOLD` on those two operations, so the route-coverage test can check that
  exactly those routes carry `@AttemptLimit` with the same kind (R10); an **Attempt limits**
  paragraph in `info.description`; a paragraph in each operation's description; the release
  operations' descriptions say they are never limited.
- Thrown as an `HttpException` from the guard, so `AllExceptionsFilter` passes the envelope through
  as for every other refusal; the guard sets `Retry-After` on the response before throwing.

**Rationale**: `429` is HTTP's status for this, and every client and proxy knows it; a code of its
own lets clients branch on it (Constitution I); the number in the body works in browsers without
widening CORS.

**Alternatives considered**: `409` (a business-rule conflict; a client could not tell "try later"
from "never"); only the header (unreadable cross-origin without exposing it, and the envelope rule
asks for structured details); exposing `Retry-After` through CORS and reading it in the app (a second
source for the same number); a `Retry-After` HTTP date (clock skew between Backend and client).

## R5. Configuration: two settings, defaults in the repository, no "off"

**Decision** (decided by Mahdi, item 3; FR-017, FR-018):

- **`RATE_LIMIT_PER_MINUTE`** (default `10`) and **`RATE_LIMIT_PER_5_SECONDS`** (default `3`), one
  pair for both kinds. Read once at start-up by a provider factory `ATTEMPT_LIMITS`
  (`attempt-limits.config.ts`): missing → the default; otherwise it must match `^[1-9][0-9]*$`, or the
  factory throws `Error("RATE_LIMIT_PER_MINUTE must be a whole number of at least 1, got '0'")` and
  the Backend does not start. No value turns the limits off (no `0`, no "disabled"), so there is no
  test-only bypass to guard (Constitution VIII). The window lengths, 60 and 5 seconds, are constants,
  not settings.
- **`docker-compose.yml`**, backend `environment`: `RATE_LIMIT_PER_MINUTE:
  ${RATE_LIMIT_PER_MINUTE:-10}` and `RATE_LIMIT_PER_5_SECONDS: ${RATE_LIMIT_PER_5_SECONDS:-3}`, with a
  comment (spec 026). **`.env.example`**: both, with the defaults and a line saying a demo may raise
  them and nothing may switch them off. `docker compose up --build` needs nothing set (Constitution
  II). `scripts/run-host.mjs` passes the environment through, so the code's defaults apply.
- **`e2e/stack/docker-compose.e2e.yml`**: unchanged, so the browser tests run with the defaults
  (FR-018, SC-004). A comment there says so.
- **Backend tests**: `createTestApp(options?)` (`backend/test/setup/test-app.ts`) sets both
  variables before compiling the app: to `'1000'` by default, so every existing test, including the
  concurrency tests that send 20 orders from one customer at once, runs unchanged with the check still
  on; to the given values with `createTestApp({ attemptLimits: { perMinute: 10, perFiveSeconds: 3
  } })`; or deletes them with `createTestApp({ attemptLimits: 'defaults' })`, so the code's defaults
  apply. This feature's integration tests use `'defaults'`. The values are assigned, never `??=`, so
  one test file's app never inherits another's.
- **Demo data** (`backend/src/scripts/demo-data.ts`): unchanged. It places its orders by calling
  `OrdersService.create` inside the Backend's own module at load time, not through the API, so no
  guard runs and nothing is counted; it is not a caller of the API, and it runs before any customer
  can sign in.

**Rationale**: Mahdi's "configuration rather than skipping the check": every test runs the guard. One
pair of numbers covers both kinds because Mahdi set the same numbers for both; two pairs would be a
configuration surface nobody uses (Constitution VIII).

**Alternatives considered**: a pair per kind (unused surface); configurable window lengths (the same);
`0` meaning "off" for tests (an exemption, which Mahdi ruled out); a provider override in tests only
(not configuration, and the Compose stack could not use it).

## R6. The Customer app: the message beside the disabled button, counting down

**Decision** (decided by Mahdi, item 4; recommended, open to review, for where it is shown; FR-011 to
FR-014), in `customer-app/src/components/GetTickets.tsx`:

- **State**: `waits`, a deadline per kind (`{ BUY: number | null; HOLD: number | null }`, in
  `performance.now()` milliseconds: `now + retryAfterSeconds * 1000`), and the seconds left per kind,
  ticked every 250 ms as `015`'s hold countdown is (`Math.ceil((deadline - performance.now()) /
  1000)`); at 0 the kind's deadline is cleared. A monotonic clock, so a wrong device clock changes
  nothing (Edge Cases).
- **Recognised** in `reserve()` and `confirm()` before the generic refusal: `response.status ===
  429`, `error.error.code === 'RATE_LIMITED'`, and a numeric `details.retryAfterSeconds`; anything
  else falls through to today's handling.
- **`reserve()`**: sets the `HOLD` wait; keeps `seats` (the picks), the reservation, and `notice`
  unchanged.
- **`confirm()`**: sets the `BUY` wait; returns to the phase it started from (`choosing`, or `unknown`
  for Check again; today it sets `confirming` first, so it remembers the phase it came from); **keeps
  `requestId`** (nothing was recorded, and Check again must repeat the same confirmation, FR-014);
  does not call `refresh()`.
- **Disabled**: `canConfirm` and Check again also need no `BUY` wait; `canReserve` needs no `HOLD`
  wait. Native `disabled`, as every other disabled button in the app (FR-013). Release, Release seats,
  the seat picker, and the tier and quantity controls are untouched (FR-012).
- **The message**: `rateLimitMessage(secondsLeft)` in a `p.banner.banner--error` placed directly
  above the disabled button: above **Reserve seats**; above **Confirm order**; inside **Reserved for
  you** above **Confirm purchase**; inside the unknown-outcome banner above **Check again**. The
  visible text has `aria-live="off"` (as `015`'s `role="timer"`), and a `.visually-hidden` `role="alert"`
  element next to it holds the first message only (the N at the moment of refusal) and is not changed
  by the ticks, so a screen reader hears it once (FR-013). At 0 both are removed.
- **A reload** loses the waits: the buttons are enabled, and a press before the wait ends is refused
  again with the seconds left (spec US2-6).

**Rationale**: next to the button it explains, so a customer with both kinds waiting sees which is
which; the existing banner style (Constitution VII); one announcement, as `015` does for its timer.

**Alternatives considered**: the shared `notice` banner at the top (one place for two different
countdowns, and its `role="alert"` would re-announce every tick); the countdown in the button's own
label ("Try again in 3 s": the button's accessible name would change every second, and tests and
screen readers find buttons by name); also disabling Release (Mahdi: nothing they had is lost, and
releasing is never limited, FR-004).

## R7. Interaction with `015` and `016`

**Decision** (recommended, open to review; FR-007, FR-020):

- **`015`**: a refused hold reaches no service code, so no hold is made or changed, `closeRunOut`
  does not run for it, and nothing is published to the seat stream; the account's active
  reservation keeps its seats and `expiresAt`. Holds are not extended while a customer waits
  (spec Clarifications). `streamSeatMap`, `getSeatMap`, `listMyReservations`, and both release
  operations are never limited. The 2-minute wait on a released seat (`SEAT_COOLDOWN`) is unchanged
  and independent: a hold can be refused for either, for different reasons, and the limit is checked
  first.
- **`016`**: unchanged. The ticket limit is checked only for orders the guard lets through; a
  refused order does not count against it or toward it (it creates no ticket).
- **`006`**: one order per confirmation is unchanged; the Customer app keeps the `requestId` across a
  refusal for the limit (R6).

## R8. Logging

**Decision** (recommended, open to review; FR-019): `AttemptLimitsService` keeps, per key, the time
until which it has already logged. On a refusal at `now` with no log line for this key covering
`now`, it writes one `Logger.warn` line and remembers `now + wait`:

`Attempt limit: customer <sub> (<username>) over the HOLD allowance (3 in 5 seconds); try again in 3 s.`

The window named is the one that set the wait (the larger). Further refusals during that wait write
nothing. The token is never logged (as `AuthGuard`, which logs reasons only). The username is the
token's display copy (Constitution V).

**Alternatives considered**: a line per refused request (a flood floods the logs and the disk, the
opposite of FR-015); no log (operators could not see that limits are being met); a metrics endpoint
(new surface, Constitution VIII).

## R9. Ordinary use never meets the limits

**Decision** (FR-016, SC-004): the Customer app sends one hold request per **Reserve seats** press
(however many seats), one buy request per **Confirm** or **Check again** press, and guards each with
`sending` so a double-click sends one. Releases, which a customer may press several times in a row,
are not limited (FR-004). A person reading each answer before pressing again makes far fewer than 3
presses in 5 seconds. The proof is end to end: every browser test (`006`/`007`, `015`, `016`, `017`,
`019`, `020` buy or hold) runs against the Compose stack with the defaults (R5), each with its own
customer account (`e2e/fixtures/apps.ts` `customerFor`), and must pass with no refusal for the limit
(SC-004); plus a Backend test of an ordinary sequence at a person's pace on the test clock (R10).

## R10. Testing

**Decision** (Constitution VI, written first and seen to fail):

- **Shared** (Vitest, `packages/shared/test/rate-limit.test.ts`): `rateLimitMessage(1)` → "Too many
  tries. You can try again in 1 second."; `(3)` → "… in 3 seconds."; `(60)`.
- **Backend unit** (Jest, `backend/test/unit/attempt-limits.spec.ts`, a `FakeClock`):
  - 3 attempts at `t` → the 4th at `t` refused with `retryAfterSeconds: 5`; at `t + 4001` refused with
    `1`; at `t + 4999` refused with `1`; at `t + 5000` let through;
  - 10 attempts, 3, 3, 3, 1, spaced so no 5 seconds holds 4 → the 11th at `t + 59_999` refused with
    `1`; at `t + 60_000` let through; the wait is the larger of the two windows' when both bind;
  - refused attempts are not recorded (20 refusals, then the wait, then let through);
  - kinds and accounts are separate; a key with no time left is deleted; `sweepOnce()` deletes stale
    keys and keeps live ones;
  - the log: one `warn` for the first refusal of a wait, none for the next ones, one again after the
    wait and a new refusal; no token in any line;
  - config (`attempt-limits.config.ts`): unset → 10 and 3; `'7'` → 7; `'0'`, `'-1'`, `'1.5'`, `'abc'`,
    `''`, `' 3'` → throws naming the variable.
- **Backend integration** (Jest, Testcontainers PostgreSQL, `backend/test/integration/`, every
  response validated against the contract; `createTestApp({ attemptLimits: 'defaults' })`):
  - `rate-limits.buy.e2e-spec.ts`: 20 genuinely concurrent `createOrder` from one customer for a
    general-admission event (distinct `requestId`s, plenty of tickets) → exactly 3 `201` and 17 `429
    RATE_LIMITED` with `details.action: BUY`, `retryAfterSeconds` 1–5 and `Retry-After` equal to it;
    exactly 3 orders in the database; a second customer's order at the same moment → `201`. A
    refused request does not call `OrdersService.create` (`jest.spyOn`), the only path from it to the
    database; the guard and `AttemptLimitsService` take no `PrismaService` (SC-005). Boundaries on the test clock (FR-002). Refusal order: no token → `401`, an admin token →
    `403`, neither counted (afterwards the customer still has 3); a malformed body counts (3 malformed
    `400`, then a valid order → `429`); a repeated `requestId` counts.
  - `rate-limits.hold.e2e-spec.ts`: the same for `reserveSeats` (20 concurrent holds of distinct seats
    → exactly 3 handled, 17 `429` with `action: HOLD`); a customer holding 2 seats who is then refused
    keeps them with the same `expiresAt` and no seat-stream change is published; 10 releases in one
    second all `200`; the buy allowance used up → a hold is still handled, and the other way round.
  - `rate-limits.ordinary.e2e-spec.ts`: an ordinary sequence on the test clock, one action every 2
    seconds (hold, add, release, hold, buy, then a second event's buy) → no `429` (SC-004's Backend
    half).
  - `backend/test/contract/route-coverage.e2e-spec.ts`: the routes with `@AttemptLimit(kind)` are
    exactly the operations with `x-attempt-limit: kind`, and each has a `'429'` response (R4).
  - Every other Backend test passes unchanged with `createTestApp()`'s large numbers.
- **Customer app** (Vitest, RTL, fake timers, `customer-app/test/rate-limit.test.tsx`): a `429` on
  Reserve seats → the message with N, Reserve seats disabled, picks and held seats kept, Confirm
  purchase and Release enabled; after 1 s "… 2 seconds", "1 second", then removed and enabled; one
  `role="alert"` whose text never changes; a `429` on Confirm order and on Confirm purchase → the buy
  buttons disabled, Reserve seats enabled; Check again after an unknown outcome → still unknown, the
  countdown above Check again, and the next press sends the same `requestId`; a `429` without
  `retryAfterSeconds` → today's refusal message; the hold's own countdown keeps running.
- **Browser test** (R11).

## R11. Browser test: one test, the hold countdown

**Decision** (Constitution VI, spec `022`): `e2e/tests/026-rate-limits.spec.ts`, one test, `'026 S2:
a customer over the hold limit sees a countdown and keeps their seats'`:

1. Set-up through the API (`e2e/fixtures/api.ts`): a venue with a layout, a seated event a week
   ahead, as `006-007-tickets.spec.ts` does.
2. The customer (`customerFor(testInfo, n)` with an `n` no other test uses; 13 at the time of
   writing) signs in to the event page and holds one seat with **Reserve seats**.
3. Through the same customer's API context (`apiFor`), three hold attempts that are refused for
   their own reason (the held seat again, `400`), back to back.
4. In the page, pick another seat and press **Reserve seats** at once. **Expected**: "Too many tries.
   You can try again in N seconds." (N from 1 to 5, read from the page), Reserve seats disabled, the
   first seat still under **Reserved for you**, Confirm purchase enabled.
5. Wait for the message to go (Playwright's `toBeHidden` with a 10-second timeout). **Expected**:
   Reserve seats enabled; pressing it adds the second seat.

Steps 3 and 4 make four hold attempts within a second or two, so the fourth is refused under the
default 3-in-5-seconds limit; the earlier hold of step 2 may or may not fall in the same 5 seconds,
which does not change the outcome. The test passes in any time zone (it reads no times).

The buy countdown, Check again, and the exact ticks are covered by the Customer app's tests (R10);
"ordinary customers never notice" by every other browser test on the defaults (R9).

## R12. The Automation table on the spec branch

**Decision**: as `025` R12. On this branch every row of [quickstart.md](./quickstart.md)'s table is
`Manual:` with its reason, S2 naming the test that will automate it. The implementation PR, with the
test, changes S2's row to exactly:

| Scenario | Browser test |
| --- | --- |
| S2 | Automated: `026 S2: a customer over the hold limit sees a countdown and keeps their seats`; rest Manual: the buy buttons and Check again, covered by the Customer app's tests |

## R13. Contract version and a rebase

**Decision**: contract **1.16.0 → 1.17.0** in this PR (a new code, a new response on two operations,
a new extension: a minor version, one per feature, `025` R6). `025`'s implementation PR is due to set
**1.16.1** (its required lists). Whichever merges first, this branch rebases onto `main` and keeps the
minor bump above whatever `main` has: after 1.16.1, still **1.17.0**; if another feature has taken
1.17.0, **1.18.0**, with `npm run generate:api` run again and the `info.version` line and this
paragraph's numbers updated in the rebase (tasks T001).

## R14. Constitution 3.6.3; README

**Decision**: a PATCH amendment in this PR, as `025`'s 3.6.2: the roadmap row
`026-purchase-rate-limits` (#56, depends on `006`, `015`, `016`), the next free number `027`, the Sync
Impact Report replaced, the README's version reference. The README's features table gains the `026`
row in the implementation PR, with a line under "What the system does" on the limits and the two
settings in the configuration notes (tasks T019).
