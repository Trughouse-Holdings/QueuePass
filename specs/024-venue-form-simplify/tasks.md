---
description: "Task list for Venue Form Simplify"
---

# Tasks: Venue Form Simplify

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R15),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (1.15.0, descriptions
only, already on this branch), [quickstart.md](./quickstart.md) (V0–V10)

**Issue**: [#107](https://github.com/Trughouse-Holdings/QueuePass/issues/107). The implementation
PR's **description** says `fixes #107` on its own line. No commit message on either branch may
contain "fixes #107", "closes #107", or "resolves #107".

**Tests**: **REQUIRED and written first** (Constitution VI). Write each phase's tests and see them
fail before the implementation below them. Browser tests are required too (Constitution VI, 3.6.0):
`024`'s implementation PR opens after `022`'s implementation merged (#106).

## Ground rules

- **Fresh session** (Constitution III) on `024-venue-form-simplify-impl`, cut from the spec branch
  while its PR is open (rebased onto `main` once it merges).
- **Commits**: `Impl 024: <what> (T0xx, #107)`; the body names the `FR-…` and `R…` it rests on.
- **Docker**: `npm run e2e` uses the standard ports; stop any other stack first (`docker ps`) and leave
  nothing running when done.
- One independent review (T029), `npm run ci` green (T030), `npm run e2e` green (T028), the walk by
  Nate (T031), CI green on GitHub (T032).

---

## Phase 1: Setup

- [ ] T001 Cut the branch; `npm ci`; `npm run ci` green before any change; record the counts per
  workspace here. Confirm the contract is 1.15.0 and `node scripts/check-contract-drift.mjs` passes
  (both on the spec branch already; nothing to regenerate).

## Phase 2: Foundational

No shared prerequisite beyond the contract: the three stories touch separate code (`LocationForm`'s
zone, `LocationForm`'s save and `LocationsService`, `SectionLines`) and can be built in any order.
US1 and US2 both edit `admin-app/src/pages/LocationForm.tsx`, so they are done one after the other.

---

## Phase 3: User Story 1 - An Admin Picks the Venue's Time Zone (P1) 🎯 MVP

**Goal**: the Time zone select has the eight zones only, is required on create, starts on the stored
zone on edit, and the zone is sent per research R3.

**Independent Test**: spec US1's Independent Test; quickstart V1, V5.

### Tests first

- [ ] T002 [US1] Rewrite the zone tests in `admin-app/test/venue-time-zone.test.tsx` (keep the venue
  list and page tests and the zone-change tests as they are). Must fail on today's form:
  - New venue: the Time zone options are exactly `['Choose a time zone', 'Eastern Time', 'Central
    Time', 'Mountain Time', 'Arizona Time (no daylight saving)', 'Pacific Time', 'Alaska Time',
    'Hawaii-Aleutian Time', 'Hawaii Time']`, the first selected; no option contains "Work it out".
  - Create venue with every field but the zone: the text "Choose the venue's time zone." is shown in
    an element with `role="alert"` that the select's `aria-describedby` names, the select has
    `aria-invalid="true"`, every value is kept, and **no** write is made; choosing a zone removes the
    message; pressing again sends one `POST /locations` with `timeZone: 'America/Chicago'`.
  - New venue hint: "Event times at this venue are shown and entered in this zone."
  - Edit venue (stored `America/New_York`, `ADDRESS`): the options are exactly the eight zones, the
    select's value is `America/New_York`, and "Eastern Time, from the address." is shown under it;
    after changing City, "Changing the address doesn't change the time zone. Choose another zone here
    if the venue is in a different one." is shown, and after changing it back it is not.
  - Edit, name only → the `PATCH` body has no `timeZone`; Edit, street changed and zone untouched →
    the body has `timeZone: 'America/New_York'`; Edit, zone changed to Central → `timeZone:
    'America/Chicago'` and the zone-change note as today.
  - Replace the `a state with more than one zone (FR-003)` describe with: a Kentucky create whose
    response is a `400 ADDRESS_NOT_FOUND` (an API stub; the form no longer causes it) shows no group
    named "more than one time zone" and no "Save anyway" button.
  **Fails because**: today's first option is "Work it out from the address", and a create without a
  zone is sent.

### Implementation

- [ ] T003 [US1] `admin-app/src/pages/LocationForm.tsx` per research R1 and R3: the select (create:
  `<option value="">Choose a time zone</option>` then `US_TIME_ZONES`; edit: the eight only,
  `zoneChoice` initialised from `loaded.timeZone ?? DEFAULT_TIME_ZONE`); the required check in
  `save()` alongside `addressProblems`, with `zoneProblem` "Choose the venue's time zone." in a
  `<span className="field__hint" role="alert" id="timeZone-problem">`, `aria-invalid` and
  `aria-describedby` on the select, cleared on change; the hints (create; edit `${venueZone(loaded)}.`;
  edit while `!sameAsStored(address, loaded)`); `timeZone` sent on create, and on edit only when
  `zoneChoice !== storedZone || !sameAsStored(address, loaded)`. Remove `stateZone`,
  `requiredZones`, `splitZones`, `storedInState`, `chosenStateZone`, `stateName`, the split-state
  fieldset, and the `TIME_ZONE_REQUIRED` handling; drop the imports this leaves unused (`STATE_TIME_ZONES`, `SOURCE_TEXT`;
  `npm run lint` names any other). T002 passes.
- [ ] T004 [US1] Every other Admin test that creates a venue through the form now chooses a zone
  before Create venue, with no other change to what it asserts: `admin-app/test/venue-create.test.tsx`
  (`fillNameAndAddress`), `admin-app/test/venue-address.test.tsx` (its fill helper),
  `admin-app/test/pages.live-fixtures.test.tsx` (`LocationForm against a live validation
  rejection`). `npm run test --workspace @queuepass/admin-app` green except the US2/US3 tests still to
  be written.

**Checkpoint**: US1 works on its own: quickstart V1 passes in the browser.

---

## Phase 4: User Story 2 - The Address Is Always Saved, and Says When It Is Not Verified (P1)

**Goal**: one press saves any well-formed address; the Backend's flag covers the service being down;
an unchanged not-verified address is checked again on edit; the not-verified notice.

**Independent Test**: spec US2's Independent Test; quickstart V3–V6.

### Tests first

- [ ] T005 [P] [US2] `backend/test/integration/locations.address.e2e-spec.ts` (research R5, R15):
  replace "ignores save anyway: still 503, nothing saved" with, for a create with the fake address
  service unavailable:
  - `acceptUnverifiedAddress: true` and `timeZone: 'America/New_York'` → `201`; the address as sent
    (trimmed, runs of spaces collapsed, ZIP cut to 5 digits), `addressVerified: false`, `timeZone`
    `America/New_York`, `timeZoneSource` `ADMIN`; one venue row;
  - the flag, no `timeZone`, an Ohio address → `201`, `America/New_York`, `STATE`;
  - the flag, no `timeZone`, a Kentucky address → `400 TIME_ZONE_REQUIRED`, no row;
  - no flag → `503 ADDRESS_SERVICE_UNAVAILABLE`, the exact message, no row (keep the existing test).
  Every response validated against the contract as the file already does. Must fail (today: `503`).
- [ ] T006 [P] [US2] `backend/test/integration/locations.address-edit.e2e-spec.ts` (research R5, R7,
  R15). Must fail:
  - `when the address service is unavailable (US2)`: an address change **with** the flag → `200`,
    saved as sent, not verified, the zone decided as for a create; **without** the flag → `503`,
    venue unchanged (keep the existing `it.each` for the cases without the flag).
  - New `describe('re-check of the same address on a not-verified venue (024 R7)')`: on a venue saved
    not verified (its four fields set) with `timeZone` `America/New_York` / `ADMIN`, a `PATCH` that
    resends the same four fields (in other case and spacing) and a new name:
    - the fake answers one match keeping ZIP and house number, at a place whose zone is
      `America/Chicago` → `200`, the standard form, `addressVerified: true`, `timeZone` still
      `America/New_York` and `timeZoneSource` still `ADMIN`, the new name saved; the fake asked
      exactly once;
    - the fake answers no match, several, a moved match, or unavailable → `200`, the stored address
      unchanged and `addressVerified: false`, the new name saved; the same without the flag;
    - a verified venue resent with its same address → the fake not asked; a name-only `PATCH` on the
      not-verified venue → the fake not asked.
  - Rewrite "stays not verified when the same address is resent, even with the flag" to the
    no-match case above (it now asks the service once).
- [ ] T007 [P] [US2] `admin-app/test/venue-address.test.tsx` (research R4, R6, R15). Must fail:
  - every create body has `acceptUnverifiedAddress: true`; an edit body with the four fields has it;
    an edit of a venue from before `013` with its fields left empty has neither the fields nor the
    flag;
  - after any response (`201` verified or not, `400 ADDRESS_NOT_FOUND`, `400 ADDRESS_AMBIGUOUS`,
    `400 VALIDATION_FAILED`, `503`), no button named "Save anyway (address not verified)" exists;
    refusals are still shown in the error banner with every value kept;
  - a `201` with `addressVerified: false`, `address: '1 Arena Plaza, Louisville, KY 40202'`,
    `timeZone: 'America/New_York'`, `timeZoneSource: 'ADMIN'` → the venue list shows, in a
    `role="status"` element that is not the success state, exactly: "Venue saved, but its address is
    not verified: 1 Arena Plaza, Louisville, KY 40202. The US address service couldn't confirm it, so
    check that it's right: customers see this address and its map link. To verify it later, edit the
    venue and save it, correcting the address if it's wrong. Time zone: Eastern Time, chosen by an
    admin.";
  - a verified `201` → today's success notice, unchanged;
  - Edit of a not-verified venue shows "This address is not verified. Saving checks it again.";
  - a seated create whose response is not verified still sends the layout `PUT` (`008` FR-017).
  Remove the Save anyway tests (`shows … and offers Save anyway`, `hides Save anyway again when %s
  changes`, `sends no layout when the address is refused, and the layout after Save anyway`, `hides
  Save anyway when pressing it meets a 503`, and the Save anyway parts of the others), replacing each
  with the new behavior above.

### Implementation

- [ ] T008 [US2] `backend/src/locations/locations.service.ts` `checkAddress` (research R5): on
  `AddressServiceUnavailableError`, return `unverified()` when `saveUnverifiedWhenUnavailable ||
  acceptUnverified`; else throw `serviceUnavailable()` as today; the warning log unchanged. Update
  the method's doc comment (feature 024). T005 passes; T006's unavailable cases pass.
- [ ] T009 [US2] `backend/src/locations/locations.service.ts` `update` (research R7): when the four
  fields are sent, `sameAddress(parts, existing)` is true, and `existing.addressVerified` is false,
  look the address up once (a new private method beside `checkAddress`, e.g. `recheckAddress`):
  a match that passes `matchesTyped` returns `checked(match, true)`, written with the update; any
  other result, and `AddressServiceUnavailableError` (logged as in `checkAddress`), returns nothing
  and writes nothing about the address; never throws a refusal. Pass `address: undefined` to
  `decide()` for this case, so the zone is untouched. Update `update`'s doc comment. T006 passes; every
  other test in `backend/test/integration/locations*.e2e-spec.ts`, `venues*.e2e-spec.ts`, and
  `demo-data.e2e-spec.ts` passes unchanged (SC-005).
- [ ] T010 [US2] `admin-app/src/pages/LocationForm.tsx` (research R4, R6): add
  `acceptUnverifiedAddress: true` to the address parts whenever they are sent; remove
  `SAVE_ANYWAY_CODES`, `offerSaveAnyway`, the Save anyway block, and `save()`'s parameter
  (`handleSubmit` calls `save()`); `savedNotice` returns `{ kind: 'info', text }` with R6's exact text
  when `addressVerified` is false, and today's success notice otherwise; the not-verified edit note
  becomes "This address is not verified. Saving checks it again." T007 passes.
- [ ] T011 [US2] Admin tests that assert an exact request body or the old notice now include the flag
  or the new text, nothing else: `admin-app/test/capacity.test.tsx`,
  `admin-app/test/venue-create.test.tsx` (`SENT_ADDRESS` bodies), `admin-app/test/venue-time-zone.test.tsx`
  (bodies), and any other the workspace's run names. `npm run test --workspace @queuepass/admin-app`
  and `npm run test --workspace @queuepass/backend` green.

**Checkpoint**: US1 and US2 work: quickstart V3–V6 pass in the browser.

---

## Phase 5: User Story 3 - Sections Read as Rows × Seats per Row (P2)

**Goal**: labelled section lines with "×", each line's seat count, and one hint, on the New venue form
and the layout editor.

**Independent Test**: spec US3's Independent Test; quickstart V2.

### Tests first

- [ ] T012 [P] [US3] New `admin-app/test/section-lines.test.tsx` (research R8), rendering
  `SectionLines` with a small stateful wrapper. Must fail:
  - the hint "A section is a grid of seats: rows run front to back, and every row has the same number
    of seats across." appears exactly once, with zero, one, and two lines;
  - each line has visible labels "Section name", "Rows", "Seats per row" (`getByText`) and a "×" that
    is `aria-hidden`; the boxes are found as `getByRole('textbox', { name: 'Section 1 Section name' })`,
    `getByRole('spinbutton', { name: 'Section 1 Rows' })`, `getByRole('spinbutton', { name: 'Section
    1 Seats per row' })`; `min`/`max` stay 1–100 and 1–200;
  - counts: 10 × 20 → "= 200 seats"; 1 × 1 → "= 1 seat"; Rows empty → "= 0 seats"; "abc" → "= 0
    seats"; 100 × 200 → "= 20,000 seats";
  - Remove section 1 of two: the remaining line's legend is "Section 1" and its boxes' names follow;
    Add section adds a 1 × 1 line ("= 1 seat").
- [ ] T013 [P] [US3] Update the box names in `admin-app/test/venue-create.test.tsx` (`addSection`),
  `admin-app/test/venue-address.test.tsx`, and `admin-app/test/layout.test.tsx` to "Section N Section
  name", "Section N Rows", "Section N Seats per row", and add to `layout.test.tsx` that the layout
  editor shows the hint and "= 200 seats" for a 10 × 20 section, and to `venue-create.test.tsx` that
  the New venue form's lines show their counts beside "Total: 70 seats". Must fail on the old names.

### Implementation

- [ ] T014 [US3] `admin-app/src/components/SectionLines.tsx` (research R8): the hint once above the
  lines; per line a `<fieldset className="form__row">` with `<legend id>` "Section {i}"; three
  `.field` wrappers with visible `<label id htmlFor>` "Section name", "Rows", "Seats per row";
  inputs named by `aria-labelledby="{legend id} {label id}"` (ids from `useId()` plus the index), no
  `aria-label`; `<span aria-hidden="true">×</span>` between Rows and Seats per row; the count
  `= {n.toLocaleString()} {n === 1 ? 'seat' : 'seats'}` with `n = (Number(rows) || 0) *
  (Number(seatsPerRow) || 0)`; Remove section {i} unchanged. Update the component's doc comment
  (spec `024`). T012 and T013 pass.
- [ ] T015 [US3] `admin-app/src/styles.css` `.form__row` (research R8): columns for name, rows, ×,
  seats per row, count, and Remove; at `max-width: 640px` the name full width, then rows × seats per
  row, then the count and Remove; theme values only (`var(--space-…)`). The shared theme's drift test
  (`npm run test --workspace @queuepass/shared`) and the Admin app's `theme-classes.test.tsx` pass.
  Check at 360 px in a browser that nothing scrolls sideways (record here).

**Checkpoint**: all three stories work: quickstart V1–V7 pass in the browser.

---

## Phase 6: Browser tests (Constitution VI)

- [ ] T016 [P] `e2e/stack/geocoder-stub/server.mjs` (research R10, data-model.md): before matching
  `addresses.json`, a lookup whose `street` equals `0 Outage Way` ignoring case and surrounding spaces
  answers `503` with `{ "errors": ["stand-in outage"] }` and logs `lookup "…": outage`; update the
  file's header comment (spec `024`). `addresses.json` unchanged.
- [ ] T017 [P] `e2e/fixtures/data.ts`: export `UNKNOWN_PLACE` (`1 Nowhere Blvd`, `Louisville`, `KY`,
  `40202`) and `OUTAGE_PLACE` (`0 Outage Way`, `Louisville`, `KY`, `40202`) as `Place`, with a comment
  saying what the stand-in answers for each; `PLACES` unchanged.
- [ ] T018 `e2e/tests/003-venue-event.spec.ts`: in `003 C1`'s first step, choose **Eastern Time** in
  the Time zone select before Create venue; the comment "spec 020: its zone from the address" becomes
  "spec 024: the zone the admin chose"; the assertions stay. Title unchanged.
- [ ] T019 `e2e/tests/024-venue-form.spec.ts`, test `'024 V1/V2/V3: an admin creates a seated venue in
  one press, at an address the service does not know, in the zone they pick'` exactly as research R10
  item 1, signed in as `adminFor(testInfo)`, names from `uniqueName`; record the `POST /locations`
  requests with `page.on('request')` and assert exactly one, after the zone is chosen, whose
  `postDataJSON()` has `acceptUnverifiedAddress: true` and `timeZone: 'America/Chicago'`.
- [ ] T020 Same file, test `'024 V4/V5: with the address service down a venue is saved not verified,
  and a new address keeps its zone'` exactly as research R10 item 2.
- [ ] T021 See each `024` test fail once against a deliberate break, then restore it (as `022`
  T031): T019 with `acceptUnverifiedAddress` removed from `LocationForm`'s create, T020 with T008's
  change reverted. Record both failures (the assertion that failed) here.
- [ ] T022 `specs/024-venue-form-simplify/quickstart.md` Automation table: rows V1–V5 exactly as
  research R11 lists them (V0, V6–V10 unchanged), and the paragraph above the table loses its
  "On the spec branch …" sentences. `node scripts/check-quickstart-marks.mjs` passes.

---

## Phase 7: Polish & cross-cutting

- [ ] T023 [P] `README.md` (research R14): the features table's `024` row (spec link, scope, "Draft",
  "Done (N/32 tasks)", the code status); the `013` row's "with an explicit save anyway" and the `020`
  row's "worked out from its checked address" rewritten as R14 says; the Status paragraph names `024`;
  the **Today** paragraph's Save anyway and "worked out from its verified address" sentences; the
  **Venue address checks** item; the **Venue time zones** section. `npx prettier --check README.md`.
- [ ] T024 [P] Search the repository for the old behavior in user-facing text and comments: `rg -n
  "Save anyway|save anyway|Work it out|work it out|worked out from the new address"` over `admin-app/`,
  `backend/src/`, `e2e/`, `README.md`. Each hit is updated to the new behavior, or is a record (specs
  `013`, `020`, the contract's "feature 013" wording, `demo-data.ts`'s internal option) and is listed
  here with why it stays.
- [ ] T025 [P] Confirm `specs/013-venue-address-validation/{spec,quickstart}.md` and
  `specs/020-venue-time-zones/{spec,quickstart}.md` carry the "Superseded in part by `024`" note (spec
  PR) and that its scenario and requirement numbers match what was built; fix the note only.
- [ ] T026 Coverage: `admin-app` and `backend` stay at or above 80% line coverage, and the removed
  Save anyway and split-state code leaves no untested branch in `LocationForm.tsx`; record each
  workspace's figure here.
- [ ] T027 `npx tsc --noEmit -p e2e` and `npm run lint` clean for the new and changed `e2e/` files.
- [ ] T028 `npm run e2e` locally, green: every test, `024`'s two included; record the count and
  time here; the stack left stopped.
- [ ] T029 Independent review by a separate Claude session (Constitution III) of the branch against
  spec, plan, research, and contract 1.15.0; fix the findings, tests first where a finding is a
  defect; record the round here (counts by severity, each fix, and any finding left open with the
  reason).
- [ ] T030 `npm run ci` locally green after the review's fixes and the latest merge of `origin/main`;
  record the counts per workspace and the coverage figures.
- [ ] T031 Running-system walk, quickstart V0–V10, on a stack built from this branch: Nate walks it
  (V4 needs the Backend pointed at an unreachable address service and back; V9 needs VoiceOver).
  Record each scenario's result as Nate reports it; his "pass" closes the walk.
- [ ] T032 Push; open the implementation PR after the spec PR has merged and the branch is rebased
  onto `main`: its description says `fixes #107` on its own line and carries the review (T029), the
  counts and coverage (T030), the browser tests and their deliberate failures (T021, T028), and the
  walk (T031). CI green on GitHub (the `test` and `e2e` checks); merge when green and approved.

---

## Dependencies & Execution Order

- T001 → US1 (T002 → T003 → T004) → US2 (T005, T006, T007 in parallel → T008 → T009; T010 after T003;
  → T011) → US3 (T012, T013 in parallel → T014 → T015) → browser tests (T016, T017 in parallel →
  T018 → T019, T020 → T021 → T022) → polish (T023–T025 in parallel; T026–T028; T029 → T030 → T031 →
  T032).
- US3 touches only `SectionLines.tsx`, `styles.css`, and its tests, so it may be done before or
  beside US1/US2; T013's edits to `venue-create.test.tsx` and `venue-address.test.tsx` then merge with
  T004's and T011's.
- The Backend tasks (T005, T006, T008, T009) do not depend on the Admin app tasks and may run first.

## Parallel Examples

- US2's three test files: T005 (`locations.address.e2e-spec.ts`), T006
  (`locations.address-edit.e2e-spec.ts`), T007 (`venue-address.test.tsx`).
- US3's tests: T012 (`section-lines.test.tsx`) and T013 (the three existing files).
- Browser-test setup: T016 (`server.mjs`) and T017 (`data.ts`).
- Polish: T023 (README), T024 (search), T025 (the notes).

## Implementation Strategy

- **MVP**: T001–T004: the admin picks every new venue's zone (US1), the first item of #107.
- Then US2 (one-press save, Backend and form), US3 (section lines), the browser tests, and the polish.
- Each story's checkpoint is a quickstart walk of its scenarios; the full walk (T031) is Nate's.
