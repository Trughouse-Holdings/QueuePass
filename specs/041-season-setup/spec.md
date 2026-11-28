# Feature Specification: Season Setup (Admin Side) and the Shared Season Contract

**Feature Branch**: `041-season-setup-spec`

**Created**: 2026-11-27

**Status**: Draft

**Issue**: [#192](https://github.com/Trughouse-Holdings/QueuePass/issues/192)

**Input**: The "Season Pass — Feature Proposal" doc (Nate and Mahdi, 2026-11-24), its sections
"Spec 041: Season setup (admin side)" and "Shared contract (first)", and issue #192. A season pass
lets a customer buy one seat (or one general-admission place) for every event in a named set, in one
purchase. An admin groups events at one venue into a **Season** (for example "Louisville Cardinals
Basketball 2026–27", 16 home games), sets a pass price, and puts it on sale. The proposal splits the
feature into two specs that run in parallel after a shared contract: `041` (this spec, the admin
side) and `042-season-pass-purchase` (#193, the customer side). Nate decided on 2026-11-27 that the
shared contract (the data model, the API for both sides, and a test fixture) rides in this spec's
pull request instead of a pull request of its own (#191 was closed).

## Context

Builds on `002` (venues and events), `004` (ticket types for general admission), `005` (orders,
tickets, the sales report, attendee lists, cancelling an event, which refunds its orders), `016`
(tickets per customer), `017` (the name on tickets), `020` (venue time zones), `023` (report
exports), `029` (the demo reset), `031`/`035` (the event form: one-step saves, each refusal shown
beside its field, controls locked with the reason when the Backend would refuse them), `034`
(selling until the end), `037` (the Rust Admin app, which must match the Admin app page for page)
and `038` (layouts with price levels; a seated event uses one layout, a price per level, and seats
off sale; a sold or held seat can't be taken off sale; a layout can't change once an event has sold
tickets or has live holds).

The pass is a wrapper: buying one (042) writes ordinary per-event orders and tickets, so My
tickets, rotating codes (`018`), gate check-in (`017`), refunds and reports keep working. This spec
gives admins everything on their side of that: making Seasons, pricing them, the presale window,
editing and cancelling them, and seeing pass sales. It also fixes, for both specs, the shared data
and API so 042 never waits on 041's screens and 041 never waits on 042's checkout.

## Clarifications

### Session 2026-11-27

Nate answered the proposal's open questions 1 and 2 and the contract question. The other open
questions that touch the admin side take the answer below, recorded as **default, open to review**,
so Mahdi can overturn any of them in review of the spec PR.

- Q: (Proposal question 1) If single tickets go on sale at the same time as passes, pass seats
  disappear fast. A presale window or pass-only sections? → A: **A presale window** (Nate). A
  Season may set when single tickets for its events go on sale. Until then, while the Season is on
  sale, its events sell only passes: holding seats or ordering single tickets for them is refused,
  saying when single tickets go on sale. A Season without that time doesn't hold single sales back.
  Tickets already sold stay valid. The refusal lives on the customer's purchase paths, which `042`
  owns, so `042` enforces it; this spec sets the time, the rule, and the contract for it.
- Q: (Proposal question 2) How is a pass's price split across its events? → A: **Evenly** (Nate):
  the pass price divided by the number of events, rounded down to the cent, with the cents left
  over on the earliest event. Each event's order and ticket carry that share. `042` applies it when
  a pass is bought; reports and refunds read each order's own price.
- Q: Who writes the shared contract? → A: **This spec, in its spec PR** (Nate). The data model and
  its migration, every Season operation for both sides (042's marked as planned for `042`), and a
  test fixture that makes a Season with 3 events, prices and one sold pass.
- Q: (Proposal question 3) Can events be added to a Season after it goes on sale? → A: **Default:
  the event list can change (add or remove) until the first pass is sold, and not after.** Before a
  sale no customer holds a ticket that a new event would have to match; after one, a new event
  would need a ticket for every holder, whose seat may already be gone.
- Q: (Proposal question 4) What does cancelling one event or the whole Season do? → A: **Default:
  cancelling one event works as today (`005`)**: it refunds every order for that event, pass
  orders included, so each pass holder gets back that event's share, and their pass stays good for
  the other events. **Cancelling a Season** refunds every pass in full (every pass order, voiding
  its tickets and freeing its seats), ends any pass being bought, and leaves the Season read-only.
  Its events stay scheduled and keep selling single tickets, with no presale.
- Q: (Proposal question 5) Can a pass be bought once the first event has started? → A: **Default:
  no.** A Season's pass sales end at its sales end time, which must be no later than the start of
  its first event. No reduced late price in v1.
- Q: (Issue #192) Can an event in a Season change its layout, or have a pass holder's seat taken
  off sale? → A: **Default: an event in a Season can't change its layout, or switch between
  reserved seating and general admission**, refused naming the Season, because a pass seat is the
  same seat of one layout at every event. A pass holder's seat is a sold ticket at every event, and
  `038` already refuses taking a sold seat off sale. An open seat taken off sale for one event is
  simply not offered on passes (`042`).
- Q: (Proposal question 7, admin side) React only first, or both Admin apps? → A: **Both, in the
  same implementation PR** (the issue): the Rust Admin app's browser check compares every Admin
  page of both apps, so a Seasons page in one app alone fails CI.
- Q: How few events can a Season have? → A: **Default: at least 2 to go on sale.** A one-event
  "season" is a single ticket. A draft may have fewer while it is being built.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An admin creates a Season and puts it on sale (Priority: P1)

An admin opens Seasons, chooses New Season, and fills in a name, the venue, the layout (or general
admission), the sport and team for a sports Season, when pass sales end, an optional time single
tickets go on sale, and an optional limit of passes per customer. A picker lists only that venue's
upcoming events on that layout; the admin ticks the events. For a seated Season the form lists every
price level of the layout with a pass price box; for general admission it lists the ticket type
names to price. The admin saves the Season as a draft, then puts it on sale.

**Why this priority**: Without a Season on sale there is nothing for customers to buy (042) and
nothing to report. It is the feature's core.

**Independent Test**: In either Admin app, create a seated Season with 3 events at one venue on one
layout, price every level, save, put it on sale; the Season's page and the list show it on sale.
Through the API alone, the customer list of Seasons on sale includes it (once 042 serves it).

**Acceptance Scenarios**:

1. **Given** a venue with a layout and 3 upcoming events on it, **When** the admin picks that venue
   and layout, **Then** the event picker lists exactly those events (not events on another layout,
   at another venue, cancelled, started, or already in another Season).
2. **Given** a complete Season form, **When** the admin saves it, **Then** it is saved as a draft,
   with its events and prices, and is not on sale.
3. **Given** a draft with at least 2 events and a price for every level, **When** the admin puts it
   on sale, **Then** its status becomes on sale.
4. **Given** a draft with a level unpriced, **When** the admin puts it on sale, **Then** it is
   refused, naming each unpriced level beside its price box, and the Season stays a draft.
5. **Given** a form with a required field empty (name, venue, sales end, or a seated Season's
   layout), **When** the admin saves, **Then** each empty field is marked beside it as the event
   form marks one (a red outline and "Required" once #189 is merged), focus moves to the first, and
   nothing is sent.
6. **Given** a sport chosen and no team (or a team and no sport), **When** the admin saves, **Then**
   it is refused beside the empty one: both or neither.
7. **Given** sales end after the first chosen event starts, or single tickets set to go on sale
   after sales end, **When** the admin saves, **Then** it is refused beside that field, saying the
   limit.

---

### User Story 2 - An admin edits or cancels a Season (Priority: P1)

An admin opens a Season to change it. Before the first pass is sold, anything may change. After it,
the events are locked (the picker says why), while the name, sport and team, prices for future
sales, sales end, the time single tickets go on sale, and the passes-per-customer limit can still
change within their rules. A draft with no passes can be deleted. A Season on sale can be cancelled,
after a confirmation that says how many passes will be refunded.

**Why this priority**: Admins make mistakes and plans change; a Season they can't fix or stop is a
liability once money is involved.

**Independent Test**: With the shared fixture's Season (one pass sold), try to remove an event and
see it refused; change the pass price and see the sold pass keep its price; cancel the Season and
see the pass's orders refunded and its tickets void.

**Acceptance Scenarios**:

1. **Given** a Season with no passes sold, **When** the admin adds or removes events, **Then** the
   change saves.
2. **Given** a Season with a pass sold, **When** the admin tries to add or remove an event, **Then**
   it is refused, saying passes have been sold; the form shows the picker locked with that reason.
3. **Given** a Season with a pass sold, **When** the admin changes a level's pass price, **Then** it
   saves; the sold pass and its tickets keep the prices they were sold at.
4. **Given** a draft with no passes, **When** the admin deletes it, **Then** it is gone and its
   events can join another Season.
5. **Given** a Season on sale with passes, **When** the admin cancels it and confirms, **Then**
   every pass is refunded (every one of its orders refunded, its tickets void, its seats free), the
   Season is cancelled and read-only, and its events stay scheduled and on sale as single tickets.
6. **Given** a Season whose events include one the admin cancels (`005`), **When** the cancellation
   completes, **Then** that event's pass orders are refunded like any other order, and each pass
   stays valid for the Season's other events.
7. **Given** an event in a Season, **When** an admin tries to change that event's layout or switch
   it between reserved seating and general admission, **Then** it is refused, naming the Season, and
   the event form shows the layout control locked with that reason.

---

### User Story 3 - An admin sees pass sales and pass holders (Priority: P1)

The sales report says, for each event and in its total, how many tickets and how much revenue came
from passes. The Seasons list and each Season's page show its passes sold and pass revenue. The
attendee list marks each order bought on a pass with its Season's name. The same figures and marks
appear in the CSV, Excel and PDF exports.

**Why this priority**: The issue's "done when": an admin puts a Season on sale and sees a pass sale
in the sales report.

**Independent Test**: Load the shared fixture (a Season with one sold pass), open Reports and the
attendee list of one of its events, in both Admin apps; download each export and find the same
figures and marks.

**Acceptance Scenarios**:

1. **Given** a sold pass for a 3-event Season, **When** the admin opens the sales report, **Then**
   each of the 3 events shows 1 pass ticket and its share of the pass price as pass revenue, and the
   total row shows 3 pass tickets and the full pass price; the Seasons list and the Season's page
   show 1 pass sold and the full pass price.
2. **Given** the same, **When** the admin opens one event's attendee list, **Then** the pass order
   shows the Season's name in a Pass column, and single-ticket orders show it empty.
3. **Given** the same, **When** the admin downloads the sales report or the attendee list as CSV,
   Excel or PDF, **Then** each file has the same pass figures and marks as the screen.
4. **Given** a refunded pass (Season cancelled), **When** the admin opens the report, **Then** the
   pass counts nowhere in sold or revenue, as refunded orders today.

---

### User Story 4 - The presale window holds single tickets back (Priority: P2)

An admin who wants pass holders to get first pick sets when single tickets go on sale. Until then,
while the Season is on sale, its events sell only passes. The Admin app shows this on the Season and
on each of its events.

**Why this priority**: Nate chose it to keep the best seats from vanishing before passes sell, but a
Season without it still works.

**Independent Test**: Through the API, with a Season on sale whose single-ticket time is tomorrow,
read one of its events as a customer and see when single tickets go on sale; the Admin app's Season
page and event page say "Single tickets on sale from …". (The refusal of a single-ticket hold or
order is tested in `042`, which serves those paths.)

**Acceptance Scenarios**:

1. **Given** a Season on sale with single tickets on sale from a future time, **When** anyone reads
   one of its events, **Then** it says single tickets go on sale at that time, in the venue's time
   zone.
2. **Given** that time has passed, or the Season has no such time, is a draft, or is cancelled,
   **When** anyone reads the event, **Then** it says nothing about a presale and single sales are
   as before.
3. **Given** a Season with single tickets on sale from a time, **When** the admin clears or moves
   it, **Then** it saves, within its rules, and every event shows the new time at once.

---

### User Story 5 - The demo has a Season on sale (Priority: P2)

After the demo reset, a Louisville Cardinals Basketball Season of upcoming games at the KFC Yum!
Center, on its Basketball layout, is on sale with every level priced and a presale running.

**Why this priority**: The team demos from the reset; the feature should be visible without setup.

**Independent Test**: Run the demo reset; open Seasons in either Admin app and see the Season on
sale with its games, prices and presale.

**Acceptance Scenarios**:

1. **Given** the demo reset has run, **When** an admin opens Seasons, **Then** the Basketball Season
   is listed on sale with its games and a price for every level.
2. **Given** the reset runs twice, **When** it finishes, **Then** the same Season, same events and
   same prices exist, with times relative to the run.

---

### Edge Cases

- **An event that is cancelled, has started, or has ended** can't be added to a Season. An event
  already in a Season that is later cancelled stays listed on the Season, marked cancelled; it no
  longer counts toward "at least 2 events" for putting a draft on sale.
- **The venue or layout changes on a draft** with events chosen: events no longer matching are
  refused on save, each named, so the admin removes them or changes back. After a pass sale, venue
  and layout are locked with the events.
- **Two admins add the same event to two Seasons at the same moment**: one save succeeds; the other
  is refused naming the event. Never both.
- **A pass is sold while an admin is removing an event**: one of them wins; if the sale wins, the
  removal is refused as "passes have been sold". Never a pass whose events changed under it.
- **An event's time changes** so it would start before the Season's sales end: the event edit is
  refused, naming the Season and its sales end, so pass sales never run past the first game's start.
- **Single tickets were already sold** for an event when its Season goes on sale with a presale:
  those tickets stay valid; their seats are taken for passes; new single sales wait for the
  presale's end.
- **A Season with a presale is cancelled**: the presale ends with it; single tickets sell at once.
- **A level is added to or removed from the layout** (`039`'s editor) after the Season was priced:
  publishing or a price save is refused while a level has no price; a removed level's price goes
  with it. (A layout with tickets sold can't be edited in `039`, so this only happens before sales.)
- **General admission**: each priced ticket type name must exist on every event of the Season; an
  event without one is refused, naming the event and the name. A ticket type renamed or deleted on
  an event in a Season with that name priced is refused, naming the Season.
- **Sales end passes** with the Season on sale: it stays on sale in status but sells nothing; the
  admin list shows "Sales ended".
- **Passes-per-customer limit lowered** below what a customer already holds: allowed; it only limits
  new purchases.
- **A Season with no sport** (a concert series): saved and sold the same way; how the customer app
  groups it is `042`'s decision.

## Requirements *(mandatory)*

### Functional Requirements

**Seasons and their events**

- **FR-001**: Admins (and only admins, checked by the Backend) MUST be able to create, read, list,
  edit, put on sale, cancel, and delete Seasons.
- **FR-002**: A Season MUST have a name (1 to 100 characters), one venue, a layout of that venue or
  general admission, a sales end time, and a status: draft, on sale, or cancelled. It MAY have a
  sport from a fixed list and a team name (1 to 100 characters), both or neither; a time single
  tickets go on sale; and a limit of passes per customer (1 to 10).
- **FR-003**: Every event of a Season MUST be at the Season's venue; for a seated Season, every
  event MUST be a seated event on the Season's layout; for a general-admission Season, every event
  MUST be general admission. A save that breaks this MUST be refused, naming each event at fault.
- **FR-004**: An event MUST belong to at most one Season, guaranteed under concurrent saves. A
  Season MUST NOT take an event that is cancelled or whose start has passed.
- **FR-005**: A Season's events, venue and layout MUST be changeable until its first pass is sold,
  and MUST NOT change after, guaranteed against a pass sold at the same moment; the refusal MUST say
  passes have been sold.
- **FR-006**: A Season's sales end MUST be in the future when it is put on sale, and no later than
  the start of its earliest event (not cancelled) at every save. The time single tickets go on sale,
  when set, MUST be no later than the sales end.
- **FR-007**: An event in a Season (not cancelled) MUST NOT change its layout, switch between
  reserved seating and general admission, or move its start before the Season's sales end; the
  refusal MUST name the Season.
- **FR-008**: A draft with no passes MUST be deletable; deleting it frees its events. A Season on
  sale or cancelled MUST NOT be deleted.

**Prices and going on sale**

- **FR-009**: A seated Season MUST have one pass price per price level of its layout; a
  general-admission Season MUST have one pass price per ticket type name it sells, at least one, and
  every event MUST have a ticket type of each priced name. Prices are USD, 0.00 or more, to the
  cent.
- **FR-010**: Putting a Season on sale MUST be refused while it has fewer than 2 events (not
  cancelled), a level with no price (seated), no priced name (general admission), or its sales end
  in the past; each refusal MUST name the field or level at fault.
- **FR-011**: Prices MAY change while a Season is on sale; a pass already sold, its orders and its
  tickets MUST keep the prices they were sold at.
- **FR-012**: The contract MUST state the price split for `042`: the pass price divided evenly
  across the Season's events, rounded down to the cent, the remainder on the earliest event.

**Presale**

- **FR-013**: While a Season is on sale and its time single tickets go on sale is in the future,
  its events MUST be described to every client as selling single tickets from that time, and the
  contract MUST state that single-ticket holds and orders for them are refused until then, with a
  conflict naming the time (enforced by `042`). Otherwise single sales are as before.

**Cancelling**

- **FR-014**: Cancelling a Season MUST be one all-or-nothing step: every pass refunded (each of its
  orders refunded and tickets voided, as `005` refunds an order), every pass being bought ended, the
  freed seats announced to live seat maps, the Season cancelled and read-only. Its events MUST stay
  scheduled. Clients MUST ask the admin to confirm first, saying how many passes will be refunded.
- **FR-015**: Cancelling an event in a Season MUST work as `005` (refunding every order for it, pass
  orders included); each pass MUST stay valid for the Season's other events.

**Refusals and forms**

- **FR-016**: Every refusal MUST use the existing error shape and, when a field, event or level is
  at fault, name it so the form shows the message beside it (`031`'s field details).
- **FR-017**: Both Admin apps MUST have a Seasons page in the navigation (list, create, edit), with
  the form behaviour of the event form as it stands on `main` when the implementation starts (a
  red outline and "Required" on missing fields once #189 is merged), messages beside fields, focus
  on the first field at fault, every entered value kept after a refusal, controls locked with the
  reason beside them when the Backend would refuse a change (events after the first sale; everything
  on a cancelled Season).
- **FR-018**: The Seasons list MUST show each Season's name, venue, sport and team, number of
  events, status (Draft, On sale, Presale until …, Sales ended, Cancelled), passes sold and pass
  revenue. Times are shown and entered in the venue's time zone (`020`).
- **FR-019**: The event form and event page MUST say when an event belongs to a Season, naming it,
  and lock the layout and seating-kind controls with that reason.

**Reports**

- **FR-020**: The sales report MUST give, for each event and in its totals, pass tickets sold and
  pass revenue (part of the tickets sold and revenue, not added to them); the Seasons list and a
  Season's page MUST give its passes sold and pass revenue; refunded passes count nowhere. The
  attendee list MUST mark each order bought on a pass with its Season's name.
- **FR-021**: The CSV, Excel and PDF exports of the sales report and attendee list (`023`) MUST
  carry the same pass figures and marks as the screen, in both Admin apps.

**Parity, demo and contract**

- **FR-022**: The Rust Admin app MUST have the same Seasons page and report changes as the Admin
  app, page for page, in the same implementation; the cross-app page comparison MUST cover the
  Seasons pages.
- **FR-023**: The demo reset MUST create one Season on sale: Louisville Cardinals Basketball at the
  KFC Yum! Center on its Basketball layout, at least 3 upcoming games, every level priced, and
  single tickets going on sale a few days after the reset, the same on every run.
- **FR-024**: This spec's pull request MUST carry the shared contract: the data model and migration
  for Seasons, their events, prices, passes, pass holds and an order's pass; the API for both sides
  (`042`'s operations marked planned for `042`); and a test fixture making a Season with 3 events,
  prices and one sold pass, usable by both specs' tests without either's screens.

### Key Entities

- **Season**: a named set of events at one venue, on one layout or general admission; sport and team
  (optional, both or neither); status draft, on sale or cancelled; sales end; optional time single
  tickets go on sale; optional passes per customer; when it went on sale and was cancelled.
- **Season event**: one event in one Season; an event is in at most one Season.
- **Season price**: one pass price for one price level (seated) or one ticket type name (general
  admission) of a Season.
- **Season pass**: one customer's purchase of a Season (written by `042`): the buyer and the name on
  its tickets, the seat (seated) or ticket type name (general admission), the total price, active or
  refunded, the confirmation id that makes buying it idempotent.
- **Pass hold** (`042`): the group of one seat hold per event, under one 5-minute timer, while a
  customer buys a pass.
- **Order** (existing): gains the pass it belongs to, if any; one order per event per pass.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin creates a 3-event seated Season, prices it, and puts it on sale in under 3
  minutes in either Admin app, with no API use.
- **SC-002**: Every rule in FR-003 to FR-011 and FR-014 has a test that sends the violating request
  straight to the API and sees it refused, naming the field, event or level; the concurrency rules
  (FR-004, FR-005) each have a test of two simultaneous requests where exactly one succeeds.
- **SC-003**: For the shared fixture's sold pass, the sales report, the attendee list and all six
  exports show the same pass figures in both Admin apps, to the cent.
- **SC-004**: The cross-app page comparison passes with the Seasons list and form included, at both
  of its window widths.
- **SC-005**: After the demo reset, the Basketball Season is on sale, identically on two consecutive
  runs.
- **SC-006**: Cancelling a Season with passes leaves zero valid tickets from its passes and every
  pass order refunded, in one step; a failure part way leaves nothing changed.
- **SC-007**: Each workspace stays at or above the 80% line coverage floor.

## Assumptions

- The sport list is fixed in the contract: Basketball, Football, Baseball, Soccer, Hockey,
  Volleyball. Adding one is a contract change.
- Pass prices are whole-Season prices, not per-event prices; the split (FR-012) is mechanical.
- A Season's status "on sale" is not changed by its sales end passing; the lists derive "Sales
  ended" and "Presale until …" from the times.
- An event of a cancelled Season stays tied to it (an event is in at most one Season, ever, while
  the Season exists); deleting is only for drafts. Moving an event of a cancelled Season to a new
  Season is out of scope for v1.
- Only admins of the Admin apps manage Seasons; gate agents and the Ticket Booth app are unchanged.
- Payment stays simulated; refunds are the simulated refunds of `005`.
- `042` may change the contract's customer side in a small contract pull request that this spec's
  author reviews, as the proposal's parallel rules say.

## Out of Scope

- Everything a customer does: listing and browsing Seasons, the Season page and seat map, pass
  holds, buying a pass, the presale refusal on single-ticket paths, My tickets (`042`).
- Seasons across venues or layouts, partial or flex passes, renewals, payment plans, priority for
  last season's holders, transferring or reselling passes (proposal non-goals).
- Adding events after the first pass sale; reduced late prices.
- Pass-only sections (Nate chose the presale window instead).
