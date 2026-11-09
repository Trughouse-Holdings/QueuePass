# Implementation Plan: Demo Checkpoint

**Branch**: `029-demo-checkpoint-spec` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#139](https://github.com/Trughouse-Holdings/QueuePass/issues/139)

**Input**: Feature specification from `specs/029-demo-checkpoint/spec.md`

## Summary

- **A reset script beside the demo data** (research R1): `backend/src/scripts/demo-reset.ts`, built to
  `backend/dist/scripts/demo-reset.js`, Backend workspace script `demo-reset`. It checks the
  permission and the database host before connecting (R7), checks the migration record, removes every
  row of every table but `_prisma_migrations` in one `TRUNCATE` (R2), loads the demo data through
  `runDemoData` (R5), and prints what it removed and created (R11).
- **The demo state gains a past event** (R5): `runDemoData` creates **Season Opener** at Demo
  Riverside Hall, 7 days before the run, 7:00–10:00 PM local, no tickets; `DemoSummary.past`.
- **Two one-line commands** (R6): Compose, `docker compose exec -e QUEUEPASS_ALLOW_RESET=1 backend
  node backend/dist/scripts/demo-reset.js`; path B, `node scripts/run-host.mjs --demo-reset` (a new
  one-step mode with the Backend's environment).
- **Out**: Keycloak (R4), the in-memory attempt limits (R3), save and restore checkpoints (R8,
  deferred, no control deferred).
- **Tests** (R12, R13): Backend integration (Testcontainers) and unit tests; root script tests for
  `run-host.mjs --demo-reset` and that no Compose file, `.env.example`, or workflow gives the
  permission; the e2e harness loads the demo state through the reset; one browser test of the demo
  state in the apps.
- **Constitution 3.9.1** (R14): roadmap row `029`, on top of PR #140's 3.9.0.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11 and Prisma 6 (Backend);
plain Node ES modules for `scripts/`.

**Primary Dependencies**: none new. The Backend's own services (`LocationsService`, `EventsService`,
`TiersService`, `OrdersService`, `EventImagesService`) through `runDemoData`; `@queuepass/shared` for
time formatting; Node's `URL` for the database address.

**Storage**: PostgreSQL 17. No schema change (data-model.md). One `TRUNCATE … RESTART IDENTITY
CASCADE` over the tables `pg_tables` lists.

**Testing**: Jest with Testcontainers PostgreSQL (Backend integration and unit); `node --test` for
`scripts/test/*.test.mjs`; Playwright against the `qpe2e` Compose stack (`npm run e2e`). Research R12,
R13.

**Target Platform**: a developer's laptop: the Compose stack (path A) or the database and Keycloak in
Docker with the Backend and apps on the host (path B, this machine).

**Project Type**: web application; this feature touches the Backend's scripts, the root scripts, and
the browser test harness. No front end, no API.

**Performance Goals**: the reset within 10 seconds with the address service answering; the wipe under
1 second (SC-002; R9).

**Constraints**: Constitution I (no API change; the reset reaches the database only through the
Backend's own code), II (`docker compose up` unchanged, the reset never in it), IV (the demo data
still goes through the Backend's rules; the past event too), VI (tests first, real PostgreSQL), VIII
(the permission off by default, only on a command line, never in a Compose file; checkpoints
deferred with reasons).

**Scale/Scope**: one new Backend script, one change to the demo data, one new mode in `run-host.mjs`,
one line in `scripts/e2e.mjs`, two root test files, two Backend test files and one changed, one
browser test, the README.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | No API operation; contract untouched (contracts/README.md). The reset is Backend code using the Backend's services; no front end touches the database | Pass |
| II. One command | `docker compose up --build` unchanged, still seeded and usable with no manual step; the reset is a separate, optional command and never part of start-up (FR-003, SC-007); the Keycloak seed untouched | Pass |
| III. Spec-driven | Spec + plan PR with the constitution row (3.9.1, on top of #140), independent review, fresh implementer; commits cite `029` and #139; `fixes #139` only in the implementation PR's description. Shared surface in the spec PR: the constitution (every member approves). The implementation PR touches no shared surface (`backend/package.json` is the workspace's, not the root's; no Compose file, `.env.example`, workflow, `backend/prisma/`, or `packages/shared/` change) | Pass |
| IV. Server-authoritative | Every demo row, the past event included, is made by the Backend's services and their rules; the wipe is one transaction (all or nothing) | Pass |
| V. Least privilege | No role, token, or Keycloak change; the reset is not reachable through the API, only by whoever runs the laptop's containers or host processes | Pass |
| VI. Test-first, real database | Integration tests on Testcontainers PostgreSQL written first (wipe, repeatability, refusals, migration check); guard unit tests; root script tests; a browser test of the demo state; the harness runs the reset on every PR (R12, R13) | Pass |
| VII. Shared look | No front-end change | Pass |
| VIII. Simplicity | One script, no new service, variable file, or dependency; the permission is off unless given on the command line and never set in `docker-compose.yml` (checked by a test); save and restore checkpoints deferred with reasons (R8), no control deferred | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.9.1 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/029-demo-checkpoint/
├── spec.md, plan.md, research.md (R1–R14), data-model.md, quickstart.md (S0–S7)
├── contracts/README.md          # no API change
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
.specify/memory/constitution.md                # 3.9.1, the 029 row (this PR)
README.md                                      # 029 status row, v3.9.1 (this PR); Demo checkpoint section (impl)

backend/
├── package.json                               # "demo-reset": "node dist/scripts/demo-reset.js"
├── src/scripts/demo-data.ts                   # Season Opener; DemoSummary.past; events 5 (R5)
├── src/scripts/demo-reset.ts                  # new: checkResetAllowed, assertMigrated, wipeAppData,
│                                              # runDemoReset, main (R1, R2, R7, R10, R11)
└── test/
    ├── unit/demo-reset-guard.spec.ts          # new: the guard's cases; main never boots when refused
    └── integration/
        ├── demo-reset.e2e-spec.ts             # new: wipe, repeatability, refusals, output, timing
        └── demo-data.e2e-spec.ts              # 5 events, totals.events 4, Season Opener's checks
scripts/
├── run-host.mjs                               # --demo-reset: one step with the Backend's env (R6)
├── e2e.mjs                                    # loads the demo state through the reset (R13)
└── test/
    ├── run-host.test.mjs                      # --demo-reset plan; refused with --demo-data
    └── demo-reset-safety.test.mjs             # new: no Compose file, .env.example, or workflow
                                               # gives the permission or runs the reset
e2e/tests/029-demo-checkpoint.spec.ts          # new: 029 S2
specs/029-demo-checkpoint/quickstart.md        # Automation row S2 → Automated (impl)
```

**Structure Decision**: the reset sits beside the demo data it reuses, in the Backend's `scripts/`,
because only Backend code may write the database and the demo data must go through the Backend's
services. Host-run plumbing stays in `run-host.mjs`, the one place path B's environment is written.
No new module, service, or operation.

## Complexity Tracking

None.
