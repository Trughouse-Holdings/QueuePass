# Feature Specification: Venue Form Simplify

**Feature Branch**: `024-venue-form-simplify-spec`

**Created**: 2026-10-30

**Status**: Draft

**Issue**: [#107](https://github.com/Trughouse-Holdings/QueuePass/issues/107) (venue form: pick the
time zone, always save the address, clear section sizes)

**Input**: User description: "024" (the roadmap entry reserved for #107 in Constitution 3.6.1). From
Nate's testing of the Admin app's New venue form (2026-10-30): remove "Work it out from the address"
from the Time zone select, so the admin picks the venue's zone (a new venue must pick one; an edit
starts on the stored zone); always save the venue's address, even when it can't be verified, with no
separate "Save anyway" step, still checked, saved verified when the check finds it and otherwise
saved and marked not verified, also when the address service is down; and when defining each section
of a seated venue, make it clear the admin is entering rows by seats per row, with visible labels and
each section's seat count.

## Context

Builds on `007` (a venue's seating layout: sections, each with a number of rows and seats per row,
edited on the venue page), `008` US5 (a seated venue is created in one step on the New venue form,
with the same section lines), `013` (a venue's address is four fields checked by the US address
service; an address the service does not find, or finds more than once, is refused unless the admin
presses **Save anyway (address not verified)**; when the service is down the save is refused even
then), and `020` (every venue has a time zone, worked out from the address's matched place or the
state unless an admin picks one; a state with two zones asks the admin when the address is saved
anyway).

Today the New venue form has three rough edges, found by Nate testing it:

- The **Time zone** select starts on "Work it out from the address". An admin cannot see what will be
  picked until after saving, and in the 15 states with two zones an address saved anyway brings up a
  second question.
- An address the service does not know (the KFC Yum! Center at 1 Arena Plaza is one) is refused
  first, and the admin must press a second button to save it. When the service is down, a new venue
  cannot be saved at all.
- Each section line is three unlabelled boxes (the labels are only read out by a screen reader), so
  it is not clear which number is rows and which is seats across a row, or how many seats the
  section makes.

This feature makes the time zone the admin's own pick, saves a well-formed address in one step
whatever the address service answers (marking it not verified when the service could not confirm it),
and labels the section lines so each reads "Rows × Seats per row = seats".

It changes some of `013`'s and `020`'s requirements for the Admin app and, for one case (the address
service is down), the Backend; it does not rewrite those specs. Requirements this spec supersedes are
listed under **Superseded requirements**; `013`'s and `020`'s spec files get a one-line note at the
top pointing here (research R12). Constitution 3.6.1 reserves the number; no principle changes.

## Clarifications

### Session 2026-10-30

Nate asked for this spec to be written unattended. The three decisions in the issue were taken by
Nate; each other question below took the recommended answer, recorded here so the team can overturn
it in review of the spec PR.

- Q: What does the Time zone select offer, and where does it start? → A: The eight zones only, no
  "work it out" choice (decided by Nate, issue item 1). On **New venue** it starts on an empty
  "Choose a time zone" choice, and a zone is required before saving: pressing **Create venue**
  without one says "Choose the venue's time zone." next to the field, like the form's other field
  problems, and sends nothing. On **Edit venue** it starts on the venue's stored zone; changing the
  address does not change the zone. `020`'s split-state question is no longer needed in the form
  and goes (FR-001 to FR-006).
- Q: Does the API keep `timeZone` optional and keep working the zone out when it is not sent? → A:
  **Yes.** The change is in the Admin app, which always sends the admin's pick on a create; the
  Backend stores it as chosen by an admin, as today. Other callers (the demo-data script, the
  browser tests' set-up) keep `020`'s rules unchanged, including `TIME_ZONE_REQUIRED` (FR-007;
  research R2; Constitution VIII, the smallest change).
- Q: On **Edit venue**, does the Admin app send the zone with every save? → A: **Only when the admin
  changed the zone or the address.** Sending the stored zone on a name-only edit would relabel a zone
  worked out from the address as "chosen by an admin" (`020` research R4); sending it with an address
  change is what keeps the zone from being worked out again from the new address (FR-005; research
  R3).
- Q: How is the address saved? → A: In one step (decided by Nate, issue item 2): every save from the
  Admin app that sends an address asks for it to be saved even if it can't be verified, so there is
  no separate "Save anyway" button or step. The address is still checked: a match is saved verified,
  in the service's standard form; no match, several matches, or a different address found is saved
  as typed and marked not verified (FR-009 to FR-011).
- Q: And when the address service can't be reached? → A: **Saved as typed, not verified**, the same
  way (decided by Nate, issue item 2). Today that is a refusal even with "save anyway"; the Backend's
  "save even if unverified" request now covers it too. Without that request (another caller), the
  save is still refused as today (FR-012; research R5; contract 1.15.0).
- Q: When the check found a different address ("Did you mean 1540 UNIVERSITY CT …?") or several, is
  the suggestion shown? → A: **No.** The venue is saved as typed and the notice says it is not
  verified, as for any other unverified address. The admin loses the "did you mean" hint that `013`
  FR-021 showed before a save anyway; the notice says to check the address and correct it by editing
  (FR-014, FR-015; research R6 records the trade-off).
- Q: The notice says the address "can be verified later by editing". How, when `013` FR-008 never
  checks an unchanged address again? → A: **An edit that sends the same address for a venue whose
  address is not verified checks it again.** A match makes it verified (in the service's standard
  form); any other answer, the service being down included, leaves it as stored and is never a
  refusal; the zone is not touched. So an address saved while the service was down is verified by
  opening **Edit venue** and pressing **Save changes** once the service is back (FR-016; research
  R7). Edits of verified venues still never call the service.
- Q: What does a section line show? → A: Visible labels "Section name", "Rows", and "Seats per
  row", with rows and seats per row side by side so the line reads "Rows × Seats per row", then the
  line's seat count ("= 200 seats"), and one short hint that a section is a grid of rows front to
  back and seats across each row (decided by Nate, issue item 3). Both places that edit sections get
  it: the New venue form and the venue page's layout editor. The total stays (FR-018 to FR-022).
- Q: Do the section inputs' names for screen readers change? → A: They now come from what is on the
  screen, the section's legend and the field's label: "Section 1 Section name", "Section 1 Rows",
  "Section 1 Seats per row", so the spoken name contains the visible label (WCAG 2.5.3) (FR-020;
  research R8).
- Q: How does the notice after saving a not-verified address look? → A: A plain information banner,
  not the green success banner with its check mark, since the admin has something to check (FR-014;
  research R6).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Admin Picks the Venue's Time Zone (Priority: P1)

An admin adds the Old Forester's Paristown Hall in Louisville. On the New venue form, the **Time
zone** select says "Choose a time zone" and lists the eight US zones; there is no "work it out"
choice. They fill in everything else and press **Create venue** without choosing: the form says
"Choose the venue's time zone." under the select and sends nothing. They choose **Eastern Time** and
press **Create venue**: the venue is saved in Eastern Time, shown as "chosen by an admin". Later they
correct the venue's street on **Edit venue**: the select already shows Eastern Time, and a note says
changing the address does not change the time zone. The zone stays Eastern.

**Why this priority**: Nate's first finding. Every event time at a venue is shown and entered in its
zone (`020`), so the zone must be what the admin meant, visible before saving.

**Independent Test**: Create a venue without choosing a zone (refused in the form, nothing sent),
then with Central Time at a Louisville address (saved Central, chosen by an admin); edit its address
to another Louisville address and save (still Central).

**Acceptance Scenarios**:

1. **Given** the New venue form, **When** the admin opens the Time zone select, **Then** it shows
   "Choose a time zone" selected, followed by Eastern, Central, Mountain, Arizona (no daylight
   saving), Pacific, Alaska, Hawaii-Aleutian, and Hawaii Time, and nothing else.
2. **Given** a New venue form with every other field filled, **When** the admin presses Create venue
   with no zone chosen, **Then** "Choose the venue's time zone." appears next to the Time zone field
   and is announced, every value is kept, and nothing is sent.
3. **Given** a zone chosen, **When** the admin creates the venue, **Then** it is saved in that zone,
   whatever the address, and the venue list, the venue page, and the saved notice say "chosen by an
   admin".
4. **Given** a venue in Eastern Time, **When** an admin opens Edit venue, **Then** the select shows
   Eastern Time, and a line under it says how the zone was set ("Eastern Time, from the address").
5. **Given** Edit venue, **When** the admin changes any address field, **Then** a note says the time
   zone does not change with the address, and **When** they save, **Then** the venue keeps its zone.
6. **Given** Edit venue, **When** the admin changes only the name (or the capacity) and saves,
   **Then** the zone and how it was set are unchanged.
7. **Given** Edit venue of a venue with events, **When** the admin picks a different zone, **Then**
   the form says the events keep their local times, as today (`020` FR-009), and a refusal
   (`020` FR-010 to FR-012) is shown with every value kept.
8. **Given** any state with two zones (Kentucky, for example), **When** an admin creates a venue
   there whose address the service does not find, **Then** no second question about the state's
   zones appears: the zone chosen in the select is used.

---

### User Story 2 - The Address Is Always Saved, and Says When It Is Not Verified (Priority: P1)

An admin adds the KFC Yum! Center at 1 Arena Plaza, Louisville, KY 40202, which the address service
does not know. They press **Create venue** once. The venue is saved, and the notice says plainly that
its address is saved but not verified: the address service could not confirm it, customers see it
and its map link, so check it is right, and to verify it later, edit the venue and save it. The venue
list marks it "Not verified". Another day the address service is down; an admin adds a venue at a
real address and it saves at once, not verified. When the service is back, they open Edit venue and
press Save changes, and the address becomes verified.

**Why this priority**: Nate's second finding. The second button and the refusal while the service is
down cost admins time and, offline, block them completely.

**Independent Test**: With an address the service does not know, one with a different match, and the
service stopped, create a venue each time with one press of Create venue; each is saved and marked
not verified with the notice. Then, with the service back, open Edit venue on the one saved while it
was down and press Save changes: it becomes verified.

**Acceptance Scenarios**:

1. **Given** an address the service matches (same ZIP code and house number, `013` FR-021), **When**
   the admin creates the venue, **Then** it is saved verified, in the service's standard form, and
   the notice is the success notice with that address, as today.
2. **Given** an address the service does not find, **When** the admin presses Create venue once,
   **Then** the venue is saved with the address as typed (spaces tidied, ZIP code cut to 5 digits),
   marked not verified, and the notice says so (FR-014). No "Save anyway" control appears, at any
   point.
3. **Given** an address with several matches, or one match at a different ZIP code or house number,
   **When** the admin presses Create venue once, **Then** it is saved as typed and not verified, with
   the same notice; the match is not shown.
4. **Given** the address service cannot be reached, does not answer within 5 seconds, or answers
   with an error, **When** the admin presses Create venue once, **Then** within 6 seconds the venue
   is saved as typed and not verified, with the same notice.
5. **Given** a seated New venue whose address is not verified, **When** the admin creates it,
   **Then** the venue and its layout are both saved, as for a verified address (`008` FR-017).
6. **Given** Edit venue of a verified venue, **When** the admin changes the address to one the
   service does not find, or while the service is down, **Then** it is saved as typed and not
   verified, with the notice.
7. **Given** a venue whose address is not verified, **When** an admin opens Edit venue, **Then** the
   form says the address is not verified and that saving checks it again; **When** they press Save
   changes without changing the address and the service now matches it, **Then** it is saved
   verified, in the service's standard form, and its zone is unchanged; **When** the service still
   does not match it, or is down, **Then** the save succeeds, the address stays as it was and not
   verified, and nothing else is refused because of it.
8. **Given** a blank street, city, or ZIP code, no state, or a malformed ZIP code, **When** the
   admin presses Create venue or Save changes, **Then** the form names each problem and sends
   nothing, as today (`013` FR-013); the Backend still refuses such a request (`013` FR-001).

---

### User Story 3 - Sections Read as Rows × Seats per Row (Priority: P2)

On the New venue form, an admin chooses **Seated** and presses **Add section**. A short line above
the sections says a section is a grid: rows run front to back, and every row has the same number of
seats across. The new line shows labelled boxes, "Section name", "Rows", "×", "Seats per row", and
then "= 1 seat". They type Floor, 10, and 20; the line now ends "= 200 seats", and the total under
the lines reads "Total: 200 seats". The same labelled lines appear when they later edit the layout on
the venue's page.

**Why this priority**: Nate's third finding. A section typed the wrong way round (20 rows of 10)
gives the right total but the wrong seat map, which customers then choose seats from (`007`).

**Independent Test**: On New venue (Seated) and in a venue page's layout editor, add two sections and
read each line's labels and seat count, and the total; check each box's name with a screen reader.

**Acceptance Scenarios**:

1. **Given** the New venue form set to Seated, or the venue page's layout editor, **When** a section
   line is shown, **Then** it has visible labels "Section name", "Rows", and "Seats per row", with
   the Rows and Seats per row boxes side by side and a "×" between them.
2. **Given** a line with 10 rows and 20 seats per row, **Then** the line shows "= 200 seats"; with 1
   and 1, "= 1 seat"; with a box empty or not a whole number, "= 0 seats".
3. **Given** any lines, **Then** the total ("Total: 270 seats" on the New venue form; the layout
   table's total on the venue page once saved) equals the sum of the lines' seat counts.
4. **Given** the section lines, **Then** one hint, shown once above them, says a section is a grid of
   rows front to back and seats across each row.
5. **Given** a screen reader, **When** it reaches a box, **Then** it reads the section's number and
   the box's visible label ("Section 1 Rows").
6. **Given** a phone-width screen (360 px), **Then** each line wraps without the page scrolling
   sideways, and every label stays next to its box.

---

### Edge Cases

- **A venue from before `013`** (one-line address, no fields): Edit venue keeps the address unless the
  admin fills in the four fields, as today (`013` FR-016); filling them in saves the address in one
  step like any other. Its zone (Eastern, "the default", `020` FR-006) shows in the select with that
  source, so the admin can see it may need changing; entering the address does not change it.
- **The admin picks a zone that does not match the address** (Pacific Time for a Louisville venue):
  saved as picked, as `020` FR-004 already allows; the venue's page says "chosen by an admin".
- **A different address found** (`013` FR-021, "1540 University Dr", 40508 → "1540 UNIVERSITY CT",
  40503): saved as typed and not verified; the suggestion is not shown (Clarifications).
- **The address service is slow**: the save waits up to the service's 5-second limit, then saves not
  verified; the Create button says "Saving…" and cannot be pressed twice, as today.
- **Name-only edit of a not-verified venue while the service is down**: the address is checked
  again (FR-016), the service does not answer within 5 seconds, and the edit is saved with the
  address unchanged, after up to 5 seconds; `013` SC-006 (name-only edits succeed while the service
  is down) still holds.
- **Another caller** (the demo-data script, a direct API request): without the "save even if
  unverified" request, an unmatched address is still refused and the service being down is still a
  `503`; without a zone, the zone is still worked out from the address or the state, and a two-zone
  state still needs one (`TIME_ZONE_REQUIRED`) (FR-007, FR-012).
- **The layout is refused after the venue is saved** (`008` US5 scenario 4): unchanged; the admin is
  told and given the link to the venue's page.
- **A section line with 100 rows × 200 seats** (the largest, `007` FR-001): "= 20,000 seats", with a
  thousands separator, as the total.
- **Removing a section**: the lines after it are renumbered (Section 3 becomes Section 2), as today,
  and their names for screen readers follow.

## Requirements *(mandatory)*

### Functional Requirements

**The time zone is the admin's pick (US1)**

- **FR-001**: The Admin app's venue form MUST offer, for the venue's time zone, exactly the eight
  zones of `020` FR-001, and MUST NOT offer any choice that works the zone out from the address.
- **FR-002**: On New venue, the time zone MUST start with no zone chosen ("Choose a time zone"). The
  form MUST NOT send the venue until a zone is chosen: pressing Create venue without one MUST show
  "Choose the venue's time zone." next to the field, announced to assistive technology, keep every
  value, and send nothing.
- **FR-003**: On Edit venue, the time zone MUST start on the venue's stored zone and MUST say how it
  was set ("Eastern Time, from the address"; `020` FR-007).
- **FR-004**: On Edit venue, while any address field differs from the stored address, the form MUST
  say that changing the address does not change the time zone. Saving MUST NOT change the zone
  unless the admin picked another one.
- **FR-005**: The Admin app MUST send the chosen zone on every create, and on every edit that changes
  the zone or the address. An edit that changes neither MUST NOT send it, so the zone and how it was
  set stay as they are.
- **FR-006**: The Admin app's venue form MUST NOT ask a second question about a state's time zones
  (`020` FR-003's choice); the select is the only place the zone is chosen.
- **FR-007**: The Backend's zone rules for a request that sends no zone MUST be unchanged (`020`
  FR-002, FR-003, FR-005), including the refusal for a two-zone state; a sent zone MUST still be
  stored as chosen by an admin (`020` FR-004). The zone-change rules and their refusals (`020`
  FR-009 to FR-012, FR-026) and the zone-change note on Edit venue MUST be unchanged.

**The address is always saved (US2)**

- **FR-008**: The Admin app MUST NOT offer a "Save anyway" control or any second step to save an
  address.
- **FR-009**: Every save from the Admin app that sends an address MUST ask the Backend to save it even
  if it cannot be verified.
- **FR-010**: The Backend MUST still check every new or changed address with the address service
  first. An address the service matches (`013` FR-003, FR-021) MUST be saved verified, in the
  service's standard form, whether or not the save asked to save it unverified.
- **FR-011**: With the request to save it even if unverified, an address with no match, several
  matches, or one match at a different ZIP code or house number MUST be saved as sent (trimmed, runs
  of spaces collapsed to one, ZIP code cut to 5 digits) and recorded as not verified (`013` FR-019).
- **FR-012**: With the request to save it even if unverified, when the address service cannot be
  reached, does not answer within 5 seconds, answers with an error, or answers with something that
  cannot be read, the address MUST be saved as sent and recorded as not verified, instead of refused.
  Without that request, the save MUST still be refused as today (`013` FR-006).
- **FR-013**: Format problems MUST still block saving: the form names a blank street, city, or ZIP
  code, a missing state, or a malformed ZIP code and sends nothing (`013` FR-013), and the Backend
  refuses them (`013` FR-001).
- **FR-014**: After a save whose address is not verified, the Admin app MUST show, in an information
  notice (not the success notice), that the venue was saved but its address is not verified, the
  address as saved, why that matters (the address service could not confirm it as a US address;
  customers see this address and its map link), and how to verify it later (edit the venue and save
  it, correcting the address if it is wrong), then the time zone, as today. After a save whose address
  is verified, the notice MUST be unchanged (`013` FR-012, `020` research R14).
- **FR-015**: The not-verified notice MUST NOT show the address service's other matches.
- **FR-016**: An edit that sends the same address (ignoring case and extra spaces, `013` FR-008) for
  a venue whose address is not verified and has its four fields MUST check it again. A match MUST be
  saved verified, in the service's standard form. Any other answer, the service being unavailable
  included, MUST leave the address as stored, not verified, and MUST NOT refuse the edit. This check
  MUST NOT change the venue's zone. An edit that sends no address, or the same address for a verified
  venue, MUST still never call the address service (`013` FR-008).
- **FR-017**: Edit venue of a venue whose address is not verified MUST say so and that saving checks
  it again. The "Not verified" marks on the venue list and page (`013` FR-017) MUST be unchanged.

**Sections read as rows × seats per row (US3)**

- **FR-018**: Each section line, on the New venue form and in the venue page's layout editor, MUST
  show visible labels "Section name", "Rows", and "Seats per row", with the Rows and Seats per row
  boxes side by side and "×" between them, so the line reads "Rows × Seats per row".
- **FR-019**: Each section line MUST end with its seat count, rows times seats per row: "= 200
  seats", "= 1 seat", with a thousands separator ("= 20,000 seats"); a box that is empty or not a
  whole number counts as 0.
- **FR-020**: Each box's name for assistive technology MUST be the section's legend followed by the
  box's visible label ("Section 1 Section name", "Section 1 Rows", "Section 1 Seats per row"), so it
  contains the visible label (WCAG 2.5.3).
- **FR-021**: Both places MUST show, once above the section lines, a short hint that a section is a
  grid: rows run front to back, and every row has the same number of seats across.
- **FR-022**: The total of seats (the New venue form's "Total: N seats", the venue page's layout
  total) MUST be unchanged and equal the sum of the lines' seat counts; the section limits (1–100
  rows, 1–200 seats per row, `007` FR-001), Add section, Remove section N, and the layout table on
  the venue page MUST be unchanged.
- **FR-023**: The section lines MUST work at 360 px wide without sideways scrolling, by keyboard, and
  in light and dark schemes, using only the shared theme's styles (Constitution VII).

### Superseded requirements

This spec changes these requirements of earlier specs; the earlier text stays as their record.

| Spec | Requirement | Now |
| --- | --- | --- |
| `013` | FR-006 (refused when the service is down, even with save anyway) | Only without the request to save it unverified; with it, saved not verified (FR-012) |
| `013` | FR-008 (an unchanged address is never checked again) | Except a not-verified one, checked again without refusal (FR-016) |
| `013` | FR-011 (a "Save anyway (address not verified)" control after a not-found or ambiguous refusal) | No such control; the Admin app always asks to save unverified (FR-008, FR-009) |
| `013` | FR-019 (save anyway does not change the outcome when the service is unavailable) | It does: saved not verified (FR-012) |
| `013` | SC-002, SC-003 (a save refused while the service is down, "try again" within 6 seconds) | For the Admin app, saved not verified within 6 seconds (SC-003 below) |
| `020` | FR-002 (zone worked out from the address "without asking the admin"), for the Admin app | The admin picks every new venue's zone (FR-001, FR-002); the API still works it out for other callers (FR-007) |
| `020` | FR-003 (in a two-zone state, the admin's choice asked by the form) | No second question; the select is required (FR-006) |
| `020` | FR-024 (the form lets the admin choose a zone and shows FR-003's choice) | The form requires a zone on create and starts on the stored one on edit (FR-002, FR-003) |
| `020` | Research R4 ("The Admin app sends `timeZone` only when the admin picks one"), R14 (the select's first option, the split-state question) | Research R1, R3 |
| `007`, `008` | `008` FR-017's section lines "as on the venue page" (name, rows, seats per row, unlabelled) | Labelled lines with a seat count, in both places (FR-018 to FR-021) |

### Key Entities

- **Venue**: unchanged. Its time zone and how it was set (`020`), and whether its address is
  verified (`013`). A venue created through the Admin app now always has a zone chosen by an admin.
- **Save even if unverified**: the existing request flag (`013` FR-019), now also covering the address
  service being unavailable (FR-012); the Admin app sends it with every address.
- **Section line**: a section being edited: name, rows, seats per row, and its seat count (rows ×
  seats per row), shown, not stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The venue form's time zone offers 8 choices (9 on New venue, counting "Choose a time
  zone") and none of them works the zone out; 100% of venues created through the Admin app are saved
  in the zone the admin chose, recorded as chosen by an admin.
- **SC-002**: 100% of Admin app saves of a well-formed address succeed with one press, whatever the
  address service answers (a match, none, several, a different address, or no answer); every one the
  service did not match is marked not verified and its notice says so.
- **SC-003**: With the address service unreachable, a new venue is saved, not verified, within 6
  seconds of pressing Create venue.
- **SC-004**: A venue saved not verified while the service was down becomes verified with one Save
  changes on Edit venue once the service answers, with its zone unchanged.
- **SC-005**: For every request that does not ask to save unverified or does not send a zone (other
  callers), the outcome is the same as before this feature: 100% of `013`'s and `020`'s Backend tests
  for those requests pass unchanged.
- **SC-006**: On every section line, in both places, the seat count shown equals rows × seats per row
  and the total equals the sum of the lines, for 100% of whole-number entries in the limits.
- **SC-007**: Every section box has a visible label, and its name for assistive technology contains
  that label; the lines fit a 360 px screen with no sideways scrolling.

## Assumptions

- Only the Admin app changes how it sends a venue; every other client of the venue operations is a
  script or test in this repository and keeps today's behavior (FR-007, FR-012).
- The address service's 5-second limit (`013` research R6) is unchanged, so a save while it is down
  waits up to that long.
- Verifying a not-verified address on an edit (FR-016) costs one address lookup per save of such a
  venue; there are few of them, and a verified venue is never looked up again.
- The notice's wording is settled in the plan (research R6); this spec fixes what it must say.
- English only, US addresses only, as `013`.
- No deferral of a security or correctness control: the address is still checked on every new or
  changed address, and still only the Backend decides whether it is verified (`013` FR-018).
