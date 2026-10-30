# Research: Test Coverage Floor

**Feature**: `010-test-coverage` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-10-30

Written unattended at Nate's request; each decision takes the recommended option.

## R1. The floor in each test runner

**Decision**: Vitest workspaces (`admin-app`, `customer-app`, `booth-app`, `packages/shared`,
`scripts/seed`): `coverage.thresholds: { lines: 80 }` in each `vitest.config.ts`. Backend (Jest):
`coverageThreshold: { global: { lines: 80 } }` in `backend/jest.config.ts`. Each runner then exits
non-zero below the floor and prints which metric failed with the number (FR-001, FR-003), so `npm
test` (which runs each workspace in turn) fails at the first workspace below it.

**Rationale**: the runners already measure coverage (`011` R10); their built-in thresholds fail the
run with a clear message and need no new code.

**Alternatives considered**: failing in `scripts/coverage-report.mjs` after all suites: it runs after
`npm test` in `npm run ci` and CI, so a local `npm test` would pass below the floor.

## R2. The report says the floor is enforced

**Decision**: `scripts/coverage-report.mjs`: `NOTE` becomes "The 80% floor is enforced by each
workspace's test run (010-test-coverage)."; it still marks a workspace below 80% (FR-004). Its
`node --test` file is updated for the new note.

## R3. The Backend's unit run and the time-zone runs

**Decision**: `backend/jest.unit.config.ts` (used by `npm run test:tz`, `020` R20) does not get the
threshold: it runs only the unit tests, whose coverage is lower than the full suite's by design, and
it exists to check time-zone behavior, not coverage. The Vitest workspaces' `test:tz` runs call
`vitest run` without `--coverage` (check in T002); if they do run coverage, the threshold applies there
too, and the same suite meets it.

## R4. The seed's unit tests: a fake admin client

**Decision**: `scripts/seed/test/fake-keycloak.ts`: an object with the methods the seed calls
(`realms.find`, `realms.create`, `roles.find`, `roles.create`, `roles.findOneByName`, `users.find`,
`users.create`, `users.addRealmRoleMappings`, `users.listRealmRoleMappings` if used, `clients.find`,
`clients.create`, `clients.update`, `clientScopes.find`, `clientScopes.create`,
`clients.addDefaultClientScope`, and whatever else `src/*.ts` calls: list them from the code in T003),
backed by in-memory maps, recording every call. Tests (new files, so they do not collide with `021`'s
`provision-realm.test.ts`):

- `realm-roles.unit.test.ts`: absent realm → created with its settings; present → left; roles created
  only when missing.
- `users.unit.test.ts`: every group's accounts created once with the right role and password; a second
  run creates nothing; an account present without its role gets the role (if the code does that; test
  what the code does).
- `clients.unit.test.ts` (beside the existing `provision-clients.test.ts`): created when absent;
  converged when drifted (redirect URIs, web origins, flows); the audience scope created once and added
  as a default scope.
- `keycloak-client.unit.test.ts`: `loadConfig` defaults and environment overrides; `waitForKeycloak`
  succeeding at once, after retries, and timing out with its message (a fake `fetch` and short
  intervals through its parameters or fake timers); `createKeycloakClient` authenticates with the
  configured admin (a stubbed `KcAdminClient` module).
- `index.unit.test.ts`: `seed()` calls realm, users, then clients in that order and logs the summary;
  the entry-point failure path exits 1 (spawn `tsx` on a script that imports `index.ts` with Keycloak
  unreachable and a 1-second wait, or refactor the entry check into a testable function).

**Rationale**: the seed is configuration code: what matters is which requests it sends and how it
handles answers, which a recording fake checks precisely, with no network.

## R5. Exclusions

**Decision**: confirm in T002 that `packages/shared/vitest.config.ts`'s `src/api-schema.ts` exclusion
(with its comment) is the only one; Vitest's `coverageConfigDefaults.exclude` excludes test files and
configs, which are not source (FR-008). No other exclusion is added.

## R6. Proof

**Decision**: T010 proves each runner fails below the floor by temporarily lowering a workspace (a
throwaway untested file), once locally per runner kind (Jest, Vitest) and once on a draft PR in CI,
then removes it.
