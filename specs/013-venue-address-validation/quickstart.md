# Quickstart: Validating Venue Addresses and Map Links

**Superseded in part by `024`** ([spec](../024-venue-form-simplify/spec.md#superseded-requirements),
#107): the Admin app has no Save anyway button; an address is saved in one press, not verified when
the service can't confirm it, also when the service is down (S1b, S2, S2b, S4, S5, S7). `024`'s
quickstart walks the new behavior. The text below is this feature's walk as built.

The running-system gate for `013`. Run after the implementation with every service healthy and
the laptop online (S1–S6 use the real US Census Geocoder):

```bash
docker compose up --build -d
npm test                      # full suite; no test uses the network
```

Use a normal window for the Admin app (http://localhost:5173, `admin1` / `test123`) and a private
window for the Customer app (http://localhost:5174, `customer1` / `test123`).

Addresses below were checked against the live service on 2026-10-11 (research R1).

## S1: A real address is saved in standard form (US1)

As `admin1`, open **Venues → New venue**. Name "Rupp Arena", street "430 W Vine St", city
"Lexington", state "Kentucky (KY)", ZIP "40507", capacity 20500. Save. **Expect**: the venue list
shows "Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507." and the new row has that
address.

### S1b: One match somewhere else is not saved (US1 scenario 10, FR-021)

New venue: name "Kroger Field", street "1540 University Dr", city "Lexington", state KY, ZIP
"40508", capacity 61000. Save. **Expect**: refused with "We found a different US address for
1540 University Dr, Lexington, KY 40508. Did you mean this one?…", the candidate "1540
UNIVERSITY CT, LEXINGTON, KY 40503" listed, every field kept, and **Save anyway** offered; no new
venue. Leave the form without saving (or choose Save anyway: the venue is saved as typed, "Not
verified").

## S2: An address that does not exist is refused (US1)

New venue: street "1 Nowhere Blvd", city "Louisville", state KY, ZIP "40202". Save. **Expect**:
"We couldn't find 1 Nowhere Blvd, Louisville, KY 40202 as a US address…", every field still filled
in, a **Save anyway (address not verified)** button, and no new venue in the list. Leave the
form without saving.

### S2b: Save anyway for a real venue the service misses (US1, FR-019)

New venue: name "KFC Yum! Center", street "1 Arena Plaza", city "Louisville", state KY, ZIP
"40202", capacity 22090. Save. **Expect**: refused as not found (the service does not know this
real address), with **Save anyway**. Change the ZIP to "40203". **Expect**: the Save anyway
button disappears until the next refusal. Put "40202" back, save, then choose **Save anyway**.
**Expect**: "Venue saved. Address (not verified): 1 Arena Plaza, Louisville, KY 40202."; the list
shows the address as typed with "Not verified"; the venue page says "Address not verified. Edit
the venue to verify it."; the address is still a map link. Edit its name only. **Expect**: saved,
still not verified.

## S3: Field checks before sending (US1, FR-013)

New venue with the ZIP "4050" and then with no state. **Expect**: each is refused in the form,
naming the field, and nothing is sent (the browser's network panel shows no `POST /locations`).

## S4: Edits (US1, FR-008)

Edit Rupp Arena: change only the name to "Rupp Arena at Central Bank Center" and save.
**Expect**: saved. Edit it again and change the street to "1 Nowhere Blvd". **Expect**: refused as
in S2, the name and other values kept, and the venue page still shows the old address.

## S5: Seated venue in one step (US1, `008`)

New venue, **Seated**, with one section of 2 rows × 10 seats, and the address from S2. **Expect**:
refused; no venue and no layout saved. Fix the address to "937 Phillips Ln", "Louisville", KY,
"40209" and save. **Expect**: the venue and its 20-seat layout are saved.

## S6: Map links in both apps (US3)

In the Admin app's venue list and on Rupp Arena's page, select the address. **Expect**: a new tab
opens Google Maps searching for "430 W VINE ST, LEXINGTON, KY 40507", and the QueuePass tab stays
open. As `customer1`, do the same on **Venues** and the venue page. **Expect**: the same. Check one
link's HTML: `target="_blank"` and `rel="noopener noreferrer"`.

## S7: The address service is down (US2)

Point the Backend at an address that never answers, and restart it:

```bash
ADDRESS_GEOCODER_URL=http://10.255.255.1 docker compose up -d backend
```

As `admin1`, create a venue with the S1 address. Time it. **Expect**: within 6 seconds, "We can't
verify the address right now. Nothing was saved. Try again in a minute.", every value kept, no new
venue (SC-003), and **no** Save anyway button. Then send the save-anyway request straight to the
API with the Admin app's token (see quickstart V6 of `001` for copying a token):

```bash
curl -s -X POST http://localhost:3000/locations \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Test","street":"1 Arena Plaza","city":"Louisville","state":"KY","zip":"40202","seatingCapacity":10,"acceptUnverifiedAddress":true}'
```

**Expect**: `503` with `code: ADDRESS_SERVICE_UNAVAILABLE`, and no new venue. Edit an existing
venue's name only. **Expect**: saved (SC-006). As `customer1`, **Expect**: venues and their map
links still show.

Repeat with `ADDRESS_GEOCODER_URL=http://geocoder.invalid` (no such host). **Expect**: the same
message, at once. Also try with the laptop's network turned off and the default URL.

Restore the default:

```bash
docker compose up -d backend
```

## S8: Existing venues keep working (US4)

Before upgrading, on a database from `main` without `013`, create a venue with the address "1 Demo
Plaza, Louisville, KY" and an event there. Upgrade and start the stack. **Expect**: the venue and
event show as before; searching venues for "demo plaza" finds it; its page says "Address not
verified. Edit the venue to verify it."; its address is a map link. Edit only its name. **Expect**:
saved, still not verified. Edit it and fill in "937 Phillips Ln", "Louisville", KY, "40209".
**Expect**: saved as "937 PHILLIPS LN, LOUISVILLE, KY 40209", and the mark is gone. Likewise,
edit the KFC Yum! Center from S2b to "937 Phillips Ln", "Louisville", KY, "40209". **Expect**:
saved in standard form and verified (FR-019, US1 scenario 5).

## S9: Demo data

On an empty database, `docker compose exec backend node backend/dist/scripts/demo-data.js`.
**Expect**: both demo venues have verified addresses (research R14).

Then reset the database (`docker compose down -v && docker compose up --build -d`), point the
Backend at `http://10.255.255.1` as in S7, and run the script again. **Expect**: it finishes,
prints that the demo venues are not verified, and the Admin app shows both marked "Address not
verified". Restore the default URL afterwards.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| S1 | Manual: the real address service's standard form; the `003 C1` browser test saves a venue through the stand-in |
| S1b | Manual: needs the real address service's answers |
| S2 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S2b | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S3 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S4 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S5 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S6 | Manual: opens an outside map site |
| S7 | Manual: needs the Backend restarted with an address service that never answers |
| S8 | Manual: needs a database from before `013` |
| S9 | Manual: an empty database; every `npm run e2e` loads the demo data |
