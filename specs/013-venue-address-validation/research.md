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
request and the shape of the service's own error body were not observed; the client reads only
the status code of a non-2xx answer (R6), never its body, so it does not depend on them.

An independent review re-ran the live service the same day: Freedom Hall, Rupp Arena, 350 Adams
St, and the White House matched; 1 Arena Plaza had no match again; and
`2301 S 3rd St, Louisville, KY 40292` matched with its ZIP code corrected to `40208` (R3).

**Rationale**: Decided by the user, 2026-10-11: free, no key, no secret to manage (Constitution
Security). One interface keeps tests off the network (R9) and lets a later feature swap the
service by writing one class.

**Known limit**: the Census service matches against street address ranges, and misses some real
addresses, such as the KFC Yum! Center above. Such an address is refused like any other unmatched
address on the first try. Because of this, the user decided (2026-10-11) that the admin may then
confirm "save anyway": the venue is saved as typed and marked not verified (R2, R4, R8).

**Alternatives considered**: Google's Address Validation API (needs a key and billing; the user
chose Census). USPS Web Tools (needs registration). The Census one-line endpoint
(`onelineaddress`) (we already have the parts; the parts endpoint parses less).

## R2. Exactly one match is verified; none and several are refused unless the admin confirms

**Decision**: The client groups `addressMatches` by `matchedAddress`:

- one distinct `matchedAddress` → `match` → saved in standard form, `addressVerified = true`;
- none → `none`;
- two or more distinct → `many` (up to the first 5).

For `none` and `many`:

- **without** `acceptUnverifiedAddress: true` → `400 ADDRESS_NOT_FOUND` or
  `400 ADDRESS_AMBIGUOUS` (with `details.candidates` in the service's order, in our one-line
  form, R3). Both carry
  `details.address`, the one-line address as typed, and a message naming it. Nothing is saved.
- **with** `acceptUnverifiedAddress: true` → saved as typed (trimmed, runs of whitespace collapsed to one space, state as its code, ZIP cut to
  5 digits; the admin's own case is kept), `addressVerified = false`.

`match` ignores the flag: a matched address is always saved in standard form and verified.
`unavailable` ignores it too (R6).

**Rationale**: FR-003 to FR-005 and FR-019. A match the admin cannot see could be the wrong
building; listing the candidates lets them type the right one. The service misses some real venues
(R1), so the user chose an explicit, recorded "save anyway" over a dead end. The lookup always
runs first, so the flag never saves an address the service could have verified, and never hides
an outage. `400` because the request is not acceptable as sent; separate codes let the Admin app
branch on `code` and offer "Save anyway" only for these two (Constitution I).

**Alternatives considered**: Taking the first of several matches (could save the wrong street).
Folding "several" into `ADDRESS_NOT_FOUND` with candidates (one code with two meanings). `422`
(no other operation in the contract uses it). Skipping the lookup when the flag is sent (an
admin who ticks it up front would never get a verified address).

## R3. Save the service's standard form, built from `matchedAddress`

**Decision**: `matchedAddress` is always `STREET, CITY, ST, ZIP` (four comma-separated parts in
the samples above). The client splits it from the right: the last part is the ZIP code, then the
state, then the city, and everything before is the street. A split "works" when it gives a
non-empty street and city, a state in `US_STATES`, and a 5-digit ZIP code. The venue stores these
four parts exactly as returned (upper case), and `address` is built from them as
`STREET, CITY, ST ZIP` (FR-010), for example `430 W VINE ST, LEXINGTON, KY 40507`. After saving,
the Admin app shows the saved address (FR-012).

- **A single match that does not split** (for example, a territory's state code, or a ZIP code
  that is not 5 digits) returns `none`, so the admin gets `ADDRESS_NOT_FOUND` and may save
  anyway. The client logs the raw `matchedAddress` at `warn`. Retrying would give the same
  answer, so it is not "unavailable" (R6).
- **Candidates for `ADDRESS_AMBIGUOUS`** are reformatted to our one-line form, `STREET, CITY, ST
  ZIP` (Census returns `100 N MAIN ST, SPRINGFIELD, IL, 62701`; we show
  `100 N MAIN ST, SPRINGFIELD, IL 62701`), so they read like every other address in the app. A
  candidate that does not split is shown raw, as the service returned it: it is display text
  only, never saved, and dropping it could leave the admin wondering why the address was called
  ambiguous.

**Rationale**: What the service vouched for is what is stored, so a typo the service corrected (a
wrong ZIP code, "Lexinton") is not kept. One standard form also makes FR-008's "same address"
comparison reliable. A match we cannot read is no better than no match, and the admin should get
the same way forward.

**Alternatives considered**: Storing what the admin typed (keeps the typo the check forgave).
Title-casing the service's answer ("Mcdonald St", "Nw" are wrong more often than upper case is
ugly; Constitution VII puts function first).

## R4. Storage: four nullable columns, a verified flag, and `address` stays

**Decision**: `Location` gains `street VARCHAR(200)`, `city VARCHAR(100)`, `state VARCHAR(2)`, and
`zip VARCHAR(5)`, all nullable, and `addressVerified BOOLEAN NOT NULL DEFAULT false`. `address`
stays `NOT NULL`. Four CHECKs (data-model.md): the four parts are all set or all `NULL`; `state`
is two capital letters and `zip` five digits; when the parts are set, `address` equals
`street || ', ' || city || ', ' || state || ' ' || zip`; and a verified venue has its parts
(`NOT "addressVerified" OR "street" IS NOT NULL`). No coordinates are stored.

The three kinds of venue (FR-020):

| Kind | Parts | `addressVerified` |
|---|---|---|
| Verified (service matched) | standard form | `true` |
| Saved anyway (admin confirmed) | as typed | `false` |
| From before `013`, not re-addressed | `NULL` | `false` |

**Rationale**: Keeping `address` means venue search (`004` FR-007), the event responses that embed
the venue, and every display keep working with no change (FR-010, FR-016). With "save anyway",
`NULL` parts can no longer stand for "not verified", because a confirmed venue has parts, so the
state is stored. A boolean is enough: nothing reads when an address was verified (Constitution
VIII). `DEFAULT false` makes every existing row not verified in the same statement, with no
backfill. The CHECKs make it a database fact that the line and the parts agree, and that no venue
is verified without parts. The Google Maps link is built from text (R10), so coordinates would be
unused.

**Alternatives considered**: `addressVerifiedAt TIMESTAMPTZ NULL` (carries a time no requirement
reads). Inferring "not verified" from `NULL` parts (wrong for saved-anyway venues). Dropping
`address` and building it on read (search would need an expression over four columns, and
existing rows would lose their address).

## R5. Existing venues are not converted

**Decision**: The migration adds the columns and CHECKs only. Existing rows keep their `address`
and get `NULL` parts and `addressVerified = false`. They are checked only when an admin next
changes their address (FR-016). The Admin app marks them "Address not verified" on the venue list
and page, and shows the old address above the four empty fields in the edit form (FR-017).

**Rationale**: Existing addresses are free text ("1 Demo Plaza, Louisville, KY", "Y"), most with
no ZIP code, so a parse would guess, and a guessed part is worse than an honest `NULL`. A
migration must not call the network (it runs at every startup, offline included). Nothing about an
existing venue stops working.

**Alternatives considered**: A best-effort parse in SQL (wrong parts for any address that does not
fit the pattern, presented as if verified). A one-off script that geocodes every venue (needs the
network, and refuses real venues the service does not know, R1).

## R6. "Unavailable" covers every failure to get an answer, with a 5-second limit, as `503`

**Decision**: `CensusGeocoder` throws `AddressServiceUnavailableError` when the request fails to
connect, takes longer than 5 seconds (`AbortSignal.timeout(5000)` on Node 22's global `fetch`),
returns a `5xx` status or any `4xx` other than `400`, returns a body that is not JSON, or returns
JSON without `result.addressMatches` as an array. There is no retry. (A match that R3 cannot
split is not a failure to get an answer; it is `none`, R3.) The service turns it into `503 ADDRESS_SERVICE_UNAVAILABLE`: "We can't verify the address
right now. Nothing was saved. Try again in a minute." The cause is logged at `warn` for the
operator; the response does not include it. `acceptUnverifiedAddress` does not change this
(decided by the user, 2026-10-11).

A `400` from the service is the one exception: it returns `none`, so the admin gets
`ADDRESS_NOT_FOUND` and may save anyway. Our own field rules (FR-001) run first, so a `400` from
the service means it read the request and could not work with the address itself (for example,
characters it does not parse). Retrying would give the same answer, so "try again" would be the
wrong advice. Other `4xx` statuses (`404`, `408`, `429`, …) describe the endpoint or the
connection, not the address, so they stay "unavailable".

The timeout is a constant, not a setting (Constitution VIII).

**Rationale**: Decided by the user, 2026-10-11: refuse, keep the values, even with "save anyway".
`503` says "this server cannot do it right now, retry later", which is the advice we give.
`502 Bad Gateway` would describe a proxy relaying a bad answer, and is the wrong signal for
"unreachable" or "timed out". 5 seconds keeps the admin's wait under SC-003's 6 seconds. One code
for every failure, because the admin's next step is the same.

**Alternatives considered**: Saving the venue unverified when the service is down (the user chose
refusal). Treating every non-2xx as unavailable (tells the admin to retry an address that will
never pass). Retrying once (doubles the wait for little gain on a service that is down).
`504 Gateway Timeout` for timeouts only (two codes, one meaning to the admin).

## R7. The lookup runs outside any lock; the write re-checks under the venue lock

**Decision**:

- **Create**: DTO validation (FR-001; `acceptUnverifiedAddress` is a boolean) → `lookup` → R2
  decides → one `location.create` with the parts, `address`, and `addressVerified`. A new row has
  nothing to race with.
- **Update**, in two steps:
  1. **Before the lookup, no lock**: DTO validation → venue exists → all four address fields or
     none, and `acceptUnverifiedAddress` only with the four (FR-009, FR-019, `400`) → the
     existing capacity rules as a fast first check (`007` FR-017 "set by its seating layout",
     `400`; an event above the new `seatingCapacity`, `409 CAPACITY_EXCEEDED`) → if the address
     is sent and differs from the stored parts, `lookup` (up to 5 seconds) → R2 decides, or
     refuses.
  2. **The write, in one short transaction** (`LOCKING_TX`): lock the venue row and its scheduled
     events in the same order `layout.service.ts` does (`SELECT … FROM "Location" … FOR UPDATE`,
     then `SELECT … FROM "Event" WHERE "locationId" = … AND "status" = 'SCHEDULED' ORDER BY "id"
     FOR UPDATE`), **re-run** the two capacity rules against what is now stored, and then
     `location.update`. That lock helper moves from `LayoutService` to
     `backend/src/common/venue-lock.ts` so both use the same code and order, and no deadlock is
     possible between them.
  When the request changes neither `seatingCapacity` nor anything checked in step 2 (for example
  a name-only edit), step 2 still takes the lock, which costs one row lock for a few
  milliseconds.
- "Differs" compares `norm(street)`, `norm(city)`, `state`, and the first 5 digits of `zip`
  against the same of the stored parts, where `norm` trims, collapses spaces, and upper-cases.
  Both sides are normalized, because a saved-anyway venue stores the admin's own case. A venue
  with `NULL` parts always differs.
- When it does not differ, no lookup runs, the address fields and `addressVerified` are left out
  of the write, and the venue keeps its verified or not-verified state, whatever the flag says.
  So a saved-anyway venue whose name is edited is not re-checked; changing its address re-checks
  it, and a match makes it verified.
- No transaction or lock is open during `lookup`, and nothing is written before it returns.
- The "differs" decision is made in step 1. If another admin changes the same venue's address
  during the lookup, the later write wins, as for every other venue field today; only capacity
  is a rule that must hold under concurrency.

**Rationale**: FR-002, FR-007, FR-008, and Constitution IV. Cheap local refusals come first, so a
request refused for another reason never waits on the network. Holding no lock during a network
call keeps a slow service from blocking layout saves, event writes, and orders. But capacity *is*
a concurrency rule: `layout.service.ts` locks the venue row and sets `seatingCapacity` from the
layout (`007` FR-017), and an event's ticket capacity must not exceed its venue's. On `main` a
venue update checks those rules and writes within milliseconds; with a lookup of up to 5 seconds
between the check and the write, a layout saved meanwhile would have its capacity overwritten,
and an event raised meanwhile could end up above the new capacity. Re-running the checks under the
same lock `layout.service.ts` takes closes that gap: a layout save either finishes before the
re-check (and the re-check sees it) or waits for the update.

Event create and event update read the venue without locking it, so a millisecond-wide race
between them and a capacity edit already exists on `main`. This feature does not widen it (the
re-check runs immediately before the write) and does not change event code; closing it is out of
scope.

**Alternatives considered**: Holding the lock across the lookup (a slow service would block layout
saves and seat sales at that venue for up to 5 seconds). Checking only once, after the lookup
(every refusal for another reason would wait on the network). Checking the address first (a
capacity refusal would cost a network call). Re-checking on every edit (fails name-only edits
while the service is down; SC-006).

## R8. Request and response shapes

**Decision**:

- On create, the Backend requires `name`, `street`, `city`, `state`, `zip`, and `seatingCapacity`
  (the contract lists only `name` and `seatingCapacity` in `required`, and says the other four are
  required; R11). `address` is no longer accepted; the Backend builds it. Because the global `ValidationPipe` forbids
  unknown properties, a request that still sends `address` is `400`.
- `LocationUpdate` gains optional `street`, `city`, `state`, `zip` (all four or none) and drops
  `address`.
- `LocationInput` and `LocationUpdate` gain optional `acceptUnverifiedAddress: boolean`
  (default `false`). It only turns `ADDRESS_NOT_FOUND` and `ADDRESS_AMBIGUOUS` into a save with
  `addressVerified: false` (R2). It never skips the lookup and never bypasses
  `ADDRESS_SERVICE_UNAVAILABLE` (R6). On an update without the four address fields it is `400`,
  so it cannot be sent by mistake on a name-only edit.
- `state` is one of `US_STATES`: the 50 states and DC, by code. `zip` is `^\d{5}(-\d{4})?$`.
  `street` 1–200 and `city` 1–100 characters after trimming.
- `Location` gains `street`, `city`, `state`, `zip`, each a value or `null`, and
  `addressVerified: boolean`, all always sent. `address` is unchanged.

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
- `backend/test/setup/fixtures.ts` exports `ADDRESS = { street: '430 W Vine St', city:
  'Lexington', state: 'KY', zip: '40507' }`, an address the real service matches (R1), so the
  fixture does not suggest otherwise. Each existing test that posts a venue with `address: '…'`
  sends `...ADDRESS` (or its own four fields) instead. Assertions on the returned `address`
  expect the fake's standard form, `430 W VINE ST, LEXINGTON, KY 40507`.
- `CensusGeocoder` is tested on its own against a local HTTP server on `127.0.0.1` started by the
  test (one match, none, several distinct, several identical, `400` → none, `404`/`429`/`500` →
  unavailable, not JSON, wrong shape, a split that fails, and a server that never answers, with
  the timeout lowered through the constructor). Local only, so no network (Constitution VI).
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
spec and plan PR. The version is the next minor at merge time. `016`'s spec PR (#29) took
**1.6.0** and merged first, so this branch was rebased onto it and takes **1.7.0**: the error-code
lists of both features are kept, `npm run generate:api` was rerun, and
`node scripts/check-contract-drift.mjs` passes.

Two things would turn `main` red between the PRs, and both are avoided the way `016` research R9
avoids it:

- **Responses**: the Backend's tests validate every response against the contract, and the
  Backend on `main` does not send the five new `Location` fields (the four parts and
  `addressVerified`) until the implementation merges. They are documented as always sent, but
  are not in `required`.
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

**Follow-up**: the loose `required` lists exist only for the gap between the two PRs. Once the
implementation has merged, a small contract PR tightens them: `Location.required` gains `street`,
`city`, `state`, `zip`, and `addressVerified` (the parts stay nullable), and
`LocationInput.required` gains `street`, `city`, `state`, and `zip`, with `api-schema.ts`
regenerated. The implementation session opens a GitHub issue for it as its last task (tasks.md);
it is not opened now, because it cannot be done until the implementation merges.

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
- Create sends all four. Edit of a venue with parts (verified or saved anyway) prefills them from
  the stored parts and always sends all four (the Backend skips the check when unchanged, R7).
  For a venue with a seating layout, the edit sends the name and the four fields (plus the flag
  on Save anyway), never `seatingCapacity`; today `LocationForm.tsx` sends `{ name, address }`
  there, and `address` goes away.
  Edit of a venue from before `013` (`street` is `null`) shows "Current address (not verified):
  {address}. Enter it below to verify it." above empty fields, and sends the four only when the
  admin fills any of them (then all four are required).
- `ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS` (with its candidates as a list), and
  `ADDRESS_SERVICE_UNAVAILABLE` appear through `ErrorBanner`, which gains the candidates list.
  Every value stays (FR-011).
- After `ADDRESS_NOT_FOUND` or `ADDRESS_AMBIGUOUS`, and only then, the form shows a secondary
  button, **Save anyway (address not verified)**, with the line "Use this only if you are sure the
  address is right. The venue will be marked not verified." It resubmits the same values with
  `acceptUnverifiedAddress: true`. Any change to an address field hides it again, so the
  confirmation always applies to the address the admin saw refused. The normal submit never sends
  the flag. `ADDRESS_SERVICE_UNAVAILABLE` never shows it (R6).
- After saving, the app goes to the venue list with a notice: "Venue saved. Address: 430 W VINE
  ST, LEXINGTON, KY 40507." (FR-012), or, for a saved-anyway venue, "Venue saved. Address (not
  verified): 1 Arena Plaza, Louisville, KY 40202." Today the form shows `SuccessState` and then
  calls `navigate('/locations')` with no state. It instead calls
  `navigate('/locations', { state: { notice: { kind: 'success', text } } })`, as
  `admin-app/src/hooks/use-delete.ts` does, and the list's existing `Notice` shows it.
- When `addressVerified` is `false`, `LocationList.tsx` shows "Not verified" after the address
  link, and `LocationDetail.tsx` shows "Address not verified. Edit the venue to verify it." under
  it (FR-017). For a saved-anyway venue the edit form shows "This address is not verified." above
  the prefilled fields. The text is in words, not color alone.
- These marks use existing classes only: `.pill` for "Not verified" in the list, and `.note` for
  the sentences on the venue page and in the form. No new CSS and no inline style, so they pass
  the shared theme's no-drift check from `012` (#30).
- A seated venue created in one step (`008`) is unchanged: the layout is only saved after the
  venue is, so a refused address saves neither, and "Save anyway" continues to the layout.

**Rationale**: The smallest change to a form that already keeps values on any refusal and shows
the Backend's message.

**Alternatives considered**: Keeping the old address field for unverified venues (two ways to
enter an address).

## R14. Demo data

**Decision**: `backend/src/scripts/demo-data.ts` gives its two venues real addresses the service
matches (R1): Demo Riverside Hall at `430 W Vine St, Lexington, KY 40507`, and QueuePass Demo
Arena at `937 Phillips Ln, Louisville, KY 40209`. It goes through `LocationsService.create`, so
every rule applies, and online the venues are verified.

So that a demo still works offline or while the service is down, `LocationsService.create` takes
a second, internal argument, `{ whenServiceUnavailable: 'refuse' | 'saveUnverified' }`, default
`'refuse'`. Only `demo-data.ts` passes `'saveUnverified'`: on `AddressServiceUnavailableError`
the venue is saved as typed with `addressVerified: false`, and the script prints that the demo
venues are not verified. The controller never passes the argument, it is not part of any DTO, and
no request can set it, so the API rule (FR-006: refuse when unavailable, even with "save anyway")
is unchanged. A test proves the controller path still refuses.

The Hall is created first and the Arena (the "already run" marker) second, so a run that fails
for any other reason leaves no marker and can be run again.

**Rationale**: `main` must be demo-ready (Constitution III), and demo day may have no internet.
`demo-data` is a developer tool run by hand inside the container (`005` research R9), not a client
of the API, so a dev-only path through the service is not a bypass of the API's control
(Constitution VIII is about switches that disable a control for the running system). The
demo-data test runs with the fake, once matching and once unavailable (R9).

**Alternatives considered**: Writing the demo venues with `prisma` directly (skips every other
venue rule, which `demo-data` exists to obey). An environment variable that saves unverified when
the service is down (would reach the API in the running system). Leaving demo-data dependent on
the network (fails on demo day offline).
