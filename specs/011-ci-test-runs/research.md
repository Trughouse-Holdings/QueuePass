# Research: Test Runs on Every Pull Request

Decisions for [plan.md](./plan.md). Each has a decision, its rationale, and the alternatives
considered. Facts about the repository were checked on `main` at `bf569a1` on 2026-10-24.

## R1. Triggers: every pull request, every push to `main`, no path filters

**Decision**:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]
```

No `paths` or `paths-ignore`, no branch filter on `pull_request`, no condition on draft status.
`pull_request_target`, `workflow_dispatch`, and `schedule` are not used.

**Rationale**: `opened`, `synchronize` (new commits), and `reopened` are "every pull request open
and update" (FR-001); they are also GitHub's defaults, listed explicitly so the test in R13 can
assert them and a reader does not have to know the default. The push to `main` checks each merge
result (FR-002): two pull requests that pass on their own can still break each other once both are
merged.

For a pull request, GitHub checks out `refs/pull/N/merge`, the branch merged with the latest `main`,
not the branch head. That is kept: it catches a branch that passes alone but breaks against what
`main` gained since it was cut (for example a contract change). The cost is that reproducing a red
check locally means merging or rebasing onto `main` first; the README and quickstart say so.
GitHub does not run the workflow while a pull request has merge conflicts; a
required check then keeps it unmergeable until they are resolved.

- **Docs-only pull requests run in full.** A workflow skipped by a path filter never reports, and a
  required check (R18) that never reports leaves the pull request stuck at "Expected — Waiting for
  status to be reported". Spec and plan pull requests also change the contract and the generated
  types, which the suite checks. A full run costs minutes of runner time, not anyone's attention.
- **Drafts run.** Problems surface before review is requested; skipping drafts needs an `if:` and
  a `ready_for_review` trigger for no saving that matters.
- **Forks** are handled by `pull_request` safely: the token is read-only and no secrets exist to
  withhold (R15). `pull_request_target` runs with a write token in the base repository's context
  and is the documented way to leak one; this workflow has no use for it.

**Alternatives considered**: checking out `github.event.pull_request.head.sha` (the branch alone,
so local and CI see the same commit, but conflicts in meaning between the branch and `main` are
then found only after merging); `paths-ignore: ['**/*.md', 'specs/**']` (the stuck-required-check
problem above, and spec PRs carry contract changes); skipping drafts (above); a nightly `schedule`
(nothing changes between pushes); `workflow_dispatch` (the "Re-run jobs" button already re-runs a
check, R6).

## R2. Runner, Node.js version, and actions

**Decision**: `runs-on: ubuntu-24.04`. `actions/setup-node` with `node-version-file: .nvmrc` (which
holds `22`). Only GitHub's own actions (`actions/checkout`, `actions/setup-node`), each at its
current major version tag at implementation time. `actions/checkout` with
`persist-credentials: false`.

**Rationale**: FR-010 asks for the version the laptops and containers use, and `.nvmrc` is where the
constitution pins it; reading the file means a future Node bump changes one file, not two. A named
Ubuntu image rather than `ubuntu-latest` keeps a run reproducible when GitHub moves `latest`; it has
Docker preinstalled (R6). GitHub-owned actions add no third party to trust. A major tag receives
GitHub's fixes without a pull request each time; pinning to commit SHAs is the stronger
supply-chain practice for third-party actions, and is unnecessary while only `actions/*` is used.
`persist-credentials: false` keeps the token out of the checked-out repository's git config, since
no step pushes.

**Alternatives considered**: `node-version: 22` written in the workflow (a second place to keep in
step); a Node version matrix (the constitution fixes one version); `ubuntu-latest` (silent image
changes); self-hosted runners (machines to maintain); SHA-pinned actions (above).

## R3. Install with `npm ci`, cache the npm download cache

**Decision**: `actions/setup-node` with `cache: npm` (it keys the cache of `~/.npm` on
`package-lock.json`), then `npm ci`.

**Rationale**: `npm ci` installs exactly the lock file and fails when `package.json` and the lock
file disagree (spec Edge Cases), which `npm install` would silently "fix". Caching the download
cache, not `node_modules`, is what `setup-node` supports directly: a changed lock file still
installs correctly, and packages with install scripts (Prisma's engines, esbuild) run them every
time, as on a fresh clone.

**Alternatives considered**: caching `node_modules` with `actions/cache` (skips install scripts
and platform checks, so a stale cache can pass where a fresh clone fails); no cache (correct but
slower each run).

## R4. One job, one step per check

**Decision**: One job, `test`, whose steps after checkout and setup are: `npm ci`, then one named
step per part of the local `ci` script (R12): generate the Prisma client, check formatting, lint,
build, test, report coverage. Steps run in order and the job stops at the first failure, as `&&`
does locally.

**Rationale**: The suite is dominated by the backend's tests against a real PostgreSQL (one
container, `--runInBand`); the front ends' Vitest suites and the lint and format checks take
seconds to a minute. Splitting into parallel jobs (for example lint, backend, front ends) would
save at most the front ends' minute or two of a run expected to finish well under SC-004's 15
minutes, while installing dependencies three times, producing three check names to mark required
(R18), and no longer matching the one local command (FR-008). One step per check keeps the
readability that splitting would give: the failed step's name says whether it was formatting,
lint, the build, or a test (SC-006).

The job stops at the first failure, so a lint error hides test results until it is fixed. That is
deliberate: the local command behaves the same way (FR-008), formatting and lint run first and
take seconds, and authors run the local command before pushing (quickstart).

**Alternatives considered**: a job per check or per workspace (above); a single step running
`npm run ci` (no drift possible, but every failure shows as the same step, and the author must read
the log to learn which check failed); `if: ${{ !cancelled() }}` on every step to report all
failures at once (diverges from the local command's behaviour; a broken install would then cascade
into confusing errors).

## R5. Generate the Prisma client explicitly

**Decision**: Two places, both idempotent:

- the first step after installing is `npm run prisma:generate --workspace @queuepass/backend`,
  both in the workflow and in the local `ci` script, so the build step (R7), which runs before the
  tests, has the client;
- the backend's `pretest` becomes `npm run build --workspace @queuepass/shared && prisma generate`,
  so the README's `npm install` then `npm test` works on a fresh clone (spec FR-019). R13's test
  asserts that `pretest` contains `prisma generate`.

**Rationale**: A fresh `npm ci` does not generate the client. `@prisma/client`'s install script
changes to `INIT_CWD` (the repository root) and looks for `prisma/schema.prisma` there
(`node_modules/@prisma/client/scripts/postinstall.js`); the schema is at
`backend/prisma/schema.prisma`, so it prints a warning and generates nothing. The backend's build
and its tests import the generated client, so both would fail on the runner. Laptops do not notice
because the client was generated once and stays in `node_modules`. The backend's `Dockerfile`
already runs `npx prisma generate --schema backend/prisma/schema.prisma` for the same reason.
Generating is idempotent and takes seconds, so generating twice in `npm run ci` costs seconds, and
it fixes the README's own documented test command for a new developer, which today fails on a fresh
clone until someone generates the client by hand.

**Alternatives considered**: a root `postinstall` script (would also run in every front-end image's
`npm ci`, where the backend's schema may not be copied); a `"prisma": { "schema": ... }` key in the
root `package.json` (Prisma 6 deprecates that configuration, and its failure is only a warning);
`pretest` alone (does not cover the build step, R7, which runs first); the explicit step alone
(leaves a fresh clone's `npm test` broken); a backend `prebuild` too (`nest build` is also run by
the backend's `Dockerfile`, which already generates; one more hook for no new case); a README note
to generate once by hand (a manual step the constitution's "one documented command" avoids).

## R6. The backend's Testcontainers PostgreSQL on the runner

**Decision**: Run the backend's tests unchanged. GitHub's Ubuntu runners have Docker installed and
running, and Testcontainers finds it at `/var/run/docker.sock` with no configuration. Each run
pulls `postgres:17-alpine` and Testcontainers' Ryuk image from Docker Hub. No pre-pull step, no
retry loop, and Ryuk stays on. The job has a 30-minute limit (R17). When a pull fails, the test
step fails with the Testcontainers error in its output, and the author uses **Re-run failed jobs**
(quickstart).

**Rationale**: The constitution requires persistence tests against real PostgreSQL through
Testcontainers (Principle VI); running them exactly as on a laptop is the point. The images are
small (tens of MB) and pulled in seconds on GitHub's network. A failed pull already fails the run
(FR-004), which is the safe direction; a pre-pull with retries would need the image name repeated
in the workflow (drifting from `backend/test/setup/postgres-container.ts`) to save an occasional
re-run click. Ryuk removes the container if the job dies mid-run; on a discarded runner VM that
matters little, but leaving it on keeps CI identical to the laptop.

**Alternatives considered**: a GitHub `services: postgres` container with `DATABASE_URL` passed in
(bypasses Testcontainers, so CI would test a different setup path than laptops, and `globalSetup`
would need a second code path); a pre-pull step with retries (above); `TESTCONTAINERS_RYUK_DISABLED`
(saves one small pull, diverges from laptops).

## R7. Build every workspace, which type-checks it

**Decision**: Run `npm run build` (the existing root script, every workspace's `build`) after lint
and before the tests. It type-checks the code the containers build: each front end's `src` (and the
`packages/shared` code it imports), the backend's `src`, and the seed. It does not type-check test
files, or `packages/shared/src/web` code that no app imports, because `packages/shared`'s build
uses `tsconfig.build*.json`, which leaves those out. That gap is accepted for this feature: a type
error there cannot break `docker compose up --build`, which is what this step protects.

**Rationale**: Vitest strips types without checking them, so a type error in a front end passes
every test today, and is found only when `docker compose up --build` runs `tsc --noEmit && vite
build` and fails. `main` must start with that command at all times (Constitution III), so the check
must catch it. The front ends' `build` already runs `tsc --noEmit` first; the backend's `nest build`
and the seed's `tsc --noEmit` type-check too. It reuses existing scripts and adds about a minute.

**Alternatives considered**: new `typecheck` scripts per workspace (more surface, same result);
leaving it out (Mahdi's list named lint, format, and the suite; leaving out the build would let a
type error through to a `main` that no longer builds, which the Green and Running-system gates
forbid).

## R8. The formatting and lint checks

**Decision**: Add a root script `"format:check": "prettier --check ."` next to the existing
`format`; lint is the existing `npm run lint` (`eslint .`).

**Rationale**: The constitution fixes ESLint and Prettier, but only `prettier --write` exists today,
which changes files instead of failing. `prettier --check .` honours `.prettierignore` (which
already excludes `packages/shared/src/api-schema.ts`, `specs/`, `.specify/`, and coverage output)
and lists every unformatted file. On 2026-10-24, `prettier --check .` and `npm run lint` both pass
on `main`, so turning them on breaks no existing pull request that is formatted.

**Alternatives considered**: running `prettier --check .` directly in the workflow (the local
command would need the same literal, and R12's drift test compares script names more cleanly);
ESLint's Prettier plugin (a new dependency for what one command already does).

## R9. Front-end coverage: add `@vitest/coverage-v8`

**Decision**: `011` adds one devDependency, `@vitest/coverage-v8`, pinned to the exact version of
the installed Vitest (`3.2.7` on 2026-10-24), in the root `package.json`, so all five Vitest
workspaces can measure coverage.

**Rationale** (Principle VIII): the spec requires every run to report all six workspaces' coverage
(FR-005, FR-006; Clarifications), and the constitution's recorded deferral asks pull requests to
"report their coverage" until the floor is enforced. Today they cannot: Vitest has no coverage
provider installed, so earlier features reported backend coverage only (`016` T033). Vitest cannot
measure coverage without a provider package; `@vitest/coverage-v8` is Vitest's own default
provider, published from the Vitest repository in lockstep with it, used only in tests, and never
shipped in an image. It is the smallest addition that meets the requirement, and `010` would need
exactly the same package to enforce the floor. It is pinned exactly because the provider requires
the same Vitest version. The root `package.json` is the one place shared by every workspace, and is
already changed by this feature (R8, R12).

**Alternatives considered**:

- **Report backend coverage only and leave front ends to `010`**: no new dependency, but five of six
  workspaces would report nothing, against Mahdi's decision that coverage is measured and reported
  in each run, and `010` would then add the same package anyway.
- **`@vitest/coverage-istanbul`**: instruments the code before running it, slower, and not Vitest's
  default; v8 coverage reports lines accurately for this codebase's TypeScript.
- **Adding the provider to each of five workspaces**: five copies of one pin to keep in step.

## R10. Coverage is measured by `npm test`, reported, not enforced

**Decision**: Each workspace's `test` script gains the coverage flag: `jest --runInBand --coverage`
in `backend`, `vitest run --coverage` in the five Vitest workspaces. Configuration:

- **Backend** (`jest.config.ts`): keep `collectCoverageFrom: ['src/**/*.(t|j)s']` and
  `coverageDirectory`; add `coverageReporters: ['text-summary', 'json-summary']`.
- **Vitest workspaces** (each `vitest.config.ts`): `coverage: { provider: 'v8', include:
  ['src/**'], reporter: ['text-summary', 'json-summary'] }`. In `packages/shared`, also
  `exclude: [...coverageConfigDefaults.exclude, 'src/api-schema.ts']` (imported from
  `vitest/config`; a plain `exclude` replaces Vitest's defaults instead of adding to them), with
  the comment "generated from contracts/openapi.yaml by npm run generate:api (Constitution VI
  allows excluding generated code)".
- **ESLint** ignores `**/coverage/` (today only the root `coverage/` is ignored, so a laptop with
  an old Jest HTML report in `backend/coverage/lcov-report/` fails `npm run lint` while CI passes).
  `.prettierignore`'s `coverage/` already matches at any depth (gitignore rules), so Prettier needs
  no change.
- **No thresholds** anywhere. `010` adds them (`coverageThreshold` in Jest, `coverage.thresholds`
  in Vitest), which is how the floor fails `npm test` and the run.

**Rationale**: Constitution VI says coverage "MUST be measured by the documented test command", so
the measurement belongs in `npm test` itself, on laptops and in CI alike, not in a CI-only command.
The flag sits on the `test` scripts, so the watch scripts stay fast. A targeted run (for example
`npm test --workspace @queuepass/backend -- one.spec.ts`) also measures, and prints the whole
workspace's coverage, which is mostly low for one file; the cost of measuring on every `npm test` is
recorded against T001's baseline (tasks T022).

`include: ['src/**']` states each workspace's source plainly and leaves out its config files and
`test/` folder. Files the Admin and Customer apps import from `packages/shared/src` are already
outside their numbers (Vitest's `coverage.allowExternal` defaults to `false`); the include keeps
it that way by configuration. `text-summary` prints four lines per workspace in the log;
`json-summary` writes `coverage/coverage-summary.json`, which R11 reads. `coverage/` folders are
ignored by git and Prettier at any depth, and by ESLint once `**/coverage/` is added (above).

**Alternatives considered**: a separate `test:coverage` script (the chain in the root `test` script
would be written twice, and `npm test` would not measure coverage as the constitution says);
`coverage.enabled: true` in the configs (also turns it on in watch mode); `lcov` or HTML reports
(nobody reads them in CI; local developers can add `--coverage.reporter=html` when they want one).

## R11. The coverage report: one small script, report-only

**Decision**: `scripts/coverage-report.mjs`, run by the root script `coverage:report`. It reads
`<workspace>/coverage/coverage-summary.json` for the six workspaces in a fixed list, and prints a
table: workspace, line coverage percentage, covered and total lines, and "below 80%" where it
applies, followed by "The 80% floor is not enforced until 010-test-coverage is merged." When
`GITHUB_STEP_SUMMARY` is set, it appends the same table in Markdown to that file, which GitHub shows
on the run's summary page. It exits `1`, naming the workspace, if any workspace's file is missing or
unreadable, or counts no lines (`total.lines.total === 0`, which istanbul reports as 100%: the mark
of an `include` that matches nothing). Otherwise it exits `0`, whatever the percentages. Its
formatting and reading logic are exported functions, tested by R13; the file runs its `main` only
when executed directly.

**Only this run's summaries**: the root `test` script starts with
`node scripts/coverage-report.mjs --clean`, which deletes the six workspaces' `coverage/` folders
before any test runs. A summary the report reads was therefore written by this `npm test`. Without
it, a laptop keeps `backend/coverage/coverage-summary.json` from an earlier run, and if a
workspace's `test` script lost `--coverage`, `npm run ci` would pass on the old file while CI, on a
fresh checkout, fails (breaking FR-008). The guarantee holds when `coverage:report` follows the
root `npm test`, as it always does in `npm run ci` and in the check. A single workspace's tests
(`npm test --workspace …`) clean nothing, so a report run after one of those can mix this run's
numbers with older ones; the README says the table is meant to follow `npm test` or `npm run ci`.

**Rationale**: FR-006 and FR-007 in about fifty lines, no dependency, no network, no write access
(the step summary is a file on the runner, not an API call). Failing on a missing file catches a
workspace whose coverage was silently not measured (FR-007); the zero-lines rule catches a
misconfigured one; cleaning first catches a stale one, and also removes old HTML reports.
Below-80% exits `0` until `010`, which enforces the floor through the test runners' own thresholds
(R10), so this script never needs an "enforce" switch.

**Alternatives considered** for stale files: comparing each summary's modification time with a
start stamp written at the beginning of `npm test` (a stamp file, and clock comparisons, for what
deleting does outright); relying on CI's fresh checkout only (leaves local parity broken). For the
report: a third-party coverage-comment action (third-party code, and
`pull-requests: write` to comment, against R15); Codecov or Coveralls (an outside service and,
usually, a secret token); reading the `text-summary` lines from the log (fragile parsing).

## R12. The local equivalent: `npm run ci`

**Decision**: A root script:

```json
"ci": "npm run prisma:generate --workspace @queuepass/backend && npm run format:check && npm run lint && npm run build && npm test && npm run coverage:report"
```

The workflow runs `npm ci`, then each of these six commands as its own named step, in the same
order. R13's test fails when the workflow's commands after `npm ci` are not exactly the `ci`
script's parts, in order (FR-009). The README and quickstart say: run `npm ci` once (the workflow's
install) and then `npm run ci` to reproduce a run exactly. For a pull request, run it on the
branch merged or rebased onto the latest `main` (R1), with the Docker Compose stack down (with the
stack up, the seed's two Keycloak tests run locally instead of being skipped, R16).

**Rationale**: FR-008 asks for one command with the same steps, and the constitution's "tests run
locally" now matches CI by construction. `npm ci` stays out of the script because it deletes
`node_modules`, which a developer does not want on every local run, and is needed only when the
lock file changed.

**Alternatives considered**: running workflows locally with `act` (needs the runner image, and
Docker-in-Docker for Testcontainers); a shell script (does not run the same way in Git Bash,
PowerShell, and macOS); no local command (the drift FR-009 guards against).

## R13. Testing the workflow and the report script with Node's own test runner

**Decision**: Two test files, run by `node --test`, no new dependency:

- `scripts/test/ci-workflow.test.mjs` parses `.github/workflows/ci.yml` with the `yaml` package
  (already a root devDependency) and asserts: the `pull_request` types are exactly `opened`,
  `synchronize`, `reopened`, with no `paths`, `paths-ignore`, or `branches`; `push.branches` is
  exactly `[main]`; no `pull_request_target`; `permissions` is exactly `{ contents: read }`;
  `concurrency` matches R14 exactly; one job, `test`, on `ubuntu-24.04`, with `timeout-minutes` set;
  every `uses:` starts with `actions/`; `setup-node` reads `.nvmrc` with `cache: npm`; checkout
  sets `persist-credentials: false`; the first `run` step is `npm ci` and the remaining `run` steps
  equal the root `ci` script split on ` && `, in order; and the file contains no `secrets.` and no
  `${{ github.token }}`. It also asserts that every part of the `ci` script names a script that
  exists, that the root `test` script starts with `node scripts/coverage-report.mjs --clean`
  (R11), and that the backend's `pretest` runs `prisma generate` (R5).
- `scripts/test/coverage-report.test.mjs` tests R11's functions with fixture summaries: all six
  present and above 80% (table, exit 0); one below 80% (marked, note about `010`, still exit 0); one
  missing, one unreadable, and one with zero lines (each exit 1, named); `--clean` removing the
  `coverage/` folders; the Markdown appended to a temporary `GITHUB_STEP_SUMMARY` file.

The root `test` script gains `node scripts/coverage-report.mjs --clean && node --test
"scripts/test/*.test.mjs"` before the boundary check, so the suite, and therefore the check, runs
them. The glob is quoted: Node 22 expands it itself, and
`node --test scripts/test/` with a directory fails (tried on Node 22.20, 2026-10-24).

**Rationale**: The workflow is configuration whose mistakes (a wrong trigger, a write permission, a
step missing from the local command) do not show up as a failing test anywhere else; asserting its
shape is the test-first handle on it (Constitution VI). Node's built-in runner needs no
configuration and the root has no test runner of its own; ESLint already lints `scripts/**/*.mjs`
with Node globals.

**Alternatives considered**: `actionlint` (a downloaded binary; checks syntax but not our rules); a
Vitest config at the root (would risk collecting every workspace's tests); no tests (the drift
FR-009 forbids would go unnoticed).

## R14. Cancel superseded pull request runs, never `main`'s

**Decision**:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

**Rationale**: The workflow's name prefixes the group, so a later workflow copying the pattern
cannot cancel this one. For a pull request, the group is its number, so a new push cancels the run
for the older push (FR-011). For a push to `main`, the group is the commit, unique per run, so
nothing is cancelled and every merge result is checked.

**Alternatives considered**: `group: ${{ github.ref }}` with `cancel-in-progress: true` (would also
cancel a `main` run when the next merge lands, leaving a commit on `main` unchecked); no
concurrency (wasted runner time, and an older run can finish after a newer one).

## R15. Least privilege, no secrets

**Decision**: `permissions: contents: read` at the top of the workflow, nothing else. No `secrets.`
reference, no environment, no `.env` file.

**Rationale**: The job only reads the code (FR-012). Nothing in the suite needs a secret, checked on
2026-10-24:

- the backend's token tests sign with RS256 key pairs generated in memory on each run
  (`backend/test/setup/keys.ts`), and the app trusts only that generated key set
  (`backend/test/setup/test-app.ts`);
- the test database's user and password (`queuepass` / `queuepass`) are fixed test values for a
  container that lives only for the run (`backend/test/setup/postgres-container.ts`), and
  `DATABASE_URL` is set from the started container;
- the address service is a `FakeGeocoder`, and the JWKS URL defaults to `http://keycloak.invalid`;
  no test calls the network;
- nothing reads `.env` or uses `dotenv`; the seed's Keycloak tests default to `localhost` and skip
  when it is not there (R16);
- no front-end test reads `process.env`.

A pull request from a fork therefore runs exactly like one from a branch.

**Alternatives considered**: the default token permissions (often read and write, depending on the
repository setting; more than the job uses).

## R16. The seed's Keycloak tests skip in CI, and say so

**Decision**: Keycloak is not started in the check. `scripts/seed/test/seed-idempotence.test.ts`
already detects that Keycloak is unreachable and warns, but each test then returns early and is
reported as **passed**. Change the two tests to call Vitest's `skip()` from the test context when
Keycloak is unavailable (`it('…', async ({ skip }) => { if (!available) skip(); … })`), so they
are reported as skipped, with the existing warning (FR-014). The pure `provision-clients.test.ts`
runs everywhere.

**Rationale**: Running Keycloak in the check means a service container with the realm bootstrap,
about a minute to become healthy, and seeding 235 users twice, adding several minutes to every run,
for behaviour the running-system gate already proves on every implementation pull request (the
seed must succeed on the first run). Not starting it is a choice the run should report honestly:
a test that did not run must not count as a pass.

**Alternatives considered**: a Keycloak service container (above; also the seed's own coverage would
rise, which is `010`'s concern); leaving the early `return` (two tests counted as passed that never
ran); deleting the tests (they are the seed's idempotence proof when the stack is up).

## R17. Time limit

**Decision**: `timeout-minutes: 30` on the job. Test timeouts stay as they are (Jest's 120 s per
test, the seed's Vitest timeouts).

**Rationale**: A typical run is expected to take under 15 minutes (SC-004; measured in the running
system task). Jest's `globalSetup`, which pulls and starts PostgreSQL, has no timeout of its own, so
a hung pull would otherwise run for GitHub's default of six hours. Thirty minutes is twice the
expected time, so a slow runner does not fail, and a hang fails within half an hour (FR-013).

**Alternatives considered**: per-step timeouts (more numbers to keep right for one job); the
six-hour default (above).

## R18. Making the check required is a manual repository setting

**Decision**: The workflow is named `CI` and its one job `test`; GitHub lists the check as `test`
(shown as "CI / test" on a pull request). After the implementation merges and the check has run
once, a repository admin adds a branch ruleset (or branch protection rule) for `main` that requires
the `test` status check. The quickstart gives the steps. Nothing automates it.

`test` is a generic name; if another workflow ever has a `test` job, the ruleset picker lists both,
and the admin chooses the one from the `CI` workflow (quickstart Q5). Renaming the job to something
unique (`ci`) was considered and not done: "CI / test" reads well on a pull request, and no second
workflow exists. The constitution's recorded deferral makes the run merge-blocking once `011` is
merged **and** this setting is on, so it is turned on right after the merge, not at some later
point (tasks T033).

**Rationale**: It is a repository setting, not code (FR-015, spec Assumptions); automating it needs
an admin token, which R15 rules out. The job name is the check's name, so it must not change; the
test in R13 pins it. The constitution's Green gate already requires a passing run before a merge;
the setting makes the repository enforce it.

**Alternatives considered**: a settings-as-code app or a script with an admin token (a secret and a
new tool, for one setting changed once).

## R19. How a pull request author reads a failure

**Decision**: No extra reporters. The author opens the failed check from the pull request, and the
failed step's name says which check failed:

- **Check formatting**: Prettier lists each unformatted file; `npm run format` fixes them.
- **Lint**: ESLint prints file, line, and rule.
- **Build**: `tsc` prints file, line, and the type error.
- **Test**: the scripts' tests, the boundary check, and the drift check print their own messages
  (the drift check says to run `npm run generate:api`); Jest and Vitest list each failing test with
  its file and assertion. Vitest also adds its failures as annotations on the pull request's
  changed files, which it does on its own when it runs in GitHub Actions. The test step's output
  says which workspace was running.
- **Report coverage**: names a workspace whose coverage is missing.
- A Testcontainers error ("could not pull image", "Could not find a working container runtime")
  in the backend's tests is the runner, not the code: **Re-run failed jobs**.

The quickstart walks through it with the deliberately failing pull request.

**Rationale**: SC-006 is met by what the tools already print plus step names (R4). Jest's
`github-actions` reporter would add annotations for backend failures, but needs a CI-only reporter
list in `jest.config.ts`; not worth the branching for this feature.

**Alternatives considered**: Jest's `github-actions` reporter (above); a summary step that parses
test output (fragile, duplicates the log).

## R20. Documentation

**Decision**: The README's "Run the tests" section gains `npm run ci` (what it runs, that it is
what the check runs, `npm ci` first to match exactly, and onto the latest `main` with the stack down
to reproduce a pull request's run), how to read a failure (open **Details**; the failed step's
name says which check failed; a Testcontainers "could not pull image" error means **Re-run failed
jobs**), and a sentence on the pull request check and the coverage table. The Status table, the
"reserved features" line, and the repository layout block (a line for `.github/workflows/`) are
updated for `011`. The quickstart covers watching a run, reproducing it locally, reading a
failure, and turning on the required check (FR-017).

**Rationale**: The constitution's Documentation gate requires the README to document the test
command in the same pull request that changes it.

**Alternatives considered**: a separate CONTRIBUTING file (one more place to keep in step).
