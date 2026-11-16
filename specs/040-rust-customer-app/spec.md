# Feature Specification: Rust Customer App

**Feature Branch**: `040-rust-customer-app-spec`

**Created**: 2026-11-15

**Status**: Draft

**Issues**: [#175](https://github.com/Trughouse-Holdings/QueuePass/issues/175) (port the customer
app to Rust)

**Input**: John's requirements for the week of 2026-11-10: "alternate versions of the application
in Rust for both the admin and the customer app". Nathan built the Admin app's Rust version (spec
`037`, #163, merged as PR #174). This spec is its Customer counterpart, Mahdi's. The Rust versions:

1. run at the same time as the current apps;
2. look different, so it is obvious which version you are in (John suggested a red background or
   color); they do not have to look like the current apps;
3. work the same: every feature in the current app is in the Rust one too.

The roadmap number is reserved by this PR's amendment. The next free number before it was 040.

## Clarifications

### Session 2026-11-15 (Mahdi, product owner)

- Q: Does the Rust Customer app have its own customer accounts, as the Rust Admin app has its own
  admin accounts in its own realm (`037` R4)? → A: No. **Same customer accounts.** It signs in to
  the existing Customer realm (`queuepass-customer-app`) through its own client
  (`customer-rust-app`), with its own exact redirect address and web origin. `customer1` is the same
  person in both Customer apps, so their orders, tickets, and seat holds show in both. Accepted
  trade-off: the two Customer apps share one sign-in session, so signing out of one ends the
  other's sign-in session, and signing in to one can sign the other in without the sign-in form.
  This departs from `028`'s one-app-one-realm rule and needs a constitution amendment (Principle V
  exception, see Constitution impact) (FR-004, FR-005).
- Q: Which red? → A: **The Rust Admin app's red** (accent `#b3261e`, its look colors), so the two
  Rust apps read as one family. The sign-in screen is red too. Because the realm is shared with the
  React Customer app, the red applies only when the sign-in was started by the Rust Customer app;
  the React Customer app's sign-in screen stays as it is (FR-009, FR-010).
- Q: Name? → A: The React Customer app's name with "(Rust)", as `037` did: "QueuePass Tickets
  (Rust)" in the header, the browser tab, and the sign-in heading (FR-010).
- Q: Does it run beside every other app? → A: Yes, with its own address (port 5177), its own
  container in the one-command start, and the host run script, at the same time as the React
  Customer app and the other apps (FR-001).
- Q: How close to the React Customer app? → A: As `037`'s amended rule: the same pages at the same
  paths, the same layout, the same words, and the same behavior; red colors and the "(Rust)" name are
  the only visible differences (FR-020). This is the cheapest way to be "functionally identical",
  because the browser tests and the parity check can then use one script for both apps.
- Q: Which Customer app is "now"? → A: `main` at `680b4f7` (2026-11-15): seat maps (`038`), click
  to hold and the cart (`033`), selling until the end (`034`), past events (`030`), and every earlier
  Customer feature. Anything merged into the React Customer app after it and before the
  implementation PR opens is added to the parity checklist by that PR (FR-012).
- Q: When the React Customer app has a known bug or rough edge, copy it or fix it? → A: Copy it, as
  `037` decided. A fix goes into the React app first, in its own issue (FR-014).
- Q: Is the shared session acceptable at EDIS, where both Customer apps are shown? → A: Yes. The
  demo shows the two Customer apps in separate browser windows, one normal and one private, so
  their sessions don't interfere (quickstart demo note).
- Q: If the Rust app's QR code can't be made module-for-module identical to the React app's in
  time? → A: The fallback is accepted: the same text at the same version and error-correction
  level, which scans the same at the gate. The exact module (mask) match is a goal, not a gate
  (FR-015, research R9).
- Q: What if not everything is done by EDIS (2026-11-20)? → A: Cut line accepted: sign-in,
  browsing, and general-admission buying first (target 2026-11-18), then seats, the cart, and My
  tickets. If the implementation PR has not merged by EDIS, the demo runs from the implementation
  branch.
- Q: Issue #175's wording on the sign-in colors? → A: Updated by Mahdi: "red sign-in colors through
  one per-client style rule" (research R7).

## Context

Today the Customer app (`customer-app/`) is where customers find events, look at venues, hold
seats on a venue map or pick a ticket type, buy tickets from the event page or the cart, and show,
print, or add their tickets to a calendar. Each of those behaviors is defined by a merged spec
(`003`, `006`, `007`, `008`, `012`, `013`, `014`, `015`, `016`, `017`, `018`, `019`, `020`, `021`,
`025`, `026`, `028`, `030`, `032`, `033`, `034`, `038`).

This feature adds a **second** Customer app, written in Rust, called the **Rust Customer app**
below. The current one is the **React Customer app**. Both use the same Backend API and the same
customer accounts, so the same data. A customer can use either, or both at once, and what they do
in one (a seat held, an order placed) shows in the other. The React Customer app does not change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in to the Rust Customer app beside the React one (Priority: P1)

A customer opens the Rust Customer app at its own address and signs in with their usual account.
It is red from the first screen, so they always know which app they are in, and their orders and
tickets are the ones they already have.

**Why this priority**: Nothing else can be used or checked without sign-in, and it settles the
rules every screen follows: both apps run at once, the Rust one is obvious, and the accounts are
the same.

**Independent Test**: Bring up the system with one command. In a fresh browser, open the Rust
Customer app, sign in as `customer1`, and see the red sign-in screen and then the red app. Open My
tickets: the same orders as in the React Customer app.

**Acceptance Scenarios**:

1. **Given** the system is up and no one is signed in, **When** a customer opens the Rust Customer
   app's address, **Then** they are sent to a sign-in screen that names the Rust Customer app and
   is red, while the React Customer app's sign-in screen is unchanged.
2. **Given** a customer signed in to the Rust Customer app, **Then** every page is visibly red (its
   background, surfaces, and accent), the header and the browser tab say it is the Rust version,
   and a sign-out control is shown.
3. **Given** `customer1` has orders made in the React Customer app, **When** they open My tickets
   in the Rust Customer app, **Then** they see exactly those orders and tickets (and the reverse).
4. **Given** a customer is signed in to the React Customer app, **When** they open the Rust
   Customer app in the same browser, **Then** they may be signed in without the form, as the same
   customer (the accepted shared session).
5. **Given** a customer is signed in to both Customer apps, **When** they sign out of either,
   **Then** that app is signed out, the shared sign-in session ends, the account's seat holds are
   released (as signing out does today), and the other Customer app asks for sign-in again once
   its current access ends, never later than its next renewal. Every other app (both Admin apps,
   the Ticket Booth) stays signed in.
6. **Given** a user without the customer role signs in, **Then** they are told plainly that they
   lack access, shown no data, and offered sign-out.
7. **Given** the Backend cannot be reached, **When** a page loads, **Then** it says so plainly, as
   the React Customer app does.

---

### User Story 2 - Find events and venues (Priority: P1)

A customer lists and filters events (search, venue, dates, hide cancelled), never sees past events
in a list, opens an event's page with its pictures, times in the venue's time zone, doors open, the
"already started" note, and the ended and cancelled notes, and looks at venues and their events.

**Why this priority**: Customers must find an event before they can buy for it.

**Independent Test**: With the demo data, filter the event list in both apps by the same search,
venue, and dates: the same events, in the same order, with the same URL. Open the same event in
both: the same facts, pictures, and notes.

**Acceptance Scenarios**:

1. **Given** events exist, **When** the customer opens Events, **Then** they see the same events,
   filters, URL keys, empty states, and cards as in the React Customer app, with no past events.
2. **Given** an event that has started but not ended, **When** its page opens, **Then** it says it
   has already started, when it began, and that tickets are on sale until it ends, in the venue's
   time zone (`034`).
3. **Given** an event that has ended, **When** its page opens (from a link or My tickets), **Then**
   it says the event has ended and sales are closed (`030`, `034`).
4. **Given** an event with pictures, **Then** the gallery rotates, pauses, and opens full screen as
   in the React Customer app (`014`).

---

### User Story 3 - Hold seats on the venue map and buy them from the cart (Priority: P1)

On a seated event, the customer chooses seats on the venue map: sections colored by price, a zoom
into a section, the Sections list for keyboard and screen readers, seats off sale, and the price
tiles. A click holds a seat at once and starts the 5-minute countdown; another click releases it.
Add to cart opens the Cart, where each event's held seats are bought before their countdown ends.

**Why this priority**: It is the main way customers buy, and the most complex Customer screen.

**Independent Test**: In the Rust Customer app, hold two seats of two price levels, release one and
hold it again, Add to cart, enter the name, and buy. The React Customer app's My tickets and the
Admin app's seat map show the same seats sold.

**Acceptance Scenarios**:

1. **Given** a seated event, **When** the customer clicks an open seat, **Then** it is held for
   them at once, the countdown starts at 5:00, and the hold is announced; a second seat joins the
   same countdown; clicking a held seat releases it.
2. **Given** another customer holds or buys a seat, **Then** the map shows it held or sold without
   a reload, within the same time as the React Customer app.
3. **Given** held seats, **When** the customer chooses Add to cart, **Then** the Cart lists them by
   event with the same countdown, and Buy tickets buys them with the name on the tickets.
4. **Given** the countdown reaches 0, **Then** the seats are released and the customer is told, as
   in the React Customer app.
5. **Given** seats held in the React Customer app, **When** the customer opens the Rust Customer
   app's Cart, **Then** the same reservation is there with the same time left (and the reverse).
6. **Given** a customer at the per-customer limit or over the attempt limits, **Then** they are
   told plainly, with a countdown where the React app shows one, and keep what they had (`016`,
   `026`).

---

### User Story 4 - Buy general-admission tickets (Priority: P1)

On a general-admission event, the customer picks a ticket type and quantity, enters the name on the
tickets, and confirms the order, with the same limits, refusals, and confirmation as the React
Customer app.

**Why this priority**: Every general-admission event is bought this way.

**Independent Test**: Buy 2 tickets of a type in the Rust Customer app; see the confirmation with
the ticket codes; open My tickets in the React Customer app: the same order.

**Acceptance Scenarios**:

1. **Given** a general-admission event, **When** the customer confirms an order, **Then** it is
   placed once, even if they press twice or check again after no answer, and the confirmation lists
   the ticket codes.
2. **Given** a refusal (sold out, the per-customer limit, sales closed), **Then** the reason shows
   in the panel and every value entered is kept.

---

### User Story 5 - My tickets: show, print, and add to calendar (Priority: P2)

The customer sees their orders in My tickets, upcoming first and past ones under Past, with each
ticket's state; opens a ticket's live entry code that changes every 30 seconds; prints a ticket;
and adds an event to their calendar.

**Why this priority**: Needed at the gate and for parity, after buying works.

**Independent Test**: For one order, open the entry code in both apps at the same moment: the same
QR code. Print the ticket in both: the same code and facts. Download the calendar file from both:
the same file apart from its stamp time.

**Acceptance Scenarios**:

1. **Given** orders for upcoming and ended events, **Then** My tickets lists them as the React
   Customer app does, with the ended ones under Past and cancelled and refunded ones marked.
2. **Given** a valid ticket, **When** the customer opens its entry code, **Then** the Ticket Booth
   admits the code it shows, in its 30-second window, exactly once.
3. **Given** a ticket, **When** the customer prints it, **Then** the page shows the same QR code,
   code, and facts as the React Customer app's.
4. **Given** an upcoming event, **When** the customer adds it to a calendar, **Then** the file and
   the Google link hold the same event, times, and place as the React Customer app's.

---

### Edge Cases

- The customer buys the same reservation in both apps at once: the Backend's rules decide; one
  order is placed, and the other app shows the reservation as bought or ended, as the React app does
  for a second tab.
- The customer signs out of the React Customer app while the Rust one is open: the Rust app keeps
  working until its access ends, then asks for sign-in again; the holds made in either app were
  released by the sign-out (accepted trade-off).
- A skipped or repeated local time at the venue, and a browser in another time zone: times read in
  the venue's zone, as in `020`.
- An event ends while its page is open: tickets stop selling at the end, as in `034`.
- A seated event switched to general admission while its page is open: as the React app (`038`).
- No connection while the entry code is open: the plain message to use the printed ticket (`018`).
- A browser narrower than a phone, keyboard-only use, and a screen reader: the same usability the
  React Customer app has.
- The Rust Customer app is down or still building: every other service, the React Customer app
  included, starts and works without it.

## Requirements *(mandatory)*

### Functional Requirements

**Running side by side**

- **FR-001**: The system MUST include the Rust Customer app as its own long-running service,
  started by the same one command as everything else and by the host run script, with its own
  address and port that differ from every other app's.
- **FR-002**: The React Customer app MUST stay in place and unchanged in behavior and look, its
  sign-in screen included. Both Customer apps MUST be usable at the same time against the same
  data.
- **FR-003**: The Rust Customer app MUST be written in Rust (John's requirement), and MUST read and
  write data only through the Backend's API, under the existing contract. This feature adds or
  changes no API endpoint.

**Sign-in and accounts**

- **FR-004**: The Rust Customer app MUST require sign-in before showing any page, in the Customer
  app's existing realm, through its own client, with the same sign-in method, role (`customer`),
  and seeded customer accounts (`customer1`–`customer200`, password `test123`) as the React
  Customer app. A customer MUST be the same account in both apps: the same orders, tickets, seat
  holds, limits, and attempt allowances.
- **FR-005**: The two Customer apps MAY share one sign-in session (Clarifications). Signing in to,
  renewing, or signing out of either Customer app MUST NOT end, change, or replace the sign-in of
  any other app (both Admin apps, the Ticket Booth app).
- **FR-006**: The Rust Customer app MUST keep tokens in memory only, send the customer's own access
  token on every API call, renew it before it expires, and on sign-out release the account's seat
  holds as the React app does and end both its own session and the realm's sign-in session.
- **FR-007**: The Backend MUST give a token issued to the Rust Customer app's client exactly the
  access a token issued to the React Customer app's client gets for the same customer, and MUST
  allow the Rust Customer app's address as a front-end origin. The Backend's trusted realms and
  roles do not change.
- **FR-008**: The seed MUST create the Rust Customer app's client in the Customer realm with no
  manual steps, create no second copy of any customer, and converge on the same state when rerun.

**Looking different**

- **FR-009**: Every screen of the Rust Customer app MUST be visibly red, with the Rust Admin app's
  red look colors (page background, header, cards and other surfaces, borders, text, and the
  accent). Its data colors MUST stay the React Customer app's: seat states, price levels, map
  colors, the QR code, and the error, warning, and success colors.
- **FR-010**: The sign-in screen MUST be red, with the Rust Admin app's red sign-in colors, when the
  Rust Customer app started the sign-in, and name "QueuePass Tickets (Rust)". The app's header and
  browser tab MUST say "QueuePass Tickets (Rust)". The React Customer app's sign-in screen MUST NOT
  change.
- **FR-011**: The red MUST keep the usability the React Customer app has: AA contrast for text and
  controls, visible focus, states that do not rely on color alone, keyboard access, and a layout
  that works at phone width.
- **FR-020**: Apart from its colors and its name, the Rust Customer app MUST look like the React
  Customer app: the same pages at the same paths; on each page the same headings, cards, sections,
  fields, buttons, lists, and tables, in the same order and arrangement; the same sizes, spacing,
  and type; and the same changes at phone width and in print.

**Working the same**

- **FR-012**: The Rust Customer app MUST provide every behavior the React Customer app provides on
  `main` when this feature's implementation PR opens, as defined by the merged specs listed in
  Context. The plan lists each one, by screen, as a parity checklist, complete for `main` at
  `680b4f7`; the implementation PR adds a row for any Customer behavior merged after it.
- **FR-013**: At least these screens and actions MUST be present: the sign-in, wrong-role, and
  unreachable states and sign-out; Events (list, search, venue and date filters, hide cancelled,
  past events left out, the cards with their galleries); the event page (gallery and full-screen
  viewer, times, doors open, started, ended, and cancelled notes); Get tickets for general
  admission (ticket types, quantity, name on tickets, per-customer limit, attempt limits, the
  unknown-outcome check, the confirmation); the seated panel (price tiles, Choose seats, the venue
  map with sections by price, zoom, the Sections list, seats off sale, click to hold and release,
  live seat changes, the 5-minute countdown, Your seats, the hold log, Add to cart); the Cart
  (reservations by event, countdowns, name, Buy tickets, run out, bought or ended elsewhere);
  Venues (list and venue page); My tickets (upcoming and Past, ticket states, Add to calendar);
  the printable ticket; and the live entry code.
- **FR-014**: For the same data and action, the Rust Customer app MUST give the same outcome as the
  React Customer app: the same requests, the same Backend refusals shown with the same meaning in
  the same place, the same values kept after a refusal, the same figures and timings, and the same
  visible words. This includes the React Customer app's known bugs and rough edges: the Rust app
  copies them, and a fix made in the React app is then copied too.
- **FR-015**: Files and codes the Rust Customer app makes MUST be the same as the React Customer
  app's for the same data: the calendar file (apart from its stamp time) and the Google Calendar
  link, the text of the printed and the live QR codes (and their version and error-correction
  level; the same modules are a goal, not a requirement, Clarifications), and the live entry code
  for a given 30-second window.

**Quality**

- **FR-016**: The Rust Customer app MUST have automated tests run by the project's one test command
  and in CI. Its logic MUST meet the same 80% line coverage floor as every other front end, and
  every one of its screens MUST be exercised by at least one browser test.
- **FR-017**: The browser tests MUST run the Customer quickstart journeys against the Rust Customer
  app as well as the React Customer app, and this feature's quickstart MUST mark each scenario
  Automated or Manual.
- **FR-018**: The README MUST list the Rust Customer app's address, how to start and test it, that
  it uses the same customer accounts, and the shared sign-in session.
- **FR-019**: The Rust Customer app failing or being unavailable MUST NOT stop any other service
  from starting or working: no service in the one-command start depends on it.

### Key Entities

No new data. The Rust Customer app reads and writes the same events, venues, ticket types, seat
maps, reservations (seat holds), orders, tickets, entry keys, and pictures as the React Customer
app, through the same API, for the same customer accounts. The only new configuration is one
sign-in client in the existing Customer realm.

## Constitution impact

This spec PR carries an amendment, **3.11.1 → 3.12.0 (MINOR)**, that:

- Adds the Rust Customer app as a fifth front end in the Preamble and the stack table's Language, Repository, Front ends, Front-end tests, Lint, and CI rows.
- Adds a **Principle V exception**: the Rust Customer app signs in through its own client in the
  Customer app's realm, so it shares that realm's customers and one sign-in session with the React
  Customer app. The risk (signing out of one Customer app signs the customer out of the other, and
  releases holds made in either) is accepted explicitly for these two apps only; between every
  other pair of apps the one-realm-per-app rule holds. The Identity row, the OIDC clients rule,
  and the role rule name the new client; the CORS rule counts five origins.
- Widens Principle VI's Rust coverage exclusion to the Rust Customer app's view crate, with the same
  replacement control: every Customer browser journey also runs against it, and spec 040's own
  journeys drive the screens they don't reach.
- Widens Principle VII's red exception to the Rust Customer app: the Rust Admin app's red look
  tokens over the Customer app's own stylesheets, and the Rust Admin app's red sign-in tokens.
- Reserves roadmap row `040-rust-customer-app`. The next free number becomes 041.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh clone, one command brings up both Customer apps, both Admin apps, and the
  Ticket Booth app, and a customer can use both Customer apps at once in one browser.
- **SC-002**: 100% of the parity checklist's items pass in the Rust Customer app, the "Same layout"
  items included.
- **SC-003**: In a hallway test, 5 of 5 people shown either Customer app name which one it is within
  3 seconds.
- **SC-004**: An order placed or a seat held in either Customer app shows in the other on its next
  load (the Cart within its 1-second refresh), and a seat held in either shows on the other's map
  within 2 seconds.
- **SC-005**: The Rust Customer app's logic reaches at least 80% line coverage, and the Customer
  browser journeys pass against it in CI.
- **SC-006**: Signing out of either Customer app leaves both Admin apps and the Ticket Booth signed
  in, in 10 of 10 tries.
- **SC-007**: For the same ticket and window, the live entry code the Rust Customer app shows is
  admitted by the Ticket Booth, and equals the React Customer app's.

## Assumptions

- **One realm, two clients.** Decided by Mahdi (Clarifications). The Backend trusts tokens by
  realm and role, not by client, so nothing on the server changes; the new client gets the same API
  audience as every front-end client.
- **The shared session's effects are accepted.** Signing out of either Customer app ends the
  realm's sign-in session; the other Customer app's access lasts until its access token expires,
  then its renewal is refused and it asks for sign-in again. Signing out releases the account's
  holds, made in either app, as the React app does today.
- **Parity is a snapshot** of `main` at `680b4f7`, plus anything merged before the implementation
  PR opens. A later Customer feature says in its own spec whether it covers the Rust Customer app.
- **Port.** 5177, the next free port after the Rust Admin app's 5176.
- **Look.** The Rust Customer app reuses the React Customer app's stylesheets and the Rust Admin
  app's red token file (plan), so the layout cannot drift from the React app's and the red cannot
  drift from the Rust Admin app's.
- **Out of scope**: changes to the Backend's rules or API; changes to the React Customer app; a
  Rust Ticket Booth app (skipped by John); changes to the Rust Admin app's behavior or look;
  removing the React Customer app.
