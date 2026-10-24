# Data Model: Bare-Bones QueuePass System

Feature `001` adds **no database tables and no migrations**. Identities live in Keycloak, not in
PostgreSQL (FR-025). The existing `Location` and `Event` tables are unchanged and belong to
`002`. See [research R14](./research.md#r14-the-existing-venue-and-event-code).

What `001` models is the identity configuration in Keycloak, the claims the Backend reads from a
token, and the shapes the API returns.

## 1. Keycloak realm configuration (converged by the seed)

### Realm `queuepass`

| Attribute | Value |
|---|---|
| `enabled` | `true` |
| `registrationAllowed` | `false` (no self sign-up) |
| `accessTokenLifespan` | Keycloak default, 300 s |

### Realm roles

| Role | Seeded accounts | Front end it admits |
|---|---|---|
| `queuepass-admin` | `admin1`–`admin5` | Admin app |
| `gate-agent` | `agent1`–`agent30` | Ticket Booth app |
| `customer` | `customer1`–`customer200` | Customer app |

Every account has password `test123` (non-temporary), `enabled: true`, `emailVerified: true`,
and exactly one of the roles above. **Invariant**: 235 accounts in total, before and after any
number of seed runs (FR-004, FR-007).

### Client scope `queuepass-api`

| Attribute | Value |
|---|---|
| `protocol` | `openid-connect` |
| Mapper | `oidc-audience-mapper`: `included.custom.audience = queuepass-api`, `access.token.claim = true`, `id.token.claim = false` |

### Clients (one per front end)

| `clientId` | Origin | Required role |
|---|---|---|
| `admin-app` | `http://localhost:5173` | `queuepass-admin` |
| `customer-app` | `http://localhost:5174` | `customer` |
| `booth-app` | `http://localhost:5175` | `gate-agent` |

All three share the settings in [research R6](./research.md#r6-keycloak-provisioning): public, standard
flow only, PKCE `S256`, direct access grants off, exact origin, and default scopes including
`queuepass-api` and `roles`.

**Invariant**: exactly these three clients carry the `queuepass-api` scope. Any other client's
tokens lack the audience and are refused by the Backend.

## 2. Access token claims the Backend reads

| Claim | Check | Used as |
|---|---|---|
| signature (`kid`, `alg`) | verifies against realm JWKS; `alg` must be `RS256` | |
| `iss` | equals `OIDC_ISSUER` (`http://localhost:8080/realms/queuepass`) | |
| `aud` | includes `queuepass-api` | |
| `exp` | not past, 30 s tolerance | |
| `sub` | present | `Me.sub` |
| `preferred_username` | present | `Me.username` |
| `realm_access.roles` | array (missing means no roles) | `Me.roles`, filtered to the three QueuePass roles |

A token failing any check yields `401 UNAUTHENTICATED`. No other request field (header, query,
or body) may supply identity or roles (FR-020).

### Authenticated principal (in the Backend, per request)

```ts
interface Principal {
  sub: string;
  username: string;
  roles: Role[]; // subset of 'queuepass-admin' | 'gate-agent' | 'customer'
}
```

Attached to the request by the auth guard, read by the roles guard and by `GET /me`. Never
persisted.

## 3. API shapes added in 001

Authoritative definitions are in [`contracts/openapi.yaml`](../../contracts/openapi.yaml). Summary:

| Schema | Fields |
|---|---|
| `Me` | `sub`, `username`, `roles[]` |
| `Hello` | `app` (`admin` \| `customer` \| `booth`), `appName`, `username`, `message` |
| `ErrorEnvelope.error.code` | adds `UNAUTHENTICATED` and `FORBIDDEN` to the existing five codes |

## 4. Front-end session state (in memory only)

| State | Meaning | What the user sees |
|---|---|---|
| `loading` | checking for a user, or completing the redirect back from Keycloak | "Signing in…" |
| `signed-out` | no user in memory | redirect to Keycloak login (never rendered as a page) |
| `signed-in, wrong role` | token valid, required role missing | "Your account can't use this app", plus logout |
| `signed-in` | token valid, role present. *Amended by spec 018 research R12: also a user kept in memory with an expired token after a refresh failed for lack of network; the Backend refuses that token with `401`, and the refresh is retried quietly.* | hello-world page, or the app's screens, plus logout |
| `backend-unreachable` | signed in, but the greeting call failed with a network error | "Can't reach the QueuePass service", plus logout |

Transitions:

- `loading` → `signed-out` → Keycloak → `loading` → `signed-in` or `signed-in, wrong role`
- Access token nearing expiry → refresh in place; refresh fails → `signed-out`
  *Amended by spec 018 research R12: only Keycloak refusing the refresh (`ErrorResponse`) leads to
  `signed-out`. A refresh that fails for lack of network keeps the user signed in, in memory, with
  an expired token the Backend refuses, and retries quietly.*
- Logout: remove the user (→ `signed-out`), then redirect to Keycloak's end-session endpoint
- Page restored from the back-forward cache → re-check → `signed-out` if memory is empty

The role check reads roles from the access token's `realm_access.roles` claim, so the gate works
before any API call. The Backend still enforces the same role independently (Constitution V).
