# Quickstart: Test Coverage Floor

## F1. Green with the floor on (US1, US2; SC-001)

With no stack running, `npm test`. **Expected**: passes; the table lists all six workspaces at or
above 80%, `scripts/seed` included, and says the floor is enforced; the seed's live tests are
reported skipped with their reason.

## F2. A drop fails (US1; SC-002)

Add `booth-app/src/untested.ts` with 60 lines of exported functions and no tests. `npm test`.
**Expected**: fails at `booth-app`, naming lines, its percentage, and 80. Remove the file: green. Repeat
once for `backend` (Jest).

## F3. In CI (US1)

A draft PR with F2's file: the `test` check fails. Close it unmerged, delete the branch.

## F4. With Keycloak (US2; FR-006)

`docker compose up -d keycloak`, wait healthy, `npm test --workspace @queuepass/seed`. **Expected**:
the live tests run and pass too.

## F5. Exclusions (US3; SC-003)

Search the six configs for `exclude`. **Expected**: only `src/api-schema.ts` in `packages/shared`, with
its reason.
