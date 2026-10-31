# Research: Venue Form Simplify

**Feature**: `024-venue-form-simplify` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-10-30

Written unattended at Nate's request. R1, R4, R5, and R8 carry the three decisions Nate took in #107;
every other decision takes the recommended option and records the alternatives, for the team to
overturn in review of the spec PR.

## R1. The Time zone select: the eight zones, required on create, the stored zone on edit

**Decision** (decided by Nate, #107 item 1), in `admin-app/src/pages/LocationForm.tsx`:

- **New venue**: `<select id="timeZone">` starts on `<option value="">Choose a time zone</option>`,
  then the eight `US_TIME_ZONES` by `name` (`020` research R2). No "Work it out from the address"
  option. Under it, the hint "Event times at this venue are shown and entered in this zone."
- **Required on create**: `save()` checks the zone with the address fields, before anything is sent.
  With none chosen it shows "Choose the venue's time zone." under the select (a `field__hint` span
  with `role="alert"`, the select `aria-invalid="true"` and `aria-describedby` that span), keeps every
  value, and sends nothing; the address problems banner ("Check the address") still lists any address
  problem in the same press, so one press shows every problem. Choosing a zone clears the message.
- **Edit venue**: the select lists only the eight zones and starts on the stored `timeZone` (every
  venue has one since `020`; `DEFAULT_TIME_ZONE` stands in only if a response lacks it, as today).
  Under it, the hint "{Eastern Time, from the address}." (`venueZone(loaded)`), so a venue still on
  "the default" says so. While any address field differs from the venue as loaded (`sameAsStored`, as
  today), a second hint: "Changing the address doesn't change the time zone. Choose another zone here
  if the venue is in a different one." Whenever the save will send the address (R3) with the zone the
  venue already has and its source is not `ADMIN`, a third: "Saving records {Eastern Time} as chosen
  by an admin." (spec review round 1, S4). The zone-change note (`020` R14) is unchanged.
- **Removed**: the split-state fieldset (`splitZones`, `stateZone`, `requiredZones`, `storedInState`,
  `chosenStateZone`, `stateName`), the `TIME_ZONE_REQUIRED` handling in `save()`, and the
  "Work it out" / "Keep …" first option.

**Rationale**: FR-001 to FR-004, FR-006. A zone that is visible and chosen before saving is the
admin's own. The required check lives in the form because the API keeps the zone optional for other
callers (R2); it is a form rule about what the Admin app sends, not a business rule the Backend must
enforce (Constitution IV applies to rules a direct API call could break; a create without a zone is
still valid through the API and gets a worked-out zone).

**Alternatives considered**: pre-selecting the state's zone in one-zone states (a guess the admin
might not read, which is what #107 removes); keeping the derivation as a labelled default ("Eastern
Time (from the address)") filled in after typing the address (needs an address lookup before saving,
a new API operation); the browser's `required` attribute alone (its message is the browser's, not
announced the same way in every browser, and does not match the form's other messages).

## R2. The API keeps `timeZone` optional and keeps working the zone out

**Decision**: no change to `LocationInput.timeZone` or `LocationUpdate.timeZone` (optional) or to
`decideZone` (`020` research R7). A request that sends a zone gets it with `timeZoneSource: ADMIN`; a
request that sends none gets the zone from the matched place, else the state, else
`400 TIME_ZONE_REQUIRED`. `LocationInput.timeZone`'s description says the Admin app always sends it
on create (feature 024). The demo-data script (`020` R19, `fallbackToDefaultTimeZone`) and the
browser tests' set-up (`e2e/fixtures/api.ts` `createVenue`, which sends no zone and asserts the
address is verified; tests such as `020 S6` and `020 S7` then assert the zone worked out) keep working
unchanged.

**Rationale**: Constitution VIII (the smallest change that meets the issue): #107 is about the form.
Requiring `timeZone` in the API would break the demo-data script, the browser tests' fixtures, and
`020`'s Backend tests, for no gain to an admin, and would be the first required field added to a
venue request since `013`.

**Alternatives considered**: `timeZone` required in `LocationInput` (above); removing the derivation
code (`TimeZoneFinder`, `geo-tz`) once nothing in the Admin app uses it (demo data and the browser
tests still do; a later cleanup can, when no caller relies on it).

## R3. On edit: the address only when it needs checking, and the zone with it

**Decision**: `LocationForm` sends `timeZone` on every create. On an edit it sends:

- the four address fields (with the flag, R4) when they differ from the venue as the form loaded it
  (`!sameAsStored(address, loaded)`), or when the loaded venue's `addressVerified` is false and its
  fields are set (so R7 checks it again); otherwise no address fields (a verified venue's unchanged
  address is not sent, where today's form resends it and the Backend skips it);
- `timeZone`, the zone shown in the select, whenever it sends the address fields, and otherwise only
  when the selected zone differs from the stored one.

A name-only or capacity-only edit of a verified venue sends neither. When the address is sent with
the zone the venue already has, the Backend records it as `ADMIN` (`020` R4); the form says so first
(R1's third hint).

**Rationale**: FR-004, FR-005. On an edit that sends the address, the Backend works the zone out
again unless a zone is sent (`020` FR-005, R7), so sending the zone shown is what keeps it. The zone
shown is the admin's choice in the plain sense: they saved with it on screen and were told (spec
review round 1, S4). On an edit that sends no address, sending the stored zone would relabel a zone
worked out from the address as "chosen by an admin" on every name edit.

**A form opened before someone else changed the address** (spec review round 1): the form compares
with the venue as it loaded it. If the admin left the address alone, a verified venue's address is
not sent, so the other change stands; a not-verified venue's loaded address is resent (last write
wins, as for the name and capacity) and always with the zone, so the Backend never works a zone out
from it or answers `TIME_ZONE_REQUIRED`. This is the simplest rule that never sends an address
without a zone; no refusal handling for `TIME_ZONE_REQUIRED` is needed in the form.

**Alternatives considered**: sending the address on every edit as today, with the zone only when the
address changed (a form opened before another admin's address change sends the old address with no
zone: the zone worked out again, or `TIME_ZONE_REQUIRED` in a two-zone state); always sending the
zone on edit and teaching the Backend to keep the source when the sent zone equals the stored one (a
change to `020` R4 for every caller, for one label); showing `TIME_ZONE_REQUIRED` on the zone field
(handles a case the rule above never produces).

## R4. One press saves the address: the Admin app always sends `acceptUnverifiedAddress: true`

**Decision** (decided by Nate, #107 item 2): `LocationForm.save()` adds `acceptUnverifiedAddress:
true` to every request that carries the four address fields: every create, and every edit that sends
them (R3; never without the fields, which the Backend refuses, `013` FR-019). Removed: `SAVE_ANYWAY_CODES`,
`offerSaveAnyway`, the "Save anyway (address not verified)" button and its note, and the
`save(acceptUnverifiedAddress)` parameter. `ErrorBanner` still shows every refusal that can still
happen (`VALIDATION_FAILED`, `CAPACITY_EXCEEDED`, the zone-change refusals, `NOT_FOUND`, a network
failure), with every value kept (Constitution IV).

**Rationale**: FR-008 to FR-011. The flag already does exactly this for not found, several matches,
and a moved match (`013` FR-019, FR-021); sending it every time removes the second step without a
new Backend path. The address is still looked up first, so a match is still saved verified in the
service's standard form (FR-010).

**Alternatives considered**: send without the flag and resend with it automatically after an
`ADDRESS_NOT_FOUND` or `ADDRESS_AMBIGUOUS` refusal (two requests and two lookups, up to 10 seconds,
for the same result); keep the button but press it for the admin (the same).

## R5. The flag also covers the address service being down; contract 1.15.0

**Decision** (decided by Nate, #107 item 2): in `LocationsService.checkAddress`
(`backend/src/locations/locations.service.ts`), when the lookup throws
`AddressServiceUnavailableError`, the address is saved as sent and not verified when
`acceptUnverified` is true, as it already is for the demo-data option
(`saveUnverifiedWhenUnavailable`, `013` R14); without the flag it is still `503
ADDRESS_SERVICE_UNAVAILABLE`. The warning log line is unchanged. The zone is then decided as for any
unverified address (`020` R7: the sent zone, else the state's one zone, else
`TIME_ZONE_REQUIRED` for a caller that sent none). Create and update share the change through
`checkAddress`.

The contract moves **1.14.0 → 1.15.0**: the repository takes one minor version per feature that
changes the contract (`013` research R11, `020` research R18), and this changes what a documented
request returns (a `503` becomes a `201` or `200`). Only descriptions change: `createLocation`,
`updateLocation`, `Location`, `LocationInput.timeZone`, `AcceptUnverifiedAddress`, and the
`AddressServiceUnavailable` response (contracts/README.md). No schema shape, operation, role, or
error code changes, so the contract tests and the generated types' shapes are unaffected;
`packages/shared/src/api-schema.ts` is regenerated in this PR because it carries the descriptions,
and the drift check (`scripts/check-contract-drift.mjs`) passes.

**Rationale**: FR-012. A real address saved while the service is down is saved and can be verified
later (R7); before, the venue could not be created at all. Callers without the flag see no change
(FR-012, SC-005).

**Alternatives considered**: a second flag for "save when unavailable" (two flags that always travel
together from the one client that sends them); saving unverified on `503` from the Admin app by
resending to a new operation (a new operation for one branch); PATCH 1.14.1 (the repository has not
used patch versions for a change in what a request returns).

## R6. The not-verified notice, and the suggestion that is not shown

**Decision**: after a save whose response has `addressVerified: false`, `LocationForm` navigates to
the venue list with an `info` notice (the existing `Notice` kind: a plain `.banner` with
`role="status"`, no check mark), text exactly:

> Venue saved, but its address is not verified: {address}. The US address service couldn't confirm
> it, so check that it's right: customers see this address and its map link. To verify it later,
> edit the venue and save it, correcting the address if it's wrong. Time zone: {zone, source}.
>
> (A venue from before `013`, with no address fields, gets R16.4's wording instead.)

A verified save keeps today's `success` notice: "Venue saved. Address: {address}. Time zone: {zone,
source}." The edit form of a not-verified venue says "This address is not verified. Saving checks it
again." (was "This address is not verified."); the venue page's "Address not verified. Edit the
venue to verify it." is now accurate as it stands (R7) and is unchanged.

When the service found a different address or several, the venue is saved as typed and the notice is
the same; the candidates are not shown.

**Rationale**: FR-014, FR-015. The admin learns in one place that the save worked, that the address
needs a look, why (customers use it), and what to do. Keeping the candidates would need them in the
`Location` response (a new response field, present only on the save that made it) or a refusal
first (the second step #107 removes).

**Trade-off recorded**: `013` FR-021's "Did you mean 1540 UNIVERSITY CT …" is lost from the Admin app.
An admin who typed a wrong ZIP code gets a not-verified venue and the advice to check it, instead of
the suggestion. Saving and re-checking on edit (R7) means a corrected address becomes verified in one
more save.

**Alternatives considered**: a new optional `addressCheck` object on the create and update responses
(`{ result: 'NOT_FOUND' | 'AMBIGUOUS' | 'UNAVAILABLE', candidates }`) so the notice could say why and
show the suggestion (a contract shape change and a response-only field, more than #107 asks);
a warning-colored banner (`.banner--conflict` is the scheduling-conflict style; a plain banner and
plain words do not rely on color, Constitution VII).

## R7. An unchanged, not-verified address is checked again on an edit

**Decision**: in `LocationsService.update`, when the four address fields are sent with
`acceptUnverifiedAddress: true` and equal the stored ones (`sameAddress`), and the venue's
`addressVerified` is false (its fields are set, since `sameAddress` is false for a venue from before
`013`), the address is looked up again, with no lock, in the place today's lookup runs (after the
cheap checks, before the transaction, `013` R7):

- one match that keeps the ZIP code and house number (`matchesTyped`) → the upgrade is written in
  the service's standard form with `addressVerified: true`, **only if**, inside the transaction after
  `lockVenueAndEvents`, the venue row read again (`tx.location.findUniqueOrThrow`) still has the same
  address (`sameAddress`) and `addressVerified: false`; otherwise the upgrade is dropped and the rest
  of the edit is written (spec review round 1: another admin's address change during the lookup is
  never overwritten by this check);
- anything else (no match, several, a moved match, `AddressServiceUnavailableError`) → nothing about
  the address is written, and the edit goes on; never a refusal. An unavailable service is logged as
  today.

Without the flag, the same address is never looked up, as today (`013` FR-008): only the Admin app
sends the flag, so every other caller's behavior is literally unchanged (spec review round 1, S1;
SC-005).

The re-check never decides the zone: `decide()` gets `address: undefined` for it, so the zone changes
only when sent (R3) or when the address changed (`020` R7, unchanged). A verified venue with the same
address, and an edit without address fields, still never call the service (`013` FR-008).

**Rationale**: FR-016, SC-004. R5 lets a correct address be saved unverified while the service is
down; without a re-check, the only way to verify it would be to change the address and change it
back. Opening Edit venue and pressing Save changes is what the venue page already tells the admin to
do ("Edit the venue to verify it"). Never refusing keeps every edit that works today working; tying
the re-check to the flag keeps every other caller's requests exactly as before (SC-005).

**Alternatives considered**: a "Check the address again" button on the venue page (a new operation
and control); re-checking without the flag too (a direct `PATCH` resending the same address would
start calling the address service, a change for callers that did not ask for it); refusing an
unchanged not-found address (breaks name-only edits of venues saved anyway, `013` SC-006); writing
the upgrade without re-reading under the lock (a race with another admin's address change).

**Cost**: one lookup per save of a not-verified venue, up to 5 seconds while the service is down
(spec Edge Cases). `013` SC-006 (name-only edits succeed while the service is down) still holds.

## R8. Section lines: visible labels, Rows × Seats per row, the line's seats

**Decision** (decided by Nate, #107 item 3), in `admin-app/src/components/SectionLines.tsx`, so the New
venue form and the venue page's layout editor (`LayoutCard.tsx`) both get it:

- Above the lines, once: `<p className="field__hint">A section is a grid of seats: rows run front to
  back, and every row has the same number of seats across.</p>`.
- Each line becomes a `<fieldset className="form__row form__row--section">` with `<legend id="{p}-{i}">Section {i}</legend>`
  (`p` from `useId()`). Its three boxes are each in a `.field` with a visible `<label>`: "Section
  name", "Rows", "Seats per row". Each input's name comes from `aria-labelledby="{legend id} {label
  id}"`: "Section 1 Section name", "Section 1 Rows", "Section 1 Seats per row". Between Rows and Seats
  per row, `<span aria-hidden="true">×</span>`. After them, the line's seat count as text,
  `= {n.toLocaleString()} {n === 1 ? 'seat' : 'seats'}` with `n = (Number(rows) || 0) *
  (Number(seatsPerRow) || 0)`, the same rule as `totalSeats`. Then "Remove section {i}", unchanged.
- `admin-app/src/styles.css`: a new modifier `.form__row--section` (its own rules, after `.form__row`'s)
  sets the columns name, rows, ×, seats per row, count, with Remove under them (R16.1); at 640 px
  and below, the name takes the full width, then rows × seats per row, then the count and Remove. Theme values only (`012`'s
  drift check). `.form__row` itself is **not** changed: the Schedule and Edit event form's ticket-type
  lines (`EventForm.tsx`) and the seated-event tier mapping (`SeatingCard.tsx`) also use it (spec
  review round 1, M1).
- Unchanged: `NEW_LINE` (1 × 1), `toSectionInputs`, `totalSeats`, the input limits (`min`/`max` 1–100,
  1–200), Add section, the New venue form's "Total: N seats", and `LayoutCard`'s table and total.

**Rationale**: FR-018 to FR-023. A visible label per box answers "which number is which" where the
admin is looking; "×" and "= 200 seats" make the grid explicit. Building the name from the legend and
the visible label means the spoken name contains the visible label (WCAG 2.5.3) and stays unique per
line; today's hidden `aria-label`s ("Section 1 rows") do not contain the visible text once there is
one ("Section name" is not in "Section 1 name").

**Alternatives considered**: visible labels with today's `aria-label`s kept (fails 2.5.3 for the name
box); one header row of labels above all lines (labels drift away from boxes when a line wraps at
phone width); labels "Name", "Rows", "Seats" (#107 asks for "Seats per row", and "Name" alone is what
made the line unclear); a live region announcing each line's count (noisy while typing; the count is
read with the line, and the total is announced as today).

**Test names change**: the Admin app's tests that find these boxes by their old names
(`venue-create.test.tsx`, `venue-address.test.tsx`, `layout.test.tsx`) use the new ones. No browser
test uses them today.

## R9. Demo data and other callers: unchanged

**Decision**: `backend/src/scripts/demo-data.ts` and its internal `CreateOptions`
(`whenServiceUnavailable: 'saveUnverified'`, `fallbackToDefaultTimeZone`) are not changed. It does not
send the flag, so an address the service does not find still stops it (the demo addresses are known),
and offline it still saves unverified with the default zone (`020` R19).

**Rationale**: FR-007, SC-005; Constitution VIII.

**Alternatives considered**: replacing the internal option with the flag (demo data would then save
a mistyped demo address silently unverified instead of failing loudly).

## R10. Browser tests: two tests, and an outage address in the stand-in

**Decision**: Constitution VI (3.6.0) requires browser tests for this feature's main journey, since
its implementation PR opens after `022`'s implementation merged (#106). One file,
`e2e/tests/024-venue-form.spec.ts`, two tests (titles exactly):

1. `024 V1/V2/V3: an admin creates a seated venue in one press, at an address the service does not
   know, in the zone they pick` — as `adminFor(testInfo)`: New venue; the Time zone select's options
   are "Choose a time zone" and the eight zones, none "Work it out"; Seated; two sections typed into
   the labelled boxes (`Section 1 Section name` Floor, `Section 1 Rows` 10, `Section 1 Seats per row`
   20; Balcony 5 × 10), each line shows "= 200 seats" / "= 50 seats", "Total: 250 seats", the hint
   shown once; Create venue with no zone → "Choose the venue's time zone." and no `POST /locations`
   (request listener, as `020 S7`); choose Central Time; Create venue at `UNKNOWN_PLACE` (`1 Nowhere
   Blvd`, Louisville, KY 40202, which the stand-in does not know) → one `POST /locations` carrying
   `acceptUnverifiedAddress: true` and `timeZone: America/Chicago`, the info notice text (R6) with
   "Time zone: Central Time, chosen by an admin.", no "Save anyway" button anywhere; the list row says
   "Not verified"; the venue page's layout total is 250; Edit layout shows the same labelled lines and
   counts.
2. `024 V4/V5: with the address service down a venue is saved not verified, and a new address keeps
   its zone` — New venue at `OUTAGE_PLACE` (`0 Outage Way`, Louisville, KY 40202), Pacific Time,
   general admission → saved, the not-verified notice, within the 10-second expect timeout; Edit
   venue: the select shows Pacific Time with "Pacific Time, chosen by an admin."; change the address
   to `PLACES.louisville` → the "doesn't change the time zone" hint; Save changes → the verified
   notice "Venue saved. Address: 1 ARENA PLZ, LOUISVILLE, KY 40202. Time zone: Pacific Time, chosen
   by an admin."; the list row has no "Not verified".

The stand-in (`e2e/stack/geocoder-stub/server.mjs`) gains one fixed rule: a lookup whose street is
`0 Outage Way` (ignoring case) is answered `503` with `{ "errors": ["stand-in outage"] }`, which the
Backend's `CensusGeocoder` reads as unavailable (any non-2xx, `013` R6). It is a constant in the
server, not an entry in `addresses.json`, so `e2e/fixtures/data.ts`'s `place()` and `PLACES` are
unaffected. `UNKNOWN_PLACE` and `OUTAGE_PLACE` are exported from `e2e/fixtures/data.ts`.

`e2e/tests/003-venue-event.spec.ts` (`003 C1`) creates a venue through the New venue form and would
now stop at the required zone: it chooses Eastern Time before Create venue, and its comment changes
from "its zone from the address" to "the zone the admin chose"; its assertions (`Venue saved. Address:
1 ARENA PLZ…`, `Time zone: Eastern Time`) still hold. Its title, and so `003`'s Automation table, are
unchanged.

**Rationale**: the two tests walk US1, US2, and US3's main paths through the real stack. The outage
address is the only way the stack can show "the service is down" per request: the stand-in answers
every other address the same way every time, and the Backend's address service URL is fixed for the
whole run (`e2e/stack/docker-compose.e2e.yml`).

**Not automated, and why** (the quickstart's Automation table): a different or several matches (the
stand-in answers exact addresses only, so it never returns a different one; Backend tests cover it);
the re-check of an unchanged not-verified address (the stand-in never changes its answer for one
address; Backend tests cover R7); format problems (unchanged from `013`; the Admin app's tests);
other callers (an API behavior; Backend tests, and every browser test's set-up creates venues through
the API without a zone); keyboard, screen reader, phone width, and dark mode (by a person).

**Alternatives considered**: restarting the Backend with an unreachable address service URL inside a
test (slow, and it would break the other tests running in parallel); a stand-in switch flipped over
HTTP (shared state across parallel workers).

## R11. The Automation table on the spec branch, and in the implementation

**Decision**: `scripts/check-quickstart-marks.mjs` (run by `npm test`) fails when an `Automated` row
names a test that does not exist in `e2e/tests`. On this spec branch the tests do not exist yet, so
every row of [quickstart.md](./quickstart.md)'s Automation table is `Manual:` with its reason; the
rows V1 to V5 say which planned test will automate them. The implementation PR, with the tests,
changes those rows to exactly:

| Scenario | Browser test |
| --- | --- |
| V1 | Automated: `024 V1/V2/V3: an admin creates a seated venue in one press, at an address the service does not know, in the zone they pick` |
| V2 | Automated: `024 V1/V2/V3: an admin creates a seated venue in one press, at an address the service does not know, in the zone they pick`; rest Manual: phone width and a screen reader, by a person (V9); the "= 0 seats" and "= 20,000 seats" counts and the renumbering after Remove are covered by the Admin app's `section-lines.test.tsx` (T012) |
| V3 | Automated: `024 V1/V2/V3: an admin creates a seated venue in one press, at an address the service does not know, in the zone they pick` |
| V4 | Automated: `024 V4/V5: with the address service down a venue is saved not verified, and a new address keeps its zone`; rest Manual: the 6-second bound against a service that never answers, by hand |
| V5 | Automated: `024 V4/V5: with the address service down a venue is saved not verified, and a new address keeps its zone`; rest Manual: the re-check of an unchanged not-verified address and a name-only edit, covered by Backend tests (the stand-in never changes its answer) |

V0 and V6 to V10 stay Manual as written.

**Rationale**: `npm test` stays green on the spec branch and on `main` after the spec PR merges, and
the final rows are fixed here for the implementer (Constitution VI).

## R12. A note at the top of `013`'s and `020`'s specs and quickstarts

**Decision**: one short paragraph, "**Superseded in part by `024`** …", under the **Issue** line of
`specs/013-venue-address-validation/spec.md` and `specs/020-venue-time-zones/spec.md` (in the spec
commit), and the same one line at the top of their `quickstart.md` files (in the plan commit), naming
the requirements and scenarios that changed and linking to this spec's **Superseded requirements**.
Nothing else in those files changes.

**Rationale**: the repository has no precedent: `020` changed `013`'s rules (the zone of an address
saved anyway) without touching `013`'s files, and `007`'s one "Supersedes" note is inside its own
spec. Without a pointer, a reader of `013` FR-011 or a person walking `013` quickstart S2b or S7
would build or expect the "Save anyway" button. A note at the top keeps those specs as the record of
what was built (they are not rewritten) while saying where the current rule is.

**Alternatives considered**: editing the superseded requirements in place (rewrites history; the
reviews and commits that cite them would point at changed text); no note (above).

## R13. Constitution 3.6.1, a reserved row; the `013` and `020` rows stay

**Decision**: a PATCH amendment in this PR, as `021`–`023`'s reservation (3.4.2): the roadmap gains
`024-venue-form-simplify` (#107, depends on `007`, `013`, `020`), the next free number becomes `025`,
the Sync Impact Report is replaced, and the README's version reference follows. The `013` row
("…unless an admin explicitly confirms an unmatched address…") and the `020` row ("…worked out from
its checked address…") are not reworded.

**Rationale**: the roadmap rows record what each feature built; `024`'s row says what changes, and
this spec lists the superseded requirements. No principle changes: the address is still checked on
every new or changed address, the Backend still decides verification (Constitution IV), and the new
form check is a convenience over an optional field.

**Alternatives considered**: rewording `013`'s row as its own spec PR did (3.0.1) — that was the
feature defining its own row; changing another feature's row would make the roadmap disagree with
that feature's spec.

## R14. README

**Decision** (implementation PR): the features table gains the `024` row (spec link; "The Admin venue
form: the admin picks the time zone; an address is saved in one step, marked not verified when the
address service can't confirm it, even when it's down; section lines read Rows × Seats per row with
their seats"); the `013` row's "with an explicit save anyway" becomes "saved not verified when the
service can't confirm it (`024`)"; the `020` row's "worked out from its checked address" becomes
"chosen by an admin in the Admin app (`024`), worked out from the address for other callers"; the
Status paragraph names `024`; the **Today** paragraph's "unless an admin chooses **Save anyway** … not
verified" and "worked out from its verified address (or from its state, or chosen by an admin)"
sentences, the **Venue address checks** item in "What the system does" ("refused, unless the admin
chooses **Save anyway** … When the service is down, saving a new address is refused"), and the **Venue
time zones** section ("worked out by the Backend from the place …, or chosen by an admin (who must
choose in the 15 states with two zones when saving an address anyway)") are rewritten to the new
behavior.

**Rationale**: Constitution, Development Workflow 6; the issue's process.

## R15. Tests first

**Decision** (Constitution VI): each change is preceded by tests that fail on today's code.

- **Backend** (Jest, Testcontainers PostgreSQL, the fake address service the integration tests
  already use): in `backend/test/integration/locations.address.e2e-spec.ts`, "ignores save anyway:
  still 503, nothing saved" becomes: with `acceptUnverifiedAddress: true` and the service unavailable,
  `201`, the address as sent, `addressVerified: false`, the sent zone as `ADMIN`; without a zone in a
  one-zone state (OH), `STATE`; without a zone in a two-zone state (KY), `400 TIME_ZONE_REQUIRED`, and
  nothing saved; without the flag, `503` and nothing saved (unchanged). In
  `locations.address-edit.e2e-spec.ts`: an address change with the flag while unavailable is saved
  not verified (`200`), without the flag still `503`; R7's re-check, with the flag: a not-verified
  venue resent with the same address and a match → verified, standard form, zone and source unchanged
  even when the matched place is in another zone; with no match, several, a moved match, or
  unavailable → `200`, the stored address unchanged and not verified; the lookup made exactly once;
  the same resend **without** the flag → no lookup (unchanged); a verified venue resent with the same
  address and a name-only edit → no lookup; another admin's address change during a paused re-check
  lookup stands (the upgrade is dropped). The existing "stays not verified when the same address is
  resent, even with the flag" is rewritten to the flagged no-match re-check (it now looks up once). Every other `013` and `020` test passes unchanged (SC-005).
- **Admin app** (Vitest, RTL, the stubbed API): `venue-time-zone.test.tsx` (the select's options on
  create and edit, the required message and no request, the zone sent on create; on edit, R3's
  rule: a verified venue's name-only edit sends neither address nor zone, an address change sends both,
  a not-verified venue's name-only edit sends both; the hints; the split-state tests replaced by "no
  second question in Kentucky"); `venue-address.test.tsx` (the flag on every create and every edit
  that sends address fields, never without them; no "Save anyway"
  button after any response; the not-verified notice's exact text and its `info` look; the verified
  notice unchanged; the not-verified edit note; refusals still shown with values kept);
  `section-lines.test.tsx` (new: labels, names, "×", each line's count, singular, 0 for empty,
  thousands separator, the hint once, renumbering on Remove, the line's classes `form__row
  form__row--section`); `venue-create.test.tsx` and `layout.test.tsx` (the new names, the counts, and
  on New venue a zone chosen); an Event form test asserting a ticket-type line's class is exactly
  `form__row` (M1).
- **Browser** (`npm run e2e`): R10.

## R16. Decisions made while implementing

1. **Remove section goes under the line at desktop width.** With all six on one row (R8 as
   planned), the Admin form's width left the Rows and Seats per row boxes about 60 px wide, and
   "200" did not fit (checked in Chromium, T015). The line is now name, rows, ×, seats per row,
   and the count, with Remove section N under them; phone width is as planned. FR-018 to FR-023 are
   unchanged.
2. **An edit's flag lands with the zone rule (T003), the create's with T010.** T002's edit bodies
   (R3) already carry `acceptUnverifiedAddress: true`, so T003 sends it with every address on an
   edit; T010 sends it on create and removes Save anyway. T002's Kentucky test ("no Save anyway")
   therefore passes at T010, not T003.
3. **The ticket-type class guard (M1) is in `theme-classes.test.tsx`**, which renders the New event
   form, rather than `event-form.tz.test.tsx`, which `test:tz` reruns under four device zones and is
   about times (T013 allowed either).
4. **A venue from before `013` is told how it gets verified** (review round 1, minor 3). Its
   name-only edit is saved not verified, and saving again never checks its one-line address (only
   entering the four fields does, `013` FR-016), so R6's "To verify it later, edit the venue and
   save it" would be wrong for it. For a not-verified response with no `street`, the notice reads:
   "Venue saved, but its address is not verified: {address}. To verify it, edit the venue and
   enter its street, city, state, and ZIP code. Time zone: {zone, source}."
5. **A refused layout says the address is not verified** (review round 1, minor 4). A seated
   create whose layout is refused stays on the form with "Seating layout not saved" (`008` US5), so
   it never reaches R6's notice. When the saved venue is not verified, that banner adds: "Its
   address is saved but not verified: {address}. The US address service couldn't confirm it, so
   check that it's right."
6. **The select is described by what is under it** (review round 1, minor 6): the problem message
   (when shown), the New venue hint, the stored zone line, the address hint, the "Saving records"
   hint, and the zone-change note, each in its own element named by the select's
   `aria-describedby`, in that order.

