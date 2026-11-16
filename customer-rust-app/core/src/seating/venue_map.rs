// Copied from admin-rust-app/core/src/seating/venue_map.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R13 (T059; parity M6, M12–M15): everything the Leptos venue map, section
//! view, legend, Sections list, and layout preview draw, and the event page's Seating card says,
//! as plain data. Ported from `packages/shared/src/web/venue-map/` (`venue-map.tsx`,
//! `section-view.tsx`, `legend.tsx`, `sections-list.tsx`, `layout-preview.tsx`) and
//! `admin-app/src/components/EventSeatMap.tsx`.
//!
//! Every number an SVG attribute takes is already written as JavaScript writes it (`String(n)`,
//! [`js_number`]), so a view puts it in as it is and the attribute is byte for byte the React
//! app's. Every class, accessible name, tip, and line of text is the React app's, quirks kept (a
//! seat of a level missing from the map is named with an empty level, "Row 1, Seat 1, , not on
//! sale, open"; a section's counts by state include levels not on the map, its open seats by
//! price don't; each level's count is clamped at 0 before the sum).
//!
//! What the views keep for themselves: the elements and their fixed attributes (`role`,
//! `tabindex`, `text-anchor`, `dominant-baseline`, `aria-hidden`), the events, and the tip line's
//! state (a space when empty).

use serde::{Deserialize, Serialize};

use super::map_geometry::{Point, js_hypot, js_max, js_number, outline_path};
use super::map_state::{
    FloorKind, MapLevel, MapRow, MapSeat, MapSectionSummary, SeatState, VenueMap, VenueMapSection,
    open_seats_in, section_level,
};
use super::pan_zoom::{View, fit_of};
use crate::api::seat_stream::LiveSeatStatus;
use crate::api::types;
use crate::money::{format_price, price_cents};

/// `plural` (`venue-map.tsx`, `sections-list.tsx`): "1 open seat", "2 open seats".
fn plural(n: u64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

// ------------------------------------------------------------------------------ sections by state

/// `VenueMapProps['colorBy']` (`venue-map.tsx`): `Price`, the customer's map (sections in their
/// cheapest open level's color, the level legend); `State`, the admin's (FR-027).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ColorBy {
    #[default]
    Price,
    State,
}

/// `SectionState` (`legend.tsx`): a section's make-up of seat states on the admin's map.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionState {
    Open,
    Held,
    Sold,
    Off,
}

impl SectionState {
    /// The TypeScript value, as the classes name it (`venue-map__section--state-open`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Held => "held",
            Self::Sold => "sold",
            Self::Off => "off",
        }
    }
}

/// `SECTION_STATES` (`legend.tsx`): the admin's map's section fills, in the legend's order.
pub const SECTION_STATES: [(SectionState, &str); 4] = [
    (SectionState::Open, "Seats open"),
    (SectionState::Held, "None open, some held"),
    (SectionState::Sold, "Sold out"),
    (SectionState::Off, "Off sale"),
];

/// What `stateCounts` (`venue-map.tsx`) gives: a section's seats by state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StateCounts {
    pub open: u64,
    pub held: u64,
    pub sold: u64,
    pub off_sale: u64,
}

impl StateCounts {
    fn add(&mut self, section: &MapSectionSummary) {
        for c in &section.counts {
            self.open += c.clamped(SeatState::Open);
            self.held += c.clamped(SeatState::Reserved);
            self.sold += c.clamped(SeatState::Sold);
            self.off_sale += c.clamped(SeatState::OffSale);
        }
    }
}

/// `stateCounts` (`venue-map.tsx`): a section's seats by state over every level it has counts
/// for (a level missing from the map included), each level's count clamped at 0.
pub fn state_counts(section: &MapSectionSummary) -> StateCounts {
    let mut c = StateCounts::default();
    c.add(section);
    c
}

/// `sectionState` (`venue-map.tsx`, FR-027): some open; none open but some held; sold out; or
/// none on sale.
pub fn section_state(section: &MapSectionSummary) -> SectionState {
    let c = state_counts(section);
    if c.open > 0 {
        SectionState::Open
    } else if c.held > 0 {
        SectionState::Held
    } else if c.sold > 0 {
        SectionState::Sold
    } else {
        SectionState::Off
    }
}

// ------------------------------------------------------------------------------ the overview

/// `VenueMap`'s `open` (`venue-map.tsx`): the open section, if it is on the map.
pub fn open_section<'a>(
    map: &'a VenueMap,
    open_section_id: Option<&str>,
) -> Option<&'a MapSectionSummary> {
    let id = open_section_id?;
    map.sections.iter().find(|s| s.section_id == id)
}

/// `fitOf(map)` (`venue-map.tsx`): [`fit_of`] on a venue map's section outlines and its floor
/// (when not `NONE`), else its whole canvas.
pub fn fit_of_map(map: &VenueMap) -> View {
    let floor = match (&map.floor_outline, map.floor_kind) {
        (Some(f), kind) if kind != FloorKind::None => Some(f.as_slice()),
        _ => None,
    };
    fit_of(
        map.sections.iter().map(|s| s.outline.as_slice()),
        floor,
        map.size.width as f64,
        map.size.height as f64,
    )
}

/// The SVG's accessible name (`venue-map.tsx`): "{layoutName} map".
pub fn map_label(map: &VenueMap) -> String {
    format!("{} map", map.layout_name)
}

/// The note while the open section's seats load (`venue-map.tsx`).
pub fn loading_note(section_name: &str) -> String {
    format!("Loading the seats of section {section_name}…")
}

/// `sectionName` (`venue-map.tsx`): a section's accessible name. By state: "Section 115, 2 open,
/// 2 held, 1 sold, 1 off sale". By price: "Section 115, 2 open seats from $60" (its open seats
/// with a price, from its cheapest open level's price), else "Section 301, no open seats".
pub fn section_name(map: &VenueMap, s: &MapSectionSummary, color_by: ColorBy) -> String {
    if color_by == ColorBy::State {
        let c = state_counts(s);
        return format!(
            "Section {}, {} open, {} held, {} sold, {} off sale",
            s.name, c.open, c.held, c.sold, c.off_sale
        );
    }
    let n = open_seats_in(map, s);
    if n > 0
        && let Some(price) = section_level(map, s).and_then(|l| l.price.as_deref())
    {
        return format!(
            "Section {}, {} from {}",
            s.name,
            plural(n, "open seat", "open seats"),
            format_price(price)
        );
    }
    format!("Section {}, no open seats", s.name)
}

/// `sectionClass` (`venue-map.tsx`): `venue-map__section`, then by price its level's color (or
/// `venue-map--unavailable`) and `venue-map__section--faded` with no open seat on sale, or by
/// state `venue-map__section--state venue-map__section--state-{state}`; then
/// `venue-map__section--current` for the open section.
pub fn section_class(
    map: &VenueMap,
    s: &MapSectionSummary,
    color_by: ColorBy,
    open_section_id: Option<&str>,
) -> String {
    let mut classes = vec!["venue-map__section".to_string()];
    match color_by {
        ColorBy::Price => {
            classes.push(match section_level(map, s) {
                Some(level) => format!("venue-map--{}", level.color),
                None => "venue-map--unavailable".into(),
            });
            if open_seats_in(map, s) == 0 {
                classes.push("venue-map__section--faded".into());
            }
        }
        ColorBy::State => {
            classes.push("venue-map__section--state".into());
            classes.push(format!(
                "venue-map__section--state-{}",
                section_state(s).as_str()
            ));
        }
    }
    if open_section(map, open_section_id).is_some_and(|o| o.section_id == s.section_id) {
        classes.push("venue-map__section--current".into());
    }
    classes.join(" ")
}

/// One section's `<path role="button">` on the map.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionShape {
    pub section_id: String,
    /// `d`: its outline ([`outline_path`]).
    pub d: String,
    /// `class` ([`section_class`]).
    pub class: String,
    /// `aria-label` ([`section_name`]).
    pub name: String,
    /// The open section: `aria-current="true"` (absent otherwise).
    pub current: bool,
}

/// The "sold / open" line of a section's label on the admin's map: the second `tspan`
/// (`venue-map__label-counts`, `x` the label's).
#[derive(Debug, Clone, PartialEq)]
pub struct LabelCounts {
    /// "{sold} / {open}".
    pub text: String,
    /// `dy`: 1.2 × the font size.
    pub dy: String,
}

/// One section's name on the map, `<text class="venue-map__label">` (every section but the open
/// one).
#[derive(Debug, Clone, PartialEq)]
pub struct SectionLabel {
    pub section_id: String,
    /// `x`: its `labelAt` x.
    pub x: String,
    /// `y`: its `labelAt` y, less 0.6 × the font size on the admin's map.
    pub y: String,
    /// `font-size`.
    pub font_size: String,
    /// The section's name: the text itself by price; by state, the first `tspan` (`x` the
    /// label's), with [`Self::counts`] the second.
    pub name: String,
    pub counts: Option<LabelCounts>,
}

/// The section labels (`venue-map.tsx`): at `font_size`
/// ([`super::pan_zoom::label_font_size`] of the fit and the zoom).
pub fn section_labels(
    map: &VenueMap,
    color_by: ColorBy,
    open_section_id: Option<&str>,
    font_size: f64,
) -> Vec<SectionLabel> {
    let open = open_section(map, open_section_id);
    map.sections
        .iter()
        .filter(|s| open.is_none_or(|o| o.section_id != s.section_id))
        .map(|s| {
            let [x, y] = s.label_at;
            let counts = (color_by == ColorBy::State).then(|| {
                let c = state_counts(s);
                LabelCounts {
                    text: format!("{} / {}", c.sold, c.open),
                    dy: js_number(font_size * 1.2),
                }
            });
            SectionLabel {
                section_id: s.section_id.clone(),
                x: js_number(x),
                y: js_number(if counts.is_some() {
                    y - font_size * 0.6
                } else {
                    y
                }),
                font_size: js_number(font_size),
                name: s.name.clone(),
                counts,
            }
        })
        .collect()
}

/// Everything `VenueMap` (`venue-map.tsx`) draws besides its legend, toolbar buttons, and the
/// pan and zoom.
#[derive(Debug, Clone, PartialEq)]
pub struct VenueMapDrawing {
    /// The SVG's `aria-label` ([`map_label`]).
    pub label: String,
    /// The background rect's `width` and `height` (the canvas; `x` and `y` 0).
    pub width: String,
    pub height: String,
    /// The floor's `d` (`venue-map__floor`), when not `NONE`.
    pub floor: Option<String>,
    pub sections: Vec<SectionShape>,
    pub labels: Vec<SectionLabel>,
    /// "Back to map" is shown: a section on the map is open.
    pub back_to_map: bool,
    /// `p.note` ([`loading_note`]) while the open section's seats aren't loaded.
    pub loading: Option<String>,
    /// The open section's seats, once loaded (`SectionView`).
    pub seats: Option<SectionViewDrawing>,
}

/// `VenueMap` (`venue-map.tsx`): the drawing of `map` with `open_section_id` open (ignored when
/// not on the map) and `section` its loaded seats (ignored when another section's), each seat by
/// `seat_view`, the labels at `font_size`.
pub fn venue_map_drawing(
    map: &VenueMap,
    color_by: ColorBy,
    open_section_id: Option<&str>,
    section: Option<&VenueMapSection>,
    seat_view: Option<&dyn Fn(&MapSeatInfo) -> SeatView>,
    font_size: f64,
) -> VenueMapDrawing {
    let open = open_section(map, open_section_id);
    let seats = open
        .and(section)
        .filter(|s| open.is_some_and(|o| o.section_id == s.section_id));
    VenueMapDrawing {
        label: map_label(map),
        width: js_number(map.size.width as f64),
        height: js_number(map.size.height as f64),
        floor: match (&map.floor_outline, map.floor_kind) {
            (Some(f), kind) if kind != FloorKind::None => Some(outline_path(f)),
            _ => None,
        },
        sections: map
            .sections
            .iter()
            .map(|s| SectionShape {
                section_id: s.section_id.clone(),
                d: outline_path(&s.outline),
                class: section_class(map, s, color_by, open_section_id),
                name: section_name(map, s, color_by),
                current: open.is_some_and(|o| o.section_id == s.section_id),
            })
            .collect(),
        labels: section_labels(map, color_by, open_section_id, font_size),
        back_to_map: open.is_some(),
        loading: match (open, seats) {
            (Some(o), None) => Some(loading_note(&o.name)),
            _ => None,
        },
        seats: seats.map(|s| section_view(map, s, seat_view)),
    }
}

// ------------------------------------------------------------------------------ seats

/// `ShownState` (`section-view.tsx`): how a seat is shown, its state or the customer's own view
/// of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShownState {
    Open,
    Reserved,
    Sold,
    OffSale,
    Mine,
    Holding,
    Releasing,
}

impl From<SeatState> for ShownState {
    fn from(s: SeatState) -> Self {
        match s {
            SeatState::Open => Self::Open,
            SeatState::Reserved => Self::Reserved,
            SeatState::Sold => Self::Sold,
            SeatState::OffSale => Self::OffSale,
        }
    }
}

/// `STATE_TEXT` (`section-view.tsx`): a shown state as a seat's name ends.
pub fn state_text(shown: ShownState) -> &'static str {
    match shown {
        ShownState::Open => "open",
        ShownState::Reserved => "held",
        ShownState::Sold => "sold",
        ShownState::OffSale => "off sale",
        ShownState::Mine => "held by you",
        ShownState::Holding => "holding",
        ShownState::Releasing => "releasing",
    }
}

/// `MarkKind` (`legend.tsx`): a seat's mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkKind {
    Open,
    Held,
    Sold,
    Off,
    Mine,
}

impl MarkKind {
    /// The TypeScript value, as the classes name it (`venue-map__seat--off`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Held => "held",
            Self::Sold => "sold",
            Self::Off => "off",
            Self::Mine => "mine",
        }
    }
}

/// `MARK` (`section-view.tsx`): a shown state's mark.
pub fn mark_of(shown: ShownState) -> MarkKind {
    match shown {
        ShownState::Open | ShownState::Releasing => MarkKind::Open,
        ShownState::Reserved => MarkKind::Held,
        ShownState::Sold => MarkKind::Sold,
        ShownState::OffSale => MarkKind::Off,
        ShownState::Mine | ShownState::Holding => MarkKind::Mine,
    }
}

/// `SeatView` (`section-view.tsx`): how a seat is shown and whether it can be chosen; each by its
/// state when `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SeatView {
    pub shown: Option<ShownState>,
    pub disabled: Option<bool>,
}

/// `MapSeat` (`section-view.tsx`): a seat as the map hands it to `onSeat`, with the labels people
/// read, its level and price for this event, and its state as loaded. (Named apart from
/// [`MapSeat`], the contract's loaded seat.)
#[derive(Debug, Clone, PartialEq)]
pub struct MapSeatInfo {
    pub section_id: String,
    /// The section's name.
    pub section: String,
    pub row: u64,
    pub row_label: String,
    pub seat: u64,
    pub seat_label: String,
    pub level_id: String,
    /// Empty when the level is not on the map.
    pub level_name: String,
    /// This event's price for the seat's level; `None` when it has nothing on sale.
    pub price: Option<String>,
    pub state: SeatState,
    pub accessible: bool,
}

fn level_of<'a>(map: &'a VenueMap, level_id: &str) -> Option<&'a MapLevel> {
    map.levels.iter().find(|l| l.level_id == level_id)
}

/// `mapSeatOf` (`section-view.tsx`): a loaded seat as the map hands it to `onSeat`.
pub fn map_seat_of(
    map: &VenueMap,
    section: &VenueMapSection,
    row: &MapRow,
    s: &MapSeat,
) -> MapSeatInfo {
    let level = level_of(map, &s.level_id);
    MapSeatInfo {
        section_id: section.section_id.clone(),
        section: section.name.clone(),
        row: row.number,
        row_label: row.label.clone(),
        seat: s.number,
        seat_label: s.label.clone(),
        level_id: s.level_id.clone(),
        level_name: level.map(|l| l.name.clone()).unwrap_or_default(),
        price: level.and_then(|l| l.price.clone()),
        state: s.state,
        accessible: s.accessible,
    }
}

fn price_or_not(price: Option<&str>) -> String {
    price.map_or_else(|| "not on sale".into(), format_price)
}

/// `seatTip` (`section-view.tsx`, FR-019): "Sec 115, Row F, Seat 7 · Courtside · $95", shown on
/// hover and focus.
pub fn seat_tip(s: &MapSeatInfo) -> String {
    format!(
        "Sec {}, Row {}, Seat {} · {} · {}",
        s.section,
        s.row_label,
        s.seat_label,
        s.level_name,
        price_or_not(s.price.as_deref())
    )
}

/// `SeatLook` (`section-view.tsx`): how a seat is drawn and named.
#[derive(Debug, Clone, PartialEq)]
pub struct SeatLook {
    pub shown: ShownState,
    pub disabled: bool,
    /// Its mark (SC-007: states differ by shape, not color alone).
    pub kind: MarkKind,
    /// Its fill class: its level's color while its mark is open, else `venue-map--unavailable`.
    pub color: String,
    /// "Row F, Seat 7, Courtside, $95, open".
    pub name: String,
}

/// `seatLook` (`section-view.tsx`): shown by `seat_view` or by its state; disabled as
/// `seat_view` says, else unless open, mine, holding, or releasing.
pub fn seat_look(
    map: &VenueMap,
    seat: &MapSeatInfo,
    seat_view: Option<&dyn Fn(&MapSeatInfo) -> SeatView>,
) -> SeatLook {
    let view = seat_view.map(|f| f(seat)).unwrap_or_default();
    let shown = view.shown.unwrap_or(seat.state.into());
    let disabled = view.disabled.unwrap_or(!matches!(
        shown,
        ShownState::Open | ShownState::Mine | ShownState::Holding | ShownState::Releasing
    ));
    let kind = mark_of(shown);
    let color = match level_of(map, &seat.level_id) {
        Some(level) if kind == MarkKind::Open => format!("venue-map--{}", level.color),
        _ => "venue-map--unavailable".into(),
    };
    SeatLook {
        shown,
        disabled,
        kind,
        color,
        name: format!(
            "Row {}, Seat {}, {}, {}, {}",
            seat.row_label,
            seat.seat_label,
            seat.level_name,
            price_or_not(seat.price.as_deref()),
            state_text(shown)
        ),
    }
}

/// `seatSpacing` (`section-view.tsx`): the smallest positive distance between neighbouring seats
/// in any row, else 2; a seat's radius is 0.4 of it, its row labels' size 0.8.
pub fn seat_spacing(section: &VenueMapSection) -> f64 {
    let mut best = f64::INFINITY;
    for row in &section.rows {
        for pair in row.seats.windows(2) {
            let (a, b) = (pair[0].at, pair[1].at);
            let d = js_hypot(b[0] - a[0], b[1] - a[1]);
            if d > 0.0 && d < best {
                best = d;
            }
        }
    }
    if best.is_finite() { best } else { 2.0 }
}

/// The row label places (`SectionView`'s `ends`): 1.2 spacings before the first seat and past the
/// last, along the row (first to last; along x for one seat or none apart); none for no seat.
pub fn row_label_ends(row: &MapRow, spacing: f64) -> Vec<Point> {
    let (Some(first), Some(last)) = (row.seats.first(), row.seats.last()) else {
        return Vec::new();
    };
    let mut dir = [1.0, 0.0];
    if row.seats.len() > 1 {
        let dx = last.at[0] - first.at[0];
        let dy = last.at[1] - first.at[1];
        let len = js_hypot(dx, dy);
        let len = if len == 0.0 || len.is_nan() { 1.0 } else { len };
        dir = [dx / len, dy / len];
    }
    vec![
        [
            first.at[0] - dir[0] * spacing * 1.2,
            first.at[1] - dir[1] * spacing * 1.2,
        ],
        [
            last.at[0] + dir[0] * spacing * 1.2,
            last.at[1] + dir[1] * spacing * 1.2,
        ],
    ]
}

/// One element of a seat's mark (`SeatMark`, `legend.tsx`), its numbers written.
#[derive(Debug, Clone, PartialEq)]
pub enum MarkPart {
    Circle {
        class: &'static str,
        cx: String,
        cy: String,
        r: String,
    },
    Path {
        class: &'static str,
        d: String,
    },
}

fn circle(class: &'static str, x: f64, y: f64, r: f64) -> MarkPart {
    MarkPart::Circle {
        class,
        cx: js_number(x),
        cy: js_number(y),
        r: js_number(r),
    }
}

/// `SeatMark` (`legend.tsx`, research R13): open, a filled circle r; held, a hollow circle 0.8r;
/// sold, a circle 0.75r with a cross of half-size 0.45r; off sale, a clear hit circle r with a
/// dash ±0.6r; the customer's own, a circle r with a check mark.
pub fn seat_mark(kind: MarkKind, x: f64, y: f64, r: f64) -> Vec<MarkPart> {
    let n = js_number;
    match kind {
        MarkKind::Held => vec![circle(
            "venue-map__dot venue-map__dot--hollow",
            x,
            y,
            r * 0.8,
        )],
        MarkKind::Sold => {
            let d = r * 0.45;
            vec![
                circle("venue-map__dot venue-map__dot--small", x, y, r * 0.75),
                MarkPart::Path {
                    class: "venue-map__mark venue-map__mark--cross",
                    d: format!(
                        "M{} {}L{} {}M{} {}L{} {}",
                        n(x - d),
                        n(y - d),
                        n(x + d),
                        n(y + d),
                        n(x - d),
                        n(y + d),
                        n(x + d),
                        n(y - d)
                    ),
                },
            ]
        }
        MarkKind::Off => vec![
            circle("venue-map__hit", x, y, r),
            MarkPart::Path {
                class: "venue-map__mark venue-map__mark--dash",
                d: format!("M{} {}H{}", n(x - r * 0.6), n(y), n(x + r * 0.6)),
            },
        ],
        MarkKind::Mine => vec![
            circle("venue-map__dot", x, y, r),
            MarkPart::Path {
                class: "venue-map__mark venue-map__mark--check",
                d: format!(
                    "M{} {}L{} {}L{} {}",
                    n(x - r * 0.45),
                    n(y),
                    n(x - r * 0.1),
                    n(y + r * 0.35),
                    n(x + r * 0.5),
                    n(y - r * 0.35)
                ),
            },
        ],
        MarkKind::Open => vec![circle("venue-map__dot", x, y, r)],
    }
}

/// One seat's `<g role="button" tabindex="0">` in the open section.
#[derive(Debug, Clone, PartialEq)]
pub struct SeatShape {
    /// What `onSeat` is handed (when not `disabled`).
    pub seat: MapSeatInfo,
    /// `aria-label` ([`SeatLook::name`]).
    pub name: String,
    /// `class`: `venue-map__seat venue-map__seat--{kind} {color}`.
    pub class: String,
    /// `aria-pressed`: shown as mine or holding.
    pub pressed: bool,
    /// `aria-disabled="true"` (absent otherwise); a click does nothing.
    pub disabled: bool,
    /// The tip on hover and focus ([`seat_tip`]).
    pub tip: String,
    /// The mark inside the `g`.
    pub marks: Vec<MarkPart>,
}

/// One row's `<g class="venue-map__row">`.
#[derive(Debug, Clone, PartialEq)]
pub struct RowShape {
    pub number: u64,
    /// The row labels' text.
    pub label: String,
    /// The row labels' `font-size`: 0.8 × the spacing.
    pub font_size: String,
    /// Each row label's `x` and `y` (`venue-map__row-label`), before the seats.
    pub label_ends: Vec<(String, String)>,
    pub seats: Vec<SeatShape>,
}

/// `SectionView`'s `<g class="venue-map__seats">`.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionViewDrawing {
    pub rows: Vec<RowShape>,
}

/// `SectionView` (`section-view.tsx`, FR-018, FR-019): the open section's seats, each in its
/// place with radius 0.4 × [`seat_spacing`], row labels at both ends of each row.
pub fn section_view(
    map: &VenueMap,
    section: &VenueMapSection,
    seat_view: Option<&dyn Fn(&MapSeatInfo) -> SeatView>,
) -> SectionViewDrawing {
    let spacing = seat_spacing(section);
    let r = spacing * 0.4;
    SectionViewDrawing {
        rows: section
            .rows
            .iter()
            .map(|row| RowShape {
                number: row.number,
                label: row.label.clone(),
                font_size: js_number(spacing * 0.8),
                label_ends: row_label_ends(row, spacing)
                    .into_iter()
                    .map(|[x, y]| (js_number(x), js_number(y)))
                    .collect(),
                seats: row
                    .seats
                    .iter()
                    .map(|s| {
                        let seat = map_seat_of(map, section, row, s);
                        let look = seat_look(map, &seat, seat_view);
                        SeatShape {
                            name: look.name,
                            class: format!(
                                "venue-map__seat venue-map__seat--{} {}",
                                look.kind.as_str(),
                                look.color
                            ),
                            pressed: matches!(look.shown, ShownState::Mine | ShownState::Holding),
                            disabled: look.disabled,
                            tip: seat_tip(&seat),
                            marks: seat_mark(look.kind, s.at[0], s.at[1], r),
                            seat,
                        }
                    })
                    .collect(),
            })
            .collect(),
    }
}

// ------------------------------------------------------------------------------ legend

/// The note under the admin's legend of section fills (`legend.tsx`).
pub const LEGEND_NOTE: &str = "Sections show sold / open seats.";

/// One `li.venue-map-legend__item` of a list with a swatch: the `span`'s class, then the text.
#[derive(Debug, Clone, PartialEq)]
pub struct LegendItem {
    /// `level-swatch level-swatch--{color}` or `level-swatch state-swatch--{state}`.
    pub swatch_class: String,
    pub text: String,
}

/// One item of the "Seat states" list: a 16 × 16 `svg.venue-map-legend__mark` (`viewBox="-1 -1
/// 2 2"`) holding `<g class="{group_class}">` with the mark at 0, 0, r 0.8, then the name.
#[derive(Debug, Clone, PartialEq)]
pub struct LegendMark {
    pub kind: MarkKind,
    /// `venue-map__seat--{kind}`.
    pub group_class: String,
    pub name: &'static str,
    pub marks: Vec<MarkPart>,
}

/// `Legend` (`legend.tsx`), in order: `ul[aria-label="Price levels"]` (by price), or
/// `ul[aria-label="Sections"]` and `p.venue-map-legend__note` (by state); then
/// `ul[aria-label="Seat states"]`.
#[derive(Debug, Clone, PartialEq)]
pub struct LegendData {
    pub price_levels: Option<Vec<LegendItem>>,
    pub sections: Option<Vec<LegendItem>>,
    pub note: Option<&'static str>,
    pub seat_states: Vec<LegendMark>,
}

/// A level in the legend (`legend.tsx`): "Courtside $95", or "Upper: not on sale".
pub fn price_level_text(level: &MapLevel) -> String {
    match &level.price {
        None => format!("{}: not on sale", level.name),
        Some(p) => format!("{} {}", level.name, format_price(p)),
    }
}

/// `Legend` (`legend.tsx`, FR-016, FR-019, FR-027).
pub fn legend(map: &VenueMap, color_by: ColorBy) -> LegendData {
    let priced = color_by == ColorBy::Price;
    let mut states = vec![
        (MarkKind::Open, "Open"),
        (MarkKind::Held, "Held"),
        (MarkKind::Sold, "Sold"),
        (MarkKind::Off, "Off sale"),
    ];
    if priced {
        states.push((MarkKind::Mine, "Your seats"));
    }
    LegendData {
        price_levels: priced.then(|| {
            map.levels
                .iter()
                .map(|l| LegendItem {
                    swatch_class: format!("level-swatch level-swatch--{}", l.color),
                    text: price_level_text(l),
                })
                .collect()
        }),
        sections: (!priced).then(|| {
            SECTION_STATES
                .iter()
                .map(|(kind, name)| LegendItem {
                    swatch_class: format!("level-swatch state-swatch--{}", kind.as_str()),
                    text: (*name).into(),
                })
                .collect()
        }),
        note: (!priced).then_some(LEGEND_NOTE),
        seat_states: states
            .into_iter()
            .map(|(kind, name)| LegendMark {
                kind,
                group_class: format!("venue-map__seat--{}", kind.as_str()),
                name,
                marks: seat_mark(kind, 0.0, 0.0, 0.8),
            })
            .collect(),
    }
}

// ------------------------------------------------------------------------------ Sections list

/// `openPrices` (`sections-list.tsx`): "$60–$95" (or "$35"), the prices of a section's open
/// seats, low to high; `None` if none.
pub fn open_prices(map: &VenueMap, s: &MapSectionSummary) -> Option<String> {
    let mut prices: Vec<&str> = s
        .counts
        .iter()
        .filter(|c| c.open > 0)
        .filter_map(|c| level_of(map, &c.level_id).and_then(|l| l.price.as_deref()))
        .collect();
    if prices.is_empty() {
        return None;
    }
    prices.sort_by_key(|p| price_cents(p).unwrap_or(0));
    let low = format_price(prices[0]);
    let high = format_price(prices[prices.len() - 1]);
    Some(if low == high {
        low
    } else {
        format!("{low}–{high}")
    })
}

/// One section's `<li><button type="button">` in the Sections list.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionsListRow {
    pub section_id: String,
    /// `aria-label`: "Section 115, $60–$95, 2 open seats", or "Section 301, no open seats".
    pub name: String,
    /// `span.sections-list__name`: "Section 115".
    pub title: String,
    /// `span.sections-list__prices`, when it has open seats with a price.
    pub prices: Option<String>,
    /// `span.sections-list__count`: "2 open seats", or "no open seats".
    pub count: String,
    /// `aria-pressed`, and `span.sections-list__shown` "On the map" (`aria-hidden`).
    pub chosen: bool,
    /// `class`: `sections-list__section`, `--faded` with no prices, `--chosen` when chosen.
    pub class: String,
}

impl SectionsListRow {
    /// What a click asks `onOpenSection` for: this section, or the whole map when it is chosen.
    pub fn on_choose(&self) -> Option<&str> {
        (!self.chosen).then_some(self.section_id.as_str())
    }
}

/// `SectionsList` (`sections-list.tsx`, FR-020): every section, the open one chosen.
pub fn sections_list_rows(map: &VenueMap, open_section_id: Option<&str>) -> Vec<SectionsListRow> {
    let open = open_section(map, open_section_id);
    map.sections
        .iter()
        .map(|s| {
            let n = open_seats_in(map, s);
            let prices = open_prices(map, s).filter(|_| n > 0);
            let (name, count) = match &prices {
                Some(p) => {
                    let count = plural(n, "open seat", "open seats");
                    (format!("Section {}, {p}, {count}", s.name), count)
                }
                None => (
                    format!("Section {}, no open seats", s.name),
                    "no open seats".to_string(),
                ),
            };
            let chosen = open.is_some_and(|o| o.section_id == s.section_id);
            let mut class = "sections-list__section".to_string();
            if prices.is_none() {
                class.push_str(" sections-list__section--faded");
            }
            if chosen {
                class.push_str(" sections-list__section--chosen");
            }
            SectionsListRow {
                section_id: s.section_id.clone(),
                name,
                title: format!("Section {}", s.name),
                prices,
                count,
                chosen,
                class,
            }
        })
        .collect()
}

// ------------------------------------------------------------------------------ layout preview

/// `PreviewLayout['size']` (`layout-preview.tsx`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PreviewSize {
    pub width: f64,
    pub height: f64,
}

/// A section of `PreviewLayout` (`layout-preview.tsx`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSection {
    pub id: String,
    pub name: String,
    pub outline: Vec<Point>,
    pub label_at: Point,
}

/// `PreviewLayout` (`layout-preview.tsx`): what a preview draws of a layout (a `LayoutDetail`
/// has all of it, [`From`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayout {
    pub name: String,
    pub size: PreviewSize,
    pub floor_kind: FloorKind,
    pub floor_outline: Option<Vec<Point>>,
    pub sections: Vec<PreviewSection>,
}

fn points(o: &types::MapOutline) -> Vec<Point> {
    o.iter().map(|p| [p.0.0, p.0.1]).collect()
}

impl From<&types::LayoutDetail> for PreviewLayout {
    fn from(d: &types::LayoutDetail) -> Self {
        Self {
            name: d.name.to_string(),
            size: PreviewSize {
                width: d.size.width.get() as f64,
                height: d.size.height.get() as f64,
            },
            floor_kind: d.floor_kind,
            floor_outline: d.floor_outline.as_ref().map(points),
            sections: d
                .sections
                .iter()
                .map(|s| PreviewSection {
                    id: s.id.to_string(),
                    name: s.name.to_string(),
                    outline: points(&s.outline),
                    label_at: [s.label_at.0.0, s.label_at.0.1],
                })
                .collect(),
        }
    }
}

/// One section of the preview: `<g>` with `path.layout-preview__section` and
/// `text.layout-preview__label` (`aria-hidden`).
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewSectionShape {
    pub id: String,
    /// The path's `d`.
    pub d: String,
    /// The label's `x` and `y` (its `labelAt`).
    pub x: String,
    pub y: String,
    pub name: String,
}

/// What `LayoutPreview` (`layout-preview.tsx`, M6) draws in its `<svg role="img"
/// class="layout-preview" preserveAspectRatio="xMidYMid meet">`.
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutPreviewDrawing {
    /// `aria-label`: "Basketball: 54 sections" ("1 section").
    pub label: String,
    /// `viewBox`: the whole canvas, "0 0 {width} {height}".
    pub view_box: String,
    /// `path.layout-preview__floor`'s `d`, when not `NONE`.
    pub floor: Option<String>,
    /// Every label's `font-size`: max(width, height) / 50.
    pub font_size: String,
    pub sections: Vec<PreviewSectionShape>,
}

/// `LayoutPreview` (`layout-preview.tsx`, FR-007): a layout's sections in place with their
/// names, and its floor, never its seats.
pub fn layout_preview(layout: &PreviewLayout) -> LayoutPreviewDrawing {
    let n = layout.sections.len();
    let PreviewSize { width, height } = layout.size;
    LayoutPreviewDrawing {
        label: format!(
            "{}: {n} {}",
            layout.name,
            if n == 1 { "section" } else { "sections" }
        ),
        view_box: format!("0 0 {} {}", js_number(width), js_number(height)),
        floor: match (&layout.floor_outline, layout.floor_kind) {
            (Some(f), kind) if kind != FloorKind::None => Some(outline_path(f)),
            _ => None,
        },
        font_size: js_number(js_max([width, height]) / 50.0),
        sections: layout
            .sections
            .iter()
            .map(|s| PreviewSectionShape {
                id: s.id.clone(),
                d: outline_path(&s.outline),
                x: js_number(s.label_at[0]),
                y: js_number(s.label_at[1]),
                name: s.name.clone(),
            })
            .collect(),
    }
}

// ------------------------------------------------------------------------------ Seating card

/// The Seating card's note for an event without a layout (`EventSeatMap.tsx`).
pub const GENERAL_ADMISSION: &str = "General admission.";
/// `p.loading` while there is no map yet (`EventSeatMap.tsx`).
pub const LOADING_SEAT_MAP: &str = "Loading the seat map…";
/// `p.note` when no map could be had (`EventSeatMap.tsx`).
pub const SEAT_MAP_UNAVAILABLE: &str = "The seat map is unavailable right now.";
/// `p.note` while the stream reconnects with a map shown (`EventSeatMap.tsx`).
pub const RECONNECTING_NOTE: &str = "Reconnecting: the map may be behind for a moment.";

/// `EventSeatMap`'s `seated` (`EventSeatMap.tsx`): a layout is set, or the event is reserved
/// seating.
pub fn is_seated(has_layout_id: bool, reserved_seating: bool) -> bool {
    has_layout_id || reserved_seating
}

/// `EventSeatMap`'s `total` (`EventSeatMap.tsx`): the event's seats by state over every section
/// and level, each count clamped at 0.
pub fn seat_totals(map: &VenueMap) -> StateCounts {
    let mut c = StateCounts::default();
    for s in &map.sections {
        c.add(s);
    }
    c
}

/// The Seating card's totals line (`EventSeatMap.tsx`): "1 sold, 1 held, 67 open, 1 off sale".
pub fn totals_line(map: &VenueMap) -> String {
    let c = seat_totals(map);
    format!(
        "{} sold, {} held, {} open, {} off sale",
        c.sold, c.held, c.open, c.off_sale
    )
}

/// What the Seating card (`EventSeatMap.tsx`, M12) shows under its heading and, when seated, its
/// note with the "Edit event" and "attendee list" links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeatingCard {
    /// [`GENERAL_ADMISSION`]: no map read, no stream.
    GeneralAdmission,
    /// [`LOADING_SEAT_MAP`].
    Loading,
    /// [`SEAT_MAP_UNAVAILABLE`].
    Unavailable,
    /// The totals line ([`totals_line`]), [`RECONNECTING_NOTE`] when reconnecting, then the map
    /// by state, read-only, with [`kept_open_section`] open.
    Map { totals: String, reconnecting: bool },
}

/// `EventSeatMap` (`EventSeatMap.tsx`): the card by whether it is seated, the stream's status,
/// and the map.
pub fn seating_card(seated: bool, status: LiveSeatStatus, map: Option<&VenueMap>) -> SeatingCard {
    if !seated {
        return SeatingCard::GeneralAdmission;
    }
    match map {
        None if matches!(status, LiveSeatStatus::Loading | LiveSeatStatus::Connecting) => {
            SeatingCard::Loading
        }
        None => SeatingCard::Unavailable,
        Some(map) => SeatingCard::Map {
            totals: totals_line(map),
            reconnecting: status == LiveSeatStatus::Reconnecting,
        },
    }
}

/// The Seating card's open section (`EventSeatMap.tsx`): a section gone from a new map is
/// closed.
pub fn kept_open_section<'a>(map: &VenueMap, open: Option<&'a str>) -> Option<&'a str> {
    open.filter(|id| map.sections.iter().any(|s| s.section_id == *id))
}
