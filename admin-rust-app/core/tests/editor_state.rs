//! Spec 037 research R14 (T073): the layout editor's reducer, ported case by case from
//! `admin-app/test/layout-editor/editor-state.test.ts` (039 research R5–R7, R10, R12; parity
//! LE5, LE18, LE19, LE27, LE28, LE30, LE32, LE33, LE38–LE42, LE48, LE51–LE58, LE64–LE66, LE80).
//! Then parity: scenarios run through the TypeScript reducer by `make-fixtures.ts`
//! (`tests/fixtures/editor/scenarios.json`) must give the same state after every action, every
//! number to the same float.

use std::{fs, path::PathBuf, sync::Arc};

use admin_rust_core::editor::doc::{
    EditorDoc, FloorKind, empty_doc, from_drawing, outline_of, to_input,
};
use admin_rust_core::editor::state::{
    Action, DeletePlan, EditorState, HISTORY_LIMIT, RegeneratePlan, Selection, current_doc,
    free_name, init_state, is_dirty, level_name_problem, plan_delete_seats, reduce,
    regenerate_plan, row_label_problem, rows_word, seat_count, seat_label_problem, seats_word,
    section_name_problem, totals,
};
use admin_rust_core::seating::geometry::{BlockValues, Direction, RowLabelStyle};
use admin_rust_core::seating::map_geometry::Bounds;
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/editor")
        .join(name);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn loaded() -> EditorState {
    init_state(from_drawing(&fixture("drawing.json")))
}

fn doc(s: &EditorState) -> &EditorDoc {
    current_doc(s)
}

fn sel_sections(ids: &[&str]) -> Selection {
    Selection::Sections {
        ids: ids.iter().map(|s| s.to_string()).collect(),
    }
}

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn r(s: &EditorState, a: Action) -> EditorState {
    reduce(s, a)
}

fn rename(name: &str) -> Action {
    Action::Rename { name: name.into() }
}

fn move_sections(v: &[&str], dx: f64, dy: f64) -> Action {
    Action::MoveSections {
        ids: ids(v),
        dx,
        dy,
    }
}

fn set_floor(kind: FloorKind, at: [f64; 2]) -> Action {
    Action::SetFloor { kind, at }
}

// ------------------------------------------------------------------------------ load and selection

#[test]
fn loads_a_document_with_nothing_selected_not_dirty_nothing_to_undo() {
    let s = loaded();
    assert_eq!(doc(&s).name, "Riverside");
    assert_eq!(s.selection, Selection::None);
    assert!(!is_dirty(&s));
    assert_eq!(s.cursor, 0);
    assert_eq!(s.steps, ["Loaded"]);
    assert_eq!(s.message, "");
}

#[test]
fn a_load_replaces_the_document_and_its_history() {
    let mut s = r(&loaded(), rename("Other"));
    s = r(&s, Action::Load { doc: empty_doc() });
    assert_eq!(doc(&s).name, "");
    assert_eq!(s.history.len(), 1);
    assert!(!is_dirty(&s));
}

#[test]
fn selects_sections_adds_and_removes_one_with_shift_and_clears() {
    let mut s = r(
        &loaded(),
        Action::SelectSections {
            ids: ids(&["s-101"]),
        },
    );
    assert_eq!(s.selection, sel_sections(&["s-101"]));
    s = r(&s, Action::ToggleSection { id: "s-102".into() });
    assert_eq!(s.selection, sel_sections(&["s-101", "s-102"]));
    s = r(&s, Action::ToggleSection { id: "s-101".into() });
    assert_eq!(s.selection, sel_sections(&["s-102"]));
    s = r(&s, Action::ToggleSection { id: "s-102".into() });
    assert_eq!(s.selection, Selection::None);
    s = r(&s, Action::SelectFloor);
    assert_eq!(s.selection, Selection::Floor);
    s = r(&s, Action::ClearSelection);
    assert_eq!(s.selection, Selection::None);
    // Selecting is not a change.
    assert_eq!(s.history.len(), 1);
}

#[test]
fn select_floor_without_a_floor_does_nothing() {
    let s = init_state(empty_doc());
    assert_eq!(r(&s, Action::SelectFloor), s);
}

#[test]
fn zoom_selects_the_section_and_out_a_rows_or_seats_selection_becomes_its_section() {
    // LE44: zooming in selects the section; Back to layout turns rows or seats into it.
    let mut s = r(
        &loaded(),
        Action::Zoom {
            id: Some("s-101".into()),
        },
    );
    assert_eq!(s.zoomed.as_deref(), Some("s-101"));
    assert_eq!(s.selection, sel_sections(&["s-101"]));
    s = r(
        &s,
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a2"]),
            add: false,
        },
    );
    s = r(&s, Action::Zoom { id: None });
    assert_eq!(s.zoomed, None);
    assert_eq!(s.selection, sel_sections(&["s-101"]));
    // Out with the floor selected keeps it.
    s = r(&s, Action::SelectFloor);
    s = r(&s, Action::Zoom { id: None });
    assert_eq!(s.selection, Selection::Floor);
}

// ------------------------------------------------------------------------------ rename and floor

#[test]
fn renames_the_layout_consecutive_renames_are_one_step() {
    let mut s = r(&loaded(), rename("B"));
    s = r(&s, rename("Ba"));
    assert_eq!(doc(&s).name, "Ba");
    assert_eq!(s.history.len(), 2);
    assert_eq!(s.message, "Layout named Ba");
    s = r(&s, Action::Undo);
    assert_eq!(doc(&s).name, "Riverside");
}

#[test]
fn a_rename_after_another_action_is_a_new_step() {
    let mut s = r(&loaded(), rename("B"));
    s = r(&s, Action::SelectFloor);
    s = r(&s, rename("Ba"));
    assert_eq!(s.history.len(), 3);
}

#[test]
fn sets_the_floor_kind_with_a_rectangle_at_the_given_place_none_clears_the_outline() {
    let mut s = init_state(empty_doc());
    s = r(&s, set_floor(FloorKind::Court, [150.0, 100.0]));
    let floor = doc(&s).floor.clone();
    assert_eq!(floor.kind, FloorKind::Court);
    let outline = floor.outline.clone().unwrap();
    assert_eq!(outline.len(), 4);
    let xs: Vec<f64> = outline.iter().map(|p| p[0]).collect();
    let ys: Vec<f64> = outline.iter().map(|p| p[1]).collect();
    let mid = |v: &[f64]| {
        (v.iter().copied().fold(f64::INFINITY, f64::min)
            + v.iter().copied().fold(f64::NEG_INFINITY, f64::max))
            / 2.0
    };
    assert_eq!(mid(&xs), 150.0);
    assert_eq!(mid(&ys), 100.0);
    // Court is 100 × 56 (LE30).
    assert_eq!(outline[0], [100.0, 72.0]);
    assert_eq!(outline[2], [200.0, 128.0]);
    // Review B2: chosen, it is selected, so its corner handles show for resizing (FR-005).
    assert_eq!(s.selection, Selection::Floor);
    assert_eq!(s.message, "Floor object set to Court");
    // Another kind keeps the place.
    s = r(&s, set_floor(FloorKind::Ring, [0.0, 0.0]));
    assert_eq!(doc(&s).floor.kind, FloorKind::Ring);
    assert_eq!(doc(&s).floor.outline, floor.outline);
    s = r(&s, set_floor(FloorKind::None, [0.0, 0.0]));
    assert_eq!(doc(&s).floor.kind, FloorKind::None);
    assert_eq!(doc(&s).floor.outline, None);
    assert_eq!(s.message, "Floor object removed");
    assert_eq!(s.selection, Selection::None);
}

#[test]
fn each_floor_kind_has_its_size() {
    for (kind, w, h) in [
        (FloorKind::EndStage, 80.0, 30.0),
        (FloorKind::CenterStage, 40.0, 40.0),
        (FloorKind::Ring, 30.0, 30.0),
    ] {
        let s = r(&init_state(empty_doc()), set_floor(kind, [100.0, 100.0]));
        let o = doc(&s).floor.outline.clone().unwrap();
        assert_eq!(o[2][0] - o[0][0], w);
        assert_eq!(o[2][1] - o[0][1], h);
    }
}

#[test]
fn removing_the_floor_keeps_a_section_selection() {
    let mut s = r(
        &loaded(),
        Action::SelectSections {
            ids: ids(&["s-101"]),
        },
    );
    s = r(&s, set_floor(FloorKind::None, [0.0, 0.0]));
    assert_eq!(s.selection, sel_sections(&["s-101"]));
}

// ------------------------------------------------------------------------------ history

#[test]
fn makes_each_change_one_step_undo_and_redo_walk_it_and_say_so() {
    let mut s = r(&loaded(), move_sections(&["s-101"], 1.0, 0.0));
    s = r(&s, set_floor(FloorKind::Ring, [0.0, 0.0]));
    assert_eq!(s.history.len(), 3);
    s = r(&s, Action::Undo);
    assert_eq!(doc(&s).floor.kind, FloorKind::Court);
    assert_eq!(s.message, "Undone: floor object set to Ring");
    s = r(&s, Action::Undo);
    assert_eq!(doc(&s).sections[0].origin, [20.0, 30.0]);
    assert_eq!(s.message, "Undone: section 101 moved");
    // Nothing more to undo: unchanged.
    assert_eq!(r(&s, Action::Undo), s);
    s = r(&s, Action::Redo);
    assert_eq!(doc(&s).sections[0].origin, [21.0, 30.0]);
    assert_eq!(s.message, "Redone: section 101 moved");
}

#[test]
fn a_change_after_undo_drops_the_redo_side() {
    let mut s = r(&loaded(), set_floor(FloorKind::Ring, [0.0, 0.0]));
    s = r(&s, Action::Undo);
    s = r(&s, rename("X"));
    assert_eq!(r(&s, Action::Redo), s);
    assert_eq!(doc(&s).floor.kind, FloorKind::Court);
}

#[test]
fn keeps_at_most_100_documents_the_101st_change_drops_the_oldest() {
    let mut s = loaded();
    for _ in 0..101 {
        s = r(&s, move_sections(&["s-101"], 1.0, 0.0));
    }
    assert_eq!(HISTORY_LIMIT, 100);
    assert_eq!(s.history.len(), 100);
    assert_eq!(s.steps.len(), 100);
    for _ in 0..120 {
        s = r(&s, Action::Undo);
    }
    // Back 99 steps: the first two moves can't be undone.
    assert_eq!(doc(&s).sections[0].origin, [22.0, 30.0]);
}

#[test]
fn shares_the_sections_a_change_does_not_touch() {
    let s0 = loaded();
    let s1 = r(&s0, move_sections(&["s-101"], 1.0, 0.0));
    assert!(Arc::ptr_eq(&doc(&s1).sections[1], &doc(&s0).sections[1]));
    assert!(!Arc::ptr_eq(&doc(&s1).sections[0], &doc(&s0).sections[0]));
    assert_eq!(doc(&s1).levels, doc(&s0).levels);
}

// ------------------------------------------------------------------------------ dirty

#[test]
fn dirty_after_a_change_clean_when_undo_returns_to_the_saved_document_and_after_saved() {
    let mut s = r(&loaded(), rename("X"));
    assert!(is_dirty(&s));
    s = r(&s, Action::Undo);
    assert!(!is_dirty(&s));
    s = r(&s, Action::Redo);
    let sent = current_doc(&s).clone();
    s = r(&s, Action::Saved { sent, doc: None });
    assert!(!is_dirty(&s));
    assert_eq!(s.message, "Layout saved");
    // Undo past the save is allowed, and is a change again.
    s = r(&s, Action::Undo);
    assert!(is_dirty(&s));
}

#[test]
fn saved_with_nothing_new_keeps_the_document_and_the_history() {
    let mut s = r(&loaded(), rename("X"));
    let sent = current_doc(&s).clone();
    let back = (*sent).clone();
    s = r(
        &s,
        Action::Saved {
            sent: sent.clone(),
            doc: Some(back),
        },
    );
    assert!(Arc::ptr_eq(current_doc(&s), &sent));
    assert!(!is_dirty(&s));
    assert_eq!(s.cursor, 1);
}

/// A new section added, then moved; read back with the ids the Backend gave everything new.
fn added_and_moved() -> (EditorState, Arc<EditorDoc>, EditorDoc, String) {
    let mut s = r(
        &loaded(),
        Action::AddSection {
            name: "103".into(),
            values: BlockValues {
                rows: 1.0,
                seats_per_row: vec![2.0],
                ..block()
            },
            level_id: "lv-std".into(),
            at: [150.0, 100.0],
        },
    );
    let added = doc(&s).sections[2].id.clone();
    s = r(&s, move_sections(&[&added], 5.0, 0.0));
    let sent = current_doc(&s).clone();
    let server = |id: &str| match id.strip_prefix("new:") {
        Some(n) => format!("srv-{n}"),
        None => id.to_string(),
    };
    let mut back = (*sent).clone();
    back.sections = back
        .sections
        .iter()
        .map(|x| {
            let mut x = (**x).clone();
            x.id = server(&x.id);
            for r in &mut x.rows {
                r.id = server(&r.id);
                for q in &mut r.seats {
                    q.id = server(&q.id);
                }
            }
            Arc::new(x)
        })
        .collect();
    (s, sent, back, added)
}

#[test]
fn saved_with_the_read_back_gives_every_step_the_backends_ids() {
    let (before, sent, back, added) = added_and_moved();
    let mut s = r(
        &before,
        Action::Saved {
            sent,
            doc: Some(back.clone()),
        },
    );
    assert!(!is_dirty(&s));
    assert_eq!(doc(&s).sections[2].id, back.sections[2].id);
    // Undo the move: the section is still the saved one, by id, rows and seats too.
    s = r(&s, Action::Undo);
    let undone = &doc(&s).sections[2];
    assert_eq!(undone.id, back.sections[2].id);
    assert_ne!(undone.id, added);
    let seat_ids = |x: &admin_rust_core::editor::doc::EdSection| -> Vec<String> {
        x.rows[0].seats.iter().map(|q| q.id.clone()).collect()
    };
    assert_eq!(seat_ids(undone), seat_ids(&back.sections[2]));
    assert_eq!(
        to_input(doc(&s), Some(3), false)["sections"][2]["id"],
        Value::String(back.sections[2].id.clone())
    );
}

#[test]
fn keeps_a_change_made_while_the_save_was_on_its_way_still_unsaved_with_the_new_ids() {
    let (before, sent, back, _) = added_and_moved();
    // A move after Save was pressed, before its answer came back.
    let during = r(&before, move_sections(&["s-101"], 50.0, 0.0));
    let moved = doc(&during).sections[0].origin;
    let s = r(
        &during,
        Action::Saved {
            sent,
            doc: Some(back.clone()),
        },
    );
    assert_eq!(doc(&s).sections[0].origin, moved);
    assert!(is_dirty(&s));
    assert_eq!(doc(&s).sections[2].id, back.sections[2].id);
    // Undo returns to what was saved.
    assert!(!is_dirty(&r(&s, Action::Undo)));
}

#[test]
fn saved_remaps_the_selection_and_the_zoom() {
    let (mut s, sent, back, added) = added_and_moved();
    s = r(
        &s,
        Action::Zoom {
            id: Some(added.clone()),
        },
    );
    let row = doc(&s).sections[2].rows[0].id.clone();
    s = r(
        &s,
        Action::SelectRows {
            section_id: added.clone(),
            ids: vec![row],
            add: false,
        },
    );
    s = r(
        &s,
        Action::Saved {
            sent,
            doc: Some(back.clone()),
        },
    );
    assert_eq!(s.zoomed.as_deref(), Some(back.sections[2].id.as_str()));
    assert_eq!(
        s.selection,
        Selection::Rows {
            section_id: back.sections[2].id.clone(),
            ids: vec![back.sections[2].rows[0].id.clone()],
        }
    );
}

// ------------------------------------------------------------------------------ totals

#[test]
fn totals_count_sections_seats_seats_per_level_and_seats_left() {
    let t = totals(doc(&loaded()));
    assert_eq!(t.sections, 2);
    assert_eq!(t.seats, 8);
    assert_eq!(t.seats_left, 30_000 - 8);
    // 101: row A seat 1 own Courtside, A2 A3 Standard (section), row B Courtside ×3; 102 ×2.
    assert_eq!(t.by_level.get("lv-court"), Some(&6));
    assert_eq!(t.by_level.get("lv-std"), Some(&2));
    assert_eq!(t.by_level.len(), 2);
}

#[test]
fn totals_count_0_for_a_level_no_seat_is_in() {
    let t = totals(&empty_doc());
    assert_eq!(t.by_level.len(), 1);
    assert_eq!(t.by_level.get(&empty_doc().levels[0].id), Some(&0));
    assert_eq!(t.level("nope"), 0);
}

// ------------------------------------------------------------------------------ addSection

fn block() -> BlockValues {
    BlockValues {
        rows: 3.0,
        seats_per_row: vec![4.0],
        row_labels: RowLabelStyle::Letters,
        first_row: "A".into(),
        first_seat: 1.0,
        direction: Direction::LeftToRight,
        curve: 0.0,
    }
}

fn add(name: &str, values: BlockValues, at: [f64; 2]) -> Action {
    Action::AddSection {
        name: name.into(),
        values,
        level_id: "new:0".into(),
        at,
    }
}

#[test]
fn generates_the_block_at_the_given_place_in_the_level_selected_with_its_outline() {
    let s = r(
        &init_state(empty_doc()),
        add(" 101 ", block(), [150.0, 100.0]),
    );
    let section = &doc(&s).sections[0];
    assert_eq!(section.name, "101");
    assert_eq!(section.level_id, "new:0");
    assert_eq!(section.origin, [150.0, 100.0]);
    assert_eq!(section.angle, 0.0);
    assert_eq!(section.generator, Some(block()));
    assert!(section.id.starts_with("new:"));
    let labels: Vec<_> = section.rows.iter().map(|r| r.label.as_str()).collect();
    assert_eq!(labels, ["A", "B", "C"]);
    // The origin is the middle of the front row; rows go back toward −y (R7).
    let ats: Vec<_> = section.rows[0].seats.iter().map(|x| x.at).collect();
    assert_eq!(
        ats,
        [
            [147.0, 100.0],
            [149.0, 100.0],
            [151.0, 100.0],
            [153.0, 100.0]
        ]
    );
    assert_eq!(section.rows[2].seats[0].at, [147.0, 96.0]);
    let seat_labels: Vec<_> = section.rows[0]
        .seats
        .iter()
        .map(|x| x.label.as_str())
        .collect();
    assert_eq!(seat_labels, ["1", "2", "3", "4"]);
    assert_eq!(section.outline, outline_of(&section.rows));
    let mut all = vec![section.id.clone()];
    for r in &section.rows {
        all.push(r.id.clone());
        all.extend(r.seats.iter().map(|x| x.id.clone()));
    }
    let unique: std::collections::HashSet<_> = all.iter().collect();
    assert_eq!(unique.len(), all.len());
    assert_eq!(s.selection, sel_sections(&[&section.id]));
    assert_eq!(s.message, "Section 101 added");
    assert_eq!(totals(doc(&s)).seats, 12);
}

#[test]
fn refuses_a_block_that_would_take_the_layout_over_30000_seats() {
    let big = BlockValues {
        rows: 100.0,
        seats_per_row: vec![200.0],
        ..block()
    };
    let s = r(
        &init_state(empty_doc()),
        add("A", big.clone(), [2500.0, 2500.0]),
    );
    let t = r(&s, add("B", big, [2500.0, 2500.0]));
    assert_eq!(doc(&t).sections.len(), 1);
    assert_eq!(t.message, "The layout would be over its limits");
    assert_eq!(t.history.len(), s.history.len());
}

#[test]
fn refuses_a_block_it_cannot_generate_and_a_101st_section() {
    let s = r(
        &init_state(empty_doc()),
        add(
            "A",
            BlockValues {
                rows: 0.0,
                ..block()
            },
            [10.0, 10.0],
        ),
    );
    assert_eq!(s.message, "The section could not be generated");
    assert!(doc(&s).sections.is_empty());
    let mut s = init_state(empty_doc());
    let one = BlockValues {
        rows: 1.0,
        seats_per_row: vec![1.0],
        ..block()
    };
    for i in 0..100 {
        s = r(&s, add(&format!("S{i}"), one.clone(), [10.0, 10.0]));
    }
    assert_eq!(doc(&s).sections.len(), 100);
    let t = r(&s, add("S100", one, [10.0, 10.0]));
    assert_eq!(doc(&t).sections.len(), 100);
    assert_eq!(t.message, "The layout would be over its limits");
}

// ------------------------------------------------------------------------------ move and turn

#[test]
fn moves_a_section_its_seats_outline_and_origin_by_the_offset() {
    let s = r(&loaded(), move_sections(&["s-101"], 10.0, 5.0));
    let a = &doc(&s).sections[0];
    assert_eq!(a.origin, [30.0, 35.0]);
    assert_eq!(a.rows[0].seats[0].at, [28.0, 35.0]);
    let before = doc(&loaded()).sections[0].outline[0];
    assert_eq!(a.outline[0], [before[0] + 10.0, before[1] + 5.0]);
    assert_eq!(s.message, "Section 101 moved");
}

#[test]
fn moves_several_sections_as_one_step() {
    let s = r(&loaded(), move_sections(&["s-101", "s-102"], 1.0, 1.0));
    let origins: Vec<_> = doc(&s).sections.iter().map(|x| x.origin).collect();
    assert_eq!(origins, [[21.0, 31.0], [101.04, 31.0]]);
    assert_eq!(s.message, "2 sections moved");
    assert_eq!(s.history.len(), 2);
}

#[test]
fn past_the_top_or_left_edge_moves_everything_so_no_place_is_below_0() {
    let before = doc(&loaded()).clone();
    let s = r(&loaded(), move_sections(&["s-101"], 0.0, -40.0));
    let after = doc(&s);
    // 101's outline reached y = 26.5 − 40 = −13.5: everything moves down 15.
    assert_eq!(after.sections[0].origin, [20.0, 5.0]);
    assert_eq!(after.sections[1].origin, [100.04, 45.0]);
    assert_eq!(after.floor.outline.as_ref().unwrap()[0], [40.0, 55.0]);
    let min_y = after
        .sections
        .iter()
        .flat_map(|x| {
            x.outline
                .iter()
                .map(|p| p[1])
                .chain(x.rows.iter().flat_map(|r| r.seats.iter().map(|q| q.at[1])))
                .collect::<Vec<_>>()
        })
        .fold(f64::INFINITY, f64::min);
    assert!(min_y >= 0.0);
    assert_eq!(before.sections[1].origin, [100.04, 30.0]);
}

#[test]
fn never_moves_past_5000() {
    let s = r(&loaded(), move_sections(&["s-101"], 9000.0, 0.0));
    let max_x = doc(&s).sections[0]
        .outline
        .iter()
        .map(|p| p[0])
        .fold(f64::NEG_INFINITY, f64::max);
    assert!((max_x - 5000.0).abs() < 1e-6);
}

#[test]
fn a_move_of_nothing_or_by_nothing_is_no_change() {
    let s = loaded();
    assert_eq!(r(&s, move_sections(&["nope"], 1.0, 1.0)), s);
    assert_eq!(r(&s, move_sections(&["s-101"], 0.0, 0.0)), s);
}

#[test]
fn turns_each_section_about_its_own_origin_clockwise_keeping_the_angle_in_range() {
    let mut s = r(
        &loaded(),
        Action::TurnSections {
            ids: ids(&["s-101"]),
            degrees: 90.0,
        },
    );
    let a = &doc(&s).sections[0];
    assert_eq!(a.angle, 90.0);
    // Seat A3 at (22, 30), 2 right of the origin (20, 30), turns to 2 below it.
    let [x, y] = a.rows[0].seats[2].at;
    assert!((x - 20.0).abs() < 1e-9);
    assert!((y - 32.0).abs() < 1e-9);
    assert_eq!(a.origin, [20.0, 30.0]);
    assert_eq!(s.message, "Section 101 turned to 90°");
    s = r(
        &s,
        Action::TurnSections {
            ids: ids(&["s-101", "s-102"]),
            degrees: 100.0,
        },
    );
    let angles: Vec<_> = doc(&s).sections.iter().map(|q| q.angle).collect();
    assert_eq!(angles, [-170.0, -170.0]);
    assert_eq!(doc(&s).sections[1].origin, [100.04, 30.0]);
    assert_eq!(s.message, "2 sections turned 100°");
}

#[test]
fn a_whole_turn_is_no_change() {
    let s = loaded();
    assert_eq!(
        r(
            &s,
            Action::TurnSections {
                ids: ids(&["s-101"]),
                degrees: 360.0
            }
        ),
        s
    );
}

// ------------------------------------------------------------------------------ placeSection

#[test]
fn a_typed_angle_turns_by_the_difference_a_typed_place_moves_the_origin_there() {
    let mut s = r(
        &loaded(),
        Action::PlaceSection {
            id: "s-102".into(),
            origin: None,
            angle: Some(30.0),
        },
    );
    assert_eq!(doc(&s).sections[1].angle, 30.0);
    assert_eq!(s.message, "Section 102 turned to 30°");
    s = r(
        &s,
        Action::PlaceSection {
            id: "s-101".into(),
            origin: Some([50.0, 60.0]),
            angle: None,
        },
    );
    let a = &doc(&s).sections[0];
    assert_eq!(a.origin, [50.0, 60.0]);
    assert_eq!(a.rows[0].seats[0].at, [48.0, 60.0]);
    assert_eq!(s.message, "Section 101 moved");
}

#[test]
fn typing_on_in_the_same_box_is_one_step() {
    let place = |angle| Action::PlaceSection {
        id: "s-101".into(),
        origin: None,
        angle: Some(angle),
    };
    let mut s = r(&loaded(), place(3.0));
    s = r(&s, place(30.0));
    assert_eq!(s.history.len(), 2);
    assert_eq!(doc(&s).sections[0].angle, 30.0);
    // Another box is another step.
    s = r(
        &s,
        Action::PlaceSection {
            id: "s-101".into(),
            origin: Some([1.0, 2.0]),
            angle: None,
        },
    );
    assert_eq!(s.history.len(), 3);
}

#[test]
fn a_place_that_is_not_a_number_is_no_change() {
    let s = loaded();
    assert_eq!(
        r(
            &s,
            Action::PlaceSection {
                id: "s-101".into(),
                origin: Some([f64::NAN, 1.0]),
                angle: Some(f64::INFINITY),
            }
        ),
        s
    );
    assert_eq!(
        r(
            &s,
            Action::PlaceSection {
                id: "nope".into(),
                origin: Some([1.0, 1.0]),
                angle: None
            }
        ),
        s
    );
}

// ------------------------------------------------------------------------------ the floor, moved and resized

#[test]
fn moves_the_floor_by_an_offset_and_resizes_it_to_new_bounds() {
    let mut s = r(&loaded(), Action::MoveFloor { dx: 10.0, dy: 0.0 });
    assert_eq!(
        doc(&s).floor.outline.clone().unwrap(),
        [[50.0, 40.0], [90.0, 40.0], [90.0, 60.0], [50.0, 60.0]]
    );
    assert_eq!(s.message, "Floor object moved");
    s = r(
        &s,
        Action::ResizeFloor {
            to: Bounds {
                x: 50.0,
                y: 40.0,
                width: 60.0,
                height: 30.0,
            },
        },
    );
    assert_eq!(
        doc(&s).floor.outline.clone().unwrap(),
        [[50.0, 40.0], [110.0, 40.0], [110.0, 70.0], [50.0, 70.0]]
    );
    assert_eq!(s.message, "Floor object resized");
}

#[test]
fn a_floor_resized_under_1_or_moved_by_nothing_is_no_change() {
    let s = loaded();
    assert_eq!(r(&s, Action::MoveFloor { dx: 0.0, dy: 0.0 }), s);
    let tiny = Bounds {
        x: 1.0,
        y: 1.0,
        width: 0.5,
        height: 30.0,
    };
    assert_eq!(r(&s, Action::ResizeFloor { to: tiny }), s);
    let e = init_state(empty_doc());
    assert_eq!(r(&e, Action::MoveFloor { dx: 1.0, dy: 0.0 }), e);
}

// ------------------------------------------------------------------------------ levels

fn level_names(s: &EditorState) -> Vec<String> {
    doc(s).levels.iter().map(|l| l.name.clone()).collect()
}

#[test]
fn adds_a_level_with_the_first_of_the_12_colors_not_yet_used_up_to_12() {
    let mut s = r(&loaded(), Action::AddLevel);
    let added = doc(&s).levels[2].clone();
    assert_eq!(
        (added.name.as_str(), added.color.as_str()),
        ("Level 3", "blue")
    );
    assert!(added.id.starts_with("new:"));
    assert_eq!(s.message, "Level 3 added");
    for _ in 0..9 {
        s = r(&s, Action::AddLevel);
    }
    assert_eq!(doc(&s).levels.len(), 12);
    let colors: std::collections::HashSet<_> =
        doc(&s).levels.iter().map(|l| l.color.clone()).collect();
    assert_eq!(colors.len(), 12);
    let t = r(&s, Action::AddLevel);
    assert_eq!(doc(&t).levels.len(), 12);
    assert_eq!(t.message, "A layout has at most 12 levels");
}

#[test]
fn a_new_level_skips_names_already_taken() {
    let mut s = r(
        &loaded(),
        Action::RenameLevel {
            id: "lv-std".into(),
            name: "level 3".into(),
        },
    );
    s = r(&s, Action::AddLevel);
    assert_eq!(doc(&s).levels[2].name, "Level 4");
}

#[test]
fn renames_a_level_refusing_an_empty_name_or_one_another_level_has() {
    let s = r(
        &loaded(),
        Action::RenameLevel {
            id: "lv-std".into(),
            name: "Lower sideline".into(),
        },
    );
    assert_eq!(level_names(&s), ["Courtside", "Lower sideline"]);
    assert_eq!(s.message, "Standard renamed Lower sideline");
    assert_eq!(
        level_name_problem(doc(&s), "lv-std", "courtside").as_deref(),
        Some("Another level is named courtside")
    );
    assert_eq!(
        level_name_problem(doc(&s), "lv-std", " ").as_deref(),
        Some("Name the level")
    );
    assert_eq!(
        level_name_problem(doc(&s), "lv-std", &"x".repeat(51)).as_deref(),
        Some("At most 50 characters")
    );
    assert_eq!(
        level_name_problem(doc(&s), "lv-std", "Lower sideline"),
        None
    );
    let refused = r(
        &s,
        Action::RenameLevel {
            id: "lv-std".into(),
            name: "COURTSIDE".into(),
        },
    );
    assert_eq!(doc(&refused), doc(&s));
    assert_eq!(refused.history.len(), s.history.len());
    assert_eq!(refused.message, "Another level is named COURTSIDE");
}

#[test]
fn recolors_a_level() {
    let s = r(
        &loaded(),
        Action::RecolorLevel {
            id: "lv-std".into(),
            color: "teal".into(),
        },
    );
    assert_eq!(doc(&s).levels[1].color, "teal");
    assert_eq!(s.message, "Standard is now teal");
    assert_eq!(
        r(
            &s,
            Action::RecolorLevel {
                id: "lv-std".into(),
                color: "teal".into()
            }
        ),
        s
    );
}

#[test]
fn moves_a_level_up_and_down_ranks_follow_the_order() {
    let mut s = r(
        &loaded(),
        Action::MoveLevel {
            id: "lv-std".into(),
            by: -1,
        },
    );
    assert_eq!(level_names(&s), ["Standard", "Courtside"]);
    assert_eq!(s.message, "Standard moved to rank 1");
    let keys: Vec<(String, String)> = to_input(doc(&s), Some(4), false)["levels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            (
                l["key"].as_str().unwrap().to_string(),
                l["name"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(
        keys,
        [
            ("l1".to_string(), "Standard".to_string()),
            ("l2".to_string(), "Courtside".to_string())
        ]
    );
    // Not past either end.
    assert_eq!(
        r(
            &s,
            Action::MoveLevel {
                id: "lv-std".into(),
                by: -1
            }
        ),
        s
    );
    s = r(
        &s,
        Action::MoveLevel {
            id: "lv-std".into(),
            by: 1,
        },
    );
    assert_eq!(level_names(&s), ["Courtside", "Standard"]);
}

#[test]
fn deletes_a_level_its_seats_taking_the_replacement_overrides_equal_to_their_parent_go() {
    let s = r(
        &loaded(),
        Action::DeleteLevel {
            id: "lv-court".into(),
            replacement: "lv-std".into(),
        },
    );
    assert_eq!(level_names(&s), ["Standard"]);
    let a = &doc(&s).sections[0];
    let b = &doc(&s).sections[1];
    // Row B and seat A1 were Courtside, now Standard: the same as their section, so cleared.
    assert_eq!(a.rows[1].level_id, None);
    assert_eq!(a.rows[0].seats[0].level_id, None);
    assert_eq!(b.level_id, "lv-std");
    let t = totals(doc(&s));
    assert_eq!(t.by_level.len(), 1);
    assert_eq!(t.by_level.get("lv-std"), Some(&8));
    assert_eq!(s.message, "Courtside deleted; its seats are now Standard");
}

#[test]
fn keeps_an_override_that_differs_from_its_new_parent() {
    let mut s = r(&loaded(), Action::AddLevel);
    let upper = doc(&s).levels[2].id.clone();
    s = r(
        &s,
        Action::DeleteLevel {
            id: "lv-court".into(),
            replacement: upper.clone(),
        },
    );
    let a = &doc(&s).sections[0];
    assert_eq!(a.rows[1].level_id.as_deref(), Some(upper.as_str()));
    assert_eq!(a.rows[0].seats[0].level_id.as_deref(), Some(upper.as_str()));
}

#[test]
fn refuses_to_delete_the_last_level() {
    let s = r(
        &init_state(empty_doc()),
        Action::DeleteLevel {
            id: "new:0".into(),
            replacement: "new:0".into(),
        },
    );
    assert_eq!(doc(&s).levels.len(), 1);
    assert_eq!(s.message, "The last level can't be deleted");
    let s = r(
        &loaded(),
        Action::DeleteLevel {
            id: "lv-court".into(),
            replacement: "lv-court".into(),
        },
    );
    assert_eq!(doc(&s).levels.len(), 2);
    assert_eq!(s, loaded());
}

// ------------------------------------------------------------------------------ painting

#[test]
fn paints_selected_sections_their_section_level() {
    let mut s = r(
        &loaded(),
        Action::SelectSections {
            ids: ids(&["s-101", "s-102"]),
        },
    );
    s = r(
        &s,
        Action::Paint {
            level_id: "lv-std".into(),
        },
    );
    let levels: Vec<_> = doc(&s)
        .sections
        .iter()
        .map(|x| x.level_id.clone())
        .collect();
    assert_eq!(levels, ["lv-std", "lv-std"]);
    assert_eq!(s.message, "2 sections painted Standard");
    // Rows and seats with their own level keep it.
    let t = totals(doc(&s));
    assert_eq!((t.by_level["lv-court"], t.by_level["lv-std"]), (4, 4));
}

#[test]
fn painting_a_section_its_own_level_still_makes_a_step_quirk_le48() {
    let mut s = r(
        &loaded(),
        Action::SelectSections {
            ids: ids(&["s-101"]),
        },
    );
    s = r(
        &s,
        Action::Paint {
            level_id: "lv-std".into(),
        },
    );
    assert_eq!(s.history.len(), 2);
    assert_eq!(s.message, "Section 101 painted Standard");
    assert!(is_dirty(&s));
}

#[test]
fn paints_rows_their_own_level_and_a_range_of_rows_by_label() {
    let mut s = r(
        &loaded(),
        Action::SelectRows {
            section_id: "s-101".into(),
            ids: ids(&["r-101-a"]),
            add: false,
        },
    );
    s = r(
        &s,
        Action::SelectRowRange {
            section_id: "s-101".into(),
            to_id: "r-101-b".into(),
        },
    );
    assert_eq!(
        s.selection,
        Selection::Rows {
            section_id: "s-101".into(),
            ids: ids(&["r-101-a", "r-101-b"])
        }
    );
    s = r(
        &s,
        Action::Paint {
            level_id: "lv-court".into(),
        },
    );
    let levels: Vec<_> = doc(&s).sections[0]
        .rows
        .iter()
        .map(|r| r.level_id.clone())
        .collect();
    assert_eq!(
        levels,
        [Some("lv-court".to_string()), Some("lv-court".to_string())]
    );
    assert_eq!(s.message, "Rows A–B painted Courtside");
    let t = totals(doc(&s));
    assert_eq!((t.by_level["lv-court"], t.by_level["lv-std"]), (8, 0));
}

#[test]
fn paints_seats_their_own_level_and_same_as_clears_it() {
    let mut s = r(
        &loaded(),
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a2"]),
            add: false,
        },
    );
    s = r(
        &s,
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a3"]),
            add: true,
        },
    );
    s = r(
        &s,
        Action::Paint {
            level_id: "lv-court".into(),
        },
    );
    let own = |s: &EditorState| -> Vec<Option<String>> {
        doc(s).sections[0].rows[0]
            .seats
            .iter()
            .map(|x| x.level_id.clone())
            .collect()
    };
    let court = Some("lv-court".to_string());
    assert_eq!(own(&s), [court.clone(), court.clone(), court.clone()]);
    assert_eq!(s.message, "2 seats painted Courtside");
    s = r(&s, Action::ClearLevel);
    assert_eq!(own(&s), [court, None, None]);
    assert_eq!(s.message, "2 seats take the row's level");
    s = r(
        &s,
        Action::SelectRows {
            section_id: "s-101".into(),
            ids: ids(&["r-101-b"]),
            add: false,
        },
    );
    s = r(&s, Action::ClearLevel);
    assert_eq!(doc(&s).sections[0].rows[1].level_id, None);
    assert_eq!(s.message, "Row B takes the section's level");
}

#[test]
fn a_seat_selected_twice_with_add_is_taken_out_leaving_its_section_chosen() {
    let mut s = r(
        &loaded(),
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a2"]),
            add: false,
        },
    );
    s = r(
        &s,
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-a2"]),
            add: true,
        },
    );
    assert_eq!(s.selection, sel_sections(&["s-101"]));
}

#[test]
fn names_one_seat_by_its_row_and_label() {
    let mut s = r(
        &loaded(),
        Action::SelectSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-b3"]),
            add: false,
        },
    );
    s = r(
        &s,
        Action::Paint {
            level_id: "lv-std".into(),
        },
    );
    assert_eq!(s.message, "Row B, seat 3 painted Standard");
}

#[test]
fn paints_nothing_without_a_selection() {
    let s = loaded();
    assert_eq!(
        r(
            &s,
            Action::Paint {
                level_id: "lv-std".into()
            }
        ),
        s
    );
    // Clearing a sections selection's level is nothing too.
    let s = r(
        &s,
        Action::SelectSections {
            ids: ids(&["s-101"]),
        },
    );
    assert_eq!(r(&s, Action::ClearLevel), s);
}

#[test]
fn rows_word_and_seats_word_name_a_run_a_list_and_a_count() {
    let d = doc(&loaded()).clone();
    let s101 = &d.sections[0];
    assert_eq!(rows_word(s101, &ids(&["r-101-b"])), "Row B");
    assert_eq!(rows_word(s101, &ids(&["r-101-b", "r-101-a"])), "Rows A–B");
    let mut three = (**s101).clone();
    let mut c = three.rows[1].clone();
    c.id = "r-c".into();
    c.label = "C".into();
    three.rows.push(c);
    assert_eq!(rows_word(&three, &ids(&["r-101-a", "r-c"])), "Rows A, C");
    assert_eq!(seats_word(s101, &ids(&["st-a2", "st-a3"])), "2 seats");
    assert_eq!(seats_word(s101, &ids(&["st-b1"])), "Row B, seat 1");
    assert_eq!(seats_word(s101, &ids(&["gone"])), "1 seat");
    assert_eq!(seats_word(s101, &[]), "0 seats");
}

// ------------------------------------------------------------------------------ duplicate and rename

#[test]
fn copies_a_section_10_units_right_under_a_free_name_with_new_ids_levels_marks_and_generator() {
    let mut s = r(&loaded(), Action::DuplicateSection { id: "s-101".into() });
    let orig = doc(&s).sections[0].clone();
    let copy = doc(&s).sections[2].clone();
    assert_eq!(copy.name, "101 (2)");
    assert_eq!(copy.origin, [30.0, 30.0]);
    assert_eq!(copy.level_id, orig.level_id);
    assert_eq!(copy.generator, orig.generator);
    assert_eq!(copy.rows[1].level_id.as_deref(), Some("lv-court"));
    let seat = &copy.rows[0].seats[0];
    assert_eq!(seat.label, "1");
    assert_eq!(seat.at, [28.0, 30.0]);
    assert_eq!(seat.level_id.as_deref(), Some("lv-court"));
    assert!(seat.accessible);
    let mut all = vec![copy.id.clone()];
    for r in &copy.rows {
        all.push(r.id.clone());
        all.extend(r.seats.iter().map(|x| x.id.clone()));
    }
    assert!(all.iter().all(|id| id.starts_with("new:")));
    assert_eq!(s.selection, sel_sections(&[&copy.id]));
    assert_eq!(s.message, "Section 101 duplicated as 101 (2)");
    s = r(&s, Action::DuplicateSection { id: "s-101".into() });
    assert_eq!(doc(&s).sections[3].name, "101 (3)");
}

#[test]
fn duplicate_refuses_past_100_sections_and_30000_seats_by_message_only() {
    let mut s = init_state(empty_doc());
    let one = BlockValues {
        rows: 1.0,
        seats_per_row: vec![1.0],
        ..block()
    };
    for i in 0..100 {
        s = r(&s, add(&format!("S{i}"), one.clone(), [10.0, 10.0]));
    }
    let first = doc(&s).sections[0].id.clone();
    let t = r(&s, Action::DuplicateSection { id: first });
    assert_eq!(t.message, "A layout has at most 100 sections");
    assert_eq!(t.history.len(), s.history.len());
    let big = BlockValues {
        rows: 100.0,
        seats_per_row: vec![200.0],
        ..block()
    };
    let s = r(&init_state(empty_doc()), add("A", big, [2500.0, 2500.0]));
    let id = doc(&s).sections[0].id.clone();
    let t = r(&s, Action::DuplicateSection { id });
    assert_eq!(t.message, "The layout would be over its limits");
    assert_eq!(r(&s, Action::DuplicateSection { id: "nope".into() }), s);
}

#[test]
fn free_name_cuts_the_base_so_the_whole_is_at_most_50() {
    let d = doc(&loaded()).clone();
    assert_eq!(free_name(&d, "101"), "101 (2)");
    let long = "x".repeat(50);
    let name = free_name(&d, &long);
    assert_eq!(name, format!("{} (2)", "x".repeat(46)));
    assert_eq!(name.len(), 50);
}

#[test]
fn renames_a_section_refusing_a_name_another_section_has() {
    let mut s = r(
        &loaded(),
        Action::RenameSection {
            id: "s-101".into(),
            name: "104".into(),
        },
    );
    assert_eq!(doc(&s).sections[0].name, "104");
    assert_eq!(s.message, "Section 101 renamed 104");
    assert_eq!(
        section_name_problem(doc(&s), "s-101", "102").as_deref(),
        Some("Another section is named 102")
    );
    assert_eq!(
        section_name_problem(doc(&s), "s-101", "").as_deref(),
        Some("Name the section")
    );
    assert_eq!(
        section_name_problem(doc(&s), "s-101", &"é".repeat(51)).as_deref(),
        Some("At most 50 characters")
    );
    s = r(
        &s,
        Action::RenameSection {
            id: "s-101".into(),
            name: "102".into(),
        },
    );
    assert_eq!(doc(&s).sections[0].name, "104");
    assert_eq!(s.message, "Another section is named 102");
    // The same name, trimmed, is no change.
    assert_eq!(
        r(
            &s,
            Action::RenameSection {
                id: "s-101".into(),
                name: " 104 ".into()
            }
        )
        .history
        .len(),
        s.history.len()
    );
}

// ------------------------------------------------------------------------------ deleting

#[test]
fn deletes_seats_a_row_left_empty_is_removed_and_the_outline_redrawn() {
    let s = r(
        &loaded(),
        Action::DeleteSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-b1", "st-b2", "st-b3", "st-a3"]),
        },
    );
    let a = &doc(&s).sections[0];
    let labels: Vec<_> = a.rows.iter().map(|r| r.label.as_str()).collect();
    assert_eq!(labels, ["A"]);
    let seats: Vec<_> = a.rows[0].seats.iter().map(|x| x.label.as_str()).collect();
    assert_eq!(seats, ["1", "2"]);
    assert_eq!(a.rows[0].seats[1].at, [20.0, 30.0]);
    assert_eq!(a.outline, outline_of(&a.rows));
    assert_eq!(s.message, "4 seats deleted from section 101");
    assert_eq!(s.selection, Selection::None);
    let one = r(
        &loaded(),
        Action::DeleteSeats {
            section_id: "s-101".into(),
            ids: ids(&["st-b1"]),
        },
    );
    assert_eq!(one.message, "1 seat deleted from section 101");
}

#[test]
fn asks_before_the_last_seats_of_a_section_go_the_section_is_deleted_instead() {
    let all = ids(&["st-a1", "st-a2", "st-a3", "st-b1", "st-b2", "st-b3"]);
    assert_eq!(
        plan_delete_seats(doc(&loaded()), "s-101", &all),
        DeletePlan::Section
    );
    assert_eq!(
        plan_delete_seats(doc(&loaded()), "s-101", &ids(&["st-a1"])),
        DeletePlan::Seats
    );
    assert_eq!(
        plan_delete_seats(doc(&loaded()), "nope", &ids(&["st-a1"])),
        DeletePlan::Section
    );
    let s = loaded();
    let t = r(
        &s,
        Action::DeleteSeats {
            section_id: "s-101".into(),
            ids: all,
        },
    );
    assert_eq!(doc(&t), doc(&s));
    assert_eq!(
        t.message,
        "Deleting every seat deletes the section: delete section 101 instead"
    );
}

#[test]
fn deletes_sections() {
    let s = r(
        &loaded(),
        Action::DeleteSections {
            ids: ids(&["s-102"]),
        },
    );
    let names: Vec<_> = doc(&s).sections.iter().map(|x| x.name.clone()).collect();
    assert_eq!(names, ["101"]);
    assert_eq!(s.message, "Section 102 deleted");
    assert_eq!(
        r(
            &s,
            Action::DeleteSections {
                ids: ids(&["nope"])
            }
        ),
        s
    );
}

#[test]
fn deleting_the_zoomed_section_leaves_the_zoom() {
    let mut s = r(
        &loaded(),
        Action::Zoom {
            id: Some("s-102".into()),
        },
    );
    s = r(
        &s,
        Action::DeleteSections {
            ids: ids(&["s-101"]),
        },
    );
    assert_eq!(s.zoomed.as_deref(), Some("s-102"));
    s = r(
        &s,
        Action::DeleteSections {
            ids: ids(&["s-102"]),
        },
    );
    assert_eq!(s.zoomed, None);
}

// ------------------------------------------------------------------------------ labels and accessible seats

#[test]
fn relabels_a_row_refusing_one_used_in_the_section_or_longer_than_5() {
    let s = r(
        &loaded(),
        Action::RelabelRow {
            section_id: "s-101".into(),
            row_id: "r-101-b".into(),
            label: "A1".into(),
        },
    );
    assert_eq!(doc(&s).sections[0].rows[1].label, "A1");
    assert_eq!(s.message, "Row B relabelled A1");
    assert_eq!(
        row_label_problem(doc(&s), "s-101", "r-101-b", "A").as_deref(),
        Some("Row A is already in section 101")
    );
    assert_eq!(
        row_label_problem(doc(&s), "s-101", "r-101-b", "ABCDEF").as_deref(),
        Some("At most 5 characters")
    );
    assert_eq!(
        row_label_problem(doc(&s), "s-101", "r-101-b", " ").as_deref(),
        Some("Give the row a label")
    );
    let t = r(
        &s,
        Action::RelabelRow {
            section_id: "s-101".into(),
            row_id: "r-101-b".into(),
            label: "A".into(),
        },
    );
    assert_eq!(doc(&t), doc(&s));
    assert_eq!(t.history.len(), s.history.len());
}

#[test]
fn relabels_a_seat_refusing_one_used_in_its_row() {
    let s = r(
        &loaded(),
        Action::RelabelSeat {
            section_id: "s-101".into(),
            seat_id: "st-a3".into(),
            label: "3A".into(),
        },
    );
    assert_eq!(doc(&s).sections[0].rows[0].seats[2].label, "3A");
    assert_eq!(s.message, "Row A, seat 3 relabelled 3A");
    assert_eq!(
        seat_label_problem(doc(&s), "s-101", "st-a3", "1").as_deref(),
        Some("Seat 1 is already in row A")
    );
    assert_eq!(seat_label_problem(doc(&s), "s-101", "st-b1", "3A"), None);
    assert_eq!(
        seat_label_problem(doc(&s), "s-101", "st-b1", "").as_deref(),
        Some("Give the seat a label")
    );
}

#[test]
fn refuses_a_label_that_differs_from_another_only_in_case_as_the_backend_does() {
    let s = r(
        &loaded(),
        Action::RelabelSeat {
            section_id: "s-101".into(),
            seat_id: "st-a3".into(),
            label: "3A".into(),
        },
    );
    assert_eq!(
        seat_label_problem(doc(&s), "s-101", "st-a1", "3a").as_deref(),
        Some("Seat 3a is already in row A")
    );
    let t = r(
        &s,
        Action::RelabelRow {
            section_id: "s-101".into(),
            row_id: "r-101-b".into(),
            label: "X".into(),
        },
    );
    assert_eq!(
        row_label_problem(doc(&t), "s-101", "r-101-a", "x").as_deref(),
        Some("Row x is already in section 101")
    );
}

#[test]
fn marks_seats_accessible_and_not() {
    let mut s = r(
        &loaded(),
        Action::MarkAccessible {
            section_id: "s-101".into(),
            ids: ids(&["st-a2", "st-b2"]),
            accessible: true,
        },
    );
    let marks: Vec<_> = doc(&s).sections[0]
        .rows
        .iter()
        .map(|r| r.seats[1].accessible)
        .collect();
    assert_eq!(marks, [true, true]);
    assert_eq!(s.message, "2 seats marked accessible");
    s = r(
        &s,
        Action::MarkAccessible {
            section_id: "s-101".into(),
            ids: ids(&["st-a1"]),
            accessible: false,
        },
    );
    assert!(!doc(&s).sections[0].rows[0].seats[0].accessible);
    assert_eq!(s.message, "Row A, seat 1 marked not accessible");
}

#[test]
fn marking_accessible_seats_accessible_again_still_makes_a_step_quirk_le56() {
    let s = r(
        &loaded(),
        Action::MarkAccessible {
            section_id: "s-101".into(),
            ids: ids(&["st-a1"]),
            accessible: true,
        },
    );
    assert_eq!(s.history.len(), 2);
    assert_eq!(s.message, "Row A, seat 1 marked accessible");
}

// ------------------------------------------------------------------------------ regenerate

fn regen_values() -> BlockValues {
    let mut v: BlockValues =
        serde_json::from_value(fixture("drawing.json")["sections"][0]["generator"].clone())
            .unwrap();
    v.rows = 3.0;
    v.seats_per_row = vec![2.0];
    v
}

#[test]
fn says_how_many_seats_would_go_and_whether_labels_changed_by_hand_are_replaced() {
    assert_eq!(
        regenerate_plan(doc(&loaded()), "s-101", &regen_values()),
        RegeneratePlan {
            removed: 2,
            hand_labels: false
        }
    );
    let s = r(
        &loaded(),
        Action::RelabelRow {
            section_id: "s-101".into(),
            row_id: "r-101-b".into(),
            label: "BB".into(),
        },
    );
    assert!(regenerate_plan(doc(&s), "s-101", &regen_values()).hand_labels);
}

#[test]
fn rebuilds_the_block_in_place_keeping_ids_and_own_levels_of_rows_and_seats_whose_labels_remain() {
    let s = r(
        &loaded(),
        Action::Regenerate {
            id: "s-101".into(),
            values: regen_values(),
        },
    );
    let a = &doc(&s).sections[0];
    assert_eq!(a.generator, Some(regen_values()));
    assert_eq!(a.rows[0].id, "r-101-a");
    assert_eq!(a.rows[0].level_id, None);
    assert_eq!(a.rows[1].id, "r-101-b");
    assert_eq!(a.rows[1].level_id.as_deref(), Some("lv-court"));
    assert!(a.rows[2].id.starts_with("new:"));
    assert_eq!(a.rows[2].label, "C");
    assert_eq!(a.rows[2].level_id, None);
    let seats: Vec<_> = a.rows[0]
        .seats
        .iter()
        .map(|x| {
            (
                x.id.as_str(),
                x.label.as_str(),
                x.level_id.as_deref(),
                x.accessible,
            )
        })
        .collect();
    assert_eq!(
        seats,
        [
            ("st-a1", "1", Some("lv-court"), true),
            ("st-a2", "2", None, false)
        ]
    );
    // The block's front row is centered on the origin (20, 30), at the section's angle 0.
    let ats: Vec<_> = a.rows[0].seats.iter().map(|x| x.at).collect();
    assert_eq!(ats, [[19.0, 30.0], [21.0, 30.0]]);
    assert_eq!(a.rows[2].seats[0].at, [19.0, 26.0]);
    assert_eq!(a.outline, outline_of(&a.rows));
    assert_eq!(s.message, "Section 101 regenerated");
    assert_eq!(s.selection, sel_sections(&["s-101"]));
}

#[test]
fn keeps_the_sections_angle() {
    let mut s = r(
        &loaded(),
        Action::TurnSections {
            ids: ids(&["s-101"]),
            degrees: 90.0,
        },
    );
    s = r(
        &s,
        Action::Regenerate {
            id: "s-101".into(),
            values: regen_values(),
        },
    );
    let [x, y] = doc(&s).sections[0].rows[0].seats[1].at;
    assert!((x - 20.0).abs() < 1e-9);
    assert!((y - 31.0).abs() < 1e-9);
    assert_eq!(doc(&s).sections[0].angle, 90.0);
}

#[test]
fn regenerate_refuses_bad_values_and_the_seat_limit() {
    let s = loaded();
    let bad = r(
        &s,
        Action::Regenerate {
            id: "s-101".into(),
            values: BlockValues {
                rows: f64::NAN,
                ..regen_values()
            },
        },
    );
    assert_eq!(bad.message, "The section could not be generated");
    assert_eq!(doc(&bad), doc(&s));
    let mut big = r(
        &s,
        add(
            "Big",
            BlockValues {
                rows: 100.0,
                seats_per_row: vec![200.0],
                ..block()
            },
            [2500.0, 2500.0],
        ),
    );
    big = r(
        &big,
        Action::Regenerate {
            id: "s-101".into(),
            values: BlockValues {
                rows: 100.0,
                seats_per_row: vec![200.0],
                ..block()
            },
        },
    );
    assert_eq!(big.message, "The layout would be over its limits");
    assert_eq!(
        r(
            &s,
            Action::Regenerate {
                id: "nope".into(),
                values: regen_values()
            }
        ),
        s
    );
    assert_eq!(seat_count(&doc(&s).sections[0]), 6);
}

// ------------------------------------------------------------------------------ parity with the TypeScript reducer

fn parse_action(step: &Value) -> Action {
    serde_json::from_value(step.clone()).unwrap_or_else(|e| panic!("{step}: {e}"))
}

fn server_doc(sent: &EditorDoc) -> EditorDoc {
    let server = |id: &str| match id.strip_prefix("new:") {
        Some(n) => format!("srv-{n}"),
        None => id.to_string(),
    };
    let mut back = sent.clone();
    for l in &mut back.levels {
        l.id = server(&l.id);
    }
    back.sections = back
        .sections
        .iter()
        .map(|x| {
            let mut x = (**x).clone();
            x.id = server(&x.id);
            x.level_id = server(&x.level_id);
            for r in &mut x.rows {
                r.id = server(&r.id);
                r.level_id = r.level_id.as_deref().map(server);
                for q in &mut r.seats {
                    q.id = server(&q.id);
                    q.level_id = q.level_id.as_deref().map(server);
                }
            }
            Arc::new(x)
        })
        .collect();
    back
}

#[test]
fn every_scenario_gives_the_typescript_reducers_state_after_every_action() {
    use admin_rust_core::editor::doc::map_size;
    use admin_rust_core::editor::overlap::warnings_of;
    use admin_rust_core::editor::view::map_fit;
    let scenarios = fixture("scenarios.json");
    let drawing = fixture("drawing.json");
    let mut checked = 0;
    for scenario in scenarios.as_array().unwrap() {
        let name = scenario["name"].as_str().unwrap();
        let mut s = init_state(if scenario["start"] == "drawing" {
            from_drawing(&drawing)
        } else {
            empty_doc()
        });
        let steps = scenario["steps"].as_array().unwrap();
        let after = scenario["after"].as_array().unwrap();
        for (i, (step, want)) in steps.iter().zip(after).enumerate() {
            let at = format!("{name} step {i} ({})", step["type"]);
            s = if step["type"] == "saveNow" {
                let sent = current_doc(&s).clone();
                let back = (step["readBack"] == true).then(|| server_doc(&sent));
                reduce(&s, Action::Saved { sent, doc: back })
            } else {
                reduce(&s, parse_action(step))
            };
            let want_doc: EditorDoc = serde_json::from_value(want["doc"].clone()).unwrap();
            assert_eq!(doc(&s), &want_doc, "{at}: doc");
            assert_eq!(
                s.message,
                want["message"].as_str().unwrap(),
                "{at}: message"
            );
            assert_eq!(
                s.cursor as u64,
                want["cursor"].as_u64().unwrap(),
                "{at}: cursor"
            );
            assert_eq!(
                s.history.len() as u64,
                want["historyLength"].as_u64().unwrap(),
                "{at}: history"
            );
            assert_eq!(
                s.steps[s.cursor],
                want["step"].as_str().unwrap(),
                "{at}: step"
            );
            let selection: Selection = serde_json::from_value(want["selection"].clone()).unwrap();
            assert_eq!(s.selection, selection, "{at}: selection");
            assert_eq!(s.zoomed.as_deref(), want["zoomed"].as_str(), "{at}: zoomed");
            assert_eq!(s.seq, want["seq"].as_u64().unwrap(), "{at}: seq");
            assert_eq!(s.typing.as_deref(), want["typing"].as_str(), "{at}: typing");
            assert_eq!(is_dirty(&s), want["dirty"] == true, "{at}: dirty");
            assert_eq!(
                s.saved.name,
                want["savedName"].as_str().unwrap(),
                "{at}: saved"
            );
            let t = totals(doc(&s));
            assert_eq!(
                t.seats as u64,
                want["totals"]["seats"].as_u64().unwrap(),
                "{at}"
            );
            assert_eq!(
                t.seats_left,
                want["totals"]["seatsLeft"].as_i64().unwrap(),
                "{at}"
            );
            for (id, n) in want["totals"]["byLevel"].as_object().unwrap() {
                assert_eq!(t.level(id) as u64, n.as_u64().unwrap(), "{at}: {id}");
            }
            assert_eq!(
                to_input(doc(&s), Some(7), false),
                want["input"],
                "{at}: input"
            );
            let w = warnings_of(doc(&s));
            let messages: Vec<String> =
                serde_json::from_value(want["warnings"]["messages"].clone()).unwrap();
            assert_eq!(w.messages, messages, "{at}: warnings");
            let mut sections: Vec<String> =
                serde_json::from_value(want["warnings"]["sections"].clone()).unwrap();
            sections.sort();
            assert_eq!(w.sections.into_iter().collect::<Vec<_>>(), sections, "{at}");
            let fit = map_fit(doc(&s));
            assert_eq!(
                [fit.x, fit.y, fit.width, fit.height],
                [
                    0.0,
                    0.0,
                    want["mapFit"]["width"].as_f64().unwrap(),
                    want["mapFit"]["height"].as_f64().unwrap()
                ],
                "{at}: mapFit"
            );
            let size = map_size(doc(&s));
            assert_eq!(
                [size.width, size.height],
                [
                    want["mapSize"]["width"].as_f64().unwrap(),
                    want["mapSize"]["height"].as_f64().unwrap()
                ],
                "{at}: mapSize"
            );
            checked += 1;
        }
    }
    assert!(checked > 80, "{checked}");
}
