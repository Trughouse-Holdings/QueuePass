# Feature Specification: Add to Calendar

**Feature Branch**: `019-add-to-calendar-spec`

**Created**: 2026-10-24

**Status**: Draft

**Issue**: [#50](https://github.com/Trughouse-Holdings/QueuePass/issues/50) (add to calendar from
My tickets)

**Input**: User description: "019" (the roadmap entry reserved for #50). From the issue: from **My
tickets**, a customer can add an event to common calendar apps (Google Calendar, Apple Calendar,
Outlook). The calendar entry has the event's name, its correct start and end times, and the venue
and its address. The issue leaves two questions open: should the customer's calendar update if the
event later changes or is cancelled, and should this be offered only for tickets that are still
valid.

## Context

Builds on `006` (**My tickets**, every order the signed-in customer placed, with its event and
tickets), `002` (every event has a start and an end; times are instants), `005` (a cancelled event
stays on record, read-only, its orders refunded and its tickets void), `013`
(every venue has a full one-line address), `008` (the Customer app's usability rules: phone width,
keyboard access, contrast), and `012` (one shared theme).

Today **My tickets** shows one card per order: the event's name (a link to the event), the venue's
name, the start time, the tier, the name on the tickets, the quantity, the total, when it was placed,
its status, and its tickets, each with **Show entry code** and **Print ticket** while it is valid and
unused (`017`, `018`). It does not show the venue's address, and nothing on it helps the customer
remember the event outside QueuePass.

This feature adds **Add to calendar** to each order card whose event is still ahead or under way:
one control downloads a standard calendar file that Apple Calendar, Outlook, and most other calendar
apps open, and another opens Google Calendar with the entry already filled in. The entry is a copy
made at that moment; it does not change afterwards.

The constitution's roadmap row for `019` (Constitution 3.4.1) already describes this feature, so it
is not amended.

## Clarifications

### Session 2026-10-24

- Q: If the event later changes or is cancelled, should the customer's calendar update? (issue
  open question 1) → A: No. Adding to a calendar is a **one-time snapshot**, not a live feed: the
  entry holds what the event was when the customer added it and is never updated by QueuePass
  afterwards (decided by Mahdi, 2026-10-24).
- Q: How does the entry reach each calendar app? → A: The customer downloads a standard calendar
  (`.ics`) file, which Apple Calendar and Outlook open, and/or opens Google Calendar with the event
  pre-filled (decided by Mahdi, 2026-10-24). How Outlook is served is in research R9.
- Q: Should this be offered only for tickets that are still valid? (issue open question 2) → A: It
  is offered only for events that are **not cancelled and have not ended** (decided by Mahdi,
  2026-10-24), and only for an order that still holds at least one valid ticket, so a refunded order
  offers nothing (proposed in this spec, confirmed by Mahdi, 2026-10-24). Today an order is refunded
  only when its event is cancelled (`005`), which the first rule already covers; the ticket rule
  also covers the single-order refunds planned in `009`, with no change when it lands (FR-002).
- Q: What is in the calendar entry? → A: The event's name, its correct start and end, and the
  venue's name and full address (decided by Mahdi, 2026-10-24). Nothing else (FR-004).
- Q: Where on **My tickets** does the action appear? → A: Once per order card, with the event's
  details, not on each ticket (proposed in this spec, research R11; confirmed by Mahdi, 2026-10-24).
  Two orders for the same event each offer it, and both make the same entry (FR-007).
- Q: Is the calendar file enough for Outlook, or is a separate Outlook web link needed? → A: The
  file is enough; no Outlook web link (proposed in this spec, research R9; confirmed by Mahdi,
  2026-10-24).
- Q: Should the entry's identifier differ per customer? → A: No. Every file for an event identifies
  the same entry, whoever downloads it, and carries nothing about the customer's account (proposed
  in this spec, research R4; confirmed by Mahdi, 2026-10-24).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Customer Adds an Event to Apple Calendar or Outlook (Priority: P1)

A customer with tickets for Saturday's Season Opener opens **My tickets**. On the order's card, next
to the event's details, they choose **Add to Apple Calendar or Outlook**. A calendar file named
after the event is downloaded; opening it in Apple Calendar or Outlook adds an entry called "Season
Opener" from the event's start to its end, at "KFC Yum! Center, 1 ARENA PLAZA, LOUISVILLE, KY
40202", shown in the customer's own time.

**Why this priority**: This is the feature for two of the three calendar apps the issue names, and
the calendar file works in nearly every other calendar app too.

**Independent Test**: With demo data loaded, as `customer1` with a ticket for an upcoming event,
download the calendar file from **My tickets**, open it in a calendar app, and confirm the entry's
title, start, end, and location match the event, in the device's time zone.

**Acceptance Scenarios**:

1. **Given** an order for an event that is not cancelled and has not ended, with at least one
   valid ticket, **When** the customer opens **My tickets**, **Then** that order's card offers
   **Add to Apple Calendar or Outlook** once, with the event's details, and no ticket row offers it.
2. **Given** that card, **When** the customer chooses **Add to Apple Calendar or Outlook**, **Then**
   a calendar file named after the event (for example `season-opener.ics`) is downloaded, with
   nothing else leaving the device.
3. **Given** that file, **When** it is opened in Apple Calendar or Outlook, **Then** the app offers
   to add one entry whose title is the event's name, whose start and end are the event's start and
   end, and whose location is the venue's name followed by its full address.
4. **Given** a device set to any time zone, **Then** the entry starts and ends at the same moments
   as the event, shown in that zone; the file is the same whatever the device's zone.
5. **Given** an event whose name or venue contains commas, semicolons, a backslash, accented
   letters, or an emoji, or a 200-character name, **Then** the calendar app shows the name and
   location exactly as QueuePass does.
6. **Given** the customer adds the same event a second time from a file, **Then** that file
   identifies the entry exactly as the first did (FR-007), so a calendar app that honors this
   updates the existing entry instead of adding a second one. Whether a given app does is that
   app's behavior; the running-system walk records what the apps it uses do.
7. **Given** the card, **Then** it says, next to the controls, that the calendar entry is a copy
   that will not change if the event does.

---

### User Story 2 - A Customer Adds an Event to Google Calendar (Priority: P1)

On the same card, the customer chooses **Add to Google Calendar**. Google Calendar opens in a new tab
with a new entry already filled in: the event's name, its start and end, and the venue's name and
address. The customer saves it there.

**Why this priority**: Google Calendar is the third calendar app the issue names, and many customers
use it on the web, where opening a downloaded file is awkward.

**Independent Test**: From **My tickets**, choose **Add to Google Calendar** for an upcoming event,
and confirm Google Calendar's new-entry page shows the right title, start, end, and location before
saving.

**Acceptance Scenarios**:

1. **Given** an eligible order card (US1 scenario 1), **Then** it also offers **Add to Google
   Calendar**, which says it opens in a new tab.
2. **Given** that control, **When** the customer chooses it, **Then** Google Calendar opens in a new
   tab on a new entry with the event's name as its title, the event's start and end, and the venue's
   name and full address as its location; **My tickets** stays open in its own tab.
3. **Given** a device or Google account in any time zone, **Then** the pre-filled entry starts and
   ends at the event's moments, shown in that zone.
4. **Given** an event whose name or venue contains `&`, `#`, `/`, `+`, `%`, accented letters, or an
   emoji, **Then** Google Calendar shows the name and location exactly as QueuePass does.
5. **Given** the customer is not signed in to Google, **Then** Google asks them to sign in, and the
   entry is still pre-filled afterwards (Google's own behavior; QueuePass sends nothing else).

---

### User Story 3 - Offered Only for Events Still Ahead or Under Way (Priority: P1)

A customer's **My tickets** lists an event that was cancelled, one that ended last week, and an
event that started an hour ago and is still on. Only the last offers **Add to calendar**.

**Why this priority**: Mahdi's decision (Clarifications). Adding a cancelled or finished event to a
calendar is never what the customer wants.

**Independent Test**: With orders for a cancelled event, an ended event, an event under way, and an
upcoming event, confirm only the last two cards offer the calendar controls. A refunded order for an
event that is still ahead cannot be made until `009` is built, so scenario 4 is checked by the
automated tests only.

**Acceptance Scenarios**:

1. **Given** an order for a cancelled event, **Then** its card offers no calendar control.
2. **Given** an order for an event whose end has passed, **Then** its card offers no calendar
   control. At the event's exact end, it is ended (event windows are half-open, Constitution, Time).
3. **Given** an order for an event that has started but not ended, **Then** its card offers both
   calendar controls.
4. **Given** an order with no valid ticket (every ticket void) for an event that is still ahead,
   which a single-order refund will produce once `009` is built, **Then** its card offers no
   calendar control. **Given** another order for the same event with valid tickets, **Then** that
   card offers them.
5. **Given** an order whose tickets have all been used at the gate (`017`), for an event still under
   way, **Then** its card still offers them; used tickets are still valid tickets.
6. **Given** a card that offers no calendar control, **Then** it shows no disabled control and no
   explanation; it looks as it does today.

---

### Edge Cases

- **Several orders for one event**: each order's card offers the controls, and every file for that
  event identifies the same entry, so adding it twice updates rather than duplicates in calendar
  apps that honor the identifier (FR-007). Google Calendar's pre-filled page always creates a new
  entry; that is Google's behavior and is accepted.
- **The event changes after it was added**: the customer's calendar keeps the old details
  (Clarifications). Adding it again from **My tickets** brings the new details: an app that honors
  the identifier replaces the old entry, others (and Google Calendar's pre-filled page) add a second
  one.
- **The event is cancelled after it was added**: the entry stays in the customer's calendar; the
  card then shows "This event has been cancelled." and no calendar controls, as today.
- **An event that crosses midnight** (22:00 to 02:00): the entry spans both days, in every zone.
- **An event that ends while My tickets is open**: the controls are decided when **My tickets**
  loads. A file made after the end is still a correct entry for a past event; reloading hides them.
- **An event cancelled while My tickets is open**: the card keeps its controls until the page is
  reloaded, since nothing tells the page; the entry then holds the event as it was loaded. After a
  reload, the card says the event is cancelled and offers no controls.
- **The device's clock is wrong**: whether an event has ended is judged by the device's clock, so a
  device that is far off may show or hide the controls for an event that is near its end. The entry
  itself is unaffected: its times come from QueuePass, not from the device.
- **A venue saved before `013`** (one-line address, not verified): its address is used as it is.
- **Names with line breaks or control characters**: line breaks are kept as line breaks; other
  control characters, which calendar files cannot carry, are left out.
- **Very long names and addresses**: the event name (up to 200 characters), venue name (up to 200),
  and address (up to 500) are never cut short, in the file or in the Google Calendar link. The file
  keeps them at any length; the running-system walk opens the Google link for a name as long as the
  Admin form allows (research R8).
- **No calendar app on the device**: the file is downloaded like any other; the customer can open it
  later or import it anywhere. QueuePass does not detect calendar apps.
- **Phones**: the controls fit a phone's width (FR-014), and the calendar file is downloaded like any
  other file. Whether the phone then offers to add it straight to a calendar depends on the phone's
  system and browser, and some browsers, in-app browsers especially, may not save it at all. The
  Google Calendar link is the dependable path on a phone. Real-device behavior is not a requirement
  of this feature.
- **Pop-up blockers**: Google Calendar opens from a link the customer chose, so it is not blocked.

## Requirements *(mandatory)*

### Functional Requirements

**Where and when it is offered**

- **FR-001**: On **My tickets**, each order card whose order is eligible (FR-002) MUST offer two
  calendar controls, **Add to Apple Calendar or Outlook** and **Add to Google Calendar**, once per
  card, with the event's details, and never per ticket.
- **FR-002**: An order is eligible when, at the moment **My tickets** loads its orders, its event is
  not cancelled, the event's end is still in the future (the end itself counts as ended), and the
  order holds at least one valid (not void) ticket, used or not. A card whose order is not eligible
  MUST show no calendar control, enabled or disabled. (Today an order loses its valid tickets only
  when its event is cancelled; once `009` adds single-order refunds, a refunded order's void tickets
  make it ineligible under this same rule, with no change.)
- **FR-003**: Next to the controls, the card MUST say that the calendar entry is a copy that will not
  change if the event does, and assistive technology MUST read that note as the description of both
  controls.

**The calendar entry**

- **FR-004**: The calendar entry MUST have exactly: the event's name as its title; the event's start
  and end; and as its location, the venue's name, a comma and a space, and the venue's full one-line
  address. It MUST NOT contain ticket codes, the holder's name, prices, the customer's account, or
  any other data.
- **FR-005**: The entry's start and end MUST be the event's instants, carried so that every calendar
  app places them at the same moments whatever the time zone of the customer's device, browser, or
  calendar. The calendar file a customer gets for an event MUST be the same whatever the device's
  time zone, apart from the moment it was made.
- **FR-006**: The entry is a one-time snapshot. QueuePass MUST NOT offer a subscription, a feed, or
  any link that a calendar app could use to refresh it later, and MUST NOT change or remove an entry
  after it is added.
- **FR-007**: Every calendar file for the same event MUST identify the entry the same way, so a
  calendar app that recognizes repeated entries updates the existing entry instead of adding a
  second one when the customer adds the event again.

**The calendar file (Apple Calendar, Outlook, and others)**

- **FR-008**: **Add to Apple Calendar or Outlook** MUST download one calendar file in the standard
  iCalendar format (RFC 5545, `.ics`) holding exactly one entry (FR-004), which Apple Calendar and
  Outlook open as an entry to add. Commas, semicolons, backslashes, line breaks, accented letters,
  and emoji in any field MUST appear in the calendar app exactly as in QueuePass, and fields of any
  allowed length MUST be kept whole.
- **FR-009**: The file's name MUST be the event's name in lower case with accents removed from
  letters (`Café Noël` → `cafe-noel`), with every run of characters other than `a`–`z` and `0`–`9`
  replaced by one `-`, without a `-` at either end, at most 60 characters before `.ics`; when nothing
  is left, `event.ics`. It MUST be served as a calendar file
  in UTF-8.
- **FR-010**: Making the file MUST need no request to any server: it is made on the customer's device
  from what **My tickets** already loaded.

**Google Calendar**

- **FR-011**: **Add to Google Calendar** MUST open Google Calendar's new-entry page in a new tab,
  pre-filled with the entry (FR-004, FR-005). Only the entry's title, start, end, and location are
  sent to Google, and only when the customer chooses this control.

**Data My tickets needs**

- **FR-012**: The customer's own order list (`006` FR-008) MUST include, for each order's event, the
  venue's full one-line address, as the venue's own pages show it (`013`).

**Usability**

- **FR-013**: Both controls MUST be reachable and usable by keyboard alone, in the card's reading
  order. Each control's accessible name MUST start with its visible text and name the event (for
  example "Add to Google Calendar: Season Opener, opens in a new tab"), so a screen reader user can
  tell the cards' controls apart.
- **FR-014**: The controls MUST take their look from the shared theme (Constitution VII), meet the
  Customer app's usability rules from `008` (phone width of 360 CSS pixels without horizontal
  scrolling, AA contrast, states not shown by color alone), and be at least 44 by 44 CSS pixels.
- **FR-015**: Nothing else on **My tickets** changes: every card that offers no calendar control
  looks and behaves as it does today.

### Key Entities

- **Calendar entry**: what the customer adds to their calendar for one event: title, start, end,
  location (FR-004), and an identifier that is the same for every copy of that event's entry
  (FR-007). Made on the customer's device; not stored by QueuePass.
- **Calendar file**: an iCalendar (`.ics`) file holding one calendar entry (FR-008, FR-009).
- **Order event summary** (`006`): the parts of an event **My tickets** shows next to an order. It
  gains the venue's full address (FR-012).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For two different events, the calendar file opened in a calendar app and the Google
  Calendar link each produce an entry whose title, start, end, and location match the event exactly,
  checked in the running system (quickstart).
- **SC-002**: For every test event, the calendar file is identical, apart from the moment it was made,
  when made under at least three device time zones (UTC, America/New_York, America/Los_Angeles),
  every time the tests run.
- **SC-003**: 100% of the test fixtures with commas, semicolons, backslashes, line breaks, accented
  letters, emoji, and maximum-length fields are read back from the calendar file exactly, and no
  line of any file is longer than the standard allows (75 octets).
- **SC-004**: A customer can add an event to their calendar from **My tickets** in at most two
  selections in QueuePass (choose the control, then open the file), plus their calendar app's own
  confirmation.
- **SC-005**: In tests, no card for a cancelled event, an ended event, or a refunded order shows a
  calendar control, and every eligible card shows exactly one of each.
- **SC-006**: A keyboard-only user can reach and use both controls on every eligible card.

## Assumptions

- **Snapshot** (decided by Mahdi, 2026-10-24): no updates, so no feed or subscription to keep in
  sync, and no need for the Backend to know who added what. The note next to the controls (FR-003)
  tells the customer, so a changed or cancelled event is not a surprise.
- **Valid tickets** (confirmed by Mahdi, 2026-10-24): an order with no valid ticket offers nothing,
  since the customer no longer holds tickets through it. Today that happens only when the event is
  cancelled (`005`); single-order refunds (`009`) are planned, not built, and are covered by the same
  rule when they land. Used tickets still count, so a customer already inside can still add the event
  (it has not ended).
- **One control per order card** (confirmed by Mahdi, 2026-10-24; research R11): **My tickets** shows
  orders, not events, so the card is where an event's details already are. Grouping orders by event
  would redesign the page, which the issue does not ask for.
- **Outlook** (confirmed by Mahdi, 2026-10-24; research R9): the calendar file covers Outlook, which
  opens or imports `.ics` files. A separate Outlook.com link is not offered.
- **One identifier per event** (confirmed by Mahdi, 2026-10-24; research R4): every file for an event
  identifies the same entry, with no customer data in it.
- **No end time**: does not arise. Every event has a start and an end (`002`; Constitution, Data
  model minimums).
- **Times**: the entry carries the event's instants in UTC, which every calendar app shows in the
  customer's own zone. This does not depend on venue time zones (`020`, #42), and nothing here
  conflicts with them if `020` lands first.
- **Who can add**: only the signed-in customer, for their own orders, on **My tickets**. The file is
  made on their device; there is no public link to it.

## Dependencies

- Constitution 3.4.1 reserves `019-add-to-calendar` for #50.
- Spec `006-customer-ticket-purchase` (**My tickets**, the customer's own order list).
- Spec `013-venue-address-validation` (each venue's full one-line address).
- Spec `005` (cancelled events, refunded orders, void tickets); `008` and `012` (usability, shared
  theme). Spec `009` (single-order refunds) is planned, not built; nothing here waits for it
  (FR-002).
- Spec `020-venue-time-zones` (#42) is specified in parallel; this feature does not depend on it.

## Out of Scope

- Updating or removing calendar entries after they are added; calendar subscriptions or feeds
  (Clarifications).
- Adding a whole order's tickets, seats, ticket codes, or entry codes to the entry (FR-004).
- Reminders or alarms in the entry; the customer's calendar app sets its own.
- A separate Outlook.com or Office 365 web link (research R9), and links for other calendar
  services (Yahoo and others); the calendar file covers them.
- Adding events the customer holds no ticket for (from the Events list or an event page).
- Grouping **My tickets** by event.
