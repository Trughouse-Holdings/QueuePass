# Implementation Plan: Test Coverage Floor

**Branch**: `010-test-coverage-spec` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#22](https://github.com/Trughouse-Holdings/QueuePass/issues/22)

## Summary

Turn on an 80% line floor in each workspace's own test runner (research R1), so `npm test` and CI fail
below it; say so in the coverage table (R2); bring `scripts/seed` from 24% to at least 80% with unit
tests against a recording fake Keycloak admin client (R4). No product code changes, no API, database,
or constitution change.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22.

**Primary Dependencies**: Vitest and Jest coverage (existing, v8 provider and Jest's).

**Storage**: none. **Testing**: the new seed unit tests; the runners' thresholds; a deliberate drop
(R6). **Target Platform**: laptops and GitHub Actions. **Project Type**: test infrastructure.

**Performance Goals**: the `test` job within 2 minutes of today (SC-004). **Constraints**: lines only;
only generated code excluded. **Scale/Scope**: six configs, about five new seed test files.

## Constitution Check

| Principle | Check | Result |
| --- | --- | --- |
| VI. Test-first, 80% per workspace | This feature enforces it; the deferral closes on merge | Pass |
| VIII. Simplicity | Built-in thresholds; one fake | Pass |
| Others | No product change | Pass (n/a) |

## Project Structure

```text
admin-app/vitest.config.ts, customer-app/vitest.config.ts, booth-app/vitest.config.ts,
packages/shared/vitest.config.ts, scripts/seed/vitest.config.ts   # thresholds.lines 80 (R1)
backend/jest.config.ts                                             # coverageThreshold (R1)
scripts/coverage-report.mjs, scripts/test/coverage-report.test.mjs # the note (R2)
scripts/seed/test/fake-keycloak.ts and *.unit.test.ts              # R4
README.md                                                          # 010 row; the floor
```

## Complexity Tracking

None.
