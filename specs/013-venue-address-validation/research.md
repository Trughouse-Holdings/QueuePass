# Research: Venue Address Validation and Google Maps Link

Decisions for [plan.md](./plan.md). Each has a decision, its rationale, and the alternatives
considered.

## R1. The address service is the US Census Geocoder, behind a small swappable client

**Decision**: The Backend calls the Census Geocoder's single-address endpoint:

```text
GET {ADDRESS_GEOCODER_URL}/geocoder/locations/address
    ?street=430+W+Vine+St&city=Lexington&state=KY&zip=40507
    &benchmark=Public_AR_Current&format=json
```

`ADDRESS_GEOCODER_URL` defaults to `https://geocoding.geo.census.gov` (in `.env.example`,
`docker-compose.yml`, and the code). It is not a secret; the service needs no key. The `zip`
parameter is always the first 5 digits.

The call sits behind one interface, `AddressGeocoder`, injected with the token
`ADDRESS_GEOCODER`. Its one method, `lookup(parts)`, returns one of:

- `{ kind: 'match', street, city, state, zip }`,
- `{ kind: 'none' }`,
- `{ kind: 'many', candidates: string[] }`,

and throws `AddressServiceUnavailableError` for every failure (R6). `CensusGeocoder` is the only
real implementation. Nothing outside it knows the Census URL or response shape.

**Verified on 2026-10-11** by calling the live service:

- `4600 Silver Hill Rd, Washington, DC 20233` → one match, `matchedAddress`
  `"4600 SILVER HILL RD, WASHINGTON, DC, 20233"`.
- `430 W Vine St, Lexington, KY 40507` → one match, `"430 W VINE ST, LEXINGTON, KY, 40507"`.
- `937 Phillips Ln, Louisville, KY 40209` → one match, `"937 PHILLIPS LN, LOUISVILLE, KY, 40209"`.
- `1 Nowhere Blvd, Louisville, KY 40202` → `"addressMatches": []`.
- `1 Arena Plaza, Louisville, KY 40202` (the KFC Yum! Center, a real address) →
  `"addressMatches": []`. Also with `Plz` and no ZIP.

The response is `{ "result": { "input": {...}, "addressMatches": [ { "matchedAddress",
"coordinates": { "x", "y" }, "addressComponents": {...}, "tigerLine": {...} } ] } }`.
`addressComponents` gives the street's number range (`fromAddress`, `toAddress`), not the house
number, so the saved parts come from `matchedAddress` (R3). The HTTP status for a malformed
request and the shape of the service's own error body were not observed; every non-2xx answer is
treated as unavailable (R6), so the client does not depend on them.

**Rationale**: Decided by the user, 2026-10-11: free, no key, no secret to manage (Constitution
Security). One interface keeps tests off the network (R9) and lets a later feature swap the
service by writing one class.

**Known limit**: the Census service matches against street address ranges, and misses some real
addresses, such as the KFC Yum! Center above. Such an address is refused like any other unmatched
address (spec Edge Cases). The admin enters a form the service knows. There is no override
(spec Assumptions).

**Alternatives considered**: Google's Address Validation API (needs a key and billing; the user
chose Census). USPS Web Tools (needs registration). The Census one-line endpoint
(`onelineaddress`) (we already have the parts; the parts endpoint parses less).

## R2. Exactly one match is "real"; none and several are refused with their own codes

**Decision**: The client groups `addressMatches` by `matchedAddress`:

- one distinct `matchedAddress` → `match`;
- none → `none` → `400 ADDRESS_NOT_FOUND`;
- two or more distinct → `many` (up to the first 5) → `400 ADDRESS_AMBIGUOUS`, with
  `details.candidates` listing them in the service's order.

Both refusals carry `details.address`, the one-line address as the admin typed it, and a message
naming it. Nothing is saved.

**Rationale**: FR-003 to FR-005. A match the admin cannot see could be the wrong building; listing
the candidates lets them type the right one. `400` because the request is wrong as sent, like
`VALIDATION_FAILED`; separate codes let the Admin app branch on `code` (Constitution I).

**Alternatives considered**: Taking the first of several matches (could save the wrong street).
Folding "several" into `ADDRESS_NOT_FOUND` with candidates (one code with two meanings). `422`
(no other operation in the contract uses it).

## R3. Save the service's standard form, built from `matchedAddress`

**Decision**: `matchedAddress` is always `STREET, CITY, ST, ZIP` (four comma-separated parts in
the samples above). The client splits it from the right: the last part is the ZIP code, then the
state, then the city, and everything before is the street. If the split does not give a 2-letter
state in `US_STATES` and a 5-digit ZIP code, the answer is treated as unreadable (R6). The venue
stores these four parts exactly as returned (upper case), and `address` is built from them as
`STREET, CITY, ST ZIP` (FR-010), for example `430 W VINE ST, LEXINGTON, KY 40507`. After saving,
the Admin app shows the saved address (FR-012).

**Rationale**: What the service vouched for is what is stored, so a typo the service corrected (a
wrong ZIP code, "Lexinton") is not kept. One standard form also makes FR-008's "same address"
comparison reliable.

**Alternatives considered**: Storing what the admin typed (keeps the typo the check forgave).
Title-casing the service's answer ("Mcdonald St", "Nw" are wrong more often than upper case is
ugly; Constitution VII puts function first).

## R4. Storage: four nullable columns, and `address` stays

**Decision**: `Location` gains `street VARCHAR(200)`, `city VARCHAR(100)`, `state VARCHAR(2)`, and
`zip VARCHAR(5)`, all nullable. `address` stays `NOT NULL`. Three CHECKs (data-model.md): the four
parts are all set or all `NULL`; `state` is two capital letters and `zip` five digits; and when the
parts are set, `address` equals `street || ', ' || city || ', ' || state || ' ' || zip`. No
coordinates are stored.

A venue with `NULL` parts is "not verified" (spec US4). There is no separate flag.

**Rationale**: Keeping `address` means venue search (`004` FR-007), the event responses that embed
the venue, and every display keep working with no change (FR-010, FR-016). The CHECKs make it a
database fact that the line and the parts agree. The Google Maps link is built from text (R10), so
coordinates would be unused (Constitution VIII).

**Alternatives considered**: Dropping `address` and building it on read (search would need an
expression over four columns, and existing rows would lose their address). A `verified` boolean
(says the same as `street IS NOT NULL`, and could disagree with it).

## R5. Existing venues are not converted

**Decision**: The migration adds the columns and CHECKs only. Existing rows keep their `address`
and get `NULL` parts. They are checked only when an admin next changes their address (FR-016).
The Admin app marks them "Address not verified" on the venue page and shows the old address above
the four empty fields in the edit form (FR-017).

**Rationale**: Existing addresses are free text ("1 Demo Plaza, Louisville, KY", "Y"), most with
no ZIP code, so a parse would guess, and a guessed part is worse than an honest `NULL`. A
migration must not call the network (it runs at every startup, offline included). Nothing about an
existing venue stops working.

**Alternatives considered**: A best-effort parse in SQL (wrong parts for any address that does not
fit the pattern, presented as if verified). A one-off script that geocodes every venue (needs the
network, and refuses real venues the service does not know, R1).

## R6. "Unavailable" covers every failure, with a 5-second limit, as `503`

**Decision**: `CensusGeocoder` throws `AddressServiceUnavailableError` when the request fails to
connect, takes longer than 5 seconds (`AbortSignal.timeout(5000)` on Node 22's global `fetch`),
returns a non-2xx status, returns a body that is not JSON, or returns JSON without
`result.addressMatches` as an array, or a match that R3 cannot split. There is no retry. The
service turns it into `503 ADDRESS_SERVICE_UNAVAILABLE`: "We can't verify the address right now.
Nothing was saved. Try again in a minute." The cause is logged at `warn` for the operator; the
response does not include it.

The timeout is a constant, not a setting (Constitution VIII).

**Rationale**: Decided by the user, 2026-10-11: refuse, keep the values. `503` says "this server
cannot do it right now, retry later", which is the advice we give. `502 Bad Gateway` would describe
a proxy relaying a bad answer, and is the wrong signal for "unreachable" or "timed out". 5 seconds
keeps the admin's wait under SC-003's 6 seconds. One code for every failure, because the admin's
next step is the same.

**Alternatives considered**: Saving the venue unverified when the service is down (the user chose
refusal). Retrying once (doubles the wait for little gain on a service that is down).
`504 Gateway Timeout` for timeouts only (two codes, one meaning to the admin).

## R7. The check runs last before the write, and only when the address changes

**Decision**:

- **Create**: DTO validation (FR-001) → `lookup` → one `location.create` with the standard parts
  and `address`.
- **Update**: DTO validation → venue exists → all four address fields or none (FR-009, `400`) →
  the existing capacity rules (`007` FR-017, `CAPACITY_EXCEEDED`) → if the address is sent and
  differs from the stored parts, `lookup` → one `location.update`.
- "Differs" compares trimmed, space-collapsed, upper-cased `street`, `city`, and `state`, and the
  first 5 digits of `zip`, against the stored parts. A venue with `NULL` parts always differs.
  When it does not differ, the address fields are left out of the write.
- No transaction or lock is open during `lookup`, and nothing is written before it returns.

**Rationale**: FR-002, FR-007, FR-008. Cheap local refusals come first, so a request refused for
another reason never waits on the network. Holding no lock during a network call keeps a slow
service from blocking other writes. Venue edits are not a concurrency rule today (last write
wins), and this feature does not change that.

**Alternatives considered**: Checking the address first (a capacity refusal would cost a network
call). Re-checking on every edit (fails name-only edits while the service is down; SC-006).

## R8. Request and response shapes

**Decision**:

- On create, the Backend requires `name`, `street`, `city`, `state`, `zip`, and `seatingCapacity`
  (the contract lists only `name` and `seatingCapacity` in `required`, and says the other four are
  required; R11). `address` is no longer accepted; the Backend builds it. Because the global `ValidationPipe` forbids
  unknown properties, a request that still sends `address` is `400`.
- `LocationUpdate` gains optional `street`, `city`, `state`, `zip` (all four or none) and drops
  `address`.
- `state` is one of `US_STATES`: the 50 states and DC, by code. `zip` is `^\d{5}(-\d{4})?$`.
  `street` 1–200 and `city` 1–100 characters after trimming.
- `Location` gains `street`, `city`, `state`, `zip`, each a value or `null`, always sent.
  `address` is unchanged.

`US_STATES` (code and name, for the Admin app's list) lives in `packages/shared/src/location.ts`
and is used by the Backend DTO and the Admin app. A Backend unit test fails if it differs from the
contract's `UsState` enum.

**Rationale**: Separate fields were decided by the user. Accepting the old one-line `address` too
would be a way around the check. Every client of the API is in this repository and changes in the
implementation PR.

**Alternatives considered**: Keeping `address` as an optional input checked with the one-line
endpoint (two input shapes for one thing). Territories (spec Out of Scope).

## R9. Tests never use the network: a fake geocoder in the test app

**Decision**:

- `backend/test/setup/fake-geocoder.ts` exports `FakeGeocoder implements AddressGeocoder`. By
  default it returns `match` with the input upper-cased and the ZIP code cut to 5 digits. A test
  can set the next answer (`none`, `many`, `unavailable`) and read how many times it was called.
- `createTestApp()` overrides `ADDRESS_GEOCODER` with a new `FakeGeocoder`, as it already
  overrides `JWKS`, and returns it as `ctx.geocoder`. Every test app, including the demo-data
  test, uses it.
- `backend/test/setup/fixtures.ts` exports `ADDRESS = { street: '1 Arena Plaza', city:
  'Louisville', state: 'KY', zip: '40202' }`. Each existing test that posts a venue with
  `address: '…'` sends `...ADDRESS` (or its own four fields) instead. Assertions on the returned
  `address` expect the fake's standard form, such as `1 ARENA PLAZA, LOUISVILLE, KY 40202`.
- `CensusGeocoder` is tested on its own against a local HTTP server on `127.0.0.1` started by the
  test (one match, none, several distinct, several identical, non-2xx, not JSON, wrong shape, a
  split that fails, and a server that never answers, with the timeout lowered through the
  constructor). Local only, so no network (Constitution VI).
- The real service is used only in the running-system check (quickstart.md).

**Rationale**: Tests must not depend on an outside service (Constitution VI). A default that
accepts everything keeps every existing venue creation a one-line change. The local
server tests the real client's parsing and timeout end to end.

**Alternatives considered**: An environment flag that skips the check (a bypass of a control,
which Constitution VIII says must be off by default and refuse to start; an override in the test
module is simpler and cannot reach production). Mocking `fetch` globally (tests the mock, not the
HTTP handling).

## R10. One shared address link for both apps

**Decision**: `packages/shared/src/location.ts` gains `mapsUrl(address)`:

```text
https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(address)>
```

and `packages/shared/src/web/address-link.tsx` exports `AddressLink({ address })`:

```tsx
<a href={mapsUrl(address)} target="_blank" rel="noopener noreferrer"
   aria-label={`${address} (opens Google Maps in a new tab)`}>{address}</a>
```

It replaces the address text in the Admin app's `LocationList` and `LocationDetail` and the
Customer app's `VenueList` and `VenueDetail`, which are every place either app shows a venue
address today. It uses the one-line `address`, so venues from before this feature get a link too.

**Rationale**: FR-014 and FR-015. Google's documented Maps URL needs no key. `noopener noreferrer`
keeps the new tab from reaching the QueuePass page. One component means the two apps cannot
differ, as with the shared theme (Constitution VII). The link is plain text styled as the apps'
existing links.

**Alternatives considered**: A separate "Map" link next to the address (two controls for one
thing). An embedded map (spec Out of Scope; needs a key).

## R11. Contract version, and keeping `main` green between the two PRs

**Decision**: The contract change and regenerated `packages/shared/src/api-schema.ts` land in the
spec and plan PR. The version is the next minor at merge time: **1.6.0** here, from `main`'s
1.5.0. `016`'s pending spec PR also claims 1.6.0; whichever merges second rebases, takes **1.7.0**,
reruns `npm run generate:api`, and passes `node scripts/check-contract-drift.mjs`.

Two things would turn `main` red between the PRs, and both are avoided the way `016` research R9
avoids it:

- **Responses**: the Backend's tests validate every response against the contract, and the
  Backend on `main` does not send the four new `Location` fields until the implementation merges.
  They are documented as always sent, but are not in `required`.
- **Requests**: the Admin app sends venues through `openapi-fetch`, typed by `api-schema.ts`, and
  its build runs `tsc --noEmit` (also inside `docker compose up --build`). If `LocationInput` listed
  `street`, `city`, `state`, and `zip` in `required`, the Admin app's current request type (with
  `address`, without the parts) would not compile. Checked on 2026-10-11 with `tsc` against the
  regenerated types: it fails with `required` listing them (TS2739), and compiles without. So
  `LocationInput.required` stays `[name, seatingCapacity]`, and its description says the four
  fields are required by the Backend (`400 VALIDATION_FAILED` when missing). The Backend's DTO is
  the enforcement, as for every other rule.

Request schemas are not validated by the Backend's tests, so dropping `address` from them does not
fail anything on `main`.

Removing `address` from the request is a change old clients would notice. Every client is in
this repository and changes in the implementation PR, so it follows the project's one minor
version per feature.

**Rationale**: Constitution I (contract first) and III (`main` green and demo-ready at every
merge).

**Alternatives considered**: Required response fields (the suite fails on `main` until the
implementation merges). Required request fields (the Admin app's build fails on `main` until the
implementation merges). Listing them in `required` in the implementation PR (changes the contract
outside the spec and plan PR; a later contract PR may tighten it once nothing depends on the old
shape). A 2.0.0 major version (no outside client exists to warn).

## R12. Configuration and Docker

**Decision**: `ADDRESS_GEOCODER_URL=https://geocoding.geo.census.gov` is added to `.env.example`,
and to the `backend` service in `docker-compose.yml` as
`${ADDRESS_GEOCODER_URL:-https://geocoding.geo.census.gov}`. The code uses the same default when
the variable is unset. The Compose default network allows outbound internet, so the Backend
container can reach the service with no other change. On a laptop with no internet, new addresses
are refused with `503` and everything else works (spec Edge Cases). The README says so.

**Rationale**: Constitution Security: configuration through environment variables, with working
defaults in `.env.example`. A default in code means tests and `demo-data` need no extra setup.

**Alternatives considered**: A configurable timeout (no one has asked for it; Constitution VIII).

## R13. Admin form

**Decision**: In `LocationForm.tsx`, the Address field becomes four: **Street address**
(`autoComplete="address-line1"`), **City** (`address-level2`), **State** (a `<select>` of
`US_STATES`, "Kentucky (KY)", with an empty "Choose a state" first option), and **ZIP code**
(`inputMode="numeric"`, `postal-code`). All reuse `.field` markup.

- Before sending, the form refuses a blank field or a ZIP code that is not 5 digits or ZIP+4,
  naming the field, and keeps every value (FR-013).
- Create sends all four. Edit of a verified venue prefills them from the stored parts and always
  sends all four (the Backend skips the check when unchanged, R7). Edit of a venue that is not
  verified shows "Current address (not verified): {address}. Enter it below to verify it." above
  empty fields, and sends the four only when the admin fills any of them (then all four are
  required).
- `ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS` (with its candidates as a list), and
  `ADDRESS_SERVICE_UNAVAILABLE` appear through `ErrorBanner`, which gains the candidates list.
  Every value stays (FR-011).
- After saving, the app goes to the venue list with the existing notice: "Venue saved. Address:
  430 W VINE ST, LEXINGTON, KY 40507." (FR-012).
- `LocationDetail.tsx` shows "Address not verified. Edit the venue to verify it." under the
  address when `street` is `null` (FR-017).
- A seated venue created in one step (`008`) is unchanged: the layout is only saved after the
  venue is, so a refused address saves neither.

**Rationale**: The smallest change to a form that already keeps values on any refusal and shows
the Backend's message.

**Alternatives considered**: Keeping the old address field for unverified venues (two ways to
enter an address).

## R14. Demo data

**Decision**: `backend/src/scripts/demo-data.ts` gives its two venues real, verified addresses
(R1): Demo Riverside Hall at `430 W Vine St, Lexington, KY 40507`, and QueuePass Demo Arena at
`937 Phillips Ln, Louisville, KY 40209`. It still goes through `LocationsService`, so every rule
applies, and so it needs internet. The Hall is created first and the Arena (the "already run"
marker) second, so a run that fails on an address leaves no marker and can be run again.

**Rationale**: `main` must be demo-ready (Constitution III). The demo-data test runs with the fake
(R9).
