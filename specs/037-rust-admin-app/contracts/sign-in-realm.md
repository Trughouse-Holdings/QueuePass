# Contract: Rust Admin App Sign-In and Origin

**Feature**: `037-rust-admin-app` | Spec FR-004 to FR-008 | Research R4, R8, R11

The REST API contract (`contracts/openapi.yaml`) is **unchanged**. This feature adds no endpoint and
changes no request or response. What it adds is configuration that other parts of the system rely
on. This file is the contract for that configuration.

## Keycloak

| Item | Value |
|---|---|
| Realm | `queuepass-admin-rust-app` (`displayName` `QueuePass`, login theme `queuepass`, as the other realms) |
| Client | `admin-rust-app`, public, Authorization Code with PKCE `S256` only, direct-access grants off |
| Client name (sign-in heading) | `QueuePass Admin (Rust)` |
| Redirect URI and web origin | exact, derived from port 5176 as for the other clients |
| Audience mapper | `queuepass-api-audience`, the same API audience as the other clients |
| Realm role | `queuepass-admin` |
| Users | `admin1`–`admin5`, password `test123`, role `queuepass-admin` |
| Sign-in look | body class `qp-app--admin-rust-app` maps to a red sign-in accent set of all seven roles (accent, hover, soft, text, brand-mark-end, brand-mark-text, stone-accent), light and dark; message `qpAudience.admin-rust-app` |

Source of truth: one row in `APP_REALMS` (`packages/shared/src/realms.ts`) and one client row in
`scripts/seed/src/provision-clients.ts`. The import-free copies in `scripts/seed/src/app-realms.ts`
and `e2e/fixtures/realms.ts` follow, kept equal by the existing test.

## Backend

| Item | Behavior |
|---|---|
| Trusted issuer | `${issuerBase}/queuepass-admin-rust-app`, keys from that realm's own JWKS |
| Honoured role | `queuepass-admin` only; any other role in the token is ignored |
| Access | identical to a `queuepass-admin` token from `queuepass-admin-app` |
| CORS | `http://localhost:5176` added to `CORS_ORIGINS` (`.env.example`, `docker-compose.yml`, `scripts/run-host.mjs`, `backend/test/setup/test-app.ts`, `backend/test/integration/cors-docs.e2e-spec.ts`) |

Required tests (Backend, written first, Principle VI). The realm-driven suite
`backend/test/integration/auth.realms.e2e-spec.ts` loops over `APP_REALMS`, so the new row brings
its cases in; confirm each is there and add any that are missing: a valid admin token from the new
realm gets `200` on an admin endpoint; no `queuepass-admin` role gets `403`; only `customer` or
`gate-agent` gets `403`; signed by another realm's key but claiming the new issuer gets `401`;
expired gets `401`; wrong audience gets `401`; and the CORS preflight from 5176 is allowed.

## Compose

| Item | Value |
|---|---|
| Service | `admin-rust-app` |
| Port | `5176:5176` |
| Build args | `QP_API_BASE_URL` (default `${VITE_API_BASE_URL:-http://localhost:3000}`), `QP_OIDC_AUTHORITY` (default `${ADMIN_RUST_OIDC_AUTHORITY:-http://localhost:8080/realms/queuepass-admin-rust-app}`), `QP_OIDC_CLIENT_ID` (`admin-rust-app`) |
| Depends on | `backend: service_healthy`, `seed: service_completed_successfully` |
| Health check | `wget -qO- http://127.0.0.1:5176/health` (nginx `location = /health`) |
| Depended on by | none |
