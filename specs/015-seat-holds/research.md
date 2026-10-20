# Research: Seat Holds with Live Updates

Decisions for [plan.md](./plan.md). Each has a decision, its rationale, and the alternatives
considered. "Reservation" is the spec's word for what issue #27 calls a hold. In the code, a
**reservation** is one customer's 5-minute claim on an event, and a **hold** is one seat in it.

## R1. Two tables: a reservation, and one hold row per seat

**Decision**: `SeatReservation` (one per customer per event while active: `eventId`,
`customerSub`, `tierId`, `createdAt`, `expiresAt`, `endedAt`) and `SeatHold` (one per seat:
`reservationId`, `eventId`, `seatSection`, `seatRow`, `seatNumber`, `releasedAt`, `endReason`).
A hold names its seat by **label** (section name, row, seat), exactly as `Ticket` does (spec 007
research R1). Hold rows are kept after they end, with the moment and the reason, because the
2-minute wait (R6) is computed from them.

**Rationale**: The reservation carries what is per customer per event: one fixed end time
(FR-004), one tier (FR-003), and "at most one active" (FR-003). The hold carries what is per seat:
the uniqueness the database must guarantee (FR-009, R2), and the release of a single seat by
deselecting it (FR-007). Labels let the hold and ticket checks compare seats the same way, and a
layout replacement ends every hold at the venue anyway (R11), so a section foreign key adds
nothing. `SeatHold.eventId` repeats the reservation's event so the unique index can use it; a
composite foreign key `(reservationId, eventId)` → `SeatReservation(id, eventId)` makes the database
keep the two equal.

**Alternatives considered**: One table with a row per seat and the expiry repeated on every row
(nothing stops two rows of one reservation from disagreeing on the end time, and "one active
reservation per customer per event" has no row to hang its index on). Columns on `Ticket` with a
`HELD` status (a hold is not a ticket: it must not count toward capacity, sales, or the `016`
limit, and every existing ticket query would need a new filter).

## R2. The database guarantee: a partial unique index plus the event row lock

**Decision**:

- `seat_hold_one_live_per_seat`: a unique index on `SeatHold(eventId, seatSection, seatRow,
  seatNumber) WHERE "releasedAt" IS NULL`. No seat can have two live holds, from any path.
- `seat_reservation_one_active`: a unique index on `SeatReservation(eventId, customerSub) WHERE
  "endedAt" IS NULL`. At most one active reservation per customer per event (FR-003).
- **Hold versus ticket**: every path that creates a hold or a seated ticket first takes the
  event's `SELECT … FOR UPDATE` row lock (`common/event-lock.ts`), which already serializes every
  order for an event. Under that lock, the reserve path refuses seats with a valid ticket, and the
  order path accepts only seats with the customer's own live hold (R7). `ticket_one_valid_per_seat`
  (spec 007) still guarantees no two valid tickets.

**Rationale**: Constitution IV accepts a unique index or a row lock as the database guarantee.
"No two live holds on a seat" is a single-table rule, so a partial unique index states it directly
and holds even against a write that skips the Backend. "No live hold on a seat that has a valid
ticket" spans two tables, which no index can express. The event row lock is the mechanism this
codebase already uses for cross-row rules (`SOLD_OUT`, the `016` limit). The 10-simultaneous-
reservations test (FR-019) exercises the lock. Because every reserve runs under the lock, that test
never reaches the unique indexes, so a separate test writes rows directly with SQL to prove each
index and CHECK refuses on its own (R16).

**Alternatives considered**: An exclusion constraint over time ranges (`tstzrange(createdAt,
expiresAt)`): it would need no clean-up of expired rows, but a released or bought hold must stop
blocking at once, not at its expiry, so the range would have to be rewritten on every release, and
the index still couldn't see tickets. One shared "seat claim" table for both holds and tickets
(one index for both rules, but it moves seat storage off `Ticket` and rewrites spec 007's order
path and its tests). Advisory locks (another locking scheme beside the row lock).

## R3. Time comes from the database, and expiry is closed under the lock

**Decision**: `createdAt` is `now()` in the inserting transaction, and `expiresAt` is
`createdAt + interval '5 minutes'`. A CHECK, `seat_reservation_five_minutes`, keeps exactly that
relationship. A reservation is active while `endedAt IS NULL AND now() < expiresAt` (half-open,
`[createdAt, expiresAt)`, as the constitution requires for time windows). Every locked path (reserve,
release, order, and the admin changes in R11) begins by **closing** the event's reservations that
have run out: it sets `endedAt = expiresAt` on each, and on each of its live holds
`releasedAt = expiresAt, endReason = 'EXPIRED'`. Reads without the lock (the seat map) treat a hold
whose reservation has run out as open, whether or not it has been closed yet.

**Rationale**: One clock, the database's, decides every boundary, so the Backend's clock and the
test machine's can't disagree about "exactly 5 minutes" (FR-004, FR-019). Closing under the lock
frees a run-out hold's slot in `seat_hold_one_live_per_seat` before the same transaction inserts a
new hold. Recording `releasedAt = expiresAt` instead of the sweep time makes the 2-minute wait
(R6) start at exactly the end of the 5 minutes, however late the sweep runs. Boundary tests set
`createdAt`/`expiresAt` into the past with SQL instead of waiting or faking a clock.

**Two clocks**: the existing order path (spec 006) checks that sales are open with the Backend's
`new Date()`, while this feature decides every reservation boundary, including "sales closed" on
the reserve path, with the database's `now()`. On the one laptop both containers read the same
host clock, so they agree to well under a second. The only place they meet is `startsAt` itself: a
reservation refused there by the database clock could, within that fraction of a second, still be
orderable by the Backend's clock, and it needs a reservation anyway. Moving `006`'s check to the
database is out of scope; it is noted here so the implementation doesn't mix the two in one rule.

**Alternatives considered**: Application time (`new Date()`): two clocks, and the CHECK couldn't be
stated against them. Deleting expired rows (loses the history R6 needs). A scheduled database job
(`pg_cron`: not in the Postgres image, and a new moving part).

## R4. A one-second sweep ends run-out reservations and tells viewers

**Decision**: `HoldSweeper`, started in `onModuleInit` with `setInterval` (stopped in
`onModuleDestroy`), finds events with run-out active reservations (and seated events whose sales
have closed, R11) through a partial index on `SeatReservation(expiresAt) WHERE "endedAt" IS NULL`.
For each event it runs one transaction that takes the event lock and closes them (R3), then
publishes the freed seats as open (R9). A sweep that finds nothing costs one indexed query.

The interval comes from a Nest provider, `HOLD_SWEEP_INTERVAL_MS`, which is 1000 in the app module.
`createTestApp` overrides it with `0`, which starts no timer, and tests call `sweepOnce()`
themselves. Otherwise a timer in every test app would race the tests that move rows into the past
(a run-out reservation that must still be unclosed, the boundaries, and the publish assertions,
which could receive extra events). The sweep only tells viewers sooner; it is not a security or
correctness control (R3 closes run-out reservations under the lock), so turning it off in tests
skips nothing Principle VIII protects. It is a provider, not an environment variable, so
Principle II's "no new variable" holds.

**Rationale**: Closing under the lock (R3) keeps the rules correct without any sweep, but nobody
would be told when a reservation ran out on an idle event. SC-003 needs viewers to see the seats
open within 2 seconds after the 5 minutes end: a 1-second sweep plus delivery meets that. Nest's
lifecycle hooks and `setInterval` need no new dependency.

**Alternatives considered**: `@nestjs/schedule` (a new dependency for one interval). Jest fake
timers in the Backend tests (they also stop Testcontainers' and Prisma's timers). One timer per
reservation (lost on a Backend restart, and thousands of timers for no gain). Postgres
`LISTEN/NOTIFY` on expiry (Postgres has no time-based notification; something still has to look).

## R5. The reserve path

**Decision**: `POST /events/{id}/reservation` (`reserveSeats`, `customer` role) with
`{ seats: SeatChoice[] }`, 1 to 10 choices. In one transaction:

1. Lock the event (R2) and close its run-out reservations (R3).
2. Refuse a missing event (`404`), a cancelled one (`409 EVENT_CANCELLED`), one whose sales have
   closed (`409 SALES_CLOSED`), and one without reserved seating (`400`).
3. Resolve every seat with the **same rules as an order** (spec 007 FR-008): in the layout, in a
   section for sale, of one tier, not repeated (`400`). The seat resolution in
   `orders.service.ts` moves to `seating/seat-rules.ts` so both paths share it. With an active
   reservation, the new seats must be of its tier, and must not already be in it (`400`).
4. Refuse seats in the 2-minute wait (R6, `409 SEAT_COOLDOWN`).
5. Refuse seats with a valid ticket or another customer's live hold (`409 SEAT_TAKEN`, naming
   every such seat in `details.seats`, with `details.reserved` listing those that are reserved
   rather than sold).
6. Refuse when the reservation would hold more than 10 seats (`400`), or more than the customer
   may still get under `016`, counting valid tickets only (`409 TICKET_LIMIT_REACHED`, with the
   `016` details, `requested` being the seats the reservation would then hold).
7. Insert the reservation if there is none (`201`), or add the holds to the active one, keeping
   its `expiresAt` (`200`). Either way, return the whole reservation.

The request has no `tierId`: the reservation's tier is the tier of the sections its seats resolve
to (`null` for an event without tiers), and the contract says so. An order whose `tierId` differs
from its reservation's tier is `400` by the existing seat rule (its seats are not in that tier's
sections), before the reservation check (R7).

Every refusal reserves nothing (FR-002). After the commit, the new seats are published as reserved
(R9).

**Rationale**: Reusing the order's seat rules means a seat that can be reserved is exactly a seat
that can be ordered, so Confirm purchase never fails on a rule Reserve seats already passed. The
order of steps puts the refusals that need no seat lookups first and makes a refusal name the most
specific cause, matching how spec 007 checks seats before counts (007 research R6). `SEAT_TAKEN`
is reused because, to the customer, a seat someone else has reserved is as unavailable as a sold
one; `details.reserved` lets the app say "reserved" rather than "sold".

**Alternatives considered**: A new code for "reserved by someone else" (a second code the Customer
app would handle identically). `PUT` with the full seat list (adding and removing in one call is
harder to make all-or-nothing and to name refusals for; FR-007 releases separately). A reservation
id in the path (a customer has at most one per event, so the event identifies it).

## R6. The 2-minute wait is computed from ended holds

**Decision**: A customer may not reserve a seat of an event while one of **their** holds on that
seat, for that event, ended with `endReason` in (`EXPIRED`, `RELEASED`, `LOGOUT`) less than 2
minutes ago: `now() < releasedAt + interval '2 minutes'`. The refusal is `409 SEAT_COOLDOWN`, with
`details.seats` (labels) and `details.availableAt` (the latest end + 2 minutes among them). Holds
that ended `BOUGHT` or `CLOSED` (R11) don't count. An index on `SeatHold(eventId, releasedAt)`
serves the lookup, joined to the reservation for `customerSub`.

**Rationale**: FR-004a ties the wait to one customer and one seat, and it ends on its own, so a
query over recent history is the whole mechanism: no timers, no second table. Other customers
aren't affected because the query is per customer. `availableAt` lets the app say when to try
again.

**Alternatives considered**: A `SeatCooldown` table written on every release (a second record of
the same fact). A wait per customer per event, whatever the seat (stricter than FR-004a, and it
would block a customer who simply changes their mind).

## R7. A seated order must come from the customer's own reservation

**Decision**: In `OrdersService.createLocked`, after the existing `requestId` replay check and the
cancelled and sales-closed checks, and after the seats are resolved (R5's shared rules), a seated
order requires every seat to have a live hold in the **caller's** active reservation for the event.
Otherwise:

- a seat with a valid ticket, or a live hold of another customer's, is `409 SEAT_TAKEN`, as in
  spec 007, with `details.reserved` as in R5;
- any other seat is `409 RESERVATION_REQUIRED`, with `details.seats`, and `details.expired: true`
  when the caller's reservation for the event ran out (so the app can say so, FR-006).

On success, the order's holds end with `endReason = 'BOUGHT'` in the same transaction that inserts
the tickets, and the reservation ends if no live hold is left. After the commit, the seats are
published as sold (R9). A `requestId` replay is returned before any reservation check, so a repeat
of a confirmed order still returns it after its reservation has ended (spec 006).

**Rationale**: The clarification makes the 5-minute rule a Backend rule (Constitution IV), so a
direct API call can't skip Reserve seats. Ending the holds and inserting the tickets in one
transaction, under the event lock, means a seat is never both held and sold, and never neither
between the two. Partial orders of a reservation are allowed, and the seats not bought stay
reserved until the 5 minutes end (FR-006).

**Alternatives considered**: An order that names the reservation instead of seats (a second order
shape; the existing `seats` already say which). Refusing an order that buys only part of a
reservation (no rule needs it, and the Customer app always buys all of it).

## R8. Releasing, and releasing on logout

**Decision**:

- `POST /events/{id}/reservation/release` (`releaseSeats`, `customer`) with `{ seats?:
  SeatChoice[] }`: the listed seats, or every seat when `seats` is omitted. The holds end
  `RELEASED`, and the reservation ends when no live hold is left. It returns `{ reservation }`,
  `null` once nothing is left. Seats not in the caller's reservation are `400`. Releasing when
  there is no active reservation is `200` with `null`, so a repeated release is harmless.
- `GET /me/reservations` (`listMyReservations`, `customer`): the caller's active reservations,
  for every event, newest first.
- `POST /me/reservations/release` (`releaseAllMyReservations`, `customer`): ends every active
  reservation of the caller with `LOGOUT`. Returns `{ released }`, the number of seats.
- The shared `AuthProvider` gains an optional `beforeLogout(api)` prop. `logout()` awaits it,
  bounded by 2 seconds, before it clears the user, and goes on even if it fails or times out. Only
  the Customer app passes one: it calls `releaseAllMyReservations`.

**Rationale**: `POST …/release` keeps request bodies off `DELETE`. One endpoint handles both a
single deselect and Release seats (FR-007). `/me/reservations` mirrors `/me/orders`, and is how a
second tab, or a page reload, learns about a reservation it didn't make (spec edge case "Two tabs").
Logout has to call the Backend while the token is still in memory, which only the shared
`AuthProvider` controls; the time bound keeps a dead connection from trapping the customer signed
in, and FR-008's fallback is the 5-minute end.

**Alternatives considered**: `DELETE /events/{id}/reservation/seats/{sectionId}/{row}/{seat}` (one
request per seat for Release seats). Releasing on the Keycloak logout callback (the Backend never
sees Keycloak's logout). Releasing in `beforeunload` (unreliable, and the spec keeps reservations
when the tab closes).

## R9. Live updates: Server-Sent Events over `fetch`, from an in-process bus

**Decision**:

- **Route**: `GET /events/{id}/seats/stream` (`streamSeatMap`, any signed-in user, like
  `getSeatMap`), `text/event-stream`, through Nest's `@Sse()`.
- **On connect**, it sends `event: snapshot` with the full `SeatMap` (R10). After that, it sends
  `event: seats` with `{ eventId, changes: [{ sectionId, row, seat, state }] }`, where `state` is
  `open`, `reserved`, or `sold`, and `event: ping` every 15 seconds. Neither event names a
  customer (FR-014).
- **The stream ends** when the access token expires, so a stream never outlives the token it was
  opened with (Constitution V). The client then reconnects with its current token.
- **Bus**: `SeatEventsService` holds an RxJS `Subject` per event with viewers. Services call
  `publish(eventId, changes)` only **after** their transaction commits. A viewer that is slow or
  gone never delays a write (spec edge case "Many viewers").
- **Client**: `packages/shared/src/web/seat-stream.ts` opens the stream with `fetch`, sending the
  `Authorization: Bearer` header like every other call, and parses the event stream (about 40 lines,
  no dependency). It takes its path from the generated `paths` and its payload types from
  `components['schemas']` (`SeatMap`, `SeatMapChange`), so it is typed by the contract like the
  `openapi-fetch` client, which can't read a stream.
  - **Headers**: only `Authorization` and `Accept: text/event-stream`. The CORS policy allows
    `authorization` and `content-type` (`configure-app.ts`), so `Cache-Control` or `Last-Event-ID`
    would fail the preflight. A CORS test covers the stream.
  - **Reconnect**: when the server ends the stream normally (the planned end at token expiry), it
    reconnects at once with the current token. After a network drop or an error status, it waits
    1, 2, then 5 seconds. With Keycloak's 300-second access tokens, every viewer re-snapshots about
    every 4 to 5 minutes; at laptop scale that is one seat-map query per viewer per 5 minutes.
    After a `404` (the event was deleted) it stops.
  - **Closing**: `close()` aborts the `fetch`. The hook, `useSeatStream(eventId)`, closes it on
    unmount and when `eventId` changes, since a browser allows only 6 connections per host.

  Each reconnect starts with a fresh `snapshot`, which is the catch-up FR-010 requires. The hook
  gives both apps the current `SeatMap`.
- **Deleting the event** completes every stream for it (`SeatEventsService.end(eventId)`, after
  the delete commits).
- **A change to the map's shape** ends the stream too: `updateSeating` (reserved seating on or off,
  a section's tier) and a layout replace (new sections, new ids) end every stream for the event,
  or for each event at the venue, after the commit (R11). A `SeatMapChange` can't carry a new
  shape, so the client reconnects at once, as at token expiry, and the new snapshot carries it.

**Rationale**: Updates flow one way, server to browser, which is what SSE is for. It is plain HTTP,
a `GET` like any other in the contract, with JSON `data`, and `x-sse-events` names each event's
schema, so tests validate payloads from the operation itself (Constitution I, plan Complexity
Tracking). Being plain HTTP, the existing CORS policy (the `authorization` header is already allowed), the auth guard, and
the role metadata apply unchanged. The browser's `EventSource` can't send an `Authorization` header,
and a token in the URL would be written to access logs, so the client reads the stream with
`fetch`, holding the token in memory as Constitution V requires. The front ends call the Backend directly, not through their nginx, so no proxy buffering
sits in the path. A snapshot on every connect makes "catch up after a drop" the same code as "first
load". The Compose stack runs one Backend container, so an in-process bus reaches every viewer.

**Alternatives considered**: WebSockets (two-way, a second protocol and auth handshake, and a new
dependency, for one-way updates). Polling `getSeatMap` every second (meets 2 seconds, but every
viewer polls forever, and each poll is a full seat map). `EventSource` with the token in the query
string (the token ends up in access logs and browser history). Postgres `LISTEN/NOTIFY` as the bus (needed
only with several Backend instances; recorded as the path if that day comes, Constitution VIII).

## R10. The seat map gains reserved seats

**Decision**: `SeatMapSection` gains `reserved: SeatPosition[]`, the seats with a live hold whose
reservation hasn't run out. It is the same for every caller and never says whose (FR-014). The
customer's own reserved seats come from `/me/reservations` (R8), and the apps show them as "yours"
(FR-012). Admin counts: `sold` (as today), `reserved` = `reserved.length`, and open = the rest
(FR-013). `getSeatMap` and the stream's `snapshot` return the same shape.

**Rationale**: One read path for the seat map, the stream snapshot and both apps. Keeping identity
out of the map keeps spec 007's FR-013 untouched. The caller's own reservation is a separate,
role-checked read.

**Alternatives considered**: A per-caller `mine` field in the map (the map would differ by caller,
so the stream would need one snapshot per viewer). Counting reserved seats on the server (the list
already gives it).

## R11. Admin changes and closed sales end reservations, without the wait

**Decision**: These paths end the affected live holds with `endReason = 'CLOSED'`, in the same
transaction, and publish the seats as open after the commit:

- `EventsService.cancel`: every hold of the event;
- `SeatMapService.update` (`updateSeating`): every hold when reserved seating is turned off, and
  the holds in each section whose tier changes;
- `LayoutService` replace: every hold at each event of the venue (this path already locks the
  venue and then its events). Layout **remove** needs nothing: it is already refused while any
  scheduled event at the venue has reserved seating on (`layout.service.ts` `remove`, spec 007),
  so it can never meet a hold;
- `TiersService` create, when it adds the first tier to an event with reserved seating: every
  hold of the event's tierless reservations. Without this, a reservation made while the event had
  no tiers would be stranded (an order now needs a `tierId`, and the sections are unmapped, so
  it is a `400`), and its seats would stay blocked for up to 5 minutes. `assertNoTierlessSales`
  checks tickets only, so it doesn't catch this;
- the sweep (R4): every hold of a seated event once `now() >= startsAt`.

`cancelEvent` also voids the event's valid tickets, so it publishes **every** seat it frees as
open: the held seats and the sold ones.

`updateSeating` and layout replace also end the streams of the events they change, after the
commit, because the seat map's shape changed (R9).

Two paths **remove** rows instead, through `ON DELETE CASCADE`, because the parent row goes:

- `TiersService` delete (allowed only for a tier without orders, spec 005): the reservation rows
  go with the tier, since a reservation with no tier left has nothing to buy. The service reads the
  tier's live holds under the event lock before deleting, and publishes them as open after the
  commit;
- `EventsService` remove (allowed only for an event without orders, spec 005): the reservation
  and hold rows go with the event. It now runs in a transaction that takes `lockEvent` first, so a
  reserve can't slip in between the order count and the delete. After the commit,
  `SeatEventsService.end(eventId)` completes every open stream for the event; a client that
  reconnects gets `404` and stops (R9).

Neither removal starts a 2-minute wait, since the rows it would be computed from are gone, which
matches `CLOSED`. `CLOSED` holds don't start the 2-minute wait (FR-004a). A customer finds out
through the live update, and by a `RESERVATION_REQUIRED` refusal if they confirm anyway.

**Rationale**: FR-016 lists exactly these. Each path already takes the locks it needs (event
delete gains the same event lock every other event write takes), so ending the holds there adds no
new lock order. Ending tierless reservations, rather than refusing the tier, keeps R11's rule that
the admin wins over a 5-minute reservation.

**Alternatives considered**: Refusing the admin change while seats are reserved, as spec 007 does
for sold seats (a 5-minute reservation would block an admin, and the spec chose the admin). Ending
tier-deleted holds `CLOSED` and keeping the rows (the reservation's `tierId` would point at nothing,
or need `SET NULL`, which would make it look tierless).

## R12. Contract first: 1.9.0, with the new operations marked `x-planned`

**Decision**: Contract **1.8.0 → 1.9.0** lands in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated. Its five new operations carry
`x-planned: '015'`. `backend/test/contract/route-coverage.e2e-spec.ts` changes so that an operation
marked `x-planned` may be unimplemented, but **fails** if it is implemented. The implementation PR
therefore has to remove every marker, and from then on the operations are checked like any other.
New fields on existing responses (`SeatMapSection.reserved`) are not in `required`, so the
Backend's response validation passes on `main` before the implementation (as spec 016 R9 did). The
implementation PR adds `reserved` to `required`, in the contract and in
`packages/shared/src/seating.ts`, since its Backend always sends it.

The two new error codes, `SEAT_COOLDOWN` and `RESERVATION_REQUIRED`, go into
`packages/shared/src/errors.ts` in this PR too, as spec 014 did for its five. Spec 013's
`us-states.spec.ts` checks that `ERROR_CODES` has every code of the contract's `ErrorEnvelope`, and
the exception filter would rewrite an unknown code.

Spec 014 (#35) merged first and took 1.8.0 with the same strict `x-planned` rule; this feature
uses its feature-neutral "Planned operations" paragraph, and only adds the "Live streams" one.

**Rationale**: Constitution I wants the contract merged before the code, and Principle III wants
`main` green at all times. Before this, spec 007 added routes in a plan PR that merged with its
implementation the same day. Now a spec PR can sit on `main` for days, and the route-coverage test
fails on any contract operation without a route. The marker is the smallest change that keeps
both rules, and making an implemented-but-marked operation fail means the marker can't be
forgotten.

**Alternatives considered**: A separate contract fragment merged in the implementation PR (the
contract would not be on `main` first, against Constitution I). Stub routes returning `501` (code
in a spec PR, and the stubs would pass route coverage while doing nothing). Skipping the
route-coverage test until the implementation merges (hides any other drift meanwhile).

## R13. Customer app: pick, reserve, confirm

**Decision**: `GetTickets` keeps its tier, section, and seat-picker flow from spec 007, with:

- **States**: *picking* (no reservation), *reserved* (an active reservation, with a countdown),
  and *ran out* (a message, and the picks kept). The picker shows four seat states: open, picked,
  yours (reserved), and Reserved or sold by others.
- **Controls**: Reserve seats (enabled with 1 or more picks not yet reserved; adds them to an
  active reservation), Confirm purchase (only while reserved; orders the reserved seats with the
  usual `requestId`), and Release seats.
- **Countdown**: from the response's `secondsLeft`, against the browser's clock, so a skewed clock
  can't shorten or lengthen it. It is shown as `m:ss`, with `role="timer"`. A timer is not
  announced (its `aria-live` is off), so the 1-minute warning is written once into a separate
  `role="status"` region.
- **Announcements** (FR-012): the FR-011 "no longer available" message goes in a `role="status"`
  region, and the "ran out" message in a `role="alert"` region.
- **Focus**: a seat that becomes unavailable through a live update gets `aria-disabled="true"`
  and ignores clicks, instead of the `disabled` attribute, which would drop keyboard focus to the
  page. Seats that were already unavailable when the map loaded keep `disabled`, as in spec 007.
- **Names**: open "Row N, Seat M"; sold "Row N, Seat M, sold"; another customer's "Row N, Seat M,
  reserved"; the customer's own "Row N, Seat M, reserved by you", so reserved and sold are
  distinct for screen readers.
- **Deselecting** a reserved seat calls `releaseSeats` for it. Picking another tier releases the
  active reservation first.
- **Live**: `useSeatStream` replaces the one-off seat map load. When another customer reserves or
  buys a picked seat, the pick is dropped with a message naming it (FR-011). When a change touches
  one of the customer's own reserved seats, the app reloads `/me/reservations`, which covers
  admin changes and the second tab.
- **Refusals** (`SEAT_TAKEN`, `SEAT_COOLDOWN` with `availableAt`, `RESERVATION_REQUIRED` with
  `expired`, `TICKET_LIMIT_REACHED`) are shown as error states with the picks kept
  (Constitution IV).

**Rationale**: It extends the existing component instead of replacing it, so spec 007, 008 and 016
behavior and tests carry over. The server's `secondsLeft` avoids trusting the browser's clock for
the deadline, while the Backend decides the real end (R3).

**Alternatives considered**: A separate "checkout" page after Reserve seats (more navigation, and
the seat map, which should stay live, would leave the screen). Computing the countdown from
`expiresAt` against the browser's clock (wrong by any clock skew).

## R14. Admin app: reserved seats and counts, live

**Decision**: `SeatGrid` gains a third mark, `◩` for reserved, next to `■` sold and `□` open, with
the spoken label "reserved". `SeatingCard`'s section counts show sold, reserved, and open. The
page reads the seat map through the same `useSeatStream` hook (R9), so it updates live.

**Rationale**: Spec 007's admin map already marks states with text glyphs and spoken labels, which
isn't color alone (FR-012). The shared hook gives the admin view the same live behavior for free.

**Alternatives considered**: Who reserved which seat (out of scope; FR-014).

## R15. Styles come from the shared theme

**Decision**: The Customer app adds `.seat--reserved` (another customer's) and `.seat--mine`
(the customer's own) to its own stylesheet, using theme values only: `.seat--reserved` is a
dashed `--border-strong` outline over the open seat's background, with no fill pattern and a small
`R` mark, so it differs from `.seat--taken`'s 45° stripe in shape, not just by the glyph;
`.seat--mine` is the chosen style plus a clock mark. The countdown and the reservation messages use
the theme's existing `note` and `banner` classes. No new theme value is added.

**Rationale**: Constitution VII and spec 012: app styles may add screens' styles but must use the
theme's values, and 012's drift check, now on `main`, enforces it. Marks, outlines and stripes keep the states
distinguishable without color (spec 008).

**Alternatives considered**: A new theme color for "reserved" (a theme change, and color alone).

## R16. Testing

**Decision**:

- **Backend**, real PostgreSQL through Testcontainers:
  - reserve and add-to rules and every refusal;
  - the 5-minute and 2-minute boundaries, one second before and at each end, with
    `createdAt`/`expiresAt`/`releasedAt` moved by SQL;
  - releases by seat, Release seats and logout;
  - seated orders with and without a reservation, after it runs out, and against another
    customer's;
  - holds ended by cancellation, seating changes, layout replacement and the sales close;
  - 10 simultaneous reservations for one seat, from 10 customers, with exactly 1 succeeding;
  - the database rules below the Backend, with rows inserted by SQL: a second live hold on a
    seat is refused, an ended hold doesn't block, a second active reservation for the same
    customer and event is refused, the `five_minutes` and `end_all_or_none` CHECKs refuse bad
    rows, and the composite foreign key refuses a hold whose event differs from its
    reservation's. `seats.concurrency.e2e-spec.ts` keeps `007`'s below-the-Backend test for
    `ticket_one_valid_per_seat`;
  - and the stream: a real `app.listen(0)`, two readers, a reservation by one customer reaching
    the other reader within 2 seconds, a fresh snapshot on reconnect, no customer identity in any
    event, `401` without a token and with an expired, wrongly signed, or wrong-audience one, the
    CORS preflight from a front-end origin, and the end at token expiry. The sweeper is off in the
    test app and tests call `sweepOnce()` (R4).
- **Front ends**: Vitest with a stubbed `fetch` whose stream body is a `ReadableStream`, for the
  parser, the reconnect and catch-up, every Customer state and refusal, the countdown with fake
  timers, logout releasing, and the Admin marks and counts.
- **Existing seated-order tests** in spec 007 and 016 gain a reserve step through a fixture,
  `reserveThenOrder()` (spec Assumptions).

**Rationale**: Constitution VI: real database for every persistence rule, genuinely concurrent
requests for the guarantee, both sides of each boundary.

**Alternatives considered**: A fake clock in the Backend (the database decides time, R3, so moving
the rows is the honest test).
