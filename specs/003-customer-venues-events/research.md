# Research: Customer Venue and Event Browsing

Decisions for feature `003`, planned under constitution v2.0.0 on top of the built features `001`
and `002`. The stack is fixed by the constitution. This feature is front-end only.

## R1: The Backend already serves everything

Checked against `contracts/openapi.yaml` (1.1.0) and the Backend code:

| Spec 003 requirement | Served by | Role | Order |
|---|---|---|---|
| FR-001, FR-002 event list | `GET /events` | any signed-in | `startsAt` ascending (`events.service.ts`) |
| FR-003 venue list | `GET /locations` | any signed-in | `name` ascending (`locations.service.ts`) |
| FR-004 venue page and its events | `GET /locations/{id}` + `GET /events?locationId=` | any signed-in | `startsAt` ascending |
| FR-005 event page with its venue | `GET /events/{id}` (embeds `location`) | any signed-in | — |

Both list orders are documented in the contract as relied on by `003`. The `venues-events.authz`
Backend spec already proves a customer token can read all four and is refused (`403`) on every
write.

**Decision**: no Backend, schema, or contract change (FR-012). **Alternatives rejected**: a
dedicated `/customer/...` read API duplicates four operations for no gain.

## R2: Routes and landing page

| Path | Page |
|---|---|
| `/` and `/events` | Event list |
| `/events/:id` | Event page, linking to its venue |
| `/venues` | Venue list |
| `/venues/:id` | Venue page with its events |

The Admin app keeps `/locations` for historical reasons (spec `002` research R8); the Customer
app has no such history, so its paths say "venues", matching the words on screen. The event list
is the landing page (spec Clarifications); the `001` hello page is retired for this app. Unknown
paths show a plain "page not found" message with links to both lists.

**Providers**: `main.tsx` wraps `App` in `AuthProvider` → `RequireRole role="customer"` →
`BrowserRouter`, exactly as the Admin app does, so no route ever renders for a signed-out
visitor or a wrong-role user (FR-011, US3-2, US3-3). Tests mount the same stack with a
`MemoryRouter`.

## R3: No client-side sorting or filtering

The app renders lists in the order the Backend returns them. Sorting again in the browser would
be a second, possibly different, source of truth for FR-002 and FR-003. Tests pin the order by
stubbing the Backend's order and asserting the rendered order matches it.

## R4: Loading and error states

A single hook, `useLoad(fetcher)`, returns one of:

| State | When | Page shows |
|---|---|---|
| `loading` | request in flight | "Loading…" |
| `ok` | `2xx` | the data |
| `missing` | `404` | "This event/venue is no longer available." with a link back (spec edge case) |
| `unreachable` | network error or any other status | `ServiceUnreachable` from `@queuepass/shared/web` |

A `401` calls `signIn()` (session expired edge case), as `HelloPage` does in `001`. The hook
uses `useAuth().api`, the shared typed client that sends the customer's own token (FR-010).

**Alternatives rejected**: copying the Admin app's module-level `api/client.ts`. That exists to
carry `ErrorEnvelope` details into forms; a read-only app never needs them.

## R5: Time and money formatting

- **Time** (FR-006): `when(iso)` is `toLocaleString(undefined, { dateStyle: 'medium',
  timeStyle: 'short' })`, the same format as the Admin app. Start and end both carry their
  date, so an event from 22:00 to 02:00 shows two dates (spec edge case).
- **Money** (FR-007): `basePrice` is a decimal string such as `"45.5"` or `"1200.00"`. `usd()`
  splits it at the decimal point, groups the whole part with `en-US` separators, and pads the
  fraction to two digits: `$45.50`, `$1,200.00`. The value never passes through a
  floating-point number.

## R6: Tests

Vitest + React Testing Library, following the Admin app's `stubApi` pattern: `fetch` is stubbed
per `METHOD /path`, and every request is recorded so tests can assert the Bearer token and that
**no non-GET request is ever sent**. `TZ` is pinned to `America/New_York` in `vitest.config.ts`
so local-time assertions are exact. The existing `001` tests for sign-in, wrong role, and logout
move to the new provider layout and keep their assertions.
