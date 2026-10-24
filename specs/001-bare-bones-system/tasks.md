---
description: "Task list for Bare-Bones QueuePass System"
---

# Tasks: Bare-Bones QueuePass System

**Input**: Design documents from `specs/001-bare-bones-system/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml), [quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first.** Spec FR-030 through FR-035 require automated tests,
and Constitution VI makes test-first mandatory. Within each story phase, write every test task
and run it to confirm it **fails** before starting the implementation tasks below it.

**Organization**: Tasks are grouped by user story, so each story can be built and verified as an
increment. IDs are in execution order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1, US2, US3)
- Every task names its exact file paths, relative to the repository root.

## Ground rules for whoever implements these tasks

- The authoritative API is [`contracts/openapi.yaml`](../../contracts/openapi.yaml). Never change
  a response shape to make a test pass. Change the contract in a reviewed PR first.
- **No auth bypass of any kind**: no `AUTH_DISABLED` flag, no `NODE_ENV === 'test'` branch in
  the guards. Tests sign real tokens (research R11).
- Tokens **never** go into `localStorage` or `sessionStorage` (Constitution V, FR-011).
- Do not add venue or event features, delete controls, or new database tables. Those are `002`
  (research R14).
- Ports are fixed: Backend 3000, Admin 5173, Customer 5174, Booth 5175, Keycloak 8080 (health on
  9000), PostgreSQL 5432 (research R16).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspaces, dependencies, and configuration that every story needs.

- [X] T001 Add `customer-app` and `booth-app` to `workspaces` in `package.json` (after `admin-app`), and change the root `test` script to `node scripts/check-boundary.mjs && node scripts/check-contract-drift.mjs && npm run test --workspace @queuepass/shared && npm run test --workspace @queuepass/backend && npm run test --workspace @queuepass/admin-app && npm run test --workspace @queuepass/customer-app && npm run test --workspace @queuepass/booth-app && npm run test --workspace @queuepass/seed`. Add a `generate:api` script: `openapi-typescript contracts/openapi.yaml -o packages/shared/src/api-schema.ts`. Add root devDependencies `openapi-typescript@^7` and `yaml@^2`.
- [X] T002 [P] Add Backend dependencies in `backend/package.json`: `jose@^5`, `swagger-ui-express@^5`, `yaml@^2`; devDependencies `ajv@^8`, `ajv-formats@^3`, `@types/swagger-ui-express`.
- [X] T003 [P] Add `oidc-client-ts@^3` and `openapi-fetch@^0.13` as dependencies, and `react@^19`, `react-dom@^19`, `react-router-dom@^7` as **peerDependencies**, in `packages/shared/package.json`. Add devDependencies `vitest@^3.2.7`, `jsdom@^25`, `@testing-library/react@^16`, `@testing-library/jest-dom@^6`, `@testing-library/user-event@^14`, `@types/react@^19`, `@types/react-dom@^19`, `@vitejs/plugin-react@^4`, and a `"test": "vitest run"` script. Add an export `"./web": "./src/web/index.ts"` to `exports`. Front ends consume `web` as TypeScript source through a Vite alias, and the Backend never imports it.
- [X] T004 [P] Exclude `src/web/**` from `packages/shared/tsconfig.build.json` and `packages/shared/tsconfig.build.esm.json` (add `"exclude": ["src/web/**"]`), so the Backend's build of `@queuepass/shared` needs no React. Add `"jsx": "react-jsx"` and `"lib": ["ES2022", "DOM"]` to `packages/shared/tsconfig.json`. Add `packages/shared/vitest.config.ts` (jsdom, `setupFiles: ['./test/setup.ts']`, include `test/**/*.test.{ts,tsx}`) and `packages/shared/test/setup.ts` importing `@testing-library/jest-dom/vitest`.
- [X] T005 [P] Add to `.env.example`, under a new `# --- Sign-in (OIDC) ---` section: `OIDC_ISSUER=http://localhost:8080/realms/queuepass`, `OIDC_JWKS_URL=http://keycloak:8080/realms/queuepass/protocol/openid-connect/certs`, `OIDC_AUDIENCE=queuepass-api`, `CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5175`, `VITE_OIDC_AUTHORITY=http://localhost:8080/realms/queuepass`. Keep the existing entries.
- [X] T006 Run `npm install` at the repository root and commit the updated `package-lock.json`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The contract types, error codes, and test harness that all three stories build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Add `'UNAUTHENTICATED'` and `'FORBIDDEN'` to the start of `ERROR_CODES` in `packages/shared/src/errors.ts`, and change the file's header comment to reference `contracts/openapi.yaml` instead of the old spec path (research R13).
- [X] T008 Add `export const QUEUEPASS_ROLES = ['queuepass-admin', 'gate-agent', 'customer'] as const;` and `export type Role = (typeof QUEUEPASS_ROLES)[number];` in a new `packages/shared/src/roles.ts`, and re-export it from `packages/shared/src/index.ts`.
- [X] T009 Run `npm run generate:api` to create `packages/shared/src/api-schema.ts` from `contracts/openapi.yaml`, and re-export its `paths` and `components` types from `packages/shared/src/index.ts` as `ApiPaths` and `ApiComponents`.
- [X] T010 [P] Create `scripts/check-contract-drift.mjs`: run `openapi-typescript` on `contracts/openapi.yaml` into a temporary file, compare it byte for byte with `packages/shared/src/api-schema.ts`, and exit 1 with the message `api-schema.ts is out of date: run npm run generate:api` if they differ (research R8).
- [X] T011 [P] Create `scripts/check-boundary.mjs`: for each of `admin-app`, `customer-app`, `booth-app`, fail (exit 1, naming the file and match) if `package.json` lists any of `@prisma/client`, `prisma`, `pg`, `postgres`, `mysql2`, `typeorm`, `sequelize`, `knex` in any dependency field, or if any file under `src/` contains `DATABASE_URL`, `postgres://`, `postgresql://`, or `@prisma/client`. Skip an app whose directory does not exist yet (research R12, FR-033).
- [X] T012 [P] Create `backend/test/setup/keys.ts`: generate an RS256 key pair with `jose`'s `generateKeyPair('RS256')` once per Jest worker, export the public JWK with `kid: 'test-key'`, and also export a second, **unpublished** key pair (`kid: 'rogue-key'`) for the unknown-key case (research R11).
- [X] T013 Create `backend/test/setup/tokens.ts` exporting `tokenFor({ username, roles, sub?, iss?, aud?, expiresIn?, key? })`. It signs with `SignJWT`, sets `preferred_username`, `sub` (default a stable UUID per username), `realm_access: { roles }`, `iss` (default `http://localhost:8080/realms/queuepass`), `aud` (default `queuepass-api`), `iat`, and `exp` (default 5 minutes ahead). Also export `ADMIN`, `CUSTOMER`, and `AGENT` presets for `admin1`, `customer1`, and `agent1` (depends on T012).
- [X] T014 Create `backend/test/contract/expect-to-match-contract.ts`: load `contracts/openapi.yaml` with `yaml`, compile each operation's response schema for the returned status using `Ajv2020` plus `ajv-formats` (resolving `$ref`s against `components`), and export `expectToMatchContract(res, operationId)`. It throws when the status is not declared for that operation, or when the body fails the schema. A `204` must have an empty body (research R7, FR-031).

**Checkpoint**: Types, error codes, key pair, token helper, and contract helper exist. Stories can start.

---

## Phase 3: User Story 1 — Bring Up the Whole System with One Command (Priority: P1) 🎯 MVP

**Goal**: One `docker compose up --build` starts all six services and the seed. Keycloak holds 235 accounts, three OIDC clients, and the audience scope. Each front end's URL answers.

**Independent Test**: [quickstart.md](./quickstart.md) V1, V2, and V9. From a clean clone, all six services report healthy, `seed` exits 0, a rerun changes nothing, and a restart keeps data.

### Tests for User Story 1 (write first, confirm they fail)

- [X] T015 [US1] Fix the health probe in `scripts/seed/test/seed-idempotence.test.ts`: use `process.env.KEYCLOAK_HEALTH_URL ?? 'http://localhost:9000'` + `/health/ready` instead of the 8080 URL, so the test runs whenever Keycloak is up (research R15).
- [X] T016 [US1] Add client assertions to `scripts/seed/test/seed-idempotence.test.ts` (FR-005, FR-006, FR-034). After running `seed()` twice, assert:
  - exactly one client scope named `queuepass-api` exists, holding one `oidc-audience-mapper` with `included.custom.audience = queuepass-api` and `access.token.claim = "true"`;
  - clients `admin-app`, `customer-app`, and `booth-app` each exist exactly once, with `publicClient: true`, `standardFlowEnabled: true`, `directAccessGrantsEnabled: false`, `implicitFlowEnabled: false`, `serviceAccountsEnabled: false`, `attributes['pkce.code.challenge.method'] === 'S256'`, `redirectUris` equal to `['http://localhost:<port>/']`, `webOrigins` equal to `['http://localhost:<port>']`, and `attributes['post.logout.redirect.uris'] === 'http://localhost:<port>/'` (exact, no wildcard; amended by #60, research R6), where the port is 5173, 5174, or 5175;
  - each client's default client scopes include `queuepass-api` and `roles`;
  - each client's internal `id` is unchanged between the two runs.
  - each client's `attributes['use.refresh.tokens'] === 'true'`, since renewal relies on the
    refresh token (research R6, #60).

  Also, in `scripts/seed/test/provision-clients.test.ts` (a unit test, no Keycloak), assert the
  same exact URIs and refresh-token setting for each client's desired settings, and that no
  URI contains `*` (amended by #60).
- [X] T017 [P] [US1] Add a drift-repair test in `scripts/seed/test/seed-idempotence.test.ts`: set `admin-app`'s `directAccessGrantsEnabled` to `true` through the admin client, run `seed()`, and assert it is `false` again (research R6). Likewise set all three clients'
  redirect and post-logout URIs back to `http://localhost:<port>/*`, run `seed()`, and assert the
  exact lists are restored (amended by #60).

### Implementation for User Story 1

- [X] T018 [US1] Create `scripts/seed/src/provision-clients.ts` exporting `FRONTEND_CLIENTS` (`admin-app` 5173, `customer-app` 5174, `booth-app` 5175) and `provisionClients(kc)`. It:
  1. finds or creates client scope `queuepass-api` (`protocol: 'openid-connect'`) and ensures it holds exactly one protocol mapper `queuepass-api-audience` of type `oidc-audience-mapper`, with config `{ 'included.custom.audience': 'queuepass-api', 'access.token.claim': 'true', 'id.token.claim': 'false' }`;
  2. for each front-end client, looks it up by `clientId`, creates it if absent, or **updates** it to the settings asserted in T016 (never deletes and recreates);
  3. adds `queuepass-api` and `roles` as default client scopes on each client if missing.

  Log one `[seed]` line per created or updated item, matching `provision-realm.ts`.
- [X] T019 [US1] Call `provisionClients(kc)` after `provisionUsers(kc)` in `scripts/seed/src/index.ts`, and extend the final log line to `… 235 principals (…) and 3 clients`.
- [X] T020 [P] [US1] Create `admin-app/nginx.conf`: `listen 5173`; `root /usr/share/nginx/html`; `location = /health { default_type application/json; return 200 '{"status":"ok"}'; }`; `location / { try_files $uri /index.html; }`; and response headers `Cache-Control: no-store` for `index.html` (so the back button refetches after logout) and `X-Content-Type-Options: nosniff` (research R10).
- [X] T021 [US1] Rewrite `admin-app/Dockerfile` as two stages. The build stage keeps the existing deps and build steps, takes `ARG`s `VITE_API_BASE_URL`, `VITE_OIDC_AUTHORITY`, and `VITE_OIDC_CLIENT_ID=admin-app`, and additionally copies `contracts/`, `customer-app/package.json`, and `booth-app/package.json` so `npm ci` sees every workspace. The runtime stage is `FROM nginx:alpine`, copies `admin-app/dist` to `/usr/share/nginx/html` and `admin-app/nginx.conf` to `/etc/nginx/conf.d/default.conf`, and exposes 5173. Remove the `vite preview` command (depends on T020).
- [X] T022 [P] [US1] Scaffold `customer-app/` as a copy of the Admin app's build setup, without its pages: `package.json` (name `@queuepass/customer-app`, same scripts and devDependencies as `admin-app/package.json`, dependencies `@queuepass/shared`, `react`, `react-dom`, `react-router-dom`), `index.html` (title `QueuePass`), `tsconfig.json`, `vite.config.ts` (port 5174, and aliases `@queuepass/shared` → `../packages/shared/src/index.ts` and `@queuepass/shared/web` → `../packages/shared/src/web/index.ts`), `vitest.config.ts` (same aliases), `test/setup.ts`, `nginx.conf` (as T020, but `listen 5174`), `Dockerfile` (as T021, with `VITE_OIDC_CLIENT_ID=customer-app` and port 5174), and a placeholder `src/main.tsx` that renders `<h1>QueuePass</h1>`. US2 replaces it.
- [X] T023 [P] [US1] Scaffold `booth-app/` exactly as T022, with name `@queuepass/booth-app`, title `QueuePass Ticket Booth`, port 5175, and `VITE_OIDC_CLIENT_ID=booth-app`.
- [X] T024 [US1] Update `backend/Dockerfile` and `scripts/seed/Dockerfile` so their deps stage also copies `customer-app/package.json` and `booth-app/package.json`, and the Backend build stage copies `contracts/` into the image at `/app/contracts` (needed for `/docs` in US3).
- [X] T025 [US1] Update `docker-compose.yml`:
  - **keycloak**: add `KC_HOSTNAME: http://localhost:8080` and `KC_HOSTNAME_BACKCHANNEL_DYNAMIC: 'true'` (research R4).
  - **backend**: add `OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_AUDIENCE`, and `CORS_ORIGINS`, using the `.env.example` defaults via `${VAR:-default}`; add `keycloak: condition: service_healthy` to `depends_on`; add healthcheck `['CMD-SHELL', 'wget -qO- http://127.0.0.1:3000/health || exit 1']` (interval 5s, retries 30, start_period 20s).
  - **admin-app**: pass build args `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID: admin-app`; set `depends_on` to `backend: service_healthy` and `seed: service_completed_successfully`; add healthcheck `wget -qO- http://127.0.0.1:5173/health`.
  - **customer-app** (5174) and **booth-app** (5175): new services, built like admin-app with their own client IDs, ports, dependencies, and healthchecks.
  - Update the header comment to "six services plus a one-shot seed job".
- [X] T026 [US1] Run [quickstart.md](./quickstart.md) V1 and V2 against the real stack (`docker compose down -v && docker compose up --build -d`), and confirm T015–T017 now pass with `npm test --workspace @queuepass/seed`.

**Checkpoint**: The whole system comes up. The front ends show placeholders, and the Backend is still open. US1 is independently verified.

---

## Phase 4: User Story 3 — The Backend Trusts Only Valid, Correctly Scoped Tokens (Priority: P3)

> Implemented **before** US2: the hello-world pages of US2 call the greeting endpoints this story
> creates. US2's component tests mock the API, so US2 can still be built in parallel. Only its
> end-to-end check (T059) needs this phase.

**Goal**: Every endpoint except `/health` refuses a request without a valid token for `queuepass-api`. Role-restricted endpoints refuse the wrong role with `403`. `/me` and the three greetings exist. The existing venue and event endpoints are protected and match the contract.

**Independent Test**: [quickstart.md](./quickstart.md) V6 and V7, plus `npm test --workspace @queuepass/backend`.

### Tests for User Story 3 (write first, confirm they fail)

- [X] T027 [US3] Update `backend/test/setup/test-app.ts`: override the JWKS provider token (`JWKS`, defined in T036) with `createLocalJWKSet({ keys: [publicJwk] })` from T012, and set `process.env.OIDC_ISSUER`, `OIDC_AUDIENCE`, and `CORS_ORIGINS` to the `.env.example` values before compiling the module.
- [X] T028 [US3] Create `backend/test/setup/authed-request.ts` exporting `as(app, token)`, a small Supertest wrapper whose `get`, `post`, `patch`, and `delete` set `Authorization: Bearer <token>`, and `asAdmin(app)` using `tokenFor(ADMIN)` (depends on T013).
- [X] T029 [US3] Update every existing spec in `backend/test/integration/` (`events.*.e2e-spec.ts`, `locations.*.e2e-spec.ts`, and `health.e2e-spec.ts`) to send requests through `asAdmin(app)` instead of bare `request(app.getHttpServer())`. `health.e2e-spec.ts` stays unauthenticated. After the change, add `expectToMatchContract(res, '<operationId>')` to each response assertion. Do not change any expected status or body.
- [X] T030 [P] [US3] Create `backend/test/integration/auth.e2e-spec.ts` covering FR-018, FR-019, and FR-030 against `GET /me`. Each of these must return `401`, with `error.code === 'UNAUTHENTICATED'`, header `www-authenticate: Bearer`, and a body matching the contract's `Unauthenticated` response:
  - no header;
  - `Bearer not-a-jwt`;
  - a token signed with the rogue key;
  - `exp` 5 minutes in the past;
  - `iss: 'http://localhost:8080/realms/other'`;
  - `aud: 'account'`;
  - a token with `alg: 'HS256'` (signed with a shared secret);
  - `Basic` scheme instead of `Bearer`.

  Also assert that a token expired by 10 seconds is **accepted** (within the 30-second tolerance), and that the `401` message is identical in every case.
- [X] T031 [P] [US3] Create `backend/test/integration/me.e2e-spec.ts` (FR-020, FR-022). With `tokenFor({ username: 'admin1', roles: ['queuepass-admin', 'offline_access', 'uma_authorization'] })`, assert that `GET /me` returns `200` with `{ sub, username: 'admin1', roles: ['queuepass-admin'] }` (non-QueuePass roles filtered out) and matches `getMe`. A token with no `realm_access` claim returns `roles: []`. A request with header `X-User: admin1` and no token is still `401`.
- [X] T032 [P] [US3] Create `backend/test/integration/hello.e2e-spec.ts` (FR-021, FR-023). For each of `/hello/admin` (`queuepass-admin`, `appName: 'QueuePass Admin'`), `/hello/customer` (`customer`, `appName: 'QueuePass'`), and `/hello/booth` (`gate-agent`, `appName: 'QueuePass Ticket Booth'`):
  - the right role gets `200`, a `Hello` body whose `username` is the caller and whose `message` contains both the username and `appName`, matching the contract;
  - each of the other two roles gets `403` with `error.code === 'FORBIDDEN'` and `details.requiredRoles`;
  - no token gets `401`.

  A user holding two roles can call both of their greetings.
- [X] T033 [P] [US3] Create `backend/test/integration/carried-over.authz.e2e-spec.ts` (R14). For each carried-over write (`createLocation`, `updateLocation`, `deleteLocation`, `createEvent`, `updateEvent`, `deleteEvent`), assert `403 FORBIDDEN` for `CUSTOMER` and `AGENT` tokens, with the database row count unchanged afterwards. For each carried-over read (`listLocations`, `getLocation`, `listEvents`, `getEvent`), assert `200` for `CUSTOMER` and `AGENT`. Every carried-over operation returns `401` with no token.
  *Renamed to `venues-events.authz.e2e-spec.ts` by spec 002 T026.*
- [X] T034 [P] [US3] Create `backend/test/contract/route-coverage.e2e-spec.ts` (FR-027, SC-009). Using Nest's `DiscoveryService` and `Reflector` on the test app, collect every (HTTP method, path) pair with its `@Public()` and `@Roles()` metadata. Convert `:id` to `{id}`. Assert:
  - the set equals the set of operations in `contracts/openapi.yaml`, reporting extras on either side;
  - an operation with `x-required-roles: public` is exactly a `@Public()` handler;
  - `[]` means neither `@Public()` nor `@Roles()`;
  - a role list equals the handler's `@Roles()` list.
- [X] T035 [P] [US3] Create `backend/test/integration/cors-docs.e2e-spec.ts` (FR-024, FR-027):
  - `GET /health` with `Origin: http://localhost:5174` returns `access-control-allow-origin: http://localhost:5174`;
  - with `Origin: http://evil.example`, the header is absent;
  - a preflight `OPTIONS /me` from `http://localhost:5173`, with `Access-Control-Request-Headers: authorization`, is allowed;
  - `GET /docs` returns `200` HTML with **no** token (served as public documentation);
  - `GET /docs/openapi.yaml` returns the committed contract byte for byte.

  **Note**: this adds `/docs` and `/docs/openapi.yaml` as public non-API routes. Mount them through `swagger-ui-express` in `main.ts` and `test-app.ts`, not as Nest controllers, so they fall outside route coverage (T034).

### Implementation for User Story 3

- [X] T036 [US3] Create `backend/src/auth/jwks.provider.ts`: export injection token `JWKS` and a provider whose factory returns `createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URL))`, with `cooldownDuration: 30_000` and `timeoutDuration: 5_000`. Throw at startup if `OIDC_JWKS_URL`, `OIDC_ISSUER`, or `OIDC_AUDIENCE` is unset (research R3).
- [X] T037 [P] [US3] Create `backend/src/auth/public.decorator.ts` (`IS_PUBLIC_KEY`, `Public()`), `backend/src/auth/roles.decorator.ts` (`ROLES_KEY`, `Roles(...roles: Role[])`, importing `Role` from `@queuepass/shared`), and `backend/src/auth/principal.ts` (the `Principal` interface from [data-model.md §2](./data-model.md), and a `@CurrentPrincipal()` param decorator reading `request.principal`).
- [X] T038 [US3] Create `backend/src/auth/auth.guard.ts`, a `CanActivate` that:
  1. returns `true` for `@Public()` handlers;
  2. requires `Authorization: Bearer <token>`;
  3. calls `jwtVerify(token, jwks, { issuer: OIDC_ISSUER, audience: OIDC_AUDIENCE, algorithms: ['RS256'], clockTolerance: 30 })`;
  4. requires string `sub` and `preferred_username` claims;
  5. sets `request.principal = { sub, username, roles }`, with roles taken from `realm_access.roles` filtered by `QUEUEPASS_ROLES`.

  On any failure, it logs the reason at `warn` (never the token) and throws `UnauthorizedException('A valid access token is required.')`.
- [X] T039 [US3] Create `backend/src/auth/roles.guard.ts`: read `@Roles()` metadata. If absent, allow. Otherwise, if `request.principal.roles` shares no role with it, throw `ForbiddenException({ message: 'This action requires the <roles joined by " or "> role.', requiredRoles })`.
- [X] T040 [US3] Create `backend/src/auth/auth.module.ts` providing the JWKS provider, and registering `AuthGuard` then `RolesGuard` as `APP_GUARD`s in that order. Import it in `backend/src/app.module.ts`.
- [X] T041 [US3] Map authentication and authorization errors in `backend/src/common/filters/prisma-exception.filter.ts` (research R13). `401` gives `envelope('UNAUTHENTICATED', 'A valid access token is required.')` and sets header `WWW-Authenticate: Bearer`. `403` gives `envelope('FORBIDDEN', message, { requiredRoles })`, taking `requiredRoles` from the exception response. Both are handled **before** the existing "unmapped status" fallback. Update the header comment's spec path to `contracts/openapi.yaml`.
- [X] T042 [P] [US3] Add `@Public()` to `HealthController.check` in `backend/src/health/health.controller.ts`.
- [X] T043 [P] [US3] Create `backend/src/me/me.controller.ts` (`GET /me`, returning `{ sub, username, roles }` from `@CurrentPrincipal()`) and `backend/src/me/me.module.ts`. Register it in `backend/src/app.module.ts`.
- [X] T044 [P] [US3] Create `backend/src/hello/hello.controller.ts` with `GET /hello/admin` (`@Roles('queuepass-admin')`), `GET /hello/customer` (`@Roles('customer')`), and `GET /hello/booth` (`@Roles('gate-agent')`). Each returns `{ app, appName, username, message: \`Hello, ${username}! Welcome to ${appName}.\` }`, with `appName` of `QueuePass Admin`, `QueuePass`, and `QueuePass Ticket Booth` respectively. Add `backend/src/hello/hello.module.ts` and register it in `backend/src/app.module.ts`.
- [X] T045 [P] [US3] Add `@Roles('queuepass-admin')` to the `create`, `update`, and `remove` handlers in `backend/src/locations/locations.controller.ts` and `backend/src/events/events.controller.ts`. Change nothing else in those files (research R14).
- [X] T046 [US3] Update `backend/src/main.ts`:
  - replace `enableCors({ origin: true })` with `enableCors({ origin: CORS_ORIGINS.split(','), allowedHeaders: ['authorization', 'content-type'], methods: ['GET', 'POST', 'PATCH', 'DELETE'] })`;
  - read `contracts/openapi.yaml` (path from `OPENAPI_PATH`, default `../contracts/openapi.yaml` relative to the Backend's working directory, `/app/contracts/openapi.yaml` in the image) and mount `swagger-ui-express` at `/docs`, plus `GET /docs/openapi.yaml` serving the raw file;
  - apply the same CORS and `/docs` setup in `backend/test/setup/test-app.ts`, extracting a shared `configureApp(app)` function into `backend/src/configure-app.ts` so they cannot drift.
- [X] T047 [US3] Run `npm test --workspace @queuepass/backend` and confirm T029–T035 pass, then run [quickstart.md](./quickstart.md) V6 with a token from Keycloak. To get one before US2 exists, temporarily enable direct access grants on `admin-app` in the Keycloak console, request a token with `curl -d grant_type=password -d client_id=admin-app -d username=admin1 -d password=test123 localhost:8080/realms/queuepass/protocol/openid-connect/token`, then rerun the seed, which turns the grant off again (T017).

**Checkpoint**: The API is locked down and matches the contract. US3 is independently verified.

---

## Phase 5: User Story 2 — Sign In to and Out of Each Front End (Priority: P2)

**Goal**: Each front end sends a signed-out visitor to Keycloak and shows a hello-world page from the Backend after sign-in. It refuses the wrong role, keeps tokens in memory only, renews them, and logs out of Keycloak too.

**Independent Test**: [quickstart.md](./quickstart.md) V3, V4, and V5 in a browser, plus `npm test` for `@queuepass/shared`, `@queuepass/admin-app`, `@queuepass/customer-app`, and `@queuepass/booth-app`.

### Tests for User Story 2 (write first, confirm they fail)

- [X] T048 [P] [US2] Create `packages/shared/test/web/fake-user-manager.ts`: a test double for `oidc-client-ts`'s `UserManager` with controllable `getUser`, `signinRedirect`, `signinRedirectCallback`, `removeUser`, `signoutRedirect`, and `events.addUserLoaded`/`addAccessTokenExpired`/`addSilentRenewError`. It records call order into an array, and a `makeUser({ username, roles, expiresIn })` helper builds a `User` whose `access_token` is an unsigned JWT carrying `preferred_username` and `realm_access.roles`.
- [X] T049 [P] [US2] Create `packages/shared/test/web/auth-provider.test.tsx` (FR-009, FR-011, FR-013, US2-8, R1, R2):
  - with no user, it calls `signinRedirect` and renders no children;
  - with `?code=…&state=…` in the URL, it calls `signinRedirectCallback`, then `history.replaceState` removes the query;
  - the `UserManager` is constructed with `response_type: 'code'`, `automaticSilentRenew: true`, and a `userStore` whose `store` is an `InMemoryWebStorage`;
  - after sign-in, `localStorage` and `sessionStorage` contain no value matching `/access_token|id_token|refresh_token|^eyJ/`;
  - on `addSilentRenewError`, it removes the user and calls `signinRedirect`;
  - a `pageshow` event with `persisted: true` and no user in memory triggers `signinRedirect`.
- [X] T050 [P] [US2] Create `packages/shared/test/web/require-role.test.tsx` (FR-016, US2-6):
  - while loading, it shows "Signing in…";
  - with a user holding the required role, it renders children;
  - with a user lacking it, it renders only the text "Your account can't use this app." (plus the username) and a Log out button, and **not** the children;
  - a user with two roles passes each app's gate for its own role only.
- [X] T051 [P] [US2] Create `packages/shared/test/web/logout-button.test.tsx` (FR-015, US2-4, US2-5, R2). Clicking "Log out" calls `removeUser` **before** `signoutRedirect`, and `signoutRedirect` receives `id_token_hint` equal to the user's `id_token` and `post_logout_redirect_uri` equal to `window.location.origin + '/'`.
- [X] T052 [P] [US2] Create `packages/shared/test/web/hello-page.test.tsx` (FR-012, FR-014, FR-017), mocking `fetch`:
  - it calls the given greeting path with header `Authorization: Bearer <access_token>`;
  - it renders a heading with `appName` and a paragraph with `message`;
  - a network error renders "Can't reach the QueuePass service." (not a blank page);
  - a `401` response triggers `signinRedirect`;
  - a `403` response renders the wrong-role message.
- [X] T053 [P] [US2] Create `customer-app/test/app.test.tsx` and `booth-app/test/app.test.tsx`. With the fake `UserManager` injected through `AuthProvider`'s `userManager` prop, each app renders the hello page for its own role (`customer`, `gate-agent`), shows the wrong-role message for `queuepass-admin`, and always shows a Log out button when signed in.
- [X] T054 [P] [US2] Create `admin-app/test/app.auth.test.tsx`. Signed in as a `queuepass-admin` user, `/` shows the hello page and the header shows Venues, Events, and Log out links. As a `customer` user, `/locations` shows only the wrong-role message. Update `admin-app/test/EventForm.conflict.test.tsx` and `admin-app/test/pages.live-fixtures.test.tsx` to render inside a signed-in `AuthProvider` with the fake manager, without changing their assertions.

### Implementation for User Story 2

- [X] T055 [US2] Create the shared sign-in code in `packages/shared/src/web/` (research R1, R2, R9):
  - `auth-provider.tsx`: `AuthProvider({ authority, clientId, userManager?, children })` builds a `UserManager` with `redirect_uri: origin + '/'`, `post_logout_redirect_uri: origin + '/'`, `response_type: 'code'`, `scope: 'openid profile'`, `automaticSilentRenew: true`, `userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() })`, and `stateStore: new WebStorageStateStore({ store: window.sessionStorage })`. It handles the redirect callback, auto-redirects when there is no user, listens for `pageshow`, and exposes `useAuth()` returning `{ status, user, username, roles, accessToken(), logout() }`. `roles` is decoded from the access token's `realm_access.roles` without verifying it; the Backend verifies.
  - `require-role.tsx`, `logout-button.tsx`, `hello-page.tsx` (`HelloPage({ greetingPath })`), `service-unreachable.tsx`, and `index.ts` re-exporting all of them.
  - `api-client.ts`: `createApiClient(baseUrl, getAccessToken)`, which returns an `openapi-fetch` client typed with `ApiPaths` and adds a middleware that sets `Authorization: Bearer <token>`.

  Use plain semantic HTML only (Constitution VII).
- [X] T056 [US2] Replace `customer-app/src/main.tsx` and `booth-app/src/main.tsx`. Each renders `<AuthProvider authority={import.meta.env.VITE_OIDC_AUTHORITY} clientId={import.meta.env.VITE_OIDC_CLIENT_ID}>`, then `<RequireRole role="customer">` (or `gate-agent`), then a `<header>` with the app name and `<LogoutButton/>`, then `<HelloPage greetingPath="/hello/customer"/>` (or `/hello/booth`). Add `src/vite-env.d.ts` typing `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, and `VITE_API_BASE_URL`.
- [X] T057 [US2] Update the Admin app:
  - `admin-app/src/main.tsx` wraps `<App/>` in `AuthProvider` and `<RequireRole role="queuepass-admin">`;
  - `admin-app/src/App.tsx` routes `/` to `<HelloPage greetingPath="/hello/admin"/>` instead of redirecting to `/locations`, keeps the existing routes, and adds `<LogoutButton/>` to the header;
  - add `admin-app/src/vite-env.d.ts` as in T056;
  - add the `@queuepass/shared/web` alias to `admin-app/vite.config.ts` and `admin-app/vitest.config.ts`.
- [X] T058 [US2] Rebuild `admin-app/src/api/client.ts`, `admin-app/src/api/locations.ts`, and `admin-app/src/api/events.ts` on `createApiClient` (research R8, R14). Keep every exported function's name and signature, and keep `ApiError` with its `status`, `code`, and `details`, so the pages do not change. Take the token from a module-level `setAccessTokenGetter()` that `main.tsx` calls with `useAuth().accessToken`. A `401` from the API triggers the auth provider's re-sign-in instead of throwing `ApiError`.
- [X] T059 [US2] Rebuild and run [quickstart.md](./quickstart.md) V3, V4, and V5 in a browser (`docker compose up --build -d`), for all three apps, in private windows. Fix any failure before continuing.

**Checkpoint**: All three front ends sign in, greet, refuse the wrong role, and log out. All three user stories work.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T060 [P] Replace the Admin app's `VITE_API_BASE_URL` fallback and any remaining `'http://localhost:3000'` literal in `admin-app/src/` with the shared client's base URL from `import.meta.env.VITE_API_BASE_URL`, so all three apps read configuration the same way.
- [X] T061 [P] Update comment references to `specs/001-venue-event-management/` in `backend/jest.config.ts`, `backend/test/setup/postgres-container.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260920000001_scheduling_constraints/migration.sql`, and `packages/shared/src/errors.ts` so they point to `specs/002-admin-venues-events/`. Comments only: **do not edit the SQL** in the committed migration.
  *Done except `migration.sql`, which was left untouched: Prisma checksums applied migrations, and even a comment edit would make `prisma migrate dev` report it as modified.*
- [X] T062 [P] Update `README.md`:
  - move `001` to "Built" in the status table;
  - remove "(arrives in `001`)" markers;
  - replace the "Today the Backend API is open…" paragraph;
  - in "How sign-in works", replace "The exact command will be in the `001` quickstart" with a link to [quickstart.md](./quickstart.md) V6.
- [X] T063 [P] Run `npx @redocly/cli@1 lint contracts/openapi.yaml` and confirm 0 errors. Run `npm run lint` and `npx prettier --check .` at the root, and fix any findings.
- [X] T064 Run the full [quickstart.md](./quickstart.md) V1–V9 from a fresh clone (`docker compose down -v` first), then `npm test` at the root, and record the date and result at the bottom of `specs/001-bare-bones-system/quickstart.md` (Constitution VI, workflow gate 5).

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Blocks |
|---|---|---|
| 1 Setup | nothing | everything |
| 2 Foundational | Setup | all stories |
| 3 US1 (P1) | Foundational | end-to-end checks of US3 (T047) and US2 (T059) |
| 4 US3 (P3) | Foundational; T047 needs US1 running | US2's end-to-end check (T059) |
| 5 US2 (P2) | Foundational; T022–T023 (app scaffolds) from US1 | nothing |
| 6 Polish | all stories | nothing |

**Why US3 comes before US2**: US2's hello-world pages call `/hello/*`, which US3 creates. The
spec's priorities rank value to the user; build order follows dependencies. US2's code and
component tests (T048–T058) can proceed in parallel with US3, because they mock the API.

### Within each story

1. Tests first, confirmed **failing**.
2. Then implementation, in the listed order.
3. The story's end-to-end task last (T026, T047, T059).

### Critical couplings

- **T038–T040 (global guards) and T029 (existing specs send tokens) must land together.**
  Otherwise all 15 existing Backend specs fail with `401`.
- **T041 (filter mapping) must land with T038.** Otherwise the `401`s surface as
  `VALIDATION_FAILED` (research R13).
- **T009 (generated types) must be rerun** after any contract change, or T010 fails `npm test`.

## Parallel Opportunities

**Phase 1**: T002, T003, T004, and T005 run together after T001.

**Phase 2**: T010, T011, and T012 run together. T013 follows T012, and T014 is independent.

**US1**:

```text
T017                (seed drift test)
T020 → T021         (admin nginx)
T022                (customer-app scaffold)
T023                (booth-app scaffold)
```

**US3**, once T027 and T028 are done, tests together:

```text
T030 auth.e2e   T031 me.e2e   T032 hello.e2e   T033 carried-over.authz
T034 route-coverage   T035 cors-docs
```

Then implementation together after T036–T041: T042, T043, T044, T045.

**US2**: T048–T054 (all tests) together. Then T055, followed by T056, T057, and T058, which touch
separate apps.

**Across stories**: after Phase 2, one person can take US3 (Backend) while another takes US2
(front ends and `packages/shared/web`). They meet at T059.

## Implementation Strategy

### MVP: User Story 1 only

Phases 1, 2, and 3. The whole system comes up with one command, seeded with accounts and clients.
**Stop and validate** with quickstart V1, V2, and V9. It is demonstrable, but it is not yet a
secure system: the API is still open and the front ends are placeholders.

### Incremental delivery

1. Setup + Foundational + US1 gives a running six-service system (MVP).
2. + US3 gives a locked-down API matching the contract. Verify with V6 and V7.
3. + US2 gives a real login, hello-world, and logout in every app. Verify with V3–V5.
4. Polish, then the full quickstart from a fresh clone (T064), then the implementation PR.

### Pull requests (Constitution III)

This `tasks.md` goes in the **plan PR**, with `plan.md`, `research.md`, `data-model.md`,
`quickstart.md`, `contracts/`, and the root `contracts/openapi.yaml`. Tasks T001–T064 go in the
**implementation PR**, with each task checked off. The repository needs `git init` and a merged
spec PR first (plan.md, *Complexity Tracking*).
