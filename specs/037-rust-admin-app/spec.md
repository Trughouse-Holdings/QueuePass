# Feature Specification: Rust Admin App

**Feature Branch**: `037-rust-admin-app-spec`

**Created**: 2026-11-11

**Status**: Draft

**Issues**: [#163](https://github.com/Trughouse-Holdings/QueuePass/issues/163) (port the admin
app to Rust)

**Input**: John's requirements for the week of 2026-11-11. The team rewrites two of the apps in
Rust, one each. Nathan takes the Admin app; the Customer app's Rust version is Mahdi's, in its own
spec. The Ticket Booth app is skipped. The Rust versions:

1. run at the same time as the current apps;
2. look different, so it is obvious which version you are in (John suggested a red background or
   color); they do not have to look like the current apps;
3. work the same: every feature in the current app is in the Rust one too.

The roadmap number is reserved by this PR's amendment. The next free number before it was 037.

## Context

Today the Admin app (`admin-app/`) is the one place QueuePass admins work. They sign in, manage
venues and their seating, schedule and edit events with ticket types, reserved seating, and
pictures, watch sales and seat maps, read attendee lists and reports, and download them. Each of
those behaviors is defined by a merged spec (`002`, `004`, `005`, `007`, `012`, `013`, `014`,
`015`, `016`, `020`, `021`, `023`, `024`, `025`, `028`, `030`, `031`, `032`, `035`, `036`).

This feature adds a **second** Admin app, written in Rust, called the **Rust Admin app** below.
The current one is the **React Admin app**. Both use the same Backend API and so the same data.
An admin can use either, or both at once, and a change made in one shows in the other. The React
Admin app does not change.

The Rust Admin app is a new front end, so it gets what every front end has under the
constitution: its own container, its own sign-in, tests, a smoke test, and browser tests. The
constitution today fixes TypeScript and React for every front end, gives each app its own realm
(three in all), lets the Backend allow only three front-end origins, and gives the Admin and
Customer apps one shared look with no per-app accent. This feature needs each of those widened,
so its spec PR carries an amendment (see Constitution impact).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in to the Rust Admin app next to the React one (Priority: P1)

An admin opens the Rust Admin app at its own address and signs in, while the React Admin app stays
open and signed in in another tab. The Rust Admin app is red from the first screen, so the admin
always knows which one they are in. Signing out of one leaves the other signed in.

**Why this priority**: Nothing else can be used or checked without sign-in. It also settles the
two rules that apply to every screen: both apps run at once, and the Rust one is obvious.

**Independent Test**: Bring up the system with one command. Open both Admin apps in one browser,
sign in to each as `admin1`, sign out of the Rust one, and use the React one: it is still signed in.

**Acceptance Scenarios**:

1. **Given** the system is up, **When** an admin opens the Rust Admin app's address, **Then** they
   are sent to a sign-in screen that names the Rust Admin app and is red, unlike the React Admin
   app's sign-in screen.
2. **Given** an admin is signed in to the React Admin app, **When** they sign in to the Rust Admin
   app in the same browser, **Then** both stay signed in, and each keeps working past its token
   renewal.
3. **Given** both apps are signed in, **When** the admin signs out of the Rust Admin app,
   **Then** they are signed out of it and of its sign-in session, and the React Admin app stays
   signed in (and the other way around).
4. **Given** a user without the admin role signs in to the Rust Admin app, **Then** they are told
   plainly that they lack access, shown no data, and offered sign-out.
5. **Given** the Backend cannot be reached, **When** the Rust Admin app loads a page, **Then** it
   says so plainly, as the React Admin app does.
6. **Given** any signed-in page of the Rust Admin app, **Then** the page is visibly red (its
   background or its accent), the app's name in the header and the browser tab says it is the Rust
   version, and a sign-out control is shown.

---

### User Story 2 - Manage venues and their seating (Priority: P1)

An admin lists, searches, views, creates, edits, and deletes venues in the Rust Admin app, with
the same rules and messages as the React Admin app: address checking, the time zone picked from
the list, and the seating layout (sections of rows by seats per row).

**Why this priority**: Events need venues. This is the first half of what admins do.

**Independent Test**: Create a venue with a seating layout in the Rust Admin app, then open it in
the React Admin app: it shows the same address, verified status, time zone, and layout. Edit it in
the React app, reload it in the Rust app: the change shows.

**Acceptance Scenarios**:

1. **Given** venues exist, **When** the admin opens Venues, **Then** they see the same venues, with
   the same details and search, as in the React Admin app.
2. **Given** an admin creates or edits a venue, **When** the address service matches the address,
   **Then** the venue is saved verified; **when** it does not, or the service is down, **then** it
   is saved as typed and marked not verified, as in `024`.
3. **Given** a venue, **When** the admin opens it, **Then** they see its address (with its map
   link), time zone, capacity, seating layout with each section's Rows × Seats per row and seat
   count, and its events, with past events hidden unless shown.
4. **Given** a venue the Backend refuses to change or delete (for example, one with events),
   **Then** the Rust Admin app shows the Backend's reason beside the right field or action and
   keeps every value entered.

---

### User Story 3 - Schedule and edit events (Priority: P1)

An admin schedules an event in the Rust Admin app with the same form behavior as the React Admin
app: the three sections of `035`, the times of `036` (date and time controls; doors open as a
length of time before the start or as a date and time; a new event starting today at the next
whole hour and ending 4 hours later), ticket types, reserved seating and the live seat totals,
tickets per customer, and pictures. Editing an event follows the same rules, including controls
locked because tickets are sold.

**Why this priority**: Scheduling events is the core admin job, and the event form carries most of
the Admin app's rules.

**Independent Test**: Schedule an event with two ticket types, reserved seating, a per-customer
limit, and two pictures in the Rust Admin app; open it in the React Admin app and check every
value. Repeat the form's checks (`035`, `036`) in the Rust app and see the same messages.

**Acceptance Scenarios**:

1. **Given** the admin opens Schedule event, **Then** the form shows the same sections, fields,
   defaults, and field-by-field checks as the React Admin app's form, and never sends a problem it
   can see.
2. **Given** a valid event, **When** the admin submits it, **Then** the event, its ticket types, and
   its seating are saved all or nothing, and pictures upload after it exists, as in `031`.
3. **Given** the Backend refuses the event (for example, a clash at the venue within the 60-minute
   buffer), **Then** the reason is shown beside its field and focused, and every value is kept.
4. **Given** an event with tickets sold, **When** the admin edits it, **Then** the controls the
   Backend would refuse are locked, with the reason beside them.
5. **Given** an event, **When** the admin cancels or deletes it, **Then** the Rust Admin app asks
   first and follows the same rules and messages as the React Admin app.

---

### User Story 4 - Watch events, sales, and seats (Priority: P2)

An admin lists and searches events (with the Show past events toggle and filters), opens an event,
and sees its details, pictures, sales, and seat map, with seats that change state as customers
hold and buy them, without reloading.

**Why this priority**: Admins use these screens throughout an event's sale, but they only read.

**Independent Test**: Open a seated event in the Rust Admin app; in the Customer app, hold and then
buy a seat; the Rust Admin app's seat map shows the seat held and then sold without a reload.

**Acceptance Scenarios**:

1. **Given** events exist, **When** the admin opens Events, **Then** they see the same events, the
   same search and filters, and the same past-event behavior as in the React Admin app.
2. **Given** an event, **When** the admin opens it, **Then** they see its venue, times in the
   venue's time zone with the zone made clear, doors open, ticket types, limit, pictures, sales,
   and, for a seated event, the seat map with sold, held, and open seats told apart without
   relying on color alone.
3. **Given** a customer holds or releases a seat, **Then** the Rust Admin app's seat map shows the
   change within the same time the React Admin app does.

---

### User Story 5 - Attendees, reports, and downloads (Priority: P2)

An admin reads an event's attendee list and the sales report in the Rust Admin app and downloads
each as CSV, XLSX, or PDF, with the same figures, columns, and file contents as the React Admin
app's downloads.

**Why this priority**: Needed for parity, and used after sales, not to run them.

**Independent Test**: For one event, download the attendee list and the sales report in each format
from both apps; the files hold the same rows, columns, and values (only the time each file was made
differs).

**Acceptance Scenarios**:

1. **Given** an event with orders, **When** the admin opens its attendees, **Then** they see the
   same attendees and check-in details as in the React Admin app, including the "Check-in details
   removed on …" note of `032`.
2. **Given** the Reports page, **Then** it shows the same totals and per-event rows as the React
   Admin app.
3. **Given** a download in CSV, XLSX, or PDF, **Then** its contents match the React Admin app's file
   for the same data, numbers, dates, and money are kept as data in CSV and XLSX, and the file says
   when it was made.

---

### Edge Cases

- An admin edits the same event in both apps at once: the Backend's rules decide, and the second
  save shows the Backend's refusal or the newer values exactly as the React Admin app would.
- The Rust Admin app's sign-in session ends (expiry or sign-out elsewhere in its own realm): the app
  sends the admin to sign in again, as the React Admin app does.
- The address service is down while a venue is saved: saved as typed, marked not verified (`024`).
- A skipped or repeated local time at the venue (daylight saving): refused or chosen by its offset,
  as in `020`.
- An event becomes past while its page is open: it reads as Ended, as in `030`.
- A picture upload fails after the event is saved: the event stays, and the app says which picture
  failed, as in `014` and `031`.
- A browser narrower than a phone, keyboard-only use, and a screen reader: the same usability the
  React Admin app has (phone-width layout, keyboard access, AA contrast, announced changes).
- The Rust Admin app is down or still building: the rest of the system, the React Admin app
  included, starts and works without it.

## Requirements *(mandatory)*

### Functional Requirements

**Running side by side**

- **FR-001**: The system MUST include the Rust Admin app as its own long-running service, started by
  the same one command as everything else, with its own address and port that differ from every
  other app's.
- **FR-002**: The React Admin app MUST stay in place and unchanged in behavior. Both Admin apps
  MUST be usable at the same time, by the same or different admins, against the same data.
- **FR-003**: The Rust Admin app MUST be written in Rust (John's requirement for this week), and
  MUST read and write data only through the Backend's API, under the existing contract. This
  feature adds or changes no API endpoint.

**Sign-in**

- **FR-004**: The Rust Admin app MUST require sign-in before showing any page, through its own
  sign-in realm and client, with the same sign-in method, role (`queuepass-admin`), and seeded
  admin accounts (`admin1`–`admin5`, password `test123`) as the React Admin app.
- **FR-005**: Signing in to, renewing, or signing out of either Admin app MUST NOT end, change, or
  replace the other's sign-in in the same browser.
- **FR-006**: The Rust Admin app MUST keep tokens in memory only, send the admin's own access token
  on every API call, renew it before it expires, and on sign-out end both its own session and its
  realm's sign-in session.
- **FR-007**: The Backend MUST accept tokens from the Rust Admin app's realm, honour only the
  `queuepass-admin` role from it, and allow the Rust Admin app's address as a front-end origin. A
  token from it MUST get exactly the access an admin token from the React Admin app's realm gets.
- **FR-008**: The seed MUST create the Rust Admin app's realm, client, role, and admin accounts
  with no manual steps, and rerunning it MUST converge on the same state.

**Looking different**

- **FR-009**: Every screen of the Rust Admin app, its sign-in screen included, MUST be visibly red
  (a red background or a red accent across headers, primary buttons, and links) so it cannot be
  mistaken for the React Admin app at a glance.
- **FR-010**: The Rust Admin app's name in its header and browser tab MUST say it is the Rust
  version (for example "QueuePass Admin (Rust)").
- **FR-011**: The red theme MUST keep the usability the React Admin app has: AA contrast for text
  and controls, visible focus, states that do not rely on color alone, keyboard access, and a
  layout that works at phone width. It does not need to match the React Admin app's layout.

**Working the same**

- **FR-012**: The Rust Admin app MUST provide every behavior the React Admin app provides on `main`
  when this feature's implementation PR opens, as defined by the merged specs listed in Context.
  The plan MUST list each one, by screen, as a parity checklist, and the implementation MUST be
  checked against it.
- **FR-013**: At least these screens and actions MUST be present: the signed-in home page; Venues
  (list, search, view, create, edit, delete, seating layout, address check, time zone); Events
  (list, search and filters, Show past events, view, schedule, edit, cancel, delete, ticket types,
  reserved seating with live totals, tickets per customer, pictures, doors open, times in the
  venue's time zone); an event's sales and live seat map; Attendees; Reports; and CSV, XLSX, and
  PDF downloads of the attendee list and the sales report.
- **FR-014**: For the same data and action, the Rust Admin app MUST give the same outcome as the
  React Admin app: the same values saved, the same Backend refusals shown with the same meaning
  beside the same field, the same values kept after a refusal, and the same figures shown.
- **FR-015**: Downloads from the Rust Admin app MUST hold the same rows, columns, and values as the
  React Admin app's downloads of the same data, apart from the time each file was made.

**Quality**

- **FR-016**: The Rust Admin app MUST have automated tests run by the project's one test command
  and in CI, and MUST meet the same 80% line coverage floor as every other front end.
- **FR-017**: The browser tests MUST run the Admin quickstart journeys against the Rust Admin app
  as well as the React Admin app, and this feature's quickstart MUST mark each scenario Automated
  or Manual.
- **FR-018**: The README MUST list the Rust Admin app's address, how to start and test it, and that
  it uses the same admin accounts.
- **FR-019**: The Rust Admin app failing or being unavailable MUST NOT stop any other service from
  starting or working.

### Key Entities

No new data. The Rust Admin app reads and writes the same venues, seating layouts, events, ticket
types, pictures, orders, tickets, and check-ins as the React Admin app, through the same API. The
only new configuration is one sign-in realm with its client, the admin role, and its five admin
accounts.

## Constitution impact

This spec PR carries an amendment (MINOR) that:

- Adds the Rust Admin app as a fourth front end in the Preamble, Principle II, and the Repository
  and Front ends rows of the stack table: Rust, for this app only, with its toolchain choice made in
  the plan. TypeScript and React stay fixed for every other front end.
- Adds its realm and client to Principle V and the Identity row, and its origin to the CORS rule.
- Adds an exception to Principle VII: the Rust Admin app uses its own red theme, not the shared
  theme, so it is clearly a different version. It keeps the usability targets.
- Adds its workspace to Principle VI's coverage floor, measured by its own Rust tooling but run by
  the one test command, and its tests to the Front-end tests row.
- Reserves roadmap row `037-rust-admin-app`. The Customer app's Rust version takes the next number.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh clone, one command brings up both Admin apps, the Customer app, and the
  Ticket Booth app, and an admin can sign in to both Admin apps at once in one browser.
- **SC-002**: 100% of the plan's parity checklist items pass in the Rust Admin app.
- **SC-003**: In a hallway test, 5 of 5 people shown either Admin app name which one it is within 3
  seconds.
- **SC-004**: For one event, every CSV, XLSX, and PDF download from the Rust Admin app matches the
  React Admin app's file for the same data, apart from when it was made.
- **SC-005**: A change made in either Admin app shows in the other on its next load, and a seat held
  or bought in the Customer app shows on the Rust Admin app's seat map without a reload.
- **SC-006**: The Rust Admin app's tests reach at least 80% line coverage, and the Admin browser
  journeys pass against it in CI.
- **SC-007**: Signing out of either Admin app leaves the other signed in, in 10 of 10 tries.

## Assumptions

- **Its own realm.** The Rust Admin app signs in through its own realm (a fourth one, named in the
  plan), not a second client in the React Admin app's realm. A shared realm would let signing out
  of one Admin app sign the admin out of the other, which `028` and Principle V forbid. The admin
  accounts have the same names and password in both realms; admin data is not tied to who made it,
  so nothing depends on the two realms' accounts being the same identity.
- **Parity is a snapshot.** Parity is with `main` when this feature's implementation PR opens.
  Each later Admin feature (for example, seat maps and season tickets) says in its own spec
  whether it also covers the Rust Admin app. Whether John wants every later feature built twice is
  to be asked in Slack, with options, before the seat-map proposal is final.
- **Port.** The Rust Admin app runs on port 5176 unless the plan finds it taken. The Customer
  app's Rust version picks its own.
- **Look.** The Rust Admin app's red theme is its own. It need not match the React Admin app's
  layout, but it keeps the same words for the same things, so the parity check and the browser
  tests can use one script for both.
- **Same downloads.** "The same" for PDFs means the same text, rows, and columns, not
  pixel-identical pages.
- **Out of scope**: changes to the Backend's rules or API; changes to the React Admin app; the
  Customer app's Rust version (Mahdi's, its own spec); a Rust Ticket Booth app (skipped by John);
  removing the React Admin app.
