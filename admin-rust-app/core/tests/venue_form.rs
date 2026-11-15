//! Spec 037 T040: the venue form's rules and the section lines, ported test first from
//!
//! - `admin-app/test/section-lines.test.tsx` (spec 024 US3, spec 038 FR-005; parity M3a)
//! - `admin-app/test/layout.test.tsx` (a LINES layout edited as lines again; parity M3)
//! - `admin-app/test/venue-create.test.tsx` (New venue › Seated; parity V10)
//! - `admin-app/test/venue-address.test.tsx` (specs 013, 024; parity V2, V3, V4, V9)
//! - `admin-app/test/venue-time-zone.test.tsx` (specs 020, 024; parity V2, V8)
//! - `packages/shared/test/location.test.ts` (`US_STATES`, `ZIP_PATTERN`) and the zone list of
//!   `packages/shared/test/time-zone.test.ts`, as the form's selects offer them
//!
//! The React tests drive rendered pages; these drive the same state and check what the page
//! shows (texts, hints, notices, banners) and what a save sends (each body also checked against
//! `contracts/openapi.yaml`). Expected strings are the React app's, byte for byte.

#[path = "fixtures/venue/contract.rs"]
mod contract;

use admin_rust_core::api::client::{ApiError, error_from};
use admin_rust_core::api::types::{LayoutDetail, LayoutSummary, LevelColor, Location};
use admin_rust_core::forms::section_lines::{
    CHOOSE_A_LEVEL, LEVEL_COLORS, LEVELS_HINT, LevelLine, LinesDraft, SECTIONS_HINT, SectionLine,
    SelectOption, draft_of, js_number, js_number_string, json_number, line_seats, new_level,
    new_line, seats_text, to_lines_input, to_locale_string, total_seats, total_text,
};
use admin_rust_core::forms::venue::{
    ADDRESS_ZONE_HINT, Address, CAPACITY_HINT, CapacityField, FIRST_LAYOUT, LAYOUT_REFUSED_LINK,
    LAYOUT_REFUSED_TEXT, LAYOUT_REFUSED_TITLE, NEW_ZONE_HINT, NoticeKind, PROBLEMS_TITLE,
    SaveRequest, SeatingKind, UNVERIFIED_NOTE, US_STATES, VenueFormState, ZONE_CHANGE_NOTE,
    ZONE_REQUIRED, address_problems, first_level, is_zip, refusal_banner, same_as_stored,
    saved_notice, state_options,
};
use serde_json::{Value, json};

const ID: &str = "6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e";

fn level(name: &str, color: LevelColor) -> LevelLine {
    LevelLine {
        name: name.into(),
        color,
    }
}

fn levels() -> Vec<LevelLine> {
    vec![
        level("Front", LevelColor::Violet),
        level("Back", LevelColor::Teal),
    ]
}

fn line(name: &str, rows: &str, seats_per_row: &str, level: &str) -> SectionLine {
    SectionLine {
        name: name.into(),
        rows: rows.into(),
        seats_per_row: seats_per_row.into(),
        level: level.into(),
    }
}

fn draft(lines: Vec<SectionLine>) -> LinesDraft {
    LinesDraft {
        name: String::new(),
        levels: levels(),
        lines,
    }
}

fn opts(pairs: &[(&str, &str)]) -> Vec<SelectOption> {
    pairs
        .iter()
        .map(|(v, l)| SelectOption {
            value: (*v).into(),
            label: (*l).into(),
        })
        .collect()
}

/// A `Location` as the Backend sends it: the venue of `venue-address.test.tsx`, with `over`.
fn location(over: Value) -> Location {
    let mut v = json!({
        "id": ID,
        "name": "Rupp Arena",
        "address": "430 W VINE ST, LEXINGTON, KY 40507",
        "street": "430 W VINE ST",
        "city": "LEXINGTON",
        "state": "KY",
        "zip": "40507",
        "addressVerified": true,
        "timeZone": "America/New_York",
        "timeZoneSource": "DEFAULT",
        "seatingCapacity": 20500,
        "createdAt": "2026-10-11T12:00:00.000Z",
        "updatedAt": "2026-10-11T12:00:00.000Z",
    });
    for (k, val) in over.as_object().unwrap() {
        v[k] = val.clone();
    }
    serde_json::from_value(v).expect("a Location")
}

fn verified() -> Location {
    location(json!({}))
}

fn saved_anyway() -> Location {
    location(json!({
        "name": "KFC Yum! Center",
        "address": "1 Arena Plaza, Louisville, KY 40202",
        "street": "1 Arena Plaza",
        "city": "Louisville",
        "state": "KY",
        "zip": "40202",
        "addressVerified": false,
    }))
}

fn not_verified() -> Location {
    location(json!({
        "name": "KFC Yum! Center",
        "address": "1 Arena Plaza, Louisville, KY 40202",
        "street": "1 Arena Plaza",
        "city": "Louisville",
        "state": "KY",
        "zip": "40202",
        "addressVerified": false,
        "timeZoneSource": "ADMIN",
    }))
}

fn legacy() -> Location {
    location(json!({
        "name": "Demo Arena",
        "address": "1 Demo Plaza, Louisville, KY",
        "street": null,
        "city": null,
        "state": null,
        "zip": null,
        "addressVerified": false,
    }))
}

/// The time-zone test's venue: verified, its zone from the address.
fn tz_venue() -> Location {
    location(json!({ "timeZoneSource": "ADDRESS" }))
}

fn summary(id: &str, name: &str, seats: u64) -> LayoutSummary {
    serde_json::from_value(json!({
        "id": id,
        "locationId": ID,
        "name": name,
        "source": "FILE",
        "floorKind": "COURT",
        "seatCount": seats,
        "sectionCount": 1,
        "levelCount": 1,
        "eventsUsing": 0,
        "locked": false,
    }))
    .expect("a LayoutSummary")
}

fn refusal(status: u16, body: Value) -> ApiError {
    ApiError::Status(error_from(status, body.to_string().as_bytes()))
}

/// New venue with every field filled as `venue-address.test.tsx`' `fill()`.
fn filled_new() -> VenueFormState {
    let mut f = VenueFormState::new_venue();
    f.name = "KFC Yum! Center".into();
    f.address = Address {
        street: "1 Arena Plaza".into(),
        city: "Louisville".into(),
        state: "KY".into(),
        zip: "40202".into(),
    };
    f.seating_capacity = "22090".into();
    f.choose_zone("America/New_York");
    f
}

fn edit_of(stored: Location) -> VenueFormState {
    let mut f = VenueFormState::edit(ID);
    f.on_loaded(stored);
    f.on_layouts(&[]);
    f
}

fn hint_texts(f: &VenueFormState) -> Vec<String> {
    f.zone_hints().into_iter().map(|h| h.text).collect()
}

/// The request a save makes, checked against the contract.
fn create_of(f: &mut VenueFormState) -> (Value, Option<Value>) {
    match f.save().expect("a request") {
        SaveRequest::Create { body, layout } => {
            contract::assert_valid("LocationInput", &body);
            if let Some(layout) = &layout {
                contract::assert_valid("LayoutLinesInput", layout);
            }
            (body, layout)
        }
        other => panic!("expected a create, got {other:?}"),
    }
}

fn update_of(f: &mut VenueFormState) -> Value {
    match f.save().expect("a request") {
        SaveRequest::Update { id, body } => {
            assert_eq!(id, ID);
            contract::assert_valid("LocationUpdate", &body);
            body
        }
        other => panic!("expected an update, got {other:?}"),
    }
}

// ------------------------------------------------------------------ section-lines.test.tsx

mod section_lines {
    use super::*;

    #[test]
    fn says_what_levels_and_sections_are() {
        assert_eq!(
            LEVELS_HINT,
            "Price levels, most desirable first. Each event that uses the layout sets a price for each level."
        );
        assert_eq!(
            SECTIONS_HINT,
            "A section is a grid of seats: rows run front to back, and every row has the same number of seats across."
        );
    }

    #[test]
    fn shows_each_lines_seats_as_typed() {
        for (rows, seats, text) in [
            ("10", "20", "= 200 seats"),
            ("1", "1", "= 1 seat"),
            ("", "20", "= 0 seats"),
            ("10", "", "= 0 seats"),
            ("abc", "20", "= 0 seats"),
            ("100", "200", "= 20,000 seats"),
        ] {
            let l = line("Floor", rows, seats, "Front");
            assert_eq!(seats_text(line_seats(&l)), text, "{rows} × {seats}");
        }
    }

    #[test]
    fn renumbers_the_lines_after_remove_and_adds_a_1_by_1_line() {
        let mut d = draft(vec![
            line("Floor", "10", "20", "Front"),
            line("Balcony", "5", "10", "Front"),
        ]);
        d.remove_section(0);
        assert_eq!(d.lines, vec![line("Balcony", "5", "10", "Front")]);
        assert_eq!(seats_text(line_seats(&d.lines[0])), "= 50 seats");

        d.add_section();
        assert_eq!(d.lines[1], line("", "1", "1", "Front"));
        assert_eq!(seats_text(line_seats(&d.lines[1])), "= 1 seat");
    }

    #[test]
    fn offers_the_levels_by_name_the_lines_level_chosen() {
        assert_eq!(
            d_options(&levels(), "Back"),
            opts(&[("Front", "Front"), ("Back", "Back")])
        );
    }

    fn d_options(levels: &[LevelLine], current: &str) -> Vec<SelectOption> {
        LinesDraft {
            name: String::new(),
            levels: levels.to_vec(),
            lines: vec![],
        }
        .level_options(current)
    }

    #[test]
    fn puts_choose_a_level_first_when_the_lines_level_is_not_a_named_one() {
        assert_eq!(CHOOSE_A_LEVEL, "Choose a level");
        assert_eq!(
            d_options(&levels(), ""),
            opts(&[("", "Choose a level"), ("Front", "Front"), ("Back", "Back")])
        );
        assert_eq!(
            d_options(&levels(), "Gone"),
            opts(&[
                ("Gone", "Choose a level"),
                ("Front", "Front"),
                ("Back", "Back")
            ])
        );
        // A level whose name is blank is not offered.
        let mut with_blank = levels();
        with_blank.push(level("  ", LevelColor::Red));
        assert_eq!(
            d_options(&with_blank, "Front"),
            opts(&[("Front", "Front"), ("Back", "Back")])
        );
        assert_eq!(
            LinesDraft {
                name: String::new(),
                levels: with_blank,
                lines: vec![]
            }
            .named_levels(),
            vec!["Front".to_string(), "Back".to_string()]
        );
    }

    #[test]
    fn lists_the_twelve_colors_in_the_contracts_order() {
        let names: Vec<String> = LEVEL_COLORS.iter().map(|c| c.to_string()).collect();
        assert_eq!(
            names,
            [
                "violet", "blue", "cyan", "teal", "green", "lime", "yellow", "orange", "red",
                "pink", "purple", "brown"
            ]
        );
    }

    #[test]
    fn adds_a_blank_violet_level_and_removes_one_leaving_the_lines() {
        assert_eq!(new_level(), level("", LevelColor::Violet));
        let mut d = draft(vec![line("Floor", "10", "20", "Front")]);
        d.add_level();
        assert_eq!(d.levels[2], level("", LevelColor::Violet));
        d.remove_level(0);
        assert_eq!(d.levels[0], level("Back", LevelColor::Teal));
        assert_eq!(d.lines[0].level, "Front");
    }

    #[test]
    fn renames_a_level_in_every_line_that_uses_it_and_adds_a_line_in_the_first_level() {
        let mut d = draft(vec![
            line("Floor", "10", "20", "Front"),
            line("Balcony", "5", "10", "Back"),
        ]);
        d.rename_level(0, "Courtside");
        assert_eq!(d.levels[0].name, "Courtside");
        let used: Vec<&str> = d.lines.iter().map(|l| l.level.as_str()).collect();
        assert_eq!(used, ["Courtside", "Back"]);
        d.add_section();
        assert_eq!(d.lines[2].level, "Courtside");
    }

    #[test]
    fn a_color_change_or_the_same_name_touches_no_line() {
        let mut d = draft(vec![line("Floor", "10", "20", "Front")]);
        d.set_level_color(0, LevelColor::Red);
        assert_eq!(d.levels[0], level("Front", LevelColor::Red));
        d.rename_level(0, "Front");
        assert_eq!(d.lines[0].level, "Front");
    }

    #[test]
    fn renaming_one_of_two_same_named_levels_moves_every_line_of_that_name() {
        // Quirk kept: lines name their level, so two levels named alike share their lines.
        let mut d = LinesDraft {
            name: String::new(),
            levels: vec![
                level("Front", LevelColor::Violet),
                level("Front", LevelColor::Blue),
            ],
            lines: vec![line("A", "1", "1", "Front"), line("B", "1", "1", "Front")],
        };
        d.rename_level(1, "Rear");
        assert!(d.lines.iter().all(|l| l.level == "Rear"));
        assert_eq!(d.levels[0].name, "Front");
    }

    #[test]
    fn adds_a_line_in_no_level_when_none_is_named() {
        let mut d = LinesDraft {
            name: String::new(),
            levels: vec![new_level()],
            lines: vec![],
        };
        d.add_section();
        assert_eq!(d.lines, vec![new_line("")]);
        assert_eq!(new_line("Front"), line("", "1", "1", "Front"));
    }

    #[test]
    fn edits_a_lines_fields() {
        let mut d = draft(vec![line("Floor", "10", "20", "Front")]);
        d.set_line_name(0, "Pit");
        d.set_line_rows(0, "3");
        d.set_line_seats_per_row(0, "4");
        d.set_line_level(0, "Back");
        d.set_name("Club");
        assert_eq!(d.lines[0], line("Pit", "3", "4", "Back"));
        assert_eq!(d.name, "Club");
        assert_eq!(d.total_seats(), 12.0);
    }

    #[test]
    fn makes_the_request_names_trimmed_numbers_as_numbers_levels_in_order() {
        let body = to_lines_input(
            " Club room ",
            &levels(),
            &[line(" Floor A ", "10", "20", "Front")],
        );
        assert_eq!(
            body,
            json!({
                "name": "Club room",
                "levels": [{ "name": "Front", "color": "violet" }, { "name": "Back", "color": "teal" }],
                "sections": [{ "name": "Floor A", "rows": 10, "seatsPerRow": 20, "level": "Front" }],
            })
        );
        contract::assert_valid("LayoutLinesInput", &body);
        contract::assert_valid("LayoutUpdate", &body);
    }

    #[test]
    fn sends_what_number_makes_of_the_text_as_json_stringify_would() {
        let body = to_lines_input(
            "X",
            &[level(" Front ", LevelColor::Violet)],
            &[
                line("A", "abc", "1.5", " Front "),
                line("B", "", " 7 ", "Front"),
            ],
        );
        assert_eq!(
            body["sections"],
            json!([
                { "name": "A", "rows": null, "seatsPerRow": 1.5, "level": "Front" },
                { "name": "B", "rows": 0, "seatsPerRow": 7, "level": "Front" },
            ])
        );
        assert_eq!(
            body["levels"],
            json!([{ "name": "Front", "color": "violet" }])
        );
    }

    #[test]
    fn totals_the_lines_as_typed() {
        let lines = [
            line("A", "3", "10", ""),
            line("B", "2", "20", ""),
            line("C", "x", "9", ""),
        ];
        assert_eq!(total_seats(&lines), 70.0);
        assert_eq!(total_seats(&[]), 0.0);
        assert_eq!(total_text(70.0), "Total: 70 seats");
        assert_eq!(total_text(1.0), "Total: 1 seat");
        assert_eq!(total_text(22090.0), "Total: 22,090 seats");
    }

    #[test]
    fn starts_a_new_layout_from_lines_with_one_blank_level_and_no_lines() {
        assert_eq!(
            LinesDraft::new_layout(),
            LinesDraft {
                name: String::new(),
                levels: vec![level("", LevelColor::Violet)],
                lines: vec![],
            }
        );
    }
}

/// JavaScript's `Number(text)`, `String(n)`, `n.toLocaleString()` (en-US) and
/// `JSON.stringify(n)`, as the lines use them; expected values from Node 22.
mod javascript_numbers {
    use super::*;

    #[test]
    fn number_of_text() {
        let nan = f64::NAN;
        for (text, n) in [
            ("", 0.0),
            (" ", 0.0),
            ("10", 10.0),
            (" 10 ", 10.0),
            ("abc", nan),
            ("1.5", 1.5),
            ("1e2", 100.0),
            ("1E3", 1000.0),
            ("-3", -3.0),
            ("0x10", 16.0),
            ("0b11", 3.0),
            ("0o7", 7.0),
            ("0x", nan),
            ("-0x10", nan),
            ("Infinity", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
            ("inf", nan),
            ("NaN", nan),
            (".5", 0.5),
            ("5.", 5.0),
            ("+5", 5.0),
            ("+.5e-1", 0.05),
            ("1e", nan),
            ("\u{a0}10\u{feff}", 10.0),
            ("1_0", nan),
            ("00012", 12.0),
            ("1e400", f64::INFINITY),
            ("\u{85} 5", nan),
            (".", nan),
        ] {
            let got = js_number(text);
            if n.is_nan() {
                assert!(got.is_nan(), "{text:?} gave {got}");
            } else {
                assert_eq!(got, n, "{text:?}");
            }
        }
        assert!(js_number("-0").is_sign_negative());
    }

    #[test]
    fn string_of_number() {
        for (n, text) in [
            (31.0 / 3.0, "10.333333333333334"),
            (1e-7, "1e-7"),
            (1.5e21, "1.5e+21"),
            (2.0 / 3.0, "0.6666666666666666"),
            (100.0 / 7.0, "14.285714285714286"),
            (1e21, "1e+21"),
            (1.23e-18, "1.23e-18"),
            (10.0, "10"),
            (-0.0, "0"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ] {
            assert_eq!(js_number_string(n), text);
        }
    }

    #[test]
    fn locale_string_of_number() {
        for (n, text) in [
            (0.0, "0"),
            (1.0, "1"),
            (1000.0, "1,000"),
            (22090.0, "22,090"),
            (1.5, "1.5"),
            (1.0625, "1.063"),
            (1.0005, "1.001"),
            (2.0005, "2.001"),
            (1234567.891, "1,234,567.891"),
            (0.0001, "0"),
            (-1234.5, "-1,234.5"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "∞"),
            (f64::NEG_INFINITY, "-∞"),
            (-0.0, "-0"),
            (1e21, "1,000,000,000,000,000,000,000"),
            (123456789012345680000.0, "123,456,789,012,345,680,000"),
            (0.1 + 0.2, "0.3"),
            (4.56789, "4.568"),
            (0.0005, "0.001"),
            (2.5e-7, "0"),
            (999.9996, "1,000"),
        ] {
            assert_eq!(to_locale_string(n), text, "{n}");
        }
    }

    #[test]
    fn json_of_number() {
        assert_eq!(json_number(10.0), json!(10));
        assert_eq!(json_number(-0.0), json!(0));
        assert_eq!(json_number(1.5), json!(1.5));
        assert_eq!(json_number(f64::NAN), Value::Null);
        assert_eq!(json_number(f64::INFINITY), Value::Null);
    }

    #[test]
    fn an_infinite_line_times_zero_is_nan_seats() {
        // `(Number('Infinity') || 0) * (Number('') || 0)` is NaN in the React app too.
        let l = line("A", "Infinity", "", "");
        assert!(line_seats(&l).is_nan());
        assert_eq!(seats_text(line_seats(&l)), "= NaN seats");
    }
}

// ------------------------------------------------------------------ layout.test.tsx

mod lines_layout {
    use super::*;

    const SQUARE: &str = "[[0,0],[10,0],[10,10],[0,10]]";
    const FRONT: &str = "0b0d8e8e-0000-4000-8000-000000000001";
    const BACK: &str = "0b0d8e8e-0000-4000-8000-000000000002";

    fn club(sections: Value) -> LayoutDetail {
        let square: Value = serde_json::from_str(SQUARE).unwrap();
        let mut sections = sections;
        for s in sections.as_array_mut().unwrap() {
            s["outline"] = square.clone();
            s["labelAt"] = json!([5, 5]);
            s["levelIds"] = json!([s["levelId"].clone()]);
        }
        serde_json::from_value(json!({
            "id": "0b0d8e8e-0000-4000-8000-0000000000aa",
            "locationId": ID,
            "name": "Club room",
            "source": "LINES",
            "floorKind": "NONE",
            "seatCount": 70,
            "sectionCount": 2,
            "levelCount": 2,
            "eventsUsing": 0,
            "locked": false,
            "size": { "width": 100, "height": 40 },
            "floorOutline": null,
            "levels": [
                { "id": FRONT, "name": "Front", "rank": 1, "color": "violet", "seatCount": 30 },
                { "id": BACK, "name": "Back", "rank": 2, "color": "teal", "seatCount": 40 },
            ],
            "sections": sections,
            "latestPrices": null,
        }))
        .expect("a LayoutDetail")
    }

    fn the_club() -> LayoutDetail {
        club(json!([
            { "id": "0b0d8e8e-0000-4000-8000-0000000000a1", "name": "A", "levelId": FRONT,
              "rowCount": 3, "seatCount": 30 },
            { "id": "0b0d8e8e-0000-4000-8000-0000000000a2", "name": "B", "levelId": BACK,
              "rowCount": 2, "seatCount": 40 },
        ]))
    }

    #[test]
    fn starts_from_its_lines_each_with_its_rows_seats_per_row_and_price_level() {
        let d = draft_of(&the_club());
        assert_eq!(d.name, "Club room");
        assert_eq!(d.levels, levels());
        assert_eq!(
            d.lines,
            vec![line("A", "3", "10", "Front"), line("B", "2", "20", "Back")]
        );
        assert_eq!(total_text(d.total_seats()), "Total: 70 seats");
    }

    #[test]
    fn saves_the_levels_and_the_lines_in_order() {
        let mut d = draft_of(&the_club());
        d.add_section();
        d.set_line_name(2, "C");
        d.set_line_seats_per_row(2, "5");
        d.set_line_level(2, "Back");
        assert_eq!(seats_text(line_seats(&d.lines[1])), "= 40 seats");
        let body = d.to_lines_input();
        assert_eq!(
            body,
            json!({
                "name": "Club room",
                "levels": [{ "name": "Front", "color": "violet" }, { "name": "Back", "color": "teal" }],
                "sections": [
                    { "name": "A", "rows": 3, "seatsPerRow": 10, "level": "Front" },
                    { "name": "B", "rows": 2, "seatsPerRow": 20, "level": "Back" },
                    { "name": "C", "rows": 1, "seatsPerRow": 5, "level": "Back" },
                ],
            })
        );
        contract::assert_valid("LayoutUpdate", &body);
    }

    #[test]
    fn removes_a_section_line_before_saving() {
        let mut d = draft_of(&the_club());
        d.remove_section(0);
        assert_eq!(
            d.to_lines_input()["sections"],
            json!([{ "name": "B", "rows": 2, "seatsPerRow": 20, "level": "Back" }])
        );
    }

    #[test]
    fn writes_an_uneven_row_as_string_does_and_an_unknown_level_as_blank() {
        let d = draft_of(&club(json!([
            { "id": "0b0d8e8e-0000-4000-8000-0000000000a1", "name": "A",
              "levelId": "0b0d8e8e-0000-4000-8000-0000000000ff", "rowCount": 3, "seatCount": 31 },
        ])));
        assert_eq!(d.lines, vec![line("A", "3", "10.333333333333334", "")]);
    }
}

// ------------------------------------------------------------------ location.test.ts

mod us_states_and_zip {
    use super::*;

    #[test]
    fn lists_the_50_states_and_dc_each_once() {
        let codes: Vec<&str> = US_STATES.iter().map(|s| s.code).collect();
        assert_eq!(codes.len(), 51);
        let mut unique = codes.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 51);
        assert!(codes.contains(&"DC"));
        assert!(codes.contains(&"KY"));
    }

    #[test]
    fn lists_no_territory() {
        for territory in ["PR", "GU", "VI", "AS", "MP", "UM"] {
            assert!(
                !US_STATES.iter().any(|s| s.code == territory),
                "{territory}"
            );
        }
    }

    #[test]
    fn gives_every_state_a_name() {
        assert_eq!(
            US_STATES.iter().find(|s| s.code == "KY").unwrap().name,
            "Kentucky"
        );
        assert!(US_STATES.iter().all(|s| !s.name.is_empty()));
    }

    #[test]
    fn equals_the_contracts_us_state() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../contracts/openapi.yaml");
        let doc: Value = serde_yaml::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let listed: Vec<String> = doc["components"]["schemas"]["UsState"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let ours: Vec<String> = US_STATES.iter().map(|s| s.code.to_string()).collect();
        assert_eq!(ours, listed);
    }

    #[test]
    fn zip_pattern_accepts_5_digits_or_zip_plus_4() {
        for zip in ["40507", "40507-1234"] {
            assert!(is_zip(zip), "{zip}");
        }
    }

    #[test]
    fn zip_pattern_refuses_others() {
        for zip in [
            "4050",
            "405071",
            "40507-123",
            "ABCDE",
            "",
            "40507-",
            "４0507",
            " 40507",
        ] {
            assert!(!is_zip(zip), "{zip}");
        }
    }

    #[test]
    fn the_state_select_offers_choose_a_state_then_each_state() {
        let options = state_options();
        assert_eq!(options.len(), 52);
        assert_eq!(options[0], opts(&[("", "Choose a state")])[0]);
        assert!(options.contains(&opts(&[("KY", "Kentucky (KY)")])[0]));
        assert_eq!(options[9], opts(&[("DC", "District of Columbia (DC)")])[0]);
    }
}

// ------------------------------------------------------------------ venue-address.test.tsx

mod address {
    use super::*;

    #[test]
    fn sends_the_four_fields_and_the_flag_with_no_one_line_address() {
        let (body, layout) = create_of(&mut filled_new());
        assert_eq!(
            body,
            json!({
                "name": "KFC Yum! Center",
                "street": "1 Arena Plaza",
                "city": "Louisville",
                "state": "KY",
                "zip": "40202",
                "acceptUnverifiedAddress": true,
                "timeZone": "America/New_York",
                "seatingCapacity": 22090,
            })
        );
        assert_eq!(layout, None);
    }

    #[test]
    fn refuses_each_missing_field_before_sending_naming_it() {
        type Change = fn(&mut Address);
        let cases: [(Change, &str); 4] = [
            (|a| a.street = String::new(), "Street address is required."),
            (|a| a.city = "   ".into(), "City is required."),
            (|a| a.state = String::new(), "Choose a state."),
            (
                |a| a.zip = "4050".into(),
                "ZIP code must be 5 digits, or 5 digits, a hyphen, and 4 digits.",
            ),
        ];
        for (change, problem) in cases {
            let mut f = filled_new();
            change(&mut f.address);
            assert_eq!(f.save(), None, "{problem}");
            assert_eq!(f.problems, vec![problem.to_string()]);
            assert_eq!(f.name, "KFC Yum! Center");
            assert!(!f.busy);
        }
        assert_eq!(PROBLEMS_TITLE, "Check the address");
    }

    #[test]
    fn names_every_address_problem_in_order() {
        assert_eq!(
            address_problems(&Address::default()),
            vec![
                "Street address is required.",
                "City is required.",
                "Choose a state.",
                "ZIP code must be 5 digits, or 5 digits, a hyphen, and 4 digits.",
            ]
        );
        // The ZIP code is checked trimmed.
        let ok = Address {
            street: "1 A St".into(),
            city: "B".into(),
            state: "KY".into(),
            zip: " 40507 ".into(),
        };
        assert!(address_problems(&ok).is_empty());
    }

    #[test]
    fn sends_a_zip_plus_4_and_trims_the_zip_only() {
        let mut f = filled_new();
        f.address.zip = " 40507-1234 ".into();
        f.address.street = " 1 Arena Plaza ".into();
        let (body, _) = create_of(&mut f);
        assert_eq!(body["zip"], "40507-1234");
        assert_eq!(body["street"], " 1 Arena Plaza ");
    }

    #[test]
    fn a_save_clears_the_last_problems_and_refusal() {
        let mut f = filled_new();
        f.address.city = String::new();
        assert_eq!(f.save(), None);
        f.on_refused(refusal(
            503,
            json!({ "error": { "code": "ADDRESS_SERVICE_UNAVAILABLE", "message": "x" } }),
        ));
        f.address.city = "Louisville".into();
        assert!(f.save().is_some());
        assert!(f.problems.is_empty());
        assert_eq!(f.error, None);
        assert!(f.busy);
    }
}

/// Spec 024 research R6: the notice after a save.
mod notices {
    use super::*;

    const NOT_VERIFIED_NOTICE: &str = "Venue saved, but its address is not verified: 1 Arena Plaza, Louisville, KY 40202. The US address service couldn't confirm it, so check that it's right: customers see this address and its map link. To verify it later, edit the venue and save it, correcting the address if it's wrong. Time zone: Eastern Time, chosen by an admin.";

    #[test]
    fn after_a_not_verified_save_says_so_plainly_why_and_how_to_verify_it() {
        let mut f = filled_new();
        f.save().unwrap();
        let notice = f.on_saved(&not_verified());
        assert_eq!(notice.kind, NoticeKind::Info);
        assert_eq!(notice.kind.as_str(), "info");
        assert_eq!(notice.text, NOT_VERIFIED_NOTICE);
        assert!(!f.busy);
    }

    #[test]
    fn after_a_verified_save_names_the_saved_address_and_zone() {
        let notice = saved_notice(&verified());
        assert_eq!(notice.kind, NoticeKind::Success);
        assert_eq!(notice.kind.as_str(), "success");
        assert_eq!(
            notice.text,
            "Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507. Time zone: Eastern Time, the default."
        );
        assert_eq!(
            saved_notice(&location(json!({ "timeZoneSource": "ADMIN" }))).text,
            "Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507. Time zone: Eastern Time, chosen by an admin."
        );
    }

    #[test]
    fn after_a_legacy_save_says_to_enter_the_four_fields() {
        assert_eq!(
            saved_notice(&legacy()).text,
            "Venue saved, but its address is not verified: 1 Demo Plaza, Louisville, KY. To verify it, edit the venue and enter its street, city, state, and ZIP code. Time zone: Eastern Time, the default."
        );
    }
}

/// Backend refusals: an error banner with the Backend's words; every value kept (V4).
mod refusals {
    use super::*;

    #[test]
    fn shows_each_refusal_in_the_backends_words_keeping_every_value() {
        for (status, body) in [
            (
                400,
                json!({ "error": { "code": "ADDRESS_NOT_FOUND", "message": "We couldn't find 1 Arena Plaza, Louisville, KY 40202 as a US address. Check the street, city, state, and ZIP code.", "details": { "address": "1 Arena Plaza, Louisville, KY 40202" } } }),
            ),
            (
                400,
                json!({ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed.", "details": { "fields": ["name must be between 1 and 200 characters"] } } }),
            ),
            (
                503,
                json!({ "error": { "code": "ADDRESS_SERVICE_UNAVAILABLE", "message": "We can't verify the address right now. Nothing was saved. Try again in a minute." } }),
            ),
        ] {
            let mut f = filled_new();
            f.save().unwrap();
            f.on_refused(refusal(status, body.clone()));
            let banner = refusal_banner(f.error.as_ref().unwrap(), None);
            assert_eq!(banner.message, body["error"]["message"].as_str().unwrap());
            assert_eq!(banner.title, "Could not save");
            assert!(!banner.conflict);
            assert_eq!(f.name, "KFC Yum! Center");
            assert_eq!(f.address.street, "1 Arena Plaza");
            assert_eq!(f.address.zip, "40202");
            assert_eq!(f.seating_capacity, "22090");
            assert!(!f.busy);
        }
    }

    #[test]
    fn lists_a_validation_refusals_fields() {
        let e = refusal(
            400,
            json!({ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed.", "details": { "fields": ["name must be between 1 and 200 characters"] } } }),
        );
        let banner = refusal_banner(&e, None);
        assert_eq!(banner.code.as_deref(), Some("VALIDATION_FAILED"));
        assert_eq!(
            banner.fields,
            vec!["name must be between 1 and 200 characters"]
        );
        assert!(banner.candidates.is_empty());
        assert!(banner.events.is_empty());
    }

    #[test]
    fn lists_address_ambiguous_candidates() {
        let candidates = [
            "100 N MAIN ST, SPRINGFIELD, IL 62701",
            "100 S MAIN ST, SPRINGFIELD, IL 62701",
        ];
        let e = refusal(
            400,
            json!({ "error": { "code": "ADDRESS_AMBIGUOUS", "message": "100 Main St, Springfield, IL 62701 matches more than one US address. Enter one of these.", "details": { "address": "100 Main St, Springfield, IL 62701", "candidates": candidates } } }),
        );
        assert_eq!(refusal_banner(&e, None).candidates, candidates);
    }

    #[test]
    fn lists_the_events_of_time_zone_has_orders_as_links() {
        let e = refusal(
            409,
            json!({ "error": { "code": "TIME_ZONE_HAS_ORDERS", "message": "Can't change the time zone of Rupp Arena: tickets have been sold for 2 of its events. No customer's ticket time may move.", "details": { "timeZone": "America/New_York", "proposedTimeZone": "America/Chicago", "events": [{ "id": "e1", "name": "Fall Concert" }, { "id": "e2", "name": "Gala" }], "eventCount": 2 } } }),
        );
        let banner = refusal_banner(&e, None);
        let links: Vec<(String, String, String)> = banner
            .events
            .iter()
            .map(|l| (l.id.clone(), l.name.clone(), l.href()))
            .collect();
        assert_eq!(
            links,
            vec![
                ("e1".into(), "Fall Concert".into(), "/events/e1".into()),
                ("e2".into(), "Gala".into(), "/events/e2".into()),
            ]
        );
    }

    #[test]
    fn events_of_another_code_are_not_listed() {
        let e = refusal(
            409,
            json!({ "error": { "code": "EVENT_TIME_NOT_IN_ZONE", "message": "Can't change the time zone: Late C's start, Mar 14, 2027, 2:30 AM, doesn't exist in Mountain Time.", "details": { "events": [{ "id": "e1", "name": "X" }] } } }),
        );
        let banner = refusal_banner(&e, None);
        assert!(banner.events.is_empty());
        assert_eq!(banner.code.as_deref(), Some("EVENT_TIME_NOT_IN_ZONE"));
    }

    #[test]
    fn a_scheduling_conflict_has_its_own_look_and_title() {
        let e = refusal(
            409,
            json!({ "error": { "code": "SCHEDULING_CONFLICT", "message": "Can't change the time zone: 'Late B' would start at …", "details": {} } }),
        );
        let banner = refusal_banner(&e, Some("Could not delete"));
        assert!(banner.conflict);
        assert_eq!(banner.title, "Venue already committed");
        assert_eq!(
            banner.message,
            "Can't change the time zone: 'Late B' would start at …"
        );
    }

    #[test]
    fn takes_another_title() {
        let e = refusal(
            409,
            json!({ "error": { "code": "VENUE_HAS_EVENTS", "message": "m" } }),
        );
        assert_eq!(
            refusal_banner(&e, Some("Could not delete")).title,
            "Could not delete"
        );
    }

    #[test]
    fn an_answer_without_the_envelope_reads_as_the_client_says() {
        let e = ApiError::Status(error_from(502, b"<html>Bad gateway</html>"));
        let banner = refusal_banner(&e, None);
        assert_eq!(banner.message, "Request failed with status 502.");
        assert_eq!(banner.code.as_deref(), Some("VALIDATION_FAILED"));
    }

    #[test]
    fn an_edit_load_failure_shows_as_the_banner() {
        let mut f = VenueFormState::edit(ID);
        f.on_load_failed(refusal(
            404,
            json!({ "error": { "code": "NOT_FOUND", "message": "Venue not found." } }),
        ));
        assert_eq!(
            refusal_banner(f.error.as_ref().unwrap(), None).title,
            "Could not save"
        );
    }
}

/// Spec 024 research R3, R4: what a save sends with the address.
mod edit_sends {
    use super::*;

    #[test]
    fn sends_the_flag_with_the_address_on_an_edit_that_changes_it() {
        let mut f = edit_of(verified());
        f.address.street = "1 Nowhere Blvd".into();
        let body = update_of(&mut f);
        assert_eq!(body["street"], "1 Nowhere Blvd");
        assert_eq!(body["acceptUnverifiedAddress"], true);
    }

    #[test]
    fn sends_a_not_verified_venue_its_address_again_with_the_flag() {
        let mut f = edit_of(not_verified());
        let body = update_of(&mut f);
        for (k, v) in [
            ("street", "1 Arena Plaza"),
            ("city", "Louisville"),
            ("state", "KY"),
            ("zip", "40202"),
        ] {
            assert_eq!(body[k], v);
        }
        assert_eq!(body["acceptUnverifiedAddress"], true);
    }

    #[test]
    fn prefills_the_four_fields_and_a_name_edit_sends_none_of_them() {
        let mut f = edit_of(verified());
        assert_eq!(
            f.address,
            Address {
                street: "430 W VINE ST".into(),
                city: "LEXINGTON".into(),
                state: "KY".into(),
                zip: "40507".into(),
            }
        );
        assert_eq!(f.seating_capacity, "20500");
        f.name = "Rupp Arena at Central Bank Center".into();
        assert_eq!(
            update_of(&mut f),
            json!({ "name": "Rupp Arena at Central Bank Center", "seatingCapacity": 20500 })
        );
    }

    #[test]
    fn sends_a_laid_out_verified_venue_its_name_only() {
        let mut f = VenueFormState::edit(ID);
        f.on_loaded(verified());
        f.on_layouts(&[summary("0b0d8e8e-0000-4000-8000-0000000000c1", "L", 20)]);
        assert_eq!(
            f.capacity_field(),
            CapacityField::FromLayouts {
                value: 20,
                hint: "From the largest layout (20 seats)".into()
            }
        );
        assert_eq!(update_of(&mut f), json!({ "name": "Rupp Arena" }));
    }

    #[test]
    fn a_failed_layout_read_leaves_the_capacity_typed_and_sent() {
        let mut f = VenueFormState::edit(ID);
        f.on_loaded(verified());
        f.on_layouts_failed();
        assert_eq!(f.capacity_field(), CapacityField::Typed);
        assert_eq!(update_of(&mut f)["seatingCapacity"], 20500);
    }

    #[test]
    fn ignores_case_extra_spaces_and_the_zip_plus_4_when_comparing() {
        let mut f = edit_of(verified());
        f.address.street = "  430  w vine   st ".into();
        f.address.city = "Lexington".into();
        f.address.zip = "40507-1234".into();
        assert!(!f.address_changed());
        assert_eq!(
            update_of(&mut f),
            json!({ "name": "Rupp Arena", "seatingCapacity": 20500 })
        );
        f.address.state = "OH".into();
        assert!(f.address_changed());
    }

    #[test]
    fn compares_with_no_venue_or_a_legacy_one_as_all_blank() {
        let blank = Address {
            street: " ".into(),
            ..Address::default()
        };
        assert!(same_as_stored(&blank, None));
        assert!(same_as_stored(&blank, Some(&legacy())));
        let typed = Address {
            city: "x".into(),
            ..Address::default()
        };
        assert!(!same_as_stored(&typed, Some(&legacy())));
        assert!(!same_as_stored(&typed, None));
    }
}

/// Parity V9: venues whose address is not verified.
mod not_verified_venues {
    use super::*;

    #[test]
    fn shows_a_legacy_venue_its_old_address_above_empty_fields_and_sends_no_address() {
        let mut f = edit_of(legacy());
        assert!(f.legacy());
        assert_eq!(
            f.address_note().as_deref(),
            Some(
                "Current address (not verified): 1 Demo Plaza, Louisville, KY. Enter it below to verify it."
            )
        );
        assert_eq!(f.address, Address::default());
        assert_eq!(f.name, "Demo Arena");
        f.name = "Demo Arena II".into();
        assert_eq!(
            update_of(&mut f),
            json!({ "name": "Demo Arena II", "seatingCapacity": 20500 })
        );
    }

    #[test]
    fn sends_a_legacy_venue_its_filled_in_fields_the_flag_and_the_zone_shown() {
        let mut f = edit_of(legacy());
        let records = "Saving records Eastern Time as chosen by an admin.";
        assert!(!hint_texts(&f).contains(&records.to_string()));
        f.address = Address {
            street: "937 Phillips Ln".into(),
            city: "Louisville".into(),
            state: "KY".into(),
            zip: "40209".into(),
        };
        assert!(hint_texts(&f).contains(&records.to_string()));
        assert_eq!(
            update_of(&mut f),
            json!({
                "name": "Demo Arena",
                "street": "937 Phillips Ln",
                "city": "Louisville",
                "state": "KY",
                "zip": "40209",
                "acceptUnverifiedAddress": true,
                "timeZone": "America/New_York",
                "seatingCapacity": 20500,
            })
        );
    }

    #[test]
    fn requires_all_four_once_a_legacy_venue_address_field_is_filled_in() {
        let mut f = edit_of(legacy());
        f.address.street = "937 Phillips Ln".into();
        assert_eq!(f.save(), None);
        assert_eq!(
            f.problems,
            vec![
                "City is required.",
                "Choose a state.",
                "ZIP code must be 5 digits, or 5 digits, a hyphen, and 4 digits.",
            ]
        );
    }

    #[test]
    fn says_a_saved_anyway_venue_is_not_verified_and_that_saving_checks_it_again() {
        let f = edit_of(saved_anyway());
        assert!(!f.legacy());
        assert_eq!(f.address_note().as_deref(), Some(UNVERIFIED_NOTE));
        assert_eq!(
            UNVERIFIED_NOTE,
            "This address is not verified. Saving checks it again."
        );
        assert_eq!(f.address.street, "1 Arena Plaza");
        assert_eq!(edit_of(verified()).address_note(), None);
        assert_eq!(VenueFormState::new_venue().address_note(), None);
    }
}

// ------------------------------------------------------------------ venue-create.test.tsx

mod seated_new_venue {
    use super::*;

    fn seated() -> VenueFormState {
        let mut f = filled_new();
        f.name = "Seat Hall".into();
        f.address = Address {
            street: "1 Seat St".into(),
            city: "Louisville".into(),
            state: "KY".into(),
            zip: "40202".into(),
        };
        f.seating_capacity = String::new();
        f.kind = SeatingKind::Seated;
        f
    }

    fn add(f: &mut VenueFormState, name: &str, rows: &str, seats: &str) {
        f.seating.add_section();
        let i = f.seating.lines.len() - 1;
        f.seating.set_line_name(i, name);
        f.seating.set_line_rows(i, rows);
        f.seating.set_line_seats_per_row(i, seats);
    }

    #[test]
    fn starts_as_general_admission_asking_for_a_capacity() {
        let f = VenueFormState::new_venue();
        assert_eq!(f.kind, SeatingKind::General);
        assert_eq!(f.capacity_field(), CapacityField::Typed);
        assert_eq!(
            CAPACITY_HINT,
            "An event scheduled here cannot sell more tickets than this. A seating layout, once added on the venue page, sets it instead."
        );
    }

    #[test]
    fn replaces_the_capacity_with_sections_and_their_total_when_seated() {
        let mut f = seated();
        add(&mut f, "A", "3", "10");
        add(&mut f, "B", "2", "20");
        assert_eq!(seats_text(line_seats(&f.seating.lines[0])), "= 30 seats");
        assert_eq!(seats_text(line_seats(&f.seating.lines[1])), "= 40 seats");
        assert_eq!(
            f.capacity_field(),
            CapacityField::Lines {
                total: "Total: 70 seats".into()
            }
        );
        f.seating.remove_section(0);
        assert_eq!(
            f.capacity_field(),
            CapacityField::Lines {
                total: "Total: 40 seats".into()
            }
        );
    }

    #[test]
    fn starts_its_lines_with_the_standard_level() {
        let f = seated();
        assert_eq!(FIRST_LAYOUT, "Standard");
        assert_eq!(first_level(), level("Standard", LevelColor::Violet));
        assert_eq!(f.seating.name, "Standard");
        assert_eq!(f.seating.levels, vec![first_level()]);
        assert!(f.seating.lines.is_empty());
    }

    #[test]
    fn creates_the_venue_with_the_total_then_its_standard_layout() {
        let mut f = seated();
        add(&mut f, "A", "3", "10");
        add(&mut f, "B", "2", "20");
        let (body, layout) = create_of(&mut f);
        assert_eq!(
            body,
            json!({
                "name": "Seat Hall",
                "street": "1 Seat St",
                "city": "Louisville",
                "state": "KY",
                "zip": "40202",
                "acceptUnverifiedAddress": true,
                "timeZone": "America/New_York",
                "seatingCapacity": 70,
            })
        );
        assert_eq!(
            layout,
            Some(json!({
                "name": "Standard",
                "levels": [{ "name": "Standard", "color": "violet" }],
                "sections": [
                    { "name": "A", "rows": 3, "seatsPerRow": 10, "level": "Standard" },
                    { "name": "B", "rows": 2, "seatsPerRow": 20, "level": "Standard" },
                ],
            }))
        );
    }

    #[test]
    fn says_so_with_a_way_to_the_venue_when_the_layout_is_refused() {
        let mut f = seated();
        add(&mut f, "A", "1", "5");
        add(&mut f, "a", "1", "5");
        f.save().unwrap();
        let venue = location(json!({ "addressVerified": true }));
        f.on_layout_refused(
            &venue,
            refusal(400, json!({ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed." } })),
        );
        let refused = f.layout_refused.clone().unwrap();
        assert_eq!(refused.message, "Request validation failed.");
        assert_eq!(refused.href, format!("/locations/{ID}"));
        assert_eq!(refused.not_verified, None);
        assert_eq!(LAYOUT_REFUSED_TITLE, "Seating layout not saved");
        assert_eq!(
            LAYOUT_REFUSED_TEXT,
            "The venue was created without its seating layout."
        );
        assert_eq!(LAYOUT_REFUSED_LINK, "Add the layout on its page");
        assert!(!f.busy);
        // The form keeps its values.
        assert_eq!(f.seating.lines.len(), 2);
        // A new save clears the banner.
        f.save();
        assert_eq!(f.layout_refused, None);
    }

    #[test]
    fn says_the_address_is_not_verified_beside_seating_layout_not_saved() {
        let mut f = seated();
        f.seating.add_section();
        f.save().unwrap();
        f.on_layout_refused(
            &not_verified(),
            refusal(400, json!({ "error": { "code": "VALIDATION_FAILED", "message": "section names must be unique" } })),
        );
        assert_eq!(
            f.layout_refused.unwrap().not_verified.as_deref(),
            Some(
                "Its address is saved but not verified: 1 Arena Plaza, Louisville, KY 40202. The US address service couldn't confirm it, so check that it's right."
            )
        );
    }

    #[test]
    fn keeps_general_admission_the_typed_capacity_and_no_layout_request() {
        let mut f = seated();
        f.kind = SeatingKind::General;
        f.seating_capacity = "500".into();
        let (body, layout) = create_of(&mut f);
        assert_eq!(body["seatingCapacity"], 500);
        assert_eq!(layout, None);
    }

    #[test]
    fn a_seated_venue_with_no_lines_still_asks_for_its_layout() {
        // The React app sends capacity 0 and the Backend refuses it (V4); nothing is checked here.
        let mut f = seated();
        match f.save().unwrap() {
            SaveRequest::Create { body, layout } => {
                assert_eq!(body["seatingCapacity"], 0);
                assert_eq!(layout.unwrap()["sections"], json!([]));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_edit_never_sends_lines() {
        let mut f = edit_of(verified());
        f.kind = SeatingKind::Seated;
        assert!(matches!(f.capacity_field(), CapacityField::Typed));
        assert_eq!(update_of(&mut f)["seatingCapacity"], 20500);
    }
}

// ------------------------------------------------------------------ venue-time-zone.test.tsx

const ZONES: [&str; 8] = [
    "Eastern Time",
    "Central Time",
    "Mountain Time",
    "Arizona Time (no daylight saving)",
    "Pacific Time",
    "Alaska Time",
    "Hawaii-Aleutian Time",
    "Hawaii Time",
];
const RECORDS_ADMIN: &str = "Saving records Eastern Time as chosen by an admin.";

mod new_venue_zone {
    use super::*;

    #[test]
    fn offers_choose_a_time_zone_and_the_eight_zones() {
        let f = VenueFormState::new_venue();
        let labels: Vec<String> = f.zone_options().into_iter().map(|o| o.label).collect();
        let mut expected = vec!["Choose a time zone".to_string()];
        expected.extend(ZONES.iter().map(|z| z.to_string()));
        assert_eq!(labels, expected);
        assert_eq!(f.zone_options()[0].value, "");
        assert_eq!(f.zone_options()[1].value, "America/New_York");
        assert_eq!(f.zone_choice, "");
        assert_eq!(hint_texts(&f), vec![NEW_ZONE_HINT]);
        assert_eq!(
            NEW_ZONE_HINT,
            "Event times at this venue are shown and entered in this zone."
        );
        assert_eq!(f.zone_described_by().as_deref(), Some("timeZone-hint"));
        assert!(!f.zone_invalid());
    }

    #[test]
    fn sends_nothing_without_a_zone_says_so_by_the_field_and_sends_the_zone_once_chosen() {
        let mut f = filled_new();
        f.zone_choice = String::new();
        assert_eq!(f.save(), None);
        assert_eq!(f.zone_problem.as_deref(), Some(ZONE_REQUIRED));
        assert_eq!(ZONE_REQUIRED, "Choose the venue's time zone.");
        assert!(f.zone_invalid());
        let hints = f.zone_hints();
        assert_eq!(hints[0].id, "timeZone-problem");
        assert!(hints[0].alert);
        assert!(!hints[1].alert);
        assert_eq!(
            f.zone_described_by().as_deref(),
            Some("timeZone-problem timeZone-hint")
        );
        assert_eq!(hint_texts(&f), vec![ZONE_REQUIRED, NEW_ZONE_HINT]);
        assert_eq!(f.name, "KFC Yum! Center");
        assert_eq!(f.seating_capacity, "22090");

        f.choose_zone("America/Chicago");
        assert_eq!(f.zone_problem, None);
        assert!(!f.zone_invalid());
        let (body, _) = create_of(&mut f);
        assert_eq!(body["timeZone"], "America/Chicago");
    }

    #[test]
    fn names_the_zone_problem_and_the_address_problems_in_the_same_press() {
        let mut f = filled_new();
        f.zone_choice = String::new();
        f.address.zip = "4050".into();
        assert_eq!(f.save(), None);
        assert_eq!(f.zone_problem.as_deref(), Some(ZONE_REQUIRED));
        assert_eq!(
            f.problems,
            vec!["ZIP code must be 5 digits, or 5 digits, a hyphen, and 4 digits."]
        );
    }

    #[test]
    fn names_the_zone_and_its_source_in_the_saved_notice() {
        let mut f = filled_new();
        f.save().unwrap();
        assert_eq!(
            f.on_saved(&location(json!({ "timeZoneSource": "ADMIN" })))
                .text,
            "Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507. Time zone: Eastern Time, chosen by an admin."
        );
    }

    #[test]
    fn titles_and_buttons() {
        let mut f = filled_new();
        assert_eq!(f.title(), "New venue");
        assert_eq!(f.submit_label(), "Create venue");
        f.save();
        assert_eq!(f.submit_label(), "Saving…");
        let e = edit_of(verified());
        assert_eq!(e.title(), "Edit venue");
        assert_eq!(e.submit_label(), "Save changes");
    }
}

mod edit_venue_zone {
    use super::*;

    #[test]
    fn starts_on_the_stored_zone_says_how_it_was_set_and_offers_only_the_eight() {
        let f = edit_of(tz_venue());
        let labels: Vec<String> = f.zone_options().into_iter().map(|o| o.label).collect();
        assert_eq!(labels, ZONES);
        assert_eq!(f.zone_choice, "America/New_York");
        assert_eq!(hint_texts(&f), vec!["Eastern Time, from the address."]);
        assert_eq!(f.zone_described_by().as_deref(), Some("timeZone-stored"));
    }

    #[test]
    fn says_an_address_change_does_not_change_the_zone_and_that_saving_records_it() {
        let mut f = edit_of(tz_venue());
        f.address.city = "Louisville".into();
        assert_eq!(
            hint_texts(&f),
            vec![
                "Eastern Time, from the address.",
                ADDRESS_ZONE_HINT,
                RECORDS_ADMIN
            ]
        );
        assert_eq!(
            f.zone_described_by().as_deref(),
            Some("timeZone-stored timeZone-address timeZone-records")
        );
        f.address.city = "LEXINGTON".into();
        assert_eq!(hint_texts(&f), vec!["Eastern Time, from the address."]);
        assert_eq!(
            ADDRESS_ZONE_HINT,
            "Changing the address doesn't change the time zone. Choose another zone here if the venue is in a different one."
        );
    }

    #[test]
    fn on_a_zone_an_admin_chose_says_only_that_the_address_does_not_change_it() {
        let mut f = edit_of(location(json!({ "timeZoneSource": "ADMIN" })));
        f.address.city = "Louisville".into();
        assert_eq!(
            hint_texts(&f),
            vec!["Eastern Time, chosen by an admin.", ADDRESS_ZONE_HINT]
        );
    }

    #[test]
    fn a_venue_with_no_zone_stored_starts_on_eastern() {
        // The contract requires `timeZone`; the form's `?? DEFAULT_TIME_ZONE` still applies.
        let f = edit_of(tz_venue());
        assert_eq!(f.stored_zone(), "America/New_York");
    }
}

mod what_an_edit_sends {
    use super::*;

    #[test]
    fn a_verified_venue_name_only_neither_the_address_nor_the_zone() {
        let mut f = edit_of(tz_venue());
        f.name = "Rupp Arena II".into();
        assert_eq!(
            update_of(&mut f),
            json!({ "name": "Rupp Arena II", "seatingCapacity": 20500 })
        );
    }

    #[test]
    fn a_verified_venue_street_changed_the_four_fields_the_flag_and_the_zone_shown() {
        let mut f = edit_of(tz_venue());
        f.address.street = "431 W Vine St".into();
        assert_eq!(
            update_of(&mut f),
            json!({
                "name": "Rupp Arena",
                "street": "431 W Vine St",
                "city": "LEXINGTON",
                "state": "KY",
                "zip": "40507",
                "acceptUnverifiedAddress": true,
                "timeZone": "America/New_York",
                "seatingCapacity": 20500,
            })
        );
    }

    #[test]
    fn a_not_verified_venue_name_only_the_four_fields_as_loaded_the_flag_and_the_zone() {
        let mut f = edit_of(location(
            json!({ "addressVerified": false, "timeZoneSource": "STATE" }),
        ));
        assert!(hint_texts(&f).contains(&RECORDS_ADMIN.to_string()));
        f.name = "Rupp Arena II".into();
        assert_eq!(
            update_of(&mut f),
            json!({
                "name": "Rupp Arena II",
                "street": "430 W VINE ST",
                "city": "LEXINGTON",
                "state": "KY",
                "zip": "40507",
                "acceptUnverifiedAddress": true,
                "timeZone": "America/New_York",
                "seatingCapacity": 20500,
            })
        );
    }

    #[test]
    fn any_venue_zone_changed_the_new_zone_with_the_zone_change_note() {
        let mut f = edit_of(tz_venue());
        assert!(!hint_texts(&f).contains(&ZONE_CHANGE_NOTE.to_string()));
        f.choose_zone("America/Chicago");
        assert!(hint_texts(&f).contains(&ZONE_CHANGE_NOTE.to_string()));
        assert_eq!(
            ZONE_CHANGE_NOTE,
            "Changing the time zone keeps each event's local time (7:00 PM stays 7:00 PM), so their times move. Not possible once tickets are sold."
        );
        assert_eq!(f.zone_hints().last().map(|h| h.id), Some("timeZone-change"));
        assert_eq!(
            update_of(&mut f),
            json!({ "name": "Rupp Arena", "timeZone": "America/Chicago", "seatingCapacity": 20500 })
        );
    }

    #[test]
    fn a_typed_capacity_is_sent_as_number_reads_it() {
        let mut f = edit_of(tz_venue());
        f.seating_capacity = " 300 ".into();
        assert_eq!(update_of(&mut f)["seatingCapacity"], 300);
        f.seating_capacity = "abc".into();
        match f.save().unwrap() {
            SaveRequest::Update { body, .. } => assert_eq!(body["seatingCapacity"], Value::Null),
            other => panic!("{other:?}"),
        }
    }
}

mod zone_change_note {
    use super::*;

    #[test]
    fn is_not_shown_on_a_venue_without_events() {
        let mut f = edit_of(tz_venue());
        f.choose_zone("America/Chicago");
        // Until the venue's events load, the note is shown.
        assert!(hint_texts(&f).contains(&ZONE_CHANGE_NOTE.to_string()));
        f.set_has_events(Some(false));
        assert!(!hint_texts(&f).contains(&ZONE_CHANGE_NOTE.to_string()));
    }

    #[test]
    fn is_shown_on_a_venue_with_events_or_when_they_could_not_be_read() {
        let mut f = edit_of(tz_venue());
        f.choose_zone("America/Chicago");
        f.set_has_events(Some(true));
        assert!(hint_texts(&f).contains(&ZONE_CHANGE_NOTE.to_string()));
        f.set_has_events(None);
        assert!(hint_texts(&f).contains(&ZONE_CHANGE_NOTE.to_string()));
    }

    #[test]
    fn keeps_every_value_after_a_zone_change_refusal() {
        let mut f = edit_of(tz_venue());
        f.choose_zone("America/Chicago");
        f.save().unwrap();
        f.on_refused(refusal(
            409,
            json!({ "error": { "code": "EVENT_TIME_NOT_IN_ZONE", "message": "m", "details": {} } }),
        ));
        assert_eq!(f.zone_choice, "America/Chicago");
        assert_eq!(f.name, "Rupp Arena");
        assert_eq!(
            f.error.as_ref().unwrap().code(),
            Some("EVENT_TIME_NOT_IN_ZONE")
        );
    }
}

#[test]
fn the_seated_lines_use_the_same_level_colors_as_the_contract() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../contracts/openapi.yaml");
    let doc: Value = serde_yaml::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let listed = doc["components"]["schemas"]["LevelColor"]["enum"].clone();
    let ours: Vec<String> = LEVEL_COLORS.iter().map(|c| c.to_string()).collect();
    assert_eq!(json!(ours), listed);
}
