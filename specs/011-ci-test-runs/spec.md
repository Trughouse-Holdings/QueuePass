# Feature Specification: Test Runs on Every Pull Request

**Feature Branch**: `011-ci-test-runs-spec`

**Created**: 2026-10-24

**Status**: Draft

**Issue**: [#23](https://github.com/Trughouse-Holdings/QueuePass/issues/23)

**Input**: User description: "Tests run locally on the laptop and automatically in GitHub Actions on
every pull request open and update. The workflow runs the full suite (`npm test`) with coverage. A
failing test, or a workspace below 80% line coverage, fails the check. Backend tests use
Testcontainers, so the runner needs Docker."

## Context

Builds on every feature merged so far: their tests are the suite this feature runs. It needs no
change to the API, the database, or any screen.

Today the suite runs only when someone remembers to run `npm test` on their laptop. Nothing checks
a pull request on its own, so a pull request can be merged with a failing test, unformatted code,
a lint error, or a type error that breaks `docker compose up --build` on `main`. Front-end
coverage cannot be measured at all, so earlier features reported backend coverage only (for
example `016` task T033).

This feature adds an automatic check to every pull request and every commit on `main` that runs
the same checks a developer runs locally with one command, and reports each workspace's line
coverage.

The constitution already defers the 80% coverage floor and the merge-blocking CI run until `010`
and `011` are merged (Principle VI, recorded deferral). This feature is built **before** `010`
(Clarifications), so its pull request also amends the constitution, a MINOR (3.3.0 → 3.4.0,
because it changes when the CI run becomes merge-blocking):

- the `011` roadmap row no longer depends on `010`, and states that the floor fails the run once
  `010` is merged;
- the `010` row now builds on `011` and turns the floor on, since `011` brings the coverage
  measurement;
- the recorded deferral names which feature closes which half: the CI run blocks merges once
  `011` is merged and its check is required on `main` (turned on right after the merge), and the
  coverage floor once `010` is merged.

No control is weakened. The floor's deferral already exists; it is only split so the CI half
closes sooner. The constitution is shared surface, so every team member signs off on it in the
pull request.

## Clarifications

### Session 2026-10-24

- Q: Does the check fail below 80% coverage now, as the issue says, or later? → A: CI now, floor
  later. The check runs on every pull request open and update (and every push to `main`), runs the
  format and lint checks and the full suite, including the backend's real-database tests, and
  fails on any failing test or check from the day it is merged. Coverage is measured and reported
  in every run, but a workspace below 80% does not fail the run until `010-test-coverage` is
  merged; `010` turns the floor on. This matches the constitution's recorded deferral (decided by
  Mahdi, 2026-10-24).
- Q: The roadmap says `011` depends on `010`. Which is built first? → A: `011` is built before
  `010`. This spec's pull request amends the constitution so the `011` row no longer depends on
  `010` and says the floor is enforced once `010` merges (decided by Mahdi, 2026-10-24).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every Pull Request Gets a Pass or Fail on Its Own (Priority: P1)

A developer opens a pull request. Without doing anything else, the pull request shows a check that
runs the formatting check, the lint check, the build, and the full test suite, including the
backend's tests against a real database. When any of them fails, the check is red, and the
developer can open it and see which step failed and why. Each new push to the pull request runs
the check again, on the pull request's changes merged with the latest `main`; a run for an older
push that is still going is stopped, because only the latest push matters.

**Why this priority**: This is the feature. Without it, a failing test reaches `main` whenever
someone forgets to run the suite.

**Independent Test**: Open a throwaway pull request whose only change is a test that always fails,
and confirm the check turns red naming that test. Push a commit that removes it, and confirm the
check turns green and the earlier run, if still going, was stopped.

**Acceptance Scenarios**:

1. **Given** a pull request whose code passes every check, **When** it is opened, **Then** the
   check runs on its own and passes.
2. **Given** a pull request with a failing test in any workspace, **When** it is opened or updated,
   **Then** the check fails, and its output names the failing test.
3. **Given** a pull request with a file that is not formatted, a lint error, or a type error,
   **When** it is opened or updated, **Then** the check fails and its output names the file.
4. **Given** a pull request whose generated API types no longer match the contract, **When** it is
   opened or updated, **Then** the check fails, saying how to regenerate them.
5. **Given** a check still running for a pull request, **When** the author pushes again, **Then**
   the older run is cancelled and a new run starts for the latest push.
6. **Given** a pull request that is merged, **When** its commit lands on `main`, **Then** the check
   runs on `main` too, and is not cancelled by a later merge.
7. **Given** a draft pull request, or one that changes only documentation, **When** it is opened
   or updated, **Then** the check runs in full, the same as for any other pull request.

---

### User Story 2 - The Same Checks Run Locally With One Command (Priority: P1)

Before pushing, a developer runs one documented command on their laptop. It runs exactly the checks
the pull request check runs, in the same order, and passes or fails for the same reasons. The pull
request check runs on the branch merged with the latest `main`, so a developer whose branch is
behind `main` first merges or rebases onto it; then they never have to guess why the pull request
is red when their laptop was green.

**Why this priority**: A check that cannot be reproduced locally costs a push and a wait for every
attempt to fix it. The constitution requires the suite to run with one documented command on a
laptop as well as in CI.

**Independent Test**: On a laptop with Docker running, run the local command on a clean checkout
of `main` and confirm it passes; add an unformatted line and confirm it fails at the same step the
pull request check fails at.

**Acceptance Scenarios**:

1. **Given** a clean checkout with dependencies installed and Docker running, **When** the
   developer runs the local command, **Then** it runs the same steps as the pull request check, in
   the same order, and passes.
2. **Given** a change that fails the pull request check, **When** the developer runs the local
   command on their branch merged with the same `main`, with the Docker Compose stack down,
   **Then** it fails at the same step.
3. **Given** someone adds, removes, or reorders a step in either the local command or the pull
   request check but not the other, **When** the suite runs, **Then** a test fails naming the
   difference.

---

### User Story 3 - Each Workspace's Coverage Is Shown on Every Run (Priority: P2)

On every run that gets through the tests, the check shows a short table of line coverage for each
of the six workspaces (`backend`, `admin-app`, `customer-app`, `booth-app`, `packages/shared`,
`scripts/seed`), each measured on its own code, and marks the ones below 80%. A workspace below
80% does not fail the run yet; the table says the floor is not enforced until `010` is merged.

**Why this priority**: The constitution asks pull requests to report coverage until the floor is
enforced, and today only the backend can. The check (US1) is useful without it.

**Independent Test**: Open a pull request, open the finished run, and confirm the table lists all
six workspaces with a percentage each, that a workspace below 80% is marked, and that the run is
still green.

**Acceptance Scenarios**:

1. **Given** a run in which every test passes, **When** it finishes, **Then** its summary shows
   the line coverage of all six workspaces, each from its own code only.
2. **Given** a workspace below 80% line coverage, **When** the run finishes, **Then** that
   workspace is marked as below the floor, the summary says the floor is not enforced until `010`
   is merged, and the run passes.
3. **Given** a workspace whose coverage was not measured in this run (its result is missing, left
   over from an earlier run, or counts no lines at all because its measurement is misconfigured),
   **When** the run reaches the coverage step, **Then** the run fails, naming the workspace.
4. **Given** the local command (US2), **When** it finishes, **Then** it prints the same table.

---

### User Story 4 - The Team Can Make the Check Required on `main` (Priority: P2)

After this feature is merged, a team member with admin rights on the repository marks the check as
required for merging into `main`, following the quickstart. From then on, a pull request cannot be
merged while the check is red or has not run.

**Why this priority**: The constitution's Green gate already requires the suite to pass in CI
before a merge; making the check required is how the repository enforces it. It is a repository
setting, turned on by hand once, not part of the code.

**Independent Test**: With the setting on, open a pull request with a failing test and confirm the
merge button is blocked; fix it and confirm merging is allowed once the check is green.

**Acceptance Scenarios**:

1. **Given** the check has run at least once, **When** an admin follows the quickstart, **Then**
   they can find the check by one stable name and mark it required for `main`.
2. **Given** the setting is on, **When** a pull request's check is red or has not finished,
   **Then** the pull request cannot be merged.
3. **Given** the setting is on, **When** a pull request changes only documentation, **Then** the
   check still runs and reports, so the pull request is never stuck waiting for a check that
   never starts.

---

### Edge Cases

- **Container image download fails**: the backend tests download a PostgreSQL image. When the
  download fails or times out, the run fails (it never passes without the real-database tests),
  and the failed step's output shows the download error. The author re-runs the failed run from
  the pull request; the quickstart says how to tell this apart from a failing test.
- **A run hangs**: every run has a time limit. A run that reaches it fails instead of waiting
  forever.
- **Pull requests from forks**: the check runs the same way. It needs no secrets and gets no write
  access, so a fork's pull request is checked exactly like a branch in the repository. Whether a
  first-time contributor's run waits for a maintainer's approval is a repository setting,
  unchanged by this feature.
- **Draft pull requests**: checked like any other, so problems show up before review is
  requested.
- **The branch is behind `main`**: the pull request check runs on the branch merged with the latest
  `main`, so it can fail (for example, the contract changed on `main`) where the branch alone
  passes, or the reverse. That is intended: it catches two changes that break each other before
  either is merged. To reproduce it locally, merge or rebase onto `main` first.
- **A pull request with merge conflicts**: GitHub does not run the check until the conflicts are
  resolved; a required check then keeps it unmergeable, which is the safe direction.
- **The Docker Compose stack is up on the laptop**: the seed's Keycloak tests then run locally,
  but are skipped in the check, so they are the one expected difference between the two.
- **Documentation-only pull requests**: checked in full. Skipping them would leave a required
  check waiting forever (US4), and spec and plan pull requests often change files the suite reads,
  such as the API contract and the generated types checked against it.
- **Tests that need the full stack**: the seed's Keycloak tests need a running Keycloak, which the
  check does not start. They are reported as **skipped**, with a line saying why, never counted as
  passed. The seed itself is still proven on every implementation pull request by the
  running-system gate (`docker compose up --build`, seeding on the first run).
- **The seed's coverage**: measured without Keycloak, so `scripts/seed` reports low coverage in the
  check. This feature reports it; `010` decides how that workspace reaches 80%.
- **A pull request that changes the check itself**: the run uses the check as changed by that pull
  request, so a broken change to the check shows up on its own pull request. Changing the check is
  shared surface (every team member approves).
- **Dependencies out of step with the lock file**: the check installs exactly what the lock file
  says and fails when the two disagree.
- **Coverage below 80% before `010`**: reported, marked, and does not fail the run (Clarifications).
- **A failing test in one workspace**: the run fails at the test step; later workspaces' tests do
  not run in that run, the same as locally. The coverage table appears only on runs whose tests all
  pass.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The check MUST run automatically whenever a pull request is opened, reopened, or
  updated with new commits, for every pull request, including drafts, pull requests from forks,
  and pull requests that change only documentation. It checks the pull request's changes merged
  with the latest `main`. (GitHub does not run it while a pull request has merge conflicts, or
  before a maintainer approves a first-time fork contributor's run, where that setting is on.)
- **FR-002**: The check MUST also run on every commit pushed to `main`.
- **FR-003**: The check MUST run, in this order: install the exact locked dependencies, the
  formatting check, the lint check, the build of every workspace (which type-checks the code the
  containers build), and the
  full test suite, which includes the front-end database-access boundary check, the generated API
  types drift check, and every workspace's tests, the backend's against a real PostgreSQL.
- **FR-004**: The check MUST fail when any step in FR-003 fails, including a failure to install,
  to download a container image, or to start the test database. A step that fails MUST NOT be
  reported as passed.
- **FR-005**: The check MUST measure line coverage for each of the six workspaces, each on its own
  source code only. Only generated code may be excluded, and each exclusion MUST be listed in that
  workspace's coverage configuration with its reason (Constitution VI).
- **FR-006**: On every run whose tests pass, the check MUST show, in the run's summary, each
  workspace's line coverage, marking each workspace below 80%.
- **FR-007**: Until `010-test-coverage` is merged, a workspace below 80% MUST NOT fail the run, and
  the summary MUST say that the floor is not yet enforced. A workspace with no coverage result from
  this run, or a result that counts no lines, MUST fail the run, naming the workspace.
- **FR-008**: One documented local command MUST run the same steps as FR-003 (after installation)
  and FR-006, in the same order, with the same pass or fail outcome on the same code (the branch
  merged with the same `main`), apart from tests that need the Docker Compose stack when it is up
  locally (FR-014).
- **FR-009**: An automated test MUST fail when the local command's steps and the check's steps
  differ in content or order.
- **FR-010**: The check MUST use the Node.js version pinned in the repository (`.nvmrc`), the same
  one the laptop and the containers use.
- **FR-011**: When a pull request is updated while its check is running, the older run MUST be
  cancelled. Runs on `main` MUST NOT be cancelled by later commits.
- **FR-012**: The check MUST have read-only access to the repository and MUST use no secrets. It
  MUST make no writes through GitHub's API or to any other system: its only output is the check run
  itself (its log, its summary, and the annotations the test runners add to it).
- **FR-013**: Every run MUST have a time limit, after which it fails.
- **FR-014**: Tests that cannot run in the check (the seed's Keycloak tests) MUST be reported as
  skipped, with the reason in the output, and MUST NOT be reported as passed.
- **FR-015**: The check MUST report under one stable name, so it can be marked required for `main`.
- **FR-016**: The check MUST NOT deploy, publish, or release anything.
- **FR-017**: The repository's README MUST document the local command, what the check runs, and
  where to read a failure; the quickstart MUST document how an admin marks the check required.
- **FR-019**: On a fresh clone, the documented `npm install` then `npm test` MUST work with no other
  setup step, apart from Docker running.
- **FR-018**: Every existing test MUST keep passing unchanged, apart from the seed's Keycloak tests
  reporting themselves as skipped (FR-014).

### Key Entities

- **Check run**: one execution of the check for one commit of a pull request or of `main`. It has
  an outcome (passed, failed, cancelled), the step that failed if any, and a coverage summary.
- **Workspace coverage**: for one workspace in one run, the share of its own source lines that the
  tests executed, and whether that is below 80%.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of pull requests opened or updated after this feature is merged get a check
  result without anyone starting it by hand, except while GitHub holds the run (merge conflicts, or
  a first-time fork contributor awaiting approval).
- **SC-002**: A change that adds one failing test, one unformatted file, one lint error, or one type
  error fails the check every time, and the failed step's output names the test or file (the failing
  test and the formatting error proven on a pull request, the lint and type errors with the local
  command).
- **SC-003**: The local command and the check give the same outcome on the same code, in every case
  tried in the quickstart (one passing, one failing test, one formatting error).
- **SC-004**: A typical check run, from push to result, finishes in under 15 minutes.
- **SC-005**: Every passing run shows the line coverage of all six workspaces.
- **SC-006**: A developer can tell which step failed, and why, within 2 minutes of opening a
  failed check (timed on the deliberately failing pull request).

## Assumptions

- The check runs on GitHub-hosted Linux runners, which come with Docker, so the backend's
  real-database tests run there exactly as on a laptop.
- The seed's Keycloak tests stay skipped in the check. Starting Keycloak and seeding 235 users
  would add minutes to every run for tests that the running-system gate already covers on every
  implementation pull request.
- Making the check required on `main` is a repository setting a team member with admin rights turns
  on by hand right after this feature is merged, following the quickstart. It is not automated.
- The 80% floor, its failing behaviour, and the tests that bring each workspace up to it are
  `010`'s work. `010` builds on the coverage measurement this feature adds.
- Pull requests target `main`, as the constitution's two-PR flow requires; the check runs for a
  pull request to any branch anyway.

## Out of Scope

- Deploying, publishing images, or releasing anything.
- Failing a run for coverage below 80% (`010`).
- Writing tests to raise coverage (`010`).
- Running Keycloak, the full Docker Compose stack, or browser tests in the check; the
  running-system gate stays a manual step on each implementation pull request.
- Posting comments on pull requests, coverage badges, or uploading coverage to an outside service.
- Automating repository settings such as required checks or branch protection.
- Scheduled or manually started runs, and checks for other branches' pushes.
