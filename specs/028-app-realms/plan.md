# Implementation Plan: A Separate Sign-in for Each App

**Branch**: `028-app-realms-spec` (implementation: `028-app-realms-impl`) | **Date**: 2026-11-09 |
**Spec**: [spec.md](spec.md) | **Issue**: [#138](https://github.com/Trughouse-Holdings/QueuePass/issues/138)

**Input**: Feature specification from `specs/028-app-realms/spec.md`

## Summary

Split the one Keycloak realm, `queuepass`, into three, one per app (`queuepass-admin-app`,
`queuepass-customer-app`, `queuepass-booth-app`), because Keycloak keeps one browser session per
realm (research R1, R2). The seed builds the three realms as it builds the shared one today, then
**moves** each existing user into its app's realm through Keycloak's partial import, keeping the
user's subject, so nothing in the QueuePass database changes (R5, R6). Once all 235 users are in
place it turns the old realm off; it never deletes it. The Backend accepts tokens from the three
realms only, each checked against its own realm's keys and issuer, and honours from each realm only
its app's role (R8). Each app's default authority points at its own realm (R9); the sign-in code in
the apps does not change. Constitution 3.9.0 rewrites Principle V for three realms and reserves
`028` (R12).

## Technical Context

**Language/Version**: TypeScript 5 on Node 22 (Backend, seed, apps), as today

**Primary Dependencies**: NestJS + `jose` (Backend token checks), `@keycloak/keycloak-admin-client`
26.7.4 (seed; `realms.partialImport`), `oidc-client-ts` (apps, unchanged), Playwright (e2e).
No new dependency.

**Storage**: Keycloak's own database (realms, users). The QueuePass PostgreSQL schema is
**unchanged**: no migration.

**Testing**: Vitest/Jest unit and integration tests as today (seed against `fake-keycloak.ts`,
Backend against a local key set), one new Playwright spec (`e2e/tests/028-app-realms.spec.ts`).

**Target Platform**: the six-service Compose stack; the host-run path (`scripts/run-host.mjs`).

**Project Type**: web (Backend + three front ends + seed job)

**Performance Goals**: sign-in, renewal and API latency unchanged. The Backend caches one key set
per realm (three small fetches at first use instead of one).

**Constraints**: no front end handles a password; tokens in memory only; nothing deleted from
Keycloak; the move is idempotent and resumable; `main` stays demo-ready (a database made before
this feature keeps working after the update, US3).

**Scale/Scope**: 3 realms, 3 clients, 235 users, as today.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. API-only, contract first | The contract's authentication text and `Me.roles` description change in this PR (no operation, schema shape or error code changes); `api-schema.ts` regenerated | ✅ |
| II. One command | `docker compose up --build` still builds, seeds (now three realms) and starts everything from a clean clone; the move runs inside the same seed | ✅ |
| III. Spec-driven | Issue #138 → this spec PR → implementation PR by a fresh session, each independently reviewed | ✅ |
| IV. Server-authoritative | Role per realm enforced by the Backend's guard, not the apps | ✅ |
| V. Sign-in everywhere | **Amended (3.9.0)**: one realm per app; tokens from the three realms only; one role per realm; logout ends the app's own Keycloak session. Every other rule (PKCE, memory-only tokens, 401/403, wrong-role page) unchanged | ✅ after amendment |
| VI. Test-first, real database | Tests written first per story (tasks); the e2e test runs against the real stack in CI | ✅ |
| VII. One shared look | Sign-in pages unchanged (same theme and display name per realm) | ✅ |
| VIII. Staged simplicity | No subject-per-realm database change (R7); no single sign-out across apps; old realm kept, not migrated further | ✅ |
| Security and Data Constraints | Same accounts, roles, password, client settings (public, PKCE S256, exact URIs, no password grant), now per realm; amended to say which realm holds which accounts | ✅ after amendment |
| Shared surface | Constitution, contract, `packages/shared`, `docker-compose.yml`, `.env.example`: every team member approves both PRs | ⚠️ needs Nate |

## Project Structure

### Documentation (this feature)

```text
specs/028-app-realms/
├── spec.md               # the feature
├── research.md           # R1–R12: the bug, the probes, the decisions
├── plan.md               # this file
├── data-model.md         # realms, users, the move, Backend configuration
├── quickstart.md         # S0–S7 and the Automation table
├── contracts/README.md   # what the contract change is (text only)
├── checklists/requirements.md
└── tasks.md              # T001–…
```

### Source Code (repository root)

```text
packages/shared/src/
├── realms.ts                    # NEW: APP_REALMS (app → realm, client, role), LEGACY_REALM
└── index.ts                     # exports realms.ts

scripts/seed/src/
├── index.ts                     # per realm: realm, users, clients; then the move's last step
├── keycloak-client.ts           # loadConfig without KEYCLOAK_REALM
├── provision-realm.ts           # provisionRealm(kc, realm, role) for each app realm
├── provision-users.ts           # users of one realm through partialImport (moved or new, R5)
├── provision-clients.ts         # one client and the audience scope in its own realm
└── retire-legacy-realm.ts       # NEW: read the shared realm's users; turn it off when done (R6)
scripts/seed/test/               # fake-keycloak: partialImport, realm enable, several realms

backend/src/auth/
├── jwks.provider.ts             # OIDC_ISSUER_BASE, OIDC_JWKS_BASE; a key set per realm
└── auth.guard.ts                # realm from `iss`, verify with that realm, keep its role only
backend/test/setup/              # a key pair and issuer per realm; tokenFor picks the realm by role

admin-app/Dockerfile, customer-app/Dockerfile, booth-app/Dockerfile   # default authority per app
docker-compose.yml, .env.example, scripts/run-host.mjs                # new env, per-app authority
contracts/openapi.yaml, packages/shared/src/api-schema.ts             # text only (this PR)
e2e/tests/028-app-realms.spec.ts                                      # NEW
e2e/fixtures/backdrop.ts, e2e/tests/027-sign-in-background.spec.ts    # realm paths
README.md                                                             # URLs, realms
```

**Structure Decision**: no new package or service. The realm table lives once in
`packages/shared` because the seed, the Backend and the tests all need it (R4).

## Order of work

1. `packages/shared/src/realms.ts` (the table everything else reads).
2. Backend token checks (tests first), so the Backend accepts the new realms before any app uses
   them.
3. Seed: three realms, users through partial import, the move, turning the old realm off (tests
   first against the fake).
4. Configuration: compose, `.env.example`, Dockerfiles, `run-host.mjs`.
5. e2e: the new spec, and the realm paths in the existing ones.
6. README, quickstart walk on a database made before the feature (US3), and the fresh-clone gate.

## Complexity Tracking

| Choice | Why | Simpler alternative rejected because |
|---|---|---|
| Three realms instead of one | Keycloak has one browser session per realm (R1, R2) | One realm with per-app tokens: observed not to work (R2) |
| A move through partial import | Keeps every subject QueuePass already stores (R5) | Fresh users in new realms: cuts customers off from their orders |
| The old realm turned off, not deleted | FR-007; reversible | Deleting it: irreversible, and nothing needs it gone |
