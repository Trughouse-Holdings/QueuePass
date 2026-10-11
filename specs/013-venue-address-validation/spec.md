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

## Clarifications

### Session 2026-10-11

- Q: Which address service checks that an address is real? → A: The free US Census Geocoder. It
  needs no API key (decided by the user, 2026-10-11).
- Q: What happens when the address service cannot be reached? → A: The save is refused with a
  clear "can't verify the address right now, try again" message, and what the admin typed is
  kept (decided by the user, 2026-10-11).
- Q: One address line, or separate fields? → A: Separate fields: street, city, state (chosen from
  a list), and ZIP code (decided by the user, 2026-10-11).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Admin Cannot Save an Address That Is Not Real (Priority: P1)

An admin creates a venue and enters a street, city, state, and ZIP code. If the address service
finds exactly one matching US address, the venue is saved with the address in the service's
standard form, and the admin is shown the address as saved. If the service finds no match, the
venue is not saved, the admin is told the address could not be found, and everything they typed
stays in the form so they can fix it.

**Why this priority**: This is the rule itself. Without it, a venue can still have an address no
one can find.

**Independent Test**: With the address service replaced by a stand-in in tests, create a venue
whose address the stand-in matches and confirm it is saved in standard form. Create one the
stand-in does not match and confirm it is refused, nothing is saved, and the form keeps its values.

**Acceptance Scenarios**:

1. **Given** the venue form, **When** an admin enters "430 W Vine St", "Lexington", "KY", "40507"
   and saves, **Then** the venue is saved, and its address is shown as "430 W VINE ST, LEXINGTON,
   KY 40507".
2. **Given** the venue form, **When** an admin enters an address the service cannot match,
   **Then** the venue is not saved, the message says the address could not be found as a US
   address and asks the admin to check it, and every value entered is kept.
3. **Given** the venue form, **When** the address matches more than one US address, **Then** the
   venue is not saved, and the message lists the matches so the admin can enter the right one.
4. **Given** the venue form, **When** any of the four address fields is blank, the state is not on
   the list, or the ZIP code is not 5 digits (or 5+4), **Then** the venue is not saved and the
   form names the field, without asking the address service.
5. **Given** an existing venue, **When** an admin changes its street and saves, **Then** the new
   address is checked the same way before anything is saved.
6. **Given** an existing venue, **When** an admin changes only its name or seating capacity,
   **Then** the address is not checked again and the change is saved.
7. **Given** a request sent straight to the API, not through the Admin app, **Then** the same
   checks apply.

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
3. **Given** the address service is down, **When** an admin edits only a venue's name, **Then**
   the change is saved, because the address is not checked.
4. **Given** the address service is down, **Then** customers and admins can still see every
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
Then edit its address and confirm the new address is checked and saved in the four fields.

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
   is checked and, if it matches, replaces the old one.

---

### Edge Cases

- **Upper case**: The service's standard form is upper case ("430 W VINE ST"). That is what is
  saved and shown. The admin is shown the saved form after saving.
- **ZIP+4**: An admin may enter "40507-1234". The service's 5-digit ZIP code is what is saved.
- **The service corrects a field**: If the admin's city or ZIP code was slightly off and the
  service still finds one match, the corrected address is saved and shown to the admin.
- **A real address the service does not know**: The service works from street address ranges and
  misses some real addresses, such as some plazas and new buildings. These are refused like any
  other unmatched address; the admin can enter the street address the service knows. There is no
  override (Assumptions).
- **Unchanged address on edit**: If the four fields are sent again with the same values (ignoring
  case and extra spaces), the address is not checked again.
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
  the address with the address service. Nothing about the venue is saved until the check passes.
- **FR-003**: An address is accepted only when the service finds exactly one matching US address.
  The venue is then saved with the service's standard form of the street, city, state, and ZIP
  code, not the text the admin typed.
- **FR-004**: An address with no match MUST be refused with the standard error shape and its own
  stable code, and a message telling the admin the address was not found.
- **FR-005**: An address with more than one match MUST be refused with its own stable code, and
  the refusal MUST list the matches.
- **FR-006**: When the address service cannot be reached, does not answer within 5 seconds,
  answers with an error, or answers with something that cannot be read, the save MUST be refused
  with its own stable code and a message saying the address cannot be verified right now and to
  try again. Nothing is saved.
- **FR-007**: Field rules (FR-001) and the venue's other rules MUST be checked before the address
  service is asked, so a request refused for another reason never calls it.
- **FR-008**: An edit that does not change the address (no address fields sent, or the same four
  values, ignoring case and extra spaces) MUST NOT call the address service.
- **FR-009**: An edit MUST send all four address fields together or none of them.
- **FR-010**: Every venue MUST still have a full one-line address, built from the four fields as
  "STREET, CITY, ST ZIP", which every app shows and venue search matches (`004` FR-007).
- **FR-011**: The Admin app MUST show any refusal from FR-004 to FR-006 as an explicit error, and
  MUST keep every value the admin entered (Constitution IV).
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
- **FR-017**: The Admin app MUST mark a venue whose address has not been verified, on its page and
  in its edit form.
- **FR-018**: Only the Backend decides whether an address is accepted. The Admin app's checks
  (FR-013) are a preview.

### Key Entities

- **Venue**: gains a **street**, **city**, **state**, and **ZIP code**, all present for a venue
  whose address was verified, all absent for a venue from before this feature. Its one-line
  **address** stays and is built from the four.
- **Address check**: not stored. The answer from the address service for one save: one match,
  no match, several matches, or unavailable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of venues saved or re-addressed after this feature have an address the address
  service matched.
- **SC-002**: 100% of refused saves (no match, several matches, service unavailable) leave the
  database unchanged and keep the admin's entered values in the form.
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
  there is no "save anyway" (decided by the user, 2026-10-11).
- The address is entered as street, city, state, and ZIP code (decided by the user, 2026-10-11).
- "Real" means the address service matched it. A real address the service does not know is
  refused; the admin enters a nearby form of the address it knows. A manual override would
  reopen the gap this feature closes, so none is offered.
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
