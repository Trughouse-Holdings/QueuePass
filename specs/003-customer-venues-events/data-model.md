# Data Model: Customer Venue and Event Browsing

**No schema change and no migration.** Feature `003` only reads the Venue (`Location`) and Event
records defined in [`002`'s data model](../002-admin-venues-events/data-model.md), through the
Backend API.

## Fields the Customer app shows

| Entity | Field (API) | Shown as |
|---|---|---|
| Venue | `name` | text, link to the venue page |
| Venue | `address` | text |
| Venue | `seatingCapacity` | integer with thousands separators |
| Event | `name` | text, link to the event page |
| Event | `location.name` | text, link to the venue page |
| Event | `startsAt`, `endsAt` | local date and time, both with dates (research R5) |
| Event | `basePrice` | USD from the decimal string, never a float (research R5) |
| Event | `totalTicketCapacity` | integer with thousands separators, on the event page |

`id`, `createdAt`, and `updatedAt` are used for links and keys only and are not displayed.

## Ordering

Taken from the Backend as returned (research R3): events by `startsAt` ascending, venues by
`name` ascending.
