# Implementation Plan: Quickstart Browser Tests

**Branch**: `022-quickstart-browser-tests-spec` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#93](https://github.com/Trughouse-Holdings/QueuePass/issues/93)

**Input**: Feature specification from `specs/022-quickstart-browser-tests/spec.md`

## Summary

- **Playwright Test, Chromium** (research R1), in `e2e/` at the repository root (not a workspace,
  so the coverage floor is unchanged), as a root devDependency.
- **`npm run e2e`** (R3): refuses if the stack's ports are busy; starts a throwaway Compose project
  `qpe2e` from clean data with `docker compose up --build --wait`, checks the seed, loads the demo
  data, runs the tests, keeps logs on failure, and removes the stack and its volumes.
- **A local address stand-in** (R4) in `e2e/stack/` answers venue address checks for the browser-test
  stack only; `docker-compose.yml` is unchanged.
- **Tests act like people** (R5, R6): sign in on Keycloak's page with seed accounts; set up data a
  scenario does not walk through the API with the token the app itself sent. Each test makes its own
  venue and events (R8), so tests are independent and run in parallel.
- **About a dozen journeys** (R9) over `001`, `002`/`003`, `006`, `007`, `015`, `016`, `017`, `019`,
  `020`, each named after its quickstart scenario.
- **Every quickstart gets an Automation table** (R10), checked against the test titles by a fast
  script in `npm test`.
- **CI**: a second job `e2e` (R11), required on `main` after it passes there (R12). No retries (R13).
- **Constitution 3.5.0** (R14): features whose implementation PR opens after this one merges ship browser tests for their main journey;
  Playwright joins the stack table. Renumbered to 3.6.0 if `021`'s spec PR merges first.
- **No API, database, or Keycloak change** (data-model.md, contracts/README.md).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS; the runner and checks are Node ESM
scripts like `scripts/check-contract-drift.mjs`.

**Primary Dependencies**: `@playwright/test` (new root devDependency, exact pin, R1); Docker Compose
v2 (existing). The address stand-in uses only Node's `http` module.

**Storage**: none. The browser-test stack's volumes are created and removed per run.

**Testing**: the browser tests themselves; `node --test` for `check-quickstart-marks.mjs` and the
runner's port check; the updated `scripts/test/ci-workflow.test.mjs`.

**Target Platform**: macOS laptops with Docker Desktop; GitHub Actions `ubuntu-24.04`.

**Project Type**: web application (tests over the whole stack).

**Performance Goals**: the `e2e` job under 30 minutes including image builds (SC-003); each test
under 60 seconds.

**Constraints**: standard ports only (exact redirect URIs); seed accounts only; no retries; no outside
service; `npm test` gains only the marks check.

**Scale/Scope**: about 12 tests in 8 files; every quickstart (19 today) gets a table.

## Constitution Check

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | Setup goes through the documented API; no contract change | Pass |
| II. One command | Uses `docker compose up --build` as-is; `npm run e2e` is one command | Pass |
| III. Spec-driven | Spec + plan PR, independent review, fresh implementer | Pass |
| IV. Server-authoritative | Tests observe rules through the UI; nothing changes them | Pass (n/a) |
| V. Sign-in everywhere | Real Keycloak sign-in with seed accounts; no bypass, no extra client (R5, R6) | Pass |
| VI. Test-first | Adds tests; the marks check is test-first (T004); the e2e tests are the checks | Pass |
| VII. Shared look | No UI change | Pass (n/a) |
| VIII. Simplicity | One browser, no image cache until measured, a 40-line stand-in, test-only override file not used by `docker-compose.yml` | Pass |
| Stack table | Adds Playwright; CI row names `e2e`. Amended in this PR (R14) | Pass after amendment |

## Project Structure

### Documentation (this feature)

```text
specs/022-quickstart-browser-tests/
├── spec.md, plan.md, research.md (R1–R15), data-model.md, quickstart.md (B1–B5)
├── contracts/README.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
e2e/                                  # NEW (R2)
├── playwright.config.ts, tsconfig.json
├── fixtures/{apps,sign-in,api,data}.ts
├── tests/001-sign-in.spec.ts, 003-venue-event.spec.ts, 006-007-tickets.spec.ts,
│   015-seat-holds.spec.ts, 016-ticket-limit.spec.ts, 017-check-in.spec.ts,
│   019-calendar.spec.ts, 020-time-zones.spec.ts
└── stack/docker-compose.e2e.yml, stack/geocoder-stub/{Dockerfile,server.mjs,addresses.json}
scripts/e2e.mjs                       # NEW (R3)
scripts/check-quickstart-marks.mjs    # NEW (R10)
scripts/test/check-quickstart-marks.test.mjs, scripts/test/e2e-ports.test.mjs   # NEW
scripts/test/ci-workflow.test.mjs     # two jobs (R11)
.github/workflows/ci.yml              # job e2e (R11)
package.json                          # devDependency, "e2e" script, marks check in "test"
.gitignore, .prettierignore, eslint.config.mjs   # e2e output folders; lint e2e/
specs/*/quickstart.md                 # Automation tables (R10)
.specify/memory/constitution.md       # 3.5.0 (R14) — this spec PR
README.md                             # how to run; 022 status row
```

**Structure Decision**: a root `e2e/` folder beside `scripts/`, because the tests span every
service and belong to no one workspace.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A test-only Compose override with an address stand-in | No outside service in a required check (FR-010) | The real Census service: flaky and rate-limited from CI |
| A second CI job | The `test` job's 30-minute limit (FR-009) | Steps in `test`: image builds would push it past the limit |
