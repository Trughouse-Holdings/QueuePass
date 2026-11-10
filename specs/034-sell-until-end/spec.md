# Feature Specification: Sell Tickets Until the Event Ends

**Feature Branch**: `034-sell-until-end-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#126](https://github.com/Trughouse-Holdings/QueuePass/issues/126) (sell tickets until the
event ends, not when it starts; tell customers when it has already started)

**Input**: User description: issue #126. Ticket sales close the moment an event **starts** (spec
`006` FR-014), so people who arrive late, or decide at the door, cannot buy a ticket while the event
is still going. Sales should stay open until the event **ends**: orders, reservations, and seat holds
are allowed until the end and refused as sales closed from then on, on the same half-open rule (at
the end it is closed), with every existing limit still applying (capacity, the per-customer limit of
`016`, the attempt limits of `026`, seat holds of `015`). On the event page and in the Get tickets
panel, a customer is told when the event has already started, for example "This event has already
started (began at 7:00 PM). You can still buy tickets until it ends at 10:00 PM.", in the venue's
time zone (`020`), from the start until the end, and on the confirmation of a ticket bought after
the start. After the end, a reworded closed message: "Sales closed: this event has ended." The issue
leaves open: the contract's `salesClosed: STARTED` value and whether availability says "started,
still on sale"; the Ticket Booth's entry window for a ticket bought late; lists that hide started
events; and reports. The roadmap number is reserved by this PR's amendment (Constitution 3.9.6).

## Context

Builds on `006` (getting tickets, the sales-closed rule this feature moves), `015` (seat holds,
which end when sales close), `016` (the per-customer limit), `017` and `025` (the Ticket Booth's
entry window, open until the event ends), `020` (event times in the venue's time zone), `026` (the
attempt limits), `030` (an event is past once its end is reached; past events leave the lists; a
past event's page says "This event has ended."), and `033` (seats held by clicking them, and the
cart; merged as a spec, its implementation in flight).

Today:

- **The Backend closes sales at the start.** An order at or after the event's start is refused as
  `SALES_CLOSED` ("Sales for Season Opener closed when it started."); so is a seat reservation; the
  hold sweep ends every open reservation once the start is reached; and the event's availability
  says `salesClosed: STARTED`.
- **The Customer app's Get tickets panel** shows a "Sales closed" badge and "Sales closed: this
  event has already started." from the start onwards, also after the event has ended (where `030`
  adds "This event has ended." under the event's name and left the panel's wording to this issue).
- **The Ticket Booth** admits a valid ticket from 1 hour before doors open until the event ends
  (`025`), whenever it was bought.
- **Lists** already keep an event until its end (`030`); My tickets keeps an order among the
  upcoming ones, with its entry code, until its event ends.

This feature moves the one instant at which sales close from the event's start to its end,
everywhere the Backend decides it, and has the Customer app tell a customer, while they can still
buy, that the event has already started and until when tickets are on sale.

## Clarifications

### Session 2026-11-09

The issue settles the rule and the messages. Every question it leaves open below took the
recommended answer, written unattended and recorded here as **recommended answer, open to review**,
so Mahdi and the team can overturn it in review of the spec PR.

- Q: When exactly do sales close? → A: **At the event's end, half-open**: an order or a seat hold
  is allowed at any instant before the end and refused as sales closed at the end exactly and after
  (Constitution, "Time"). A cancelled event stays refused as cancelled, at any time. Nothing else
  about buying changes: capacity, tiers, seats, the per-customer limit, the attempt limits, the
  request id, and holds all apply as before the start (the issue; FR-001 to FR-005).
- Q: The contract's `salesClosed` value? → A: **`ENDED` replaces `STARTED`**: availability says
  `salesClosed: ENDED` once the end is reached, `CANCELLED` for a cancelled event (which wins, as
  today), and `null` while tickets can be ordered. `STARTED` is no longer sent; the spec PR keeps it
  in the contract's list so `main`'s Backend still matches until the implementation removes it
  (recommended answer, open to review) (FR-006; research R2).
- Q: Does availability say "started, still on sale"? → A: **Yes, a flag `inProgress`**, true from
  the start until the end by the Backend's clock, in the same answer as `salesClosed`, so the panel
  never says "you can still buy" while the Backend says sales have ended, and no app works it out
  from its own clock (the issue's suggestion). It is the clock fact alone, also for a cancelled event,
  whose panel shows only that it is cancelled (recommended answer, open to review) (FR-007;
  research R2).
- Q: Where does the "already started" notice appear? → A: **Once, at the top of the Get tickets
  panel**, which is on the event page, above the ticket choices, so it is read before buying. It is
  not repeated under the event's name: one notice on the page is enough, and a second copy would be
  read twice by a screen reader (recommended answer, open to review; the issue lists "the event page,
  and the Get tickets panel") (FR-008; research R4).
- Q: Its wording and its times? → A: **"This event has already started (began at 7:00 PM EST). You
  can still buy tickets until it ends at 10:00 PM EST."**, each time in the venue's time zone with
  its abbreviation (`020`); a time is shown alone when it falls on the venue's date at the moment the
  panel loaded, and with its date otherwise ("until it ends at Nov 21, 2026, 1:00 AM EST" for a show
  that runs past midnight) (recommended answer, open to review) (FR-008, FR-009; research R4).
- Q: The notice when the customer cannot buy (sold out, at their limit, or no seats on sale yet)? →
  A: **Only its first sentence**, "This event has already started (began at 7:00 PM EST).", above
  whichever of those messages applies: "You can still buy tickets" would not be true for them. A
  cancelled event shows only that it is cancelled (recommended answer, open to review) (FR-010;
  research R4).
- Q: After the end? → A: **The panel's badge stays "Sales closed" and its sentence becomes "Sales
  closed: this event has ended."**, below `030`'s "This event has ended." under the name. The
  Backend's refusal says "Sales for {event} closed when it ended." (the issue) (FR-011; research R2,
  R4).
- Q: The event page's "This event has ended." line (`030`) uses the browser's clock, the panel the
  Backend's: what if they disagree? → A: **Once the panel's availability has loaded, the line
  follows it**: shown when `salesClosed` is `ENDED`, or, for a cancelled event (`CANCELLED` whatever
  the time), when `inProgress` is false and `030`'s browser-clock rule says it has ended; never
  while `inProgress` is true. So the header and the panel never contradict each other, and a
  cancelled event that has ended still says so. Before availability first loads, or if it never
  answers, `030`'s browser-clock rule stands; a later reload keeps the last answer meanwhile
  (decided in spec review rounds 1 and 2, by the orchestrating session) (FR-017; research R4).
- Q: On the confirmation? → A: **For an order placed at or after the event's start**, the
  confirmation says "This event has already started (began at 7:00 PM EST). Your tickets admit you
  until it ends at 10:00 PM EST.", decided from the order's own time and the event's start, both the
  Backend's, so nothing new is asked for. The same confirmation serves the event page and `033`'s cart
  (recommended answer, open to review) (FR-012; research R5).
- Q: A seat hold near the end? → A: **It ends at the event's end**, even if its 5 minutes have not run
  out, as it ends at the start today; its `expiresAt` is not shortened. The panel then shows, on its
  next load of availability, that sales have closed (recommended answer, open to review) (FR-004;
  research R3).
- Q: The Ticket Booth? → A: **Unchanged.** Its window, from 1 hour before doors open until the event
  ends (`025`), already admits a ticket bought after the start, until the end, like any other valid
  ticket (FR-013; research R6).
- Q: Lists, My tickets, Add to calendar, reports? → A: **Unchanged.** Lists keep an event until its end
  (`030`); My tickets keeps the order among the upcoming ones with its entry code until the end
  (`030`); Add to calendar is offered until the end (`019`); sales after the start count in every
  report and export like any other (`005`, `023`) (FR-014; research R7).
- Q: The demo data? → A: **Unchanged.** `029`'s Demo Tonight starts 1 hour after a reset and is on
  sale until it ends 3 hours later; Season Opener, over, now reads "Sales closed: this event has
  ended." No demo event is made to be in progress when the data loads (recommended answer, open to
  review) (FR-015; research R8).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Latecomer Buys a Ticket After the Start (Priority: P1)

Sam is outside the Hall at 8:15 PM. The comedy show started at 8:00 and ends at 11:00. He opens the
event in the Customer app: the Get tickets panel says "This event has already started (began at
8:00 PM EST). You can still buy tickets until it ends at 11:00 PM EST." He chooses a ticket, enters
his name, and confirms. The confirmation shows his ticket code and says the event has already
started and his ticket admits him until 11:00 PM EST. At the door the gate agent scans it: admitted.

**Why this priority**: it is the issue's main ask; every other change follows from it.

**Independent Test**: for an event that started a few minutes ago and ends in an hour, a customer
buys a ticket; the panel and the confirmation both show the notice; the ticket is admitted at the
Ticket Booth.

**Acceptance Scenarios**:

1. **Given** an event that started 15 minutes ago and has not ended, **When** a customer opens its
   page, **Then** the Get tickets panel shows the notice with the start and end times in the venue's
   zone, and offers tickets as before the start.
2. **When** they confirm an order, **Then** it is placed, with its ticket codes, and the confirmation
   says the event has already started and the tickets admit them until it ends.
3. **Given** that ticket, **When** a gate agent scans or types it at the Ticket Booth for that event
   before its end, **Then** it is admitted.
4. **Given** the same event with reserved seating, **When** the customer holds seats and buys them,
   **Then** the hold and the order succeed as before the start.
5. **Given** an event that has not started, **Then** the panel shows no notice and the confirmation
   says nothing about a start.

---

### User Story 2 - Sales Close at the End (Priority: P1)

At 11:00 PM the comedy show ends. A customer who opened the page at 10:58 and confirms at 11:00:01
is told sales have closed; nothing is charged. Opening the page again: "This event has ended." under
its name, and in the Get tickets panel the "Sales closed" badge and "Sales closed: this event has
ended." A customer who held seats at 10:58 sees them released at 11:00.

**Why this priority**: the closing rule must hold exactly, on the Backend, for every client.

**Independent Test**: an order placed just before an event's end succeeds; one at or after its end is
refused as sales closed and records nothing; holds still open at the end are ended at the end, not at
the start.

**Acceptance Scenarios**:

1. **Given** an event ending in a few seconds, **When** an order arrives before the end, **Then** it
   is placed.
2. **Given** an event whose end has been reached, **When** an order or a seat hold arrives, **Then**
   it is refused as sales closed, saying sales closed when the event ended, and nothing is recorded.
3. **Given** a seat reservation still open when its event starts, **Then** it stays open (until its 5
   minutes run out or it is bought or released); **given** one still open when its event ends,
   **Then** it is ended within a few seconds of the end and its seats are shown open to viewers.
4. **Given** an event that has ended, **When** a customer opens its page, **Then** the Get tickets
   panel shows "Sales closed" and "Sales closed: this event has ended.", and no way to get tickets.
5. **Given** a cancelled event, before or after its start or end, **Then** an order is refused as
   cancelled, and the panel says it has been cancelled, as today, with no started notice.
6. **Given** an order placed before the end with a request id, **When** the same confirmation is
   repeated after the end, **Then** the earlier order is returned, as today.

---

### User Story 3 - The Customer Can Tell What Is Left (Priority: P2)

At 9:30 PM a show that started at 8 is sold out. Its panel says "This event has already started
(began at 8:00 PM EST)." and below it "Sold out: no tickets are left for this event." A customer
who already holds the per-customer limit sees the first sentence and their limit message.

**Why this priority**: the notice must never promise tickets the customer cannot get.

**Independent Test**: for an event in progress that is sold out, and one where the customer is at
their limit, the panel shows the first sentence of the notice and the reason, never "You can still
buy tickets".

**Acceptance Scenarios**:

1. **Given** an event in progress with no tickets left, **Then** the panel shows the notice's first
   sentence and the sold-out message.
2. **Given** an event in progress and a customer at the per-customer limit, **Then** the panel shows
   the notice's first sentence and the limit message.
3. **Given** an event in progress that runs past midnight at the venue, **Then** the end is shown
   with its date.

---

### User Story 4 - One Answer for Every Client (Priority: P2)

A teammate's script reads an event's availability. Before the start it says `salesClosed: null` and
`inProgress: false`; during the event `null` and `true`; at and after the end `ENDED` and `false`;
for a cancelled event `CANCELLED`.

**Why this priority**: the Backend decides, so every client (the Customer app, a future one) agrees.

**Independent Test**: read availability before the start, during the event, and after the end; the
values follow the rule.

**Acceptance Scenarios**:

1. **Given** an event ahead, in progress, and ended, **When** availability is read, **Then**
   `salesClosed` is `null`, `null`, and `ENDED`, and `inProgress` is `false`, `true`, and `false`.
2. **Given** a cancelled event, in progress or ended, **Then** `salesClosed` is `CANCELLED`.
3. **Then** every answer matches the contract.

---

### Edge Cases

- **The exact end.** At the event's end an order or a hold is refused; one millisecond before, it is
  allowed (subject to every other rule). The Backend's tests check a few seconds before the end and
  the end reached; the millisecond itself would need a clock the tests can stop in every path, which
  research R1 does not add.
- **The exact start.** At the start nothing changes for sales: an order one millisecond before and one
  at the start are both allowed; from the start the panel shows the notice.
- **A page left open across the start.** The notice appears the next time the panel loads
  availability (a reload, or after any refusal or purchase); buying works throughout.
- **A page left open across the end.** The panel still offers tickets until it loads availability
  again; an order confirmed after the end is refused as sales closed, the panel says why, loads
  availability, and shows the closed message.
- **A hold made in the last 5 minutes.** It ends at the event's end, before its countdown reaches
  0:00; its `expiresAt` is unchanged (FR-004).
- **An admin moves the end.** Sales follow the end in force: moved earlier to a time already passed,
  sales close and open holds end at the next sweep; moved later, sales reopen until the new end.
  Moving times is otherwise as before (`002`, `025`, `032`).
- **A client's clock differs from the Backend's.** The Backend decides whether sales are open and
  whether the event is in progress; the apps only show it. The times in the notice are the event's
  own. A browser clock running a few minutes fast near the end does not put "This event has ended."
  under the name while the Backend says the event is in progress, and a slow one does not hide it
  once the Backend says sales have ended: once availability has loaded, that line follows it
  (FR-017); before, it follows `030`'s rule.
- **A cancelled event in progress.** Refused as cancelled; the panel shows only that it is cancelled.
- **A cancelled event that has ended.** As today: `CANCELLED` wins; its page says it has been
  cancelled and (`030`) that it has ended. Because availability says `CANCELLED` whatever the time,
  the "ended" line for a cancelled event still follows the browser's clock (FR-017): a browser
  clock running slow keeps it hidden for a little while after the Backend's end, until the page is
  loaded again after the browser's clock passes the end.
- **The per-customer limit and the attempt limits** (`016`, `026`) count orders and holds after the
  start exactly as before it.
- **The cart (`033`).** A reservation, and so a cart entry, stays until its event ends rather than
  starts; buying from the cart after the start is allowed and its confirmation shows the notice (the
  same confirmation as the event page). The cart itself shows no notice (Out of scope).
- **The Ticket Booth.** A ticket bought one second before the end is admittable for that second, as
  any valid ticket is; at the end every ticket of the event is refused as ended (`025`).
- **Demo data.** Demo Tonight is on sale from the reset until its end, 4 hours later, and shows the
  notice from its start, 1 hour after the reset; Season Opener shows the ended message.

## Requirements *(mandatory)*

### Functional Requirements

**The rule (the Backend)**

- **FR-001**: Sales for an event MUST be open from when it is created until the instant its end time
  is reached, and closed from that instant on (half-open), unless it is cancelled. Its start time
  MUST play no part in whether sales are open. This replaces `006` FR-014's close at the start.
- **FR-002**: The Backend MUST refuse an order for an event whose end has been reached as sales
  closed, with a message saying sales closed when the event ended, and record nothing. A cancelled
  event MUST still be refused as cancelled first.
- **FR-003**: The Backend MUST refuse a seat reservation (making one or adding seats) for an event
  whose end has been reached as sales closed, with the same message, and reserve nothing.
- **FR-004**: Seat reservations MUST end when their event ends, not when it starts: the Backend
  MUST end every reservation still open at its event's end, within a few seconds of it, and show
  its seats open to viewers. A reservation's 5 minutes MUST NOT be shortened to the end.
- **FR-005**: Every other rule of an order and a hold MUST apply after the start exactly as before
  it: capacity and tiers, seats, the per-customer limit (`016`), the attempt limits (`026`), seat
  holds and their wait (`015`, `033`), and a repeated request id returning the earlier order.

**Availability (the Backend)**

- **FR-006**: An event's availability MUST say why sales are closed as `CANCELLED` for a cancelled
  event, `ENDED` once its end has been reached, and nothing while tickets can be ordered; it MUST
  no longer say `STARTED`.
- **FR-007**: An event's availability MUST say whether the event is in progress: true from the instant
  its start is reached until the instant its end is reached, by the same clock as FR-006.

**The Customer app**

- **FR-008**: While an event is in progress and sales are open, the Get tickets panel MUST show, at its
  top, "This event has already started (began at {start}). You can still buy tickets until it ends
  at {end}.", decided from the event's availability.
- **FR-009**: The start and end in the notice MUST be in the venue's time zone with its abbreviation
  (`020`), each shown alone when it falls on the venue's date at the moment the panel loaded and with
  its date otherwise.
- **FR-010**: While an event is in progress and sales are open but the panel shows a reason it
  offers no way to get tickets (none left, the customer at their limit, or no seats on sale yet), it
  MUST show only the notice's first sentence, "This event has already started (began at {start}).",
  above that reason. For a cancelled event it MUST show no notice.
- **FR-011**: Once sales have ended, the panel MUST show the "Sales closed" badge and "Sales closed:
  this event has ended.", with no way to get tickets.
- **FR-012**: The confirmation of an order placed at or after its event's start MUST say "This event
  has already started (began at {start}). Your tickets admit you until it ends at {end}.", by
  FR-009's rule; an order placed before the start MUST show no such line.
- **FR-017**: Once the Get tickets panel has loaded the event's availability, the event page's "This
  event has ended." line (`030` FR-014) MUST follow the last answer: shown when it says sales have
  `ENDED`, or when it says `CANCELLED` with the event not in progress and `030`'s rule (the
  browser's clock when the event loaded) says the event has ended; never while it says the event is
  in progress. While availability is loading again after a first answer, or when such a reload
  fails, the last answer MUST still be used. Before any answer has arrived, or if none ever does,
  `030`'s rule applies. An answer saying `STARTED` or without `inProgress` (only from a Backend
  before this feature's implementation, research R2) counts as no answer, so `030`'s rule applies.
  _(Added in spec review round 1, cancelled events in round 2, reloads and `STARTED` in round 3.)_

**Unchanged**

- **FR-013**: The Ticket Booth's entry window MUST stay as `025` sets it, so a valid ticket bought
  after its event's start is admitted until the event ends.
- **FR-014**: Event lists, My tickets, Add to calendar, the Admin app, reports, and exports MUST be
  unchanged; orders placed after the start count in every figure like any other.
- **FR-015**: The demo data's events and times MUST be unchanged; its texts and tests that say a
  started or past event's sales closed at the start MUST say they close at the end.

**Documentation**

- **FR-016**: The contract MUST state the rule (sales close at `endsAt`), `ENDED`, and `inProgress`.
  Every start-based sales rule in an earlier spec MUST carry a dated note pointing here: `006`
  (US2's narrative and scenario 6, the "Event starts while a customer is confirming" edge case,
  FR-014, SC-004), `007` (the "Events that started or were cancelled" edge case), `015` (the "Sales
  closed" edge case, FR-016), `030` (the clarification leaving the panel to #126, and FR-014 for
  FR-017), and `033` (the edge cases on ended events in the cart and on a reservation ending
  elsewhere, the "Issue
  #126" line, and the coordination assumption). The README MUST list `034` and describe the rule.

### Key Entities

- **Event**: unchanged. Its end time (`endsAt`) now decides when sales close; its start time
  (`startsAt`) only whether it is in progress.
- **Availability**: why sales are closed (`CANCELLED`, `ENDED`, or none) and, new, whether the event
  is in progress, both by the Backend's clock.
- **Order**: unchanged; its creation time, compared with its event's start, decides the
  confirmation's notice.
- **Seat reservation**: unchanged; it now ends at its event's end, not its start.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An order for an event in progress, placed one minute after its start, succeeds in 100%
  of tries (within capacity and limits).
- **SC-002**: An order or a hold at or after an event's end is refused as sales closed in 100% of
  tries, and one a few seconds before the end succeeds (tested on both sides).
- **SC-003**: No open seat reservation outlives its event's end by more than 5 seconds, and none is
  ended because its event started.
- **SC-004**: On 100% of in-progress events with tickets on sale, the panel shows the notice with the
  start and end in the venue's zone; on 0% of events not yet started or ended.
- **SC-005**: On 100% of ended events the panel says "Sales closed: this event has ended."; "has
  already started" appears in no closed message.
- **SC-006**: A ticket bought after its event's start is admitted at the Ticket Booth before the end in
  100% of tries.
- **SC-007**: Every report figure for an event counts orders placed after its start.

## Assumptions

- **The Backend's clocks.** Each path keeps the clock it reads today (the order check and
  availability the Backend's process clock, holds and the sweep the database's clock); they run on
  one machine, so they agree to well under a second. Only the instant compared changes (research R1).
- **The contract change lands in two steps**, as PR #151 proposes for `032`: the spec PR adds
  `ENDED` and `inProgress` (optional) and keeps `STARTED`, so `main`'s Backend still matches; the
  implementation removes `STARTED` and makes `inProgress` required, keeping 1.26.0, which the
  contract approved in the spec PR already announces (research R2).
- **Coordination with `033`'s implementation** (branch `033-seat-hold-cart-impl`, in flight): it
  reworks the seated half of `GetTickets.tsx`, moves the confirmation into its own component shared
  with the new cart, and changes the reservation wait query in `reservations.service.ts`; this
  feature changes the sales-closed check and message in the same service, the hold sweep, the
  panel's top and closed messages, and the confirmation. `033`'s implementation is expected to land
  first: this feature's implementation is then cut from, or rebased onto, `main` with it, and puts
  the notice in `033`'s confirmation component. If this feature lands first, `033`'s implementation
  keeps both: the notice at the panel's top, the closed messages, and the confirmation's line moved
  with the confirmation (research R10).
- **`032`'s implementation** (PR #151) touches neither sales nor the panel; whichever of it and this
  feature lands second keeps both contract changes, regenerates `api-schema.ts`, and reruns the
  contract drift check.
- **No new setting.** The closing instant is the event's own end, not a configurable offset.

## Out of scope

- Selling after an event ends, or closing sales at any other instant (doors open, a cut-off before the
  end).
- A notice under the event's name in addition to the panel's, or in the cart (`033`), My tickets, the
  event lists, or the Ticket Booth.
- Shortening a seat reservation's 5 minutes to the event's end.
- Changing the Ticket Booth's entry window, the demo data's events, lists, reports, or exports.
- Late-entry pricing or any price that changes after the start.
