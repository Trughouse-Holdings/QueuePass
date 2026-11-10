# Feature Specification: Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends

**Feature Branch**: `033-seat-hold-cart-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#135](https://github.com/Trughouse-Holdings/QueuePass/issues/135) (seated events: click a
seat to hold it, Add to cart, buy from the cart before the 5-minute countdown ends). It supersedes
[#131](https://github.com/Trughouse-Holdings/QueuePass/issues/131) (no Reserve seats button; the hold
starts when a seat is clicked), closed as covered; #131's questions carry over.

**Input**: User description: issue #135, filed by Dr. Squyres, also on Nate's list for the week of
Nov 8: "Cart Hold Countdown Timer: refactor seat selection so selecting a seat immediately places a
5-minute hold across sessions, releasing inventory automatically if checkout is not completed". The
seat map is the only control for choosing seats: clicking an open seat holds it, clicking it again
releases it; there is no Reserve seats, Remove, Release, or Release seats button. A 5-minute
countdown starts with the first held seat, keeps running as seats are added, resets when every seat
is released, and is shown prominently the whole time seats are held, in the cart too. An Add to cart
button puts the held seats in a cart; tickets are bought from the cart; if the countdown runs out
first, the seats are released, removed from the cart, and the customer is told. Done when specs 007
and 015 are amended or superseded, with Customer app tests, Backend tests for any contract change,
and the seated-purchase browser test clicking seats, Add to cart, and buying from the cart. The
roadmap number is reserved by this PR's amendment (Constitution 3.9.5).

## Context

Builds on `007` (seat selection: a tier, a section, seats on a map; one tier per order), `015` (seat
holds: a reservation of 1 to 10 seats of one tier per customer per event, exactly 5 minutes from when
it is made and never extended, added to with its end unchanged, released by seat or all at once and
on logout, a 2-minute wait before the same customer can hold a seat they let go, live seat changes,
and seated orders only from the customer's own reservation), `016` (tickets per customer), `017` (the
name on tickets), `020` (times in the venue's zone, and the viewer's own zone for the 2-minute wait),
and `026` (attempt limits: holding seats is limited per account, releasing never is).

Today, on a seated event (`GetTickets.tsx`, `015` research R13):

1. clicking a seat only **picks** it, in the browser; nothing is held and nobody else sees it;
2. **Reserve seats** holds the picks and starts the 5 minutes, and is pressed again to add more;
3. **Remove** (a pick), **Release** (a held seat), and **Release seats** (all) undo them, beside the
   map, which also releases a held seat when it is clicked;
4. the countdown is one line of text, "Time left to confirm: 4:12", in the "Reserved for you" box;
5. **Confirm purchase**, in that box, buys the held seats.

The Backend already holds seats one request at a time: the first request makes the reservation, each
later one adds to it with its end unchanged, and a release of the last seat ends it. What changes is
mostly the Customer app. Two Backend rules change because each click is now a request: the 2-minute
wait (a released seat can be clicked again while the reservation goes on) and the hold allowance.

## Clarifications

### Session 2026-11-09

The issue settles what the customer sees and does. Every question it leaves open below took the
recommended answer, written unattended and recorded here as **recommended answer, open to review**,
so Mahdi and the team can overturn it in review of the spec PR.

- Q: Where does the cart live: in the Backend, or only in the browser? → A: **The cart is the
  customer's active reservations, which the Backend already keeps.** Nothing new is stored. A
  refresh, another tab, another device, or signing in again shows the same cart, and other customers
  see the held seats as Reserved, live: what Nate's "a 5-minute hold across sessions" asks for. A
  cart in the browser's storage would be lost on another device and could disagree with the holds
  the Backend enforces (recommended answer, open to review) (FR-012; research R1).
- Q: What does Add to cart do, then? → A: **It opens the Cart page.** The held seats are already the
  cart; there is no separate "in the cart" state, so seats held and not yet "added" show in the cart
  too (a customer who wanders off finds them there). A Backend flag for "added to cart" would add a
  contract operation and a column and change nothing the customer can do (recommended answer, open
  to review) (FR-011; research R1).
- Q: One event at a time, or seats from several events in one checkout? → A: **The cart lists every
  event the customer holds seats for, each bought on its own**, with its own countdown and its own
  Buy tickets button. A customer could always hold seats for several events (`015`: one reservation
  per event), so the cart shows what they hold. One checkout for several events is deferred: an
  order is for one event (`005`), and combining them is a new kind of order (recommended answer,
  open to review) (FR-013, FR-014; Out of scope; research R2).
- Q: Do general-admission events go through the cart? → A: **No; unchanged.** They have no hold and
  no timer: a quantity, the name, and Confirm order on the event page, as `006`. Holding a quantity
  of tickets would be a new kind of hold (recommended answer, open to review) (FR-018; research R2).
- Q: What does the timer cover? → A: **One countdown per reservation, that is per event**, exactly
  as the Backend keeps it: 5 minutes from the first held seat, never extended; more seats join with
  the same end; releasing the last seat ends the reservation, and the next click starts a new 5:00
  (FR-003, FR-004; research R3).
- Q: Gaming the reset: releasing everything restarts the 5 minutes; is the 2-minute wait enough? →
  A: **Yes, with the wait counted from the reservation's end and covering every seat it held.**
  Today a seat released by clicking it waits 2 minutes even while the reservation goes on, so a
  mis-click on a held seat would lose it for 2 minutes, which click-to-hold makes common. So: **a
  seat released while the reservation still holds other seats can be clicked again at once**
  (it rejoins the same reservation, whose end does not change, so nothing is gained); **once the
  reservation ends** (its last seat released, its 5 minutes run out, or logout), **every seat it
  held and did not sell waits 2 minutes from that end** for this customer; others can take them at
  once. Releasing seats one by one and then the last cannot free some of them early, so no seat can
  be kept past its 5 minutes by restarting (recommended answer, open to review) (FR-006; research
  R4).
- Q: Rate limits (`026`): each click is a hold request; does normal clicking meet the limit of 10 a
  minute and 3 in any 5 seconds? → A: **It would**: a customer clicking four seats in four seconds is
  refused on the fourth. So **seat holds get their own allowance, 30 attempts a minute and 10 in any
  5 seconds**, two new settings beside the buy pair, which keeps 10 and 3; and **the app sends one
  hold request per click, one at a time, in click order**. Releases stay unlimited. Batching clicks
  into one request is not needed at these numbers and is deferred. This replaces Mahdi's `026`
  decision 2 for holds only (**decided by Mahdi, 2026-11-09**: holds 30 a minute and 10 in any 5
  seconds; buying keeps 10 and 3) (FR-008, FR-009, FR-021; research R5).
- Q: Clicks while a request is in flight? → A: **Queued in order, never the same seat twice**: a
  second click on a seat whose hold is still queued cancels it before it is sent; a click on a seat
  whose hold is in flight releases it once the hold is answered; when an action on a seat is refused
  or unanswered, the opposite action queued behind it for that seat is dropped; the seat shows
  "holding" meanwhile (FR-007; research R6).
- Q: Changing the ticket type while seats are held? → A: **The other ticket types cannot be chosen
  while seats are held**, with a note saying to release the held seats first by clicking them. Today
  choosing another type silently releases them all, which is a Release seats button in disguise, ends
  the reservation, and starts the 2-minute wait (recommended answer, open to review) (FR-005;
  research R7).
- Q: Where is the name on tickets typed? → A: **In the cart**, once, above the events it lists, since
  that is where tickets are bought; the event page of a seated event no longer asks for it.
  General admission keeps it on the event page (recommended answer, open to review) (FR-013; research
  R8).
- Q: Where is the countdown shown, and how? → A: **In large type at the top of a "Your seats" box
  directly below the seat map on the event page, and at the top of each event in the cart**, from
  the first held seat until the reservation ends, with the seats, the total, and (on the event page)
  Add to cart. Not in the top bar on every page: the nav's **Cart** link is enough to find it, and a
  count in it is deferred (recommended answer, open to review) (FR-010; research R9).
- Q: Accessibility? → A: **Every hold and release is announced** in a polite status region, "Section
  A, Row 1, Seat 12 held. 4:59 left." or "Section A, Row 1, Seat 12 released.", and the end of a
  reservation by releasing says the next seat starts a new 5 minutes; the 1-minute warning and the
  "ran out" alert stay (`015` FR-012); a refused click is an alert naming the seat and why; seats
  are the same buttons, so the keyboard works as before; the countdown is a timer that is not read
  every second (FR-015, FR-016; research R10).
- Q: Limits on each click? → A: **The Backend checks every rule on every click**, as for Reserve
  seats today: the seat open, of the reservation's tier, at most 10 seats, the per-customer limit
  (`016`), sales open (FR-019).
- Q: Specs 007 and 015: amended or superseded? → A: **Superseded for the Customer app's seated
  flow, with dated notes**: `015` FR-001, FR-004a, FR-005, FR-007 (its Release seats control), US1,
  and research R13; `007`'s Confirm purchase step; `026`'s hold numbers and its Reserve seats and
  Release buttons. Their Backend rules and everything else stand (FR-022; research R11).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Click Seats to Hold Them, Then Buy From the Cart (Priority: P1)

Jordan opens a seated concert, chooses the Floor ticket type, and clicks Row 1, Seats 5 and 6. Each
seat turns "yours" at once, a screen reader says "Section A, Row 1, Seat 5 held. 4:59 left.", and a
"Your seats" box below the map shows **4:58** in large type, both seats, and the total. Jordan
clicks Add to cart; the Cart page shows the concert, the two seats, the same countdown, and the
total. Jordan types the name on the tickets and clicks Buy tickets; the order is confirmed with both
ticket codes and the concert leaves the cart.

**Why this priority**: it is the issue: one control for choosing seats, a hold the moment a seat is
chosen, and a cart to buy from.

**Independent Test**: on a seated event, click two seats; the countdown starts at 5:00 on the first
and does not restart on the second; Add to cart opens the cart with both seats and the countdown;
Buy tickets places one order for both; no Reserve seats, Remove, Release, or Release seats button
appears anywhere.

**Acceptance Scenarios**:

1. **Given** a seated event with no seats held, **When** the customer clicks an open seat, **Then**
   the seat is held for them, shown as theirs, and the countdown starts at 5:00.
2. **Given** a held seat, **When** the customer clicks another open seat of the same ticket type,
   **Then** it joins the same reservation and the countdown keeps running from where it was.
3. **Given** held seats, **When** the customer clicks Add to cart, **Then** the Cart page opens and
   lists the event, its seats, the ticket type and price, the total, and the countdown.
4. **Given** the cart with an event's seats and a valid name on tickets, **When** the customer
   clicks Buy tickets before the countdown ends, **Then** one order buys exactly those seats and the
   confirmation shows each ticket code with its seat.
5. **Given** a seated event, **Then** neither its page nor the cart has a Reserve seats, Remove,
   Release, Release seats, or Confirm purchase button.

---

### User Story 2 - Click a Held Seat to Let It Go; the Last One Ends the Countdown (Priority: P1)

Jordan holds Seats 5, 6, and 7, then clicks Seat 7: it is released, announced, and open to others at
once; the countdown does not change. Jordan clicks Seat 7 again: it is held again, in the same
reservation, with the same time left. Jordan then clicks Seats 5, 6, and 7: the last release ends the
reservation, the countdown goes away, and the next seat Jordan clicks starts a new 5:00. Seats 5, 6,
and 7 cannot be held by Jordan for 2 minutes; another customer can take them at once.

**Why this priority**: releasing by clicking replaces three buttons, and the reset is the rule the
issue asks to make safe.

**Independent Test**: hold three seats, click one held seat (released, countdown unchanged), click it
again (held again at once), release all three (countdown gone), click one of them (refused for 2
minutes, saying when), click another seat (a new 5:00).

**Acceptance Scenarios**:

1. **Given** held seats, **When** the customer clicks one of them, **Then** it is released and open
   to others at once, the countdown does not change, and the release is announced.
2. **Given** a seat released while other seats stay held, **When** the customer clicks it again,
   **Then** it is held again at once, in the same reservation, with the same end.
3. **Given** one held seat, **When** the customer clicks it, **Then** the reservation ends, the
   countdown and the "Your seats" box go away, and the announcement says the next seat starts a new
   5 minutes.
4. **Given** a reservation that ended less than 2 minutes ago, **When** its customer clicks one of
   its seats, **Then** the seat is not held and the message names it and says when it can be held
   again, in the customer's own time zone; another customer clicking it holds it.

---

### User Story 3 - The Countdown Runs Out (Priority: P1)

Jordan holds two seats and leaves the cart open without buying. At 1:00 a status message says one
minute is left. At 0:00 the seats are released, the event leaves the cart, and an alert says the
reservation ran out and its seats were released, and that they can be held again in 2 minutes if
they are still open. On the event page, the seats show as open, and the "Your seats" box is gone.

**Why this priority**: the issue's last line: if the countdown runs out first, the seats are
released, removed from the cart, and the customer is told.

**Independent Test**: hold a seat, wait out the 5 minutes on the cart page (or with a test clock);
the alert shows, the cart is empty, the seat is open to another customer, and Buy tickets is gone.

**Acceptance Scenarios**:

1. **Given** a reservation with 60 seconds left, **Then** a status message says 1 minute is left,
   once.
2. **Given** a reservation whose 5 minutes end, **Then** within 2 seconds the cart no longer lists
   its event, an alert says it ran out and its seats were released, and the seats are open to others.
3. **Given** Buy tickets clicked after the Backend ended the reservation, **Then** nothing is bought,
   the event leaves the cart, and the message says the reservation ran out.

---

### User Story 4 - The Same Cart Everywhere (Priority: P2)

Jordan holds seats on a laptop, then opens QueuePass on a phone: the cart there lists the same seats
with the same time left. Buying on the phone removes the event from the laptop's cart within 2
seconds. Another customer looking at the same event sees Jordan's seats as Reserved the moment they
are clicked.

**Why this priority**: "across sessions" (Nate's line); the hold is the Backend's, not the browser's.

**Independent Test**: hold seats in one browser; open the cart in a second signed in as the same
customer (the same seats, the countdown within a second of the first); buy in the second; the first
cart drops the event without a reload. A third browser, another customer, sees the seats Reserved.

**Acceptance Scenarios**:

1. **Given** seats held in one tab or device, **When** the customer opens the cart in another,
   **Then** it lists the same seats with the same time left, within a second.
2. **Given** the cart open in two tabs, **When** the seats are bought, released, or run out in one,
   **Then** the other drops the event within 2 seconds, without a reload.
3. **Given** a customer clicks a seat, **Then** every other customer viewing the event sees it
   Reserved within 2 seconds (`015` FR-010).

---

### User Story 5 - Normal Clicking Never Meets the Limit; Refusals Are Explained (Priority: P2)

Jordan clicks ten seats as fast as they can click, two or three a second. Every one is held, in order;
none is refused for the limit. One of them was taken by another customer a moment earlier: that
seat is refused, named, and shown as Reserved; the others stay held. A script that sends hold
requests far faster is refused for the limit and told how long to wait.

**Why this priority**: click-to-hold multiplies requests; ordinary use must not be punished for it.

**Independent Test**: click ten seats within five seconds; ten holds, no limit refusal; make one of
them taken by another customer first; it alone is refused and named.

**Acceptance Scenarios**:

1. **Given** a customer clicking up to 10 seats within 5 seconds, **Then** each is held in click
   order and none is refused for the limit.
2. **Given** a click on a seat another customer has just held or bought, **Then** that seat is not
   held, the message names it, and every seat already held stays held.
3. **Given** a click that would pass 10 seats or the per-customer limit, **Then** it is refused with
   the reason and every seat already held stays held.
4. **Given** hold attempts over the account's allowance, **Then** the click is refused with "Too
   many tries. You can try again in N seconds." above the map, N counting down; open seats do
   nothing until it reaches 0; held seats can still be clicked to release them; nothing held is lost.

---

### Edge Cases

- **Two quick clicks on the same open seat** (a double click): the second cancels the first if it
  has not been sent; if it has, the seat is released once the hold is answered. The seat ends open,
  and at most one hold and one release are sent.
- **A click on a seat that another customer holds or bought while the request was in flight**:
  refused as taken, named; the queue goes on with the next click.
- **A mis-click on the only held seat**: the reservation ends and that seat waits 2 minutes for this
  customer (FR-006). The announcement says so; other seats can be held at once with a new 5:00.
- **A seat released mid-reservation, then the reservation ends**: that seat's 2 minutes run from the
  end, like every other seat of it (FR-006).
- **A seat released, and the reservation then ends by a purchase**: the released seat waits 2
  minutes from the purchase; a customer who wants it back can hold it again before buying.
- **The reservation ends elsewhere** (bought or released in another tab, an admin change, the event
  starts, logout in another tab): the event page and the cart drop it within 2 seconds. The cart
  checks the customer's orders once: if an order for that event appeared since the cart loaded, it
  says the seats were bought, with a link to My tickets; otherwise "Your reservation for {event}
  ended." An entry whose purchase is in flight, or awaiting Check again, is kept until that purchase
  settles. A read refused as signed out stops the cart's reads and signs the customer in again.
- **The token expires**: a click or Buy tickets that gets `401` signs the customer in again, as
  today; held seats stay held until their 5 minutes end.
- **No answer to a hold or release** (the connection drops): the seat goes back to what it was
  before the click, with a message that the click did not go through; the live seat map and the
  reservation are loaded again, so a hold that did go through shows as held.
- **No answer to Buy tickets**: as today (`006`): "We couldn't confirm whether your order went
  through", Check again, which never places a second order.
- **Over the buy limit in the cart**: as `026`, above that event's Buy tickets.
- **The per-customer limit reached by held seats plus tickets**: open seats are no longer clickable,
  with the `016` note, as when picking today.
- **10 seats held**: open seats are no longer clickable; the note says a reservation holds at most
  10 seats.
- **A section moved to another ticket type, or reserved seating turned off, while seats are held**:
  the reservation ends (`015` FR-016) and the customer is told; the cart drops it.
- **Several events in the cart, one running out**: only that event leaves; the others keep their
  own countdowns.
- **An empty cart**: "Your cart is empty. Seats you hold on an event's page appear here for 5
  minutes."
- **The cart opened for an event that has since been deleted**: its reservation went with it; it is
  not listed.
- **Logout**: releases every reservation, as today (`015` FR-008); the cart is empty when the
  customer signs in again.
- **General admission**: unchanged; it never appears in the cart.
- **Spec `030`** (an ended event's page says "This event has ended."; implementation in flight): a
  reservation ends when its event starts (`015` FR-016), so an ended event is never in the cart.
  _Amended 2026-11-09 by spec `034` (#126), FR-004: a reservation ends when its event ends, so a
  started event stays in the cart until its end, and an ended one never is._
- **Issue #126** (sell until the event ends; not yet specced): see Assumptions. _Amended 2026-11-09
  by spec `034` (#126): specced as `034`; its Assumptions say which of the two implementations
  merges what._

## Requirements *(mandatory)*

### Functional Requirements

**Holding seats on the event page (Customer app, seated events)**

- **FR-001**: Clicking (or pressing Enter or Space on) an open seat of the chosen ticket type MUST
  ask the Backend to hold it for the customer at once; there MUST be no picked-but-not-held state.
  Clicking a seat the customer holds MUST release it.
- **FR-002**: The event page and the cart MUST NOT offer Reserve seats, Remove, Release, Release
  seats, or Confirm purchase; the seat map is the only control for choosing seats.
- **FR-003**: The first held seat MUST start the reservation's 5 minutes; further seats MUST join it
  with its end unchanged; releasing a seat MUST NOT change the end of the rest (`015` FR-003, FR-004,
  FR-007, unchanged in the Backend).
- **FR-004**: Releasing the last held seat MUST end the reservation; the next held seat MUST start a
  new one with a new 5 minutes.
- **FR-005**: While seats are held, the other ticket types MUST NOT be choosable, and a note MUST
  say to release the held seats (by clicking them) to choose another; the section choice stays free
  within the ticket type.
- **FR-006** (amends `015` FR-004a): A seat released from a reservation that still holds other seats
  MUST be holdable again by the same customer at once, into that reservation, with its end
  unchanged. Once a reservation has ended, however it ended (its last seat released or bought, its 5
  minutes run out, logout, or an admin change), every seat of it that left it released, run out, or
  by logout MUST NOT be held again by that customer until 2 minutes after the reservation's end; the
  refusal names the seats and when, as today. Other customers MUST be able to hold them at once.
  Seats bought, or ended by an admin change or cancellation, still start no wait. The Backend MUST
  enforce this for every caller.
- **FR-007**: The Customer app MUST send hold and release requests one at a time, in the order the
  seats were clicked, and MUST NOT send a hold for a seat it holds or is already holding: a second
  click on a seat whose hold is not yet sent cancels it; a click on a seat whose hold is in flight
  releases it after the hold is answered; when a hold or release is refused or unanswered, the
  opposite action queued behind it for the same seat MUST be dropped, not sent. A seat whose
  request is pending MUST show and be named as holding or releasing.
- **FR-008**: The Backend MUST count each seat hold attempt against the account's **hold**
  allowance, which MUST default to **30 attempts in any 60 seconds and 10 in any 5 seconds**, set
  by two settings of their own; the **buy** allowance keeps its settings and defaults (10 and 3).
  Releasing stays unlimited (`026` FR-004).
- **FR-009**: When a click is refused for the hold limit, the app MUST show `026`'s message and
  countdown above the seat map, make open seats do nothing until it ends (they stay focusable),
  keep held seats clickable to release them, and drop the refused click (it is not sent again
  automatically).
- **FR-010**: From the first held seat until the reservation ends, the event page MUST show a "Your
  seats" box directly below the seat map with the time left as `m:ss` in large type (at least twice
  the body text), the held seats, the total, and an **Add to cart** button; the cart MUST show the
  same countdown, as large, for each event it lists.
- **FR-011**: Add to cart MUST open the Cart page. It sends nothing to the Backend.

**The cart (Customer app)**

- **FR-012**: The cart MUST be the customer's active reservations as the Backend reports them, for
  every event, newest first: no cart is stored in the browser. Every signed-in page MUST have a
  **Cart** link in the top bar.
- **FR-013**: The cart MUST show one **Name on tickets** field (`017`, the same rules and messages)
  and, for each event: its name (a link to its page), its date and time in the venue's zone
  (`020`), the ticket type and price, its seats, the countdown, the total, a **Change seats** link to
  the event's page, and a **Buy tickets** button that orders exactly that reservation's seats.
- **FR-014**: Buy tickets MUST behave as Confirm purchase does today (`006`, `015` FR-006, `017`,
  `026`): one order with a request id kept for that purchase; a confirmation with every ticket code
  and seat; the unknown outcome with Check again; refusals explained; the buy limit's countdown. The
  event leaves the cart once bought.
- **FR-015**: When a reservation's countdown reaches 0, the event page and the cart MUST drop it,
  and an alert MUST say it ran out, its seats were released, and they can be held again in 2 minutes
  if still open. The 1-minute warning MUST be announced once per reservation through its own status
  region (`015` FR-012).
- **FR-016**: Every hold and release MUST be announced in a polite status region, naming the seat,
  and, for a hold, the time left ("Section A, Row 1, Seat 12 held. 4:59 left."); a release that ends
  the reservation MUST say the next seat starts a new 5 minutes; answers arriving close together
  MUST each be announced, in order, none replacing another (a non-atomic region). A refused click MUST be shown and
  announced as an alert naming the seat and the reason. The countdown MUST be a timer that is not
  announced each second. Seats MUST keep their keyboard behavior and focus (`007`, `015` FR-012).
- **FR-017**: The event page MUST follow the Backend's reservation live, as the seat map does today
  (`015` FR-010); the cart MUST read the customer's reservations again about once a second while it
  is visible, and when it becomes visible or gains focus, and not while it is hidden. A change made
  in another tab or device, by an admin, or by the 5 minutes ending, MUST show on either page within
  2 seconds without a reload. The cart MUST open no live seat stream of its own, MUST have at most
  one read in flight, MUST NOT drop an entry whose purchase is in flight or awaiting Check again,
  and MUST say whether a vanished entry was bought (an order for that event since the cart loaded)
  or otherwise ended.

**Unchanged**

- **FR-018**: General-admission events MUST work exactly as before (`006`, `016`, `017`, `026`): no
  hold, no countdown, not in the cart.
- **FR-019**: Every rule the Backend applies to holding seats today MUST apply to each click
  (`015` FR-002, FR-003, FR-009, FR-016; `016`): open seats only, one ticket type, at most 10 seats,
  the per-customer limit, sales open. Seated orders MUST still come only from the customer's own
  active reservation (`015` FR-006).
- **FR-020**: The Admin app and the Ticket Booth app MUST NOT change.

**Contract and documentation**

- **FR-021**: The contract MUST state the 2-minute rule of FR-006 on `reserveSeats` and
  `releaseSeats`, the hold allowance's numbers and settings, and that the Customer app's cart is
  `listMyReservations`.
- **FR-022**: Specs `007`, `015`, and `026` MUST carry dated notes where this feature replaces their
  Customer app flow (`015` FR-001, FR-004a, FR-005, FR-007's Release seats, US1, research R13;
  `007`'s Confirm purchase step; `026`'s hold numbers and buttons), pointing here.

**Tests**

- **FR-023**: Backend tests against a real database MUST cover FR-006 on both sides of the 2 minutes
  (a seat released mid-reservation held again at once; every seat of an ended reservation refused
  until 2 minutes after its end, including one released earlier) and FR-008 (the hold pair's
  defaults and settings, the buy pair unchanged). Customer app tests MUST cover FR-001 to FR-017. The
  browser tests that hold seats MUST click seats, Add to cart, and buy from the cart.

### Key Entities

- **Reservation** (unchanged, `015`): one customer's held seats for one event, of one ticket type, 1
  to 10, with a fixed end 5 minutes after its first seat.
- **Cart** (not stored): the customer's active reservations, as `listMyReservations` returns them.
- **Hold allowance** (`026`): attempts to hold seats per account, now with its own two numbers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Buying two seats takes, after choosing the ticket type: two seat clicks, Add to cart,
  the name, and Buy tickets; no other control.
- **SC-002**: The countdown shows 5:00 (or 4:59) within 1 second of the first click and never
  increases while the reservation lasts, in 100% of tries.
- **SC-003**: A customer clicking 10 seats within 5 seconds is never refused for the limit with the
  default settings.
- **SC-004**: When a reservation runs out, the cart drops it and says so within 2 seconds, and its
  seats are open to other customers within 2 seconds.
- **SC-005**: The same cart, with the same time left (within 1 second), shows in a second tab or
  device; a change in one reaches the other within 2 seconds.
- **SC-006**: Every existing Backend test of holds, orders, and limits passes, changed only where
  FR-006 and FR-008 change the rule; every general-admission test passes unchanged.
- **SC-007**: A screen reader user hears each hold with the time left, each release, the 1-minute
  warning, and the end, and can do everything by keyboard.

## Assumptions

- **"Across sessions"** (Nate's line) means the hold is the Backend's: it survives a refresh and a
  second device, and other customers see it live. That is how `015` already works; this feature
  holds on click and shows the cart from it.
- **The 5 minutes and the 2 minutes** stay `015`'s constants (`RESERVATION_LIMITS`), and the 10-seat
  cap stays.
- **The hold numbers** (30 and 10) were decided by Mahdi on 2026-11-09: 10 seats are the most one
  reservation holds, a person clicks at most two or three a second, and a few mis-clicks and
  refusals fit in the minute; a script is still held far below what it could send. The settings let
  a deployment change them.
- **One request per click** is enough at those numbers; a click is answered in well under a second
  on the stack, so the queue rarely holds more than one or two.
- **The cart page reads each listed event's details and ticket types** through the existing reads
  (`getEvent`, `listTiers`); no new read is added for a handful of events.
- **Coordination with work in flight**: issue **#126** (sales open until the event ends, not yet
  specced) changes `salesClosed`, the hold sweep, and the order check from `startsAt` to `endsAt` in
  the same reservation and order code; this feature changes the 2-minute wait query in
  `ReservationsService` and the attempt limits, not when sales close. Whichever lands second keeps
  both; the cart then lists a reservation until its event ends rather than starts. Spec **030**
  (implementation on `030-hide-past-events-impl`) changes the customer event page for ended events
  and My tickets' Past section; spec **032** (implementation on `032-drop-check-ins-impl`) shows
  "Event over" in My tickets, and its implementation also edits `contracts/openapi.yaml` (it makes
  `checkInDetailsRemovedAt` required, still 1.24.0) and regenerates `api-schema.ts`; neither touches
  `GetTickets.tsx`, the reservation rules, or the limits. Whichever of `032`'s implementation and
  this feature lands second keeps both contract changes, regenerates `api-schema.ts`, and reruns
  `check-contract-drift`. Constitution 3.9.5 and contract 1.25.0 apply on top of `main` (3.9.4,
  1.24.0).

## Out of scope

- **One checkout for several events** (one order, one payment, across events): deferred; each event
  is bought on its own from the cart (Principle VIII). An order is for one event (`005`).
- **General admission in the cart**, and holds on a quantity of unseated tickets.
- **A count or countdown in the top bar** on every page; the Cart link is plain.
- **Batching several clicks into one hold request** (#131's 300 ms idea): not needed at the new
  numbers (research R5).
- **Extending a reservation**, or a timer that restarts while seats stay held: `015` forbids both.
- **Payments**: still none (`006`).
- The Admin app's and Ticket Booth's screens.
