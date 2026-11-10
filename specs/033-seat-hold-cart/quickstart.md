# Quickstart: Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends

**Feature**: `033-seat-hold-cart` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it against a stack built from the implementation
branch, on its own Compose project (`-p qp033`), or on path B with Mahdi's go for the team stack's
ports. Each scenario names the requirements it proves. Keep the browser's network panel open: each
seat click should be one `POST …/reservation` or `POST …/reservation/release`.

## S0. A stack of its own, with a seated event

1. Path A: `docker compose -p qp033 up --build`, then `docker compose -p qp033 exec backend node
   backend/dist/scripts/demo-data.js` (README "Demo data"). Path B (this machine): the team's stack
   (Compose project `queuepass-team`) holds the ports. **Ask Mahdi before touching it.** With his
   go: stop its `run-host.mjs` (Ctrl+C in its terminal) and `docker compose -p queuepass-team stop`
   (never `down`, never `-v`); then `docker compose -p qp033 up -d database keycloak` and `node
   scripts/run-host.mjs --demo-data`.
2. In the Admin app as `admin1`, find a seated event on sale at QueuePass Demo Arena (or schedule
   one with reserved seating and two ticket types, Front and Standard). Note its name.
3. Sign in to the Customer app as `customer1` in one browser and `customer2` in another (a private
   window). **Expected**: the top bar has **Cart** after My tickets; the cart is empty: "Your cart
   is empty. Seats you hold on an event's page appear here for 5 minutes."

## S1. Click to hold; the countdown starts once (US1; FR-001 to FR-003, FR-010, FR-016, SC-002)

1. As `customer1`, open the event, choose Standard, and click Row 1, Seat 5.
2. **Expected**: one `POST …/reservation` with that one seat (`201`); the seat shows as yours
   ("Row 1, Seat 5, reserved by you"); a **Your seats** box below the map shows the time left in
   large type, 5:00 or 4:59, the seat, the total, and **Add to cart**; a screen reader (or the
   status region in the accessibility tree) says "Section …, Row 1, Seat 5 held. 4:59 left."
3. Ten seconds later click Seat 6. **Expected**: `200`; both seats in the box; the countdown about
   4:49, not reset.
4. **Expected** nowhere on the page: Reserve seats, Remove, Release, Release seats, Confirm
   purchase, or a Name on tickets field.
5. In `customer2`'s browser, open the same event. **Expected**: Seats 5 and 6 show Reserved.

## S2. Click to let go; the last one ends the countdown (US2; FR-003, FR-004, FR-006, FR-016)

1. As `customer1`, with Seats 5 and 6 held (S1), click Seat 6. **Expected**: one `POST
   …/reservation/release` (`200`); "… Seat 6 released."; the countdown unchanged; `customer2` sees
   Seat 6 open within 2 seconds.
2. Click Seat 6 again at once. **Expected**: `200`, held again, the same countdown (no 2-minute
   refusal).
3. Click Seats 5 and 6. **Expected**: the second release ends the reservation: the Your seats box
   goes away; the announcement says the next seat starts a new 5 minutes.
4. Click Seat 5. **Expected**: refused (`409 SEAT_COOLDOWN`): the alert names Seat 5 and says when it
   can be held again, in the browser's own zone with its abbreviation; nothing held.
5. Click Seat 8. **Expected**: `201`; a new countdown from 5:00.
6. As `customer2`, click Seat 5. **Expected**: held at once (the wait is `customer1`'s only).

## S3. The countdown runs out (US3; FR-015, SC-004)

1. As `customer1`, hold one seat, click **Add to cart**, and wait on the cart page.
2. **Expected**: at 1:00 a status message "1 minute left to buy your seats." once; at 0:00 the event
   leaves the cart within 2 seconds and an alert says the reservation ran out, its seats were
   released, and they can be held again in 2 minutes if still open; `customer2` sees the seat open.

## S4. The same cart in another tab (US4; FR-012, FR-017, SC-005)

1. As `customer1`, hold two seats; open `/cart` in a second tab of the same browser.
2. **Expected**: the same event, seats, and time left (within a second).
3. In the first tab, release one seat on the event page. **Expected**: the second tab's cart shows
   one seat within 2 seconds, without a reload.
4. Sign in as `customer1` in another browser (or on a phone on the same network, path A). **Expected**:
   the same cart.

## S5. Clicking fast (US5; FR-007, FR-008, SC-003)

1. As `customer1` on a fresh event or after S2's seats are released, click ten open seats of one
   ticket type as fast as you can.
2. **Expected**: ten requests, one at a time, in click order; ten seats held; no "Too many tries".
3. Double-click an open seat. **Expected**: it ends open; at most one hold and one release were sent.

## S6. Add to cart, buy from the cart (US1; FR-011, FR-013, FR-014, SC-001)

1. As `customer1`, hold two seats and click **Add to cart**. **Expected**: the Cart page; no request
   was sent by the click; the event's name (a link), date and time in the venue's zone, the ticket
   type and price, the two seats, the countdown in large type, the total, **Change seats**, and
   **Buy tickets**.
2. Type a name on tickets and click **Buy tickets**. **Expected**: one `POST /events/{id}/orders`
   with both seats and the tier; "Order confirmed" with both ticket codes and seats; the event leaves
   the cart; My tickets lists both tickets.

## S7. Several events in the cart (FR-012, FR-013)

1. Hold a seat at two seated events. **Expected**: the cart lists both, newest first, each with its
   own countdown and Buy tickets; buying one leaves the other with its countdown unchanged.

## S8. Ticket types, 10 seats, and the per-customer limit (FR-005, FR-019)

1. With seats held, look at the ticket types. **Expected**: the other types are disabled, with the
   note to release the held seats by clicking them; the section select still works within the type.
2. Hold 10 seats. **Expected**: the other open seats cannot be clicked; the note says a reservation
   holds at most 10 seats.
3. On an event with a per-customer limit of 4 (`016`), hold 4. **Expected**: the `016` note; other
   open seats cannot be clicked.

## S9. General admission unchanged (FR-018)

1. Open a general-admission event. **Expected**: quantity, Name on tickets, and Confirm order on the
   event page as before; nothing appears in the cart.

## S10. Through the API (FR-006, FR-008, FR-021)

1. With a customer token (README "How sign-in works"), hold two seats with `POST
   /events/{id}/reservation`, release one with `POST …/reservation/release`, and hold it again.
   **Expected**: `200` with the same `expiresAt`.
2. Release both, then hold one of them. **Expected**: `409 SEAT_COOLDOWN`, `details.availableAt` the
   reservation's end plus 2 minutes.
3. Send 11 hold requests within 5 seconds. **Expected**: the eleventh is `429 RATE_LIMITED` with
   `details.action: HOLD`. Buy attempts (`POST /events/{id}/orders`) are still refused at the
   fourth within 5 seconds (`details.action: BUY`).

## S11. Sign in, use, sign out (Constitution VI)

Sign in to each front end, use it briefly, and sign out. **Expected**: as before `033`; logging out of
the Customer app with seats held empties the cart (`015` FR-008). Afterwards `docker compose -p qp033
down -v` removes this stack. On path B, restore the team's stack: `docker compose -p queuepass-team
start database keycloak` (only those two) and its `run-host.mjs` from the main checkout.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. The wait's rule, the hold allowance, and
concurrency are covered by the Backend's integration tests against real PostgreSQL (tasks T002 to
T004); the click queue, the countdown, and the cart by the Customer app's tests (T005 to T007).

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: setup by hand; the browser tests make their own venue and events through the API |
| S1 | Automated: `033 S1/S2/S6: a customer holds seats by clicking them, lets one go and takes it back, adds them to the cart, and buys them there` |
| S2 | Automated: `033 S1/S2/S6: a customer holds seats by clicking them, lets one go and takes it back, adds them to the cart, and buys them there`; rest Manual: the 2-minute refusal after the last release is covered by the Backend's tests (T002) and the Customer app's (T005) |
| S3 | Manual: the hold runs out after 5 real minutes; the run-out in the cart is covered by the Customer app's tests (T006) |
| S4 | Manual: a second tab or device by hand; the live cart is covered by the Customer app's tests (T006); other customers' live view by `015 S2` |
| S5 | Manual: the click queue is covered by the Customer app's tests (T005), the allowance by the Backend's (T003) and `026 S2` |
| S6 | Automated: `033 S1/S2/S6: a customer holds seats by clicking them, lets one go and takes it back, adds them to the cart, and buys them there` |
| S7 | Manual: two events by hand; covered by the Customer app's tests (T006) |
| S8 | Manual: the ticket-type lock and the caps are covered by the Customer app's tests (T005) and the Backend's `015` and `016` tests |
| S9 | Manual: general admission is `006 P1/P4`'s browser test, unchanged |
| S10 | Manual: API calls by hand; covered by the Backend's integration tests (T002, T003) |
| S11 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
