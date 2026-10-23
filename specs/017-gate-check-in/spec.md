# Feature Specification: Names on Tickets and Gate Check-In

**Feature Branch**: `017-gate-check-in-spec`

**Created**: 2026-10-22

**Status**: Draft

**Issues**: [#39](https://github.com/Trughouse-Holdings/QueuePass/issues/39) (names on tickets),
[#40](https://github.com/Trughouse-Holdings/QueuePass/issues/40) (Ticket Booth check-in)

**Input**: User description: "Names on tickets plus Ticket Booth check-in. Every valid ticket
carries the name of the person expected to use it, set when bought; an order without the required
name(s) is refused with a clear message; the name is shown to the customer on My tickets, to admins
on the attendee list, and to gate agents at check-in; tickets bought before this feature still work
and clearly have no name; demo data includes names. The Ticket Booth app checks customers in. The
Customer app lets a customer print a static QR code for each valid ticket. A gate agent scans the
QR with the device camera or types the 12-character ticket code; sees what the ticket is for and the
holder's name; unusable tickets are refused with the reason. For printed QR or typed codes the agent
is prompted to check a government-issued ID matching the ticket's name, then admits (records the
entry) or refuses (not an entry; the ticket stays usable). A ticket enters exactly once even if two
agents scan at the same moment; only gate agents can check in, enforced by the Backend; Admin
reports and attendee lists show real check-ins; the Booth app uses the shared theme and works on a
phone. Rotating 30-second QR codes are out of scope (spec 018, #41)."

## Clarifications

### Session 2026-10-22

- Q: Whose name goes on each ticket of a multi-ticket order, and can it change after purchase? →
  A: The buyer types one name, their own, and it goes on every ticket of the order. It cannot be
  changed after purchase.
- Q: Should a refused ID check be recorded? → A: No. Refusing leaves no trace; recording it is left
  to the audit log (#51).
- Q: Can an entry be undone, and can a holder re-enter? → A: No undo and no re-entry. An admitted
  ticket is used for good.
- Q: When a buyer arrives with their group, does the agent admit each ticket one at a time, or the
  whole order after one ID check? → A: After one ticket is looked up, the agent sees how many of
  its order's tickets are still unused and, after one ID check, can admit just this ticket or all
  of them at once. Each ticket is still its own entry and is admitted at most once.
- Q: When can a ticket be used to get in? → A: From 2 hours before its event's start until its
  event's end.
- Q: Must the camera scan work on a real phone in the demo, or is the laptop's webcam enough? → A:
  The webcam is the required demo. A documented optional step serves the Ticket Booth app over
  HTTPS so a real phone on the same network can scan; it is not part of the automated tests.
- Q: Should this spec's PR clarify the constitution's identity rule for holder names, or leave the
  constitution alone? → A: Add a PATCH clarification to Constitution V in this spec's PR (3.1.2
  when decided; 3.2.1 since 3.2.0 merged first): a name the buyer types onto an order is ticket
  data, not an identity.

## Context

Builds on `001` (gate agents sign in to the Ticket Booth app), `005` (orders, tickets, attendee
lists, check-in figures in reports), `006` (customers get tickets and see them on **My tickets**),
`007` (seated tickets), and `012` (the shared theme).

Today:

- **Ticket Booth app**: a hello-world page behind sign-in, for the gate-agent role (spec `001`).
- **Ticket codes**: every ticket has a 12-character code that the customer and admins can see.
  Nothing in QueuePass looks a ticket up by its code.
- **Check-in figures**: Admin reports and attendee lists show how many tickets are checked in, and
  **My tickets** shows a ticket as "Used", but nothing can check a ticket in. The figures come only
  from demo data.
- **Who a ticket is for**: an order records which customer account bought it (its username, for
  display) and nothing about who will attend. Customer accounts have placeholder names only.

This feature gives every new ticket a holder's name, and gives the Ticket Booth app its first real
job: checking people in at the gate, once per ticket, with an ID check against that name.

Spec `018` (#41) adds QR codes that change every 30 seconds and need no ID check. This spec's printed
QR code and typed code stay as the fallback that always needs one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Gate Agent Admits a Ticket Holder Once (Priority: P1)

A gate agent signs in to the Ticket Booth app on a phone, chooses the event they are working, and
types a ticket's code. The app shows the event, the ticket type or seat, and the holder's name, and
prompts the agent to check a government-issued ID that shows that name. The ID matches, the agent
presses **Admit**, and the app confirms the entry. When anyone tries the same code again, at any
gate, it is refused as already used, with the time it was used.

**Why this priority**: This is the feature. Every other story feeds it or reports on it. A typed
code works on every device, so this story does not wait on the camera.

**Independent Test**: With demo data loaded, sign in as `agent1`, choose an event, type a valid
ticket's code, admit it, and confirm the success message. Type it again and confirm the "already
used" refusal with the time. Confirm the Admin attendee list shows the ticket as checked in.

**Acceptance Scenarios**:

1. **Given** a valid, unused ticket for the chosen event, **When** the agent enters its code,
   **Then** they see the event, the ticket type (or "General admission" for an event sold at its
   base price), the seat if any, and the holder's name, with a prompt to check an ID that shows
   that name, and controls to **Admit** or **Refuse**.
2. **Given** that ticket on screen, **When** the agent presses **Admit**, **Then** the entry is
   recorded with the time and the agent, and the app says the holder is admitted.
3. **Given** an admitted ticket, **When** its code is entered again by any agent, **Then** it is
   refused as "Already used", with the date and time of the entry.
4. **Given** the ticket on screen, **When** the agent presses **Refuse** (no ID, or the name does
   not match), **Then** no entry is recorded, the app says the holder was not admitted, and the
   same ticket can be entered again later and admitted.
5. **Given** a code the agent mistypes in letter case, or with spaces or dashes, **When** they
   submit it, **Then** it is treated as the same code.
6. **Given** a ticket whose order has 4 unused tickets, **When** the agent looks it up, **Then**
   they see "4 unused tickets on this order" and, besides **Admit**, an **Admit all 4** control;
   **When** they press **Admit all 4** after the ID check, **Then** all 4 tickets are admitted, each
   as its own entry, and the app says 4 admitted.
7. **Given** a ticket whose order has no other unused tickets, **Then** only **Admit** is offered.

---

### User Story 2 - Two Gates, One Ticket, One Entry (Priority: P1)

Two people with copies of the same printed ticket arrive at two gates at the same moment. Both
agents look the ticket up and both press **Admit** at the same moment. Exactly one entry is
recorded. The other agent is told the ticket was just used, and when.

**Why this priority**: "A ticket gets one person in" is the rule a gate exists to enforce. A rule
that two simultaneous scans can beat is not enforced (Constitution IV).

**Independent Test**: Send many genuinely concurrent admit requests for the same ticket, from
different gate-agent accounts, and confirm exactly one succeeds and every other one is refused as
already used.

**Acceptance Scenarios**:

1. **Given** a valid, unused ticket, **When** two agents admit it at the same moment, **Then**
   exactly one entry is recorded, and the other agent is told it is already used, with the time.
2. **Given** a valid, unused ticket, **When** 20 admit requests for it arrive at the same moment,
   **Then** exactly one succeeds.
3. **Given** an admitted ticket, **When** the same agent presses **Admit** again (a double tap),
   **Then** the second press is refused as already used and nothing else changes.

---

### User Story 3 - Unusable Tickets Are Refused With a Reason (Priority: P1)

A gate agent enters a code that cannot get anyone in. The app refuses it and says why, in words a
gate agent can say to the customer, without showing an **Admit** control.

**Why this priority**: A gate that only knows "yes" is not a gate. The reason lets the agent send
the customer to the right place.

**Independent Test**: Enter, in turn, an unknown code, a code of a cancelled event's ticket, a used
ticket's code, and a valid code for a different event, and confirm each refusal and its reason.

**Acceptance Scenarios**:

1. **Given** a code that matches no ticket, **When** it is entered, **Then** the app says "No
   ticket has this code" and offers to enter another.
2. **Given** a void ticket (its order was refunded, for example because the event was cancelled),
   **When** its code is entered, **Then** the app says the ticket was cancelled and refunded.
3. **Given** a valid ticket for another event, **When** its code is entered, **Then** the app names
   the event the ticket is for and refuses it at this gate.
4. **Given** a used ticket, **When** its code is entered, **Then** the app says when it was used.
5. **Given** a refusal, **Then** no **Admit** control is shown, and nothing is recorded.

---

### User Story 4 - Every New Ticket Carries a Holder's Name (Priority: P1)

A customer getting tickets types their own name before confirming. It goes on every ticket of the
order and is shown with each ticket on **My tickets**. The buyer comes to the gate with their group
and shows an ID with that name. An order without a valid name is refused, and the customer is told
why.

**Why this priority**: The ID check in US1 compares an ID with this name. Without it, the gate can
only check that a code exists.

**Independent Test**: As a customer, get 3 tickets and enter a name; confirm all 3 tickets show
that name on **My tickets** and on the Admin attendee list. Send an order with a missing name
directly to the Backend and confirm it is refused with no order recorded.

**Acceptance Scenarios**:

1. **Given** the Get tickets form, **Then** it asks for one name, says it goes on every ticket and
   must match the ID the buyer shows at the gate, and the confirm control is not enabled until a
   valid name is entered.
2. **Given** a valid order of 3 tickets with a name, **When** it is confirmed, **Then** all 3
   tickets carry that name, shown on **My tickets** next to each ticket's code.
3. **Given** an order sent with a missing, blank, or invalid name (FR-003), **When** it reaches the
   Backend, **Then** it is refused with a message that says the name is missing or invalid and
   why, and no order or ticket is recorded.
4. **Given** a seated order, **Then** every seat's ticket shows the order's name.
5. **Given** a confirmed order, **Then** neither the customer nor anyone else can change its name
   through QueuePass.
6. **Given** a ticket bought before this feature, **When** it is shown on **My tickets**, the
   attendee list, or the Ticket Booth app, **Then** it says "No name on ticket" instead of a name.

---

### User Story 5 - Customers Print a QR Code; Agents Scan It (Priority: P2)

From **My tickets**, a customer opens a printable view of a valid ticket: a QR code, the ticket's
code in plain text, the holder's name, the event, its venue and time, and the seat if any. They
print it, or show it on screen. At the gate, the agent points the phone's camera at the QR code,
and the app looks the ticket up exactly as if its code had been typed (US1), including the ID check.

**Why this priority**: Typing 12 characters per person is slow at a busy gate. Scanning is what
makes the Ticket Booth usable, but US1 already proves the rules without it.

**Independent Test**: Print (or open) a ticket's QR view, scan it with the Ticket Booth app's
camera, and confirm the same ticket appears with the same ID-check prompt as typing its code.

**Acceptance Scenarios**:

1. **Given** a valid ticket on **My tickets**, **When** the customer chooses to print it, **Then** a
   view opens that fits one ticket on a printed page, with the QR code, the code in text, the
   holder's name, the event, venue, start time, and seat, and the browser's print dialog can print
   it legibly in black and white.
2. **Given** a void or used ticket, **Then** no printable QR view is offered for it.
3. **Given** the Ticket Booth app, **When** the agent chooses to scan, **Then** it asks for camera
   access, shows the camera view, and looks the ticket up as soon as a QR code is read, without a
   further tap.
4. **Given** a scanned QR code, **Then** the agent is prompted for the ID check exactly as for a
   typed code.
5. **Given** a device with no camera, or camera access refused, **Then** the app says so plainly and
   the typed code (US1) still works.
6. **Given** a QR code that is not a QueuePass ticket, **When** it is scanned, **Then** the app says
   it is not a QueuePass ticket and keeps scanning.

---

### User Story 6 - Admins See Real Check-Ins (Priority: P2)

An admin opens an event's attendee list during the event and sees, for each ticket, its holder's
name and whether it has been checked in, and when. The sales report's checked-in figures count the
real entries recorded at the gate.

**Why this priority**: The figures already exist on screen. This story makes them true, which is
what an admin needs, but the gate works without it.

**Independent Test**: Admit two tickets of an event through the Ticket Booth app, then open the
Admin attendee list and the report for that event and confirm both show 2 more checked in, with
times.

**Acceptance Scenarios**:

1. **Given** an event with admitted tickets, **When** an admin opens its attendee list, **Then**
   each ticket shows its holder's name (or "No name on ticket") and, if admitted, the time of
   entry.
2. **Given** an admitted ticket, **When** an admin opens the sales report, **Then** the event's
   checked-in count includes it.
3. **Given** a refused scan (US1 scenario 4 or US3), **Then** no figure changes.
4. **Given** a customer whose ticket was admitted, **When** they open **My tickets**, **Then** the
   ticket shows as "Used" with its time of entry.

---

### Edge Cases

- **A group at the gate**: every ticket of an order carries the buyer's name. The buyer shows
  their ID once and the agent admits the whole group with **Admit all** (FR-015a), or one ticket at
  a time if only some have arrived. Group members arriving without the buyer are refused at the ID
  check, the accepted cost of one name per order.
- **Admit all races another gate**: if some of the order's tickets are admitted at another gate
  between the lookup and **Admit all**, those are not admitted again; the rest are, and the app
  says how many were admitted here and how many were already used, with when.
- **Tickets without a name** (bought before this feature): the agent sees "No name on ticket"
  instead of a name, and the prompt asks them to check that the person presents a valid ID; the
  agent decides to admit or refuse. These tickets still enter exactly once.
- **Event not yet open for entry, or long over**: see FR-019. A refusal says when entry opens or
  that the event has ended.
- **Cancelled event**: its tickets are void (spec `005`) and refused as cancelled, at every gate,
  including another event's (research R5). Entries recorded before the cancellation stay on
  record and keep their time.
- **Ticket refunded after it was used**: no customer refunds exist yet (#45, roadmap `009`). When
  an event is cancelled after people have entered, every ticket is voided as today, and the entries
  stay on record. Those features decide whether a used ticket can be refunded.
- **Agent's session expires mid-scan**: the action is refused, nothing is recorded, and the agent
  is sent to sign in again, keeping the event they chose.
- **A customer, or an admin, tries to check a ticket in**: the Backend refuses it (FR-016), even
  through the API directly.
- **The same ticket on screen at two gates**: the first **Admit** wins (US2); the second agent's
  **Admit** is refused as already used, even though their screen showed it as valid a moment ago.
- **Poor connection at the gate**: if the Backend cannot be reached, the app says so and records
  nothing locally. No ticket is admitted offline (see Out of Scope).
- **Bright light, damaged print, or a phone screen with glare**: the agent can always type the code
  printed under the QR code.
- **Very long names, or names in non-Latin scripts**: shown in full, wrapped, on every screen,
  including the narrowest phone width.

## Requirements *(mandatory)*

### Functional Requirements

**Names on tickets (#39)**

- **FR-001**: Every order created from this feature on MUST carry one holder's name, the buyer's
  own, typed by the customer before confirming. Every ticket of the order carries that name. The
  Get tickets form MUST say that the name goes on every ticket and must match the ID the buyer
  shows at the gate.
- **FR-001a**: The holder's name MUST NOT be changeable after the order is confirmed, by the
  customer, an admin, or a gate agent.
- **FR-002**: The Backend MUST refuse an order whose name is missing or does not meet FR-003, using
  the standard error shape with its own stable code and a message that says why. A refused order
  records no order and no ticket.
- **FR-003**: A valid name is 1 to 100 characters after trimming leading and trailing spaces,
  contains at least one letter (in any script), and contains no control characters. Inner runs of
  spaces are kept as typed.
- **FR-004**: The holder's name MUST be shown with its ticket on **My tickets**, on the printable
  ticket (FR-012), on the Admin attendee list, and in the Ticket Booth app when the ticket is looked
  up.
- **FR-005**: Tickets created before this feature MUST keep working exactly as today and MUST be
  shown as having no name ("No name on ticket") wherever FR-004 shows a name.
- **FR-006**: The demo data MUST give every demo ticket a holder's name, and MUST include at least
  one event whose entry window (FR-019) is open when the demo data is loaded, with unused tickets.

**Looking a ticket up at the gate (#40)**

- **FR-007**: The Ticket Booth app MUST let a signed-in gate agent choose the event they are working
  from events that are not cancelled and have not ended, and MUST keep that choice until they change
  it or sign out.
- **FR-008**: A gate agent MUST be able to look up a ticket by typing its code. Letter case,
  spaces, and dashes MUST be ignored.
- **FR-009**: A gate agent MUST be able to look up a ticket by scanning its printed QR code with the
  device's camera (FR-012). A scan MUST behave exactly like typing the code it carries.
- **FR-009a**: Camera scanning MUST work on the laptop running QueuePass, with its webcam, after
  the usual single start command (Constitution II). The README MUST document an optional step that
  lets a phone connected to the laptop open the Ticket Booth app from a secure address and scan
  with its camera. That step MUST NOT be required for the demo, the automated tests, or any other
  app, and MUST NOT change any service's configuration. (The plan refines "on the same network" to
  "connected to the laptop": research R10.)
- **FR-010**: A lookup MUST show the ticket's event, ticket type (or "General admission" for an
  event sold at its base price; the price itself is not shown), seat if any, holder's name
  (FR-004, FR-005), and whether it can be admitted at this gate now.
- **FR-011**: A ticket that cannot be admitted MUST be refused with one stated reason: no ticket has
  this code; cancelled and refunded; already used (with the date and time); for another event (named);
  or outside the entry window (FR-019, with when entry opens or that the event has ended). No
  **Admit** control is offered for a refused ticket.

**Printed QR code**

- **FR-012**: For each valid, unused ticket, the Customer app MUST offer a printable view with a QR
  code that encodes the ticket's code and nothing else, the code in plain text, the holder's name,
  the event's name, venue, and start time, and the seat if any. It MUST print legibly on one page in
  black and white.
- **FR-013**: The printed QR code MUST be treated as no more secret than the ticket code it carries.
  Whoever holds a copy of it can present it, which is why every printed or typed code requires the
  ID check (FR-014).

**ID check and entry**

- **FR-014**: For a ticket looked up by a typed code or a printed QR code, the app MUST prompt the
  agent to check a government-issued photo ID that shows the ticket's holder's name, before offering
  **Admit** and **Refuse**. For a ticket with no name, the prompt asks for a valid ID only.
- **FR-015**: **Admit** MUST record exactly one entry for the ticket: its time and the gate agent
  who admitted it. A ticket MUST NOT be admitted more than once, even when several admit requests
  for it arrive at the same moment from any number of agents, guaranteed by the database
  (Constitution IV). Every admit after the first MUST be refused as already used, with the time of
  the entry.
- **FR-015a**: A lookup MUST show how many of the ticket's order's tickets are still unused. When
  more than one is, the agent MUST be offered, after the same ID check, to admit all of them at
  once. **Admit all** MUST admit each of those tickets that is still unused when it arrives, each as
  its own entry under FR-015, skip any already used, and report both counts. It MUST NOT admit
  tickets of any other order.
- **FR-016**: Only users with the gate-agent role MAY look tickets up for entry or admit them. The
  Backend MUST enforce this (Constitution V), refusing other roles with `403` and missing or invalid
  sign-in with `401`.
- **FR-017**: **Refuse** MUST NOT record an entry or change the ticket in any way. The same ticket
  MUST be admittable later. A refusal MUST NOT be recorded anywhere; recording refusals is left to
  the audit log (#51).
- **FR-018**: An admitted ticket MUST NOT be usable to enter again, and an entry MUST NOT be undone
  through QueuePass, by a gate agent or an admin. There is no re-entry.
- **FR-019**: A ticket MUST be admittable only from 2 hours before its event's start until its
  event's end. Outside that window, it is refused with the reason (FR-011).

**Reports and customer views**

- **FR-020**: Admin reports' checked-in figures and the attendee list MUST count and show entries
  recorded by FR-015, with each entry's time.
- **FR-021**: **My tickets** MUST show an admitted ticket as "Used", with the time of entry.

**The Ticket Booth app**

- **FR-022**: The Ticket Booth app MUST take its look from the shared theme in `packages/shared/`
  (Constitution VII, which says the Booth app adopts the theme when a spec gives it functionality),
  defining no look of its own.
- **FR-023**: The Ticket Booth app MUST be usable at phone width (360 CSS pixels) without horizontal
  scrolling, with touch targets of at least 44 by 44 CSS pixels for **Admit**, **Refuse**, and
  **Scan**, keyboard access for every control, and states (admitted, refused, and each refusal
  reason) that do not rely on color alone.
- **FR-024**: The result of every lookup, admit, and refusal MUST be announced to assistive
  technology, and MUST stay on screen until the agent starts the next lookup.

### Key Entities

- **Order**: gains the **holder's name** (FR-001, FR-003): the buyer's own, fixed at
  confirmation, absent on orders created before this feature.
- **Ticket**: carries its order's holder's name. Its existing check-in time becomes the time of its
  one **entry**.
- **Entry**: the record that a ticket was admitted: the ticket, the time, and the gate agent (by
  their identity provider subject identifier and username, as orders record their customer). At
  most one per ticket.
- **Gate agent's chosen event**: the event the Ticket Booth app checks tickets against. Kept in the
  app, not stored by the Backend.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test of 20 concurrent admit requests for one ticket from different gate agents,
  exactly one entry is recorded, every time the test is run.
- **SC-002**: A gate agent can go from a scanned QR code to an admitted holder in under 10 seconds,
  not counting the time spent looking at the ID, and can admit a group of 6 on one order in the
  same time with one scan and one ID check.
- **SC-003**: A gate agent can type a ticket's code and see the ticket, or the reason it is refused,
  in under 15 seconds.
- **SC-004**: 100% of refused lookups state one of the reasons in FR-011, and none offer **Admit**.
- **SC-005**: After a ticket is admitted, its event's checked-in figure in the Admin app includes it
  the next time the page is loaded, and **My tickets** shows it as "Used".
- **SC-006**: 100% of orders confirmed after this feature carry a valid holder's name on every
  ticket, and 100% of orders without one are refused.
- **SC-007**: Every ticket bought before this feature can still be admitted exactly once.

## Assumptions

- **Holder names and the constitution**: Constitution V says QueuePass "stores at most the Keycloak
  subject identifier" and does not manage identities. A holder's name is ticket data the buyer types,
  like a seat or a quantity, not an account or identity: it is not tied to any user account, is not
  used to sign anyone in, and is never checked against the identity provider. Orders already store
  the buyer's username for display under the same reading (spec `005` research). This spec's PR
  adds a PATCH clarification to Constitution V saying so (3.2.1, decided 2026-10-22; numbered 3.1.2
  until 3.2.0 merged first), for every team member to approve.
- **The QR code carries only the ticket code** (FR-012). A copy of it is worth exactly as much as
  the code itself, which the customer can already see and copy. Making a copied code worthless is
  spec `018`'s job (#41), not this one's.
- **Entry window** (FR-019, decided 2026-10-22): 2 hours before the start until the end, a common
  time for venue doors to open. A doors-open time on events (#49) can narrow it later.
- **One event at a time**: a gate agent works one event, chosen in the app (FR-007), so a valid
  ticket for the wrong event is refused with its event named (FR-011). A gate serving several events
  at once is out of scope.
- **Cancelling an event that has started** stays allowed, as today (spec `005`). Recorded entries
  stay on record with their time; every ticket becomes void.
- **No offline entry**: the Ticket Booth app needs to reach the Backend to admit anyone, because
  only the Backend can guarantee one entry per ticket (FR-015).
- **Camera on a phone** (FR-009a, decided 2026-10-22): browsers allow camera access only to pages
  served from a secure origin. `localhost` counts; a phone reaching the laptop over the local
  network does not. The required demo uses the laptop's webcam; a phone needs the optional step,
  which the plan makes Android Chrome's USB port forwarding (research R10). iPhones can't use it.
- **Gate agents are the 30 seeded accounts** (`agent1` to `agent30`, spec `001`); no new roles.
- **Typed codes**: the existing 12-character codes from `005` are used unchanged.

## Dependencies

- Constitution 3.1.1 reserves `017-gate-check-in` for #39 and #40 (PR #65, merged).
- Constitution 3.2.0 (PR #67, merged) lets the implementation start while this PR is open.
- Constitution 3.2.1, in this spec's PR, clarifies that a holder's name is ticket data under
  Constitution V.
- Spec `018-rotating-qr-codes` (#41) builds on this spec's lookup and entry rules.
- The live check-in dashboard (#53) and ticket transfer (#46) depend on this spec.

## Out of Scope

- Rotating QR codes, valid only in their 30-second window (spec `018`, #41).
- Admitting tickets with no connection to the Backend.
- A different name for each ticket of an order, and changing a name after purchase (decided
  2026-10-22). Changing a ticket's holder belongs to ticket transfer (#46).
- Undoing an entry, re-entry, and recording refused ID checks (decided 2026-10-22).
- Gates, lanes, or devices as things QueuePass knows about; an entry records only its agent.
- A live, self-updating check-in view for admins (#53).
- Customer refunds, and what happens to a used ticket's refund (#45, roadmap `009`).
- Enforcing an event's age restriction (#49).
- Checking an ID automatically: the agent compares the name by eye.
