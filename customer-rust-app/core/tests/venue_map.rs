// Copied from admin-rust-app/core/tests/venue_map.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R13 (T059): the venue map's drawing data, ported from
//! `packages/shared/test/venue-map/venue-map.test.tsx`, `sections-list.test.tsx`,
//! `layout-preview.test.tsx`, and `admin-app/test/event-seat-map.test.tsx` (parity M6, M12–M15),
//! their rendering cases as cases of what `customer_rust_core::seating::venue_map` hands the Leptos
//! views. Then parity: the React components themselves, rendered by
//! `scripts/venue-map-parity-fixtures.mjs` into `tests/fixtures/venue_map/`, must draw the same
//! elements, attribute for attribute, as the views draw from this data.

use std::{collections::BTreeMap, fs, path::PathBuf};

use customer_rust_core::api::seat_stream::LiveSeatStatus;
use customer_rust_core::seating::map_geometry::{Point, js_number, outline_path};
use customer_rust_core::seating::map_state::{
    LevelSeatCounts, MapAction, MapSectionSummary, MapState, SeatMapChange, SeatState,
    SeatStateChange, VenueMap, VenueMapSection, map_reducer,
};
use customer_rust_core::seating::pan_zoom::{label_font_size, view_box, zoom_by, zoom_of};
use customer_rust_core::seating::venue_map::{
    ColorBy, GENERAL_ADMISSION, LEGEND_NOTE, LOADING_SEAT_MAP, LayoutPreviewDrawing, LegendData,
    MapSeatInfo, MarkKind, MarkPart, PreviewLayout, RECONNECTING_NOTE, SEAT_MAP_UNAVAILABLE,
    SECTION_STATES, SeatView, SeatingCard, SectionState, SectionViewDrawing, SectionsListRow,
    ShownState, StateCounts, VenueMapDrawing, fit_of_map, is_seated, kept_open_section,
    layout_preview, legend, loading_note, map_label, map_seat_of, open_prices, open_section,
    row_label_ends, seat_look, seat_mark, seat_spacing, seat_tip, seat_totals, seating_card,
    section_class, section_name, section_state, section_view, sections_list_rows, state_counts,
    totals_line, venue_map_drawing,
};
use serde::Deserialize;
use serde_json::Value;

// ------------------------------------------------------------------------------ support

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/venue_map")
        .join(name);
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {name}: {e}"))
}

fn case<'a>(cases: &'a Value, name: &str) -> &'a Value {
    cases
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("no case {name}"))
}

fn map_of(v: &Value) -> VenueMap {
    serde_json::from_value(v.clone()).expect("a venue map")
}

fn section_of(v: &Value) -> Option<VenueMapSection> {
    (!v.is_null()).then(|| serde_json::from_value(v.clone()).expect("a section"))
}

/// venue-map.test.tsx's `MAP` (Basketball) and `SECTION_115`, from the fixture's first cases.
fn basketball() -> (VenueMap, VenueMapSection) {
    let cases = fixture("venue-map.json");
    let c = case(&cases, "price, section 115 open");
    (
        map_of(&c["input"]["map"]),
        section_of(&c["input"]["section"]).unwrap(),
    )
}

/// The odd hall: fractional outlines, a level missing from the map, counts below 0.
fn odd() -> (VenueMap, VenueMapSection) {
    let cases = fixture("venue-map.json");
    let c = case(&cases, "odd, price, stalls open, every shown state");
    (
        map_of(&c["input"]["map"]),
        section_of(&c["input"]["section"]).unwrap(),
    )
}

/// event-seat-map.test.tsx's Arena (`arenaVenueMap` with its `STATES`) and Floor A's seats.
fn arena() -> (VenueMap, VenueMapSection) {
    let cases = fixture("venue-map.json");
    let c = case(&cases, "admin arena, Floor A open");
    (
        map_of(&c["input"]["map"]),
        section_of(&c["input"]["section"]).unwrap(),
    )
}

fn summary<'a>(map: &'a VenueMap, name: &str) -> &'a MapSectionSummary {
    map.sections.iter().find(|s| s.name == name).unwrap()
}

/// A seat view, boxed.
type SeatViewFn = Box<dyn Fn(&MapSeatInfo) -> SeatView>;

/// The fixture script's seat views, by name.
fn seat_view_named(name: &str) -> Option<SeatViewFn> {
    match name {
        "none" => None,
        "readOnly" => Some(Box::new(|_| SeatView {
            shown: None,
            disabled: Some(true),
        })),
        "mine11" => Some(Box::new(|s| {
            if s.row == 1 && s.seat == 11 {
                SeatView {
                    shown: Some(ShownState::Mine),
                    disabled: Some(false),
                }
            } else {
                SeatView::default()
            }
        })),
        "cycle" => Some(Box::new(|s| {
            let (shown, disabled) = match s.seat % 8 {
                0 => (Some(ShownState::Holding), None),
                1 => (Some(ShownState::Releasing), None),
                2 => (Some(ShownState::Mine), Some(true)),
                3 => (Some(ShownState::Open), Some(true)),
                4 => (Some(ShownState::Sold), Some(false)),
                5 => (Some(ShownState::OffSale), None),
                6 => (Some(ShownState::Reserved), None),
                _ => (None, None),
            };
            SeatView { shown, disabled }
        })),
        other => panic!("no seat view {other}"),
    }
}

fn read_only() -> impl Fn(&MapSeatInfo) -> SeatView {
    |_| SeatView {
        shown: None,
        disabled: Some(true),
    }
}

/// The overview's drawing at zoom 1 with no section open.
fn overview(map: &VenueMap, color_by: ColorBy) -> VenueMapDrawing {
    let fs = label_font_size(&fit_of_map(map), 1.0);
    venue_map_drawing(map, color_by, None, None, None, fs)
}

fn shape<'a>(
    d: &'a VenueMapDrawing,
    name: &str,
) -> &'a customer_rust_core::seating::venue_map::SectionShape {
    d.sections
        .iter()
        .find(|s| s.name.starts_with(&format!("Section {name},")))
        .unwrap_or_else(|| panic!("no section {name}"))
}

fn seats(d: &SectionViewDrawing) -> Vec<&customer_rust_core::seating::venue_map::SeatShape> {
    d.rows.iter().flat_map(|r| r.seats.iter()).collect()
}

fn seat_named<'a>(
    d: &'a SectionViewDrawing,
    name: &str,
) -> &'a customer_rust_core::seating::venue_map::SeatShape {
    seats(d)
        .into_iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("no seat {name}"))
}

fn has_class(class: &str, want: &str) -> bool {
    class.split(' ').any(|c| c == want)
}

fn mark_classes(marks: &[MarkPart]) -> Vec<&'static str> {
    marks
        .iter()
        .map(|m| match m {
            MarkPart::Circle { class, .. } | MarkPart::Path { class, .. } => *class,
        })
        .collect()
}

// ------------------------------------------------------------------------------ the overview

#[test]
fn overview_draws_every_section_filled_by_its_cheapest_open_level_and_the_floor() {
    let (map, _) = basketball();
    let d = overview(&map, ColorBy::Price);
    assert_eq!(d.label, "Basketball map");
    assert_eq!(map_label(&map), "Basketball map");
    // 115: Courtside $95 and Lower sideline $60 open; the cheaper one colors it.
    let s115 = shape(&d, "115");
    assert_eq!(s115.class, "venue-map__section venue-map--blue");
    assert_eq!(s115.name, "Section 115, 2 open seats from $60");
    assert_eq!(shape(&d, "101").class, "venue-map__section venue-map--teal");
    // 301: nothing on sale, gray.
    let s301 = shape(&d, "301");
    assert!(has_class(&s301.class, "venue-map--unavailable"));
    assert_eq!(s301.name, "Section 301, no open seats");
    let names: Vec<&str> = d.labels.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names, ["115", "101", "301"]);
    assert_eq!(
        d.floor.as_deref(),
        Some("M400 260L600 260L600 380L400 380Z")
    );
    assert_eq!((d.width.as_str(), d.height.as_str()), ("1000", "640"));
}

#[test]
fn overview_never_draws_a_seat() {
    let (map, section) = basketball();
    let d = overview(&map, ColorBy::Price);
    assert!(d.seats.is_none());
    assert!(!d.back_to_map);
    assert!(d.loading.is_none());
    // A section loaded but not open draws nothing either.
    let fs = label_font_size(&fit_of_map(&map), 1.0);
    let d = venue_map_drawing(&map, ColorBy::Price, None, Some(&section), None, fs);
    assert!(d.seats.is_none());
}

#[test]
fn legend_names_each_level_with_its_color_and_price_and_each_seat_state() {
    let (map, _) = basketball();
    let LegendData {
        price_levels,
        sections,
        note,
        seat_states,
    } = legend(&map, ColorBy::Price);
    let levels = price_levels.unwrap();
    let texts: Vec<&str> = levels.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "Courtside $95",
            "Lower sideline $60",
            "Lower end $35",
            "Upper: not on sale"
        ]
    );
    assert_eq!(levels[0].swatch_class, "level-swatch level-swatch--violet");
    assert_eq!(levels[2].swatch_class, "level-swatch level-swatch--teal");
    assert!(sections.is_none());
    assert!(note.is_none());
    let states: Vec<&str> = seat_states.iter().map(|s| s.name).collect();
    assert_eq!(states, ["Open", "Held", "Sold", "Off sale", "Your seats"]);
}

#[test]
fn no_price_filter_every_section_drawn_fading_only_one_with_no_open_seat_on_sale() {
    let (map, _) = basketball();
    let d = overview(&map, ColorBy::Price);
    assert_eq!(d.sections.len(), 3);
    assert!(!has_class(
        &shape(&d, "101").class,
        "venue-map__section--faded"
    ));
    assert!(!has_class(
        &shape(&d, "115").class,
        "venue-map__section--faded"
    ));
    let c = &shape(&d, "301").class;
    assert!(has_class(c, "venue-map__section--faded") && has_class(c, "venue-map--unavailable"));
    for item in legend(&map, ColorBy::Price).price_levels.unwrap() {
        assert!(!item.text.contains("outside"));
    }
}

// ------------------------------------------------------------------------------ a section open

fn open_115(seat_view: Option<&dyn Fn(&MapSeatInfo) -> SeatView>) -> VenueMapDrawing {
    let (map, section) = basketball();
    let fs = label_font_size(&fit_of_map(&map), 1.0);
    venue_map_drawing(
        &map,
        ColorBy::Price,
        Some("s-115"),
        Some(&section),
        seat_view,
        fs,
    )
}

#[test]
fn a_section_open_has_back_to_map_its_seats_and_no_label() {
    let d = open_115(None);
    assert!(d.back_to_map);
    let seats_drawn = d.seats.as_ref().unwrap();
    seat_named(seats_drawn, "Row F, Seat 7, Courtside, $95, open");
    // The open section is current, and its label is not drawn.
    let s115 = shape(&d, "115");
    assert!(s115.current);
    assert!(has_class(&s115.class, "venue-map__section--current"));
    assert!(d.sections.iter().filter(|s| s.current).count() == 1);
    assert!(d.labels.iter().all(|l| l.section_id != "s-115"));
}

#[test]
fn draws_only_that_sections_seats_with_row_labels_at_both_ends() {
    let d = open_115(None);
    let drawn = d.seats.as_ref().unwrap();
    assert_eq!(seats(drawn).len(), 6);
    let labels: Vec<&str> = drawn
        .rows
        .iter()
        .flat_map(|r| r.label_ends.iter().map(|_| r.label.as_str()))
        .collect();
    assert_eq!(labels, ["F", "F", "P", "P"]);
}

#[test]
fn each_state_has_a_mark_and_a_name_not_only_a_color() {
    let mine = |s: &MapSeatInfo| {
        if s.row == 1 && s.seat == 11 {
            SeatView {
                shown: Some(ShownState::Mine),
                disabled: Some(false),
            }
        } else {
            SeatView::default()
        }
    };
    let d = open_115(Some(&mine));
    let drawn = d.seats.as_ref().unwrap();
    let open = seat_named(drawn, "Row F, Seat 7, Courtside, $95, open");
    assert!(
        has_class(&open.class, "venue-map__seat--open")
            && has_class(&open.class, "venue-map--violet")
    );
    assert!(!open.disabled);
    let held = seat_named(drawn, "Row F, Seat 8, Courtside, $95, held");
    assert!(has_class(&held.class, "venue-map__seat--held"));
    assert!(mark_classes(&held.marks).contains(&"venue-map__dot venue-map__dot--hollow"));
    assert!(held.disabled);
    let sold = seat_named(drawn, "Row F, Seat 9, Courtside, $95, sold");
    assert!(has_class(&sold.class, "venue-map__seat--sold"));
    assert!(mark_classes(&sold.marks).contains(&"venue-map__mark venue-map__mark--cross"));
    let off = seat_named(drawn, "Row F, Seat 10, Courtside, $95, off sale");
    assert!(has_class(&off.class, "venue-map__seat--off"));
    assert!(mark_classes(&off.marks).contains(&"venue-map__mark venue-map__mark--dash"));
    let yours = seat_named(drawn, "Row F, Seat 11, Courtside, $95, held by you");
    assert!(has_class(&yours.class, "venue-map__seat--mine"));
    assert!(mark_classes(&yours.marks).contains(&"venue-map__mark venue-map__mark--check"));
    assert!(yours.pressed);
    assert!(!open.pressed);
}

#[test]
fn a_seats_tip_says_its_section_row_seat_level_and_price() {
    let d = open_115(None);
    let drawn = d.seats.as_ref().unwrap();
    assert_eq!(
        seat_named(drawn, "Row F, Seat 7, Courtside, $95, open").tip,
        "Sec 115, Row F, Seat 7 · Courtside · $95"
    );
    assert_eq!(
        seat_named(drawn, "Row P, Seat 7, Lower sideline, $60, open").tip,
        "Sec 115, Row P, Seat 7 · Lower sideline · $60"
    );
}

#[test]
fn the_seat_handed_to_on_seat_and_which_can_be_chosen() {
    let (map, section) = basketball();
    let row = &section.rows[0];
    let s = map_seat_of(&map, &section, row, &row.seats[0]);
    assert_eq!(
        s,
        MapSeatInfo {
            section_id: "s-115".into(),
            section: "115".into(),
            row: 1,
            row_label: "F".into(),
            seat: 7,
            seat_label: "7".into(),
            level_id: "l-court".into(),
            level_name: "Courtside".into(),
            price: Some("95.00".into()),
            state: SeatState::Open,
            accessible: false,
        }
    );
    // Open seats can be chosen; held and sold ones can't (aria-disabled, click does nothing).
    assert!(!seat_look(&map, &s, None).disabled);
    let held = map_seat_of(&map, &section, row, &row.seats[1]);
    let sold = map_seat_of(&map, &section, row, &row.seats[2]);
    assert!(seat_look(&map, &held, None).disabled);
    assert!(seat_look(&map, &sold, None).disabled);
}

#[test]
fn section_view_is_the_open_sections_seats() {
    let (map, section) = basketball();
    let d = section_view(&map, &section, None);
    assert_eq!(Some(&d), open_115(None).seats.as_ref());
    let rows: Vec<(u64, &str, &str)> = d
        .rows
        .iter()
        .map(|r| (r.number, r.label.as_str(), r.font_size.as_str()))
        .collect();
    assert_eq!(rows, [(1, "F", "1.6"), (2, "P", "1.6")]);
    assert_eq!(d.rows[0].seats[0].seat.seat, 7);
}

#[test]
fn says_the_seats_are_loading_until_they_come() {
    let (map, section) = basketball();
    let fs = label_font_size(&fit_of_map(&map), 1.0);
    let d = venue_map_drawing(&map, ColorBy::Price, Some("s-101"), None, None, fs);
    assert_eq!(
        d.loading.as_deref(),
        Some("Loading the seats of section 101…")
    );
    assert_eq!(loading_note("101"), "Loading the seats of section 101…");
    assert!(d.seats.is_none());
    // Another section's seats loaded: still loading this one.
    let d = venue_map_drawing(
        &map,
        ColorBy::Price,
        Some("s-101"),
        Some(&section),
        None,
        fs,
    );
    assert!(d.loading.is_some() && d.seats.is_none());
    // An open id not on the map opens nothing.
    let d = venue_map_drawing(
        &map,
        ColorBy::Price,
        Some("s-gone"),
        Some(&section),
        None,
        fs,
    );
    assert!(d.loading.is_none() && d.seats.is_none() && !d.back_to_map);
    assert!(open_section(&map, Some("s-gone")).is_none());
    assert_eq!(open_section(&map, Some("s-101")).unwrap().name, "101");
    assert!(open_section(&map, None).is_none());
}

// ------------------------------------------------------------------------------ zoom

#[test]
fn fits_what_is_drawn() {
    let (map, _) = basketball();
    let fit = fit_of_map(&map);
    assert_eq!(view_box(&fit), "80 20 540 440");
    let mut no_floor = map.clone();
    no_floor.floor_kind = customer_rust_core::seating::map_state::FloorKind::None;
    let mut no_outline = map.clone();
    no_outline.floor_outline = None;
    assert_eq!(fit_of_map(&no_floor), fit_of_map(&no_outline));
    let mut empty = no_floor.clone();
    empty.sections.clear();
    assert_eq!(view_box(&fit_of_map(&empty)), "0 0 1000 640");
}

// ------------------------------------------------------------------------------ by state (FR-027)

#[test]
fn by_state_names_each_sections_counts() {
    let (map, _) = basketball();
    let d = overview(&map, ColorBy::State);
    let s115 = shape(&d, "115");
    assert_eq!(s115.name, "Section 115, 2 open, 2 held, 1 sold, 1 off sale");
    assert!(has_class(&s115.class, "venue-map__section--state"));
    let l = legend(&map, ColorBy::State);
    assert!(l.price_levels.is_none());
    let states: Vec<&str> = l.seat_states.iter().map(|s| s.name).collect();
    assert_eq!(states, ["Open", "Held", "Sold", "Off sale"]);
}

fn made(name: &str, c: LevelSeatCounts) -> MapSectionSummary {
    let (map, _) = basketball();
    MapSectionSummary {
        section_id: format!("s-{name}"),
        name: name.into(),
        counts: vec![c],
        ..map.sections[1].clone()
    }
}

fn counts(level_id: &str, open: i64, reserved: i64, sold: i64, off_sale: i64) -> LevelSeatCounts {
    LevelSeatCounts {
        level_id: level_id.into(),
        open,
        reserved,
        sold,
        off_sale,
    }
}

#[test]
fn fills_each_section_by_its_make_up_of_seat_states_as_the_legend_names_them() {
    let (mut map, _) = basketball();
    map.sections = vec![
        made("A", counts("l-court", 1, 2, 1, 1)),
        made("B", counts("l-court", 0, 1, 3, 0)),
        made("C", counts("l-court", 0, 0, 3, 1)),
        made("D", counts("l-upper", 0, 0, 0, 4)),
    ];
    let d = overview(&map, ColorBy::State);
    for (name, state) in [("A", "open"), ("B", "held"), ("C", "sold"), ("D", "off")] {
        assert!(has_class(
            &shape(&d, name).class,
            &format!("venue-map__section--state-{state}")
        ));
    }
    assert_eq!(section_state(&map.sections[0]), SectionState::Open);
    assert_eq!(section_state(&map.sections[1]), SectionState::Held);
    assert_eq!(section_state(&map.sections[2]), SectionState::Sold);
    assert_eq!(section_state(&map.sections[3]), SectionState::Off);
    let l = legend(&map, ColorBy::State);
    let items = l.sections.unwrap();
    let texts: Vec<&str> = items.iter().map(|i| i.text.as_str()).collect();
    assert_eq!(
        texts,
        ["Seats open", "None open, some held", "Sold out", "Off sale"]
    );
    for (i, kind) in ["open", "held", "sold", "off"].iter().enumerate() {
        assert_eq!(
            items[i].swatch_class,
            format!("level-swatch state-swatch--{kind}")
        );
        assert_eq!(SECTION_STATES[i].0.as_str(), *kind);
    }
    // Not on the customer's map.
    assert!(legend(&map, ColorBy::Price).sections.is_none());
}

#[test]
fn shows_each_sections_sold_over_open_under_its_name() {
    let (map, _) = basketball();
    let d = overview(&map, ColorBy::State);
    let counts: Vec<&str> = d
        .labels
        .iter()
        .map(|l| l.counts.as_ref().unwrap().text.as_str())
        .collect();
    assert_eq!(counts, ["1 / 2", "0 / 3", "0 / 0"]);
    assert_eq!(legend(&map, ColorBy::State).note, Some(LEGEND_NOTE));
    assert_eq!(LEGEND_NOTE, "Sections show sold / open seats.");
    // Not on the customer's map.
    let d = overview(&map, ColorBy::Price);
    assert!(d.labels.iter().all(|l| l.counts.is_none()));
    assert!(legend(&map, ColorBy::Price).note.is_none());
}

#[test]
fn state_counts_clamp_each_level_and_count_levels_not_on_the_map() {
    let (map, _) = odd();
    // Left Box: Box 2 open, -1 held, 3 sold; Stalls -2 open, 1 held, 1 off sale.
    assert_eq!(
        state_counts(summary(&map, "Left Box")),
        StateCounts {
            open: 2,
            held: 1,
            sold: 3,
            off_sale: 1
        }
    );
    // Stalls counts a level missing from the map (9 open); the price name does not.
    assert_eq!(state_counts(summary(&map, "Stalls")).open, 15);
    assert_eq!(
        section_name(&map, summary(&map, "Stalls"), ColorBy::Price),
        "Section Stalls, 6 open seats from $0.99"
    );
    assert_eq!(
        section_name(&map, summary(&map, "Stalls"), ColorBy::State),
        "Section Stalls, 15 open, 0 held, 7 sold, 0 off sale"
    );
    // Gallery: its open seats are in a level with no price: no open seats, held by state.
    assert_eq!(
        section_name(&map, summary(&map, "Gallery"), ColorBy::Price),
        "Section Gallery, no open seats"
    );
    assert_eq!(section_state(summary(&map, "Gallery")), SectionState::Open);
    assert_eq!(section_state(summary(&map, "Closed")), SectionState::Off);
    assert_eq!(
        section_class(&map, summary(&map, "Gallery"), ColorBy::Price, Some("o-3")),
        "venue-map__section venue-map--unavailable venue-map__section--faded venue-map__section--current"
    );
    // One open seat: singular.
    let mut one = map.clone();
    one.sections[0].counts = vec![counts("l-a", 1, 0, 0, 0)];
    assert_eq!(
        section_name(&one, &one.sections[0], ColorBy::Price),
        "Section Left Box, 1 open seat from $1,200.50"
    );
}

// ------------------------------------------------------------------------------ seats

#[test]
fn seat_look_by_shown_state() {
    let (map, section) = odd();
    let row = &section.rows[0];
    let seat = map_seat_of(&map, &section, row, &row.seats[0]);
    let look = |v: SeatView| seat_look(&map, &seat, Some(&move |_: &MapSeatInfo| v));
    let cases = [
        (
            ShownState::Open,
            false,
            MarkKind::Open,
            "venue-map--pink",
            "open",
        ),
        (
            ShownState::Releasing,
            false,
            MarkKind::Open,
            "venue-map--pink",
            "releasing",
        ),
        (
            ShownState::Reserved,
            true,
            MarkKind::Held,
            "venue-map--unavailable",
            "held",
        ),
        (
            ShownState::Sold,
            true,
            MarkKind::Sold,
            "venue-map--unavailable",
            "sold",
        ),
        (
            ShownState::OffSale,
            true,
            MarkKind::Off,
            "venue-map--unavailable",
            "off sale",
        ),
        (
            ShownState::Mine,
            false,
            MarkKind::Mine,
            "venue-map--unavailable",
            "held by you",
        ),
        (
            ShownState::Holding,
            false,
            MarkKind::Mine,
            "venue-map--unavailable",
            "holding",
        ),
    ];
    for (shown, disabled, kind, color, text) in cases {
        let l = look(SeatView {
            shown: Some(shown),
            disabled: None,
        });
        assert_eq!(l.shown, shown);
        assert_eq!(l.disabled, disabled, "{shown:?}");
        assert_eq!(l.kind, kind);
        assert_eq!(l.color, color);
        assert_eq!(l.name, format!("Row AA, Seat 101, Stalls, $60.50, {text}"));
    }
    // `disabled` given wins either way.
    assert!(
        look(SeatView {
            shown: Some(ShownState::Open),
            disabled: Some(true)
        })
        .disabled
    );
    assert!(
        !look(SeatView {
            shown: Some(ShownState::Sold),
            disabled: Some(false)
        })
        .disabled
    );
    // No view: by its state as loaded.
    let plain = seat_look(&map, &seat, None);
    assert_eq!((plain.shown, plain.disabled), (ShownState::Open, false));
    assert_eq!(ShownState::from(SeatState::OffSale), ShownState::OffSale);
    // A level missing from the map: no name, not on sale, gray even when open.
    let lost = map_seat_of(&map, &section, row, &row.seats[4]);
    assert_eq!(lost.level_name, "");
    assert_eq!(lost.price, None);
    let l = seat_look(&map, &lost, None);
    assert_eq!(l.color, "venue-map--unavailable");
    assert_eq!(l.name, "Row AA, Seat 105, , not on sale, open");
    assert_eq!(
        seat_tip(&lost),
        "Sec Stalls, Row AA, Seat 105 ·  · not on sale"
    );
}

#[test]
fn seat_spacing_is_the_smallest_positive_gap_in_any_row_else_2() {
    let (_, stalls) = odd();
    let spacing = seat_spacing(&stalls);
    // React's radius for it (0.4 × spacing), from the fixture.
    assert_eq!(js_number(spacing * 0.4), "1.32060592153753");
    let (_, s115) = basketball();
    assert_eq!(seat_spacing(&s115), 2.0);
    let cases = fixture("venue-map.json");
    let gallery =
        section_of(&case(&cases, "odd, state, gallery open")["input"]["section"]).unwrap();
    assert_eq!(seat_spacing(&gallery), 2.0);
    let mut empty = gallery.clone();
    empty.rows.clear();
    assert_eq!(seat_spacing(&empty), 2.0);
}

#[test]
fn row_labels_sit_1_2_spacings_past_the_end_seats_along_the_row() {
    let (_, s115) = basketball();
    let ends = row_label_ends(&s115.rows[0], 2.0);
    assert_eq!(ends, vec![[427.6, 410.0], [440.4, 410.0]]);
    // One seat: along x.
    assert_eq!(
        row_label_ends(&s115.rows[1], 2.0),
        vec![[427.6, 420.0], [432.4, 420.0]]
    );
    // No seat: no labels.
    let (_, stalls) = odd();
    assert!(row_label_ends(&stalls.rows[2], 2.0).is_empty());
    // Two seats in one place, the last elsewhere: along first to last.
    let ends: Vec<Point> = row_label_ends(&stalls.rows[3], 2.0);
    assert_eq!(ends.len(), 2);
}

#[test]
fn seat_marks_geometry() {
    let circle = |class: &'static str, cx: &str, cy: &str, r: &str| MarkPart::Circle {
        class,
        cx: cx.into(),
        cy: cy.into(),
        r: r.into(),
    };
    let path = |class: &'static str, d: &str| MarkPart::Path { class, d: d.into() };
    assert_eq!(
        seat_mark(MarkKind::Open, 10.0, 20.0, 1.0),
        vec![circle("venue-map__dot", "10", "20", "1")]
    );
    assert_eq!(
        seat_mark(MarkKind::Held, 10.0, 20.0, 1.0),
        vec![circle(
            "venue-map__dot venue-map__dot--hollow",
            "10",
            "20",
            "0.8"
        )]
    );
    assert_eq!(
        seat_mark(MarkKind::Sold, 10.0, 20.0, 1.0),
        vec![
            circle("venue-map__dot venue-map__dot--small", "10", "20", "0.75"),
            path(
                "venue-map__mark venue-map__mark--cross",
                "M9.55 19.55L10.45 20.45M9.55 20.45L10.45 19.55"
            ),
        ]
    );
    assert_eq!(
        seat_mark(MarkKind::Off, 10.0, 20.0, 1.0),
        vec![
            circle("venue-map__hit", "10", "20", "1"),
            path("venue-map__mark venue-map__mark--dash", "M9.4 20H10.6"),
        ]
    );
    assert_eq!(
        seat_mark(MarkKind::Mine, 10.0, 20.0, 1.0),
        vec![
            circle("venue-map__dot", "10", "20", "1"),
            path(
                "venue-map__mark venue-map__mark--check",
                "M9.55 20L9.9 20.35L10.5 19.65"
            ),
        ]
    );
    assert_eq!(MarkKind::Off.as_str(), "off");
}

// ------------------------------------------------------------------------------ Sections list

#[test]
fn sections_list_rows_name_the_price_range_of_open_seats_and_their_count() {
    let (map, _) = basketball();
    let rows = sections_list_rows(&map, None);
    let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Section 115, $60–$95, 2 open seats",
            "Section 101, $35, 3 open seats",
            "Section 301, no open seats"
        ]
    );
    assert_eq!(
        rows[0],
        SectionsListRow {
            section_id: "s-115".into(),
            name: "Section 115, $60–$95, 2 open seats".into(),
            title: "Section 115".into(),
            prices: Some("$60–$95".into()),
            count: "2 open seats".into(),
            chosen: false,
            class: "sections-list__section".into(),
        }
    );
    assert!(rows.iter().all(|r| !r.chosen));
    assert_eq!(rows[0].on_choose(), Some("s-115"));
    assert_eq!(
        rows[2].class,
        "sections-list__section sections-list__section--faded"
    );
    assert_eq!(open_prices(&map, &map.sections[2]), None);
    // Chosen: marked, and choosing it again shows the whole map.
    let rows = sections_list_rows(&map, Some("s-115"));
    assert!(rows[0].chosen && !rows[1].chosen);
    assert_eq!(
        rows[0].class,
        "sections-list__section sections-list__section--chosen"
    );
    assert_eq!(rows[0].on_choose(), None);
    assert_eq!(rows[1].on_choose(), Some("s-101"));
}

#[test]
fn open_prices_cover_only_open_priced_levels() {
    let (map, _) = odd();
    // Left Box: Box 2 open at $1,200.50; Stalls -2 open does not count.
    assert_eq!(
        open_prices(&map, summary(&map, "Left Box")).as_deref(),
        Some("$1,200.50")
    );
    // Stalls: $60.50 and $0.99 (the missing level is not priced): low first.
    assert_eq!(
        open_prices(&map, summary(&map, "Stalls")).as_deref(),
        Some("$0.99–$60.50")
    );
    assert_eq!(open_prices(&map, summary(&map, "Gallery")), None);
    // Two levels of one price: one price.
    let (mut one, _) = basketball();
    one.levels[1].price = Some("95".into());
    assert_eq!(open_prices(&one, &one.sections[0]).as_deref(), Some("$95"));
}

// ------------------------------------------------------------------------------ layout preview

fn preview_of(v: &Value) -> PreviewLayout {
    serde_json::from_value(v.clone()).expect("a preview layout")
}

#[test]
fn layout_preview_is_one_image_named_for_the_layout_and_its_section_count() {
    let cases = fixture("layout-preview.json");
    let p = layout_preview(&preview_of(&case(&cases, "54 sections")["input"]));
    assert_eq!(p.label, "Basketball: 54 sections");
    assert_eq!(p.view_box, "0 0 1000 640");
    let p = layout_preview(&preview_of(&case(&cases, "one section")["input"]));
    assert_eq!(p.label, "Basketball: 1 section");
}

#[test]
fn layout_preview_draws_each_section_by_its_outline_with_its_name_and_the_floor() {
    let cases = fixture("layout-preview.json");
    let layout = preview_of(&case(&cases, "no floor")["input"]);
    let p = layout_preview(&layout);
    let paths: Vec<&str> = p.sections.iter().map(|s| s.d.as_str()).collect();
    let want: Vec<String> = layout
        .sections
        .iter()
        .map(|s| outline_path(&s.outline))
        .collect();
    assert_eq!(paths, want);
    let labels: Vec<(&str, &str, &str)> = p
        .sections
        .iter()
        .map(|s| (s.name.as_str(), s.x.as_str(), s.y.as_str()))
        .collect();
    assert_eq!(
        labels,
        [
            ("101", "35", "30"),
            ("102", "135", "30"),
            ("103", "235", "30")
        ]
    );
    assert!(p.floor.is_none());
    let p = layout_preview(&preview_of(&case(&cases, "54 sections")["input"]));
    assert_eq!(
        p.floor.as_deref(),
        Some("M400 250L600 250L600 390L400 390Z")
    );
    assert_eq!(p.font_size, "20");
}

// ------------------------------------------------------------------------------ Seating card

#[test]
fn seating_card_shows_each_sections_counts_and_the_events_totals() {
    let (map, floor_a) = arena();
    let d = overview(&map, ColorBy::State);
    assert_eq!(d.label, "Arena map");
    assert_eq!(
        shape(&d, "Floor A").name,
        "Section Floor A, 28 open, 1 held, 1 sold, 0 off sale"
    );
    assert_eq!(
        shape(&d, "Floor B").name,
        "Section Floor B, 30 open, 0 held, 0 sold, 0 off sale"
    );
    assert_eq!(
        shape(&d, "Balcony").name,
        "Section Balcony, 9 open, 0 held, 0 sold, 1 off sale"
    );
    let label_counts: Vec<&str> = d
        .labels
        .iter()
        .map(|l| l.counts.as_ref().unwrap().text.as_str())
        .collect();
    assert_eq!(label_counts[..2], ["1 / 28", "0 / 30"]);
    assert!(has_class(
        &shape(&d, "Floor A").class,
        "venue-map__section--state-open"
    ));
    assert_eq!(totals_line(&map), "1 sold, 1 held, 67 open, 1 off sale");
    assert_eq!(
        seat_totals(&map),
        StateCounts {
            open: 67,
            held: 1,
            sold: 1,
            off_sale: 1
        }
    );

    // Floor A open: every seat by its state, all read-only.
    let ro = read_only();
    let fs = label_font_size(&fit_of_map(&map), 1.0);
    let d = venue_map_drawing(
        &map,
        ColorBy::State,
        Some("s-a"),
        Some(&floor_a),
        Some(&ro),
        fs,
    );
    let drawn = d.seats.as_ref().unwrap();
    let sold = seat_named(drawn, "Row 1, Seat 1, Front, $90, sold");
    assert!(mark_classes(&sold.marks).contains(&"venue-map__mark venue-map__mark--cross"));
    let held = seat_named(drawn, "Row 1, Seat 2, Front, $90, held");
    assert!(mark_classes(&held.marks).contains(&"venue-map__dot venue-map__dot--hollow"));
    assert_eq!(seats(drawn).len(), 30);
    assert!(seats(drawn).iter().all(|s| s.disabled));
    // Who bought a seat is never named.
    for s in seats(drawn) {
        let rest = s.name.strip_prefix("Row ").unwrap();
        let (_, rest) = rest.split_once(", Seat ").unwrap();
        let (_, state) = rest.split_once(", Front, $90, ").unwrap();
        assert!(
            ["open", "held", "sold", "off sale"].contains(&state),
            "{}",
            s.name
        );
    }
}

#[test]
fn seating_card_follows_a_live_seats_message() {
    let (map, floor_a) = arena();
    let mut state = map_reducer(MapState::default(), MapAction::Map(map.clone()));
    state = map_reducer(state, MapAction::Section(floor_a));
    let change = |seat, from| SeatStateChange {
        section_id: "s-a".into(),
        row: 1,
        seat,
        state: SeatState::Sold,
        from,
        level_id: "l-front".into(),
    };
    state = map_reducer(
        state,
        MapAction::Change(SeatMapChange {
            event_id: map.event_id.clone(),
            seq: 2,
            changes: vec![change(3, SeatState::Open), change(2, SeatState::Reserved)],
        }),
    );
    let map = state.map.as_ref().unwrap();
    let floor_a = &state.sections["s-a"].section;
    let ro = read_only();
    let fs = label_font_size(&fit_of_map(map), 1.0);
    let d = venue_map_drawing(
        map,
        ColorBy::State,
        Some("s-a"),
        Some(floor_a),
        Some(&ro),
        fs,
    );
    assert_eq!(
        shape(&d, "Floor A").name,
        "Section Floor A, 27 open, 0 held, 3 sold, 0 off sale"
    );
    let drawn = d.seats.as_ref().unwrap();
    seat_named(drawn, "Row 1, Seat 3, Front, $90, sold");
    seat_named(drawn, "Row 1, Seat 2, Front, $90, sold");
    assert_eq!(totals_line(map), "3 sold, 0 held, 66 open, 1 off sale");
    // The open section hides its label; back on the whole map it shows the new counts.
    assert!(d.labels.iter().all(|l| l.name != "Floor A"));
    let d = overview(map, ColorBy::State);
    assert_eq!(d.labels[0].counts.as_ref().unwrap().text, "3 / 27");
}

#[test]
fn seating_card_by_status() {
    let (map, _) = arena();
    assert!(is_seated(true, false) && is_seated(false, true) && !is_seated(false, false));
    assert_eq!(
        seating_card(false, LiveSeatStatus::Live, Some(&map)),
        SeatingCard::GeneralAdmission
    );
    assert_eq!(GENERAL_ADMISSION, "General admission.");
    for s in [LiveSeatStatus::Loading, LiveSeatStatus::Connecting] {
        assert_eq!(seating_card(true, s, None), SeatingCard::Loading);
    }
    for s in [
        LiveSeatStatus::Live,
        LiveSeatStatus::Reconnecting,
        LiveSeatStatus::Offline,
        LiveSeatStatus::Missing,
        LiveSeatStatus::Unreachable,
    ] {
        assert_eq!(seating_card(true, s, None), SeatingCard::Unavailable);
    }
    assert_eq!(LOADING_SEAT_MAP, "Loading the seat map…");
    assert_eq!(
        SEAT_MAP_UNAVAILABLE,
        "The seat map is unavailable right now."
    );
    assert_eq!(
        seating_card(true, LiveSeatStatus::Live, Some(&map)),
        SeatingCard::Map {
            totals: "1 sold, 1 held, 67 open, 1 off sale".into(),
            reconnecting: false
        }
    );
    assert_eq!(
        seating_card(true, LiveSeatStatus::Reconnecting, Some(&map)),
        SeatingCard::Map {
            totals: "1 sold, 1 held, 67 open, 1 off sale".into(),
            reconnecting: true
        }
    );
    assert_eq!(
        RECONNECTING_NOTE,
        "Reconnecting: the map may be behind for a moment."
    );
    // A section gone from a new map is closed.
    assert_eq!(kept_open_section(&map, Some("s-a")), Some("s-a"));
    assert_eq!(kept_open_section(&map, Some("s-gone")), None);
    assert_eq!(kept_open_section(&map, None), None);
}

// ------------------------------------------------------------------------------ parity with React

/// One element as the fixture script writes it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct El {
    tag: String,
    depth: usize,
    attrs: BTreeMap<String, String>,
    text: String,
}

fn el(tag: &str, depth: usize, attrs: &[(&str, &str)], text: &str) -> El {
    El {
        tag: tag.into(),
        depth,
        attrs: attrs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect(),
        text: text.into(),
    }
}

fn mark_els(marks: &[MarkPart], depth: usize) -> Vec<El> {
    marks
        .iter()
        .map(|m| match m {
            MarkPart::Circle { class, cx, cy, r } => el(
                "circle",
                depth,
                &[("class", class), ("cx", cx), ("cy", cy), ("r", r)],
                "",
            ),
            MarkPart::Path { class, d } => el("path", depth, &[("class", class), ("d", d)], ""),
        })
        .collect()
}

/// What the Leptos `Legend` draws from [`LegendData`].
fn legend_els(l: &LegendData) -> Vec<El> {
    let mut out = Vec::new();
    let list = |out: &mut Vec<El>,
                label: &str,
                items: &[customer_rust_core::seating::venue_map::LegendItem]| {
        out.push(el(
            "UL",
            0,
            &[("aria-label", label), ("class", "venue-map-legend__list")],
            "",
        ));
        for i in items {
            out.push(el("LI", 1, &[("class", "venue-map-legend__item")], &i.text));
            out.push(el(
                "SPAN",
                2,
                &[("aria-hidden", "true"), ("class", &i.swatch_class)],
                "",
            ));
        }
    };
    if let Some(items) = &l.price_levels {
        list(&mut out, "Price levels", items);
    }
    if let Some(items) = &l.sections {
        list(&mut out, "Sections", items);
    }
    if let Some(note) = l.note {
        out.push(el("P", 0, &[("class", "venue-map-legend__note")], note));
    }
    out.push(el(
        "UL",
        0,
        &[
            ("aria-label", "Seat states"),
            ("class", "venue-map-legend__list"),
        ],
        "",
    ));
    for m in &l.seat_states {
        out.push(el("LI", 1, &[("class", "venue-map-legend__item")], m.name));
        out.push(el(
            "svg",
            2,
            &[
                ("aria-hidden", "true"),
                ("class", "venue-map-legend__mark"),
                ("height", "16"),
                ("viewBox", "-1 -1 2 2"),
                ("width", "16"),
            ],
            "",
        ));
        out.push(el("g", 3, &[("class", &m.group_class)], ""));
        out.extend(mark_els(&m.marks, 4));
    }
    out
}

/// What the Leptos `VenueMap` draws inside its `<svg>` from [`VenueMapDrawing`].
fn svg_els(d: &VenueMapDrawing) -> Vec<El> {
    let mut out = vec![el(
        "rect",
        0,
        &[
            ("class", "venue-map__bg"),
            ("height", &d.height),
            ("width", &d.width),
            ("x", "0"),
            ("y", "0"),
        ],
        "",
    )];
    if let Some(floor) = &d.floor {
        out.push(el(
            "path",
            0,
            &[("class", "venue-map__floor"), ("d", floor)],
            "",
        ));
    }
    for s in &d.sections {
        let mut attrs = vec![
            ("aria-label", s.name.as_str()),
            ("class", s.class.as_str()),
            ("d", s.d.as_str()),
            ("role", "button"),
            ("tabindex", "0"),
        ];
        if s.current {
            attrs.push(("aria-current", "true"));
        }
        out.push(el("path", 0, &attrs, ""));
    }
    for l in &d.labels {
        let base = [
            ("aria-hidden", "true"),
            ("class", "venue-map__label"),
            ("dominant-baseline", "central"),
            ("font-size", l.font_size.as_str()),
            ("text-anchor", "middle"),
            ("x", l.x.as_str()),
            ("y", l.y.as_str()),
        ];
        match &l.counts {
            None => out.push(el("text", 0, &base, &l.name)),
            Some(c) => {
                out.push(el("text", 0, &base, ""));
                out.push(el("tspan", 1, &[("x", &l.x)], &l.name));
                out.push(el(
                    "tspan",
                    1,
                    &[
                        ("class", "venue-map__label-counts"),
                        ("dy", &c.dy),
                        ("x", &l.x),
                    ],
                    &c.text,
                ));
            }
        }
    }
    if let Some(seats) = &d.seats {
        out.push(el("g", 0, &[("class", "venue-map__seats")], ""));
        for row in &seats.rows {
            out.push(el("g", 1, &[("class", "venue-map__row")], ""));
            for (x, y) in &row.label_ends {
                out.push(el(
                    "text",
                    2,
                    &[
                        ("aria-hidden", "true"),
                        ("class", "venue-map__row-label"),
                        ("dominant-baseline", "central"),
                        ("font-size", &row.font_size),
                        ("text-anchor", "middle"),
                        ("x", x),
                        ("y", y),
                    ],
                    &row.label,
                ));
            }
            for s in &row.seats {
                let mut attrs = vec![
                    ("aria-label", s.name.as_str()),
                    ("aria-pressed", if s.pressed { "true" } else { "false" }),
                    ("class", s.class.as_str()),
                    ("role", "button"),
                    ("tabindex", "0"),
                ];
                if s.disabled {
                    attrs.push(("aria-disabled", "true"));
                }
                out.push(el("g", 2, &attrs, ""));
                out.extend(mark_els(&s.marks, 3));
            }
        }
    }
    out
}

fn color_by_named(v: &Value) -> ColorBy {
    match v.as_str().unwrap() {
        "price" => ColorBy::Price,
        "state" => ColorBy::State,
        other => panic!("colorBy {other}"),
    }
}

fn assert_els(name: &str, got: &[El], want: &Value) {
    let want: Vec<El> = serde_json::from_value(want.clone()).unwrap();
    for (i, (g, w)) in got.iter().zip(&want).enumerate() {
        assert_eq!(g, w, "{name}: element {i}");
    }
    assert_eq!(got.len(), want.len(), "{name}: element count");
}

#[test]
fn venue_map_draws_what_the_react_venue_map_draws() {
    let cases = fixture("venue-map.json");
    let cases = cases.as_array().unwrap();
    assert_eq!(cases.len(), 14);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let input = &c["input"];
        let out = &c["out"];
        let map = map_of(&input["map"]);
        let color_by = color_by_named(&input["colorBy"]);
        let open = input["openSectionId"].as_str();
        let section = section_of(&input["section"]);
        let view = seat_view_named(input["seatView"].as_str().unwrap());
        // The view after the case's presses of "Zoom in".
        let fit = fit_of_map(&map);
        let mut v = fit;
        for _ in 0..input["zoomIns"].as_u64().unwrap() {
            v = zoom_by(&v, 1.5, &fit);
        }
        assert_eq!(view_box(&v), out["viewBox"].as_str().unwrap(), "{name}");
        let fs = label_font_size(&fit, zoom_of(&v, &fit));
        let d = venue_map_drawing(&map, color_by, open, section.as_ref(), view.as_deref(), fs);

        assert_eq!(d.label, out["svgLabel"].as_str().unwrap(), "{name}");
        assert_eq!(d.back_to_map, out["backToMap"].as_bool().unwrap(), "{name}");
        match &out["loading"] {
            Value::Null => assert!(d.loading.is_none(), "{name}"),
            l => {
                assert_eq!(l["attrs"]["class"], "note");
                assert_eq!(d.loading.as_deref(), l["text"].as_str(), "{name}");
            }
        }
        assert_eq!(out["emptyTip"], " ");
        let tips: Vec<String> = d
            .seats
            .iter()
            .flat_map(|s| {
                s.rows
                    .iter()
                    .flat_map(|r| r.seats.iter().map(|s| s.tip.clone()))
            })
            .collect();
        let want_tips: Vec<String> = serde_json::from_value(out["tips"].clone()).unwrap();
        assert_eq!(tips, want_tips, "{name}");
        assert_els(name, &legend_els(&legend(&map, color_by)), &out["legend"]);
        assert_els(name, &svg_els(&d), &out["svg"]);
    }
}

#[test]
fn sections_list_draws_what_the_react_sections_list_draws() {
    let cases = fixture("sections-list.json");
    for c in cases.as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let map = map_of(&c["input"]["map"]);
        let mut got = Vec::new();
        for r in sections_list_rows(&map, c["input"]["openSectionId"].as_str()) {
            got.push(el("LI", 0, &[], ""));
            got.push(el(
                "BUTTON",
                1,
                &[
                    ("aria-label", &r.name),
                    ("aria-pressed", if r.chosen { "true" } else { "false" }),
                    ("class", &r.class),
                    ("type", "button"),
                ],
                "",
            ));
            got.push(el("SPAN", 2, &[("class", "sections-list__name")], &r.title));
            if let Some(p) = &r.prices {
                got.push(el("SPAN", 2, &[("class", "sections-list__prices")], p));
            }
            got.push(el(
                "SPAN",
                2,
                &[("class", "sections-list__count")],
                &r.count,
            ));
            if r.chosen {
                got.push(el(
                    "SPAN",
                    2,
                    &[("aria-hidden", "true"), ("class", "sections-list__shown")],
                    "On the map",
                ));
            }
        }
        assert_els(name, &got, &c["out"]);
    }
}

fn preview_els(p: &LayoutPreviewDrawing) -> Vec<El> {
    let mut out = Vec::new();
    if let Some(floor) = &p.floor {
        out.push(el(
            "path",
            0,
            &[("class", "layout-preview__floor"), ("d", floor)],
            "",
        ));
    }
    for s in &p.sections {
        out.push(el("g", 0, &[], ""));
        out.push(el(
            "path",
            1,
            &[("class", "layout-preview__section"), ("d", &s.d)],
            "",
        ));
        out.push(el(
            "text",
            1,
            &[
                ("aria-hidden", "true"),
                ("class", "layout-preview__label"),
                ("dominant-baseline", "central"),
                ("font-size", &p.font_size),
                ("text-anchor", "middle"),
                ("x", &s.x),
                ("y", &s.y),
            ],
            &s.name,
        ));
    }
    out
}

#[test]
fn layout_preview_draws_what_the_react_layout_preview_draws() {
    let cases = fixture("layout-preview.json");
    for c in cases.as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let p = layout_preview(&preview_of(&c["input"]));
        let root = &c["out"]["root"];
        assert_eq!(
            root["aria-label"].as_str(),
            Some(p.label.as_str()),
            "{name}"
        );
        assert_eq!(
            root["viewBox"].as_str(),
            Some(p.view_box.as_str()),
            "{name}"
        );
        assert_eq!(root["class"], "layout-preview");
        assert_eq!(root["role"], "img");
        assert_eq!(root["preserveAspectRatio"], "xMidYMid meet");
        assert_els(name, &preview_els(&p), &c["out"]["elements"]);
    }
}

#[test]
fn preview_layout_from_a_layout_detail() {
    let detail: customer_rust_core::api::types::LayoutDetail =
        serde_json::from_value(serde_json::json!({
            "id": "00000000-0000-4000-8000-000000000001",
            "locationId": "00000000-0000-4000-8000-000000000002",
            "name": "Arena",
            "source": "LINES",
            "floorKind": "COURT",
            "floorOutline": [[1, 2], [3, 2], [3, 4]],
            "seatCount": 1,
            "sectionCount": 1,
            "levelCount": 1,
            "eventsUsing": 0,
            "locked": false,
            "size": { "width": 80, "height": 10 },
            "levels": [
                { "id": "00000000-0000-4000-8000-000000000003", "name": "Front", "rank": 1,
                  "color": "violet", "seatCount": 1 }
            ],
            "sections": [
                { "id": "00000000-0000-4000-8000-000000000004", "name": "Floor A",
                  "levelId": "00000000-0000-4000-8000-000000000003",
                  "levelIds": ["00000000-0000-4000-8000-000000000003"],
                  "outline": [[0, 0], [24, 0], [24, 10]], "labelAt": [12, 5],
                  "rowCount": 1, "seatCount": 1 }
            ],
            "latestPrices": null
        }))
        .expect("a layout detail");
    let p = PreviewLayout::from(&detail);
    assert_eq!(p.name, "Arena");
    assert_eq!((p.size.width, p.size.height), (80.0, 10.0));
    assert_eq!(
        p.floor_outline.as_deref(),
        Some(&[[1.0, 2.0], [3.0, 2.0], [3.0, 4.0]][..])
    );
    assert_eq!(p.sections[0].id, "00000000-0000-4000-8000-000000000004");
    assert_eq!(p.sections[0].label_at, [12.0, 5.0]);
    let d = layout_preview(&p);
    assert_eq!(d.label, "Arena: 1 section");
    assert_eq!(d.floor.as_deref(), Some("M1 2L3 2L3 4Z"));
    assert_eq!(d.font_size, "1.6");
}
