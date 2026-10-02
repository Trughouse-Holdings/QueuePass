# Contracts for 004

The contract is the repository-wide [`contracts/openapi.yaml`](../../../contracts/openapi.yaml),
moved to **1.2.0** in this plan PR with `packages/shared/src/api-schema.ts` regenerated.

| Method | Path | `x-required-roles` | Operation | Change in 004 |
|---|---|---|---|---|
| GET | `/locations` | any signed-in | `listLocations` | + `q`; + `400` |
| GET | `/events` | any signed-in | `listEvents` | + `q`, `from`, `to` |
| PATCH | `/events/{id}` | `queuepass-admin` | `updateEvent` | `409 CAPACITY_EXCEEDED` when below the tier total (described) |
| DELETE | `/events/{id}` | `queuepass-admin` | `deleteEvent` | deletes tiers too (described) |
| GET | `/events/{id}/tiers` | any signed-in | `listTicketTiers` | **new** |
| POST | `/events/{id}/tiers` | `queuepass-admin` | `createTicketTier` | **new** |
| PATCH | `/events/{id}/tiers/{tierId}` | `queuepass-admin` | `updateTicketTier` | **new** |
| DELETE | `/events/{id}/tiers/{tierId}` | `queuepass-admin` | `deleteTicketTier` | **new** |

New schemas: `TicketTier`, `TicketTierInput`, `TicketTierUpdate`. New error code:
`TIER_NAME_TAKEN`. No operation is removed and no existing response shape changes.
