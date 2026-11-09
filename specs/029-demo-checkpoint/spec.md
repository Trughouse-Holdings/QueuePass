# Feature Specification: Demo Checkpoint

**Feature Branch**: `029-demo-checkpoint-spec`

**Created**: 2026-11-09

**Status**: Draft

**Issue**: [#139](https://github.com/Trughouse-Holdings/QueuePass/issues/139) (database
seeding/checkpoint script: reset test data to a clean, repeatable state before live demos)

**Input**: User description: issue #139, from Nate's list (section 4, Feature Refinements & Demo
Support): "Implement a database seeding/checkpoint script to reset test data instantly to a clean,
repeatable state prior to live demonstrations." One command that removes all app data, keeps the
schema, loads the demo data again through the real rules, gives the same state every time with times
relative to now (an upcoming event, one whose doors are open for the Ticket Booth, one in the past),
runs in a few seconds, refuses unless explicitly allowed and pointed at a local database, is never
run by `docker compose up`, and prints what it removed and created. Optionally, save and restore a
hand-prepared checkpoint. The roadmap number is reserved by this PR's amendment (Constitution 3.9.1).

## Context

Builds on `005` (the demo data: `npm run demo-data`, research R9, which adds venues, events, tiers,
orders, and check-ins through the Backend's own services, and stops if the demo venue exists), `014`
(generated images on the demo events), `017` (holder names on demo orders; **Demo Tonight**, an event
whose check-in window is open as soon as the demo data loads), `020` (event times in the venue's time
zone), and `025` (doors open 1 hour before the start by default; check-in from 1 hour before doors).

Today:

- The demo data only **adds**. Once the demo venue exists it changes nothing, so it cannot undo
  anything. Everything made while testing or demoing stays until someone deletes it by hand: extra
  venues and events, test orders, admitted tickets, seat holds. The "EDIS Showcase Night" event and
  its test orders are still in the team's local database.
- **Demo Tonight** starts 1 hour after the demo data loads, and its check-in window closes 4 hours
  after it. A day later the Ticket Booth has nothing open to demo, and running the demo data again
  does not move it (README, "Demo data").
- No demo event is in the past, so there is nothing to show how the apps treat an event that is over.
- The only clean slate is `docker compose down -v`, which also deletes every Keycloak account, and a
  full rebuild, minutes, not seconds.

This feature adds one **reset** command: it removes all of QueuePass's app data from a local database,
keeps the schema and its migrations, and loads the demo data again through the Backend's rules, so
every reset ends in the same known demo state with times relative to the moment it ran. Keycloak is
not touched. It is a command a person runs before a demo, never part of starting the system.

## Clarifications

### Session 2026-11-09

The issue settles what the command does. Every question it leaves open below took the recommended
answer, written unattended and recorded here as **recommended answer, open to review**, so Mahdi and
the team can overturn it in review of the spec PR.

- Q: What does "all app data" cover? → A: **Every row of every QueuePass table except the record of
  applied migrations**: venues, their seating sections, events, tiers, section-to-tier mappings,
  event images, orders, tickets (and so their check-ins), seat reservations and seat holds. The
  schema, its constraints, and the migration record stay (FR-004, FR-005; research R2).
- Q: The issue lists "attempt/rate-limit records". Where are they? → A: **Not in the database.**
  `026`'s purchase attempt counts live in the running Backend's memory and each one is forgotten
  within a minute. A separate command cannot reach them. The reset says so in its output, and a
  presenter who needs them cleared at once restarts the Backend (recommended answer, open to review)
  (FR-014; research R3).
- Q: Keycloak? → A: **Out of scope, never touched** (the issue: leave the demo users as they are).
  The reset neither reads nor writes Keycloak, and does not need it running, so it does not depend on
  realm names, which spec `028` is changing. Demo orders and check-ins belong to stand-in identities
  (`demo-customer1`…`demo-customer25`, `demo-agent1`), not real accounts, so the demo state is the
  same whatever accounts exist. Orders real signed-in customers made are app data and are removed
  like the rest (FR-004, FR-008; research R4).
- Q: Which demo state? → A: **The existing demo data, plus one past event.** The two venues, Fall
  Concert (14 days ahead), Comedy Night (21 days), Demo Tonight (starts 1 hour after the run, doors
  open at the run, so its check-in window is open), Holiday Gala (30 days, cancelled), their tiers,
  orders, check-ins and images, as today; and a new **Season Opener** at Demo Riverside Hall, 7 days
  before the run, 7:00 PM to 10:00 PM local, already over. The past event is added to the demo data
  itself, so `npm run demo-data` and the reset load the same thing (recommended answer, open to
  review) (FR-006, FR-007; research R5).
- Q: Does the past event have tickets? → A: **No.** Sales close when an event starts (`006`), so no
  order can be placed for a past event through the Backend's rules, and the demo data uses those
  rules. It shows as an event that is over, with sales closed, in the Customer and Admin apps, and is
  not offered at the Ticket Booth. Writing past orders straight into the database instead is the
  alternative, rejected to keep every demo row made by the real rules (recommended answer, open to
  review) (FR-007; research R5).
- Q: Which command? → A: **One command per way of running the stack**, each one line: with the
  full Compose stack, `docker compose exec -e QUEUEPASS_ALLOW_RESET=1 backend node
  backend/dist/scripts/demo-reset.js` (like the demo data's command today); with the Backend run from
  the host (README "When the images can't be built", path B), `node scripts/run-host.mjs
  --demo-reset`, which runs the reset alone and exits, in a second terminal while the stack runs. No
  root `package.json` script (shared surface; it could not set the Backend's environment on every
  shell) (recommended answer, open to review) (FR-001, FR-002; research R6).
- Q: What counts as "explicitly allowed" and "local"? → A: **Both checks, before anything is
  connected to**: the variable `QUEUEPASS_ALLOW_RESET` set to exactly `1`, and the database host in
  the database address the Backend uses being `localhost`, `127.0.0.1`, `::1`, or `database` (the
  Compose stack's own service name, reachable only inside that stack's network). Then, connected but
  before removing anything: the database is a QueuePass database with every migration applied.
  `run-host.mjs --demo-reset` sets the variable itself, because typing `--demo-reset` is the explicit
  request and `run-host.mjs` only ever targets `localhost` (recommended answer, open to review)
  (FR-009, FR-010; research R7).
- Q: Save and restore checkpoints (`pg_dump`/`pg_restore`)? → A: **Deferred, not built** (Principle
  VIII). A restored dump brings back its times as they were when saved, so Demo Tonight's check-in
  window, open for 4 hours after the save, would be closed at a demo a day later: the main thing the
  reset is for. The tools are not on the host here (path B), the database container's name differs
  per Compose project, and the reset already gives a known state in seconds. Deferring it defers no
  security or correctness control; a later issue can add it if a hand-made state is ever needed
  (recommended answer, open to review) (Out of scope; research R8).
- Q: How fast? → A: **Within 10 seconds** on the team's laptop when the address service answers (or
  cannot be reached at once); removing the data itself well under a second. When the address service
  hangs, each venue waits for its own time limit (5 seconds) and is saved not verified, as the demo
  data does today (recommended answer, open to review) (SC-002; research R9).
- Q: What if the Backend is running and people are using the apps? → A: **The reset runs anyway**,
  waiting at most a few seconds for requests in flight; anything an open page shows that was removed
  is gone, and the page shows the new state when reloaded. The output says to reload the apps (Edge
  Cases; research R10).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reset to the Demo State Before a Demo (Priority: P1)

Before John's demo, Mahdi's local database holds a week of testing: an "EDIS Showcase Night" event and
its orders, a venue with a test seating layout, tickets admitted at the Booth, a seat hold someone left
behind, and yesterday's Demo Tonight, whose check-in window closed long ago. He runs the reset command.
In a few seconds it prints the database it worked on, how many rows of each kind it removed, and what
it created: 2 venues, 5 events, their orders, tickets, check-ins and images. In the Admin app he sees
exactly the demo venues and events and nothing else; in the Ticket Booth, Demo Tonight is open for
check-in; in the Customer app, Fall Concert is on sale and Season Opener is over.

**Why this priority**: it is the feature. Every demo starts from a known state instead of whatever the
last test left.

**Independent Test**: fill a local database with extra venues, events, seating, orders, admitted
tickets, images and seat holds; run the reset; the database holds exactly the demo data, and the
Booth offers Demo Tonight.

**Acceptance Scenarios**:

1. **Given** a local database with extra venues, events, tiers, seating, images, orders, admitted
   tickets, and seat holds, **When** the reset runs with the explicit permission, **Then** afterwards
   it holds exactly the demo data: the two demo venues, the five demo events with their tiers,
   orders, tickets, check-ins and images, and nothing else.
2. **Given** the reset has just run, **When** a gate agent opens the Ticket Booth, **Then** Demo
   Tonight is offered and open for check-in, and its unused tickets can be admitted.
3. **Given** the reset has just run, **When** a customer opens the Customer app, **Then** Fall
   Concert and Comedy Night are on sale, Holiday Gala shows cancelled, and Season Opener shows that
   sales are closed.
4. **Given** the reset has run, **Then** its output names the database it worked on (host, port, and
   name, never the password), the number of rows it removed of each kind, and what it created.
5. **Given** Keycloak accounts and signed-in users, **When** the reset runs, **Then** every account,
   role, and sign-in is as it was; a signed-in user reloads the app and carries on.

---

### User Story 2 - The Same State Every Time (Priority: P1)

Mahdi runs the reset, walks the demo once as a rehearsal (buys tickets, admits some at the Booth), then
runs it again just before the real demo. The second state matches the first: the same venues, events,
tiers, prices, orders, holder names, quantities, check-in counts and images. Only identifiers, ticket
codes, and the moments things were created differ, and the event times are placed relative to the
moment of each run.

**Why this priority**: a demo script only works if the state it walks through is the same each time.

**Independent Test**: reset twice in a row; compare everything except identifiers, codes, and
timestamps; they are equal.

**Acceptance Scenarios**:

1. **Given** a reset, then changes made through the apps, **When** the reset runs again, **Then** the
   data matches the first reset's, apart from identifiers, ticket codes, the moments rows were made,
   and event times, which keep the same place relative to each run.
2. **Given** a reset run today and one run tomorrow, **Then** each has an upcoming event, one whose
   check-in window is open, and one in the past, relative to the moment it ran.
3. **Given** a reset that stopped halfway (for example, the database went away while the demo data
   was loading), **When** the reset runs again, **Then** it ends in the full demo state.

---

### User Story 3 - It Refuses Anything but a Local Database It Was Told to Reset (Priority: P1)

Nate has a terminal open with a database address for a shared machine. He types the reset command by
habit. It refuses before connecting to anything, says why, and says how to allow it on a local
database. Another time he runs it on his laptop without the permission variable; it refuses the same
way. On his laptop with the permission, against a database whose migrations are behind, it refuses
before removing anything and says to bring the database up to date first.

**Why this priority**: it deletes everything. Pointed at the wrong database it loses real data, so
the refusals matter as much as the reset.

**Independent Test**: run the reset without the permission, with the permission and a non-local
host, with the permission against a database that is not QueuePass's or not up to date; each is
refused with its reason and every row is still there.

**Acceptance Scenarios**:

1. **Given** the permission is not given (or given with any value but `1`), **When** the reset runs,
   **Then** it refuses, connects to nothing, changes nothing, says how to give the permission, and
   ends with a failure status.
2. **Given** the permission is given but the database host is not local, **When** the reset runs,
   **Then** it refuses, naming the host, connects to nothing, changes nothing, and ends with a
   failure status.
3. **Given** a local database that has no QueuePass migration record, or has migrations not yet
   applied, **When** the reset runs with the permission, **Then** it refuses before removing anything
   and says what to do.
4. **Given** `docker compose up` (with or without `--build`) on a clean clone or an existing one,
   **Then** the reset never runs, and nothing in the Compose files gives the permission.

---

### Edge Cases

- **The Backend is running and in use.** The reset waits a few seconds at most for requests in
  flight, then removes the data. An open page keeps showing what it last loaded until reloaded; an
  action on something removed is refused as not found, as when an admin deletes it. A customer's
  live seat map for a removed event stops updating. The output reminds the presenter to reload the
  apps. If the database stays busy past the wait, the reset refuses and changes nothing.
- **Two resets at once.** The second one's demo data finds the first one's already loading and
  stops; the reset says another reset ran at the same time and asks for one more run. One more run
  ends in the demo state.
- **The reset stops halfway.** Removing the data is all or nothing. Loading the demo data is not: a
  failure there (the database went away) leaves part of the demo state. The reset says so and fails;
  running it again removes the part and loads it all.
- **The address service is unreachable or slow.** As in the demo data today: each demo venue waits
  for the service's own time limit, then is saved with its address not verified, and the output says
  so. The time zone is Eastern either way (both venues are in Kentucky).
- **A database with no data.** The reset removes nothing (it says 0 for each kind) and loads the
  demo data. A clean stack can be reset as its first step.
- **Purchase attempt limits** (`026`) still counted in the running Backend's memory from before the
  reset are not cleared; each is forgotten within a minute of its attempt. Restarting the Backend
  clears them at once. The output says so.
- **Demo Tonight later the same day.** Its check-in window closes 4 hours after the reset. Running the
  reset again opens a new one.
- **Daylight-saving dates.** Event times follow the demo data's existing rule (`020` research R19):
  a local time that does not exist that day moves an hour later, a repeated one takes the first.
- **A database address with a host in its options** (a socket path or a `host=` parameter) or that
  cannot be read: refused as not local.
- **A local address that leads elsewhere** (an SSH tunnel on `localhost` to a remote server): the
  reset cannot tell; the permission variable is the guard. Recorded as an accepted risk.

## Requirements *(mandatory)*

### Functional Requirements

**The command**

- **FR-001**: With the full Compose stack running, one command MUST reset the database the Backend
  uses: run inside the Backend's container, with the permission given on that command line.
- **FR-002**: With the Backend run from the host (path B), one command MUST reset the database the
  host-run Backend uses, with the same environment the host-run Backend gets, without stopping or
  starting the Backend or the apps, and then exit. It MUST NOT rebuild anything; when the Backend has
  not been built it MUST say so and stop.
- **FR-003**: Nothing that starts the system (`docker compose up` with or without `--build`, the
  one-shot seed job, `run-host.mjs` without its reset option) MUST ever run the reset, and no
  Compose file, `.env.example`, or workflow MUST give the permission (Constitution VIII).

**What it does**

- **FR-004**: The reset MUST remove every row of every QueuePass table, all in one step that either
  completes or changes nothing: venues, seating sections, events, tiers, section-to-tier mappings,
  event images, orders, tickets with their check-ins, seat reservations, and seat holds. A table a
  later feature adds MUST be included without changing the reset.
- **FR-005**: The reset MUST keep the schema, every constraint, and the record of applied
  migrations. It MUST NOT drop, create, or migrate anything.
- **FR-006**: After removing the data, the reset MUST load the demo data through the Backend's own
  rules, as `npm run demo-data` does, so every business rule applies to it.
- **FR-007**: The demo data (and so the reset) MUST include, relative to the moment it runs: at least
  one upcoming event on sale (Fall Concert, Comedy Night); one event whose check-in window is open
  (Demo Tonight, doors open at the run); one cancelled event (Holiday Gala); and one event that is
  over (Season Opener, at Demo Riverside Hall, 7 days before the run, 7:00 PM to 10:00 PM local, no
  tickets). Every other demo row stays as it is today.
- **FR-008**: The reset MUST NOT touch Keycloak, read from it, or need it running.

**Safety**

- **FR-009**: Before connecting to anything, the reset MUST refuse, with a failure status and a
  message saying why and how to proceed, unless both: the permission `QUEUEPASS_ALLOW_RESET` is set
  to exactly `1`; and the database address it would use names its host as `localhost`, `127.0.0.1`,
  `::1`, or `database`, with no other host given in its options.
- **FR-010**: Connected, and before removing anything, the reset MUST refuse, with a failure status
  and a message, unless the database holds QueuePass's migration record with every migration the
  Backend ships applied and none failed.
- **FR-011**: The reset MUST never print the database password.

**Output**

- **FR-012**: The reset MUST print, in order: the database it is working on (host, port, database
  name); the rows it removed, per kind; what it created (venues, events, orders, tickets, check-ins,
  images, the cancelled event, the past event); whether the venues' addresses were verified; and how
  long it took.
- **FR-013**: When loading the demo data fails after the data was removed, the reset MUST say that the
  data was removed, that the demo state is incomplete, and that running it again finishes it, and end
  with a failure status. When the demo data finds another reset's data already loading, it MUST say so
  the same way.
- **FR-014**: The reset MUST end its output by telling the presenter to reload any open app, and that
  purchase attempt limits counted before the reset clear within a minute or when the Backend
  restarts.

**Documentation**

- **FR-015**: The README MUST document both commands, the permission, what is removed and kept, the
  demo state it gives (with the past event), and that it never runs by itself; the "Demo data"
  section MUST point to it for moving Demo Tonight.

### Key Entities

- **App data**: every row in QueuePass's tables (venues, sections, events, tiers, section tiers,
  event images, orders, tickets, seat reservations, seat holds). Removed by the reset.
- **Migration record**: the database's list of applied migrations. Kept; checked before removing.
- **Demo state**: what the demo data creates relative to the moment it runs (FR-007). The reset ends
  in it.
- **Permission**: `QUEUEPASS_ALLOW_RESET=1`, given on the command line for one run, never in a file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a reset on a database with extra venues, events, seating, orders, admitted
  tickets, images and seat holds, the database holds exactly the demo state: the same rows, compared
  apart from identifiers, codes, timestamps and run-relative times, as a reset of an empty database.
- **SC-002**: The reset completes within 10 seconds on the team's laptop with the address service
  answering or refusing at once; removing the data takes under 1 second at demo size.
- **SC-003**: Two resets in a row give data equal apart from identifiers, ticket codes, the moments
  rows were made, and event times, which keep their place relative to each run.
- **SC-004**: Without the permission, or with a non-local host, the reset refuses in 100% of tries
  and every row is unchanged; it opens no connection to the database.
- **SC-005**: Against a database that is not QueuePass's or not fully migrated, the reset refuses in
  100% of tries with every row unchanged.
- **SC-006**: Right after a reset, the Ticket Booth offers Demo Tonight open for check-in, and the
  Customer app shows Season Opener with sales closed.
- **SC-007**: `docker compose up --build` on a clean clone gives the same running system as before
  this feature; nothing in it can run the reset.

## Assumptions

- **Local only.** The reset is for laptops running QueuePass for development and demos. There is no
  shared, staging, or production database today; if one is ever added, its address will not be one of
  the local hosts in FR-009, and the permission is never set there.
- **The demo data is the checkpoint.** The known state is whatever the demo data creates; changing
  the demo data changes the checkpoint, for `npm run demo-data` and the reset alike.
- **Times relative to the run.** Fall Concert, Comedy Night, and Holiday Gala keep their local times
  on their dates (days after the run's local date); Demo Tonight and Season Opener are placed from
  the run's moment and date. Two runs on different days differ by those days, as intended.
- **Stand-in identities.** Demo orders belong to `demo-customerN` and demo check-ins to
  `demo-agent1`, as since `005` and `017`; they appear on no real customer's My tickets (README).
- **Speed.** "A few seconds" in the issue is read as SC-002's 10 seconds, which includes starting the
  Backend's code, checking two addresses, and loading about 40 orders.
- **An accepted risk.** A local address that tunnels to another server passes the host check; the
  explicit permission on the command line is what guards it.

## Out of scope

- **Saving and restoring a hand-made checkpoint** (`pg_dump`/`pg_restore`): deferred (Clarifications;
  research R8). No security or correctness control is deferred.
- Keycloak accounts, realms, roles, and sign-ins (the seed's job; spec `028`).
- Clearing the running Backend's in-memory purchase attempt limits (they expire within a minute).
- Any API operation, Admin screen, or button for resetting: it is a command for whoever runs the
  laptop, not a feature of the apps.
- Changing `docker compose up`, the seed job, or the shared surface beyond the constitution's
  roadmap row.
