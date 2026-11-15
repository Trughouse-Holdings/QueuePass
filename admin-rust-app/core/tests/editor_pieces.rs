//! Spec 037 research R14 (T073): the pure pieces the React editor keeps inside its components,
//! moved into `core::editor::{draft, save, view}`. Each case is a logic case of
//! `admin-app/test/layout-editor/`: `AddSectionForm.test.tsx` (`readDraft`, the First-row reset,
//! LE13–LE16), `SaveBar.test.tsx` (`missingParts`, the warnings, the refusals, LE68–LE79),
//! `SelectionPanel.test.tsx` (the confirm texts, LE54, LE57, LE58), `SectionSeatsView.test.tsx`
//! (`seatsInBox`, row-label ends, LE44–LE47), `EditorCanvas.test.tsx` (`mapFit`, turn snapping,
//! handle and box placement, the floor stretch, LE22–LE32), `LevelsPanel.test.tsx`,
//! `level-picker.test.tsx` (LE37–LE43, LE48), `guide.test.tsx` (LE10, LE11), `keyboard.test.tsx`
//! (LE51, LE59–LE61), and `LayoutEditor.test.tsx` (`listed`, the title, LE3–LE9, LE75). Then
//! parity: `readDraft`, `regeneratePlan`, and the number box's display on the TypeScript's own
//! outputs (`tests/fixtures/editor/`).

use std::{fs, path::PathBuf, sync::Arc};

use admin_rust_core::api::client::{ApiError, error_from};
use admin_rust_core::editor::doc::{EditorDoc, FloorKind, empty_doc, from_drawing};
use admin_rust_core::editor::draft::{
    BlockDraft, CURVES, DraftField, ReadDraftOptions, draft_of, new_block, read_draft,
    seats_left_note,
};
use admin_rust_core::editor::save::{
    CANT_REACH, Problem, RELOAD, Refusal, SaveCheck, UNREAD, before_save, copy_name, missing_parts,
    refusal_effects, save_as_new_input, section_index_of,
};
use admin_rust_core::editor::state::{
    Action, EditorState, Selection, current_doc, init_state, reduce, regenerate_plan, totals,
};
use admin_rust_core::editor::view::{
    ACCESSIBLE_RADIUS, CORNERS, CommitOutcome, Corner, DeleteRequest, GUIDE_STEPS, LEAVE,
    LevelPick, MapKey, PickerValue, ROW_LABEL_SIZE, SEAT_RADIUS, color_name, commit_outcome,
    confirm_delete_sections, corner_box, degrees_of, delete_level_label, delete_seats_request,
    delete_selection, editor_title, guide_open_after, guide_open_at_start, guide_steps,
    handle_radius, hint_for, level_pick, listed, locked_note, map_fit, map_key, map_label, meta_of,
    number_to_send, parts_selected, past_slop, pick_action, preview_label, regenerate_confirm,
    row_click, row_label_ends, row_list_label, rows_list_section, seat_click, seat_ids_of,
    seat_label, seats_in_box, seats_text, section_font_size, section_item, section_label,
    sections_left, sections_totals, selection_box, selection_note, should_guard, shown, snap_turn,
    stretch_outline, tenth, total_text, turn_handle, undo_key,
};
use admin_rust_core::seating::geometry::{BlockValues, Direction, RowLabelStyle};
use admin_rust_core::seating::map_geometry::Bounds;
use admin_rust_core::seating::pan_zoom::View;
use serde_json::{Value, json};

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/editor")
        .join(name);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn doc() -> EditorDoc {
    from_drawing(&fixture("drawing.json"))
}

fn loaded() -> EditorState {
    init_state(doc())
}

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn opts(seats_before: f64) -> ReadDraftOptions<'static> {
    ReadDraftOptions {
        except: None,
        seats_before,
        check_name: true,
    }
}

// ------------------------------------------------------------------------------ AddSectionForm

#[test]
fn add_section_starts_as_a_10_by_20_straight_block_in_the_first_level() {
    let d = draft_of(&new_block(), "", "new:0");
    assert_eq!(d.name, "");
    assert_eq!(d.rows, "10");
    assert_eq!(d.seats_per_row, "20");
    assert_eq!(d.row_labels, RowLabelStyle::Letters);
    assert_eq!(d.first_row, "A");
    assert_eq!(d.first_seat, "1");
    assert_eq!(d.direction, Direction::LeftToRight);
    assert_eq!(d.curve_preset, "0");
    assert_eq!(d.curve, "0");
    assert_eq!(d.level_id, "new:0");
    let labels: Vec<_> = CURVES.iter().map(|c| c.label).collect();
    assert_eq!(labels, ["None", "Slight", "Medium", "Strong"]);
    let degrees: Vec<_> = CURVES.iter().map(|c| c.degrees).collect();
    assert_eq!(degrees, [0.0, 20.0, 40.0, 60.0]);
    assert_eq!(
        seats_left_note(&empty_doc()),
        "30,000 seats left in this layout"
    );
}

#[test]
fn draft_of_a_generator_with_a_list_and_a_custom_curve() {
    let v = BlockValues {
        seats_per_row: vec![16.0, 16.0, 18.0],
        curve: 25.5,
        ..new_block()
    };
    let d = draft_of(&v, "102", "lv-std");
    assert_eq!(d.seats_per_row, "16, 16, 18");
    assert_eq!(d.curve_preset, "custom");
    assert_eq!(d.curve, "25.5");
    assert!(d.is_custom_curve());
    assert_eq!(
        draft_of(
            &BlockValues {
                curve: 40.0,
                ..new_block()
            },
            "",
            ""
        )
        .curve_preset,
        "40"
    );
}

#[test]
fn reads_a_curved_12_by_20_block() {
    let d = BlockDraft {
        name: "101".into(),
        rows: "12".into(),
        ..draft_of(&new_block(), "", "new:0").with_curve_preset("40")
    };
    let read = read_draft(&d, &empty_doc(), &opts(0.0));
    assert!(read.problems.is_empty(), "{:?}", read.problems);
    assert_eq!(read.values.rows, 12.0);
    assert_eq!(read.values.curve, 40.0);
    assert_eq!(d.curve, "40");
}

#[test]
fn reads_seats_per_row_as_a_list_one_a_row_and_a_curve_in_degrees() {
    let d = BlockDraft {
        name: "102".into(),
        rows: "6".into(),
        seats_per_row: "16, 16, 18, 18, 20, 20".into(),
        ..draft_of(&new_block(), "", "new:0").with_curve_preset("custom")
    };
    let d = BlockDraft {
        curve: "25".into(),
        ..d
    };
    let read = read_draft(&d, &empty_doc(), &opts(0.0));
    assert!(read.problems.is_empty());
    assert_eq!(
        read.values.seats_per_row,
        [16.0, 16.0, 18.0, 18.0, 20.0, 20.0]
    );
    assert_eq!(read.values.curve, 25.0);
}

#[test]
fn refuses_each_value_beside_its_field() {
    for (field, set, message) in [
        (DraftField::Rows, "rows=101", "At most 100 rows"),
        (
            DraftField::SeatsPerRow,
            "seats=201",
            "At most 200 seats in a row",
        ),
        (
            DraftField::SeatsPerRow,
            "seats=20, x",
            "Seats per row: whole numbers, such as 20 or 16, 16, 18",
        ),
        (
            DraftField::FirstRow,
            "first=AB",
            "The first row is a letter, or one letter repeated (A, AA, AAA)",
        ),
    ] {
        let mut d = draft_of(&new_block(), "101", "new:0");
        let (k, v) = set.split_once('=').unwrap();
        match k {
            "rows" => d.rows = v.into(),
            "seats" => d.seats_per_row = v.into(),
            _ => d.first_row = v.into(),
        }
        let read = read_draft(&d, &empty_doc(), &opts(0.0));
        assert_eq!(
            read.problems.get(&field).map(String::as_str),
            Some(message),
            "{set}"
        );
    }
}

#[test]
fn refuses_a_block_that_would_take_the_layout_over_30000_seats_naming_the_limit() {
    let d = BlockDraft {
        rows: "100".into(),
        seats_per_row: "200".into(),
        ..draft_of(&new_block(), "B", "new:0")
    };
    let read = read_draft(&d, &empty_doc(), &opts(20_000.0));
    assert_eq!(
        read.problems
            .get(&DraftField::SeatsPerRow)
            .map(String::as_str),
        Some("The layout would have 40,000 seats; at most 30,000")
    );
    let read = read_draft(&d, &empty_doc(), &opts(10_000.0));
    assert!(read.problems.is_empty());
}

#[test]
fn refuses_a_name_another_section_has_ignoring_case() {
    let d = draft_of(&new_block(), "101", "lv-std");
    let read = read_draft(&d, &doc(), &opts(8.0));
    assert_eq!(
        read.problems.get(&DraftField::Name).map(String::as_str),
        Some("Another section is named 101")
    );
    // Regenerate leaves the name out (`checkName: false`).
    let read = read_draft(
        &d,
        &doc(),
        &ReadDraftOptions {
            except: Some("s-101"),
            seats_before: 2.0,
            check_name: false,
        },
    );
    assert!(read.problems.is_empty());
}

#[test]
fn switching_row_labels_to_numbers_starts_them_at_1_and_back_at_a() {
    let d = draft_of(&new_block(), "", "new:0");
    let n = d.with_row_labels(RowLabelStyle::Numbers);
    assert_eq!(n.first_row, "1");
    assert_eq!(n.row_labels, RowLabelStyle::Numbers);
    let l = n.with_row_labels(RowLabelStyle::Letters);
    assert_eq!(l.first_row, "A");
    // Only an all-letter or all-digit First row is reset.
    let mut odd = d.clone();
    odd.first_row = "A1".into();
    assert_eq!(odd.with_row_labels(RowLabelStyle::Numbers).first_row, "A1");
    odd.first_row = " B".into();
    assert_eq!(odd.with_row_labels(RowLabelStyle::Numbers).first_row, " B");
}

#[test]
fn a_curve_preset_sets_the_degrees_and_degrees_keeps_the_last_preset() {
    let d = draft_of(&new_block(), "", "new:0").with_curve_preset("20");
    assert_eq!((d.curve_preset.as_str(), d.curve.as_str()), ("20", "20"));
    let c = d.with_curve_preset("custom");
    assert_eq!(
        (c.curve_preset.as_str(), c.curve.as_str()),
        ("custom", "20")
    );
}

/// A fixture number; `JSON.stringify` writes `NaN` and the infinities as `null` (`None`).
fn js_num(v: &Value) -> Option<f64> {
    v.as_f64()
}

fn same(a: f64, b: Option<f64>) -> bool {
    match b {
        Some(b) => a == b,
        None => !a.is_finite(),
    }
}

#[test]
fn read_draft_gives_the_typescripts_values_and_problems() {
    let drafts = fixture("drafts.json");
    let mut many = doc();
    let first = many.sections[0].clone();
    many.sections = (0..100)
        .map(|i| {
            let mut s = (*first).clone();
            s.id = format!("s{i}");
            s.name = format!("S{i}");
            Arc::new(s)
        })
        .collect();
    for case in drafts.as_array().unwrap() {
        let draft: BlockDraft = serde_json::from_value(case["draft"].clone()).unwrap();
        let except = case["except"].as_str().map(str::to_string);
        let options = ReadDraftOptions {
            except: except.as_deref(),
            seats_before: case["seatsBefore"].as_f64().unwrap(),
            check_name: case["checkName"] == true,
        };
        let on = if case["many"] == true {
            many.clone()
        } else {
            doc()
        };
        let read = read_draft(&draft, &on, &options);
        let want = &case["out"];
        let v = &want["values"];
        let at = format!("{}", case["draft"]);
        assert!(same(read.values.rows, js_num(&v["rows"])), "{at}: rows");
        let list: Vec<Option<f64>> = v["seatsPerRow"]
            .as_array()
            .unwrap()
            .iter()
            .map(js_num)
            .collect();
        assert_eq!(read.values.seats_per_row.len(), list.len(), "{at}");
        for (a, b) in read.values.seats_per_row.iter().zip(&list) {
            assert!(same(*a, *b), "{at}: seats {a} {b:?}");
        }
        assert_eq!(
            read.values.first_row,
            v["firstRow"].as_str().unwrap(),
            "{at}"
        );
        assert!(
            same(read.values.first_seat, js_num(&v["firstSeat"])),
            "{at}: firstSeat"
        );
        assert!(same(read.values.curve, js_num(&v["curve"])), "{at}: curve");
        let problems: Vec<(String, String)> = want["problems"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, m)| (k.clone(), m.as_str().unwrap().to_string()))
            .collect();
        let mut problems = problems;
        problems.sort();
        let mut got: Vec<(String, String)> = read
            .problems
            .iter()
            .map(|(k, m)| (k.as_str().to_string(), m.clone()))
            .collect();
        got.sort();
        assert_eq!(got, problems, "{at}");
    }
}

#[test]
fn regenerate_plan_gives_the_typescripts_plans() {
    for case in fixture("plans.json").as_array().unwrap() {
        let values: BlockValues = serde_json::from_value(case["values"].clone()).unwrap();
        let plan = regenerate_plan(&doc(), case["id"].as_str().unwrap(), &values);
        assert_eq!(
            plan.removed as u64,
            case["out"]["removed"].as_u64().unwrap()
        );
        assert_eq!(plan.hand_labels, case["out"]["handLabels"] == true);
    }
}

// ------------------------------------------------------------------------------ SaveBar

#[test]
fn missing_parts_name_what_stops_a_save() {
    assert_eq!(
        missing_parts(&empty_doc()),
        ["Name the layout", "Add at least one section"]
    );
    assert!(missing_parts(&doc()).is_empty());
    let mut d = doc();
    d.name = "  ".into();
    assert_eq!(missing_parts(&d), ["Name the layout"]);
    assert_eq!(
        before_save(&empty_doc(), false),
        SaveCheck::Missing(vec!["Name the layout", "Add at least one section"])
    );
}

fn overlapping() -> EditorDoc {
    let mut d = fixture("drawing.json");
    d["levels"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "id": "lv-up", "name": "Upper", "rank": 3, "color": "teal" }));
    d["sections"][1]["rows"] = json!([{
        "id": "r-102-1",
        "label": "1",
        "seats": [
            { "id": "st-102-1", "label": "1", "at": [21, 30] },
            { "id": "st-102-2", "label": "2", "at": [23, 30] },
        ],
    }]);
    from_drawing(&d)
}

#[test]
fn lists_overlaps_and_empty_levels_before_saving_and_save_anyway_skips_them() {
    match before_save(&overlapping(), false) {
        SaveCheck::Warnings { messages, sections } => {
            assert_eq!(messages, ["Section 102 overlaps 101", "Upper has no seats"]);
            assert_eq!(sections.into_iter().collect::<Vec<_>>(), ["s-101", "s-102"]);
        }
        other => panic!("{other:?}"),
    }
    // Save anyway: sent, and the outlines left as they were.
    assert_eq!(
        before_save(&overlapping(), true),
        SaveCheck::Send { warned: None }
    );
    // No warnings: sent at once, the outlines cleared.
    assert_eq!(
        before_save(&doc(), false),
        SaveCheck::Send {
            warned: Some(Default::default())
        }
    );
}

#[test]
fn section_index_of_reads_the_section_of_a_problem_path() {
    assert_eq!(
        section_index_of("sections[1].rows[0].seats[1].label"),
        Some(1)
    );
    assert_eq!(section_index_of("sections[12]"), Some(12));
    assert_eq!(section_index_of("name"), None);
    assert_eq!(section_index_of("levels[0]"), None);
    assert_eq!(section_index_of("xsections[1]"), None);
    assert_eq!(section_index_of("sections[]"), None);
}

fn refused(status: u16, body: Value) -> ApiError {
    ApiError::Status(error_from(status, body.to_string().as_bytes()))
}

#[test]
fn a_layout_file_invalid_refusal_lists_its_problems_and_selects_the_section_at_its_path() {
    let message = "Section 102, row 1: seat label \"1\" is used twice";
    let error = refused(
        400,
        json!({ "error": {
            "code": "LAYOUT_FILE_INVALID",
            "message": "The layout has 1 problem.",
            "details": { "problems": [
                { "path": "name", "message": "Name the layout" },
                { "path": "sections[1].rows[0].seats[1].label", "message": message },
                { "path": "sections[0]", "message": "Another" },
            ], "more": 3 },
        }}),
    );
    let refusal = Refusal::from_error(&error);
    assert_eq!(refusal.code, "LAYOUT_FILE_INVALID");
    assert_eq!(refusal.message, "The layout has 1 problem.");
    assert_eq!(
        refusal.problems[1],
        Problem {
            path: "sections[1].rows[0].seats[1].label".into(),
            message: message.into()
        }
    );
    assert_eq!(refusal.more_text().as_deref(), Some("and 3 more"));
    assert!(!refusal.offers_copy());
    assert!(!refusal.offers_reload());
    let effects = refusal_effects(&refusal);
    assert_eq!(effects.select_section, Some(1));
    assert_eq!(effects.name_problem.as_deref(), Some("Name the layout"));
}

#[test]
fn a_name_refusal_goes_beside_the_name_box() {
    let refusal = Refusal::from_error(&refused(
        409,
        json!({ "error": { "code": "LAYOUT_NAME_TAKEN", "message": "Another layout is named Riverside." } }),
    ));
    let effects = refusal_effects(&refusal);
    assert_eq!(
        effects.name_problem.as_deref(),
        Some("Another layout is named Riverside.")
    );
    assert_eq!(effects.select_section, None);
    assert!(refusal.problems.is_empty());
    assert_eq!(refusal.more_text(), None);
}

#[test]
fn layout_changed_offers_save_as_new_and_reload_layout_in_use_only_save_as_new() {
    let changed = Refusal::from_error(&refused(
        409,
        json!({ "error": { "code": "LAYOUT_CHANGED", "message": "Riverside was changed since you opened it.", "details": { "revision": 5 } } }),
    ));
    assert!(changed.offers_copy());
    assert!(changed.offers_reload());
    assert!(changed.problems.is_empty());
    let locked = Refusal::from_error(&refused(
        409,
        json!({ "error": { "code": "LAYOUT_IN_USE", "message": "Riverside is used by \"Cardinals vs. Duke\", which has sold or held seats." } }),
    ));
    assert!(locked.offers_copy());
    assert!(!locked.offers_reload());
    assert_eq!(
        locked.message,
        "Riverside is used by \"Cardinals vs. Duke\", which has sold or held seats."
    );
    assert_eq!(RELOAD, "Reload the layout? Your changes will be lost.");
    let mut d = doc();
    d.name = " Riverside! ".into();
    assert_eq!(copy_name(&d), "Riverside! (copy)");
}

#[test]
fn a_network_failure_says_the_service_cant_be_reached() {
    for error in [ApiError::Unreachable, ApiError::Decode("bad".into())] {
        let refusal = Refusal::from_error(&error);
        assert_eq!(refusal.message, "Can't reach the QueuePass service.");
        assert_eq!(refusal.message, CANT_REACH);
        assert_eq!(refusal.code, "VALIDATION_FAILED");
    }
    assert_eq!(
        UNREAD,
        "Saved, but the layout could not be read back. Reload it before saving again."
    );
}

// ------------------------------------------------------------------------------ SelectionPanel

#[test]
fn delete_section_asks_naming_its_seats() {
    assert_eq!(
        confirm_delete_sections(&doc(), &ids(&["s-101"])).as_deref(),
        Some("Delete section 101 and its 6 seats?")
    );
    assert_eq!(
        confirm_delete_sections(&doc(), &ids(&["s-101", "s-102"])).as_deref(),
        Some("Delete 2 sections and their 8 seats?")
    );
    assert_eq!(confirm_delete_sections(&doc(), &ids(&["nope"])), None);
}

#[test]
fn deleting_every_seat_of_a_section_asks_to_delete_the_section() {
    assert_eq!(
        delete_seats_request(&doc(), "s-102", &ids(&["st-102-1", "st-102-2"])),
        DeleteRequest::Confirm {
            text: "Delete section 102 and its 2 seats?".into(),
            action: Action::DeleteSections {
                ids: ids(&["s-102"])
            },
        }
    );
    assert_eq!(
        delete_seats_request(&doc(), "s-101", &ids(&["st-a2"])),
        DeleteRequest::Do(Action::DeleteSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a2"])
        })
    );
    assert_eq!(
        delete_seats_request(&doc(), "s-101", &[]),
        DeleteRequest::Nothing
    );
}

#[test]
fn regenerate_warns_before_removing_seats_and_of_labels_changed_by_hand() {
    let plan = |removed, hand_labels| admin_rust_core::editor::state::RegeneratePlan {
        removed,
        hand_labels,
    };
    assert_eq!(
        regenerate_confirm(&plan(4, false)).as_deref(),
        Some("Regenerate removes 4 seats. Go on?")
    );
    assert_eq!(
        regenerate_confirm(&plan(3, true)).as_deref(),
        Some("Regenerate removes 3 seats. Labels changed by hand are replaced. Go on?")
    );
    assert_eq!(
        regenerate_confirm(&plan(1, false)).as_deref(),
        Some("Regenerate removes 1 seat. Go on?")
    );
    // LE58 quirk kept: no seats removed, no period after "Regenerate".
    assert_eq!(
        regenerate_confirm(&plan(0, true)).as_deref(),
        Some("Regenerate Labels changed by hand are replaced. Go on?")
    );
    assert_eq!(regenerate_confirm(&plan(0, false)), None);
}

#[test]
fn the_selection_panel_says_what_is_selected() {
    let d = doc();
    let rows = Selection::Rows {
        section_id: "s-101".into(),
        ids: ids(&["r-101-a", "r-101-b"]),
    };
    assert_eq!(
        parts_selected(&d, &rows).as_deref(),
        Some("Rows A–B selected in section 101")
    );
    let one = Selection::Seats {
        section_id: "s-101".into(),
        ids: ids(&["st-a2"]),
    };
    assert_eq!(
        parts_selected(&d, &one).as_deref(),
        Some("Row A, seat 2 selected in section 101")
    );
    let two = Selection::Seats {
        section_id: "s-101".into(),
        ids: ids(&["st-a2", "st-a3"]),
    };
    assert_eq!(
        parts_selected(&d, &two).as_deref(),
        Some("2 seats selected in section 101")
    );
    assert_eq!(parts_selected(&d, &Selection::None), None);
    assert_eq!(selection_note(&d, &d.sections[0]), "Standard · 6 seats");
    assert_eq!(
        seat_ids_of(&d.sections[0], &rows),
        ids(&["st-a1", "st-a2", "st-a3", "st-b1", "st-b2", "st-b3"])
    );
    assert_eq!(seat_ids_of(&d.sections[0], &two), ids(&["st-a2", "st-a3"]));
    assert_eq!(row_list_label(&d.sections[0].rows[0]), "Row A · 3 seats");
    // The rows list: the one section selected, or the section of its rows or seats.
    assert_eq!(
        rows_list_section(&d, &rows).map(|s| s.id.as_str()),
        Some("s-101")
    );
    let sel = Selection::Sections {
        ids: ids(&["s-102"]),
    };
    assert_eq!(
        rows_list_section(&d, &sel).map(|s| s.id.as_str()),
        Some("s-102")
    );
    let both = Selection::Sections {
        ids: ids(&["s-101", "s-102"]),
    };
    assert_eq!(rows_list_section(&d, &both), None);
}

#[test]
fn name_and_label_boxes_keep_on_enter_or_blur() {
    let check = |t: &str| (t.trim() == "102").then(|| "Another section is named 102".to_string());
    assert_eq!(commit_outcome(" 101 ", "101", check), CommitOutcome::Same);
    assert_eq!(
        commit_outcome("102", "101", check),
        CommitOutcome::Problem("Another section is named 102".into())
    );
    assert_eq!(
        commit_outcome("104 ", "101", check),
        CommitOutcome::Commit("104 ".into())
    );
}

// ------------------------------------------------------------------------------ SectionSeatsView

#[test]
fn seats_are_named_with_their_level_and_mark() {
    let d = doc();
    let s = &d.sections[0];
    assert_eq!(
        seat_label(&d, s, &s.rows[0], &s.rows[0].seats[0]),
        "Row A, Seat 1, Courtside, accessible"
    );
    assert_eq!(
        seat_label(&d, s, &s.rows[0], &s.rows[0].seats[1]),
        "Row A, Seat 2, Standard"
    );
    assert_eq!(
        seat_label(&d, s, &s.rows[1], &s.rows[1].seats[2]),
        "Row B, Seat 3, Courtside"
    );
    assert_eq!(SEAT_RADIUS, 0.8);
    assert_eq!(ACCESSIBLE_RADIUS, 0.8 * 0.45);
    assert_eq!(ROW_LABEL_SIZE, 1.6);
}

#[test]
fn row_labels_sit_2_4_units_past_both_end_seats() {
    let d = doc();
    let row = &d.sections[0].rows[0];
    assert_eq!(row_label_ends(row), [[15.6, 30.0], [24.4, 30.0]]);
    // One seat: along x.
    let mut one = row.clone();
    one.seats.truncate(1);
    assert_eq!(row_label_ends(&one), [[15.6, 30.0], [20.4, 30.0]]);
    one.seats.clear();
    assert!(row_label_ends(&one).is_empty());
}

#[test]
fn clicks_on_seats_and_row_labels_select_them() {
    assert_eq!(
        seat_click("s-101", "st-a2", true),
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a2"]),
            add: true
        }
    );
    assert_eq!(
        row_click("s-101", "r-101-b", false),
        Action::SelectRows {
            section_id: "s-101".into(),
            ids: ids(&["r-101-b"]),
            add: false
        }
    );
    assert_eq!(
        row_click("s-101", "r-101-b", true),
        Action::SelectRowRange {
            section_id: "s-101".into(),
            to_id: "r-101-b".into()
        }
    );
}

#[test]
fn box_select_takes_the_seats_inside_edges_included() {
    let d = doc();
    let s = &d.sections[0];
    // From (17, 27) to (21, 31): seats 1 and 2 of rows A and B.
    assert_eq!(
        seats_in_box(s, [17.0, 27.0], [21.0, 31.0]),
        ids(&["st-a1", "st-a2", "st-b1", "st-b2"])
    );
    // Either corner first; an edge on a seat takes it.
    assert_eq!(
        seats_in_box(s, [22.0, 30.0], [20.0, 28.0]),
        ids(&["st-a2", "st-a3", "st-b2", "st-b3"])
    );
    assert!(seats_in_box(s, [0.0, 0.0], [1.0, 1.0]).is_empty());
}

// ------------------------------------------------------------------------------ EditorCanvas

#[test]
fn map_fit_is_at_least_300_by_200_from_0_growing_in_steps_of_50() {
    assert_eq!(
        map_fit(&empty_doc()),
        View {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 200.0
        }
    );
    // Riverside reaches x 101.5 and y 60: still 300 × 200.
    assert_eq!(map_fit(&doc()).width, 300.0);
    let mut far = empty_doc();
    far.floor.outline = Some(vec![[0.0, 0.0], [281.0, 0.0], [0.0, 231.0]]);
    let fit = map_fit(&far);
    assert_eq!((fit.width, fit.height), (350.0, 300.0));
}

#[test]
fn the_map_names_its_sections_with_their_level_and_seats() {
    let d = doc();
    assert_eq!(map_label(2), "Layout map: 2 sections");
    assert_eq!(map_label(1), "Layout map: 1 section");
    assert_eq!(
        section_label(&d, &d.sections[0]),
        "Section 101, Standard, 6 seats"
    );
    assert_eq!(
        section_label(&d, &d.sections[1]),
        "Section 102, Courtside, 2 seats"
    );
    assert_eq!(section_font_size(&map_fit(&d)), 5.0);
}

#[test]
fn a_press_is_a_drag_after_3_pixels() {
    assert!(!past_slop([100.0, 31.0], [102.0, 31.0]));
    assert!(past_slop([100.0, 31.0], [103.0, 31.0]));
    assert!(past_slop([100.0, 31.0], [110.0, 31.0]));
    assert_eq!(tenth(4.96), 5.0);
    assert_eq!(tenth(10.04), 10.0);
}

#[test]
fn the_turn_handle_sits_above_the_selection_box() {
    let d = doc();
    let sel = Selection::Sections {
        ids: ids(&["s-101"]),
    };
    let b = selection_box(&d, &sel, false).unwrap();
    let outline = &d.sections[0].outline;
    let min_y = outline.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
    assert_eq!(b.y, min_y);
    // Not while zoomed, and not without sections.
    assert_eq!(selection_box(&d, &sel, true), None);
    assert_eq!(selection_box(&d, &Selection::Floor, false), None);
    let view = map_fit(&d);
    let h = turn_handle(&b, &view);
    assert_eq!(h.center, [b.x + b.width / 2.0, b.y + b.height / 2.0]);
    assert_eq!(h.line_from, [h.center[0], b.y - 1.0]);
    // max(4, 200 / 15) above the box's top less 1.
    assert_eq!(h.at, [h.center[0], b.y - 1.0 - 200.0 / 15.0]);
    assert_eq!(handle_radius(&view), 3.0);
    assert_eq!(
        handle_radius(&View {
            x: 0.0,
            y: 0.0,
            width: 60.0,
            height: 40.0
        }),
        1.5
    );
    let small = turn_handle(
        &b,
        &View {
            x: 0.0,
            y: 0.0,
            width: 30.0,
            height: 20.0,
        },
    );
    assert_eq!(small.at[1], b.y - 1.0 - 4.0);
}

#[test]
fn the_turn_handle_turns_in_1_degree_steps_15_with_shift() {
    let center = [20.0, 29.0];
    let above = [20.0, 10.0];
    let start = degrees_of(center, above);
    assert_eq!(start, -90.0);
    // From straight above the middle to 50 right and 20 below it: 90° + atan(20/50) ≈ 111.8°.
    let at = [70.0, 49.0];
    assert_eq!(snap_turn(center, start, at, false), 112.0);
    assert_eq!(snap_turn(center, start, at, true), 105.0);
    // Normalized to (−180, 180].
    assert_eq!(snap_turn(center, start, [19.0, 49.0], false), -177.0);
}

#[test]
fn a_floor_corner_keeps_the_opposite_corner_and_stretches_the_floor() {
    let names: Vec<_> = CORNERS.iter().map(|c| c.as_str()).collect();
    assert_eq!(names, ["nw", "ne", "se", "sw"]);
    let b = Bounds {
        x: 50.0,
        y: 40.0,
        width: 40.0,
        height: 20.0,
    };
    assert_eq!(Corner::Se.at(&b), [90.0, 60.0]);
    assert_eq!(Corner::Nw.at(&b), [50.0, 40.0]);
    assert_eq!(Corner::Ne.opposite(), Corner::Sw);
    assert_eq!(Corner::Se.opposite().at(&b), [50.0, 40.0]);
    let to = corner_box(Corner::Se.opposite().at(&b), [100.0, 70.0]);
    assert_eq!(
        to,
        Bounds {
            x: 50.0,
            y: 40.0,
            width: 50.0,
            height: 30.0
        }
    );
    let floor = vec![[50.0, 40.0], [90.0, 40.0], [90.0, 60.0], [50.0, 60.0]];
    assert_eq!(
        stretch_outline(&floor, &to),
        [[50.0, 40.0], [100.0, 40.0], [100.0, 70.0], [50.0, 70.0]]
    );
    // Dragged past the fixed corner: the box flips.
    assert_eq!(
        corner_box([50.0, 40.0], [30.0, 20.0]),
        Bounds {
            x: 30.0,
            y: 20.0,
            width: 20.0,
            height: 20.0
        }
    );
    // A flat floor stretches by 1 (`from.width || 1`).
    let flat = vec![[10.0, 10.0], [20.0, 10.0], [15.0, 10.0]];
    let s = stretch_outline(
        &flat,
        &Bounds {
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 5.0,
        },
    );
    assert_eq!(s, [[0.0, 0.0], [20.0, 0.0], [10.0, 0.0]]);
}

#[test]
fn map_keys_move_turn_delete_and_clear() {
    // Escape always clears (read-only too).
    assert_eq!(map_key("Escape", false, true, false, false), MapKey::Clear);
    assert_eq!(
        map_key("Delete", false, false, false, false),
        MapKey::Delete
    );
    assert_eq!(
        map_key("Backspace", false, false, true, false),
        MapKey::Delete
    );
    assert_eq!(map_key("Delete", false, true, false, true), MapKey::PanZoom);
    assert_eq!(
        map_key("ArrowRight", false, false, false, true),
        MapKey::Move { dx: 1.0, dy: 0.0 }
    );
    assert_eq!(
        map_key("ArrowUp", true, false, false, true),
        MapKey::Move { dx: 0.0, dy: -10.0 }
    );
    assert_eq!(
        map_key("]", false, false, false, true),
        MapKey::Turn { degrees: 1.0 }
    );
    assert_eq!(
        map_key("{", true, false, false, true),
        MapKey::Turn { degrees: -15.0 }
    );
    assert_eq!(
        map_key("[", false, false, false, true),
        MapKey::Turn { degrees: -1.0 }
    );
    // Zoomed, read-only, or nothing selected: the arrows pan.
    assert_eq!(
        map_key("ArrowRight", false, false, true, true),
        MapKey::PanZoom
    );
    assert_eq!(
        map_key("ArrowRight", false, true, false, true),
        MapKey::PanZoom
    );
    assert_eq!(
        map_key("ArrowRight", false, false, false, false),
        MapKey::PanZoom
    );
    assert_eq!(map_key("+", false, false, false, true), MapKey::PanZoom);
}

#[test]
fn delete_on_the_map_asks_for_sections_and_deletes_seats_and_the_floor() {
    let d = doc();
    let sel = Selection::Sections {
        ids: ids(&["s-102"]),
    };
    assert_eq!(
        delete_selection(&d, &sel),
        DeleteRequest::Confirm {
            text: "Delete section 102 and its 2 seats?".into(),
            action: Action::DeleteSections {
                ids: ids(&["s-102"])
            }
        }
    );
    let rows = Selection::Rows {
        section_id: "s-101".into(),
        ids: ids(&["r-101-b"]),
    };
    assert_eq!(
        delete_selection(&d, &rows),
        DeleteRequest::Do(Action::DeleteSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-b1", "st-b2", "st-b3"])
        })
    );
    assert_eq!(
        delete_selection(&d, &Selection::Floor),
        DeleteRequest::Do(Action::SetFloor {
            kind: FloorKind::None,
            at: [0.0, 0.0]
        })
    );
    assert_eq!(
        delete_selection(&d, &Selection::None),
        DeleteRequest::Nothing
    );
    let gone = Selection::Sections {
        ids: ids(&["nope"]),
    };
    assert_eq!(delete_selection(&d, &gone), DeleteRequest::Nothing);
}

// ------------------------------------------------------------------------------ NumberBox

#[test]
fn the_number_box_shows_a_tenth_never_minus_zero() {
    for case in fixture("shown.json").as_array().unwrap() {
        let n = match &case["n"] {
            Value::String(s) if s == "-0" => -0.0,
            v => v.as_f64().unwrap(),
        };
        assert_eq!(shown(n), case["out"].as_str().unwrap(), "{n}");
    }
}

#[test]
fn the_number_box_sends_only_a_finite_number_that_shows_differently() {
    assert_eq!(number_to_send("50", 20.0), Some(50.0));
    assert_eq!(number_to_send(" 30 ", 0.0), Some(30.0));
    assert_eq!(number_to_send("20.04", 20.0), None);
    assert_eq!(number_to_send("", 20.0), None);
    assert_eq!(number_to_send("  ", 20.0), None);
    assert_eq!(number_to_send("abc", 20.0), None);
    assert_eq!(number_to_send("Infinity", 20.0), None);
    assert_eq!(number_to_send("1e2", 20.0), Some(100.0));
    // The reducer does not enforce min or max (LE51).
    assert_eq!(number_to_send("-5", 20.0), Some(-5.0));
}

// ------------------------------------------------------------------------------ LevelsPanel

#[test]
fn the_levels_panel_counts_and_names() {
    let d = doc();
    let t = totals(&d);
    assert_eq!(seats_text(t.level("lv-court")), "6 seats");
    assert_eq!(seats_text(1), "1 seat");
    assert_eq!(seats_text(30_000), "30,000 seats");
    assert_eq!(total_text(&t), "Total: 8 seats");
    assert_eq!(color_name("teal"), "Teal");
    assert_eq!(delete_level_label(6), "Its 6 seats take");
    assert_eq!(delete_level_label(0), "Its 0 seats take");
}

// ------------------------------------------------------------------------------ SectionsPanel

#[test]
fn the_sections_panel_counts_sections_seats_and_seats_left() {
    let t = totals(&doc());
    assert_eq!(sections_totals(&t), "2 sections · 8 seats");
    assert_eq!(sections_left(&t), "29,992 seats left of 30,000");
    assert_eq!(section_item(&doc().sections[1]), "102 · 2 seats");
    let s = reduce(
        &init_state(empty_doc()),
        Action::AddSection {
            name: "101".into(),
            values: BlockValues {
                rows: 12.0,
                curve: 40.0,
                ..new_block()
            },
            level_id: "new:0".into(),
            at: [150.0, 100.0],
        },
    );
    let t = totals(current_doc(&s));
    assert_eq!(sections_totals(&t), "1 section · 240 seats");
    assert_eq!(sections_left(&t), "29,760 seats left of 30,000");
}

// ------------------------------------------------------------------------------ level-picker

fn pick(s: &EditorState) -> Option<LevelPick> {
    level_pick(current_doc(s), &s.selection)
}

#[test]
fn the_level_picker_is_not_there_with_nothing_selected() {
    assert_eq!(pick(&loaded()), None);
    let floor = reduce(&loaded(), Action::SelectFloor);
    assert_eq!(pick(&floor), None);
}

#[test]
fn shows_a_sections_level_and_gives_it_another_at_once() {
    let s = reduce(
        &loaded(),
        Action::SelectSections {
            ids: ids(&["s-101"]),
        },
    );
    let p = pick(&s).unwrap();
    assert_eq!(p.value, PickerValue::Level("lv-std".into()));
    assert_eq!(p.inherit, None);
    assert_eq!(p.swatch.as_deref(), Some("violet"));
    let action = pick_action(&PickerValue::Level("lv-court".into())).unwrap();
    let s = reduce(&s, action);
    assert_eq!(s.message, "Section 101 painted Courtside");
    let s = reduce(&s, Action::Undo);
    assert_eq!(pick(&s).unwrap().value, PickerValue::Level("lv-std".into()));
}

#[test]
fn says_mixed_for_sections_of_different_levels() {
    let s = reduce(
        &loaded(),
        Action::SelectSections {
            ids: ids(&["s-102", "s-101"]),
        },
    );
    let p = pick(&s).unwrap();
    assert_eq!(p.value, PickerValue::Mixed);
    assert_eq!(p.swatch, None);
    assert_eq!(pick_action(&PickerValue::Mixed), None);
    assert_eq!(PickerValue::Mixed.as_value(), "__mixed");
    assert_eq!(PickerValue::from_value("__inherit"), PickerValue::Inherit);
    assert_eq!(
        PickerValue::from_value("lv-std"),
        PickerValue::Level("lv-std".into())
    );
}

#[test]
fn offers_same_as_the_section_for_rows_which_clears_their_own_level() {
    let s = reduce(
        &loaded(),
        Action::SelectRows {
            section_id: "s-101".into(),
            ids: ids(&["r-101-b"]),
            add: false,
        },
    );
    let p = pick(&s).unwrap();
    assert_eq!(p.inherit.as_deref(), Some("Same as the section (Standard)"));
    // Row B has its own level, Courtside, in the fixture.
    assert_eq!(p.value, PickerValue::Level("lv-court".into()));
    let s = reduce(&s, pick_action(&PickerValue::Inherit).unwrap());
    assert_eq!(pick(&s).unwrap().value, PickerValue::Inherit);
    assert_eq!(pick(&s).unwrap().swatch, None);
    assert!(s.message.starts_with("Row B"));
}

#[test]
fn seats_offer_same_as_the_row_naming_it_when_their_rows_agree() {
    let s = reduce(
        &loaded(),
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-b1"]),
            add: false,
        },
    );
    let p = pick(&s).unwrap();
    assert_eq!(p.inherit.as_deref(), Some("Same as the row (Courtside)"));
    assert_eq!(p.value, PickerValue::Inherit);
    let both = reduce(
        &loaded(),
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a2", "st-b1"]),
            add: false,
        },
    );
    assert_eq!(
        pick(&both).unwrap().inherit.as_deref(),
        Some("Same as the row")
    );
    // A seat with its own level and one without: Mixed.
    let mixed = reduce(
        &loaded(),
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a1", "st-a2"]),
            add: false,
        },
    );
    assert_eq!(pick(&mixed).unwrap().value, PickerValue::Mixed);
}

// ------------------------------------------------------------------------------ guide

#[test]
fn the_steps_open_on_a_new_layout_five_of_them_none_done() {
    let steps = guide_steps(&empty_doc());
    assert!(guide_open_at_start(&empty_doc()));
    assert!(!guide_open_at_start(&doc()));
    assert_eq!(steps.len(), 5);
    assert!(steps.iter().all(|s| !s.done));
    assert!(steps[0].text.starts_with("Pick a floor object"));
    assert!(
        steps[1]
            .text
            .starts_with("Add a section: in Sections, press Add section")
    );
    assert!(steps[2].text.starts_with("Drag the section into place"));
    assert!(steps[3].text.starts_with("Give seats price levels"));
    assert_eq!(steps[4].text, "Name the layout at the top and press Save.");
    assert_eq!(GUIDE_STEPS[4], steps[4].text);
}

#[test]
fn the_steps_tick_off_the_floor_sections_and_levels() {
    let mut s = reduce(
        &init_state(empty_doc()),
        Action::SetFloor {
            kind: FloorKind::Court,
            at: [150.0, 100.0],
        },
    );
    assert!(guide_steps(current_doc(&s))[0].done);
    s = reduce(
        &s,
        Action::AddSection {
            name: "101".into(),
            values: new_block(),
            level_id: "new:0".into(),
            at: [150.0, 100.0],
        },
    );
    let steps = guide_steps(current_doc(&s));
    assert!(steps[1].done);
    assert!(!steps[2].done && !steps[3].done && !steps[4].done);
    // Folded once the first section appears; left as the admin left it after that.
    assert!(!guide_open_after(true, false, true));
    assert!(guide_open_after(true, true, true));
    assert!(guide_open_after(true, false, false));
    s = reduce(
        &s,
        Action::RenameLevel {
            id: "new:0".into(),
            name: "Floor".into(),
        },
    );
    assert!(guide_steps(current_doc(&s))[3].done);
    assert!(guide_steps(&doc())[3].done);
}

#[test]
fn the_line_under_the_map_follows_what_is_selected() {
    assert!(hint_for(&Selection::None, false, true).starts_with("Click a section to select it"));
    let sel = Selection::Sections {
        ids: ids(&["s-101"]),
    };
    assert!(hint_for(&sel, false, true).contains("Double-click it to see its seats"));
    let zoomed = hint_for(&sel, true, true);
    assert!(zoomed.starts_with("Click seats (Shift-click for more) or a row label"));
    assert!(zoomed.contains("Selection: Price level"));
    assert!(hint_for(&Selection::Floor, false, true).starts_with("Drag the floor to move it"));
    assert_eq!(
        hint_for(&Selection::None, false, false),
        "Start with the steps above: a floor object, then a section."
    );
    // A rows or seats selection while not zoomed falls through (LE11).
    let rows = Selection::Rows {
        section_id: "s-101".into(),
        ids: ids(&["r-101-a"]),
    };
    assert!(hint_for(&rows, false, true).starts_with("Click a section to select it"));
}

// ------------------------------------------------------------------------------ keyboard

#[test]
fn cmd_or_ctrl_z_undoes_and_shift_or_y_redoes_but_not_in_a_text_box() {
    assert_eq!(undo_key("z", false, true, false, false), Some(Action::Undo));
    assert_eq!(undo_key("Z", true, false, true, false), Some(Action::Redo));
    assert_eq!(undo_key("y", false, true, false, false), Some(Action::Redo));
    assert_eq!(undo_key("z", false, false, false, false), None);
    assert_eq!(undo_key("z", false, true, false, true), None);
    assert_eq!(undo_key("x", true, false, false, false), None);
}

// ------------------------------------------------------------------------------ LayoutEditor

#[test]
fn listed_joins_names_with_and() {
    assert_eq!(listed(&[]), "");
    assert_eq!(listed(&ids(&["A"])), "A");
    assert_eq!(listed(&ids(&["A", "B"])), "A and B");
    assert_eq!(listed(&ids(&["A", "B", "C"])), "A, B and C");
}

#[test]
fn a_locked_layout_says_why() {
    let meta = meta_of(&fixture("locked.json"));
    assert!(meta.locked);
    assert_eq!(meta.revision, Some(4));
    let names: Vec<String> = meta.locked_by.iter().map(|e| e.name.clone()).collect();
    assert_eq!(
        locked_note(&names),
        "Locked: seats are sold or held at Cardinals vs. Duke and Spring concert"
    );
    let open = meta_of(&fixture("drawing.json"));
    assert!(!open.locked);
    assert!(open.locked_by.is_empty());
}

#[test]
fn the_title_is_new_edit_with_the_saved_name_or_the_locked_name() {
    assert_eq!(editor_title(false, false, "", ""), "New layout");
    assert_eq!(
        editor_title(true, false, "Riverside bowl", "Riverside"),
        "Edit layout: Riverside"
    );
    assert_eq!(
        editor_title(true, true, "Riverside", "Riverside"),
        "Riverside"
    );
    // The saved name, not the typing.
    let s = reduce(
        &loaded(),
        Action::Rename {
            name: "Typed".into(),
        },
    );
    assert_eq!(
        editor_title(true, false, &current_doc(&s).name, &s.saved.name),
        "Edit layout: Riverside"
    );
}

#[test]
fn the_phone_preview_names_the_layout_and_its_sections() {
    assert_eq!(preview_label(&doc()), "Riverside: 2 sections");
    assert_eq!(preview_label(&empty_doc()), "New layout: 0 sections");
    let s = reduce(
        &init_state(empty_doc()),
        Action::AddSection {
            name: "101".into(),
            values: new_block(),
            level_id: "new:0".into(),
            at: [150.0, 100.0],
        },
    );
    assert_eq!(preview_label(current_doc(&s)), "New layout: 1 section");
}

#[test]
fn leaving_while_dirty_asks_but_a_search_only_change_passes() {
    assert_eq!(LEAVE, "Leave without saving? Your changes will be lost.");
    assert!(should_guard(
        true,
        "/locations/v1/layouts/lay-1/edit",
        "/locations/v1"
    ));
    assert!(!should_guard(
        true,
        "/locations/v1/layouts/lay-1/edit",
        "/locations/v1/layouts/lay-1/edit"
    ));
    assert!(!should_guard(false, "/a", "/b"));
}

#[test]
fn save_as_a_new_layout_sends_every_part_as_new_under_the_trimmed_name() {
    // LE78: `{ ...toInput(doc, null, { fresh: true }), name }`, the name trimmed by the bar.
    let body = save_as_new_input(&doc(), "  Riverside (copy) ");
    assert_eq!(body["name"], json!("Riverside (copy)"));
    assert!(body.get("revision").is_none());
    assert!(body["sections"][0].get("id").is_none());
    assert!(!body.to_string().contains("\"id\""));
    assert_eq!(body["levels"][0]["key"], json!("l1"));
}
