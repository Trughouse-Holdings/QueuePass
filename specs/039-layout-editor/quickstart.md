# Quickstart: Layout Editor

**Feature**: `039-layout-editor` | **Contract**: [contracts/README.md](./contracts/README.md) |
**Data model**: [data-model.md](./data-model.md)

How to see the feature work end to end, and which scenarios the browser tests cover (Constitution
VI, `022`). Each scenario is marked **Automated** (with its test) or **Manual** (with the reason);
the implementation fills in the test names.

## Prerequisites

- The Compose stack: `docker compose up --build` (or path B, `node scripts/run-host.mjs`).
- The demo state from `038` (the KFC Yum! Center: Basketball, End-stage concert and Wrestling
  locked by sold seats; Center stage unused): `docker compose exec -e QUEUEPASS_ALLOW_RESET=1
  backend node backend/dist/scripts/demo-reset.js` (path B: `QUEUEPASS_ALLOW_RESET=1 node
  scripts/run-host.mjs --demo-reset`).
- Admin app http://localhost:5173 as `admin1`; Customer app http://localhost:5174 as `customer1`;
  password `test123`. A laptop-width window.
- Tests: `npm test` (all workspaces; Testcontainers needs Docker running); `npm run e2e` (browser).

## S1. Draw a new layout with the generator (US1)

Make a venue "Riverside Arena" (seated, no layouts). On its Layouts card press **New layout**.
**Expected**: the editor opens with an empty map, one level "Standard", floor "None", a name box.
Pick floor **Court**; drag a corner to resize it. **Add section**: name 101, 12 rows, 20 seats per
row, letters from A, first seat 1, left to right, curve medium. **Expected**: a curved block of 240
seats appears in the middle of the map, selected; the totals read "1 section · 240 seats".
**Covered by**: shared `layout-geometry` test; Admin `AddSectionForm` and `editor-state` tests.

## S2. Place and turn sections (US1)

Drag 101 beside the court; turn it with the round handle until it faces the court. Add 102 with
seats per row `16, 16, 18, 18, 20, 20`, straight; place it at the corner. **Expected**: each section
moves and turns as a whole; the Selection panel's place and angle follow; 102's rows are centered on
each other. **Covered by**: Admin `EditorCanvas` and `editor-state` tests.

## S3. Save, and the customer sees what was drawn (US1)

Name the layout "Basketball" and **Save**. **Expected**: "Saved"; back on the venue page the
Layouts card lists "Basketball · 348 seats · 2 sections · 1 level · used by 0 events" with its
preview. Schedule an event on it (038's Seating section), price Standard, open it in the Customer
app: the map draws the court, 101 curved beside it and 102 at the corner, each seat where the editor
showed it (FR-025). **Covered by**: Backend `layouts.drawing` test (outline, size, numbers).

## S4. Unsaved changes are not lost by accident (US1)

Move a section, then click **Venues** in the top bar. **Expected**: asked to confirm leaving;
Cancel keeps the editor and the change. Reload the tab: the browser asks too. **Covered by**: Admin
`LayoutEditor` test.

## S5. Levels and painting (US2)

Open Basketball (Edit). Add levels Courtside (red), Lower sideline (blue) and Upper (teal); move
Courtside to the top. Select 101 and choose Lower sideline as its **Price level** (Selection
panel). Zoom into 101, click row label A, Shift-click D, choose Courtside as their Price level.
Box-select two aisle seats in row K, and choose Upper.
**Expected**: colors and names change at once; the totals read Courtside 80, Lower sideline 158,
Upper 2, Standard 108. Delete Standard, choosing Lower sideline for its seats; save; reopen.
**Expected**: every seat's level as painted. **Covered by**: Admin `LevelsPanel` and `editor-state`
tests; Backend `layouts.drawing` test (own levels kept).

## S6. Undo and redo (US1, US2)

Paint a row, move a section, delete a seat; press Cmd/Ctrl+Z three times, then Shift+Cmd/Ctrl+Z
once. **Expected**: each step undone in reverse order and the status line says so; the redo brings
back the paint. **Covered by**: Admin `editor-state` test.

## S7. Edit a layout an event uses without sales (US3)

On the Yum! Center, schedule an event on **Center stage** with every level priced and one section
off sale; sell nothing. Edit Center stage: move a floor section, add a new floor section, repaint
two rows of a kept section with a level the event prices, and save. **Expected**: saved; the event
keeps its prices and its off-sale section; the new section is off sale for it; its capacity is
recomputed. Paint a kept section with a new level the event has no price for and save.
**Expected**: refused, naming the event and the level; the editor keeps the change. **Covered by**:
Backend `layouts.drawing` test.

## S8. A locked layout is read-only (US3)

Open **Basketball** at the Yum! Center (seats sold). **Expected**: the Layouts card offers **View**,
not Edit; the editor shows it read-only with "Locked: seats are sold or held at …" and **Duplicate
to edit**, which opens an editable "Basketball (copy)". **Covered by**: Admin `LayoutsCard` and
`LayoutEditor` tests; Backend `layouts.drawing` test.

## S9. Locked, or changed, while open (US3)

Open Center stage in the editor; in another window hold a seat at an event on it (Customer app);
move a section and save. **Expected**: refused, "seats are sold or held"; **Save as a new layout**
saves the work as "Center stage (copy)". Then open Center stage in two tabs, save in one, save in
the other. **Expected**: the second is refused as changed since it was opened, with Save as a new
layout and Reload. **Covered by**: Backend `layouts.drawing` and `layouts.drawing.concurrency`
tests.

## S10. A section-line layout becomes drawn (US3)

Make a layout from section lines (038), Edit it, move one section, save. **Expected**: the Layouts
card no longer offers section lines for it. **Covered by**: Backend `layouts.drawing` test; Admin
`LayoutsCard` test.

## S11. Fine-tune sections (US4)

Duplicate 101 three times (names 103, 104, 105). In 104 delete three seats of row A, rename row "B"
to "B1", mark two seats of row K accessible. Select 103 and **Regenerate** with 14 rows.
**Expected**: copies keep rows, seats and levels; row A has the gap and the outline follows it; a
duplicate label is refused beside the field; accessible seats show the mark; 103 grows by two rows
at the back, keeping its painted rows. Regenerate 104 with 10 rows. **Expected**: warned that 40
seats will be removed. **Covered by**: Admin `editor-state` and `SelectionPanel` tests; shared
`layout-geometry` test.

## S12. Keyboard only (US5)

Without the mouse: Add section, generate, then in the Sections list choose it; type an angle of 30
in the Selection panel; press the right arrow 5 times and Shift+right once; open its rows, check A–D
and choose Courtside as their Price level; Save. **Expected**: every step reachable with a visible focus; the status line
announces each change. **Covered by**: Admin keyboard tests.

## S13. Warnings before saving (US1)

Drag 102 over 101 and Save. **Expected**: a list "Section 102 overlaps 101" (both outlined) and
"Upper has no seats" if so, with **Save anyway** and **Go back**; Save anyway saves. **Covered by**:
Admin `overlap` and `SaveBar` tests.

## S14. Phone width (US1)

Open the editor at 390px wide. **Expected**: the layout's preview and "Editing a layout needs a
wider screen"; no editing controls. **Covered by**: Admin `LayoutEditor` test.

## Timing checks (SC-001–SC-003, SC-008)

Run on a laptop against the demo state, by hand, and record the times in the implementation PR:
open Center stage and a duplicate of Basketball (22,090 seats) in the editor (≤ 3 s); drag and turn
a section of the duplicate (no visible lag); save it (≤ 5 s); add and place a 20-row section
(< 1 min); repaint rows A–J of a section (< 30 s); draw a 10-section, about 3,000-seat bowl around a
court with three levels from blank (< 15 min, someone who has not used the editor).

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

**2026-11-19: the React Admin app's layout editor was removed** (layouts are imported from a file
only; the Rust Admin app keeps its editor). `e2e/tests/039-layout-editor.spec.ts`, which walked
S1–S3 and S5, and the Admin editor's own tests were removed with it, so every row is Manual now.

| Scenario | Browser test |
| --- | --- |
| S1 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S2 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S3 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S4 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S5 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S6 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S7 | Manual: covered by the Backend `layouts.drawing` test |
| S8 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S9 | Manual: two windows and a race; the Backend `layouts.drawing` and `layouts.drawing.concurrency` tests |
| S10 | Manual: covered by the Backend `layouts.drawing` test and the Admin `LayoutsCard` test |
| S11 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S12 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S13 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
| S14 | Manual: removed 2026-11-19 with the React Admin app's layout editor |
