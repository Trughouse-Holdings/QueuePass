//! Spec 037 research R13 (T032): the layout editor's geometry, ported from
//! `packages/shared/src/layout-geometry.ts` (039 research R5, R6, R7), with `LAYOUT_LIMITS` and
//! `LEVEL_COLORS` from `packages/shared/src/seating.ts`. Pure, in map units with `y` growing
//! downward (as the venue map draws). The Backend draws every saved outline with `outlineAround`
//! and the editor draws the same one live; the block generator makes a section's rows and seats.
//! Every number comes out as the TypeScript's, to the same float (`tests/seating_geometry.rs`).

use std::{collections::HashSet, fmt};

use serde::{Deserialize, Serialize};

use super::map_geometry::{Point, js_cos, js_hypot, js_max, js_min, js_number, js_round, js_sin};

/// `Pt` of `layout-geometry.ts`: a place `[x, y]`.
pub type Pt = Point;

/// `SEAT_GAP`: seats are this far apart along a row (038's standard spacing).
pub const SEAT_GAP: f64 = 2.0;
/// `ROW_GAP`: rows are this far apart.
pub const ROW_GAP: f64 = 2.0;
/// `OUTLINE_MARGIN`: how far an outline stands out from its seats: half a gap plus a seat.
pub const OUTLINE_MARGIN: f64 = 1.5;
/// `SIZE_MARGIN`: how much room the map leaves past the furthest thing drawn on it.
pub const SIZE_MARGIN: f64 = 10.0;

/// How far a point on the front or back edge may be left out of the outline: the edge then passes
/// at most this much nearer the seats, which stay at least 1 unit inside it.
const EDGE_TOLERANCE: f64 = 0.5;

/// The type of `LAYOUT_LIMITS` (`seating.ts`): the limits of a layout and of an event's seating
/// save (038 FR-001 to FR-003, FR-013, research R5, R8, R16).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutLimits {
    pub max_sections: usize,
    pub max_rows: usize,
    pub max_seats_per_row: usize,
    pub max_seats: usize,
    pub max_levels: usize,
    pub max_carried_levels: usize,
    pub name_max_length: usize,
    pub label_max_length: usize,
    pub max_outline_points: usize,
    pub max_map_units: usize,
    pub max_off_sale_selectors: usize,
    pub max_import_bytes: usize,
}

/// `LAYOUT_LIMITS` (`seating.ts`). A layout carried over from `007` may have up to
/// `max_carried_levels` levels and more than `max_seats` seats; imports and section lines keep 12
/// and 30,000.
pub const LAYOUT_LIMITS: LayoutLimits = LayoutLimits {
    max_sections: 100,
    max_rows: 100,
    max_seats_per_row: 200,
    max_seats: 30_000,
    max_levels: 12,
    max_carried_levels: 50,
    name_max_length: 50,
    label_max_length: 5,
    max_outline_points: 64,
    max_map_units: 5_000,
    max_off_sale_selectors: 5_000,
    max_import_bytes: 4 * 1024 * 1024,
};

/// `LEVEL_COLORS` (`seating.ts`, 038 research R13, R16): the 12 level colors in the contract's
/// `LevelColor` order, the order the carry-over gives them out in (repeating after 12).
pub const LEVEL_COLORS: [&str; 12] = [
    "violet", "blue", "cyan", "teal", "green", "lime", "yellow", "orange", "red", "pink", "purple",
    "brown",
];

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
fn add(a: Pt, b: Pt) -> Pt {
    [a[0] + b[0], a[1] + b[1]]
}
fn scale(a: Pt, k: f64) -> Pt {
    [a[0] * k, a[1] * k]
}
fn dot(a: Pt, b: Pt) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn length(a: Pt) -> f64 {
    js_hypot(a[0], a[1])
}
fn unit(a: Pt) -> Pt {
    let l = length(a);
    if l < 1e-12 {
        [0.0, 0.0]
    } else {
        [a[0] / l, a[1] / l]
    }
}
/// `a` turned a quarter, so it is at right angles to it.
fn perp(a: Pt) -> Pt {
    [-a[1], a[0]]
}
fn mean(points: &[Pt]) -> Pt {
    let n = points.len() as f64;
    [
        points.iter().fold(0.0, |s, p| s + p[0]) / n,
        points.iter().fold(0.0, |s, p| s + p[1]) / n,
    ]
}

/// `moveBy`: every point moved by `(dx, dy)`.
pub fn move_by(points: &[Pt], dx: f64, dy: f64) -> Vec<Pt> {
    points.iter().map(|p| [p[0] + dx, p[1] + dy]).collect()
}

/// `turnAbout`: every point turned `degrees` clockwise (with `y` down) about `origin`.
pub fn turn_about(points: &[Pt], origin: Pt, degrees: f64) -> Vec<Pt> {
    let a = (degrees * std::f64::consts::PI) / 180.0;
    let cos = js_cos(a);
    let sin = js_sin(a);
    points
        .iter()
        .map(|p| {
            let x = p[0] - origin[0];
            let y = p[1] - origin[1];
            [origin[0] + x * cos - y * sin, origin[1] + x * sin + y * cos]
        })
        .collect()
}

/// `normalizeAngle`: an angle in degrees as one in `(-180, 180]`, never `-0`.
pub fn normalize_angle(degrees: f64) -> f64 {
    let a = ((degrees % 360.0) + 360.0) % 360.0;
    let b = if a > 180.0 { a - 360.0 } else { a };
    if b == 0.0 { 0.0 } else { b }
}

/// The error `outlineAround` throws when it is given no seat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoSeats;

impl fmt::Display for NoSeats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("outlineAround needs at least one seat")
    }
}

impl std::error::Error for NoSeats {}

/// `outlineAround` (039 R5): the outline of a section around its seats, given its rows front
/// first, each row's seats in order (left to right as seen from the floor). The first seat of
/// each row front to back, then the last seat of each row back to front, each pushed out 1.5
/// units: along its row at the sides, and at the front and back rows' corners also forward or
/// back; along a curved front or back row, the seats between its ends too, where the edge would
/// otherwise come nearer them. At most 64 points: with many rows, the front, the back and evenly
/// spaced rows between. One row: a rectangle 1.5 units around it, along it. One seat: a square.
/// Empty rows are skipped; no seat at all is [`NoSeats`].
pub fn outline_around<R: AsRef<[Pt]>>(rows_in: &[R]) -> Result<Vec<Pt>, NoSeats> {
    let rows: Vec<&[Pt]> = rows_in
        .iter()
        .map(AsRef::as_ref)
        .filter(|r| !r.is_empty())
        .collect();
    if rows.is_empty() {
        return Err(NoSeats);
    }
    let m = OUTLINE_MARGIN;
    // A box 1.5 units around every seat: one seat's square, or seats with no direction to follow.
    let boxed = || -> Vec<Pt> {
        let all = rows.iter().flat_map(|r| r.iter());
        let x0 = js_min(all.clone().map(|p| p[0])) - m;
        let x1 = js_max(all.clone().map(|p| p[0])) + m;
        let y0 = js_min(all.clone().map(|p| p[1])) - m;
        let y1 = js_max(all.map(|p| p[1])) + m;
        [[x0, y1], [x0, y0], [x1, y0], [x1, y1]]
            .into_iter()
            .map(clean)
            .collect()
    };

    if rows.len() == 1 {
        let row = rows[0];
        // One seat, or a row whose ends are on top of each other (review M1).
        if row.len() == 1 || length(sub(row[row.len() - 1], row[0])) < 1e-9 {
            return Ok(boxed());
        }
        // Along the row: from its first seat to its last, and across it.
        let t = unit(sub(row[row.len() - 1], row[0]));
        let n = perp(t);
        let t0 = js_min(row.iter().map(|p| dot(*p, t))) - m;
        let t1 = js_max(row.iter().map(|p| dot(*p, t))) + m;
        let n0 = js_min(row.iter().map(|p| dot(*p, n))) - m;
        let n1 = js_max(row.iter().map(|p| dot(*p, n))) + m;
        let at = |a: f64, b: f64| add(scale(t, a), scale(n, b));
        // The side toward +n first, so a row along +x reads front-left, back-left, back-right, ….
        return Ok([at(t0, n1), at(t0, n0), at(t1, n0), at(t1, n1)]
            .into_iter()
            .map(clean)
            .collect());
    }

    // Each row's direction where it has two seats or more, else its nearest such row's; a section
    // of one-seat rows only runs across, at right angles to the line from its back to its front.
    let own: Vec<Option<Pt>> = rows
        .iter()
        .map(|r| (r.len() > 1).then(|| unit(sub(r[r.len() - 1], r[0]))))
        .collect();
    let front = mean(rows[0]);
    let back = mean(rows[rows.len() - 1]);
    let fallback = perp(unit(sub(front, back)));
    let own_at = |k: isize| -> Option<Pt> {
        usize::try_from(k)
            .ok()
            .and_then(|k| own.get(k).copied().flatten())
    };
    let dir_of = |k: usize| -> Pt {
        for d in 0..rows.len() as isize {
            if let Some(a) = own_at(k as isize - d) {
                return a;
            }
            if let Some(b) = own_at(k as isize + d) {
                return b;
            }
        }
        fallback
    };
    // The direction along row `k` at seat `i`, from its neighbours.
    let tangent = |k: usize, i: usize| -> Pt {
        let r = rows[k];
        if r.len() == 1 {
            return dir_of(k);
        }
        let a = r[i.saturating_sub(1)];
        let b = r[(i + 1).min(r.len() - 1)];
        unit(sub(b, a))
    };
    // At right angles to the row at seat `i`, on the side of `away`.
    let normal = |k: usize, i: usize, away: Pt| -> Pt {
        let n = perp(tangent(k, i));
        if dot(n, away) >= 0.0 {
            n
        } else {
            scale(n, -1.0)
        }
    };

    let last = rows.len() - 1;
    let forward = unit(sub(front, mean(rows[1])));
    let backward = unit(sub(back, mean(rows[last - 1])));

    let corner = |k: usize, first: bool, away: Pt| -> Pt {
        let r = rows[k];
        let i = if first { 0 } else { r.len() - 1 };
        let along = scale(tangent(k, i), if first { -1.0 } else { 1.0 });
        add(r[i], scale(unit(add(along, normal(k, i, away))), m))
    };
    let side = |k: usize, first: bool| -> Pt {
        let r = rows[k];
        let i = if first { 0 } else { r.len() - 1 };
        add(r[i], scale(tangent(k, i), if first { -m } else { m }))
    };
    let edge = |k: usize, away: Pt| -> Vec<Pt> {
        let r = rows[k];
        if r.len() < 2 {
            return Vec::new();
        }
        r[1..r.len() - 1]
            .iter()
            .enumerate()
            .map(|(j, p)| add(*p, scale(normal(k, j + 1, away), m)))
            .collect()
    };

    // The front and back edges, left to right, each with as few points as keep it near its seats.
    let max_points = LAYOUT_LIMITS.max_outline_points;
    let mut tolerance = EDGE_TOLERANCE;
    let fl = corner(0, true, forward);
    let fr = corner(0, false, forward);
    let bl = corner(last, true, backward);
    let br = corner(last, false, backward);
    let front_all = edge(0, forward);
    let back_all = edge(last, backward);
    let chain = |a: Pt, mid: &[Pt], b: Pt| -> Vec<Pt> {
        let mut c = Vec::with_capacity(mid.len() + 2);
        c.push(a);
        c.extend_from_slice(mid);
        c.push(b);
        c
    };
    let inner = |c: Vec<Pt>| -> Vec<Pt> { c[1..c.len() - 1].to_vec() };
    let (front_edge, back_edge) = loop {
        let f = inner(simplify(chain(fl, &front_all, fr), tolerance));
        let b = inner(simplify(chain(bl, &back_all, br), tolerance));
        if 4 + f.len() + b.len() <= max_points - 2 {
            break (f, b);
        }
        tolerance *= 2.0;
    };

    // The rows between the front and the back whose ends are kept: all of them when they fit.
    let room =
        ((max_points - 4 - front_edge.len() - back_edge.len()) as f64 / 2.0).floor() as usize;
    let between = last - 1;
    let middle: Vec<usize> = if between <= room {
        (0..between).map(|i| i + 1).collect()
    } else {
        (0..room)
            .map(|i| 1 + js_round(((i + 1) as f64 * between as f64) / (room as f64 + 1.0)) as usize)
            .collect()
    };
    let mut once = HashSet::new();
    let kept: Vec<usize> = middle
        .into_iter()
        .filter(|k| once.insert(*k))
        .filter(|k| *k > 0 && *k < last)
        .collect();

    let mut ring: Vec<Pt> = vec![fl];
    ring.extend(kept.iter().map(|k| side(*k, true)));
    ring.push(bl);
    ring.extend_from_slice(&back_edge);
    ring.push(br);
    ring.extend(kept.iter().rev().map(|k| side(*k, false)));
    ring.push(fr);
    ring.extend(front_edge.iter().rev());
    let out: Vec<Pt> = drop_repeats(ring).into_iter().map(clean).collect();
    // Seats on top of each other leave too few points for an outline (review M1).
    let distinct: HashSet<String> = out
        .iter()
        .map(|p| format!("{},{}", js_number(p[0]), js_number(p[1])))
        .collect();
    Ok(if distinct.len() >= 3 { out } else { boxed() })
}

/// Douglas–Peucker: the points of a chain that keep it within `tolerance` of every point left out.
fn simplify(chain: Vec<Pt>, tolerance: f64) -> Vec<Pt> {
    if chain.len() <= 2 {
        return chain;
    }
    let mut keep = vec![false; chain.len()];
    keep[0] = true;
    keep[chain.len() - 1] = true;
    let mut stack = vec![(0, chain.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        let mut worst = -1.0;
        let mut at = None;
        for i in a + 1..b {
            let d = distance_to_segment(chain[i], chain[a], chain[b]);
            if d > worst {
                worst = d;
                at = Some(i);
            }
        }
        if let Some(at) = at
            && worst > tolerance
        {
            keep[at] = true;
            stack.push((a, at));
            stack.push((at, b));
        }
    }
    chain
        .into_iter()
        .zip(keep)
        .filter_map(|(p, k)| k.then_some(p))
        .collect()
}

fn distance_to_segment(p: Pt, a: Pt, b: Pt) -> f64 {
    let ab = sub(b, a);
    let l2 = dot(ab, ab);
    let t = if l2 < 1e-12 {
        0.0
    } else {
        js_max([0.0, js_min([1.0, dot(sub(p, a), ab) / l2])])
    };
    length(sub(p, add(a, scale(ab, t))))
}

/// Without a point that repeats the one before it (a one-seat row's two ends).
fn drop_repeats(points: Vec<Pt>) -> Vec<Pt> {
    let mut out: Vec<Pt> = Vec::with_capacity(points.len());
    for p in points {
        if out.last().is_none_or(|prev| length(sub(p, *prev)) > 1e-9) {
            out.push(p);
        }
    }
    while out.len() > 1 && length(sub(out[0], out[out.len() - 1])) <= 1e-9 {
        out.pop();
    }
    out
}

/// No `-0`, and no float dust past a billionth.
fn clean(p: Pt) -> Pt {
    [tidy(p[0]), tidy(p[1])]
}
fn tidy(v: f64) -> f64 {
    let r = js_round(v * 1e9) / 1e9;
    if r == 0.0 { 0.0 } else { r }
}

// ------------------------------------------------------------------------------ block generator

/// `BlockValues['rowLabels']`: rows labelled with letters (A … Z, AA … ZZ, AAA …) or numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RowLabelStyle {
    Letters,
    Numbers,
}

/// `BlockValues['direction']`: how seat numbers run, as seen from the floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Direction {
    LeftToRight,
    RightToLeft,
}

/// `BlockValues` (the contract's `SectionGenerator`): what a section was generated from. Numbers
/// are the form's, unchecked (`NaN` for an empty field), so `checkBlock` can name each problem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockValues {
    pub rows: f64,
    pub seats_per_row: Vec<f64>,
    pub row_labels: RowLabelStyle,
    pub first_row: String,
    pub first_seat: f64,
    pub direction: Direction,
    pub curve: f64,
}

/// `BlockSeat`: a seat's label and place.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockSeat {
    pub label: String,
    pub at: Pt,
}

/// `BlockRow`: a row's label and seats, left to right as seen from the floor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockRow {
    pub label: String,
    pub seats: Vec<BlockSeat>,
}

/// `Block`: a generated block, rows front first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Block {
    pub rows: Vec<BlockRow>,
}

/// `keyof BlockValues`: the form field a problem belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockField {
    Rows,
    SeatsPerRow,
    RowLabels,
    FirstRow,
    FirstSeat,
    Direction,
    Curve,
}

/// `BlockProblem`: a value of the generator that can't be used, with its field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockProblem {
    pub field: BlockField,
    pub message: String,
}

/// `BlockError`: the problems that stop a block being generated; its message joins them with
/// "; ".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockError {
    pub problems: Vec<BlockProblem>,
}

impl fmt::Display for BlockError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let messages: Vec<&str> = self.problems.iter().map(|p| p.message.as_str()).collect();
        f.write_str(&messages.join("; "))
    }
}

impl std::error::Error for BlockError {}

const LETTERS: &[u8; 26] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// JavaScript's `String.prototype.trim`: its white space and line ends (with U+FEFF, without
/// U+0085).
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// JavaScript's `Number.isInteger`.
fn is_integer(n: f64) -> bool {
    n.is_finite() && n.trunc() == n
}

/// A letter label's place in A … Z, AA … ZZ, AAA …, or `None` when it is not one. Upper-cased as
/// JavaScript does (so "ß" reads as "SS").
fn letter_index(label: &str) -> Option<usize> {
    let s = label.to_uppercase();
    let first = *s.as_bytes().first()?;
    if !first.is_ascii_uppercase() || !s.bytes().all(|b| b == first) {
        return None;
    }
    Some((first - b'A') as usize + 26 * (s.len() - 1))
}

fn letter_label(i: usize) -> String {
    (LETTERS[i % 26] as char).to_string().repeat(i / 26 + 1)
}

/// `rowLabels` (039 R7): `count` row labels from `first`: letters run A … Z, AA … ZZ (one letter
/// repeated), AAA …; numbers count up. A [`BlockError`] when `first` isn't in the style or a label
/// would be longer than 5 characters.
pub fn row_labels(
    style: RowLabelStyle,
    first: &str,
    count: usize,
) -> Result<Vec<String>, BlockError> {
    let problems = label_problems(style, first, count);
    if !problems.is_empty() {
        return Err(BlockError { problems });
    }
    let s = js_trim(first);
    Ok(match style {
        RowLabelStyle::Numbers => {
            let start: u64 = s.parse().expect("checked: 1 to 5 digits");
            (0..count).map(|i| (start + i as u64).to_string()).collect()
        }
        RowLabelStyle::Letters => {
            let start = letter_index(s).expect("checked: a letter label");
            (0..count).map(|i| letter_label(start + i)).collect()
        }
    })
}

fn label_problems(style: RowLabelStyle, first: &str, count: usize) -> Vec<BlockProblem> {
    let max = LAYOUT_LIMITS.label_max_length;
    let s = js_trim(first);
    let problem = |message: String| {
        vec![BlockProblem {
            field: BlockField::FirstRow,
            message,
        }]
    };
    match style {
        RowLabelStyle::Numbers => {
            if s.is_empty() || s.len() > 5 || !s.bytes().all(|b| b.is_ascii_digit()) {
                return problem("The first row is a whole number, such as 1".into());
            }
            let last = s.parse::<u64>().expect("1 to 5 digits") + count.saturating_sub(1) as u64;
            if last.to_string().len() > max {
                return problem(format!("Row labels would run past {max} characters"));
            }
            Vec::new()
        }
        RowLabelStyle::Letters => {
            let Some(start) = letter_index(s) else {
                return problem(
                    "The first row is a letter, or one letter repeated (A, AA, AAA)".into(),
                );
            };
            if letter_label(start + count.saturating_sub(1)).len() > max {
                return problem(format!("Row labels would run past {}", "Z".repeat(max)));
            }
            Vec::new()
        }
    }
}

/// `checkBlock` (039 R7, FR-006): every problem with the generator's values, by field, naming
/// each limit.
pub fn check_block(v: &BlockValues) -> Vec<BlockProblem> {
    let mut problems = Vec::new();
    let mut push = |field, message: String| problems.push(BlockProblem { field, message });
    let max_rows = LAYOUT_LIMITS.max_rows as f64;
    let max_seats = LAYOUT_LIMITS.max_seats_per_row as f64;
    let rows_ok = is_integer(v.rows) && v.rows >= 1.0 && v.rows <= max_rows;
    if !is_integer(v.rows) || v.rows < 1.0 {
        push(BlockField::Rows, "At least 1 row".into());
    } else if v.rows > max_rows {
        push(
            BlockField::Rows,
            format!("At most {} rows", LAYOUT_LIMITS.max_rows),
        );
    }
    let list = &v.seats_per_row;
    if list.is_empty() {
        push(
            BlockField::SeatsPerRow,
            "Seats per row: one number, or one a row".into(),
        );
    } else {
        if list.iter().any(|n| !is_integer(*n) || *n < 1.0) {
            push(BlockField::SeatsPerRow, "At least 1 seat in a row".into());
        } else if list.iter().any(|n| *n > max_seats) {
            push(
                BlockField::SeatsPerRow,
                format!("At most {} seats in a row", LAYOUT_LIMITS.max_seats_per_row),
            );
        }
        if list.len() != 1 && rows_ok && list.len() as f64 != v.rows {
            push(
                BlockField::SeatsPerRow,
                format!(
                    "Give one number for every row, or one for each of the {} rows",
                    js_number(v.rows)
                ),
            );
        }
    }
    if rows_ok {
        problems.extend(label_problems(v.row_labels, &v.first_row, v.rows as usize));
    } else {
        problems.extend(label_problems(v.row_labels, &v.first_row, 1));
    }
    if !is_integer(v.first_seat) || v.first_seat < 1.0 || v.first_seat > 9999.0 {
        problems.push(BlockProblem {
            field: BlockField::FirstSeat,
            message: "The first seat is a whole number from 1 to 9,999".into(),
        });
    }
    if !v.curve.is_finite() || v.curve < 0.0 || v.curve > 120.0 {
        problems.push(BlockProblem {
            field: BlockField::Curve,
            message: "The curve is from 0 to 120 degrees".into(),
        });
    }
    problems
}

/// `seatCounts`: the seats of each row, front first. As `Array.from({ length: rows })`: a
/// fractional count of rows is cut down and `NaN` gives none; a row past a short list is `NaN`
/// (JavaScript's `undefined`).
pub fn seat_counts(v: &BlockValues) -> Vec<f64> {
    let rows = if v.rows.is_nan() || v.rows <= 0.0 {
        0
    } else {
        v.rows.trunc() as usize
    };
    (0..rows)
        .map(|k| {
            let i = if v.seats_per_row.len() == 1 { 0 } else { k };
            v.seats_per_row.get(i).copied().unwrap_or(f64::NAN)
        })
        .collect()
}

/// `generateBlock` (039 R7): a block of seats in its own frame. The origin is the middle of the
/// front row; rows go back toward `-y`, so the block faces down the map. Straight: row `k` seat
/// `i` of `n` at `((i − (n − 1) / 2) × 2, −2k)`. Curved (`curve` degrees of the front row's arc):
/// every row an arc about `(0, R₀)` on the floor side, `R₀ = 2(n₀ − 1) / curve` in radians (at
/// least 2), row `k` of radius `R₀ + 2k`, its seats 2 apart along it, centered. Seats listed left
/// to right; their labels run from `firstSeat` in `direction`. A [`BlockError`] for bad values.
pub fn generate_block(v: &BlockValues) -> Result<Block, BlockError> {
    let problems = check_block(v);
    if !problems.is_empty() {
        return Err(BlockError { problems });
    }
    let counts = seat_counts(v);
    let labels = row_labels(v.row_labels, &v.first_row, v.rows as usize)?;
    let curve = (v.curve * std::f64::consts::PI) / 180.0;
    let r0 = if curve > 0.0 {
        js_max([ROW_GAP, (SEAT_GAP * (counts[0] - 1.0)) / curve])
    } else {
        0.0
    };

    let rows = counts
        .iter()
        .enumerate()
        .map(|(k, &n)| {
            let seats = (0..n as usize)
                .map(|i| {
                    let offset = (i as f64 - (n - 1.0) / 2.0) * SEAT_GAP;
                    let at = if curve > 0.0 {
                        let radius = r0 + ROW_GAP * k as f64;
                        let a = offset / radius;
                        [radius * js_sin(a), r0 - radius * js_cos(a)]
                    } else {
                        [offset, -ROW_GAP * k as f64]
                    };
                    let label = match v.direction {
                        Direction::LeftToRight => v.first_seat + i as f64,
                        Direction::RightToLeft => v.first_seat + n - 1.0 - i as f64,
                    };
                    BlockSeat {
                        label: js_number(label),
                        at: clean(at),
                    }
                })
                .collect();
            BlockRow {
                label: labels[k].clone(),
                seats,
            }
        })
        .collect();
    Ok(Block { rows })
}

/// `placeBlock`: a block turned `angle` degrees clockwise about its origin, then moved to
/// `origin`.
pub fn place_block(block: &Block, origin: Pt, angle: f64) -> Block {
    Block {
        rows: block
            .rows
            .iter()
            .map(|r| BlockRow {
                label: r.label.clone(),
                seats: r
                    .seats
                    .iter()
                    .map(|s| {
                        let p = turn_about(&[s.at], [0.0, 0.0], angle)[0];
                        BlockSeat {
                            label: s.label.clone(),
                            at: [p[0] + origin[0], p[1] + origin[1]],
                        }
                    })
                    .collect(),
            })
            .collect(),
    }
}
