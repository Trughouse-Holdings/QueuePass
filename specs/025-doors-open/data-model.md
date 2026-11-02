# Data Model: Doors Open

**Feature**: `025-doors-open` | **Spec**: [spec.md](./spec.md)

One column and one CHECK on `Event`, one migration. Nothing else in the schema changes.

## Event (PostgreSQL, Prisma)

| Column | Type | Rule |
| --- | --- | --- |
| `doorsOpenAt` (new) | `timestamptz(6)`, `NOT NULL`, no default | `event_doors_open_range`: `"doorsOpenAt" <= "startsAt" AND "doorsOpenAt" >= "startsAt" - interval '6 hours'` (research R2) |

Prisma, in `model Event` after `endsAt`:

```prisma
  // Spec 025 FR-001, FR-004: when doors open; between 6 hours before startsAt and startsAt, both
  // allowed (the event_doors_open_range CHECK, migration SQL). Only the Backend decides it.
  doorsOpenAt         DateTime @db.Timestamptz(6)
```

Migration `20261102000000_doors_open` (research R1): add the column nullable; set every row to
`"startsAt" - interval '1 hour'` (scheduled and cancelled, past and future, FR-024); `SET NOT NULL`;
add the CHECK. No index. `event_no_overlap` and `queuepass_event_window` are unchanged (research R3).

## Worked out, not stored

| Name | Value | Where |
| --- | --- | --- |
| `entryOpensAt` | `doorsOpenAt - 60 minutes` (`ENTRY_OPENS_BEFORE_DOORS_MINUTES`) | `Event` responses (`EventsService.toResponse`); `EntryTicket.entryOpensAt` and `ENTRY_REFUSED`'s `details.entryOpensAt` (SQL, research R7) |
| check-in window | `[entryOpensAt, endsAt)`, on the database's `now()` | `ticket-state.ts` `stateCase` (`NOT_OPEN` when `now() < entryOpens`), `entry.service.ts` `tryAdmit` |

## Shared constants and helpers (`packages/shared/src/event.ts`)

| Name | Value or signature | Used by |
| --- | --- | --- |
| `DEFAULT_DOORS_BEFORE_START_MINUTES` | `60` | Backend create default; Admin form prefill |
| `DOORS_OPEN_MAX_BEFORE_START_MINUTES` | `360` | Backend check, form check, the CHECK test |
| `ENTRY_OPENS_BEFORE_DOORS_MINUTES` | `60` | `entryOpensAt`, the entry SQL |
| `doorsOpenProblem(startsAt, doorsOpenAt)` | `'TOO_EARLY' \| 'AFTER_START' \| null` | Backend, form, zone change |
| `doorsOpenRangeMessage(startsAt, zone)` | "Doors must open no more than 6 hours before the start and not after it: between Nov 20, 2026, 1:00 PM EST and 7:00 PM EST." | Backend message, form message |
| `formatDoorsOpen(startsAt, doorsOpenAt, zone)` | `formatEventEnd`'s rule: "5:30 PM EST", or the full date and time when the local date differs from the start's | Customer and Admin displays (research R9) |

## Writes (Backend, `EventsService`)

| Request | `doorsOpenAt` sent | Stored |
| --- | --- | --- |
| Create | no | `startsAt - 60 minutes` |
| Create | yes | as sent, after `020`'s zone checks (`field: doorsOpenAt`) and the range check (`400 DOORS_OPEN_OUT_OF_RANGE`) |
| Update, start changed (sent and different) | no | `stored doorsOpenAt + (new startsAt - stored startsAt)`: the same gap, no check needed |
| Update | yes | as sent, checked against the start in force after the update |
| Update, start not changed | no | unchanged |
| Venue zone change (`020`) | — | the same local date and time in the new zone; refused (`409 EVENT_TIME_NOT_IN_ZONE`, `field: doorsOpenAt`) when skipped, repeated, before standard time, or then out of range (`reason: DOORS_OUT_OF_RANGE`) (research R5) |
| Cancel | — | unchanged; a cancelled event is still refused for updates (`EVENT_CANCELLED`) |

## What the Admin form sends (`EventForm`)

| Save | `doorsOpenAt` |
| --- | --- |
| Create | always: the Doors open field, in the venue's local time with its offset |
| Edit | always, like `startsAt` and `endsAt` |

Form state added: `doorsOpenAt` (local string, like `startsAt`), `occurrence.doorsOpenAt`,
`doorsTouched` (false on load; true once the admin changes Doors open), and `doorsGapMs` (60 minutes
on create; `stored startsAt - stored doorsOpenAt` on edit) (research R4).

## Ticket Booth list (`EventPicker`)

| Item | When | Shows | Choosable |
| --- | --- | --- | --- |
| Open | `entryOpensAt <= now` (or `entryOpensAt` missing) | `{name} · {start}` | yes (button) |
| Not open yet | `entryOpensAt > now` | `{name} · {start}`, "Not open yet", "Opens {time today, or date and time}" | no (text, not a control) |

`now` is the device's clock; every 30 seconds while the list is shown, `now` is refreshed and the
list fetched again. Scheduled events not ended, soonest start first, as today (research R8).

## Existing data

| Data | After the migration |
| --- | --- |
| Every event (scheduled or cancelled) | `doorsOpenAt = startsAt - 1 hour`, so check-in still opens 2 hours before the start (SC-004) |
| Tickets, entries, orders, venues | unchanged |
| Demo data loaded later | through the Backend, no `doorsOpenAt` sent: start minus 1 hour (research R11) |
