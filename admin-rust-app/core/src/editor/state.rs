//! Spec 037 research R14 (T074): the layout editor's state, one pure reducer over the document,
//! the selection and the history, ported from `admin-app/src/layout-editor/editor-state.ts` (039
//! research R5–R7, R10, R12; parity LE5, LE18, LE19, LE27–LE33, LE38–LE42, LE48, LE51–LE58,
//! LE64–LE66, LE80). Every change is an action and one history step; a step replaces only the
//! sections it touches (they are shared, `Arc`), so the history keeps the last 100 documents
//! cheaply. "Dirty" is "the document is not the one last loaded or saved" (the same `Arc`), so an
//! Undo back to it is clean. Each step says what it did (`message`), for the status line and
//! Undo's "Undone: …" (FR-027). The Leptos editor holds one [`EditorState`], dispatches
//! [`Action`]s through [`reduce`], and reads [`current_doc`], [`is_dirty`] and [`totals`].
//!
//! Quirks kept (they make the two apps the same): painting a selection its own level (LE48) and
//! marking accessible seats accessible again (LE56) still make a step; a relabelled seat is a
//! step even with the same label (the box guards it); a level's name problem is the message
//! only, not cleared by another action.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

use super::doc::{
    EdFloor, EdLevel, EdRow, EdSeat, EdSection, EditorDoc, FloorKind, Place, SectionGenerator,
    is_new, level_name, outline_of, seat_level,
};
use super::js;
use crate::seating::geometry::{
    LAYOUT_LIMITS, LEVEL_COLORS, generate_block, move_by, normalize_angle, place_block, turn_about,
};
use crate::seating::map_geometry::{Bounds, js_max, js_min, js_number};

/// `Selection`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Selection {
    None,
    Floor,
    Sections {
        ids: Vec<String>,
    },
    Rows {
        section_id: String,
        ids: Vec<String>,
    },
    Seats {
        section_id: String,
        ids: Vec<String>,
    },
}

impl Selection {
    /// The selected sections' ids (`selection.kind === 'sections' ? selection.ids : []`).
    pub fn section_ids(&self) -> &[String] {
        match self {
            Selection::Sections { ids } => ids,
            _ => &[],
        }
    }

    /// The section of a rows or seats selection (`'sectionId' in selection`).
    pub fn parts_section(&self) -> Option<&str> {
        match self {
            Selection::Rows { section_id, .. } | Selection::Seats { section_id, .. } => {
                Some(section_id)
            }
            _ => None,
        }
    }
}

/// `EditorState`.
#[derive(Debug, Clone, PartialEq)]
pub struct EditorState {
    /// The documents, oldest first; at most [`HISTORY_LIMIT`].
    pub history: Vec<Arc<EditorDoc>>,
    /// What made each document (`steps[0]` is the load).
    pub steps: Vec<String>,
    pub cursor: usize,
    /// The document as last loaded or saved.
    pub saved: Arc<EditorDoc>,
    pub selection: Selection,
    /// The section zoomed into (its seats drawn), or none.
    pub zoomed: Option<String>,
    /// The last `new:<n>` given out.
    pub seq: u64,
    /// The status line's announcement of the last action (FR-027).
    pub message: String,
    /// A step that typing goes on changing (a name being typed), or none.
    pub typing: Option<String>,
}

/// `HISTORY_LIMIT` (R10): at most this many documents (FR-014 asks at least the last 50 changes).
pub const HISTORY_LIMIT: usize = 100;

/// `FLOOR_NAMES`, in the select's order.
pub const FLOOR_NAMES: [(FloorKind, &str); 5] = [
    (FloorKind::None, "None"),
    (FloorKind::Court, "Court"),
    (FloorKind::EndStage, "End stage"),
    (FloorKind::CenterStage, "Center stage"),
    (FloorKind::Ring, "Ring"),
];

/// `FLOOR_SIZE`: a new floor object's size in map units (seats are 2 apart).
fn floor_size(kind: FloorKind) -> Place {
    match kind {
        FloorKind::Court => [100.0, 56.0],
        FloorKind::EndStage => [80.0, 30.0],
        FloorKind::CenterStage => [40.0, 40.0],
        FloorKind::Ring | FloorKind::None => [30.0, 30.0],
    }
}

/// `Action`: one variant per action of `editor-state.ts`, with its fields. It reads the
/// TypeScript's action objects too (`{ "type": "moveSections", "ids": [...], "dx": 1, "dy": 0 }`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Load {
        doc: EditorDoc,
    },
    /// The save of `sent` went through; `doc` is the layout read back after it, with the ids
    /// the Backend gave what was new, when it could be read.
    #[serde(skip)]
    Saved {
        sent: Arc<EditorDoc>,
        doc: Option<EditorDoc>,
    },
    Undo,
    Redo,
    SelectSections {
        ids: Vec<String>,
    },
    ToggleSection {
        id: String,
    },
    SelectFloor,
    ClearSelection,
    Zoom {
        id: Option<String>,
    },
    Rename {
        name: String,
    },
    SetFloor {
        kind: FloorKind,
        at: Place,
    },
    MoveFloor {
        dx: f64,
        dy: f64,
    },
    ResizeFloor {
        to: Bounds,
    },
    AddSection {
        name: String,
        values: SectionGenerator,
        level_id: String,
        at: Place,
    },
    MoveSections {
        ids: Vec<String>,
        dx: f64,
        dy: f64,
    },
    TurnSections {
        ids: Vec<String>,
        degrees: f64,
    },
    PlaceSection {
        id: String,
        #[serde(default)]
        origin: Option<Place>,
        #[serde(default)]
        angle: Option<f64>,
    },
    SelectRows {
        section_id: String,
        ids: Vec<String>,
        #[serde(default)]
        add: bool,
    },
    SelectRowRange {
        section_id: String,
        to_id: String,
    },
    SelectSeats {
        section_id: String,
        ids: Vec<String>,
        #[serde(default)]
        add: bool,
    },
    AddLevel,
    RenameLevel {
        id: String,
        name: String,
    },
    RecolorLevel {
        id: String,
        color: String,
    },
    /// `by` is −1 (up) or 1 (down).
    MoveLevel {
        id: String,
        by: i32,
    },
    DeleteLevel {
        id: String,
        replacement: String,
    },
    Paint {
        level_id: String,
    },
    ClearLevel,
    DuplicateSection {
        id: String,
    },
    RenameSection {
        id: String,
        name: String,
    },
    DeleteSeats {
        section_id: String,
        ids: Vec<String>,
    },
    DeleteSections {
        ids: Vec<String>,
    },
    RelabelRow {
        section_id: String,
        row_id: String,
        label: String,
    },
    RelabelSeat {
        section_id: String,
        seat_id: String,
        label: String,
    },
    MarkAccessible {
        section_id: String,
        ids: Vec<String>,
        accessible: bool,
    },
    Regenerate {
        id: String,
        values: SectionGenerator,
    },
}

/// `currentDoc`.
pub fn current_doc(s: &EditorState) -> &Arc<EditorDoc> {
    &s.history[s.cursor]
}

/// `isDirty` (LE5): the current document is not the one last loaded or saved.
pub fn is_dirty(s: &EditorState) -> bool {
    !Arc::ptr_eq(current_doc(s), &s.saved)
}

/// `highestNew`: the highest `new:<n>` in a document, so new ids never repeat one.
fn highest_new(doc: &EditorDoc) -> u64 {
    let mut n = 0;
    let mut see = |id: &str| {
        if let Some(d) = id.strip_prefix("new:")
            && !d.is_empty()
            && d.bytes().all(|b| b.is_ascii_digit())
        {
            // `Number(m[1])`: digits past u64 are read as its largest.
            n = n.max(d.parse().unwrap_or(u64::MAX));
        }
    };
    doc.levels.iter().for_each(|l| see(&l.id));
    for s in &doc.sections {
        see(&s.id);
        for r in &s.rows {
            see(&r.id);
            r.seats.iter().for_each(|x| see(&x.id));
        }
    }
    n
}

/// `initState`.
pub fn init_state(doc: EditorDoc) -> EditorState {
    let seq = highest_new(&doc);
    let doc = Arc::new(doc);
    EditorState {
        history: vec![doc.clone()],
        steps: vec!["Loaded".into()],
        cursor: 0,
        saved: doc,
        selection: Selection::None,
        zoomed: None,
        seq,
        message: String::new(),
        typing: None,
    }
}

// ------------------------------------------------------------------------------ totals

/// `Totals`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Totals {
    pub sections: usize,
    pub seats: usize,
    /// Under the 30,000 limit (FR-017); below 0 for a layout carried over with more.
    pub seats_left: i64,
    /// Seats in each level, resolved seat → row → section; 0 for a level no seat is in.
    pub by_level: BTreeMap<String, usize>,
}

impl Totals {
    /// `t.byLevel[id] ?? 0`.
    pub fn level(&self, id: &str) -> usize {
        self.by_level.get(id).copied().unwrap_or(0)
    }
}

/// `totals` (FR-017): the side panel's counts, from the document.
pub fn totals(doc: &EditorDoc) -> Totals {
    let mut by_level: BTreeMap<String, usize> =
        doc.levels.iter().map(|l| (l.id.clone(), 0)).collect();
    let mut seats = 0;
    for s in &doc.sections {
        for r in &s.rows {
            for x in &r.seats {
                *by_level.entry(seat_level(s, r, x).to_string()).or_insert(0) += 1;
                seats += 1;
            }
        }
    }
    Totals {
        sections: doc.sections.len(),
        seats,
        seats_left: LAYOUT_LIMITS.max_seats as i64 - seats as i64,
        by_level,
    }
}

/// `seatCount`.
pub fn seat_count(s: &EdSection) -> usize {
    s.rows.iter().map(|r| r.seats.len()).sum()
}

// ------------------------------------------------------------------------------ history

/// What a step sets besides the document (`commit`'s `extra`).
#[derive(Default)]
struct Extra {
    selection: Option<Selection>,
    seq: Option<u64>,
    zoomed: Option<Option<String>>,
    typing: Option<String>,
}

/// `commit`: one step. `doc` becomes the current document, after the cursor (the redo side
/// goes), the oldest dropped past 100. With `typing`, a step of the same `typing` key just
/// before is replaced, so a name typed letter by letter is one step. (Every caller passes a new
/// document, so the TypeScript's "same document, no step" never applies.)
fn commit(s: &EditorState, doc: EditorDoc, message: String, extra: Extra) -> EditorState {
    let replace = extra.typing.is_some()
        && s.typing == extra.typing
        && s.cursor > 0
        && s.cursor == s.history.len() - 1;
    let keep = if replace { s.cursor } else { s.cursor + 1 };
    let mut history: Vec<Arc<EditorDoc>> = s.history[..keep].to_vec();
    history.push(Arc::new(doc));
    let mut steps: Vec<String> = s.steps[..keep].to_vec();
    steps.push(message.clone());
    if history.len() > HISTORY_LIMIT {
        history.drain(..history.len() - HISTORY_LIMIT);
        steps.drain(..steps.len() - HISTORY_LIMIT);
    }
    EditorState {
        cursor: history.len() - 1,
        history,
        steps,
        saved: s.saved.clone(),
        selection: extra.selection.unwrap_or_else(|| s.selection.clone()),
        zoomed: extra.zoomed.unwrap_or_else(|| s.zoomed.clone()),
        seq: extra.seq.unwrap_or(s.seq),
        message,
        typing: extra.typing,
    }
}

/// The state with only its message changed (`{ ...s, message }`).
fn say(s: &EditorState, message: impl Into<String>) -> EditorState {
    EditorState {
        message: message.into(),
        ..s.clone()
    }
}

/// `newIds` (review S1): the ids the Backend gave the parts of `sent` that were new, from the
/// layout read back after the save. A save keeps the order of levels, sections, rows and seats,
/// so they match by place; a part whose place doesn't line up is left as it was.
fn new_ids(sent: &EditorDoc, back: &EditorDoc) -> HashMap<String, String> {
    let mut ids = HashMap::new();
    let mut pair = |mine: &str, theirs: Option<&str>| {
        if let Some(t) = theirs
            && !t.is_empty()
            && is_new(mine)
        {
            ids.insert(mine.to_string(), t.to_string());
        }
    };
    for (i, l) in sent.levels.iter().enumerate() {
        pair(&l.id, back.levels.get(i).map(|x| x.id.as_str()));
    }
    for (i, x) in sent.sections.iter().enumerate() {
        let Some(y) = back.sections.get(i) else {
            continue;
        };
        pair(&x.id, Some(&y.id));
        for (j, r) in x.rows.iter().enumerate() {
            let Some(q) = y.rows.get(j) else { continue };
            pair(&r.id, Some(&q.id));
            for (k, seat) in r.seats.iter().enumerate() {
                pair(&seat.id, q.seats.get(k).map(|z| z.id.as_str()));
            }
        }
    }
    ids
}

/// `remapper`: documents with `ids` put in place of the old ones, each part made again only if
/// it changed; the same document (or section) in gives the same one out.
struct Remapper<'a> {
    ids: &'a HashMap<String, String>,
    docs: HashMap<*const EditorDoc, Arc<EditorDoc>>,
    sections: HashMap<*const EdSection, Arc<EdSection>>,
}

impl Remapper<'_> {
    fn id(&self, v: &str) -> String {
        self.ids.get(v).cloned().unwrap_or_else(|| v.to_string())
    }

    fn level(&self, v: &Option<String>) -> Option<String> {
        v.as_deref().map(|x| self.id(x))
    }

    fn touched(&self, v: &Option<String>) -> bool {
        v.as_deref().is_some_and(|x| self.ids.contains_key(x))
    }

    fn section(&mut self, x: &Arc<EdSection>) -> Arc<EdSection> {
        if let Some(done) = self.sections.get(&Arc::as_ptr(x)) {
            return done.clone();
        }
        let mut changed = self.ids.contains_key(&x.id) || self.ids.contains_key(&x.level_id);
        let rows: Vec<EdRow> = x
            .rows
            .iter()
            .map(|r| {
                let touched = self.ids.contains_key(&r.id)
                    || self.touched(&r.level_id)
                    || r.seats
                        .iter()
                        .any(|q| self.ids.contains_key(&q.id) || self.touched(&q.level_id));
                if !touched {
                    return r.clone();
                }
                changed = true;
                EdRow {
                    id: self.id(&r.id),
                    level_id: self.level(&r.level_id),
                    seats: r
                        .seats
                        .iter()
                        .map(|q| EdSeat {
                            id: self.id(&q.id),
                            level_id: self.level(&q.level_id),
                            ..q.clone()
                        })
                        .collect(),
                    ..r.clone()
                }
            })
            .collect();
        let out = if changed {
            Arc::new(EdSection {
                id: self.id(&x.id),
                level_id: self.id(&x.level_id),
                rows,
                ..(**x).clone()
            })
        } else {
            x.clone()
        };
        self.sections.insert(Arc::as_ptr(x), out.clone());
        out
    }

    fn doc(&mut self, d: &Arc<EditorDoc>) -> Arc<EditorDoc> {
        if self.ids.is_empty() {
            return d.clone();
        }
        if let Some(done) = self.docs.get(&Arc::as_ptr(d)) {
            return done.clone();
        }
        let levels_changed = d.levels.iter().any(|l| self.ids.contains_key(&l.id));
        let mapped: Vec<Arc<EdSection>> = d.sections.iter().map(|x| self.section(x)).collect();
        let same = !levels_changed
            && mapped
                .iter()
                .zip(&d.sections)
                .all(|(a, b)| Arc::ptr_eq(a, b));
        let out = if same {
            d.clone()
        } else {
            Arc::new(EditorDoc {
                levels: if levels_changed {
                    d.levels
                        .iter()
                        .map(|l| EdLevel {
                            id: self.id(&l.id),
                            ..l.clone()
                        })
                        .collect()
                } else {
                    d.levels.clone()
                },
                sections: mapped,
                ..(**d).clone()
            })
        };
        self.docs.insert(Arc::as_ptr(d), out.clone());
        out
    }
}

/// `remapSelection`.
fn remap_selection(sel: &Selection, ids: &HashMap<String, String>) -> Selection {
    let id = |v: &String| ids.get(v).cloned().unwrap_or_else(|| v.clone());
    match sel {
        Selection::Sections { ids: s } => Selection::Sections {
            ids: s.iter().map(id).collect(),
        },
        Selection::Rows { section_id, ids: s } => Selection::Rows {
            section_id: id(section_id),
            ids: s.iter().map(id).collect(),
        },
        Selection::Seats { section_id, ids: s } => Selection::Seats {
            section_id: id(section_id),
            ids: s.iter().map(id).collect(),
        },
        other => other.clone(),
    }
}

/// `sanitize`: the selection with what no longer exists taken out.
fn sanitize(sel: &Selection, doc: &EditorDoc) -> Selection {
    match sel {
        Selection::None => Selection::None,
        Selection::Floor => {
            if doc.floor.outline.is_some() {
                Selection::Floor
            } else {
                Selection::None
            }
        }
        Selection::Sections { ids } => {
            let ids: Vec<String> = ids
                .iter()
                .filter(|id| doc.sections.iter().any(|x| &x.id == *id))
                .cloned()
                .collect();
            if ids.is_empty() {
                Selection::None
            } else {
                Selection::Sections { ids }
            }
        }
        Selection::Rows { section_id, ids } | Selection::Seats { section_id, ids } => {
            let Some(section) = doc.sections.iter().find(|x| &x.id == section_id) else {
                return Selection::None;
            };
            let present: HashSet<&str> = if matches!(sel, Selection::Rows { .. }) {
                section.rows.iter().map(|r| r.id.as_str()).collect()
            } else {
                section
                    .rows
                    .iter()
                    .flat_map(|r| r.seats.iter().map(|x| x.id.as_str()))
                    .collect()
            };
            let ids: Vec<String> = ids
                .iter()
                .filter(|id| present.contains(id.as_str()))
                .cloned()
                .collect();
            match (ids.is_empty(), sel) {
                (true, _) => Selection::None,
                (false, Selection::Rows { .. }) => Selection::Rows {
                    section_id: section_id.clone(),
                    ids,
                },
                (false, _) => Selection::Seats {
                    section_id: section_id.clone(),
                    ids,
                },
            }
        }
    }
}

/// `travel`: Undo or Redo to `to`, the selection cleaned up, the zoom ended if its section went.
fn travel(s: &EditorState, to: isize, undo: bool) -> EditorState {
    if to < 0 || to as usize >= s.history.len() {
        return s.clone();
    }
    let to = to as usize;
    let step = if undo {
        &s.steps[s.cursor]
    } else {
        &s.steps[to]
    };
    let doc = &s.history[to];
    let zoomed = s
        .zoomed
        .as_ref()
        .filter(|z| doc.sections.iter().any(|x| &&x.id == z))
        .cloned();
    let word = if undo { "Undone" } else { "Redone" };
    EditorState {
        cursor: to,
        selection: sanitize(&s.selection, doc),
        zoomed,
        message: format!("{word}: {}", js::lower_first(step)),
        typing: None,
        ..s.clone()
    }
}

// ------------------------------------------------------------------------------ geometry

/// `places`: every place of a document: seats, outlines, origins, the floor.
fn places(doc: &EditorDoc) -> impl Iterator<Item = &Place> {
    doc.sections
        .iter()
        .flat_map(|s| {
            std::iter::once(&s.origin)
                .chain(s.outline.iter())
                .chain(s.rows.iter().flat_map(|r| r.seats.iter().map(|x| &x.at)))
        })
        .chain(doc.floor.outline.iter().flatten())
}

/// `shiftSection`.
fn shift_section(s: &EdSection, dx: f64, dy: f64) -> EdSection {
    EdSection {
        origin: [s.origin[0] + dx, s.origin[1] + dy],
        outline: move_by(&s.outline, dx, dy),
        rows: s
            .rows
            .iter()
            .map(|r| EdRow {
                seats: r
                    .seats
                    .iter()
                    .map(|x| EdSeat {
                        at: [x.at[0] + dx, x.at[1] + dy],
                        ..x.clone()
                    })
                    .collect(),
                ..r.clone()
            })
            .collect(),
        ..s.clone()
    }
}

/// `turnSection`.
fn turn_section(s: &EdSection, degrees: f64) -> EdSection {
    EdSection {
        angle: normalize_angle(s.angle + degrees),
        outline: turn_about(&s.outline, s.origin, degrees),
        rows: s
            .rows
            .iter()
            .map(|r| EdRow {
                seats: r
                    .seats
                    .iter()
                    .map(|x| EdSeat {
                        at: turn_about(&[x.at], s.origin, degrees)[0],
                        ..x.clone()
                    })
                    .collect(),
                ..r.clone()
            })
            .collect(),
        ..s.clone()
    }
}

/// `keepOnMap` (R5, FR-005, LE19): no place below 0. When something has gone past the top or
/// left edge, everything moves right or down by whole units until it is 1 unit inside; the map
/// grows to fit.
fn keep_on_map(doc: EditorDoc) -> EditorDoc {
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    for [x, y] in places(&doc) {
        if *x < min_x {
            min_x = *x;
        }
        if *y < min_y {
            min_y = *y;
        }
    }
    let dx = if min_x < 0.0 {
        (-min_x).ceil() + 1.0
    } else {
        0.0
    };
    let dy = if min_y < 0.0 {
        (-min_y).ceil() + 1.0
    } else {
        0.0
    };
    if dx == 0.0 && dy == 0.0 {
        return doc;
    }
    EditorDoc {
        floor: EdFloor {
            outline: doc.floor.outline.as_ref().map(|o| move_by(o, dx, dy)),
            kind: doc.floor.kind,
        },
        sections: doc
            .sections
            .iter()
            .map(|s| Arc::new(shift_section(s, dx, dy)))
            .collect(),
        ..doc
    }
}

/// `changeSections`: the sections of `ids` changed by `change`, the others as they were
/// (shared). Always a new document.
fn change_sections(
    doc: &EditorDoc,
    ids: &[String],
    mut change: impl FnMut(&Arc<EdSection>) -> Arc<EdSection>,
) -> EditorDoc {
    let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
    EditorDoc {
        sections: doc
            .sections
            .iter()
            .map(|s| {
                if set.contains(s.id.as_str()) {
                    change(s)
                } else {
                    s.clone()
                }
            })
            .collect(),
        ..doc.clone()
    }
}

/// `sectionsWord`: "Section 101", or "2 sections".
fn sections_word(doc: &EditorDoc, ids: &[String]) -> String {
    if ids.len() == 1 {
        let name = doc
            .sections
            .iter()
            .find(|s| s.id == ids[0])
            .map_or("", |s| s.name.as_str());
        return format!("Section {name}");
    }
    format!("{} sections", ids.len())
}

/// `rect`: a rectangle `w` × `h` about `(cx, cy)`.
fn rect(cx: f64, cy: f64, [w, h]: Place) -> Vec<Place> {
    vec![
        [cx - w / 2.0, cy - h / 2.0],
        [cx + w / 2.0, cy - h / 2.0],
        [cx + w / 2.0, cy + h / 2.0],
        [cx - w / 2.0, cy + h / 2.0],
    ]
}

// ------------------------------------------------------------------------------ levels and painting

fn same_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// `levelNameProblem` (R12, FR-015, LE38): what is wrong with a level's name, or `None`: 1–50
/// characters, unique ignoring case.
pub fn level_name_problem(doc: &EditorDoc, id: &str, name: &str) -> Option<String> {
    let n = js::trim(name);
    if n.is_empty() {
        return Some("Name the level".into());
    }
    if js::len(n) > LAYOUT_LIMITS.name_max_length {
        return Some(format!(
            "At most {} characters",
            LAYOUT_LIMITS.name_max_length
        ));
    }
    if doc
        .levels
        .iter()
        .any(|l| l.id != id && same_name(&l.name, n))
    {
        return Some(format!("Another level is named {n}"));
    }
    None
}

/// `rowsWord`: "Row A", "Rows A–D" (a run in order), or "Rows A, C".
pub fn rows_word(section: &EdSection, ids: &[String]) -> String {
    let idx: Vec<usize> = section
        .rows
        .iter()
        .enumerate()
        .filter(|(_, r)| ids.contains(&r.id))
        .map(|(i, _)| i)
        .collect();
    let labels: Vec<&str> = idx
        .iter()
        .map(|&i| section.rows[i].label.as_str())
        .collect();
    if labels.len() == 1 {
        return format!("Row {}", labels[0]);
    }
    let run = idx.windows(2).all(|w| w[1] == w[0] + 1);
    if run {
        // As JavaScript writes a missing label: "undefined".
        let first = labels.first().copied().unwrap_or("undefined");
        let last = labels.last().copied().unwrap_or("undefined");
        format!("Rows {first}–{last}")
    } else {
        format!("Rows {}", labels.join(", "))
    }
}

/// `seatsWord`: "Row B, seat 3", or "2 seats".
pub fn seats_word(section: &EdSection, ids: &[String]) -> String {
    if ids.len() != 1 {
        return format!("{} seats", ids.len());
    }
    for r in &section.rows {
        if let Some(x) = r.seats.iter().find(|q| q.id == ids[0]) {
            return format!("Row {}, seat {}", r.label, x.label);
        }
    }
    "1 seat".into()
}

/// `changeRows`: the rows of one section changed by `change`; the section made again only when
/// a row changed (but the document always new).
fn change_rows(
    doc: &EditorDoc,
    section_id: &str,
    change: impl Fn(&EdRow) -> Option<EdRow>,
) -> EditorDoc {
    change_sections(doc, &[section_id.to_string()], |s| {
        let mut changed = false;
        let rows: Vec<EdRow> = s
            .rows
            .iter()
            .map(|r| match change(r) {
                Some(n) => {
                    changed = true;
                    n
                }
                None => r.clone(),
            })
            .collect();
        if changed {
            Arc::new(EdSection {
                rows,
                ..(**s).clone()
            })
        } else {
            s.clone()
        }
    })
}

/// `setSeatLevels`: the seats of `ids` in one section with their own level set (or cleared).
fn set_seat_levels(
    doc: &EditorDoc,
    section_id: &str,
    ids: &[String],
    level_id: Option<&str>,
) -> EditorDoc {
    let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
    change_rows(doc, section_id, |r| {
        r.seats
            .iter()
            .any(|x| set.contains(x.id.as_str()))
            .then(|| EdRow {
                seats: r
                    .seats
                    .iter()
                    .map(|x| {
                        if set.contains(x.id.as_str()) {
                            EdSeat {
                                level_id: level_id.map(str::to_string),
                                ..x.clone()
                            }
                        } else {
                            x.clone()
                        }
                    })
                    .collect(),
                ..r.clone()
            })
    })
}

/// `repoint` (R12, LE41): a level deleted, everything naming it repointed at `to`; a row's or
/// seat's own level that then equals its parent's is cleared.
fn repoint(doc: &EditorDoc, from: &str, to: &str) -> EditorDoc {
    EditorDoc {
        levels: doc
            .levels
            .iter()
            .filter(|l| l.id != from)
            .cloned()
            .collect(),
        sections: doc
            .sections
            .iter()
            .map(|s| {
                let sec_changed = s.level_id == from;
                let level_id = if sec_changed { to } else { s.level_id.as_str() };
                let mut touched = sec_changed;
                let rows: Vec<EdRow> = s
                    .rows
                    .iter()
                    .map(|r| {
                        let row_re = r.level_id.as_deref() == Some(from);
                        let mut row_level = if row_re {
                            Some(to)
                        } else {
                            r.level_id.as_deref()
                        };
                        if row_level == Some(level_id) && (row_re || sec_changed) {
                            row_level = None;
                        }
                        let parent = row_level.unwrap_or(level_id);
                        let mut seat_touched = false;
                        let seats: Vec<EdSeat> = r
                            .seats
                            .iter()
                            .map(|x| {
                                let seat_re = x.level_id.as_deref() == Some(from);
                                let mut own = if seat_re {
                                    Some(to)
                                } else {
                                    x.level_id.as_deref()
                                };
                                if own == Some(parent) && (seat_re || row_re || sec_changed) {
                                    own = None;
                                }
                                if own == x.level_id.as_deref() {
                                    return x.clone();
                                }
                                seat_touched = true;
                                EdSeat {
                                    level_id: own.map(str::to_string),
                                    ..x.clone()
                                }
                            })
                            .collect();
                        if row_level == r.level_id.as_deref() && !seat_touched {
                            return r.clone();
                        }
                        touched = true;
                        EdRow {
                            level_id: row_level.map(str::to_string),
                            seats: if seat_touched { seats } else { r.seats.clone() },
                            ..r.clone()
                        }
                    })
                    .collect();
                if touched {
                    Arc::new(EdSection {
                        level_id: level_id.to_string(),
                        rows,
                        ..(**s).clone()
                    })
                } else {
                    s.clone()
                }
            })
            .collect(),
        ..doc.clone()
    }
}

// ------------------------------------------------------------------------------ fine-tuning

/// `sectionNameProblem` (FR-010, LE52): what is wrong with a section's name, or `None`.
pub fn section_name_problem(doc: &EditorDoc, id: &str, name: &str) -> Option<String> {
    let n = js::trim(name);
    if n.is_empty() {
        return Some("Name the section".into());
    }
    if js::len(n) > LAYOUT_LIMITS.name_max_length {
        return Some(format!(
            "At most {} characters",
            LAYOUT_LIMITS.name_max_length
        ));
    }
    if doc
        .sections
        .iter()
        .any(|x| x.id != id && same_name(&x.name, n))
    {
        return Some(format!("Another section is named {n}"));
    }
    None
}

/// `labelShape`.
fn label_shape(label: &str, what: &str) -> Option<String> {
    let l = js::trim(label);
    if l.is_empty() {
        return Some(format!("Give the {what} a label"));
    }
    if js::len(l) > LAYOUT_LIMITS.label_max_length {
        return Some(format!(
            "At most {} characters",
            LAYOUT_LIMITS.label_max_length
        ));
    }
    None
}

/// `rowLabelProblem` (FR-012, LE56): a row's label is 1–5 characters, unique in its section
/// ignoring case (R16).
pub fn row_label_problem(
    doc: &EditorDoc,
    section_id: &str,
    row_id: &str,
    label: &str,
) -> Option<String> {
    if let Some(p) = label_shape(label, "row") {
        return Some(p);
    }
    let section = doc.sections.iter().find(|x| x.id == section_id)?;
    let l = js::trim(label);
    section
        .rows
        .iter()
        .any(|r| r.id != row_id && same_name(&r.label, l))
        .then(|| format!("Row {l} is already in section {}", section.name))
}

/// `seatLabelProblem` (FR-012, LE56): a seat's label is 1–5 characters, unique in its row
/// ignoring case (R16).
pub fn seat_label_problem(
    doc: &EditorDoc,
    section_id: &str,
    seat_id: &str,
    label: &str,
) -> Option<String> {
    if let Some(p) = label_shape(label, "seat") {
        return Some(p);
    }
    let row = doc
        .sections
        .iter()
        .find(|x| x.id == section_id)?
        .rows
        .iter()
        .find(|r| r.seats.iter().any(|q| q.id == seat_id))?;
    let l = js::trim(label);
    row.seats
        .iter()
        .any(|q| q.id != seat_id && same_name(&q.label, l))
        .then(|| format!("Seat {l} is already in row {}", row.label))
}

/// What deleting seats leaves (`planDeleteSeats`'s `'seats' | 'section'`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeletePlan {
    /// Seats are left in the section.
    Seats,
    /// None would be left: the section is deleted instead.
    Section,
}

/// `planDeleteSeats` (FR-012, LE57): deleting these seats leaves seats in the section, or none.
pub fn plan_delete_seats(doc: &EditorDoc, section_id: &str, ids: &[String]) -> DeletePlan {
    let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let left = doc
        .sections
        .iter()
        .find(|x| x.id == section_id)
        .is_some_and(|s| {
            s.rows
                .iter()
                .any(|r| r.seats.iter().any(|q| !set.contains(q.id.as_str())))
        });
    if left {
        DeletePlan::Seats
    } else {
        DeletePlan::Section
    }
}

/// `freeName` (LE53): a section's name with " (n)" for the first n from 2 that no section has,
/// the base cut so the whole is at most 50.
pub fn free_name(doc: &EditorDoc, name: &str) -> String {
    let mut n: u64 = 2;
    loop {
        let suffix = format!(" ({n})");
        let keep = LAYOUT_LIMITS
            .name_max_length
            .saturating_sub(js::len(&suffix));
        let candidate = format!("{}{suffix}", js::slice_to(name, keep));
        if section_name_problem(doc, "", &candidate).is_none() {
            return candidate;
        }
        n += 1;
    }
}

/// `generatedLabels`: the labels a generator makes: rows, and each row's seats.
fn generated_labels(values: Option<&SectionGenerator>) -> Option<HashMap<String, HashSet<String>>> {
    let block = generate_block(values?).ok()?;
    Some(
        block
            .rows
            .into_iter()
            .map(|r| (r.label, r.seats.into_iter().map(|q| q.label).collect()))
            .collect(),
    )
}

/// What Regenerate would do (`regeneratePlan`'s result).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegeneratePlan {
    /// The seats that would go.
    pub removed: usize,
    /// Whether labels changed by hand (not what its generator made) would be replaced.
    pub hand_labels: bool,
}

/// `regeneratePlan` (FR-009, R7, LE58): what Regenerate with `values` would do to a section.
pub fn regenerate_plan(doc: &EditorDoc, id: &str, values: &SectionGenerator) -> RegeneratePlan {
    let none = RegeneratePlan {
        removed: 0,
        hand_labels: false,
    };
    let Some(section) = doc.sections.iter().find(|x| x.id == id) else {
        return none;
    };
    let Some(next) = generated_labels(Some(values)) else {
        return none;
    };
    let mut removed = 0;
    for r in &section.rows {
        let seats = next.get(&r.label);
        removed += r
            .seats
            .iter()
            .filter(|q| !seats.is_some_and(|s| s.contains(&q.label)))
            .count();
    }
    let hand_labels = generated_labels(section.generator.as_ref()).is_some_and(|before| {
        section.rows.iter().any(|r| match before.get(&r.label) {
            None => true,
            Some(seats) => r.seats.iter().any(|q| !seats.contains(&q.label)),
        })
    });
    RegeneratePlan {
        removed,
        hand_labels,
    }
}

// ------------------------------------------------------------------------------ reducer

/// Gives out `new:<n>` ids from `seq`.
struct Ids(u64);

impl Ids {
    fn next(&mut self) -> String {
        self.0 += 1;
        format!("new:{}", self.0)
    }
}

/// Toggles each of `ids` in `before` (`add`), or replaces it.
fn toggled(before: &[String], ids: &[String], add: bool) -> Vec<String> {
    if !add {
        return ids.to_vec();
    }
    ids.iter().fold(before.to_vec(), |mut acc, id| {
        if acc.contains(id) {
            acc.retain(|x| x != id);
        } else {
            acc.push(id.clone());
        }
        acc
    })
}

/// `reduce`: the state after one action.
pub fn reduce(s: &EditorState, a: Action) -> EditorState {
    let doc: &EditorDoc = current_doc(s);
    match a {
        Action::Load { doc } => init_state(doc),
        Action::Saved { sent, doc: back } => {
            // R10 (review B1, S1): `sent` is what was saved. Every `new:` id in it now has the id
            // the Backend gave it (read back, matched by order), and every step of the history
            // takes those ids, so Undo past the save, or a change made while the save was on its
            // way, never sends the saved parts again as new ones.
            let ids = back.map(|b| new_ids(&sent, &b)).unwrap_or_default();
            let mut remap = Remapper {
                ids: &ids,
                docs: HashMap::new(),
                sections: HashMap::new(),
            };
            let history = s.history.iter().map(|d| remap.doc(d)).collect();
            let saved = remap.doc(&sent);
            EditorState {
                history,
                saved,
                selection: remap_selection(&s.selection, &ids),
                zoomed: s
                    .zoomed
                    .as_ref()
                    .map(|z| ids.get(z).cloned().unwrap_or_else(|| z.clone())),
                message: "Layout saved".into(),
                typing: None,
                ..s.clone()
            }
        }
        Action::Undo => travel(s, s.cursor as isize - 1, true),
        Action::Redo => travel(s, s.cursor as isize + 1, false),

        Action::SelectSections { ids } => EditorState {
            selection: if ids.is_empty() {
                Selection::None
            } else {
                Selection::Sections { ids }
            },
            typing: None,
            ..s.clone()
        },
        Action::ToggleSection { id } => {
            let ids = s.selection.section_ids();
            let next = if ids.contains(&id) {
                ids.iter().filter(|i| **i != id).cloned().collect()
            } else {
                let mut v = ids.to_vec();
                v.push(id);
                v
            };
            reduce(s, Action::SelectSections { ids: next })
        }
        Action::SelectFloor => {
            if doc.floor.outline.is_some() {
                EditorState {
                    selection: Selection::Floor,
                    typing: None,
                    ..s.clone()
                }
            } else {
                s.clone()
            }
        }
        Action::ClearSelection => EditorState {
            selection: Selection::None,
            typing: None,
            ..s.clone()
        },
        Action::Zoom { id } => {
            // In, the section is selected; out, rows or seats of it give way to the section.
            let selection = match (&id, &s.selection) {
                (Some(id), _) => Selection::Sections {
                    ids: vec![id.clone()],
                },
                (
                    None,
                    Selection::Rows { section_id, .. } | Selection::Seats { section_id, .. },
                ) => Selection::Sections {
                    ids: vec![section_id.clone()],
                },
                (None, other) => other.clone(),
            };
            EditorState {
                zoomed: id,
                selection,
                typing: None,
                ..s.clone()
            }
        }

        Action::Rename { name } => {
            let message = format!("Layout named {}", js::trim(&name));
            commit(
                s,
                EditorDoc {
                    name,
                    ..doc.clone()
                },
                message,
                Extra {
                    typing: Some("rename".into()),
                    ..Extra::default()
                },
            )
        }

        Action::SetFloor { kind, at } => {
            if kind == FloorKind::None {
                let selection = if s.selection == Selection::Floor {
                    Selection::None
                } else {
                    s.selection.clone()
                };
                return commit(
                    s,
                    EditorDoc {
                        floor: EdFloor {
                            kind: FloorKind::None,
                            outline: None,
                        },
                        ..doc.clone()
                    },
                    "Floor object removed".into(),
                    Extra {
                        selection: Some(selection),
                        ..Extra::default()
                    },
                );
            }
            let outline = doc
                .floor
                .outline
                .clone()
                .unwrap_or_else(|| rect(at[0], at[1], floor_size(kind)));
            commit(
                s,
                keep_on_map(EditorDoc {
                    floor: EdFloor {
                        kind,
                        outline: Some(outline),
                    },
                    ..doc.clone()
                }),
                format!("Floor object set to {}", kind.name()),
                // Review B2: selected, so its corner handles show and it can be resized at once.
                Extra {
                    selection: Some(Selection::Floor),
                    ..Extra::default()
                },
            )
        }
        Action::MoveFloor { dx, dy } => {
            let Some(from) = &doc.floor.outline else {
                return s.clone();
            };
            if dx == 0.0 && dy == 0.0 {
                return s.clone();
            }
            commit(
                s,
                keep_on_map(EditorDoc {
                    floor: EdFloor {
                        outline: Some(move_by(from, dx, dy)),
                        kind: doc.floor.kind,
                    },
                    ..doc.clone()
                }),
                "Floor object moved".into(),
                Extra::default(),
            )
        }
        Action::ResizeFloor { to } => {
            let Some(from) = &doc.floor.outline else {
                return s.clone();
            };
            if to.width < 1.0 || to.height < 1.0 {
                return s.clone();
            }
            let x0 = js_min(from.iter().map(|p| p[0]));
            let y0 = js_min(from.iter().map(|p| p[1]));
            let w = or_one(js_max(from.iter().map(|p| p[0])) - x0);
            let h = or_one(js_max(from.iter().map(|p| p[1])) - y0);
            // A polygon of any shape is stretched to the new bounds (R11).
            let outline = from
                .iter()
                .map(|p| {
                    [
                        to.x + ((p[0] - x0) * to.width) / w,
                        to.y + ((p[1] - y0) * to.height) / h,
                    ]
                })
                .collect();
            commit(
                s,
                keep_on_map(EditorDoc {
                    floor: EdFloor {
                        outline: Some(outline),
                        kind: doc.floor.kind,
                    },
                    ..doc.clone()
                }),
                "Floor object resized".into(),
                Extra::default(),
            )
        }

        Action::AddSection {
            name,
            values,
            level_id,
            at,
        } => {
            let seats = totals(doc).seats;
            let Ok(block) = generate_block(&values).map(|b| place_block(&b, at, 0.0)) else {
                return say(s, "The section could not be generated");
            };
            let adding: usize = block.rows.iter().map(|r| r.seats.len()).sum();
            if seats + adding > LAYOUT_LIMITS.max_seats
                || doc.sections.len() >= LAYOUT_LIMITS.max_sections
            {
                return say(s, "The layout would be over its limits");
            }
            let mut ids = Ids(s.seq);
            let rows: Vec<EdRow> = block
                .rows
                .into_iter()
                .map(|r| EdRow {
                    id: ids.next(),
                    label: r.label,
                    level_id: None,
                    seats: r
                        .seats
                        .into_iter()
                        .map(|x| EdSeat {
                            id: ids.next(),
                            label: x.label,
                            at: x.at,
                            level_id: None,
                            accessible: false,
                        })
                        .collect(),
                })
                .collect();
            let section = EdSection {
                id: ids.next(),
                name: js::trim(&name).to_string(),
                level_id,
                origin: at,
                angle: 0.0,
                generator: Some(values),
                outline: outline_of(&rows),
                rows,
            };
            let message = format!("Section {} added", section.name);
            let selection = Selection::Sections {
                ids: vec![section.id.clone()],
            };
            let mut sections = doc.sections.clone();
            sections.push(Arc::new(section));
            commit(
                s,
                keep_on_map(EditorDoc {
                    sections,
                    ..doc.clone()
                }),
                message,
                Extra {
                    selection: Some(selection),
                    seq: Some(ids.0),
                    ..Extra::default()
                },
            )
        }

        Action::MoveSections { ids, dx, dy } => {
            let moving: Vec<&Arc<EdSection>> = doc
                .sections
                .iter()
                .filter(|x| ids.contains(&x.id))
                .collect();
            if moving.is_empty() {
                return s.clone();
            }
            // Never past the far edges (5,000): the move stops there.
            let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
            for x in &moving {
                for [px, py] in &x.outline {
                    max_x = js_max([max_x, *px]);
                    max_y = js_max([max_y, *py]);
                }
            }
            let max = LAYOUT_LIMITS.max_map_units as f64;
            let dx = js_min([dx, max - max_x]);
            let dy = js_min([dy, max - max_y]);
            if dx == 0.0 && dy == 0.0 {
                return s.clone();
            }
            let message = format!("{} moved", sections_word(doc, &ids));
            commit(
                s,
                keep_on_map(change_sections(doc, &ids, |x| {
                    Arc::new(shift_section(x, dx, dy))
                })),
                message,
                Extra::default(),
            )
        }

        Action::TurnSections { ids, degrees } => {
            if degrees % 360.0 == 0.0 || !doc.sections.iter().any(|x| ids.contains(&x.id)) {
                return s.clone();
            }
            let turned = keep_on_map(change_sections(doc, &ids, |x| {
                Arc::new(turn_section(x, degrees))
            }));
            let one = if ids.len() == 1 {
                turned.sections.iter().find(|x| x.id == ids[0])
            } else {
                None
            };
            let message = match one {
                Some(one) => format!("Section {} turned to {}°", one.name, js_number(one.angle)),
                None => format!(
                    "{} sections turned {}°",
                    ids.len(),
                    js_number(normalize_angle(degrees))
                ),
            };
            commit(s, turned, message, Extra::default())
        }

        Action::PlaceSection { id, origin, angle } => {
            // Typed in the Selection panel (FR-011): a new origin moves it, a new angle turns it
            // by the difference. Typing on is one step.
            let Some(section) = doc.sections.iter().find(|x| x.id == id) else {
                return s.clone();
            };
            let mut changed: Option<EdSection> = None;
            if let Some(a) = angle.filter(|a| a.is_finite()) {
                let base = changed.as_ref().unwrap_or(section);
                changed = Some(turn_section(base, normalize_angle(a) - base.angle));
            }
            if let Some(o) = origin.filter(|o| o.iter().all(|n| n.is_finite())) {
                let base = changed.as_ref().unwrap_or(section);
                changed = Some(shift_section(
                    base,
                    o[0] - base.origin[0],
                    o[1] - base.origin[1],
                ));
            }
            let Some(changed) = changed else {
                return s.clone();
            };
            let what = if angle.is_some() {
                format!("turned to {}°", js_number(changed.angle))
            } else {
                "moved".into()
            };
            let message = format!("Section {} {what}", section.name);
            let typing = format!(
                "place:{id}:{}",
                if angle.is_some() { "angle" } else { "origin" }
            );
            let changed = Arc::new(changed);
            commit(
                s,
                keep_on_map(change_sections(doc, &[id], |_| changed.clone())),
                message,
                Extra {
                    typing: Some(typing),
                    ..Extra::default()
                },
            )
        }

        Action::SelectRows {
            section_id,
            ids,
            add,
        } => {
            let before: &[String] = match &s.selection {
                Selection::Rows {
                    section_id: sid,
                    ids,
                } if *sid == section_id => ids,
                _ => &[],
            };
            let ids = toggled(before, &ids, add);
            EditorState {
                // Nothing left checked: the section stays chosen, its lists open (FR-026).
                selection: if ids.is_empty() {
                    Selection::Sections {
                        ids: vec![section_id],
                    }
                } else {
                    Selection::Rows { section_id, ids }
                },
                typing: None,
                ..s.clone()
            }
        }
        Action::SelectRowRange { section_id, to_id } => {
            let Some(section) = doc.sections.iter().find(|x| x.id == section_id) else {
                return s.clone();
            };
            let anchor = match &s.selection {
                Selection::Rows {
                    section_id: sid,
                    ids,
                } if *sid == section_id => ids.last().cloned(),
                _ => Some(to_id.clone()),
            };
            let i = section
                .rows
                .iter()
                .position(|r| Some(&r.id) == anchor.as_ref());
            let j = section.rows.iter().position(|r| r.id == to_id);
            let (Some(i), Some(j)) = (i, j) else {
                return s.clone();
            };
            let ids = section.rows[i.min(j)..=i.max(j)]
                .iter()
                .map(|r| r.id.clone())
                .collect();
            EditorState {
                selection: Selection::Rows { section_id, ids },
                typing: None,
                ..s.clone()
            }
        }
        Action::SelectSeats {
            section_id,
            ids,
            add,
        } => {
            let before: &[String] = match &s.selection {
                Selection::Seats {
                    section_id: sid,
                    ids,
                } if *sid == section_id => ids,
                _ => &[],
            };
            let ids = toggled(before, &ids, add);
            EditorState {
                selection: if ids.is_empty() {
                    Selection::Sections {
                        ids: vec![section_id],
                    }
                } else {
                    Selection::Seats { section_id, ids }
                },
                typing: None,
                ..s.clone()
            }
        }

        Action::AddLevel => {
            if doc.levels.len() >= LAYOUT_LIMITS.max_levels {
                return say(
                    s,
                    format!("A layout has at most {} levels", LAYOUT_LIMITS.max_levels),
                );
            }
            let used: HashSet<&str> = doc.levels.iter().map(|l| l.color.as_str()).collect();
            let color = LEVEL_COLORS
                .iter()
                .find(|c| !used.contains(**c))
                .unwrap_or(&LEVEL_COLORS[0]);
            let mut k = doc.levels.len() + 1;
            while level_name_problem(doc, "", &format!("Level {k}")).is_some() {
                k += 1;
            }
            let seq = s.seq + 1;
            let level = EdLevel {
                id: format!("new:{seq}"),
                name: format!("Level {k}"),
                color: (*color).to_string(),
            };
            let message = format!("{} added", level.name);
            let mut levels = doc.levels.clone();
            levels.push(level);
            commit(
                s,
                EditorDoc {
                    levels,
                    ..doc.clone()
                },
                message,
                Extra {
                    seq: Some(seq),
                    ..Extra::default()
                },
            )
        }
        Action::RenameLevel { id, name } => {
            let Some(level) = doc.levels.iter().find(|l| l.id == id) else {
                return s.clone();
            };
            if let Some(problem) = level_name_problem(doc, &id, &name) {
                return say(s, problem);
            }
            let name = js::trim(&name).to_string();
            if name == level.name {
                return s.clone();
            }
            let message = format!("{} renamed {name}", level.name);
            commit(
                s,
                EditorDoc {
                    levels: doc
                        .levels
                        .iter()
                        .map(|l| {
                            if l.id == id {
                                EdLevel {
                                    name: name.clone(),
                                    ..l.clone()
                                }
                            } else {
                                l.clone()
                            }
                        })
                        .collect(),
                    ..doc.clone()
                },
                message,
                Extra::default(),
            )
        }
        Action::RecolorLevel { id, color } => {
            let Some(level) = doc.levels.iter().find(|l| l.id == id) else {
                return s.clone();
            };
            if level.color == color {
                return s.clone();
            }
            let message = format!("{} is now {color}", level.name);
            commit(
                s,
                EditorDoc {
                    levels: doc
                        .levels
                        .iter()
                        .map(|l| {
                            if l.id == id {
                                EdLevel {
                                    color: color.clone(),
                                    ..l.clone()
                                }
                            } else {
                                l.clone()
                            }
                        })
                        .collect(),
                    ..doc.clone()
                },
                message,
                Extra::default(),
            )
        }
        Action::MoveLevel { id, by } => {
            let Some(i) = doc.levels.iter().position(|l| l.id == id) else {
                return s.clone();
            };
            let j = i as i64 + i64::from(by);
            if j < 0 || j >= doc.levels.len() as i64 {
                return s.clone();
            }
            let j = j as usize;
            let mut levels = doc.levels.clone();
            levels.swap(i, j);
            let message = format!("{} moved to rank {}", levels[j].name, j + 1);
            commit(
                s,
                EditorDoc {
                    levels,
                    ..doc.clone()
                },
                message,
                Extra::default(),
            )
        }
        Action::DeleteLevel { id, replacement } => {
            if doc.levels.len() <= 1 {
                return say(s, "The last level can't be deleted");
            }
            let Some(level) = doc.levels.iter().find(|l| l.id == id) else {
                return s.clone();
            };
            if replacement == id || !doc.levels.iter().any(|l| l.id == replacement) {
                return s.clone();
            }
            let message = format!(
                "{} deleted; its seats are now {}",
                level.name,
                level_name(doc, Some(&replacement))
            );
            commit(
                s,
                repoint(doc, &id, &replacement),
                message,
                Extra::default(),
            )
        }
        Action::Paint { .. } | Action::ClearLevel => {
            let level_id = match &a {
                Action::Paint { level_id } => Some(level_id.as_str()),
                _ => None,
            };
            let word = level_id
                .map(|l| format!("painted {}", level_name(doc, Some(l))))
                .unwrap_or_default();
            match (&s.selection, level_id) {
                (Selection::Sections { ids }, Some(level)) => {
                    let next = change_sections(doc, ids, |x| {
                        if x.level_id == level {
                            x.clone()
                        } else {
                            Arc::new(EdSection {
                                level_id: level.to_string(),
                                ..(**x).clone()
                            })
                        }
                    });
                    let message = format!("{} {word}", sections_word(doc, ids));
                    commit(s, next, message, Extra::default())
                }
                (Selection::Rows { section_id, ids }, _) => {
                    let Some(section) = doc.sections.iter().find(|x| x.id == *section_id) else {
                        return s.clone();
                    };
                    let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
                    let next = change_rows(doc, section_id, |r| {
                        (set.contains(r.id.as_str()) && r.level_id.as_deref() != level_id).then(
                            || EdRow {
                                level_id: level_id.map(str::to_string),
                                ..r.clone()
                            },
                        )
                    });
                    let who = rows_word(section, ids);
                    let message = match level_id {
                        Some(_) => format!("{who} {word}"),
                        None => format!(
                            "{who} {} the section's level",
                            if ids.len() == 1 { "takes" } else { "take" }
                        ),
                    };
                    commit(s, next, message, Extra::default())
                }
                (Selection::Seats { section_id, ids }, _) => {
                    let Some(section) = doc.sections.iter().find(|x| x.id == *section_id) else {
                        return s.clone();
                    };
                    let who = seats_word(section, ids);
                    let message = match level_id {
                        Some(_) => format!("{who} {word}"),
                        None => format!(
                            "{who} {} the row's level",
                            if ids.len() == 1 { "takes" } else { "take" }
                        ),
                    };
                    commit(
                        s,
                        set_seat_levels(doc, section_id, ids, level_id),
                        message,
                        Extra::default(),
                    )
                }
                _ => s.clone(),
            }
        }

        Action::DuplicateSection { id } => {
            let Some(from) = doc.sections.iter().find(|x| x.id == id) else {
                return s.clone();
            };
            if doc.sections.len() >= LAYOUT_LIMITS.max_sections {
                return say(
                    s,
                    format!(
                        "A layout has at most {} sections",
                        LAYOUT_LIMITS.max_sections
                    ),
                );
            }
            if totals(doc).seats + seat_count(from) > LAYOUT_LIMITS.max_seats {
                return say(s, "The layout would be over its limits");
            }
            let mut ids = Ids(s.seq);
            let shifted = shift_section(from, 10.0, 0.0);
            let copy_id = ids.next();
            let name = free_name(doc, &from.name);
            let rows = shifted
                .rows
                .iter()
                .map(|r| EdRow {
                    id: ids.next(),
                    seats: r
                        .seats
                        .iter()
                        .map(|q| EdSeat {
                            id: ids.next(),
                            ..q.clone()
                        })
                        .collect(),
                    ..r.clone()
                })
                .collect();
            let copy = EdSection {
                id: copy_id,
                name,
                rows,
                ..shifted
            };
            let message = format!("Section {} duplicated as {}", from.name, copy.name);
            let selection = Selection::Sections {
                ids: vec![copy.id.clone()],
            };
            let mut sections = doc.sections.clone();
            sections.push(Arc::new(copy));
            commit(
                s,
                keep_on_map(EditorDoc {
                    sections,
                    ..doc.clone()
                }),
                message,
                Extra {
                    selection: Some(selection),
                    seq: Some(ids.0),
                    ..Extra::default()
                },
            )
        }
        Action::RenameSection { id, name } => {
            let Some(section) = doc.sections.iter().find(|x| x.id == id) else {
                return s.clone();
            };
            if let Some(problem) = section_name_problem(doc, &id, &name) {
                return say(s, problem);
            }
            let name = js::trim(&name).to_string();
            if name == section.name {
                return s.clone();
            }
            let message = format!("Section {} renamed {name}", section.name);
            commit(
                s,
                change_sections(doc, &[id], |x| {
                    Arc::new(EdSection {
                        name: name.clone(),
                        ..(**x).clone()
                    })
                }),
                message,
                Extra::default(),
            )
        }
        Action::DeleteSeats { section_id, ids } => {
            let Some(section) = doc.sections.iter().find(|x| x.id == section_id) else {
                return s.clone();
            };
            if ids.is_empty() {
                return s.clone();
            }
            if plan_delete_seats(doc, &section_id, &ids) == DeletePlan::Section {
                return say(
                    s,
                    format!(
                        "Deleting every seat deletes the section: delete section {} instead",
                        section.name
                    ),
                );
            }
            let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
            let rows: Vec<EdRow> = section
                .rows
                .iter()
                .map(|r| EdRow {
                    seats: r
                        .seats
                        .iter()
                        .filter(|q| !set.contains(q.id.as_str()))
                        .cloned()
                        .collect(),
                    ..r.clone()
                })
                .filter(|r| !r.seats.is_empty())
                .collect();
            let gone = seat_count(section) - rows.iter().map(|r| r.seats.len()).sum::<usize>();
            let message = format!(
                "{gone} {} deleted from section {}",
                if gone == 1 { "seat" } else { "seats" },
                section.name
            );
            let outline = outline_of(&rows);
            commit(
                s,
                change_sections(doc, std::slice::from_ref(&section_id), |x| {
                    Arc::new(EdSection {
                        rows: rows.clone(),
                        outline: outline.clone(),
                        ..(**x).clone()
                    })
                }),
                message,
                Extra {
                    selection: Some(Selection::None),
                    ..Extra::default()
                },
            )
        }
        Action::DeleteSections { ids } => {
            let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
            if !doc.sections.iter().any(|x| set.contains(x.id.as_str())) {
                return s.clone();
            }
            let word = sections_word(doc, &ids);
            let zoomed = s
                .zoomed
                .as_ref()
                .filter(|z| !set.contains(z.as_str()))
                .cloned();
            commit(
                s,
                EditorDoc {
                    sections: doc
                        .sections
                        .iter()
                        .filter(|x| !set.contains(x.id.as_str()))
                        .cloned()
                        .collect(),
                    ..doc.clone()
                },
                format!("{word} deleted"),
                Extra {
                    selection: Some(Selection::None),
                    zoomed: Some(zoomed),
                    ..Extra::default()
                },
            )
        }
        Action::RelabelRow {
            section_id,
            row_id,
            label,
        } => {
            let Some(row) = doc
                .sections
                .iter()
                .find(|x| x.id == section_id)
                .and_then(|x| x.rows.iter().find(|r| r.id == row_id))
            else {
                return s.clone();
            };
            if let Some(problem) = row_label_problem(doc, &section_id, &row_id, &label) {
                return say(s, problem);
            }
            let label = js::trim(&label).to_string();
            if label == row.label {
                return s.clone();
            }
            let message = format!("Row {} relabelled {label}", row.label);
            commit(
                s,
                change_rows(doc, &section_id, |r| {
                    (r.id == row_id).then(|| EdRow {
                        label: label.clone(),
                        ..r.clone()
                    })
                }),
                message,
                Extra::default(),
            )
        }
        Action::RelabelSeat {
            section_id,
            seat_id,
            label,
        } => {
            let Some(section) = doc.sections.iter().find(|x| x.id == section_id) else {
                return s.clone();
            };
            if let Some(problem) = seat_label_problem(doc, &section_id, &seat_id, &label) {
                return say(s, problem);
            }
            let label = js::trim(&label).to_string();
            let who = seats_word(section, std::slice::from_ref(&seat_id));
            commit(
                s,
                change_rows(doc, &section_id, |r| {
                    r.seats
                        .iter()
                        .any(|q| q.id == seat_id && q.label != label)
                        .then(|| EdRow {
                            seats: r
                                .seats
                                .iter()
                                .map(|q| {
                                    if q.id == seat_id {
                                        EdSeat {
                                            label: label.clone(),
                                            ..q.clone()
                                        }
                                    } else {
                                        q.clone()
                                    }
                                })
                                .collect(),
                            ..r.clone()
                        })
                }),
                format!("{who} relabelled {label}"),
                Extra::default(),
            )
        }
        Action::MarkAccessible {
            section_id,
            ids,
            accessible,
        } => {
            let Some(section) = doc.sections.iter().find(|x| x.id == section_id) else {
                return s.clone();
            };
            let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
            let message = format!(
                "{} marked {}",
                seats_word(section, &ids),
                if accessible {
                    "accessible"
                } else {
                    "not accessible"
                }
            );
            commit(
                s,
                change_rows(doc, &section_id, |r| {
                    r.seats
                        .iter()
                        .any(|q| set.contains(q.id.as_str()) && q.accessible != accessible)
                        .then(|| EdRow {
                            seats: r
                                .seats
                                .iter()
                                .map(|q| {
                                    if set.contains(q.id.as_str()) {
                                        EdSeat {
                                            accessible,
                                            ..q.clone()
                                        }
                                    } else {
                                        q.clone()
                                    }
                                })
                                .collect(),
                            ..r.clone()
                        })
                }),
                message,
                Extra::default(),
            )
        }
        Action::Regenerate { id, values } => {
            let Some(section) = doc.sections.iter().find(|x| x.id == id) else {
                return s.clone();
            };
            let Ok(block) =
                generate_block(&values).map(|b| place_block(&b, section.origin, section.angle))
            else {
                return say(s, "The section could not be generated");
            };
            let others = totals(doc).seats - seat_count(section);
            let adding: usize = block.rows.iter().map(|r| r.seats.len()).sum();
            if others + adding > LAYOUT_LIMITS.max_seats {
                return say(s, "The layout would be over its limits");
            }
            // R7: a row is kept when its label is still generated, a seat when its row is kept
            // and its label is still in it: their ids, own levels and accessible marks stay.
            let mut ids = Ids(s.seq);
            let old_rows: HashMap<&str, &EdRow> =
                section.rows.iter().map(|r| (r.label.as_str(), r)).collect();
            let rows: Vec<EdRow> = block
                .rows
                .into_iter()
                .map(|r| {
                    let old = old_rows.get(r.label.as_str()).copied();
                    let old_seats: HashMap<&str, &EdSeat> = old
                        .map(|o| o.seats.iter().map(|q| (q.label.as_str(), q)).collect())
                        .unwrap_or_default();
                    let row_id = old.map_or_else(|| ids.next(), |o| o.id.clone());
                    EdRow {
                        id: row_id,
                        level_id: old.and_then(|o| o.level_id.clone()),
                        seats: r
                            .seats
                            .into_iter()
                            .map(|q| {
                                let was = old_seats.get(q.label.as_str()).copied();
                                EdSeat {
                                    id: was.map_or_else(|| ids.next(), |w| w.id.clone()),
                                    at: q.at,
                                    level_id: was.and_then(|w| w.level_id.clone()),
                                    accessible: was.is_some_and(|w| w.accessible),
                                    label: q.label,
                                }
                            })
                            .collect(),
                        label: r.label,
                    }
                })
                .collect();
            let message = format!("Section {} regenerated", section.name);
            let outline = outline_of(&rows);
            commit(
                s,
                keep_on_map(change_sections(doc, std::slice::from_ref(&id), |x| {
                    Arc::new(EdSection {
                        generator: Some(values.clone()),
                        rows: rows.clone(),
                        outline: outline.clone(),
                        ..(**x).clone()
                    })
                })),
                message,
                Extra {
                    selection: Some(Selection::Sections { ids: vec![id] }),
                    seq: Some(ids.0),
                    ..Extra::default()
                },
            )
        }
    }
}

/// `x || 1`: a zero (or `NaN`) width is 1.
fn or_one(n: f64) -> f64 {
    if n == 0.0 || n.is_nan() { 1.0 } else { n }
}
