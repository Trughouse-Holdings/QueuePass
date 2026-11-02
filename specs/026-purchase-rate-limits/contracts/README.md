# Contract Changes: Purchase Rate Limits

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.16.0 to 1.17.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passing (research R4). If `025`'s implementation has set
1.16.1 on `main` by the time this branch rebases, this stays 1.17.0; if another feature has taken
1.17.0, it becomes 1.18.0 (research R13).

No new operation, so no `x-planned` marker. No schema changes shape: the refusal uses the existing
`ErrorEnvelope`. A `429` declared before the Backend sends it is safe for `main`: the contract tests
validate the responses the Backend gives, and it gives none until the implementation.

| Where | Change |
|---|---|
| `info.version` | 1.16.0 → 1.17.0 |
| `info.description` | New paragraph **Attempt limits** (before **Errors**): the two allowances per customer account (10 in any 60 seconds, 3 in any 5 seconds, buy and hold separately), `x-attempt-limit`, what counts (every request past the token and role checks, whatever its outcome; not one refused for the limit), `429 RATE_LIMITED` before anything else, `details.retryAfterSeconds` and `Retry-After` and what waiting them guarantees, browsers read the body (CORS does not expose the header), no one exempt, releases and reads never limited, the two settings and their defaults. |
| `createOrder` | `x-attempt-limit: BUY`; description: a buy attempt, a repeated `requestId` included; refused with `429` before every other rule, nothing recorded, reservations unchanged; `'429': TooManyAttempts`. |
| `reserveSeats` | `x-attempt-limit: HOLD`; description: a hold attempt, new or adding seats, however many seats; refused with `429` before every other rule, the active reservation keeps its seats and `expiresAt`; `'429': TooManyAttempts`. |
| `releaseSeats`, `releaseAllMyReservations` | description: never limited and never counted. |
| `components.responses.TooManyAttempts` | new: `429`; header `Retry-After` (integer 1–60); `ErrorEnvelope` with examples `holdLimited` (3 seconds) and `buyLimited` (47 seconds). |
| `ErrorEnvelope.code` | adds `RATE_LIMITED`, after `DOORS_OPEN_OUT_OF_RANGE`. |

Unchanged: every operation's path, roles, request, and success responses; every schema's shape; the
CORS policy (`allowedHeaders`, no `exposedHeaders`).

Also in this PR: `packages/shared/src/errors.ts` lists `RATE_LIMITED` in `ERROR_CODES`, after
`DOORS_OPEN_OUT_OF_RANGE` (the Backend's list test fails when a contract code is missing).

`x-attempt-limit` is a vendor extension, like `x-required-roles`; `openapi-typescript` ignores it,
and the Backend's route-coverage test checks it against `@AttemptLimit` on the routes (research R10).

## Examples

With the defaults (10 a minute, 3 in 5 seconds), a customer's fourth hold attempt within 5 seconds:

```bash
curl -si -X POST http://localhost:3000/events/0f8a9d3e-…/reservation \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"seats":[{"sectionId":"5b1c…","row":1,"seat":7}]}'
```

→

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 3
Content-Type: application/json; charset=utf-8

{"error":{"code":"RATE_LIMITED","message":"Too many tries. You can try again in 3 seconds.","details":{"action":"HOLD","retryAfterSeconds":3}}}
```

The same request 3 seconds later → `200` or `201` (or a refusal of `015`'s, such as `409 SEAT_TAKEN`),
never `429`, unless another hold attempt of that account came between.

A script sending `POST /events/{id}/orders` 20 times at once with one customer's token: 3 answers are
`201` (or a refusal of `006`/`007`/`015`/`016`'s), 17 are `429` with `"action":"BUY"`. Ten handled
buy attempts later within a minute, the eleventh gets, for example, `"retryAfterSeconds":47` and
`Retry-After: 47`.

`POST /events/{id}/reservation/release` and `POST /me/reservations/release`: never `429`.

A gate agent's or an admin's token on either limited operation: `403 FORBIDDEN`, as today, and not
counted.
