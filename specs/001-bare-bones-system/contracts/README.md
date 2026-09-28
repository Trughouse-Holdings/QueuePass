# Contracts for 001

This feature's API contract is the repository-wide document
[`contracts/openapi.yaml`](../../../contracts/openapi.yaml), not a copy in this folder.
Constitution I makes that file the single authoritative contract for every front end. It is
shared surface: changes need approval from every team member.

Feature `001` creates it with these operations:

| Method | Path | `x-required-roles` | Operation | Status |
|---|---|---|---|---|
| GET | `/health` | public | `getHealth` | existing, now declared public |
| GET | `/me` | any signed-in | `getMe` | new |
| GET | `/hello/admin` | `queuepass-admin` | `getAdminHello` | new |
| GET | `/hello/customer` | `customer` | `getCustomerHello` | new |
| GET | `/hello/booth` | `gate-agent` | `getBoothHello` | new |
| GET | `/locations` | any signed-in | `listLocations` | carried over, now protected |
| POST | `/locations` | `queuepass-admin` | `createLocation` | carried over, now protected |
| GET | `/locations/{id}` | any signed-in | `getLocation` | carried over, now protected |
| PATCH | `/locations/{id}` | `queuepass-admin` | `updateLocation` | carried over, now protected |
| DELETE | `/locations/{id}` | `queuepass-admin` | `deleteLocation` | carried over, now protected |
| GET | `/events` | any signed-in | `listEvents` | carried over, now protected |
| POST | `/events` | `queuepass-admin` | `createEvent` | carried over, now protected |
| GET | `/events/{id}` | any signed-in | `getEvent` | carried over, now protected |
| PATCH | `/events/{id}` | `queuepass-admin` | `updateEvent` | carried over, now protected |
| DELETE | `/events/{id}` | `queuepass-admin` | `deleteEvent` | carried over, now protected |

The `carried-over` operations keep their existing request and response shapes. Feature `002`
owns their design (research R14). The earlier per-feature copy at
`specs/002-admin-venues-events/contracts/openapi.yaml` is superseded by the root document.

`redocly lint contracts/openapi.yaml` passes with the recommended ruleset. Its three remaining
warnings (no license, a localhost server URL, and no 4xx response on `/health`) are accepted.
