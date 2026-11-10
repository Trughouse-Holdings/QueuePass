# Data Model: Hide Past Events

**Feature**: `030-hide-past-events` | **Spec**: [spec.md](./spec.md)

**No schema change.** `backend/prisma/` is unchanged: no table, column, constraint, index, or
migration. Whether an event is past is worked out from a column it already has, never stored.

## The rule (FR-001, research R1, R2)

| Term | Definition |
| --- | --- |
| Past event | `now >= Event.endsAt`, whatever `Event.status` |
| Not past | `Event.endsAt > now`: upcoming or in progress |
| `now` in the Backend's lists | the Backend's `Clock` (`backend/src/common/clock.ts`) when `listEvents` answers |
| `now` in the apps' labels | the browser's clock, read once when the page's events or orders load |

The half-open window `[startsAt, endsAt)` (Constitution, "Time") puts the instant `endsAt` itself in
the past.

## The event list's query (research R3)

`GET /events` filters, all optional, combined with `AND`:

| Parameter | Since | Condition |
| --- | --- | --- |
| `locationId` | `002` | `locationId = $1` |
| `q` | `004` | name contains, case-insensitive |
| `from`, `to` | `004` | `startsAt` in `[from, to)` |
| `fromDate`, `toDate` | `020` | the venue-local start date in `[fromDate, toDate]` |
| `includePast` | **`030`** | absent or `false`: `endsAt > now`; `true`: no condition |

Order: `startsAt` ascending, unchanged.

## State held by the apps (research R5, R8)

| Where | What | Held in |
| --- | --- | --- |
| Admin Events page | Show past events | the page address, `past=1` when on; absent when off |
| Admin venue page | Show past events | its page address, `past=1` when on |
| Customer My tickets | which orders are Past | the render, from `loadedAt` (already kept, spec `019` research R10) |

Nothing is written to `localStorage` or `sessionStorage` by this feature.

## Unchanged

`Event` and every response schema; `getEvent`; tiers, availability, seat map, images, orders,
attendees, `GET /reports/sales` and the exports built from it; the Ticket Booth's own rule
(`forTheGate`: `status = SCHEDULED` and `endsAt > now`).
