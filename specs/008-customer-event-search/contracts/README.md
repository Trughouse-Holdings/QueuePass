# Contracts for 008

**No contract change.** [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) stays at
**1.5.0**. The Customer app uses operations that already exist and already allow the `customer`
role:

| Method | Path | Operation | Used for |
|---|---|---|---|
| GET | `/events` with `q`, `locationId`, `from`, `to` | `listEvents` (`004`) | the filtered event list |
| GET | `/locations` | `listLocations` (`002`) | the venue choice |
| GET | `/events/{id}/tiers` | `listTicketTiers` (`004`) | "from $X" on an event's page |
| GET | `/events/{id}/availability` | `getEventAvailability` (`006`) | Sold out and Sales closed badges |
| GET | `/events/{id}/seats` | `getSeatMap` (`007`) | the seat picker |
