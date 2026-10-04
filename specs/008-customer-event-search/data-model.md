# Data Model: Customer Event Search and Usability

**No changes.** This feature adds no tables, columns, or constraints, and no migration (spec
FR-012). It reads, as before:

- **Events** from `GET /events` (`003`), filtered by `004`'s `q`, `locationId`, `from`, and `to`.
- **Venues** from `GET /locations`, for the venue choice.
- **Tiers and availability** on an event's page (`006`), for tier prices and badges.
- **Seat maps** on an event's page (`007`).

## Page address (client state)

| Parameter | Type | Valid when |
|---|---|---|
| `q` | text | any; trimmed, empty means absent |
| `venue` | UUID | a UUID among the venues listed |
| `from`, `to` | `YYYY-MM-DD` | a real calendar date; `to` not before `from` |
| `hideCancelled` | `1` | present means on |

Invalid parameters are ignored (research R1).
