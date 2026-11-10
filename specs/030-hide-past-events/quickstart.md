# Quickstart: Hide Past Events

**Feature**: `030-hide-past-events` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it against a stack built from the implementation
branch, **on its own Compose project** (`-p qp030`), or on path B with the team stack's go-ahead from
Mahdi (tasks, ground rules). It creates venues, events, and an order; it deletes nothing. Each scenario
names the requirements it proves. Test accounts and the seed password are in the README.

## S0. Events on both sides of their end

1. Path A: `docker compose -p qp030 up --build`. Path B: as in the README ("When the images can't be
   built"), on a stack of its own or the team's with Mahdi's go.
2. In the Admin app, as `admin1`, add three venues, **QP030 Hall**, **QP030 Club**, and **QP030
   Arena** (any well-formed address; saved not verified is fine), each in Eastern time. Then schedule:
   - **QP030 Ended Show** at QP030 Hall, yesterday, 7:00 PM to 10:00 PM, with a tier (General, $10).
   - **QP030 Coming Soon** at QP030 Hall, 7 days ahead, 7:00 PM to 10:00 PM, with a tier.
   - **QP030 Now Playing** at QP030 Club, started 30 minutes ago, ending 2 hours from now.
   - **QP030 Short Show** at QP030 Arena, starting 5 minutes from now and ending 15 minutes after
     that, with a tier.
3. Within the 5 minutes, in the Customer app as `customer1`, buy one ticket for QP030 Short Show, and
   one for QP030 Coming Soon. Then wait until QP030 Short Show has ended (about 20 minutes after step 2).
4. **Expected**: the Admin app accepted the past times (the Backend has no rule against them). Note
   the time QP030 Short Show ends.

## S1. Customers see only events that have not ended (US1; FR-002, FR-014, SC-001, SC-002)

1. Customer app, as `customer1`, **Events**. **Expected**: QP030 Coming Soon and QP030 Now Playing are
   listed; QP030 Ended Show and QP030 Short Show are not; no control offers past events.
2. Search "QP030". **Expected**: the same two. Filter by venue QP030 Hall: QP030 Coming Soon only.
   Filter From yesterday To today: QP030 Now Playing only. Clear.
3. **Venues** → QP030 Hall. **Expected**: QP030 Coming Soon only. QP030 Arena: "Nothing is scheduled
   here."
4. If the demo data is loaded (`029`'s Season Opener, over): it is not listed either.

## S2. A past event's page still opens (US2; FR-007, FR-014, SC-005)

1. In the Admin app copy QP030 Ended Show's address; in the Customer app open
   `/events/<its id>`. **Expected**: the page opens with its name, venue, and times, and says
   **"This event has ended."** under the name; its Get tickets panel says sales are closed.
2. Open QP030 Now Playing's page. **Expected**: no "has ended" line.

## S3. My tickets keeps past tickets under Past (US2; FR-015, FR-016, SC-005)

1. As `customer1`, **My tickets**. **Expected**: QP030 Coming Soon's order first, with "Show entry code"
   and "Print ticket"; then a **Past** heading and QP030 Short Show's order, with its ticket "Valid",
   "Print ticket", and no "Show entry code" and no Add to calendar.
2. Its name opens its page, which says "This event has ended."
3. As `customer2` (no orders): "You have no tickets yet." and no Past heading.

## S4. The Admin Events page hides past events until asked (US3; FR-008, FR-009, FR-011, SC-001, SC-004)

1. Admin app, as `admin1`, **Events** from the menu. **Expected**: QP030 Coming Soon and QP030 Now
   Playing listed, QP030 Ended Show and QP030 Short Show not; the page says past events are hidden;
   Show past events is off.
2. Turn **Show past events** on. **Expected**: the list updates without pressing Search; all four are
   listed, soonest start first, QP030 Ended Show and QP030 Short Show each with **Ended**; the address
   ends with `past=1`.
3. Reload. **Expected**: still on, the same list. Open QP030 Ended Show and press Back: still on.
4. Search "QP030 Ended", then **Clear**. **Expected**: the search is cleared; the toggle stays on.
5. Turn it off; search with From a week ago and To yesterday. **Expected**: nothing listed, and the page
   says past events are hidden and to turn on Show past events to include them.
6. Turn it on, then open **Events** from the menu. **Expected**: off again.

## S5. The venue pages (US3; FR-008 to FR-010)

1. **Venues** → QP030 Hall. **Expected**: QP030 Coming Soon only, "Past events are hidden."; with its
   Show past events on, QP030 Ended Show too, marked Ended.
2. QP030 Arena, toggle off. **Expected**: no events listed, and past events hidden said. Press
   **Delete**. **Expected**: refused: 1 event is still scheduled there (the past one).
3. Edit QP030 Arena and choose another time zone, without saving. **Expected**: the note that changing
   the zone moves its events' times appears (its only event is past). Cancel.

## S6. A past event's Admin pages and Reports (US3; FR-007, FR-011, FR-013, SC-006)

1. Open QP030 Ended Show (from the list with the toggle on). **Expected**: its page with **Ended** by
   its name; Attendees opens; the exports download.
2. QP030 Short Show's page: Ended; its Attendees lists `customer1`'s ticket; the Sales card shows its
   sale.
3. **Reports**. **Expected**: every QP030 event listed with its figures, the past ones included; QP030
   Short Show's name opens its page.
4. QP030 Now Playing's page: no Ended.

## S7. The Ticket Booth is unchanged (FR-017, SC-007)

1. Ticket Booth, as `agent1`. **Expected**: QP030 Now Playing offered (its check-in window is open);
   QP030 Coming Soon listed, not yet open; QP030 Ended Show and QP030 Short Show not offered: as before
   this feature.

## S8. The API's rule (US4; FR-001 to FR-006, SC-003)

1. With an admin's access token (the browser's network panel on the Admin app shows one in a request's
   `Authorization` header), `GET http://localhost:3000/events?q=QP030`. **Expected**: Coming Soon and
   Now Playing.
2. `…&includePast=true`. **Expected**: all four, soonest start first. `…&includePast=false`: two.
3. `…&includePast=yes`. **Expected**: `400 VALIDATION_FAILED` naming `includePast`.
4. The exact-end boundary (SC-003) is the Backend's tests' (`events.past.e2e-spec.ts`), with a clock set
   to the millisecond.

## S9. Sign in, use, sign out (Constitution VI)

Sign in to each front end, use it briefly, and sign out. **Expected**: as before `030`. Afterwards
`docker compose -p qp030 down -v` removes this stack and its data.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. The Backend's rule, its boundary, and the
parameter's refusals are covered by the Backend's integration tests against real PostgreSQL (tasks
T002); each app's behavior by its Vitest tests (T003 to T006).

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: setup by hand; the browser tests make their own venue and events through the API |
| S1 | Manual: until T007 adds `030 S1/S2: the Customer app leaves an ended event out of the list, a search, and its venue page, and its own page says it has ended` |
| S2 | Manual: until T007 adds `030 S1/S2: the Customer app leaves an ended event out of the list, a search, and its venue page, and its own page says it has ended` |
| S3 | Manual: an order for an ended event cannot be placed through the rules in a test's time (sales close at the start, `006`); My tickets' Past section is covered by the Customer app's tests (T006) |
| S4 | Manual: until T007 adds `030 S4/S6: the Admin app hides an ended event until Show past events is on, marks it Ended, and its page, attendees, and Reports row open` |
| S5 | Manual: the venue page's toggle and the venue form's note are covered by the Admin app's tests (T003); the delete refusal by `002`'s |
| S6 | Manual: until T007 adds `030 S4/S6: the Admin app hides an ended event until Show past events is on, marks it Ended, and its page, attendees, and Reports row open`; exports and the Sales card by hand |
| S7 | Manual: the Ticket Booth's list is `025`'s browser test, unchanged |
| S8 | Manual: API calls by hand; covered by the Backend's integration tests (T002) |
| S9 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
