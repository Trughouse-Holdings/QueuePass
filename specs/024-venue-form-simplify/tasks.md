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

- [x] T001 Cut the branch; `npm ci`; `npm run ci` green before any change; record the counts per
  workspace here. Confirm the contract is 1.15.0 and `node scripts/check-contract-drift.mjs` passes
  (both on the spec branch already; nothing to regenerate).
  **Result**: worktree branch `024-venue-form-simplify-impl` cut from the spec branch at c352b8c (spec PR #108 open); `npm ci` clean; `npm run ci` before any change green: format, lint, build; scripts 75, "23 quickstarts marked; every browser test has its row", shared 681, backend 943, admin 314, customer 308, booth 76, seed 111 (0 skipped: a local Keycloak was up), test:tz quick passed; coverage shared 93.13%, backend 97.03%, admin 97.22%, customer 97.46%, booth 92.28%, seed 100%. Contract `info.version` 1.15.0; `check-contract-drift.mjs`: "api-schema.ts matches contracts/openapi.yaml".

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

- [x] T002 [US1] Rewrite the zone tests in `admin-app/test/venue-time-zone.test.tsx` (keep the venue
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
    if the venue is in a different one." and "Saving records Eastern Time as chosen by an admin." are
    shown, and after changing it back neither is; on a venue whose source is `ADMIN`, only the first.
  - Research R3's sending rule, by `PATCH` body: a verified venue, name only → no `timeZone` and no
    address fields; a verified venue, street changed, zone untouched → the four fields, the flag, and
    `timeZone: 'America/New_York'`; a not-verified venue (fields set, source `STATE`), name only → the
    four fields as loaded, the flag, and `timeZone`, with "Saving records Eastern Time as chosen by an
    admin." shown before saving; any venue, zone changed to Central → `timeZone: 'America/Chicago'`
    and the zone-change note as today.
  - Replace the `a state with more than one zone (FR-003)` describe with: a Kentucky create whose
    response is a `400 ADDRESS_NOT_FOUND` (an API stub; the form no longer causes it) shows no group
    named "more than one time zone" and no "Save anyway" button.
  **Fails because**: today's first option is "Work it out from the address", and a create without a
  zone is sent.
  **Result**: `venue-time-zone.test.tsx`: the old select and split-state describes replaced by three: New venue (options exactly "Choose a time zone" and the eight, value `''`, no "Work it out"; the hint; no zone → `role="alert"` span named by the select's `aria-describedby`, `aria-invalid="true"`, values kept, no write, cleared on choosing, then one `POST` with `America/Chicago`; zone and address problems in one press; the saved notice; Kentucky `400 ADDRESS_NOT_FOUND` → no "more than one time zone" group, no Save anyway), Edit venue (the eight, stored value, "Eastern Time, from the address.", both hints after a City change and neither after changing back, only the first on an `ADMIN` zone), and R3's sending rule by exact `PATCH` body (four cases). The list/page, zone-change note, and refusal tests kept. 11 of 22 failed on the old form.

### Implementation

- [x] T003 [US1] `admin-app/src/pages/LocationForm.tsx` per research R1 and R3: the select (create:
  `<option value="">Choose a time zone</option>` then `US_TIME_ZONES`; edit: the eight only,
  `zoneChoice` initialised from `loaded.timeZone ?? DEFAULT_TIME_ZONE`); the required check in
  `save()` alongside `addressProblems`, with `zoneProblem` "Choose the venue's time zone." in a
  `<span className="field__hint" role="alert" id="timeZone-problem">`, `aria-invalid` and
  `aria-describedby` on the select, cleared on change; the hints (create; edit `${venueZone(loaded)}.`;
  edit while `!sameAsStored(address, loaded)`; edit when the address will be sent with the stored zone
  and `loaded.timeZoneSource !== 'ADMIN'`: "Saving records {zone} as chosen by an admin."); research
  R3's sending rule: on edit, `sendAddress = !sameAsStored(address, loaded) || (loaded.addressVerified
  === false && loaded.street != null)`; the four fields and `timeZone: zoneChoice` together when
  `sendAddress`, else `timeZone` only when `zoneChoice !== storedZone`; on create always `timeZone`.
  Remove `stateZone`,
  `requiredZones`, `splitZones`, `storedInState`, `chosenStateZone`, `stateName`, the split-state
  fieldset, and the `TIME_ZONE_REQUIRED` handling; drop the imports this leaves unused (`STATE_TIME_ZONES`, `SOURCE_TEXT`;
  `npm run lint` names any other). T002 passes.
  **Result**: `LocationForm.tsx` as the task: the select (`Choose a time zone` on create only), `zoneChoice` from the loaded zone, `ZONE_REQUIRED` in `#timeZone-problem` with `aria-invalid`/`aria-describedby`, cleared on change, checked in the same press as the address problems; the four hints (`recordsAdminZone` when the address goes with the stored zone and the source is not `ADMIN`); `sendAddress` per R3 and `timeZone` with it, else only when changed; the split-state code, `TIME_ZONE_REQUIRED` handling, `STATE_TIME_ZONES`, `SOURCE_TEXT`, and `stateName` removed. An edit that sends the address already sends `acceptUnverifiedAddress: true` here, since T002's edit bodies expect it (R3, R4); the create side and the Save anyway removal are T010's. T002: 21 of 22 pass; the Kentucky test's "no Save anyway" assertion passes with T010, which removes the button.
- [x] T004 [US1] Every other Admin test that creates a venue through the form now chooses a zone
  before Create venue: `admin-app/test/venue-create.test.tsx` (`fillNameAndAddress`, and its two
  `expect(writes[0].body).toEqual({ name: 'Seat Hall', ...SENT_ADDRESS, seatingCapacity: … })`
  assertions gain the chosen `timeZone`), `admin-app/test/venue-address.test.tsx` (its fill helper,
  and any exact create body), `admin-app/test/pages.live-fixtures.test.tsx` (`LocationForm against a
  live validation rejection`). Edit bodies that change with R3 (no address fields for a verified
  venue's name or capacity edit, e.g. `admin-app/test/capacity.test.tsx`) are updated here too. `npm run test --workspace @queuepass/admin-app` green except the US2/US3 tests still to
  be written.
  **Result**: `venue-create.test.tsx` (`fillNameAndAddress` chooses Eastern; both exact create bodies gain `timeZone`), `venue-address.test.tsx` (`fill` chooses Eastern; the create body gains `timeZone`; the two edit-body tests now expect a verified venue's name edit to send no address: `{ name, seatingCapacity }` and, laid out, `{ name }`), `pages.live-fixtures.test.tsx` (selects Eastern). `capacity.test.tsx` passed unchanged. Admin suite: 312 passed, 4 failed, all Save anyway tests T007 replaces.

**Checkpoint**: US1 works on its own: quickstart V1 passes in the browser.

---

## Phase 4: User Story 2 - The Address Is Always Saved, and Says When It Is Not Verified (P1)

**Goal**: one press saves any well-formed address; the Backend's flag covers the service being down;
an unchanged not-verified address is checked again on edit; the not-verified notice.

**Independent Test**: spec US2's Independent Test; quickstart V3–V6.

### Tests first

- [x] T005 [P] [US2] `backend/test/integration/locations.address.e2e-spec.ts` (research R5, R15):
  replace "ignores save anyway: still 503, nothing saved" with, for a create with the fake address
  service unavailable:
  - `acceptUnverifiedAddress: true` and `timeZone: 'America/New_York'` → `201`; the address as sent
    (trimmed, runs of spaces collapsed, ZIP cut to 5 digits), `addressVerified: false`, `timeZone`
    `America/New_York`, `timeZoneSource` `ADMIN`; one venue row;
  - the flag, no `timeZone`, an Ohio address → `201`, `America/New_York`, `STATE`;
  - the flag, no `timeZone`, a Kentucky address → `400 TIME_ZONE_REQUIRED`, no row;
  - no flag → `503 ADDRESS_SERVICE_UNAVAILABLE`, the exact message, no row (keep the existing test).
  Every response validated against the contract as the file already does. Must fail (today: `503`).
  **Result**: "ignores save anyway: still 503" replaced by three tests in the unavailable describe: the flag and Eastern → `201`, as sent (`' 1  Arena Plaza '` → `1 Arena Plaza`, ZIP+4 cut), not verified, `ADMIN`, one row; the flag, no zone, Ohio → `201`, `America/New_York`/`STATE`; the flag, no zone, Kentucky → `400 TIME_ZONE_REQUIRED`, no row. The `503` test without the flag kept. All 3 failed (`503`) before T008.
- [x] T006 [P] [US2] `backend/test/integration/locations.address-edit.e2e-spec.ts` (research R5, R7,
  R15). Must fail (all but the cases marked unchanged):
  - `when the address service is unavailable (US2)`: an address change **with** the flag → `200`,
    saved as sent, not verified, the zone decided as for a create; **without** the flag → `503`,
    venue unchanged (keep the existing `it.each` for the cases without the flag).
  - New `describe('re-check of the same address on a not-verified venue (024 R7)')`: on a venue saved
    not verified (its four fields set) with `timeZone` `America/New_York` / `ADMIN`, a `PATCH` that
    resends the same four fields (in other case and spacing), `acceptUnverifiedAddress: true`, and a
    new name:
    - the fake answers one match keeping ZIP and house number, at a place whose zone is
      `America/Chicago` → `200`, the standard form, `addressVerified: true`, `timeZone` still
      `America/New_York` and `timeZoneSource` still `ADMIN`, the new name saved; the fake asked
      exactly once;
    - the fake answers no match, several, a moved match, or unavailable → `200`, the stored address
      unchanged and `addressVerified: false`, the new name saved;
    - the same resend **without** the flag → the fake not asked, the address unchanged (unchanged
      behavior, SC-005); a verified venue resent with its same address and the flag → the fake not
      asked; a name-only `PATCH` on the not-verified venue → the fake not asked;
    - race (as the file's `concurrency during a slow lookup` tests, `ctx.geocoder.pause()`): while the
      re-check's lookup is paused, another `PATCH` changes the venue's address to one the fake then
      answers with no match (saved with the flag, not verified); release the paused lookup with a
      match → the first `PATCH` answers `200` and the venue keeps the second address, not verified
      (the upgrade is dropped).
  - Rewrite "stays not verified when the same address is resent, even with the flag" to the
    no-match case above (it now asks the service once).
  **Result**: Unavailable describe: the flag (whitespace and ZIP+4 tidied) with Central → `200`, as sent, not verified, `ADMIN`; the flag without a zone in Kentucky → `400 TIME_ZONE_REQUIRED`, venue unchanged; the `it.each` without the flag kept (its "with save anyway" row became "without the flag, with a zone"). New `re-check …` describe on a venue saved not verified (`America/New_York`/`ADMIN`), resent as `1 ARENA  PLAZA`/`louisville`: a match at a Chicago place → verified, standard form, zone and source unchanged, name saved, one lookup; `it.each` no match, several, a match at another ZIP, unavailable → `200`, stored address unchanged, not verified, name saved, one lookup; no flag → no lookup; a verified venue with the flag → no lookup; the race (paused re-check, another `PATCH` saves 937 Phillips Ln not verified, release with a match) → `200`, the second address stands, not verified. The old "stays not verified … even with the flag" test removed (now the no-match row). The existing name-only test kept. 8 failed before T008/T009 (the race by timeout: no lookup was made).
- [x] T007 [P] [US2] `admin-app/test/venue-address.test.tsx` (research R3, R4, R6, R15). Must fail:
  - every create body has `acceptUnverifiedAddress: true`; every edit body with the four fields has
    it; an edit body without them (a verified venue's name edit; a venue from before `013` with its
    fields left empty) has neither the fields nor the flag;
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
  **Result**: `venue-address.test.tsx`: the create body has the flag; the Save anyway describes replaced by "One press saves the address" (`400 ADDRESS_NOT_FOUND`/`ADDRESS_AMBIGUOUS`/`VALIDATION_FAILED` and `503` shown with values kept and no Save anyway; candidates still listed; no Save anyway after a verified or not-verified `201`; R6's exact notice in a `role="status"` that is not `banner--success`, one request; the verified notice in the success state) and "What a save sends" (an address change and a not-verified venue's unchanged address carry the flag; a verified name edit has neither fields nor flag; T004's legacy test covers the empty-fields case); the seated test now: a not-verified `201` still sends the layout `PUT`; the edit note test expects "This address is not verified. Saving checks it again."; the edit `503` test kept. 6 failed before T010 (the edit-flag tests already passed after T003).

### Implementation

- [x] T008 [US2] `backend/src/locations/locations.service.ts` `checkAddress` (research R5): on
  `AddressServiceUnavailableError`, return `unverified()` when `saveUnverifiedWhenUnavailable ||
  acceptUnverified`; else throw `serviceUnavailable()` as today; the warning log unchanged. Update
  the method's doc comment (feature 024). T005 passes; T006's unavailable cases pass.
  **Result**: `checkAddress`: `if (saveUnverifiedWhenUnavailable || acceptUnverified) return unverified();` on `AddressServiceUnavailableError`, the log line unchanged; doc comment names feature 024. T005 passes (19/19 in the file).
- [x] T009 [US2] `backend/src/locations/locations.service.ts` `update` (research R7): when the four
  fields are sent with `dto.acceptUnverifiedAddress === true`, `sameAddress(parts, existing)` is true,
  and `existing.addressVerified` is false, look the address up once (a new private method beside
  `checkAddress`, e.g. `recheckAddress`): a match that passes `matchesTyped` returns `checked(match,
  true)`; any other result, and `AddressServiceUnavailableError` (logged as in `checkAddress`),
  returns nothing; never throws a refusal. Inside the transaction, after `lockVenueAndEvents`, read the
  venue row again (`tx.location.findUniqueOrThrow({ where: { id } })`) and write the upgrade only if
  `sameAddress(parts, row)` and `row.addressVerified === false`. Pass `address: undefined` to
  `decide()` for this case, so the check never decides the zone. Update `update`'s doc comment. T006 passes; every
  other test in `backend/test/integration/locations*.e2e-spec.ts`, `venues*.e2e-spec.ts`, and
  `demo-data.e2e-spec.ts` passes unchanged (SC-005).
  **Result**: `update`: `recheckedAddress = await this.recheckAddress(parts)` when the four fields are the same, the flag is `true`, and the venue is not verified; `recheckAddress` (new, beside `checkAddress`) returns `checked(match, true)` for a match passing `matchesTyped`, else `undefined`, logging an unavailable service through a shared `logUnavailable`; in the transaction, after `lockVenueAndEvents`, `tx.location.findUniqueOrThrow` and the upgrade written only if `sameAddress(parts, now) && now.addressVerified === false`; `decide()` still gets `address: undefined` (no `checkedAddress`). Doc comment updated. Address tests 59/59; `locations*`, `venues*`, `demo-data`, and contract suites 242/242 unchanged; the whole backend 954 passed (943 + 11 new).
- [x] T010 [US2] `admin-app/src/pages/LocationForm.tsx` (research R4, R6): add
  `acceptUnverifiedAddress: true` to the address parts whenever they are sent; remove
  `SAVE_ANYWAY_CODES`, `offerSaveAnyway`, the Save anyway block, and `save()`'s parameter
  (`handleSubmit` calls `save()`); `savedNotice` returns `{ kind: 'info', text }` with R6's exact text
  when `addressVerified` is false, and today's success notice otherwise; the not-verified edit note
  becomes "This address is not verified. Saving checks it again." T007 passes.
  **Result**: `acceptUnverifiedAddress: true` in `parts` (sent whenever the address is); `SAVE_ANYWAY_CODES`, `offerSaveAnyway`, the Save anyway block, and `save()`'s parameter removed; `savedNotice` returns `{ kind: 'info', text }` with R6's text when `addressVerified` is false; the edit note "This address is not verified. Saving checks it again." T007 passes, and T002's Kentucky test.
- [x] T011 [US2] Admin tests that assert an exact request body or the old notice now include the flag
  (with the address fields, R3) or the new text, nothing else: `admin-app/test/capacity.test.tsx`,
  `admin-app/test/venue-create.test.tsx` (`SENT_ADDRESS` bodies), `admin-app/test/venue-time-zone.test.tsx`
  (bodies), and any other the workspace's run names. `npm run test --workspace @queuepass/admin-app`
  and `npm run test --workspace @queuepass/backend` green.
  **Result**: Only `venue-create.test.tsx`'s two exact create bodies needed the flag (`SENT_ZONE` now carries it); `capacity.test.tsx` and `venue-time-zone.test.tsx` passed as they were. Admin 316 passed; backend 954 passed.

**Checkpoint**: US1 and US2 work: quickstart V3–V6 pass in the browser.

---

## Phase 5: User Story 3 - Sections Read as Rows × Seats per Row (P2)

**Goal**: labelled section lines with "×", each line's seat count, and one hint, on the New venue form
and the layout editor.

**Independent Test**: spec US3's Independent Test; quickstart V2.

### Tests first

- [x] T012 [P] [US3] New `admin-app/test/section-lines.test.tsx` (research R8), rendering
  `SectionLines` with a small stateful wrapper. Must fail:
  - the hint "A section is a grid of seats: rows run front to back, and every row has the same number
    of seats across." appears exactly once, with zero, one, and two lines;
  - within each line (`within(screen.getByRole('group', { name: 'Section 1' }))`, and Section 2),
    the visible labels "Section name", "Rows", "Seats per row" (`getByText`) and a "×" that is
    `aria-hidden`; each line's fieldset has the classes `form__row form__row--section`; the boxes are found as `getByRole('textbox', { name: 'Section 1 Section name' })`,
    `getByRole('spinbutton', { name: 'Section 1 Rows' })`, `getByRole('spinbutton', { name: 'Section
    1 Seats per row' })`; `min`/`max` stay 1–100 and 1–200;
  - counts: 10 × 20 → "= 200 seats"; 1 × 1 → "= 1 seat"; Rows empty → "= 0 seats"; "abc" → "= 0
    seats"; 100 × 200 → "= 20,000 seats";
  - Remove section 1 of two: the remaining line's legend is "Section 1" and its boxes' names follow;
    Add section adds a 1 × 1 line ("= 1 seat").
  **Result**: `admin-app/test/section-lines.test.tsx`, 11 tests on a stateful wrapper: the hint once with 0, 1, 2 lines; per line (`within` the `Section N` group) the three labels, `×` `aria-hidden`, classes `form__row form__row--section`; names "Section 1 Section name"/"Rows"/"Seats per row", no `aria-label`, `min`/`max` 1–100 and 1–200; counts 10 × 20, 1 × 1, empty, `abc`, 100 × 200; Remove section 1 renumbers (names and count follow) and Add section gives "= 1 seat". All 11 failed before T014.
- [x] T013 [P] [US3] Update the box names in `admin-app/test/venue-create.test.tsx` (`addSection`),
  `admin-app/test/venue-address.test.tsx`, and `admin-app/test/layout.test.tsx` to "Section N Section
  name", "Section N Rows", "Section N Seats per row", and add to `layout.test.tsx` that the layout
  editor shows the hint and "= 200 seats" for a 10 × 20 section, and to `venue-create.test.tsx` that
  the New venue form's lines show their counts beside "Total: 70 seats". In
  `admin-app/test/event-form.tz.test.tsx` (or the Event form test that renders ticket types), assert
  the first ticket-type line's element has `className` exactly `form__row` (spec review round 1, M1:
  the section modifier must not reach it). Must fail on the old names.
  **Result**: New names in `venue-create.test.tsx`, `venue-address.test.tsx`, `layout.test.tsx`; `layout.test.tsx` checks the hint once and "= 40 seats" on a 2 × 20 line in the editor; `venue-create.test.tsx` checks "= 30 seats" and "= 40 seats" beside "Total: 70 seats". The ticket-type check went into `theme-classes.test.tsx` (it renders the New event form; `event-form.tz.test.tsx` is rerun under four zones by `test:tz` and is about times): the first ticket-type line's `className` is exactly `form__row` (passes before and after, as a guard). 5 of these failed on the old names.

### Implementation

- [x] T014 [US3] `admin-app/src/components/SectionLines.tsx` (research R8): the hint once above the
  lines; per line a `<fieldset className="form__row form__row--section">` with `<legend id>` "Section {i}"; three
  `.field` wrappers with visible `<label id htmlFor>` "Section name", "Rows", "Seats per row";
  inputs named by `aria-labelledby="{legend id} {label id}"` (ids from `useId()` plus the index), no
  `aria-label`; `<span aria-hidden="true">×</span>` between Rows and Seats per row; the count
  `= {n.toLocaleString()} {n === 1 ? 'seat' : 'seats'}` with `n = (Number(rows) || 0) *
  (Number(seatsPerRow) || 0)`; Remove section {i} unchanged. Update the component's doc comment
  (spec `024`). T012 and T013 pass.
  **Result**: `SectionLines.tsx` as research R8: the hint once; per line `<fieldset className="form__row form__row--section">`, `<legend id>`, three `.field`s with visible `<label id htmlFor>`, inputs named by `aria-labelledby="{legend} {label}"` (ids from `useId()` and the index), `×` in an `aria-hidden` span, the count as R8; a private `lineSeats` that `totalSeats` now sums (same result). Admin 328 passed (T012, T013 included).
- [x] T015 [US3] `admin-app/src/styles.css` (research R8): a new `.form__row--section` rule after
  `.form__row`'s: columns for name, rows, ×, seats per row, count, and Remove (under them, research R16.1); at `max-width: 640px`
  the name full width, then rows × seats per row, then the count and Remove; theme values only
  (`var(--space-…)`). The `.form__row` rules themselves are not changed (`git diff` shows none): the
  event form's ticket-type lines (`EventForm.tsx`) and the tier mapping (`SeatingCard.tsx`) use them. The shared theme's drift test
  (`npm run test --workspace @queuepass/shared`) and the Admin app's `theme-classes.test.tsx` pass.
  Check at 360 px in a browser that nothing scrolls sideways, and that the Schedule event form's
  ticket-type lines look as before (record here).
  **Result**: `.form__row--section` after `.form__row`'s rules: name, rows, ×, seats per row (rows and seats `minmax(0, 6.5rem)`), the count, with Remove under them; at 640 px and below the name full width, then rows × seats per row, then the count and Remove; `.section-line__times`/`.section-line__seats` for the × and the count; theme values only. `git diff` shows no line of `.form__row` changed. Shared drift test 681 passed; `theme-classes.test.tsx` passed. Checked in Chromium (Playwright) on a page built from `theme.css`, `styles.css`, and the component's markup with two lines (100 × 200 and a long name) and a ticket-type line: at 360 px, light and dark, `scrollWidth` 360 (no sideways scroll), each label above its box; at 1024 px one line per section with Remove under it, and the ticket-type line's columns as before (`2fr 1fr 1fr auto`). A first layout with Remove on the same row truncated "200" at desktop width, so Remove moved under the line. The real app at 360 px is part of Nate's walk (V9).

**Checkpoint**: all three stories work: quickstart V1–V7 pass in the browser.

---

## Phase 6: Browser tests (Constitution VI)

- [x] T016 [P] `e2e/stack/geocoder-stub/server.mjs` (research R10, data-model.md): before matching
  `addresses.json`, a lookup whose `street` equals `0 Outage Way` ignoring case and surrounding spaces
  answers `503` with `{ "errors": ["stand-in outage"] }` and logs `lookup "…": outage`; update the
  file's header comment (spec `024`). `addresses.json` unchanged.
  **Result**: `server.mjs`: `OUTAGE_STREET = '0 Outage Way'`, checked with the file's `same()` (case and surrounding spaces ignored) before matching; answers `503` `{ "errors": ["stand-in outage"] }` and logs `lookup "0 Outage Way, Louisville, KY 40202": outage` (seen in the stack log); header comment names spec 024. `addresses.json` unchanged.
- [x] T017 [P] `e2e/fixtures/data.ts`: export `UNKNOWN_PLACE` (`1 Nowhere Blvd`, `Louisville`, `KY`,
  `40202`) and `OUTAGE_PLACE` (`0 Outage Way`, `Louisville`, `KY`, `40202`) as `Place`, with a comment
  saying what the stand-in answers for each; `PLACES` unchanged.
  **Result**: `UNKNOWN_PLACE` and `OUTAGE_PLACE` exported as `Place`, each with a comment saying what the stand-in answers; `PLACES` unchanged.
- [x] T018 `e2e/tests/003-venue-event.spec.ts`: in `003 C1`'s first step, choose **Eastern Time** in
  the Time zone select before Create venue; the comment "spec 020: its zone from the address" becomes
  "spec 024: the zone the admin chose"; the assertions stay. Title unchanged.
  **Result**: `003 C1` selects Eastern Time before Create venue; the comment says "spec 024: the zone the admin chose"; assertions and title unchanged; passes.
- [x] T019 `e2e/tests/024-venue-form.spec.ts`, test `'024 V1/V2/V3: an admin creates a seated venue in
  one press, at an address the service does not know, in the zone they pick'` exactly as research R10
  item 1, signed in as `adminFor(testInfo)`, names from `uniqueName`; record the `POST /locations`
  requests with `page.on('request')` and assert exactly one, after the zone is chosen, whose
  `postDataJSON()` has `acceptUnverifiedAddress: true` and `timeZone: 'America/Chicago'`.
  **Result**: As research R10 item 1, with `page.on('request')` recording `POST /locations`: none after the first press (1 s wait, as `020 S7`), exactly one after choosing Central, whose `postDataJSON()` has `acceptUnverifiedAddress: true` and `timeZone: 'America/Chicago'`; options, the hint once, labels and `×` per line, "= 200 seats"/"= 50 seats"/"Total: 250 seats", the zone message as an alert, R6's notice in a status (no success state, no Save anyway), the row's "Not verified" and "Central Time, chosen by an admin", the venue page's "Total: 250 seats", and Edit layout's hint, named boxes, and counts.
- [x] T020 Same file, test `'024 V4/V5: with the address service down a venue is saved not verified,
  and a new address keeps its zone'` exactly as research R10 item 2.
  **Result**: As research R10 item 2: `OUTAGE_PLACE`, Pacific, capacity 300 → R6's notice for "0 Outage Way, Louisville, KY 40202" with "Pacific Time, chosen by an admin", the row "Not verified"; the row's **Edit** link (the venue page's link is also named "Edit", and the list has one per row) → Edit venue: the select on `America/Los_Angeles`, "Pacific Time, chosen by an admin.", "This address is not verified. Saving checks it again."; `PLACES.louisville` typed → the "doesn't change the time zone" hint; Save changes → the success notice "Venue saved. Address: 1 ARENA PLZ, LOUISVILLE, KY 40202. Time zone: Pacific Time, chosen by an admin.", the row without "Not verified". The first full run failed here on an ambiguous `Edit` locator (16 rows); fixed by taking the row's link.
- [x] T021 See each `024` test fail once against a deliberate break, then restore it (as `022`
  T031): T019 with `acceptUnverifiedAddress` removed from `LocationForm`'s create, T020 with T008's
  change reverted. Record both failures (the assertion that failed) here.
  **Result**: Break 1, `LocationForm` sending the flag only on edit: `npm run e2e -- -g "024 V1"` → `024 V1/V2/V3` failed at `expect(getByRole('heading', { level: 1, name: 'Venues' })).toBeVisible()` (line 112: the create was refused, the form stayed). Break 2, `checkAddress` back to `if (saveUnverifiedWhenUnavailable) return unverified();`: `npm run e2e -- -g "024 V4"` → `024 V4/V5` failed at the not-verified status notice (line 163); the page showed "We can't verify the address right now. Nothing was saved. Try again in a minute." and the stand-in logged the outage. Both restored with `git checkout` (working tree clean), no `qpe2e` container left.
- [x] T022 `specs/024-venue-form-simplify/quickstart.md` Automation table: rows V1–V5 exactly as
  research R11 lists them (V0, V6–V10 unchanged), and the paragraph above the table loses its
  "On the spec branch …" sentences. `node scripts/check-quickstart-marks.mjs` passes.
  **Result**: Rows V1–V5 exactly as research R11; V0, V6–V10 unchanged; the "On the spec branch …" sentences removed. `node scripts/check-quickstart-marks.mjs`: "23 quickstarts marked; every browser test has its row".

---

## Phase 7: Polish & cross-cutting

- [x] T023 [P] `README.md` (research R14): the features table's `024` row (spec link, scope, "Draft",
  "Done (N/32 tasks)", the code status); the `013` row's "with an explicit save anyway" and the `020`
  row's "worked out from its checked address" rewritten as R14 says; the Status paragraph names `024`;
  the **Today** paragraph's Save anyway and "worked out from its verified address" sentences; the
  **Venue address checks** item; the **Venue time zones** section. `npx prettier --check README.md`.
  **Result**: README: the `024` row ("Draft", "Done (29/32 tasks)", "Built (review pending)"), the `013` and `020` rows as R14, the Status paragraph names `024`, the Today paragraph's address and zone sentences, the Venue address checks item (one press; other callers still refused without the flag), and the Venue time zones section. Prettier realigned the table; `npx prettier --check README.md` passes.
- [x] T024 [P] Search the repository for the old behavior in user-facing text and comments: `rg -n
  "Save anyway|save anyway|Work it out|work it out|worked out from the new address"` over `admin-app/`,
  `backend/src/`, `e2e/`, `README.md`. Each hit is updated to the new behavior, or is a record (specs
  `013`, `020`, the contract's "feature 013" wording, `demo-data.ts`'s internal option) and is listed
  here with why it stays.
  **Result**: Updated: `backend/src/locations/dto/create-location.dto.ts`'s flag comment (now names feature 024 and the unavailable case). Kept, with why: `backend/src/locations/venue-time-zone.ts` lines 33 and 54 ("saved anyway": the Backend's rule for a not-verified address and a caller that sends no zone, unchanged, FR-007); `locations.service.ts` (the "save-anyway flag" in `update`'s doc, the flag's name; `CreateOptions`' "an address saved offline", the demo-data option, R9); the Admin tests and `024-venue-form.spec.ts` that assert no Save anyway button or "work it out" option exists. No hit in `admin-app/src`, `e2e/stack`, or README.
- [x] T025 [P] Confirm `specs/013-venue-address-validation/{spec,quickstart}.md` and
  `specs/020-venue-time-zones/{spec,quickstart}.md` carry the "Superseded in part by `024`" note (spec
  PR) and that its scenario and requirement numbers match what was built; fix the note only.
  **Result**: All four notes present. Checked against what was built: `013` spec (FR-006, FR-008, FR-011, FR-019) and quickstart (S1b, S2, S2b, S4, S5, S7: the refusals, Save anyway, edits, the seated create, the outage); `020` spec (FR-002 and FR-003 for the Admin app, FR-024, SC-006, R4, R14) and quickstart (S3, S4). No fix needed.
- [x] T026 Coverage: `admin-app` and `backend` stay at or above 80% line coverage, and the removed
  Save anyway and split-state code leaves no untested branch in `LocationForm.tsx`; record each
  workspace's figure here.
  **Result**: Line coverage after the change: admin-app 97.22% (3572/3674), backend 97.05% (2075/2138); `LocationForm.tsx` 100% lines, 127/128 branches (the one left is `sameAsStored`'s `s ?? ''`, unchanged since `013`, for a city that is null while the street is not); `SectionLines.tsx` 100% lines and branches once T012 gained an empty Seats per row case (it was 22/23); `locations.service.ts` 100% lines, 62/64 branches (the rethrow of an error that is not "unavailable" and an error with a cause, moved unchanged from `checkAddress` into `logUnavailable`). No Save anyway or split-state branch remains.
- [x] T027 `npx tsc --noEmit -p e2e` and `npm run lint` clean for the new and changed `e2e/` files.
  **Result**: `npx tsc --noEmit -p e2e/tsconfig.json` and `npx eslint e2e` clean; `npm run lint` (which also type-checks `e2e/`) green in T030's run.
- [x] T028 `npm run e2e` locally, green: every test, `024`'s two included; record the count and
  time here; the stack left stopped.
  **Result**: `docker compose -p qp023walk stop` first (a manual-testing stack held the ports; stopped, not removed). `npm run e2e`: **14 passed** (14.0 s of tests, 1.3 min in all, stack healthy after 0.9 min), `024`'s two included; no `qpe2e` container or volume left.
- [ ] T029 Independent review by a separate Claude session (Constitution III) of the branch against
  spec, plan, research, and contract 1.15.0; fix the findings, tests first where a finding is a
  defect; record the round here (counts by severity, each fix, and any finding left open with the
  reason).
- [x] T030 `npm run ci` locally green after the review's fixes and the latest merge of `origin/main`;
  record the counts per workspace and the coverage figures.
  **Result**: Before the review (T029 not yet run; repeat after its fixes): `origin/main` already contained; `npm run ci` green: format, lint (with the `e2e/` type-check), build; scripts 75, "23 quickstarts marked; every browser test has its row", contract drift clean, shared 681, backend 954 (943 + 11), admin 328 (314 before; 329 with T026's extra case, run alone), customer 308, booth 76, seed 91 passed and 20 skipped (Keycloak down), test:tz quick passed. Coverage: shared 93.13%, backend 97.05%, admin 97.22%, customer 97.46%, booth 92.28%, seed 100%.
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

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-10-30, at `5aa5a4b`): 1 must-fix, 4 should-fix, 7
  minor; all fixed in the `Review 024` commit:
  - must M1: `.form__row` also lays out the event form's ticket-type lines and the tier mapping, so
    restyling it would break them. The section lines get a modifier `.form__row--section`;
    `.form__row` is unchanged; T012 checks the section line's classes and T013 that a ticket-type
    line keeps exactly `form__row` (research R8, plan, T014, T015).
  - should S1: SC-005 said "or" and the re-check changed direct API callers. The re-check now runs
    only with `acceptUnverifiedAddress: true` (only the Admin app sends it), so callers without the
    flag are literally unchanged; SC-005 says exactly which two outcomes change for flagged requests
    (FR-016, SC-005, Assumptions, research R7, contract 1.15.0 `updateLocation`, contracts/README.md,
    data-model.md, T006, T009).
  - should S2: after T003 the create body carries `timeZone`, so `venue-create.test.tsx`'s exact
    bodies would fail; T004 adds it (and covers the edit bodies R3 changes).
  - should S3: `020` SC-006 (0 extra steps to set the zone) is superseded; added to the table and to
    `020`'s superseded note.
  - should S4: an address sent with the zone shown records that zone as chosen by an admin; the spec
    says so (Clarifications, US1 scenario 5, Edge Cases, FR-004), and the edit form says it before
    saving: "Saving records {zone} as chosen by an admin." (research R1, R3, T002, T003, quickstart
    V5).
  - minor: R2's claim about `createVenue` corrected (it asserts the address is verified; tests such as
    `020 S6`/`S7` assert the zone). R11's V2 row names the counts and renumbering covered by T012.
    T012 finds labels within each line's group, not with a bare `getByText`. R7's upgrade is written
    only if the row re-read under the venue lock still has the same not-verified address (T006 race
    test, T009). Stale edit form: decided in R3 that the edit sends the address only when it differs
    from the loaded venue or the loaded venue is not verified, and always with the zone shown, so no
    save sends an address without a zone (spec Edge Cases, FR-005, data-model.md). `013`'s quickstart
    note adds S1b. The plan's Constitution Check says the spec PR touches shared surface
    (constitution, contract, `api-schema.ts`) and needs every team member's approval.
- **Open findings**: none.
