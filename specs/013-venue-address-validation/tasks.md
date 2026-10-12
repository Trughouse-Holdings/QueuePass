---
description: "Task list for Venue Address Validation and Google Maps Link"
---

# Tasks: Venue Address Validation and Google Maps Link

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.7.0, already applied),
[quickstart.md](./quickstart.md)

**Issue**: [#25](https://github.com/Trughouse-Holdings/QueuePass/issues/25). The implementation PR
says `fixes #25`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `013-venue-address-validation-impl`,
  cut from `main` after the spec and plan PR merges, in a Claude session that starts from these
  files only. A gap in the spec or plan is fixed there, not worked around in code.
- **Do not change the contract** (1.7.0, types regenerated). Raise any gap.
- **Merge order with `016`'s implementation (#32) does not matter**: the contract already lists
  `TICKET_LIMIT_REACHED`. If `packages/shared/src/errors.ts` on `main` does not have it yet when
  you start, T005 adds it, in the contract's position (before the three address codes). If #32
  merges later, its line and yours are the same; resolve the conflict by keeping one.
- **Always send the new response fields**: `street`, `city`, `state`, `zip` (`null` for a venue
  from before `013`) and `addressVerified` on every `Location`. They are optional in the contract
  only so the plan PR could merge with `main` green (research R11). The Backend DTO requires the
  four on create even though the contract's `required` does not list them.
- **Save anyway never skips the lookup** (research R2, R6): `acceptUnverifiedAddress` only turns
  `none` / `many` into a save with `addressVerified: false`. A `match` is always saved verified;
  `unavailable` is always `503`. The flag without the four address fields is `400`.
- **One whitespace rule** for an address saved as sent: trim, collapse runs of whitespace to one
  space, the state code as validated, the first 5 digits of the ZIP; the admin's case is kept
  (data-model.md).
- **No network in tests**: every test app uses `FakeGeocoder` (research R9). `CensusGeocoder` is
  tested only against a local server on `127.0.0.1`. Never call `geocoding.geo.census.gov` from a
  test.
- **Order on update** (research R7): DTO → venue exists → all-four-or-none and flag-only-with-four
  → capacity rules (fast check) → address lookup only if changed, **no lock held** → one short
  transaction: lock the venue then its scheduled events (`common/venue-lock.ts`, the same order as
  `layout.service.ts`) → re-run the capacity rules → write.
- **One format**: when the parts are set, `address` is always `formatAddress(parts)` from
  `packages/shared`. Never build it anywhere else.
- **No new styles**: the "not verified" marks use the existing `.pill` and `.note` classes only;
  no new CSS and no inline style (research R13).
- **Nothing else changes**: every existing test keeps its meaning. Tests that posted
  `address: '…'` now post the four fields (T013); assertions on a returned address expect the
  fake's standard form.

## Phase 1: Setup

- [x] T001 Cut `013-venue-address-validation-impl` from an up-to-date `main`, run `npm install` and
  `npm test` from the repository root, and confirm the suite is green before any change (baseline).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: shared types, storage, the geocoder plumbing, and every existing venue test moved to
the four fields, with the happy path working through the fake.

- [x] T002 [P] **Test first.** Create `packages/shared/test/location.test.ts`: `US_STATES` has 51
  unique codes including `DC` and no territory; `ZIP_PATTERN` accepts `40507` and `40507-1234`,
  refuses `4050`, `405071`, `40507-123`, and `ABCDE`; `formatAddress` gives
  `430 W VINE ST, LEXINGTON, KY 40507`; `mapsUrl` encodes spaces, commas, `#`, and `&` (for
  example `1 A St #2 & B`) with `encodeURIComponent` after
  `https://www.google.com/maps/search/?api=1&query=`.
- [x] T003 [P] In `packages/shared/src/location.ts`, add `US_STATES`, `UsState`, `ZIP_PATTERN`,
  `formatAddress`, `mapsUrl`, `streetMaxLength: 200` and `cityMaxLength: 100` in
  `LOCATION_LIMITS`; add `street`, `city`, `state`, `zip` (`… | null`) and `addressVerified:
  boolean` to `Location`; replace `address` in `LocationInput` with `street`, `city`, `state:
  UsState`, `zip`, and optional `acceptUnverifiedAddress: boolean` (data-model.md). Export the
  new names from `packages/shared/src/index.ts`. Run T002 until it passes.
- [x] T004 [P] **Test first.** Create `backend/test/unit/us-states.spec.ts`: the codes of
  `US_STATES` equal the contract's `components.schemas.UsState.enum` (as sets), and every code in
  the contract's `ErrorEnvelope` enum is in `ERROR_CODES`. Load the contract the way
  `backend/test/contract/expect-to-match-contract.ts` does. Confirm the second test fails.
- [x] T005 [P] In `packages/shared/src/errors.ts`, add `'ADDRESS_NOT_FOUND'`,
  `'ADDRESS_AMBIGUOUS'`, `'ADDRESS_SERVICE_UNAVAILABLE'` to `ERROR_CODES`, last, in the contract's
  order, with a `// Spec 013` comment. If `'TICKET_LIMIT_REACHED'` is missing (`016`'s
  implementation, #32, not yet merged), add it before them with a `// Spec 016` comment (ground
  rules). Without the codes the exception filter rewrites the `503` (data-model.md). Run T004
  until it passes.
- [x] T006 **Test first.** Create `backend/test/integration/locations.legacy-address.e2e-spec.ts`
  with the storage tests (direct writes with `ctx.prisma`), and confirm they fail before T007:
  - a venue with only `address` (parts `NULL`) is accepted and reads back `addressVerified:
    false` (the default);
  - three parts set and one `NULL` is refused (`location_address_parts_all_or_none`);
  - `state` `'ky'` or `zip` `'4050'` is refused (`location_address_parts_format`);
  - parts set with an `address` that is not `formatAddress(parts)` is refused
    (`location_address_matches_parts`); the matching `address` is accepted, with
    `addressVerified` `true` or `false`;
  - `addressVerified: true` with `NULL` parts is refused (`location_verified_has_parts`).
- [x] T007 Add `street String? @db.VarChar(200)`, `city String? @db.VarChar(100)`,
  `state String? @db.VarChar(2)`, `zip String? @db.VarChar(5)`, and `addressVerified Boolean
  @default(false)` to `model Location` in `backend/prisma/schema.prisma`, with a comment citing
  spec 013 FR-001 and FR-020. Create
  `backend/prisma/migrations/20261011120000_venue_address_parts/migration.sql` exactly as in
  data-model.md (no backfill beyond the column default). Apply with `prisma migrate deploy`
  (never `db push`). Run T006 until it passes.
- [x] T008 Create `backend/src/address/address-geocoder.ts`: `export const ADDRESS_GEOCODER =
  Symbol('ADDRESS_GEOCODER')`; `AddressParts { street; city; state; zip }`; `GeocodeResult` (`match`
  with parts, `none`, `many` with `candidates`); `interface AddressGeocoder { lookup(parts):
  Promise<GeocodeResult> }`; `class AddressServiceUnavailableError extends Error` with a `cause`
  (research R1).
- [x] T009 **Test first.** Create `backend/test/unit/census-geocoder.spec.ts`, which starts a
  `node:http` server on `127.0.0.1:0` per test and builds `new CensusGeocoder({ baseUrl, timeoutMs
  })` against it:
  - the request path is `/geocoder/locations/address` with `street`, `city`, `state`, `zip` (first
    5 digits of a ZIP+4), `benchmark=Public_AR_Current`, `format=json`;
  - one match `"430 W VINE ST, LEXINGTON, KY, 40507"` → `match` with those four parts;
  - a street containing a comma in `matchedAddress` keeps it in `street` (split from the right);
  - `addressMatches: []` → `none`;
  - one match that does not split (state `"PR"`, or ZIP `"4050"`, or only three parts) → `none`,
    and a `warn` is logged with the raw `matchedAddress` (research R3);
  - two matches with the same `matchedAddress` → `match`; two distinct → `many` with both, each
    reformatted to `STREET, CITY, ST ZIP` (`"…, IL, 62701"` becomes `"…, IL 62701"`); a distinct
    candidate that does not split is kept raw; seven distinct → `many` with the first 5;
  - status `400` (any body) → `none` (research R6);
  - status `404`, `429`, `500`, `503`, a non-JSON `200` body, and JSON without
    `result.addressMatches` → each throws `AddressServiceUnavailableError`;
  - a server that never answers, with `timeoutMs: 200` → throws within 1 second; one that answers
    at 100 ms with `timeoutMs: 200` → succeeds (both sides);
  - a closed port → throws `AddressServiceUnavailableError`.
- [x] T010 Create `backend/src/address/census-geocoder.ts` implementing T009 with global `fetch`
  and `AbortSignal.timeout(timeoutMs)` (default 5000), no retry (research R1, R3, R6). Create
  `backend/src/address/address.module.ts` providing `ADDRESS_GEOCODER` with a factory: `new
  CensusGeocoder({ baseUrl: process.env.ADDRESS_GEOCODER_URL ??
  'https://geocoding.geo.census.gov' })`, exported. Import it in
  `backend/src/locations/locations.module.ts`. Run T009 until it passes.
- [x] T011 Create `backend/test/setup/fake-geocoder.ts`: `FakeGeocoder implements AddressGeocoder`.
  Default answer: `match` with the input trimmed, upper-cased, and the ZIP cut to 5 digits. A test
  sets `next(answer)` for one call, or `always(answer)` until `reset()` (`none`, `many` with
  candidates, `unavailable` which throws `AddressServiceUnavailableError`, or a specific
  `match`); `pause()` makes the next `lookup` wait on a promise until the returned `release()` is
  called, and resolves `started` once that lookup has begun (for the concurrency tests in T017);
  `calls` records each input. In `backend/test/setup/test-app.ts`, override `ADDRESS_GEOCODER`
  with a new `FakeGeocoder` (next to the `JWKS` override) and add `geocoder: FakeGeocoder` to
  `TestContext`.
- [x] T012 **Test first.** Extend `backend/test/integration/locations.crud.e2e-spec.ts`: create with
  the four fields → `201`, the four parts in the fake's standard form, `address`
  `430 W VINE ST, LEXINGTON, KY 40507`, `addressVerified: true`, matching the contract;
  `GET /locations/{id}` and `GET /events/{id}` (embedded `location`) carry the parts and
  `addressVerified`. Rewrite `backend/test/integration/locations.validation.e2e-spec.ts` for
  FR-001: missing or blank `street`, `city`; `state` `'ZZ'`, `'ky'`, `'PR'`; `zip` `'4050'`,
  `'40507-12'`; `street` of 201 characters and `city` of 101 (and 200 / 100 accepted, both sides);
  `acceptUnverifiedAddress: 'yes'`; a body with `address` → each `400 VALIDATION_FAILED` naming
  the field, and the fake was **not** called.
- [x] T013 In `backend/test/setup/fixtures.ts`, export `ADDRESS = { street: '430 W Vine St', city:
  'Lexington', state: 'KY', zip: '40507' }` (an address the real service matches, research R9)
  and use it in `venue()`. Replace every `address: '…'` in a `POST /locations` body with
  `...ADDRESS` (or four fields of its own where a test needs a distinct address) in:
  `events.buffer-boundary`, `events.capacity`, `events.concurrency`, `events.conflict-contract`,
  `events.conflict-update`, `events.conflict`, `events.crud`, `events.price-precision`,
  `events.search`, `events.validation`, `locations.capacity`, `locations.delete`,
  `locations.search`, `tiers.authz`, `tiers.capacity`, `tiers.crud`, `venues-events.authz` (all
  `backend/test/integration/*.e2e-spec.ts`). In `locations.search.e2e-spec.ts`, give each venue a
  different city so the "matches the address, such as a city" test still means what it says.
- [x] T014 In `backend/src/locations/dto/create-location.dto.ts` and `update-location.dto.ts`,
  replace `address` with `street` (trim, 1–200), `city` (trim, 1–100), `state` (`@IsIn` the
  `US_STATES` codes), `zip` (`@Matches(ZIP_PATTERN)`), and add optional
  `acceptUnverifiedAddress` (`@IsBoolean`), with messages naming the field and the rule
  (address fields optional in the update DTO).
- [x] T015 In `backend/src/locations/locations.service.ts` `create`, call
  `this.geocoder.lookup(parts)` (injected with `@Inject(ADDRESS_GEOCODER)`); on `match`, write the
  matched parts, `address: formatAddress(parts)`, and `addressVerified: true` in one
  `location.create`. Every response includes the five fields. (Refusals and save anyway come in
  US1 and US2.) Run T004, T012, and the whole Backend suite until green.

**Checkpoint**: venues are created with four fields and saved in standard form; every existing
test passes on the fake.

---

## Phase 3: User Story 1 - An Admin Cannot Save an Address That Is Not Real (Priority: P1) 🎯 MVP

**Goal**: FR-002 to FR-005, FR-007 to FR-011, FR-013, FR-018, FR-019, FR-020, and the capacity
guarantee of research R7.

**Independent Test**: a matched address saves in standard form and verified; unmatched and
ambiguous ones are refused with nothing saved, or saved as typed and not verified with "save
anyway"; name-only edits do not call the service; a slow lookup cannot break capacity.

### Tests for User Story 1 (write first, confirm they fail)

- [ ] T016 [P] [US1] Create `backend/test/integration/locations.address.e2e-spec.ts` (create):
  - fake `none` → `400 ADDRESS_NOT_FOUND`, message naming the typed address, `details.address`,
    matching the contract, and no row in `Location`;
  - fake `many` with two candidates → `400 ADDRESS_AMBIGUOUS` with `details.candidates` as the
    fake gave them, no row;
  - fake `none` with `acceptUnverifiedAddress: true` and input `' 1  Arena Plaza '`,
    `'Louisville'`, `'KY'`, `'40202-1234'` → `201`, the fake was called once, parts `1 Arena
    Plaza`, `Louisville`, `KY`, `40202` (the one whitespace rule, case kept, ZIP cut), `address`
    `1 Arena Plaza, Louisville, KY 40202`, `addressVerified: false`;
  - fake `many` with `acceptUnverifiedAddress: true` → `201`, saved as typed, not verified;
  - fake `match` with `acceptUnverifiedAddress: true` → `201`, the matched standard form,
    `addressVerified: true` (the flag changes nothing);
  - `acceptUnverifiedAddress: false` with fake `none` → `400 ADDRESS_NOT_FOUND`, as without it;
  - fake `match` with corrected parts (city and ZIP differ from the input) → the corrected parts
    are saved and returned (spec edge case "The service corrects a field");
  - a ZIP+4 input is sent to the fake as 5 digits and stored as 5;
  - a request with a bad field and a real address → `400 VALIDATION_FAILED`, fake not called
    (FR-007).
- [ ] T017 [P] [US1] Create `backend/test/integration/locations.address-edit.e2e-spec.ts`:
  - name only, capacity only → `200`, fake not called (FR-008);
  - the same four values in different case and spacing, and the same ZIP as ZIP+4 → `200`, fake
    not called, and the stored parts and `addressVerified` are unchanged;
  - a changed street → fake called once; `match` saves the new parts and `address` and sets
    `addressVerified: true`; `none` → `400 ADDRESS_NOT_FOUND` and the stored venue is unchanged;
    `many` → `400 ADDRESS_AMBIGUOUS`, unchanged;
  - a changed street with `acceptUnverifiedAddress: true` and fake `none` → `200`, saved as
    typed, `addressVerified: false`;
  - a saved-anyway venue: a name-only edit → fake not called, still `addressVerified: false`;
    the same address resent (even with the flag, in other case) → fake not called, still not
    verified; a changed address the fake matches → `addressVerified: true`, standard form;
  - one, two, or three of the four fields → `400 VALIDATION_FAILED` naming the rule, fake not
    called (FR-009); `acceptUnverifiedAddress` with no address fields (alone, or with only
    `name`) → `400`, fake not called (FR-019);
  - a changed address together with a capacity below an event's tickets → the existing
    `409 CAPACITY_EXCEEDED`, fake not called (FR-007); with a capacity on a laid-out venue → the
    existing `400`, fake not called;
  - **concurrency (research R7)**, each with `ctx.geocoder.pause()` holding the lookup of a
    `PATCH` that changes the address and sets `seatingCapacity`, and the other request sent after
    `started` resolves and allowed to finish before `release()`:
    - a venue without a layout, `PATCH { seatingCapacity: 500, …new address }`; meanwhile
      `PUT /locations/{id}/layout` with 300 seats → `200`; after release the `PATCH` is
      `400` ("set by this venue's seating layout"), and the venue's `seatingCapacity` is still
      300 and its layout unchanged;
    - a venue of 1000 with an event of 100 tickets, `PATCH { seatingCapacity: 200, … }`;
      meanwhile the event is raised to 400 tickets (`PATCH /events/{id}`) → `200`; after release
      the `PATCH` is `409 CAPACITY_EXCEEDED` naming the event, and the venue is still 1000;
    - the same, but meanwhile a new event of 400 tickets is created at the venue → after release
      `409 CAPACITY_EXCEEDED` naming it;
    - 10 simultaneous requests mixing address-changing venue edits and layout saves on one venue
      → no `5xx` (assert this first, so a deadlock or transaction timeout fails clearly), and the
      venue's `seatingCapacity` equals its layout's total seats at the end.
- [ ] T018 [P] [US1] Create `admin-app/test/venue-address.test.tsx` with `stubApi`:
  - the form has Street address, City, State (a list of 51 options plus "Choose a state"), and
    ZIP code, each with a `<label>`;
  - create sends `street`, `city`, `state`, `zip`, no `address`, and no
    `acceptUnverifiedAddress`;
  - a blank field, no state, or ZIP `4050` is refused before sending, naming the field, values
    kept, and no request made; ZIP `40507-1234` is sent;
  - `400 ADDRESS_NOT_FOUND` shows the Backend's message, keeps every value, and shows "Save
    anyway (address not verified)";
  - `400 ADDRESS_AMBIGUOUS` shows the message, each candidate as a list item, values kept, and
    the Save anyway button;
  - Save anyway resends the same values with `acceptUnverifiedAddress: true`; on `201` with
    `addressVerified: false`, the venue list shows "Venue saved. Address (not verified): …";
  - editing any address field after the refusal hides Save anyway; a `400 VALIDATION_FAILED`
    does not show it;
  - after a verified save, the app navigates to the venue list with the notice in router state,
    and the list shows "Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507." from the
    response;
  - edit of a venue with parts prefills the four fields from `street`, `city`, `state`, `zip`
    and sends all four; edit of a laid-out venue sends `name` and the four fields, never
    `seatingCapacity` or `address`;
  - a seated create whose address is refused sends no layout request; after Save anyway, the
    layout request follows.
  Update the existing tests that use the old single Address field or `Location` fixtures:
  `admin-app/test/venue-create.test.tsx`, `admin-app/test/pages.live-fixtures.test.tsx` (it types
  into the `Address` label), `admin-app/test/fixtures/locations.json`, and other `Location`
  fixtures in `admin-app/test/`, with the four fields and `addressVerified`.

### Implementation for User Story 1

- [ ] T019 [US1] Move `lockVenueAndEvents` from `backend/src/seating/layout.service.ts` to
  `backend/src/common/venue-lock.ts` (exported, same SQL and order: the venue row, then its
  scheduled events ordered by `id`, both `FOR UPDATE`), and use it from `LayoutService`. Run
  `layout.e2e-spec.ts` and `seating*.e2e-spec.ts`: unchanged behavior.
- [ ] T020 [US1] In `backend/src/locations/locations.service.ts`, apply research R2 and R7: map
  `none` to `400 ADDRESS_NOT_FOUND` and `many` to `400 ADDRESS_AMBIGUOUS` (messages and `details`
  exactly as in contracts/README.md), thrown as envelopes, unless `acceptUnverifiedAddress` is
  `true`, in which case save the parts as sent (the one whitespace rule) with `addressVerified:
  false`. In `update`: all-four-or-none and flag-only-with-four checks after `findOne`, then the
  existing capacity rules as a fast check, then the "changed" comparison (data-model.md, both
  sides normalized), then `lookup` only if changed, with no lock; then one
  `prisma.$transaction(…, LOCKING_TX)` that calls `lockVenueAndEvents`, re-runs the two capacity
  rules against the locked data, and calls `location.update` (address fields and
  `addressVerified` left out when unchanged). Run T016 and T017 until they pass.
- [ ] T021 [US1] In `admin-app/src/pages/LocationForm.tsx`, replace the Address field with the four
  fields (research R13), reusing `.field` markup, `autoComplete` values, and the `US_STATES` list
  ("Kentucky (KY)"); add the preview check; send per R13 (a laid-out venue: `name` and the four
  fields, plus the flag on Save anyway); add the Save anyway button shown only after
  `ADDRESS_NOT_FOUND` / `ADDRESS_AMBIGUOUS` and hidden on any address-field change; after saving,
  `navigate('/locations', { state: { notice: { kind: 'success', text } } })` as
  `admin-app/src/hooks/use-delete.ts` does, instead of `SuccessState` and a bare navigate.
- [ ] T022 [US1] In `admin-app/src/components/ErrorBanner.tsx`, list `details.candidates` when
  present, like `details.fields`. Run T018 until it passes, then the Admin app suite.

**Checkpoint**: only matched or explicitly confirmed addresses are saved, through the API and the
Admin app, and capacity holds during a slow lookup.

---

## Phase 4: User Story 2 - The Address Service Is Down (Priority: P1)

**Goal**: FR-006, SC-002, SC-003, SC-006.

**Independent Test**: every failure of the service gives `503 ADDRESS_SERVICE_UNAVAILABLE`, with
or without "save anyway", nothing saved; name-only edits still work.

### Tests for User Story 2 (write first, confirm they fail)

- [ ] T023 [P] [US2] Extend `backend/test/integration/locations.address.e2e-spec.ts`:
  - fake `unavailable` on create → `503 ADDRESS_SERVICE_UNAVAILABLE` with the exact message,
    matching the contract, no row; the response has no `details` revealing the cause; the same
    with `acceptUnverifiedAddress: true` → `503`, no row (the flag is ignored);
  - the internal option (research R14), called in-process with
    `ctx.app.get(LocationsService).create(dto, { whenServiceUnavailable: 'saveUnverified' })`
    while the fake is `unavailable` → the venue is saved as sent with `addressVerified: false`;
    the same call without the option → throws the `503` envelope, no row.
- [ ] T024 [P] [US2] Extend `backend/test/integration/locations.address-edit.e2e-spec.ts`: fake
  `unavailable` on an address change → `503`, venue unchanged, also with
  `acceptUnverifiedAddress: true`; with the fake set to `always('unavailable')`, a name-only edit
  → `200` (SC-006); `GET /locations` and `GET /locations/{id}` → `200`.
- [ ] T025 [P] [US2] Extend `admin-app/test/venue-address.test.tsx`: a `503
  ADDRESS_SERVICE_UNAVAILABLE` shows "We can't verify the address right now. Nothing was saved.
  Try again in a minute.", keeps every value, and shows **no** Save anyway button, on create and
  on edit; a `503` after pressing Save anyway shows the same and hides the button.

### Implementation for User Story 2

- [ ] T026 [US2] In `backend/src/locations/locations.service.ts`, catch
  `AddressServiceUnavailableError` from `lookup`, log its cause at `warn`, and throw `503
  ADDRESS_SERVICE_UNAVAILABLE` (research R6), whatever `acceptUnverifiedAddress` says. Give
  `create` its internal second argument `{ whenServiceUnavailable: 'refuse' | 'saveUnverified' }`
  (default `'refuse'`, research R14); the controller never passes it. Confirm in
  `backend/src/common/filters/prisma-exception.filter.ts` that the envelope passes through with
  status 503 (it should, once T005 is in). Run T023–T025 until they pass.

**Checkpoint**: the P1 rule is complete, and an outage never lets an unchecked address through
the API.

---

## Phase 5: User Story 3 - The Address Opens in Google Maps (Priority: P2)

**Goal**: FR-014, FR-015, SC-004.

**Independent Test**: each address in both apps' venue lists and venue pages is a Google Maps link
that opens in a new tab.

### Tests for User Story 3 (write first, confirm they fail)

- [ ] T027 [P] [US3] Create `packages/shared/test/web/address-link.test.tsx`: `AddressLink` renders
  a link whose text is the address, `href` is `mapsUrl(address)`, `target="_blank"`,
  `rel="noopener noreferrer"`, and accessible name `{address} (opens Google Maps in a new tab)`.
- [ ] T028 [P] [US3] Create `customer-app/test/address-link.test.tsx`: on Venues and on a venue
  page, the address is that link. Add the four fields and `addressVerified` to the venue factory
  in `customer-app/test/helpers.tsx`.
- [ ] T029 [P] [US3] Extend `admin-app/test/venue-address.test.tsx`: on the venue list and the venue
  page, the address is that link.

### Implementation for User Story 3

- [ ] T030 [US3] Create `packages/shared/src/web/address-link.tsx` (research R10) and export it
  from `packages/shared/src/web/index.ts`.
- [ ] T031 [US3] Use `AddressLink` for the address in `admin-app/src/pages/LocationList.tsx`,
  `admin-app/src/pages/LocationDetail.tsx`, `customer-app/src/pages/VenueList.tsx`, and
  `customer-app/src/pages/VenueDetail.tsx`. Run T027–T029 until they pass.

**Checkpoint**: every venue address in both apps opens Google Maps.

---

## Phase 6: User Story 4 - Existing Venues Keep Working (Priority: P2)

**Goal**: FR-016, FR-017, SC-005.

**Independent Test**: a venue with only a one-line address lists, searches, takes an event, edits
its name without a check, and is verified when its address is filled in.

### Tests for User Story 4 (write first, confirm they fail)

- [ ] T032 [P] [US4] Extend `backend/test/integration/locations.legacy-address.e2e-spec.ts`
  (from T006), with a venue inserted by `ctx.prisma` with `address: '1 Demo Plaza, Louisville, KY'`
  and no parts:
  - `GET /locations` and `GET /locations/{id}` return it with `address` unchanged, the four
    parts `null`, and `addressVerified: false`, matching the contract;
  - `GET /locations?q=demo plaza` finds it;
  - an event can be created there, and `GET /events/{id}` embeds it;
  - a name-only edit → `200`, fake not called, parts still `null`;
  - an edit with the four fields → fake called; `match` replaces `address`, sets the parts, and
    `addressVerified: true`; `none` → `400`, row unchanged; `none` with
    `acceptUnverifiedAddress: true` → saved as typed, `addressVerified: false`.
- [ ] T033 [P] [US4] Extend `admin-app/test/venue-address.test.tsx`:
  - for any venue with `addressVerified: false` (legacy with `street: null`, and saved anyway),
    the venue list shows "Not verified" in a `.pill` after the address, and the venue page shows
    "Address not verified. Edit the venue to verify it." in a `.note`; a verified venue shows
    neither; no element of either mark has a `style` attribute;
  - for a legacy venue, the edit form shows "Current address (not verified): {address}. Enter it
    below to verify it." above empty address fields; saving with them empty sends no address
    fields; filling one requires all four;
  - for a saved-anyway venue, the edit form shows "This address is not verified." above the
    prefilled fields.

### Implementation for User Story 4

- [ ] T034 [US4] In `admin-app/src/pages/LocationList.tsx`, `LocationDetail.tsx`, and
  `LocationForm.tsx`, add the not-verified marks and the edit behavior from research R13, keyed
  on `addressVerified` (and on `street === null` for the legacy edit form), with the existing
  `.pill` and `.note` classes only. The Backend needs no change beyond Phase 3. Run T032 and
  T033 until they pass.

**Checkpoint**: every story works on its own and together.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T035 [P] Add `ADDRESS_GEOCODER_URL=https://geocoding.geo.census.gov` to `.env.example` under a
  `# --- Address service (spec 013) ---` heading, and `ADDRESS_GEOCODER_URL:
  ${ADDRESS_GEOCODER_URL:-https://geocoding.geo.census.gov}` to the `backend` service in
  `docker-compose.yml` (research R12).
- [ ] T036 **Test first.** Extend `backend/test/integration/demo-data.e2e-spec.ts`: with the fake
  matching, both demo venues have the R14 addresses and `addressVerified: true`; on a reset
  database with the fake `always('unavailable')`, the run still completes with the same summary,
  both venues are saved as typed with `addressVerified: false`, and a direct `POST /locations` in
  the same state is still `503`. Confirm it fails before T037.
- [ ] T037 In `backend/src/scripts/demo-data.ts`, give the venues the addresses from research R14,
  creating Demo Riverside Hall before QueuePass Demo Arena, call `locations.create(dto, {
  whenServiceUnavailable: 'saveUnverified' })`, and print a line saying the demo venues are not
  verified when that happened. Run T036 until it passes.
- [ ] T038 [P] Update `README.md`: add the `013` row to the Status table, mention address checks,
  save anyway, and map links in "Today", note that saving a new venue address needs internet
  (the Census Geocoder) and the `ADDRESS_GEOCODER_URL` variable, note that `demo-data` works
  offline with unverified venues, and keep the reserved-features line accurate.
- [ ] T039 Run `npm run lint` and `npm test` from the repository root; everything passes,
  including `check-contract-drift`. Also run `npm run build` in `admin-app` and `customer-app`
  (their `tsc --noEmit`).
- [ ] T040 Report coverage for the files this feature changed (`npx jest --coverage` in `backend`;
  the front ends' and `packages/shared` coverage if a provider is installed) in the PR
  description. The 80% floor is not yet blocking (Constitution VI deferral until `010` and `011`).
- [ ] T041 Running-system gate: `docker compose up --build` online, walk quickstart.md S1–S9
  (including S2b) in the browser, and sign in, use, and sign out of each front end. Record the
  results in this file.
- [ ] T042 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md and plan.md; fix the findings; repeat until only minor findings remain (2–3
  rounds). Record the number of rounds and any open finding in the PR description.
- [ ] T043 Open the implementation PR against `main` with `fixes #25` in its description. It
  touches the shared surface (`packages/shared/`, `backend/prisma/`, `.env.example`,
  `docker-compose.yml`), so every team member approves it.
- [ ] T044 After the implementation PR merges, open a follow-up GitHub issue to tighten the
  contract (research R11 Follow-up): add `street`, `city`, `state`, `zip`, and `addressVerified`
  to `Location.required`, and `street`, `city`, `state`, `zip` to `LocationInput.required`, then
  regenerate `api-schema.ts`. Link it from the PR.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** is the MVP and comes first. **US2** builds on US1's refusal path in the same
  service.
- **US3** depends only on Phase 2 (`mapsUrl`) and can run in parallel with US1 and US2.
- **US4** depends on US1 (edit rules) and on T021's form.
- **Phase 7** after every story; T036–T037 need T026's internal option.

## Parallel Opportunities

- Phase 2: T002, T004 in parallel, then T003, T005; T008 alongside. T006 → T007; T009 → T010;
  T011, T012, T013 → T014 → T015.
- US1: T016, T017, T018 in parallel; T019 before T020; T021/T022 alongside T019–T020.
- US2: T023, T024, T025 in parallel.
- US3: T027, T028, T029 in parallel; all of US3 alongside US1/US2.
- Polish: T035 and T038.

## Implementation Strategy

1. **MVP**: Phases 1–3. Only matched or explicitly confirmed addresses are saved.
2. **Safe outage**: Phase 4 makes a service failure a clear refusal, even with save anyway.
3. **Getting there**: Phase 5 adds the map links in both apps.
4. **No one left behind**: Phase 6 covers venues from before this feature and saved-anyway venues.
5. **Ship**: Phase 7, with the independent review before the PR.
