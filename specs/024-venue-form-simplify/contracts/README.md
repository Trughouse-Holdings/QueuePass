# Contract Changes: Venue Form Simplify

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.14.0 to 1.15.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passing (research R5).

**Descriptions only.** No operation, path, role, request or response shape, `required` list, or
error code changes, so no `x-planned` marker, no new `ERROR_CODES`, and the contract tests that
validate responses are unaffected while the Backend on `main` still refuses with `503` (the `503`
response stays declared on both operations: a caller without the flag still gets it). The minor
version follows the repository's one minor per feature that changes the contract (`013` research
R11, `020` research R18): a documented request now succeeds where it was refused.

| Where | Change |
|---|---|
| `info.version` | 1.14.0 → 1.15.0 |
| `createLocation` | The "Save anyway" paragraph: with `acceptUnverifiedAddress: true`, an address service that cannot be reached, does not answer within 5 seconds, or answers with an error also saves the venue as sent with `addressVerified: false` (feature 024). The `503` paragraph: only without the flag. The zone paragraph: the Admin app always sends `timeZone` (feature 024); other callers may leave it out. |
| `updateLocation` | Feature 013's paragraph: an edit with the same address never calls the address service **unless the venue's address is not verified**: then it is checked again; a match is saved verified in the service's standard form, and any other answer (service unavailable included) leaves the address as stored, never refused, and does not decide the zone (feature 024). Feature 020's paragraph: the zone is decided again only when the address changed, never on that re-check. The unavailable case with the flag as in `createLocation`. |
| `Location` | The `addressVerified: false` with fields bullet: saved with `acceptUnverifiedAddress` because the address service did not match it or could not be asked (feature 024). |
| `LocationInput.timeZone` | Adds: the Admin app always sends it (feature 024); optional for other callers. |
| `AcceptUnverifiedAddress` | Reworded: "save even if unverified". The Admin app sends it with every address (feature 024). With no match, several, a moved match, **or the service unavailable**, the venue is saved as sent, not verified; with a verified match it is saved verified. |
| `AddressServiceUnavailable` (response) | Adds: returned only when `acceptUnverifiedAddress` is not `true` (feature 024). |

Unchanged: `AddressRejected` (`ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS`, `TIME_ZONE_REQUIRED` are still
returned to a caller without the flag, or without a zone in a two-zone state), every example, and
every other operation.

## Examples

A create the Admin app sends while the address service is down (1.15.0):

```json
{
  "name": "Rupp Arena",
  "street": "430 W Vine St",
  "city": "Lexington",
  "state": "KY",
  "zip": "40507",
  "acceptUnverifiedAddress": true,
  "timeZone": "America/New_York",
  "seatingCapacity": 20500
}
```

`201`, with `"address": "430 W Vine St, Lexington, KY 40507"`, `"addressVerified": false`,
`"timeZone": "America/New_York"`, `"timeZoneSource": "ADMIN"`. The same request without
`acceptUnverifiedAddress` is still `503 ADDRESS_SERVICE_UNAVAILABLE`, and nothing is saved.

An edit of that venue, sending the same four fields and nothing else changed, once the service
is back and matches it: `200`, `"address": "430 W VINE ST, LEXINGTON, KY 40507"`,
`"addressVerified": true`, the zone and `timeZoneSource` unchanged.
