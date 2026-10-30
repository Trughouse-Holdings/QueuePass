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
  `provision-clients.ts`, build on it: keep its tests, test its new paths too.

## Phase 1: Setup

- [ ] T001 Cut the branch; `npm ci`; `npm run ci` green; record each workspace's line coverage here.
- [ ] T002 Check R3 and R5: how `scripts/test-tz.mjs` runs each workspace (coverage or not), and that
  `src/api-schema.ts` is the only exclusion. Record.

## Phase 2: User Story 2 - The seed without Keycloak (P1)

- [ ] T003 [US2] List every Keycloak admin client method `scripts/seed/src/*.ts` calls; write
  `scripts/seed/test/fake-keycloak.ts` (R4) implementing exactly those, in memory, recording calls.
- [ ] T004 [P] [US2] `scripts/seed/test/realm-roles.unit.test.ts` (R4).
- [ ] T005 [P] [US2] `scripts/seed/test/users.unit.test.ts` (R4).
- [ ] T006 [P] [US2] `scripts/seed/test/clients.unit.test.ts` (R4).
- [ ] T007 [P] [US2] `scripts/seed/test/keycloak-client.unit.test.ts` (R4).
- [ ] T008 [P] [US2] `scripts/seed/test/index.unit.test.ts` (R4); if the entry-point check cannot be
  tested as written, move it into an exported function and test that (no behavior change).
- [ ] T009 [US2] With no Keycloak: `npm test --workspace @queuepass/seed` at or above 80% lines (aim
  higher, so a small later change does not drop it below); record the number. Every test passes 3 runs
  in a row.

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
  workspace.
- [ ] T015 Independent review by a separate Claude session; fix; record here.
- [ ] T016 `npm run ci` green locally; record each workspace's coverage and the `test` job's duration
  against `main`'s (SC-004).
- [ ] T017 Quickstart F2–F4 (F3 on a draft PR, closed unmerged afterwards); record.
- [ ] T018 Push; open the implementation PR after the spec PR merges: `fixes #22`, coverage before and
  after, the review. CI green; merge when green and approved.

## Dependencies

T001–T002 → T003 → T004–T008 → T009 → T010–T012 → T013–T018.
