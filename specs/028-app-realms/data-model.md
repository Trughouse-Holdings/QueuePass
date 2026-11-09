# Data Model: A Separate Sign-in for Each App

The QueuePass database is **unchanged**: no table, column or migration. What changes is Keycloak's
configuration (made by the seed) and the Backend's token configuration.

## The realm table (`packages/shared/src/realms.ts`)

One constant, read by the Backend and the apps' tests; the seed (`scripts/seed/src/app-realms.ts`)
and the e2e tests (`e2e/fixtures/realms.ts`) keep import-free copies that one test checks are equal
(research R4):

```ts
export const APP_REALMS = [
  { app: 'admin',    realm: 'queuepass-admin-app',    clientId: 'admin-app',    role: 'queuepass-admin', prefix: 'admin',    count: 5 },
  { app: 'customer', realm: 'queuepass-customer-app', clientId: 'customer-app', role: 'customer',        prefix: 'customer', count: 200 },
  { app: 'booth',    realm: 'queuepass-booth-app',    clientId: 'booth-app',    role: 'gate-agent',      prefix: 'agent',    count: 30 },
] as const;

/** The single realm before 028; renamed by the seed to the customer realm (research R6). */
export const LEGACY_REALM = 'queuepass';
```

`role` uses the existing `Role` type; `clientId` the existing client IDs. Everything else the seed
needs per client (name, port) stays in `FRONTEND_CLIENTS` (`021`).

## Keycloak, per app realm

| Setting | Value |
|---|---|
| `realm` | from `APP_REALMS` |
| `enabled` | `true` |
| `displayName` | `QueuePass` (the `027` header) |
| `loginTheme` | `queuepass` |
| Token lifespans, session timeouts | Keycloak's defaults, as the shared realm has today (access token 300 s, SSO idle 1800 s, SSO max 36000 s) |
| Realm roles | the app's one role |
| Client scope `queuepass-api` | with the audience mapper, as today |
| Client | the app's one client, `desiredClient` as today (public, PKCE S256, exact URIs, refresh tokens, front-channel logout) |
| Users | `prefix1`…`prefixN`, enabled, email `<username>@queuepass.local` verified, first name = prefix, last name = number, the app's role, the seed password (non-temporary) |

## The rename, on a system made before 028 (research R5, R6)

| Step | What |
|---|---|
| Condition | realm `queuepass` exists and `queuepass-customer-app` does not (both: fail, change nothing) |
| Rename | `queuepass` → `queuepass-customer-app` (`realms.update` with the new `realm`); every user keeps its `id` (subject), password, roles; theme and display name stay |
| Converge | the customer realm like a clean one: settings, `customer` role, audience scope, `customer-app` client; the customers already exist and are left alone |
| Disable, in the customer realm only | every enabled user without the `customer` role (old `admin1`–`5`, `agent1`–`30`), and the clients `admin-app` and `booth-app`: `enabled: false`; nothing deleted |
| Admin and Booth realms | created as on a clean system, with new accounts (new subjects) |

## Backend configuration (environment)

| Variable | Default (Compose) | Replaces |
|---|---|---|
| `OIDC_ISSUER_BASE` | `http://localhost:8080/realms` | `OIDC_ISSUER` |
| `OIDC_JWKS_BASE` | `http://keycloak:8080/realms` | `OIDC_JWKS_URL` |
| `OIDC_AUDIENCE` | `queuepass-api` | unchanged |

Derived per realm: issuer `${OIDC_ISSUER_BASE}/${realm}`, key set
`${OIDC_JWKS_BASE}/${realm}/protocol/openid-connect/certs`.

## Front-end configuration (build arguments)

| App | `VITE_OIDC_AUTHORITY` default | `VITE_OIDC_CLIENT_ID` |
|---|---|---|
| Admin | `http://localhost:8080/realms/queuepass-admin-app` | `admin-app` |
| Customer | `http://localhost:8080/realms/queuepass-customer-app` | `customer-app` |
| Ticket Booth | `http://localhost:8080/realms/queuepass-booth-app` | `booth-app` |

`.env.example` lists the three as `VITE_ADMIN_OIDC_AUTHORITY`, `VITE_CUSTOMER_OIDC_AUTHORITY`,
`VITE_BOOTH_OIDC_AUTHORITY`, each passed by Compose to its app's `VITE_OIDC_AUTHORITY`.
`KEYCLOAK_REALM` is retired from `.env.example`, `docker-compose.yml` and the seed.
