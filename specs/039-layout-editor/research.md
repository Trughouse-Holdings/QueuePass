# Research: Layout Editor

**Feature**: `039-layout-editor` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Each decision gives what was chosen, why, and what was rejected. "038 Rn" is a decision of
[`038`'s research](../038-seat-maps/research.md).

## What exists

`038` (implementation PR #167, open; spec PR #166, merged) built everything the editor edits:

- **Data**: `Layout` → `PriceLevel`, `Section` → `SeatRow` → `Seat`, each a database row with its
  own id; a seat's level is `COALESCE(seat, row, section)` (038 R1). Sections have an `outline`
  (3–64 points), a label point and a `position`; seats have `x`, `y`, a `number` (order in the row)
  and a `label`. `Layout.source` is `FILE` or `LINES`.
- **Backend** `backend/src/layouts/`: `layout-file.ts` checks a layout file whole and returns up to
  50 problems with paths (038 R5); `layouts.service.ts` imports, makes and edits section lines
  keeping ids by label (`replaceLines`, `replaceRows`), renames, duplicates (`copyContent`),
  deletes, and after an edit puts new seats off sale for the scheduled events using the layout and
  recomputes or refuses each (`recomputeEvent`, 038 R6); `layout-lock.ts` locks venue → layout →
  events (038 R7). The import route alone takes a 4 MB JSON body (`configure-app.ts`).
- **Shared** `packages/shared/src/web/venue-map/`: the SVG map (`venue-map.tsx`, `section-view.tsx`),
  `map-geometry.ts` (outline paths, bounds, centroid), `use-pan-zoom.ts` (viewBox pan and zoom by
  wheel, drag, pinch, buttons and keys), `layout-preview.tsx`, the level colors in the theme (038
  R13). `LAYOUT_LIMITS` in `packages/shared/src/seating.ts`.
- **Admin app**: `LayoutsCard.tsx` on the venue page (import, section lines, rename, duplicate,
  delete, preview, the locked note); `SectionLines.tsx`. Routes are a `<BrowserRouter>` with
  `<Routes>` in `App.tsx`.
- **Contract** 2.0.0 after 038's step 2: eight layout operations, `LayoutFile`, `LayoutDetail`,
  `LAYOUT_IN_USE`, `LAYOUT_NAME_TAKEN`, `LAYOUT_FILE_INVALID`.

What is missing is any way to place a section, curve its rows, or set a row's or seat's level in
the app.

## R1. 039 builds on 038's implementation; contract 2.1.0

**Decision**: the branch `039-layout-editor-spec` sits on `038-seat-maps-impl` (PR #167) and is
rebased onto `main` once #167 merges. The contract goes **2.0.0 → 2.1.0** (MINOR, additions only):
three operations marked `x-planned: '039'`, four schemas, `DRAWN` added to `LayoutSummary.source`,
one error code, `LAYOUT_CHANGED`. The spec PR opens after #167 merges, so it is reviewed against
`main`.

**Why**: the plan names 038's files and builds on its contract after step 2; planning against
1.28.0 would describe operations step 2 removes. Additions keep `main` green (038's contracts
README, "why main stays green").

**Alternatives**: plan against `main` (1.28.0; wrong file paths and a contract that changes under
it; rejected); wait for #167 to merge before planning (loses the days before EDIS; rejected).

**`DRAWN` in a response enum**: a new value in a response is additive here: no response of `main`
sends it, and the only clients are the apps in this repository, which compile against the
regenerated types (none switches over `source` exhaustively; the Layouts card only asks
`source === 'LINES'`). `037`'s Rust Admin app reads `LayoutSummary` only once its seating parity
follows 038 (038 R22); its session is told that `source` may be `DRAWN`.

## R2. The editor draws with SVG and the shared map's shapes

**Decision**: the editor is an SVG drawn with the shared map's pieces: `outlinePath`, the floor
object, the section outline and name, and seats as circles at the same radius and with the level
colors of 038 R13. It adds its own selection rings, handles and accessible marks. Pan and zoom use
the shared `usePanZoom`. The overview draws outlines only; seats are drawn for the zoomed section
(as 038 FR-029).

**Why**: the customer map is SVG; drawing the editor from the same shapes is what makes FR-025
(the customer sees exactly what the editor showed) hold by construction. SVG gives every section,
row label and seat a focusable element with an accessible name (FR-027), which the keyboard path
needs. Sizes are small: ≤ 100 outlines in the overview, ≤ 900 seats in a Yum! Center section,
20,000 at the very most (100 × 200).

**Alternatives**: Konva or Fabric.js on a canvas, as the proposal floated (built-in selection and
transform handles, but no per-element focus or accessible names, a second rendering of the map that
can drift from the customer's, and a new dependency; rejected); PixiJS (WebGL; same objections,
more so; rejected).

## R3. Read the whole layout once, save the whole layout at once

**Decision**: two new reads and writes:

- `getLayoutDrawing` (`GET /layouts/{layoutId}/drawing`, `queuepass-admin`): the whole layout with
  every row and seat, their ids and **own** levels, each section's `origin`, `angle` and
  `generator`, the `revision`, and `locked` with `lockedBy`. Defaults are left out (a seat without
  its own level, `accessible: false`), so the Yum! Center's 22,090 seats are about 1.4 MB.
- `saveLayoutDrawing` (`PUT /layouts/{layoutId}/drawing`) and `createLayoutDrawing` (`POST
  /locations/{id}/layouts/drawing`): the whole layout as `LayoutDrawingInput`, all or nothing.
  Both take up to 4 MB, as the import route (`LAYOUT_LIMITS.maxImportBytes`); 30,000 listed seats
  with ids, labels and places rounded to 0.1 unit are about 2.6 MB.

The editor keeps the whole document in memory and sends it whole on Save.

**Why**: FR-019 asks one all-or-nothing save; FR-014's undo needs every change local until then;
the whole document is what `038`'s file checks already validate. The existing reads
(`getVenueLayout` without seats, `getVenueLayoutSection` one section at a time) would take 54
requests to open the Yum! Center and return resolved levels, not own ones.

**Alternatives**: a list of edit operations replayed on the server (each operation a new rule to
check and test, and a replay that can fail halfway; rejected); a save per section (not all or
nothing; an event could see half a change; rejected); saving through `importVenueLayout` (no ids,
so nothing is kept; no generator or angle; rejected).

## R4. What a save keeps, deletes and makes

**Decision**: identity is the **id** the editor sends back (FR-021):

- A level, section, row or seat sent with an id is kept, whatever changed about it; one without an
  id is new; anything of the layout not sent is deleted (its prices and off-sale entries with it,
  by the existing cascades).
- An id must be of this layout, and a row or seat must come under the section or row it belongs to;
  the editor never moves a row or seat between sections (Duplicate section makes new ones). A
  breach is a problem in the `LAYOUT_FILE_INVALID` list.
- **Numbers come from order**: rows `1…n` front first, seats `1…n` in the order sent (the editor
  sends each row left to right as seen from the floor). Numbers of kept rows and seats may change;
  that is safe because the layout is unlocked (no ticket or hold points at a seat by number, and
  off-sale entries point at the seat id), and viewers' maps reload when the stream ends.
- `source`: a `LINES` layout becomes `DRAWN` (FR-003, so section lines can't put it back in a
  grid); `FILE` and `DRAWN` stay. Section lines remain only for `LINES` (038 R6 unchanged).

**Why**: keeping by id, not by label as 038's lines do, is what lets an admin rename "AA" to "A1"
or move a section without losing an event's off-sale seats (US3).

**Alternatives**: keep by label (a relabel or a move between rows loses identity; rejected);
renumber only new seats past the highest number (numbers stop meaning order, and the Sections list
sorts by number; rejected).

## R5. The Backend draws outlines and sizes the map

**Decision**: the editor sends seats, not outlines or a size. On every save the Backend:

- draws each section's **outline** around its seats with `outlineAround(rows)` from a new pure
  module, `packages/shared/src/layout-geometry.ts`: the first seat of each row front to back, then
  the last seat of each row back to front, pushed out 1.5 units (half a seat gap plus the seat's
  radius), so curved blocks and rows of different lengths get a snug outline; with more than 31 rows
  it keeps the front row, the back row and evenly spaced rows between, to stay within 64 points; a
  one-row section gets a rectangle around its row; then the name at the outline's centroid
  (038's `centroid`);
- sizes the map: `width`/`height` = the largest `x`/`y` of any seat, outline point or floor point,
  plus 10, at most 5,000. Every place must be from 0 to 5,000; the editor keeps that true by moving
  everything right or down when something is dragged past the top or left edge (FR-005).

The editor calls the same `outlineAround` to draw outlines live.

**Why**: Constitution IV: what the customer sees is decided by the Backend, not trusted from the
browser; one function in shared code means the editor's outline and the saved one are the same
(FR-025). The admin never draws outlines (FR-008).

**Alternatives**: convex hull (covers the hollow inside of a curved block and reaches into the
next section; rejected); trusting the editor's outline (a buggy or old editor could save a wrong
map; rejected).

## R6. A section has a place and an angle

**Decision**: `Section` gains `originX`, `originY` and `angle` (degrees clockwise, -180 to 180):
the point it moves and turns about and how far the editor has turned it. Moving adds the same
offset to the origin, every seat and the outline; turning by `d` turns every seat and outline point
about the origin and adds `d` to the angle (normalized). The Selection panel shows and takes the
origin and angle (FR-011); typing an angle turns by the difference.

- A **generated** section's origin is the middle of its front row (R7), so Regenerate rebuilds the
  block in place.
- An **imported**, **section-line** or **carried-over** section gets origin = its label point
  (the outline's centroid unless the file says) and angle 0, by the migration for existing rows
  and by import, lines and duplicate from then on.

**Why**: Regenerate (FR-009) needs to know where the block sits and how it is turned; the Selection
panel needs a place and an angle to show (US5). A transform kept beside absolute seat places means
every reader of seats (the customer map, holds, the venue map counts) is unchanged.

**Alternatives**: store seats relative to the section and a transform (every seat reader in 038
would have to apply it; rejected); work the transform out from two kept seats on Regenerate (fails
when the admin relabels or deletes those seats; rejected).

## R7. The block generator

**Decision**: `generateBlock(values)` in `layout-geometry.ts`, pure, with `SectionGenerator`'s
values (contract):

- **Local frame**: the origin is the middle of the front row; rows go back toward `-y`, so at angle
  0 the block faces down the map (its floor below it). Seats are 2 units apart and rows 2 units
  apart (038's standard spacing, 038 R6).
- **Straight** (`curve: 0`): row `k` (0 = front) of `n` seats has seat `i` at
  `x = (i − (n − 1) / 2) × 2`, `y = −2k`: each row centered on the one in front (FR-007).
- **Curved** (`curve` = the front row's arc in degrees, 1–120): rows are arcs about one center
  `(0, R₀)` on the floor side, `R₀ = 2 (n₀ − 1) / curve` in radians (at least 2); row `k` has radius
  `R₀ + 2k` and its seats 2 units apart along it, centered on the axis. Presets in the form: none
  (0), slight (20), medium (40), strong (60), or a number.
- **Row labels**: letters run A … Z, AA … ZZ, AAA … ZZZ, AAAA …, starting at `firstRow` (which must
  be in that sequence: one letter repeated); numbers run from `firstRow` (a whole number) up.
- **Seat labels**: `firstSeat`, `firstSeat + 1`, … ; `LEFT_TO_RIGHT` as seen from the floor is
  increasing `x` at angle 0 (a person on the floor facing the block has `−x` on their left). Seats
  are always listed left to right; only the labels follow `direction`.
- **Limits**: 1–100 rows, 1–200 seats a row, and the layout's 30,000; the form refuses more before
  generating, naming the limit and showing the seats left (FR-017, edge case "Limits").
- **New section**: placed with its origin at the middle of the visible map, angle 0, in the chosen
  level, and selected (FR-007).
- **Regenerate**: generate from the new values in the section's place (origin and angle); a row is
  kept when its label is still generated (its id and own level stay), and a seat when its row is
  kept and its label is still in that row; the rest are new. Before applying, the editor counts the
  seats that would go, and asks when there are any (FR-009). Labels the admin changed by hand are
  not in the generated set, so Regenerate warns that it will replace them.

**Why**: arena bowl sections are curved blocks of rows (proposal, D1 A); concentric arcs with a
fixed seat gap make back rows longer when seat counts grow, as real bowls do, and match the R5
outline. Keeping by label on Regenerate is the only identity a rebuilt block can have.

**Alternatives**: a curve as a radius (hard for an admin to guess; rejected); rows that fan out by
keeping the same angle per seat (seats spread apart toward the back; rejected).

## R8. One transaction per save, in 038's lock order

**Decision**: `saveLayoutDrawing` in `layouts.service.ts`, one transaction (`LOCKING_TX`, as
`update`):

1. `lockLayout` (venue `FOR UPDATE` → layout → the scheduled events using it, 038 R7).
2. `revision` must equal the layout's (`409 LAYOUT_CHANGED`, R9); the layout must not be locked
   (`assertUnlocked`, `409 LAYOUT_IN_USE`); the name free (`assertNameFree`).
3. Check the body whole (R16): limits, names, labels, keys, ids and their parents, places.
4. `SET CONSTRAINTS` the per-row unique constraints `DEFERRED` (data-model: the migration makes
   `seat_row_number_unique`, `seat_row_label_unique`, `seat_number_unique`, `seat_label_unique`,
   `price_level_rank_unique` and `Section_layoutId_position_key` deferrable, initially immediate),
   so swapped labels, numbers, ranks and positions are checked once, at commit.
5. Delete the seats, rows, sections and levels not sent.
6. Kept sections and levels whose name changes take a parked name first (`\u0001` + id, which no
   checked name can be, since names refuse control characters), because their case-insensitive
   name indexes are expressions and can't be deferred.
7. Update kept levels, sections, rows and seats in bulk (`UPDATE … FROM unnest(…)`, one statement
   per table, as `replaceRows` moves seats); insert new ones in batches (`insertBatches`,
   `createMany` of 5,000).
8. The layout: name, floor, size, `seatCount`, `source`, `revision + 1`.
9. The events: a helper `afterLayoutChange(tx, layoutName, newSeatIds, eventIds)`, extracted from
   `replaceLines` so both use it: new seats off sale for each event, `recomputeEvent`, refuse with
   `409 LAYOUT_IN_USE` naming each event and why (FR-022).
10. `setCapacity`; after commit, `seatEvents.end` for each event (viewers reload).

`createLayoutDrawing` is steps 3, 7 (inserts only), 8 and 10 with `lockVenue`, as `importFile`.
**Save as a new layout** (FR-023, FR-024) is a `createLayoutDrawing` of the same body.

**Why**: the lock order is 038's, so no deadlock with event saves, holds and orders; a hold that
races a save either commits first (the save then finds the layout locked) or waits on the event row
and finds its seat gone or kept. Deferrable constraints keep the save to a few statements, which is
what a 22,090-seat save in under 5 seconds needs (SC-003).

**Alternatives**: park every changed label, number and rank as `moveRanks` and `PARKED_POSITION`
do (labels are at most 5 characters and numbers have CHECK ranges, so there is no room to park
22,090 seats; rejected); delete and re-insert every seat with the same ids (cascades delete the
events' off-sale entries and void tickets' seat links; rejected).

## R9. Revision, locks while editing, and two editors

**Decision**: `Layout.revision` (integer, starts at 1) goes up by one with **every** change to a
layout: a rename, a lines edit, a drawing save (038's `update` gains the increment).
`getLayoutDrawing` returns it; `saveLayoutDrawing` requires it and refuses a stale one with `409
LAYOUT_CHANGED`, `details.revision`. The editor then offers **Save as a new layout** (a name box
filled with "<name> (copy)") or **Reload** (after confirming that the changes go). A layout that
became locked while open is refused with `409 LAYOUT_IN_USE`, and the editor offers Save as a new
layout too (FR-023). A refused save never changes the editor's document (FR-019).

**Why**: FR-024 without live co-editing; an integer is exact where `updatedAt` could tie.

**Alternatives**: `updatedAt` as the version (millisecond ties, and Prisma's `@updatedAt` moves on
unrelated writes; rejected); a lock held while an admin edits (abandoned tabs keep it; rejected).

## R10. The editor's state: one document, one reducer, history

**Decision**: `admin-app/src/layout-editor/editor-doc.ts` holds the document (name, floor, levels,
sections → rows → seats, each with its id or a temporary `new:<n>` id) and converts
`LayoutDrawing` → document → `LayoutDrawingInput` (levels keyed `l1`…`l12`, new ids left out, places
rounded to 0.1). `editor-state.ts` is a pure reducer over `{ doc, selection, history }`:

- every change is an action (`addSection`, `moveSections`, `turnSections`, `regenerate`,
  `duplicateSection`, `deleteSeats`, `relabel`, `markAccessible`, `paint`, `clearLevel`,
  `addLevel`, `renameLevel`, `recolorLevel`, `moveLevel`, `deleteLevel`, `setFloor`, `rename`);
- a change replaces only the section it touches (structural sharing), so **history** keeps the last
  100 documents cheaply; Undo and Redo move through it (FR-014: at least 50); a new change after an
  Undo drops the redo side;
- `dirty` compares the document with the one last loaded or saved; `totals` (seats per level,
  sections, seats left) are derived from the document (FR-017).

**Why**: a pure reducer is tested without a browser, seat by seat; whole-document history makes
Undo trivially right for every action.

**Alternatives**: inverse operations per action (each needs its own inverse and tests; rejected);
a state library (none in the apps; nothing needs it; rejected, Constitution VIII).

## R11. Pointer, keyboard and screen reader

**Decision** (FR-011, FR-012, FR-026, FR-027):

- **Overview**: click selects a section, Shift-click adds or removes; dragging a selected section
  moves the selection; a round handle above the selection turns it (1° steps, Shift for 15°).
  While dragging, the editor moves the drawn group with an SVG `transform` and applies the move to
  the document once, on release (one action, one Undo step). Dragging empty space pans (shared
  `usePanZoom`); scroll and pinch zoom. Double-click or Enter on a section zooms into it.
- **Floor object**: selected like a section; dragged to move; four corner handles resize its
  rectangle. A floor imported as another polygon moves and resizes by its bounds.
- **Zoomed section**: click selects a seat, Shift-click adds; a **Box select** toggle makes dragging
  draw a selection box (otherwise dragging pans); clicking a row label selects the row; Shift-click
  on another row label selects the range. **Back to layout** returns to the overview.
- **Keyboard**: the Sections list selects sections; with the map focused, arrow keys move the
  selection 1 unit (Shift 10), `[` and `]` turn it 1° (Shift 15°), Delete deletes after
  confirming, Escape clears the selection, Cmd/Ctrl+Z undoes and Shift+Cmd/Ctrl+Z or Ctrl+Y redoes.
  In the Selection panel, rows and seats of the chosen section are checkbox lists (a row's seats
  open under it) with the same actions as on the map.
- **Status line**: a polite live region announces each change ("Section 104 moved", "Rows A–D
  painted Courtside", "Undone: section 104 moved").

**Why**: pointer for speed, typed values and lists for exactness and for keyboard users
(Constitution VII); one action per drag keeps Undo sensible.

**Alternatives**: free-form drag with no typed values (fails US5; rejected); a separate keyboard
mode (two ways to keep in step; rejected).

## R12. Levels and painting

**Decision**: the Levels panel lists levels best first with a color swatch, name and seats (resolved
counts from the document). **Add level** (to 12) takes a name and one of the 12 colors not yet used
(any, once all are used); rename and recolor in place; **Move up**/**Move down** buttons reorder
(dragging the list is not added: buttons are keyboard-usable and enough for 12 items). **Delete**
asks for the level its seats take instead (sections, rows and seats that name it are repointed;
row and seat overrides equal to their parent's level are cleared); the last level can't be deleted.
The selection's level is chosen where the selection is shown: the Selection panel's **Price level**
box shows the level the selected sections, rows or seats have ("Mixed" when they differ), and
choosing another sets it on them at once (one Undo step): sections (their level), rows (their own
level), seats (their own level). For rows and seats its first choice, **Same as the section** or
**Same as the row**, clears their own levels. A new layout starts with one level, "Standard",
violet.

*Amended 2026-11-14 (Nate's walk, "the Paint: Standard makes no sense")*: this replaces a radio
per level in the Levels panel and a separate **Paint: <level>** button (and **Use section's
level**); the Levels panel only manages levels. FR-016 is unchanged.

**Why**: FR-015, FR-016; repointing on delete keeps every seat with a level (038 FR-003).

**Alternatives**: deleting a level drops overrides to the parent (a section using it would have
none; rejected); paint by click-to-paint mode without selection (no keyboard path; rejected).

## R13. Leaving with unsaved changes

**Decision**: the Admin app moves from `<BrowserRouter>` to a data router (`createBrowserRouter`
with the same routes, in `main.tsx`/`App.tsx`), so the editor can use React Router's `useBlocker`
to confirm before leaving by any link, and adds a `beforeunload` handler while dirty for reloads
and closing the tab (FR-001 US1 scenario 7).

**Why**: `useBlocker` works only under a data router; without it the top bar's links would leave
silently. The change is one file's routing; page tests keep their `MemoryRouter`, and the editor's
tests use `createMemoryRouter`.

**Alternatives**: a capture-phase click listener on every link (misses back/forward and programmatic
navigation; rejected); confirming only on the editor's own Back button (the top bar still leaves
silently; rejected).

## R14. Screens and routes

**Decision**:

- **Routes**: `/locations/:id/layouts/new` and `/locations/:id/layouts/:layoutId/edit`, full width
  under the top bar.
- **Layouts card** (038 R15): **New layout** (beside Import and section lines) and, per layout,
  **Edit** (unlocked) or **View** (locked). The editor on a locked layout is read-only with the
  note "Locked: seats are sold or held at <events>" and **Duplicate to edit** (calls
  `duplicateVenueLayout`, then opens the copy) (FR-002).
- **Editor page**: a toolbar (name box, Undo, Redo, Box select, zoom buttons, Save); the map; a side
  column with three panels: **Levels** (R12), **Sections** (list, Add section, Duplicate, Delete,
  totals), **Selection** (place, angle, generator values with Regenerate for one generated section,
  name, labels, accessible). Save opens the warnings list when there are any (R15).
- **Phone width** (≤ 640px, the theme's breakpoint): the layout's preview (shared `LayoutPreview`)
  and "Editing a layout needs a wider screen" (FR-004).

**Why**: one full page leaves the map room; the panels map one to one to the spec's stories.

**Alternatives**: a modal over the venue page (cramped; no unsaved guard by route; rejected).

## R15. Warnings before saving

**Decision**: on Save, the editor lists, without blocking: **overlapping sections**, where a seat
of one section is closer than 1.5 units to a seat of another (checked only for pairs whose outlines'
bounds overlap, with a 2-unit grid of seats; well under 100 ms for 22,090 seats), each drawn with a
warning outline on the map; and **levels with no seats**. The list has **Save anyway** and **Go
back**. Refusals (R16) are not warnings.

**Why**: FR-020: an outline may only approximate a real section, so overlap is the admin's call.

**Alternatives**: refuse overlaps (blocks legitimate tight layouts; rejected); check on the Backend
(a warning has no place in an all-or-nothing API; rejected).

## R16. One set of checks; refusals placed where the problem is

**Decision**: the Backend checks a drawing with the checks `layout-file.ts` already has for a file
(names 1–50 and unique ignoring case, labels 1–5 and unique in their row or section, keys, limits,
places), factored into functions both use, plus the drawing's own: ids of this layout under their
right parent, a `revision` on save, no control characters in names and labels. Problems come back
as `400 LAYOUT_FILE_INVALID` with up to 50 `{ path, message }`, paths into the body
(`sections[12].rows[2].seats[6].label`). The editor maps a path's section index to its section,
selects it and shows the message beside the field or on the map (FR-019). The editor checks the
same limits and uniqueness as the admin types (shared `LAYOUT_LIMITS`), so a refusal from the
Backend is rare.

**Why**: Constitution IV (the Backend decides), one set of rules for files and drawings, and the
admin sees each problem where it is.

**Alternatives**: a new error code for drawings (the same problems under two names; rejected).

## R17. Tests (Constitution VI; written first, seen to fail)

- **Shared** (`layout-geometry.test.ts`): `generateBlock` seat by seat for straight, curved and
  mixed-length blocks, both directions, letter and number labels across Z→AA and 99→100, the limits;
  `outlineAround` (snug, ≤ 64 points, one-row and 100-row sections); move and turn.
- **Backend** (Testcontainers PostgreSQL): `layouts.drawing.e2e-spec.ts`: create and save, every
  limit on both sides, names and labels, ids under the wrong parent, places out of range, outline
  and size computed, numbers from order, kept ids across move, relabel, repaint and swap (two rows
  exchanging labels, two levels exchanging ranks and names), `LINES` → `DRAWN`, new seats off sale
  and every refusal of FR-022, `LAYOUT_CHANGED`, `LAYOUT_IN_USE`, rename raising the revision, 4 MB;
  `layouts.drawing.concurrency.e2e-spec.ts`: a save and 10 holds on one event at once (each hold
  either succeeds before the save, which is then refused, or fails); `layouts.authz.e2e-spec.ts`
  for the three operations; `migration.layout-editor.e2e-spec.ts`: origins and angles filled,
  constraints deferrable; the 22,090-seat Yum! Center basketball layout read and saved within the
  SC-003 times.
- **Admin** (Vitest, React Testing Library): `editor-state.test.ts` for every action and Undo/Redo;
  `editor-doc.test.ts` round trips; component tests for the generator form, Levels panel, Selection
  panel, Sections list, keyboard moves and turns, the status line, warnings, each refusal, the
  unsaved-changes guard, read-only and phone width; `LayoutsCard` New layout, Edit and View.
- **Browser** (`e2e/tests/039-layout-editor.spec.ts`, `022`): User Story 1 (draw, place, turn,
  save, the customer map shows it) and User Story 2 (levels, paint section, rows and seats, totals,
  reopen); quickstart's Automation table.
- 80% line coverage per workspace, as every feature.

## R18. Spec and documentation changes in this PR

- `038`'s spec: dated notes on FR-006 (any unlocked layout can be edited, in the editor), the
  Assumption that row and seat levels come only from a file, and research R6 (an imported layout
  is edited in `039`'s editor) (FR-030).
- Constitution: no change (row `039` was reserved by `038`).
- README: the `039` row and the editor in the Admin app's list (implementation).
- A GitHub issue for 039, before the PR (Constitution III).

## R19. Order of work

1. Contract 2.1.0 (this PR); migration (origin, angle, generator, revision, `DRAWN`, deferrable
   constraints) with its test.
2. `layout-geometry.ts` (generator, outline, transforms) with its tests.
3. Backend: `getLayoutDrawing`, checks, `createLayoutDrawing`, `saveLayoutDrawing`,
   `afterLayoutChange`, revision on `update`, import/lines/duplicate writing origin and angle.
4. Admin: data router; `editor-doc.ts`, `editor-state.ts`; the editor page and panels; the Layouts
   card's buttons.
5. Browser tests for US1 and US2; quickstart's Automation table; README; review; walk; PR.
