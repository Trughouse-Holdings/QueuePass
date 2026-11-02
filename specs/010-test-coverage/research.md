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

**Decision**: the failing runner's own message names the workspace's coverage and the floor (FR-003);
`npm test` stops at the first workspace below it, and CI's "Report coverage" step runs only after a
green `npm test` (`011`'s shape, every step required, unchanged here). So the table appears only when
every workspace passes; after a local failure, `npm run coverage:report` prints it from the summaries
written so far (both runners write `coverage-summary.json` even when the threshold fails). `scripts/
coverage-report.mjs`: `NOTE` becomes "The 80% floor is enforced by each
workspace's test run (010-test-coverage)."; it still marks a workspace below 80% (FR-004). Its
`node --test` file is updated for the new note.

## R3. The Backend's unit run and the time-zone runs

**Decision**: `backend/jest.unit.config.ts` (used by `npm run test:tz`, `020` R20) inherits the
threshold through its `...rest` spread, but sets `collectCoverage: false`, so the threshold never
applies there: it runs only the unit tests, whose coverage is lower than the full suite's by design, and
it exists to check time-zone behavior, not coverage. The Vitest workspaces' `test:tz` runs call
`vitest run` without `--coverage` and no config turns coverage on (`scripts/test-tz.mjs`, confirmed in
review round 1), so the floor cannot affect `npm run test:tz` or its `--quick` run in `npm test`.

## R4. The seed's unit tests: a fake admin client

**Decision**: `scripts/seed/test/fake-keycloak.ts`: an object with the methods the seed calls
(`realms.find`, `realms.create`, `roles.find`, `roles.create`, `roles.findOneByName`, `users.find`,
`users.create`, `users.addRealmRoleMappings`, `clients.find`, `clients.create`, `clients.update`,
`clients.listDefaultClientScopes`, `clients.addDefaultClientScope`, `clientScopes.find`,
`clientScopes.create`, `clientScopes.listProtocolMappers`, `clientScopes.addProtocolMapper`,
`clientScopes.delProtocolMapper`; T003 confirms the list from the code), backed by in-memory maps, recording every call. Tests (new files, so they do not collide with `021`'s
`provision-realm.test.ts`):

- The fake is a `Proxy`: calling any method it does not implement throws `fake Keycloak: <group>.<method>
  is not implemented`, so a later change to the seed (for example `021`'s `realms.findOne` and
  `realms.update`) fails with a message that names what to add (review round 1, should-fix 3).
- `realm-roles.unit.test.ts`: absent realm → created with its settings; present → left; roles created
  only when missing.
- `users.unit.test.ts`: every group's accounts created once with the right role and password; a second
  run creates nothing; a role missing from the realm fails with the seed's message; an account present without its role gets the role (if the code does that; test
  what the code does).
- `clients.unit.test.ts` (beside the existing `provision-clients.test.ts`): created when absent;
  converged when drifted (redirect URIs, web origins, flows); the audience scope created once and added
  as a default scope; a missing `roles` scope fails with the seed's message; a stray protocol mapper on
  the audience scope is removed and the right one added.
- `keycloak-client.unit.test.ts`: `loadConfig` defaults and environment overrides; `waitForKeycloak`
  succeeding at once, after retries, and timing out with its message (a fake `fetch` and Vitest's
  fake timers: its 2-second wait is fixed, with no interval parameter); `createKeycloakClient` authenticates with the
  configured admin (a stubbed `KcAdminClient` module).
- `index.unit.test.ts`: `seed()` calls realm, users, then clients in that order and logs the summary;
  the entry point, in process (a child process's coverage is not counted, and importing `index.ts`
  from another script never runs the entry code, which checks `process.argv[1]`): set
  `process.argv[1]` to a path ending `scripts/seed/src/index.ts`, `vi.resetModules()`, mock
  `./keycloak-client` so the seed rejects, stub `process.exit`, then `await import('../src/index')` and
  expect `process.exit(1)` and the "[seed] FAILED:" message; restore `argv` afterwards (review round 1,
  should-fix 1).

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

## R7. Flaky front-end tests under load (issue #118, 2026-11-02)

**Measured**: the `admin-app` and `customer-app` suites (`vitest run --coverage`) run side by side,
on a 16-thread, 16 GB laptop with another session's Backend tests running. Before: `admin-app`
failed 6 of 10 runs (8 failures: 7 timeouts, each in a different test, and 1 from the images
preview race), `customer-app` passed 10 of 10. After: both passed 10 of 10. `admin-app` takes
about 51 s instead of 43 s in this setting; `customer-app` about 25 s instead of 30 s.

**Cause**: Vitest starts one worker per CPU thread less one (15 here), each its own jsdom process.
Two suites at once ran 30, free memory fell to about 2 GB, and a worker paged out for seconds
missed the 5 s test timeout: tests that take 20 ms alone were reported at 10 s, whichever happened
to be running. The issue's two timeouts (`reports-export`, under 0.5 s alone, of which 0.35 s is
the XLSX library's first import, the write, and the read back; `times.tz`, 0.3 s) are this stall;
neither recurred in the runs above, which caught seven other tests instead.

**Decision**: each jsdom workspace's `vitest.config.ts` runs at most 4 workers (one per thread less
one below that, so CI's 4-CPU runner keeps 3). Separately, the races found while looking:

- `customer-app/test/app.test.tsx` "offers no change control at /events/e1": waits for the Get
  tickets form, then leaves out its "Name on tickets" field (the buyer's own name, not a change).
- `admin-app/test/images-field.test.tsx` (three tests): waits for each new picture's preview,
  which is set in an effect after its row appears.
- `admin-app/test/event-types-edit.test.tsx` and `ticket-limit.test.tsx`: the edit form loads the
  event and its ticket types in separate requests; the tests now wait for both.
- `admin-app/test/venue-time-zone.test.tsx`: waits for the zone-change note to go instead of a
  fixed 50 ms.
- `admin-app/test/reports-export.test.tsx` "names the signed-in admin as made by": checks the table
  the App hands the Excel writer; `xlsx.test.ts` already proves that table reaches the file.

No test timeout was raised and nothing retries.
