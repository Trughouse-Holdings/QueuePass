# Research: Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends

**Feature**: `033-seat-hold-cart` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-09

The issue (#135, superseding #131) settles what the customer sees and does. Every decision below
that it leaves open takes the recommended option and records the alternatives, for Mahdi and the
team to overturn in review of the spec PR. Line numbers are `main` at `796e9a9`.

## What exists

- **Backend** (`backend/src/reservations/`): `reserveSeats` (`reservations.service.ts:60-162`)
  locks the event, closes run-out reservations, checks the event, the seats (`resolveSeats`), the
  tier (the active reservation's, else the first seat's section's, `:169-189`), seats already in the
  reservation (`400`), the 2-minute wait (`assertNoWait`, `:191-222`), seats sold or held by others
  (`409 SEAT_TAKEN`), at most 10 seats and the `016` limit, then inserts a reservation with
  `expiresAt = now() + 5 minutes` (`:224-236`; the `seat_reservation_five_minutes` CHECK) or adds the
  holds to the active one with its end unchanged (`:144-146`). `releaseSeats` (`:258-298`) ends the
  listed holds, or all, `RELEASED`; `endHolds` (`holds.ts:73-93`) then ends every reservation left
  with no live hold. One active reservation per customer per event (`seat_reservation_one_active`);
  one live hold per seat (`seat_hold_one_live_per_seat`). The sweep (`hold-sweeper.ts`) closes run-out
  reservations every second and publishes their seats.
- **Orders** (`backend/src/orders/orders.service.ts:343-396`): a seated order's seats must all be live
  holds of the caller (`409 RESERVATION_REQUIRED`, `details.expired` when the latest reservation ran
  out); bought holds end `BOUGHT`, the rest stay held.
- **Limits** (`backend/src/attempt-limits/`): `reserveSeats` carries `@AttemptLimit('HOLD')`,
  `createOrder` `BUY`; one pair of settings for both kinds (`RATE_LIMIT_PER_MINUTE`,
  `RATE_LIMIT_PER_5_SECONDS`; defaults 10 and 3, `attempt-limits.config.ts:13`); releases never
  count.
- **Customer app** (`customer-app/src/components/GetTickets.tsx`, 951 lines): picks in browser state
  (`seats`, `:123`); Remove (`:803-809`); Reserve seats (`:816-825`, `reserve()` `:480-510`); the
  "Reserved for you" box with the countdown line (`:876-916`), Release (`:888-895`), Confirm
  purchase and Release seats (`:899-913`); `release()` (`:513-541`); `confirm()` (`:543-601`) with
  the request id, the unknown outcome, and the buy wait; the live seat stream with the customer's
  own reservations (`useSeatStream(…, { withMine: true })`, `:104-110`), reloaded on any change to
  them (`:251-268`); the countdown from the Backend's `secondsLeft` against `performance.now()`
  (`:214-231`, `:322-352`), the 1-minute warning and the "ran out" alert. Choosing another tier
  releases the reservation (`:719-720`). Logout releases everything (`release-on-logout.ts`).

## R1. The cart is the active reservations; Add to cart opens it

**Decision**: no cart is stored anywhere new. The Cart page (`/cart`) lists
`GET /me/reservations` (`listMyReservations`), which already returns every active reservation of
the caller, for every event, newest first, with its seats, `tierId`, `expiresAt`, and `secondsLeft`.
**Add to cart** navigates to `/cart`; it sends nothing. Held seats are in the cart from the moment
they are held.

**Why**: the holds are already the Backend's, with every rule the cart needs (one per event, a fixed
end, released on logout, seen by other customers live). Reading them is what makes the cart survive a
refresh and a second device (Nate's "across sessions"), with no contract or schema change and no way
for the cart and the holds to disagree.

**Alternatives**:

- **A cart in `localStorage`**: lost on another device, can list seats the Backend no longer holds,
  and duplicates the reservation. Rejected.
- **A Backend "in cart" flag** (a column on `SeatReservation` and `POST …/reservation/cart`): a
  contract operation, a migration, and a state that changes nothing the customer can do (the seats
  are held either way, and buying already requires the hold). Rejected; open to review if the team
  wants "held but not in the cart" to look different.

## R2. Scope: every held event, each bought on its own; general admission unchanged

**Decision**: the cart lists each active reservation as its own entry, with its own countdown, total,
and **Buy tickets**. Each Buy tickets is one `createOrder` for that event. General-admission events
never appear: they have no hold.

**Why**: a customer could always hold seats for several events at once (one reservation per event,
`015` FR-003), so a cart limited to one event would either hide holds or need a new rule refusing a
second event's hold. One order per event is `005`'s model; a combined checkout is a new kind of
order (several events, one request id, all or nothing across event locks) for no current need.

**Alternatives**: one event per cart (a new refusal on holding a second event's seats, and the first
event's seats hidden or released); a multi-event checkout (deferred, Out of scope); general
admission in the cart (a hold on a quantity, with capacity counting held tickets: a new rule in
orders and availability; deferred).

## R3. One countdown per reservation, from the Backend

**Decision**: each reservation's countdown is from its own `secondsLeft`, against `performance.now()`,
as `GetTickets` does today (`015` R13), started when the app first sees that reservation and never
restarted while it lasts. Releasing the last seat ends the reservation (the Backend's `endHolds`);
the app drops the countdown, and the next hold's `201` starts a new one.

**Why**: the Backend already keeps exactly this; the app only shows it. `secondsLeft` avoids trusting
the browser's clock (`015` R13).

## R4. The 2-minute wait counts from the reservation's end and covers all of its seats

**Decision**: `assertNoWait` (`reservations.service.ts:191-222`) changes its query: a hold of this
customer for this event blocks a seat when its `endReason` is `EXPIRED`, `RELEASED`, or `LOGOUT`,
**its reservation has ended** (`r."endedAt" IS NOT NULL`), and `now() < r."endedAt" + interval '2
minutes'`; `availableAt` is `r."endedAt" + 2 minutes`. The query keeps a bound on the hold's own
end, `AND h."releasedAt" > now() - interval '7 minutes'`, so the `SeatHold (eventId, releasedAt)`
index still narrows it by time and not only by event. The bound is exact: a hold's `releasedAt` is
never more than 5 minutes before its reservation's end (a reservation lasts at most 5 minutes), so a
hold that can still block (its reservation ended less than 2 minutes ago) was released less than 7
minutes ago. So:

- a seat released while its reservation still has live holds is not blocked: it can be held again
  at once, into the same reservation (`reserveLocked` step 7 adds it with `expiresAt` unchanged);
- when the reservation ends (`endHolds` sets `endedAt` when its last live hold ends; `closeRunOut`
  sets it to `expiresAt`), every seat that left it released, run out, or by logout waits 2 minutes
  from that end, including seats released earlier;
- `BOUGHT` and `CLOSED` holds still block nothing.

**The order of checks** (`reserveLocked`): step 5 (seats sold, or held by another customer, `409
SEAT_TAKEN`) now runs **before** step 4 (the wait). Otherwise a seat the customer released, held
again, and then bought leaves a `RELEASED` hold in an ended reservation, and holding it later would
be refused as `SEAT_COOLDOWN` instead of `SEAT_TAKEN`. Taken is the truer reason whenever both
apply (another customer holding a seat this customer must wait for is also refused as taken). The
alternative, excluding seats with a `BOUGHT` hold in the same reservation from the wait, covers only
this one case and adds a subquery. Rejected.

For `EXPIRED` and `LOGOUT`, and for the last released seat, `releasedAt` equals `endedAt`, so those
waits are unchanged. What changes: a seat released mid-reservation no longer waits while the
reservation goes on, and waits from the reservation's end afterwards.

The refusal's message says what happened whichever way the seat left: "Your reservation of {seats}
ended less than 2 minutes ago. You can reserve {it|them} again at HH:MM:SS UTC." (today: "You
released {seats} less than 2 minutes ago…", wrong for a run-out seat). The Customer app writes its
own from `details` (`GetTickets.tsx:454-461`): "Your reservation of {seats} ended less than 2
minutes ago. You can hold {it|them} again at {time in the viewer's zone}."

**Why**: with click-to-hold a click on a held seat is a release, and a mis-click would lose that seat
for 2 minutes (the wait starts at its own release today; `reservations.boundaries.e2e-spec.ts:171-185`
pins "re-adding the released seat to the still-active reservation waits too"). Re-holding into the
same reservation gains nothing: the end is fixed. The reset the issue worries about is ending the
reservation and starting a new one, and every seat of the old one then waits, so releasing seats one
at a time before the last cannot free some early and carry them into a new 5 minutes.

**Alternatives**:

- **Keep today's rule** (each seat's wait from its own release): mis-clicks cost 2 minutes per seat,
  and a seat released early is free again sooner than the reservation's other seats: a customer can
  release seat B at 4:00, release A at 4:59 (ending the reservation), and hold B at once with a new
  5:00. Rejected.
- **No wait at all**: the reset becomes free; a customer could keep seats indefinitely by releasing
  and clicking again. Rejected.
- **A longer wait, or a cap on reservations per hour**: not needed; other customers can take the
  seats during the 2 minutes, which is what stops hoarding.

## R5. The hold allowance: its own pair, 30 a minute and 10 in any 5 seconds; one request per click

**Decision**: the `HOLD` kind reads two new settings, `RATE_LIMIT_HOLD_PER_MINUTE` (default 30) and
`RATE_LIMIT_HOLD_PER_5_SECONDS` (default 10), checked like the others (a whole number of at least 1;
the 5-second number not above the minute's; a wrong value stops the Backend). The existing pair
(`RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_5_SECONDS`) keeps its names and defaults (10, 3) and now
applies to `BUY` only. `AttemptLimits` becomes `{ BUY: Pair; HOLD: Pair }`; the service picks the
pair by kind; `createTestApp`'s `attemptLimits` option sets both kinds (a number pair for both, or
`'defaults'`). `.env.example` and `docker-compose.yml` gain the two settings (shared surface, in this
PR); `e2e/stack/docker-compose.e2e.yml` sets them to the defaults (implementation).

The Customer app sends **one hold request per click**, one request at a time (R6).

**Why**: at 3 in any 5 seconds, the fourth seat clicked within 5 seconds is refused; at 10 a minute,
10 seats plus one mis-click or one taken seat is refused. Ten seats is the most one reservation
holds, and a person clicks at most two or three a second, so 10 in 5 seconds and 30 a minute fit
ordinary use with room for mis-clicks and refusals, while a script stays far below what it could
send (each attempt can hold at most 10 seats, for 5 minutes, then waits 2 minutes for them). Buying
is unchanged: Buy tickets is one request per event.

**Alternatives**:

- **Batch clicks** (#131: gather clicks for ~300 ms, send them in one request): a person clicking
  one seat a second still sends one request a second, which meets 3 in 5 seconds on the fourth;
  batching only helps with a wait long enough to feel slow. And a batch is all or nothing (`015`
  FR-002): one taken seat refuses the others, which then need resending. Deferred; not needed at the
  new numbers.
- **Raise the shared pair**: loosens buying too, which nothing asks for. Rejected.
- **Count only new reservations, not additions**: a script could then probe taken seats for free
  while holding one seat, against `026`'s "every attempt counts" (`026` Clarifications). Rejected.
- **Fixed numbers without settings**: tests and deployments could not set them, against `026`
  FR-017 (tests set their own numbers through configuration). Rejected.

**Decided by Mahdi, 2026-11-09** (asked directly in review of this spec): holds get their own
limit, 30 a minute and 10 in any 5 seconds; buying keeps 10 a minute and 3 in any 5 seconds. This
replaces his `026` decision 2 ("10 seat-hold attempts a minute … no more than 3 in any 5 seconds")
for holds only.

## R6. The click queue

**Decision**: `GetTickets` keeps an ordered queue of seat actions (`hold` or `release`, by seat) and
sends the head when nothing is in flight:

- a click on an open seat appends `hold`; a click on a held seat appends `release`;
- a click on a seat with a queued, unsent `hold` removes it (nothing is sent); with a queued
  `release`, removes it (the seat stays held);
- a click on a seat whose request is in flight appends the opposite action, sent after the answer;
- a seat with a queued or in-flight action is shown pressed or not as it will be, named "Row N, Seat
  M, holding" or "…, releasing", and still clickable;
- when an action is refused or unanswered, the opposite action queued behind it **for the same
  seat** is dropped too: a release queued after a refused hold (the seat was never held), or a hold
  queued after a refused or unanswered release (the seat is still held, or its state is reloaded);
  so a double click on the only held seat whose release is refused leaves it held, with no second
  hold sent;
- on a refusal of a hold, that action is dropped and the queue goes on; on a hold-limit refusal
  (`429`) every queued `hold` is dropped (they would be refused too) and queued releases go on; on
  `401`, the queue is cleared and the customer signs in again; on no answer, the seat reverts and
  the reservation and seat map are loaded again (`reloadMine`, `reload`).

**Why**: #131 asks for "queue them in order, and never send the same seat twice". One at a time keeps
each answer about one seat, so each announcement and refusal names it, and the reservation the app
shows is always the latest answer (the `lastWrite` guard, `:243`, keeps working).

**Alternatives**: parallel requests (out-of-order answers, and the second hold of a new reservation
racing the first: both see no active reservation; one fails on `seat_reservation_one_active` and is
retried by `reserve()`'s collision retry, `:65-76`, but its answer may arrive first). Rejected.

## R7. Ticket types are locked while seats are held

**Decision**: while the customer has an active reservation for the event, every other ticket type's
radio is `disabled`, with a note under the fieldset: "Your held seats are {tier} seats. To choose
another ticket type, click your held seats to release them." The section select stays free within
the type.

**Why**: today choosing another tier releases the whole reservation (`GetTickets.tsx:719-720`):
a Release seats button in disguise, which the issue removes, and one that ends the reservation and
starts the 2-minute wait for every seat without the customer clicking any of them. A reservation is
one tier (`015` FR-003), so holding seats of two types at once is not possible.

**Alternative**: keep the silent release, announced. Rejected for the reasons above.

## R8. The cart page

**Decision**: a new page, `customer-app/src/pages/Cart.tsx` at `/cart`, and a **Cart** link in the
top bar after My tickets. It loads `GET /me/reservations` and, for each reservation, its event
(`GET /events/{id}`) and its ticket types (`GET /events/{id}/tiers`, for the name and price; the
event's `basePrice` when `tierId` is `null`). It shows:

- one **Name on tickets** field at the top (`017`; the shared `holderNameProblem` and messages);
- per event, a `section` with the event's name (a link), its date and time in the venue's zone
  (`format.ts`'s existing helpers), the type and price, the countdown (R9), the seats, the total,
  **Change seats** (a link to `/events/{id}`), and **Buy tickets**;
- the empty state: "Your cart is empty. Seats you hold on an event's page appear here for 5
  minutes."

**The cart opens no seat stream.** It reads `GET /me/reservations` again about every second while
the page is visible (`document.visibilityState === 'visible'`), at once on `visibilitychange` to
visible and on window `focus`, and not at all while hidden (the timer stops). A purchase, release,
admin change, or run-out elsewhere therefore drops an entry within 2 seconds (FR-017); the
countdowns run between reads from each entry's `secondsLeft`, re-based only when a new reservation
appears (an entry's end never moves). The event and tier reads are made once per event and kept
while the page is open. **Connection budget**: the cart holds no long-lived connection, so its
reads and Buy tickets each use one short request; the event page keeps its single seat stream
(`useSeatStream`, one per open event page), as today. A stream per listed event would have used one
of the browser's six HTTP/1.1 connections to the host each (three events in two tabs fill all six,
and Buy tickets then waits), downloaded each event's full seat map, and fired a `GET
/me/reservations` from every stream on any seat change. Buy tickets moves
`confirm()`'s logic (`GetTickets.tsx:543-601`: request id, `401`, `429` wait, `5xx` and no answer to
the unknown outcome with Check again, refusals) into a hook both pages could use, `use-buy.ts`; the
event page now uses it only for general admission. The confirmation (`Confirmation`,
`GetTickets.tsx:922-951`) moves to its own component file and shows in place of the cart entry.

**Why**: a page of its own, reached from the nav and from Add to cart, is what "a cart" means to a
customer; reusing `confirm()`'s logic keeps every `006`, `015`, `017`, and `026` behavior of
buying. One small read a second while visible costs the Backend one indexed query per open cart and
needs no connection held open.

**Alternatives**: the cart as a panel on the event page (it could not list other events, and the
issue says "including in the cart"); a `useSeatStream` per listed event (the connection budget
above). Rejected.

## R9. The countdown, prominent

**Decision**: a `HoldCountdown` component (`customer-app/src/components/HoldCountdown.tsx`) shared
by the event page and the cart: a `<p role="timer" aria-live="off" className="hold-countdown">` with
"Time left: **4:12**" where the time is in a span with `.hold-countdown__time` (the theme's mono
font at 32 px, `font-variant-numeric: tabular-nums`, in `customer-app/src/styles.css`, tokens only, as
`.entry-code__countdown` does), and its own `role="status"` region for the 1-minute warning ("1
minute left to buy your seats."). On the event page it is the first thing in the **Your seats** box
(`section` labelled "Your seats", directly below the seat map: the countdown, the seats, the total,
**Add to cart**); in the cart, the first line of each entry.

**Why**: "shown prominently … not a line of small text"; 32 px is twice the body text; the shared
theme already has the tokens, so no shared-surface change (Constitution VII; the theme drift scan
allows app classes built from tokens).

**Alternatives**: a sticky bar on every page (a global poll or stream for any page, deferred with the
nav count); a banner color (color alone says nothing to a screen reader). Rejected.

## R10. Announcements and keyboard

**Decision**: one polite `role="status"` region in Get tickets says each answer: "Section A, Row 1,
Seat 12 held. 4:59 left." (the seat's `seatLabel` and the reservation's `secondsLeft` as `m:ss`),
"Section A, Row 1, Seat 12 released.", and, when a release ends the reservation, "Section A, Row 1,
Seat 12 released. You hold no seats now; the next seat you click starts a new 5 minutes." A refused
click goes in the existing error banner (`role="alert"`), naming the seat and the reason (the
Backend's message; `SEAT_COOLDOWN` with `availableAt` in the viewer's zone, as `:454-461`). The
`015` live-change messages ("no longer available") go away with picks; a held seat lost to an admin
change says "Your held seats were released." as today. Seats remain `SeatPicker`'s toggle buttons,
`aria-pressed` for held and holding seats; seats that become unavailable while focused keep
`aria-disabled` (`015` FR-012).

**Fast clicks**: a polite region announces only its latest text once a screen reader catches up,
so replacing the text on each answer can drop announcements when answers arrive close together.
The region therefore **appends**: each answer adds its sentence as a new line (a child element) to
the region, which keeps the last few (at most 5) and is cleared 10 seconds after the last addition,
so three quick clicks are three announcements, in order.

**Why**: the issue's own example; each click changes the server, so each answer is said once.

## R11. Specs 007, 015, and 026: dated notes

**Decision**: in this PR, a dated italic note (as `031` did in `008`, and `032` in `030`) after:
`015` Clarifications 1, 2, and 4, US1, FR-001, FR-004a, FR-005, FR-007, and research R13; `007`'s
Confirm purchase step (its seated purchase flow); `026` Clarifications 2 and its Customer app
requirements naming Reserve seats, Release, and Release seats (FR-011 to FR-014), each pointing to
`033`. The Backend rules they state stand, except `015` FR-004a's start of the wait (R4) and `026`'s
hold numbers (R5).

## R12. Tests

**Decision**:

- **Backend**, against Testcontainers PostgreSQL, first: `reservations.boundaries.e2e-spec.ts`'s
  2-minute cases rewritten to R4 (a seat released mid-reservation is held again at once with
  `expiresAt` unchanged; after the reservation ends, every seat of it, one released earlier
  included, is refused until exactly `endedAt + 2 minutes` and allowed at it; `BOUGHT`/`CLOSED`
  still free; another customer never waits); `rate-limits.hold.e2e-spec.ts` with the new defaults
  (exactly 10 of 20 simultaneous holds handled; the 31st in a minute refused) and the buy pair
  unchanged (`rate-limits.buy.e2e-spec.ts` untouched); `attempt-limits.spec.ts` for the four settings
  and their checks; the contract tests.
- **Customer app** (Vitest, React Testing Library), first: `seat-hold-click.test.tsx` (new: FR-001 to
  FR-011, FR-016; the queue of R6) and `cart.test.tsx` (new: FR-012 to FR-015, FR-017); the existing
  `seat-holds`, `seats`, `rate-limit`, `holder-name-field`, `keyboard`, `seat-stream`, `ticket-limit`,
  and `purchase` tests updated from Reserve seats and Confirm purchase to clicks, Add to cart, and the
  cart, keeping what each checks.
- **Browser** (Playwright): `e2e/tests/033-seat-hold-cart.spec.ts` (new, quickstart S1/S2/S6); `007
  S3`, `015 S2`, and `026 S2` updated to click seats, Add to cart, and buy from the cart (their
  titles unchanged, so their quickstarts' Automation rows stay right).

## R13. Version order

**Decision**: contract 1.24.0 → **1.25.0** (MINOR: rule and number changes in descriptions; no
operation, schema, field, or code), with `api-schema.ts` regenerated; constitution 3.9.4 → **3.9.5**
(PATCH, row `033`). On top of `main` at `796e9a9` (specs 028 to 032 merged). `030`'s implementation,
in flight, changes neither. `032`'s implementation (in flight) edits `contracts/openapi.yaml` (it
makes `checkInDetailsRemovedAt` required, still 1.24.0) and regenerates `api-schema.ts`; whichever
of it and this feature's PRs lands second keeps both changes, regenerates `api-schema.ts`, and
reruns `check-contract-drift`.
