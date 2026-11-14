---
description: "Task list for Layout Editor: Draw, Arrange and Price a Venue Layout"
---

# Tasks: Layout Editor: Draw, Arrange and Price a Venue Layout

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R19),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (contract 2.1.0),
[quickstart.md](./quickstart.md) (S1–S14)

**Issue**: #168, filed before the spec PR opens (Constitution III). Below, `#N` means #168.
The implementation PR's **description** says `fixes #N` on its own line. No
commit message on either branch may contain "fixes #N", "closes #N", or "resolves #N".

**Tests**: **REQUIRED and written first** (Constitution VI, FR-029). In every phase, write its test
tasks and confirm they **fail** before its implementation tasks.

**Where tests live**: each workspace runs tests only from its `test/` folder (`vitest.config.ts`
`include: test/**`; the Backend's Jest `test/integration`, `test/unit`). So the shared tests are in
`packages/shared/test/`, the editor's in `admin-app/test/layout-editor/`, the Layouts card's in
`admin-app/test/layouts-card.test.tsx`, and Backend helpers in `backend/test/setup/`. A test named
below by file name alone (`editor-state.test.ts`, `SaveBar.test.tsx`) is in
`admin-app/test/layout-editor/`.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `039-layout-editor-impl` in a Claude
  session that starts from these files only. Cut it from `039-layout-editor-spec`; once the spec PR
  merges, bring it up to `main`. A gap in the spec or plan is fixed there (a commit on the spec
  branch), not worked around in code.
- **038 first** (research R1): this feature builds on `038`'s implementation (PR #167). Do not
  start until #167 has merged and the spec branch has been rebased onto `main`; if #167 changed
  anything this plan names (a function, a file, the contract), fix the plan on the spec branch first.
- **Commits** cite the spec, the task IDs and the issue: `Impl 039: block generator (T030–T032,
  #N)`. The body names the FR or R it rests on.
- **Contract**: 2.1.0 and `api-schema.ts` come from the spec PR. The implementation changes the
  contract only to remove each `x-planned: '039'` marker in the change that serves its route
  (T012), then regenerates `api-schema.ts` (`npm run generate:api`). Anything else it finds it needs
  goes to the spec PR first.
- **Shared surface the implementation touches** (every member approves the PR): `backend/prisma/`,
  `packages/shared/src/layout-geometry.ts` and its export in `packages/shared/src/index.ts`,
  `contracts/openapi.yaml` (markers only), `api-schema.ts`.
- **Lock order** (038 R7, 039 R8): **the venue first, always.** A drawing save uses `lockLayout`
  (venue `FOR UPDATE`, then the layout, then its scheduled events by id); a drawing create uses
  `lockVenue`. Never lock an event before its venue.
- **`037`** (Rust Admin app): tell its session (through Nate) that `LayoutSummary.source` may now be
  `DRAWN` (research R1) when this PR opens (T060).
- **One independent review** (Constitution III) of the implementation branch before its PR (T061).
- **`npm run ci` locally** before pushing (T058), then **CI green on GitHub** (`test` and `e2e`)
  before merge (T063).
- **The team stack** (Compose project `queuepass-team`) holds the fixed ports and the team's data.
  Walk on a Compose project of your own (`-p qp039`); stop the team stack only with Mahdi's go, with
  `docker compose -p queuepass-team stop` (never `down`, never `-v`), and restore it afterwards.
- **Not needed for EDIS** (2026-11-20): `038` carries the demo. The MVP is Phases 1–4 (US1 and US2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [X] T001 Cut `039-layout-editor-impl` from `039-layout-editor-spec` (rebased onto `main` after
  #167 merged); `npm ci`; `npx prisma generate` in `backend/`; `npm run ci` green before any change,
  so a later failure is this feature's. Record any test that already fails on the untouched branch
  (038's T001 and T058 saw `rate-limits.buy.e2e-spec.ts` "lets another account buy while one sends
  200" fail with `connect ECONNRESET` on this Mac; if it does, run the remaining workspaces' tests by
  hand and record them).
  **Done 2026-11-14**: on the untouched branch, `npm run ci` failed in the Backend with two
  suites: `rate-limits.buy.e2e-spec.ts` (`connect ECONNRESET`, as 038 saw) and
  `layouts.authz.e2e-spec.ts`, which listed 039's three `x-planned` operations; the latter was
  a spec-branch defect, fixed there (commit "Plan 039: keep 038's layouts.authz table…").
  Every other workspace passed.
- [X] T002 [P] Test helpers in `backend/test/setup/layout-drawing.ts`: `drawingToInput(drawing:
  LayoutDrawing): LayoutDrawingInput` (levels keyed by their id, which matches the key pattern
  `^[a-z0-9-]{1,40}$`; every id kept; `revision` copied; `origin`, `angle`, `generator` copied;
  row and seat `level` from their own `levelId` when present); `newDrawing()`: a `LayoutDrawingInput`
  named "Drawn", floor `COURT` with a rectangle outline, levels `a` "Front" (red) and `b` "Back"
  (teal), and three sections: "101" straight 3 rows × 4 seats, "102" curved 4 rows (seats 4, 4, 6, 6),
  "103" one row of 5 seats, with one row-level override (`a`) and one seat-level override (`b`) and
  one `accessible` seat, places worked out by hand (not by `generateBlock`, which comes in US1), all
  from 20 to 200 units. Document both in the file's header comment.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the schema, the geometry the Backend needs, the three operations, the data router, and
the editor's document, state and page shell that every story builds on.

### Tests first

- [X] T003 [P] `backend/test/integration/migration.layout-editor.e2e-spec.ts` on the pattern of
  `migration.seat-maps.e2e-spec.ts` (a fresh database migrated to the migration before
  `_layout_editor`, rows inserted with SQL, then the migration). Before: a venue with an imported
  layout of two sections (label points (50, 60) and (150, 60)) and a carried-over "Standard" layout.
  After: every `Layout.revision` = 1; every section's `originX`, `originY` = its `labelX`, `labelY`
  and `angle` = 0 and `generator` IS NULL; `'DRAWN'` is a value of `"LayoutSource"`; each of
  `price_level_rank_unique`, `Section_layoutId_position_key`, `seat_row_number_unique`,
  `seat_row_label_unique`, `seat_number_unique`, `seat_label_unique` is in `pg_constraint` with
  `contype = 'u'`, `condeferrable = true`, `condeferred = false`; swapping two rows' labels in one
  transaction fails without, and commits after, `SET CONSTRAINTS seat_row_label_unique DEFERRED`;
  the CHECKs refuse `angle = -180`, accept `angle = 180`, refuse `originX = 5001` and
  `originY = -1`, refuse `revision = 0`, refuse `generator = '[]'::jsonb`.
- [X] T004 [P] `packages/shared/test/layout-geometry.test.ts` (R5, R6): `outlineAround(rows)` for a
  3 × 4 straight block is the first seats front to back then the last seats back to front, each
  pushed out 1.5 units, in order, closed; for a curved block it hugs the arcs (no point inside the
  hollow of the curve: every outline point is within 1.5 units + 1e-6 of some seat); for rows of
  different lengths it follows each row's ends; for 100 rows it has at most 64 points and includes
  the front and back rows' ends; a one-row section gives a 4-point rectangle 1.5 units around the
  row; a one-seat section a 4-point square. `moveBy(points, dx, dy)`; `turnAbout(points, origin,
  degrees)` (90° clockwise with `y` down maps (1, 0) about (0, 0) to (0, 1)); `normalizeAngle`
  returns values in `(-180, 180]` (`-180` → `180`, `190` → `-170`, `360` → `0`).
- [X] T005 [P] `backend/test/integration/layouts.drawing.e2e-spec.ts` (FR-019–FR-024, R3–R5, R8, R9,
  R16), against Testcontainers PostgreSQL, using T002's helpers:
  - **Read**: `getLayoutDrawing` of an imported `small.json` returns `revision` 1, `locked: false`,
    `lockedBy: []`, every row and seat with its id, own `levelId` only where the file set one,
    `accessible` only where true, each section's `origin` = its label point and `angle` 0 and
    `generator: null`; of a layout an event with a valid ticket uses: `locked: true`, `lockedBy`
    names that event.
  - **Create**: `createLayoutDrawing` of `newDrawing()` → 201 `LayoutDetail`, `source: 'DRAWN'`,
    `seatCount` 37 (T002's sections: 12 + 20 + 5; "31" here first was a miscount), 3 sections, 2 levels; each outline equals `outlineAround` of its seats; the label
    point is the outline's centroid; `size` = the largest `x`/`y` of seats, outlines and floor + 10;
    rows numbered 1…n and seats 1…m in the order sent; ids and `revision` in the body are ignored.
  - **Limits, both sides**: 100 sections OK / 101 refused; 100 rows / 101; 200 seats in a row /
    201; 30,000 seats / 30,001; 12 levels / 13; a name of 50 / 51 characters; a label of 5 / 6; each
    refusal `400 LAYOUT_FILE_INVALID` with a `path` into the body and nothing saved.
  - **Problems**: two sections "104" and "104 " → after trim the same ignoring case; a row label
    repeated in a section; a seat label repeated in a row; a level key not in `levels`; a place of
    -0.1 and of 5,000.1; a name with a control character (`"A\u0001"`); up to 50 problems listed and
    `details.more` counting the rest.
  - **Save keeps by id** (R4): read, then save with section "101" moved by (+10, +5) and turned 15°,
    its row "B" relabelled "BB", a seat repainted to `b`, a level renamed: every id the same after;
    two rows of a section exchanging labels ("A" ↔ "B"), two levels exchanging ranks and names, and
    two sections exchanging names, each in one save: committed; a seat not sent is deleted and one
    sent without an id is new; numbers follow the order sent.
  - **Ids**: an id of another layout, a row id sent under another section, a seat id under another
    row → `400 LAYOUT_FILE_INVALID` naming the path.
  - **Revision and source**: a save raises `revision` by one; a save with the old `revision` →
    `409 LAYOUT_CHANGED`, `details.revision` = the current one, nothing saved; `revision` missing →
    `400`; a `LINES` layout saved becomes `DRAWN`; a `FILE` layout stays `FILE`; a rename by
    `updateVenueLayout` raises `revision`.
  - **Locked**: a layout used by a scheduled event with a valid ticket, or a live hold → `409
    LAYOUT_IN_USE` naming the event; a cancelled event's void ticket does not lock it.
  - **Events on the layout** (FR-021, FR-022): with a scheduled event using the layout, every level
    priced and one seat off sale, no sales: a save that moves and relabels keeps its prices and its
    off-sale seat; a new seat is off sale for it and its `totalTicketCapacity` and `basePrice` are
    recomputed; deleting the off-sale seat deletes the entry; deleting a level deletes its price; a
    save that paints a kept section a new level the event has no price for, or deletes every seat
    on sale, or leaves `maxTicketsPerCustomer` above its seats on sale → `409 LAYOUT_IN_USE`, the
    message naming the event and why, nothing saved.
  - **Capacity**: a save that lowers the venue's largest layout below a scheduled general-admission
    event's capacity → `409 CAPACITY_EXCEEDED`.
  - **Body size**: a 3.9 MB body is accepted on both drawing write routes; a 4.1 MB body is `413`;
    other routes keep the default limit.
- [X] T006 [P] `backend/test/integration/layouts.authz.e2e-spec.ts`: add `getLayoutDrawing`,
  `saveLayoutDrawing` and `createLayoutDrawing` to its table (missing, expired, wrong-signed,
  wrong-audience token → 401; a `customer` or `gate-agent` token → 403; `queuepass-admin` → not 401
  or 403), as for 038's operations.

### Implementation

- [X] T007 Migration `backend/prisma/migrations/<timestamp>_layout_editor/migration.sql`,
  hand-written, and `backend/prisma/schema.prisma` (data-model.md):
  - `ALTER TYPE "LayoutSource" ADD VALUE 'DRAWN'`; `enum LayoutSource { FILE LINES DRAWN }`.
  - `Layout.revision` "INT NOT NULL DEFAULT 1, CHECK ≥ 1" (`layout_revision_positive`).
  - `Section.originX`, `originY` "REAL NOT NULL … 0–5,000 (CHECK)", filled from `labelX`,
    `labelY` (add nullable, `UPDATE`, then `SET NOT NULL`); `Section.angle` "REAL NOT NULL DEFAULT 0,
    CHECK `angle > -180 AND angle <= 180`"; `Section.generator` "JSONB, nullable … CHECK
    `generator IS NULL OR jsonb_typeof(generator) = 'object'`".
  - For each of the six names in data-model.md's table: `DROP INDEX "<name>"` then `ALTER TABLE …
    ADD CONSTRAINT "<name>" UNIQUE (…) DEFERRABLE INITIALLY IMMEDIATE`; `schema.prisma`'s
    `@@unique` lines keep their `map:` names.
  - Run T003; it passes.
- [X] T008 Write origin and angle everywhere a section is made, in `backend/src/layouts/
  layouts.service.ts` (`insertContent`, `copyContent`, the lines insert in `replaceLines`) and
  `layout-lines.ts`: a new section's `originX`, `originY` = its label point and `angle` = 0;
  `copyContent` (duplicate) copies `originX`, `originY`, `angle`, `generator`; a kept section in a
  lines edit gets its new label point as origin. `update` (rename or lines) raises `revision` by one
  in its transaction. Every existing `layouts`, `migration.seat-maps` and `demo-data` test still
  passes.
- [X] T009 [P] `packages/shared/src/layout-geometry.ts` (R5, R6): `outlineAround`, `moveBy`,
  `turnAbout`, `normalizeAngle`, and the constants `SEAT_GAP = 2`, `ROW_GAP = 2`,
  `OUTLINE_MARGIN = 1.5`, `SIZE_MARGIN = 10`; pure, no DOM; exported from
  `packages/shared/src/index.ts`. Run T004; it passes.
- [X] T010 Checks (R16) in `backend/src/layouts/`: factor `layout-file.ts`'s name, label, key,
  limit and place checks into functions taking a path prefix, used by the file import unchanged
  (its tests still pass); new `layout-drawing.ts` with `checkDrawing(body, existing | null)`: those
  checks over a `LayoutDrawingInput`, places from 0 to 5,000, no control characters
  (`/[\u0000-\u001f\u007f]/`) in names and labels, and with `existing` (the layout's current ids by
  kind and parent) every id of this layout, of the right kind and under its own parent; up to 50
  `{ path, message }` problems, messages naming section, row and seat as 038's do
  ("Section 104, row F: seat 7 appears twice").
- [X] T011 DTOs `backend/src/layouts/dto/layout-drawing.dto.ts` (`LayoutDrawingInput` with
  class-validator, `forbidNonWhitelisted` as every DTO; `SectionGenerator` as in the contract);
  `layouts.controller.ts` routes `GET /layouts/:layoutId/drawing`, `PUT /layouts/:layoutId/drawing`,
  `POST /locations/:id/layouts/drawing`, each `@Roles('queuepass-admin')`; `configure-app.ts`: the
  4 MB JSON parser (`LAYOUT_LIMITS.maxImportBytes`) also on `PUT /layouts/:layoutId/drawing` and
  `POST /locations/:id/layouts/drawing`.
- [X] T012 Contract markers: remove `x-planned: '039'` from `getLayoutDrawing`, `saveLayoutDrawing`
  and `createLayoutDrawing` in `contracts/openapi.yaml`; `npm run generate:api`;
  `node scripts/check-contract-drift.mjs` passes; the route-coverage test now expects the routes
  served.
- [X] T013 `LayoutsService.drawing(layoutId)` in `layouts.service.ts` → `LayoutDrawing` (R3): one
  query for levels, one for sections, one for rows and seats ordered by section position, row
  number, seat number; own `levelId` on rows and seats only when set; `accessible` only when true;
  `locked` and `lockedBy` from the same query `assertUnlocked` uses (scheduled events with valid
  tickets or live holds); 404 for an unknown layout.
- [X] T014 `LayoutsService.createDrawing(locationId, body)` (R8): `lockVenue`; `checkDrawing(body,
  null)`; `assertNameFree`; outlines from `outlineAround`, label points from `centroid`, size from
  the largest `x`/`y` + `SIZE_MARGIN`; insert levels (ranks 1…n by order), sections (`position` by
  order, origin, angle, generator), rows and seats (numbers by order) with `insertBatches`;
  `source: 'DRAWN'`, `revision: 1`, `seatCount`; `setCapacity`; return `detail`.
- [X] T015 `LayoutsService.saveDrawing(layoutId, body)` (R8 steps 1–10): `lockLayout`; `revision`
  check (`409 LAYOUT_CHANGED`, `details: { revision }`, message "<name> was changed since you
  opened it; nothing was saved."); `assertUnlocked`; `assertNameFree`; `checkDrawing(body,
  existing)`; `SET CONSTRAINTS` the six DEFERRED; delete what is not sent (seats, rows, sections,
  levels); park changing section and level names as `'\u0001' || id`; bulk-update kept levels,
  sections, rows, seats with `UPDATE … FROM unnest(…)`; insert new ones; the layout's name, floor,
  size, `seatCount`, `source` (`LINES` → `DRAWN`), `revision + 1`. Extract
  `afterLayoutChange(tx, layoutName, newSeatIds, eventIds)` from `replaceLines` (new seats off sale,
  `recomputeEvent`, the `LAYOUT_IN_USE` refusal) and call it from both; `setCapacity`; after commit
  `seatEvents.end` for each event. Run T005 and T006; they pass.
- [X] T016 [P] Admin data router (R13): `admin-app/src/main.tsx` builds the router with
  `createBrowserRouter` from the routes `App.tsx` declares (keep the top bar as a layout route with
  an `<Outlet />`); add the routes `/locations/:id/layouts/new` and
  `/locations/:id/layouts/:layoutId/edit` (after `/locations/:id`, rendering `LayoutEditor`, a stub
  until T023). Every existing Admin test still passes.
- [X] T017 [P] `admin-app/src/api/layouts.ts`: `getLayoutDrawing`, `saveLayoutDrawing`,
  `createLayoutDrawing` through the generated client, returning the envelope's `code`, `message`
  and `details` on failure (as `importVenueLayout` does there).
- [X] T018 [P] Tests `admin-app/test/layout-editor/editor-doc.test.ts` (R10): `fromDrawing` →
  document → `toInput` round-trips a `LayoutDrawing` (levels keyed `l1`… by rank, ids kept, own
  levels kept, places rounded to 0.1); a new level, section, row or seat (id `new:<n>`) is sent
  without `id`; `revision` is sent for an existing layout and left out for a new one; outlines are
  `outlineAround` of the seats.
- [X] T019 [P] Tests `admin-app/test/layout-editor/editor-state.test.ts`, core (R10): `load`; select
  and deselect sections; `rename`; `setFloor` (kind and rectangle; `NONE` clears the outline);
  history: each change is one step, Undo and Redo walk it, a change after Undo drops the redo side,
  the 101st change drops the oldest; `dirty` false after `load` and after `saved`, true after any
  change, false again when Undo returns to the saved document; `totals` (sections, seats, seats per
  level resolved seat → row → section, seats left under 30,000).
- [X] T020 `admin-app/src/layout-editor/editor-doc.ts` (R10, data-model "The editor's document").
  Run T018; it passes.
- [X] T021 `admin-app/src/layout-editor/editor-state.ts`, core actions and history as T019
  (structural sharing: a change replaces only the sections it touches; history ≤ 100 documents).
  Run T019; it passes.
- [X] T022 [P] Tests `admin-app/test/layout-editor/LayoutEditor.test.tsx` (with `createMemoryRouter`):
  `/locations/v1/layouts/new` shows an empty map, a name box, one level "Standard" and floor "None";
  `/…/:layoutId/edit` loads `getLayoutDrawing` and draws each section's outline and name and the
  floor; Save of a new layout calls `createLayoutDrawing` and moves to its edit route; Save of an
  existing one calls `saveLayoutDrawing` with the `revision` and shows "Saved"; a
  `LAYOUT_FILE_INVALID` refusal selects the section its `path` points at and shows the message, and
  the document is unchanged; a locked layout shows "Locked: seats are sold or held at <events>" and
  no editing controls; at 390px wide (`matchMedia('(max-width: 640px)')`) it shows the shared
  `LayoutPreview` and "Editing a layout needs a wider screen"; the status line is a polite live
  region.
- [X] T023 The page shell (R14): `admin-app/src/layout-editor/LayoutEditor.tsx` (load, toolbar with
  name box, Undo, Redo, zoom buttons and Save; the map; a side column for the panels; read-only for
  locked layouts and at ≤ 640px; the status line), `EditorCanvas.tsx` (overview drawn with the shared
  `outlinePath`, the floor object and section names, `usePanZoom` for pan and zoom; selection by
  click and Shift-click), `SaveBar.tsx` (Save, "Saved", refusals placed by `path`). Styles in the
  Admin app's stylesheet with theme values only (Constitution VII). Run T022; it passes.

**Checkpoint**: the Backend saves and reads drawings with every rule; the editor opens, shows and
saves a layout.

---

## Phase 3: User Story 1 - An admin draws a new layout with the block generator (Priority: P1) 🎯 MVP

**Goal**: New layout → floor object → generated sections, straight or curved, of any row lengths →
drag and turn → save; the customer map shows it.

**Independent Test**: quickstart S1–S4, S13, S14.

### Tests first

- [X] T024 [P] [US1] `packages/shared/test/layout-geometry.test.ts`, `generateBlock` (R7), seat by
  seat: 3 rows × 4 straight → row k seat i at `((i − 1.5) × 2, −2k)`; rows `[4, 6]` → the second row
  centered on the first; `curve: 40` with `[20, 20, 20]` → every seat of row k at distance `R₀ + 2k`
  from `(0, R₀)` with `R₀ = 2 × 19 / (40° in radians)`, neighbours 2 units apart along the arc
  (± 1e-6), symmetric about `x = 0`; `curve` small enough that `R₀ < 2` uses `R₀ = 2`; letters from
  "A" for 30 rows end "Z", "AA", "BB", "CC", "DD"; from "Y": "Y", "Z", "AA"; numbers from "99": "99",
  "100"; seats from 101 `RIGHT_TO_LEFT` → the leftmost seat is labelled last; seats always listed
  left to right; a `firstRow` not in the letter sequence ("AB") and `rows` 101, `seatsPerRow` 201,
  a `seatsPerRow` list whose length is neither 1 nor `rows` are errors; the origin is the front
  row's middle.
- [X] T025 [P] [US1] `admin-app/test/layout-editor/AddSectionForm.test.tsx`: fields name, rows, seats
  per row ("20" or "16, 16, 18"), row labels (letters/numbers) and first row, first seat, direction,
  curve (None, Slight, Medium, Strong, or a number 0–120); Generate adds the section, selected, in
  the middle of the visible map, in the chosen level; a value over a limit is refused beside its
  field naming the limit ("At most 100 rows"), and the seats left under 30,000 are shown; a
  duplicate name is refused beside the name.
- [X] T026 [P] [US1] `admin-app/test/layout-editor/EditorCanvas.test.tsx`: dragging a selected
  section moves it and its seats by the pointer's offset in map units (one Undo step); dragging
  two selected sections moves both; the turn handle turns the selection about each section's origin
  in 1° steps, 15° with Shift, and the angle shows in the Selection panel; dragging past the top or
  left edge moves everything right or down so no place is below 0; the floor object is picked
  (Court, End stage, Center stage, Ring, None), moved, and resized by its corner handles.
- [X] T027 [P] [US1] `admin-app/test/layout-editor/overlap.test.ts` and `SaveBar.test.tsx` (R15):
  two sections with seats 1.4 units apart overlap and 1.6 apart do not; sections whose bounds do not
  meet are not compared; Save with an overlap or a level with no seats lists "Section 102 overlaps
  101" and "Upper has no seats" with **Save anyway** and **Go back**; Save anyway saves.
- [X] T028 [P] [US1] `admin-app/test/layout-editor/LayoutEditor.test.tsx`, unsaved changes (R13):
  with a change, following a link asks to confirm and Cancel stays with the change kept; a
  `beforeunload` handler is set while dirty and removed when saved.
- [X] T029 [P] [US1] Browser test `e2e/tests/039-layout-editor.spec.ts`, US1 (S1–S3), title
  `039 S1/S2/S3: an admin draws a layout with a court and two generated sections, turns one, saves it, and the customer map draws it`:
  make a venue, New layout, Court, generate "101" (12 × 20, letters, medium curve) and "102"
  (`16, 16, 18, 18, 20, 20`), drag and turn, name "Basketball", Save; the Layouts card lists 348
  seats, 2 sections; schedule an event on it with a price, and the Customer app's map shows both
  sections with 240 and 108 seats.

### Implementation

- [X] T030 [US1] `generateBlock(values)` in `packages/shared/src/layout-geometry.ts` (R7), and
  `placeBlock(local, origin, angle)`; run T024; it passes.
- [X] T031 [US1] Actions in `editor-state.ts`: `addSection` (generator values, level, place at
  the visible map's middle, selected), `moveSections` (offset; the normalizing shift of R5),
  `turnSections` (degrees, about each origin, `normalizeAngle`), `setFloor` move and resize; each
  recomputes the outline with `outlineAround` (move and turn transform it instead). Extend T019's
  tests first.
- [X] T032 [US1] `admin-app/src/layout-editor/AddSectionForm.tsx` in the Sections panel; run T025.
- [X] T033 [US1] Drag, turn handle and floor handles in `EditorCanvas.tsx` (R11): an SVG
  `transform` on the dragged group while dragging, one action on release; run T026.
- [X] T034 [US1] `admin-app/src/layout-editor/overlap.ts` and the warnings step in `SaveBar.tsx`,
  with warning outlines on the map; run T027.
- [X] T035 [US1] Unsaved changes in `LayoutEditor.tsx`: `useBlocker` while dirty with a confirm
  ("Leave without saving? Your changes will be lost."), and `beforeunload`; run T028.
- [X] T036 [US1] `admin-app/src/components/LayoutsCard.tsx`: **New layout** beside Import and
  section lines, linking to `/locations/:id/layouts/new`; its test in `admin-app/test/layouts-card.test.tsx` first.
- [X] T037 [US1] Run T029 against the e2e stack; it passes.

**Checkpoint**: US1 works alone: a drawn layout is saved and sold from.

---

## Phase 4: User Story 2 - An admin paints price levels on sections, rows and seats (Priority: P1)

**Goal**: levels added, ordered, recolored, deleted with a replacement; painted on sections, rows
and seats; totals live.

**Independent Test**: quickstart S5, S6.

### Tests first

- [X] T038 [P] [US2] `editor-state.test.ts`, levels and painting (R12): `addLevel` (at most 12; the
  first unused of the 12 colors), `renameLevel` (unique ignoring case), `recolorLevel`, `moveLevel`
  up and down (ranks follow order), `deleteLevel(id, replacement)` repoints sections, rows and seats
  and clears row and seat overrides that then equal their parent's level, and refuses the last level;
  `paint(level)` on sections sets their level, on rows their own level, on seats their own level;
  `clearLevel` on rows and seats; totals after each.
- [X] T039 [P] [US2] `admin-app/test/layout-editor/LevelsPanel.test.tsx`: lists levels best first with
  swatch, name and seats; Add level; rename in place; recolor from the 12 colors; Move up/Move down;
  Delete asks which level the seats take; the last level's Delete is disabled with the reason; each
  level's name is beside its color.
- [X] T040 [P] [US2] `admin-app/test/layout-editor/SectionSeatsView.test.tsx`: Enter or double-click on
  a section zooms into it and draws its seats in their levels' colors with row labels at both ends;
  click selects a seat, Shift-click adds; clicking a row label selects the row, Shift-clicking
  another selects the range; with **Box select** on, a drag selects the seats inside the box (off,
  it pans); Paint applies the chosen level; **Back to layout** returns to the overview.
- [X] T041 [P] [US2] Browser test in `e2e/tests/039-layout-editor.spec.ts`, US2 (S5), title
  `039 S5: an admin adds three levels, paints a section, rows A–D and two seats, deletes Standard, and the levels are kept on reopening`:
  on the layout of T029, the totals read Courtside 80, Lower sideline 158, Upper 2, Standard 108,
  then after deleting Standard for Lower sideline, Courtside 80, Lower sideline 266, Upper 2; Save;
  reload; the same.

### Implementation

- [X] T042 [US2] Level and paint actions in `editor-state.ts`; run T038.
- [X] T043 [US2] `admin-app/src/layout-editor/LevelsPanel.tsx` with the totals; run T039.
- [X] T044 [US2] `admin-app/src/layout-editor/SectionSeatsView.tsx` (zoom with `usePanZoom`'s
  animated `viewBox`, seats as the shared map's circles, row labels, selection, box select) and the
  Paint and Use section's level buttons; run T040.
- [X] T045 [US2] Run T041 against the e2e stack; it passes.

**Checkpoint**: MVP: layouts are drawn and priced by level in the app.

---

## Phase 5: User Story 3 - An admin edits a layout nobody has bought from (Priority: P2)

**Goal**: Edit any unlocked layout from the Layouts card; locked layouts read-only with Duplicate
to edit; stale or newly locked saves refused with Save as a new layout or Reload.

**Independent Test**: quickstart S7–S10.

### Tests first

- [X] T046 [P] [US3] `backend/test/integration/layouts.drawing.concurrency.e2e-spec.ts` (Constitution
  IV): on a layout a scheduled event uses with no sales, a save and 10 holds of 10 different seats
  started at once: either every hold that succeeded committed before the save, and the save is
  refused `409 LAYOUT_IN_USE`, or the save committed first and every hold of a deleted seat failed
  and of a kept seat succeeded; never a hold on a deleted seat; run 5 times.
- [X] T047 [P] [US3] `layouts-card.test.tsx`: an unlocked layout of any `source` has **Edit**; a
  locked one **View**; a `DRAWN` layout has no section-lines editing. `LayoutEditor.test.tsx`: a
  locked layout's **Duplicate to edit** calls `duplicateVenueLayout` and opens the copy's edit
  route. `SaveBar.test.tsx`: `409 LAYOUT_CHANGED` and `409 LAYOUT_IN_USE` (locked) keep the document
  and offer **Save as a new layout** (name box "<name> (copy)", calls `createLayoutDrawing`, then
  opens it) and, for `LAYOUT_CHANGED`, **Reload** (after a confirm); `409 LAYOUT_IN_USE` naming
  events that would be left unable to sell shows the message as sent.

### Implementation

- [X] T048 [US3] `LayoutsCard.tsx` Edit and View; `LayoutEditor.tsx` Duplicate to edit;
  `SaveBar.tsx` Save as a new layout and Reload; run T046 and T047.

**Checkpoint**: layouts change safely while events use them.

---

## Phase 6: User Story 4 - An admin fine-tunes sections (Priority: P2)

**Goal**: Duplicate section, delete seats and sections, relabel rows and seats, mark accessible,
Regenerate.

**Independent Test**: quickstart S11.

### Tests first

- [X] T049 [P] [US4] `editor-state.test.ts`: `duplicateSection` (new ids, a free name "101 (2)",
  placed 10 units right of the original, levels and accessible marks copied, generator copied);
  `deleteSeats` (a row left empty is removed; outline redrawn; the last seats of a section ask, by
  returning a `confirm` result, to delete the section); `deleteSection`; `relabelRow` and
  `relabelSeat` refused when not unique (row in section, seat in row) or longer than 5 characters;
  `markAccessible`; `regenerate(values)` keeps the id and own level of every row whose label is
  still generated and every seat whose row is kept and label still in it, places the new block at
  the section's origin and angle, and reports how many seats would go before applying.
- [X] T050 [P] [US4] `admin-app/test/layout-editor/SelectionPanel.test.tsx`: for one selected section,
  its name, origin, angle, and (when generated) its generator values with **Regenerate**, which
  warns "Regenerate removes N seats" when N > 0 and that labels changed by hand are replaced;
  Duplicate section and Delete section (confirm naming the seat count); for selected seats,
  Delete, Mark accessible, and the label box; for a row, its label box.

### Implementation

- [X] T051 [US4] The actions in `editor-state.ts` and `admin-app/src/layout-editor/
  SelectionPanel.tsx`; the accessible mark drawn on seats in `SectionSeatsView.tsx`; run T049 and
  T050.

---

## Phase 7: User Story 5 - An admin builds a layout without a mouse (Priority: P2)

**Goal**: every action by keyboard: Sections list, typed place and angle, arrow keys, row and seat
lists, announcements.

**Independent Test**: quickstart S12.

### Tests first

- [X] T052 [P] [US5] `admin-app/test/layout-editor/keyboard.test.tsx` (user-event, keyboard only):
  Tab reaches every control with a visible focus (the focus class from the theme); the Sections list
  selects a section; typing 30 in the angle box turns it to 30°; typing x and y moves its origin;
  with the map focused, ArrowRight moves the selection 1 unit, Shift+ArrowRight 10, `[` and `]` turn
  1°, Shift 15°, Delete asks then deletes, Escape clears the selection, Cmd/Ctrl+Z undoes,
  Shift+Cmd/Ctrl+Z and Ctrl+Y redo; the chosen section's rows are a checkbox list whose rows open to
  their seats, and Paint, Delete, relabel and Mark accessible work from the lists; the status line
  announces "Section 104 moved", "Rows A–D painted Courtside", "Undone: section 104 moved".

### Implementation

- [X] T053 [US5] `admin-app/src/layout-editor/SectionsPanel.tsx` (list, Add section, Duplicate,
  Delete, totals); typed place and angle in `SelectionPanel.tsx`; the key handling on the map in
  `EditorCanvas.tsx` and `SectionSeatsView.tsx`; the row and seat checkbox lists; an announcement
  for every action in `editor-state.ts` (a `message` per action) shown in the status line; run T052.

---

## Phase 8: Polish, browser tests, review

- [X] T054 Contract check: `grep -n "x-planned: '039'" contracts/openapi.yaml` finds nothing;
  `node scripts/check-contract-drift.mjs` passes.
- [X] T055 [P] `specs/039-layout-editor/quickstart.md`: the Automation rows of S1, S2, S3 and S5
  become Automated with T029's and T041's exact titles; `node scripts/check-quickstart-marks.mjs`
  passes.
- [X] T056 [P] `README.md`: the 039 row (plan and tasks "Done (N/63 tasks)", code "Built (review
  …)") and the layout editor in the Admin app's list of screens, in the README's existing style.
- [X] T057 Coverage: each workspace ≥ 80% lines (`npm test`); add tests where a new file falls short.
- [X] T058 `npm run ci` green locally; `npm run e2e` green (on a port-shifted stack if the team
  stack holds 5173–5175, as 038's T058 did); record the runs.
- [X] T059 Timing checks (quickstart "Timing checks"; SC-001–SC-003, SC-008) on the demo state on a
  laptop; record the times for the PR description.
- [X] T060 Tell Nate, for the `037` session: `LayoutSummary.source` may be `DRAWN` and three new
  operations exist (research R1).
  **Done 2026-11-14**: told Nate, and said in the implementation PR's description.
- [X] T061 Independent review of the implementation branch by a Claude session that did not write it
  (Constitution III), against the merged spec and plan; fix the findings, each with a test written
  to fail first; record the review and any open finding for the PR description.
  **Done 2026-11-14**: one round. 4 blocking (edits made during a save lost; the floor's corner
  handles hidden after choosing a floor; Box select panning inside a zoomed section; "Saved"
  lost after a new layout's redirect), 2 should-fix (Undo past a save re-sending saved parts as
  new; typed places applied per keystroke) and 3 minor (stacked seats: a 500; the save checking
  its body under its locks, in IMPORT_TX; arrow keys only from the bare map). All fixed, each
  with a test first. Open, for the PR: `LAYOUT_IN_USE` doesn't say whether the layout is locked
  or an event would be left unable to sell, so the editor offers Save as a new layout for both.
  The browser tests then found three more, fixed the same way: deep links lost after sign-in
  (the data router was made before sign-in restored the address), clicks and double-clicks on a
  section going to the map (pointer captured too early), and a kept row painted with a level
  made in the same save failing with a 500.
- [X] T062 Walk the quickstart on a Compose project of your own (`-p qp039`): S1–S14, with Nate.
  His "pass" closes it.
  **Done 2026-11-14**: walked on `-p qp039`; Nate's feedback along the way was fixed on this
  branch, each with a test first (the how-to steps and hint line, the floor shown whole when
  chosen, the selection's level chosen under Selection, wrapping button rows, Delete for the
  floor, 038's off-sale section buttons and row-label halos). Nate: "yes everything passes"
  (his confirmation closes the walk and the timing checks; no times were recorded).
- [ ] T063 Push `039-layout-editor-impl` (ask first); open the implementation PR (ask first)
  assigned to nathan-707, its description with `fixes #N` on its own line, the review, the timing
  checks and the walk; CI green (`test` and `e2e`) before merge.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** → every story. Within Phase 2: T003 → T007 → T008; T004 → T009; T005, T006 →
  T010–T015 (T013–T015 need T009 and T010); T016, T017 independent; T018 → T020; T019 → T021; T022
  → T023 (needs T016, T017, T020, T021).
- **US1 (Phase 3)** needs Phase 2. **US2 (Phase 4)** needs Phase 2; its browser test T041 builds on
  T029's layout, so run it after US1. **US3 (Phase 5)** needs Phase 2 (the Backend rules are
  already in T015). **US4 (Phase 6)** needs US1's `generateBlock` (T030) for Regenerate and US2's
  `SectionSeatsView` (T044) for seat selection. **US5 (Phase 7)** needs the panels of US1, US2 and
  US4.
- **Phase 8** after every story.

## Parallel examples

- Phase 2 tests: T003, T004, T005, T006, T018, T019, T022 in parallel; then T009, T016, T017 beside
  the Backend tasks.
- US1 tests: T024–T029 together; then T030 beside T034 and T036.
- US2 tests: T038–T041 together; then T043 beside T044.
- After Phase 2, US3 (T046–T048) can run beside US1.

## Implementation Strategy

1. **MVP** = Phases 1–4: a drawn layout with levels painted, saved and sold from (US1, US2). Stop
   and check S1–S6 there.
2. Then US3 (editing layouts events use), US4 (fine-tuning), US5 (keyboard), each checked by its
   quickstart scenarios.
3. Polish, review, walk, PR. Not needed for EDIS on 2026-11-20; if done by then it can be shown, and
   the demo does not depend on it.
