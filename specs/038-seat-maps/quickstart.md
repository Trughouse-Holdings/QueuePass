# Quickstart: Seat Maps

**Feature**: `038-seat-maps` | **Contract**: [contracts/README.md](./contracts/README.md) |
**Data model**: [data-model.md](./data-model.md)

How to see the feature work end to end, and which scenarios the browser tests cover (Constitution
VI, `022`). Each scenario is marked **Automated** (with its test) or **Manual** (with the reason);
the implementation fills in the test names.

## Prerequisites

- The Compose stack: `docker compose up --build` (or path B, `node scripts/run-host.mjs`).
- The demo state with the KFC Yum! Center: `docker compose exec -e QUEUEPASS_ALLOW_RESET=1 backend
  node backend/dist/scripts/demo-reset.js` (path B: `QUEUEPASS_ALLOW_RESET=1 node
  scripts/run-host.mjs --demo-reset`).
- Admin app http://localhost:5173 as `admin1`; Customer app http://localhost:5174 as `customer1`
  and, in a second browser profile, `customer2`; password `test123`.
- Tests: `npm test` (all workspaces, Testcontainers needs Docker running); `npm run e2e` (browser).

## S0. The demo has the Yum! Center (US5)

Run the reset; open Venues → KFC Yum! Center. **Expected**: Layouts: Basketball 22,090 seats · 54 sections · 4 levels; End-stage concert 17,500; Center stage; Wrestling (ring). Basketball is used by 2 events, End-stage concert and Wrestling by 1, all three locked (seats sold); Center stage by none, unlocked. Capacity 22,090, read-only. The four events of research R18 exist with their prices and off-sale seats, about 40 seats sold each and none held. **Covered by**: Backend `demo-data` test; browser `038 S0`.

## S1. The reset is repeatable (US5)

Run the reset again. **Expected**: Same layouts, events, prices and seat states (times relative to now). **Covered by**: Backend `demo-data` test (twice).

## S2. Import a layout file (US1)

On a venue with no layouts, **Import layout file** with `backend/test/fixtures/layouts/small.json` (added by the implementation). **Expected**: Listed with its counts and "used by 0 events"; preview draws each section around the floor object. **Covered by**: Backend `layouts` test; Admin `LayoutsCard` test.

## S3. A layout file with problems (US1)

Import `backend/test/fixtures/layouts/bad.json` (a repeated seat label, a level key not in the file, a 201-seat row, two sections with one name, a point outside the map). **Expected**: Nothing saved; each problem listed with where it is, e.g. "Section 104, row F: seat 7 appears twice". **Covered by**: Backend `layouts` test; Admin `LayoutsCard` test.

## S4. A layout from section lines (US1)

**New layout from section lines**: levels Front, Back; "Floor A, 10 × 20, Front", "Floor B, 10 × 20, Back". **Expected**: 400 seats, 2 levels; rows 1–10, seats 1–20. **Covered by**: Backend `layouts` test.

## S5. A locked layout; Duplicate (US1)

On Basketball (locked), try Rename and Delete; then **Duplicate**. **Expected**: Refused naming the event; "Basketball (copy)" made, unlocked. **Covered by**: Backend `layouts` test; browser `038 S5`.

## S6. Schedule a seated event (US2)

Schedule "Cardinals Women vs. Duke" at the Yum! Center on Basketball; take sections 301–330 and rows D–F of 104 off sale (the Upper price box goes away); price Courtside $95, Lower sideline $60, Lower end $35; save. **Expected**: Line reads seats on sale and off sale as the counts; event price "$35–$95"; capacity = seats on sale. **Covered by**: browser `038 S6`.

## S7. A level without a price (US2)

Save with one on-sale level unpriced. **Expected**: Refused beside that price box, focused; nothing saved. **Covered by**: Admin `SeatingSection` test.

## S8. Sold seats block changes (US2)

On an event with a sold seat in 104, try to take 104 off sale; try to switch layout. **Expected**: Both refused, saying why. **Covered by**: Backend `event-seating` test.

## S9. A price change after a sale (US2)

Change a level's price after a sale. **Expected**: The sold ticket keeps its price; new holds show the new one. **Covered by**: Backend `orders.levels` test.

## S10. The customer's venue map (US3)

As `customer1`, open women's basketball → **Choose seats**. **Expected**: Sections colored by their cheapest open level; the upper level gray; the legend reads Courtside $95, Lower sideline $60, Lower end $35, Upper: not on sale. **Covered by**: browser `038 S10`.

## S11. The price filter (US3)

Set the price filter to $50–$100. **Expected**: The end sections (101–103, 109–112, 118–120, only $35 seats) fade; the sideline sections stay; the overview still shows every section. **Covered by**: Customer `VenueMap` test; browser `038 S10`.

## S12. Zoom into a section (US3)

Click section 115; hover Row F Seat 7. **Expected**: Zoomed; rows D–G in Courtside's color, the rows behind in Lower sideline's; "Sec 115, Row F, Seat 7 · Courtside · $95". **Covered by**: shared `VenueMap` test; browser `038 S10`.

## S13. Hold seats of two levels and buy (US3)

Hold Row F 7 and 8 and Row P 7; Back to map; Add to cart; Buy. **Expected**: One countdown; Your seats lists $95, $95 and $60, total $250; order has 3 tickets at their prices; My tickets shows "Section 115, Row F, Seat 7". **Covered by**: browser `038 S10`.

## S14. Live changes (US3)

`customer2` watches the same section while `customer1` holds and buys. **Expected**: Seats and section color change within 2 s. **Covered by**: Backend `seat-stream` test; browser `038 S14`.

## S15. Phone width (US3)

Phone width (390 × 844): pinch, zoom buttons, tap a section. **Expected**: Zooms and pans; tap zooms into the section. **Covered by**: manual, pinch can't be driven reliably in Playwright's Chromium; zoom buttons and tap are in `038 S10` at phone width.

## S16. Keyboard and screen reader (US4)

Keyboard only: filter, open the Sections list, choose 115, hold Row F Seat 7, release it. **Expected**: Seats are buttons named "Row F, Seat 7, Courtside, $95, open"; the map shows the same. **Covered by**: Customer `SectionsList` test; browser `038 S16`.

## S17. The admin's live map (US6)

As `admin1`, open the women's game while `customer1` holds a seat. **Expected**: Map by state with counts; the seat turns held within 2 s. **Covered by**: Admin `EventSeatMap` test; browser `038 S17`.

## S18. Carry-over of today's data (FR-031, FR-032)

On a database from before 038 with seated events and sold tickets, migrate. **Expected**: Each venue has "Standard"; every ticket keeps seat, label, price, status. **Covered by**: Backend `migration.seat-maps` test.

## S19. One seat, ten requests (SC-001)

10 simultaneous holds of one seat; 10 simultaneous orders. **Expected**: Exactly 1 succeeds each time. **Covered by**: Backend `seats.concurrency` test.

## S20. The gate (FR-026)

In the Booth app, look up a seated ticket. **Expected**: Shows "Section 115, Row F, Seat 7" and "Lower sideline". **Covered by**: Booth `EntryResult` test.

## S21. Exports (FR-030)

Attendee list → CSV/Excel/PDF for the women's game. **Expected**: Price level and price columns per ticket. **Covered by**: Admin `attendee-rows` test.

## Timing checks (SC-002–SC-005)

Run on a laptop against the demo state, by hand, and record the times in the implementation PR:
overview after Choose seats (≤ 2 s), a section after clicking it (≤ 1 s), a seat found and held
inside a price range (< 60 s), an event scheduled with prices and one section and one row range off
sale (< 3 min). The stream's 2-second delivery (SC-004) is the Backend `seat-stream` test.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. Until the implementation adds
`e2e/tests/038-seat-maps.spec.ts`, every row is Manual; the implementation turns the rows its
browser tests walk (S0, S5, S6, S10–S14, S16, S17) into Automated rows with the tests' exact titles
(T055).

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: covered by the Backend `demo-data` test until T052 adds `038 S0` |
| S1 | Manual: two resets compared by the Backend `demo-data` test (twice); a browser adds nothing |
| S2 | Manual: covered by the Backend `layouts` test and the Admin `LayoutsCard` test |
| S3 | Manual: covered by the Backend `layouts` test and the Admin `LayoutsCard` test |
| S4 | Manual: covered by the Backend `layouts` test |
| S5 | Manual: covered by the Backend `layouts` test until T052 adds `038 S5` |
| S6 | Manual: covered by the Backend `event-seating` and Admin `SeatingSection` tests until T052 adds `038 S6` |
| S7 | Manual: covered by the Admin `SeatingSection` test |
| S8 | Manual: covered by the Backend `event-seating` test |
| S9 | Manual: covered by the Backend `orders.levels` test |
| S10 | Manual: covered by the shared `VenueMap` and Customer `venue-map-flow` tests until T052 adds `038 S10` |
| S11 | Manual: covered by the shared `VenueMap` test until T052 adds it to `038 S10` |
| S12 | Manual: covered by the shared `VenueMap` test until T052 adds it to `038 S10` |
| S13 | Manual: covered by the Customer `venue-map-flow` test until T052 adds it to `038 S10` |
| S14 | Manual: covered by the Backend `seat-stream` test until T052 adds `038 S14` |
| S15 | Manual: pinch can't be driven reliably in Playwright's Chromium; the zoom buttons and a tap at phone width go into `038 S10` (T052) |
| S16 | Manual: covered by the shared and Customer `SectionsList` tests until T052 adds `038 S16` |
| S17 | Manual: covered by the Admin `EventSeatMap` test until T052 adds `038 S17` |
| S18 | Manual: a migration from a pre-038 database; the Backend `migration.seat-maps` test |
| S19 | Manual: genuinely concurrent requests; the Backend `seats.concurrency` test |
| S20 | Manual: covered by the Booth app's entry result test |
| S21 | Manual: file downloads; covered by the Admin `attendees-export` test |
