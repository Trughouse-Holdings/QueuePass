//! Spec 037 research R14 (T074): the pure pieces the React editor keeps inside its components,
//! moved here unchanged in behavior so the Leptos views hold no editing logic:
//!
//! - `EditorCanvas.tsx`: `mapFit`, the drag slop, turn snapping, the selection box and turn
//!   handle, the floor's corners and stretch, the map's keys, and the names it gives (LE21–LE33,
//!   LE60, LE61);
//! - `SectionSeatsView.tsx`: `seatsInBox`, the row labels' ends, the seats' names (LE44–LE47);
//! - `SelectionPanel.tsx`: `confirmDeleteSections`, `deleteSeats`, `seatIdsOf`, the Regenerate
//!   confirm, what is selected (LE49–LE58);
//! - `NumberBox.tsx` (`shown`, the send rule) and `CommitBox.tsx` (the keep rule) (LE51, LE52);
//! - `LevelPicker.tsx`: its value, "Mixed", and "Same as…" (LE48);
//! - `LevelsPanel.tsx` and `SectionsPanel.tsx`: their counts and names (LE37–LE42, LE63);
//! - `Guide.tsx`: the steps, their done flags, the fold, and `hintFor` (LE10, LE11);
//! - `LayoutEditor.tsx`: `listed`, the title, the locked note, the undo keys, the guard, the
//!   phone preview's name, and the layout's meta (LE3–LE9, LE59, LE75).

use serde_json::Value;

use super::doc::{
    EdRow, EdSeat, EdSection, EditorDoc, FloorKind, Place, farthest, level_name, seat_level,
};
use super::js;
use super::state::{
    Action, DeletePlan, RegeneratePlan, Selection, Totals, plan_delete_seats, rows_word,
    seat_count, seats_word,
};
use crate::seating::geometry::normalize_angle;
use crate::seating::map_geometry::{Bounds, bounds, js_hypot, js_max, js_min, js_number, js_round};
use crate::seating::pan_zoom::View;

// ------------------------------------------------------------------------------ counts

/// `seatsText`: "1 seat", "6 seats", "30,000 seats".
pub fn seats_text(n: usize) -> String {
    format!(
        "{} {}",
        js::grouped(n as i64),
        if n == 1 { "seat" } else { "seats" }
    )
}

fn count(n: usize, one: &str, many: &str) -> String {
    format!(
        "{} {}",
        js::grouped(n as i64),
        if n == 1 { one } else { many }
    )
}

// ------------------------------------------------------------------------------ EditorCanvas

/// `MIN_WIDTH`, `MIN_HEIGHT`: an empty map shows at least this much, in map units.
pub const MIN_WIDTH: f64 = 300.0;
pub const MIN_HEIGHT: f64 = 200.0;
/// `GROW_STEP`: the map grows in steps of this, so a small move does not reset the view.
pub const GROW_STEP: f64 = 50.0;
/// `DRAG_SLOP`: a press on a section or the floor that moves less than this many pixels is a
/// click, not a drag (the empty map's pan uses `pan_zoom::DRAG_SLOP`, 4).
pub const DRAG_SLOP: f64 = 3.0;

/// `mapFit` (FR-005, LE22): the whole map, from 0, at least 300 × 200, growing in steps of 50
/// to keep every section and the floor object inside it with room around them.
pub fn map_fit(doc: &EditorDoc) -> View {
    let [x, y] = farthest(doc);
    let up = |n: f64, min: f64| js_max([min, ((n + 20.0) / GROW_STEP).ceil() * GROW_STEP]);
    View {
        x: 0.0,
        y: 0.0,
        width: up(x, MIN_WIDTH),
        height: up(y, MIN_HEIGHT),
    }
}

/// `viewCenter`: the middle of the visible map, where a new section or floor goes (FR-007).
pub fn view_center(v: &View) -> Place {
    [v.x + v.width / 2.0, v.y + v.height / 2.0]
}

/// `degreesOf`: the direction from one place to another, in degrees (`atan2`, `y` down).
pub fn degrees_of(from: Place, to: Place) -> f64 {
    (libm::atan2(to[1] - from[1], to[0] - from[0]) * 180.0) / std::f64::consts::PI
}

/// `tenth`: to 0.1 (what a drag sends on release).
pub fn tenth(n: f64) -> f64 {
    js_round(n * 10.0) / 10.0
}

/// Whether a press at `from` (client pixels) has become a drag at `now` (LE27: 3 px).
pub fn past_slop(from: Place, now: Place) -> bool {
    js_hypot(now[0] - from[0], now[1] - from[1]) >= DRAG_SLOP
}

/// The turn handle's live angle (LE28): from the box center to the pointer, less where the drag
/// started, in (−180, 180], snapped to 1° or, with Shift, 15°.
pub fn snap_turn(center: Place, start: f64, at: Place, shift: bool) -> f64 {
    let step = if shift { 15.0 } else { 1.0 };
    let raw = normalize_angle(degrees_of(center, at) - start);
    js_round(raw / step) * step
}

/// `fontSize`: the section names' size, `max(fit w, h) / 60` (LE24).
pub fn section_font_size(fit: &View) -> f64 {
    js_max([fit.width, fit.height]) / 60.0
}

/// `handleR`: the turn handle's and the floor corners' size, `max(1.5, view width / 100)`.
pub fn handle_radius(view: &View) -> f64 {
    js_max([1.5, view.width / 100.0])
}

/// The selection's box (LE25): the bounds of the selected sections' outlines, drawn 1 unit
/// out; none while zoomed or with no section selected.
pub fn selection_box(doc: &EditorDoc, selection: &Selection, zoomed: bool) -> Option<Bounds> {
    let ids = selection.section_ids();
    let points: Vec<Place> = doc
        .sections
        .iter()
        .filter(|s| ids.contains(&s.id))
        .flat_map(|s| s.outline.iter().copied())
        .collect();
    (!points.is_empty() && !zoomed).then(|| bounds(&points))
}

/// Where the turn handle goes (LE28).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TurnHandle {
    /// The box's center, what the selection turns about on screen.
    pub center: Place,
    /// The line's start, the top center of the drawn box.
    pub line_from: Place,
    /// The handle's center: `max(4, view height / 15)` above the drawn box.
    pub at: Place,
}

/// The turn handle above a selection box.
pub fn turn_handle(b: &Bounds, view: &View) -> TurnHandle {
    let center = [b.x + b.width / 2.0, b.y + b.height / 2.0];
    TurnHandle {
        center,
        line_from: [center[0], b.y - 1.0],
        at: [center[0], b.y - 1.0 - js_max([4.0, view.height / 15.0])],
    }
}

/// A floor corner handle (`Corner`), with `data-corner` from [`Corner::as_str`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Corner {
    Nw,
    Ne,
    Se,
    Sw,
}

/// `CORNERS`: the handles in drawing order.
pub const CORNERS: [Corner; 4] = [Corner::Nw, Corner::Ne, Corner::Se, Corner::Sw];

impl Corner {
    /// "nw", "ne", "se", "sw".
    pub fn as_str(self) -> &'static str {
        match self {
            Corner::Nw => "nw",
            Corner::Ne => "ne",
            Corner::Se => "se",
            Corner::Sw => "sw",
        }
    }

    /// `cornerAt`: the corner's place on a box.
    pub fn at(self, b: &Bounds) -> Place {
        [
            if matches!(self, Corner::Nw | Corner::Sw) {
                b.x
            } else {
                b.x + b.width
            },
            if matches!(self, Corner::Nw | Corner::Ne) {
                b.y
            } else {
                b.y + b.height
            },
        ]
    }

    /// `OPPOSITE`: the corner that stays put while this one is dragged.
    pub fn opposite(self) -> Corner {
        match self {
            Corner::Nw => Corner::Se,
            Corner::Ne => Corner::Sw,
            Corner::Se => Corner::Nw,
            Corner::Sw => Corner::Ne,
        }
    }
}

/// The floor's live box while a corner is dragged (LE32): from the fixed corner to the pointer.
/// On release the app sends `resizeFloor` with each number to a tenth.
pub fn corner_box(fixed: Place, at: Place) -> Bounds {
    Bounds {
        x: js_min([fixed[0], at[0]]),
        y: js_min([fixed[1], at[1]]),
        width: (at[0] - fixed[0]).abs(),
        height: (at[1] - fixed[1]).abs(),
    }
}

/// The floor as the corner drag shows it: the outline stretched to `to` (`from.width || 1`).
pub fn stretch_outline(outline: &[Place], to: &Bounds) -> Vec<Place> {
    let from = bounds(outline);
    let or_one = |n: f64| if n == 0.0 || n.is_nan() { 1.0 } else { n };
    outline
        .iter()
        .map(|p| {
            [
                to.x + ((p[0] - from.x) * to.width) / or_one(from.width),
                to.y + ((p[1] - from.y) * to.height) / or_one(from.height),
            ]
        })
        .collect()
}

/// The map's name (LE21): "Layout map: N section(s)".
pub fn map_label(n: usize) -> String {
    format!(
        "Layout map: {n} {}",
        if n == 1 { "section" } else { "sections" }
    )
}

/// A section's name on the map (LE24): "Section 101, Standard, 6 seats" (the count not
/// grouped).
pub fn section_label(doc: &EditorDoc, s: &EdSection) -> String {
    let seats = seat_count(s);
    format!(
        "Section {}, {}, {seats} {}",
        s.name,
        level_name(doc, Some(&s.level_id)),
        if seats == 1 { "seat" } else { "seats" }
    )
}

/// A level's color for `venue-map--<color>`, violet when the level is gone.
pub fn level_color<'a>(doc: &'a EditorDoc, level_id: &str) -> &'a str {
    doc.levels
        .iter()
        .find(|l| l.id == level_id)
        .map_or("violet", |l| l.color.as_str())
}

/// What a key on the focused map (or a section on it) does (LE60, LE61).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MapKey {
    /// Escape: `clearSelection` (read-only too).
    Clear,
    /// Delete or Backspace (edit mode): [`delete_selection`], after `preventDefault`.
    Delete,
    /// An arrow with sections selected: `moveSections` by this.
    Move { dx: f64, dy: f64 },
    /// `[` `{` `]` `}` with sections selected: `turnSections` by this.
    Turn { degrees: f64 },
    /// Anything else: the pan and zoom keys (`pan_zoom::key_action`).
    PanZoom,
}

/// The map's key table (`onKeyDown`). `zoomed` is whether a section is zoomed into;
/// `sections_selected` whether the selection is sections.
pub fn map_key(
    key: &str,
    shift: bool,
    read_only: bool,
    zoomed: bool,
    sections_selected: bool,
) -> MapKey {
    if key == "Escape" {
        return MapKey::Clear;
    }
    if !read_only && (key == "Delete" || key == "Backspace") {
        return MapKey::Delete;
    }
    if !read_only && !zoomed && sections_selected {
        let step = if shift { 10.0 } else { 1.0 };
        match key {
            "ArrowLeft" => return MapKey::Move { dx: -step, dy: 0.0 },
            "ArrowRight" => return MapKey::Move { dx: step, dy: 0.0 },
            "ArrowUp" => return MapKey::Move { dx: 0.0, dy: -step },
            "ArrowDown" => return MapKey::Move { dx: 0.0, dy: step },
            _ => {}
        }
        let turn = match key {
            "[" | "{" => -1.0,
            "]" | "}" => 1.0,
            _ => 0.0,
        };
        if turn != 0.0 {
            return MapKey::Turn {
                degrees: turn * if shift { 15.0 } else { 1.0 },
            };
        }
    }
    MapKey::PanZoom
}

// ------------------------------------------------------------------------------ deleting (SelectionPanel)

/// What a delete asks for.
#[derive(Debug, Clone, PartialEq)]
pub enum DeleteRequest {
    /// Nothing to delete.
    Nothing,
    /// Ask `window.confirm(text)`; on OK dispatch `action`.
    Confirm { text: String, action: Action },
    /// Dispatch at once.
    Do(Action),
}

/// `confirmDeleteSections`'s question (FR-013, LE54): "Delete section 101 and its 6 seats?" /
/// "Delete 2 sections and their 8 seats?", or none when no such section is left.
pub fn confirm_delete_sections(doc: &EditorDoc, ids: &[String]) -> Option<String> {
    let sections: Vec<&EdSection> = doc
        .sections
        .iter()
        .filter(|s| ids.contains(&s.id))
        .map(|s| &**s)
        .collect();
    if sections.is_empty() {
        return None;
    }
    let seats: usize = sections.iter().map(|s| seat_count(s)).sum();
    Some(if sections.len() == 1 {
        format!(
            "Delete section {} and its {}?",
            sections[0].name,
            seats_text(seats)
        )
    } else {
        format!(
            "Delete {} sections and their {}?",
            sections.len(),
            seats_text(seats)
        )
    })
}

/// Deleting sections (Delete sections, Delete section, the key): asks first.
fn delete_sections_request(doc: &EditorDoc, ids: &[String]) -> DeleteRequest {
    match confirm_delete_sections(doc, ids) {
        Some(text) => DeleteRequest::Confirm {
            text,
            action: Action::DeleteSections { ids: ids.to_vec() },
        },
        None => DeleteRequest::Nothing,
    }
}

/// `deleteSeats` (FR-012, LE57): deletes seats of a section at once; when they are all its
/// seats, asks to delete the section instead.
pub fn delete_seats_request(doc: &EditorDoc, section_id: &str, ids: &[String]) -> DeleteRequest {
    if ids.is_empty() {
        return DeleteRequest::Nothing;
    }
    if plan_delete_seats(doc, section_id, ids) == DeletePlan::Section {
        return delete_sections_request(doc, &[section_id.to_string()]);
    }
    DeleteRequest::Do(Action::DeleteSeats {
        section_id: section_id.to_string(),
        ids: ids.to_vec(),
    })
}

/// `seatIdsOf`: the seats a rows or seats selection stands for (none for another selection).
pub fn seat_ids_of(section: &EdSection, selection: &Selection) -> Vec<String> {
    match selection {
        Selection::Seats { ids, .. } => ids.clone(),
        Selection::Rows { ids, .. } => section
            .rows
            .iter()
            .filter(|r| ids.contains(&r.id))
            .flat_map(|r| r.seats.iter().map(|q| q.id.clone()))
            .collect(),
        _ => Vec::new(),
    }
}

/// Delete or Backspace on the map (LE60): sections ask (LE54), rows or seats as Delete seats
/// (LE57), the floor goes at once (LE33).
pub fn delete_selection(doc: &EditorDoc, selection: &Selection) -> DeleteRequest {
    match selection {
        Selection::Sections { ids } => delete_sections_request(doc, ids),
        Selection::Rows { section_id, .. } | Selection::Seats { section_id, .. } => {
            match doc.sections.iter().find(|x| &x.id == section_id) {
                Some(section) => {
                    delete_seats_request(doc, section_id, &seat_ids_of(section, selection))
                }
                None => DeleteRequest::Nothing,
            }
        }
        Selection::Floor => DeleteRequest::Do(Action::SetFloor {
            kind: FloorKind::None,
            at: [0.0, 0.0],
        }),
        Selection::None => DeleteRequest::Nothing,
    }
}

/// Regenerate's question (LE58), or none when nothing goes and no hand label is replaced. The
/// quirk is kept: with no seats removed it reads "Regenerate Labels changed by hand are
/// replaced. Go on?".
pub fn regenerate_confirm(plan: &RegeneratePlan) -> Option<String> {
    if plan.removed == 0 && !plan.hand_labels {
        return None;
    }
    let mut parts = vec![if plan.removed > 0 {
        format!("Regenerate removes {}.", seats_text(plan.removed))
    } else {
        "Regenerate".to_string()
    }];
    if plan.hand_labels {
        parts.push("Labels changed by hand are replaced.".into());
    }
    parts.push("Go on?".into());
    Some(parts.join(" "))
}

// ------------------------------------------------------------------------------ SelectionPanel

/// The section whose rows and seats are listed (LE55): the one section selected, or the one a
/// rows or seats selection is of.
pub fn rows_list_section<'a>(doc: &'a EditorDoc, selection: &Selection) -> Option<&'a EdSection> {
    let id = match selection {
        Selection::Sections { ids } if ids.len() == 1 => &ids[0],
        Selection::Rows { section_id, .. } | Selection::Seats { section_id, .. } => section_id,
        _ => return None,
    };
    doc.sections.iter().find(|s| &s.id == id).map(|s| &**s)
}

/// One section's note (LE50): "<level name> · <n> seat(s)".
pub fn selection_note(doc: &EditorDoc, section: &EdSection) -> String {
    format!(
        "{} · {}",
        level_name(doc, Some(&section.level_id)),
        seats_text(seat_count(section))
    )
}

/// A row in the Rows list (LE55): "Row A · 3 seats".
pub fn row_list_label(row: &EdRow) -> String {
    format!("Row {} · {}", row.label, seats_text(row.seats.len()))
}

/// `PartsSelected`'s line (LE56): "<what> selected in section <name>", or none for a selection
/// that isn't rows or seats of a section still there.
pub fn parts_selected(doc: &EditorDoc, selection: &Selection) -> Option<String> {
    let (section_id, ids, rows) = match selection {
        Selection::Rows { section_id, ids } => (section_id, ids, true),
        Selection::Seats { section_id, ids } => (section_id, ids, false),
        _ => return None,
    };
    let section = doc.sections.iter().find(|s| &s.id == section_id)?;
    let what = if rows {
        rows_word(section, ids)
    } else if ids.len() == 1 {
        seats_word(section, ids)
    } else {
        format!("{} seats", ids.len())
    };
    Some(format!("{what} selected in section {}", section.name))
}

/// What a name or label box does on Enter or blur (`CommitBox`'s `keep`, LE52).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitOutcome {
    /// The same trimmed text: the problem cleared, nothing sent.
    Same,
    /// Shown beside the box with `aria-invalid`; nothing sent.
    Problem(String),
    /// Sent (the reducer trims it).
    Commit(String),
}

/// `CommitBox`'s `keep`: `check` is the box's problem rule (`sectionNameProblem`, …).
pub fn commit_outcome(
    text: &str,
    value: &str,
    check: impl FnOnce(&str) -> Option<String>,
) -> CommitOutcome {
    if js::trim(text) == value {
        return CommitOutcome::Same;
    }
    match check(text) {
        Some(p) => CommitOutcome::Problem(p),
        None => CommitOutcome::Commit(text.to_string()),
    }
}

// ------------------------------------------------------------------------------ SectionSeatsView

/// `SPACING`: the seats' spacing, as the shared map draws them.
pub const SPACING: f64 = 2.0;
/// `RADIUS`: a seat's circle.
pub const SEAT_RADIUS: f64 = SPACING * 0.4;
/// An accessible seat's inner circle (`RADIUS * 0.45`).
pub const ACCESSIBLE_RADIUS: f64 = SEAT_RADIUS * 0.45;
/// A row label's font size.
pub const ROW_LABEL_SIZE: f64 = SPACING * 0.8;

/// Where a row's label goes (LE44): 2.4 units past each end seat along the row; none for a row
/// without seats.
pub fn row_label_ends(row: &EdRow) -> Vec<Place> {
    let (Some(first), Some(last)) = (row.seats.first(), row.seats.last()) else {
        return Vec::new();
    };
    let mut dir = [1.0, 0.0];
    if row.seats.len() > 1 {
        let dx = last.at[0] - first.at[0];
        let dy = last.at[1] - first.at[1];
        let h = js_hypot(dx, dy);
        let len = if h == 0.0 || h.is_nan() { 1.0 } else { h };
        dir = [dx / len, dy / len];
    }
    let gap = SPACING * 1.2;
    vec![
        [first.at[0] - dir[0] * gap, first.at[1] - dir[1] * gap],
        [last.at[0] + dir[0] * gap, last.at[1] + dir[1] * gap],
    ]
}

/// A seat's name (LE45): "Row A, Seat 1, Courtside" (+ ", accessible").
pub fn seat_label(doc: &EditorDoc, section: &EdSection, row: &EdRow, seat: &EdSeat) -> String {
    format!(
        "Row {}, Seat {}, {}{}",
        row.label,
        seat.label,
        level_name(doc, Some(seat_level(section, row, seat))),
        if seat.accessible { ", accessible" } else { "" }
    )
}

/// A seat's press (LE45): selects only it; Shift adds or removes it.
pub fn seat_click(section_id: &str, seat_id: &str, shift: bool) -> Action {
    Action::SelectSeats {
        section_id: section_id.to_string(),
        ids: vec![seat_id.to_string()],
        add: shift,
    }
}

/// A row label's press (LE46): selects only that row; Shift the range from the last selected.
pub fn row_click(section_id: &str, row_id: &str, shift: bool) -> Action {
    if shift {
        Action::SelectRowRange {
            section_id: section_id.to_string(),
            to_id: row_id.to_string(),
        }
    } else {
        Action::SelectRows {
            section_id: section_id.to_string(),
            ids: vec![row_id.to_string()],
            add: false,
        }
    }
}

/// `seatsInBox` (LE47): the seats of a section inside a box of map places, edges included.
pub fn seats_in_box(section: &EdSection, a: Place, b: Place) -> Vec<String> {
    let (x0, x1) = (js_min([a[0], b[0]]), js_max([a[0], b[0]]));
    let (y0, y1) = (js_min([a[1], b[1]]), js_max([a[1], b[1]]));
    section
        .rows
        .iter()
        .flat_map(|r| {
            r.seats
                .iter()
                .filter(|s| s.at[0] >= x0 && s.at[0] <= x1 && s.at[1] >= y0 && s.at[1] <= y1)
                .map(|s| s.id.clone())
        })
        .collect()
}

// ------------------------------------------------------------------------------ NumberBox

/// `shown`: a number as the box shows it: to 0.1, no `-0`.
pub fn shown(n: f64) -> String {
    let r = js_round(n * 10.0) / 10.0;
    js_number(if r == 0.0 { 0.0 } else { r })
}

/// The box's `send` (LE51): the typed number, when it is finite and shows differently from
/// `value`; else nothing.
pub fn number_to_send(raw: &str, value: f64) -> Option<f64> {
    let n = if js::trim(raw).is_empty() {
        f64::NAN
    } else {
        js::to_number(raw)
    };
    (n.is_finite() && shown(n) != shown(value)).then_some(n)
}

// ------------------------------------------------------------------------------ LevelPicker

/// The picker's value (LE48).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PickerValue {
    /// "Mixed" (disabled): the selection's levels differ.
    Mixed,
    /// "Same as the section/row …": none of them has its own level.
    Inherit,
    /// A level's id.
    Level(String),
}

impl PickerValue {
    /// The `<option>` value: `__mixed`, `__inherit`, or the level's id.
    pub fn as_value(&self) -> &str {
        match self {
            PickerValue::Mixed => "__mixed",
            PickerValue::Inherit => "__inherit",
            PickerValue::Level(id) => id,
        }
    }

    /// The value of a chosen `<option>`.
    pub fn from_value(v: &str) -> PickerValue {
        match v {
            "__mixed" => PickerValue::Mixed,
            "__inherit" => PickerValue::Inherit,
            id => PickerValue::Level(id.to_string()),
        }
    }
}

/// What the Price level picker shows (LE48).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LevelPick {
    pub value: PickerValue,
    /// The first option for rows ("Same as the section (Standard)") or seats ("Same as the
    /// row (Courtside)", or "Same as the row" when their rows differ); none for sections.
    pub inherit: Option<String>,
    /// The swatch's color when the value is a level, else hidden.
    pub swatch: Option<String>,
}

/// `LevelPicker`'s reading of a selection, or none (no picker) for nothing, the floor, or a
/// selection whose parts are gone.
pub fn level_pick(doc: &EditorDoc, selection: &Selection) -> Option<LevelPick> {
    let mut own: Vec<Option<&str>> = Vec::new();
    let mut inherit = None;
    match selection {
        Selection::Sections { ids } => {
            own = doc
                .sections
                .iter()
                .filter(|s| ids.contains(&s.id))
                .map(|s| Some(s.level_id.as_str()))
                .collect();
        }
        Selection::Rows { section_id, ids } => {
            let section = doc.sections.iter().find(|s| &s.id == section_id)?;
            own = section
                .rows
                .iter()
                .filter(|r| ids.contains(&r.id))
                .map(|r| r.level_id.as_deref())
                .collect();
            inherit = Some(format!(
                "Same as the section ({})",
                level_name(doc, Some(&section.level_id))
            ));
        }
        Selection::Seats { section_id, ids } => {
            let section = doc.sections.iter().find(|s| &s.id == section_id)?;
            let mut row_levels: Vec<&str> = Vec::new();
            for r in &section.rows {
                for q in &r.seats {
                    if !ids.contains(&q.id) {
                        continue;
                    }
                    own.push(q.level_id.as_deref());
                    let level = r.level_id.as_deref().unwrap_or(&section.level_id);
                    if !row_levels.contains(&level) {
                        row_levels.push(level);
                    }
                }
            }
            inherit = Some(if row_levels.len() == 1 {
                format!("Same as the row ({})", level_name(doc, Some(row_levels[0])))
            } else {
                "Same as the row".to_string()
            });
        }
        Selection::None | Selection::Floor => return None,
    }
    let first = *own.first()?;
    let value = if own.iter().all(|v| *v == first) {
        first.map_or(PickerValue::Inherit, |id| {
            PickerValue::Level(id.to_string())
        })
    } else {
        PickerValue::Mixed
    };
    let swatch = match &value {
        PickerValue::Level(id) => doc
            .levels
            .iter()
            .find(|l| &l.id == id)
            .map(|l| l.color.clone()),
        _ => None,
    };
    Some(LevelPick {
        value,
        inherit,
        swatch,
    })
}

/// The action for a chosen value: a level paints, "Same as…" clears, "Mixed" does nothing.
pub fn pick_action(choice: &PickerValue) -> Option<Action> {
    match choice {
        PickerValue::Mixed => None,
        PickerValue::Inherit => Some(Action::ClearLevel),
        PickerValue::Level(id) => Some(Action::Paint {
            level_id: id.clone(),
        }),
    }
}

// ------------------------------------------------------------------------------ LevelsPanel, SectionsPanel

/// `colorName`: a level color's name in the select, "Teal".
pub fn color_name(c: &str) -> String {
    let mut chars = c.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// The Price levels panel's total (LE37): "Total: 8 seats".
pub fn total_text(t: &Totals) -> String {
    format!("Total: {}", seats_text(t.seats))
}

/// Delete level's select label (LE41): "Its 6 seats take".
pub fn delete_level_label(seats: usize) -> String {
    format!("Its {} take", seats_text(seats))
}

/// The Sections panel's totals (LE63): "2 sections · 348 seats".
pub fn sections_totals(t: &Totals) -> String {
    format!(
        "{} · {}",
        count(t.sections, "section", "sections"),
        count(t.seats, "seat", "seats")
    )
}

/// The Sections panel's note (LE63): "29,652 seats left of 30,000".
pub fn sections_left(t: &Totals) -> String {
    format!("{} seats left of 30,000", js::grouped(t.seats_left))
}

/// A section in the Sections list (LE63): "101 · 6 seats".
pub fn section_item(s: &EdSection) -> String {
    format!("{} · {}", s.name, count(seat_count(s), "seat", "seats"))
}

// ------------------------------------------------------------------------------ Guide

/// The guide's five steps (LE10).
pub const GUIDE_STEPS: [&str; 5] = [
    "Pick a floor object (Court, End stage, Center stage or Ring) under Floor object, then drag its corners on the map to size it.",
    "Add a section: in Sections, press Add section, type its rows and seats per row (and a curve for a bowl), and press Generate. It appears in the middle of the map.",
    "Drag the section into place, and drag the round handle above it to turn it toward the floor. Duplicate section (under Selection) makes the next one faster.",
    "Give seats price levels: add levels under Price levels (Add level), then select sections (or, after double-clicking a section, rows and seats) and choose their level under Selection: Price level.",
    "Name the layout at the top and press Save.",
];

/// A step of the guide: done (struck through, with a hidden "Done: "), and its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GuideStep {
    pub done: bool,
    pub text: &'static str,
}

/// The guide's steps (LE10): step 1 done when the floor kind isn't None; step 2 with a section;
/// step 4 with more than one level or the first not named "Standard"; steps 3 and 5 never.
pub fn guide_steps(doc: &EditorDoc) -> [GuideStep; 5] {
    let leveled =
        doc.levels.len() > 1 || doc.levels.first().map(|l| l.name.as_str()) != Some("Standard");
    let done = [
        doc.floor.kind != FloorKind::None,
        !doc.sections.is_empty(),
        false,
        leveled,
        false,
    ];
    std::array::from_fn(|i| GuideStep {
        done: done[i],
        text: GUIDE_STEPS[i],
    })
}

/// Whether the guide starts open (LE10): only when the layout has no sections.
pub fn guide_open_at_start(doc: &EditorDoc) -> bool {
    doc.sections.is_empty()
}

/// Whether the guide is open after the document changes (LE10): it folds when the first section
/// appears (`had` none, `has` some); otherwise it stays as the admin left it (`open`).
pub fn guide_open_after(open: bool, had: bool, has: bool) -> bool {
    if has && !had { false } else { open }
}

/// `hintFor` (LE11): what can be done now, by what is selected; first match wins.
pub fn hint_for(selection: &Selection, zoomed: bool, has_sections: bool) -> &'static str {
    if zoomed {
        return "Click seats (Shift-click for more) or a row label (Shift-click another for a range of rows); Box select draws a box around seats. Then choose their level under Selection: Price level. Back to layout returns to the whole map.";
    }
    match selection {
        Selection::Sections { .. } => {
            "Drag it to move it. Drag the round handle above it to turn it. Choose its level under Selection: Price level. Double-click it to see its seats. The arrow keys move it, and [ and ] turn it."
        }
        Selection::Floor => {
            "Drag the floor to move it; drag its corners to size it. Delete (the key, or Delete floor object under Selection) removes it."
        }
        _ if !has_sections => "Start with the steps above: a floor object, then a section.",
        _ => {
            "Click a section to select it (Shift-click for more). Drag empty space to move the map; scroll or use the zoom buttons to zoom."
        }
    }
}

// ------------------------------------------------------------------------------ LayoutEditor

/// `LEAVE` (R13, LE4): the question before unsaved changes are thrown away.
pub const LEAVE: &str = "Leave without saving? Your changes will be lost.";
/// The loading line (LE3).
pub const LOADING: &str = "Loading the layout…";
/// The load failure's banner title (LE3).
pub const COULD_NOT_OPEN: &str = "Could not open the layout";
/// Duplicate to edit's failure banner title (LE75).
pub const COULD_NOT_DUPLICATE: &str = "Could not duplicate the layout";
/// The phone-width note (LE9).
pub const NEEDS_WIDER: &str = "Editing a layout needs a wider screen.";

/// `listed`: "A", "A and B", "A, B and C".
pub fn listed(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// The locked note (LE75): "Locked: seats are sold or held at <A and B>" (no final period).
pub fn locked_note(names: &[String]) -> String {
    format!("Locked: seats are sold or held at {}", listed(names))
}

/// The h1 (LE6): "New layout"; an unlocked layout "Edit layout: <saved name>" (the last saved
/// name, not the typing); a locked one its name.
pub fn editor_title(existing: bool, locked: bool, doc_name: &str, saved_name: &str) -> String {
    match (existing, locked) {
        (false, _) => "New layout".into(),
        (true, true) => doc_name.into(),
        (true, false) => format!("Edit layout: {saved_name}"),
    }
}

/// The editor-wide undo keys (LE59): Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z and Cmd/Ctrl+Y redo;
/// nothing inside an input, textarea, or select. The app calls `preventDefault` when this is
/// some.
pub fn undo_key(
    key: &str,
    meta: bool,
    ctrl: bool,
    shift: bool,
    in_text_box: bool,
) -> Option<Action> {
    if !(meta || ctrl) || in_text_box {
        return None;
    }
    match key.to_lowercase().as_str() {
        "z" => Some(if shift { Action::Redo } else { Action::Undo }),
        "y" => Some(Action::Redo),
        _ => None,
    }
}

/// The guard (LE4): leaving for another path while dirty asks [`LEAVE`]; a search-only change
/// passes.
pub fn should_guard(dirty: bool, current_path: &str, next_path: &str) -> bool {
    dirty && current_path != next_path
}

/// The phone preview's name (`previewOf`, LE9): "<name or 'New layout'>: N section(s)".
pub fn preview_label(doc: &EditorDoc) -> String {
    let name = if doc.name.is_empty() {
        "New layout"
    } else {
        doc.name.as_str()
    };
    let n = doc.sections.len();
    format!(
        "{name}: {n} {}",
        if n == 1 { "section" } else { "sections" }
    )
}

/// An event locking a layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockedBy {
    pub id: String,
    pub name: String,
}

/// `Meta`: what the editor knows of the saved layout beside its document (R9).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LayoutMeta {
    pub revision: Option<u64>,
    pub locked: bool,
    pub locked_by: Vec<LockedBy>,
}

/// `metaOf`: a `LayoutDrawing`'s revision and lock.
pub fn meta_of(d: &Value) -> LayoutMeta {
    LayoutMeta {
        revision: d["revision"].as_u64(),
        locked: d["locked"].as_bool().unwrap_or(false),
        locked_by: d["lockedBy"]
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|e| LockedBy {
                        id: e["id"].as_str().unwrap_or_default().to_string(),
                        name: e["name"].as_str().unwrap_or_default().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}
