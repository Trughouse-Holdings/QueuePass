# Feature Specification: Seat Maps: Venue Layouts, Prices by Level, Seats Off Sale, and the Customer Venue Map

**Feature Branch**: `038-seat-maps-spec`

**Created**: 2026-11-13

**Status**: Draft

**Issue**: [#165](https://github.com/Trughouse-Holdings/QueuePass/issues/165)

**Input**: John's direction at the Nov 10 team meeting, and the seat-maps proposal Nate drafted from it
(QueuePass Seat Maps Proposal, Nov 11–12), whose spec "038" this is. John asked for "a realistic
looking seat map that's similar to what you might see in any of the other ticketing apps": a visual
map of the venue, a zoom into a section, each seat drawn, and a filter of available seats by price
range. A venue has several seating layouts ("one layout for basketball games, another layout for a
standard concert", a stage in the middle, a wrestling ring in the middle). A layout carries "the
different gradients of desirability baked into it", down to rows ("the first 10 rows of a section
might be a higher price") or single seats, and "when I'm defining an event ... for the tier one most
expensive tickets, I can set a price for those and then kind of work my way down the list". Some
sections or rows are not for sale at a given event (his Ticketmaster examples: women's basketball
selling only the lower bowl, WWE selling only some rows). He suggested copying real KFC Yum! Center
layouts and getting the data in "without spending 3 weeks typing it all in". The drawing editor for
layouts (block generator, drag and rotate, painting price levels) is the proposal's second spec,
`039`, and is out of scope here.

## Context

Builds on `007` (venue layouts as sections of rows × seats per row; reserved seating per event; each
section mapped to one ticket type; seats labelled section, row number, seat number; no seat sold
twice), `015` (holds: a reservation of 1 to 10 seats of one ticket type, 5 minutes, live seat changes
to every viewer), `016` (tickets per customer), `017` (the name on tickets), `023` (report exports),
`029` (the demo data and the reset command), `031` (an event, its ticket types and its seating saved
in one step), `033` (click a seat to hold it, Add to cart, buy from the cart), `034` (sales until the
event ends) and `035` (the event form's sections, live seat totals, all-or-nothing edits).

Today a venue has **one** layout: a list of rectangular sections, each "Rows × Seats per row", with
no position in the building. A seated event maps each whole section to one of its ticket types, so
every seat in a section costs the same. The customer picks a ticket type, then a section from a
list, then seats in a grid of buttons. One hold and one order are one ticket type at one price.

This feature changes that in five ways:

1. A venue has **several named layouts**, each a map: sections placed where they are in the
   building, rows of any length with labels such as "A" or "AA", and seats with their own place.
2. A layout sorts its seats into **price levels** by desirability, by section, by row, or seat by
   seat.
3. A seated event uses **one layout**, sets **a price for each level**, and may take **sections,
   rows, or seats off sale** for that event only.
4. The customer chooses seats on a **venue map**: the whole venue colored by price, a price-range
   filter, a zoom into one section, each seat drawn in place. One hold and one order may mix levels.
5. The KFC Yum! Center's four layouts and four demo events modelled on John's examples come with the
   demo data.

Season tickets (Mahdi's spec) build on this: a series of events shares one layout, so a season seat
is the same seat at every event in the series. This spec makes that possible and nothing more.

## Clarifications

### Session 2026-11-13

The proposal's six decisions (D1–D6) are posted for John in Slack and not yet answered. Each takes
the proposal's recommended answer, recorded here as **recommended answer, open to review**, so John,
Mahdi and the team can overturn it in review of the spec PR.

- Q: How are layouts made in this spec, since the drawing editor is `039`? → A: **Two ways: import a
  layout file, or build a plain layout from section lines as today.** A layout file holds sections
  with their outlines and places, rows with labels, seats with their places, price levels, and each
  seat's level (by section, by row, or by seat). Section lines ("Name, Rows × Seats per row, Price
  level") make a plain layout: rectangular sections set side by side in a grid, rows labelled 1, 2,
  3…, one price level per section. Real arenas come in by file, generated, not typed (D1, D6;
  recommended answer, open to review) (FR-001–FR-008).
- Q: Where does an event's price live, and what happens to ticket types on seated events? → A: **Each
  event sets one price per price level of its layout. Ticket types stay for general admission
  only.** A seated event has no ticket types; mapping sections to ticket types (`007` FR-004–FR-006)
  ends. Reports, the cart, and tickets name the seat's price level where they name a ticket type
  today (D2; recommended answer, open to review) (FR-012, FR-013, FR-030).
- Q: Can one hold or one order mix price levels? → A: **Yes.** Seats next to each other can sit in
  different levels, so a hold and an order may hold seats of any levels of one event; each ticket
  carries its own price and the order's total is the sum. The 10-seat cap on one hold (`015`) and
  the tickets-per-customer limit (`016`) are unchanged (FR-021, FR-022).
- Q: Can a layout change once events use it? → A: **A layout used by any scheduled event that has
  valid tickets or live holds cannot be changed or deleted; Duplicate makes an editable copy.** A
  sold seat can never move, vanish, or change level (D3; recommended answer, open to review)
  (FR-006).
- Q: What happens to today's venues, layouts, seated events and sold tickets? → A: **They carry over
  unchanged.** Each venue's sections become a plain layout named "Standard", one price level per
  section; each seated event uses it, priced so every seat costs what it costs today; each sold
  ticket keeps its seat, its price and its label (D4; recommended answer, open to review) (FR-031,
  FR-032).
- Q: A standing pit on a concert floor? → A: **Not in this spec.** Floor seats are seated sections.
  A standing area sold by quantity inside a seated event is deferred (D5; recommended answer, open
  to review) (Out of scope).
- Q: Where do the Yum! Center layouts come from? → A: **From the venue's own public seating charts,
  traced by hand into a section plan, and a script that generates rows and seats to match the
  published capacities** (basketball 22,090; end-stage concert 17,500). John suggested having Claude
  pull the data from Ticketmaster; its terms ban robots and data mining, and its map data is
  undocumented, so the data is ours and approximate where the venue publishes nothing (seats per
  row; center-stage and wrestling capacities) (D6; recommended answer, open to review) (FR-033).
- Q: How is a section's color on the overview map chosen? → A: **The color of the cheapest price
  level in which the section still has open seats inside the price filter**; a section with none is
  gray. Price levels are always named next to their color (legend, seat details, list view), so
  color is never the only cue (Constitution VII) (FR-016, FR-019).
- Q: Does the customer give a quantity first, as on Ticketmaster? → A: **No.** Clicking seats holds
  them one at a time, as `033` built it, so a quantity adds nothing. "Best available" seats are
  deferred (Out of scope).
- Q: What is a seated event's ticket capacity now? → A: **The seats on sale**: the layout's seats
  minus the seats off sale, recomputed whenever either changes; admins never type it. A venue's
  seating capacity is its largest layout's seat count (FR-010, FR-014).
- Q: A seated event's base price (Constitution: every event has one)? → A: **The lowest of its level
  prices, set by the Backend.** The customer sees the seated event's price as a range, "$45–$250"
  (FR-012, FR-015).
- Q: The Rust Admin and Customer apps (`037` and Mahdi's)? → A: **Not covered here.** Whether they
  must also get seat maps is an open question for John; this spec changes only the React apps,
  the Backend, the Booth app's seat label, and the demo data (Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A venue has several layouts, each a map with price levels (Priority: P1)

Avery, an admin, opens the KFC Yum! Center venue and finds a **Layouts** list instead of today's
section lines. She imports the "Basketball" layout file: the list shows "Basketball · 22,090 seats ·
54 sections · 4 price levels · used by 0 events", and its preview draws the court with the lower
bowl, the terrace and the upper level around it. She imports "End-stage concert" and "Wrestling
(ring)" as well, then builds a small "Club room" layout from three section lines with a level each.
She duplicates "Basketball" to make "Basketball (playoffs)" and renames it.

**Why this priority**: Every other story needs layouts with seats and levels. Season tickets need
them too, so they must merge first.

**Independent Test**: Import a layout file and build a layout from section lines at one venue; each
shows the right seat count, sections, levels and preview; a layout used by an event with sales
refuses changes and deletion but can be duplicated; the venue's seating capacity is its largest
layout.

**Acceptance Scenarios**:

1. **Given** a venue with no layouts, **When** an admin imports a valid layout file, **Then** the
   layout is listed with its name, seat count, section count, level count and "used by 0 events",
   and its preview shows every section in place around its floor object.
2. **Given** a layout file with an error (a seat with no row, two sections with one name, a seat
   with no price level, more seats than allowed), **When** it is imported, **Then** nothing is saved
   and the admin sees each problem named, such as "Section 104, row F: seat 7 appears twice".
3. **Given** the section-line form, **When** an admin enters "Floor A, 10 × 20, Level 1" and "Floor
   B, 10 × 20, Level 2", **Then** a layout of 400 seats with two levels is saved, rows labelled 1–10
   and seats 1–20.
4. **Given** a layout used by a scheduled event with valid tickets, **When** an admin tries to
   change or delete it, **Then** it is refused, naming the event, and **Duplicate** still makes an
   editable copy named "… (copy)".
5. **Given** a venue with layouts of 22,090 and 17,500 seats, **Then** the venue's seating
   capacity reads 22,090 and cannot be typed.
6. **Given** a venue that had sections before this feature, **Then** it has one layout named
   "Standard" with those sections, rows and seats, one price level per section.

---

### User Story 2 - An admin schedules a seated event: a layout, a price per level, seats off sale (Priority: P1)

Avery schedules "Cardinals Women's Basketball vs. Duke" at the Yum! Center. In the event form's
Seating section she picks **Basketball**; a price table lists its levels with their seat counts, and
she types $95, $60, $35 and $20. She takes the whole upper level, sections 301–330, **off sale**,
and also rows D–F of section 104 for a camera platform. The line under the map reads "11,212 seats
on sale · 10,878 off sale". She saves; the event's capacity is the seats on sale, and its price
reads "$20–$95".

**Why this priority**: Without prices and sale rules on an event, no customer can buy a seat on a
layout.

**Independent Test**: Schedule a seated event on an imported layout, price every level, take a
section, a row range, and single seats off sale, save, and confirm the stored prices, capacity, and
off-sale seats; confirm the refusals below.

**Acceptance Scenarios**:

1. **Given** the event form with reserved seating chosen, **When** the admin picks a layout,
   **Then** a price table lists each of its levels (name, color, seats in it) with an empty price
   box, and the map preview shows the layout.
2. **Given** a level with seats on sale and no price, **When** the admin saves, **Then** the save is
   refused and the empty price box is named and focused; nothing is saved (`031`, `035`).
3. **Given** the map preview, **When** the admin takes a section, a range of rows, and two single
   seats off sale, **Then** they are drawn crossed out, the seats-on-sale line updates at once, and
   a level whose seats are all off sale no longer needs a price.
4. **Given** a saved seated event with no valid tickets and no live holds, **When** the admin
   switches it to another layout, **Then** its prices and off-sale seats are cleared and must be
   set again for the new layout.
5. **Given** a seated event with valid tickets or live holds, **When** the admin tries to switch its
   layout or turn reserved seating off, **Then** it is refused, saying why.
6. **Given** a seat that is sold or held, **When** the admin tries to take it (or its row or
   section) off sale, **Then** it is refused, naming the seats; seats already sold stay valid.
7. **Given** a seated event, **When** the admin changes a level's price, **Then** tickets already
   sold keep the price they were sold at, and new sales use the new price.
8. **Given** the next event scheduled on the same layout, **When** the admin picks that layout,
   **Then** the price boxes start with the prices of the latest earlier event on that layout.

---

### User Story 3 - A customer chooses seats on the venue map (Priority: P1)

Jordan opens the women's basketball game and presses **Choose seats**. The Yum! Center is drawn from
above with the court in the middle. The lower bowl is colored by price; the upper level is gray. A
legend lists "Courtside $95, Lower sideline $60, Lower corner $35, Upper $20". He drags the price
filter to $30–$65; the courtside sections fade. He clicks section 115: the map zooms in, rows D to HH
appear in place, the front rows blue for $60 and the back rows green for $35. Hovering a seat shows
"Sec 115, Row F, Seat 7 · Lower sideline · $60". He clicks Row F seats 7 and 8 and Row P seat 7; all
three are held, the 5-minute countdown starts, and Your seats lists them with $60, $60 and $35, total
$155. He presses **Back to map**, then Add to cart, and buys from the cart as in `033`.

**Why this priority**: This is what John asked to see and the heart of the EDIS demo.

**Independent Test**: On a seated event with several levels and some seats off sale, sold and held,
open the map, filter by price, zoom into a section, hold seats of two levels in one hold, and buy
them; the tickets carry each seat's own price and label.

**Acceptance Scenarios**:

1. **Given** a seated event, **When** the customer opens the seat map, **Then** every section of
   its layout is drawn in place with its name; a section is filled with the color of its cheapest
   level that still has open seats, gray when it has none on sale or open; and a legend names each
   level with its color and price.
2. **Given** the overview, **When** the customer sets the price filter to a range, **Then** sections
   with no open seats priced inside it are drawn faded, the legend marks the levels outside it, and
   the overview still shows every section.
3. **Given** the overview, **When** the customer clicks (or presses Enter on) a section, **Then** the
   map zooms into it, drawing each row and seat in place with row labels; open seats show their
   level's color; sold, held, and off-sale seats are drawn as unavailable with a shape or mark, not
   only a color; seats outside the price filter are faded but still choosable.
4. **Given** a zoomed section, **When** the customer hovers or focuses a seat, **Then** its section,
   row, seat, level and price are shown.
5. **Given** a zoomed section, **When** the customer clicks open seats of two levels, **Then** each
   is held as in `033` (one countdown, Your seats lists each seat with its own price, the total is
   their sum).
6. **Given** held seats, **When** the customer buys them from the cart, **Then** the order holds one
   ticket per seat at that seat's price at the moment of purchase, and the confirmation, My
   tickets, and the Admin attendee list show "Section 115, Row F, Seat 7".
7. **Given** another customer holds, releases, or buys a seat, **When** Jordan is viewing the map,
   **Then** the seat and its section's color change within 2 seconds without a refresh (`015`).
8. **Given** a phone-width screen, **When** the customer pinches or uses the zoom buttons, **Then**
   the map zooms and pans, and a tap on a section zooms into it.

---

### User Story 4 - Seats can be chosen without the map (Priority: P2)

Sam uses a screen reader. Next to the map, the page offers a **Sections** list: each section's name,
its price range, and its open seats, filtered by the same price range. Choosing a section lists its
rows, each with its seats as buttons named "Row F, Seat 7, Lower sideline, $60, open". Holding a
seat here holds it on the map as well.

**Why this priority**: The map is a picture; the list keeps seat choosing usable by keyboard and
screen reader, which the current seat grid already is.

**Independent Test**: With the keyboard only, filter by price, choose a section from the list, hold
and release seats, and buy them; the map and the list always agree.

**Acceptance Scenarios**:

1. **Given** the seat map page, **Then** a Sections list is reachable by keyboard with each
   section's name, price range of its open seats, and open seat count, under the price filter.
2. **Given** a chosen section, **Then** its seats are buttons grouped by row, each named with row,
   seat, level, price and state, and pressing one holds or releases it exactly as a click on the map.
3. **Given** a seat held or released in either view, **Then** the other view shows it at once.

---

### User Story 5 - The demo resets to the Yum! Center events John showed (Priority: P2)

Before a demo, Nate runs the reset command (`029`). The KFC Yum! Center has its four layouts:
Basketball, End-stage concert, Center stage and Wrestling (ring). Four upcoming events use them,
modelled on John's examples: women's basketball (upper level off sale, rows of one lower section
priced differently), men's basketball (everything on sale), an end-stage concert (floor sections
1–5, the seats behind the stage off sale), and WWE (floor sections around the ring, back rows of some
sections off sale). Each has some seats already sold and held, so every seat state shows.

**Why this priority**: The demo must start from the same state every time, and the broken seat
demo (#162) came from having no seated event.

**Independent Test**: Run the reset; the four layouts and four events exist with the counts below;
run it again and get the same result.

**Acceptance Scenarios**:

1. **Given** any database, **When** the reset command runs, **Then** the Yum! Center has exactly
   the four layouts, Basketball with 22,090 seats and End-stage concert with 17,500.
2. **Given** the reset, **Then** the four demo events exist with their layouts, level prices, the
   off-sale seats described above, and some seats sold and held.
3. **Given** the reset run twice, **Then** the second run ends in the same layouts, events, prices
   and seat states (times relative to when it ran).

---

### User Story 6 - The admin watches a seated event on the same map (Priority: P3)

On the event page, Avery sees the same venue map, colored by seat state instead of price: open,
held, sold, off sale. Each section shows its sold and open counts; clicking one zooms in, and it
updates live.

**Why this priority**: The Admin app already shows a live seat map (`007`, `015`); this keeps it
working on layouts, but the demo can run without it.

**Independent Test**: Hold and buy seats as a customer while the admin views the event; the admin's
map shows each change within 2 seconds.

**Acceptance Scenarios**:

1. **Given** a seated event, **When** an admin opens it, **Then** the map shows every section with
   its sold, held, open and off-sale counts, and a legend of the states.
2. **Given** a zoomed section, **Then** each seat shows its state, and the admin can see who bought
   a seat only on the attendee list, as today.

---

### Edge Cases

- **Imported file bigger than allowed**: a layout of more than 30,000 seats, a section of more than
  100 rows or a row of more than 200 seats is refused, naming the limit.
- **Two layouts with one name at a venue** (ignoring case): refused.
- **A level with no seats**: allowed in a layout (a file may define it); an event never asks a
  price for it.
- **Every seat off sale**: the event can't be saved with reserved seating, since it would sell
  nothing; the refusal says so.
- **A seat taken off sale while a customer is viewing it**: it turns unavailable on their map
  within 2 seconds, as a sold seat does.
- **Price changed while seats are held**: the hold keeps the seats; the purchase is at the price
  when bought, and the cart shows the new price before the customer buys.
- **Price filter matching nothing**: every section is faded and a note says no open seats are in
  that range; the filter can be reset to the full range.
- **An event's layout from another venue**: refused; an event uses only its own venue's layouts.
- **Venue changed on an event with a layout**: allowed only with no valid tickets or live holds, and
  it clears the layout, prices and off-sale seats.
- **Deleting the last layout of a venue with seated events**: refused, naming the events.
- **A sold seat's row or seat label changes in a duplicate**: the duplicate is a new layout; the
  sold ticket keeps its own label and its original seat.
- **General admission events**: unchanged; they have no layout, keep ticket types, and never show
  the map.
- **Cancelled event** (`005`): its tickets are void, so its seats no longer block layout changes.

## Requirements *(mandatory)*

### Functional Requirements

**Layouts**

- **FR-001**: A venue MUST be able to have zero or more **layouts**, each with a name (1–50
  characters, unique per venue ignoring case), a floor object (court, end stage, center stage, ring,
  or none), sections, rows, seats and price levels. A layout has 1 to 100 sections and 1 to 30,000
  seats.
- **FR-002**: A **section** MUST have a name (1–50 characters, unique within its layout ignoring
  case), an outline and a place on the layout's map, and 1 to 100 rows. A **row** MUST have a label
  (1–5 characters, unique within its section, such as "A", "AA" or "12") and an order, and 1 to 200
  seats. A **seat** MUST have a label (1–5 characters, unique within its row) and a place on the
  map, and MAY be marked accessible (for `#57` later; this spec gives the mark no other behavior).
- **FR-003**: A layout MUST have 1 to 12 **price levels** (a layout carried over by FR-031 may
  have one per section, up to 50), each with a name (1–50 characters,
  unique within the layout ignoring case), a rank (1 = most desirable) and a color. Every seat MUST
  have exactly one level: its own if set, else its row's, else its section's.
- **FR-004**: Admins MUST be able to create a layout by **importing a layout file** in the format
  the contract defines. An import MUST be all or nothing, and a refused import MUST list each
  problem with where it is.
- **FR-005**: Admins MUST be able to create a layout from **section lines** (name, rows, seats per
  row, price level; level names defined in the same form). It makes rectangular sections placed in
  a grid, rows labelled 1 upward and seats numbered 1 upward, as `007` did.
- **FR-006**: Admins MUST be able to rename, duplicate and delete layouts, and to edit a
  section-line layout. A layout used by any scheduled event that has valid tickets or live holds
  MUST NOT be changed or deleted, and a layout used by any scheduled event MUST NOT be deleted; the
  refusal MUST name the events. Duplicate MUST always work and make an unused copy.
- **FR-007**: The venue page MUST list each layout's name, seat count, section count, level count,
  and the number of scheduled events using it, with a preview of its map.
- **FR-008**: Layout changes MUST require `queuepass-admin`. A layout's map, without who holds any
  seat, MUST be readable by any signed-in user of the Admin and Customer apps.
- **FR-009**: A venue's seating capacity MUST be the seat count of its largest layout whenever it
  has one, and admins MUST NOT type it then; a venue without layouts keeps a typed capacity (`002`).

**Event seating**

- **FR-010**: An admin MUST be able to give an event reserved seating by choosing one of its venue's
  layouts, or general admission by choosing none. The layout MAY be chosen, changed, or removed
  only while the event has no valid tickets and no live holds; changing or removing it clears the
  event's level prices and off-sale seats.
- **FR-011**: A seated event MUST have a price (USD, 0.00 or more, to the cent) for every level of
  its layout that has seats on sale; a save without one MUST be refused, naming the levels. Prices
  MAY change at any time; a ticket keeps the price it was sold at.
- **FR-012**: A seated event MUST NOT have ticket types; its base price MUST be the lowest of its
  level prices, set by the Backend. General-admission events keep ticket types exactly as `004` and
  `006`.
- **FR-013**: An admin MUST be able to take seats **off sale** for one event, by section, by rows
  of a section, or seat by seat, and to put them back on sale. A seat that is sold or held MUST NOT
  be taken off sale; the refusal MUST name the seats. An off-sale seat MUST NOT be held or sold.
- **FR-014**: A seated event's ticket capacity MUST be its layout's seat count minus its off-sale
  seats, recomputed on every change; a seated event with no seats on sale MUST be refused. The
  tickets-per-customer limit (`016`) is checked against it as today.
- **FR-015**: The event form's Seating section (`035`) MUST offer: the layout (or general
  admission) with a preview; a price table of the layout's levels with each level's color and seats
  on sale; and the map with an off-sale tool and a running line "N seats on sale · M off sale".
  Price boxes MUST start with the prices of the latest earlier event on the same layout, when there
  is one. Saving the event, its layout, prices and off-sale seats MUST be all or nothing, and a
  refusal MUST appear beside the field at fault, as `031` and `035` do.

**Customer venue map**

- **FR-016**: For a seated event, the Customer app MUST show a **venue map**: the layout's floor
  object and every section in place with its name; each section filled with the color of its
  cheapest level that has open seats inside the price filter, or gray when none; and a legend naming
  each level with its color and price.
- **FR-017**: The map MUST offer a **price filter** (a low and a high price, in whole dollars, over
  the event's level prices, starting at the full range). Sections with no open seats inside it MUST
  be drawn faded, and seats outside it faded but still choosable.
- **FR-018**: Clicking, tapping, or pressing Enter on a section MUST zoom the map into it, drawing
  each row and seat in place, row labels beside the rows, and a **Back to map** control. The map
  MUST zoom and pan by scroll, pinch, drag, and zoom buttons.
- **FR-019**: Open seats MUST show their level's color. Sold, held, and off-sale seats MUST look
  unavailable by a shape or mark as well as a color, and the customer's own held seats MUST look
  selected. Hovering or focusing a seat MUST show its section, row, seat, level and price.
- **FR-020**: A **Sections list** MUST offer the same choices without the map: each section's name,
  the price range of its open seats and its open seat count, under the same filter; then the chosen
  section's seats as buttons grouped by row, each named with row, seat, level, price and state. The
  map and the list MUST share one state.
- **FR-021**: Clicking an open seat on the map or in the list MUST hold it, and clicking a held seat
  MUST release it, exactly as `033` (one countdown per event, Add to cart, buy from the cart, the
  2-minute wait, the hold allowance). One hold MUST be able to hold seats of any levels of one event;
  its cap of 10 seats stays.
- **FR-022**: An order for a seated event MUST issue one ticket per seat at that seat's level price
  at the moment of purchase, and its total MUST be the sum. Your seats and the cart MUST list each
  seat with its level and price.
- **FR-023**: Seat changes (held, released, sold, put on or taken off sale) MUST reach every viewer's
  map within 2 seconds without a refresh, as `015`, including the sections' colors and counts.
- **FR-024**: The event page MUST show a seated event's price as the range of its on-sale level
  prices ("$20–$95") and a **Choose seats** button in place of the ticket-type step.

**Seats, labels, and other screens**

- **FR-025**: A seat MUST be held by at most one valid ticket and at most one live hold per event,
  including under concurrent requests, guaranteed by the database (Constitution IV), by the seat
  itself, not only by its label.
- **FR-026**: A ticket MUST keep its seat and a copy of its section, row and seat labels as sold,
  and its price. Confirmations, My tickets, the attendee list, the Ticket Booth app, and the report
  exports (`023`) MUST show the labels as text ("Row F", "Row 12").
- **FR-027**: The Admin app's event page MUST show the event's map colored by seat state (open,
  held, sold, off sale) with each section's counts, zoom into a section, and live updates; who bought
  a seat stays only on the attendee list.
- **FR-028**: The seat map MUST NOT reveal who holds or bought a seat to anyone but admins, on the
  attendee list (`007` FR-013).
- **FR-029**: The overview map MUST draw sections, not seats; seats MUST be drawn only for the
  section zoomed into, so a 30,000-seat layout stays usable on a laptop and a phone.
- **FR-030**: Report exports and the attendee list MUST name a seated ticket's price level where
  they name a ticket type today.

**Carrying data over, demo data, and process**

- **FR-031**: Each venue that has sections before this feature MUST get one layout named
  "Standard" with those sections, rows labelled by their numbers, seats by theirs, and one price
  level per section named after it. Each seated event at that venue MUST use it, with each level
  priced at what its section sold for (its ticket type's price, or the base price without types).
  A section not mapped to a ticket type on an event with types (not sellable before this feature)
  MUST be off sale for that event; an event with types and no mapped section (nothing sellable)
  MUST become general admission, keeping its types. A carried-over ticket's price level is the name
  of the ticket type it was sold as, else its section's.
- **FR-032**: Every ticket sold before this feature MUST keep its seat, labels and price, and stay
  valid or void as it was. Every scenario of `006`, `016`, `017`, `033` and `034` MUST still pass;
  `007` and `015` scenarios pass as amended below.
- **FR-033**: The demo data and the reset command (`029`) MUST load the KFC Yum! Center's four
  layouts (Basketball 22,090 seats; End-stage concert 17,500; Center stage and Wrestling (ring) at
  our estimate) from layout files committed to the repository, made by a script from a section plan
  traced from the venue's public charts, and the four demo events of User Story 5 with sold and held
  seats. No data is taken from Ticketmaster or any other ticket seller's site.
- **FR-034**: The contract MUST be updated first (Constitution I). Removing ticket types from seated
  events and the section-to-ticket-type mapping MAY be breaking for the seating operations; every
  other change MUST be additive, and the contract's version MUST say which.
- **FR-035**: Automated tests MUST cover, against real PostgreSQL: layout and import rules, level
  resolution (seat, row, section), event prices and off-sale rules, the carry-over of existing data,
  mixed-level holds and orders, the concurrent same-seat guarantee (10 simultaneous holds or orders
  for one seat: exactly 1 succeeds), and the Admin and Customer screens; and browser tests
  (Constitution VI, `022`) MUST walk User Stories 2 and 3.
- **FR-036**: This spec MUST amend, with dated notes: `007` FR-001–FR-008, FR-017 and FR-018
  (layouts, reserved seating, section-to-type mapping, capacities); `015`'s one-ticket-type
  reservation; `033` FR-005 (ticket types while seats are held: seated events have none); and `035`'s
  Seating section.

### Key Entities

- **Layout**: one seating configuration of a venue, such as Basketball or End-stage concert; a name,
  a floor object, its sections and price levels.
- **Price level**: a group of seats of similar desirability within a layout; a name, a rank, a color.
- **Section**: a named block of rows with an outline and a place on the layout's map, and a default
  price level.
- **Row**: a labelled line of seats in a section, in order, optionally with its own price level.
- **Seat**: one physical seat with a label, a place, an optional price level of its own, and an
  accessible mark.
- **Event level price**: the price one event charges for one level of its layout.
- **Off-sale seat**: a seat one event does not sell.
- **Ticket** (changed): now points at its seat and carries its price and its seat labels as sold.
- **Hold** (changed, `015`): now points at its seat; one hold may span levels.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 seats are ever sold twice or held twice for one event, including in a test of 10
  simultaneous requests for one seat.
- **SC-002**: A customer finds a seat inside a chosen price range and holds it in under 60 seconds
  from opening a seated event, on the Yum! Center basketball layout.
- **SC-003**: On a laptop, the overview map of a 22,090-seat layout appears within 2 seconds of
  pressing Choose seats, and a section's seats within 1 second of choosing it.
- **SC-004**: When one customer holds, releases or buys a seat, a second customer and an admin
  viewing the event see it within 2 seconds, in at least 95% of trials.
- **SC-005**: An admin schedules a seated event on an imported layout, with a price for every level
  and one section and one row range off sale, in under 3 minutes.
- **SC-006**: After the carry-over, 100% of tickets sold before this feature keep their seat, label,
  price and status, and every existing seated event sells each seat at its old price.
- **SC-007**: Every seat choice that can be made on the map can be made by keyboard alone in the
  Sections list, and every seat state is told apart without color.
- **SC-008**: Two runs of the reset command end in identical layouts, events, level prices and seat
  states.

## Assumptions

- The seat-maps proposal's decisions D1–D6 take its recommended answers until John answers in Slack
  (Clarifications).
- The drawing editor (block generator, drag and rotate, price-level painting by hand) is spec `039`.
  Until it merges, a layout's row and seat level overrides come from its file.
- The Rust Admin and Customer apps (`037` and its Customer counterpart) are not changed here. Whether
  they must also get seat maps is an open question for John.
- Season tickets (Mahdi's spec) use this spec's layouts and seats; nothing here depends on them.
- Holds, the cart, the 5-minute countdown, the 2-minute wait, the hold allowance, and the purchase
  limits work as `015`, `026` and `033` define them, apart from mixing levels.
- Seats per row at the Yum! Center are not published; the generator spreads seats so each layout's
  total matches the published capacity, and the center-stage and wrestling totals are our estimate.
- Colors for price levels come from a fixed set in the shared theme (Constitution VII); a layout
  file chooses among them.
- The accessible mark on seats has no behavior until `#57`.

## Out of Scope

- The drawing editor (`039`).
- A standing pit or other general-admission area inside a seated event (D5).
- "Best available" seats, a quantity picker, and seat views from a seat (3D).
- Holds for the artist, press or sponsors; resale; prices that change with demand; price types such
  as adult and student.
- Seat maps in the Rust apps.
