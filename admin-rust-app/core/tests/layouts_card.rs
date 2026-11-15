//! Spec 037 T042: the venue page's Layouts card, ported test first from
//! `admin-app/test/layouts-card.test.tsx` (spec 038 US1, spec 039; parity M1–M5, M7) and
//! `admin-app/src/components/LayoutsCard.tsx`: the summary line, the import's checks and its
//! problem list, the bodies each action sends (checked against `contracts/openapi.yaml`), and the
//! venue's capacity from its largest layout. Expected strings are the React app's.

#[path = "fixtures/venue/contract.rs"]
mod contract;

use admin_rust_core::api::client::{ApiError, error_from};
use admin_rust_core::api::types::LayoutSummary;
use admin_rust_core::forms::layouts::{
    IMPORT_HINT, IMPORT_TITLE, ImportError, LOCKED_NOTE, MAX_IMPORT_BYTES, NAME_MAX_LENGTH,
    SAVE_LAYOUT_TITLE, UNREACHABLE, as_api_error, capacity_note, change_title, check_import_size,
    count_text, delete_confirm, duplicate_body, editor_link, import_problems, largest_capacity,
    lines_form_label, new_layout_href, parse_import, rename_body, summary_line, takes_lines,
};
use admin_rust_core::forms::section_lines::LinesDraft;
use admin_rust_core::forms::venue::refusal_banner;
use serde_json::{Value, json};

const VENUE: &str = "6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e";
const BB: &str = "0b0d8e8e-0000-4000-8000-0000000000b1";
const CLUB: &str = "0b0d8e8e-0000-4000-8000-0000000000c1";

fn summary(over: Value) -> LayoutSummary {
    let mut v = json!({
        "locationId": VENUE,
        "source": "FILE",
        "floorKind": "COURT",
        "seatCount": 100,
        "sectionCount": 1,
        "levelCount": 1,
        "eventsUsing": 0,
        "locked": false,
    });
    for (k, val) in over.as_object().unwrap() {
        v[k] = val.clone();
    }
    serde_json::from_value(v).expect("a LayoutSummary")
}

fn basketball() -> LayoutSummary {
    summary(json!({
        "id": BB, "name": "Basketball", "seatCount": 22090, "sectionCount": 54,
        "levelCount": 4, "eventsUsing": 2, "locked": true,
    }))
}

fn club() -> LayoutSummary {
    summary(json!({
        "id": CLUB, "name": "Club room", "source": "LINES", "floorKind": "NONE",
        "seatCount": 400, "sectionCount": 2, "levelCount": 2,
    }))
}

fn refusal(status: u16, body: Value) -> ApiError {
    ApiError::Status(error_from(status, body.to_string().as_bytes()))
}

fn small_layout() -> Vec<u8> {
    std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/venue/small-layout.json"
    ))
    .unwrap()
}

mod summary_line_m1 {
    use super::*;

    #[test]
    fn lists_seats_sections_levels_and_events_grouped() {
        assert_eq!(
            summary_line(&basketball()),
            "22,090 seats · 54 sections · 4 price levels · used by 2 events"
        );
        assert_eq!(
            summary_line(&club()),
            "400 seats · 2 sections · 2 price levels · used by 0 events"
        );
    }

    #[test]
    fn is_singular_at_one() {
        let one = summary(json!({ "id": CLUB, "name": "One", "seatCount": 1, "eventsUsing": 1 }));
        assert_eq!(
            summary_line(&one),
            "1 seat · 1 section · 1 price level · used by 1 event"
        );
    }

    #[test]
    fn counts_as_count_does() {
        assert_eq!(count_text(0.0, "seat", None), "0 seats");
        assert_eq!(count_text(1.0, "seat", None), "1 seat");
        assert_eq!(count_text(1234567.0, "seat", None), "1,234,567 seats");
        assert_eq!(count_text(2.0, "child", Some("children")), "2 children");
        assert_eq!(count_text(1.0, "child", Some("children")), "1 child");
    }

    #[test]
    fn notes_a_lock_without_naming_an_event() {
        assert_eq!(LOCKED_NOTE, "Locked: seats are sold or held");
    }
}

mod import_m2 {
    use super::*;

    #[test]
    fn has_its_hint_and_limit() {
        assert_eq!(MAX_IMPORT_BYTES, 4_194_304);
        assert_eq!(
            IMPORT_HINT,
            "A layout file (JSON, format 1) of up to 4 MB: its sections, rows, seats and price levels."
        );
    }

    #[test]
    fn refuses_a_file_over_4_mb_before_reading_it() {
        assert_eq!(
            check_import_size("big.json", 4_194_305),
            Err(ImportError::Local("big.json is larger than 4 MB.".into()))
        );
        assert_eq!(check_import_size("big.json", 4_194_304), Ok(()));
    }

    #[test]
    fn says_a_file_that_is_not_json_is_not_a_layout_file() {
        for text in ["not json", "", "{\"format\":1", "{'a':1}"] {
            assert_eq!(
                parse_import("notes.txt", text.as_bytes()),
                Err(ImportError::Local(
                    "notes.txt is not a layout file: it is not JSON.".into()
                )),
                "{text:?}"
            );
        }
    }

    #[test]
    fn sends_the_file_as_it_reads() {
        let file = json!({ "format": 1, "name": "Basketball", "sections": [] });
        assert_eq!(
            parse_import("basketball.json", file.to_string().as_bytes()),
            Ok(json!({ "file": file }))
        );
    }

    #[test]
    fn sends_any_json_value_as_json_parse_reads_it() {
        assert_eq!(parse_import("a.json", b" 5 "), Ok(json!({ "file": 5 })));
        assert_eq!(parse_import("a.json", b"null"), Ok(json!({ "file": null })));
        // `File.text()` drops a byte order mark.
        assert_eq!(
            parse_import("a.json", "\u{feff}{\"a\":1}".as_bytes()),
            Ok(json!({ "file": { "a": 1 } }))
        );
    }

    #[test]
    fn a_real_layout_file_makes_a_body_the_contract_takes() {
        let body = parse_import("small.json", &small_layout()).unwrap();
        assert_eq!(body["file"]["name"], "Small court");
        contract::assert_valid("LayoutImport", &body);
    }

    #[test]
    fn lists_every_problem_of_a_refused_file_and_how_many_more() {
        let e = refusal(
            400,
            json!({ "error": {
            "code": "LAYOUT_FILE_INVALID",
            "message": "The layout file has 2 problems; nothing was saved.",
            "details": { "problems": [
                { "path": "file.sections[0].rows[0].seats[2]", "message": "Section 104, row F: seat 7 appears twice" },
                { "path": "file.sections[1].level", "message": "Section 104: level \"upper\" is not in the file" },
            ], "more": 3 },
        } }),
        );
        let shown = import_problems(&ImportError::Api(e));
        assert_eq!(shown.title, IMPORT_TITLE);
        assert_eq!(IMPORT_TITLE, "Could not import the layout");
        assert_eq!(
            shown.message,
            "The layout file has 2 problems; nothing was saved."
        );
        assert_eq!(
            shown.problems,
            vec![
                "Section 104, row F: seat 7 appears twice (file.sections[0].rows[0].seats[2])",
                "Section 104: level \"upper\" is not in the file (file.sections[1].level)",
                "and 3 more",
            ]
        );
        assert!(shown.fields.is_empty());
    }

    #[test]
    fn says_no_more_when_there_are_none() {
        let e = refusal(
            400,
            json!({ "error": {
            "code": "LAYOUT_FILE_INVALID", "message": "m",
            "details": { "problems": [{ "path": "file.name", "message": "Name is required" }], "more": 0 },
        } }),
        );
        assert_eq!(
            import_problems(&ImportError::Api(e)).problems,
            vec!["Name is required (file.name)"]
        );
    }

    #[test]
    fn lists_a_validation_refusals_fields_under_the_import_too() {
        let e = refusal(
            400,
            json!({ "error": {
            "code": "VALIDATION_FAILED",
            "message": "Request validation failed.",
            "details": { "fields": ["name must be 1 to 50 characters"] },
        } }),
        );
        let shown = import_problems(&ImportError::Api(e));
        assert_eq!(shown.message, "Request validation failed.");
        assert_eq!(shown.fields, vec!["name must be 1 to 50 characters"]);
        assert!(shown.problems.is_empty());
    }

    #[test]
    fn shows_only_the_message_of_any_other_refusal() {
        let e = refusal(
            409,
            json!({ "error": {
            "code": "LAYOUT_NAME_TAKEN", "message": "Yum Center already has a layout named \"Basketball\".",
            "details": { "problems": [{ "path": "p", "message": "m" }], "fields": ["f"], "more": 2 },
        } }),
        );
        let shown = import_problems(&ImportError::Api(e));
        assert_eq!(
            shown.message,
            "Yum Center already has a layout named \"Basketball\"."
        );
        assert!(shown.problems.is_empty());
        assert!(shown.fields.is_empty());
    }

    #[test]
    fn shows_a_local_problem_as_its_message() {
        let shown = import_problems(&ImportError::Local(
            "notes.txt is not a layout file: it is not JSON.".into(),
        ));
        assert_eq!(shown.title, "Could not import the layout");
        assert_eq!(
            shown.message,
            "notes.txt is not a layout file: it is not JSON."
        );
        assert!(shown.problems.is_empty() && shown.fields.is_empty());
    }

    #[test]
    fn says_it_cannot_reach_the_service_when_nothing_answers() {
        assert_eq!(UNREACHABLE, "Can't reach the QueuePass service.");
        let e = as_api_error(ApiError::Unreachable);
        assert_eq!(e.code(), Some("VALIDATION_FAILED"));
        assert_eq!(e.status(), Some(0));
        assert_eq!(e.message(), UNREACHABLE);
        assert_eq!(import_problems(&ImportError::Api(e)).message, UNREACHABLE);
        assert_eq!(
            as_api_error(ApiError::Decode("x".into())).message(),
            UNREACHABLE
        );
        let kept = refusal(
            409,
            json!({ "error": { "code": "LAYOUT_IN_USE", "message": "m" } }),
        );
        assert_eq!(as_api_error(kept.clone()), kept);
    }
}

mod lines_form_m3 {
    use super::*;

    #[test]
    fn names_each_form() {
        assert_eq!(lines_form_label(None), "New layout from section lines");
        assert_eq!(
            lines_form_label(Some("Club room")),
            "Section lines of Club room"
        );
        assert_eq!(SAVE_LAYOUT_TITLE, "Could not save the layout");
        assert_eq!(NAME_MAX_LENGTH, 50);
    }

    #[test]
    fn makes_a_layout_from_section_lines_with_level_names_and_a_level_for_each_section() {
        let mut d = LinesDraft::new_layout();
        d.set_name("Club room");
        d.rename_level(0, "Front");
        d.add_level();
        d.rename_level(1, "Back");
        d.set_level_color(1, "teal".parse().unwrap());
        for (name, level) in [("Floor A", "Front"), ("Floor B", "Back")] {
            d.add_section();
            let i = d.lines.len() - 1;
            d.set_line_name(i, name);
            d.set_line_rows(i, "10");
            d.set_line_seats_per_row(i, "20");
            d.set_line_level(i, level);
        }
        let body = d.to_lines_input();
        assert_eq!(
            body,
            json!({
                "name": "Club room",
                "levels": [{ "name": "Front", "color": "violet" }, { "name": "Back", "color": "teal" }],
                "sections": [
                    { "name": "Floor A", "rows": 10, "seatsPerRow": 20, "level": "Front" },
                    { "name": "Floor B", "rows": 10, "seatsPerRow": 20, "level": "Back" },
                ],
            })
        );
        contract::assert_valid("LayoutLinesInput", &body);
    }

    #[test]
    fn offers_lines_only_for_a_lines_layout_whose_detail_loaded() {
        assert!(takes_lines(&club(), true));
        assert!(!takes_lines(&club(), false));
        assert!(!takes_lines(&basketball(), true));
        let drawn = summary(json!({ "id": CLUB, "name": "Drawn bowl", "source": "DRAWN" }));
        assert!(!takes_lines(&drawn, true));
    }

    #[test]
    fn shows_a_refusal_in_the_backends_words() {
        let e = refusal(
            409,
            json!({ "error": { "code": "LAYOUT_IN_USE", "message": "Club room is used by \"Season Opener\", which has sold or held seats. Duplicate it to make changes." } }),
        );
        let banner = refusal_banner(&e, Some(SAVE_LAYOUT_TITLE));
        assert_eq!(banner.title, "Could not save the layout");
        assert_eq!(
            banner.message,
            "Club room is used by \"Season Opener\", which has sold or held seats. Duplicate it to make changes."
        );
    }
}

#[test]
fn the_contract_check_refuses_what_the_contract_refuses() {
    assert!(!contract::problems("LayoutUpdate", &json!({})).is_empty());
    assert!(!contract::problems("LayoutUpdate", &rename_body("  ")).is_empty());
    assert!(!contract::problems("LayoutImport", &json!({ "file": 5 })).is_empty());
    assert!(!contract::problems("LocationInput", &json!({ "name": "x" })).is_empty());
}

mod rename_duplicate_delete_m4 {
    use super::*;

    #[test]
    fn renames_with_the_name_trimmed() {
        let body = rename_body(" Club room (VIP) ");
        assert_eq!(body, json!({ "name": "Club room (VIP)" }));
        contract::assert_valid("LayoutUpdate", &body);
    }

    #[test]
    fn duplicates_with_an_empty_body() {
        assert_eq!(duplicate_body(), json!({}));
        contract::assert_valid("LayoutDuplicate", &duplicate_body());
    }

    #[test]
    fn confirms_a_delete_naming_the_layout() {
        assert_eq!(
            delete_confirm("Basketball"),
            "Delete the layout \"Basketball\"? This can't be undone."
        );
    }

    #[test]
    fn titles_a_refusal_with_the_layouts_name() {
        assert_eq!(change_title("Club room"), "Could not change Club room");
        let e = refusal(
            409,
            json!({ "error": { "code": "LAYOUT_NAME_TAKEN", "message": "Yum Center already has a layout named \"Basketball\"." } }),
        );
        let banner = refusal_banner(&e, Some(&change_title("Club room")));
        assert_eq!(banner.title, "Could not change Club room");
        assert_eq!(
            banner.message,
            "Yum Center already has a layout named \"Basketball\"."
        );
    }
}

mod editor_links_m5 {
    use super::*;

    #[test]
    fn offers_new_layout_into_the_editor() {
        assert_eq!(
            new_layout_href(VENUE),
            format!("/locations/{VENUE}/layouts/new")
        );
    }

    #[test]
    fn an_unlocked_layout_has_edit_a_locked_one_view_both_into_the_editor() {
        let edit = editor_link(&club());
        assert_eq!(edit.text, "Edit");
        assert_eq!(edit.label, "Edit Club room");
        assert_eq!(edit.href, format!("/locations/{VENUE}/layouts/{CLUB}/edit"));
        let view = editor_link(&basketball());
        assert_eq!(view.text, "View");
        assert_eq!(view.label, "View Basketball");
        assert_eq!(view.href, format!("/locations/{VENUE}/layouts/{BB}/edit"));
    }
}

mod capacity_m7 {
    use super::*;

    #[test]
    fn is_the_largest_layouts_seats() {
        assert_eq!(largest_capacity(&[basketball(), club()]), Some(22090));
        assert_eq!(largest_capacity(&[club(), basketball()]), Some(22090));
        assert_eq!(largest_capacity(&[]), None);
    }

    #[test]
    fn reads_from_the_largest_layout() {
        assert_eq!(
            capacity_note(22090),
            "From the largest layout (22,090 seats)"
        );
        // Quirk kept: always "seats".
        assert_eq!(capacity_note(1), "From the largest layout (1 seats)");
    }
}
