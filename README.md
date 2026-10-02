# QueuePass

Venue and event management with sign-in for every user and guaranteed conflict-free scheduling.

Built from the specifications in [`specs/`](specs/) under the project constitution at
[`.specify/memory/constitution.md`](.specify/memory/constitution.md) (v2.0.0).

---

## Status

Features `001`, `002`, and `003` are built and verified.

| Spec                                                                     | What it delivers                                                                                                        | Spec             | Plan and tasks     | Code                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------ | ---------------------- |
| [`001-bare-bones-system`](specs/001-bare-bones-system/spec.md)           | All six services; Keycloak sign-in, JWT validation, role checks; login, hello-world, and logout in all three front ends | Draft            | Done (64/64 tasks) | **Built and verified** |
| [`002-admin-venues-events`](specs/002-admin-venues-events/spec.md)       | Venue and event API with the 60-minute rule; Admin app create, read, update, delete                                     | Draft (revised)  | Done (32/32 tasks) | **Built and verified** |
| [`003-customer-venues-events`](specs/003-customer-venues-events/spec.md) | Customer app shows all venues and events                                                                                | Ready for review | Done (23/23 tasks) | **Built and verified** |
| [`004-admin-tiers-search`](specs/004-admin-tiers-search/spec.md)         | Ticket tiers per event; Admin search for events and venues                                                              | Ready for review | Done (23/23 tasks) | **Built and verified** |
| [`005-admin-orders-reporting`](specs/005-admin-orders-reporting/spec.md) | Orders and tickets; Admin sales dashboard, attendee lists, safe cancellation                                            | Ready for review | Done (25/25 tasks) | **Built and verified** |

**Today** all three front ends sign in through Keycloak and log out,
and the Backend refuses any request without a valid token and the right role. In the Admin app, admins
list, view, create, edit, and delete venues and events. Deleting asks for confirmation first,
and a venue that still has events is refused with a count of what blocks it. In the Customer app,
customers browse every event, soonest first, and every venue with what is on there, read-only.

Each feature lands as three pull requests, in order: spec, then plan and tasks, then code
(Constitution III).

---

## Start the system

```bash
cp .env.example .env     # optional — every value has a working default
docker compose up --build
```

One command from a clean clone. No manual configuration steps.

| Service          | URL                   | Sign in as        | Notes                                                        |
| ---------------- | --------------------- | ----------------- | ------------------------------------------------------------ |
| Admin app        | http://localhost:5173 | `admin1`          | role `queuepass-admin`                                       |
| Customer app     | http://localhost:5174 | `customer1`       | role `customer`; browse venues and events, read-only         |
| Ticket Booth app | http://localhost:5175 | `agent1`          | role `gate-agent`; hello-world page only                     |
| Backend API      | http://localhost:3000 | Bearer token      | `GET /health` is the only open endpoint; contract at `/docs` |
| Keycloak         | http://localhost:8080 | `admin` / `admin` | admin console; realm `queuepass`                             |
| PostgreSQL       | `localhost:5432`      |                   | volume-mapped; survives restarts                             |

Startup order is gated on health: the Backend waits for PostgreSQL and applies migrations, the
seed waits for Keycloak's `/health/ready`, and the front ends wait for the Backend.

> The stack uses ports 3000, 5173–5175, 8080, 9000, and 5432. Stop anything else using them
> first, or `docker compose up` fails with "port is already allocated".

**To stop without losing data:**

```bash
docker compose down          # keeps the volumes
docker compose down -v       # DELETES all data — venues, events, and Keycloak users
```

---

## Demo data

The Admin app's Reports and Attendees pages need orders, and customers can't buy tickets in the
Customer app until spec `006`. To fill them for a demo, run once after `docker compose up`:

```bash
docker compose exec backend node backend/dist/scripts/demo-data.js
```

It adds two venues, three events with tiers, orders from `customer1`…`customer25`, some
check-ins, and one cancelled event, all through the real Backend rules. Running it again changes
nothing. It is never run automatically.

---

## How sign-in works

Every front end requires sign-in, and the Backend trusts nothing without a valid token
(Constitution V, spec `001`).

1. You open a front end. It is not signed in, so it sends you to **Keycloak's login page**. No
   QueuePass app ever sees your password.
2. You sign in. Keycloak sends you back with a one-time code, and the front end exchanges it for
   tokens using the **OIDC Authorization Code flow with PKCE**. Each front end has its own public
   client in the `queuepass` realm: `admin-app`, `customer-app`, and `booth-app`.
3. The front end keeps the tokens **in memory only** and sends the access token as
   `Authorization: Bearer <token>` on every API call. It renews the token before it expires.
4. The Backend **validates the JWT** on every request except `/health`: signature against the
   realm's published keys (JWKS), issuer, audience (the QueuePass API), and expiry. Failures get
   `401`.
5. The Backend reads your **realm roles** from the token and enforces them. The wrong role gets
   `403`. Hiding a button in a front end is never the enforcement.
6. **Logout** discards the tokens and ends your Keycloak session, so reopening the app shows the
   login page again.

| Who                         | Can use          | Can do through the API            |
| --------------------------- | ---------------- | --------------------------------- |
| `queuepass-admin`           | Admin app        | read and change venues and events |
| `customer`                  | Customer app     | read venues and events            |
| `gate-agent`                | Ticket Booth app | read venues and events            |
| no token, or an invalid one | nothing          | only `GET /health`                |

To call the API by hand, copy a token from a signed-in app and pass it as a Bearer token. The
steps are in [quickstart V6](specs/001-bare-bones-system/quickstart.md#v6-the-backend-refuses-bad-tokens-us3-fr-018fr-024-sc-006).
Front-end clients deliberately refuse password grants, so there is no `curl` login.

---

## Run the tests

```bash
npm install     # first time only
npm test
```

Backend tests provision a **real PostgreSQL 17** through Testcontainers, so Docker must be
running. The scheduling rule is a PostgreSQL exclusion constraint, and SQLite has no
`tstzrange`, `EXCLUDE`, or `btree_gist`, so a substitute could not express the feature.
Authorization tests use tokens signed by a real test key set.

```bash
npm test --workspace @queuepass/backend      # API, persistence, scheduling, auth
npm test --workspace @queuepass/admin-app    # Admin app components
npm run seed                                 # re-run the Keycloak seed (idempotent)
```

---

## Seeded test credentials

The seed provisions **235 accounts** in the `queuepass` realm, plus one OIDC client per front
end:

| Accounts           | Usernames                   | Realm role        |
| ------------------ | --------------------------- | ----------------- |
| 5 QueuePass Admins | `admin1` … `admin5`         | `queuepass-admin` |
| 30 Gate Agents     | `agent1` … `agent30`        | `gate-agent`      |
| 200 Customers      | `customer1` … `customer200` | `customer`        |

**Password for every seeded account: `test123`**

> ⚠️ `test123` is for **local development only**. It must never be used in a shared, staging,
> or production environment, and must never be reused as a default for real accounts.

The Keycloak admin console uses `admin` / `admin` (override with `KEYCLOAK_ADMIN` and
`KEYCLOAK_ADMIN_PASSWORD`).

The seed is **idempotent**: running it again succeeds and leaves the accounts and clients
unchanged.

---

## What the system does

- **Sign-in everywhere** — login page, hello-world page, and logout in all three front ends;
  JWT validation and role checks at the Backend (`001`)
- **Venue catalog** — admins create, view, edit, and delete venues with name, address, and
  seating capacity (`002`)
- **Event scheduling** — admins create, view, edit, and delete events with times, ticket
  capacity, and base price (`002`)
- **Double-booking prevention** — events at the same venue must be at least **60 minutes**
  apart, enforced by a database constraint so no client can bypass it (`002`)
- **Customer browsing** — customers see all venues and events, read-only (`003`)
- **Ticket tiers** — admins split an event's tickets into tiers such as General and VIP, each
  with its own price and quantity; tiers never exceed the event's capacity, even under
  simultaneous edits (`004`)
- **Admin search** — find events by name, venue, and date range, and venues by name or address;
  filters stay in the page address (`004`)
- **Orders and tickets** — customers get tickets through the API, one unique code per seat; sales
  never exceed a tier or the event, even with many simultaneous buyers. Payment is simulated, and
  the Customer app screens arrive in `006` (`005`)
- **Sales dashboard** — admins see tickets sold against capacity, revenue, and check-ins, overall
  and per event and tier, always current (`005`)
- **Attendee lists** — every order for an event, with ticket codes and check-in state (`005`)
- **Safe cancellation** — cancelling an event voids its tickets, refunds its orders, frees the
  venue time, and shows customers it was cancelled; events and tiers with orders can't be
  deleted (`005`)

### Scheduling rule

Each event reserves its window plus a 60-minute setup and teardown buffer. For an event running
18:00–21:00 at a venue:

| Next event starts         | Result                                  |
| ------------------------- | --------------------------------------- |
| 21:00 (immediately after) | rejected — buffer unsatisfied           |
| 21:59                     | rejected — only 59 minutes of clearance |
| 22:00                     | accepted — exactly 60 minutes           |

The same window at a _different_ venue is always accepted.

---

## API contract

The OpenAPI 3.1 document is the agreement every front end builds against (Constitution I). It
is [`contracts/openapi.yaml`](contracts/openapi.yaml) at the repository root, created in the `001`
plan and is served by the Backend at `/docs`. Every endpoint declares its request and response
shapes, its required role, and every error it can return. An API change is merged into the
contract, in a reviewed PR, before it is implemented.

The front ends reach data **only** through this API. None holds a database connection.

---

## Deliberate scope boundaries

- No ticket sales, orders, payment, ticket codes, or check-in yet.
- The Ticket Booth app is a stub (sign-in, hello-world, logout) until a later spec.
- No self-service sign-up, password reset, or multi-factor authentication.
- No visual design work: front ends are plain and accessible (Constitution VII).
- Laptop only: no shared deployment, no TLS.

---

## Repository layout

```
backend/          NestJS API, Prisma schema and migrations, JWT validation
admin-app/        React + Vite Admin app          (role queuepass-admin)
customer-app/     React + Vite Customer app       (role customer)
booth-app/        React + Vite Ticket Booth app   (role gate-agent)
contracts/        OpenAPI contract shared by every app
packages/shared/  Request and response types shared by the apps
scripts/seed/     Idempotent Keycloak seed: realm, roles, clients, accounts
specs/            Specifications, plans, contracts, tasks
```

---

## Troubleshooting

| Symptom                                          | Fix                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port is already allocated` on startup           | Another program or Compose project is using one of the ports listed under _Start the system_. Stop it.                                                                           |
| Seed fails with connection refused               | Keycloak wasn't ready; the job retries. Confirm `KC_HEALTH_ENABLED=true`.                                                                                                        |
| Every API call returns `401` with a valid login  | The token's issuer is the browser's Keycloak address (`localhost:8080`), not the in-container one. The Backend must expect that issuer while fetching keys from `keycloak:8080`. |
| `401` with "invalid audience"                    | The front-end client is missing the audience mapper for the QueuePass API. Re-run the seed.                                                                                      |
| Login redirects fail with "Invalid redirect uri" | The client's redirect URI must match the front end's address exactly. Re-run the seed.                                                                                           |
| Signed in but "your account cannot use this app" | You are using the wrong role for that app. See the table under _Start the system_.                                                                                               |
| All same-venue bookings rejected                 | Buffer applied to both interval bounds; it belongs on the lower bound only.                                                                                                      |
| `constraint "event_no_overlap" does not exist`   | Someone ran `prisma db push`. Use `prisma migrate deploy`.                                                                                                                       |
| Data gone after restart                          | `docker compose down -v` deletes volumes; omit `-v`.                                                                                                                             |
| Tests fail to start                              | Docker must be running for Testcontainers.                                                                                                                                       |
