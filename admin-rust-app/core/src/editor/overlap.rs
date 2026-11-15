//! Spec 037 research R14 (T074): overlapping sections and levels with no seats, the warnings
//! before a save, ported from `admin-app/src/layout-editor/overlap.ts` (039 FR-020, research
//! R15; parity LE34, LE35, LE69). Neither blocks a save.

use std::collections::{BTreeSet, HashMap};

use super::doc::{EdLevel, EdSection, EditorDoc};
use super::state::totals;
use crate::seating::map_geometry::{Bounds, bounds, js_hypot};

/// `OVERLAP_DISTANCE` (R15): seats of two sections closer than this overlap.
pub const OVERLAP_DISTANCE: f64 = 1.5;
/// `CELL`: the grid the seats of one section are put in, so each seat is checked only near
/// itself.
const CELL: f64 = 2.0;

fn meet(a: &Bounds, b: &Bounds) -> bool {
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

fn cell(n: f64) -> i64 {
    // Places are 0 to 5,000: the cell always fits.
    #[allow(clippy::cast_possible_truncation, reason = "a map place over 2")]
    let c = (n / CELL).floor() as i64;
    c
}

/// `seatsOverlap`: whether a seat of `b` is closer than 1.5 units to a seat of `a`.
fn seats_overlap(a: &EdSection, b: &EdSection) -> bool {
    let mut grid: HashMap<(i64, i64), Vec<[f64; 2]>> = HashMap::new();
    for r in &a.rows {
        for s in &r.seats {
            grid.entry((cell(s.at[0]), cell(s.at[1])))
                .or_default()
                .push(s.at);
        }
    }
    for r in &b.rows {
        for s in &r.seats {
            let (ci, cj) = (cell(s.at[0]), cell(s.at[1]));
            for di in -1..=1 {
                for dj in -1..=1 {
                    if let Some(list) = grid.get(&(ci + di, cj + dj))
                        && list
                            .iter()
                            .any(|p| js_hypot(p[0] - s.at[0], p[1] - s.at[1]) < OVERLAP_DISTANCE)
                    {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// What `findOverlaps` gives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Overlaps {
    /// The overlapping pairs of section ids, earlier section first.
    pub pairs: Vec<(String, String)>,
    /// How many pairs were compared (their outlines' bounds meet).
    pub compared: usize,
}

/// `findOverlaps` (FR-020, R15, LE35): the pairs of sections whose seats overlap, earlier
/// section first. Only sections whose outlines' bounds meet are compared, each through a 2-unit
/// grid of seats.
pub fn find_overlaps(doc: &EditorDoc) -> Overlaps {
    let boxes: Vec<Bounds> = doc.sections.iter().map(|s| bounds(&s.outline)).collect();
    let mut pairs = Vec::new();
    let mut compared = 0;
    for i in 0..doc.sections.len() {
        for j in i + 1..doc.sections.len() {
            if !meet(&boxes[i], &boxes[j]) {
                continue;
            }
            compared += 1;
            if seats_overlap(&doc.sections[i], &doc.sections[j]) {
                pairs.push((doc.sections[i].id.clone(), doc.sections[j].id.clone()));
            }
        }
    }
    Overlaps { pairs, compared }
}

/// `emptyLevels` (FR-020): the levels no seat is in (allowed; events never ask a price for
/// them).
pub fn empty_levels(doc: &EditorDoc) -> Vec<EdLevel> {
    let t = totals(doc);
    doc.levels
        .iter()
        .filter(|l| t.level(&l.id) == 0)
        .cloned()
        .collect()
}

/// What `warningsOf` gives.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Warnings {
    /// "Section 102 overlaps 101" per pair, then "Upper has no seats" per empty level.
    pub messages: Vec<String>,
    /// The sections to outline on the map (LE34).
    pub sections: BTreeSet<String>,
}

/// `warningsOf` (LE69): the warnings before a save, in words, and the sections to outline on
/// the map.
pub fn warnings_of(doc: &EditorDoc) -> Warnings {
    let name: HashMap<&str, &str> = doc
        .sections
        .iter()
        .map(|s| (s.id.as_str(), s.name.as_str()))
        .collect();
    let pairs = find_overlaps(doc).pairs;
    let named = |id: &str| name.get(id).copied().unwrap_or("undefined");
    let mut messages: Vec<String> = pairs
        .iter()
        .map(|(a, b)| format!("Section {} overlaps {}", named(b), named(a)))
        .collect();
    messages.extend(
        empty_levels(doc)
            .into_iter()
            .map(|l| format!("{} has no seats", l.name)),
    );
    Warnings {
        messages,
        sections: pairs.into_iter().flat_map(|(a, b)| [a, b]).collect(),
    }
}
