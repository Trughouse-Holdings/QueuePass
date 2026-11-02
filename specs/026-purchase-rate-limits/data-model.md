# Data Model: Purchase Rate Limits

**Feature**: `026-purchase-rate-limits` | **Spec**: [spec.md](./spec.md)

**No new tables, columns, constraints, or migrations.** `backend/prisma/` is unchanged. The attempt
counts are kept in the Backend's memory and forgotten on a restart (research R3; spec Assumptions).

## In memory (`AttemptLimitsService`)

| Name | Shape | Rule |
| --- | --- | --- |
| attempts | `Map<string, number[]>`, key `` `${sub}:${kind}` ``, `kind` `BUY` or `HOLD` | The `ATTEMPT_CLOCK` times (ms, monotonic `performance.now()`, research R2) of the attempts let through, oldest first; only those with `t > now - 60_000`; at most `perMinute` (research R2). A key with none left is deleted. |
| loggedUntil | `Map<string, number>`, same key | The end of the wait already logged for this key; a refusal before it writes no log line (research R8). Deleted with its key. |

Swept every 60 seconds (`sweepOnce()`): every key whose newest time is `<= now - 60_000` is deleted
with its `loggedUntil` (research R3).

## The rule (`tryAttempt(sub, kind)`, synchronous)

| Step | What |
| --- | --- |
| 1 | `now = attemptClock.now()`; drop times `<= now - 60_000`, and any `> now` (a guard; impossible on a monotonic clock) |
| 2 | `waitMinute = len >= perMinute ? times[len - perMinute] + 60_000 - now : 0` |
| 3 | `recent = times > now - 5_000`; `waitBurst = recent.length >= perFiveSeconds ? recent[recent.length - perFiveSeconds] + 5_000 - now : 0` |
| 4 | `wait = min(60_000, max(...))`; `> 0` → refused, `retryAfterSeconds = ceil(wait / 1000)` (1–60), nothing recorded; else append `now`, let through |

Each comparison and wait is computed from the age `now - t`, not as `t + window - now`: the clock's
milliseconds are fractional, and the sum can land a hair over the window and round up a second too
many (research R2, "Computed as ages").

## Configuration (`ATTEMPT_LIMITS`, read once at start-up)

| Variable | Default | Valid | Meaning |
| --- | --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | `10` | `^[1-9][0-9]*$` | Attempts of one kind an account may have handled in any 60 seconds |
| `RATE_LIMIT_PER_5_SECONDS` | `3` | `^[1-9][0-9]*$` | The same, in any 5 seconds |

Anything else, or a per-5-seconds value above the per-minute value, stops the Backend at start-up
with the variable's name in the error. The same pair
applies to `BUY` and `HOLD`, each counted separately. Window lengths (60 s, 5 s) are constants.

| Where | `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_5_SECONDS` |
| --- | --- |
| `docker-compose.yml` | `${…:-10}` / `${…:-3}` |
| `e2e/stack/docker-compose.e2e.yml` (`npm run e2e`'s `qpe2e` stack) | `'10'` / `'3'`, literal, so a developer's `.env` cannot change them |
| `.env.example` | `10` / `3` |
| `scripts/run-host.mjs` | not set: the code's defaults |
| Backend tests, `createTestApp()` | `1000` / `1000` |
| Backend tests, `createTestApp({ attemptLimits: 'defaults' })` (this feature) | unset: `10` / `3` |

## Operations

| Operation | Kind | Limited |
| --- | --- | --- |
| `createOrder` (`POST /events/{id}/orders`) | `BUY` | yes (`x-attempt-limit: BUY`) |
| `reserveSeats` (`POST /events/{id}/reservation`), new or adding seats | `HOLD` | yes (`x-attempt-limit: HOLD`) |
| `releaseSeats`, `releaseAllMyReservations` | — | never |
| every read, `streamSeatMap` | — | never |

## The refusal (`429`)

| Part | Value |
| --- | --- |
| Status | `429 Too Many Requests` |
| Header | `Retry-After: <retryAfterSeconds>` |
| `error.code` | `RATE_LIMITED` |
| `error.message` | `rateLimitMessage(retryAfterSeconds)`: "Too many tries. You can try again in 3 seconds." ("1 second") |
| `error.details` | `{ action: 'BUY' \| 'HOLD', retryAfterSeconds: 1–60 }` |

## Customer app state (`GetTickets`)

| Name | Shape | Rule |
| --- | --- | --- |
| `waits` | `{ BUY: number \| null; HOLD: number \| null }`, `performance.now()` deadlines | Set from `retryAfterSeconds` on a `429 RATE_LIMITED`; cleared when it passes (research R6) |
| seconds left | per kind, ticked every 250 ms | The shown N; at 0 the message goes and the kind's buttons are enabled |
| button state | per kind | While waiting: `aria-disabled="true"`, clicks ignored, focus kept (and moved back to the pressed button if it had gone to `body` while confirming) (research R6) |
| first message | per kind | The `role="alert"` text, fixed at the refusal, so it is announced once |

Nothing else in the app's state changes on a refusal for the limit: picks, the reservation and its
countdown, the holder's name, the quantity, the tier, and `requestId` are kept.
