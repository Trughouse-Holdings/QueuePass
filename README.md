# QueuePass

Venue and event management with sign-in for every user and guaranteed conflict-free scheduling.

Built from the specifications in [`specs/`](specs/) under the project constitution at
[`.specify/memory/constitution.md`](.specify/memory/constitution.md) (v3.4.1).

---

## Status

Features `001` through `008` and `012` through `018` are built and verified. `019` is built and
reviewed; part of its running-system walk is still to do. `020` is built, reviewed, and walked
on the running system (path B; the image checks wait for a machine where images build). `011` is built; its first runs on
GitHub and its running-system walk are pending.

| Spec                                                                         | What it delivers                                                                                                                                                                                                | Spec             | Plan and tasks     | Code                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------ | ---------------------------- |
| [`001-bare-bones-system`](specs/001-bare-bones-system/spec.md)               | All six services; Keycloak sign-in, JWT validation, role checks; login, hello-world, and logout in all three front ends                                                                                         | Draft            | Done (64/64 tasks) | **Built and verified**       |
| [`002-admin-venues-events`](specs/002-admin-venues-events/spec.md)           | Venue and event API with the 60-minute rule; Admin app create, read, update, delete                                                                                                                             | Draft (revised)  | Done (32/32 tasks) | **Built and verified**       |
| [`003-customer-venues-events`](specs/003-customer-venues-events/spec.md)     | Customer app shows all venues and events                                                                                                                                                                        | Ready for review | Done (23/23 tasks) | **Built and verified**       |
| [`004-admin-tiers-search`](specs/004-admin-tiers-search/spec.md)             | Ticket tiers per event; Admin search for events and venues                                                                                                                                                      | Ready for review | Done (23/23 tasks) | **Built and verified**       |
| [`005-admin-orders-reporting`](specs/005-admin-orders-reporting/spec.md)     | Orders and tickets; Admin sales dashboard, attendee lists, safe cancellation                                                                                                                                    | Ready for review | Done (25/25 tasks) | **Built and verified**       |
| [`006-customer-ticket-purchase`](specs/006-customer-ticket-purchase/spec.md) | Customers get tickets and see them on My tickets; sales close when an event starts                                                                                                                              | Draft            | Done (29/29 tasks) | **Built and verified**       |
| [`007-seat-selection`](specs/007-seat-selection/spec.md)                     | Venue seating layouts; reserved seating per event with sections mapped to tiers; customers choose seats; no seat sold twice                                                                                     | Draft            | Done (30/30 tasks) | **Built and verified**       |
| [`008-customer-event-search`](specs/008-customer-event-search/spec.md)       | Customer event search and filters; the Customer app usable on a phone (cards, contrast, keyboard) in the Admin app's look                                                                                       | Draft            | Done (19/19 tasks) | **Built and verified**       |
| [`011-ci-test-runs`](specs/011-ci-test-runs/spec.md)                         | Every pull request and push to `main` runs formatting, lint, build, and all tests in GitHub Actions, showing each workspace's coverage; `npm run ci` runs the same steps locally                                | Draft            | Done (32/34 tasks) | **Built (walk pending)**     |
| [`012-shared-theme`](specs/012-shared-theme/spec.md)                         | One shared theme in `packages/shared/` for the Admin and Customer apps; a test fails when an app defines its own look                                                                                           | Draft            | Done (29/30 tasks) | **Built and verified**       |
| [`013-venue-address-validation`](specs/013-venue-address-validation/spec.md) | Venue addresses as street, city, state, and ZIP, checked by the US Census Geocoder, with an explicit save anyway; addresses open Google Maps                                                                    | Draft            | Done (47/48 tasks) | **Built and verified**       |
| [`014-event-images`](specs/014-event-images/spec.md)                         | Up to 5 images per event, added, ordered, and removed in the Admin event form; a rotating gallery on Customer event cards and on the event page of both apps, with full screen                                  | Draft            | Done (56/57 tasks) | **Built and verified**       |
| [`015-seat-holds`](specs/015-seat-holds/spec.md)                             | Customers reserve picked seats for 5 minutes, then confirm; no seat reserved twice; reserved and sold seats shown live in both apps                                                                             | Draft            | Done (50 tasks)    | **Built and verified**       |
| [`016-per-user-ticket-limit`](specs/016-per-user-ticket-limit/spec.md)       | An optional per-customer ticket limit on each event, held under concurrent orders; shown to admins and customers                                                                                                | Draft            | Done (36 tasks)    | **Built and verified**       |
| [`017-gate-check-in`](specs/017-gate-check-in/spec.md)                       | Every new ticket carries the buyer's name; customers print a QR per ticket; gate agents scan or type a code, check an ID against the name, and admit each ticket exactly once                                   | Draft            | Done (50 tasks)    | **Built and verified**       |
| [`018-rotating-qr-codes`](specs/018-rotating-qr-codes/spec.md)               | Customers show a live QR code per ticket that changes every 30 seconds and needs no ID check at the gate; a copy expires within 35 seconds; printed and typed codes keep the ID check                           | Draft            | Done (41 tasks)    | **Built and verified**       |
| [`019-add-to-calendar`](specs/019-add-to-calendar/spec.md)                   | From My tickets, customers add an event they hold tickets for to Apple Calendar or Outlook (a calendar file) or Google Calendar, as a one-time copy; offered only while the event is ahead or under way         | Draft            | Done (22/25 tasks) | **Built (walk partly done)** |
| [`020-venue-time-zones`](specs/020-venue-time-zones/spec.md)                 | Every venue has a time zone, worked out from its checked address; every app shows and takes event times in the venue's local time with the zone's abbreviation (7:00 PM EDT), whatever the viewer's device zone | Draft            | Done (54/58 tasks) | **Built and verified**       |

**Today** all three front ends sign in through Keycloak and log out,
and the Backend refuses any request without a valid token and the right role. In the Admin app, admins
list, view, create, edit, and delete venues and events. Deleting asks for confirmation first,
and a venue that still has events is refused with a count of what blocks it. In the Customer app,
customers find events by name, venue, and dates, browse them as cards on any screen, and see
every venue with what is on there; get tickets
for an event, in a tier or at its base price, and see their codes; choose their exact seats at
events with reserved seating, reserving them for 5 minutes while they confirm, and see seats
others reserve or buy change live; and find every order they placed on **My tickets**. Admins give
venues seating layouts and see each seated event's seat map. Admins can cap how many tickets one
customer may hold for an event; customers see how many more they can get, and the Backend refuses
an order over the cap, even when two arrive at once. A venue's address is a real US
address, checked by the US Census Geocoder when it is saved, unless an admin chooses **Save
anyway** for an address the service does not know, which is then marked not verified. Every venue
address in both apps opens Google Maps. Admins add up to 5 pictures to an event (JPG, PNG, or
WebP, up to 5 MB each) and put them in order; customers see them as a rotating gallery on the
event's card and across the top of its page, and can open one full screen. Every new order carries
the buyer's name, typed at purchase and never changed, shown on My tickets, the attendee list, and
at the gate; customers print a QR code for each valid ticket. In the Ticket Booth app, gate agents
choose their event and check people in by scanning that QR with the camera or typing the
12-character code, see the ticket and the holder's name, check a government-issued photo ID
against it, and admit — once per ticket, even when several gates try at the same moment — or
refuse, with every refusal explained. Admin reports and attendee lists count the real entries,
with their times. From **My tickets**, customers can instead show a live entry code that changes
every 30 seconds; the gate scans it and needs no ID check, because a copy stops working within
seconds, while printed and typed codes still need one (`018`). Every venue has a time zone,
worked out from its verified address (or from its state, or chosen by an admin), and every event
time in all three apps is the venue's local time with the zone's abbreviation, such as "Oct 1,
2026, 7:00 PM EDT", whatever the zone of the viewer's device; admins type times in the venue's
local time, and a time that a daylight-saving change skips or repeats is refused or asked about
(`020`).

The Admin and Customer apps take their whole look from one shared theme (`012`).

Feature `010` is reserved in the constitution's roadmap and not yet built: the 80% test coverage
floor, enforced by `npm test` and the pull request check.

### How a feature is delivered

Each feature has a GitHub issue and lands as two pull requests, in order (Constitution III):

1. **Spec and plan** (branch `NNN-name-spec`): the spec, then the plan, contract changes, and
   tasks. Coding may start once this PR is open; it must be merged before the implementation PR.
2. **Implementation** (branch `NNN-name-impl`): the code and tests, written in a fresh Claude
   session from the spec and plan. Until the spec PR merges, this branch is cut from the spec
   branch and picks up any change its review makes; it is opened as a PR only after the spec PR
   merges. The PR says `fixes #N` to close the issue.

Before either PR is opened, a second Claude session reviews the branch and the author fixes what
it finds. One review is required; more rounds are optional. A teammate then reviews the PR. Only
finished, reviewed work reaches `main`, so `main` always runs for a demo.

Every commit message cites its spec, and implementation commits also cite their task IDs, for
example `Impl 015: reserve path and its refusals (T017–T019, #27)`. That way a review session can
trace each commit to its requirements. To use the template, run `git config commit.template
.gitmessage` once per clone.

---

## Start the system

```bash
cp .env.example .env     # optional — every value has a working default
docker compose up --build
```

One command from a clean clone. No manual configuration steps.

| Service          | URL                   | Sign in as        | Notes                                                              |
| ---------------- | --------------------- | ----------------- | ------------------------------------------------------------------ |
| Admin app        | http://localhost:5173 | `admin1`          | role `queuepass-admin`                                             |
| Customer app     | http://localhost:5174 | `customer1`       | role `customer`; find and browse events, get tickets, choose seats |
| Ticket Booth app | http://localhost:5175 | `agent1`          | role `gate-agent`; check tickets in by camera scan or typed code   |
| Backend API      | http://localhost:3000 | Bearer token      | `GET /health` is the only open endpoint; contract at `/docs`       |
| Keycloak         | http://localhost:8080 | `admin` / `admin` | admin console; realm `queuepass`                                   |
| PostgreSQL       | `localhost:5432`      |                   | volume-mapped; survives restarts                                   |

Saving a new venue address needs internet: the Backend checks it with the US Census Geocoder
(`ADDRESS_GEOCODER_URL`, default `https://geocoding.geo.census.gov`, no key). Offline, a new
address is refused with "We can't verify the address right now"; everything else works.

Startup order is gated on health: the Backend waits for PostgreSQL and applies migrations, the
seed waits for Keycloak's `/health/ready`, and the front ends wait for the Backend.

> The stack uses ports 3000, 5173–5175, 8080, 9000, and 5432. Stop anything else using them
> first, or `docker compose up` fails with "port is already allocated".

**When the images can't be built** (for example, a network that intercepts TLS, so a build cannot
reach package servers; `020` quickstart path B): run the database and Keycloak from their images,
on a compose project of their own so no other stack's data is touched, and everything else from
the host. Stop any stack using the same ports first.

```bash
docker compose -p qp020gate up -d database keycloak
npm ci
node scripts/run-host.mjs --backend-tz America/Los_Angeles --demo-data
# builds, migrates, seeds Keycloak, starts the Backend and the three apps; Ctrl+C stops them
docker compose -p qp020gate down -v   # afterwards, with its data
```

`--print` shows every step and its environment without starting anything; `--geocoder-url`
points the address service elsewhere.

**To stop without losing data:**

```bash
docker compose down          # keeps the volumes
docker compose down -v       # DELETES all data — venues, events, and Keycloak users
```

---

## Demo data

The Admin app's Reports and Attendees pages need orders. Customers can get tickets in the Customer
app (`006`), but to fill the Admin pages quickly for a demo, run once after `docker compose up`:

```bash
docker compose exec backend node backend/dist/scripts/demo-data.js
```

It adds two venues, four events (three with tiers, plus Demo Tonight, open for gate check-in as
soon as the data loads, `017`), named orders from `customer1`…`customer25`, some check-ins, one
cancelled event, and generated striped pictures (three on the concert, one on the comedy night),
all through the real Backend rules. Running it again changes nothing. It is never run
automatically. Its orders belong to stand-in identities, so they don't appear on any customer's
**My tickets**; buy in the Customer app to see that page filled.

**Demo Tonight** starts 1 hour after the demo data loads and ends 4 hours after it, so its entry
window (2 hours before the start until the end) is open at once and **closes 4 hours after the
data loads**. Running the demo data again changes nothing, so it doesn't move Demo Tonight or add
a new one. To demo check-in later, create an event in the Admin app that starts within the next 2
hours, buy tickets for it in the Customer app, and choose it in the Ticket Booth
([quickstart](specs/017-gate-check-in/quickstart.md) S0).

Its two venues have real addresses, verified by the address service. It also works offline: when
the service can't be reached, it saves them with their addresses not verified and says so.

---

## How sign-in works

Every front end requires sign-in, and the Backend trusts nothing without a valid token
(Constitution V, spec `001`).

1. You open a front end. It is not signed in, so it sends you to **Keycloak's login page**. No
   QueuePass app ever sees your password.
2. You sign in. Keycloak sends you back with a one-time code, and the front end exchanges it for
   tokens using the **OIDC Authorization Code flow with PKCE**. Each front end has its own public
   client in the `queuepass` realm: `admin-app`, `customer-app`, and `booth-app`.
3. The front end keeps the tokens **in memory only** and sends the access token as
   `Authorization: Bearer <token>` on every API call. It renews the token before it expires.
4. The Backend **validates the JWT** on every request except `/health`: signature against the
   realm's published keys (JWKS), issuer, audience (the QueuePass API), and expiry. Failures get
   `401`.
5. The Backend reads your **realm roles** from the token and enforces them. The wrong role gets
   `403`. Hiding a button in a front end is never the enforcement.
6. **Logout** discards the tokens and ends your Keycloak session, so reopening the app shows the
   login page again.

| Who                         | Can use          | Can do through the API                                                                                 |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `queuepass-admin`           | Admin app        | read and change venues and events                                                                      |
| `customer`                  | Customer app     | read venues, events, and seat maps; reserve seats; get tickets; read their own orders and reservations |
| `gate-agent`                | Ticket Booth app | read venues and events                                                                                 |
| no token, or an invalid one | nothing          | only `GET /health`                                                                                     |

To call the API by hand, copy a token from a signed-in app and pass it as a Bearer token. The
steps are in [quickstart V6](specs/001-bare-bones-system/quickstart.md#v6-the-backend-refuses-bad-tokens-us3-fr-018fr-024-sc-006).
Front-end clients deliberately refuse password grants, so there is no `curl` login.

---

## Run the tests

```bash
npm install     # first time only
npm test
```

`npm test` works on a fresh clone: the Backend's tests generate the Prisma client first. It runs
the repository scripts' own tests, the boundary and contract-drift checks, then every workspace's
tests, and measures each workspace's line coverage (a short summary after each).

Backend tests provision a **real PostgreSQL 17** through Testcontainers, so Docker must be
running. The scheduling rule is a PostgreSQL exclusion constraint, and SQLite has no
`tstzrange`, `EXCLUDE`, or `btree_gist`, so a substitute could not express the feature.
Authorization tests use tokens signed by a real test key set.

```bash
npm test --workspace @queuepass/backend      # API, persistence, scheduling, auth
npm test --workspace @queuepass/admin-app    # Admin app components
npm run seed                                 # re-run the Keycloak seed (idempotent)
```

**Device time zones** (`020`): `npm run test:tz` runs the shared, Admin, Customer, and Booth
suites and the Backend's unit tests (no Docker needed) once in each of America/New_York, UTC,
America/Los_Angeles, and Pacific/Honolulu, and prints a zone-by-workspace table;
`node scripts/test-tz.mjs --zones UTC,America/Chicago` picks zones, `--quick` runs only the time
tests, and `--backend-full` adds the Backend's whole suite. It sets `QP_TEST_TZ` (which every
Vitest config reads; the Customer app's default stays America/New_York) and `TZ` in each child
from Node, and removes `019`'s `CALENDAR_TEST_TZ`, which still works on its own for the calendar
test. On Windows, a `TZ=… npm test` prefix in Git Bash does not reach Node; use `npm run test:tz`,
or PowerShell's `$env:TZ`. `npm test` ends by rerunning the time tests in America/Los_Angeles,
so CI, which runs in UTC, checks a second zone too.

### The pull request check, and running it locally

Every pull request (when opened, updated, or reopened) and every push to `main` runs the **CI /
test** check in GitHub Actions. Each run's summary page shows every workspace's line coverage;
below 80% is marked but does not fail the run until `010` enforces the floor. To run exactly what
the check runs:

```bash
npm ci          # what the check installs; only needed after package-lock.json changes
npm run ci
```

`npm run ci` runs, in this order, and each step stops the run if it fails: generate the Prisma
client, `npm run format:check` (Prettier), `npm run lint` (ESLint), `npm run build` (every
workspace, which type-checks the front ends), `npm test`, and `npm run coverage:report` (the
coverage table). The check runs the same steps, and a test fails if the two ever differ. Docker must
be running. To reproduce a pull request's run, first merge or rebase the branch onto the latest
`main` (the check tests the branch merged with `main`), and keep the Docker Compose stack down (with
it up, the seed's four Keycloak tests run instead of being skipped). `npm run coverage:report` is
meant to follow the root `npm test` or `npm run ci`: after a single workspace's tests it can mix
this run's numbers with older ones.

**Reading a failed check**: open **Details** on **CI / test**. The failed step's name says which
check failed: **Check formatting** (run `npm run format`), **Lint**, **Build**, **Test**, or
**Report coverage** (a workspace whose coverage was not measured). The step's output names the file
and line, or the failing test. A Testcontainers "could not pull image" error in the **Test** step
is the runner, not the code: use **Re-run failed jobs**.

---

## Seeded test credentials

The seed provisions **235 accounts** in the `queuepass` realm, plus one OIDC client per front
end:

| Accounts           | Usernames                   | Realm role        |
| ------------------ | --------------------------- | ----------------- |
| 5 QueuePass Admins | `admin1` … `admin5`         | `queuepass-admin` |
| 30 Gate Agents     | `agent1` … `agent30`        | `gate-agent`      |
| 200 Customers      | `customer1` … `customer200` | `customer`        |

**Password for every seeded account: `test123`**

> ⚠️ `test123` is for **local development only**. It must never be used in a shared, staging,
> or production environment, and must never be reused as a default for real accounts.

The Keycloak admin console uses `admin` / `admin` (override with `KEYCLOAK_ADMIN` and
`KEYCLOAK_ADMIN_PASSWORD`).

The seed is **idempotent**: running it again succeeds and leaves the accounts and clients
unchanged.

---

## What the system does

- **Sign-in everywhere** — login page, hello-world page, and logout in all three front ends;
  JWT validation and role checks at the Backend (`001`)
- **Venue catalog** — admins create, view, edit, and delete venues with name, address, and
  seating capacity (`002`)
- **Venue address checks** — a venue's address is entered as street, city, state, and ZIP code
  and checked by the US Census Geocoder before it is saved, in the service's standard form. An
  address the service does not find, or finds more than once, is refused, unless the admin
  chooses **Save anyway**; the venue is then marked "Address not verified". When the service is
  down, saving a new address is refused and nothing is lost. Venues from before this check keep
  their address and are marked not verified until an admin enters it again (`013`)
- **Map links** — every venue address in the Admin and Customer apps opens Google Maps in a new
  tab (`013`)
- **Event scheduling** — admins create, view, edit, and delete events with times, ticket
  capacity, and base price (`002`)
- **Double-booking prevention** — events at the same venue must be at least **60 minutes**
  apart, enforced by a database constraint so no client can bypass it (`002`)
- **Customer browsing** — customers see all venues and events, read-only (`003`)
- **Ticket tiers** — admins split an event's tickets into tiers such as General and VIP, each
  with its own price and quantity; tiers never exceed the event's capacity, even under
  simultaneous edits (`004`)
- **Admin search** — find events by name, venue, and date range, and venues by name or address;
  filters stay in the page address (`004`)
- **Orders and tickets** — customers get tickets through the API, one unique code per seat; sales
  never exceed a tier or the event, even with many simultaneous buyers. Payment is simulated
  (`005`)
- **Sales dashboard** — admins see tickets sold against capacity, revenue, and check-ins, overall
  and per event and tier, always current (`005`)
- **Attendee lists** — every order for an event, with ticket codes and check-in state (`005`)
- **Safe cancellation** — cancelling an event voids its tickets, refunds its orders, frees the
  venue time, and shows customers it was cancelled; events and tiers with orders can't be
  deleted (`005`)
- **Getting tickets** — on an event's page, customers choose a tier (or the base price) and a
  quantity, see the exact total, and confirm to get their ticket codes. Sold-out tiers, cancelled
  events, and events that have started say why tickets aren't available; sales close when an
  event starts. Confirming twice, or a retried request, never places a second order (`006`)
- **My tickets** — every order a customer placed, newest first, with its codes, and refunded
  orders, cancelled events, and used tickets marked; never anyone else's orders (`006`)
- **Finding events** — customers search by name and filter by venue, dates, and cancelled
  events; filters stay in the page address, so a filtered list can be reloaded or shared (`008`)
- **The Customer app on a phone** — events as cards, one column on a phone with no sideways
  scrolling, 44-pixel touch targets, WCAG AA contrast checked by a test, seat states that hold
  in grayscale, and full keyboard use, in the Admin app's look (`008`)
- **Seating layouts** — admins give a venue sections of numbered rows and seats, within its
  seating capacity; a layout is locked while seated sales depend on it (`007`)
- **Reserved seating** — per event, admins choose seats or general admission and map each
  section to a tier; the event page shows a seat map with sold and open counts (`007`)
- **Choosing seats** — customers pick a tier, a section, and their exact seats; every ticket names
  its seat. No seat is ever sold twice, guaranteed by the database, and cancelling frees seats
  (`007`)
- **Ticket limit per customer** — admins may set the most tickets one customer can hold for an
  event, across all their orders, or leave it blank for no limit. Customers see how many more they
  can get, and the Backend refuses an order over the limit, including simultaneous ones (`016`)
- **Event images** — admins add up to 5 pictures to an event in its form, move them, and remove
  them; the first is the cover. The Backend accepts only JPG, PNG, and WebP by their content, up to
  5 MB and 40 megapixels, removes location and camera metadata, and never lets an event have more
  than 5, even under simultaneous uploads. Customers see them as a gallery that turns every 5
  seconds, with arrows and a Pause/Play button, on event cards and across the event page, and full
  screen from the event page. Images are stored in PostgreSQL with their event and loaded with
  the user's token, like every other API response (`014`)

### Seat reservations

On an event with reserved seating, a customer picks seats and presses **Reserve seats**. The
seats are theirs for exactly 5 minutes, with a countdown; **Confirm purchase** buys them, and
**Release seats** (or deselecting one) lets them go. A seated order must come from the customer's
own reservation. No seat is ever reserved by two customers, or reserved and sold, at once,
guaranteed by the database (`015`).

- **The 5 minutes** never restart. Adding seats keeps the same end. When they run out, the seats
  are released and the customer is told, with their picks kept.
- **The 2-minute wait**: a customer whose reservation ended unbought (it ran out, they released
  it, or they logged out) can reserve those same seats again 2 minutes later. Anyone else can
  reserve them at once. Admin changes and cancellations start no wait.
- **Live updates**: every customer and admin viewing an event's seat map sees seats turn
  Reserved, open, or sold within 2 seconds, without refreshing, and catches up after a dropped
  connection. Reserved looks different from sold (a dashed outline and an R, not a striped cross;
  `◩` in the Admin app, with reserved counts), and nobody sees who reserved a seat.
- **Logging out** of the Customer app releases every seat the customer has reserved.

### Gate check-in

Every new order carries one holder's name — the buyer's own, typed at purchase, never changed
(`017`). From **My tickets**, a customer opens **Print ticket** on any valid, unused ticket: one
page with a QR code (it encodes only the 12-character ticket code), the code in text, the name,
the event, venue, time, and seat.

In the Ticket Booth app, a gate agent chooses the event they are working, then scans a ticket's QR
code with the camera or types its code (case, spaces, and dashes are ignored). The app shows the
ticket and the holder's name and prompts the agent to check a government-issued photo ID that
shows that name — a printed or typed code is only as secret as the code itself, so the ID check is
what ties it to a person. **Admit** records the entry (time and agent); **Admit all N** admits an
order's remaining tickets after one ID check; **Refuse** records nothing, and the ticket stays
usable. A ticket is admitted exactly once — simultaneous admits from any number of gates leave one
entry, guaranteed by the database — and entry is open from 2 hours before the event's start until
its end. Tickets from before `017` have no name; the agent is asked to check any valid photo ID.
Refusals always say why: no such code, cancelled and refunded, already used (with the time), for
another event (named), or outside the entry window.

- **Camera demo**: the webcam works at `http://localhost:5175`, because browsers treat
  `localhost` as a secure origin. Scan a printed ticket, or hold the print view on another screen
  up to the camera.
- **Optional, a real Android phone**: browsers allow the camera only on secure origins, and a
  phone reaching the laptop over Wi-Fi is not one. Chrome's USB port forwarding bridges this with
  no configuration change: connect the phone with USB debugging on, open `chrome://inspect` in
  desktop Chrome, choose **Port forwarding**, and add `5175`, `8080`, and `3000`, each to
  `localhost:` the same port. On the phone, open Chrome at `http://localhost:5175`, sign in as a
  gate agent, and scan. iPhones can't use this step: Safari has no port forwarding.

**Live entry codes** (`018`): **Show entry code**, beside **Print ticket** on each valid, unused
ticket, shows a QR code that changes every 30 seconds, with a countdown, the holder's name, the
event, and the seat. It follows the Backend's clock, not the phone's, and keeps changing with no
signal for as long as the page stays open; losing the signal doesn't sign the customer out. When
the gate scans it, the Backend checks it was made with that ticket's secret for the current
30-second window (with 5 seconds of grace either side), and the Ticket Booth says "Live code
verified. No ID check needed." **Admit** and **Admit all N** work as for a printed code, and a
ticket is still admitted once whichever code is used. An old screenshot is refused as expired and
a made-up code as not valid, with nothing about the ticket shown. To demonstrate it on one laptop,
hold a phone's front camera up to the Customer window so the webcam reads the phone's screen; see
[quickstart](specs/018-rotating-qr-codes/quickstart.md).

### One shared look

The Admin and Customer apps look the same because both load one theme,
[`packages/shared/src/web/theme.css`](packages/shared/src/web/theme.css): the colors (light and
dark, following the device), typefaces, spacing steps, corner rounding, shadows, and the shared
controls (buttons, fields, banners, badges, cards, tables). Each app's own `styles.css` adds only
its own screens' rules, using the theme's values. `npm test` fails, naming the file and line, if
an app writes a color, typeface, radius, shadow, or off-step spacing of its own, or redefines a
theme value (`012`). A change to the theme changes `packages/shared/`, so it needs every team
member's approval. The Ticket Booth app adopted the theme with its first functionality (`017`).

### Venue time zones

Each venue has one of eight US time zones (Eastern, Central, Mountain, Arizona, Pacific, Alaska,
Hawaii-Aleutian, Hawaii), worked out by the Backend from the place the address service matched,
from the state when the place gives none and the state has one zone, or chosen by an admin (who
must choose in the 15 states with two zones when saving an address anyway). Existing venues got
Eastern. Event times are stored as instants and shown in the venue's zone; changing a venue's zone
keeps its events' local times and is refused once any of them has an order (`020`).

Time zone boundaries: timezone-boundary-builder, © OpenStreetMap contributors, ODbL 1.0, via
`geo-tz`.

### Scheduling rule

Each event reserves its window plus a 60-minute setup and teardown buffer. For an event running
18:00–21:00 at a venue:

| Next event starts         | Result                                  |
| ------------------------- | --------------------------------------- |
| 21:00 (immediately after) | rejected — buffer unsatisfied           |
| 21:59                     | rejected — only 59 minutes of clearance |
| 22:00                     | accepted — exactly 60 minutes           |

The same window at a _different_ venue is always accepted.

---

## API contract

The OpenAPI 3.1 document is the agreement every front end builds against (Constitution I). It
is [`contracts/openapi.yaml`](contracts/openapi.yaml) at the repository root, created in the `001`
plan and is served by the Backend at `/docs`. Every endpoint declares its request and response
shapes, its required role, and every error it can return. An API change is merged into the
contract, in a reviewed PR, before it is implemented.

The front ends reach data **only** through this API. None holds a database connection.

---

## Deliberate scope boundaries

- Payment is simulated, and customers can't cancel or refund their own orders.
- No emailed tickets and no wallet passes. A printed code never expires, which is why it always
  takes an ID check; only the live code in the Customer app skips it (`018`).
- No undo for an entry, no re-entry, and refused ID checks are not recorded.
- Picking a seat holds nothing until **Reserve seats**; reservation times are fixed, with no
  admin override or waiting list. No best-available assignment, and no drawn floor plans:
  sections are rectangular rows of seats.
- The Ticket Booth app is a stub (sign-in, hello-world, logout) until a later spec.
- No self-service sign-up, password reset, or multi-factor authentication.
- No visual design work: front ends are plain and accessible (Constitution VII).
- Venue addresses in the 50 states and DC only; no map inside the apps, and no address
  suggestions while typing.
- Laptop only: no shared deployment, no TLS.

---

## Repository layout

```
backend/          NestJS API, Prisma schema and migrations, JWT validation
admin-app/        React + Vite Admin app          (role queuepass-admin)
customer-app/     React + Vite Customer app       (role customer)
booth-app/        React + Vite Ticket Booth app   (role gate-agent)
contracts/        OpenAPI contract shared by every app
packages/shared/  Request and response types, sign-in, and the theme shared by the apps
scripts/seed/     Idempotent Keycloak seed: realm, roles, clients, accounts
.github/workflows/ The pull request check, CI / test (spec 011)
specs/            Specifications, plans, contracts, tasks
```

---

## Troubleshooting

| Symptom                                                     | Fix                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port is already allocated` on startup                      | Another program or Compose project is using one of the ports listed under _Start the system_. Stop it.                                                                           |
| Seed fails with connection refused                          | Keycloak wasn't ready; the job retries. Confirm `KC_HEALTH_ENABLED=true`.                                                                                                        |
| Every API call returns `401` with a valid login             | The token's issuer is the browser's Keycloak address (`localhost:8080`), not the in-container one. The Backend must expect that issuer while fetching keys from `keycloak:8080`. |
| `401` with "invalid audience"                               | The front-end client is missing the audience mapper for the QueuePass API. Re-run the seed.                                                                                      |
| Login redirects fail with "Invalid redirect uri"            | The client's redirect URI must match the front end's address exactly. Re-run the seed.                                                                                           |
| Signed in but "your account cannot use this app"            | You are using the wrong role for that app. See the table under _Start the system_.                                                                                               |
| All same-venue bookings rejected                            | Buffer applied to both interval bounds; it belongs on the lower bound only.                                                                                                      |
| `constraint "event_no_overlap" does not exist`              | Someone ran `prisma db push`. Use `prisma migrate deploy`.                                                                                                                       |
| Data gone after restart                                     | `docker compose down -v` deletes volumes; omit `-v`.                                                                                                                             |
| Saving a venue says "We can't verify the address right now" | The Backend can't reach the US Census Geocoder. Check the laptop's internet and `ADDRESS_GEOCODER_URL`. Name-only edits still work.                                              |
| Tests fail to start                                         | Docker must be running for Testcontainers.                                                                                                                                       |
