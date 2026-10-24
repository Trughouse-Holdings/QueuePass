---
description: "Task list for Test Runs on Every Pull Request"
---

# Tasks: Test Runs on Every Pull Request

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[quickstart.md](./quickstart.md). No data model and no contract change.

**Issue**: [#23](https://github.com/Trughouse-Holdings/QueuePass/issues/23). The implementation PR
says `fixes #23`.

**Tests**: **REQUIRED and written first** where there is something to assert (Constitution VI): the
workflow's shape and its match with the local command (research R13), the backend's `pretest`
(R5), and the coverage report (R11). Write those test tasks and confirm they **fail** before the
tasks below them. The workflow's behaviour on GitHub is proven by the implementation PR's own green
run (T031) and one throwaway pull request with deliberately failing runs (T029, T033).

## Ground rules

- **Fresh session** (Constitution III): implement on branch `011-ci-test-runs-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `011-ci-test-runs-spec`; rebase it onto `main` once that PR merges. A gap in the spec or plan is
  fixed there, not worked around in code.
- **Same steps, same order**: the workflow's `run` steps after `npm ci` are exactly the parts of the
  root `ci` script (R12). Change both together; T012's test enforces it.
- **The job is `test` in workflow `CI`**, and stays so: it becomes a required check (R18).
- **No thresholds**: no `coverageThreshold`, no `coverage.thresholds`, and the report script never
  fails on a percentage. The floor is `010`'s (Clarifications, R10, R11).
- **No path filters, no `pull_request_target`, no secrets, no write permission, no third-party
  actions** (R1, R2, R15).
- **No test is weakened or skipped to get green** (Green gate). The only change to an existing test
  is the seed's Keycloak tests calling `skip()` instead of returning (R16).
- **Do not reformat** `packages/shared/src/api-schema.ts`; it is generated and already excluded from
  Prettier.
- **Do not push, open pull requests, comment on GitHub, or change repository settings** without the
  user's go-ahead in the session (T029, T031, T033, T034).
- **One throwaway pull request, at most**: branch `011-ci-throwaway`, titled and described as a
  throwaway for #23 that will be closed unmerged, no reviewers requested, linked from #23, used for
  the failing runs (T029) and the required-check test (T033), then closed unmerged with its branch
  deleted. The green run is the implementation PR's own (T031).
- The root `package.json` and `.github/workflows/` are shared surface: the implementation PR needs
  every team member's approval.

## Phase 1: Setup

- [x] T001 Cut `011-ci-test-runs-impl` (see Ground rules). In a **fresh clone** of it, with Docker
  running, run `npm ci`, then confirm research R5: the install printed `@prisma/client needs a
  schema.prisma`, `node_modules/.prisma/client` holds only Prisma's placeholder (importing
  `@prisma/client` throws "did not initialize yet"), and `npm test` fails in the backend for that
  reason (FR-019's starting point). Then run
  `npm run prisma:generate --workspace @queuepass/backend`, `npx prettier --check .`,
  `npm run lint`, `npm run build`, and `npm test`: all pass (baseline). Record the duration of
  `npm test` and each workspace's test count here.
  - **Result** (2026-10-24, `e73f5dd`, fresh local clone, Windows 11, Node 22.20, npm 10.9.3,
    Docker Desktop, Compose stack **up**): `npm ci` passed. It printed **no** Prisma warning: npm
    10 hides install-script output unless a script fails (`npm rebuild @prisma/client
    --foreground-scripts` shows only the script's banner too), so that half of R5 is not visible
    here; the rest holds. `node_modules/.prisma/client` held only the placeholder
    (`index.js`, `default.js`, `edge.js`, `wasm.js`, `index-browser.js` and their `.d.ts`), and
    `new PrismaClient()` threw "@prisma/client did not initialize yet. Please run "prisma
    generate"". `npm test` passed `packages/shared`, then failed in the backend: every suite
    failed to compile (`TS2305: Module '"@prisma/client"' has no exported member 'Location'`,
    `TS7006` implicit `any` on transaction callbacks). After generating, the format check, lint,
    and build passed, and `npm test` passed in **247 s** (4 min 7 s). Counts: shared 468 (20
    files), backend 740 (84 suites), admin-app 200 (24 files), customer-app 200 (19 files),
    booth-app 67 (4 files), seed 8 (2 files; the stack was up, so the four Keycloak tests ran):
    1,683 in all.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the format check script, the coverage provider, and lint ignoring coverage output,
before any story uses them.

- [x] T002 Add `"format:check": "prettier --check ."` to the root `package.json` scripts, next to
  `format` (R8). Run it: passes.
- [x] T003 Install the coverage provider at the root, pinned to the installed Vitest version
  exactly: check it with `npm ls vitest` (3.2.7 on 2026-10-24; every workspace must resolve the
  same one), then `npm install --save-dev --save-exact @vitest/coverage-v8@<that version>` from the
  root (R9). Confirm `package-lock.json` gains only the provider and its own dependencies, and
  `npm test` still passes.
  - **Result**: every workspace resolves `vitest@3.2.7`; `@vitest/coverage-v8@3.2.7` installed.
    The lock file gained the provider and 15 packages of its own (`@ampproject/remapping`,
    `ast-v8-to-istanbul`, `magicast`, and copies nested under the provider). npm 10.9.3 also
    added `"peer": true` to 78 existing entries (the optional `@esbuild/*`, `@rollup/rollup-*`,
    and `@napi-rs/lzma-linux-x64-gnu` platform packages), a metadata-only rewrite with no package
    or version change; those flags were removed so the diff is additions only (`npm ci` on the
    result: T011). `npm test` passed (the laptop's Prisma client was stale from 2026-10-17 and
    had to be regenerated first: the R5 problem on a laptop, which T011's `pretest` now fixes).
- [x] T004 In `eslint.config.mjs`, add `'**/coverage/'` to the ignores, next to `'coverage/'`, as
  `'**/dist/'` sits next to `'dist/'` (R10). Check: create `backend/coverage/lcov-report/x.js`
  containing `var unused = 1`, run `npm run lint`: passes (it failed before the change); delete the
  file.

**Checkpoint**: nothing measures coverage yet; the suite is unchanged.

---

## Phase 3: User Story 1 - Every Pull Request Gets a Pass or Fail on Its Own (Priority: P1) 🎯 MVP

**Goal**: the workflow exists, triggers correctly, has least privilege, and runs every check
(FR-001 to FR-004, FR-010 to FR-016), and a fresh clone's `npm test` works (FR-019).

**Independent Test**: T029 and T031: the implementation PR's check is green; the throwaway pull
request goes red with a failing test.

### Tests for User Story 1 (write first, confirm they fail)

- [x] T005 [US1] Create `scripts/test/ci-workflow.test.mjs` (`node:test`, `node:assert/strict`,
  `yaml`'s `parse`), reading `.github/workflows/ci.yml` relative to the repository root, with one
  test per rule from research R13:
  - `name` is `CI`; `on.pull_request.types` is exactly `['opened', 'synchronize', 'reopened']` and
    `on.pull_request` has no `paths`, `paths-ignore`, or `branches`; `on.push.branches` is exactly
    `['main']`; `on` has no other key (no `pull_request_target`, `workflow_dispatch`, `schedule`);
  - `permissions` deep-equals `{ contents: 'read' }`, and no job declares `permissions`;
  - `concurrency.group` is exactly
    `${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}` and
    `cancel-in-progress` is `${{ github.event_name == 'pull_request' }}` (R14);
  - `jobs` has exactly one key, `test`, with `runs-on: ubuntu-24.04` and a numeric
    `timeout-minutes` of 30 (R17);
  - every `uses` starts with `actions/`; the checkout step has `persist-credentials: false`; the
    `actions/setup-node` step has `node-version-file: .nvmrc` and `cache: npm` (R2, R3);
  - every step that has a `run` also has a `name`; the first `run` step is exactly `npm ci`;
  - the raw file text contains neither `secrets.` nor `github.token` (R15).
- [x] T006 [US1] Add `node --test "scripts/test/*.test.mjs"` to the **start** of the root `test`
  script, before `node scripts/check-boundary.mjs` (escape the quotes in JSON; research R13 explains
  why the glob, not the directory). Run `npm test`: T005's tests **fail** because the workflow file
  does not exist.
  - **Result**: 7 of 7 fail with `ENOENT` on `.github/workflows/ci.yml`; `npm test` stops there.
    The quoted glob works under npm's `cmd.exe` on Windows too (Node expands it).

### Implementation for User Story 1

- [x] T007 [US1] Create `.github/workflows/ci.yml` per research R1 to R4, R14, R15, R17: workflow
  `CI`; the triggers; top-level `permissions: contents: read` and `concurrency`; job `test`
  (`runs-on: ubuntu-24.04`, `timeout-minutes: 30`) with steps: `actions/checkout` (current major,
  `persist-credentials: false`); `actions/setup-node` (current major, `node-version-file: .nvmrc`,
  `cache: npm`); then named `run` steps: `Install dependencies` (`npm ci`), `Generate Prisma client`
  (`npm run prisma:generate --workspace @queuepass/backend`), `Check formatting`
  (`npm run format:check`), `Lint` (`npm run lint`), `Build` (`npm run build`), `Test`
  (`npm test`), `Report coverage` (`npm run coverage:report`). A comment at the top cites spec 011
  and says the steps must match the root `ci` script. Check the current major versions of the two
  actions on their GitHub pages and use those tags.
  - **Result**: on 2026-10-24 the latest releases are `actions/checkout` v7.0.1 and
    `actions/setup-node` v7.1.0, and both repositories have a `v7` tag; the workflow uses
    `@v7` for both.
- [x] T008 [US1] Run `npx prettier --write .github/workflows/ci.yml`, then `npm test`: T005's tests
  pass.
  - **Result**: Prettier left the file unchanged; 7 of 7 pass (the rest of `npm test` passed
    with T011's run).
- [ ] T009 [US1] Report the seed's Keycloak tests as skipped (R16, FR-014): in
  `scripts/seed/test/seed-idempotence.test.ts`, change each `if (!available) return;` to take the
  test context's `skip` (`async ({ skip }) => { if (!available) skip(); … }`), keeping the
  `[skip] Keycloak not reachable` warning. With the stack **down**, `npm test --workspace
  @queuepass/seed` reports `4 skipped`, not `4 passed` (the file has four Keycloak tests, not two:
  two idempotence tests and two drift tests); with the stack up (T028), they run and pass.

### The backend's `pretest` generates Prisma (FR-019, R5)

- [ ] T010 [US1] Test first: add a test to `scripts/test/ci-workflow.test.mjs` that reads
  `backend/package.json` and asserts `scripts.pretest` contains `prisma generate`. Run `npm test`:
  **fails**.
- [ ] T011 [US1] Change the backend's `pretest` to
  `npm run build --workspace @queuepass/shared && prisma generate`. Run `npm test`: T010 passes.
  In a fresh clone with Docker running, `npm ci` then `npm test` passes with **no** manual generate
  (FR-019). Record it here.

**Checkpoint**: the workflow exists and its shape is tested; `coverage:report` does not exist yet,
so the workflow's last step would fail until Phase 5.

---

## Phase 4: User Story 2 - The Same Checks Run Locally With One Command (Priority: P1)

**Goal**: `npm run ci` runs the workflow's steps in order, and a test catches any drift (FR-008,
FR-009).

**Independent Test**: `npm run ci` passes on a clean checkout and fails at the formatting step on an
unformatted file (quickstart Q1).

### Tests for User Story 2 (write first, confirm they fail)

- [ ] T012 [US2] Add a test to `scripts/test/ci-workflow.test.mjs`: read the root `package.json`,
  split `scripts.ci` on ` && `, and assert it deep-equals the `run` values of the workflow's steps
  after `npm ci`, in order. Run `npm test`: **fails** (no `ci` script). (That each part names an
  existing script is asserted in T014, once `coverage:report` exists.)

### Implementation for User Story 2

- [ ] T013 [US2] Add the root script `"ci"` exactly as in research R12. Run `npm test`: T012
  passes. Reorder two parts of `ci` temporarily and confirm T012 fails naming the difference; undo.

**Checkpoint**: `npm run ci` runs every step up to `coverage:report`, which Phase 5 adds.

---

## Phase 5: User Story 3 - Each Workspace's Coverage Is Shown on Every Run (Priority: P2)

**Goal**: `npm test` measures line coverage for all six workspaces on their own source, starting
from no old output, and a report prints and publishes the table without enforcing the floor
(FR-005 to FR-007).

**Independent Test**: after `npm test`, `npm run coverage:report` prints six rows; a missing,
stale, or zero-line summary fails it.

### Tests for User Story 3 (write first, confirm they fail)

- [ ] T014 [US3] Create `scripts/test/coverage-report.test.mjs` against the functions R11 names
  (export from `scripts/coverage-report.mjs`: `WORKSPACES`, the fixed list of the six workspace
  directories; `cleanCoverage(rootDir)`, deleting each workspace's `coverage/` folder;
  `readSummaries(rootDir)` returning each workspace's `total.lines` or a "not measured" marker;
  `formatTable(rows)` for the console; `formatMarkdown(rows)` for the step summary; and
  `run({ rootDir, stepSummaryPath })` returning the exit code). Use temporary directories with
  fixture `coverage/coverage-summary.json` files:
  - all six present at 85%: six rows with percentage and covered/total lines, no "below 80%", the
    note that the floor is not enforced until `010-test-coverage`, exit 0;
  - one at 79.9% and one at exactly 80%: only the first is marked below 80% (both sides of the
    boundary), exit 0;
  - one file missing, one that is not valid JSON, and one with `lines.total` 0 (and `pct` 100):
    each named as not measured, exit 1;
  - `cleanCoverage` removes every workspace's `coverage/` folder and does not fail when one is
    already absent;
  - with `stepSummaryPath` set, the Markdown table is **appended** to that file (existing content
    kept); without it, nothing is written.
  Also add to `scripts/test/ci-workflow.test.mjs`: every part of the root `ci` script is
  `npm test` or `npm run <name>` naming a script that exists in the root `package.json`, except
  the backend's `prisma:generate`, which must exist in `backend/package.json`; and the root `test`
  script starts with `node scripts/coverage-report.mjs --clean && ` (R11). Run `npm test`:
  **fails** (the module, `coverage:report`, and the clean do not exist).

### Implementation for User Story 3

- [ ] T015 [US3] Create `scripts/coverage-report.mjs` per R11: the exported functions above, and a
  `main` that runs only when the file is executed directly (compare `import.meta.url` with
  `process.argv[1]` via `pathToFileURL`). With `--clean`, `main` calls `cleanCoverage` and exits
  0; otherwise it calls `run` with the repository root and `process.env.GITHUB_STEP_SUMMARY` and
  exits with its code. Add the root script `"coverage:report": "node scripts/coverage-report.mjs"`,
  and put `node scripts/coverage-report.mjs --clean && ` at the very start of the root `test` script,
  before `node --test` (R11, R13). Run `npm test`: T014 passes.
- [ ] T016 [US3] Backend (R10): `backend/package.json` `test` becomes `jest --runInBand --coverage`;
  `backend/jest.config.ts` gains `coverageReporters: ['text-summary', 'json-summary']`, with a
  comment citing spec 011 R10. Keep `collectCoverageFrom` and `coverageDirectory`.
- [ ] T017 [P] [US3] The five Vitest workspaces (R10): in each of `packages/shared`, `admin-app`,
  `customer-app`, `booth-app`, and `scripts/seed`, the `test` script becomes
  `vitest run --coverage`, and `vitest.config.ts` gains under `test`:
  `coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'json-summary'] }`.
  In `packages/shared/vitest.config.ts`, add
  `exclude: [...coverageConfigDefaults.exclude, 'src/api-schema.ts']` (import
  `coverageConfigDefaults` from `vitest/config`) with the comment: generated from
  `contracts/openapi.yaml` by `npm run generate:api`; Constitution VI allows excluding generated
  code. No `thresholds`.
- [ ] T018 [US3] Run `npm test` then `npm run coverage:report`: every workspace prints its coverage
  summary, `coverage/coverage-summary.json` exists in all six, and the table lists all six. Confirm
  the Admin and Customer apps' numbers do not include `packages/shared/src` files (inspect
  `admin-app/coverage/coverage-summary.json` keys). Then remove `--coverage` from `booth-app`'s
  `test` script temporarily and run `npm test && npm run coverage:report`: the report fails naming
  `booth-app` (the clean removed the old file); undo. Record the six line percentages here.

**Checkpoint**: `npm run ci` runs every step locally.

---

## Phase 6: User Story 4 - The Team Can Make the Check Required on `main` (Priority: P2)

**Goal**: one stable check name (FR-015) and documented steps to require it. The setting itself is
turned on right after merge (T033).

- [ ] T019 [US4] Confirm T005 pins the workflow name `CI` and the single job `test`, and that
  quickstart Q5 names the check `test` from the `CI` workflow. Nothing else to build.

---

## Phase 7: Polish and Cross-Cutting

- [ ] T020 [P] Update `README.md` (R20, FR-017, Documentation gate): in "Run the tests", add
  `npm run ci` (what it runs, in order; it is exactly what the pull request check runs; run `npm ci`
  first to match exactly; Docker must be running; to reproduce a pull request's run, merge or
  rebase onto the latest `main` first and keep the Compose stack down), and that `npm test` alone
  now works on a fresh clone. Add a short "Reading a failed check" paragraph: open **Details** on
  **CI / test**; the failed step's name says which check failed; a Testcontainers "could not pull
  image" error in the Test step means **Re-run failed jobs**, not a code problem. Add one sentence
  that every pull request and every push to `main` runs the check, that each run's summary shows
  every workspace's line coverage, that `npm run coverage:report` is meant to follow the root
  `npm test` or `npm run ci` (R11), and that the 80% floor is enforced from `010`. Add the `011` row
  to the Status table, update the "Features `010` and `011` are reserved" line so only `010`
  remains reserved, and add `.github/workflows/` to the repository layout block.
- [ ] T021 Run `npx prettier --write` on every file changed (never `api-schema.ts`), then
  `npm run lint`.
- [ ] T022 On a clean working tree with Docker running and the Compose stack down, run `npm ci` and
  `npm run ci`: everything passes and the coverage table prints. Record the duration of
  `npm run ci` and of `npm test` alone here, and compare `npm test` with T001's baseline (the cost
  of measuring coverage); state both in the PR description.
- [ ] T023 Quickstart Q1's failing cases, one at a time, undoing each: an unformatted line stops at
  **Check formatting**; an unused variable stops at **Lint**; a type error in `booth-app/src`
  stops at **Build**; each names the file (SC-002's lint and type-error halves).
- [ ] T024 Confirm FR-018: compare the test counts per workspace with T001's baseline; they are
  equal, apart from the seed's four Keycloak tests now counted as skipped when the stack is down.
- [ ] T025 Confirm no secrets and least privilege by reading the final `ci.yml` once against R15
  (T005 asserts the rest).
- [ ] T026 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md, plan.md, and research.md. Fix the findings. One review is required; another
  round is optional. Record the review and any finding left open, with the reason, here and in the
  PR description.
- [ ] T027 Commit with citations (`Impl 011: … (T0NN, #23)`), each body naming the FRs and R
  decisions it rests on.

## Phase 8: Running-System Gate

- [ ] T028 Quickstart **Q6**: `docker compose up --build`, every service healthy, seed succeeds on
  the first run; sign in to, use, and sign out of each front end; with the stack up, the seed's
  Keycloak tests run and pass. Record the results here.
- [ ] T029 With the user's go-ahead: push `011-ci-test-runs-impl` and the throwaway branch
  `011-ci-throwaway` cut from it, open the one throwaway pull request (Ground rules: draft, the
  throwaway title and body, no reviewers, linked from #23 in a comment), and walk quickstart **Q3**:
  the canary test makes the check red at **Test**, naming the test, with an annotation on the file
  (record the SHA of the commit that added the canary, for T033);
  time from opening the failed check to naming the step and test (SC-006: under 2 minutes);
  `npm run ci` locally fails the same way (SC-003); two quick pushes leave the older run
  **cancelled** (FR-011); the formatting error is red at **Check formatting**. Leave the pull
  request open as a draft, with the canary, for T033. Record each run's URL and result here.

## Phase 9: Pull Request and After Merge

- [ ] T030 Rebase onto `main` if the spec and plan PR has merged since T001 (Constitution III), and
  re-run T022.
- [ ] T031 With the user's go-ahead, open the implementation PR against `main` with `fixes #23` in
  its description, the independent review record (T026), the running-system results (T028, T029),
  the timings (T022), and a note that the root `package.json`, `eslint.config.mjs`, and
  `.github/workflows/ci.yml` are shared surface needing every team member's approval (the root
  `package.json` and the workflow are listed in the constitution; `eslint.config.mjs` is noted for
  visibility). Its own **CI / test** check is the green run, quickstart **Q2**: every step green,
  the PostgreSQL line in the backend's output, the six-workspace table on the Summary page. Record
  its URL and duration (SC-004: under 15 minutes), and paste the coverage table into the
  description (the 80% floor is not yet blocking; Constitution VI, recorded deferral, closed by
  `010`).
- [ ] T032 Right after merge: quickstart **Q4**, the run on `main` for the merge commit is green.
- [ ] T033 Right after T032, the same day: a repository admin (Mahdi names who) follows quickstart
  **Q5** to require the `test` check on `main`, as the constitution's recorded deferral expects.
  Verify with the throwaway pull request from T029: rebuild its branch from `origin/main` and
  cherry-pick the canary commit recorded in T029 (Q5 step 1), force-push it, mark it **Ready for
  review** (no reviewers), confirm the red check blocks merging, remove the canary, confirm
  merging is allowed once green, and **do not merge**. Close it unmerged, delete
  `011-ci-throwaway`, and note on #23, with the user's go-ahead, who turned the setting on and
  when, and that the throwaway is closed.
- [ ] T034 After merge, with the user's go-ahead, bring the issue texts in line with constitution
  3.4.0: #23 says "Depends on: `010`" and that a workspace below 80% fails the check; #22 says the
  floor starts blocking "when this and 011 merge" and that "Coverage is reported by npm test".
  Update them (or comment) to say: `011` depends on `001`, reports coverage and fails on any failed
  check or test; `010` turns the 80% floor on in `npm test` and the CI run, building on `011`'s
  measurement.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** first: T005 → T006 (see it fail) → T007 → T008; T010 → T011. T009 is
  independent of the others.
- **US2 (Phase 4)** after T007 (it compares against the workflow).
- **US3 (Phase 5)** after T003 (the provider) and T013 (the `ci` script, checked by T014);
  T014 → T015; T016 and T017 can go before or after T015.
- **US4 (Phase 6)** after US1.
- **Phases 7 to 9** in order, after every story. T031 needs the spec and plan PR merged
  (Constitution III).

## Parallel Opportunities

- Phase 3: T009 alongside T005 to T008; T010 and T011 alongside them too (different files, but
  T010 edits the same test file as T005: write T005 first).
- Phase 5: T016 and T017 (different files) alongside T014 and T015.
- Phase 7: T020 alongside T021 to T025.

## Implementation Strategy

1. **MVP**: Phases 1 to 3. The workflow runs every check on every pull request, and a fresh clone's
   `npm test` works.
2. **Reproducible**: Phase 4 ties it to one local command.
3. **Visible coverage**: Phase 5 measures and reports all six workspaces, from this run only.
4. **Ship**: Phases 6 to 9: the failing throwaway runs before the PR, the PR's own green run, then
   the required check turned on right after merge, verified with the same throwaway, which is then
   closed.
