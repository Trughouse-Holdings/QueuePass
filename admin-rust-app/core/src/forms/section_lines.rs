//! Spec 037 T041 (parity M3, M3a): a layout's price levels and section lines being edited,
//! ported from `admin-app/src/components/SectionLines.tsx` (`LevelLine`, `SectionLine`,
//! `NEW_LEVEL`, `newLine`, `toLinesInput`, `lineSeats`, `totalSeats`, and the component's level
//! rename, option, add and remove rules) and `admin-app/src/components/LayoutsCard.tsx`
//! (`LinesDraft`, `draftOf`). Used by the Layouts card's lines form and New venue › Seated.
//!
//! Lines are kept as typed text until sent, as in the React app; numbers are read with
//! JavaScript's `Number()` ([`js_number`]) and shown with `toLocaleString()`
//! ([`to_locale_string`]), so a box that is not a number yet counts as 0 and every text matches.

use std::collections::HashMap;

use serde_json::{Value, json};

use crate::api::types::LayoutDetail;
use crate::seating::geometry::LAYOUT_LIMITS;

/// Which of a section line's boxes have no valid value yet (each outlined in red).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LineNeeded {
    pub name: bool,
    pub rows: bool,
    pub seats_per_row: bool,
    pub level: bool,
}

/// `wholeIn` (`SectionLines.tsx`): a whole number from 1 to `max`, as typed.
pub fn whole_in(s: &str, max: usize) -> bool {
    let t = js_trim(s);
    !t.is_empty()
        && t.bytes().all(|b| b.is_ascii_digit())
        && t.parse::<u64>().is_ok_and(|n| n >= 1 && n <= max as u64)
}
pub use crate::api::types::LevelColor;

/// `LEVEL_COLORS` (`packages/shared/src/seating.ts`): the shared theme's 12 level colors, in the
/// contract's `LevelColor` order, as the Color select lists them.
pub const LEVEL_COLORS: [LevelColor; 12] = [
    LevelColor::Violet,
    LevelColor::Blue,
    LevelColor::Cyan,
    LevelColor::Teal,
    LevelColor::Green,
    LevelColor::Lime,
    LevelColor::Yellow,
    LevelColor::Orange,
    LevelColor::Red,
    LevelColor::Pink,
    LevelColor::Purple,
    LevelColor::Brown,
];

/// The hint above the levels (`SectionLines.tsx`).
pub const LEVELS_HINT: &str = "Price levels, most desirable first. Each event that uses the layout sets a price for each level.";

/// The hint above the lines (spec 024 FR-018, `SectionLines.tsx`).
pub const SECTIONS_HINT: &str = "A section is a grid of seats: rows run front to back, and every row has the same number of seats across.";

/// The Price level option shown while a line's level is not one of the named levels.
pub const CHOOSE_A_LEVEL: &str = "Choose a level";

/// One `<option>` of a select: its value and its text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

impl SelectOption {
    fn new(value: impl Into<String>, label: impl Into<String>) -> Self {
        SelectOption {
            value: value.into(),
            label: label.into(),
        }
    }
}

/// `LevelLine` (`SectionLines.tsx`): a price level being edited, its name and one of the 12 colors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LevelLine {
    pub name: String,
    pub color: LevelColor,
}

/// `NEW_LEVEL` (`SectionLines.tsx`): `{ name: '', color: 'violet' }`.
pub fn new_level() -> LevelLine {
    LevelLine {
        name: String::new(),
        color: LevelColor::Violet,
    }
}

/// `SectionLine` (`SectionLines.tsx`): one section being edited, kept as typed text; its level by
/// name.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SectionLine {
    pub name: String,
    pub rows: String,
    pub seats_per_row: String,
    pub level: String,
}

/// `newLine` (`SectionLines.tsx`): a 1 × 1 line in `level`.
pub fn new_line(level: &str) -> SectionLine {
    SectionLine {
        name: String::new(),
        rows: "1".into(),
        seats_per_row: "1".into(),
        level: level.into(),
    }
}

/// `toLinesInput` (`SectionLines.tsx`, spec 038 research R6): the `LayoutLinesInput` (or
/// `LayoutUpdate`) body: names trimmed, numbers by `Number()` (as `JSON.stringify` writes them:
/// `NaN` as `null`), the levels in rank order.
pub fn to_lines_input(name: &str, levels: &[LevelLine], lines: &[SectionLine]) -> Value {
    json!({
        "name": js_trim(name),
        "levels": levels
            .iter()
            .map(|l| json!({ "name": js_trim(&l.name), "color": l.color.to_string() }))
            .collect::<Vec<_>>(),
        "sections": lines
            .iter()
            .map(|l| json!({
                "name": js_trim(&l.name),
                "rows": json_number(js_number(&l.rows)),
                "seatsPerRow": json_number(js_number(&l.seats_per_row)),
                "level": js_trim(&l.level),
            }))
            .collect::<Vec<_>>(),
    })
}

/// `Number(x) || 0`: `NaN` and 0 count as 0.
fn or_zero(n: f64) -> f64 {
    if n.is_nan() || n == 0.0 { 0.0 } else { n }
}

/// `lineSeats` (`SectionLines.tsx`): a line's seats as typed; a box that is not a number yet
/// counts as 0. As in JavaScript, `Infinity × 0` is `NaN`.
pub fn line_seats(l: &SectionLine) -> f64 {
    or_zero(js_number(&l.rows)) * or_zero(js_number(&l.seats_per_row))
}

/// `totalSeats` (`SectionLines.tsx`, spec 024 FR-022): the sum of the lines' seats.
pub fn total_seats(lines: &[SectionLine]) -> f64 {
    lines.iter().fold(0.0, |n, l| n + line_seats(l))
}

/// `${n.toLocaleString()} ${n === 1 ? one : many}`.
fn seats(n: f64) -> String {
    format!(
        "{} {}",
        to_locale_string(n),
        if n == 1.0 { "seat" } else { "seats" }
    )
}

/// A line's seats as shown beside it: "= 200 seats", "= 1 seat".
pub fn seats_text(n: f64) -> String {
    format!("= {}", seats(n))
}

/// The lines' total as shown under them, on New venue and in the lines form: "Total: 70 seats".
pub fn total_text(n: f64) -> String {
    format!("Total: {}", seats(n))
}

/// `LinesDraft` (`LayoutsCard.tsx`): a layout's name, levels and section lines being edited. New
/// venue › Seated uses one too, named "Standard".
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinesDraft {
    pub name: String,
    pub levels: Vec<LevelLine>,
    pub lines: Vec<SectionLine>,
}

impl LinesDraft {
    /// "New layout from section lines" (`LayoutsCard.tsx`): `{ name: '', levels: [NEW_LEVEL],
    /// lines: [] }`.
    pub fn new_layout() -> Self {
        LinesDraft {
            name: String::new(),
            levels: vec![new_level()],
            lines: Vec::new(),
        }
    }

    /// The draft's `toLinesInput(draft.name, draft.levels, draft.lines)`.
    pub fn to_lines_input(&self) -> Value {
        to_lines_input(&self.name, &self.levels, &self.lines)
    }

    /// `totalSeats(draft.lines)`.
    pub fn total_seats(&self) -> f64 {
        total_seats(&self.lines)
    }

    /// A required box with no valid value yet is outlined in red at once (`SectionLines.tsx`):
    /// level `i`'s name.
    pub fn level_name_needed(&self, i: usize) -> bool {
        self.levels
            .get(i)
            .is_some_and(|l| js_trim(&l.name).is_empty())
    }

    /// Section line `i`'s boxes with no valid value yet: name, rows, seats per row, price level.
    pub fn line_needed(&self, i: usize) -> LineNeeded {
        let Some(l) = self.lines.get(i) else {
            return LineNeeded::default();
        };
        LineNeeded {
            name: js_trim(&l.name).is_empty(),
            rows: !whole_in(&l.rows, LAYOUT_LIMITS.max_rows),
            seats_per_row: !whole_in(&l.seats_per_row, LAYOUT_LIMITS.max_seats_per_row),
            level: !self.named_levels().contains(&l.level),
        }
    }

    /// `named` (`SectionLines.tsx`): the levels' names that are not blank, untrimmed, in order.
    pub fn named_levels(&self) -> Vec<String> {
        self.levels
            .iter()
            .filter(|l| !js_trim(&l.name).is_empty())
            .map(|l| l.name.clone())
            .collect()
    }

    /// A line's Price level options: "Choose a level" (valued as the line's level) first when the
    /// line's level is not a named one, then each named level.
    pub fn level_options(&self, current: &str) -> Vec<SelectOption> {
        let named = self.named_levels();
        let mut out = Vec::with_capacity(named.len() + 1);
        if !named.iter().any(|n| n == current) {
            out.push(SelectOption::new(current, CHOOSE_A_LEVEL));
        }
        out.extend(named.into_iter().map(|n| SelectOption::new(n.clone(), n)));
        out
    }

    /// The Layout name box.
    pub fn set_name(&mut self, name: &str) {
        self.name = name.into();
    }

    /// `editLevel(i, { name })` (`SectionLines.tsx`): renames level `i` and, when the name
    /// changed, every line whose level was its old name (exactly, untrimmed).
    pub fn rename_level(&mut self, i: usize, name: &str) {
        let before = std::mem::replace(&mut self.levels[i].name, name.into());
        if before != name {
            for l in self.lines.iter_mut().filter(|l| l.level == before) {
                l.level = name.into();
            }
        }
    }

    /// `editLevel(i, { color })` (`SectionLines.tsx`).
    pub fn set_level_color(&mut self, i: usize, color: LevelColor) {
        self.levels[i].color = color;
    }

    /// "Add level": appends `NEW_LEVEL`, with no cap.
    pub fn add_level(&mut self) {
        self.levels.push(new_level());
    }

    /// "Remove level {i}": the lines keep their level names.
    pub fn remove_level(&mut self, i: usize) {
        self.levels.remove(i);
    }

    /// "Add section": `newLine(named[0] ?? '')`.
    pub fn add_section(&mut self) {
        let first = self.named_levels().into_iter().next().unwrap_or_default();
        self.lines.push(new_line(&first));
    }

    /// "Remove section {i}": the lines after it renumber.
    pub fn remove_section(&mut self, i: usize) {
        self.lines.remove(i);
    }

    /// The Section name box of line `i`.
    pub fn set_line_name(&mut self, i: usize, name: &str) {
        self.lines[i].name = name.into();
    }

    /// The Rows box of line `i`.
    pub fn set_line_rows(&mut self, i: usize, rows: &str) {
        self.lines[i].rows = rows.into();
    }

    /// The Seats per row box of line `i`.
    pub fn set_line_seats_per_row(&mut self, i: usize, seats_per_row: &str) {
        self.lines[i].seats_per_row = seats_per_row.into();
    }

    /// The Price level select of line `i`.
    pub fn set_line_level(&mut self, i: usize, level: &str) {
        self.lines[i].level = level.into();
    }
}

/// `draftOf` (`LayoutsCard.tsx`, spec 038 research R6): a LINES layout as lines again: its levels
/// by rank, its sections in order, Rows = `rowCount`, Seats per row = `String(seatCount /
/// rowCount)`, the level by name ('' when its level is not listed).
pub fn draft_of(layout: &LayoutDetail) -> LinesDraft {
    let level_name: HashMap<_, _> = layout
        .levels
        .iter()
        .map(|l| (l.id, l.name.to_string()))
        .collect();
    LinesDraft {
        name: layout.name.to_string(),
        levels: layout
            .levels
            .iter()
            .map(|l| LevelLine {
                name: l.name.to_string(),
                color: l.color,
            })
            .collect(),
        lines: layout
            .sections
            .iter()
            .map(|s| {
                let rows = s.row_count.get() as f64;
                SectionLine {
                    name: s.name.to_string(),
                    rows: js_number_string(rows),
                    seats_per_row: js_number_string(s.seat_count.get() as f64 / rows),
                    level: level_name.get(&s.level_id).cloned().unwrap_or_default(),
                }
            })
            .collect(),
    }
}

// ---------------------------------------------------------------- JavaScript numbers and text

/// JavaScript's white space and line terminators, as `String.prototype.trim` and `\s` read them.
fn is_js_space(c: char) -> bool {
    c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}')
}

/// `text.trim()` in JavaScript.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// The digits of `text` in `radix`, or `NaN`.
fn radix_number(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    digits
        .chars()
        .try_fold(0.0, |n, c| {
            c.to_digit(radix)
                .map(|d| n * f64::from(radix) + f64::from(d))
        })
        .unwrap_or(f64::NAN)
}

/// Whether `s` is JavaScript's unsigned decimal literal: digits, an optional fraction, an optional
/// exponent, with at least one mantissa digit.
fn is_decimal_literal(s: &str) -> bool {
    let (mantissa, exponent) = match s.find(['e', 'E']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let (int, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = |t: &str| t.chars().all(|c| c.is_ascii_digit());
    let mantissa_ok = digits(int) && digits(frac) && !(int.is_empty() && frac.is_empty());
    let exponent_ok = exponent.is_none_or(|e| {
        let e = e.strip_prefix(['+', '-']).unwrap_or(e);
        !e.is_empty() && digits(e)
    });
    mantissa_ok && exponent_ok
}

/// JavaScript's `Number(text)`: trimmed; empty is 0; decimal (with sign and exponent),
/// `Infinity`, or unsigned `0x`, `0o`, `0b` literals; anything else is `NaN`.
pub fn js_number(text: &str) -> f64 {
    let t = js_trim(text);
    if t.is_empty() {
        return 0.0;
    }
    let lower = t.get(..2).map(str::to_ascii_lowercase);
    match lower.as_deref() {
        Some("0x") => return radix_number(&t[2..], 16),
        Some("0o") => return radix_number(&t[2..], 8),
        Some("0b") => return radix_number(&t[2..], 2),
        _ => {}
    }
    let (negative, unsigned) = match t.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let magnitude = if unsigned == "Infinity" {
        f64::INFINITY
    } else if is_decimal_literal(unsigned) {
        unsigned.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        return f64::NAN;
    };
    if negative { -magnitude } else { magnitude }
}

/// JavaScript's `String(n)`: the shortest digits that read back as `n`, with an exponent
/// ("1e-7", "1.5e+21") below 1e-6 and from 1e21.
pub fn js_number_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    if n == 0.0 {
        return "0".into();
    }
    let abs = n.abs();
    if (1e-6..1e21).contains(&abs) {
        return format!("{n}");
    }
    let text = format!("{n:e}");
    match text.split_once('e') {
        Some((mantissa, exp)) if !exp.starts_with('-') => format!("{mantissa}e+{exp}"),
        _ => text,
    }
}

/// `n.toLocaleString()` in en-US: grouped thousands, at most 3 decimals rounded half away from
/// zero on the shortest decimal form (as ICU does), "NaN", "∞", and "-0" for a negative zero.
pub fn to_locale_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    let sign = if n.is_sign_negative() { "-" } else { "" };
    if n.is_infinite() {
        return format!("{sign}∞");
    }
    let plain = format!("{}", n.abs());
    let (int, frac) = plain.split_once('.').unwrap_or((&plain, ""));
    let mut digits: Vec<u8> = int.bytes().chain(frac.bytes().take(3)).collect();
    let mut frac_len = frac.len().min(3);
    if frac.as_bytes().get(3).is_some_and(|d| *d >= b'5') {
        // Round up, carrying through the digits.
        let mut i = digits.len();
        loop {
            if i == 0 {
                digits.insert(0, b'1');
                break;
            }
            i -= 1;
            if digits[i] == b'9' {
                digits[i] = b'0';
            } else {
                digits[i] += 1;
                break;
            }
        }
    }
    while frac_len > 0 && digits.last() == Some(&b'0') {
        digits.pop();
        frac_len -= 1;
    }
    let int_len = digits.len() - frac_len;
    let int_digits = std::str::from_utf8(&digits[..int_len]).unwrap_or("0");
    let mut grouped = String::new();
    for (i, c) in int_digits.chars().enumerate() {
        if i > 0 && (int_len - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(c);
    }
    if frac_len > 0 {
        grouped.push('.');
        grouped.push_str(std::str::from_utf8(&digits[int_len..]).unwrap_or(""));
    }
    format!("{sign}{grouped}")
}

/// `n` in a JSON body as `JSON.stringify` writes it: `NaN` and the infinities as `null`, a whole
/// number as an integer (-0 as 0).
pub fn json_number(n: f64) -> Value {
    if !n.is_finite() {
        Value::Null
    } else if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        json!(n as i64)
    } else {
        json!(n)
    }
}
