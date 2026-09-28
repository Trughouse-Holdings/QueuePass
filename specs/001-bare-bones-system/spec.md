# Feature Specification: Bare-Bones QueuePass System

**Feature Branch**: `001-bare-bones-system`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "A bare-bones implementation of the whole system: postgres,
keycloak, back-end app, admin app, customer app, ticket booth app. The 3 front-end apps can be
small stubs, basically no functionality. But the whole system should come up (via docker compose)
and serve up a login page and once logged in, a 'hello world' kind of web page for each of the
front ends. Also have a logout button. The front-end apps can only communicate through
OpenAPI-style REST APIs to the back-end app. Authentication, JWT validation, Keycloak, and login
must be fully implemented."

## Context

This is the first feature under constitution v2.0.0. It stands up all six services and makes
sign-in real from day one: the identity provider issues tokens, every front end requires sign-in,
and the Backend refuses any request that does not carry a valid token with the right role.
Features `002` (Admin venues and events) and `003` (Customer venues and events) build on it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bring Up the Whole System with One Command (Priority: P1)

A team member, reviewer, or grader clones the repository on a machine that has never run
QueuePass. They issue the one documented start command and end up with all six parts running:
the database, the identity provider, the Backend, the Admin app, the Customer app, and the Ticket
Booth app. The identity directory already holds every test account and the sign-in configuration
each front end needs. Stopping and restarting the system loses nothing.

**Why this priority**: Nothing else can be demonstrated, reviewed, or tested until the system
reliably comes up. Every other story is verified through this one.

**Independent Test**: From a clean clone with no containers or stored data, run the documented
start command. Confirm every service reports healthy and every front end's URL answers. Restart
the system and confirm the identity directory and database contents are unchanged.

**Acceptance Scenarios**:

1. **Given** a clean checkout with no containers or stored data, **When** the operator runs the
   documented start command, **Then** all six services start and become reachable with no manual
   steps.
2. **Given** a freshly started system, **When** the operator inspects the identity directory,
   **Then** 5 admin, 30 gate agent, and 200 customer accounts exist with the documented usernames,
   the documented development password, and the matching role.
3. **Given** a freshly started system, **When** the operator inspects the identity directory,
   **Then** one sign-in client exists for each front end, configured for that front end's address
   only.
4. **Given** an already-seeded system, **When** seeding runs again, **Then** it succeeds and the
   totals remain 5 / 30 / 200, with no duplicate accounts or clients.
5. **Given** a running system, **When** the operator stops and restarts every service, **Then**
   all stored data and every account are still present.
6. **Given** a running system, **When** the operator reads the project README, **Then** it gives
   the start command, the test command, every service's URL, and the seeded credentials.

---

### User Story 2 - Sign In to and Out of Each Front End (Priority: P2)

A person opens any of the three front ends and is sent to the identity provider's login page.
They sign in with their seeded account and land on that app's hello-world page, which names the
app and greets them by username. The greeting comes from the Backend, proving the app reached the
Backend with the user's own token. A logout button signs them out completely: reopening the app
sends them back to the login page. A person whose account lacks the role an app requires is told
so plainly and sees nothing else.

| Front end | Required role | Example account |
|---|---|---|
| Admin app | QueuePass Admin | `admin1` |
| Customer app | Customer | `customer1` |
| Ticket Booth app | Gate Agent | `agent1` |

**Why this priority**: Sign-in is the one capability all three front ends share. Building it
first means features `002` and `003` never have to retrofit it.

**Independent Test**: For each front end, open it while signed out and confirm the login page
appears. Sign in with the matching example account and confirm the hello-world page greets that
user. Click logout, reopen the app, and confirm the login page appears again. Then sign in to the
Admin app as `customer1` and confirm access is refused.

**Acceptance Scenarios**:

1. **Given** a visitor who is not signed in, **When** they open any page of any front end,
   **Then** they are sent to the login page and shown no application content.
2. **Given** the login page, **When** a user enters valid credentials for an account with the
   app's required role, **Then** they return to the app's hello-world page, which shows the app's
   name and their username.
3. **Given** the login page, **When** a user enters a wrong password, **Then** they stay on the
   login page with an error and are not signed in.
4. **Given** a signed-in user, **When** they click logout, **Then** they are signed out of the
   app and of the identity provider, and reopening the app shows the login page, not the
   hello-world page.
5. **Given** a signed-in user, **When** they use the browser's back button after logging out,
   **Then** no signed-in content is shown.
6. **Given** a user who signs in successfully but lacks the app's required role (for example
   `customer1` at the Admin app), **When** they arrive, **Then** they see a plain message that
   their account cannot use this app, see no other content, and are offered logout.
7. **Given** a user signed in to one front end, **When** they open a different front end,
   **Then** that front end still applies its own role requirement.
8. **Given** a signed-in user whose session stays open past the access token's lifetime,
   **When** they keep using the app, **Then** the app renews the token silently while the
   identity-provider session is valid, and returns them to the login page once it is not.

---

### User Story 3 - The Backend Trusts Only Valid, Correctly Scoped Tokens (Priority: P3)

Every Backend endpoint except health refuses a request unless it carries a valid access token
issued by the QueuePass realm for the QueuePass API. Each endpoint that needs a role refuses a
caller who does not have it. This holds identically whether the request comes from a front end or
straight from a command-line tool.

**Why this priority**: A front end that requires sign-in in front of an API that trusts every
caller protects nothing. This story is what makes the sign-in of Story 2 meaningful.

**Independent Test**: With a command-line HTTP client, call the "who am I" endpoint with no
token, a token with a broken signature, an expired token, and a token issued for a different
audience, and confirm each is refused as unauthenticated. Call it with a valid token and confirm
the response names that user and their roles. Call each role-specific greeting endpoint with a
token lacking that role and confirm it is refused as unauthorized.

**Acceptance Scenarios**:

1. **Given** no token, **When** any endpoint other than health is called, **Then** the request is
   refused with an authentication error in the standard error shape.
2. **Given** a token that is expired, malformed, signed by an unknown key, issued by a different
   realm, or issued for a different audience, **When** any protected endpoint is called,
   **Then** it is refused with an authentication error.
3. **Given** a valid token, **When** the "who am I" endpoint is called, **Then** it returns the
   caller's username, subject identifier, and QueuePass roles, read from the token.
4. **Given** a valid token for a user with a given role, **When** that role's greeting endpoint
   is called, **Then** it returns a greeting naming the user and the app.
5. **Given** a valid token for a user without the required role, **When** a role-restricted
   endpoint is called, **Then** it is refused with an authorization error, not an authentication
   error.
6. **Given** no token, **When** the health endpoint is called, **Then** it answers, so container
   health checks work.
7. **Given** a request from an origin other than the three front ends, **When** a browser makes
   it, **Then** the Backend does not grant it cross-origin access.

---

### Edge Cases

- **Identity provider not ready at startup**: The seed waits for it instead of failing, and the
  Backend does not report itself healthy in a way that lets the front ends start before sign-in
  can work.
- **Identity provider restarted while the Backend runs**: Token validation recovers once the
  identity provider's signing keys are reachable again, without restarting the Backend.
- **Signing key rotation**: A token signed by a key the Backend has not seen yet causes it to
  refresh the realm's published keys once, then validate; it does not refuse every such token
  forever.
- **Clock skew**: A token that is expired by a small, documented tolerance (at most 60 seconds)
  is still refused beyond that tolerance.
- **Addresses differ inside and outside containers**: The browser reaches the identity provider
  at one address and the Backend reaches it at another; tokens issued through the browser's
  address MUST still validate at the Backend.
- **Redirect tampering**: A sign-in attempt that asks to return to an address not registered for
  that front end is refused by the identity provider.
- **Backend unreachable from a signed-in front end**: The hello-world page shows a plain "cannot
  reach the service" message instead of a blank page or a partial greeting.
- **Page reload while signed in**: Reloading keeps the user signed in (by renewing from the
  identity-provider session), without the front end ever storing a token in browser storage.
- **Account with more than one role**: Each front end checks only for its own required role.
- **Re-running the seed**: Changes nothing and does not fail.

## Requirements *(mandatory)*

### Functional Requirements

#### System and Environment

- **FR-001**: The system MUST start all six services (the database, the identity provider, the
  Backend, the Admin app, the Customer app, and the Ticket Booth app) plus the seeding job from
  one documented command run against a clean checkout, with no manual configuration steps.
- **FR-002**: Every service MUST report its health, and services MUST start only after the
  services they depend on report healthy.
- **FR-003**: The system MUST keep all stored data and all identities across a full stop and
  restart of every service.
- **FR-004**: The seeding job MUST create exactly 5 admin accounts (`admin1`–`admin5`), 30 gate
  agent accounts (`agent1`–`agent30`), and 200 customer accounts (`customer1`–`customer200`), all
  with the documented development password and the matching role.
- **FR-005**: The seeding job MUST create one sign-in client per front end, each restricted to
  that front end's exact return address and origin, allowing only the browser sign-in flow with
  proof-key protection and no direct password grant.
- **FR-006**: The seeding job MUST configure the realm so access tokens issued to the three
  front-end clients name the QueuePass API as their audience and carry the user's QueuePass
  roles.
- **FR-007**: Seeding MUST be idempotent and deterministic. Rerunning it against a seeded
  directory succeeds and changes nothing.
- **FR-008**: The README MUST document the start command, the test command, each service's URL,
  and the seeded credentials, and MUST be updated whenever any of them changes.

#### Front-End Sign-In and Sign-Out (all three front ends)

- **FR-009**: Each front end MUST send any visitor who is not signed in to the identity
  provider's login page before showing any content.
- **FR-010**: No front end may accept, handle, or store a user's password; credentials are
  entered only on the identity provider's page.
- **FR-011**: Front ends MUST keep tokens in memory only and MUST NOT write them to any
  persistent browser storage.
- **FR-012**: Each front end MUST send the signed-in user's access token with every Backend
  request.
- **FR-013**: Each front end MUST renew the access token before it expires while the
  identity-provider session is valid, and MUST return the user to the login page when renewal is
  no longer possible.
- **FR-014**: After sign-in, each front end MUST show a hello-world page that displays the app's
  name and the signed-in user's username, where the greeting is obtained from the Backend using
  the user's own token.
- **FR-015**: Each front end MUST show a logout control on every signed-in page. Logging out MUST
  discard the front end's tokens and end the identity provider's session.
- **FR-016**: The Admin app MUST require the QueuePass Admin role, the Customer app the Customer
  role, and the Ticket Booth app the Gate Agent role. A signed-in user without the required role
  MUST see only a plain explanation and a logout control.
- **FR-017**: A front end that cannot reach the Backend MUST say so plainly instead of showing a
  blank or partial page.

#### Backend Authentication and Authorization

- **FR-018**: The Backend MUST refuse any request without a valid access token, on every endpoint
  except health, with an authentication error (`401`).
- **FR-019**: A valid access token is one whose signature verifies against the realm's published
  signing keys, whose issuer is the QueuePass realm, whose audience includes the QueuePass API,
  and which is not expired beyond a clock-skew tolerance of at most 60 seconds.
- **FR-020**: The Backend MUST read the caller's identity and roles only from the validated
  token, never from any other request field.
- **FR-021**: The Backend MUST refuse a validly authenticated caller who lacks an endpoint's
  required role with an authorization error (`403`), distinct from an authentication error.
- **FR-022**: The Backend MUST provide a "who am I" endpoint, open to any signed-in user, that
  returns the caller's username, subject identifier, and QueuePass roles.
- **FR-023**: The Backend MUST provide one greeting endpoint per front end, each restricted to
  that front end's required role, which the hello-world pages call.
- **FR-024**: The Backend MUST allow cross-origin browser requests only from the three front-end
  origins.
- **FR-025**: The Backend MUST NOT store passwords or user profiles. It MAY store the subject
  identifier where a later feature needs to attribute an action.
- **FR-026**: Any test-only way to bypass token validation MUST be off by default and MUST NOT be
  enabled in the start configuration.

#### API Contract and Architecture

- **FR-027**: Every Backend endpoint MUST be declared in the shared API contract document with
  its request shape, response shape, required role, security scheme, and every error it can
  return, and the Backend MUST publish that document for browsing.
- **FR-028**: Every error response MUST use one shape: a stable machine-readable code, a
  human-readable message, and structured details where relevant.
- **FR-029**: All three front ends MUST reach data only through the Backend API. None may connect
  to the database or contain database access code.

#### Quality

- **FR-030**: Automated tests MUST cover, at the Backend, each refused-token case (missing,
  expired, malformed, unknown key, wrong issuer, wrong audience), the wrong-role case, and the
  valid case for every endpoint, using tokens signed by a real key set.
- **FR-031**: Automated tests MUST verify that Backend responses match the API contract.
- **FR-032**: Automated tests MUST cover each front end's signed-out redirect, hello-world
  rendering, wrong-role refusal, and logout.
- **FR-033**: An automated check MUST fail if any front end contains database access code or a
  database driver.
- **FR-034**: Automated tests MUST verify the seed creates the documented accounts, roles, and
  clients, and is idempotent.
- **FR-035**: The full test suite MUST run with one documented command.

### Key Entities

- **User (external)**: A person held in the identity provider, not in the QueuePass database.
  QueuePass sees only their username, subject identifier, and roles, as asserted by a validated
  token on each request.
- **Role**: QueuePass Admin (5 seeded), Gate Agent (30 seeded), or Customer (200 seeded). Each
  front end admits exactly one role.
- **Sign-in client**: The identity provider's registration of one front end: its exact return
  address, its allowed origin, and the flows it may use.
- **Access token**: A short-lived, signed statement from the identity provider naming the user,
  their roles, the issuing realm, the intended audience, and an expiry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Someone new to the project goes from a clean clone to all six services running and
  seeded in under 15 minutes, using only the README and exactly one start command.
- **SC-002**: All 235 test identities exist and can sign in after first startup, and the count is
  still exactly 235 after seeding runs again.
- **SC-003**: For each of the three front ends, a user goes from opening the app, through sign-in,
  to the hello-world page, and back out via logout in under 1 minute.
- **SC-004**: 100% of visits to any front-end page while signed out reach the login page, and none
  shows application content.
- **SC-005**: 100% of attempts to use a front end with the wrong role are refused with a readable
  message.
- **SC-006**: 100% of Backend requests without a valid token, across every refused-token case, are
  refused; 100% of requests with a valid token and the right role are accepted.
- **SC-007**: After logout, 0 signed-in pages are reachable without signing in again, including
  through the browser's back button.
- **SC-008**: 0 tokens or passwords are found in any persistent browser storage after a full
  sign-in, use, and logout cycle.
- **SC-009**: Every Backend endpoint appears in the API contract, and 0 responses in the test
  suite deviate from it.
- **SC-010**: The full test suite passes from a clean checkout using the documented test command.

## Assumptions

- **Stubs are complete front ends**: Beyond sign-in, the hello-world page, and logout, the three
  front ends have no features in this spec. Venue and event screens arrive in `002` (Admin) and
  `003` (Customer).
- **One role per front end**: Each front end admits exactly one role. An admin who wants to see
  the Customer app signs in as a customer.
- **Single sign-on across front ends**: Because the three front ends share one identity provider,
  signing in to one may make signing in to another a single click. Logging out of any one ends
  the identity-provider session, which signs the user out of the others at their next token
  renewal.
- **Token lifetimes**: Access tokens are short-lived (5 minutes, the identity provider's
  default) and renewed silently. The identity-provider session length stays at its default.
- **Keycloak's own login page**: The login page is the identity provider's page with its default
  appearance. Custom login themes are visual design and out of scope (Constitution VII).
- **Development password**: `test123` is for local development only, as the constitution
  requires.
- **Existing code**: The current repository has an open API and an Admin app without sign-in.
  This spec, not that code, is authoritative; the implementation closes the gap.

## Out of Scope

- Venue and event API endpoints and screens (features `002` and `003`).
- Any Ticket Booth functionality beyond the stub.
- Self-service sign-up, password reset, multi-factor authentication, and account management
  screens.
- Social or external identity providers.
- Custom login-page themes, branding, and visual design.
- Deployment anywhere but a developer laptop, and TLS.
