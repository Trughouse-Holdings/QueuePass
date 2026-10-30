# Quickstart: Venue Form Simplify

**Feature**: `024-venue-form-simplify` | **Spec**: [spec.md](./spec.md)

## V0. Set up

Stack up from the implementation branch (`docker compose up --build`), with internet access (the real
US Census Geocoder answers the addresses below), signed in to the Admin app as `admin1`. Keep the
browser's network panel open for V1 and V7.

## V1. New venue: the time zone is the admin's pick (US1 scenarios 1–3, 8; FR-001, FR-002, FR-005, FR-006)

Venues → Add venue. Open **Time zone**. **Expected**: "Choose a time zone" selected, then Eastern,
Central, Mountain, Arizona (no daylight saving), Pacific, Alaska, Hawaii-Aleutian, and Hawaii Time;
no "Work it out" choice. Name "Zone Test Hall", 430 W Vine St, Lexington, KY, 40507, capacity 500,
no zone; press **Create venue**. **Expected**: "Choose the venue's time zone." under the select,
every value kept, no `POST /locations`. Choose **Central Time**; press **Create venue**.
**Expected**: one `POST /locations` whose body has `"timeZone": "America/Chicago"` and
`"acceptUnverifiedAddress": true`; the success notice "Venue saved. Address: 430 W VINE ST,
LEXINGTON, KY 40507. Time zone: Central Time, chosen by an admin."; the list's Time zone column says
"Central Time, chosen by an admin".

## V2. Section lines read as rows × seats per row (US3; FR-018 to FR-023, SC-006)

Add venue → **Seated** → **Add section** twice. **Expected**: one hint above the lines, "A section
is a grid of seats: rows run front to back, and every row has the same number of seats across."; each
line has labels "Section name", "Rows", "×", "Seats per row", and "= 1 seat". Type Floor, 10, 20 and
Balcony, 5, 10. **Expected**: "= 200 seats", "= 50 seats", "Total: 250 seats". Clear Balcony's Rows.
**Expected**: "= 0 seats", "Total: 200 seats". Type 100 and 200 in Floor. **Expected**: "= 20,000
seats". Remove section 1. **Expected**: Balcony's line is now "Section 1", and its boxes' names follow.
Finish the venue (V3's address, a zone) and open its page → **Edit layout**. **Expected**: the same
labelled lines, counts, and hint.

## V3. An address the service does not find, in one press (US2 scenarios 2, 5; FR-008 to FR-011, FR-014)

Add venue: "KFC Yum! Center", 1 Arena Plaza, Louisville, KY, 40202, Eastern Time, Seated with one
section 2 × 10. Press **Create venue** once. **Expected**: saved (the venue and its 20-seat layout);
no "Save anyway" button at any point; a plain (not green, no check mark) notice: "Venue saved, but
its address is not verified: 1 Arena Plaza, Louisville, KY 40202. The US address service couldn't
confirm it, so check that it's right: customers see this address and its map link. To verify it
later, edit the venue and save it, correcting the address if it's wrong. Time zone: Eastern Time,
chosen by an admin."; the list marks it "Not verified"; its page says "Address not verified. Edit the
venue to verify it." and the address is a map link.

## V4. The address service is down (US2 scenario 4; FR-012, SC-003)

Point the Backend at an address service that never answers (as `013` quickstart S7):

```bash
ADDRESS_GEOCODER_URL=http://10.255.255.1 docker compose up -d backend
```

Add venue: "Outage Hall", 937 Phillips Ln, Louisville, KY, 40209, Eastern Time, capacity 300. Press
**Create venue** and time it. **Expected**: within 6 seconds, saved, with V3's not-verified notice
for "937 Phillips Ln, Louisville, KY 40209". Then send the same create straight to the API without
the flag, with the Admin app's token (`001` quickstart V6 shows how to copy one):

```bash
curl -s -X POST http://localhost:3000/locations \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"No Flag","street":"937 Phillips Ln","city":"Louisville","state":"KY","zip":"40209","seatingCapacity":10,"timeZone":"America/New_York"}'
```

**Expected**: `503`, `ADDRESS_SERVICE_UNAVAILABLE`, no venue "No Flag". Restore the service
(`docker compose up -d backend`) and keep "Outage Hall" for V5.

## V5. Edit: the zone stays, and a not-verified address is checked again (US1 scenarios 4–6, US2 scenarios 6–7; FR-003, FR-004, FR-016, FR-017, SC-004)

Edit "Outage Hall". **Expected**: Time zone shows Eastern Time, with "Eastern Time, chosen by an
admin." under it; the form says "This address is not verified. Saving checks it again." Press **Save
changes** without changing anything. **Expected**: saved, "Venue saved. Address: 937 PHILLIPS LN,
LOUISVILLE, KY 40209. Time zone: Eastern Time, chosen by an admin."; the "Not verified" mark gone.

Edit "Zone Test Hall" (V1, Central). Change the street to 1540 University Dr and the ZIP code to 40508.
**Expected**: under Time zone, "Changing the address doesn't change the time zone. …". Save.
**Expected**: saved not verified (V6), Time zone still Central Time. Edit a demo venue ("Demo Riverside
Hall", from the address) and change only its name. **Expected**: saved; the list still says "Eastern
Time, from the address" (no `timeZone` in the `PATCH` body).

## V6. A different address found, or several (US2 scenario 3; FR-011, FR-015)

Add venue at 1540 University Dr, Lexington, KY, 40508 (the service matches "1540 UNIVERSITY CT …
40503", `013` FR-021), any zone. **Expected**: saved in one press as typed, not verified, with V3's
notice; the other address is not shown.

## V7. Format problems still block (US2 scenario 8; FR-013)

Add venue with ZIP "4050", then with no state, then with no zone. **Expected**: each named in the form
("Check the address" lists the address problems; the zone message under Time zone), nothing sent.

## V8. Other callers keep today's rules (FR-007, FR-012, SC-005)

With the Admin app's token, `POST /locations` for 1 Arena Plaza, Louisville, KY 40202 without the flag
and without `timeZone`: **Expected**: `400 ADDRESS_NOT_FOUND`. With the flag and no `timeZone`:
**Expected**: `400 TIME_ZONE_REQUIRED` (Kentucky has two zones). For 430 W Vine St, Lexington without
`timeZone`: **Expected**: `201`, `"timeZoneSource": "ADDRESS"`. On an empty database, the demo-data
script (`013` quickstart S9) still makes two verified Eastern venues.

## V9. Keyboard, screen reader, phone width, dark mode (FR-002, FR-020, FR-023, SC-007)

Tab through New venue (Seated, two sections) with the keyboard only. At 360 px wide, every section
line wraps with no sideways scrolling and every label stays by its box. With VoiceOver: the Rows box
of the first line reads "Section 1 Rows"; pressing Create venue with no zone announces "Choose the
venue's time zone."; the not-verified notice is read. Repeat in dark mode.

## V10. Sign in, use, sign out (Constitution VI)

Sign in to each of the three apps, use it, and sign out.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. On the spec branch V1 to V5 are Manual:
their tests come with the implementation PR, which marks them Automated as research R11 lists.

| Scenario | Browser test |
| --- | --- |
| V0 | Manual: set-up for V1–V10 |
| V1 | Manual: to be automated by `024 V1/V2/V3: an admin creates a seated venue in one press, at an address the service does not know, in the zone they pick` in the implementation PR (research R10, R11) |
| V2 | Manual: to be automated by `024 V1/V2/V3: …` in the implementation PR, phone width and a screen reader staying manual (research R11) |
| V3 | Manual: to be automated by `024 V1/V2/V3: …` in the implementation PR (research R10, R11) |
| V4 | Manual: to be automated by `024 V4/V5: with the address service down a venue is saved not verified, and a new address keeps its zone` in the implementation PR, the 6-second bound staying manual (research R11) |
| V5 | Manual: to be automated in part by `024 V4/V5: …` in the implementation PR; the re-check of an unchanged address stays covered by Backend tests (research R10, R11) |
| V6 | Manual: the browser tests' address stand-in answers exact addresses only, so it never finds a different one; Backend tests cover it |
| V7 | Manual: unchanged from `013` and covered by the Admin app's tests; the zone message is in the `024 V1/V2/V3` test once it exists |
| V8 | Manual: an API behavior, covered by Backend tests; every browser test's set-up creates venues through the API without a zone |
| V9 | Manual: keyboard, a screen reader, phone width, and dark mode, checked by a person |
| V10 | Manual: sign in, use, and sign out of each front end, by hand |
