# Feature Specification: Test Coverage Floor

**Feature Branch**: `010-test-coverage-spec`

**Created**: 2026-10-30

**Status**: Draft

**Issue**: [#22](https://github.com/Trughouse-Holdings/QueuePass/issues/22) (tests and 80% coverage
for all existing features)

**Input**: User description: "010" (the roadmap entry `010-test-coverage`, already reserved). From the
issue: write tests for all existing features so each workspace reaches 80% line coverage on its own;
coverage is reported by `npm test`; only generated code may be excluded, each exclusion listed with
its reason; when this and `011` merge, the coverage floor starts blocking merges.

## Context

Constitution VI requires each of the six workspaces (`backend`, `admin-app`, `customer-app`,
`booth-app`, `packages/shared`, `scripts/seed`) to reach at least 80% line coverage on its own,
measured by `npm test` and checked in CI, with only generated code excluded. Its recorded deferral
says the floor becomes merge-blocking when `010` is merged.

`011` (merged) already measures each workspace's line coverage in `npm test` and prints a table in
CI, marking any workspace below 80% without failing. On `main` today (CI run of 2026-10-30):

| Workspace | Lines |
| --- | --- |
| `packages/shared` | 93.13% (1696 / 1821) |
| `backend` | 97.02% (2055 / 2118) |
| `admin-app` | 97.06% (3040 / 3132) |
| `customer-app` | 97.46% (1616 / 1658) |
| `booth-app` | 92.28% (550 / 596) |
| `scripts/seed` | **24.01% (61 / 254)**, below 80% |

So five workspaces already meet the floor. The seed is below it because its tests talk to a live
Keycloak and are skipped when none is running, as in CI (`011` research R16). This feature adds tests
the seed can run without Keycloak, then turns the floor on in every workspace.

## Clarifications

### Session 2026-10-30

Nate asked for this spec to be written unattended: each question below took the recommended answer,
recorded here so the team can overturn it in review of the spec PR.

- Q: The other five workspaces already exceed 80%. Does this feature add tests to them? → A: Only
  where a test is needed to keep them above the floor after the floor is on; the work is the seed.
  "Tests for every existing feature" is met: every feature has tests today (`011`), and this feature
  closes the one gap the floor shows.
- Q: How does the seed reach 80% in CI, where there is no Keycloak? → A: Unit tests against a fake
  Keycloak admin client that records calls and returns set answers, covering every path of the realm,
  role, user, and client provisioning and the start-up wait, including failures. The live tests stay
  and still run when Keycloak is up.
- Q: Lines only, or branches and functions too? → A: Lines only, as the constitution states. A higher
  or wider floor is a later decision.
- Q: Where is the floor enforced? → A: In each workspace's own test run, so `npm test` fails on a laptop
  exactly as in CI, naming the workspace, its coverage, and the floor; the CI table then says the
  floor is enforced.
- Q: Does the constitution change? → A: No. Its recorded deferral already ends when `010` merges; the
  roadmap row already describes this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Pull Request That Drops a Workspace Below 80% Is Blocked (Priority: P1)

A teammate adds a module to the Ticket Booth app with no tests, dropping it to 78%. `npm test` fails
on their laptop, naming `booth-app`, 78%, and the 80% floor; if they push anyway, the required `test`
check fails and the PR cannot merge.

**Why this priority**: The issue's purpose and the constitution's requirement.

**Independent Test**: On a throwaway branch, add an untested file to one workspace that drops it under
80%; `npm test` fails naming it; the PR's `test` check is red. Remove the file: green.

**Acceptance Scenarios**:

1. **Given** any workspace below 80% lines, **When** `npm test` runs, **Then** it fails, and the output
   names the workspace, its line coverage, and the 80% floor.
2. **Given** every workspace at or above 80%, **When** `npm test` runs, **Then** it passes and the
   coverage table says the floor is enforced.
3. **Given** a pull request, **When** CI runs, **Then** the same floor applies and a workspace below it
   makes the `test` check fail.

---

### User Story 2 - The Seed Is Tested Without Keycloak (Priority: P1)

The seed workspace reaches at least 80% line coverage in a run with no Keycloak, from tests that
check what the seed asks Keycloak to do: create the realm and roles once, create each test account
once with its role, create or converge each front-end client to its exact settings, and wait for
Keycloak to be ready, failing clearly when it never is.

**Why this priority**: It is the only workspace below the floor; without it, turning the floor on
would turn every PR red.

**Independent Test**: With no Keycloak running, `npm test --workspace @queuepass/seed`: at least 80%
lines, the live tests reported as skipped with their reason.

**Acceptance Scenarios**:

1. **Given** no Keycloak, **When** the seed's tests run, **Then** line coverage is at least 80% and every
   provisioning path (absent and present realm, roles, users, clients; drifted client settings; the
   wait succeeding, retrying, and timing out; the entry point's failure exit) is exercised.
2. **Given** Keycloak running, **When** the seed's tests run, **Then** the live tests run too and pass.

---

### User Story 3 - Exclusions Are Listed and Limited to Generated Code (Priority: P2)

A reviewer opens any workspace's coverage settings and sees every excluded file with the reason, and
every excluded file is generated.

**Acceptance Scenarios**:

1. **Given** the six coverage configurations, **When** read, **Then** the only excluded source is
   generated code (today `packages/shared/src/api-schema.ts`, generated from the contract), each with a
   comment giving the reason.
2. **Given** a test file or configuration file, **When** coverage is measured, **Then** it is not counted
   as source (only `src/` is measured, as today).

---

### Edge Cases

- **The time-zone runs** (`npm run test:tz`, `020`): they run the suites under other zones; the floor
  must not make them fail for a reason that is not coverage (decided in the plan).
- **A workspace exactly at 80.00%**: passes (the floor is "at least").
- **Flaky coverage**: line coverage is deterministic for a given test set; a change in coverage
  between runs is a defect to fix.
- **Spec `021` (open) also adds seed tests**: both features' tests are kept when the second merges.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each of the six workspaces MUST fail its own test run when its line coverage is below 80%.
- **FR-002**: `npm test` and the CI `test` check MUST therefore fail when any workspace is below 80%.
- **FR-003**: The failure MUST name the workspace, its line coverage, and the floor.
- **FR-004**: The coverage table printed after the tests MUST say the floor is enforced, and keep
  marking any workspace below it.
- **FR-005**: The seed workspace MUST reach at least 80% line coverage with no Keycloak available, from
  tests that check the requests the seed makes and how it handles Keycloak's answers and failures.
- **FR-006**: The seed's live tests MUST still run, and pass, when Keycloak is available.
- **FR-007**: The only code excluded from coverage MUST be generated code, each exclusion listed in the
  coverage configuration with its reason.
- **FR-008**: Coverage MUST be measured over each workspace's source only (`src/`), as today.
- **FR-009**: The comments that say "no thresholds until `010`" MUST be updated to describe the floor.

### Key Entities

- **Coverage floor**: 80% of lines, per workspace (Constitution VI).
- **Fake Keycloak admin client**: a test double of the methods the seed calls, recording requests and
  returning set answers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every workspace is at or above 80% lines in CI, the seed included, with no Keycloak.
- **SC-002**: A deliberate drop below 80% in any one workspace fails `npm test` and the PR's `test`
  check, naming the workspace.
- **SC-003**: Exactly one exclusion exists across the six configurations (the generated API types), with
  its reason.
- **SC-004**: The `test` check's duration stays within 2 minutes of today's.

## Assumptions

- The floor is line coverage at 80%, per workspace, as the constitution states; no branch or function
  floor.
- `011`'s coverage measurement and report are kept; this feature only turns the floor on.
- The constitution is not amended; its recorded deferral for the floor closes with this merge.
