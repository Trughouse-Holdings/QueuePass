# Contract: Rust Customer App Sign-In Client and Origin

**Feature**: `040-rust-customer-app` | Spec FR-004 to FR-008, FR-010 | Research R2, R3, R7, R12

The REST API contract (`contracts/openapi.yaml`) is **unchanged**. This feature adds no endpoint and
changes no request or response. It adds configuration other parts of the system rely on; this file
is the contract for it.

## Keycloak

| Item | Value |
|---|---|
| Realm | `queuepass-customer-app`, **the existing Customer realm**, unchanged (login theme `queuepass`, `displayName` `QueuePass`, role `customer`, users `customer1`–`customer200`) |
| Client | `customer-rust-app`, public, Authorization Code with PKCE `S256` only, direct-access grants off, implicit off, service accounts off, front-channel logout on, `use.refresh.tokens` on |
| Client name (sign-in heading and tab title) | `QueuePass Tickets (Rust)` → "Sign in to QueuePass Tickets (Rust)" |
| Redirect URI, post-logout redirect URI | exactly `http://localhost:5177/` |
| Web origin | exactly `http://localhost:5177` |
| Default client scopes | `roles` and `queuepass-api` (its `queuepass-api-audience` mapper puts `aud: queuepass-api` in the access token) |
| Users | none created: the realm's customers sign in (same `sub` as in the React Customer app) |
| Sign-in look | body class `qp-app--customer-rust-app` (set by `template.ftl` from the client) maps, in its own single-class rule in `login.css`, to the existing red set `--accent-rust`, `--accent-rust-hover`, `--accent-rust-soft`, `--accent-rust-text`, `--brand-mark-end-rust`, `--brand-mark-text-rust`, `--stone-accent-rust`, light and dark, the same mappings as `.qp-app--admin-rust-app` (which is not changed); message `qpAudience.customer-rust-app=For customers buying and viewing tickets, Rust version` |
| Unchanged | the `customer-app` client and its `.qp-app--customer-app` look; every other realm and client |
| Session | one Keycloak SSO session per browser for both Customer clients (accepted, constitution 3.12.0 Principle V exception) |
| Front-channel logout | unchanged (`frontchannelLogout: true`, no `frontchannel.logout.url`) by default; if T025 and `040 S2` see Keycloak show a logout page or frame the other Customer app on logout, the seed turns it off for `customer-app` and `customer-rust-app` only, test first (research R2) |

Source of truth: one row in `SHARED_REALM_CLIENTS` (`packages/shared/src/realms.ts`) and one row in
`FRONTEND_CLIENTS` (`scripts/seed/src/provision-clients.ts`). The seed and browser-test copies of
the table follow, kept equal by `packages/shared/test/realms.test.ts`. `legacy-realm.ts`'
`OTHER_CLIENTS` MUST NOT include `customer-rust-app`.

Required seed tests (written first): the client converges with every value above; a rerun changes
nothing and creates no user (still 240 accounts); a run from a pre-028 state (the old `queuepass`
realm renamed) leaves `customer-rust-app` enabled; hand-made drift on the client is repaired.

## Backend

| Item | Behavior |
|---|---|
| Trusted issuers and keys | unchanged: the four `APP_REALMS` realms |
| Token from `customer-rust-app` | issuer `${issuerBase}/queuepass-customer-app`, `aud` includes `queuepass-api`, `azp: customer-rust-app`: trusted exactly as a token from `customer-app` for the same `sub`; only the `customer` role is honoured. The Backend reads neither `azp` nor the client ID |
| CORS | `http://localhost:5177` added to `CORS_ORIGINS` (`.env.example`, `docker-compose.yml`, `scripts/run-host.mjs`, `backend/test/setup/test-app.ts`, `backend/test/integration/cors-docs.e2e-spec.ts`) |

Required Backend tests (written first, Principle VI), with a token helper option for `azp`:

- a `customer` token with `azp: customer-rust-app` gets `200` on a customer endpoint (`GET /me/orders`);
- an order placed with `azp: customer-app` is listed by `GET /me/orders` with `azp: customer-rust-app`
  for the same `sub`, and a reservation made with one is released by `POST /me/reservations/release`
  with the other (same account, FR-004);
- with `azp: customer-rust-app`: no `customer` role → `403`; wrong audience → `401`; expired →
  `401`; another realm's key claiming the Customer issuer → `401`;
- the CORS preflight from `http://localhost:5177` is allowed, and an unlisted origin still is not.

## Compose

| Item | Value |
|---|---|
| Service | `customer-rust-app` |
| Port | `5177:5177` |
| Build args | `QP_API_BASE_URL` (`${VITE_API_BASE_URL:-http://localhost:3000}`), `QP_OIDC_AUTHORITY` (`${VITE_CUSTOMER_OIDC_AUTHORITY:-http://localhost:8080/realms/queuepass-customer-app}`, the React Customer app's variable), `QP_OIDC_CLIENT_ID` (`customer-rust-app`) |
| Depends on | `backend: service_healthy`, `seed: service_completed_successfully` |
| Health check | `wget -qO- http://127.0.0.1:5177/health` (nginx `location = /health`) |
| Depended on by | none |

## Host run (`scripts/run-host.mjs`)

A sixth child `customer-rust-app`: `npm run dev --workspace @queuepass/customer-rust-app`
(`trunk serve --port 5177`) with `QP_API_BASE_URL`, `QP_OIDC_AUTHORITY`
(`${REALMS}/queuepass-customer-app`), and `QP_OIDC_CLIENT_ID=customer-rust-app`; CORS list as above;
banner "Customer (Rust) http://localhost:5177" and "Ctrl+C stops all six".
