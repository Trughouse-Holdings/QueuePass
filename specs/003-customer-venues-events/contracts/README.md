# Contracts for 003

This feature's API contract is the repository-wide document
[`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I), at version 1.1.0.
**Feature `003` changes nothing in it** (spec FR-012).

The Customer app calls only these read operations, all open to any signed-in user:

| Method | Path | `x-required-roles` | Operation | Used for |
|---|---|---|---|---|
| GET | `/events` | any signed-in | `listEvents` | event list; `?locationId=` for a venue's events |
| GET | `/events/{id}` | any signed-in | `getEvent` | event page |
| GET | `/locations` | any signed-in | `listLocations` | venue list |
| GET | `/locations/{id}` | any signed-in | `getLocation` | venue page |

It no longer calls `GET /hello/customer` (spec Clarifications). That operation stays in the
contract, and the Backend keeps serving it.
