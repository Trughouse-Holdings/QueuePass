# Contract Changes: Doors Open

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.15.0 to 1.16.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passing (research R6).

No new operation, so no `x-planned` marker. Every new response property is documented as always sent
but left out of `required`, and every new request property is optional, so `main` stays green
between this PR and the implementation (`020` research R18). **The implementation PR** moves
`Event.doorsOpenAt`, `Event.entryOpensAt`, and `OrderEvent.doorsOpenAt` into `required`, sets
**1.18.1** (not 1.16.1: `026`'s spec PR took 1.17.0, `026` research R13, and #114 then 1.18.0,
on `main` first), and
regenerates, in the same PR that makes the Backend send them (research R6; tasks T025).

| Where | Change |
|---|---|
| `info.version` | 1.15.0 → 1.16.0 |
| `info.description` | **Venue time zones**: `doorsOpenAt` is an event time sent in the venue's local time. New paragraph **Doors open**: the range (6 hours before the start to the start, `DOORS_OPEN_OUT_OF_RANGE`), `entryOpensAt` (1 hour before doors), the gate window `[entryOpensAt, endsAt)` for every kind of code, the defaults (create: start minus 1 hour; update moving the start: same gap), and no part in the 60-minute rule. |
| `Event` | gains `doorsOpenAt` (`date-time`) and `entryOpensAt` (`date-time`, worked out by the Backend); not in `required` in 1.16.0. |
| `EventInput` | gains optional `doorsOpenAt`: left out, the start minus 1 hour; the venue's local time and offset; the range. |
| `EventUpdate` | gains optional `doorsOpenAt`: checked against the start in force after the update; left out while the start changes, it moves by the same amount. |
| `OrderEvent` | gains `doorsOpenAt`, for My tickets and the printed ticket; not in `required` in 1.16.0. |
| `listEvents` | description: each event carries `doorsOpenAt` and `entryOpensAt`; the Ticket Booth lets an agent choose only events whose `entryOpensAt` has passed; the entry operations enforce it. |
| `createEvent` | description: `doorsOpenAt` optional, default, checked after `endsAt` against the venue's zone (`details.field: doorsOpenAt`), then the range (`400 DOORS_OPEN_OUT_OF_RANGE`), before the capacity checks. |
| `updateEvent` | description: `doorsOpenAt` checked against the start in force after the update; the gap kept when only the start changes, including a move to a venue in another zone; moving doors later can close an open window, entries stay. |
| `updateLocation` | description: on a zone change, `doorsOpenAt` keeps its local time like the start and end, with the same refusals (`details.field: doorsOpenAt`), plus `409 EVENT_TIME_NOT_IN_ZONE` with `details.reason` `DOORS_OUT_OF_RANGE` when the moved doors break the range. |
| `lookupEntryTicket` | description: `NOT_OPEN` until `entryOpensAt`, 1 hour before `doorsOpenAt`; the window `[doorsOpenAt - 1 hour, endsAt)` for ticket and live codes alike; events from before 025 keep their window. |
| `admitTicket` | description: the same window. |
| `EntryTicket.entryOpensAt` | description: 1 hour before the event's `doorsOpenAt`. |
| `EventTimeRejected` | description: `details.field` may be `doorsOpenAt`; `DOORS_OPEN_OUT_OF_RANGE` with `details.field`, `doorsOpenAt`, `startsAt`, `earliest`, `latest`, `timeZone`; new example `doorsOpenOutOfRange`. |
| `ErrorEnvelope.code` | adds `DOORS_OPEN_OUT_OF_RANGE`, after `UTC_OFFSET_MISMATCH`. |

Unchanged: every operation's path, roles, and success status; `EntryTicket`'s shape; the `NOT_OPEN`
and `ENDED` reasons; `Conflict`; every other schema.

Also in this PR: `packages/shared/src/errors.ts` lists `DOORS_OPEN_OUT_OF_RANGE` in `ERROR_CODES`,
after `UTC_OFFSET_MISMATCH` (the Backend's list test fails when a contract code is missing).

## Examples

Scheduling 7:00 PM to 10:00 PM on Nov 20, 2026 at a venue in Eastern Time, doors at 5:30 PM:

```bash
curl -s -X POST http://localhost:3000/events -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Fall Concert","locationId":"0f8a9d3e-…","basePrice":"45.00",
       "startsAt":"2026-11-20T19:00:00-05:00","endsAt":"2026-11-20T22:00:00-05:00",
       "doorsOpenAt":"2026-11-20T17:30:00-05:00"}'
```

→ `201`, with `"startsAt": "2026-11-21T00:00:00.000Z"`, `"doorsOpenAt": "2026-11-20T22:30:00.000Z"`,
and `"entryOpensAt": "2026-11-20T21:30:00.000Z"`: the apps show "Doors open 5:30 PM EST", and the
Ticket Booth "Opens 4:30 PM EST".

The same request without `doorsOpenAt` → `201` with `"doorsOpenAt": "2026-11-20T23:00:00.000Z"`
(6:00 PM EST). With `"doorsOpenAt":"2026-11-20T12:30:00-05:00"`:

```json
{
  "error": {
    "code": "DOORS_OPEN_OUT_OF_RANGE",
    "message": "Doors must open no more than 6 hours before the start and not after it: between Nov 20, 2026, 1:00 PM EST and 7:00 PM EST.",
    "details": {
      "field": "doorsOpenAt",
      "doorsOpenAt": "2026-11-20T17:30:00.000Z",
      "startsAt": "2026-11-21T00:00:00.000Z",
      "earliest": "2026-11-20T18:00:00.000Z",
      "latest": "2026-11-21T00:00:00.000Z",
      "timeZone": "America/New_York"
    }
  }
}
```

Then `PATCH /events/{id}` with only `"startsAt":"2026-11-20T20:00:00-05:00"` and
`"endsAt":"2026-11-20T23:00:00-05:00"` → `200`, `"doorsOpenAt": "2026-11-20T23:30:00.000Z"` (6:30
PM EST: the 90-minute gap kept).

A lookup at 4:20 PM EST of a ticket for that event (doors 5:30 PM) → `200` with `"state":
"NOT_OPEN"` and `"entryOpensAt": "2026-11-20T21:30:00.000Z"`; at 4:31 PM → `"state": "ADMITTABLE"`.
