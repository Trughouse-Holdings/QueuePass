# Feature Specification: Layout Editor: Draw, Arrange and Price a Venue Layout

**Feature Branch**: `039-layout-editor-spec`

**Created**: 2026-11-14

**Status**: Draft

**Issue**: #168

**Input**: The seat-maps proposal's second spec (QueuePass Seat Maps Proposal, Nov 11–13; John
approved the feature on 2026-11-13). John asked that admins can "draw or define" a venue's maps,
"drag and drop or some other way". Spec `038` gives every venue several layouts, each a map of
sections, rows and seats with price levels, but admins can only make one by importing a layout file
or by typing section lines, which set rectangles side by side in a grid. Nobody can make an
arena-shaped layout in the Admin app, and nobody can change where an imported section sits or which
rows are worth more. The proposal's answer (D1, option A) is a **block generator plus drag and
rotate**: the admin types a section's rows and seats, the editor generates the block (curved if
asked), the admin drags and rotates it into place, then paints price levels on sections, rows and
single seats. The constitution's roadmap row reads: "the Admin app's layout editor: a block
generator for sections of rows and seats, drag and rotate sections, paint price levels by section,
row or seat, duplicate and edit layouts nobody has bought from".

## Context

Builds on `038` (layouts, sections, rows, seats and price levels; a seat's level is its own, else
its row's, else its section's; a layout used by a scheduled event with valid tickets or live holds
is locked; Duplicate; the layout file; the shared venue map drawing and its pan and zoom; the
Layouts card on the venue page), `035` (all-or-nothing saves with the refusal beside the field at
fault) and `024` (the venue page).

After `038`, a layout comes from a file (its places fixed, only its name editable) or from section
lines (a grid of rectangles, one level per section). The customer's venue map draws whatever the
layout holds, so a layout only looks like the building if its file was generated outside the app.

This feature adds one screen, the **layout editor**, in the Admin app. It opens from the Layouts
card for a new layout or for any layout that is not locked, and it saves the whole layout in one
step. Nothing changes for customers, events, holds or orders: the customer map draws the saved
layout exactly as `038` draws any layout.

## Clarifications

### Session 2026-11-14

Written after `038`'s spec and implementation PRs (#166, #167) opened. The proposal's
decisions take their recommended answers, recorded as **recommended answer, open to review**, so
John, Mahdi and the team can overturn them in review of the spec PR.

- Q: How does an admin define a section's shape? → A: **With the block generator only.** A section
  is generated from its rows and seats, then shaped by deleting seats, relabelling and
  regenerating; its outline is drawn around its seats. Free drawing of polygons, then placing each
  row and seat by hand, is not offered (D1 option A; recommended answer, open to review)
  (FR-006–FR-010).
- Q: Which layouts can be opened in the editor? → A: **Any layout that is not locked, however it
  was made**: imported, from section lines, or drawn. A locked layout opens read-only with
  **Duplicate to edit**. A section-line layout saved from the editor becomes a drawn layout and no
  longer offers section lines, since lines would put its sections back in a grid (FR-002, FR-003).
- Q: What happens to events on a layout when it is edited? → A: **Every section, row and seat the
  admin did not delete keeps its identity**, even when moved, rotated, relabelled or repainted, so
  the prices and off-sale seats of scheduled events on that layout survive. New seats go off sale
  for those events, and a save that would leave an event selling seats in a level it has no price
  for is refused, naming the event, as `038` FR-006 does for section lines (FR-021, FR-022).
- Q: Can a layout be changed while someone is buying from it? → A: **No.** The `038` lock is
  unchanged. If the layout becomes locked while the admin is editing, the save is refused and the
  editor offers **Save as a new layout** so the work isn't lost (FR-023).
- Q: Two admins editing one layout? → A: **The second save is refused** when the layout changed
  since it was opened, and the editor offers to save the work as a new layout or reload. No live
  co-editing (FR-024).
- Q: Must the editor be usable without a mouse? → A: **Yes, through exact entry.** Every section's
  place and angle can be typed, the arrow keys move the selection, and sections, rows and seats can
  be selected and painted from lists. Dragging is a faster way, not the only one (Constitution VII)
  (FR-026, FR-027).
- Q: Overlapping sections? → A: **Flagged, not refused.** Two sections whose seats overlap are
  marked and listed as a warning before saving; the admin may still save, since an outline may only
  approximate a real section (FR-020).
- Q (Nate's walk, 2026-11-14): how does an admin give a selection a level? → A: **Where the
  selection is shown**: the Selection panel's **Price level** box shows the selection's level and
  sets another at once; rows and seats can take **Same as the section** (or row). The Levels panel
  only manages levels (research R12, amended) (FR-016).
- Q (Nate's walk, 2026-11-14): when a customer chooses a section, should the Sections list
  beside the map turn into the section's seats? → A: **No.** The list always shows every
  section; seats are chosen on the map, where the keyboard's focus goes when a section is chosen
  from the list. `038` FR-020 is amended with a dated note.
- Q (Nate's walk, 2026-11-14, after merge): should the customer's map keep its price filter? →
  A: **No.** It is removed; the map and the Sections list show every level's open seats. `038`
  FR-017 is struck with a dated note (US3 scenario 2, its edge case and quickstart S11 too). The
  legend and zoom buttons now span the map's row, so the map and the Sections list start level.
- Q: Is this needed for the EDIS demo on 2026-11-20? → A: **No.** `038` carries the demo on its
  imported Yum! Center layouts; `039` shows the editor if it is done by then (proposal, order for
  EDIS).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An admin draws a new layout with the block generator (Priority: P1)

Avery opens a new venue, Riverside Arena, and presses **New layout** on the Layouts card. The editor
opens full page with an empty map, one price level, "Standard", and a floor object picker. She picks
**Court** and drags its corner to size it. She presses **Add section** and types: name "101", 12
rows, 20 seats per row, rows labelled A, B, C…, first seat 1, curve "medium". The editor draws a
curved block of 240 seats; she drags it beside the court and turns it with the rotate handle until
it faces the floor. She adds "102" with seats per row "16, 16, 18, 18, 20, 20" and puts it in the
corner. The side panel reads "2 sections · 348 seats". She names the layout "Basketball", saves, and
the Layouts card lists "Basketball · 348 seats · 2 sections · 1 price level · used by 0 events".

**Why this priority**: This is the editor. Without it, an arena-shaped layout can only come from a
file made outside the app.

**Independent Test**: Make a layout from blank with a floor object and three generated sections (one
straight, one curved, one with rows of different lengths), move and rotate each, save, and confirm
the Layouts card's counts and that the customer map of an event on it draws each section and seat
where the editor showed it.

**Acceptance Scenarios**:

1. **Given** the Layouts card, **When** the admin presses New layout, **Then** the editor opens with
   an empty map, one price level named "Standard", no floor object, and a name box.
2. **Given** the editor, **When** the admin picks a floor object (court, end stage, center stage or
   ring), **Then** it is drawn on the map and can be moved and resized.
3. **Given** Add section with a name, a row count, seats per row as one number, a row label style,
   a first seat number and a curve, **When** the admin presses Generate, **Then** a block of exactly
   rows × seats is drawn, rows labelled in order from the front, seats numbered from the first
   number, every seat in the section's level, and its outline drawn around its seats.
4. **Given** seats per row as a list ("16, 16, 18, 18, 20, 20"), **When** the block is generated,
   **Then** it has one row per number with that many seats, each row centered on the one in front.
5. **Given** a section on the map, **When** the admin drags it or turns its rotate handle, **Then**
   it moves or turns as a whole, its seats keeping their places within it, and the place and angle
   fields show the new values.
6. **Given** a layout with a name and at least one section, **When** the admin saves, **Then** the
   whole layout is saved in one step, the editor shows it saved, and the Layouts card lists it with
   its counts and preview.
7. **Given** unsaved changes, **When** the admin leaves the editor, **Then** they are asked to
   confirm before the changes are thrown away.

---

### User Story 2 - An admin paints price levels on sections, rows and seats (Priority: P1)

Avery adds three more levels, "Courtside", "Lower sideline" and "Upper", each with a color, and
moves them into order from best to worst. With **Lower sideline** chosen, she selects sections
101 and 102 and paints; they fill with its color. She zooms into 101, selects rows A–D by their labels and paints
them **Courtside**. She selects two seats on the aisle and paints them **Upper** for a blocked view.
The side panel reads "Courtside 80 · Lower sideline 266 · Upper 2 · Standard 0". She deletes the
unused "Standard" level and saves.

**Why this priority**: John's "gradients of desirability" are what makes an event's price per level
mean something; `038` can only set them from a file.

**Independent Test**: On a drawn layout, add levels, paint a section, a range of rows and single
seats, save, reopen, and confirm every seat's level (own, row's or section's) is as painted; then
schedule an event on it and confirm the price table lists the levels with those seat counts.

**Acceptance Scenarios**:

1. **Given** the Levels panel, **When** the admin adds a level, **Then** it gets a name, a color from
   the shared level colors, and a rank by its place in the list, and moving it up or down
   reorders the ranks.
2. **Given** a chosen level and one or more selected sections, **When** the admin paints, **Then**
   each section's level becomes that level, and its rows and seats without a level of their own take
   its color.
3. **Given** a zoomed section, **When** the admin selects rows (by label, or a range such as A–D)
   and paints, **Then** those rows get that level as their own, overriding the section's.
4. **Given** a zoomed section, **When** the admin selects single seats (click, or drag a box around
   them) and paints, **Then** those seats get that level as their own, overriding the row's and the
   section's.
5. **Given** a row or seat with its own level, **When** the admin chooses **Same as the section**
   (for a seat, **Same as the row**) as its Price level,
   **Then** its own level is cleared and it shows the section's (or, for a seat, the row's).
6. **Given** any change, **Then** the side panel shows the seats in each level and in the whole
   layout, at once.
7. **Given** a level that seats still use, **When** the admin deletes it, **Then** they choose which
   level those seats take instead; the last level cannot be deleted.

---

### User Story 3 - An admin edits a layout nobody has bought from (Priority: P2)

Avery opens the imported "End-stage concert" layout at the Yum! Center, which one upcoming event
uses with prices set and no tickets sold. She moves the floor sections closer to the stage, adds a
sixth floor section, and paints the first two rows of section 104 a better level that the event
already prices. She saves. The event keeps its prices and its off-sale seats; the new floor section
is off sale for that event until she puts it on sale in the event form. The "Basketball" layout,
which has tickets sold, opens read-only with a note "Locked: seats are sold or held" and a
**Duplicate to edit** button.

**Why this priority**: Layouts change: a stage moves, a section is added. `038` lets only section-line
layouts change, and only as a grid.

**Independent Test**: Edit an imported layout used by a scheduled event without sales, keeping some
seats, deleting some and adding some; save and confirm the event's prices and off-sale seats on
kept seats are unchanged and new seats are off sale; then confirm a locked layout cannot be saved.

**Acceptance Scenarios**:

1. **Given** a layout that is not locked (imported, from section lines, or drawn), **When** the admin
   presses Edit on the Layouts card, **Then** the editor opens with its floor object, sections, rows,
   seats and levels as saved.
2. **Given** a locked layout, **When** the admin opens it, **Then** it is shown read-only, says why,
   and offers Duplicate to edit, which opens the editor on a new unlocked copy named "… (copy)".
3. **Given** a layout used by scheduled events without sales, **When** the admin moves, rotates,
   relabels or repaints sections, rows or seats and saves, **Then** every kept seat keeps that
   event's off-sale state, and every kept level keeps that event's price.
4. **Given** the same layout, **When** the admin adds seats and saves, **Then** the new seats are off
   sale for each scheduled event using it, and those events' capacities are recomputed.
5. **Given** the same layout, **When** a save would leave an event selling seats in a level it has no
   price for, no seat on sale, or a per-customer limit above its seats on sale, **Then** the save is
   refused, naming each event and why, and the admin's changes stay in the editor.
6. **Given** a section-line layout, **When** the admin saves it from the editor, **Then** it becomes a
   drawn layout and the Layouts card no longer offers section lines for it.

---

### User Story 4 - An admin fine-tunes sections: copy, gaps, labels, accessible seats (Priority: P2)

Avery builds the lower bowl quickly: she selects section 101 and presses **Duplicate section** three
times, naming the copies 102, 103 and 104, and drags each into place. In 104 she deletes three seats
in row A to leave room for a camera, renames row "AA" to "A1" where the venue's chart says so, and
marks the two aisle seats of row K **accessible**. In 103 she presses **Regenerate** with 14 rows
instead of 12; the block grows by two rows at the back.

**Why this priority**: Real sections are rarely perfect rectangles, and an arena has dozens of
similar ones; without copying and gaps the generator alone is slow.

**Independent Test**: Duplicate a section, delete seats from a row, relabel a row and a seat, mark
seats accessible, regenerate a section with more rows; save and confirm each change on reopening and
on the customer map.

**Acceptance Scenarios**:

1. **Given** a selected section, **When** the admin presses Duplicate section, **Then** a copy with
   the same rows, seats and levels appears beside it with a new unique name, and can be renamed.
2. **Given** a zoomed section, **When** the admin deletes selected seats, **Then** they are removed,
   the remaining seats keep their labels and places, a row left empty is removed, and the outline is
   redrawn.
3. **Given** a row or seat, **When** the admin changes its label, **Then** the new label is kept if
   it is unique within its section (row) or row (seat), and refused beside the field otherwise.
4. **Given** selected seats, **When** the admin marks them accessible, **Then** they show the
   accessible mark in the editor (the mark has no other behavior until `#57`).
5. **Given** a generated section, **When** the admin changes its generator values and presses
   Regenerate, **Then** the block is rebuilt from the new values; rows and seats whose labels remain
   keep their identity and their own levels, and the admin is warned before seats are removed.

---

### User Story 5 - An admin builds a layout without a mouse (Priority: P2)

Morgan, an admin who uses the keyboard, opens the editor. A **Sections** list beside the map names
every section; choosing one selects it on the map. The **Selection** panel shows its place (x, y)
and angle as number boxes; Morgan types an angle of 30 and nudges it right with the arrow keys. In
the section's rows list Morgan checks rows A–D and chooses **Courtside** as their Price level.

**Why this priority**: The constitution requires keyboard access; dragging must not be the only way
to place or paint.

**Independent Test**: With the keyboard only, add a section, place and rotate it by typing and with
the arrow keys, paint a section, rows and a seat, and save.

**Acceptance Scenarios**:

1. **Given** the editor, **Then** every control (Add section, the generator form, the Levels panel,
   the Sections list, the Selection panel, Save) is reachable and usable by keyboard, with a visible
   focus.
2. **Given** a selected section, **When** the admin types a place or an angle, or presses an arrow
   key, **Then** the section moves or turns to match, and the map shows it.
3. **Given** a chosen section in the list, **Then** its rows and seats can be selected from lists and
   painted, deleted, relabelled or marked accessible as on the map.

---

### Edge Cases

- **Limits**: the editor never lets a layout exceed `038`'s limits (100 sections, 100 rows a
  section, 200 seats a row, 30,000 seats, 12 levels); the generator refuses values over them,
  naming the limit, and the side panel shows the seats left.
- **Names and labels**: a section named like another in the layout (ignoring case), a row label
  repeated in a section, a seat label repeated in a row, or a layout named like another at the venue
  are refused beside the field.
- **A layout with no sections, or no name**: cannot be saved; the save names what is missing.
- **A level with no seats**: allowed, as in `038`; events never ask a price for it.
- **Deleting a section or seats that events use**: on a layout without sales, allowed; their prices
  stay with their levels and their off-sale entries go with the seats.
- **A section dragged past the edge of the map**: the map grows to keep every section and the floor
  object inside it.
- **Overlapping sections**: marked on the map and listed as a warning before saving; saving is
  allowed.
- **The layout is locked while being edited** (someone holds a seat at an event on it): the save is
  refused, saying why; Save as a new layout keeps the work.
- **Another admin saved the layout since it was opened**: the save is refused; the admin may save
  their work as a new layout or reload and lose it.
- **A refused save, for any reason**: never discards the admin's unsaved changes.
- **Undo**: undoing past the last save is allowed; undo history ends when the editor is closed.
- **A very large layout** (the Yum! Center's 22,090 seats): the map draws sections, and draws seats
  only for a zoomed section or while painting it, as `038`'s map does.
- **Phone width**: the editor is for laptops and larger; at phone width it shows the layout read-only
  with a note that editing needs a wider screen.

## Requirements *(mandatory)*

### Functional Requirements

**Opening the editor**

- **FR-001**: The Layouts card (`038`) MUST offer **New layout**, which opens the editor on an empty
  layout with one price level named "Standard", and **Edit** on each layout, which opens the editor
  on it.
- **FR-002**: The editor MUST open any layout that is not locked, whether imported, made from
  section lines, or drawn. A locked layout (`038` FR-006) MUST open read-only, say why, and offer
  **Duplicate to edit**, which makes an unlocked copy (`038` Duplicate) and opens it.
- **FR-003**: A section-line layout saved from the editor MUST become a drawn layout and no longer
  take section lines (`038` FR-005); every other layout keeps how it was made for the Layouts card.
- **FR-004**: The editor MUST require `queuepass-admin`, and MUST show a layout read-only at phone
  width.

**The map and the floor object**

- **FR-005**: The editor MUST draw the layout as the customer map does (`038` FR-016, without
  prices or seat states), zoom and pan as `038` FR-018 does, and let the admin choose the floor
  object (court, end stage, center stage, ring, or none), move it and resize it. The map MUST grow
  to keep every section and the floor object inside it.

**The block generator**

- **FR-006**: **Add section** MUST take a name; a row count; seats per row as one number, or as a
  list of numbers, one per row from the front; a row label style (letters, continuing past Z as AA,
  BB…, or numbers) and a first row label; a first seat number and a numbering direction (left to
  right or right to left as seen from the floor); and a curve (none, or an amount the admin
  chooses).
- **FR-007**: Generating MUST make exactly the rows and seats asked for, rows labelled in order from
  the front, seats labelled in order from the first number, seats evenly spaced at `038`'s standard
  spacing, each row centered on the row in front, and, with a curve, every row bent around one
  center so the block reads as a slice of a bowl. The new section MUST take the chosen level, appear
  near the middle of the visible map, and be selected.
- **FR-008**: A section's outline MUST be drawn around its seats and redrawn whenever its seats
  change; the admin does not draw outlines.
- **FR-009**: A generated section MUST keep its generator values, and **Regenerate** MUST rebuild it
  from changed values, keeping the identity and own level of every row and seat whose label remains,
  and warning before any seat is removed.
- **FR-010**: **Duplicate section** MUST copy a selected section (rows, seats, levels, accessible
  marks) beside it under a new unique name.

**Moving and shaping**

- **FR-011**: The admin MUST be able to select one or several sections (click, Shift-click, or the
  Sections list), move them by dragging or by the arrow keys, and turn them with a rotate handle,
  as one group when several are selected. A section's place and angle MUST also be typeable in the
  Selection panel.
- **FR-012**: In a zoomed section the admin MUST be able to select rows (by label, or a range) and
  seats (click, Shift-click, or a box dragged around them), delete selected seats (a row left with no
  seats is removed; a section left with none asks to be deleted), change a row's or a seat's label,
  and mark seats accessible or not.
- **FR-013**: Deleting a section MUST ask for confirmation, naming its seat count.
- **FR-014**: **Undo** and **Redo** MUST cover every change made since the editor was opened, at
  least the last 50, by buttons and by the usual keys.

**Price levels and painting**

- **FR-015**: The Levels panel MUST list the layout's levels in rank order (1 = most desirable),
  each with its name, color (one of the shared theme's 12 level colors, `038` R13) and seats in it,
  and MUST let the admin add (up to 12), rename, recolor, reorder and delete them. Deleting a level
  that seats use MUST ask which level they take instead; the last level MUST NOT be deleted.
- **FR-016**: With a level chosen, painting MUST set the own level of the selection: sections (their
  section level), rows (the row's own level), or seats (the seat's own level). Choosing **Same as
  the section** (or row) MUST clear a row's or seat's own level. A seat's level stays its own, else its row's, else
  its section's (`038` FR-003).
- **FR-017**: The side panel MUST show, at once after each change, the seats in each level and in
  the whole layout, the sections, and the seats left under the 30,000 limit.
- **FR-018**: Levels MUST always be named beside their color (panel, legend, Selection panel), so
  color is never the only cue (Constitution VII).

**Saving**

- **FR-019**: **Save** MUST save the name, floor object, sections, rows, seats, levels and own levels
  all at once or not at all, under `038`'s rules (limits, names and labels, levels of this layout),
  and a refusal MUST be shown beside the field or on the map at the section at fault, without
  discarding the admin's changes.
- **FR-020**: Before saving, the editor MUST list warnings that do not block a save: sections whose
  seats overlap another section's, and levels with no seats.
- **FR-021**: A save MUST keep the identity of every section, row, seat and level the admin did not
  delete, even when it was moved, turned, relabelled or repainted, so each scheduled event's prices
  and off-sale seats on them survive. Deleted seats MUST take their off-sale entries with them, and
  deleted levels their prices.
- **FR-022**: For every scheduled event using the layout, a save MUST put **new** seats off sale for
  that event and recompute its capacity and prices (`038` FR-006, FR-014), and MUST be refused,
  naming each event and why, when an event would then sell seats in a level it has no price for,
  have no seat on sale, or have a per-customer limit above its seats on sale.
- **FR-023**: A save of a layout that became locked since it was opened MUST be refused, saying why,
  and the editor MUST offer **Save as a new layout**, which saves the work as a new unlocked layout at
  the same venue under a name the admin confirms.
- **FR-024**: A save of a layout another admin saved since it was opened MUST be refused, and the
  editor MUST offer Save as a new layout or reload.
- **FR-025**: The Customer and Admin venue maps (`038` FR-016, FR-027) MUST draw a saved layout
  exactly as the editor last showed it: every section, row and seat in the same place with the same
  label and level.

**Keyboard and screen readers**

- **FR-026**: Every editor action MUST be possible by keyboard alone: the Sections list selects
  sections; the Selection panel takes typed place and angle; arrow keys move the selection (Shift
  for a larger step); rows and seats of the chosen section can be selected from lists and painted,
  deleted, relabelled or marked accessible.
- **FR-027**: Every control MUST have an accessible name and a visible focus, and every change MUST
  be announced in a status line (for example "Section 104 moved", "Rows A–D painted Courtside").

**Process**

- **FR-028**: The contract MUST be updated first (Constitution I) with an operation that saves a
  whole layout from the editor, new or existing, and returns refusals by field; it MUST be additive.
- **FR-029**: Automated tests MUST cover, against real PostgreSQL: saving a drawn layout under every
  `038` rule; identity kept across moves, relabels, repaints and regenerations; new seats off sale
  and the refusals of FR-022; the locked and changed-since-opened refusals; and the generator's
  rows, labels, numbering, curve and row lengths seat by seat. Browser tests (Constitution VI,
  `022`) MUST walk User Stories 1 and 2.
- **FR-030**: This spec MUST amend `038` with dated notes: FR-006 (any layout that is not locked can
  be edited, in the editor), R6 (an imported layout can be edited in `039`'s editor), and the
  Assumption that row and seat levels come only from a layout file.

### Key Entities

No new entities. The editor creates and changes `038`'s:

- **Layout** (changed): may now be drawn in the editor; the way it was made is recorded (file,
  section lines, or drawn) so the Layouts card knows whether section lines apply.
- **Section** (changed): may keep the generator values it was made from, for Regenerate.
- **Price level**, **Row**, **Seat**: as `038`, now set by painting, relabelling, deleting and
  marking accessible in the editor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin who has not used the editor before draws a 10-section bowl of about 3,000
  seats around a court, with three price levels painted by section and by row, in under 15 minutes.
- **SC-002**: Adding a section of 20 rows with the generator and placing it beside the floor object
  takes under 1 minute.
- **SC-003**: The Yum! Center Basketball layout (22,090 seats, 54 sections) opens in the editor within
  3 seconds on a laptop, a dragged or turned section follows the pointer with no visible lag, and a
  save finishes within 5 seconds.
- **SC-004**: After a save, 100% of seats appear on the customer map with the place, label and level
  the editor showed.
- **SC-005**: After an edit of a layout used by scheduled events without sales, 100% of kept seats
  keep each event's off-sale state and 100% of kept levels keep each event's price.
- **SC-006**: 0 changes are ever saved to a locked layout.
- **SC-007**: Every action in the editor can be done by keyboard alone, and no level or warning is
  shown by color alone.
- **SC-008**: Repainting rows A–J of one section to another level takes under 30 seconds.

## Assumptions

- `038` is merged first; this spec changes only the Admin app, the Backend's layout saving, and the
  contract. The customer map, event form, holds and orders are unchanged.
- The proposal's D1 takes its recommended answer, A (Clarifications).
- Seat spacing is `038`'s standard; the admin chooses rows, seats per row and the curve, not spacing.
- The editor is used on a laptop or larger screen with a mouse or trackpad, or by keyboard; touch
  editing is not a target.
- Levels' colors come from the shared theme's 12 level colors (`038` R13, Constitution VII).
- The Rust Admin app (`037`) is not changed here; whether it needs the editor is the same open
  question for John as `038`'s seat maps.

## Out of Scope

- Free drawing of section outlines and placing rows or seats one by one (D1 option B).
- Mirroring sections, snapping to other sections, and custom seat spacing.
- Exporting a layout to a file, and copying a layout to another venue.
- Live co-editing by several admins.
- Editing a locked layout in any way, including versioned layouts.
- Editing on a phone or by touch.
- Any behavior for accessible seats (`#57`).
- Seats shown from a seat (3D views).
