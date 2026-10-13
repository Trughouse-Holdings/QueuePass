# Contract Changes: Venue Address Validation and Google Maps Link

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.6.0 to 1.7.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`). `016` took 1.6.0 and
merged first (PR #29), so this branch was rebased onto it (research R11). No route is added or
removed, and no role changes.

| Where | Change |
|---|---|
| `Location` | adds `street`, `city`, `state` (`UsState`), `zip`, each a value or `null` (`null` = from before `013`), and `addressVerified: boolean`. Always sent, not in `required` (research R11). `address` unchanged, now documented as built from the parts. |
| `LocationInput` | adds `street` (1–200), `city` (1–100), `state` (`UsState`), `zip` (`^[0-9]{5}(-[0-9]{4})?$`), and optional `acceptUnverifiedAddress`; removes `address`. The four are required by the Backend but not listed in `required` (research R11). |
| `LocationUpdate` | adds the same four, optional, all together or none, and `acceptUnverifiedAddress` (only with the four); removes `address`. |
| `AcceptUnverifiedAddress` | new schema: boolean, default `false`. "Save anyway" after a not-found or ambiguous refusal; never bypasses `503` (research R2, R6). |
| `UsState` | new schema: enum of the 50 states and DC. |
| `createLocation` | description: the address check, the standard form, save anyway, the three refusals. `400` → `AddressRejected`; new `503`. |
| `updateLocation` | description: all four or none; checked only when changed, after the other checks; `addressVerified` kept when unchanged. `400` → `AddressRejected`; new `503`. |
| `AddressRejected` | new response: `VALIDATION_FAILED`, `ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS` examples; says the request may be resent with `acceptUnverifiedAddress: true`. `ADDRESS_AMBIGUOUS` also covers one match at a different ZIP code or house number than sent (descriptions reworded after live testing; still 1.7.0). |
| `AddressServiceUnavailable` | new response: `503 ADDRESS_SERVICE_UNAVAILABLE`. |
| `ErrorEnvelope.code` | adds `ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS`, `ADDRESS_SERVICE_UNAVAILABLE`. |

Unchanged: `listLocations` (`q` still matches name or address), `getLocation`, `deleteLocation`,
and every event operation (their embedded `location` gains the new fields through `Location`).

Candidates are in our one-line form, `STREET, CITY, ST ZIP` (Census itself writes
`…, IL, 62701`); one that cannot be split is shown as the service returned it (research R3). A
match the Backend cannot split is reported as `ADDRESS_NOT_FOUND`.

Example refusals:

```json
{
  "error": {
    "code": "ADDRESS_NOT_FOUND",
    "message": "We couldn't find 1 Nowhere Blvd, Louisville, KY 40202 as a US address. Check the street, city, state, and ZIP code.",
    "details": { "address": "1 Nowhere Blvd, Louisville, KY 40202" }
  }
}
```

```json
{
  "error": {
    "code": "ADDRESS_AMBIGUOUS",
    "message": "100 Main St, Springfield, IL 62701 matches more than one US address. Enter one of these.",
    "details": {
      "address": "100 Main St, Springfield, IL 62701",
      "candidates": ["100 N MAIN ST, SPRINGFIELD, IL 62701", "100 S MAIN ST, SPRINGFIELD, IL 62701"]
    }
  }
}
```

One match at a different ZIP code or house number (Kroger Field, research R3):

```json
{
  "error": {
    "code": "ADDRESS_AMBIGUOUS",
    "message": "We found a different US address for 1540 University Dr, Lexington, KY 40508. Did you mean this one? Enter it to use it.",
    "details": {
      "address": "1540 University Dr, Lexington, KY 40508",
      "candidates": ["1540 UNIVERSITY CT, LEXINGTON, KY 40503"]
    }
  }
}
```

```json
{
  "error": {
    "code": "ADDRESS_SERVICE_UNAVAILABLE",
    "message": "We can't verify the address right now. Nothing was saved. Try again in a minute."
  }
}
```

Example venue after a verified save:

```json
{
  "id": "…",
  "name": "Rupp Arena",
  "address": "430 W VINE ST, LEXINGTON, KY 40507",
  "street": "430 W VINE ST",
  "city": "LEXINGTON",
  "state": "KY",
  "zip": "40507",
  "addressVerified": true,
  "seatingCapacity": 20500,
  "createdAt": "…",
  "updatedAt": "…"
}
```

Save anyway, after `ADDRESS_NOT_FOUND` for the KFC Yum! Center:

```json
{ "name": "KFC Yum! Center", "street": "1 Arena Plaza", "city": "Louisville", "state": "KY",
  "zip": "40202", "seatingCapacity": 22090, "acceptUnverifiedAddress": true }
```

→ `201` with `"address": "1 Arena Plaza, Louisville, KY 40202"` and `"addressVerified": false`.
The same request while the service is down → `503 ADDRESS_SERVICE_UNAVAILABLE`.
