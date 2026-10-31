# Data Model: Venue Form Simplify

**Feature**: `024-venue-form-simplify` | **Spec**: [spec.md](./spec.md)

No database change: no Prisma schema change, no migration. `Location`'s columns (`013`'s address
parts and `addressVerified`, `020`'s `timeZone` and `timeZoneSource`) are unchanged. What changes is
which requests write them, and how.

## Venue writes (Backend, `LocationsService`)

| Request | Address service answer | Written | Zone |
| --- | --- | --- | --- |
| Create or address change, `acceptUnverifiedAddress: true` | one match keeping ZIP and house number | standard form, `addressVerified: true` | sent → `ADMIN`; else from the place, else the state, else `TIME_ZONE_REQUIRED` (`020` R7) |
| same | none, several, a moved match | as sent (trimmed, spaces collapsed, ZIP 5 digits), `addressVerified: false` | sent → `ADMIN`; else the state's one zone, else `TIME_ZONE_REQUIRED` |
| same | **unavailable** (no answer in 5 s, error status, unreadable) | **as sent, `addressVerified: false`** (was `503`, research R5) | as the row above |
| Create or address change, no flag | unavailable | nothing; `503 ADDRESS_SERVICE_UNAVAILABLE` (unchanged) | — |
| Create or address change, no flag | none, several, a moved match | nothing; `400 ADDRESS_NOT_FOUND` / `ADDRESS_AMBIGUOUS` (unchanged) | — |
| **Edit, same address, venue not verified** (fields set), `acceptUnverifiedAddress: true` | one match keeping ZIP and house number | **standard form, `addressVerified: true`**, if the row re-read under the venue lock still has that address and is not verified; else nothing about the address (research R7) | **not decided by the check**; changes only if `timeZone` is sent |
| same | anything else, unavailable included | **nothing about the address; never refused** | as the row above |
| Edit, same address, venue not verified, **no flag**; same address, venue verified; no address fields | not asked | nothing about the address (unchanged, `013` FR-008) | unchanged unless sent |

"Same address" is `013`'s rule: the four fields equal the stored ones, ignoring case and extra
spaces, the ZIP code compared on its first 5 digits; a venue from before `013` (no fields) never has
the same address.

## What the Admin app sends (`LocationForm`)

| Save | Address fields | `acceptUnverifiedAddress` | `timeZone` |
| --- | --- | --- | --- |
| Create | always | `true` | the chosen zone; required by the form (research R1) |
| Edit, the address differs from the venue as loaded (a pre-`013` venue whose fields were filled in included) | sent | `true` | the zone shown, always (research R3) |
| Edit, the address as loaded, the loaded venue not verified and its fields set | sent (checked again, R7) | `true` | the zone shown, always |
| Edit, the address as loaded, the loaded venue verified; or a pre-`013` venue with its fields left empty | not sent | not sent | only when the admin picked a zone other than the stored one |

When `timeZone` is sent with the zone the venue already has, the Backend records it as `ADMIN`
(`020` R4); the form says so under the select before saving when the stored source is not `ADMIN`
(research R1).

The form's other values (name, capacity, the seated layout on create) are sent as today.

## Form state removed from `LocationForm`

`offerSaveAnyway`, `stateZone`, `requiredZones`, the split-state values derived from them
(`splitZones`, `storedInState`, `chosenStateZone`), and `SAVE_ANYWAY_CODES`. `zoneProblem` stays, now
"Choose the venue's time zone." (research R1). `zoneChoice` is `UsTimeZone | ''` on create (empty
until chosen) and starts as the stored zone on edit.

## Section line (Admin app, `SectionLines`)

| Field | Type | Rule |
| --- | --- | --- |
| `name` | text as typed | label "Section name"; name "Section {i} Section name" |
| `rows` | text as typed | label "Rows"; name "Section {i} Rows"; `min` 1, `max` 100 |
| `seatsPerRow` | text as typed | label "Seats per row"; name "Section {i} Seats per row"; `min` 1, `max` 200 |
| seat count | shown, not stored | `(Number(rows) \|\| 0) × (Number(seatsPerRow) \|\| 0)`, as `= {n, with separators} seat(s)` |

`toSectionInputs` and `totalSeats` are unchanged; the layout sent and stored (`007`) is unchanged.

## Address stand-in (browser tests only)

`e2e/stack/geocoder-stub/server.mjs` answers `503` with `{ "errors": ["stand-in outage"] }` for a
lookup whose street is `0 Outage Way` (ignoring case), before matching `addresses.json`, whose
entries are unchanged (research R10). `e2e/fixtures/data.ts` exports:

| Name | Street, city, state, ZIP | The stand-in answers |
| --- | --- | --- |
| `UNKNOWN_PLACE` | 1 Nowhere Blvd, Louisville, KY 40202 | no match |
| `OUTAGE_PLACE` | 0 Outage Way, Louisville, KY 40202 | `503` (unavailable) |
