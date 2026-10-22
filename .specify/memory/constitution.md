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
- The Keycloak realm, roles, OIDC clients, and test accounts MUST be created by a deterministic,
  idempotent seed script. Rerunning it converges on the same state instead of duplicating it or
  failing.

Rationale: Reviewers, graders, and teammates must reach an identical running system without
tribal knowledge. A nondeterministic seed turns every test failure into environment archaeology.

### III. Spec-Driven Development, Reviewed Before Every Pull Request

Specs come before code. Each feature has a GitHub issue and moves through two pull requests, in
order. The first MUST be merged before implementation begins:

1. **Spec and plan PR** (branch `NNN-name-spec`): `specs/NNN-name/spec.md`, then the plan,
   research, data model, OpenAPI contract changes, and task list, plus any change to this
   constitution. The spec is worked through until it is right, and only then is the plan written.
2. **Implementation PR** (branch `NNN-name-impl`): the code and tests, with the tasks checked off.
   Its description MUST reference the feature's issue (`fixes #N`) so the issue closes on merge.

Every branch is reviewed by a second Claude session before its pull request is opened:

- **Independent review.** A Claude session that did not write the work reviews the branch
  locally: the spec and plan against this constitution and the issue, and the code against the
  merged spec and plan. The writing session fixes the findings, and the review repeats until
  only minor findings remain, normally two or three rounds. The PR description records the
  number of rounds and any finding left open, with the reason.
- **Fresh implementer.** The implementation is written in a new Claude session that starts from
  the merged spec and plan only, not in the session that wrote them. A gap it finds is fixed in
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
- Logging out MUST end both the front end's session and the Keycloak session.
- Front ends MUST hold tokens in memory only, never in `localStorage` or `sessionStorage`, and
  MUST send the signed-in user's own access token as a `Bearer` token on every API call.
- The Backend MUST validate the access token (a JWT) on every endpoint except health: its
  signature against the realm's published keys, its issuer, its audience, and its expiry. A
  missing, expired, malformed, or wrongly signed token MUST be refused with `401`.
- The Backend MUST enforce role permissions on the server, reading roles from the validated
  token, and refuse with `403`. Hiding a control in a UI is never the enforcement.
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

Recorded deferral (Principle VIII): the coverage floor and the CI run become merge-blocking when
`010-test-coverage` and `011-ci-test-runs` are merged. Until then, pull requests report their
coverage but are not blocked by it.

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
| Identity | Keycloak 26, realm `queuepass`, one public OIDC client per front end (`admin-app`, `customer-app`, `booth-app`) |
| Front-end sign-in | A standards-based OIDC client library, not a Keycloak-only adapter |
| Backend token validation | JWT verification against the realm's JWKS endpoint, using a standards-based JOSE library |
| Backend tests | Jest, with Testcontainers for PostgreSQL |
| Front-end tests | Vitest with React Testing Library |
| Lint and format | ESLint and Prettier |
| Continuous integration | GitHub Actions, running `npm test` with coverage on every pull request open and update |
| Orchestration | Docker Compose v2 |

## Security and Data Constraints

- **Roles and test accounts**: The seed provisions 5 QueuePass Admins (`admin1`–`admin5`, realm
  role `queuepass-admin`), 30 Gate Agents (`agent1`–`agent30`, `gate-agent`), and 200 Customers
  (`customer1`–`customer200`, `customer`). Self-enrollment, password reset, and MFA are out of
  scope.
- **Test credentials**: The shared seed password `test123` is for local development only. It MUST
  NOT be used in any shared, staging, or production environment, and MUST NOT be reused as a
  default for real accounts.
- **OIDC clients**: Front-end clients are public (no client secret), allow only the Authorization
  Code flow with PKCE (`S256`), and list exact redirect URIs and web origins; wildcards are not
  allowed. Direct-access (password) grants are disabled on front-end clients.
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
number is a pull request against this table. The next free number is `019`.

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
| `010-test-coverage` | Tests for every existing feature, so each workspace reaches 80% line coverage, and coverage reporting in `npm test` | `001`–`008` |
| `011-ci-test-runs` | GitHub Actions workflow that runs the full suite with coverage on every pull request open and update, and fails below the floor | `010` |
| `012-shared-theme` | One shared theme in `packages/shared/` (accent color, fonts, spacing, shared control styles) used by the Admin and Customer apps | `008` |
| `013-venue-address-validation` | Admin venue create and edit accept only a real US address, checked by the Census Geocoder, unless an admin explicitly confirms an unmatched address, which is then marked not verified; a Google Maps link on the address in the Admin and Customer apps | `002`, `003` |
| `014-event-images` | Admins upload up to 5 images per event; customers see them on the event, for example as a rotating gallery | `002`, `003` |
| `015-seat-holds` | Seats a customer selects are held so no one else can take them before checkout; released on deselect or logout; other customers see held seats update live without refreshing | `007` |
| `016-per-user-ticket-limit` | Admins set a maximum number of tickets per customer per event; the limit counts across all of that customer's orders | `005`, `006` |
| `017-gate-check-in` | Every ticket carries its holder's name (#39); the Ticket Booth app checks tickets in by camera scan of a printed QR code or a typed code, with an ID check against the name, and admits each ticket exactly once, enforced by the Backend (#40) | `005`, `006`, `007` |
| `018-rotating-qr-codes` | The Customer app shows each ticket as a QR code that changes every 30 seconds; the Ticket Booth app accepts it only in its own window, with no ID check, and still admits each ticket exactly once (#41) | `017` |

A change to the shared surface (`.specify/memory/constitution.md`, `contracts/openapi.yaml`,
`backend/prisma/`, `packages/shared/`, `docker-compose.yml`, `.env.example`, `.github/workflows/`,
and the root `package.json`) needs approval from every team member in its pull request.

## Development Workflow and Quality Gates

1. **Spec and plan, then implementation: two PRs.** Per Principle III. Each branch passes the
   independent Claude review before its pull request is opened.
2. **Contract before code.** Per Principle I, any API change is merged into
   `contracts/openapi.yaml` in the spec and plan PR, before it is implemented.
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

**Version**: 3.1.2 | **Ratified**: 2026-09-20 | **Last Amended**: 2026-10-22
