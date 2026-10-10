# Contracts for 007

The contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml), moved to **1.5.0**
in this plan PR with `packages/shared/src/api-schema.ts` regenerated.

| Method | Path | `x-required-roles` | Operation | Change in 007 |
|---|---|---|---|---|
| GET | `/locations/{id}/layout` | any signed-in | `getLayout` | **new** |
| PUT | `/locations/{id}/layout` | `queuepass-admin` | `replaceLayout` | **new** |
| DELETE | `/locations/{id}/layout` | `queuepass-admin` | `deleteLayout` | **new** |
| GET | `/events/{id}/seats` | any signed-in | `getSeatMap` | **new** |
| PUT | `/events/{id}/seating` | `queuepass-admin` | `updateSeating` | **new** |
| POST | `/events/{id}/orders` | `customer` | `createOrder` | + optional `seats`; + `409 SEAT_TAKEN` |
| PATCH | `/events/{id}` | `queuepass-admin` | `updateEvent` | refuses a venue change while reserved seating is on (described) |
| PATCH | `/locations/{id}` | `queuepass-admin` | `updateLocation` | refuses seating capacity below the layout's seats (described) |

**Revision (research R11)**: `EventInput.totalTicketCapacity` and `TicketTierInput.quantity`
become optional; `TicketTier.quantity` may be 0; `replaceLayout`, `deleteLayout`,
`updateSeating`, `updateLocation`, `updateEvent`, `createTicketTier`, and `updateTicketTier`
describe the calculated capacities.

`Event` gains required `reservedSeating`; `Ticket` gains required, nullable `seat`. New schemas:
`SeatingLayout`, `Section`, `SectionInput`, `LayoutInput`, `SeatMap`, `SeatMapSection`,
`SeatPosition`, `SeatChoice`, `SeatLabel`, `SeatingInput`. New error codes: `SEAT_TAKEN`,
`LAYOUT_IN_USE`. Nothing existing is removed or narrowed.
