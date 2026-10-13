# Feature Specification: Venue Address Validation and Google Maps Link

**Feature Branch**: `013-venue-address-validation-spec`

**Created**: 2026-10-11

**Status**: Draft

**Issue**: [#25](https://github.com/Trughouse-Holdings/QueuePass/issues/25)

**Input**: User description: "When an admin creates or edits a venue, the address must be a real US
address. The venue address is a Google Maps link in both the Admin and Customer apps."

## Context

Builds on `002` (admins create, edit, and delete venues), `003` (customers see venues), `004`
(venue search matches name or address), and `008` (a seated venue is created in one step).

Today a venue's address is one free-text line. Anything is accepted: "Y", "1 Arena Plaza" with no
city, or a typo. Customers cannot tell where a venue is, and nothing helps them get there.

This feature splits the address into street, city, state, and ZIP code, checks it with an outside
address service before a venue is saved, and turns every venue address in both apps into a link
that opens the address in Google Maps.

Because an admin may "save anyway" an address the service does not find (Clarifications), this
spec's PR also rewords the `013` row of the constitution's roadmap to say so, a PATCH amendment
(3.0.0 → 3.0.1, decided by the user, 2026-10-11). The constitution is shared surface, so every
team member signs off on that row in the PR.

## Clarifications

### Session 2026-10-11

- Q: Which address service checks that an address is real? → A: The free US Census Geocoder. It
  needs no API key (decided by the user, 2026-10-11).
- Q: What happens when the address service cannot be reached? → A: The save is refused with a
  clear "can't verify the address right now, try again" message, and what the admin typed is
  kept (decided by the user, 2026-10-11).
- Q: One address line, or separate fields? → A: Separate fields: street, city, state (chosen from
  a list), and ZIP code (decided by the user, 2026-10-11).
- Q: The service misses some real venues (the KFC Yum! Center at 1 Arena Plaza has no match).
  What can the admin do? → A: When the address is not found, or matches more than one address,
  the admin can explicitly confirm and "save anyway". The venue is saved with the address as the
  admin typed it and marked "Address not verified". When the service is unavailable, saving is
  still refused, even with the confirmation (decided by the user, 2026-10-11).
- Q: The constitution's roadmap row for `013` says "accept only a real US address". Does it
  change? → A: Yes. It now reads that a real US address is required, checked by the Census
  Geocoder, unless an admin explicitly confirms an unmatched address, which is then marked not
  verified. Constitution 3.0.1 (decided by the user, 2026-10-11).
- Q: Live testing found that the service can answer with one match that is a different place:
  "1540 University Dr", Lexington, KY "40508" (Kroger Field) comes back as "1540 UNIVERSITY CT,
  LEXINGTON, KY, 40503". Is that verified? → A: No. One match is verified only when its ZIP code
  and house number are the ones typed. Otherwise it is refused like several matches, showing the
  match so the admin can enter it, or "Save anyway" (decided by the user, 2026-10-11).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Admin Cannot Save an Address That Is Not Real (Priority: P1)

An admin creates a venue and enters a street, city, state, and ZIP code. If the address service
finds exactly one matching US address that keeps the typed ZIP code and house number (FR-021),
the venue is saved with the address in the service's
standard form, and the admin is shown the address as saved. If the service finds no match, the
venue is not saved, the admin is told the address could not be found, and everything they typed
stays in the form so they can fix it. If the admin is sure the address is real (the service
misses some real venues), they can choose "Save anyway". The venue is then saved with the address
as they typed it, and marked "Address not verified".

**Why this priority**: This is the rule itself. Without it, a venue can still have an address no
one has checked, and no one knows it.

**Independent Test**: With the address service replaced by a stand-in in tests, create a venue
whose address the stand-in matches and confirm it is saved in standard form and verified. Create
one the stand-in does not match and confirm it is refused, nothing is saved, and the form keeps
its values. Choose "Save anyway" and confirm it is saved as typed and marked not verified.

**Acceptance Scenarios**:

1. **Given** the venue form, **When** an admin enters "430 W Vine St", "Lexington", "KY", "40507"
   and saves, **Then** the venue is saved, and its address is shown as "430 W VINE ST, LEXINGTON,
   KY 40507".
2. **Given** the venue form, **When** an admin enters an address the service cannot match,
   **Then** the venue is not saved, the message says the address could not be found as a US
   address and asks the admin to check it, every value entered is kept, and a "Save anyway
   (address not verified)" control is offered.
3. **Given** the venue form, **When** the address matches more than one US address, **Then** the
   venue is not saved, the message lists the matches so the admin can enter the right one, and
   "Save anyway" is offered.
4. **Given** the refusal in scenario 2 for "1 Arena Plaza", "Louisville", "KY", "40202" (the KFC
   Yum! Center, a real venue the service does not know), **When** the admin chooses "Save
   anyway", **Then** the venue is saved with "1 Arena Plaza, Louisville, KY 40202" as typed, and
   the Admin app marks it "Address not verified" on the venue list and the venue page.
5. **Given** a venue saved anyway, **When** an admin later changes its address to one the service
   matches, **Then** it is saved in standard form and the mark is removed.
6. **Given** the venue form, **When** any of the four address fields is blank, the state is not on
   the list, or the ZIP code is not 5 digits (or 5+4), **Then** the venue is not saved and the
   form names the field, without asking the address service.
7. **Given** an existing venue, **When** an admin changes its street and saves, **Then** the new
   address is checked the same way before anything is saved.
8. **Given** an existing venue, verified or not, **When** an admin changes only its name or
   seating capacity, **Then** the address is not checked again and the change is saved.
9. **Given** a request sent straight to the API, not through the Admin app, **Then** the same
   checks apply, and "save anyway" must be asked for explicitly in the request.
10. **Given** the venue form, **When** an admin enters "1540 University Dr", "Lexington", "KY",
    "40508" (Kroger Field) and the service's one match is "1540 UNIVERSITY CT, LEXINGTON, KY
    40503", **Then** the venue is not saved, the message shows that address and asks whether the
    admin meant it, every value entered is kept, and "Save anyway" is offered. Entering the shown
    address saves it verified; "Save anyway" saves what was typed, not verified.

---

### User Story 2 - The Address Service Is Down (Priority: P1)

The address service is slow, unreachable, or answers with an error. An admin saving a new
address is told plainly that the address cannot be verified right now and to try again shortly.
Nothing is saved, and what they typed stays in the form.

**Why this priority**: An outside service will fail sometimes. The admin must know why the save
failed and that nothing was lost, and an unverified address must never slip through.

**Independent Test**: Make the stand-in fail in each way (no connection, a timeout, an error
answer, a reply that makes no sense) and confirm each save is refused with the same message and
nothing is saved.

**Acceptance Scenarios**:

1. **Given** the address service cannot be reached, **When** an admin saves a new venue, **Then**
   the save is refused within a few seconds with "We can't verify the address right now. Nothing
   was saved. Try again in a minute.", and the form keeps every value.
2. **Given** the address service does not answer within 5 seconds, **Then** the save is refused
   the same way.
3. **Given** the address service is down, **When** an admin asks to "save anyway", **Then** the
   save is still refused the same way. "Save anyway" is never offered for this refusal.
4. **Given** the address service is down, **When** an admin edits only a venue's name, **Then**
   the change is saved, because the address is not checked.
5. **Given** the address service is down, **Then** customers and admins can still see every
   venue and its address link.

---

### User Story 3 - The Address Opens in Google Maps (Priority: P2)

Wherever an app shows a venue's address, the address is a link. Selecting it opens Google Maps
on that address in a new browser tab, so the QueuePass page stays open.

**Why this priority**: It helps customers get to the venue, but venues work without it.

**Independent Test**: Open the venue list and a venue page in each app and confirm each address
is a link to Google Maps for that address that opens in a new tab.

**Acceptance Scenarios**:

1. **Given** the Customer app's venue list and venue page, **Then** each address is a link that
   opens Google Maps searching for that exact address, in a new tab.
2. **Given** the Admin app's venue list and venue page, **Then** the same is true.
3. **Given** a screen reader, **Then** the link is announced with the address and says it opens
   Google Maps in a new tab.
4. **Given** a venue created before this feature, **Then** its address is a link too, built from
   its existing address.

---

### User Story 4 - Existing Venues Keep Working (Priority: P2)

Venues saved before this feature have a one-line address that was never checked. They keep
working exactly as before: customers see them, events can be scheduled there, and search still
finds them by address. They are not checked until an admin next changes their address. The Admin
app marks them as not yet verified, so an admin knows to update them.

**Why this priority**: The feature must not break or hide venues that events and orders depend
on, but no new capability depends on it.

**Independent Test**: Insert a venue with only a one-line address, as an existing venue would be,
and confirm it lists, searches, takes an event, and edits its name without an address check.
Then edit its address and confirm the new address is checked and saved in the four fields and
verified.

**Acceptance Scenarios**:

1. **Given** a venue created before this feature, **When** any app shows it, **Then** its address
   is shown as it always was.
2. **Given** that venue, **When** an admin searches venues by a word in its address, **Then** it
   is found.
3. **Given** that venue, **When** an admin opens its edit form, **Then** the old address is shown
   with a note that it is not verified, and the four address fields are empty to fill in.
4. **Given** that venue, **When** an admin changes only its name and leaves the address fields
   empty, **Then** the change is saved and the venue stays not verified.
5. **Given** that venue, **When** an admin fills in the four address fields, **Then** the address
   is checked and, if it matches, replaces the old one and the venue is verified. If it does not
   match, "Save anyway" is offered as in US1.

---

### Edge Cases

- **Upper case**: The service's standard form is upper case ("430 W VINE ST"). That is what is
  saved and shown. The admin is shown the saved form after saving.
- **ZIP+4**: An admin may enter "40507-1234". The service's 5-digit ZIP code is what is saved.
- **The service corrects a field**: If the admin's city or street spelling was slightly off and
  the service still finds one match with the typed ZIP code and house number, the corrected
  address is saved and shown to the admin.
- **One match somewhere else**: If the service's one match has a different ZIP code or house
  number than typed (Kroger Field, "1540 University Dr", 40508, comes back as "1540 UNIVERSITY
  CT", 40503), it may be a different place, so it is not saved. It is refused like several
  matches, listing that one address (FR-021). The rest of the street is not compared, because the
  service writes it in its own form ("West" → "W", "Street" → "ST"). Known limit: a match with the
  same house number and ZIP code on a different street (for example University Dr and University
  Ct in the same ZIP code) is still accepted as verified (research R3).
- **A match in a form QueuePass cannot read**: If the service's match cannot be split into a
  street, a city, one of the listed states, and a 5-digit ZIP code, it is treated as not found,
  so "Save anyway" is offered. Retrying would give the same answer.
- **A real address the service does not know**: The service works from street address ranges and
  misses some real addresses, such as the KFC Yum! Center at 1 Arena Plaza, some other plazas,
  and new buildings. The first save is refused like any other unmatched address. The admin can
  then fix the address, or choose "Save anyway" to save it as typed, marked not verified.
- **Save anyway is a deliberate choice**: It is offered only after a "not found" or "several
  matches" refusal, never up front and never when the service is unavailable. An address saved
  this way keeps the admin's spelling and case (trimmed, runs of spaces collapsed to one, and the
  ZIP code cut to 5 digits).
- **Save anyway when the address does match**: If the admin asks to save anyway and the service
  does find exactly one match that keeps the typed ZIP code and house number (FR-021) (for
  example, on a retry with a corrected address), the matched address is saved and verified, as
  usual.
- **Unchanged address on edit**: If the four fields are sent again with the same values (ignoring
  case and extra spaces), the address is not checked again, and a venue keeps its verified or not
  verified state.
- **Only part of an address on edit**: Changing one field (for example, only the city) still
  sends all four, and the whole address is checked. A request with some but not all four fields
  is refused.
- **Another rule fails too**: When an edit breaks another rule (for example, seating capacity
  below an event's tickets), that refusal comes first and the address service is not asked.
- **Seated venue in one step** (`008`): If the address is refused, neither the venue nor its
  seating layout is saved.
- **Running offline**: On a laptop with no internet, new addresses cannot be saved. Everything
  else works.
- **Territories and other countries**: Only the 50 states and the District of Columbia are
  offered.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A venue's address MUST be entered as four fields: street (1 to 200 characters),
  city (1 to 100 characters), state (one of the 50 US states or DC, by two-letter code), and ZIP
  code (5 digits, or 5 digits, a hyphen, and 4 digits).
- **FR-002**: Before a new venue is saved, or a venue's address is changed, the Backend MUST check
  the address with the address service. Nothing about the venue is saved until the service has
  answered and the answer allows the save (FR-003, FR-019).
- **FR-003**: An address is verified only when the service finds exactly one matching US address
  that keeps the typed ZIP code and house number (FR-021).
  The venue is then saved with the service's standard form of the street, city, state, and ZIP
  code, not the text the admin typed, and recorded as verified.
- **FR-004**: An address with no match MUST be refused with the standard error shape and its own
  stable code, and a message telling the admin the address was not found, unless the admin
  confirmed "save anyway" (FR-019).
- **FR-005**: An address with more than one match, or with one match at a different ZIP code or
  house number (FR-021), MUST be refused with its own stable code, and the refusal MUST list the
  matches, unless the admin confirmed "save anyway" (FR-019).
- **FR-006**: When the address service cannot be reached, does not answer within 5 seconds,
  answers with an error, or answers with something that cannot be read, the save MUST be refused
  with its own stable code and a message saying the address cannot be verified right now and to
  try again. Nothing is saved, whether or not the admin confirmed "save anyway".
- **FR-007**: Field rules (FR-001) and the venue's other rules MUST be checked before the address
  service is asked, so a request refused for another reason never calls it.
- **FR-008**: An edit that does not change the address (no address fields sent, or the same four
  values, ignoring case and extra spaces) MUST NOT call the address service.
- **FR-009**: An edit MUST send all four address fields together or none of them.
- **FR-010**: Every venue MUST still have a full one-line address, built from the four fields as
  "STREET, CITY, ST ZIP", which every app shows and venue search matches (`004` FR-007).
- **FR-011**: The Admin app MUST show any refusal from FR-004 to FR-006 as an explicit error, and
  MUST keep every value the admin entered (Constitution IV). After a refusal from FR-004 or
  FR-005, and only then, it MUST offer a "Save anyway (address not verified)" control.
- **FR-012**: After a save, the Admin app MUST show the address as it was saved.
- **FR-013**: The Admin app's state field MUST be a list of the 50 states and DC, and its form
  MUST point out a blank field or a malformed ZIP code before sending, as a convenience only.
- **FR-014**: Every place the Admin app or the Customer app shows a venue's address MUST show it
  as a link to Google Maps for that one-line address, opening in a new tab without giving the new
  tab access to the QueuePass page.
- **FR-015**: The link's accessible name MUST include the address and say that it opens Google
  Maps in a new tab.
- **FR-016**: Venues that exist before this feature MUST keep their one-line address, MUST keep
  working everywhere as before, and MUST NOT be checked until their address is changed.
- **FR-017**: The Admin app MUST mark every venue whose address is not verified (venues from
  before this feature, and venues saved anyway) on the venue list, on its page, and in its edit
  form.
- **FR-018**: Only the Backend decides whether an address is accepted. The Admin app's checks
  (FR-013) are a preview.
- **FR-019**: A create or address change MAY carry an explicit "save anyway" confirmation. With
  it, when the service finds no match or several matches (including one match at a different
  ZIP code or house number, FR-021), the venue MUST be saved with the four
  fields as the admin sent them (trimmed, runs of spaces collapsed to one, ZIP code cut to 5
  digits), and recorded as not verified.
  The address service MUST still be asked first; the confirmation MUST NOT change the outcome when
  the service finds exactly one match that keeps the typed ZIP code and house number (FR-003,
  FR-021) or is unavailable (FR-006), and MUST be refused
  when sent without the four address fields.
- **FR-020**: Every venue MUST record whether its address is verified. A verified venue always
  has its four fields.

- **FR-021**: The service's one match MUST count as a match only when its ZIP code equals the
  typed ZIP code's first 5 digits and its house number (the leading number of the street) equals
  the typed one. Otherwise the address MUST be refused as having several matches (FR-005), with
  that one match as the only listed match, and nothing is saved unless the admin confirmed "save
  anyway" (FR-019).

### Key Entities

- **Venue**: gains a **street**, **city**, **state**, and **ZIP code**, and whether its address
  is **verified**. A verified venue's four fields are the service's standard form. A venue saved
  anyway has its four fields as typed and is not verified. A venue from before this feature has no
  fields and is not verified. Its one-line **address** stays and, when the fields are present, is
  built from them.
- **Address check**: not stored. The answer from the address service for one save: exactly one
  match that keeps the typed ZIP code and house number (FR-021), no match, several matches (or
  one match that moved), or unavailable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of venues saved or re-addressed after this feature have either an address the
  address service matched, or an address an admin explicitly confirmed with "save anyway" and
  that is marked not verified.
- **SC-002**: 100% of refused saves (no match or several matches without confirmation, service
  unavailable with or without it) leave the database unchanged and keep the admin's entered
  values in the form.
- **SC-003**: When the address service is unreachable, the admin sees the "try again" message
  within 6 seconds of saving.
- **SC-004**: Every venue address shown in the Admin and Customer apps opens Google Maps on that
  address in one click.
- **SC-005**: Every venue created before this feature still shows, searches, and takes events
  exactly as before, with no admin action.
- **SC-006**: Name-only and capacity-only edits succeed while the address service is down.

## Assumptions

- The address service is the free US Census Geocoder, with no API key (decided by the user,
  2026-10-11).
- When the address service is unavailable, the save is refused and the admin's values are kept;
  "save anyway" does not apply (decided by the user, 2026-10-11).
- The address is entered as street, city, state, and ZIP code (decided by the user, 2026-10-11).
- "Verified" means the address service matched it. When the service finds no match or several,
  the admin may confirm "save anyway", and the venue is saved as typed and marked not verified
  (decided by the user, 2026-10-11), because the service misses some real venues.
- The service's standard form (upper case, abbreviated street types) is saved and shown, because
  it is what the service vouched for.
- The 50 states and DC are enough for the venues QueuePass expects. Territories can be added
  later.
- Existing venues are not converted automatically. Their one-line addresses have no ZIP code to
  rely on, and a migration must not call an outside service.
- The Google Maps link is built from the address text. It needs no key and no map data is stored.
- The Backend container can reach the internet, as Docker Compose allows by default.

## Out of Scope

- Addresses outside the 50 states and DC, including US territories and other countries.
- Suggestions or autocomplete while typing an address.
- A map shown inside either app.
- Storing map coordinates.
- Re-checking existing venues in bulk.
- Showing the address on event pages, which show the venue's name and link to the venue page.
- The Ticket Booth app, which does not show venues.
