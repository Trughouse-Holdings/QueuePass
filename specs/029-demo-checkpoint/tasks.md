---
description: "Task list for Demo Checkpoint"
---

# Tasks: Demo Checkpoint

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R14),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (no API change),
[quickstart.md](./quickstart.md) (S0–S7)

**Issue**: [#139](https://github.com/Trughouse-Holdings/QueuePass/issues/139). The implementation
PR's **description** says `fixes #139` on its own line. No commit message on either branch may
contain "fixes #139", "closes #139", or "resolves #139".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks of Phase 3.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `029-demo-checkpoint-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `029-demo-checkpoint-spec` and carry in every change that PR's review makes; once it merges, bring
  it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 029: the reset's guard (T003, T009,
  #139)`.
- **One independent review** (Constitution III) of the implementation branch before its PR (T019).
- **`npm run ci` locally** before pushing (T017), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge (T021).
- **Never reset a database you did not create.** The reset removes every venue, event, and order.
  Walk it only on a Compose project of your own (`-p qp029`). The team stack (compose project
  `queuepass-team`, its Backend and apps run from `C:\Users\mahdi\hello_world\QueuePass-team` with
  `run-host.mjs`) holds every fixed port and the team's data: do not run the reset against it, and do
  not stop it, without Mahdi saying so in the session (T020, T022). If it must be stopped for a
  stretch, use `docker compose -p queuepass-team stop` (never `down`, never `-v`) and restore it with
  `docker compose -p queuepass-team start database keycloak` and `run-host.mjs` from the main
  checkout.
- **Path B on this machine** (README "When the images can't be built"): the app images cannot be built
  here, so the Compose path (A) is walked by CI's `e2e` job (T013, R13) and the hand walk uses path B.
- **Spec `028`** (PR #140) also changes `scripts/run-host.mjs`; if it has merged, rebase first and keep
  both changes (research R6).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US3 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `029-demo-checkpoint-impl` from `029-demo-checkpoint-spec` (or from `main` once the spec
  PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's.

---

## Phase 2: Tests first (all must fail before Phase 3)

- [ ] T002 [P] [US1] `backend/test/integration/demo-data.e2e-spec.ts` (FR-007, research R5): the
  summary has `events: 5` and `past: 'Season Opener'`; the sales report's `totals.events` is 4; Season
  Opener is at Demo Riverside Hall, `SCHEDULED`, starts 7:00 PM and ends 10:00 PM local on the run's
  local date minus 7 days, has no orders or tickets, and its `endsAt` is before `now()`; the existing
  "every demo event has doors 1 hour before its start" test now counts 5 events; the round local
  times test includes Season Opener (`19:00`, 3 hours). Must fail (no past event yet).
- [ ] T003 [P] [US3] `backend/test/unit/demo-reset-guard.spec.ts` (new; FR-009, FR-011, SC-004,
  research R7): `checkResetAllowed(env)` throws `ResetRefused` naming `QUEUEPASS_ALLOW_RESET=1` when it
  is absent, `''`, `0`, `true`, ` 1`, or `yes`; with `1`, accepts hosts `localhost`, `LOCALHOST`,
  `127.0.0.1`, `[::1]`, `database` and returns `{ host, port, database }` (no password anywhere in the
  value or the message); refuses `db.example.com`, `10.0.0.5`, `127.0.0.2`, `localhost.example.com`,
  a URL with a `host=` query parameter, a `mysql:` URL, and a missing or unparseable `DATABASE_URL`,
  each message naming the host (or saying it is missing) and never the password. And `main()` with a
  refused guard sets a failure exit code and never calls `NestFactory.createApplicationContext` (a
  Jest spy). Must fail (no module yet).
- [ ] T004 [US1] [US2] `backend/test/integration/demo-reset.e2e-spec.ts` (new; FR-004 to FR-006,
  SC-001, SC-003, research R2, R12), with `createTestApp()` and the fake geocoder:
  - a `fingerprint(prisma, runAt)` helper as research R12 describes (no ids, codes, secrets, or
    timestamps; event times relative to the run; image bytes as SHA-256; sorted);
  - reset an empty database (after `resetDb`) and take the fingerprint F0;
  - fill extra data: a venue with two sections (layout service), a seated event with tiers mapped to
    sections, an unseated event, an image, orders by a real-looking subject, one ticket admitted
    through the entry service, a live seat hold and an ended one (reservations service), and run the
    reset; every table `pg_tables` lists except `_prisma_migrations` holds only demo rows (no row
    whose venue or event name is not a demo name), and the fingerprint equals F0;
  - reset twice in a row: equal fingerprints;
  - `_prisma_migrations` has the same rows before and after.
  Must fail (no reset yet).
- [ ] T005 [US3] Same file (FR-010, SC-005, research R7): `assertMigrated(prisma, migrationsDir)`
  refuses, and nothing is removed (a marker venue survives a `runDemoReset` given that directory),
  when: `_prisma_migrations` is missing (a second database created in the same container with `CREATE
  DATABASE`, connected through its own PrismaClient, dropped afterwards); `migrationsDir` is a
  temporary copy of the folder names plus `29991231000000_not_applied`, which has no row; that name has
  a row with `finished_at` NULL, and then one with `rolled_back_at` set (rows inserted by the test and
  deleted afterwards; the suites run in band). With the real directory it passes. Must fail.
- [ ] T006 [US1] Same file (FR-012, FR-013, FR-014, SC-002, research R9 to R11): the summary's removed
  counts equal the rows that were there (per table, and the checked-in tickets), its created counts
  equal `runDemoData`'s summary, `target` has no password, and the printed lines (captured from the
  logger the reset is given) contain each count, Demo Tonight's closing time, the reload reminder,
  and the attempt-limit note; the wipe alone under 1 s and the whole reset under 10 s; and when the
  demo venue already exists after the wipe (an `afterWipe` hook in the options inserts it, test only),
  `runDemoReset` rejects with FR-013's message ("removed … incomplete … run it again"). Must fail.
- [ ] T007 [P] [US3] Root scripts (FR-002, FR-003, SC-007, research R6, R12):
  `scripts/test/run-host.test.mjs`: `--print --demo-reset` lists exactly one setup step,
  `demo-reset`, `npm run demo-reset --workspace @queuepass/backend`, whose environment is the Backend
  child's (`--print` without the flag) plus `QUEUEPASS_ALLOW_RESET=1`, and no children;
  `--demo-reset --demo-data` exits non-zero naming both. New `scripts/test/demo-reset-safety.test.mjs`:
  `docker-compose.yml`, `e2e/stack/docker-compose.e2e.yml`, `.env.example`, and every file in
  `.github/workflows/` contain neither `QUEUEPASS_ALLOW_RESET` nor `demo-reset`. The `run-host` cases must fail (no mode
  yet); the safety test passes from the start, as expected: it guards against a later change.

---

## Phase 3: Implementation

- [ ] T008 [US1] `backend/src/scripts/demo-data.ts` (research R5): Season Opener after Holiday Gala,
  exactly as R5's snippet; `DemoSummary.past`; `events: 5`; the "already present" summary has `past:
  null`; `main()`'s line names it ("…; "Holiday Gala" cancelled; "Season Opener" over."). T002 passes.
- [ ] T009 [US3] `backend/src/scripts/demo-reset.ts` (new): `ResetRefused` and `checkResetAllowed` per
  research R7 (Node's `URL`; strip IPv6 brackets; lower-case; port defaulting to 5432; database from
  the path). T003's guard cases pass.
- [ ] T010 [US1] [US2] [US3] Same file: `assertMigrated(prisma, migrationsDir)` (R7: `to_regclass`
  for `_prisma_migrations` in `current_schema()`, then the folder names under
  `path.resolve(__dirname, '../../prisma/migrations')`, directories only); `wipeAppData(prisma)` (R2:
  one interactive transaction, `SET LOCAL lock_timeout = '5s'`, the `pg_tables` list, counts, one
  quoted `TRUNCATE … RESTART IDENTITY CASCADE`; a lock timeout becomes "the database is busy; try
  again", R10); `runDemoReset(app, { log, migrationsDir?, afterWipe? })` (assert, wipe, `afterWipe` for tests only, then
  `runDemoData`; `created: false` or a throw becomes FR-013's error). T004, T005 pass.
- [ ] T011 [US1] Same file: the output of research R11 (the label map, Demo Tonight's close in its
  venue's zone with `@queuepass/shared`, the duration, the reminders) and `main()` (guard first, then
  `NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })`, `runDemoReset`,
  `app.close()` in `finally`, exit code 1 with the message on any refusal or failure). Add
  `"demo-reset": "node dist/scripts/demo-reset.js"` to `backend/package.json` beside `demo-data`. T003's
  `main()` case and T006 pass.
- [ ] T012 [US1] `scripts/run-host.mjs` (research R6): parse `--demo-reset`; refuse it with
  `--demo-data`; `plan()` returns, for it, `setup: [{ name: 'demo-reset', command: 'npm run demo-reset
  --workspace @queuepass/backend', env: { ...backendEnv, QUEUEPASS_ALLOW_RESET: '1' } }]` and no
  children; `run()` checks `backend/dist/scripts/demo-reset.js` exists first (else the "Build the
  Backend first" message, exit 1), runs the step, and exits with its status without starting anything.
  Update the header comment. T007 passes.

---

## Phase 4: The browser harness and test (research R13)

- [ ] T013 [US1] `scripts/e2e.mjs`: load the demo state with `[...COMPOSE, 'exec', '-T', '-e',
  'QUEUEPASS_ALLOW_RESET=1', 'backend', 'node', 'backend/dist/scripts/demo-reset.js']` in place of the
  demo data's command; log "loading the demo state (reset)…"; on failure "npm run e2e: the demo state
  did not load." Update the header comment and the README's e2e paragraph ("loads the demo data" →
  "loads the demo state with the reset").
- [ ] T014 [US1] `e2e/tests/029-demo-checkpoint.spec.ts` (new): `029 S2: after the reset, the Ticket
  Booth offers Demo Tonight open and the Customer app shows Season Opener with sales closed`. Sign in
  to the Booth as a gate agent from `e2e/fixtures/apps.ts`: Demo Tonight is listed and choosable, Season
  Opener is not listed. Sign in to the Customer app as a customer: Season Opener's page shows "Sales
  closed"; Fall Concert's page offers tickets. Read only; admit nothing. Run it three times in a row
  locally if a stack can run here, else on CI.
- [ ] T015 `specs/029-demo-checkpoint/quickstart.md`: the Automation row S2 becomes `Automated: \`029
  S2: …\`; rest Manual: admitting a ticket by hand`, with T014's exact title; `npm test`'s
  quickstart-marks check passes.

---

## Phase 5: Documentation, review, pull request

- [ ] T016 README (FR-015): a **Demo checkpoint** section after "Demo data": both commands (path A and
  path B), the permission and why it is needed, what is removed (every venue, event, order, ticket,
  seat hold, image) and kept (the schema, Keycloak accounts), the demo state with Season Opener, that
  it never runs by itself, the reload and attempt-limit notes, and that save/restore checkpoints are
  not built (research R8). In "Demo data": five events with Season Opener, and "To demo check-in later"
  points to the reset first. The `029` status row: tasks count and code status.
- [ ] T017 `npm run ci` locally, green; record the counts per workspace and each workspace's line
  coverage (Backend at or above 80% with the new script).
- [ ] T018 Run the Backend suite three times in a row and `npm run test:tz` (several zones: the
  past event's local date math); record the counts. The `e2e` job on GitHub runs the reset (T013) and
  `029 S2`; record its time.
- [ ] T019 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, and research.md; fix the findings; record the round here.
- [ ] T020 Running-system walk, quickstart S0–S7, on Compose project `qp029` (path B on this machine;
  the team stack's ports are needed, so ask Mahdi before stopping it, ground rules); record each
  scenario's result here (Constitution VI smoke test).
- [ ] T021 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #139`, lists the review, the walk, the test counts, and
  that no shared surface is touched. Wait for CI green on GitHub (`test` and `e2e`) on the final
  commit; merge only when green and approved.
- [ ] T022 The issue's "run before John's demo": after the implementation PR merges, and only when
  Mahdi says go, run `node scripts/run-host.mjs --demo-reset` from the main checkout against the team
  stack (it removes the "EDIS Showcase Night" event and every other test row); record the output here.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Tests (T002–T007)** → **Implementation (T008–T012)** → **Harness (T013–T015)**
  → **Polish (T016–T022)**.
- T004–T006 share one file: write them in order. T002, T003, T007 are independent of them.
- T008 before T010's demo-state assertions can pass (the reset loads the new demo data).
- T009 → T010 → T011 (one file). T012 needs T011's workspace script.
- T013 needs T011 (the compiled script in the image). T014 needs T008 and T013. T015 after T014.
- T022 after T021's merge, on Mahdi's word.

### Parallel opportunities

- T002, T003, T007 (three workspaces' test files).
- T008 and T009 (different files).

## Implementation Strategy

- **MVP**: T001–T011: the reset works from the Backend's container and with the Backend's environment.
  Shippable for path A alone.
- Then path B (T012), the harness and browser test (T013–T015), the README, and the PR.

## Review record (spec branch)

_Left for the independent review session._

## Review record (implementation branch)

_Left for the implementation's review (T019)._
