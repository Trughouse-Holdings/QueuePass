# Feature Specification: Venue Time Zones

**Feature Branch**: `020-venue-time-zones-spec`

**Created**: 2026-10-24

**Status**: Draft

**Issue**: [#42](https://github.com/Trughouse-Holdings/QueuePass/issues/42)

**Input**: User description: "Show event times in the venue's time zone. Every venue has a time
zone. Wherever an event's time is shown or entered (Admin app, Customer app, and later the Ticket
Booth app), it's in the venue's local time, and it's clear to the user which time zone that is.
Existing venues and events keep working."

## Context

Builds on `002` (admins schedule events with the 60-minute rule), `003` (customers see every
event), `004` (event search by date range), `005` and `006` (orders and My tickets), `013` (every
new venue address is checked by the address service, or saved anyway and marked not verified),
`015` (seat holds and their countdown), `016` (per-customer limit), `017` and `018` (the Ticket
Booth app checks tickets in, and shows when a ticket was used or when entry opens).

Today a venue has no time zone. Every app shows event times in the time zone of the viewer's own
device, and the Admin app reads the times an admin types in the admin's own device's zone. A 7 PM
show in Louisville appears as 4 PM to a customer browsing from California, and an admin in
Louisville scheduling a 7 PM show in Phoenix schedules it for the wrong hour. Nothing says which
zone a time is in.

This feature gives every venue a time zone, worked out from its address, and makes every app show
and take every event time in the venue's local time, with the zone's short name next to it
("7:00 PM EDT"). The moments the system stores are unchanged: only how they are entered and shown
changes.

The constitution's roadmap row for `020` ("Every venue has a time zone, worked out from its checked
address; event times are shown and entered in the venue's local time, with the zone made clear, in
every app") already describes this feature, so it is not amended.

## Clarifications

### Session 2026-10-24

- Q: Where does a venue's time zone come from: chosen by the admin, or worked out from its
  address? → A: Worked out from its address, not picked from a list (decided by Mahdi,
  2026-10-24). The address check from `013` already finds where a verified address is; the zone
  is looked up from that place. For an address saved anyway (no place found), the zone comes from
  the state when the state has only one zone; in a state with more than one zone, the admin must
  choose one of that state's zones (decided in this spec, research R3). An admin can correct a
  wrong zone with an explicit choice, which is recorded as an admin's choice (recommended by
  Mahdi, decided in this spec, research R4).
- Q: What zone do existing venues get? → A: Eastern Time (America/New_York), recorded as the
  default; admins can change it (decided by Mahdi, 2026-10-24).
- Q: What happens to an event's stored times if a venue's time zone is changed after events
  exist? → A: The events keep their local times (a 7:00 PM show stays 7:00 PM), so the moments
  stored for them move. The change is refused if any of the venue's events has sold tickets, so no
  customer's ticket time ever moves (decided by Mahdi, 2026-10-24). Because the moments move, the
  60-minute rule is checked again, and the change is refused, naming the events, if it would break
  it (decided by Mahdi, 2026-10-24).
- Q: How is a time that doesn't exist, or exists twice, around a daylight-saving change handled?
  → A: In the event form, a local time that doesn't exist (clocks spring forward past it) is
  refused with a clear message, and a local time that happens twice (clocks fall back) makes the
  form ask the admin which of the two is meant, by its zone abbreviation (decided by Mahdi,
  2026-10-24). The Backend also refuses a time that doesn't exist, and a time sent in the wrong
  zone; for a time that happens twice, the request itself says which one (research R9).
- Q: What counts as "sold tickets" for refusing a zone change? → A: Any order for any of the
  venue's events, past or future, whatever its state (confirmed, refunded, or for a cancelled
  event), because a customer can still see that order's event time on My tickets (decided in this
  spec, research R8; to confirm with Mahdi).
- Q: Event date filters ("from" and "to" days in the Admin event search and the Customer event
  filters) pick days in the viewer's zone today. Do they change? → A: Yes. A day is a day at the
  venue: an event matches a day when it starts on that day in its venue's local time, so the
  filters agree with the dates shown (decided in this spec, research R15).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Customers See Event Times in the Venue's Local Time (Priority: P1)

A customer anywhere opens the Customer app. Every event's start and end time is the venue's local
time, with the zone's short name: a 7 PM show in Louisville reads "Oct 1, 2026, 7:00 PM EDT"
whether the customer is in Louisville, California, or Hawaii. The same is true on the event page,
on My tickets, on the live entry code page, and on the printable ticket.

**Why this priority**: This is the problem the issue reports. A customer who reads the wrong hour
arrives at the wrong time.

**Independent Test**: With a venue in Louisville (Eastern) and one in Phoenix (Arizona), each with
an event at 7:00 PM local time, open the Customer app with the device set to
America/Los_Angeles, then to UTC and Pacific/Honolulu: each event shows "7:00 PM" with its own
venue's zone ("EDT" or "MST"), every time.

**Acceptance Scenarios**:

1. **Given** an event at a Louisville venue starting at 7:00 PM local time on Oct 1, 2026,
   **When** a customer whose device is set to America/Los_Angeles opens the Events list, **Then**
   the card shows "Oct 1, 2026, 7:00 PM EDT" as its start.
2. **Given** the same event, **When** the customer opens the event page, My tickets (holding a
   ticket), the live entry code page, or the printable ticket, **Then** every start and end is
   shown the same way, in Eastern time with "EDT".
3. **Given** a venue in Phoenix (no daylight saving) and an event there on Jul 1 at 7:00 PM local
   time, **Then** it is shown as "7:00 PM MST", in summer as in winter.
4. **Given** an event at 8:00 PM on Dec 5 at a Louisville venue, **Then** it is shown with
   "EST", not "EDT".
5. **Given** an event that runs past midnight, 10:00 PM to 1:00 AM local time, **Then** its start
   and end show their own local dates.
6. **Given** a customer filters events from Oct 1 to Oct 1, **Then** every event that starts on
   Oct 1 in its venue's local time is listed, including a 9:00 PM PDT show in Los Angeles (which
   is already Oct 2 in Louisville), and none that starts on Oct 2 in its venue's local time.

---

### User Story 2 - An Admin Enters Event Times in the Venue's Local Time (Priority: P1)

An admin schedules an event. After choosing the venue, the form says which zone the times are in
("Times are in the venue's time zone: Eastern Time"), and the start and end the admin types are
read as that venue's local time. If the admin picks a different venue, the date and time they
typed stay as typed and are now that venue's local time. Every Admin app page then shows the event
in its venue's local time with the zone's short name.

**Why this priority**: Without it, an admin's typed time depends on where the admin's computer is,
and every new event can be scheduled at the wrong hour.

**Independent Test**: With the admin's device set to America/Los_Angeles, schedule an event at a
Louisville venue from 7:00 PM to 10:00 PM. It is saved as 7:00 PM Eastern (23:00 UTC in October)
and shown as "7:00 PM EDT" on every Admin page and in the Customer app.

**Acceptance Scenarios**:

1. **Given** the event form with a Louisville venue chosen, **Then** the form says the times are
   in Eastern Time, with the abbreviation the chosen date will have ("EDT" in October, "EST" in
   December).
2. **Given** an admin on a device in America/Los_Angeles, **When** they enter Oct 1, 2026, 7:00 PM
   to 10:00 PM at a Louisville venue and save, **Then** the event starts at 7:00 PM EDT (23:00
   UTC) and every app shows "7:00 PM EDT".
3. **Given** the form with 7:00 PM typed at a Louisville venue, **When** the admin chooses a
   Phoenix venue instead, **Then** the fields still say 7:00 PM, the form now says Arizona time,
   and saving schedules 7:00 PM MST.
4. **Given** an existing event, **When** an admin opens its edit form, **Then** its start and end
   fields show the venue's local date and time, whatever the admin's device zone.
5. **Given** an event list, event page, venue page, attendee list, or sales report in the Admin
   app, **Then** each event time is in its venue's local time with the zone's short name.
6. **Given** an admin filters events from Oct 1 to Oct 1, **Then** the result is the same as in
   US1 scenario 6.
7. **Given** a request sent straight to the API with a start time stated in a zone other than the
   venue's (for example "19:00" with the Pacific offset for a Louisville venue), **Then** it is
   refused and nothing is saved, so no client can schedule in the viewer's zone by mistake.

---

### User Story 3 - Daylight-Saving Changes Are Handled Explicitly (Priority: P1)

Twice a year, local clocks jump. On the spring night, 2:00 to 2:59 AM never happens; on the fall
night, 1:00 to 1:59 AM happens twice. An admin who types a time that never happens is told so and
nothing is saved. An admin who types a time that happens twice is asked which one they mean,
shown by its zone abbreviation, before the event can be saved.

**Why this priority**: Without it, an event at a time that never happens would be silently moved,
and an event at a time that happens twice could be an hour off with no one noticing.

**Independent Test**: At a Louisville venue, enter Mar 14, 2027, 2:30 AM as a start: the form
refuses it. Enter Nov 7, 2027, 1:30 AM: the form asks "1:30 AM EDT (the first)" or "1:30 AM EST
(the second)", and saves the chosen one. The same requests sent straight to the API are refused or
saved the same way.

**Acceptance Scenarios**:

1. **Given** a Louisville venue, **When** an admin enters a start of Mar 14, 2027, 2:30 AM,
   **Then** the form says "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump
   from 2:00 AM to 3:00 AM. Choose another time.", nothing is sent, and every value stays.
2. **Given** a Louisville venue, **When** an admin enters a start of Nov 7, 2027, 1:30 AM,
   **Then** the form asks which one is meant, offering "1:30 AM EDT (the first time)" and "1:30 AM
   EST (the second time)", and does not save until one is chosen.
3. **Given** the choice in scenario 2, **When** the admin chooses EST, **Then** the event starts at
   06:30 UTC; with EDT, at 05:30 UTC. Every app shows the chosen one as "1:30 AM EST" or "1:30 AM
   EDT".
4. **Given** an event that starts at 1:30 AM EST on Nov 7, 2027, **When** an admin opens its edit
   form, **Then** the time shows 1:30 AM with "EST (the second time)" already chosen.
5. **Given** a Phoenix or Honolulu venue (no daylight saving), **Then** no time is refused and no
   choice is asked on those dates.
6. **Given** a request straight to the API with a start of Mar 14, 2027, 2:30 AM at a Louisville
   venue, stated with either Eastern offset, **Then** it is refused with its own code and a message
   naming the skipped hour, and nothing is saved.
7. **Given** a request straight to the API with Nov 7, 2027, 1:30 AM at a Louisville venue,
   **Then** it is accepted with either Eastern offset (-04:00 for the first time, -05:00 for the
   second), and saves the time that offset names.
8. **Given** an event from 1:00 AM to 3:00 AM on the spring night, **Then** it is accepted (both
   times exist) and lasts one hour of real time; the event page shows "1:00 AM EST – 3:00 AM EDT".

---

### User Story 4 - A Venue's Time Zone Is Worked Out From Its Address (Priority: P1)

An admin creates a venue with an address the address service verifies. The venue's time zone is
worked out from where that address is, with nothing more to enter, and the admin is told which zone
it got. For an address saved anyway, the zone comes from the state when the state has one zone;
in a state that spans two zones (Kentucky, Tennessee, Indiana, …), the admin chooses which.

**Why this priority**: Every venue needs a zone before its events can be shown correctly, and
admins should not have to know which zone a town is in.

**Independent Test**: With the address service replaced by a stand-in in tests, create a venue
the stand-in matches at a place in Phoenix: it gets the Arizona zone, worked out from the address.
Save anyway an address in Ohio: Eastern, worked out from the state. Save anyway an address in
Kentucky without choosing: refused with the two Kentucky zones to choose from; choose Eastern:
saved, recorded as chosen by an admin.

**Acceptance Scenarios**:

1. **Given** the venue form, **When** an admin saves "430 W Vine St, Lexington, KY 40507" and the
   address service verifies it, **Then** the venue's zone is Eastern Time, worked out from the
   address, and the saved notice says "Time zone: Eastern Time, from the address."
2. **Given** "201 E Jefferson St, Phoenix, AZ 85004", verified, **Then** the zone is Arizona
   (Mountain, no daylight saving).
3. **Given** "1 Arena Plaza, Louisville, KY 40202", saved anyway (not verified), **When** the
   admin did not choose a zone, **Then** the venue is not saved; the form says Kentucky has more
   than one time zone and asks the admin to choose between Eastern and Central; every value stays.
   Choosing Eastern and saving anyway again saves it with Eastern, chosen by an admin.
4. **Given** an address in Ohio saved anyway, **Then** the zone is Eastern, worked out from the
   state, with no question.
5. **Given** a verified venue whose zone was worked out wrong (a venue right at a zone border),
   **When** an admin opens its edit form and chooses another zone, **Then** the change is saved
   (subject to US5) and the venue page says the zone was chosen by an admin.
6. **Given** a venue, **When** an admin changes only its name or seating capacity, **Then** its
   zone is unchanged and not worked out again.
7. **Given** a venue, **When** an admin changes its address, **Then** its zone is worked out again
   from the new address, unless the admin also chose a zone in the same save, and US5's rules
   apply if it changes.
8. **Given** the Admin venue list and venue page, **Then** each venue shows its zone ("Eastern
   Time") and how it was set ("from the address", "from the state", "chosen by an admin", or "the
   default", which existing venues have).
9. **Given** a request straight to the API, **Then** the same rules apply, and a zone not on the
   list is refused.

---

### User Story 5 - Changing a Venue's Time Zone Keeps Its Events' Local Times (Priority: P2)

An admin corrects a venue's zone. The venue's events keep their local dates and times: a 7:00 PM
show is still 7:00 PM, now in the new zone. The change is refused if any of the venue's events has
sold tickets, if any event's time would not exist or would happen twice in the new zone, or if the
moved events would break the 60-minute rule; each refusal names the events, and nothing changes.

**Why this priority**: It is the correction path for a wrong zone, rare and after the fact, but
without these rules it would silently move what customers have bought.

**Independent Test**: A venue in Eastern with two events at 7:00 PM and no orders: change it to
Central; both events now start at 7:00 PM CDT (an hour later in UTC). Add an order to one and try
to change back: refused, naming that event, nothing changed.

**Acceptance Scenarios**:

1. **Given** an Eastern venue with an event from 7:00 PM to 10:00 PM on Oct 1, 2026 and no orders,
   **When** an admin changes the venue to Central, **Then** the event is from 7:00 PM to 10:00 PM
   CDT (00:00 to 03:00 UTC on Oct 2), and every app shows "7:00 PM CDT".
2. **Given** a venue with an event that has one order (confirmed, refunded, or on a cancelled
   event), **When** an admin changes the zone, **Then** it is refused with a message naming the
   event and saying its tickets have been sold, and nothing changes.
3. **Given** a venue moving from Arizona time to Mountain time with an event at 2:30 AM on Mar 14,
   2027 (a time Mountain time skips), **Then** the change is refused naming that event and its
   time; nothing changes.
4. **Given** a venue moving from Arizona time to Mountain time with one event ending at 1:30 AM
   and another starting at 3:00 AM on Mar 14, 2027 (90 minutes apart in Arizona, 30 minutes apart
   in Mountain time), **Then** the change is refused as a scheduling conflict naming both events.
5. **Given** an admin changes a venue's zone while a customer is buying a ticket for one of its
   events, **Then** either the purchase completes first and the zone change is refused, or the
   zone change completes first and the purchase is for the event at its new moment; never both
   against the old state.
6. **Given** a cancelled event without orders at the venue, **Then** it moves with the others and
   keeps its local times.
7. **Given** the zone is changed back, **Then** the events return to their original moments.

---

### User Story 6 - The Ticket Booth Shows Times in the Venue's Local Time (Priority: P2)

A gate agent picks the event they are checking in. The event list, and every time in a lookup or
refusal ("Already used at 7:12 PM EDT", "Entry opens at 5:00 PM EDT", "For Fall Concert on Oct 1,
2026, 7:00 PM EDT, not this event"), is in the venue's local time with the zone's short name.

**Why this priority**: The booth is at the venue, so its device is usually in the venue's zone,
but a laptop set to another zone must not show the wrong hour, and a ticket for another venue's
event must show that venue's zone.

**Independent Test**: With the booth's device set to UTC, pick an event at a Louisville venue and
look up a used ticket: "Already used at" shows the Eastern time with "EDT".

**Acceptance Scenarios**:

1. **Given** the event picker, **Then** each event's start is shown in its venue's local time with
   the zone's short name.
2. **Given** a ticket for an event at a Phoenix venue looked up at a Louisville event's gate,
   **Then** the refusal names the Phoenix event's time with "MST".
3. **Given** a used ticket, **Then** "Already used at" is the venue's local time with the zone.
4. **Given** the live entry code's 30-second windows, the seat-hold countdown, and the entry
   window of 2 hours before the start, **Then** they are unchanged: they are lengths of time, not
   local times.

---

### User Story 7 - Existing Venues and Events Keep Working (Priority: P2)

Venues and events saved before this feature keep working. Each existing venue is set to Eastern
Time, recorded as the default. No event's moment changes. Admins can correct a venue's
zone afterwards, under US5's rules.

**Why this priority**: Events and orders depend on existing venues; nothing may break or move.

**Independent Test**: Insert venues and events as they are before the change, apply the change,
and confirm every venue is Eastern (the default) and every event's start and end are
the same moments as before.

**Acceptance Scenarios**:

1. **Given** venues and events from before this feature, **When** the change is applied, **Then**
   every venue's zone is Eastern Time, recorded as the default, and every event's
   start and end are unchanged to the microsecond.
2. **Given** such a venue, **Then** its events appear in every app in Eastern time with "EDT" or
   "EST".
3. **Given** such a venue without orders, **When** an admin changes its zone, **Then** its events
   keep their local times (US5).
4. **Given** such a venue (one-line address, not verified), **When** an admin first gives it a
   four-part address, **Then** its zone is worked out from the new address (US4).

---

### Edge Cases

- **Venue at a zone border**: The zone comes from where the address service places the address,
  using the official zone boundaries. A venue a few hundred meters from a border could still be
  placed on the wrong side; the admin corrects it (US4 scenario 5).
- **Zone lookup gives nothing usable**: If the place the address service gives has no US zone on
  the list (for example a point offshore), the zone is worked out from the state as for an address
  saved anyway.
- **States with more than one zone**: Alaska, Arizona, Florida, Idaho, Indiana, Kansas, Kentucky,
  Michigan, Nebraska, Nevada, North Dakota, Oregon, South Dakota, Tennessee, and Texas (research
  R3). In these, an address saved anyway needs the admin's choice.
- **Arizona and Hawaii**: no daylight saving, so they never have a skipped or repeated time.
  Arizona's Navajo Nation does observe it; a verified address there gets Mountain time.
- **The address service is down**: The venue is not saved (`013`), so no zone is needed.
- **An event at a venue whose zone is the default**: shown in Eastern time; correct for the
  existing venues, all in Kentucky, which the default was chosen for.
- **Changing the zone and the address together**: one save; the explicit choice wins and the
  zone-change rules (US5) apply once.
- **Changing a zone to the same zone**: nothing moves; it records the zone as chosen by an admin.
- **Moving an event to a venue in another zone** in the form: the typed local times are kept and
  read in the new venue's zone (US2 scenario 3). A request straight to the API that moves an event
  to a venue in another zone must send the start and end too, so it says which local times are
  meant; otherwise it is refused.
- **A time sent in UTC (`Z`) straight to the API**: no US venue is in UTC, so it is refused like
  any other time stated in the wrong zone.
- **An event lasting past a daylight-saving change**: accepted when both ends exist; its real
  length differs by an hour from its clock length, and each end shows its own abbreviation.
- **Ending at a skipped time**: refused the same way as a start.
- **A customer's own clock times**: the 2-minute cooldown message ("you can reserve them again at
  4:42 PM PDT") and the sales report's "as of" time are not event times; they keep the viewer's
  own zone, now with its short name.
- **Countdowns and windows**: the seat-hold countdown (`015`), the live code's 30-second windows
  (`018`), and the entry window (`017`) are lengths of time and are unchanged.
- **Calendar entries** (`019`): calendar files carry exact moments, which this feature never
  changes except through an explicit zone change of a venue with no orders; nothing conflicts.

## Requirements *(mandatory)*

### Functional Requirements

**Every venue has a time zone**

- **FR-001**: Every venue MUST have exactly one time zone from a fixed list of US zones: Eastern,
  Central, Mountain, Arizona (Mountain without daylight saving), Pacific, Alaska, Hawaii-Aleutian,
  and Hawaii, each identified by its standard (IANA) name.
- **FR-002**: When a venue's address is verified by the address service (`013`), its zone MUST be
  worked out from the place the service matched, without asking the admin, and recorded as worked
  out from the address.
- **FR-003**: When no usable zone comes from the matched place (the address was saved anyway, or
  the place has no zone on the list), the zone MUST come from the state when the state has only
  one zone, recorded as worked out from the state. In a state with more than one zone, the save
  MUST be refused unless the admin chose a zone, with a message listing that state's zones; nothing
  is saved and every value is kept.
- **FR-004**: An admin MAY choose a venue's zone explicitly when creating or editing it. An
  explicit choice MUST be used instead of a worked-out zone and recorded as chosen by an admin.
- **FR-005**: A venue's zone MUST be worked out again only when its address changes and no
  explicit zone is sent in the same save. Edits that do not change the address MUST NOT change
  the zone unless an explicit zone is sent.
- **FR-006**: Every venue that exists before this feature MUST get Eastern Time (America/New_York),
  recorded as the default, with no other change.
- **FR-007**: Every venue MUST record how its zone was set: from the address, from the state,
  chosen by an admin, or the default (Eastern, for existing venues, FR-006).
- **FR-008**: Only the Backend decides a venue's zone; the stored zone MUST be one on the list,
  guaranteed by the database.

**Changing a venue's time zone**

- **FR-009**: When a venue's zone changes, every event at the venue (scheduled or cancelled) MUST
  keep its local start and end date and time; the moments stored for them move accordingly.
- **FR-010**: A zone change MUST be refused, with nothing changed, when any event at the venue
  has any order, in any state. The refusal MUST name those events.
- **FR-011**: A zone change MUST be refused, with nothing changed, when any event's local start or
  end time does not exist, or happens twice, in the new zone. The refusal MUST name the event and
  the time.
- **FR-012**: A zone change MUST be refused, with nothing changed, when the scheduled events at
  the venue, at their new moments, would break the 60-minute rule (`002`). The refusal MUST name
  the events.
- **FR-013**: A zone change MUST be all or nothing, and MUST hold under concurrency: no order,
  event write, or other venue write at the same venue may be decided against the old zone and
  saved against the new one, or the other way round.

**Entering event times**

- **FR-014**: The Admin event form MUST read the start and end date and time as local time in the
  chosen venue's zone, and MUST show, next to them, which zone that is, with the abbreviation in
  force on the typed date.
- **FR-015**: When the admin changes the venue in the form, the typed dates and times MUST stay as
  typed and be read in the new venue's zone; the zone shown changes with it.
- **FR-016**: A local time that does not exist in the venue's zone (clocks spring forward past it)
  MUST be refused by the form with a message naming the skipped hour, before anything is sent, and
  every value MUST be kept.
- **FR-017**: For a local time that happens twice in the venue's zone (clocks fall back), the form
  MUST ask which one is meant, offering each with its abbreviation, and MUST NOT save until one is
  chosen. When editing an event at such a time, its stored choice MUST be selected.
- **FR-018**: The Backend MUST refuse an event start or end whose local time does not exist in the
  venue's zone, and one stated in any zone other than the venue's zone at that time (including
  UTC), each with its own stable code and the standard error shape, and save nothing. A time that
  happens twice MUST be accepted as either of its two moments, as the request states.
- **FR-019**: A request that moves an event to a venue in a different zone MUST send the start and
  end; otherwise it MUST be refused.
- **FR-020**: Event date filters in the Admin and Customer apps MUST match an event when it starts
  on a chosen day in its venue's local time.

**Showing times**

- **FR-021**: Wherever any app shows an event's start or end, or a time that belongs to an event
  (when entry opens, when a ticket was used or checked in, when an order was placed, a conflicting
  event's times), it MUST be in that event's venue's local time with the zone's short name (for
  example "Oct 1, 2026, 7:00 PM EDT"), and never depend on the viewer's device zone.
- **FR-022**: This covers, at least: in the Admin app, the event list, event page, venue page's
  events, the event form's conflict message, the attendee list's check-in times, and the sales
  report's event dates; in the Customer app, event cards, the event page, My tickets (event times,
  order time, and ticket used time), the live entry code page, and the printable ticket; in the
  Ticket Booth app, the event picker and every time in a lookup, refusal, or admit result. A
  Backend message that names an event's time (the scheduling conflict) MUST also use the venue's
  local time and the zone's short name.
- **FR-023**: A time that belongs to no event (the seat-cooldown message's "again at", the sales
  report's "as of") MUST be shown in the viewer's own zone, with that zone's short name.
- **FR-024**: The Admin venue list and venue page MUST show each venue's zone and how it was set
  (FR-007), and the venue form MUST let an admin choose a zone (FR-004) and show the choice FR-003
  requires.
- **FR-025**: Lengths of time (the seat-hold countdown, the live code windows, the entry window)
  MUST be unchanged.
- **FR-026**: The Admin app MUST show every refusal from FR-003, FR-010 to FR-012, FR-018, and
  FR-019 as an explicit error and keep every value entered (Constitution IV).
- **FR-027**: The moments stored for events MUST be unchanged by this feature, except by a zone
  change under FR-009 to FR-013.

### Key Entities

- **Venue**: gains a **time zone** (one of the list in FR-001) and **how it was set** (from the
  address, from the state, chosen by an admin, or the default).
- **Event**: unchanged. Its start and end stay exact moments; their local date and time come from
  its venue's zone.
- **US time zone**: one of the eight in FR-001, with a display name ("Eastern Time"), and its
  abbreviations as they change through the year.
- **State zones**: for each state and DC, the zones used in it, so an address without a place can
  get its zone or the admin's choices (FR-003).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the change, 100% of venues have a zone on the list, and 100% of events have the
  same start and end moments as before, checked on a copy of real data.
- **SC-002**: Every event time shown in the three apps is identical whether the viewer's device is
  set to America/New_York, UTC, America/Los_Angeles, or Pacific/Honolulu.
- **SC-003**: A 7:00 PM show at a Louisville venue appears as "7:00 PM EDT" (or "EST" in winter)
  to every viewer, in every app.
- **SC-004**: For each of America/New_York, America/Chicago, America/Denver, America/Phoenix,
  America/Los_Angeles, America/Anchorage, and Pacific/Honolulu, converting a local time to a
  moment and back is exact for every minute of the spring-forward and fall-back days, every
  skipped time is refused, and every repeated time offers exactly two moments.
- **SC-005**: 0 events with any order change their moment through a zone change.
- **SC-006**: An admin creating a venue with a verified address takes 0 extra steps to set its
  zone.
- **SC-007**: 100% of event times sent to the API in a zone other than the venue's are refused.

## Assumptions

- A venue's zone is worked out from its address, not picked (decided by Mahdi, 2026-10-24); an
  admin may correct it, and that is recorded (recommended by Mahdi).
- Existing venues get Eastern Time (decided by Mahdi, 2026-10-24). The existing venues are the demo
  venues in Kentucky (Lexington and Louisville, both Eastern) and test venues.
- Events keep their local times when a venue's zone changes; the change is refused when any of the
  venue's events has sold tickets; the 60-minute rule is checked again (decided by Mahdi,
  2026-10-24). "Sold tickets" means any order in any state (decided in this spec).
- A time that doesn't exist is refused; a time that happens twice is asked about (decided by Mahdi,
  2026-10-24).
- The eight zones cover every US state and DC. Territories are not venues (`013` allows only the
  50 states and DC).
- The address service already gives the place (longitude and latitude) of a verified address
  (checked on 2026-10-24); the zone can be found from it on the Backend without any outside call.
- English abbreviations ("EDT", "CST", "MST", "AKDT", "HST") are clear to QueuePass's users; where
  a zone has no common abbreviation, its offset from UTC is shown instead.
- An event filter's "day" means a day at the venue (decided in this spec).

## Out of Scope

- Venues outside the US, and zones other than the eight in FR-001.
- Letting a customer choose to see times in their own zone.
- Storing a venue's map coordinates (`013` Out of Scope); the place is used only to find the zone.
- Re-checking existing venues' zones in bulk.
- Changing the moments of events that have orders; an admin cancels or recreates instead.
- Changing how calendar entries (`019`) carry times.
