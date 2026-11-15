# Feature Specification: Rust Admin App

**Feature Branch**: `037-rust-admin-app-spec`

**Created**: 2026-11-11

**Status**: Draft

**Amended**: 2026-11-14, before any implementation (#163). The Rust Admin app is to be exactly
like the React Admin app as it is on `main` today (`ff993c4`): the same screens, the same layout,
the same words, and the same behavior, with seat maps (`038`) and the layout editor (`039`)
included. Only its red colors and its name differ. See Clarifications.

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

## Clarifications

### Session 2026-11-14

- Q: How close to the React Admin app must the Rust Admin app be? → A: Exactly like it, as it is
  on `main` now (Nathan, 2026-11-14): the same pages at the same paths, the same layout (headings,
  cards, sections, fields, buttons, and table columns in the same order, and the same phone-width
  behavior), the same words, and the same behavior. Red colors and the "(Rust)" name are the only
  visible differences. This replaces "they do not have to look like the current apps" in Input
  item 2 and "It does not need to match the React Admin app's layout" in FR-011.
- Q: Which Admin app is "now"? → A: `main` at `ff993c4` (2026-11-14), which has seat maps (`038`:
  layouts per venue, prices per level, seats off sale, the live venue map), the layout editor
  (`039`), and the follow-ups merged with them. The parity checklist lists every behavior of that
  version. Anything merged into the React Admin app after it and before the implementation PR opens
  is added to the checklist by the implementation PR (FR-012).

### Session 2026-11-15

- Q: Which colors turn red in the Rust Admin app? → A: The look colors only: the page background,
  the header, cards, and other surfaces, borders, text, and the accent (primary buttons, links, the
  Q mark). The
  data colors stay exactly the React Admin app's: seat states, price levels, map colors, and the
  error, warning, and success colors (FR-009).
- Q: Do the Rust Admin app's PDF downloads keep the React Admin app's indigo header, or turn red?
  → A: They keep it. Downloads are records, so they are the same whichever Admin app made them;
  the red is for telling the apps apart on screen (FR-015).
- Q: When the React Admin app has a known bug or rough edge, does the Rust Admin app copy it or fix
  it? → A: It copies it. A known bug is fixed in the React Admin app, in its own issue, and the Rust
  Admin app takes the fix like any later Admin change (FR-012, FR-014).

## Context

Today the Admin app (`admin-app/`) is the one place QueuePass admins work. They sign in, manage
venues and their seating layouts, draw layouts in the layout editor, schedule and edit events with
ticket types or a seating layout with prices per level and seats off sale, and pictures, watch
sales and the live venue map, read attendee lists and reports, and download them. Each of those
behaviors is defined by a merged spec (`002`, `004`, `005`, `007`, `012`, `013`, `014`, `015`,
`016`, `020`, `021`, `023`, `024`, `025`, `028`, `030`, `031`, `032`, `035`, `036`, `038`,
`039`).

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
   background, surfaces, and accent), the app's name in the header and the browser tab says it is the Rust
   version, and a sign-out control is shown.

---

### User Story 2 - Manage venues and their seating (Priority: P1)

An admin lists, searches, views, creates, edits, and deletes venues in the Rust Admin app, with
the same rules and messages as the React Admin app: address checking, the time zone picked from
the list, and the venue's seating layouts on its Layouts card (import a layout file, make one from
section lines, rename, edit lines, duplicate, delete, and the map preview, `038`).

**Why this priority**: Events need venues. This is the first half of what admins do.

**Independent Test**: Create a venue in the Rust Admin app and give it a layout from section lines,
then open it in the React Admin app: it shows the same address, verified status, time zone, and
layout. Rename the layout in the React app, reload the Rust app: the change shows.

**Acceptance Scenarios**:

1. **Given** venues exist, **When** the admin opens Venues, **Then** they see the same venues, with
   the same details and search, as in the React Admin app.
2. **Given** an admin creates or edits a venue, **When** the address service matches the address,
   **Then** the venue is saved verified; **when** it does not, or the service is down, **then** it
   is saved as typed and marked not verified, as in `024`.
3. **Given** a venue, **When** the admin opens it, **Then** they see its address (with its map
   link), time zone, capacity, its Layouts card with each layout's seats, sections, price levels,
   preview, and the events using it, and its events, with past events hidden unless shown.
4. **Given** a venue the Backend refuses to change or delete (for example, one with events),
   **Then** the Rust Admin app shows the Backend's reason beside the right field or action and
   keeps every value entered.
5. **Given** a layout locked by sold or held seats, **When** the admin tries to rename, change, or
   delete it, **Then** the Rust Admin app refuses with the same reason, naming the event, as the
   React Admin app; Duplicate makes an unlocked copy.
6. **Given** a layout file with problems, **When** the admin imports it, **Then** nothing is saved
   and each problem is listed with where it is, as in the React Admin app.

---

### User Story 3 - Schedule and edit events (Priority: P1)

An admin schedules an event in the Rust Admin app with the same form behavior as the React Admin
app: the three sections of `035`, the times of `036` (date and time controls; doors open as a
length of time before the start or as a date and time; a new event starting today at the next
whole hour and ending 4 hours later), seating as general admission with ticket types or as one of
the venue's layouts with a price per level and seats taken off sale (`038`), tickets per customer,
and pictures. Editing an event follows the same rules, including controls locked because tickets
are sold or seats held.

**Why this priority**: Scheduling events is the core admin job, and the event form carries most of
the Admin app's rules.

**Independent Test**: Schedule a general-admission event with two ticket types and a seated event
on a layout with a price per level and a row off sale, each with a per-customer limit and two
pictures, in the Rust Admin app; open each in the React Admin app and check every value. Repeat the
form's checks (`035`, `036`, `038`) in the Rust app and see the same messages.

**Acceptance Scenarios**:

1. **Given** the admin opens Schedule event, **Then** the form shows the same sections, fields,
   defaults, and field-by-field checks as the React Admin app's form, and never sends a problem it
   can see.
2. **Given** a valid event, **When** the admin submits it, **Then** the event, its ticket types, and
   its seating are saved all or nothing, and pictures upload after it exists, as in `031`.
3. **Given** the Backend refuses the event (for example, a clash at the venue within the 60-minute
   buffer), **Then** the reason is shown beside its field and focused, and every value is kept.
4. **Given** an event with tickets sold or seats held, **When** the admin edits it, **Then** the
   controls the Backend would refuse are locked, with the reason beside them.
5. **Given** an event, **When** the admin cancels or deletes it, **Then** the Rust Admin app asks
   first and follows the same rules and messages as the React Admin app.
6. **Given** the admin picks a layout for the event, **Then** the form shows its preview, a price
   for each of its levels, and the off-sale tool (sections, row ranges, single seats) with the
   seats on sale and off sale counted, as the React Admin app does; an unpriced level or a sold or
   held seat taken off sale is refused beside its field.

---

### User Story 4 - Watch events, sales, and seats (Priority: P2)

An admin lists and searches events (with the Show past events toggle and filters), opens an event,
and sees its details, pictures, sales, and, for a seated event, the live venue map: each section
filled by its seats' states, a legend with counts, and a zoom into a section's seats, which change
state as customers hold and buy them, without reloading (`038`).

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

### User Story 6 - Draw and edit layouts in the layout editor (Priority: P2)

An admin opens the layout editor from a venue's Layouts card in the Rust Admin app and draws a
layout exactly as in the React Admin app (`039`): generate sections of rows and seats with the
block generator, drag and turn them on the map, place the floor, paint price levels by section,
row, or seat, fine-tune a section's rows and seats, undo and redo, and save it, or view a locked
layout and duplicate it to edit. The same keyboard path, warnings, and unsaved-changes guard apply.

**Why this priority**: It is the newest and largest Admin screen, and admins need it to make
arena-shaped layouts. It comes after the P1 stories because events can use layouts made any other
way, including layouts drawn in the React Admin app.

**Independent Test**: In the Rust Admin app, draw a layout with a court and two generated sections,
turn one, paint a section and two seats with a second level, and save it. Open it in the React
Admin app's editor: every section, place, angle, label, and level is the same. Change it there and
reload the Rust editor: the change shows.

**Acceptance Scenarios**:

1. **Given** a venue, **When** the admin chooses New layout, **Then** the Rust Admin app opens the
   editor with the same panels, guidance, and controls, in the same places, as the React Admin
   app's editor.
2. **Given** the editor, **When** the admin generates, moves, turns, duplicates, relabels, or
   deletes sections, or paints levels, **Then** the map, the warnings (for example, overlapping
   sections), and the counts change as in the React Admin app, and Undo and Redo step through
   them.
3. **Given** unsaved changes, **When** the admin leaves the editor, **Then** they are asked first,
   as in the React Admin app.
4. **Given** a layout the admin changed in the other Admin app since opening it, **When** they
   save, **Then** the Backend's refusal is shown as the React Admin app shows it, and their work is
   kept.
5. **Given** a locked layout, **When** the admin opens it, **Then** it opens to view only, and
   Duplicate to edit makes an editable copy.
6. **Given** only a keyboard, **When** the admin uses the editor, **Then** the same keys, row and
   seat lists, and Delete, Undo, and Redo keys work as in the React Admin app.

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
- An admin edits the same layout in both apps' editors: the second save is refused by the Backend
  as changed since it was opened, and the Rust Admin app says so and keeps the work, as the React
  Admin app does.
- A layout becomes locked (a seat is sold or held) while it is open in the Rust editor: saving is
  refused with the Backend's reason, as in the React Admin app.
- A layout file over 4 MB or not JSON: refused before it is sent, with the same messages as the
  React Admin app; a file the Backend finds wrong is refused with each problem listed.

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
  so it cannot be mistaken for the React Admin app at a glance. Its look colors are red: the page
  background, the header, cards, and other surfaces (tinted red), borders, text, and the accent
  (primary buttons, links, the Q mark). Its data colors MUST stay the React Admin app's: seat states, price levels, map colors,
  and the error, warning, and success colors, so a level or seat state looks the same in both Admin
  apps and in the Customer app.
- **FR-010**: The Rust Admin app's name in its header and browser tab MUST say it is the Rust
  version (for example "QueuePass Admin (Rust)").
- **FR-011**: The red theme MUST keep the usability the React Admin app has: AA contrast for text
  and controls, visible focus, states that do not rely on color alone, keyboard access, and a
  layout that works at phone width.
- **FR-020**: Apart from its colors and its name, the Rust Admin app MUST look like the React Admin
  app (amended 2026-11-14, Clarifications): the same pages at the same paths; on each page the same
  headings, cards, sections, fields, buttons, tables, and table columns, in the same order and the
  same arrangement; the same sizes, spacing, and type; and the same changes at phone width. The
  venue maps and the layout editor are drawn the same way, with only their colors changed.

**Working the same**

- **FR-012**: The Rust Admin app MUST provide every behavior the React Admin app provides on `main`
  when this feature's implementation PR opens, as defined by the merged specs listed in Context.
  The plan MUST list each one, by screen, as a parity checklist, and the implementation MUST be
  checked against it. The checklist lists every behavior of `main` at `ff993c4` (2026-11-14); the
  implementation PR adds a row for any Admin behavior merged after it.
- **FR-013**: At least these screens and actions MUST be present: the signed-in home page; Venues
  (list, search, view, create, edit, delete, address check, time zone, and the Layouts card:
  import a layout file, new layout from section lines, rename, edit lines, duplicate, delete, the
  map preview, and the links into the editor); the layout editor (new, edit, view, the block
  generator, moving and turning sections, the floor, price levels and painting, fine-tuning rows
  and seats, keyboard use, undo and redo, save, save as a new layout, and the unsaved-changes
  guard); Events (list, search and filters, Show past events, view, schedule, edit, cancel, delete,
  general admission with ticket types and live totals, a seating layout with a price per level and
  seats off sale, tickets per customer, pictures, doors open, times in the venue's time zone); an
  event's sales and its live venue map; Attendees; Reports; and CSV, XLSX, and PDF downloads of the
  attendee list and the sales report.
- **FR-014**: For the same data and action, the Rust Admin app MUST give the same outcome as the
  React Admin app: the same values saved, the same Backend refusals shown with the same meaning
  beside the same field, the same values kept after a refusal, the same figures shown, and the same
  visible words (headings, labels, buttons, messages, and notes). This includes the React Admin
  app's known bugs and rough edges: the Rust Admin app copies them rather than fixing them on its
  own, and a fix made in the React Admin app is then copied too.
- **FR-015**: Downloads from the Rust Admin app MUST hold the same rows, columns, and values as the
  React Admin app's downloads of the same data, apart from the time each file was made. They are
  not red: a PDF keeps the React Admin app's header color and layout.

**Quality**

- **FR-016**: The Rust Admin app MUST have automated tests run by the project's one test command
  and in CI. Its logic MUST meet the same 80% line coverage floor as every other front end, and
  every one of its screens MUST be exercised by at least one browser test.
- **FR-017**: The browser tests MUST run the Admin quickstart journeys against the Rust Admin app
  as well as the React Admin app, and this feature's quickstart MUST mark each scenario Automated
  or Manual.
- **FR-018**: The README MUST list the Rust Admin app's address, how to start and test it, and that
  it uses the same admin accounts.
- **FR-019**: The Rust Admin app failing or being unavailable MUST NOT stop any other service from
  starting or working.

### Key Entities

No new data. The Rust Admin app reads and writes the same venues, seating layouts (with their
sections, rows, seats, price levels, and drawings), events (with their prices per level and seats
off sale), ticket types, pictures, orders, tickets, and check-ins as the React Admin app, through
the same API. The
only new configuration is one sign-in realm with its client, the admin role, and its five admin
accounts.

## Constitution impact

This spec PR carries an amendment (MINOR) that:

- Adds the Rust Admin app as a fourth front end in the Preamble, Principle II, and the Repository
  and Front ends rows of the stack table: Rust, for this app only, with its toolchain choice made in
  the plan. TypeScript and React stay fixed for every other front end.
- Adds its realm and client to Principle V and the Identity row, and its origin to the CORS rule.
- Adds an exception to Principle VII: the Rust Admin app uses its own red theme, not the shared
  theme, so it is clearly a different version. It keeps the usability targets. (Amended
  2026-11-14, Constitution 3.11.1: its own red colors, on the Admin app's layout.)
- Adds its workspace to Principle VI's coverage floor, measured by its own Rust tooling but run by
  the one test command, and its tests to the Front-end tests row.
- Reserves roadmap row `037-rust-admin-app`. The Customer app's Rust version takes the next number.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh clone, one command brings up both Admin apps, the Customer app, and the
  Ticket Booth app, and an admin can sign in to both Admin apps at once in one browser.
- **SC-002**: 100% of the plan's parity checklist items pass in the Rust Admin app, the "Same
  layout" items included.
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
  The checklist is complete for `main` at `ff993c4` (2026-11-14), seat maps (`038`) and the layout
  editor (`039`) included. Each later Admin feature (for example, season tickets) says in its own
  spec whether it also covers the Rust Admin app.
- **Port.** The Rust Admin app runs on port 5176 unless the plan finds it taken. The Customer
  app's Rust version picks its own.
- **Look.** The Rust Admin app's red look colors are its own (FR-009); everything else about its look is the
  React Admin app's (FR-020). It keeps the same words for the same things, so the parity check and
  the browser tests can use one script for both. The plan reuses the React Admin app's stylesheets
  rather than copying them, so the two layouts cannot drift apart.
- **Same downloads.** "The same" for PDFs means the same text, rows, and columns, not
  pixel-identical pages.
- **Out of scope**: changes to the Backend's rules or API; changes to the React Admin app; the
  Customer app's Rust version (Mahdi's, its own spec); a Rust Ticket Booth app (skipped by John);
  removing the React Admin app.
