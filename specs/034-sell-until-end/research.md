# Research: Sell Tickets Until the Event Ends

**Feature**: `034-sell-until-end` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-09

The issue (#126) settles the rule and the messages. Every decision below that the issue leaves open
takes the recommended option and records the alternatives, for Mahdi and the team to overturn in
review of the spec PR. The code was read on `main` at `0f35df9` (spec `030`'s implementation merged)
and checked again after rebasing onto `17b3b88` (spec `033` merged; its implementation not yet).

## R1. Where sales close today, and the one change to each

Every place that decides "sales closed" compares the current time with `Event.startsAt`. Each moves
to `Event.endsAt`, with the same comparison (`now >= endsAt` is closed, half-open), and **each keeps
the clock it reads today**:

| Where | Today | After `034` | Clock |
| --- | --- | --- | --- |
| `backend/src/orders/orders.service.ts` `createLocked` (~238) | `new Date() >= event.startsAt` → `409 SALES_CLOSED` "closed when it started" | `new Date() >= event.endsAt` → "Sales for {name} closed when it ended." | the Backend's process |
| `backend/src/reservations/reservations.service.ts` `salesClosed()` (~346) | `SELECT now() >= "startsAt"` | `SELECT now() >= "endsAt"`; its comment "whether the event has ended" | the database |
| `reservations.service.ts` `reserveLocked` (~92) | message "closed when it started" | "closed when it ended." | (uses `salesClosed()`) |
| `backend/src/reservations/hold-sweeper.ts` `sweepOnce` (~62) | `e."startsAt" <= now()` | `e."endsAt" <= now()`; the comment above it | the database |
| `hold-sweeper.ts` `sweepEvent` (~83) | comment "Sales close when the event starts" | "…when the event ends" (the call to `salesClosed()` is unchanged) | the database |
| `backend/src/events/availability.service.ts` (~37) | `CANCELLED`, else `STARTED` from `startsAt`, else `null` | `CANCELLED`, else `ENDED` from `endsAt`, else `null`; plus `inProgress` (R2) | the Backend's process |
| `backend/src/common/event-lock.ts` `LockedEvent` | `startsAt` "Spec 006 FR-014: sales close at this instant" | `endsAt` with "Spec 034 FR-001: sales close at this instant"; `lockEvent` selects `"endsAt"` in place of `"startsAt"` (nothing else reads `LockedEvent.startsAt`) | — |
| `customer-app/src/components/GetTickets.tsx` (~605–617) | `STARTED` → badge "Sales closed", "Sales closed: this event has already started." | `ENDED` → badge "Sales closed", "Sales closed: this event has ended." (R4) | — |
| `packages/shared/src/order.ts` | `SalesClosedReason = 'CANCELLED' \| 'STARTED'` | `'CANCELLED' \| 'ENDED'`, `inProgress: boolean` (R2) | — |

A search of `backend/src`, `customer-app/src`, `admin-app/src`, `booth-app/src`, `packages/shared/src`,
and `scripts/` for `startsAt`, `STARTED`, `salesClosed`, and `SALES_CLOSED` found no other place that
closes sales. The event lists already use `endsAt` (`030`); the Ticket Booth's window is
`[entryOpens, endsAt)` (`backend/src/entry/ticket-state.ts`, `025`); the Admin app shows no
sales-closed state.

**Why keep each clock**: the order check, which runs under the event lock, has always read the
process clock, and the reservation check and the sweep the database's (spec `015` research R3, so the
sweep's query and the lock agree). They run on one machine, so they agree to well under a second;
changing which clock a path reads is not what the issue asks for, and would change `015`'s tested
behavior (Principle VIII). The boundary is tested on both sides with real time (R11).

**Alternatives**: one shared helper that every path calls with one clock (the injectable `Clock`, as
the event list uses since `030`): a test could then stop time exactly at `endsAt`; but the reservation
path decides in SQL under its lock, and the sweep selects due events in SQL, so a process clock there
would be a second source of "now" next to the database's; rejected. A configurable offset (close N
minutes before the end): not asked for; rejected.

## R2. The contract: `ENDED` in place of `STARTED`, and `inProgress`

**Decision**: `Availability.salesClosed` says `ENDED` from `endsAt` on, and `STARTED` is no longer
sent. `Availability` gains a boolean `inProgress`: `startsAt <= now < endsAt`, by the same clock as
`salesClosed` in the same answer (the process clock, R1), whatever the event's status. The
`createOrder` and `reserveSeats` descriptions, a new **Sales window** paragraph in `info.description`,
`getEventAvailability`'s description, and the `SALES_CLOSED` example ("Sales for Season Opener closed
when it ended.") say so. Contract **1.25.0 → 1.26.0** (MINOR).

**In two steps, as PR #151 proposes for `032`** (not yet a merged precedent: `032`'s merged contract
README says only that the implementation "always sends" its fields), so `main` stays green between
the PRs (every response the Backend's tests receive is checked against the contract,
`backend/test/setup/authed-request.ts`):

1. **This PR**: the enum is `[CANCELLED, ENDED, STARTED, null]`, with `STARTED` described as sent only
   before `034` is implemented; `inProgress` is listed but not required. `api-schema.ts` is
   regenerated. `packages/shared/src/order.ts` widens `SalesClosedReason` to `'CANCELLED' | 'ENDED' |
   'STARTED'` and adds `inProgress?: boolean`, because the Customer and Admin apps assign the
   generated availability to that type and their builds fail otherwise (checked with `tsc --noEmit`
   against this branch's `packages/shared`).
2. **The implementation PR**: `STARTED` leaves the enum and its description, `inProgress` is listed
   in `required`, `api-schema.ts` is regenerated, and `order.ts` narrows to `'CANCELLED' | 'ENDED'`
   and `inProgress: boolean`; the version stays 1.26.0 (as `032`'s implementation, PR #151, open,
   proposes to make its field required at 1.24.0). This is a shared-surface change in the
   implementation PR, and every team member approves it there.

Keeping 1.26.0 in the implementation is acceptable under Principle I because the contract text
approved in this PR already announces the final shape: `STARTED` is described as never sent once
`034` is implemented and to be removed by that implementation, and `inProgress` as always sent and
required then. The implementation changes no behavior the reviewed contract does not already state.

**Why `ENDED` rather than keeping `STARTED`**: a value named for the start that is sent at the end would
mislead every reader of the contract. Every client is in this repository and changes in the same PR,
and only the Customer app reads the value (the Admin app reads availability for its tickets sold only,
`admin-app/src/api/seating.ts`).

**Why `inProgress` from the Backend** (the issue asks): the panel must never say "you can still buy" in
the same view where the Backend has already closed sales. With both values in one answer, by one clock,
they cannot contradict each other. `030` chose the opposite for its "Ended" label (its research R6: no
new field), but that label decides nothing about buying; here the notice is a promise about sales.

**Alternatives**: a `startedAt` or `salesCloseAt` instant: the event already carries `startsAt` and
`endsAt`; a flag is all the panel needs. A richer `salesState` enum (`OPEN`, `IN_PROGRESS`, `ENDED`,
`CANCELLED`) replacing `salesClosed`: a larger break for the same information; rejected. The panel
working "in progress" out from `startsAt` and its own clock, as `030` does for "Ended": rejected for the
reason above, and the issue's question suggests the flag.

## R3. Seat holds: end at the end, `expiresAt` unchanged

**Decision**: the sweep (`hold-sweeper.ts`) finds events with an open reservation that has run out
**or whose `endsAt` has been reached**, and ends what is still held there with reason `CLOSED`, through
the unchanged `closeHolds`; `salesClosed()` (R1) is the check, so the sweep and `reserveSeats` share
one rule. A reservation open at the start is not touched by the sweep. The partial index
`seat_reservation_open_by_expiry` serves the run-out half of the query as before; the `endsAt` half
joins `Event` as the `startsAt` half did. `CLOSED` holds start no 2-minute wait (`033`), as today.

**`expiresAt` is not shortened** to the end: the database requires `expiresAt = createdAt + 5 minutes`
(`seat_reservation_five_minutes`), and the same happens today at the start. A reservation made 2
minutes before the end is ended at the end by the sweep, and the Customer app learns it from the live
reservation list, as it does today for one ended at the start ("Your reserved seats were released."),
then shows the closed message on its next load of availability (spec Edge Cases).

**Alternatives**: cap `expiresAt` at `endsAt`: breaks the 5-minute CHECK and `015`'s fixed countdown;
rejected. Refuse a new reservation in the last 5 minutes: not asked for, and it would close sales early
for seated events only; rejected.

## R4. The Get tickets panel

**Decision** (FR-008 to FR-011), in `customer-app/src/components/GetTickets.tsx`:

- **Closed** (no form): `CANCELLED` → badge "Cancelled", "No tickets: this event has been cancelled."
  (unchanged); `ENDED` → badge "Sales closed", "Sales closed: this event has ended."; sold out and no
  seats on sale unchanged.
- **The notice**, a paragraph at the top of the panel, under its heading and above everything else
  (the price, the refusals, the form or the closed message), shown when `inProgress` is true and
  `salesClosed` is `null`: "This event has already started (began at {start})." followed, when the
  panel offers a way to get tickets (`closed` and `reached` are both empty, as the component already
  computes them), by " You can still buy tickets until it ends at {end}." A plain paragraph, not an
  alert or live region: it is page content, read in order before the form.
- **The times** (FR-009): `{start}` is `formatEventEnd(loadedAt, startsAt, zone)` and `{end}`
  `formatEventEnd(loadedAt, endsAt, zone)`, from `@queuepass/shared` (spec `020` research R9: "10:00
  PM EST" on the reference instant's local date, "Nov 21, 2026, 1:00 AM EST" otherwise), where
  `loadedAt` is the time the panel's availability loaded (kept with it, as `030`'s `EventDetail` keeps
  its own) and `zone` the venue's (`event.location.timeZone`, defaulting as `format.ts`'s `when` does). A
  small `startedNotice(...)` helper in `customer-app/src/format.ts` builds both sentences, so the panel
  and the confirmation (R5) say the same thing.
- **Once on the page**: the notice is not repeated under the event's name in `EventDetail.tsx`, where
  `030`'s "This event has ended." stays (spec Clarifications).
- **One clock for the page once availability has loaded** (FR-017, decided in spec review round 1):
  `EventDetail.tsx` shows "This event has ended." from `hasEnded(e.endsAt, loadedAt)` (`030`
  research R7, the browser's clock). Once `GetTickets` has loaded availability, it tells the page (a
  callback prop such as `onSales({ ended, inProgress })`, called on every load), and the line then
  shows exactly when `salesClosed === 'ENDED'`, and never while `inProgress` is true. Before the
  first load the page keeps `030`'s rule, so a past event's page says it has ended at once. A
  browser clock a few minutes fast near the end can therefore no longer show "This event has ended."
  above a panel offering tickets. `030` FR-014 carries a dated note.

**Why at the panel's top**: that is where the customer decides to buy; the panel already loads
availability, so the page needs no second request. Under the name it would need availability in
`EventDetail.tsx` too, or the browser's clock (R2).

**Alternatives**: an alert (`role="alert"`): it would be announced on every load of availability
(after each refusal), which is noise; rejected. The notice inside the form only: it would vanish when
the panel shows sold out, where its first sentence is still useful; rejected.

## R5. The confirmation

**Decision** (FR-012): when `Date.parse(order.createdAt) >= Date.parse(event.startsAt)`, the
confirmation shows, under its heading, "This event has already started (began at {start}). Your
tickets admit you until it ends at {end}.", with R4's times, using the order's `createdAt` as the
reference instant. Both instants are the Backend's (the order's creation and the event's start), so
nothing new is read. Today the confirmation is `Confirmation` in `GetTickets.tsx`; `033`'s
implementation moves it to `customer-app/src/components/OrderConfirmation.tsx`, shared by the event
page and the cart, and the line goes wherever it lives when this feature is implemented (R10).

**Why "admit you until it ends"**: after the start, what the buyer needs next is how long the ticket
gets them in, and the Ticket Booth admits it until the end (R6). "You can still buy tickets" would be
wrong after buying.

## R6. The Ticket Booth: unchanged

`stateCase` (`backend/src/entry/ticket-state.ts`) admits a valid, unused ticket of the gate's event
while `entryOpens <= now() < endsAt` (`025` FR-011); when the ticket was bought plays no part. A ticket
bought after the start is therefore admitted until the end with no change. One Backend test pins it
(R11): an order placed after the start, then `lookupEntryTicket` and `admitTicket` for it, admitted.
Live codes (`018`) are offered on My tickets for orders of events not ended (`030`), so a late buyer
can show one at once.

## R7. Everything else that might care: unchanged

- **Event lists** keep an event until `endsAt` (`030` FR-002); an in-progress event is listed and now
  on sale. The issue's "listings that hide events once they've started" is already satisfied.
- **My tickets** shows an order among the upcoming ones, with its entry code, until its event ends
  (`030`); **Add to calendar** is offered until the end (`019`).
- **Reports and exports** (`005`, `023`) count valid tickets and orders whenever placed; nothing filters
  by the start. **Check-in retention** (`032`) counts from `endsAt`.
- **The per-customer limit** (`016`) and **the attempt limits** (`026`, `033`'s hold pair) count orders
  and holds whatever the time; their tests need no change.
- **The Admin app** shows no sales-closed state; its seating screen reads availability only for
  tickets sold (`admin-app/src/api/seating.ts`). No change.

## R8. Demo data and existing tests that assume sales close at the start

- **Demo data** (`backend/src/scripts/demo-data.ts`, `029`): unchanged events and times. Demo
  Tonight starts 1 hour after the run and ends 4 hours after it, so it is on sale throughout and
  shows the notice from its start; Season Opener, over, shows "Sales closed: this event has ended.".
  The comment on Season Opener ("Sales closed at its start (006), so it has no tickets.") becomes
  "Sales closed at its end (034); the demo places no order for it." No demo event is moved into
  progress at load: Demo Tonight's 1 hour before its start is what makes its check-in window open at
  once (`017` research R13, `025`), and moving it would change `029`'s state and tests (Mahdi to
  confirm). The notice can be seen on Demo Tonight from 1 hour after a reset, or at once on any
  event an admin schedules with a start in the past (quickstart S0).
- **`e2e/tests/029-demo-checkpoint.spec.ts`** expects "Sales closed: this event has already started."
  on Season Opener; it becomes "Sales closed: this event has ended.".
- **`backend/test/integration/orders.sales-closed.e2e-spec.ts`**: rewritten for the end (R11); its
  "repeated requestId after the event starts" case becomes "after it ends" (moving `endsAt`, and with it
  `startsAt` and `doorsOpenAt`, into the past by SQL as it does today for the start).
- **`reservations.e2e-spec.ts`** "is 409 SALES_CLOSED once the event has started" → "once it has
  ended", plus a hold for an in-progress event succeeding.
- **`reservations.admin-changes.e2e-spec.ts`** "the sweep ends every hold once the event has started"
  → "…once it has ended", plus a hold kept by the sweep after the start.
- **`availability.e2e-spec.ts`**: `STARTED` → `ENDED` for an ended event; `null` and `inProgress: true`
  for one in progress; `inProgress` on every case.
- **`customer-app/test/purchase-unavailable.test.tsx`**: its started-event fixture becomes an ended
  one (`ENDED`), and the notice cases are added (R11). It has three stale spots: the test "shows
  Sales closed, and no form, once the event has started" (~line 90, `STARTED` and "…already
  started."), the status-badge table row `{ salesClosed: 'STARTED' }` (~118), and the refusal stub
  "Sales for Early Show closed when it started." (~130).
- The README's "Getting tickets" paragraph ("events that have started say why tickets aren't
  available; sales close when an event starts") and `006`'s status-row summary are reworded in the
  implementation PR.

## R9. Spec amendments

Dated notes (`_Amended 2026-11-09 by spec 034 (#126) …_`), in this PR: `006` US2's narrative and
scenario 6, its edge case "Event starts while a customer is confirming", FR-014, and SC-004; `007`'s
edge case "Events that started or were cancelled"; `015`'s "Sales closed" edge case and FR-016;
`030`'s clarification leaving the panel to `#126`, and its FR-014 for FR-017 (R4); `033`'s edge
cases on ended events in the cart and on a reservation that ends elsewhere ("the event starts"), its
"Issue #126" line, and its coordination assumption ("not yet specced"). `029`'s spec says Season
Opener's sales are closed, which stays true.

## R10. Coordination with work in flight

- **`033`'s implementation** (branch `033-seat-hold-cart-impl`, started after `033` merged as
  `17b3b88`) rewrites the seated half of `GetTickets.tsx`, moves `confirm()` to `use-buy.ts` and
  `Confirmation` to `OrderConfirmation.tsx`, adds `pages/Cart.tsx`, and changes the wait query
  (`assertNoWait`) in `reservations.service.ts`. This feature touches, in those files, only the panel's
  top and closed messages, the confirmation's one line, `salesClosed()` and the one message in
  `reserveLocked`. **Expected order: `033`'s implementation merges first**; this feature's
  implementation then starts from (or is rebased onto) `main` with it, puts the confirmation line in
  `OrderConfirmation.tsx` (so the cart's confirmation shows it too), and updates `033`'s browser test
  only if it asserts a sales-closed text (it does not today). **If this feature's implementation merges
  first**, `033`'s implementation keeps both: the notice and closed messages at the panel's top, and the
  confirmation line moved with `Confirmation`; and its reservation changes keep `salesClosed()` on
  `endsAt`.
- **`032`'s implementation** (PR #151) makes `checkInDetailsRemovedAt` required (contract stays 1.24.0)
  and regenerates `api-schema.ts`. It touches neither sales nor the panel. Whichever of it and this
  feature's PRs lands second keeps both contract changes, regenerates `api-schema.ts`, and reruns
  `check-contract-drift`.

## R11. Tests (written first, Constitution VI)

- **Backend** (Jest, Testcontainers PostgreSQL), events made relative to the real time through the API
  on venues of their own, so the 60-minute rule never meets them:
  - `orders.sales-closed.e2e-spec.ts` (rewritten, "Sales close at the end time"): an order for an event
    that started 1 minute ago succeeds (`201`); one for an event ending 10 seconds from now succeeds
    (just before the end); an event moved by SQL so `endsAt` is 1 second in the past (and `startsAt`,
    `doorsOpenAt` before it) refuses with `409 SALES_CLOSED`, message "Sales for {name} closed when it
    ended.", and no order recorded; the same with `endsAt` set to the test's own time just before the
    request (at the end; the process clock, as the order check reads, not the database's `now()`);
    cancelled in progress → `EVENT_CANCELLED`; a repeated `requestId` after the end returns the earlier
    order (`200`).
  - `reservations.e2e-spec.ts`: a hold for an event in progress → `201`; one for an event ending in
    10 seconds → `201` (just before the end); an ended event → `409 SALES_CLOSED` with the new
    message.
  - **The boundary**: with real time, "at the end" is tested as the end just reached (the end set to
    the test's own time immediately before the request, so the request arrives at or a few
    milliseconds after it), and "before" as a few seconds before. "One millisecond before" cannot be
    tested without a clock the tests can stop in every path, which R1 does not add.
  - `reservations.admin-changes.e2e-spec.ts` (or a new `reservations.sales-end.e2e-spec.ts`): a
    reservation on an event moved into progress by SQL survives `sweepOnce()`; moved past its end, the
    next `sweepOnce()` ends it `CLOSED` and publishes its seats open.
  - `availability.e2e-spec.ts`: ahead `{ salesClosed: null, inProgress: false }`; in progress `{ null,
    true }`; ended `{ 'ENDED', false }`; cancelled in progress `{ 'CANCELLED', true }`; each matches the
    contract.
  - `entry.*.e2e-spec.ts`: a ticket bought after its event's start is looked up `ADMITTABLE` and admitted.
  - `demo-reset.e2e-spec.ts` and the demo-data tests: unchanged unless they assert the old text.
- **Customer app** (Vitest, React Testing Library), `purchase-unavailable.test.tsx` and a new
  `started-notice.test.tsx`: in progress → the notice with both sentences, times in the venue's zone
  with its abbreviation, the end with its date past local midnight; sold out or at the limit → only
  the first sentence; cancelled in progress → no notice; ahead → no notice; ended → "Sales closed"
  and "…has ended."; the notice is not in the event page's header; with the browser clock set a few
  minutes after the end but availability saying `{ null, inProgress: true }`, the page shows no
  "This event has ended." line (FR-017), and with availability `ENDED` it shows it; a confirmation
  for an order whose `createdAt` is after the start shows its line, one before shows none;
  `format.test.ts` for the helper; `npm run test:tz` runs them in several zones.
- **Browser** (`e2e/tests/034-sell-until-end.spec.ts`, Playwright against the `qpe2e` stack): `034
  S1/S2: a customer buys a ticket for an event that has already started and sees the notice on the
  panel and the confirmation`: an admin makes an event at a venue of its own that started 10 minutes
  ago and ends in 2 hours; a customer opens its page, sees the notice, buys one ticket, and sees the
  confirmation's line; the ticket is admitted through the API as a gate agent. `029 S2`'s text changes
  (R8).

## R12. Constitution and versions

Constitution **3.9.5 → 3.9.6** (PATCH, roadmap row `034-sell-until-end`, next free `035`), on top of
`033`'s 3.9.5, merged as `17b3b88`. Contract **1.25.0 → 1.26.0** (R2), on top of `033`'s 1.25.0.
No principle changes: the rule stays in the Backend (IV), the contract leads (I), tests come first (VI).
