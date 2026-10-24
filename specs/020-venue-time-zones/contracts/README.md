# Contract Changes: Venue Time Zones

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.12.0 to 1.13.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passing. `019`'s spec PR (#82) merged first at 1.12.0; this
branch is rebased onto it and keeps both properties of `OrderEvent.location` (`019`'s `address`,
this feature's `timeZone`) (research R18). The narrower event-time input is a minor version, as
R18 explains.

No new operation, so no `x-planned` marker (the repository's rule covers operations only). Every
new response property is documented as always sent but left out of `required`, and every new
request property and query parameter is optional, so `main` stays green between this PR and the
implementation (research R18).

| Where | Change |
|---|---|
| `info.version` | 1.12.0 → 1.13.0 |
| `info.description` | new paragraph **Venue time zones**: responses send UTC instants; clients show event times in the venue's `timeZone` with its abbreviation; event times sent to the API state the venue's local time with the venue's offset; `LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH`; a repeated local time is accepted with either offset (R9). |
| `UsTimeZone` | new schema: enum of the eight IANA names (R2). |
| `TimeZoneSource` | new schema: `ADDRESS`, `STATE`, `ADMIN`, `DEFAULT` (R5); `DEFAULT` covers existing venues and demo data saved offline (R19). |
| `Location` | gains `timeZone` (`UsTimeZone`) and `timeZoneSource`; not in `required`; description says clients treat a missing `timeZone` as `America/New_York`. |
| `LocationInput`, `LocationUpdate` | gain optional `timeZone`, the admin's explicit choice (R4). |
| `createLocation` | description: how the zone is decided (sent → address → state), `400 TIME_ZONE_REQUIRED` for a split state (R3, R7). |
| `updateLocation` | description: when the zone changes and what moves; `409 TIME_ZONE_HAS_ORDERS`, `409 EVENT_TIME_NOT_IN_ZONE`, `409 SCHEDULING_CONFLICT` (R8). Its `409` becomes `examples` (`capacityExceeded`, `timeZoneHasOrders`, `eventTimeNotInZone`). |
| `AddressRejected` | description and example `timeZoneRequired` (`details.state`, `details.timeZones`). |
| `listEvents` | new optional query parameters `fromDate` and `toDate` (`format: date`, inclusive, compared with each event's local start date in its venue's zone); not combinable with `from`/`to` (R15). |
| `createEvent`, `updateEvent` | descriptions: a time without an offset (or a date only) is `VALIDATION_FAILED`; the zone checks and their place in the refusal order; moving to a venue in another zone must send both times (R9). `400` now refers to the new `EventTimeRejected` response. |
| `EventInput`, `EventUpdate` | `startsAt`, `endsAt` (and `EventUpdate.locationId`) descriptions and examples with the venue's offset. |
| `EventTimeRejected` | new response: `VALIDATION_FAILED` (examples: a field, and a time without a UTC offset), `LOCAL_TIME_SKIPPED` (`details.field`, `localTime`, `timeZone`, `skippedFrom`, `skippedTo`), `UTC_OFFSET_MISMATCH` (`details.field`, `localTime`, `timeZone`, `sentOffset`, `expectedOffsets`). |
| `OrderEvent.location` | gains optional `timeZone` (R16), next to `019`'s `address`. |
| `EventSales` | gains optional `timeZone` (R16). |
| `EntryTicket.event` | gains optional `timeZone`; `admitTicket`'s description says `ENTRY_REFUSED`'s `details.event` carries it too (R16). |
| `Conflict` | description: messages use the venue's local time, the start with its date; `details.event` for a zone change's pair. The `schedulingConflict` example's message is in the new form. |
| `ErrorEnvelope.code` | adds `TIME_ZONE_REQUIRED`, `TIME_ZONE_HAS_ORDERS`, `EVENT_TIME_NOT_IN_ZONE`, `LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH`, after the `018` codes. |

Unchanged: every operation's path, roles, and success shape; every response still sends instants in
UTC.

Also in this PR: `packages/shared/src/errors.ts` lists the five codes in `ERROR_CODES` (the
Backend's `us-states.spec.ts` fails when a contract code is missing).

**Follow-up after the implementation merges** (R18): move `Location.timeZone`,
`Location.timeZoneSource`, `OrderEvent.location.timeZone`, `EventSales.timeZone`, and
`EntryTicket.event.timeZone` into `required`, and regenerate. The implementation opens the issue.

## Examples

A venue, as every venue response returns it once implemented:

```json
{
  "id": "0f8a9d3e-4b1c-4a2e-9d7f-1e2c3b4a5d6f",
  "name": "Demo Riverside Hall",
  "address": "430 W VINE ST, LEXINGTON, KY 40507",
  "street": "430 W VINE ST",
  "city": "LEXINGTON",
  "state": "KY",
  "zip": "40507",
  "addressVerified": true,
  "timeZone": "America/New_York",
  "timeZoneSource": "ADDRESS",
  "seatingCapacity": 400,
  "createdAt": "2026-10-24T18:00:00.000Z",
  "updatedAt": "2026-10-24T18:00:00.000Z"
}
```

Scheduling 7:00 PM to 10:00 PM local time at that venue:

```bash
curl -s -X POST http://localhost:3000/events -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Fall Concert","locationId":"0f8a9d3e-…","basePrice":"45.00",
       "startsAt":"2026-10-01T19:00:00-04:00","endsAt":"2026-10-01T22:00:00-04:00"}'
```

→ `201`, with `"startsAt": "2026-10-01T23:00:00.000Z"`, which every app shows as "Oct 1, 2026,
7:00 PM EDT".

The same request with `"startsAt":"2026-10-01T19:00:00-07:00"` (a browser in California converting
in its own zone) → `400 UTC_OFFSET_MISMATCH`. With `"startsAt":"2027-03-14T02:30:00-05:00"` →
`400 LOCAL_TIME_SKIPPED`. With `"2027-11-07T01:30:00-04:00"` or `"2027-11-07T01:30:00-05:00"` →
`201`, the first or second 1:30 AM.

Changing that venue's zone to Central with `{"timeZone":"America/Chicago"}` → `200`, and the event
now starts at `"2026-10-02T00:00:00.000Z"` (7:00 PM CDT); or `409 TIME_ZONE_HAS_ORDERS` if it has
an order.
