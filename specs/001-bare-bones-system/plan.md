# Implementation Plan: Bare-Bones QueuePass System

**Branch**: `001-bare-bones-system` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-bare-bones-system/spec.md`

## Summary

Bring the whole QueuePass system up under one `docker compose up --build`: PostgreSQL, Keycloak,
the NestJS Backend, the Admin, Customer, and Ticket Booth apps, and a one-shot seed job. Make
sign-in real everywhere:

- The seed converges three public OIDC clients (PKCE only, no password grant) and an audience
  scope, so every front-end token names `queuepass-api` (research R5, R6).
- The Backend verifies each token with `jose` against the realm's JWKS (signature, issuer,
  audience, expiry) through a global guard, and enforces roles with a second guard (R3). Keycloak
  is pinned to one public hostname, so tokens issued through the browser validate inside Docker
  (R4).
- Each front end signs in with `oidc-client-ts` (Authorization Code + PKCE), keeps tokens in
  memory only, shows a hello-world page built from the Backend's role-specific greeting, refuses
  the wrong role, and logs out of Keycloak too (R1, R2).

The existing venue and event endpoints and Admin screens are kept but brought under the new token
and role rules, and declared in the new root contract `contracts/openapi.yaml`. Their redesign
remains feature `002` (R14).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**:
- Backend: NestJS 11, Prisma 6 (unchanged), `jose` 5 (JWT and JWKS), `swagger-ui-express`,
  `yaml`
- Front ends: React 19, Vite 6, React Router 7, `oidc-client-ts` 3, `openapi-fetch`
- Seed: `@keycloak/keycloak-admin-client` 26 (existing)
- Contract tooling: `openapi-typescript` (type generation), `ajv` 8 (2020-12) and
  `ajv-formats` (response validation)
- Serving: `nginx:alpine` for the three front ends

**Storage**: PostgreSQL 17, unchanged. `001` adds no tables or migrations. Identities live in
Keycloak's own volume.

**Testing**:
- Backend: Jest + Supertest + Testcontainers (real PostgreSQL), with tokens signed by a generated
  RS256 key pair (R11) and contract validation on every response (R7)
- Front ends and `packages/shared/web`: Vitest + React Testing Library with `UserManager` mocked
  (R17)
- Seed: Vitest against the running Keycloak (R15)
- Boundary and contract-drift checks as scripts run by `npm test` (R8, R12)

**Target Platform**: A developer laptop running Docker Desktop, with a modern desktop browser

**Project Type**: Web system: one REST API and three single-page front ends in an npm-workspaces
monorepo

**Performance Goals**: None beyond responsive local use. SC-001 (under 15 minutes, clean clone
to all healthy) bounds build and seed time.

**Constraints**:
- No token or password in persistent browser storage (FR-011, SC-008).
- No password grant on any front-end client (FR-005, FR-010).
- Every endpoint except `/health` needs a valid token, and no bypass flag exists (FR-018,
  FR-026).
- The contract is written by hand and never generated from code (R7).
- No new database tables (data-model §1).

**Scale/Scope**: 7 containers, 15 API operations (5 new, 10 carried over), 3 front ends, 3 OIDC
clients, 235 seeded identities

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution **v2.0.0**.

| Principle | Gate | Pre | Post | Evidence |
|---|---|---|---|---|
| **I. API-Only Boundary, Contract First** | Front ends use only the REST API; contract before code; conformance tested; one error shape | PASS | **PASS** | Root `contracts/openapi.yaml` declares all 15 operations, with `x-required-roles`, and passes `redocly lint`. Response validation plus route and role coverage (R7). Front ends use generated types (R8). The boundary check runs first in `npm test` (R12). `UNAUTHENTICATED` and `FORBIDDEN` join the one `ErrorEnvelope` (R13). |
| **II. One Repo, One Command** | Six services and the seed from `docker compose up --build`; health-gated startup; mapped volume; idempotent seed | PASS | **PASS** | Every service has a health check. Front ends wait on `backend: service_healthy` and `seed: service_completed_successfully` (R10). The seed updates clients in place (R6). |
| **III. Spec-Driven, by PR** | Spec PR, then plan PR, then implementation PR | **FAIL** | **FAIL** | The project is not yet a git repository, so no PR can be opened. See *Complexity Tracking*. The artifacts themselves follow the three-stage order. |
| **IV. Server-Authoritative, DB-Guaranteed** | Rules in the Backend; concurrency rules in the database | PASS | **PASS** | Roles are enforced by Backend guards, never only by UI (R3). The existing `event_no_overlap` exclusion constraint is untouched. |
| **V. Sign-In Everywhere, Least Privilege** | Login and logout everywhere; PKCE; memory-only tokens; JWT validated on every non-health endpoint; `401` vs `403`; one role per app | PASS | **PASS** | `oidc-client-ts` with in-memory user store (R1); logout clears memory then ends the Keycloak session (R2); global `jose` guard with issuer, audience, and expiry (R3); roles guard (R3); one role per app (data-model §1). |
| **VI. Test-First, Real Database** | Tests before code; Testcontainers; signed test tokens for every refused case; `npm test`; running-system smoke test | PASS | **PASS** | Seven refused-token cases, each made with a real key (R11). The seed test no longer silently skips (R15). The manual round trip is in [quickstart.md](./quickstart.md) V3–V6. `tasks.md` will put each story's tests before its code. |
| **VII. Function Over Finish** | Stub front ends, no styling effort | PASS | **PASS** | The hello-world page is plain semantic HTML. The Admin app's existing stylesheet is kept, not extended. |
| **VIII. Staged Simplicity** | Nothing beyond the spec; deferrals recorded; no bypass | PASS | **PASS** | No new venue or event features and no delete controls (those are `002`). Carried-over code only gets what FR-018 and FR-027 force (R14). Tests sign real tokens, so there is no bypass (R3). |

**Language and Stack**: every choice falls within the constitution's table. `oidc-client-ts` is
the standards-based OIDC library and `jose` the standards-based JOSE library it requires.
`openapi-fetch`, `openapi-typescript`, `ajv`, and nginx are implementation details, not stack
changes.

**Result**: one gate fails (III), for a reason outside the plan's control. It is recorded in
*Complexity Tracking* and must be closed before the spec is treated as merged.

## Project Structure

### Documentation (this feature)

```text
specs/001-bare-bones-system/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R17
├── data-model.md        # Keycloak configuration, token claims, session states
├── quickstart.md        # V1–V9, the running-system gate
├── contracts/README.md  # points to /contracts/openapi.yaml
└── tasks.md             # /speckit-tasks output (not created by /speckit-plan)
```

### Source Code (repository root)

New paths are marked `+`, and changed ones `~`.

```text
contracts/
└── + openapi.yaml               # THE API contract (shared surface)

backend/
├── ~ Dockerfile                 # unchanged build; healthcheck added in compose
├── src/
│   ├── ~ main.ts                # CORS from CORS_ORIGINS; /docs from contracts/openapi.yaml
│   ├── ~ app.module.ts          # AuthModule, MeModule, HelloModule; APP_GUARD x2
│   ├── + auth/                  # jwks.provider, auth.guard, roles.guard,
│   │                            #   public.decorator, roles.decorator, principal.ts
│   ├── + me/                    # GET /me
│   ├── + hello/                 # GET /hello/{admin,customer,booth}
│   ├── ~ health/                # @Public()
│   ├── ~ locations/  ~ events/  # @Roles('queuepass-admin') on writes, nothing else changes
│   └── ~ common/filters/        # 401 → UNAUTHENTICATED, 403 → FORBIDDEN (R13)
└── test/
    ├── ~ setup/                 # + keys.ts (RS256 pair), + tokens.ts (tokenFor),
    │                            #   ~ test-app.ts (local JWKS), + authed-request.ts
    ├── + contract/              # expect-to-match-contract.ts, route-coverage.e2e-spec.ts
    └── integration/             # + auth.*, + me.*, + hello.* specs;
                                 #   ~ 15 existing specs send an admin token, + wrong-role cases

packages/shared/                 # @queuepass/shared
├── src/
│   ├── ~ errors.ts              # + UNAUTHENTICATED, FORBIDDEN
│   ├── + api-schema.ts        # GENERATED from contracts/openapi.yaml
│   └── + web/                   # @queuepass/shared/web (React peer dependency)
│       ├── auth-provider.tsx    #   UserManager with InMemoryWebStorage, pageshow re-check
│       ├── require-role.tsx     #   loading / wrong-role / signed-in gate
│       ├── hello-page.tsx       #   greeting from the app's /hello operation
│       ├── logout-button.tsx    #   removeUser, then signoutRedirect
│       ├── service-unreachable.tsx
│       └── api-client.ts        #   openapi-fetch + Bearer token
└── test/web/                    # the shared sign-in behavior, tested once

admin-app/
├── ~ Dockerfile  + nginx.conf   # vite build → nginx:alpine; SPA fallback; /health
├── ~ src/main.tsx               # AuthProvider(admin-app) + RequireRole(queuepass-admin)
├── ~ src/App.tsx                # "/" is the hello page; existing routes kept; logout in header
├── ~ src/api/*.ts               # rebuilt on the shared typed client (R14)
└── test/                        # + sign-in tests; ~ existing tests supply a mocked user

+ customer-app/  + booth-app/    # same shape as admin-app; hello page only
├── Dockerfile  nginx.conf  index.html  package.json  vite.config.ts  tsconfig.json
├── src/main.tsx
└── test/

scripts/
├── seed/src/  + provision-clients.ts   ~ index.ts
├── seed/test/ ~ seed-idempotence.test.ts   # health on :9000; client assertions (R15)
├── + check-boundary.mjs                    # R12
└── + check-contract-drift.mjs              # R8

~ docker-compose.yml             # KC_HOSTNAME*, backend OIDC_* and CORS_ORIGINS, healthchecks,
                                 #   + customer-app, + booth-app, front ends wait on seed
~ .env.example                   # + OIDC_ISSUER, OIDC_JWKS_URL, OIDC_AUDIENCE, CORS_ORIGINS,
                                 #   VITE_OIDC_AUTHORITY
~ package.json                   # workspaces + customer-app, booth-app; test runs checks first
~ README.md                      # status table moves 001 to built
```

**Structure Decision**: The existing npm-workspaces monorepo, extended to exactly the workspaces
the constitution lists. The three front ends are thin shells over `@queuepass/shared/web`, so
features `002` and `003` each grow one app's `src/` without touching the others. The contract
moves to the repository root because the constitution makes it shared surface.

## Complexity Tracking

| Item | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| **Gate III fails: no git repository, so no PRs** | The project folder is not under version control. | There is no simpler compliant path. **To close**: `git init`, commit a baseline, then open the spec PR (constitution v2.0.0 and the three specs) and this plan PR against it. The assignment also asks for a new queuepass repository. Decide whether that is this folder or `../queuepass` before opening PRs. |
| Separate issuer and JWKS URLs in the Backend config | Tokens are issued to `localhost:8080`, but keys are fetched over the Compose network (R4). | A single URL fails either inside Docker or in the browser. |
| A redirect back to Keycloak on every page reload | Memory-only tokens (Constitution V) do not survive a reload (R1). | `sessionStorage` would avoid the redirect but violates the constitution. The redirect needs no login prompt while the SSO session is live. |
| Carried-over venue and event code in a "bare-bones" feature | FR-018 and FR-027 require every existing endpoint to be protected and declared (R14). | Deleting it loses unversioned work. Leaving it open lets customers change venues. |
| Route and role coverage test | SC-009 requires every endpoint in the contract with the right roles. | Response validation alone cannot catch an undocumented endpoint or a missing `@Roles`. |
