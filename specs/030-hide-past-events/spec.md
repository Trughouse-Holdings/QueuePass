# Feature Specification: Hide Past Events

**Feature Branch**: `030-hide-past-events-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#133](https://github.com/Trughouse-Holdings/QueuePass/issues/133) (hide events that have
ended; the Admin app gets a Show past events toggle)

**Input**: User description: issue #133. Events stay listed after they are over: customers still find
them in the event list, search, and venue pages, and admins see them among the events still coming
up. Past events are hidden by default wherever events are listed, in the Customer app (event list,
search and filters, venue page) and the Admin app (event list, venue page). The Admin app has a
"Show past events" toggle on its event lists that lists them too, clearly marked as ended; the
Customer app has no toggle. **Past** means the current time has reached the event's end time, not its
start. The issue leaves open: filtering in the Backend or in each app; the places a past event must
still be reachable (Customer My tickets, a direct link to a past event's page, the Admin event page,
attendees, sales, and Reports); and whether the Admin toggle is remembered. The roadmap number is
reserved by this PR's amendment (Constitution 3.9.2).

## Context

Builds on `002` and `003` (the event and venue pages in both apps), `004` (the event search and
filters every event list uses: venue, name, dates), `005` (the Admin event page, attendees, sales,
Reports), `006` (My tickets), `008` (the Customer app's search and filters), `017` and `025` (the
Ticket Booth, which already lists only events that have not ended), `019` (Add to calendar, offered
only while an event has not ended), and `020` (event times in the venue's time zone).

Today:

- **The event list returns every event**, whatever its end, soonest start first. Each app shows all
  of them: the Customer app's Events page, its search results and filters, and its venue pages; the
  Admin app's Events page and venue pages. The lists only grow.
- **The Ticket Booth** already leaves out events that have ended, in its own code
  (`booth-app/src/EventPicker.tsx`, `025` FR-014): scheduled events whose end is still ahead.
- **My tickets** lists every order the customer placed, newest first, past events and upcoming ones
  mixed, each with a "Show entry code" link while a ticket is unused, also after its event ended
  (when the gate can no longer admit it, `025`).
- **A past event's Customer page** opens like any other, with "Sales closed: this event has already
  started." in its Get tickets panel; nothing says the event is over.

This feature makes **past** one rule, decided in one place: the Backend's event list leaves past
events out unless the caller asks for them. The Admin app asks when an admin turns on **Show past
events**, and marks those events **Ended**. The Customer app never asks; a customer still reaches a
past event through My tickets, where past orders move to a **Past** section, and through a direct
link, where the page says the event has ended. Every Admin page about one event (its page,
attendees, sales, exports) and Reports work as before.

## Clarifications

### Session 2026-11-09

The issue settles what is hidden and where. Every question it leaves open below took the recommended
answer, written unattended and recorded here as **recommended answer, open to review**, so Mahdi and
the team can overturn it in review of the spec PR.

- Q: When is an event past? → A: **From the instant the current time reaches its end** (`endsAt`):
  windows are half-open (Constitution, "Time"), so an event ending at 10:00 PM is past at 10:00 PM
  exactly and listed at 9:59:59 PM. An event in progress is not past. Status plays no part: a
  cancelled event is past by its end like any other (the issue; FR-001).
- Q: Backend or each app? → A: **The Backend.** The event list gains one optional parameter,
  `includePast`; left out (or `false`), past events are left out, by the Backend's clock at the moment
  it answers. So every client, the Ticket Booth and any future one included, gets the same rule from
  one place, with the other filters and with pagination when `#43` adds it. The apps only decide
  whether to ask (recommended answer, open to review) (FR-002 to FR-005; research R1).
- Q: Who may ask for past events? → A: **Any signed-in caller**, like the event list itself. Hiding
  past events is a matter of what a list shows, not access control: a past event's own page is open
  to every signed-in user already, and customers need past events for their tickets. The Customer app
  simply never asks (recommended answer, open to review) (FR-004; research R3).
- Q: The Admin toggle: remembered? → A: **Kept in the page's address, like the search filters**
  (`004` FR-008), not stored in the browser. Turned on, the page address says so: reloading, going
  back, or sharing the link keeps it on; opening Events from the menu starts with it off, so the
  default the issue asks for is what every fresh visit shows. Remembering it per browser would leave
  an admin who turned it on once seeing every past event from then on, which the default is meant to
  avoid (recommended answer, open to review) (FR-008; research R5).
- Q: Which Admin lists get the toggle? → A: **The Events page and a venue's page**, each its own
  (the issue). The venue edit form, which only checks whether the venue has any events (for its time
  zone note, `024`), always counts past events too; Reports lists every event, as today (FR-007,
  FR-010, FR-013; research R4, R9).
- Q: Customer My tickets? → A: **Two sections: upcoming first, then Past**, both kept, nothing
  deleted. An order belongs under Past once its event has ended, decided when the page loads. In the
  Past section a ticket shows its state but no "Show entry code" link, because the gate no longer
  admits it (`025`); its printable ticket stays (recommended answer, open to review) (FR-015, FR-016;
  research R8). _Amended 2026-11-09 by spec `032` (#129), FR-014: once its event's check-in details
  have been removed, a valid ticket reads "Event over" and has no printable ticket._
- Q: A direct link to a past event in the Customer app? → A: **The page opens and says "This event
  has ended."** under the event's name, with its details as today, never "not found". Its Get tickets
  panel is left as it is (sales closed); issue `#126` rewords it when sales move to the end
  (recommended answer, open to review) (FR-014; research R7). _Amended 2026-11-09 by spec `034`
  (#126), FR-011: the panel now says "Sales closed: this event has ended."_
- Q: How is "Ended" shown in the Admin app? → A: **A plain "Ended" label beside the event's name**,
  in text, not color alone (Constitution VII), on both lists with the toggle on and on the event's own
  page. Each app works it out from the event's end and its own clock when the page loads, as the
  Ticket Booth and Add to calendar (`019`) already do, so no new field is added to the event
  (recommended answer, open to review) (FR-011, FR-012; research R6).
- Q: In what order do past events appear with the toggle on? → A: **The one order the list already
  has, soonest start first**, so past events come first, as every event did before this feature. The
  date filters narrow it (recommended answer, open to review) (FR-006; research R3).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Customers Only See Events That Have Not Ended (Priority: P1)

Jordan opens the Customer app's Events page on Saturday morning. Friday night's concert, which ended
at 11 PM, is gone from the list; tonight's show and next week's are there. He searches "concert" and
filters by the venue: the same, only events that have not ended. On the venue's page, the events
there are the coming ones. At 9:30 PM a show that started at 8 and ends at 11 is still listed: it has
not ended.

**Why this priority**: it is the issue's main ask, and what every customer sees first.

**Independent Test**: with an event that ended a minute ago, one in progress, and one ahead, the
Customer app's list, search, filters, and venue page show the last two and never the first.

**Acceptance Scenarios**:

1. **Given** an event that ended one minute ago, **When** a customer opens the Events page, searches
   for its name, filters by its venue or its date, or opens its venue's page, **Then** it is not
   listed.
2. **Given** an event in progress (started, not yet ended), **Then** it is listed in each of those
   places.
3. **Given** an event ending at 10:00 PM, **When** the list is loaded at 10:00 PM or later, **Then**
   it is left out; loaded before 10:00 PM, it is listed.
4. **Given** a cancelled event that has ended, **Then** it is not listed; a cancelled event still
   ahead is listed and marked cancelled, as today.
5. **Given** any page of the Customer app, **Then** it offers no way to list past events.

---

### User Story 2 - A Customer Still Reaches Past Events They Hold Tickets For (Priority: P1)

Jordan opens My tickets on Saturday. Tonight's show is at the top; Friday's concert is under
**Past**, with its seats and the name on the tickets, but no "Show entry code" link. He taps its
name: the event's page opens and says "This event has ended." A friend's old link to the concert
opens the same page.

**Why this priority**: hiding past events must never lose a customer's tickets or break a link
(the issue's "probably hidden or moved to a Past section, not deleted").

**Independent Test**: as a customer with orders for an ended event and an upcoming one, My tickets
shows both, the ended one under Past without an entry code link; the ended event's page opens and
says it has ended.

**Acceptance Scenarios**:

1. **Given** a customer with orders for an upcoming event and an ended one, **When** they open My
   tickets, **Then** the upcoming order is listed first, and the ended one under a **Past** heading
   after it, each with its tickets, holder name, total, and state as today.
2. **Given** an order under Past with a valid, unused ticket, **Then** it offers no "Show entry code"
   link, and still offers its printable ticket. _Amended 2026-11-09 by spec `032` (#129), FR-014: not
   once its event's check-in details have been removed ("Event over", no printable ticket)._
3. **Given** a customer whose orders are all for ended events, **Then** My tickets shows the Past
   section and says they have no upcoming tickets, with a link to browse events.
4. **Given** the page of an event that has ended, opened from My tickets or a direct link, **Then** it
   opens, shows the event's details, and says "This event has ended."
5. **Given** the page of an event in progress or ahead, **Then** it does not say the event has ended.

---

### User Story 3 - Admins See What Is Coming, and Past Events When They Ask (Priority: P1)

Priya opens the Admin app's Events page. Only events that have not ended are listed, and the page
says past events are hidden. She turns on **Show past events**: last month's events appear, each
marked **Ended**. She reloads: still on. She opens one: its page, attendees, sales, and exports work,
and its page says Ended too. Tomorrow she opens Events from the menu: the toggle is off again. On a
venue's page, the same toggle shows the venue's past events.

**Why this priority**: the issue's second ask: an admin list of events that need acting on, with the
history one click away.

**Independent Test**: with past and coming events, the Admin Events page and a venue's page list
only the coming ones until Show past events is turned on, then list both, the past ones marked Ended;
a past event's page, attendees, sales, and its row in Reports open.

**Acceptance Scenarios**:

1. **Given** past and coming events, **When** an admin opens the Events page, **Then** only events
   that have not ended are listed, and the page says past events are hidden.
2. **When** the admin turns on Show past events, **Then** past events are listed too, in the same
   order (soonest start first), each marked **Ended** in text; the other filters still apply.
3. **Given** the toggle on, **When** the admin reloads, goes back to the page, or opens the page's
   link in another tab, **Then** it is still on; **When** they open Events from the menu, **Then** it
   is off.
4. **Given** search filters and the toggle on, **When** the admin presses Clear, **Then** the search
   filters are cleared and the toggle stays as it was.
5. **Given** a venue with past and coming events, **When** the admin opens its page, **Then** it
   lists the coming ones, says past events are hidden, and its own Show past events toggle lists the
   past ones too, marked Ended.
6. **Given** a past event, **When** the admin opens its page (from the list with the toggle on, from
   Reports, or by its link), its attendees, its sales, or an export, **Then** each works as today,
   and its page marks it Ended.
7. **Given** a past event, **Then** Reports lists it with its figures, as today, and its name opens
   its page.

---

### User Story 4 - One Rule for Every Client (Priority: P2)

A teammate writes a script against the API. Asking for the event list, they get only events that
have not ended; asking with `includePast=true`, every event. The Ticket Booth, which asks for the
list without it, offers exactly what it offered before.

**Why this priority**: the rule lives in one place, so a client cannot get it wrong; the apps' own
behavior follows from it.

**Independent Test**: call the event list with and without the parameter, with an event that ended a
minute ago and one in progress; the first is left out only without it.

**Acceptance Scenarios**:

1. **Given** an event that ended one minute ago and one in progress, **When** the list is asked for
   without the parameter, or with `includePast=false`, **Then** only the one in progress is returned;
   with `includePast=true`, both.
2. **Given** the parameter with any other value, **Then** the request is refused as invalid, naming
   the parameter.
3. **Given** the parameter together with venue, name, or date filters, **Then** they combine: each
   narrows the list.
4. **Given** the Ticket Booth, **Then** it offers the same events as before this feature.

---

### Edge Cases

- **An event ends while a page is open.** A list shows what it loaded until it is reloaded; an event
  that ended meanwhile stays on it, and an Admin "Ended" label appears only after a reload. My
  tickets places orders by the moment the page loaded (as Add to calendar decides, `019`). The
  Ticket Booth keeps its own clock check, as today.
- **A client's clock differs from the Backend's.** The Backend decides what is listed. The apps
  decide only the "Ended" label, My tickets' sections, and the ended notice, from their own clock; a
  few minutes' difference can mark an event a little early or late, never hide or lose it.
- **The exact end.** At `endsAt` the event is past; one millisecond before, it is not.
- **Date filters reaching into the past.** Without the toggle, a date range in the past lists
  nothing, and the Admin page still says past events are hidden, so the admin knows to turn the
  toggle on. In the Customer app, a past date range lists nothing.
- **A venue whose events have all ended.** Its Admin page lists none while the toggle is off and
  says past events are hidden. Deleting it is still refused while it has any event, past included
  (`002`); the refusal names how many, and the toggle shows them.
- **Changing a venue's time zone** moves its past events' times too (`020`, `024`), so the venue
  form's note counts past events.
- **An event moved later.** An admin who edits a past event's end to a later time brings it back
  into the lists from the next load; nothing else is needed. _Amended 2026-11-09 by spec `032`
  (#129), FR-008: not for an event whose check-in details have been removed (a week after its end);
  its times can no longer change._
- **A cancelled event that has ended.** Hidden like any past event; with the toggle on, marked both
  Cancelled and Ended. In the Customer app, its page says both it has been cancelled and that it has
  ended.
- **Demo data.** The demo's past event (`029`'s Season Opener) is no longer in the Customer or Admin
  lists by default; its page, its row in Reports, and the Admin list with the toggle on show it.
- **Sales until the end (`#126`).** When `#126` keeps sales open until an event ends, an event in
  progress is both listed and on sale; the two features share the one boundary, `endsAt`.

## Requirements *(mandatory)*

### Functional Requirements

**The rule**

- **FR-001**: An event MUST count as **past** from the instant the current time reaches its end
  time, and not before (half-open, Constitution "Time"), whatever its status.

**The event list (the Backend)**

- **FR-002**: The event list MUST leave out past events, judged by the Backend's clock when it
  answers, unless the caller asks for them.
- **FR-003**: The event list MUST take one optional parameter, `includePast`, accepting `true` (past
  events included) or `false` (the default); any other value MUST be refused as invalid, with the
  standard error naming the parameter.
- **FR-004**: Any signed-in caller allowed to read the event list MUST be able to ask for past events.
- **FR-005**: The parameter MUST combine with every other filter of the list (venue, name, instant
  range, day range); each narrows the result.
- **FR-006**: The list's order MUST stay soonest start first, with or without past events.
- **FR-007**: Reading one event, its tiers, availability, seat map, images, attendees, sales, and
  every report and export MUST be unchanged: none leaves out past events.

**The Admin app**

- **FR-008**: The Events page and each venue's page MUST each have a **Show past events** control,
  off when the page is opened from the menu or a link without it, kept in the page's address while
  on, so reloading, going back, and opening the link keep it.
- **FR-009**: With the control off, those pages MUST list only events that have not ended and say
  that past events are hidden; turned on, they MUST list past events too. Changing it MUST update the
  list without pressing Search, and Clear MUST NOT change it.
- **FR-010**: The venue edit form's check for whether the venue has events MUST count past events.
- **FR-011**: Every past event the Admin app lists MUST be marked **Ended** in text beside its name,
  and an event's own page MUST be marked Ended once it is past. A cancelled past event MUST show both
  marks.
- **FR-012**: The app MUST decide "Ended" from the event's end and the time the page loaded its
  events.
- **FR-013**: An event's Admin page, attendees, sales, and exports, and Reports (which lists every
  event), MUST work for past events as for any other.

**The Customer app**

- **FR-014**: The Events page, its search and filters, and each venue's page MUST never ask for past
  events and MUST offer no control to show them. A past event's own page MUST open and say "This
  event has ended." under its name. _Amended 2026-11-09 by spec `034` (#126), FR-017: once the
  page's Get tickets panel has loaded the event's availability, the line follows it (shown when
  sales have `ENDED`, not while the event is in progress) instead of the browser's clock; before
  that, this rule stands._
- **FR-015**: My tickets MUST list orders for events that have not ended first, then, under a
  **Past** heading, orders for events that have ended, decided when the page loads; each section
  newest order first; no order is left out. With no upcoming orders, it MUST say so and link to the
  Events page; with no past orders, it MUST show no Past heading.
- **FR-016**: Under Past, a ticket MUST NOT offer "Show entry code"; it MUST keep its state and its
  printable ticket. _Amended 2026-11-09 by spec `032` (#129), FR-014: once its event's check-in
  details have been removed, a valid ticket reads "Event over" and has no printable ticket._

**The Ticket Booth**

- **FR-017**: The Ticket Booth MUST offer the same events as before this feature.

**Documentation**

- **FR-018**: The README's feature table MUST list `030`; the contract MUST document `includePast`,
  its default, and the rule.

### Key Entities

- **Event**: unchanged. Its end time (`endsAt`) decides whether it is past.
- **Past event**: an event whose end time has been reached (FR-001). Not stored; worked out by the
  Backend for lists and by the apps for labels.
- **Show past events**: a control on two Admin pages, held in the page's address only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An event that ended one minute ago appears in 0 of the Customer app's event lists,
  search results, filtered results, and venue pages, and in 0 Admin lists while Show past events is
  off.
- **SC-002**: An event in progress appears in every list where an upcoming event at the same venue
  appears.
- **SC-003**: At an event's end time exactly, the event list leaves it out; one millisecond before,
  it includes it (tested at both instants).
- **SC-004**: With Show past events on, 100% of past events matching the other filters are listed and
  each is marked Ended; it stays on through a reload.
- **SC-005**: A customer's orders for past events are all still on My tickets, under Past; a past
  event's page opens from them and from a direct link in 100% of tries, saying it has ended.
- **SC-006**: A past event's Admin page, attendees, sales, exports, and Reports row open as before.
- **SC-007**: The Ticket Booth offers the same events, for the same times, as before this feature.

## Assumptions

- **The Backend's clock decides lists.** The laptop's clock is the Backend's; the apps run on the
  same machine or close to it, so the labels the apps work out agree with the lists to within
  seconds.
- **No count of hidden events.** The pages say past events are hidden but not how many; counting them
  would need another request on every load. Turning the toggle on shows them.
- **Pagination (`#43`)** is not built yet; when it is, it pages the filtered list, past events left
  out unless asked for, which is why the rule is in the Backend.
- **Add to calendar (`019`)** is already offered only while an event has not ended, so it stays off
  in the Past section without a change.
- **Past check-ins (`#129`)** are not affected: who checked in is still shown on a past event's
  attendees until `#129` decides otherwise.

## Out of scope

- A Customer app control to show past events (the issue: customers see only events not ended).
- Rewording the Customer Get tickets panel's closed message, and selling until the end (`#126`).
- Dropping check-in details after an event (`#129`).
- Pagination of the event list (`#43`).
- Archiving, deleting, or otherwise changing past events: they are only left out of lists.
- The entry code page itself (`/my-tickets/<ticket>/entry-code`, spec `018`): only its link is left out
  under Past (FR-016); opened by its address it still shows a code, and the gate refuses that ticket as
  ended (spec `025`).
- Changing Reports, exports, or the Ticket Booth.
