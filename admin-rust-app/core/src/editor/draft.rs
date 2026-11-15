//! Spec 037 research R14 (T074): the block generator's form as typed, ported from
//! `admin-app/src/layout-editor/AddSectionForm.tsx` (`CURVES`, `BlockDraft`, `draftOf`,
//! `NEW_BLOCK`, `readDraft`, and the Row labels and Curve selects' changes; 039 FR-006, FR-009,
//! FR-017, research R7; parity LE13–LE16, LE58). Add section and Regenerate both read their
//! fields through [`read_draft`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::doc::EditorDoc;
use super::js;
use super::state::totals;
use crate::seating::geometry::{
    BlockField, BlockValues, Direction, LAYOUT_LIMITS, RowLabelStyle, check_block, seat_counts,
};
use crate::seating::map_geometry::js_number;

/// A curve preset: its name and the front row's arc in degrees.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Curve {
    pub label: &'static str,
    pub degrees: f64,
}

/// `CURVES` (R7): the curve presets; the select adds "Degrees…" ([`CUSTOM`]) after them.
pub const CURVES: [Curve; 4] = [
    Curve {
        label: "None",
        degrees: 0.0,
    },
    Curve {
        label: "Slight",
        degrees: 20.0,
    },
    Curve {
        label: "Medium",
        degrees: 40.0,
    },
    Curve {
        label: "Strong",
        degrees: 60.0,
    },
];

/// The Curve select's value for "Degrees…".
pub const CUSTOM: &str = "custom";

/// `BlockDraft`: the form's text, as typed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDraft {
    pub name: String,
    pub rows: String,
    pub seats_per_row: String,
    pub row_labels: RowLabelStyle,
    pub first_row: String,
    pub first_seat: String,
    pub direction: Direction,
    /// A preset's degrees, or [`CUSTOM`].
    pub curve_preset: String,
    pub curve: String,
    pub level_id: String,
}

impl BlockDraft {
    /// The Row labels select's change (LE14): to Numbers, an all-letter First row becomes "1";
    /// to Letters, an all-digit one becomes "A".
    pub fn with_row_labels(&self, style: RowLabelStyle) -> BlockDraft {
        let all = |f: fn(&u8) -> bool| {
            !self.first_row.is_empty() && self.first_row.as_bytes().iter().all(f)
        };
        let first_row = match style {
            RowLabelStyle::Numbers if all(u8::is_ascii_alphabetic) => "1".to_string(),
            RowLabelStyle::Letters if all(u8::is_ascii_digit) => "A".to_string(),
            _ => self.first_row.clone(),
        };
        BlockDraft {
            row_labels: style,
            first_row,
            ..self.clone()
        }
    }

    /// The Curve select's change: a preset sets the degrees; "Degrees…" keeps the last ones.
    pub fn with_curve_preset(&self, preset: &str) -> BlockDraft {
        BlockDraft {
            curve_preset: preset.to_string(),
            curve: if preset == CUSTOM {
                self.curve.clone()
            } else {
                preset.to_string()
            },
            ..self.clone()
        }
    }

    /// Whether "Degrees…" is chosen: then "Curve in degrees" shows, with the curve's problem
    /// under it instead of under Curve.
    pub fn is_custom_curve(&self) -> bool {
        self.curve_preset == CUSTOM
    }
}

/// `draftOf`: a generator's values as the form shows them.
pub fn draft_of(v: &BlockValues, name: &str, level_id: &str) -> BlockDraft {
    let preset = CURVES.iter().find(|c| c.degrees == v.curve);
    BlockDraft {
        name: name.to_string(),
        rows: js_number(v.rows),
        seats_per_row: v
            .seats_per_row
            .iter()
            .map(|n| js_number(*n))
            .collect::<Vec<_>>()
            .join(", "),
        row_labels: v.row_labels,
        first_row: v.first_row.clone(),
        first_seat: js_number(v.first_seat),
        direction: v.direction,
        curve_preset: preset.map_or_else(|| CUSTOM.to_string(), |c| js_number(c.degrees)),
        curve: js_number(v.curve),
        level_id: level_id.to_string(),
    }
}

/// `NEW_BLOCK`: a new section's values, 10 rows of 20, straight, lettered from A.
pub fn new_block() -> BlockValues {
    BlockValues {
        rows: 10.0,
        seats_per_row: vec![20.0],
        row_labels: RowLabelStyle::Letters,
        first_row: "A".into(),
        first_seat: 1.0,
        direction: Direction::LeftToRight,
        curve: 0.0,
    }
}

/// A field of the form (`'name' | keyof SectionGenerator`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DraftField {
    Name,
    Rows,
    SeatsPerRow,
    RowLabels,
    FirstRow,
    FirstSeat,
    Direction,
    Curve,
}

impl DraftField {
    /// The TypeScript's key: `name`, `rows`, `seatsPerRow`, ….
    pub fn as_str(self) -> &'static str {
        match self {
            DraftField::Name => "name",
            DraftField::Rows => "rows",
            DraftField::SeatsPerRow => "seatsPerRow",
            DraftField::RowLabels => "rowLabels",
            DraftField::FirstRow => "firstRow",
            DraftField::FirstSeat => "firstSeat",
            DraftField::Direction => "direction",
            DraftField::Curve => "curve",
        }
    }
}

impl From<BlockField> for DraftField {
    fn from(f: BlockField) -> Self {
        match f {
            BlockField::Rows => DraftField::Rows,
            BlockField::SeatsPerRow => DraftField::SeatsPerRow,
            BlockField::RowLabels => DraftField::RowLabels,
            BlockField::FirstRow => DraftField::FirstRow,
            BlockField::FirstSeat => DraftField::FirstSeat,
            BlockField::Direction => DraftField::Direction,
            BlockField::Curve => DraftField::Curve,
        }
    }
}

/// The first problem of each field.
pub type DraftProblems = BTreeMap<DraftField, String>;

/// `readDraft`'s options.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReadDraftOptions<'a> {
    /// The section being regenerated (its name doesn't count, and the 100 sections don't).
    pub except: Option<&'a str>,
    /// The seats the layout keeps.
    pub seats_before: f64,
    pub check_name: bool,
}

/// What `readDraft` gives.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftRead {
    pub values: BlockValues,
    pub problems: DraftProblems,
}

/// The form's `number`: an empty box is `NaN`, else `Number(s)`.
fn number(s: &str) -> f64 {
    if js::trim(s).is_empty() {
        f64::NAN
    } else {
        js::to_number(s)
    }
}

/// `readDraft` (FR-006, R7, LE15): the draft's generator values and every problem with them, by
/// field: the shared `checkBlock` limits ("At most 100 rows"), the name, and the seats left
/// under 30,000.
pub fn read_draft(draft: &BlockDraft, doc: &EditorDoc, opts: &ReadDraftOptions) -> DraftRead {
    // `split(/[\s,]+/).filter(Boolean)`.
    let list: Vec<f64> = draft
        .seats_per_row
        .split(|c: char| js::is_js_space(c) || c == ',')
        .filter(|s| !s.is_empty())
        .map(number)
        .collect();
    let values = BlockValues {
        rows: number(&draft.rows),
        seats_per_row: list.clone(),
        row_labels: draft.row_labels,
        first_row: js::trim(&draft.first_row).to_string(),
        first_seat: number(&draft.first_seat),
        direction: draft.direction,
        curve: if draft.curve_preset == CUSTOM {
            number(&draft.curve)
        } else {
            js::to_number(&draft.curve_preset)
        },
    };
    let mut problems = DraftProblems::new();
    if opts.check_name {
        let name = js::trim(&draft.name);
        let lower = name.to_lowercase();
        let problem = if name.is_empty() {
            Some("Name the section".to_string())
        } else if js::len(name) > LAYOUT_LIMITS.name_max_length {
            Some(format!(
                "At most {} characters",
                LAYOUT_LIMITS.name_max_length
            ))
        } else if doc
            .sections
            .iter()
            .any(|s| Some(s.id.as_str()) != opts.except && s.name.to_lowercase() == lower)
        {
            Some(format!("Another section is named {name}"))
        } else if opts.except.is_none() && doc.sections.len() >= LAYOUT_LIMITS.max_sections {
            Some(format!(
                "A layout has at most {} sections",
                LAYOUT_LIMITS.max_sections
            ))
        } else {
            None
        };
        if let Some(p) = problem {
            problems.insert(DraftField::Name, p);
        }
    }
    if list.iter().any(|n| n.is_nan()) {
        problems.insert(
            DraftField::SeatsPerRow,
            "Seats per row: whole numbers, such as 20 or 16, 16, 18".into(),
        );
    }
    for p in check_block(&values) {
        problems.entry(p.field.into()).or_insert(p.message);
    }
    if !problems.contains_key(&DraftField::SeatsPerRow) && !problems.contains_key(&DraftField::Rows)
    {
        let adding: f64 = seat_counts(&values).iter().sum();
        let total = opts.seats_before + adding;
        if total > LAYOUT_LIMITS.max_seats as f64 {
            // A whole count: the rows and seats passed `checkBlock`.
            #[allow(clippy::cast_possible_truncation, reason = "a whole seat count")]
            let total = total as i64;
            problems.insert(
                DraftField::SeatsPerRow,
                format!(
                    "The layout would have {} seats; at most {}",
                    js::grouped(total),
                    js::grouped(LAYOUT_LIMITS.max_seats as i64)
                ),
            );
        }
    }
    DraftRead { values, problems }
}

/// Add section's note (LE16): "<seats left, grouped> seats left in this layout".
pub fn seats_left_note(doc: &EditorDoc) -> String {
    format!(
        "{} seats left in this layout",
        js::grouped(totals(doc).seats_left)
    )
}
