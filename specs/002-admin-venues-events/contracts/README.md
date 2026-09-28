# Contracts for 002

This feature's API contract is the repository-wide document
[`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I). The earlier
per-feature copy that lived here was written under constitution v1.0.0 and has been removed.

Feature `002` owns these operations. Their shapes are unchanged from `001`; this plan retags them
from `carried-over` to `venues` and `events` and adds the changes in
[research R9](../research.md#r9-contract-changes-in-this-plan) (contract version 1.1.0):

| Method | Path | `x-required-roles` | Operation | Change in 002 |
|---|---|---|---|---|
| GET | `/locations` | any signed-in | `listLocations` | order (by name) documented |
| POST | `/locations` | `queuepass-admin` | `createLocation` | — |
| GET | `/locations/{id}` | any signed-in | `getLocation` | — |
| PATCH | `/locations/{id}` | `queuepass-admin` | `updateLocation` | — |
| DELETE | `/locations/{id}` | `queuepass-admin` | `deleteLocation` | `409` is now `VenueHasEvents` with `details.eventCount`; confirm-first stated |
| GET | `/events` | any signed-in | `listEvents` | order (by `startsAt`) documented |
| POST | `/events` | `queuepass-admin` | `createEvent` | — |
| GET | `/events/{id}` | any signed-in | `getEvent` | — |
| PATCH | `/events/{id}` | `queuepass-admin` | `updateEvent` | — |
| DELETE | `/events/{id}` | `queuepass-admin` | `deleteEvent` | confirm-first stated |

No operation is added or removed. `redocly lint` passes, with the same three accepted warnings
as `001`.
