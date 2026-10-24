# Data Model: Add to Calendar

**No schema change.** No table, column, constraint, or migration is added: QueuePass stores nothing
about calendar entries (spec FR-006, FR-010). Decisions: [research.md](./research.md) R1–R5, R10.

## Order event summary (API shape, changed)

`OrderEvent` in `contracts/openapi.yaml`, returned inside every `MyOrder` of `listMyOrders`
(`GET /me/orders`, spec 006).

| Field | Type | Rule |
|---|---|---|
| `location.address` | string, 1–500 characters | **New** (FR-012, research R2). The venue's `Location.address`: `STREET, CITY, ST ZIP` for a venue with address parts (spec 013 FR-010), or the one-line text of a venue from before 013. Read from the venue row the Backend already loads. Declared, not required, until the implementation PR adds it to `required`. |

Every other field of `OrderEvent` (`id`, `name`, `startsAt`, `endsAt`, `status`, `location.id`,
`location.name`) is unchanged, and the calendar entry uses `id`, `name`, `startsAt`, `endsAt`,
`status`, `location.name`, and `location.address`.

## Calendar entry (not stored)

Made in the Customer app by `customer-app/src/calendar.ts` from one `MyOrder` (research R3–R8).

| Part | From | In the `.ics` file | In the Google link |
|---|---|---|---|
| Identifier | `event.id` | `UID:queuepass-event-<id>` | (none; Google makes its own) |
| Made at | the device's clock at the click | `DTSTAMP:YYYYMMDDTHHMMSSZ` | (none) |
| Title | `event.name` | `SUMMARY:` escaped (R6) | `text=` |
| Start | `event.startsAt` | `DTSTART:YYYYMMDDTHHMMSSZ` (UTC) | `dates=<start>/<end>` |
| End | `event.endsAt` | `DTEND:YYYYMMDDTHHMMSSZ` (UTC) | (in `dates`) |
| Location | `event.location.name` + `, ` + `event.location.address` | `LOCATION:` escaped (R6) | `location=` |

File name: `icsFileName(event.name)` (R12). MIME type: `text/calendar;charset=utf-8`.

## Eligibility (not stored)

`calendarEligible(order, nowMs)` (research R10, spec FR-002):

| Condition | Offered |
|---|---|
| `event.status === 'CANCELLED'` | no |
| `nowMs >= Date.parse(event.endsAt)` | no |
| no ticket with `status === 'VALID'` (today only on a cancelled event; also a single-order refund once `009` is built) | no |
| otherwise (upcoming or under way, with a valid ticket, used or not) | yes |
