# Quickstart: Sell Tickets Until the Event Ends

**Feature**: `034-sell-until-end` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it against a stack built from the implementation
branch, **on its own Compose project** (`-p qp034`), or on path B with the team stack's go-ahead from
Mahdi (tasks, ground rules). It creates venues, events, orders, and seat holds; it deletes nothing.
Each scenario names the requirements it proves. Test accounts and the seed password are in the README.

## S0. Events before, during, and at the end

1. Path A: `docker compose -p qp034 up --build`. Path B: as in the README ("When the images can't be
   built"), on a stack of its own or the team's with Mahdi's go.
2. In the Admin app, as `admin1`, add four venues in Eastern time (any well-formed address; saved not
   verified is fine): **QP034 Hall**, **QP034 Club**, **QP034 Arena**, and **QP034 Studio**. Then
   schedule:
   - **QP034 Now Playing** at QP034 Hall, started 10 minutes ago, ending 2 hours from now, with a
     tier (General, $10, 50) and a per-customer limit of 2.
   - **QP034 Seated Show** at QP034 Club, started 10 minutes ago, ending 2 hours from now, with
     reserved seating (any small layout) and a tier.
   - **QP034 Sold Out** at QP034 Arena, started 10 minutes ago, ending 2 hours from now, capacity 1.
   - **QP034 Short Show** at QP034 Studio, starting 3 minutes from now and ending 10 minutes after
     that, with reserved seating and a tier.
   - **QP034 Coming Soon** at QP034 Hall, 7 days ahead, 7:00 PM to 10:00 PM.
3. As `customer2`, buy the one ticket for QP034 Sold Out.
4. **Expected**: the Admin app accepted the past start times (the Backend has no rule against them).
   Note when QP034 Short Show ends.

## S1. The notice, and buying after the start (US1; FR-001, FR-005, FR-008, FR-009, SC-001, SC-004)

1. Customer app, as `customer1`, open **QP034 Now Playing**. **Expected**: at the top of the Get
   tickets panel, "This event has already started (began at {start} EST). You can still buy tickets
   until it ends at {end} EST.", with the event's own times in Eastern time and no dates (both today
   at the venue); the ticket choices below it, as before the start; no such line under the event's
   name.
2. Choose General, 1 ticket, your name, and confirm. **Expected**: the order is placed.
3. If the venue's local time is within 2 hours of midnight, the end is shown with its date.

## S2. The confirmation and the gate (US1; FR-012, FR-013, SC-006)

1. After S1's order, **Expected**: the confirmation lists the ticket code and says "This event has
   already started (began at {start} EST). Your tickets admit you until it ends at {end} EST."
2. **My tickets**. **Expected**: the order among the upcoming ones, with Show entry code.
3. Ticket Booth, as `agent1`: choose QP034 Now Playing and type the ticket's code. **Expected**: the
   ticket is shown admittable; Admit admits it.
4. Admin app, QP034 Now Playing's Attendees and Sales, and **Reports**. **Expected**: the order and its
   ticket counted like any other (SC-007).

## S3. Before the start, nothing changes (US1; FR-008, SC-004)

1. As `customer1`, open **QP034 Coming Soon**. **Expected**: no "already started" line; tickets offered
   as before. Buy one. **Expected**: the confirmation has no such line.

## S4. Sold out, or at the limit, after the start (US3; FR-010)

1. As `customer1`, open **QP034 Sold Out**. **Expected**: "This event has already started (began at
   {start} EST)." with no "You can still buy tickets", then the "Sold out" badge and message.
2. As `customer1`, buy a second ticket for QP034 Now Playing (the limit is 2), and open its page again.
   **Expected**: the first sentence only, then "You have reached the limit of 2 tickets for this
   event."

## S5. Seats after the start, and holds at the end (US1, US2; FR-003, FR-004, SC-003)

1. As `customer1`, open **QP034 Seated Show** and hold two seats (as `033` makes it: click them).
   **Expected**: held, the countdown starts; buy them (on the page or from the Cart, as `033`
   provides). **Expected**: placed; the confirmation shows the notice's line.
2. About a minute before **QP034 Short Show** ends, open it as `customer3` and hold a seat. **Expected**:
   held, with a countdown of 5:00. As `customer4`, open the same event: the seat shows held.
3. Wait for the end. **Expected**: within a few seconds of the end, before `customer3`'s countdown
   reaches 0:00, `customer4`'s map shows the seat open again, and `customer3`'s page says the reserved
   seats were released.

## S6. At and after the end (US2; FR-002, FR-006, FR-011, SC-002, SC-005)

1. As `customer3`, after QP034 Short Show has ended, press the buy control left on the page from S5 (or
   reload and try). **Expected**: refused, "Sales for QP034 Short Show closed when it ended."; nothing
   is placed; the panel then shows the "Sales closed" badge and "Sales closed: this event has ended."
2. Reload its page. **Expected**: "This event has ended." under its name (`030`), and in the panel the
   badge and "Sales closed: this event has ended."; no "already started" line.
3. If the demo data is loaded (`029`): Season Opener's page says "Sales closed: this event has ended.".

## S7. The API's answers (US4; FR-006, FR-007)

1. With a customer's access token (the browser's network panel on the Customer app shows one), `GET
   http://localhost:3000/events/{id}/availability` for QP034 Coming Soon, QP034 Now Playing, and QP034
   Short Show (after its end). **Expected**: `salesClosed` `null`, `null`, `"ENDED"`; `inProgress`
   `false`, `true`, `false`.
2. In the Admin app cancel QP034 Sold Out; read its availability. **Expected**: `salesClosed:
   "CANCELLED"`, `inProgress: true`; its page in the Customer app says it has been cancelled, with no
   "already started" line.
3. The exact end (SC-002) is the Backend's tests' (`orders.sales-closed.e2e-spec.ts`).

## S8. Sign in, use, sign out (Constitution VI)

Sign in to each front end, use it briefly, and sign out. **Expected**: as before `034`. Afterwards
`docker compose -p qp034 down -v` removes this stack and its data.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. The rule on both sides of the end, holds at
the end, availability, and the late ticket at the gate are covered by the Backend's integration tests
against real PostgreSQL (tasks T002 to T006); the notice and the closed message by the Customer app's
tests (T007).

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: setup by hand; the browser test makes its own venue and event through the API |
| S1 | Automated: `034 S1/S2: a customer buys a ticket for an event that has already started and sees the notice on the panel and the confirmation` |
| S2 | Automated: `034 S1/S2: a customer buys a ticket for an event that has already started and sees the notice on the panel and the confirmation`; rest Manual: the Admin figures by hand (reports unchanged, research R7) |
| S3 | Manual: no notice before the start is covered by the Customer app's tests (T007) |
| S4 | Manual: sold out and the limit after the start are covered by the Customer app's tests (T007) |
| S5 | Manual: the end of a hold needs a real event end; covered by the Backend's tests (T004); seats bought after the start by T002 and T003 |
| S6 | Manual: an end reached while a page is open needs real waiting; the refusal is the Backend's tests' (T002), the closed message the Customer app's (T007), and the demo's Season Opener `029 S2` (T018) |
| S7 | Manual: API calls by hand; covered by the Backend's integration tests (T005) |
| S8 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
