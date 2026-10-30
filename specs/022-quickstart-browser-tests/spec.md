# Feature Specification: Quickstart Browser Tests

**Feature Branch**: `022-quickstart-browser-tests-spec`

**Created**: 2026-10-30

**Status**: Draft

**Issue**: [#93](https://github.com/Trughouse-Holdings/QueuePass/issues/93) (turn the quickstart
scenarios into browser tests that run in CI)

**Input**: User description: "022" (the roadmap entry reserved for #93 in Constitution 3.4.2). From
the issue: each feature's `quickstart.md` is walked by hand once, when the feature is finished, and
CI never runs it. The rules underneath have automated tests, but nothing automated checks the whole
journey (sign-in, app, Backend, what the screen shows), so a change that breaks the wiring between
the pieces can pass CI, and older features' quickstarts are never walked again.

## Context

Builds on `011` (the `test` check runs on every pull request and push to `main` and is required on
`main`) and on every feature's quickstart (`specs/NNN-*/quickstart.md`: numbered scenarios a person
walks against the running stack). The stack is started with `docker compose up --build`: PostgreSQL,
Keycloak with the seed's realm, clients, and test accounts, the Backend, and the three apps; the
README's demo data command fills the Admin pages.

This feature adds browser tests that walk the main journey of each built feature against that real
stack, started the same way, from clean data, on every pull request. Each test is named after the
scenario it walks, and every quickstart says which of its scenarios are automated and which stay
manual, and why.

## Clarifications

### Session 2026-10-30

Nate asked for this spec to be written unattended: each question below took the recommended answer,
recorded here so the team can overturn it in review of the spec PR.

- Q: Playwright, or something else? (issue open question 1) → A: **Playwright** (Chromium). It
  drives several browser contexts at once (two customers side by side, `015`), sets the browser's
  time zone per test (`020`), captures downloads (`019`), and runs headless in GitHub Actions.
- Q: Every pull request, or nightly plus before merging feature PRs? (open question 2) → A: **Every
  pull request and every push to `main`**, as its own check beside `test`, so it does not push
  `test` past its 30-minute limit. It becomes a **required** check on `main` once it has passed on
  `main` (FR-012), like `011`'s `test`.
- Q: Which features first, and is the target every automatable scenario or the main journey per
  feature? (open question 3) → A: **The main journey per built feature** (the list in the issue,
  FR-005), not every scenario. Every quickstart is still marked scenario by scenario (FR-007), so
  later work can automate more.
- Q: Should new features' quickstarts be written with their browser tests from now on? (open
  question 4) → A: **Yes**, by a constitution amendment: for every feature whose implementation PR opens after this
  feature's implementation has merged, a feature's
  implementation PR includes browser tests for its quickstart's main journey, and its quickstart
  marks each scenario automated or manual (FR-014).
- Q: The venue address service is an outside service on the internet. Does the browser-test stack
  call it? → A: **No**. The browser-test stack answers address checks from a small local stand-in
  with fixed answers, so a test never depends on an outside service being up (FR-010). The real
  service is unchanged everywhere else.
- Q: What about a hold running out (`015`, 5 minutes) and other waits measured in minutes? → A:
  They stay manual: a test that waits 5 real minutes per run costs more than it catches, and the
  Backend's clock cannot be moved from the browser. The expiry rule keeps its automated Backend
  tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Broken Journey Turns the Pull Request Red (Priority: P1)

A teammate changes the Customer app's sign-in wiring. Every unit and integration test still passes,
but customers can no longer reach **My tickets** after signing in. The pull request's browser-test
check fails, naming the scenario ("006 P1: a customer gets tickets in a tier") and showing a screenshot and a
trace of the step that broke. The teammate fixes it before merging.

**Why this priority**: This is the issue's purpose: catch broken wiring between the pieces that no
piece's own tests can see.

**Independent Test**: On a branch, break one step of a covered journey on purpose (for example,
point the Customer app at a wrong API path). Open a pull request: the browser-test check fails,
naming that scenario, with a screenshot and trace. Revert: it passes.

**Acceptance Scenarios**:

1. **Given** a pull request that breaks a covered journey, **When** CI runs, **Then** the browser-test
   check fails and its log names the scenario and step, with the screenshot and trace kept as run
   artifacts.
2. **Given** a pull request that breaks nothing, **When** CI runs, **Then** the browser-test check
   passes.
3. **Given** any pull request, **When** CI runs, **Then** the browser tests run against a stack
   started the way Compose starts it, from clean data, and the `test` check is unchanged.

---

### User Story 2 - The Main Journey of Every Built Feature Is Walked on Every Pull Request (Priority: P1)

The journeys the issue names are automated, each as a test named after its quickstart scenario:

- `001`: sign in to and out of each of the three apps.
- `002`/`003`: an admin creates a venue and an event; a customer finds the event.
- `006`/`007`: a customer gets tickets for an event without seats and for one with chosen seats,
  and sees them in **My tickets**.
- `015`: two customers side by side; one reserves seats and the other sees them become unavailable
  within 2 seconds.
- `016`: a customer at the per-customer limit is refused more tickets, with the reason.
- `017`: a gate agent admits a ticket by its typed code; a second try is refused as already used.
- `019`: a customer downloads the calendar file, and it holds the event's name, start, end, and
  venue.
- `020`: with the browser set to other time zones, event times still show in the venue's zone; a
  start time that does not exist in the venue's zone is refused.

**Why this priority**: These are the journeys that, broken, make QueuePass unusable for one of its
three kinds of user.

**Independent Test**: Run the browser tests locally with one command; each journey above has a test
whose name starts with its feature number and scenario label, and all pass.

**Acceptance Scenarios**:

1. **Given** the browser tests, **When** listed, **Then** each journey above has at least one test,
   named `NNN <label>: <what it walks>` after the quickstart scenario it covers.
2. **Given** a covered scenario, **When** its test runs, **Then** it acts only through the apps' pages
   as a person would (sign-in on Keycloak's page included), except for setting up data the scenario
   does not itself walk, which goes through the Backend's API as a signed-in user.
3. **Given** the two customers of `015`, **When** one reserves seats, **Then** the test checks the
   other's page shows them unavailable within 2 seconds, without a reload.

---

### User Story 3 - Each Quickstart Says What Is Automated (Priority: P2)

A teammate opening `specs/017-gate-check-in/quickstart.md` sees, for each scenario, whether a browser
test covers it (and its test name) or it stays manual, and why ("needs a camera", "printing").

**Why this priority**: The issue requires it; it tells a reviewer what CI proves and what still needs
a person.

**Independent Test**: Open every `specs/*/quickstart.md`; every scenario has a mark.

**Acceptance Scenarios**:

1. **Given** any quickstart, **When** read, **Then** each scenario is marked **Automated** (with the
   test's name) or **Manual** (with a reason).
2. **Given** a test named after a scenario, **When** its quickstart is read, **Then** that scenario is
   marked Automated with the same name, and no scenario marked Automated lacks a test (a check fails
   otherwise).

---

### User Story 4 - A Teammate Runs Them on a Laptop (Priority: P2)

Before pushing, a teammate runs the browser tests locally with one documented command. It starts a
separate stack from clean data, runs every test, shows a report, and removes that stack and its data
afterwards, leaving their own running stack's data alone.

**Why this priority**: A red check must be reproducible on a laptop, or it is guessed at.

**Independent Test**: With nothing else running on the stack's ports, run the documented command:
it passes and leaves no containers or volumes behind.

**Acceptance Scenarios**:

1. **Given** a laptop with Docker, **When** the documented command runs, **Then** the stack starts from
   clean data, the tests run, a report is written, and the stack and its data are removed.
2. **Given** the stack's ports already in use (the teammate's own stack is up), **When** the command
   runs, **Then** it stops before starting anything and says which ports are in use and how to free
   them, without touching the running stack.
3. **Given** one scenario name, **When** the teammate asks to run only it, **Then** only that test
   runs.

---

### Edge Cases

- **A flaky test**: fixed, never retried into green. No automatic retries (FR-011).
- **Two tests touching the same data**: each test creates its own venue, event, and tickets with
  unique names, so tests do not depend on each other or on order, and can run in parallel.
- **The 60-minute rule**: each test's events are at its own venue, so tests cannot collide on the
  scheduling rule.
- **A test at a real-time boundary** (`017`'s entry window opens 2 hours before the start): the test
  creates an event whose window is already open.
- **The address service**: answered by the local stand-in (FR-010).
- **A feature whose quickstart is all manual** (`011` CI, `012` theme): marked, with reasons; no test.
- **The stack fails to start**: the check fails with the failing service's log in the run's
  artifacts, not as a test failure.
- **A run killed midway, locally**: the next run removes the leftover stack and data before starting.
- **Spec `021` merges before this one**: its sign-in screens are walked by `001`'s sign-in tests,
  which read the screen's heading.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Browser tests MUST drive real browsers against the real stack: PostgreSQL, Keycloak
  with the seed's realm, clients, and test accounts, the Backend, and the three apps, each built and
  started as `docker compose up --build` builds and starts it.
- **FR-002**: Every run MUST start from clean data: a new stack with no data from earlier runs, seeded
  by the seed job, with the README's demo data loaded.
- **FR-003**: Each test MUST be named `NNN <label>: <description>` after the quickstart scenario it
  walks, using the scenario's own label in that quickstart (`S2`, `P1`, `V3`; older quickstarts use
  other letters); a test that walks parts of two scenarios names both.
- **FR-004**: Tests MUST act through the apps' pages as a person does, signing in on Keycloak's page
  with the seed's test accounts (`admin1`–`admin5`, `agent1`–`agent30`, `customer1`–`customer200`,
  password `test123`). Data a scenario does not itself walk MAY be set up through the Backend's API
  with the access token of a user signed in through the browser. No test may use any other credential,
  token, or bypass of sign-in or role checks.
- **FR-005**: The tests MUST cover at least the journeys of User Story 2 (`001`, `002`/`003`,
  `006`/`007`, `015`, `016`, `017`, `019`, `020`).
- **FR-006**: The `015` test MUST check that seats one customer reserves show as unavailable on a
  second customer's open page within 2 seconds, without a reload.
- **FR-007**: Every `specs/*/quickstart.md` MUST mark each scenario **Automated** (with its test's name)
  or **Manual** (with a reason), in one table per quickstart listing every scenario label. Camera scanning on a real phone, printing, screen reader passes,
  real-device layouts, timing goals measured with a person, and waits of minutes (a hold running out)
  stay manual.
- **FR-008**: An automated check MUST fail when a test's name has no matching Automated mark in its
  quickstart, or an Automated mark names a test that does not exist.
- **FR-009**: The browser tests MUST run in GitHub Actions on every pull request open, update, and
  reopen and every push to `main`, as a check separate from `test`, with a time limit, and MUST keep a
  failing test's screenshot, trace, and the stack's service logs as run artifacts.
- **FR-010**: In the browser-test stack only, venue address checks MUST be answered by a local
  stand-in with fixed answers for the addresses the tests use; the stack MUST NOT call any outside
  service. `docker-compose.yml` itself MUST keep the real address service.
- **FR-011**: Tests MUST NOT be retried automatically. Before this feature's implementation lands,
  every test MUST pass 3 times in a row locally and the full run MUST pass in CI; a flaky test is
  fixed, never retried into green.
- **FR-012**: The new check MUST become a required check on `main` once the implementation PR has
  merged and the check has passed on `main` (a repository admin turns it on, as `011`).
- **FR-013**: One documented command MUST run the browser tests locally: it refuses to start, naming
  the ports, if the stack's ports are in use; removes any leftover browser-test stack; starts a fresh
  one; runs the tests (all, or one by name); writes a report; and removes the stack and its data.
- **FR-014**: The constitution MUST require, for every feature whose implementation PR opens after this
  feature's implementation has merged, that a feature's implementation PR
  include browser tests for its quickstart's main journey, and that its quickstart mark each scenario
  Automated or Manual.
- **FR-015**: The `test` check and `npm test` MUST NOT run the browser tests or start any stack; the
  only addition to them is the check of FR-008, which reads files and takes seconds.

### Key Entities

- **Browser test**: one scenario's walk, named after it (FR-003), independent of every other test.
- **Scenario mark**: per quickstart scenario, Automated (test name) or Manual (reason) (FR-007).
- **Browser-test stack**: a throwaway copy of the Compose stack with clean data and the address
  stand-in (FR-002, FR-010).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deliberate break in any one covered journey turns the pull request's browser-test
  check red, naming the scenario; reverting it turns it green.
- **SC-002**: Every journey listed in User Story 2 has a named test: at least 10 tests over 10
  features.
- **SC-003**: The browser-test check finishes within 30 minutes on GitHub's standard runner,
  including building and starting the stack.
- **SC-004**: Every test passes 3 runs in a row locally and in CI before the implementation merges,
  with no retries.
- **SC-005**: 100% of quickstart scenarios across all `specs/*/quickstart.md` carry a mark, and the
  names check passes.
- **SC-006**: A teammate runs the full browser tests on a laptop with one command, and afterwards no
  browser-test container or volume remains.

## Assumptions

- Chromium only. Other browsers stay part of the manual walks.
- The stack's ports are the standard ones (5173–5175, 3000, 8080, 5432): the apps' sign-in clients
  allow only those exact addresses (Constitution: exact redirect URIs), so the browser-test stack
  cannot move to other ports, and a teammate's own stack must be stopped first (FR-013).
- GitHub's standard Linux runner has Docker Compose and network access to build the images.
- The browser tests are a new folder at the repository root with their own dependencies, not one of
  the six workspaces under the 80% coverage rule: they are tests, not code under test.
- Spec `010` (coverage) and this feature do not touch the same files.
