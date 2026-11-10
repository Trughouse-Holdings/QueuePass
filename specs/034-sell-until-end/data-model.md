# Data Model: Sell Tickets Until the Event Ends

**Feature**: `034-sell-until-end` | **Spec**: [spec.md](./spec.md)

**No schema change.** `backend/prisma/` is unchanged: no table, column, constraint, index, or
migration. Whether sales are open and whether an event is in progress are worked out from columns it
already has, never stored.

## The rule (FR-001, FR-006, FR-007; research R1, R2)

For an event `e` and the instant `now`:

| Term | Definition |
| --- | --- |
| Sales open | `e.status <> CANCELLED` and `now < e.endsAt` |
| Sales closed, `CANCELLED` | `e.status = CANCELLED` (whatever `now`) |
| Sales closed, `ENDED` | `e.status <> CANCELLED` and `now >= e.endsAt` |
| In progress (`inProgress`) | `e.startsAt <= now < e.endsAt`, whatever `e.status` |
| Before `034` | sales closed `STARTED` when `now >= e.startsAt` (no longer used) |

`now` per path, unchanged by this feature (research R1):

| Path | `now` |
| --- | --- |
| `createOrder` (under the event lock) | the Backend's process clock, `new Date()` |
| `reserveSeats` (`salesClosed()`, under the event lock) | the database's `now()` |
| The hold sweep (`HoldSweeper.sweepOnce` / `sweepEvent`) | the database's `now()` |
| `getEventAvailability` (`salesClosed`, `inProgress`) | the Backend's process clock, one reading for both |

## Availability (response shape; contracts/README.md)

| Field | Type | After `034` |
| --- | --- | --- |
| `eventId` | uuid | unchanged |
| `ticketsLeft` | integer | unchanged |
| `salesClosed` | `CANCELLED` \| `ENDED` \| `null` | `ENDED` replaces `STARTED` (the spec PR still lists `STARTED`; the implementation removes it) |
| `inProgress` | boolean | **new**; optional in the spec PR, required from the implementation |
| `tiers` | array | unchanged |
| `customerLimit` | object \| null | unchanged |

## Seat reservations (FR-004; research R3)

| When | Today | After `034` |
| --- | --- | --- |
| The sweep picks an event | an open reservation has `expiresAt <= now()` or its event's `startsAt <= now()` | … or its event's `endsAt <= now()` |
| The sweep ends every open hold of the event (`CLOSED`) | `salesClosed()` on `startsAt` | `salesClosed()` on `endsAt` |
| `expiresAt` | `createdAt + 5 minutes` (CHECK) | unchanged; never shortened |

## The Customer app (display only; research R4, R5)

| Where | Shown when | Text |
| --- | --- | --- |
| Get tickets panel, top | `inProgress` and `salesClosed = null` | "This event has already started (began at {start})." + " You can still buy tickets until it ends at {end}." only when the panel shows no closed, sold-out, limit, or no-seats-on-sale message |
| Get tickets panel, closed | `salesClosed = ENDED` | badge "Sales closed"; "Sales closed: this event has ended." |
| Event page, under the name (`030`) | before availability loads: browser clock `>= endsAt`; after: `salesClosed = ENDED` (never while `inProgress`) | "This event has ended." (FR-017) |
| Confirmation | `order.createdAt >= event.startsAt` | "This event has already started (began at {start}). Your tickets admit you until it ends at {end}." |

`{start}` and `{end}` are in the venue's zone with its abbreviation, each time alone on the reference
instant's local date and with its date otherwise: the reference is the time the panel's availability
loaded (panel) or the order's `createdAt` (confirmation).

Nothing is written to `localStorage` or `sessionStorage` by this feature.

## Unchanged

`Event`, `Order`, `Ticket`, `SeatReservation`, `SeatHold` and every other schema; the Ticket Booth's
entry window `[doorsOpenAt - 1 hour, endsAt)`; the event lists' past rule (`030`); reports and exports.
