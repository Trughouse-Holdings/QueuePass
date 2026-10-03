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

### III. Spec-Driven Development, Delivered by Pull Request

Specs come before code. Each feature moves through three pull requests, in order, and each MUST
be reviewed and merged before the next begins:

1. **Spec PR**: `specs/NNN-name/spec.md`, plus any change to this constitution.
2. **Plan PR**: the plan, research, data model, OpenAPI contract changes, and task list.
3. **Implementation PR**: the code and tests, with the tasks checked off.

Nothing is committed directly to `main`. There is exactly one copy of this constitution and one
copy of each spec, in the repository. Code that contradicts its spec is a defect in one of the
two, and one of them MUST be corrected in a pull request.

- Specifications describe capabilities in technology-agnostic terms. Framework choices belong in
  the plan, within the stack this constitution fixes.
- Every requirement MUST be testable, and every success criterion MUST be measurable.
- Where the source requirements are silent, the spec records a reasoned default in its
  Assumptions section and work continues.

Rationale: Separate pull requests let the team agree on what to build, then on how, before anyone
writes code against a moving target.

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
  identifier.

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
- The full suite MUST run with one documented command (`npm test`).
- Before an implementation PR is merged, the system MUST be brought up with
  `docker compose up --build`, and each front end MUST be signed into, used, and signed out of as
  a smoke test.

Rationale: Scheduling logic is full of boundary conditions, and authorization mistakes are
silent until exploited. Only explicit tests pin either down.

### VII. Function Over Finish

Usability and correctness are what get evaluated; visual design does not. Front ends MUST be
plain, semantic, and accessible. No effort goes into branding, theming, or custom visual design.
A stub front end (a hello-world page behind sign-in, plus logout) is a complete front end until a
spec gives it functionality.

Rationale: Make it function now. Make it pretty later.

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
number is a pull request against this table. The next free number is `010`.

| Spec | Scope | Depends on |
|---|---|---|
| `001-bare-bones-system` | All six services and the seed job; Keycloak sign-in, token validation, and role enforcement; three stub front ends with a login page, a hello-world page, and logout | none |
| `002-admin-venues-events` | Backend venue and event API with the 60-minute double-booking rule; Admin app screens to create, read, update, and delete venues and events | `001` |
| `003-customer-venues-events` | Customer app screens that show all venues and events, read-only | `001`, `002` |
| `004-admin-tiers-search` | Ticket tiers per event (name, price, quantity); search and filters for events and venues in the Admin app | `002` |
| `005-admin-orders-reporting` | Orders and tickets in the Backend; Admin sales dashboard, attendee lists, and safe event cancellation | `004` |
| `006-customer-ticket-purchase` | Customer app screens to choose a tier, get tickets, and see them (payment simulated) | `003`, `005` |
| `007-seat-selection` | Seating layouts per venue (sections, rows, seats) mapped to tiers; Admin seat map of sold and open seats; customers choose seats when getting tickets; no seat sold twice | `004`, `005`, `006` |
| `008-customer-event-search` | Customer app search and filters for events (name, venue, date range, hide cancelled) using the existing event search | `003`, `004` |
| `009-admin-order-management` | Admin order lookup by ticket code or customer; refund a single order, voiding its tickets and freeing its seats | `005`, `007` |

A change to the shared surface (`.specify/memory/constitution.md`, `contracts/openapi.yaml`,
`backend/prisma/`, `packages/shared/`, `docker-compose.yml`, `.env.example`, and the root
`package.json`) needs approval from every team member in its pull request.

## Development Workflow and Quality Gates

1. **Spec, plan, implementation: three PRs.** Per Principle III.
2. **Contract before code.** Per Principle I, any API change is merged into
   `contracts/openapi.yaml` in the plan PR, before it is implemented.
3. **Tests precede implementation.** Per Principle VI.
4. **Green gate.** The full suite MUST pass before a pull request is merged. A failing test is
   never skipped to unblock a merge; it is fixed, or the change is withdrawn.
5. **Running-system gate.** Before an implementation PR is merged, the system MUST start from a
   fresh clone with `docker compose up --build`, seeding MUST succeed on the first run, and each
   front end MUST pass the sign-in, use, and sign-out smoke test.
6. **Documentation gate.** The root `README.md` MUST document the start command, the test
   command, every service URL, and the seeded credentials, and MUST be updated in the same PR
   that changes any of them.
7. **Review gate.** Reviews explicitly check API-only client access, contract conformance,
   Backend- and database-enforced rules, server-side token and role checks, test-first evidence,
   and feature-appropriate scope. Any deviation MUST be justified in the PR description, or the
   PR is rejected.

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

**Version**: 2.2.0 | **Ratified**: 2026-09-20 | **Last Amended**: 2026-10-03
