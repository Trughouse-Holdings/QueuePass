---
description: "Task list for Test Coverage Floor"
---

# Tasks: Test Coverage Floor

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R6),
[quickstart.md](./quickstart.md) (F1–F5)

**Issue**: [#22](https://github.com/Trughouse-Holdings/QueuePass/issues/22). The implementation PR's
**description** says `fixes #22`; no commit message contains "fixes #22", "closes #22", or "resolves
#22".

## Ground rules

- Fresh session on `010-test-coverage-impl`, cut from the spec branch while its PR is open.
- Commits: `Impl 010: <what> (T0xx, #22)`.
- If spec `021`'s implementation has merged and added seed tests or changed `provision-realm.ts` /
  `provision-clients.ts`, build on it: keep its tests, test its new paths too. If `010` merges first,
  `021`'s implementer adds `realms.findOne` and `realms.update` to the fake; the fake's error names
  them (R4).

## Phase 1: Setup

- [x] T001 Cut the branch; `npm ci`; `npm run ci` green; record each workspace's line coverage here.
  Result: `010-test-coverage-impl` cut from `010-test-coverage-spec` (f0deb7d); `npm run ci` green
  in 218 s, with Keycloak pointed at an unreachable port as in CI. Lines before: `packages/shared`
  93.13% (1696/1821), `backend` 97.02% (2055/2118), `admin-app` 97.06% (3040/3132), `customer-app`
  97.46% (1616/1658), `booth-app` 92.28% (550/596), `scripts/seed` 24.01% (61/254), as the spec says.
- [x] T002 Check R3 and R5: how `scripts/test-tz.mjs` runs each workspace (coverage or not), and that
  `src/api-schema.ts` is the only exclusion. Record.
  Result: confirmed. `suiteCommand` runs `vitest run` (never `--coverage`) and Jest with
  `jest.unit.config.ts` (`collectCoverage: false`) or, for `--backend-full`, plain `jest
  --runInBand` (no `--coverage`, and `jest.config.ts` does not set `collectCoverage`), so no
  threshold applies there. The only `exclude` across the six configs is `src/api-schema.ts` in
  `packages/shared`, with its comment.

## Phase 2: User Story 2 - The seed without Keycloak (P1)

- [x] T003 [US2] List every Keycloak admin client method `scripts/seed/src/*.ts` calls (R4's list);
  write `scripts/seed/test/fake-keycloak.ts` (R4) implementing exactly those, in memory, recording
  calls, as a `Proxy` that throws `fake Keycloak: <group>.<method> is not implemented` for anything
  else. Result: the code calls exactly R4's 18 methods (plus `auth`, which `createKeycloakClient`
  calls on the real client, stubbed in T007). `fake-keycloak.unit.test.ts` (3 tests) checks the
  not-implemented message, that the fake is not a thenable, and that it hands out copies.
- [x] T004 [P] [US2] `scripts/seed/test/realm-roles.unit.test.ts` (R4). Result: 5 tests.
- [x] T005 [P] [US2] `scripts/seed/test/users.unit.test.ts` (R4). Result: 10 tests; an account
  already present is left as it is, its roles included (the code does not re-role it).
- [x] T006 [P] [US2] `scripts/seed/test/clients.unit.test.ts` (R4). Result: 11 tests.
- [x] T007 [P] [US2] `scripts/seed/test/keycloak-client.unit.test.ts` (R4). Result: 11 tests.
- [x] T008 [P] [US2] `scripts/seed/test/index.unit.test.ts` (R4): `seed()` in order, and the entry
  point in process (set `process.argv[1]`, `vi.resetModules()`, mock the client so the seed rejects,
  stub `process.exit`, import), never by spawning a child process (its coverage is not counted).
  Result: 7 tests; `seed()` runs end to end against the fake, and the entry point's failure exit
  (Error and non-Error, POSIX and Windows paths), success, and not-an-entry-point are covered.
- [x] T009 [US2] With no Keycloak: `npm test --workspace @queuepass/seed` at or above 80% lines (aim
  higher, so a small later change does not drop it below); record the number. Every test passes 3 runs
  in a row. Result: 100.00% lines (254/254), 51 passed and the 4 live tests skipped with their
  reason, 3 runs in a row. Each new file was seen to fail against a deliberately broken seed (a
  temporary password, a 1-second wait, a kept stray mapper, exit code 2, a skipped role), then
  reverted.

## Phase 3: User Story 1 - The floor (P1)

- [ ] T010 [US1] Prove the runners fail first (R6): set the threshold in `booth-app/vitest.config.ts`
  to 99 temporarily: `npm test --workspace @queuepass/booth-app` fails naming lines and the numbers.
  Revert. Same for `backend/jest.config.ts` with `coverageThreshold.global.lines: 99`. Record the
  messages.
- [ ] T011 [US1] Set `coverage.thresholds: { lines: 80 }` in the five `vitest.config.ts` and
  `coverageThreshold: { global: { lines: 80 } }` in `backend/jest.config.ts` (not in
  `jest.unit.config.ts`, R3); replace each "No thresholds until 010" comment with one naming the floor
  and Constitution VI (FR-009).
- [ ] T012 [US1] `scripts/coverage-report.mjs` note (R2), test first in `scripts/test/` for the new
  text. `npm test` and `npm run test:tz` green.

## Phase 4: User Story 3 and polish

- [ ] T013 [US3] Quickstart F5; record.
- [ ] T014 README: the `010` status row; the testing section says the 80% floor is enforced per
  workspace, that a filtered run (`npm test --workspace X -- somefile`) fails the floor because it
  measures only part of the suite (run the workspace's whole suite, or `npx vitest run somefile`
  without coverage), and that `npm run coverage:report` prints the table after a failing run.
- [ ] T015 Independent review by a separate Claude session; fix; record here.
- [ ] T016 `npm run ci` green locally; record each workspace's coverage and the `test` job's duration
  against `main`'s (SC-004).
- [ ] T017 Quickstart F2–F4 (F3 on a draft PR, closed unmerged afterwards); record.
- [ ] T018 Push; open the implementation PR after the spec PR merges: `fixes #22`, coverage before and
  after, the review. CI green; merge when green and approved.

## Dependencies

T001–T002 → T003 → T004–T008 → T009 → T010–T012 → T013–T018.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-10-30; it ran Vitest 3.2.7 and Jest 29.7.0 with an 80%
  lines threshold and the seed's suite without Keycloak, 24.01%): 0 must-fix, 3 should-fix, 4 minor;
  all fixed in the `Review 010` commit: the entry point is tested in process (R4, T008); FR-004 and R2
  say when the table appears (only after a passing `npm test` in CI; `npm run coverage:report` locally);
  the fake names any missing method, for whichever of `010`/`021` merges second (R4, T003); R4's method
  list and three error paths; fake timers for the fixed 2-second wait; R3's wording on
  `jest.unit.config.ts`; the README notes that a filtered run fails the floor (T014).
- **Open findings**: none.
