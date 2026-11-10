# Contracts: Drop Check-in Details a Week After the Event

`contracts/openapi.yaml` goes from `1.23.0` (spec `031`, unmerged; `main` is at `1.22.0`) to
**`1.24.0`** (MINOR: new optional response fields and one new error code). No operation is added or
removed; no request shape changes.

- `info.description`: a **Check-in retention** paragraph: details kept until `endsAt` + 7 days
  (half-open), removed within about an hour after, cancelled events included; then every ticket of the
  event has `checkedInAt: null`, the report keeps the count, and the event's times cannot change.
- `Event.checkInDetailsRemovedAt` (`string | null`, date-time): when the details were removed.
- `OrderEvent.checkInDetailsRemovedAt`: the same, for My tickets ("Event over").
- `EventSales.checkInDetailsRemovedAt`: the same, for the Sales card and Reports; `EventSales.checkedIn`
  is described: 0 for a cancelled event, the kept count once removed.
- `Ticket.checkedInAt` is described: also `null` once the event's details were removed.
- `updateEvent`: a **Feature 032** paragraph: on a removed event, a change to `startsAt`, `endsAt`, or
  `doorsOpenAt` (the instant in force after the update differs from the stored one) is
  `409 CHECK_IN_DETAILS_REMOVED`, `details.removedAt`; the same instants, or other fields only, pass.
- `ErrorEnvelope.code` gains `CHECK_IN_DETAILS_REMOVED`; `responses.Conflict` gains the example
  `checkInDetailsRemoved`.

The three new fields are **not listed as required**, as `014` and `016` did, so this contract merges
ahead of the implementation with the suite green (responses without them still match); clients treat
a missing value as `null`. The implementation always sends them.

`packages/shared/src/api-schema.ts` is regenerated (`node node_modules/openapi-typescript/bin/cli.js
contracts/openapi.yaml -o packages/shared/src/api-schema.ts`); `packages/shared/src/errors.ts` gains
`CHECK_IN_DETAILS_REMOVED`, ahead of the implementation, so the list matches the contract. The
hand-written types in `packages/shared/src/event.ts` and `order.ts` gain the fields in the
implementation (tasks T007).

This branch applies on top of `031`'s `1.23.0`; until `031` merges, the `version` line and any line
both touch conflict on rebase and are resolved by keeping both changes.
