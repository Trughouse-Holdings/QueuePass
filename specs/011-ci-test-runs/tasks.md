---
description: "Task list for Test Runs on Every Pull Request"
---

# Tasks: Test Runs on Every Pull Request

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[quickstart.md](./quickstart.md). No data model and no contract change.

**Issue**: [#23](https://github.com/Trughouse-Holdings/QueuePass/issues/23). The implementation PR
says `fixes #23`.

**Tests**: **REQUIRED and written first** where there is something to assert (Constitution VI): the
workflow's shape and its match with the local command (research R13), and the coverage report
(R11). Write those test tasks and confirm they **fail** before the tasks below them. The workflow's
behaviour on GitHub is proven by the running-system tasks (T025, T026) with a green and a
deliberately failing pull request.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `011-ci-test-runs-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `011-ci-test-runs-spec`; rebase it onto `main` once that PR merges. A gap in the spec or plan is
  fixed there, not worked around in code.
- **Same steps, same order**: the workflow's `run` steps after `npm ci` are exactly the parts of the
  root `ci` script (R12). Change both together; T009's test enforces it.
- **The job is `test` in workflow `CI`**, and stays so: it becomes a required check (R18).
- **No thresholds**: no `coverageThreshold`, no `coverage.thresholds`, and the report script never
  fails on a percentage. The floor is `010`'s (Clarifications, R10, R11).
- **No path filters, no `pull_request_target`, no secrets, no write permission, no third-party
  actions** (R1, R2, R15).
- **No test is weakened or skipped to get green** (Green gate). The only change to an existing test
  is the seed's Keycloak tests calling `skip()` instead of returning (R16).
- **Do not reformat** `packages/shared/src/api-schema.ts`; it is generated and already excluded from
  Prettier.
- **Do not push, open pull requests, or change repository settings** without the user's go-ahead in
  the session (T025, T026, T030, T032).
- The root `package.json` and `.github/workflows/` are shared surface: the implementation PR needs
  every team member's approval.

## Phase 1: Setup

- [ ] T001 Cut `011-ci-test-runs-impl` (see Ground rules). In a **fresh clone** of it, run `npm ci`,
  then confirm research R5: `backend/node_modules/.prisma` and `node_modules/.prisma/client` hold no
  generated client (the install printed `@prisma/client needs a schema.prisma`). Run
  `npm run prisma:generate --workspace @queuepass/backend`, `npx prettier --check .`,
  `npm run lint`, `npm run build`, and `npm test` with Docker running: all pass (baseline). Record
  the baseline duration of `npm test` here.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the format check script and the coverage provider, before any story uses them.

- [ ] T002 Add `"format:check": "prettier --check ."` to the root `package.json` scripts, next to
  `format` (R8). Run it: passes.
- [ ] T003 Install the coverage provider at the root, pinned to the installed Vitest version exactly:
  check it with `npm ls vitest` (3.2.7 on 2026-10-24; every workspace must resolve the same one),
  then `npm install --save-dev --save-exact @vitest/coverage-v8@<that version>` from the root (R9).
  Confirm `package-lock.json` gains only the provider and its own dependencies, and `npm test`
  still passes.

**Checkpoint**: nothing measures coverage yet; the suite is unchanged.

---

## Phase 3: User Story 1 - Every Pull Request Gets a Pass or Fail on Its Own (Priority: P1) 🎯 MVP

**Goal**: the workflow exists, triggers correctly, has least privilege, and runs every check
(FR-001 to FR-004, FR-010 to FR-016).

**Independent Test**: T025: a throwaway pull request goes green, then red with a failing test.

### Tests for User Story 1 (write first, confirm they fail)

- [ ] T004 [US1] Create `scripts/test/ci-workflow.test.mjs` (`node:test`, `node:assert/strict`,
  `yaml`'s `parse`), reading `.github/workflows/ci.yml` relative to the repository root, with one
  test per rule from research R13:
  - `name` is `CI`; `on.pull_request.types` is exactly `['opened', 'synchronize', 'reopened']` and
    `on.pull_request` has no `paths`, `paths-ignore`, or `branches`; `on.push.branches` is exactly
    `['main']`; `on` has no other key (no `pull_request_target`, `workflow_dispatch`, `schedule`);
  - `permissions` deep-equals `{ contents: 'read' }`, and no job declares `permissions`;
  - `concurrency.group` is `ci-${{ github.event.pull_request.number || github.sha }}` and
    `cancel-in-progress` is `${{ github.event_name == 'pull_request' }}` (R14);
  - `jobs` has exactly one key, `test`, with `runs-on: ubuntu-24.04` and a numeric
    `timeout-minutes` of 30 (R17);
  - every `uses` starts with `actions/`; the checkout step has `persist-credentials: false`; the
    `actions/setup-node` step has `node-version-file: .nvmrc` and `cache: npm` (R2, R3);
  - every step that has a `run` also has a `name`; the first `run` step is exactly `npm ci`;
  - the raw file text contains neither `secrets.` nor `github.token` (R15).
- [ ] T005 [US1] Add `node --test "scripts/test/*.test.mjs"` to the **start** of the root `test`
  script, before `node scripts/check-boundary.mjs` (escape the quotes in JSON; research R13 explains
  why the glob, not the directory). Run `npm test`: T004's tests **fail** because the workflow file
  does not exist.

### Implementation for User Story 1

- [ ] T006 [US1] Create `.github/workflows/ci.yml` per research R1 to R4, R14, R15, R17: workflow
  `CI`; the triggers; top-level `permissions: contents: read` and `concurrency`; job `test`
  (`runs-on: ubuntu-24.04`, `timeout-minutes: 30`) with steps: `actions/checkout` (current major,
  `persist-credentials: false`); `actions/setup-node` (current major, `node-version-file: .nvmrc`,
  `cache: npm`); then named `run` steps: `Install dependencies` (`npm ci`), `Generate Prisma client`
  (`npm run prisma:generate --workspace @queuepass/backend`), `Check formatting`
  (`npm run format:check`), `Lint` (`npm run lint`), `Build` (`npm run build`), `Test`
  (`npm test`), `Report coverage` (`npm run coverage:report`). A comment at the top cites spec 011
  and says the steps must match the root `ci` script. Check the current major versions of the two
  actions on their GitHub pages and use those tags.
- [ ] T007 [US1] Run `npx prettier --write .github/workflows/ci.yml`, then `npm test`: T004's tests
  pass.
- [ ] T008 [US1] Report the seed's Keycloak tests as skipped (R16, FR-014): in
  `scripts/seed/test/seed-idempotence.test.ts`, change each `if (!available) return;` to take the
  test context's `skip` (`async ({ skip }) => { if (!available) skip(); … }`), keeping the
  `[skip] Keycloak not reachable` warning. With the stack **down**, `npm test --workspace
  @queuepass/seed` reports `2 skipped`, not `2 passed`; with the stack up (T027), they run and pass.

**Checkpoint**: the workflow exists and its shape is tested; `coverage:report` does not exist yet,
so the workflow's last step would fail until Phase 5.

---

## Phase 4: User Story 2 - The Same Checks Run Locally With One Command (Priority: P1)

**Goal**: `npm run ci` runs the workflow's steps in order, and a test catches any drift (FR-008,
FR-009).

**Independent Test**: `npm run ci` passes on a clean checkout and fails at the formatting step on an
unformatted file (quickstart Q1).

### Tests for User Story 2 (write first, confirm they fail)

- [ ] T009 [US2] Add a test to `scripts/test/ci-workflow.test.mjs`: read the root `package.json`,
  split `scripts.ci` on ` && `, and assert it deep-equals the `run` values of the workflow's steps
  after `npm ci`, in order. Also assert that every part is `npm run <name>` or `npm test` and that
  each named script exists in the root `package.json`, except the backend's `prisma:generate`, which
  must exist in `backend/package.json`. Run `npm test`: **fails** (no `ci` script).

### Implementation for User Story 2

- [ ] T010 [US2] Add the root script `"ci"` exactly as in research R12. Run `npm test`: T009
  passes. Reorder two parts of `ci` temporarily and confirm T009 fails naming the difference; undo.

**Checkpoint**: `npm run ci` runs every step up to `coverage:report`, which Phase 5 adds.

---

## Phase 5: User Story 3 - Each Workspace's Coverage Is Shown on Every Run (Priority: P2)

**Goal**: `npm test` measures line coverage for all six workspaces on their own source, and a
report prints and publishes the table without enforcing the floor (FR-005 to FR-007).

**Independent Test**: after `npm test`, `npm run coverage:report` prints six rows; a missing summary
fails it.

### Tests for User Story 3 (write first, confirm they fail)

- [ ] T011 [US3] Create `scripts/test/coverage-report.test.mjs` against the functions R11 names
  (export from `scripts/coverage-report.mjs`: `WORKSPACES`, the fixed list of the six workspace
  directories; `readSummaries(rootDir)` returning each workspace's `total.lines` or a "missing"
  marker; `formatTable(rows)` for the console; `formatMarkdown(rows)` for the step summary; and
  `run({ rootDir, stepSummaryPath })` returning the exit code). Use temporary directories with
  fixture `coverage/coverage-summary.json` files:
  - all six present at 85%: six rows with percentage and covered/total lines, no "below 80%", the
    note that the floor is not enforced until `010-test-coverage`, exit 0;
  - one at 79.9% and one at exactly 80%: only the first is marked below 80% (both sides of the
    boundary), exit 0;
  - one file missing, and one that is not valid JSON: each named as not measured, exit 1;
  - with `stepSummaryPath` set, the Markdown table is **appended** to that file (existing content
    kept); without it, nothing is written.
  Run `npm test`: **fails** (the module does not exist).

### Implementation for User Story 3

- [ ] T012 [US3] Create `scripts/coverage-report.mjs` per R11: the exported functions above, and a
  `main` that runs only when the file is executed directly (compare `import.meta.url` with
  `process.argv[1]` via `pathToFileURL`), calling `run` with the repository root and
  `process.env.GITHUB_STEP_SUMMARY`, and exiting with its code. Add the root script
  `"coverage:report": "node scripts/coverage-report.mjs"`. Run `npm test`: T011 passes.
- [ ] T013 [US3] Backend (R10): `backend/package.json` `test` becomes `jest --runInBand --coverage`;
  `backend/jest.config.ts` gains `coverageReporters: ['text-summary', 'json-summary']`, with a
  comment citing spec 011 R10. Keep `collectCoverageFrom` and `coverageDirectory`.
- [ ] T014 [P] [US3] The five Vitest workspaces (R10): in each of `packages/shared`, `admin-app`,
  `customer-app`, `booth-app`, and `scripts/seed`, the `test` script becomes
  `vitest run --coverage`, and `vitest.config.ts` gains under `test`:
  `coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'json-summary'] }`.
  In `packages/shared/vitest.config.ts`, add `exclude: ['src/api-schema.ts']` with the comment:
  generated from `contracts/openapi.yaml` by `npm run generate:api`; Constitution VI allows
  excluding generated code. No `thresholds`.
- [ ] T015 [US3] Run `npm test` then `npm run coverage:report`: every workspace prints its coverage
  summary, `coverage/coverage-summary.json` exists in all six, and the table lists all six. Confirm
  the Admin and Customer apps' numbers do not include `packages/shared/src` files (inspect
  `admin-app/coverage/coverage-summary.json` keys). Record the six line percentages here.

**Checkpoint**: `npm run ci` runs every step locally.

---

## Phase 6: User Story 4 - The Team Can Make the Check Required on `main` (Priority: P2)

**Goal**: one stable check name (FR-015) and documented steps to require it. The setting itself is
turned on after merge (T032).

- [ ] T016 [US4] Confirm T004 pins the workflow name `CI` and the single job `test`, and that
  quickstart Q5 names the check `test` as the job produces it. Nothing else to build.

---

## Phase 7: Polish and Cross-Cutting

- [ ] T017 [P] Update `README.md` (R20, Documentation gate): in "Run the tests", add `npm run ci`
  (what it runs in order; it is exactly what the pull request check runs; run `npm ci` first to
  match exactly; Docker must be running), one sentence that every pull request and every push to
  `main` runs the check **CI / test**, that each run's summary shows every workspace's line coverage,
  and that the 80% floor is enforced from `010`; add the `011` row to the Status table and update
  the "Features `010` and `011` are reserved" line so only `010` remains reserved.
- [ ] T018 Run `npx prettier --write` on every file changed (never `api-schema.ts`), then
  `npm run lint`.
- [ ] T019 On a clean working tree with Docker running, run `npm ci` and `npm run ci`: everything
  passes and the coverage table prints. Record the duration here.
- [ ] T020 Quickstart Q1's failing half: add an unformatted line, run `npm run ci`, confirm it
  stops at **Check formatting** naming the file; undo.
- [ ] T021 Confirm FR-018: compare the test counts per workspace with T001's baseline; they are
  equal, apart from the seed's two Keycloak tests now counted as skipped when the stack is down.
- [ ] T022 Confirm no secrets and least privilege by reading the final `ci.yml` once against R15
  (T004 asserts the rest).
- [ ] T023 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md, plan.md, and research.md. Fix the findings. One review is required; another
  round is optional. Record the review and any finding left open, with the reason, here and in the
  PR description.
- [ ] T024 Commit with citations (`Impl 011: … (T0NN, #23)`), each body naming the FRs and R
  decisions it rests on.

## Phase 8: Running-System Gate

- [ ] T025 With the user's go-ahead: push `011-ci-test-runs-impl`, then a throwaway branch from it,
  and open a **draft** pull request to `main` titled "Throwaway: CI check (do not merge)". Walk
  quickstart **Q2**: the check starts on its own, every step is green, the backend's output shows
  `[test] PostgreSQL ready with migrations applied`, the Summary page shows the six-workspace
  table. Record the run's URL and duration (SC-004: under 15 minutes).
- [ ] T026 On the same throwaway pull request, walk quickstart **Q3**: the canary test makes the
  check red at **Test**, naming the test, with an annotation on the file; `npm run ci` locally fails
  the same way (SC-003); two quick pushes leave the older run **cancelled** (FR-011); the formatting
  error is red at **Check formatting**; the fix is green. Record each run's URL and result here.
  Close the throwaway pull request unmerged and delete its branch.
- [ ] T027 Quickstart **Q6**: `docker compose up --build`, every service healthy, seed succeeds on
  the first run; sign in to, use, and sign out of each front end; with the stack up, the seed's
  Keycloak tests run and pass. Record the results here.
- [ ] T028 Report coverage in the PR description: paste the table from T025's run summary. The 80%
  floor is not yet blocking (Constitution VI, recorded deferral, closed by `010`).

## Phase 9: Pull Request and After Merge

- [ ] T029 Rebase onto `main` if the spec and plan PR has merged since T001 (Constitution III), and
  re-run T019.
- [ ] T030 With the user's go-ahead, open the implementation PR against `main` with `fixes #23` in
  its description, the independent review record (T023), the running-system results (T025 to
  T027), the coverage table (T028), and a note that the root `package.json` and
  `.github/workflows/ci.yml` are shared surface needing every team member's approval. Its own
  **CI / test** check must be green.
- [ ] T031 After merge: quickstart **Q4**, the run on `main` for the merge commit is green.
- [ ] T032 After T031, a repository admin, with the team's agreement, follows quickstart **Q5** to
  require the `test` check on `main`, and confirms a throwaway pull request with a failing test
  cannot be merged. Record who turned it on and when, in issue #23 or the PR.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** first: T004 → T005 (see it fail) → T006 → T007. T008 is independent of the
  others.
- **US2 (Phase 4)** after T006 (it compares against the workflow).
- **US3 (Phase 5)** after T003 (the provider); T011 → T012; T013 and T014 can go before or after
  T012.
- **US4 (Phase 6)** after US1.
- **Phases 7 to 9** in order, after every story.

## Parallel Opportunities

- Phase 3: T008 alongside T004 to T007.
- Phase 5: T013 and T014 (different files) alongside T011 and T012.
- Phase 7: T017 alongside T018 to T022.

## Implementation Strategy

1. **MVP**: Phases 1 to 3. The workflow runs every check on every pull request.
2. **Reproducible**: Phase 4 ties it to one local command.
3. **Visible coverage**: Phase 5 measures and reports all six workspaces.
4. **Ship**: Phases 6 to 9, with the green and red throwaway runs before the PR, and the required
   check turned on after merge.
