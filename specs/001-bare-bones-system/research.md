# Research: Bare-Bones QueuePass System

Decisions taken while planning `001`, with the alternatives rejected. The stack is fixed by the
constitution's *Language and Stack* table (v2.0.0); these are the choices within it. Several
decisions follow the sibling `../queuepass` project's plan for the same feature, adjusted where
this project's constitution is stricter (notably R1: tokens in memory only).

## R1: How the front ends sign users in, with tokens in memory only

**Decision**: Each front end is a public OIDC client using the Authorization Code flow with PKCE
(`S256`) through `oidc-client-ts`. The `UserManager` is configured with
`userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() })`, so access, ID, and
refresh tokens exist only in JavaScript memory (Constitution V, FR-011). Tokens are renewed with
the refresh token before they expire (`automaticSilentRenew: true`).

On a page reload, memory is empty. The app then calls `signinRedirect()`. Because the Keycloak SSO
session cookie is still valid, Keycloak redirects straight back with a new code and no login
prompt, so the user stays signed in without the front end ever storing a token (spec edge case
"Page reload while signed in").

The PKCE `code_verifier` and `state` must survive the one redirect to Keycloak and back, so
`stateStore` stays on `sessionStorage`. That entry is a one-time value, not a token, and
`oidc-client-ts` deletes it as soon as the code is exchanged. The FR-011 test asserts that no key
containing a token remains in either storage after sign-in.

**Alternatives rejected**

- *Storing the user in `sessionStorage`* (the sibling project's choice): simpler, since reloads
  need no redirect, but it breaks this constitution's memory-only rule, and any XSS could read
  the token.
- *Silent renew through a hidden iframe (`prompt=none`)*: `localhost:5173` and `localhost:8080`
  are same-site, so this would work locally, but it breaks under third-party-cookie blocking once
  hosts differ. The refresh token plus a top-level redirect on reload has no such dependency.
- *`keycloak-js`*: Keycloak-specific. The constitution requires a standards-based library.
- *A backend-for-frontend per app*: stronger, but it adds a server to each static front end.
  Rejected for a laptop proof of concept.

## R2: Logout that ends the Keycloak session, and the back button

**Decision**: Logout runs `removeUser()` first, so React state flips to signed-out and memory is
cleared, then `signoutRedirect({ id_token_hint, post_logout_redirect_uri: <app root> })`, which
ends the SSO session at Keycloak's end-session endpoint (FR-015).

Two protections cover the back button (spec US2-5, SC-007):

1. Because the user is removed *before* navigating away, any back-forward-cache snapshot of the
   page shows the signed-out state.
2. A `pageshow` listener with `event.persisted === true` re-runs the auth check, so a restored
   page with no in-memory user goes to the login page.

**Rejected**: *Clearing only local state.* The next visit would sign the user back in silently
through the still-live Keycloak session, which fails US2-4.

## R3: How the Backend validates tokens

**Decision**: A global NestJS guard (`APP_GUARD`) checks every request except handlers marked
`@Public()` (only `GET /health`). It uses `jose`'s `jwtVerify` with:

- the key set from `createRemoteJWKSet(OIDC_JWKS_URL)`, which caches keys and refetches once when a
  token names an unknown `kid` (spec edge cases "Signing key rotation" and "Identity provider
  restarted");
- `issuer: OIDC_ISSUER`;
- `audience: 'queuepass-api'`;
- `algorithms: ['RS256']`;
- `clockTolerance: 30` seconds, under the spec's 60-second ceiling.

Roles are read from `realm_access.roles` and filtered to the three QueuePass roles. The username
is `preferred_username`, and the subject is `sub`. A `@Roles(...)` decorator marks role-restricted
handlers, and a second guard refuses with `403` when the caller lacks the role (FR-021). The key
set is injected through a provider, so tests swap in `createLocalJWKSet` (R11).

**Rejected**

- *`@nestjs/passport` with `passport-jwt` and `jwks-rsa`*: three packages and a strategy layer to
  do what `jwtVerify` does in one call.
- *Token introspection per request*: a network round trip on every call, for no gain with signed
  JWTs.
- *An "auth disabled" flag for tests*: allowed by Constitution VIII only under strict conditions.
  None is needed, because tests sign real tokens (R11). No bypass exists (FR-026).

## R4: Keeping the token issuer consistent inside and outside Docker

**Problem**: Browsers reach Keycloak at `http://localhost:8080`, but the Backend container reaches
it at `http://keycloak:8080`. By default Keycloak stamps `iss` with whichever host it was reached
on, so a Backend expecting one address refuses tokens issued through the other (spec edge case
"Addresses differ inside and outside containers").

**Decision**: Set `KC_HOSTNAME=http://localhost:8080` and `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`
on Keycloak. Every token then carries `iss=http://localhost:8080/realms/queuepass`, while
container-to-container calls still work on `keycloak:8080`. The Backend takes two settings:

- `OIDC_ISSUER=http://localhost:8080/realms/queuepass`, compared with `iss`;
- `OIDC_JWKS_URL=http://keycloak:8080/realms/queuepass/protocol/openid-connect/certs`, where keys
  are fetched over the Compose network.

## R5: Audience

**Decision**: The seed creates a client scope, `queuepass-api`, containing an audience mapper
(`oidc-audience-mapper`, included client audience or custom audience `queuepass-api`, added to
access tokens). The scope is assigned as a **default** scope on each of the three front-end
clients. The Backend requires `queuepass-api` in `aud` (FR-019). A token issued to any other
client in the realm, such as Keycloak's `account` console, is therefore refused.

Realm roles reach the token through Keycloak's built-in `roles` scope (`realm_access.roles`),
which is a default scope on new clients. The seed asserts it is attached rather than assuming so.

## R6: Keycloak provisioning

**Decision**: Extend the existing check-then-create seed with `provision-clients.ts`, which
converges three clients: `admin-app` (5173), `customer-app` (5174), and `booth-app` (5175). Each
has:

| Setting | Value |
|---|---|
| `publicClient` | `true` (no secret) |
| `standardFlowEnabled` | `true` |
| `directAccessGrantsEnabled` | `false`, so no client accepts a password (FR-005, FR-010) |
| `implicitFlowEnabled`, `serviceAccountsEnabled` | `false` |
| `attributes."pkce.code.challenge.method"` | `S256` |
| `redirectUris` | `["http://localhost:<port>/*"]` |
| `webOrigins` | `["http://localhost:<port>"]` |
| `attributes."post.logout.redirect.uris"` | `http://localhost:<port>/*` |
| default client scopes | include `queuepass-api` (R5) and `roles` |

An existing client is **updated** to these settings rather than skipped, so drift is repaired on a
rerun. The client is looked up by `clientId` and never recreated, so its internal ID stays stable
(FR-007).

A redirect URI of `/*` on an exact origin is not a wildcard *host*. It still refuses a return to
any other origin (spec edge case "Redirect tampering").

**Rejected**: *Realm import JSON.* Import applies only when the realm does not yet exist, so on a
persisted Keycloak volume it silently does nothing. That is a no-op, not idempotence.

## R7: Where the contract lives, and how conformance is tested

**Decision**: The contract is [`contracts/openapi.yaml`](../../contracts/openapi.yaml) at the
repository root (Constitution I). The Backend serves it at `/docs` through `swagger-ui-express`,
reading the committed file rather than generating one. Conformance is proven by two backend test
helpers:

1. **Response validation.** Every integration test passes its response through
   `expectToMatchContract(res, operationId)`. The helper compiles the operation's response schema
   for the returned status with Ajv's 2020-12 build (OpenAPI 3.1's dialect) and `ajv-formats`, and
   fails on any mismatch. An undeclared status also fails (FR-031).
2. **Route and role coverage.** One test reads every controller route from Nest's metadata. It
   fails if the set of (method, path) pairs differs from the contract's operations in either
   direction, or if an operation's `x-required-roles` differs from the handler's `@Roles` and
   `@Public` metadata (FR-027, SC-009).

**Rejected**: *Generating the contract from decorators (`@nestjs/swagger`).* That makes code the
source of truth, which inverts Constitution I.

## R8: Typed API access from the front ends

**Decision**: `openapi-typescript` generates `packages/shared/src/api-schema.ts` from the
contract (`npm run generate:api`). Front ends call the API through an `openapi-fetch` client typed
by that schema, so a request or response that disagrees with the contract fails the type check.
The shared client factory takes a `getAccessToken()` function and adds
`Authorization: Bearer <token>` on every request (FR-012).

A test regenerates the schema into a temporary file and fails if it differs from the committed
copy, so the contract and the types cannot drift.

## R9: Code shared by the three front ends

**Decision**: Sign-in (`AuthProvider`), the role gate (`RequireRole`), the hello-world page, the
logout button, the "cannot reach the service" message, and the API client factory live once in
`packages/shared` under the subpath export `@queuepass/shared/web`, with React as a peer
dependency. Each front end's `main.tsx` passes its app name, client ID, required role, and
greeting operation. The Backend imports only the root export, which contains no React.

**Rejected**: *A seventh workspace for web code.* The constitution's repository row lists
`packages/shared/` as the one shared package.

## R10: How the front ends are served, and their health

**Decision**: Multi-stage Dockerfiles build each app with Vite, then `nginx:alpine` serves the
static output with an SPA fallback to `index.html` and a static `GET /health` returning
`{"status":"ok"}`. The images carry no `node_modules`. Build-time values (`VITE_OIDC_AUTHORITY`,
`VITE_OIDC_CLIENT_ID`, `VITE_API_BASE_URL`) are baked in, which is fine because Compose fixes the
ports.

Each front end's Compose entry depends on `backend: service_healthy` and `seed:
service_completed_successfully`, so no login page is offered before its client exists (spec
edge case "Identity provider not ready").

**Rejected**: *`vite preview`*, the current setup. The Vite documentation says it is not for
serving, and it needs all of `node_modules` in the image. It also caused the port-mapping failure
seen when this system was last started.

## R11: Tokens in Backend tests

**Decision**: The Jest global setup generates an RS256 key pair with `jose`'s `generateKeyPair`.
A helper, `tokenFor({ username, roles, ...overrides })`, signs tokens with the expected issuer and
audience. The test app overrides the JWKS provider with `createLocalJWKSet` holding only the
public key. Negative cases (FR-030):

| Case | How it is made |
|---|---|
| missing | no `Authorization` header |
| malformed | `Bearer not-a-jwt` |
| unknown key | signed with a second, unpublished key pair |
| expired | `exp` 5 minutes in the past, beyond the 30-second tolerance |
| wrong issuer | `iss` of another realm |
| wrong audience | `aud: 'account'` |
| wrong role | valid token, roles `['customer']` on an admin-only route |

## R12: The front-end boundary check

**Decision**: `scripts/check-boundary.mjs` exits non-zero if `admin-app`, `customer-app`, or
`booth-app` declares a database dependency (`@prisma/client`, `prisma`, `pg`, `postgres`,
`mysql2`, `typeorm`, `sequelize`, `knex`) or if its `src/` mentions `DATABASE_URL`,
`postgres://`, `postgresql://`, or `@prisma/client`. It runs as the first step of `npm test`
(FR-033).

## R13: Error codes for authentication and authorization

**Problem**: The existing `AllExceptionsFilter` maps any unrecognized `HttpException` to
`VALIDATION_FAILED`. A `401` or `403` from the guards would therefore be reported to clients as a
validation error, which breaks FR-021's distinct errors and the one-error-shape rule.

**Decision**: Add `UNAUTHENTICATED` (401) and `FORBIDDEN` (403) to `ERROR_CODES` in
`packages/shared` and to the contract's `ErrorEnvelope` enum, and map both statuses explicitly in
the filter. A `401` also carries `WWW-Authenticate: Bearer`. The message never says *which* token
check failed, so the API does not help anyone probe it; the reason is logged server-side.

## R14: The existing venue and event code

**Problem**: The repository already has open `/locations` and `/events` endpoints and Admin app
screens for them, built under constitution v1.0.0. Spec `001` puts venue and event work out of
scope and hands it to `002`, but it also requires every endpoint to need a token (FR-018) and to
appear in the contract (FR-027).

**Decision**: Keep the existing code, and make it compliant with `001` without re-specifying it:

- The global guard protects the existing endpoints automatically. Writes get
  `@Roles('queuepass-admin')`, and reads stay open to any signed-in user. These are exactly the
  role rules `002` specifies, so `002` will not have to reverse them.
- The contract declares the existing operations unchanged in shape, tagged `carried-over`, with
  their security and roles added. `002` owns any redesign, including a possible rename from
  `/locations` to `/venues`.
- The existing Admin screens stay, behind sign-in, with the hello-world page as the landing page.
  Their API wrappers (`admin-app/src/api/*.ts`) are rebuilt on the shared typed client (R8), so
  they send the token and match the contract. No new screens and no delete controls are added;
  those are `002`.
- The 15 existing Backend integration specs get an admin token by default through a
  `authedRequest(app)` helper, and each write endpoint gains a wrong-role case.

**Rejected**

- *Deleting the existing screens and endpoints so 001 is a pure stub*: this project is not under
  version control yet, so the code would simply be lost, and `002` would rebuild the same thing.
- *Leaving them open until `002`*: breaks FR-018. Customers could change venues.

## R15: The seed idempotence test silently skips

**Problem**: `scripts/seed/test/seed-idempotence.test.ts` checks
`${KEYCLOAK_URL}/health/ready` on port 8080. Keycloak 26 serves health only on the management port
9000, so the check always fails and the test always skips, even with the stack running.

**Decision**: The test reads `KEYCLOAK_HEALTH_URL` (default `http://localhost:9000`), matching the
seed's own configuration. It gains client assertions (FR-034): three clients, each with the R6
settings and the `queuepass-api` scope, unchanged after a second run.

## R16: Ports, origins, and configuration

| Service | Host port | Origin allowed by Backend CORS |
|---|---|---|
| Backend | 3000 | |
| Admin app | 5173 | `http://localhost:5173` |
| Customer app | 5174 | `http://localhost:5174` |
| Ticket Booth app | 5175 | `http://localhost:5175` |
| Keycloak | 8080 (management 9000) | |
| PostgreSQL | 5432 | |

CORS allows exactly the origins in `CORS_ORIGINS` (FR-024), replacing today's `origin: true`. The
Backend's Compose healthcheck calls `GET /health` with `wget`, which the Alpine base image already
has.

New `.env.example` entries: `OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_AUDIENCE`, `CORS_ORIGINS`,
`VITE_OIDC_AUTHORITY`. Every one has a working default in `docker-compose.yml`.

## R17: Browser sign-in tests

**Decision**: The browser round trip is not automated. Playwright is not in the constitution's
stack table. Instead:

- Front-end component tests (Vitest and React Testing Library) mock `UserManager` and cover the
  signed-out redirect, the hello-world page, the wrong-role refusal, logout order (R2), the
  `pageshow` re-check, and the absence of tokens in storage (FR-032, SC-008).
- The manual smoke test in [quickstart.md](./quickstart.md) covers the real round trip, as
  Constitution VI requires before merge.
