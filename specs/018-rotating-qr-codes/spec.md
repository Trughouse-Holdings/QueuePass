# Feature Specification: Rotating QR Codes

**Feature Branch**: `018-rotating-qr-codes-spec`

**Created**: 2026-10-23

**Status**: Draft

**Issue**: [#41](https://github.com/Trughouse-Holdings/QueuePass/issues/41) (rotating QR codes in
the Customer app, valid only in their 30-second window)

**Input**: User description: "018" (the roadmap entry reserved for #41). From the issue: the
Customer app shows each ticket as a QR code that changes every 30 seconds, with how long the current
code has left. A gate agent scans it with the Ticket Booth app, and the customer is admitted or
refused with no ID check. A code is accepted only during the 30-second window it belongs to; a code
from an earlier window (for example, a screenshot passed to someone else) is refused with a clear
reason. Nobody can make a valid code from anything printed on a ticket, or from a code they saw
earlier. The "exactly one entry" rule from #40 still holds. The printed QR code and typed code from
#40 keep working, with their ID check.

## Clarifications

### Session 2026-10-23

- Q: How much grace should a live code get around its window boundary? → A: 5 seconds on each
  side. A code is accepted from 5 seconds before its window starts until 5 seconds after it ends,
  so a code shown in its last second still scans, and a copy is dead at most 35 seconds after it
  first appeared.
- Q: Must the live code keep working with no signal at the venue? → A: Yes, while the app stays
  open. Once **My tickets** has loaded a ticket online, its live code keeps changing with no
  signal for as long as the Customer app stays open. After the app is closed or reloaded, showing
  a live code needs a connection again.
- Q: When a valid live code is scanned, is the holder admitted at once, or does the agent still
  press **Admit**? → A: The agent still presses **Admit**. The scan shows the ticket with no
  ID-check prompt, so the agent stays in control, for example to admit only part of a group.
- Q: Can one verified live code admit all of its order's unused tickets with **Admit all**? → A:
  Yes, as one ID check does in `017`: the buyer's app holds every ticket of the order.
- Q: When can a customer show a ticket's live code? → A: At any time while the ticket is valid and
  unused. The gate still enforces `017`'s entry window.
- Q: When an expired live code is scanned, what does the agent see about its ticket? → A: Only that
  the code has expired and what to ask for instead (a new live code, or a printed ticket with ID),
  nothing about the ticket itself.

## Context

Builds on `017` (holder names, the Ticket Booth app's lookup, ID check, and once-only entry), `006`
(**My tickets**), and `001` (sign-in to the Customer and Ticket Booth apps).

Today (after `017`):

- **Printed QR code**: each valid, unused ticket has a printable view whose QR code carries the
  ticket's 12-character code and nothing else. Anyone with a copy can present it, so the gate agent
  checks a government-issued ID against the ticket's holder's name every time (017 FR-013, FR-014).
- **Ticket Booth app**: a gate agent chooses an event, then scans a printed QR code or types a code,
  checks ID, and admits or refuses. Each ticket is admitted at most once, guaranteed by the database.
  After one lookup the agent can admit all of the order's unused tickets (017 FR-015a).

This feature adds a second way in: a **live code**, shown only in the signed-in Customer app, that
changes every 30 seconds. Because a copy of it stops working within seconds, the gate trusts it
without an ID check. The printed and typed codes stay as the fallback that always needs one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Customer Shows a Live Code and Walks In (Priority: P1)

A customer at the gate opens **My tickets** in the Customer app and chooses **Show entry code** on
a ticket. A large QR code fills the screen with a countdown of how many seconds it has left; every
30 seconds a new code replaces it. The gate agent scans it with the Ticket Booth app. The app shows
the ticket, says the live code is verified and no ID check is needed, and the agent presses
**Admit**. The customer walks in.

**Why this priority**: This is the feature: a faster gate with no ID check, for customers who use
the app.

**Independent Test**: With demo data loaded, sign in as a customer with a ticket for an event whose
entry window is open, open its live code, and scan it with the Ticket Booth app as `agent1` working
that event. Confirm the app shows the ticket with no ID-check prompt, admit it, and confirm the
entry is recorded and **My tickets** shows the ticket as "Used".

**Acceptance Scenarios**:

1. **Given** a valid, unused ticket on **My tickets**, **When** the customer chooses **Show entry
   code**, **Then** a QR code is shown with the seconds left in its window, the holder's name, the
   event, and the seat if any.
2. **Given** a live code on screen, **When** its window ends, **Then** a new code replaces it within
   1 second and the countdown restarts, with no tap or reload.
3. **Given** a live code from the current window, **When** the agent scans it, **Then** the Ticket
   Booth app shows the ticket as in `017` (event, ticket type or seat, holder's name), states that
   the live code is verified and no ID check is needed, and offers **Admit**, with no ID-check
   prompt.
4. **Given** that ticket on screen, **When** the agent presses **Admit**, **Then** one entry is
   recorded exactly as in `017` and the app says the holder is admitted.
5. **Given** a ticket whose order has other unused tickets, **When** its live code is scanned,
   **Then** the agent is offered **Admit all** as in `017`, again with no ID-check prompt.
6. **Given** a used or void ticket, **Then** **My tickets** offers no live code for it.

---

### User Story 2 - A Copied Code Is Refused (Priority: P1)

Someone takes a screenshot of a live code and sends it to a friend. When the friend shows it at the
gate a few minutes later, the Ticket Booth app refuses it and says the code has expired, so the
agent can ask for the live code from the app or a printed ticket with an ID that matches.

**Why this priority**: Skipping the ID check is only safe if a copied code stops working. Without
this story, the live code is weaker than the printed one.

**Independent Test**: Capture a live code, then present it after its window (and any grace allowed
by FR-008, 5 seconds) has passed, and confirm it is refused as expired and nothing is recorded. In the
automated tests, do this with a controlled clock on both sides of every window boundary, not by
waiting.

**Acceptance Scenarios**:

1. **Given** a live code from a window that has ended (beyond FR-008's grace), **When** it is
   scanned, **Then** the app refuses it as expired, says to ask for the live code in the QueuePass
   app or a printed ticket with ID, shows no **Admit** control, and records nothing.
2. **Given** a live code, **When** it is scanned in its own window, **Then** it is accepted; **When**
   the same code is scanned after its window ends (beyond FR-008's grace), **Then** it is refused as
   expired.
3. **Given** a code that looks like a live code but was not made by QueuePass (altered or made up),
   **When** it is scanned, **Then** it is refused as not a valid QueuePass code, and records nothing.
4. **Given** a live code for a ticket that has already been admitted, **When** it is scanned,
   **Then** it is refused as already used, with the time, as in `017`.
5. **Given** an expired code, **Then** the ticket stays usable: the holder can still show a fresh
   live code, or a printed ticket with ID, and be admitted.

---

### User Story 3 - The Printed Ticket and Typed Code Still Work (Priority: P1)

A customer whose phone is dead brings the printed ticket from `017`. The agent scans it, checks
their ID against the name, and admits them, exactly as before this feature.

**Why this priority**: The issue requires it, and it is the fallback for every customer the live
code cannot serve (no phone, no app, dead battery).

**Independent Test**: Re-run `017`'s printed-QR and typed-code checks after this feature and confirm
each still prompts for the ID check and admits once.

**Acceptance Scenarios**:

1. **Given** a ticket's printed QR code or typed code, **When** it is looked up, **Then** the ID
   check prompt from `017` is shown, as before.
2. **Given** a ticket admitted by its live code, **When** its printed or typed code is used, **Then**
   it is refused as already used, and the other way around.
3. **Given** a printed QR code, **Then** nothing on it (the QR code, the ticket code, or any other
   text) lets anyone make a valid live code.

---

### User Story 4 - One Entry Per Ticket, However It Is Presented (Priority: P1)

A customer shows the live code at one gate while a friend shows a copy of the printed ticket at
another, at the same moment. Exactly one of them gets in.

**Why this priority**: `017`'s once-only rule must not get a second path around it (Constitution
IV).

**Independent Test**: Send many genuinely concurrent admit requests for one ticket, some from live
code lookups and some from printed-code lookups, from different gate agents, and confirm exactly one
succeeds.

**Acceptance Scenarios**:

1. **Given** a valid, unused ticket, **When** 20 admit requests for it arrive at the same moment,
   some through its live code and some through its printed code, **Then** exactly one succeeds and
   every other one is refused as already used.

---

### Edge Cases

- **Scan near a window boundary**: a code shown in the last second of its window may be read just
  after the window ends. It still counts for 5 seconds after the boundary (FR-008).
- **Customer's phone clock is wrong**: the live code MUST still be accepted (FR-009); the Backend's
  clock, not the phone's, decides which window is current.
- **No signal at the venue**: the live code keeps changing as long as the Customer app stays open
  after loading **My tickets** online (FR-010). If the app is closed or reloaded with no signal, it
  can't show a live code, and the holder uses the printed ticket with ID.
- **Offline longer than the sign-in session's idle limit** (Keycloak's SSO Session Idle, 30 minutes
  by default; the realm sets none): FR-010 still holds while there is no signal. Once the signal is
  back, the first quiet renewal is refused and the customer is sent to sign in; the printed ticket
  with photo ID remains the fallback.
- **Code expires between lookup and Admit**: the lookup already verified the code, so the agent can
  still press **Admit** for that lookup; the once-only rule (`017` FR-015) still applies. A new
  lookup needs a new code.
- **A live code shown for another event's gate**: refused, naming the ticket's event, as in `017`.
- **Outside the entry window** (`017` FR-019): the live code can be shown at any time, but the
  ticket is refused with when entry opens, or that the event has ended, exactly as in `017`.
- **Someone relays the live code in real time** (a video call, or a friend copying the screen and
  showing it within seconds): accepted risk. Whoever presents first is admitted; the ticket is then
  used, and the holder can't get in with it. The same is true of a ticket handed over in person.
- **A buyer deliberately extracts their ticket's entry secret** from their own signed-in app and
  gives it away: accepted risk. It is the same as the buyer handing over the ticket. Whoever uses
  it first is admitted once; it never yields a second entry, and it can't be got from a printed
  ticket or a screenshot.
- **Tickets bought before `017`** (no holder's name): they get live codes too, and need no ID check
  when one is used.
- **Ticket becomes used or void while its live code is on screen**: any code still on screen is
  refused for that reason; **My tickets** stops offering a live code the next time it is loaded.
- **Screen brightness or glare**: the agent can still type the code printed under the customer's
  printed QR code, or the customer can show the ticket code from **My tickets**; both need the ID
  check.
- **Many tickets on one phone**: each ticket has its own live code; a group with one phone can show
  one ticket's code and be admitted with **Admit all** (US1 scenario 5).

## Requirements *(mandatory)*

### Functional Requirements

**Showing the live code (Customer app)**

- **FR-001**: For each valid, unused ticket, **My tickets** MUST offer **Show entry code**, which
  shows the ticket's live code as a QR code, the seconds left in its window, the holder's name (or
  "No name on ticket"), the event's name and start time, and the seat if any.
- **FR-002**: The live code MUST change every 30 seconds, on its own, with no tap or reload. Windows
  are consecutive, half-open 30-second periods (Constitution, Time), the same for every ticket. The
  new code MUST appear within 1 second of its window starting.
- **FR-003**: Only the customer who bought a ticket's order MAY get its live codes. The Backend MUST
  enforce this, refusing every other customer, every other role, and missing or invalid sign-in, in
  the standard error shape (Constitution V).
- **FR-004**: The live code MUST be readable by the Ticket Booth app's camera from a phone screen
  held at a normal distance, and the countdown MUST be shown as text, not by color or motion alone.
  The countdown MUST NOT be announced to assistive technology every second; a new code may be
  announced once per window at most.
- **FR-005**: The live code can be shown at any time while the ticket is valid and unused; entry is
  still limited to `017`'s entry window (FR-019 there), checked at the gate.

**Making codes that can't be copied or forged**

- **FR-006**: A live code MUST identify its ticket and its window, and MUST be impossible to make
  without the ticket's entry secret. The secret is never printed, never shown on screen, never part
  of the ticket's code, the printed QR code, or any live code, and reaches no one but the Backend
  and the buyer's own signed-in Customer app, which holds it in memory only (FR-010). Knowing a ticket's code, its printed QR
  code, and any number of its earlier live codes MUST NOT let anyone make a live code for any other
  window.
- **FR-007**: Guessing a valid live code for any ticket and window MUST be at least as hard as
  guessing a ticket's 12-character code.

**Checking the live code (Ticket Booth app and Backend)**

- **FR-008**: The Backend MUST accept a live code only in the window it belongs to, judged by the
  Backend's clock, with a grace of 5 seconds on each side: from 5 seconds before its window starts
  until 5 seconds after it ends. A code outside its window and grace MUST be refused as expired.
- **FR-009**: Which window is current MUST be decided by the Backend's clock. A customer's device
  whose clock is wrong by up to 5 minutes MUST still show codes that the Backend accepts.
- **FR-010**: Once **My tickets** has loaded a ticket while online, its live code MUST keep
  changing, and keep being accepted (FR-008, FR-009), with no connection, for as long as the
  Customer app stays open. Nothing about live codes may be kept on the device once the app is
  closed or reloaded; showing a live code then needs a connection again.
- **FR-011**: The Ticket Booth app MUST tell a live code apart from a printed or typed ticket code
  when scanning, with no choice by the agent. A live code is looked up exactly like a ticket code in
  `017`, with these differences:
  - A live code within its window (and grace, FR-008) MUST be shown with a statement that it is a
    verified live code and no ID check is needed, and with **Admit** (and **Admit all** where `017`
    offers it), without the ID-check prompt.
  - An expired live code MUST be refused as expired, with what to ask the holder for (a new live
    code, or a printed ticket with ID), and MUST show nothing about the ticket itself (no event,
    name, or seat).
  - A code in the live-code form that QueuePass did not make MUST be refused as not a valid
    QueuePass code.
  - Every refusal reason from `017` FR-011 (cancelled and refunded, already used, for another event,
    outside the entry window) MUST apply unchanged after the live code itself is accepted.
- **FR-012**: A refused live code MUST record nothing and MUST NOT change the ticket. The ticket
  stays usable by any other means (`017` FR-017).
- **FR-013**: Only users with the gate-agent role MAY look up a live code. The Backend MUST enforce
  this, refusing other roles with `403` and missing or invalid sign-in with `401`.

**Unchanged from `017`**

- **FR-014**: The printed QR code and typed code MUST keep working exactly as in `017`, each with
  its ID check (017 FR-013, FR-014). Using any one of the three to admit a ticket uses the ticket
  for all three.
- **FR-015**: A ticket MUST be admitted at most once, whichever way it is presented, even when admit
  requests made through live, printed, and typed codes arrive at the same moment, guaranteed by the
  database (`017` FR-015, Constitution IV).
- **FR-016**: The Ticket Booth app's lookup result for a live code MUST meet `017`'s usability
  rules (FR-023, FR-024 there): phone width, touch targets, states that do not rely on color alone,
  and results announced to assistive technology.
- **FR-017**: The live-code view in the Customer app MUST take its look from the shared theme
  (Constitution VII) and work at phone width (360 CSS pixels) without horizontal scrolling.

### Key Entities

- **Ticket**: gains an **entry secret**, used only to make and check its live codes (FR-006). It is
  never printed, never shown, and never part of the ticket code. Every usable ticket has one,
  including tickets bought before this feature.
- **Live code**: what the Customer app shows for one ticket in one 30-second window. It identifies
  the ticket and the window and proves it was made with the ticket's entry secret. It is not stored;
  the Backend checks it when it is scanned.
- **Window**: one of the consecutive, half-open 30-second periods all live codes share (FR-002),
  numbered by the Backend's clock.
- **Entry**: unchanged from `017`: at most one per ticket, whichever code was used.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In automated tests with a controlled clock, a live code is accepted at the first
  instant of its grace before its window (5 seconds before it starts) and the last instant of its
  grace after (5 seconds after it ends), and refused just outside each, every time the tests are
  run.
- **SC-002**: 100% of live codes presented after their window and grace are refused as expired, and
  none of them records an entry.
- **SC-003**: A gate agent can go from scanning a live code to an admitted holder in under 5 seconds,
  with no ID check.
- **SC-004**: In a test of 20 concurrent admit requests for one ticket, mixing live and printed code
  lookups from different gate agents, exactly one entry is recorded, every time the test is run.
- **SC-005**: Every printed-QR and typed-code check from `017` still passes after this feature, with
  its ID check.
- **SC-006**: The live code on screen changes within 1 second of each window boundary, on a device
  whose clock is up to 5 minutes wrong, and keeps changing for at least 10 minutes after the
  connection is lost, with each code still accepted.
- **SC-007**: No ticket's live code can be obtained by any account other than its buyer's, in tests
  covering another customer, an admin, a gate agent, and no sign-in.

## Assumptions

- **No ID check for a live code** (from the issue): a live code proves the person holds the buyer's
  signed-in Customer app at the gate, close enough to the buyer for this proof of concept. The
  holder's name is still shown to the agent.
- **The agent still presses Admit** (decided 2026-10-23): a valid live code shows the ticket with **Admit**, rather than
  admitting on scan, so the agent stays in control (for example, to admit only part of a group, or
  to stop someone who is clearly not the holder). This costs one tap and keeps `017`'s flow.
- **Admit all with a live code** (US1 scenario 5, decided 2026-10-23): the buyer's app holds every ticket of the order,
  so one verified live code can admit the order's unused tickets, as one ID check does in `017`.
- **When the live code can be shown** (issue question 3, decided 2026-10-23): at any time while the ticket is valid and
  unused (FR-005). A code shown early is harmless because it expires within seconds, and the gate
  still enforces `017`'s entry window.
- **Printed and live codes both always work** (issue question 4): the issue requires the printed
  QR code and typed code to keep working, so neither turns the other off. A printed copy still
  needs a matching ID, so it gains nothing from the live code existing.
- **Testing window boundaries** (issue question 5): the automated tests control the clock and test
  both sides of each boundary (Constitution VI), rather than waiting for real windows to pass. The
  plan decides how.
- **Real-time relay is an accepted risk** (Edge Cases): a code relayed live within its window can be
  used once, and only once, like a ticket handed over.
- **No constitution change**: the entry secret is ticket data, not an identity, password, or token
  (Constitution V). It reaches the buyer's Customer app so codes keep changing with no signal
  (FR-010, decided 2026-10-23), held in memory only, as tokens are.
- **No signal doesn't sign the customer out** (FR-010, SC-006): a sign-in renewal that fails for any
  reason other than the identity provider's refusal (no network, a request that hangs, a captive
  portal's page), or a token that expires, leaves the customer signed in, in memory, so the live
  code stays on screen, and the app retries the renewal quietly, with no change of page; only the
  identity provider refusing the renewal ends the session. This reads spec `001` FR-013's "no longer
  possible" as a refusal, not a lost connection, amends `001`'s data-model §4 (its session states,
  annotated in place; research R12), and applies to every app.
- **Grace** (FR-008, decided 2026-10-23): 5 seconds on each side covers the time a scan takes and
  small clock differences, at the cost of a copy working up to 5 seconds longer.

## Dependencies

- Constitution 3.1.1 reserves `018-rotating-qr-codes` for #41 (PR #65, merged).
- Spec `017-gate-check-in` (#39, #40, merged as PR #68): this spec reuses its lookup, refusal
  reasons, entry window, once-only entry, **Admit all**, and the Ticket Booth app's camera scanner.
- Ticket transfer (#46) and the live check-in dashboard (#53) may later build on live codes; neither
  is needed here.

## Out of Scope

- Turning off a ticket's printed QR code or typed code (issue question 4; see Assumptions).
- Admitting anyone with no connection between the Ticket Booth app and the Backend (`017`).
- Wallet passes (Apple Wallet, Google Wallet) or any app outside the Customer app.
- Stopping a code relayed in real time within its window (accepted risk).
- Checking that the person holding the phone is the ticket's holder.
- Recording refused live codes; left to the audit log (#51), as `017` leaves refused ID checks.
