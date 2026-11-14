# Research: Seat Maps

**Feature**: `038-seat-maps` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-13 |
**Issue**: [#165](https://github.com/Trughouse-Holdings/QueuePass/issues/165)

John approved the seat-maps feature on 2026-11-13. The spec's Clarifications give D1–D6 their
recommended answers. An independent review (2026-11-13, round 1) found five blocking and
twenty-two other problems; the decisions below are as revised for it. Every decision below that the spec leaves open also takes a recommended
option and records the alternatives, for Mahdi and the team to overturn in review of the spec PR.
Paths are `main` at `5ba87a5`.

## What exists

- **Schema** (`backend/prisma/schema.prisma`): `Section` (venue, name, `rows`, `seatsPerRow`,
  `position`; names unique per venue ignoring case, `section_name_unique_per_venue`);
  `SectionTier` (event × section → tier); `Event.reservedSeating`; `Ticket.seatSection`,
  `seatRow` (Int), `seatNumber` (Int), with one valid ticket per label
  (`ticket_one_valid_per_seat`, partial unique); `SeatReservation` (one tier or none, 5 minutes,
  one active per customer per event); `SeatHold` (by label; one live hold per label,
  `seat_hold_one_live_per_seat`).
- **Backend seating** (`backend/src/seating/`): `LayoutService` (`get`, `replace`, `remove`; locks
  the venue then its scheduled events, `common/venue-lock.ts`); `SeatMapService` (`forEvent`, the
  `SeatMap`: each section's size, tier, taken and reserved seats; `update`, reserved seating and
  the section → tier mapping); `seat-rules.ts` (`resolveSeats`: a choice `{sectionId, row, seat}`
  becomes a label, checked against the layout and the tier); `tier-seats.ts` (a seated tier's
  quantity is its sections' seats); `SeatEventsService` (an in-process RxJS bus per event) and
  `seat-stream.controller.ts` (`streamSeatMap`: `snapshot`, then `seats` changes, then `ping`).
- **Reservations and orders** (`backend/src/reservations/`, `backend/src/orders/`): hold, release,
  the 2-minute wait, the sweep; `createOrder` buys held seats only (`RESERVATION_REQUIRED`), one
  tier per order, one `unitPrice`.
- **Event saves** (`backend/src/events/event-setup.ts`, `031`/`035`): `createEvent` and
  `updateEvent` take `reservedSeating` and `tiers` (with `sectionIds` on seated events) and save
  them all or nothing.
- **Shared** (`packages/shared/src/seating.ts`, `web/seat-stream.ts`, `web/use-seat-stream.ts`): the
  seating types, `RESERVATION_LIMITS`, `SEATING_LIMITS` (50 sections, 100 rows, 200 seats per row),
  and the live map hook (first `getSeatMap`, then the stream).
- **Admin app**: `LayoutCard.tsx` and `SectionLines.tsx` (a venue's layout as "Name, Rows × Seats
  per row" lines), `SeatingCard.tsx` and `SeatGrid.tsx` (the event's map and tier mapping),
  `EventForm.tsx` (the Seating section, `035`), `pages/Attendees.tsx` and `export/attendee-rows.ts`
  (`tierName`, `unitPrice`).
- **Customer app**: `GetTickets.tsx` (tier, then section, then `SeatPicker.tsx`, a grid of seat
  buttons; holds per click, `033`), `pages/Cart.tsx`, `OrderConfirmation.tsx`, `MyTickets.tsx`.
- **Booth app**: `EntryResult.tsx` shows `tierName ?? 'General admission'` and the seat.
- **Demo data** (`backend/src/scripts/demo-data.ts`, `demo-reset.ts`, `029`): two demo venues and
  their events through the real services; the reset empties every table and runs it.
- **Contract**: 1.27.0. `getLayout`, `replaceLayout`, `deleteLayout`
  (`/locations/{id}/layout`), `getSeatMap`, `updateSeating` (`/events/{id}/seats`,
  `/events/{id}/seating`), `streamSeatMap`, `reserveSeats`, `releaseSeats`, `createOrder`. The
  route-coverage test (`backend/test/contract/route-coverage.e2e-spec.ts`) fails if an operation
  marked `x-planned` is served or an unmarked one is not (`015` R12).

## R1. Layouts are tables of sections, rows and seats; a seat's level is resolved, not copied

**Decision**: new tables `Layout`, `PriceLevel`, `SeatRow`, `Seat`; `Section` moves from the venue
to a layout (data-model.md). Every seat is a row of `Seat` with a UUID, its row, its number in the
row (1, 2, 3… in drawing order), its label, its place `(x, y)` and an optional level of its own.
`SeatRow` has its section, its number in the section (1 = front), its label and an optional level;
`Section` has a required level. A seat's level is `COALESCE(seat.levelId, row.levelId,
section.levelId)` (FR-003), computed in the queries that need it, never stored twice.

**Why**: the database can then guarantee "one valid ticket and one live hold per seat" on the seat
itself (FR-025, Constitution IV), off-sale seats can be rows keyed by the seat, and a 22,090-seat
layout is 22,090 small rows, which PostgreSQL counts and groups by level in milliseconds. Keeping
only the overrides follows FR-003's rule exactly, and `039`'s painting will set and clear them
without a second copy to keep in step.

**Alternatives**:

- **Seats as a JSON document on the layout**: no foreign key or unique index can point into it, so
  "one ticket per seat" would be the application's alone. Rejected.
- **Rows as runs (first seat, count, spacing) with no seat rows**: smaller, but a ticket and a hold
  would again point at a label, and seat-by-seat levels and off-sale seats need seat rows anyway.
  Rejected (the file format keeps runs, R5).
- **Each seat's resolved level stored**: faster to read, but a section's or row's level change must
  rewrite its seats and the two can drift. Rejected; the `COALESCE` costs nothing measurable.

## R2. In the API a seat stays `{sectionId, row, seat}`; labels are added beside the numbers

**Decision**: the API keeps naming a seat as today's `SeatChoice`: the section's id, the row's
**number** and the seat's **number** in its row. Every response that shows a seat adds its
**labels** (`rowLabel`, `seatLabel`), and the section's name stays `section`. The Backend turns a
choice into a `Seat` id inside the transaction. `Seat` ids never appear in the API.

**Why**: holds, releases, orders, the cart, the live stream and every client test already speak in
`{sectionId, row, seat}` (`015`, `033`). With rows numbered front to back and seats numbered in
drawing order, the triple still names exactly one seat of a layout, so all of them keep working and
the contract change is additive (R3). Labels such as "AA" or "101" are what people read, so they
are added wherever a seat is shown.

**Alternatives**:

- **Seat ids in the API**: one field instead of three, but every seat-taking request, response and
  stream message changes shape at once, a breaking change to six operations and the stream for no
  gain to the customer. Rejected.
- **Labels in the API** (`{sectionId, rowLabel, seatLabel}`): breaking in the same way, and labels
  are only unique within their row, so no shorter. Rejected.

## R3. The contract moves in two steps: additions now (1.28.0), removals in the implementation (2.0.0)

**Decision**:

- **This PR, 1.28.0 (MINOR)**: every new operation is added and marked `x-planned: '038'` (`015`
  R12); every new field in an existing response is optional, described as "present once `038` is
  implemented" (as `016` and `014` did for `maxTicketsPerCustomer` and `images`); new request
  fields are optional; the new error codes are added (and to `ERROR_CODES`); the new SSE event
  `venueMap` is added beside `snapshot`. The five operations and the fields `038` replaces are
  marked **`x-retired: '038'`** and keep their description, so `main` keeps serving and testing
  them until the implementation.
- **The implementation PR, 2.0.0 (MAJOR)**: applies **`contracts/step2.diff`**, committed in this
  PR, unchanged (`git apply`): it removes exactly what this PR marks `x-retired: '038'`, makes
  `Order.unitPrice` nullable, makes the new fields required, and rewrites the descriptions that
  described the mapping. It is applied in Phase 2 of the tasks, together with the migration and the
  removal of the retired Backend code, and before any `x-planned` marker is removed, so its context
  matches. The implementation removes each `x-planned` marker in the change that serves its route.
- **Constitution 3.10.0** (this PR) adds the rule this needs to Principle I and gate 2: a breaking
  removal may be approved in the spec PR, marked `x-retired`, committed as the exact patch, and
  applied unchanged by the implementation (review B1).

**Why**: Constitution I wants every contract change reviewed before code merges, and Principle III
wants `main` green and demo-ready after every merge. A breaking change merged ahead of its code
would make `main`'s Backend fail its own contract tests (`expect-to-match-contract.ts` validates
every response with Ajv, strictly). Splitting additions from removals keeps the contract true at
every commit on `main`. The removals are reviewed and approved here as the exact patch; the
implementation PR only applies it. FR-034 asks the version to say which change breaks: 2.0.0 does.

**Alternatives**:

- **Everything in this PR**: `main` red until the implementation merges. Rejected.
- **Everything in the implementation PR**: the contract would not be reviewed first. Rejected.
- **Keep the old operations served for good**: `getSeatMap`'s `rows × seatsPerRow` and
  `updateSeating`'s section → ticket type mapping cannot describe the new layouts. Rejected.
- **Removals in the next spec PR (`039`)**: `main` would document operations it no longer serves
  between the two merges, and the route-coverage test would fail. Rejected.

## R4. New operations

**Decision** (all `x-planned: '038'`; contracts/README.md has each shape):

| Operation | Method and path | Roles |
| --- | --- | --- |
| `listVenueLayouts` | `GET /locations/{id}/layouts` | any signed-in |
| `createVenueLayout` | `POST /locations/{id}/layouts` (section lines) | `queuepass-admin` |
| `importVenueLayout` | `POST /locations/{id}/layouts/import` (a layout file) | `queuepass-admin` |
| `getVenueLayout` | `GET /layouts/{layoutId}` (sections, levels; no seats) | any signed-in |
| `getVenueLayoutSection` | `GET /layouts/{layoutId}/sections/{sectionId}` (rows and seats) | any signed-in |
| `updateVenueLayout` | `PUT /layouts/{layoutId}` (rename; section lines) | `queuepass-admin` |
| `duplicateVenueLayout` | `POST /layouts/{layoutId}/duplicate` | `queuepass-admin` |
| `deleteVenueLayout` | `DELETE /layouts/{layoutId}` | `queuepass-admin` |
| `getEventSeating` | `GET /events/{id}/seating` (layout, prices, off sale) | `queuepass-admin` |
| `getVenueMap` | `GET /events/{id}/venue-map` (overview, prices, counts) | any signed-in |
| `getVenueMapSection` | `GET /events/{id}/venue-map/sections/{sectionId}` (seats with states) | any signed-in |

`createEvent` and `updateEvent` gain optional `layoutId`, `levelPrices` and `offSale` (R8). Retired
(`x-retired: '038'`): `getLayout`, `replaceLayout`, `deleteLayout`, `getSeatMap`, `updateSeating`,
`EventInput.reservedSeating`, `EventTierInput.sectionIds`, `streamSeatMap`'s `snapshot` event, and
the schemas only they use.

**Why**: the overview and a section are separate reads (FR-029): the overview of 54 sections with
outlines and counts is a few kilobytes, a section's 300–900 seats about 50 kB, and a whole
22,090-seat layout with places would be over 1 MB to read before drawing anything. Layout reads are
open to any signed-in user (FR-008) because the map is public; `getEventSeating` is the admin's
editing view (off-sale seats as the admin chose them).

**Alternatives**: one `getVenueMap` with every seat (slow to load, SC-003); layouts as
sub-resources of the venue only (`/locations/{id}/layouts/{layoutId}`; longer paths for no
check the Backend doesn't make anyway). Rejected.

## R5. The layout file: JSON, format 1, seats listed or as runs

**Decision**: a layout file is one JSON document (`LayoutFile` in the contract, `format: 1`):

```json
{
  "format": 1,
  "name": "Basketball",
  "floor": { "kind": "COURT", "outline": [[350,230],[650,230],[650,410],[350,410]] },
  "size": { "width": 1000, "height": 640 },
  "levels": [
    { "key": "courtside", "name": "Courtside", "rank": 1, "color": "violet" },
    { "key": "upper", "name": "Upper", "rank": 4, "color": "teal" }
  ],
  "sections": [
    {
      "name": "104",
      "level": "lower-corner",
      "outline": [[200,120],[300,120],[300,200],[200,200]],
      "rows": [
        { "label": "D", "level": "courtside", "seats": { "first": 1, "count": 18, "from": [205,195], "to": [295,195] } },
        { "label": "E", "seats": [ { "label": "1", "at": [205,190] }, { "label": "2", "at": [210,190], "accessible": true } ] }
      ]
    }
  ]
}
```

- **Places** are map units in `size` (1 to 5,000 each way; about 1 foot, so a seat is 2 units
  apart); `y` grows downward, as in SVG.
- **Rows** are listed front first; their order gives their numbers. A row's `seats` is either a
  list (each with `label`, `at`, optional `level` and `accessible`) or a **run**: `first` (a whole
  number), `count`, `from`, `to`, and optional `bend` (a point the run curves through), labelled
  `first`, `first + 1`, … and spaced evenly; seats are numbered in the order listed.
- **Levels** are named by a `key` inside the file; `rank` 1 is most desirable; `color` is one of the
  12 level colors of the shared theme (R13).
- **Ranks** are unique within the file (a repeated rank is a problem, not a database error).
- **Limits** (FR-001–FR-003): 1–100 sections, 1–100 rows a section, 1–200 seats a row, 1–30,000
  seats, 1–12 levels; names and labels as FR-002; every outline 3–64 points inside `size`.
- **Problems**: a refused import is `400 LAYOUT_FILE_INVALID` with `details.problems`, up to 50
  entries of `{ path, message }`, such as `{ "path": "sections[12].rows[2].seats[6]", "message":
  "Section 104, row F: seat 7 appears twice" }`; nothing is saved (FR-004).
- **Size**: the import route alone accepts a JSON body up to 4 MB (Nest's default is 100 kB); a
  22,090-seat file written as runs is about 120 kB, written seat by seat about 1.3 MB.
- `name` in the request wins over the file's `name`, so one file can be imported twice under two
  names.

**Why**: JSON is what the Backend and both apps already read; runs keep a real arena's file small
enough to review in a PR; listed seats keep any odd row possible (and are what `039`'s editor will
write). Map units with `y` down are SVG's, so the apps draw them as they are.

**Alternatives**: CSV of seats (no outlines or levels in one file; rejected); the format of a
ticket seller's map (undocumented, and their terms forbid taking it, D6; rejected); SVG files
(drawings, not data: no rows, labels or levels without our own conventions; rejected).

## R6. Section-line layouts: a grid as `007` made it; editing keeps what it can

**Decision**: `createVenueLayout` takes a name, 1–12 levels (`name`, `color`; rank by order) and
1–100 section lines (`name`, `rows`, `seatsPerRow`, `level` by name). It places sections in a grid
of `ceil(√n)` columns, in line order, left to right then down, every cell as large as the largest
section (`seatsPerRow × 2 + 4` units wide, `rows × 2 + 4` high) with 8 units between cells; seats
2 units apart, 3 units in from the section's edge, row 1 at the top; rows labelled 1, 2, 3… and seats
1, 2, 3…, `floor.kind: NONE` (FR-005). The carry-over migration places seats the same way (R16), and
both are tested seat by seat (T004, T003). `updateVenueLayout` with lines replaces them, **keeping** the id of every level, section,
row and seat whose name or label is unchanged, so an event's prices and off-sale seats on a layout
nobody has bought from survive an edit; levels, sections, rows and seats that are gone are deleted
with their prices and off-sale entries. For every scheduled event using the layout, **new** seats
go off sale for that event and its capacity, `basePrice` and `priceMax` are recomputed; the edit is
refused (`409 LAYOUT_IN_USE`, naming each event and why) when an event would then have on-sale seats
in a level it has no price for (a section moved to a new level), no seat on sale, or a
`maxTicketsPerCustomer` above its seats on sale (FR-006, review S4). Only a layout made from lines
(`source: LINES`) takes lines; an imported one can only be renamed (its geometry comes from its
file; `039` edits it). A carried-over layout with more than 12 levels may keep as many as it has
(review S8).

**Why**: FR-005 keeps today's quick way to make a small room's layout. Keeping ids by label makes an
edit before any sale harmless to events already set up on it.

**Alternatives**: replace everything with new ids (simpler, but silently drops every using event's
prices and off-sale seats; rejected); allow lines on imported layouts (would flatten a real arena
into a grid; rejected).

## R7. When a layout is locked, and the lock order

**Decision**: a layout is **locked** while any scheduled event using it has a valid ticket or a
live hold (FR-006): rename, line edits and delete are refused with `409 LAYOUT_IN_USE`,
`details.events`. Delete is also refused while **any** event uses it, past or cancelled included
(their tickets keep their seats; review B5): `Event.layoutId` is `RESTRICT`, so the database
agrees. Duplicate is always allowed and makes an unlocked copy named "<name> (copy)" (then
"(copy 2)", …), with new ids throughout.

**Lock order: the venue first, always** (review S11). A layout write locks the **venue** row `FOR
UPDATE`, then the **layout** row, then every scheduled event using it, in id order (as
`common/venue-lock.ts` does today). An event save locks the venue `FOR SHARE` first
(`lockVenueShared`, as `events.service.ts` does today), then the event, then reads the layout,
whose foreign key takes a `KEY SHARE` lock on it; that is safe only because the venue lock comes
first. Holds, orders and the sweep lock only the event and never a layout or venue. Foreign keys
back the rules: `Event.layoutId` is `RESTRICT`; a seat a valid ticket or a live hold points at cannot
be deleted (R10); the level foreign keys are set so that deleting a layout cascades through its levels, sections,
rows and seats in one statement (review M6; corrected after T009 found `NO ACTION` is checked before
the cascade reaches rows and seats): `SeatRow.levelId` and `Seat.levelId` are `ON DELETE SET NULL` (an
own level that is deleted falls back, FR-003), and `Section.levelId` is `NO ACTION DEFERRABLE
INITIALLY DEFERRED`, checked at commit (a section always keeps a level; a lines edit that removes a
level still used by a section is refused by the Backend first).

The venue's `seatingCapacity` is its largest layout's seat count, set by every layout write; a
layout write that would lower it below a scheduled general-admission event's `totalTicketCapacity`
at the venue is refused (`409 CAPACITY_EXCEEDED`, as `replaceLayout` does today, FR-009), deletes
included (review M7). Deleting the last layout keeps the last capacity, typed again from then on.

**Why**: "a sold seat can never move, vanish, or change level" (D3) needs every write that could
move one to see the sales; locking venue → layout → events keeps the one lock order the Backend
already uses, so no deadlock.

**Alternatives**: lock a layout only while it has valid tickets at any event, past ones included
(the same thing, since a past event stays `SCHEDULED`); versioned layouts (each edit a new version;
`039` can add that if editing needs it; rejected now, Constitution VIII).

## R8. An event's seating is saved with the event

**Decision**: `createEvent` and `updateEvent` take three optional fields, saved all or nothing with
the rest of the event (`031`, `035`):

- `layoutId`: one of the venue's layouts, or `null` for general admission. Changing or removing it
  is refused while the event has valid tickets or live holds (`409 EVENT_HAS_ORDERS`); it clears the
  event's level prices and off-sale seats (FR-010). With a layout, `tiers` must be empty (FR-012,
  `400`); a ticket type can't be added to a seated event (`createTicketTier`, `400
  VALIDATION_FAILED`, "a seated event has no ticket types").
- `levelPrices`: `[{ levelId, price }]`, every level of the layout that has seats on sale (FR-011,
  `400`, `details.field: levelPrices`, naming the levels); extra levels with every seat off sale
  may be priced and keep their price.
- `offSale`: the seats off sale, as **selectors**: `{ sectionId }` (the whole section),
  `{ sectionId, row }` (one row) or `{ sectionId, row, seat }` (one seat), up to 5,000. The Backend
  expands them to seats, refuses one that names no seat (`400`), and refuses a sold or held seat
  (`409 SEAT_TAKEN`, `details.seats`, FR-013). Sent, it replaces the whole set; left out on
  `updateEvent`, the set is unchanged.

`getEventSeating` returns them as saved, with the off-sale seats **compacted** back to selectors (a
whole section as one, then whole rows, then seats), each level's seat count and seats on sale, and
the totals. The form's price boxes start from `getVenueLayout`'s `latestPrices`: the level prices of
the most recently **created** scheduled event on the layout, if any (FR-015, review M3).

**Edge rules** (review S10): on `updateEvent`, `layoutId: null` is allowed and makes the event
general admission (it joins `maxTicketsPerCustomer` and `doorsOpenAt` as the fields that may be
`null`); its `totalTicketCapacity` and `basePrice` stay as they were unless sent. When `layoutId`
changes, the old prices and off-sale seats go and the `levelPrices` and `offSale` sent in the same
request apply to the new layout. With `locationId` in the same request, the layout must be of the
new venue; a venue change without `layoutId` clears the layout (refused while the event has sales).

**Why**: one request keeps "save the event, its layout, prices and off-sale seats" atomic, as `031`
made the rest of the form. Selectors keep the request small (the upper level of the Yum! Center is
30 selectors, not 10,878 seats) and say what the admin did.

**Alternatives**: a separate `PUT /events/{id}/seating` (two requests, so a half-saved event;
rejected, `031`); off-sale **rules** stored as selectors (cheaper to store, but a hold must then
evaluate rules under the lock and the database can't key anything to a seat; rejected).

## R9. Capacity, base price and the price range

**Decision**: a seated event's `totalTicketCapacity` is its layout's seats minus its off-sale seats,
set by the Backend on every change and never read from the request (FR-014); `0` is refused
(`400`, "no seats on sale"). The `016` limit (`maxTicketsPerCustomer ≤ totalTicketCapacity`) is
checked against it (`409 CAPACITY_EXCEEDED`, `details.field`), as today. `basePrice` is the lowest
price of a level with seats on sale, set by the Backend; a `basePrice` in the request is ignored
for a seated event. `Event.priceMax` (new, optional in 1.28.0) is the highest such price, `null`
for general admission, so lists and the event page show "$20–$95" without another read (FR-024).

## R10. Holds and orders across levels; what the database guarantees

**Decision**:

- `reserveSeats` drops the tier rule: any on-sale seats of the event, of any levels, up to 10 in the
  reservation (`015`, `033` unchanged otherwise). A seat off sale is `409 SEAT_OFF_SALE`
  (`details.seats`). `SeatReservation.tierId` is `null` for every seated event.
- `createOrder` for a seated event takes no `tierId` (`400` with one); it buys the held seats as
  today, each at its level's price **at that moment**, under the event lock (FR-022). Each ticket
  stores its `seatId`, its `price`, its level's name, and its section name, row label and seat
  label as sold (FR-026). `Order.totalPrice` is the sum; `Order.unitPrice` is the one price when
  every ticket has it and `null` otherwise (nullable from 2.0.0; until then a mixed order never
  exists, since the implementation and the 2.0.0 contract land together).
- **Database**: `ticket_one_valid_per_seat` becomes a partial unique index on `(eventId, seatId)
  WHERE status = 'VALID'`, and `seat_hold_one_live_per_seat` on `(eventId, seatId) WHERE releasedAt
  IS NULL` (FR-025, Constitution IV). `Ticket.seatId` and `SeatHold.seatId` are `ON DELETE SET NULL`
  with CHECKs that a valid seated ticket and a live hold have one, so deleting a sold or held seat
  fails in the database whatever the application checks. Off-sale is checked under the event lock,
  which every hold, order and seating save takes (a row lock, Principle IV).
- The 10-way concurrency test (FR-035, SC-001): ten customers hold the same seat at once, then ten
  orders race for one seat's purchase; exactly one succeeds each time.

**Alternatives**: a price table per order line (no gain over a price per ticket; rejected);
`unitPrice` as an average (not a price anyone paid, Money rule; rejected).

## R11. The venue map: overview counts and one section at a time

**Decision**: `getVenueMap` returns the event's seat-change `seq` it was read at (R12), the layout's drawing (size, floor, each section's id, name,
outline and label point), its levels with this event's prices (`null` for a level with nothing on
sale), and per section and level the counts `open`, `held`, `sold`, `offSale`. `getVenueMapSection`
returns the section's rows (number, label) and seats (row, seat, label, place, level, state, and
`accessible`). Both are the same for every caller and name no buyer (FR-028); a customer's own seats
come from `listMyReservations`, as today. A general-admission event answers `404` with a message
saying it has no seat map.

**Why**: the customer's overview color (FR-016) and the price filter (FR-017) need, per section,
which levels still have open seats; the admin map (FR-027) needs every state. Counts per level give
both without seats.

## R12. Live changes carry the seat's level and its previous state

**Decision**: `SeatStateChange` gains `levelId` and `from` (optional in 1.28.0) and the state
`offSale`; `state: reserved` keeps its name (it is "held" in every screen). `streamSeatMap` begins
with `event: venueMap` (a `VenueMap`) in place of `snapshot`. A client applies a change to the
section it has open, and to the overview counts as `−1` on `from` and `+1` on `state` for the
level.

**A sequence number per event** (review B3): the stream subscribes to the bus before it reads the
map, and replays what arrived meanwhile (`seat-stream.controller.ts`: "the snapshot may already
include them, and repeating a state is harmless"). Repeating an absolute state is harmless; a
repeated `−1/+1` delta is not. So `Event.seatSeq` (BIGINT, from 0) is incremented once in every
transaction that changes a seat's state, under the event lock, and that value is the `seq` of the
`SeatMapChange` it publishes. `getVenueMap`, `getVenueMapSection` and the `venueMap` event carry the
`seq` they were read at (read in the same statement as the counts). A client applies a change only
when its `seq` is greater than the map's (for counts) or the open section's (for seats), so a change
already in a snapshot is never counted twice, in whatever order things arrive.

**Which saves end the stream** (review S5): an event save that changes its `layoutId` or its level
prices, and a layout edit of a layout it uses, end its streams (the map's levels, prices or
shape changed), and viewers reconnect, read the new map, and reload the section they had open. An
event save that only changes its off-sale seats publishes them as `seats` changes (`offSale`,
`open`) and keeps the stream.

**Alternatives**: send each changed section's new counts (two publishes can arrive out of order
and the older counts would win; rejected); deltas without a sequence (double-counted on replay;
rejected); have clients load every section's seats (FR-029; rejected).

## R13. Drawing the map: SVG, one shared component, our own pan and zoom

**Decision**: the map is an SVG drawn by a shared component in `packages/shared/src/web/venue-map/`
used by both apps: the overview draws the floor object and each section's outline with its name;
zooming into a section draws its seats as circles and the row labels at both ends of each row. Pan
and zoom are a small hook, `use-pan-zoom.ts`, over the SVG `viewBox`: wheel, drag, two-finger pinch
(Pointer Events), `+`/`−` and **Fit** buttons, and `+`, `−` and arrow keys; zooming into a section
animates the `viewBox` to the section's bounds in 200 ms (none under `prefers-reduced-motion`).

- **Colors**: 12 level colors are tokens in the shared theme, `--level-<name>` for violet, blue,
  cyan, teal, green, lime, yellow, orange, red, pink, purple and brown, each with at least 3:1
  contrast against the map background (checked by the theme's contrast tests); a layout names one
  per level. Gray
  (`--seat-unavailable`) is for sections with nothing open and unavailable seats.
- **States without color** (FR-019, SC-007, Constitution VII): open seats are filled circles; held
  by others, a hollow circle; sold, a small gray circle with a cross; off sale, a small gray dash;
  the customer's own, the accent with a check mark. Faded seats and sections are at 35% opacity and
  stay clickable. Every seat has an accessible name ("Row F, Seat 7, Lower sideline, $60, open")
  and the legend names every level and state.
- **Size** (FR-029, SC-003): the overview never draws seats; a section is at most 20,000 circles
  (100 × 200) and the Yum! Center's largest about 900.
- The **Sections list** (FR-020) is a second view of the same state, beside the map at laptop width
  and under it on a phone: sections as buttons with name, price range of open seats and open
  count; then the chosen section's rows, each a group of seat buttons (as `SeatPicker` today).

**Why**: SVG scales the vector drawing at any zoom, gets clicks, focus and accessible names per
element for free, and handles a few thousand shapes easily; nothing at this size needs a canvas. A
small hook over `viewBox` is simpler to test than a library's transforms in jsdom.

**Alternatives**: d3-zoom (good pinch handling, but pulls in d3-selection and transitions and works
on transforms jsdom doesn't compute; rejected), svg-pan-zoom (unmaintained since 2019; rejected),
Konva, Fabric or PixiJS on a canvas (no per-seat focus or accessible names, a second accessible
view would be the only one for screen readers; rejected).

## R14. The customer's flow

**Decision**: on a seated event, the event page shows the price range and **Choose seats** (FR-024)
where the ticket-type step was; it opens the map in place, with the legend and price filter (two
range inputs over whole dollars, low and high, starting at the full range; FR-017) above it,
**Back to map** while zoomed, and `033`'s **Your seats** box with its countdown below, now listing
each seat with its level and price, and the total. Clicking seats holds and releases exactly as
`033` (the click queue, `use-hold-queue.ts`, the cart, Buy tickets). The cart lists each seat with
its level and price from `listMyReservations` (`ReservedSeat.levelName` and `price`, the current
price), which it already reads about once a second, so a price change shows before buying (spec
edge case; review M4).

## R15. The admin's screens

**Decision**:

- **Venue page**: a **Layouts** card replaces `LayoutCard`: each layout's name, seats, sections,
  levels, "used by N events", a locked note, and a small preview (the overview drawing, no
  seats); **Import layout file** (a file input reading the JSON in the browser and sending it;
  problems listed under it), **New layout from section lines** (`SectionLines.tsx` with a level
  column and level names), **Rename**, **Duplicate**, **Delete**. The venue's seating capacity
  is read-only while it has layouts (FR-009).
- **Event form, Seating section** (`035`): General admission or a layout (select, with preview);
  the price table (level, color swatch, seats on sale, price box, started from `latestPrices`); the
  map with an **Off sale** tool: in a zoomed section, **Whole section off sale / on sale**, a
  checkbox per row, and seat clicks toggle single seats; the line "N seats on sale · M off sale".
  A Backend refusal is shown beside the price box, the layout select or the map, and focused (`031`,
  `035`). Sold or held seats are disabled in the tool, with the reason.
- **Event page**: the same map colored by state (FR-027), each section showing "sold / open", a
  state legend, live (`useSeatStream`). The attendee list and its exports show the price level and
  each ticket's price.

## R16. Carrying today's data over, in one migration

**Decision**: one migration, `…_seat_maps`, in SQL:

1. Create `Layout`, `PriceLevel`, `SeatRow`, `Seat`, `EventLevelPrice`, `EventOffSaleSeat`.
2. For each venue with sections, a new layout named "Standard" (`source: LINES`, `floor: none`);
   each section keeps its **id** (so held seats and open pages still name it), gets the layout, a level of its own named after it (rank by
   position; colors in theme order, repeating after 12), and an outline in the R6 grid; rows `1…n`
   labelled `'1'…'n'`, seats `1…m` labelled `'1'…'m'`, placed as R6 does, by `generate_series`.
3. Each seated event: `layoutId` = its venue's Standard. A section mapped to a ticket type is priced
   at that type's price; on an event without types, at its base price; a section **not mapped** on
   an event with types (unsellable today) goes **off sale**. An event with types and no section
   mapped (nothing sellable today) becomes **general admission**, keeping its types. So does any
   event with `reservedSeating = true`, of **any status**, whose venue has no sections: `007`'s
   `remove` only checks scheduled events, so a cancelled seated event can sit at a venue whose
   layout was removed (review B4a).
4. Tickets and holds get their `seatId` by section id or name, row and seat; a valid ticket's
   `price` is its order's `unitPrice` and its level name the ticket type's name (else the section's).
   Orders, tickets and reservations of seated events drop their `tierId`; those events' ticket types
   and every `SectionTier` are deleted.
5. Capacity becomes the seats on sale, `maxTicketsPerCustomer` is lowered to it where higher, and
   `basePrice` becomes the lowest on-sale level price.
6. Drop `Section.locationId`, `rows`, `seatsPerRow`, `SectionTier`, the label indexes; add the new
   indexes and CHECKs.

**The 12-level limit**: a Standard layout has one level per section, and a venue may have had up to
50 sections, so it may have more than 12 levels. The spec now allows that for carried-over layouts
only (FR-031 amended in this PR); imports and section lines keep 1–12.

**The 30,000-seat limit** (review B4b): `007` allowed 50 sections × 100 rows × 200 seats. A
carried-over layout keeps every seat its venue had; the database CHECK on `Layout.seatCount` is only
`≥ 1`, and the Backend applies 30,000 to imports and section lines. Generating seats in the migration
is one `INSERT … SELECT` over `generate_series`; on the team's and demo databases (a few hundred to a
few thousand seats) it takes well under a second, and even the old maximum is one statement.

**Tests**: `migration.seat-maps.e2e-spec.ts` migrates a fresh database to the migration before,
inserts each case (a seated event with types, one without, one with an unmapped section, one with
nothing mapped, a cancelled seated event at a venue with no sections, a venue of 40,000 seats, a
general-admission event, valid, void and refunded tickets, a live hold and an ended one), applies
the migration, and checks SC-006 seat by seat, as
`migration.time-zones.e2e-spec.ts` does for `020`.

**Alternatives**: keep `Section`/`SectionTier` beside the new tables for old events (two seating
models in every query; rejected); one level per distinct ticket-type price (types differ per event
at one venue; rejected).

## R17. Reports, attendee lists, the gate

**Decision**: wherever a ticket type's name is shown for a ticket or order, a seated ticket shows its
level name as sold (FR-030): `Order.tickets[].levelName`, `EntryTicket.levelName`, the attendee
list and its CSV/Excel/PDF exports (a **Price level** column beside **Ticket type**, and a **Price**
per ticket), and the sales report's `EventSales.levels` (each level's name, price, seats on sale,
tickets sold, revenue) beside `tiers`, empty for general admission. Sold tickets and revenue are
grouped by `Ticket.levelName` **as sold**; seats on sale and price come from the event's current
levels. A carried-over event's tickets carry their ticket type's name as `levelName`, so its
history still reads by ticket type, beside its new per-section levels (review M9). Seat labels are shown as
"Section 115, Row F, Seat 7" from `rowLabel`/`seatLabel` (FR-026) in the confirmation, My tickets,
the printed ticket, the attendee list, and the Booth's result.

## R18. The KFC Yum! Center data

**Decision**:

- **Section plan** (`scripts/layouts/yum-center/plan.json`, hand-traced from the venue's public
  seating charts, D6): each bowl section's outline and row line, its row labels, and its level; the
  floor object per layout; floor sections for concerts and wrestling.
- **Generator** (`scripts/layouts/generate-yum-center.mjs`, plain Node like `scripts/*.mjs`): makes
  the four layout files as runs, spreading seats per row so the totals match the published
  capacities, and checks each file against the `LayoutFile` schema from the contract before writing.
- **Files** (`backend/src/scripts/layouts/yum-center-{basketball,end-stage,center-stage,wrestling}.json`,
  imported as JSON modules so the build copies them): Basketball 22,090 seats (lower 101–120 rows D–Z
  then AA–HH where they go that deep, terrace 209–212, upper 301–330 rows A–W, 54 sections); End-stage
  concert 17,500 (sections 101–103, 119–120, 301–306 and 325–330 removed, 104 and 118 partial,
  floor 1–5); Center stage about 19,500 and Wrestling (ring) about 18,000, our estimates, with floor
  sections around the stage or ring.
- **Basketball's levels, pinned** (review S1; the stories, quickstart and browser tests use these):

  | Level (rank, color) | Seats |
  | --- | --- |
  | Courtside (1, violet) | rows D–G of the sideline sections 104–108 and 113–117 |
  | Lower sideline (2, blue) | the other rows of 104–108 and 113–117; terrace 209–212 |
  | Lower end (3, teal) | the end and corner sections 101–103, 109–112, 118–120 |
  | Upper (4, green) | 301–330 |

  The other three layouts each have three levels: Floor (1), Lower (2), Upper (3), with the floor
  sections in Floor.
- **Demo events** (FR-033, US5) at the "KFC Yum! Center" venue (1 Arena Plaza, Louisville, KY
  40202), the only seated events in the demo data (today's demo venues have no layout):

  | Event | Layout | Prices | Off sale |
  | --- | --- | --- | --- |
  | Cardinals Women vs. Duke | Basketball | $95 / $60 / $35 (Upper none) | 301–330 |
  | Cardinals Men vs. Kentucky | Basketball | $150 / $90 / $55 / $25 | none |
  | Arena Tour: Live | End-stage concert | $120 / $75 / $40 | none beyond the layout's own cut |
  | WWE Saturday Night | Wrestling (ring) | $110 / $65 / $30 | rows S–W of 305–310 and 320–325 |

  On each, about 40 seats are sold to demo customers through the real services (a hold, then an
  order, as a customer does). **No seat is left held**: a hold lasts exactly 5 minutes
  (`seat_reservation_five_minutes`) and the sweep ends it, so the held state is shown live by a
  second customer during the demo (review S3). So Basketball is used by 2 events, End-stage concert
  and Wrestling by 1, all three locked; Center stage by none, unlocked (review S2). The reset (`029`)
  loads them with the rest; times relative to the run.

**Why**: John wanted the real building "without spending 3 weeks typing it all in"; a traced plan
of about 60 sections plus a generator is an afternoon, reviewable, and ours to publish.

## R19. Tests (Constitution VI; written first, seen to fail)

- **Backend (Jest, Testcontainers)**: `layouts.e2e-spec.ts` (import, its problems, limits, lines,
  edit keeping ids, rename, duplicate, delete, lock, venue capacity), `levels.unit.spec.ts` (seat →
  row → section), `event-seating.e2e-spec.ts` (layout pick, prices, off-sale selectors, compaction,
  capacity, base price, refusals), `venue-map.e2e-spec.ts` (counts per level and state, a section,
  privacy, GA `404`), `holds.levels.e2e-spec.ts` and `orders.levels.e2e-spec.ts` (mixed levels,
  price at purchase, off sale), `seats.concurrency.e2e-spec.ts` (10 simultaneous holds, 10 orders:
  1 each), `seat-stream.e2e-spec.ts` (`venueMap`, `from`, `levelId`, `offSale`),
  `migration.seat-maps.e2e-spec.ts` (R16), `demo-data.e2e-spec.ts` (four layouts, four events,
  twice the same), authorization cases for every new operation, the contract tests for every
  response.
- **Shared (Vitest)**: `use-pan-zoom` math, the venue map component (sections, zoom, states and
  their marks, accessible names), the Sections list, the stream reducer with deltas.
- **Admin and Customer apps (Vitest, RTL)**: the Layouts card, the import's problems, the Seating
  section (prices, off-sale tool, line, refusals), the event page map; the customer's map flow,
  filter, list, Your seats with prices, cart with prices.
- **Browser (Playwright, `022`)**: `038-seat-maps.spec.ts`: US2 (schedule on Basketball, price,
  upper off sale, save) and US3 (filter, zoom, hold two levels, buy, ticket labels); the existing
  `006-007`, `015`, `031`, `033`, `035` files move to layouts.
- **Generator**: `scripts/test/layouts.test.mjs` (totals, schema, deterministic output).

## R20. Spec, constitution, other specs

- **Spec 038** (this PR): issue #165; FR-001 gains the 100-section limit; FR-003 and FR-031 allow a
  carried-over layout more than 12 levels and seats; FR-031 states the unmapped-section,
  nothing-mapped and no-sections cases (R16); after review round 1, FR-006 (delete and line edits),
  FR-008, FR-015, FR-023, FR-024, FR-033, FR-034, FR-036 and US2, US3, US5 as described above.
- **Dated notes** (FR-036, this PR): `007` FR-001–FR-008, FR-017, FR-018; `015`'s one-tier
  reservation; `033` FR-005; `035`'s Seating section; `031` FR-003 and FR-008; `024` FR-018–FR-022;
  `023`'s export columns.
- **Constitution 3.10.0** (MINOR): Principle I and gate 2 gain the rule for breaking removals (R3);
  rows `038-seat-maps` and `039-layout-editor` reserved. PR #164 (`037`) also takes 3.10.0;
  whichever lands second takes 3.11.0 and keeps both. The next free number is `040`.

## R21. Order of work, for the EDIS demo on 2026-11-20

The demo needs US1 (import), US2, US3 and US5; US4 and US6 can follow within the same PR. Work in
this order so the demo path is usable early: schema and migration with its test → layouts API and
import → Yum! Center files and demo data → event seating in the event save → venue map reads and
the stream → holds and orders across levels → the shared map component → Customer flow → Admin
Layouts card and Seating section → Sections list → Admin live map → reports, attendees, Booth →
browser tests. tasks.md follows it.

## R22. Spec 037 (the Rust Admin app) builds on what 038 retires

**Problem** (review B2): PR #164's parity checklist ports the Admin app's current seating screens to
Rust: V6 (`LayoutCard`, `replaceLayout`), E3 and E12 (section-to-ticket-type mapping,
`updateSeating`), E13 (`SeatGrid` and the `snapshot` stream), with types generated from the contract
and the `015`, `031` and `035` browser journeys run against it. Whichever of the two implementations
merges second would turn `main` red: 2.0.0 removes those operations, or the Rust app is built on
them.

**Decision** (recommended answer, open to review; both features are Nate's): **038's implementation
merges before 037's.** Before 037's implementation starts its seating screens, 037's spec PR amends
its parity rows V6, E3 (the seating part), E12 and E13 to port 038's screens instead (the Layouts
card, the Seating section with prices and off-sale seats, the event page's venue map), and its
browser journeys follow 038's. If 037's implementation is merged first after all, 038's
implementation PR also moves the Rust Admin app off the retired operations (a task added then), and
cannot merge without it.

**Alternatives**: 037 drops seating parity for now (John asked for every feature of the Admin app);
step 2 waits for 037 (keeps two seating models on `main` and blocks 038's cleanup). Rejected, open to
review.

