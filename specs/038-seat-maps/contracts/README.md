# Contract Changes: Seat Maps

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature changes it in **two steps** (research R3):

- **Step 1, this spec and plan PR: 1.27.0 → 1.28.0** (MINOR). Additions only: eleven new operations
  marked `x-planned: '038'`, new optional fields in existing schemas, three new error codes, a new
  stream event, and `x-retired: '038'` markers. `packages/shared/src/api-schema.ts` is regenerated
  (`npm run generate:api`) and `node scripts/check-contract-drift.mjs` passes. `ERROR_CODES` in
  `packages/shared/src/errors.ts` gains the three codes, so the contract test of the list passes.
- **Step 2, the implementation PR: 1.28.0 → 2.0.0** (MAJOR). Exactly the removals and the one type
  change listed under "Step 2" below, approved here, made in the change that stops serving them.

**Why `main` stays green after step 1**: no response changes type or loses a field; new response
fields are optional ("sent once 038 is implemented", as `014` and `016` did); new request fields
are optional, and `main`'s Backend refuses them as unknown (`400`, `forbidNonWhitelisted`) until
the implementation, which no client sends before then; new operations are `x-planned`, so the
route-coverage test expects `404`; retired operations are still served exactly as described. The
apps compile unchanged against the regenerated types (every new field is optional).

**Version order**: on top of `main` at `5ba87a5` (1.27.0). PR #164 (`037`, open) changes no
contract.

## Step 1 (this PR, 1.28.0)

### New operations (`x-planned: '038'`)

| Operation | Method, path | Roles | Request → response | Errors |
| --- | --- | --- | --- | --- |
| `listVenueLayouts` | `GET /locations/{id}/layouts` | any signed-in | → `LayoutSummary[]` | 400, 401, 404 |
| `createVenueLayout` | `POST /locations/{id}/layouts` | `queuepass-admin` | `LayoutLinesInput` → 201 `LayoutDetail` | 400, 401, 403, 404, 409 `LAYOUT_NAME_TAKEN` / `CAPACITY_EXCEEDED` |
| `importVenueLayout` | `POST /locations/{id}/layouts/import` | `queuepass-admin` | `LayoutImport` (≤ 4 MB) → 201 `LayoutDetail` | 400 `LAYOUT_FILE_INVALID` / `VALIDATION_FAILED`, 401, 403, 404, 409 |
| `getVenueLayout` | `GET /layouts/{layoutId}` | any signed-in | → `LayoutDetail` | 400, 401, 404 |
| `updateVenueLayout` | `PUT /layouts/{layoutId}` | `queuepass-admin` | `LayoutUpdate` → `LayoutDetail` | 400, 401, 403, 404, 409 `LAYOUT_IN_USE` / `LAYOUT_NAME_TAKEN` / `CAPACITY_EXCEEDED` |
| `deleteVenueLayout` | `DELETE /layouts/{layoutId}` | `queuepass-admin` | → 204 | 400, 401, 403, 404, 409 `LAYOUT_IN_USE` |
| `getVenueLayoutSection` | `GET /layouts/{layoutId}/sections/{sectionId}` | any signed-in | → `LayoutSectionSeats` | 400, 401, 404 |
| `duplicateVenueLayout` | `POST /layouts/{layoutId}/duplicate` | `queuepass-admin` | `LayoutDuplicate` (optional) → 201 `LayoutDetail` | 400, 401, 403, 404, 409 `LAYOUT_NAME_TAKEN` / `CAPACITY_EXCEEDED` |
| `getEventSeating` | `GET /events/{id}/seating` | `queuepass-admin` | → `EventSeating` | 400, 401, 403, 404 |
| `getVenueMap` | `GET /events/{id}/venue-map` | any signed-in | → `VenueMap` | 400, 401, 404 (also for general admission) |
| `getVenueMapSection` | `GET /events/{id}/venue-map/sections/{sectionId}` | any signed-in | → `VenueMapSection` | 400, 401, 404 |

### New schemas

`LevelColor` (12 names), `FloorKind`, `MapPoint` (`[x, y]`), `MapOutline` (3–64 points), `MapSize`,
`PriceLevel`, `LayoutSummary`, `LayoutDetail`, `LayoutSectionSummary`, `LatestPrices`,
`LayoutSectionSeats`, `LayoutSeat`, `LayoutLinesInput`, `LayoutLevelLine`, `LayoutSectionLine`,
`LayoutUpdate`, `LayoutDuplicate`, `LayoutImport`, `LayoutFile` (format 1), `LayoutFileSection`,
`LayoutFileSeat`, `LayoutFileSeatRun`, `LevelPriceInput`, `OffSaleSelector`, `EventSeating`,
`VenueMap`, `LevelSeatCounts`, `VenueMapSection`, `SeatState`, `LevelSales`; response
`LayoutFileRejected`.

### Changed

| Where | Change |
| --- | --- |
| `info.version` | 1.27.0 → 1.28.0 |
| `info.description` | New paragraphs **Retired operations** (what `x-retired` means; what 038 retires; its implementation is 2.0.0) and **Seat maps** (layouts, levels, a seat's level, event seating, seats named by numbers with labels added, map units). |
| tag `seating` | Mentions feature 038. |
| `streamSeatMap` | New SSE event `venueMap` (`VenueMap`, `x-planned`); `snapshot` marked `x-retired`; paragraph **Feature 038**: `venueMap` first, `levelId` and `from` on changes, `offSale` changes, the stream ends when the event's seating or layout is saved. |
| `reserveSeats` | Paragraph **Feature 038**: any seats of the layout, any levels, at most 10; `SEAT_OFF_SALE`; `tierId` always `null`; seats say labels, level, price. |
| `createOrder` | Paragraph **Feature 038**: no `tierId` for a seated event; each ticket at its level's price when placed; `totalPrice` the sum; `unitPrice` `null` from 2.0.0 when prices differ; `SEAT_OFF_SALE`. |
| `createTicketTier` | Paragraph **Feature 038**: refused (`400`) on a seated event. |
| `Event` | Optional `layoutId` (UUID or `null`) and `priceMax` (decimal string or `null`); `reservedSeating` is `true` exactly when `layoutId` is set. |
| `EventInput`, `EventUpdate` | Optional `layoutId`, `levelPrices` (`LevelPriceInput[]`, ≤ 50), `offSale` (`OffSaleSelector[]`, ≤ 5,000) with their rules; `reservedSeating` marked `x-retired`. |
| `EventTierInput.sectionIds` | Marked `x-retired`. |
| `Ticket` | Optional `price`, `levelName`. |
| `Order.unitPrice` | Description: `null` from 2.0.0 when prices differ (type unchanged in 1.28.0). |
| `SeatChoice` | Description: `row` and `seat` are numbers, not labels. |
| `SeatLabel` | Optional `rowLabel`, `seatLabel`; description. |
| `ReservedSeat` | Optional `rowLabel`, `seatLabel`, `levelName`, `price`. |
| `SeatStateChange` | `state` is now `SeatState` (adds `offSale`); optional `from` (`SeatState`) and `levelId`. |
| `EntryTicket` | Optional `levelName`. |
| `EventSales` | Optional `levels` (`LevelSales[]`). |
| `ErrorEnvelope.error.code` | Adds `LAYOUT_NAME_TAKEN`, `LAYOUT_FILE_INVALID`, `SEAT_OFF_SALE`. |
| `responses.Conflict` examples | New `layoutNameTaken`, `layoutLocked` (`LAYOUT_IN_USE`), `seatOffSale`. |
| `getLayout`, `replaceLayout`, `deleteLayout`, `getSeatMap`, `updateSeating` | `x-retired: '038'` and a first paragraph naming what replaces each. |
| `SeatingLayout`, `LayoutInput`, `SeatMap`, `SeatingInput` | `x-retired: '038'`. |

Unchanged: every other operation, path, role, status code and schema, including `SeatChoice`'s
shape, `Reservation`, `ReservationInput`, `ReservationRelease`, `listMyReservations`,
`releaseAllMyReservations`, `getEventAvailability` and the sales report's other fields.

## Step 2 (the implementation PR, 2.0.0), approved here

Made in the implementation's change that stops serving them; nothing else changes the contract
there except removing each `x-planned: '038'` marker in the change that serves its route.

1. `info.version` 1.28.0 → **2.0.0**; the **Retired operations** paragraph keeps its general rule
   and drops the 038 sentence; the **Seat maps** paragraph drops "New fields … are not listed as
   required, so this contract merges ahead …".
2. Remove the operations `getLayout`, `replaceLayout`, `deleteLayout` (the path
   `/locations/{id}/layout`), `getSeatMap` (the path `/events/{id}/seats`) and `updateSeating`
   (`PUT /events/{id}/seating`; its `GET` stays).
3. Remove `streamSeatMap`'s `snapshot` event and the sentences about it; `venueMap` is the first
   event.
4. Remove the schemas `Section`, `SectionInput`, `LayoutInput`, `SeatingLayout`, `SeatPosition`,
   `SeatMapSection`, `SeatMap`, `SeatingInput`.
5. Remove `EventInput.reservedSeating`, `EventUpdate.reservedSeating` and `EventTierInput.sectionIds`,
   and the sentences of `createEvent`, `updateEvent`, `EventTierInput`, `createTicketTier` and
   `reserveSeats` that describe section-to-tier mappings or a reservation's tier (feature 007's
   and 031's and 035's seating paragraphs say "retired by 038" in one line instead).
6. `Order.unitPrice` becomes `type: [string, 'null']`.
7. `Event.layoutId`, `Event.priceMax`, `Ticket.price`, `Ticket.levelName`, `SeatLabel.rowLabel`,
   `SeatLabel.seatLabel`, `ReservedSeat.rowLabel`/`seatLabel`/`levelName`/`price`,
   `SeatStateChange.from`/`levelId`, `EntryTicket.levelName` and `EventSales.levels` become
   **required**, and their "Sent once 038 is implemented" sentences go.
8. Regenerate `api-schema.ts`; `check-contract-drift` passes.

## Examples

```http
POST /locations/{id}/layouts
{ "name": "Club room",
  "levels": [ { "name": "Front", "color": "violet" }, { "name": "Back", "color": "teal" } ],
  "sections": [ { "name": "Floor A", "rows": 10, "seatsPerRow": 20, "level": "Front" },
                { "name": "Floor B", "rows": 10, "seatsPerRow": 20, "level": "Back" } ] }
→ 201 { "id": "…", "name": "Club room", "source": "LINES", "floorKind": "NONE", "seatCount": 400,
        "sectionCount": 2, "levelCount": 2, "eventsUsing": 0, "locked": false, … }
```

```http
PATCH /events/{id}   (updateEvent: the event's seating)
{ "layoutId": "…basketball…",
  "levelPrices": [ { "levelId": "…courtside…", "price": "95" }, { "levelId": "…sideline…", "price": "60" },
                   { "levelId": "…corner…", "price": "35" } ],
  "offSale": [ { "sectionId": "…301…" }, …, { "sectionId": "…104…", "row": 1 }, { "sectionId": "…104…", "row": 2 } ] }
→ 200 Event { "reservedSeating": true, "layoutId": "…", "totalTicketCapacity": 11212, "basePrice": "35.00", "priceMax": "95.00", … }
```

```text
GET /events/{id}/seats/stream
event: venueMap
data: {"eventId":"…","layoutId":"…","layoutName":"Basketball","size":{"width":1000,"height":640},…}

event: seats
data: {"eventId":"…","changes":[{"sectionId":"…","row":3,"seat":7,"state":"reserved","from":"open","levelId":"…"}]}
```
