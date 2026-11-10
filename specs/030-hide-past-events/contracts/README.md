# Contract Changes: Hide Past Events

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.21.0 to 1.22.0** in the spec and plan PR (MINOR: a new optional
parameter, and the default list changes for every client), with `packages/shared/src/api-schema.ts`
regenerated (`node node_modules/openapi-typescript/bin/cli.js contracts/openapi.yaml -o
packages/shared/src/api-schema.ts`, the same as `npm run generate:api`) and `node
scripts/check-contract-drift.mjs` passing (research R12).

No new operation, so no `x-planned` marker. Until the implementation merges, `main`'s Backend lists
every event and refuses `includePast` as an unknown parameter; no client sends it before then, so
`main` stays green.

| Where | Change |
| --- | --- |
| `info.version` | 1.21.0 → 1.22.0 |
| `listEvents` description | New paragraph **Feature 030**: past events are left out unless `includePast` is `true`; an event is past from the instant the Backend's clock, when it answers, reaches its `endsAt` (half-open: at `endsAt` exactly it is past), whatever its `status`; `includePast` combines with every other filter, the order is unchanged; any caller may send it; `getEvent` and every other operation are unaffected. |
| `listEvents` parameters | New `includePast`, in query, optional, `type: boolean, default: false`: `true` also lists events whose `endsAt` has been reached; any other value is `400 VALIDATION_FAILED`. |
| `listEvents` `200` description | "Matching events, ordered by start time; past events only with `includePast`." |

Unchanged: the operation's path, `x-required-roles: []`, its responses' schemas and error codes; the
`Event` schema (no `ended` field, research R6); every other operation.

`api-schema.ts` gains `includePast?: boolean` in `operations.listEvents.parameters.query`, and the two
descriptions.

## Examples

```http
GET /events
```

→ `200`, events whose `endsAt` is after now, soonest start first.

```http
GET /events?includePast=true&locationId=6c0e…
```

→ `200`, every event at that venue, past ones included, soonest start first.

```http
GET /events?includePast=yes
```

→ `400`:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed.",
    "details": { "fields": ["includePast must be true or false"] }
  }
}
```

The `400` body is the existing `ValidationFailed` response: `details.fields` is the list of
messages the validation produced (`backend/src/common/filters/prisma-exception.filter.ts`).

Also in this PR (spec review round 1): the contract's four `VALIDATION_FAILED` examples
(`ValidationFailed`, `EventTimeRejected`'s `validationFailed` and `noUtcOffset`, and
`OrderRejected`'s `validationFailed`) showed `details.fields` as a map from field to message; the Backend sends
a list of messages. They now show lists. Example text only; the schema (`details`, any object) and the
version (1.22.0) are unchanged; `api-schema.ts` is regenerated, and only the `ValidationFailed`
example in a doc comment changes.
