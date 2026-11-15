//! Spec 037 T049 (parity M10; 038 FR-013, FR-014): the event form's seats off sale, ported from
//! `admin-app/src/components/off-sale.ts` and the off-sale tool of `SeatingSection.tsx`, with the
//! cases of `admin-app/test/seating-section.test.tsx` on the layouts of `fixtures-038.ts`.

#[path = "fixtures/event/layouts.rs"]
mod fixtures;

use std::collections::{BTreeMap, BTreeSet};

use admin_rust_core::forms::off_sale::{
    self, LayoutDetail, LayoutSectionSeats, LayoutSummary, OffSaleSelector, Taken, TakenSeats,
    compact_section, count_off_sale, off_seats_of, ordered, seat_key, seat_radius,
    with_section_off,
};
use admin_rust_core::seating::map_state::VenueMapSection;
use serde_json::json;

fn arena() -> LayoutDetail {
    serde_json::from_value(fixtures::arena()).unwrap()
}

fn club() -> LayoutDetail {
    serde_json::from_value(fixtures::club()).unwrap()
}

fn seats(id: &str) -> LayoutSectionSeats {
    serde_json::from_value(fixtures::section_by_id(id)).unwrap()
}

fn order() -> Vec<String> {
    arena().sections.iter().map(|s| s.id.clone()).collect()
}

fn all_loaded() -> BTreeMap<String, LayoutSectionSeats> {
    ["s-a", "s-b", "s-bal"]
        .iter()
        .map(|id| (id.to_string(), seats(id)))
        .collect()
}

fn keys(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|k| k.to_string()).collect()
}

fn s(id: &str) -> OffSaleSelector {
    OffSaleSelector::section(id)
}
fn r(id: &str, row: u64) -> OffSaleSelector {
    OffSaleSelector::row(id, row)
}
fn seat(id: &str, row: u64, seat: u64) -> OffSaleSelector {
    OffSaleSelector::seat(id, row, seat)
}

#[test]
fn seat_key_is_row_slash_seat() {
    assert_eq!(seat_key(2, 3), "2/3");
}

#[test]
fn selectors_serialize_as_the_contract_has_them() {
    assert_eq!(
        serde_json::to_value(vec![s("s-bal"), r("s-a", 1), seat("s-a", 2, 3)]).unwrap(),
        json!([
            { "sectionId": "s-bal" },
            { "sectionId": "s-a", "row": 1 },
            { "sectionId": "s-a", "row": 2, "seat": 3 },
        ])
    );
    let back: Vec<OffSaleSelector> =
        serde_json::from_value(json!([{ "sectionId": "x" }, { "sectionId": "x", "row": 4 }]))
            .unwrap();
    assert_eq!(back, vec![s("x"), r("x", 4)]);
}

#[test]
fn layouts_read_from_the_contract_payloads() {
    let a = arena();
    assert_eq!(a.id, "l-arena");
    assert_eq!(a.seat_count, 70);
    assert_eq!(a.levels.len(), 3);
    assert_eq!(a.levels[0].color, "violet");
    assert_eq!(a.sections[2].level_ids, vec!["l-upper".to_string()]);
    assert_eq!(a.latest_prices.as_ref().unwrap().event_name, "Earlier game");
    assert!(club().latest_prices.is_none());
    let summary: LayoutSummary = serde_json::from_value(fixtures::club_summary()).unwrap();
    assert_eq!((summary.id.as_str(), summary.seat_count), ("l-club", 12));
}

#[test]
fn off_seats_of_reads_sections_rows_and_seats_of_one_section() {
    let a = seats("s-a");
    assert_eq!(off_seats_of(&[s("s-a")], &a).len(), 30);
    assert_eq!(off_seats_of(&[s("s-b")], &a).len(), 0);
    let row = off_seats_of(&[r("s-a", 2)], &a);
    assert_eq!(row.len(), 10);
    assert!(row.contains("2/1") && row.contains("2/10") && !row.contains("1/1"));
    assert_eq!(
        off_seats_of(&[seat("s-a", 1, 4), seat("s-a", 3, 9)], &a),
        keys(&["1/4", "3/9"])
    );
    // A seat the section lacks names nothing.
    assert!(off_seats_of(&[seat("s-a", 9, 1)], &a).is_empty());
}

#[test]
fn compact_section_is_the_section_else_whole_rows_and_seats() {
    let bal = seats("s-bal");
    let all: BTreeSet<String> = off_seats_of(&[s("s-bal")], &bal);
    assert_eq!(compact_section(&bal, &all), vec![s("s-bal")]);
    let mut some = off_seats_of(&[r("s-bal", 2)], &bal);
    some.insert("1/3".into());
    assert_eq!(
        compact_section(&bal, &some),
        vec![seat("s-bal", 1, 3), r("s-bal", 2)]
    );
    assert!(compact_section(&bal, &BTreeSet::new()).is_empty());
    // A section without rows is never "all off".
    let empty: LayoutSectionSeats = serde_json::from_value(
        json!({ "layoutId": "l", "sectionId": "s-e", "name": "E", "rows": [] }),
    )
    .unwrap();
    assert!(compact_section(&empty, &BTreeSet::new()).is_empty());
}

#[test]
fn ordered_is_sections_then_rows_then_seats_in_drawing_row_and_seat_order() {
    let mixed = vec![
        seat("s-a", 2, 3),
        r("s-b", 1),
        s("s-bal"),
        seat("s-a", 1, 9),
        r("s-a", 3),
        s("s-a"),
        seat("s-a", 1, 2),
        s("unknown"),
    ];
    assert_eq!(
        ordered(&mixed, &order()),
        vec![
            s("s-a"),
            s("unknown"),
            s("s-bal"),
            r("s-a", 3),
            r("s-b", 1),
            seat("s-a", 1, 2),
            seat("s-a", 1, 9),
            seat("s-a", 2, 3),
        ]
    );
}

#[test]
fn with_section_off_replaces_one_sections_selectors_and_keeps_the_rest() {
    // The tool's run in seating-section.test.tsx: Balcony whole, then Floor A's Row 2, Seat 3.
    let bal = seats("s-bal");
    let a = seats("s-a");
    let after_bal = with_section_off(&[], &bal, &off_seats_of(&[s("s-bal")], &bal), &order());
    assert_eq!(after_bal, vec![s("s-bal")]);
    let after_seat = with_section_off(&after_bal, &a, &keys(&["2/3"]), &order());
    assert_eq!(after_seat, vec![s("s-bal"), seat("s-a", 2, 3)]);
    // Floor A all on sale again: only Balcony's selector stays.
    assert_eq!(
        with_section_off(&after_seat, &a, &BTreeSet::new(), &order()),
        vec![s("s-bal")]
    );
}

#[test]
fn count_off_sale_counts_by_level_and_lists_sections_it_needs() {
    let layout = arena();
    let none = count_off_sale(&layout, &[], &BTreeMap::new());
    assert_eq!(
        (none.seats_on_sale, none.seats_off_sale, none.missing.len()),
        (70, 0, 0)
    );
    assert!(none.off_by_level.is_empty());

    // A whole section of one level counts without its seats (the edit's saved Balcony).
    let bal = count_off_sale(&layout, &[s("s-bal")], &BTreeMap::new());
    assert_eq!((bal.seats_on_sale, bal.seats_off_sale), (60, 10));
    assert_eq!(bal.off_by_level.get("l-upper"), Some(&10));
    assert!(bal.missing.is_empty());

    // A row needs its section's seats: until then it counts nowhere and is missing.
    let row = count_off_sale(&layout, &[r("s-a", 1)], &BTreeMap::new());
    assert_eq!((row.seats_on_sale, row.seats_off_sale), (70, 0));
    assert_eq!(row.missing, vec!["s-a".to_string()]);

    // Loaded: 50 on sale · 20 off sale, then a seat, then the row back on (the test's lines).
    let loaded = all_loaded();
    let c = count_off_sale(&layout, &[s("s-bal"), r("s-a", 1)], &loaded);
    assert_eq!((c.seats_on_sale, c.seats_off_sale), (50, 20));
    assert_eq!(c.off_by_level.get("l-front"), Some(&10));
    let c = count_off_sale(
        &layout,
        &[s("s-bal"), r("s-a", 1), seat("s-a", 2, 3)],
        &loaded,
    );
    assert_eq!((c.seats_on_sale, c.seats_off_sale), (49, 21));
    let c = count_off_sale(&layout, &[s("s-bal"), seat("s-a", 2, 3)], &loaded);
    assert_eq!((c.seats_on_sale, c.seats_off_sale), (59, 11));
}

#[test]
fn count_off_sale_whole_section_of_several_levels_counts_in_totals_only_until_loaded() {
    let mut value = fixtures::arena();
    value["sections"][0]["levelIds"] = json!(["l-front", "l-back"]);
    let layout: LayoutDetail = serde_json::from_value(value).unwrap();
    let c = count_off_sale(&layout, &[s("s-a")], &BTreeMap::new());
    assert_eq!((c.seats_on_sale, c.seats_off_sale), (40, 30));
    assert!(c.off_by_level.is_empty());
    assert_eq!(c.missing, vec!["s-a".to_string()]);
}

#[test]
fn seat_radius_is_four_tenths_of_the_first_gap_at_least_a_fifth() {
    assert!((seat_radius(&seats("s-a")) - 0.8).abs() < 1e-12);
    let mut tight = fixtures::section_by_id("s-bal");
    tight["rows"][0]["seats"][1]["at"] = json!([3.25, 3]);
    let tight: LayoutSectionSeats = serde_json::from_value(tight).unwrap();
    assert!((seat_radius(&tight) - 0.2).abs() < 1e-12);
    let mut wide = fixtures::section_by_id("s-bal");
    wide["rows"][0]["seats"][1]["at"] = json!([6, 7]);
    let wide: LayoutSectionSeats = serde_json::from_value(wide).unwrap();
    assert!((seat_radius(&wide) - 2.0).abs() < 1e-12);
    // No row with two seats: a gap of 2.
    let single =
        serde_json::from_value(fixtures::section_seats("l", "x", "X", "lv", 3, 1)).unwrap();
    assert!((seat_radius(&single) - 0.8).abs() < 1e-12);
}

fn taken_a() -> TakenSeats {
    let mut t = TakenSeats::new();
    t.insert("1/4".into(), Taken::Sold);
    t.insert("1/5".into(), Taken::Reserved);
    t
}

#[test]
fn the_tool_takes_a_whole_section_off_and_puts_it_back() {
    let bal = seats("s-bal");
    let none = TakenSeats::new();
    let tool = off_sale::SectionTool::new(&bal, &none, &[]);
    assert_eq!(tool.whole_label(), "Whole section off sale");
    assert!(!tool.whole_disabled());
    assert_eq!(tool.taken_note(), None);
    let off = tool.toggle_whole(&[], &order());
    assert_eq!(off, vec![s("s-bal")]);
    let tool = off_sale::SectionTool::new(&bal, &none, &off);
    assert_eq!(tool.whole_label(), "Whole section on sale");
    assert!(tool.toggle_whole(&off, &order()).is_empty());
}

#[test]
fn the_tool_toggles_rows_and_seats() {
    let a = seats("s-a");
    let none = TakenSeats::new();
    let tool = off_sale::SectionTool::new(&a, &none, &[]);
    let rows = tool.rows();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].label, "Row 1 off sale");
    assert!(!rows[0].checked && !rows[0].disabled);
    let off = tool.toggle_row(1, &[], &order());
    assert_eq!(off, vec![r("s-a", 1)]);
    let tool = off_sale::SectionTool::new(&a, &none, &off);
    assert!(tool.rows()[0].checked);
    let off = tool.toggle_seat(2, 3, &off, &order()).unwrap();
    assert_eq!(off, vec![r("s-a", 1), seat("s-a", 2, 3)]);
    let tool = off_sale::SectionTool::new(&a, &none, &off);
    let pressed = tool.seat(2, 3).unwrap();
    assert!(pressed.pressed);
    assert_eq!(pressed.label, "Row 2, Seat 3");
    assert_eq!(
        pressed.class,
        "off-sale-section__seat off-sale-section__seat--off"
    );
    assert_eq!(pressed.tab_index, 0);
    let off = tool.toggle_row(1, &off, &order());
    assert_eq!(off, vec![seat("s-a", 2, 3)]);
    // A row that does not exist changes nothing; so does an unknown seat.
    let tool = off_sale::SectionTool::new(&a, &none, &off);
    assert_eq!(tool.toggle_row(9, &off, &order()), off);
    assert!(tool.seat(9, 9).is_none());
    assert_eq!(tool.seats().len(), 30);
}

#[test]
fn sold_and_held_seats_cannot_be_taken_off_sale() {
    let a = seats("s-a");
    let taken = taken_a();
    let tool = off_sale::SectionTool::new(&a, &taken, &[]);
    assert_eq!(
        tool.taken_note(),
        Some("Sold and held seats can't be taken off sale.")
    );
    assert!(tool.whole_disabled());
    let rows = tool.rows();
    assert!(rows[0].disabled && !rows[0].checked);
    assert!(!rows[1].disabled);
    let sold = tool.seat(1, 4).unwrap();
    assert_eq!(sold.label, "Row 1, Seat 4, sold");
    assert_eq!(sold.taken, Some(Taken::Sold));
    assert_eq!(sold.tab_index, -1);
    assert_eq!(
        sold.class,
        "off-sale-section__seat off-sale-section__seat--taken"
    );
    assert_eq!(tool.seat(1, 5).unwrap().label, "Row 1, Seat 5, held");
    let open = tool.seat(2, 4).unwrap();
    assert_eq!(open.taken, None);
    assert_eq!(open.class, "off-sale-section__seat");
    // Pressing a taken seat does nothing.
    assert!(tool.toggle_seat(1, 4, &[], &order()).is_none());
    // Taking the whole section off (when allowed) skips the taken seats.
    let off = tool.toggle_whole(&[], &order());
    assert_eq!(
        off,
        vec![
            r("s-a", 2),
            r("s-a", 3),
            seat("s-a", 1, 1),
            seat("s-a", 1, 2),
            seat("s-a", 1, 3),
            seat("s-a", 1, 6),
            seat("s-a", 1, 7),
            seat("s-a", 1, 8),
            seat("s-a", 1, 9),
            seat("s-a", 1, 10),
        ]
    );
    // Row 1 off with taken seats: only its open ones go.
    assert_eq!(tool.toggle_row(1, &[], &order()).len(), 8);
}

#[test]
fn a_whole_row_already_off_with_a_taken_seat_can_be_put_back() {
    let a = seats("s-a");
    let taken = taken_a();
    let tool = off_sale::SectionTool::new(&a, &taken, &[r("s-a", 1)]);
    assert!(tool.rows()[0].checked && !tool.rows()[0].disabled);
    assert!(tool.toggle_row(1, &[r("s-a", 1)], &order()).is_empty());
}

#[test]
fn taken_seats_come_from_the_venue_map_section() {
    let map: VenueMapSection = serde_json::from_value(json!({
        "eventId": fixtures::EVENT_ID,
        "seq": 3,
        "sectionId": "s-a",
        "name": "Floor A",
        "rows": [{
            "number": 1,
            "label": "1",
            "seats": [
                { "number": 4, "label": "4", "at": [9, 3], "levelId": "l-front", "accessible": false, "state": "sold" },
                { "number": 5, "label": "5", "at": [11, 3], "levelId": "l-front", "accessible": false, "state": "reserved" },
                { "number": 6, "label": "6", "at": [13, 3], "levelId": "l-front", "accessible": false, "state": "offSale" },
                { "number": 7, "label": "7", "at": [15, 3], "levelId": "l-front", "accessible": false, "state": "open" },
            ],
        }],
    }))
    .unwrap();
    assert_eq!(off_sale::taken_from_map_section(&map), taken_a());
}

#[test]
fn the_tool_texts_match_the_react_app() {
    assert_eq!(off_sale::OFF_SALE_LEGEND, "Seats off sale");
    assert_eq!(
        off_sale::CHOOSE_SECTION_NOTE,
        "Choose a section to take its seats off sale or put them back."
    );
    assert_eq!(off_sale::BACK_TO_SECTIONS, "Back to all sections");
    assert_eq!(off_sale::LOADING_SEATS, "Loading the seats…");
    assert_eq!(off_sale::section_button("Balcony"), "Section Balcony");
    assert_eq!(
        off_sale::section_seats_label("Floor A"),
        "Section Floor A seats"
    );
}
