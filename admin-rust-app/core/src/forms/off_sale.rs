//! Spec 037 T049 (parity M10): the event form's seats off sale, ported from
//! `admin-app/src/components/off-sale.ts` (spec 038 FR-013, research R8, R15), and the pure part
//! of the off-sale tool in `admin-app/src/components/SeatingSection.tsx` (`SectionSeats`).
//!
//! The seats off sale are kept as the selectors the Backend takes, compacted as it compacts them
//! (`getEventSeating`): every whole section as `{sectionId}`, then every whole row as
//! `{sectionId, row}`, then single seats, each in drawing order.
//!
//! The layout payloads (`LayoutSummary`, `LayoutDetail`, `LayoutSectionSeats`) are written here as
//! plain serde structs with the contract's field names, holding what the event form reads; ids
//! are strings, as in the TypeScript.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::seating::map_state::{SeatState, VenueMapSection};

/// The contract's `OffSaleSelector`: a whole section (`section_id` alone), one row (with `row`),
/// or one seat (with `row` and `seat`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OffSaleSelector {
    pub section_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat: Option<u64>,
}

impl OffSaleSelector {
    /// `{ sectionId }`.
    pub fn section(section_id: &str) -> Self {
        Self {
            section_id: section_id.into(),
            row: None,
            seat: None,
        }
    }

    /// `{ sectionId, row }`.
    pub fn row(section_id: &str, row: u64) -> Self {
        Self {
            section_id: section_id.into(),
            row: Some(row),
            seat: None,
        }
    }

    /// `{ sectionId, row, seat }`.
    pub fn seat(section_id: &str, row: u64, seat: u64) -> Self {
        Self {
            section_id: section_id.into(),
            row: Some(row),
            seat: Some(seat),
        }
    }
}

/// The contract's `LayoutSummary`, what the Seating select lists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSummary {
    pub id: String,
    pub name: String,
    pub seat_count: i64,
}

/// The contract's `PriceLevel`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceLevel {
    pub id: String,
    pub name: String,
    pub rank: u64,
    /// The `LevelColor` name, for `level-swatch--{color}`.
    pub color: String,
    pub seat_count: i64,
}

/// The contract's `LayoutSectionSummary`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSectionSummary {
    pub id: String,
    pub name: String,
    pub level_id: String,
    pub outline: Vec<[f64; 2]>,
    pub label_at: [f64; 2],
    pub row_count: u64,
    pub seat_count: i64,
    pub level_ids: Vec<String>,
}

/// The contract's `LevelPriceInput`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelPrice {
    pub level_id: String,
    pub price: String,
}

/// The contract's `LatestPrices`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestPrices {
    pub event_id: String,
    pub event_name: String,
    pub starts_at: String,
    pub prices: Vec<LevelPrice>,
}

/// The contract's `LayoutDetail`, as far as the event form reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDetail {
    pub id: String,
    pub name: String,
    pub seat_count: i64,
    /// By rank.
    pub levels: Vec<PriceLevel>,
    /// In drawing order.
    pub sections: Vec<LayoutSectionSummary>,
    pub latest_prices: Option<LatestPrices>,
}

/// The contract's `LayoutSeat`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSeat {
    pub number: u64,
    pub label: String,
    pub at: [f64; 2],
    pub level_id: String,
    #[serde(default)]
    pub accessible: bool,
}

/// One row of `LayoutSectionSeats`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSectionRow {
    pub number: u64,
    pub label: String,
    pub seats: Vec<LayoutSeat>,
}

/// The contract's `LayoutSectionSeats`: one section of a layout, seat by seat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSectionSeats {
    pub layout_id: String,
    pub section_id: String,
    pub name: String,
    /// Front first.
    pub rows: Vec<LayoutSectionRow>,
}

/// Ports `seatKey` (`off-sale.ts`): a seat of a section by its row and seat numbers, "row/seat".
pub fn seat_key(row: u64, seat: u64) -> String {
    format!("{row}/{seat}")
}

/// Ports `offSeatsOf` (`off-sale.ts`): the seats of one section the selectors put off sale, as
/// seat keys.
pub fn off_seats_of(
    selectors: &[OffSaleSelector],
    section: &LayoutSectionSeats,
) -> BTreeSet<String> {
    let mut off = BTreeSet::new();
    for sel in selectors {
        if sel.section_id != section.section_id {
            continue;
        }
        for row in &section.rows {
            if sel.row.is_some_and(|r| r != row.number) {
                continue;
            }
            for seat in &row.seats {
                if sel.seat.is_some_and(|s| s != seat.number) {
                    continue;
                }
                off.insert(seat_key(row.number, seat.number));
            }
        }
    }
    off
}

/// Ports `compactSection` (`off-sale.ts`): one section's seats off sale as selectors, the
/// section, else its whole rows and its seats.
pub fn compact_section(
    section: &LayoutSectionSeats,
    off: &BTreeSet<String>,
) -> Vec<OffSaleSelector> {
    let id = section.section_id.as_str();
    let all = section.rows.iter().all(|r| {
        r.seats
            .iter()
            .all(|s| off.contains(&seat_key(r.number, s.number)))
    });
    if all && !section.rows.is_empty() {
        return vec![OffSaleSelector::section(id)];
    }
    let mut out = Vec::new();
    for row in &section.rows {
        let off_here: Vec<&LayoutSeat> = row
            .seats
            .iter()
            .filter(|s| off.contains(&seat_key(row.number, s.number)))
            .collect();
        if off_here.is_empty() {
            continue;
        }
        if off_here.len() == row.seats.len() {
            out.push(OffSaleSelector::row(id, row.number));
        } else {
            for s in off_here {
                out.push(OffSaleSelector::seat(id, row.number, s.number));
            }
        }
    }
    out
}

/// Ports `ordered` (`off-sale.ts`): the selectors in the Backend's compacted order, for the
/// layout's sections in drawing order (a section not in the order sorts as the first). Stable,
/// as `Array.prototype.sort` is.
pub fn ordered(selectors: &[OffSaleSelector], section_order: &[String]) -> Vec<OffSaleSelector> {
    let place: BTreeMap<&str, usize> = section_order
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    let kind = |s: &OffSaleSelector| match (s.row, s.seat) {
        (None, _) => 0,
        (Some(_), None) => 1,
        _ => 2,
    };
    let mut out = selectors.to_vec();
    out.sort_by_key(|s| {
        (
            kind(s),
            place.get(s.section_id.as_str()).copied().unwrap_or(0),
            s.row.unwrap_or(0),
            s.seat.unwrap_or(0),
        )
    });
    out
}

/// Ports `withSectionOff` (`off-sale.ts`): replaces one section's selectors by those for `off`,
/// its seats off sale after an edit, keeping every other section's, in compacted order.
pub fn with_section_off(
    selectors: &[OffSaleSelector],
    section: &LayoutSectionSeats,
    off: &BTreeSet<String>,
    section_order: &[String],
) -> Vec<OffSaleSelector> {
    let mut next: Vec<OffSaleSelector> = selectors
        .iter()
        .filter(|s| s.section_id != section.section_id)
        .cloned()
        .collect();
    next.extend(compact_section(section, off));
    ordered(&next, section_order)
}

/// Ports `OffSaleCounts` (`off-sale.ts`): what the price table and the line show.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct OffSaleCounts {
    /// Seats off sale by level.
    pub off_by_level: BTreeMap<String, i64>,
    pub seats_off_sale: i64,
    pub seats_on_sale: i64,
    /// Sections whose count by level needs their seats, which are not loaded yet.
    pub missing: Vec<String>,
}

/// Ports `countOffSale` (`off-sale.ts`): the seats off sale per level. A whole section of one
/// level counts without its seats; a row, a seat, or a section of several levels needs the
/// section's seats (`sections`), and until they are loaded its seats count in the totals but in
/// no level, and it is listed in `missing`.
pub fn count_off_sale(
    layout: &LayoutDetail,
    selectors: &[OffSaleSelector],
    sections: &BTreeMap<String, LayoutSectionSeats>,
) -> OffSaleCounts {
    let mut off_by_level: BTreeMap<String, i64> = BTreeMap::new();
    let mut missing = Vec::new();
    let mut seats_off_sale = 0;
    for summary in &layout.sections {
        let mine: Vec<OffSaleSelector> = selectors
            .iter()
            .filter(|s| s.section_id == summary.id)
            .cloned()
            .collect();
        if mine.is_empty() {
            continue;
        }
        if let Some(seats) = sections.get(&summary.id) {
            let off = off_seats_of(&mine, seats);
            for row in &seats.rows {
                for seat in &row.seats {
                    if off.contains(&seat_key(row.number, seat.number)) {
                        *off_by_level.entry(seat.level_id.clone()).or_default() += 1;
                    }
                }
            }
            seats_off_sale += off.len() as i64;
        } else if mine.iter().any(|s| s.row.is_none()) {
            seats_off_sale += summary.seat_count;
            if summary.level_ids.len() == 1 {
                *off_by_level
                    .entry(summary.level_ids[0].clone())
                    .or_default() += summary.seat_count;
            } else {
                missing.push(summary.id.clone());
            }
        } else {
            // Rows or seats of a section not loaded yet: counted once it is.
            missing.push(summary.id.clone());
        }
    }
    OffSaleCounts {
        off_by_level,
        seats_off_sale,
        seats_on_sale: layout.seat_count - seats_off_sale,
        missing,
    }
}

// ---------------------------------------------------------------- the tool (SeatingSection.tsx)

/// The legend of the off-sale tool (`<fieldset id="offSale">`).
pub const OFF_SALE_LEGEND: &str = "Seats off sale";
/// The overview's note.
pub const CHOOSE_SECTION_NOTE: &str =
    "Choose a section to take its seats off sale or put them back.";
/// The ghost button back to the overview.
pub const BACK_TO_SECTIONS: &str = "Back to all sections";
/// Shown until a section's seats are loaded (a failed read keeps it: quirk kept, M10).
pub const LOADING_SEATS: &str = "Loading the seats…";
/// Shown when a section has a sold or held seat.
pub const TAKEN_NOTE: &str = "Sold and held seats can't be taken off sale.";

/// "Section {name}": an overview button, and the open section's heading.
pub fn section_button(name: &str) -> String {
    format!("Section {name}")
}

/// "Section {name} seats": the seat drawing's `aria-label`.
pub fn section_seats_label(name: &str) -> String {
    format!("Section {name} seats")
}

/// Ports `TakenSeats`' values (`SeatingSection.tsx`): a seat the event has sold or a customer
/// holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Taken {
    Sold,
    Reserved,
}

/// Ports `TakenSeats` (`SeatingSection.tsx`): sold and held seats by seat key.
pub type TakenSeats = BTreeMap<String, Taken>;

/// The sold and held seats of a venue-map section, as `loadSection` in `EventForm.tsx` reads them
/// from `getVenueMapSection`.
pub fn taken_from_map_section(map: &VenueMapSection) -> TakenSeats {
    let mut taken = TakenSeats::new();
    for row in &map.rows {
        for seat in &row.seats {
            let state = match seat.state {
                SeatState::Sold => Taken::Sold,
                SeatState::Reserved => Taken::Reserved,
                _ => continue,
            };
            taken.insert(seat_key(row.number, seat.number), state);
        }
    }
    taken
}

/// Ports the seat radius of `SectionSeats` (`SeatingSection.tsx`): 0.4 of the gap between the
/// first two seats of the first row with more than one, else of 2, and at least 0.2, in map units.
pub fn seat_radius(section: &LayoutSectionSeats) -> f64 {
    let gap = section
        .rows
        .iter()
        .find(|r| r.seats.len() > 1)
        .map_or(2.0, |r| {
            let (a, b) = (r.seats[0].at, r.seats[1].at);
            (b[0] - a[0]).hypot(b[1] - a[1])
        });
    (gap * 0.4).max(0.2)
}

/// One row's checkbox in the tool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowChoice {
    pub number: u64,
    /// "Row {label} off sale".
    pub label: String,
    /// All its seats are off sale.
    pub checked: bool,
    /// Unchecked with a taken seat.
    pub disabled: bool,
}

/// One seat of the tool's drawing (`<g role="button">`).
#[derive(Debug, Clone, PartialEq)]
pub struct SeatChoice {
    pub row: u64,
    pub seat: u64,
    pub at: [f64; 2],
    /// "Row {r}, Seat {s}", with ", sold" or ", held".
    pub label: String,
    /// `aria-pressed`: off sale.
    pub pressed: bool,
    /// Sold or held: `aria-disabled`, not focusable, not pressable.
    pub taken: Option<Taken>,
    /// `tabIndex`: -1 when taken, else 0.
    pub tab_index: i32,
    pub class: &'static str,
}

/// Ports `SectionSeats` (`SeatingSection.tsx`) without its markup: one open section's seats off
/// sale, and the changes its controls make, each returning the event's selectors after it.
#[derive(Debug, Clone)]
pub struct SectionTool<'a> {
    section: &'a LayoutSectionSeats,
    taken: &'a TakenSeats,
    off: BTreeSet<String>,
    all: Vec<String>,
}

impl<'a> SectionTool<'a> {
    /// The open section, its sold and held seats, and the event's selectors.
    pub fn new(
        section: &'a LayoutSectionSeats,
        taken: &'a TakenSeats,
        selectors: &[OffSaleSelector],
    ) -> Self {
        let all = section
            .rows
            .iter()
            .flat_map(|r| r.seats.iter().map(move |s| seat_key(r.number, s.number)))
            .collect();
        Self {
            section,
            taken,
            off: off_seats_of(selectors, section),
            all,
        }
    }

    /// The section's seats off sale, as seat keys.
    pub fn off(&self) -> &BTreeSet<String> {
        &self.off
    }

    /// `wholeOff`: the section has seats and all are off sale.
    pub fn whole_off(&self) -> bool {
        !self.all.is_empty() && self.all.iter().all(|k| self.off.contains(k))
    }

    /// "Whole section on sale" when all are off, else "Whole section off sale".
    pub fn whole_label(&self) -> &'static str {
        if self.whole_off() {
            "Whole section on sale"
        } else {
            "Whole section off sale"
        }
    }

    /// Disabled when not all off and any seat is taken.
    pub fn whole_disabled(&self) -> bool {
        !self.whole_off() && !self.taken.is_empty()
    }

    /// [`TAKEN_NOTE`] when any seat of the section is taken.
    pub fn taken_note(&self) -> Option<&'static str> {
        (!self.taken.is_empty()).then_some(TAKEN_NOTE)
    }

    /// `toggle`: `keys` put off sale (`to`, skipping taken seats) or back on sale, as selectors.
    fn toggle(
        &self,
        keys: &[String],
        to: bool,
        selectors: &[OffSaleSelector],
        order: &[String],
    ) -> Vec<OffSaleSelector> {
        let mut next = self.off.clone();
        for k in keys {
            if to && self.taken.contains_key(k) {
                continue;
            }
            if to {
                next.insert(k.clone());
            } else {
                next.remove(k);
            }
        }
        with_section_off(selectors, self.section, &next, order)
    }

    /// The whole-section button: everything off sale (skipping taken seats), or all back.
    pub fn toggle_whole(
        &self,
        selectors: &[OffSaleSelector],
        order: &[String],
    ) -> Vec<OffSaleSelector> {
        self.toggle(&self.all, !self.whole_off(), selectors, order)
    }

    fn row_keys(&self, number: u64) -> Option<Vec<String>> {
        self.section
            .rows
            .iter()
            .find(|r| r.number == number)
            .map(|r| {
                r.seats
                    .iter()
                    .map(|s| seat_key(r.number, s.number))
                    .collect()
            })
    }

    /// Each row's checkbox, front first.
    pub fn rows(&self) -> Vec<RowChoice> {
        self.section
            .rows
            .iter()
            .map(|row| {
                let keys: Vec<String> = row
                    .seats
                    .iter()
                    .map(|s| seat_key(row.number, s.number))
                    .collect();
                let checked = keys.iter().all(|k| self.off.contains(k));
                let row_taken = keys.iter().any(|k| self.taken.contains_key(k));
                RowChoice {
                    number: row.number,
                    label: format!("Row {} off sale", row.label),
                    checked,
                    disabled: !checked && row_taken,
                }
            })
            .collect()
    }

    /// A row's checkbox changed: its seats off sale (skipping taken ones) or back on sale. A row
    /// the section lacks changes nothing.
    pub fn toggle_row(
        &self,
        number: u64,
        selectors: &[OffSaleSelector],
        order: &[String],
    ) -> Vec<OffSaleSelector> {
        let Some(keys) = self.row_keys(number) else {
            return selectors.to_vec();
        };
        let row_off = keys.iter().all(|k| self.off.contains(k));
        self.toggle(&keys, !row_off, selectors, order)
    }

    fn choice(&self, row: &LayoutSectionRow, seat: &LayoutSeat) -> SeatChoice {
        let k = seat_key(row.number, seat.number);
        let taken = self.taken.get(&k).copied();
        let pressed = self.off.contains(&k);
        let why = match taken {
            Some(Taken::Sold) => ", sold",
            Some(Taken::Reserved) => ", held",
            None => "",
        };
        SeatChoice {
            row: row.number,
            seat: seat.number,
            at: seat.at,
            label: format!("Row {}, Seat {}{why}", row.label, seat.label),
            pressed,
            taken,
            tab_index: if taken.is_some() { -1 } else { 0 },
            class: match (taken, pressed) {
                (Some(_), _) => "off-sale-section__seat off-sale-section__seat--taken",
                (None, true) => "off-sale-section__seat off-sale-section__seat--off",
                (None, false) => "off-sale-section__seat",
            },
        }
    }

    /// Every seat of the drawing, row by row.
    pub fn seats(&self) -> Vec<SeatChoice> {
        self.section
            .rows
            .iter()
            .flat_map(|row| row.seats.iter().map(move |seat| self.choice(row, seat)))
            .collect()
    }

    /// One seat by its numbers.
    pub fn seat(&self, row: u64, seat: u64) -> Option<SeatChoice> {
        let r = self.section.rows.iter().find(|r| r.number == row)?;
        let s = r.seats.iter().find(|s| s.number == seat)?;
        Some(self.choice(r, s))
    }

    /// A seat pressed (click, Enter, or Space): toggled; `None` for a taken or unknown seat,
    /// which does nothing.
    pub fn toggle_seat(
        &self,
        row: u64,
        seat: u64,
        selectors: &[OffSaleSelector],
        order: &[String],
    ) -> Option<Vec<OffSaleSelector>> {
        let choice = self.seat(row, seat)?;
        if choice.taken.is_some() {
            return None;
        }
        Some(self.toggle(&[seat_key(row, seat)], !choice.pressed, selectors, order))
    }
}

/// `n.toLocaleString()` (en-US) for a whole number: "22,090".
pub fn grouped(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}
