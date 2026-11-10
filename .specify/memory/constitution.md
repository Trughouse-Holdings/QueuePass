<!--
Sync Impact Report (replaced, not stacked, by the next amendment)
Version: 3.9.5 -> 3.9.6 (PATCH): one roadmap row reserved; no principle changed and no control
  removed. Applies on top of spec 033's amendment (3.9.4 -> 3.9.5, row 033-seat-hold-cart),
  merged to main as 17b3b88; 033's implementation (branch 033-seat-hold-cart-impl) is in flight.
Problem: issue #126. Ticket sales close the moment an event starts (spec 006 FR-014), so someone who
  arrives late or decides at the door cannot buy a ticket while the event is still going. Sales
  should stay open until the event ends, and a customer buying after the start should be told the
  event has already started and until when tickets are on sale.
Changed:
  - Roadmap: row 034-sell-until-end reserved (orders and seat holds are allowed until the event's
    end, half-open, and refused as sales closed from then on; holds end at the end, not the start;
    capacity, the per-customer limit, the attempt limits, and seat holds unchanged; from the start
    to the end the Get tickets panel says the event has already started, when it began and until
    when tickets are on sale, in the venue's time zone, and an order placed after the start says so
    on its confirmation; after the end, "Sales closed: this event has ended."; the Ticket Booth
    admits a ticket bought after the start until the end, as today). The next free number is 035.
Impact: spec 034, and its contract change (1.26.0: Availability.salesClosed gains ENDED, which
  replaces STARTED once 034 is implemented; Availability gains inProgress; createOrder's and
  reserveSeats' sales-closed rule moves to endsAt; the SALES_CLOSED example), with packages/shared's
  api-schema.ts regenerated and order.ts's SalesClosedReason and Availability widened to match in
  the spec PR. Every start-based sales rule in an earlier spec gets a dated note: 006 (US2's
  narrative and scenario 6, its edge case, FR-014, SC-004), 007 (its "Events that started or were
  cancelled" edge case), 015 (its "Sales closed" edge case and FR-016), 030 (the clarification
  leaving the Get tickets panel to #126, and FR-014: once availability has loaded, the page's "This
  event has ended." line follows it, ENDED, or CANCELLED and not in progress with the end passed by
  the browser's clock when the event loaded, never while in progress, 034 FR-017), and 033 (its edge
  cases on ended events in the cart and on a reservation ending elsewhere, its #126 line, and its
  coordination assumption). No other spec changes. The README's version reference follows.
  Templates: none need updating.
-->

# QueuePass Constitution

QueuePass replaces spreadsheets, drifting email lists, and paper tickets with one system of
record for venues and events. It is a proof of concept that must run on a laptop, stay correct
under concurrency, and be built so its simulated parts can be replaced later.

The system has six long-running parts: PostgreSQL, Keycloak, the Backend API, and three web
front ends (the **Admin app**, the **Customer app**, and the **Ticket Booth app**).

## Core Principles

### I. API-Only Boundary, Contract First (NON-NEGOTIABLE)

The Backend API owns all business logic and all persistent state. The Admin, Customer, and Ticket
Booth apps, and any future client, MUST read and write data only through the Backend's REST API.
No front end may open a database connection, share an ORM model or session, or import backend
persistence code. An automated test MUST fail if any front end's source or dependencies contain
database access code or a database driver.

The OpenAPI document at `contracts/openapi.yaml` is the single, authoritative API contract that
every front end and every team member builds against.

- An endpoint MUST be added to or changed in the OpenAPI document, and that change reviewed and
  approved in a pull request, before any implementation of it is merged.
- Every endpoint in the document MUST declare its request shape, response shape, required role,
  and every error it can return.
- The Backend MUST conform to the document, and automated tests MUST fail when a response does
  not match its declared schema. The Backend MUST serve the document for browsing.
- Front ends MUST call the API through types generated from, or checked against, the document.
- Every error response MUST use one shape across the API: a stable machine-readable code, a
  human-readable message, and structured details where relevant.

Rationale: A single enforcement point makes authorization, validation, and scheduling rules
unavoidable. A shared contract is what lets three front ends and one backend be built in
parallel, by different people, without drifting apart.

### II. One Repo, One Command, Reproducible

All applications live in one repository, and each runs in its own container with its own
Dockerfile. From a clean checkout, `docker compose up --build` MUST bring up the whole system on
one laptop, seeded and usable, with no manual steps: PostgreSQL, Keycloak, the Backend, all three
front ends, and a one-shot seed job.

- Every service MUST expose a health check, and startup order MUST be gated on health, not on
  timing.
- PostgreSQL MUST use a mapped volume so data survives a full stop and restart.
- The Keycloak realms, roles, OIDC clients, and test accounts MUST be created by a deterministic,
  idempotent seed script. Rerunning it converges on the same state instead of duplicating it or
  failing.

Rationale: Reviewers, graders, and teammates must reach an identical running system without
tribal knowledge. A nondeterministic seed turns every test failure into environment archaeology.

### III. Spec-Driven Development, Reviewed Before Every Pull Request

Specs come before code. Each feature has a GitHub issue and moves through two pull requests, in
order. Implementation MAY begin once the first is open; the first MUST be merged before the
second:

1. **Spec and plan PR** (branch `NNN-name-spec`): `specs/NNN-name/spec.md`, then the plan,
   research, data model, OpenAPI contract changes, and task list, plus any change to this
   constitution. The spec is worked through until it is right, and only then is the plan written.
2. **Implementation PR** (branch `NNN-name-impl`): the code and tests, with the tasks checked off.
   Its description MUST reference the feature's issue (`fixes #N`) so the issue closes on merge.
   While the spec and plan PR is open, the implementation branch is cut from the spec branch and
   builds against the spec and plan as they stand there. Any change the spec PR's review makes to
   the spec, plan, contract, or tasks MUST be carried into the implementation before its PR is
   opened, and the implementation branch is rebased onto `main` once the spec PR merges. The
   implementation PR MUST NOT be merged, or opened for review, before the spec and plan PR is
   merged.

Every branch is reviewed by a second Claude session before its pull request is opened:

- **Independent review.** A Claude session that did not write the work reviews the branch
  locally: the spec and plan against this constitution and the issue, and the code against the
  spec and plan as merged. The writing session fixes the findings. One review is required;
  another round is optional, at the author's choice. The fixes are not reviewed again by Claude:
  the teammate review of the pull request is the check on them. The PR description records the
  review and any finding left open, with the reason.
- **Fresh implementer.** The implementation is written in a new Claude session that starts from
  the spec and plan only, not in the session that wrote them. A gap it finds is fixed in
  the spec or plan, not worked around in code.
- **One feature at a time.** Each feature has its own branch and its own Claude session. A
  session never works on two features at once.
- **Teammate review.** Teammates review each other's pull requests promptly. Because the author
  has already run the independent review, the teammate checks that the work makes sense and
  follows this constitution, not every line again.
- **Commit citations.** Every commit message cites the spec it belongs to and, for
  implementation work, the task IDs it carries out, so a later review session can trace each
  commit to its requirements without the author's context. The subject line starts with the
  kind of work and the spec number and ends with the task IDs, when there are any, and the issue:
  `Impl 015: reserve path and its refusals (T017–T019, #27)`. Spec, clarify, plan, tasks and review
  commits use `Spec`, `Clarify`, `Plan`, `Tasks` or `Review` in place of `Impl`, and cite the
  issue: `Review 015: address PR #38 review (#27)`. A commit outside any feature, such as a
  constitution amendment, says so in place of the spec number: `Constitution: …`. The body
  names any spec requirement (`FR-…`) or research decision (`R…`) the change rests on. The
  repository's `.gitmessage` is the template.

Nothing is committed directly to `main`, and `main` MUST be demo-ready at all times: only
reviewed, finished work is merged, and at any moment `main` MUST start with
`docker compose up --build` and pass the smoke test in Principle VI. There is exactly one copy
of this constitution and one copy of each spec, in the repository. Code that contradicts its spec
is a defect in one of the two, and one of them MUST be corrected in a pull request.

- Specifications describe capabilities in technology-agnostic terms. Framework choices belong in
  the plan, within the stack this constitution fixes.
- Every requirement MUST be testable, and every success criterion MUST be measurable.
- Where the source requirements are silent, the spec records a reasoned default in its
  Assumptions section and work continues.

Rationale: One reviewed pull request settles what to build and how before anyone writes code
against a moving target. A reviewer that did not write the work catches what its author cannot
see, and an implementer that knows only the spec and plan proves they are complete enough to
build from.

### IV. Server-Authoritative Rules, Guaranteed by the Database

Domain rules, most critically venue scheduling conflicts with their 60-minute setup and teardown
buffer, MUST be enforced in the Backend. A rule that must hold under concurrency MUST also be
guaranteed by the database (a constraint, an exclusion constraint, a unique index, or a row
lock), because an application-only check-then-write has a race. The application layer may check
first so it can return a human-readable error that names the cause.

The Backend MUST reject a violating request with a non-2xx status and the standard error shape.
Client-side checks are allowed only as a convenience preview. Front ends MUST show a Backend
rejection as an explicit error state, never a silent failure or a generic retry, and MUST keep
the user's entered values so nothing has to be retyped.

Rationale: Any rule enforced only in a UI is unenforced, because the API accepts direct calls. A
double-booked venue is a real-world failure that no later code change can undo.

### V. Sign-In Everywhere, Least Privilege by Role (NON-NEGOTIABLE)

Authentication and authorization are part of the first feature, not a later stage. From
feature `001` onward:

- Every front end MUST require sign-in before showing any page other than the login page, and
  every signed-in page MUST offer a logout control.
- Users sign in on Keycloak's login page using the OIDC Authorization Code flow with PKCE. No
  front end ever accepts, handles, or stores a password.
- Each front end MUST sign in through its own Keycloak realm (`queuepass-admin-app`,
  `queuepass-customer-app`, `queuepass-booth-app`), so signing in to, renewing, or logging out of
  one app never ends, changes, or replaces another app's sign-in in the same browser.
- Logging out MUST end both the front end's session and its realm's Keycloak session.
- Front ends MUST hold tokens in memory only, never in `localStorage` or `sessionStorage`, and
  MUST send the signed-in user's own access token as a `Bearer` token on every API call.
- The Backend MUST validate the access token (a JWT) on every endpoint except health: its issuer,
  which MUST be one of the three app realms, its signature against that realm's own published
  keys, its audience, and its expiry. A missing, expired, malformed, or wrongly signed token, or
  one from any other issuer, MUST be refused with `401`.
- The Backend MUST enforce role permissions on the server, reading roles from the validated
  token, and refuse with `403`. From each realm it MUST honour only that app's role
  (`queuepass-admin` from the Admin app's realm, `customer` from the Customer app's, `gate-agent`
  from the Ticket Booth's) and ignore any other role in the token. Hiding a control in a UI is never the
  enforcement.
- The Admin app requires `queuepass-admin`, the Customer app requires `customer`, and the Ticket
  Booth app requires `gate-agent`. A signed-in user without the required role is told so plainly,
  shown no data, and offered logout.
- QueuePass MUST NOT store passwords or manage identities. It stores at most the Keycloak subject
  identifier. A name a buyer types onto an order, for the gate's ID check, is ticket data like a
  seat or a quantity, not an identity: it belongs to no account, signs no one in, and is never
  sent to or checked against Keycloak. Usernames shown next to orders and entries are display
  copies of the token's `preferred_username`, under the same reading.

Rationale: Not every staff member or customer may see or do everything. Building sign-in into
the bare-bones feature means no later feature has to retrofit it, and an API that trusts every
caller cannot be made trustworthy by its front ends.

### VI. Test-First, Real Database

Every application MUST have automated tests. Tests for every persistence path, every business
rule, and every authorization rule MUST be written, and seen to fail, before the implementation
they cover. A change to a rule MUST come with a test that fails before the change and passes
after it.

- Any test that asserts persistence behavior MUST run against real PostgreSQL (via
  Testcontainers). SQLite and in-memory substitutes are not allowed.
- Authorization tests MUST use tokens signed by a real key set, and cover the missing,
  expired, wrongly signed, wrong-audience, and wrong-role cases.
- Boundary conditions MUST be tested on both sides, and concurrency guarantees MUST be tested with
  genuinely concurrent requests.
- The full suite MUST run with one documented command (`npm test`) on a laptop, and MUST also
  run automatically in GitHub Actions whenever a pull request is opened or updated.
- Each workspace (`backend`, `admin-app`, `customer-app`, `booth-app`, `packages/shared`, and
  `scripts/seed`) MUST reach at least **80% line coverage** on its own; one well-tested
  workspace cannot make up for another. Coverage MUST be measured by the documented test command
  and checked in CI. Only generated code (such as `packages/shared/src/api-schema.ts`) may be
  excluded, and every exclusion MUST be listed in the coverage configuration with its reason.
- Before an implementation PR is merged, the system MUST be brought up with
  `docker compose up --build`, and each front end MUST be signed into, used, and signed out of as
  a smoke test.
- For every feature whose implementation PR opens after `022`'s implementation has merged, the
  implementation PR MUST include browser tests (`e2e/`, run by
  `npm run e2e` and the `e2e` check) for its quickstart's main journey, and its quickstart MUST mark
  each scenario Automated or Manual, with the test's name or the reason (spec `022`).

Recorded deferral (Principle VIII): the CI run becomes merge-blocking once `011-ci-test-runs` is
merged and its check is required on `main`, which a repository admin turns on right after that
merge; the coverage floor becomes merge-blocking when `010-test-coverage` is merged. Until `010` is
merged, pull requests report their coverage but are not blocked by it.

Rationale: Scheduling logic is full of boundary conditions, and authorization mistakes are
silent until exploited. Only explicit tests pin either down. A coverage floor per workspace shows
where tests are missing, and running them on every pull request means nobody has to remember to.

### VII. Function Over Finish, One Shared Look

Usability and correctness are what get evaluated; visual design does not. Front ends MUST be
plain, semantic, and accessible. No effort goes into branding, logos, decoration, or custom visual
design. A stub front end (a hello-world page behind sign-in, plus logout) is a complete front end
until a spec gives it functionality.

The Admin and Customer apps MUST take their look (accent color, fonts, spacing, and the styles of
shared controls such as buttons, inputs, and status messages) from one shared theme in
`packages/shared/`, so the two apps are guaranteed to match. Neither app may define its own accent
color or redefine a theme value. An app MAY add styles for its own screens, but those styles MUST
use the theme's values. The theme is one fixed set of values, not a theming system: no runtime
theme switching, no user-chosen themes, and no per-app variants. The Ticket Booth app stays a
plain stub and adopts the shared theme when a spec gives it functionality.

Reusing a look the project already has, to meet usability targets a spec states and tests (a
layout that works at phone width, touch target size, WCAG contrast, states that do not rely on
color alone, keyboard access), is usability work, not custom visual design. New branding and
decoration remain out of scope.

The one exception to "no per-app variants" and to "no decoration": the sign-in screens (Keycloak's
pages, styled from the shared theme) MAY show each app's name, a line saying who it is for, and its
own accent color, so a person can tell at a glance which app they are signing in to (spec `021`).
They MAY also show Keycloak's stock low-poly background, served from Keycloak's own theme, with the
lines between the stones in the app's accent, and, above the sign-in card, the realm's name as
Keycloak's own login page shows it (spec `027`). The lines MAY pulse and glow, smoothly and with
no flash, only with a control on the page that pauses them, and never when the person's system asks
for reduced motion. That background, its pulse, and that header are the only decoration allowed,
and every text, label, and control on them MUST keep the contrast its spec states. Those accents,
and the colors the sign-in screens draw on that background, are tokens in the shared theme, defined
only in its token blocks and checked by its contrast tests. The apps themselves keep the one
shared accent and use none of them.

Rationale: Make it function now. Make it pretty later. One shared theme guarantees the apps match
without anyone spending time on visual design, and a change to the look is made once.

### VIII. Staged Simplicity (YAGNI)

Each feature builds what its spec requires and no more. Speculative abstractions, unused
configuration surfaces, and services the current feature does not need MUST NOT be added.

- Every deferral of a security or correctness control MUST be recorded in the spec, naming the
  feature that closes it.
- Any test-only bypass of a control (for example, a flag that disables token validation) MUST be
  off by default, MUST refuse to start unless explicitly enabled, and MUST never be enabled in
  `docker-compose.yml`.

Rationale: Staged delivery only stays honest when each deferral is named. An undocumented gap
looks exactly like an oversight.

## Language and Stack

These choices are fixed for every feature. Changing one requires amending this constitution.

| Concern | Decision |
|---|---|
| Language | TypeScript (strict mode) everywhere: backend, front ends, seed, and tests |
| Runtime | Node.js 22 LTS, pinned in `.nvmrc` |
| Repository | One monorepo with npm workspaces: `backend/`, `admin-app/`, `customer-app/`, `booth-app/`, `packages/shared/`, `scripts/seed/` |
| Backend | NestJS 11, REST over HTTP/JSON |
| Persistence | PostgreSQL 17 through Prisma 6. Schema changes only through committed migrations (`prisma migrate deploy`, never `prisma db push`) |
| API contract | OpenAPI 3.1 at `contracts/openapi.yaml`, served by the Backend at `/docs` |
| Front ends | React 19 with Vite 6, one app per container |
| Identity | Keycloak 26, one realm per front end (`queuepass-admin-app`, `queuepass-customer-app`, `queuepass-booth-app`), each with that front end's one public OIDC client (`admin-app`, `customer-app`, `booth-app`) |
| Front-end sign-in | A standards-based OIDC client library, not a Keycloak-only adapter |
| Backend token validation | JWT verification against the JWKS endpoint of the token's own app realm, using a standards-based JOSE library |
| Backend tests | Jest, with Testcontainers for PostgreSQL |
| Front-end tests | Vitest with React Testing Library |
| Lint and format | ESLint and Prettier |
| Browser tests | Playwright (Chromium) in `e2e/` at the repository root, against the Compose stack (`npm run e2e`) |
| Continuous integration | GitHub Actions on every pull request open and update: the `test` job runs `npm test` with coverage; the `e2e` job runs the browser tests |
| Orchestration | Docker Compose v2 |

## Security and Data Constraints

- **Roles and test accounts**: The seed provisions 5 QueuePass Admins (`admin1`–`admin5`, realm
  role `queuepass-admin`, in realm `queuepass-admin-app`), 30 Gate Agents (`agent1`–`agent30`,
  `gate-agent`, in `queuepass-booth-app`), and 200 Customers (`customer1`–`customer200`,
  `customer`, in `queuepass-customer-app`). Self-enrollment, password reset, and MFA are out of
  scope.
- **Test credentials**: The shared seed password `test123` is for local development only. It MUST
  NOT be used in any shared, staging, or production environment, and MUST NOT be reused as a
  default for real accounts.
- **OIDC clients**: One client per front end, in that front end's realm. Front-end clients are
  public (no client secret), allow only the Authorization Code flow with PKCE (`S256`), and list
  exact redirect URIs and web origins; wildcards are not allowed. Direct-access (password) grants
  are disabled on front-end clients.
- **Secrets**: No secret, key, or non-seed credential may be committed. Configuration reaches
  services through environment variables, with working defaults in `.env.example`.
- **CORS**: The Backend allows only the three front-end origins.
- **Identifiers**: Primary keys are UUIDs.
- **Money**: Amounts are exact decimals or integer cents, never floating point. The currency is
  USD only.
- **Time**: All instants are stored and compared in UTC and exchanged as RFC 3339 with an
  explicit offset. Time windows are half-open (`[start, end)`), and this convention MUST be
  stated in the OpenAPI document.
- **Data model minimums**: Venues carry a name, an address, and a seating capacity. Events carry
  a name, a start time, an end time, a total ticket capacity, a base price, and a reference to
  exactly one venue.

## Feature Roadmap

Spec numbers are reserved here so two branches never claim the same number. Reserving a new
number is a pull request against this table. The next free number is `035`.

| Spec | Scope | Depends on |
|---|---|---|
| `001-bare-bones-system` | All six services and the seed job; Keycloak sign-in, token validation, and role enforcement; three stub front ends with a login page, a hello-world page, and logout | none |
| `002-admin-venues-events` | Backend venue and event API with the 60-minute double-booking rule; Admin app screens to create, read, update, and delete venues and events | `001` |
| `003-customer-venues-events` | Customer app screens that show all venues and events, read-only | `001`, `002` |
| `004-admin-tiers-search` | Ticket tiers per event (name, price, quantity); search and filters for events and venues in the Admin app | `002` |
| `005-admin-orders-reporting` | Orders and tickets in the Backend; Admin sales dashboard, attendee lists, and safe event cancellation | `004` |
| `006-customer-ticket-purchase` | Customer app screens to choose a tier, get tickets, and see them (payment simulated) | `003`, `005` |
| `007-seat-selection` | Seating layouts per venue (sections, rows, seats) mapped to tiers; Admin seat map of sold and open seats; customers choose seats when getting tickets; no seat sold twice | `004`, `005`, `006` |
| `008-customer-event-search` | Customer app search and filters for events (name, venue, date range, hide cancelled) using the existing event search; Customer app usability (phone-width layout, event cards, distinguishable seat and status states, keyboard access, AA contrast) reusing the Admin app's existing look | `003`, `004` |
| `009-admin-order-management` | Admin order lookup by ticket code or customer; refund a single order, voiding its tickets and freeing its seats | `005`, `007` |
| `010-test-coverage` | Tests for every existing feature, so each workspace reaches 80% line coverage; turns the floor on, so `npm test` and the CI run fail when a workspace is below it | `001`–`008`, `011` |
| `011-ci-test-runs` | GitHub Actions workflow that runs the format and lint checks, the build, and the full suite with coverage on every pull request open and update and every push to `main`; fails on any failed check or test and reports each workspace's line coverage; fails below the floor once `010` is merged | `001` |
| `012-shared-theme` | One shared theme in `packages/shared/` (accent color, fonts, spacing, shared control styles) used by the Admin and Customer apps | `008` |
| `013-venue-address-validation` | Admin venue create and edit accept only a real US address, checked by the Census Geocoder and, when it vouches for no match, by OpenStreetMap (#25), unless an admin explicitly confirms an unmatched address, which is then marked not verified; a Google Maps link on the address in the Admin and Customer apps | `002`, `003` |
| `014-event-images` | Admins upload up to 5 images per event; customers see them on the event, for example as a rotating gallery | `002`, `003` |
| `015-seat-holds` | Seats a customer selects are held so no one else can take them before checkout; released on deselect or logout; other customers see held seats update live without refreshing | `007` |
| `016-per-user-ticket-limit` | Admins set a maximum number of tickets per customer per event; the limit counts across all of that customer's orders | `005`, `006` |
| `017-gate-check-in` | Every ticket carries its holder's name (#39); the Ticket Booth app checks tickets in by camera scan of a printed QR code or a typed code, with an ID check against the name, and admits each ticket exactly once, enforced by the Backend (#40) | `005`, `006`, `007` |
| `018-rotating-qr-codes` | The Customer app shows each ticket as a QR code that changes every 30 seconds; the Ticket Booth app accepts it only in its own window, with no ID check, and still admits each ticket exactly once (#41) | `017` |
| `019-add-to-calendar` | From My tickets, a customer adds an event they hold tickets for to their own calendar (Google, Apple, Outlook): a one-time snapshot with the event's name, start and end, and venue address, offered only for events not cancelled or ended (#50) | `006` |
| `020-venue-time-zones` | Every venue has a time zone, worked out from its checked address; event times are shown and entered in the venue's local time, with the zone made clear, in every app (#42) | `002`, `003`, `013` |
| `021-sign-in-screens` | The Admin, Customer, and Ticket Booth sign-in screens are visually distinct and each names the app it is for, in its heading and browser tab title, on every screen the apps reach (sign in, errors, signing back in), set up from a clean clone with no manual Keycloak steps (#92) | `001`, `012` |
| `022-quickstart-browser-tests` | The quickstart scenarios become browser end-to-end tests run in GitHub Actions against the full stack with the seed and demo data; each quickstart marks which scenarios are automated and which stay manual, and why (#93) | `011` |
| `023-report-exports` | Admins download an event's attendee list and the sales report as CSV, XLSX, or PDF, with the same figures as the screen and the time each file was made; CSV and XLSX keep numbers, dates, and exact money as data (#52) | `005` |
| `024-venue-form-simplify` | The Admin app's venue form: the admin always picks the venue's time zone from the list, with no option to work it out from the address; a well-formed address is always saved in one step, verified when the address service matches it, otherwise saved as typed and marked not verified, also when the service is down; each section line reads Rows × Seats per row with its seat count (#107) | `007`, `013`, `020` |
| `025-doors-open` | Every event has a doors-open time, set by admins in the venue's time zone (by default 1 hour before the start, no more than 6 hours before it and not after it, refused otherwise); customers and admins see it with the event; check-in, by any code, is open from 1 hour before doors open until the event ends, and the Ticket Booth app lists events not yet open greyed out, with when they open (#91; the doors-open item of #49) | `017`, `018`, `020` |
| `026-purchase-rate-limits` | Each customer account may try to buy tickets, and separately to hold seats, at most 10 times a minute and 3 times in any 5 seconds, however the API is called, with no one exempt; a customer over a limit is told plainly and when they can try again, with a countdown, and keeps what they had; ordinary buying never meets the limits, and QueuePass stays responsive for everyone else (#56) | `006`, `015`, `016` |
| `027-sign-in-background` | Every sign-in page shows Keycloak's own low-poly stones background, served by Keycloak, with the stones grey and the lines between them in the app's accent; the form on Keycloak's card, styled from the shared theme, under the realm's name as Keycloak's own header; the lines pulse and glow, with a pause button, and are still under reduced motion; every text, field, and focus ring stays readable at every window size, in light and dark schemes (#122) | `021` |
| `028-app-realms` | Each app signs in through its own Keycloak realm, so signing in to, renewing, or logging out of one app never signs another out, and three different users can use the three apps in one browser window; on a system made before it, the seed renames the old shared realm to the Customer app's realm, so customers keep their identifiers and their orders, tickets, and holds, and admins and gate agents get new accounts in their own realms, their old copies disabled, never deleted; the Backend accepts the three realms only, and from each only its app's role (#138) | `001`, `021`, `027` |
| `029-demo-checkpoint` | One command, refused unless explicitly allowed and pointed at a local QueuePass database, removes all app data (venues, seating, events, tiers, images, orders, tickets and their check-ins, seat holds), keeps the schema, and loads the demo data again through the Backend's rules, with times relative to the run: events on sale, one open at the Ticket Booth, one cancelled, one over; the same state every run, in seconds, saying what it removed and created; Keycloak untouched; never run by `docker compose up`; saving and restoring a hand-made checkpoint deferred (#139) | `005`, `017`, `025` |
| `030-hide-past-events` | An event is past once the current time reaches its end (`endsAt`); wherever events are listed, past events are left out by default, by the Backend for every client; the Admin app's event list and venue page have a Show past events toggle that lists them too, marked Ended; the Customer app has no toggle, keeps past tickets in a Past section of My tickets, and opens a past event's own page saying it has ended; an event's Admin page, attendees, sales, and Reports stay reachable (#133) | `002`, `003`, `004`, `005`, `006`, `008`, `019`, `020`, `025` |
| `031-atomic-event-create` | Scheduling an event in the Admin app saves the event, its ticket types, and its reserved seating (which section sells which type) in one request, all or nothing: any refusal leaves no event, ticket type, or seating behind, and two schedules for one slot save one whole event; each refusal names the ticket type or section at fault, so the form shows it beside that field and keeps every value to fix and resubmit; pictures still upload after the event exists, as in `014`; existing callers that send only the event are unchanged; editing an event is unchanged (#127) | `004`, `007`, `008`, `014` |
| `032-drop-check-ins` | One week after an event ends (`endsAt` + 7 days, one named constant), a Backend job that runs every hour removes when each of its tickets was admitted and which Ticket Booth agent admitted it, cancelled events included, and keeps the event's checked-in count, so its report reads the same afterwards; the Admin app's Attendees, Sales card, Reports, and attendee export say "Check-in details removed on …" instead of showing tickets as not checked in; My tickets no longer says when a ticket was used; once removed, the event's times can no longer change (#129) | `005`, `017`, `018`, `023`, `025`, `030` |
| `033-seat-hold-cart` | On a seated event the seat map is the only control for choosing seats: clicking an open seat holds it for the customer at once, and clicking it again releases it; the first held seat starts the reservation's 5 minutes, further seats join it without restarting them, and releasing the last one ends it, so the next click starts a new 5:00; no Reserve seats, Remove, Release, or Release seats; the countdown is shown prominently on the event page and in the cart, and every hold and release is announced; Add to cart opens a Cart page that lists the customer's active reservations, kept by the Backend (so a refresh or another device shows them), each event bought on its own before its countdown ends, then removed and the customer told; a seat released while others stay held can be held again at once, and every seat of an ended reservation waits 2 minutes from its end; seat holds get their own attempt allowance (30 a minute, 10 in any 5 seconds); general admission unchanged; one checkout for several events deferred (#135) | `007`, `015`, `016`, `017`, `020`, `026` |
| `034-sell-until-end` | Tickets are sold until an event ends, not when it starts: orders and seat holds are allowed until its end time (half-open) and refused as sales closed from then on, and holds end at the end; capacity, the per-customer limit, the attempt limits, and seat holds apply as before; from the start to the end the Customer app's Get tickets panel says the event has already started, when it began, and that tickets are on sale until it ends, in the venue's time zone, and the confirmation of an order placed after the start says so; after the end it says "Sales closed: this event has ended."; a ticket bought after the start is admitted at the Ticket Booth until the end, as today (#126) | `006`, `015`, `016`, `020`, `025`, `026`, `030`, `033` |

A change to the shared surface (`.specify/memory/constitution.md`, `contracts/openapi.yaml`,
`backend/prisma/`, `packages/shared/`, `docker-compose.yml`, `.env.example`, `.github/workflows/`,
and the root `package.json`) needs approval from every team member in its pull request.

## Development Workflow and Quality Gates

1. **Spec and plan, then implementation: two PRs.** Per Principle III. Each branch passes the
   independent Claude review before its pull request is opened.
2. **Contract before code.** Per Principle I, any API change is written into
   `contracts/openapi.yaml` in the spec and plan PR, before it is implemented, and merged before
   its implementation is merged.
3. **Tests precede implementation.** Per Principle VI.
4. **Green gate.** The full suite MUST pass, locally and in CI, and every workspace MUST meet the
   80% line coverage floor before a pull request is merged (Principle VI). A failing test is
   never skipped, and a coverage exclusion is never added, to unblock a merge; the test is fixed,
   or the change is withdrawn.
5. **Running-system gate.** Before an implementation PR is merged, the system MUST start from a
   fresh clone with `docker compose up --build`, seeding MUST succeed on the first run, and each
   front end MUST pass the sign-in, use, and sign-out smoke test.
6. **Documentation gate.** The root `README.md` MUST document the start command, the test
   command, every service URL, and the seeded credentials, and MUST be updated in the same PR
   that changes any of them.
7. **Review gate.** Reviews explicitly check API-only client access, contract conformance,
   Backend- and database-enforced rules, server-side token and role checks, test-first evidence,
   coverage, use of the shared theme, feature-appropriate scope, and commit citations
   (Principle III). Any deviation MUST be
   justified in the PR description, or the PR is rejected.
8. **Issue gate.** Every feature has a GitHub issue before its spec is written, and its
   implementation PR closes that issue with `fixes #N`.

## Governance

This constitution supersedes conflicting practices, conventions, and earlier decisions. Where a
team habit and this document disagree, this document governs until it is amended.

**Amendment procedure**: An amendment is a pull request against this file. It states the problem
that motivates it, the exact text added, changed, or removed, and the impact on existing code and
specifications. It takes effect when merged. An amendment that removes or weakens a control MUST
name the replacement control or accept the risk explicitly.

**Versioning policy**: This constitution uses semantic versioning.

- **MAJOR**: A principle is removed or redefined in a backward-incompatible way, or governance is
  restructured so that previously compliant work becomes non-compliant.
- **MINOR**: A principle or section is added, or existing guidance is materially expanded.
- **PATCH**: Clarifications, wording, and typo fixes that do not change what is required.

**Compliance review**: Compliance is checked at every review gate above. Recorded deferrals
(Principle VIII) MUST be reviewed when the feature that closes them is specified. A deferral that
outlives its closing feature MUST be escalated rather than silently carried forward.

**Version**: 3.9.6 | **Ratified**: 2026-09-20 | **Last Amended**: 2026-11-09
