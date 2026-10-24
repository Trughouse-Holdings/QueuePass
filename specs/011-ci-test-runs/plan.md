# Implementation Plan: Test Runs on Every Pull Request

**Branch**: `011-ci-test-runs-spec` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#23](https://github.com/Trughouse-Holdings/QueuePass/issues/23)

**Input**: Feature specification from `specs/011-ci-test-runs/spec.md`

## Summary

- **Workflow**: `.github/workflows/ci.yml`, named `CI`, one job `test` on `ubuntu-24.04`, triggered
  by every pull request open, update, and reopen and every push to `main`, with no path filters
  (research R1, R2, R4).
- **Steps**: `npm ci` (cached npm downloads, R3), then the six parts of a new root `npm run ci`
  script, each its own named step: generate the Prisma client (R5), `format:check` (R8), `lint`,
  `build` (type-checks every workspace, R7), `npm test` (now with coverage), and `coverage:report`.
  A test fails if the workflow's steps and the `ci` script differ (R12, R13).
- **Backend tests**: unchanged; Testcontainers uses the runner's Docker (R6). A 30-minute job limit
  (R17).
- **Coverage**: every workspace's `test` script measures line coverage on its own `src/`, with
  `@vitest/coverage-v8` added for the five Vitest workspaces (R9, R10). A small script prints a
  per-workspace table and writes it to the run's summary; below 80% is marked, not failed, until
  `010` (R11).
- **Safety**: `contents: read` only, no secrets, superseded pull request runs cancelled, `main`
  runs never (R14, R15).
- **Honest skips**: the seed's Keycloak tests report as skipped instead of passed (R16).
- **Required check**: turned on by hand after merge, documented in the quickstart (R18).

No API, contract, database, or screen change. The constitution amendment 3.3.1 (roadmap rows `010`
and `011`, and the recorded deferral split by feature) lands in this spec and plan PR.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS (from `.nvmrc`); GitHub Actions
workflow YAML; Node ESM scripts (`.mjs`) for the coverage report and its tests.

**Primary Dependencies**: one new devDependency, `@vitest/coverage-v8` pinned to the installed
Vitest version (3.2.7), justified in research R9. GitHub's own `actions/checkout` and
`actions/setup-node`. Everything else exists: Jest 29, Vitest 3.2, Testcontainers 10, Prettier 3,
ESLint 9, `yaml` 2.

**Storage**: none. Coverage summaries are written to each workspace's ignored `coverage/` folder.

**Testing**: `node --test` for the workflow-shape test and the coverage report's tests (R13), run
first by `npm test`. The feature itself is proven on GitHub by a throwaway pull request with one
green run and one deliberately failing run ([quickstart.md](./quickstart.md)).

**Target Platform**: GitHub-hosted `ubuntu-24.04` runners (Docker preinstalled); laptops on
Windows, macOS, or Linux with Docker for `npm run ci`.

**Project Type**: repository tooling for the existing web application monorepo.

**Performance Goals**: a typical run under 15 minutes from push to result (SC-004); the run is
dominated by the backend's real-database tests.

**Constraints**: the local command and the check run the same steps in the same order (FR-008);
read-only token, no secrets (FR-012); coverage reported but not enforced until `010` (FR-007);
every existing test still passes (FR-018).

**Scale/Scope**: 1 new workflow; 3 new root scripts (`format:check`, `ci`, `coverage:report`) and 1
changed (`test`); 1 new script and 2 new test files under `scripts/`; 6 test scripts and 6 test
configs gain coverage settings; 1 seed test file changes `return` to `skip()`; README.

## Constitution Check

Evaluated against constitution **v3.3.1** (amended in this PR; see spec Context).

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | No API change. The boundary check and the contract-drift check now run on every pull request, so both are enforced, not just available. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, container, or variable. `docker compose up --build` is untouched; the build step (R7) catches type errors that would break it. |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #23; spec and plan on `011-ci-test-runs-spec`, reviewed by a second Claude session before the PR; implementation on `011-ci-test-runs-impl` in a fresh session, closing #23. Commits cite `011` and #23. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | No rule changes. The backend's real-database and concurrency tests run on every pull request (R6). |
| **V. Sign-In Everywhere** | PASS | **PASS** | No auth change. The authorization tests run in CI with in-memory test keys; no real credential or token is used (R15). |
| **VI. Test-First, Real Database** | PASS (deferral) | **PASS** | The suite runs in GitHub Actions on every pull request open and update (the bullet this feature exists for), with real PostgreSQL through Testcontainers. Coverage is measured by `npm test` for all six workspaces and reported in CI. The 80% floor stays a recorded deferral, now closed by `010` alone; the CI half closes with this feature. The workflow and the report script are tested first (R13). |
| **VII. Function Over Finish** | PASS | **PASS** | No screen changes. |
| **VIII. Staged Simplicity** | PASS | **PASS** | One job, GitHub's own actions, no outside service, no comment bot, no Keycloak in CI (R4, R11, R16). One devDependency, justified (R9). The floor's deferral is recorded in the constitution and the spec, naming `010`. |
| **Shared surface** | — | **Needs every member's approval** | `.github/workflows/`, the root `package.json` (implementation PR), and the constitution (this PR). |
| **Quality gates** | — | **PASS** | Green gate: from this feature on, "in CI" exists; the coverage half waits for `010` as recorded. Documentation gate: README updated with the test command (R20). Running-system gate: still run by hand on the implementation PR. |

## Project Structure

```text
specs/011-ci-test-runs/
├── spec.md, plan.md, research.md (R1–R20), quickstart.md (Q1–Q6), tasks.md
└── checklists/requirements.md
(no data-model.md and no contracts/: no entity, API, or schema change)

.specify/memory/constitution.md       # 3.3.1 (this PR): rows 010 and 011, the recorded deferral
README.md                             # version reference (this PR); test section (implementation)

.github/workflows/+ ci.yml            # the check (R1–R4, R14, R15, R17, R18)
~ package.json                        # + @vitest/coverage-v8; + format:check, ci, coverage:report;
                                      #   test gains node --test (R8–R13)
~ package-lock.json
scripts/
├── + coverage-report.mjs             # R11
└── test/
    ├── + ci-workflow.test.mjs        # R13
    └── + coverage-report.test.mjs    # R13
backend/~ package.json (test: --coverage), ~ jest.config.ts (coverageReporters)            # R10
admin-app/, customer-app/, booth-app/, scripts/seed/:
          ~ package.json (test: --coverage), ~ vitest.config.ts (coverage block)            # R10
packages/shared/~ package.json, ~ vitest.config.ts (coverage block, api-schema.ts excluded) # R10
scripts/seed/test/~ seed-idempotence.test.ts   # skip() instead of return (R16)
~ README.md                           # Run the tests, Status (R20)
```

**Structure Decision**: the workflow lives where GitHub requires it; root scripts sit next to the
existing `check-boundary.mjs` and `check-contract-drift.mjs`; each workspace's coverage settings
sit in the test configuration it already has. No new workspace.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A new devDependency, `@vitest/coverage-v8` | Five of six workspaces cannot measure coverage without it (FR-005, R9) | Reporting backend coverage only leaves five workspaces unreported, against the Clarifications decision; `010` would add the same package anyway. |
| One step per check plus a drift test, instead of one `npm run ci` step | A failed step's name tells the author which check failed (SC-006, R4) | A single step needs no drift test, but every failure looks the same until the log is read. |
| An explicit Prisma generate step | A fresh `npm ci` does not generate the client, so build and tests would fail on the runner (R5) | Install hooks run in the front-end images too, or rely on deprecated configuration. |
