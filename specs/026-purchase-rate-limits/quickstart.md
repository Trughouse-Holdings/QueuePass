# Quickstart: Purchase Rate Limits

**Feature**: `026-purchase-rate-limits` | **Spec**: [spec.md](./spec.md)

The running-system walk for `026`, with the default limits: 10 attempts a minute and 3 in any 5
seconds, buying and holding seats counted separately, per customer account.

## S0: Set up

Stack up from the implementation branch (`docker compose up --build`), demo data loaded, no `.env`
(or one without the `RATE_LIMIT_…` variables). Two browser sessions that don't share sign-in:
**Customer** (http://localhost:5174, `customer1` / `test123`) and **Customer 2** (`customer2`).
Keep the Customer session's network panel open. For S4 and S5, copy `customer1`'s and `customer2`'s
access tokens from the Customer app (`001` quickstart V6 shows how) into `TOKEN1` and `TOKEN2` in a
shell, and pick a demo event that sells general admission (`EVENT`, its id) and one with reserved
seating (`SEATED`). "Within 5 seconds" below means pressing quickly, one press after another.

## S1: Ordinary buying never meets the limits (US3 scenario 1; FR-016, SC-004)

Customer: on a general-admission event, get 2 tickets with **Confirm order**. On a seated event,
pick 2 seats and press **Reserve seats**; pick a third and press it again; press **Release** on one
held seat, then on another; press **Reserve seats** for a new pick; **Confirm purchase**. Then buy
on a second event. Work at a normal pace, reading each answer. **Expected**: no "Too many tries"
anywhere; no `429` in the network panel.

## S2: Over the hold limit: a countdown, nothing lost (US2 scenarios 1, 2, 4; FR-007, FR-011 to FR-013)

Customer: on the `SEATED` event, hold one seat with **Reserve seats** and note it (section id, row,
seat: the network panel shows them in the request). Pick another seat but don't press yet. In the
shell, send three hold attempts for the held seat, which `015` refuses (`400`, already in your
reservation), then press **Reserve seats** within the next 5 seconds:

```bash
for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://localhost:3000/events/$SEATED/reservation" -H "Authorization: Bearer $TOKEN1" \
  -H 'Content-Type: application/json' -d '{"seats":[{"sectionId":"…","row":1,"seat":1}]}'; done
```

**Expected**: three `400`s; then, in the app,
"Too many tries. You can try again in N seconds." above Reserve seats, N from 1 to 5, counting down
each second ("1 second" at the end); Reserve seats disabled; **Reserved for you** still lists the
held seats with its own countdown running; **Confirm purchase**, **Release**, and seat picking
work. When the message goes, Reserve seats works again. Network panel: the refused request is `429`
with `"code":"RATE_LIMITED"`, `"action":"HOLD"`, `"retryAfterSeconds"` equal to the first N, and a
`Retry-After` header with the same number.

## S3: Over the buy limit (US2 scenario 3; FR-011, FR-012, FR-014)

Customer: on the `EVENT` page, choose quantity 1 and enter the name on the tickets. Send three
orders with S4's command (`seq 3` in place of `seq 20`), then press **Confirm order** within 5
seconds. **Expected**: "Too many tries. You can try again in N seconds." above Confirm order,
Confirm order disabled until it goes, then enabled; the quantity and name kept; no new order on My
tickets from that press. On the `SEATED` event with a seat held, do the same with **Confirm
purchase**: it is disabled while Reserve seats, Release, and the hold's countdown keep working.
(Check again after an
unknown outcome is covered by the Customer app's tests: it needs the Backend to stop answering
mid-order.)

## S4: However the API is called (US1 scenarios 1–3, 6, 7; FR-001 to FR-010, SC-001, SC-002)

Twenty orders at once with one token:

```bash
seq 20 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://localhost:3000/events/$EVENT/orders" -H "Authorization: Bearer $TOKEN1" \
  -H 'Content-Type: application/json' \
  -d "{\"quantity\":1,\"holderName\":\"Jordan Lee\",\"requestId\":\"$(uuidgen)-{}\"}" | sort | uniq -c
```

(For an event with tiers, add `"tierId"`; `requestId` only needs to differ per request.)
**Expected**: 3 lines that are not `429` (normally `201`), 17 `429`; My tickets shows 3 new orders,
no more. Run it again at once: 20 × `429`. Wait for the seconds the last answer said, then send one:
not `429`. Send one order every 7 seconds for a minute (`for i in $(seq 11); do …; sleep 7; done`):
**Expected**: the eleventh within 60 seconds of the first is `429`, with `retryAfterSeconds` the
seconds until the first is a minute old. The same twenty at once to `POST /events/$SEATED/reservation`
(each with its own seat): 3 handled, 17 `429` with `"action":"HOLD"`; seats held before keep their
`expiresAt` (`GET /me/reservations`). Right after using up the buy allowance, a hold is handled, and
the other way round. With an admin's token, `POST /events/$EVENT/orders` → `403`, not `429`.

## S5: Releases, reads, and everyone else (US3 scenarios 2, 3; FR-004, FR-015, SC-005)

While S4's twenty-at-once command runs in a loop for `customer1` (`while true; do …; done`), the
**Customer 2** session buys tickets and holds seats on the same events. **Expected**: it works as
usual, at its usual speed. Stop the loop. `customer1`: `POST /events/$SEATED/reservation/release` ten
times in a row → `200` every time; log out of the Customer app (releases every hold) → no `429`. The
Backend's log (`docker compose logs backend`) has one "Attempt limit: customer … over the BUY
allowance" line per time the account went over, not one per refused request, and no token.

## S6: Configuration and restarts (FR-017, FR-018, spec Assumptions)

Set `RATE_LIMIT_PER_5_SECONDS=1` in `.env` and `docker compose up -d backend`. **Expected**: a second
Reserve seats within 5 seconds is refused. Set it to `0` and restart the Backend. **Expected**: the
Backend does not become healthy, and its log names `RATE_LIMIT_PER_5_SECONDS` and the value. Remove
the line and restart. Use up `customer1`'s buy allowance (S4), restart the Backend
(`docker compose restart backend`), and order once. **Expected**: handled (the restart forgot the
counts).

## S7: Keyboard, screen reader, phone width, dark mode (FR-013)

Repeat S2 with the keyboard only and VoiceOver: the message is read once when it appears, not every
second; Reserve seats is announced as dimmed (disabled) and focus is not lost; when the message goes,
Reserve seats can be pressed with Enter. At 360 px wide the message wraps above the button with
nothing scrolling sideways. Repeat in dark mode.

## S8: Sign in, use, sign out (Constitution VI)

Sign in to each of the three apps, use it, and sign out.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. On the spec branch S2 is Manual: its test
comes with the implementation PR, which marks it Automated as research R12 lists.

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: set-up for the scenarios below; the browser test sets up its own data through the API |
| S1 | Manual: walked by every browser test that buys or holds seats (`006`/`007`, `015`, `016`, `017`, `019`, `020`), which run with the default limits (research R9) |
| S2 | Manual: to be automated by `026 S2: a customer over the hold limit sees a countdown and keeps their seats` in the implementation PR (research R11, R12) |
| S3 | Manual: the buy countdown and Check again, covered by the Customer app's tests (research R10) |
| S4 | Manual: an API behavior, covered by Backend tests with genuinely concurrent requests and a test clock |
| S5 | Manual: another account's speed is judged by a person; no database work for refusals, releases, and the log line are covered by Backend tests |
| S6 | Manual: restarts the Backend with other settings; the settings' checks are covered by Backend tests |
| S7 | Manual: keyboard, a screen reader, phone width, and dark mode, checked by a person |
| S8 | Manual: sign in, use, and sign out of each front end, by hand |
