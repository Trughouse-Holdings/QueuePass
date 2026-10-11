# Quickstart: Validating Venue Addresses and Map Links

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

## S2: An address that does not exist is refused (US1)

New venue: street "1 Nowhere Blvd", city "Louisville", state KY, ZIP "40202". Save. **Expect**:
"We couldn't find 1 Nowhere Blvd, Louisville, KY 40202 as a US address…", every field still filled
in, and no new venue in the list.

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
venue (SC-003). Edit an existing venue's name only. **Expect**: saved (SC-006). As `customer1`,
**Expect**: venues and their map links still show.

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
**Expect**: saved as "937 PHILLIPS LN, LOUISVILLE, KY 40209", and the mark is gone.

## S9: Demo data

On an empty database, `docker compose exec backend node backend/dist/scripts/demo-data.js`.
**Expect**: both demo venues have verified addresses (research R14).
