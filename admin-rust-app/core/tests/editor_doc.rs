//! Spec 037 research R14 (T073): the layout editor's document and overlaps, ported from
//! `admin-app/test/layout-editor/editor-doc.test.ts` and `overlap.test.ts` (039 research R3, R5,
//! R10, R15; parity LE20, LE35, LE36, LE69, LE73, LE74). `toInput`'s body is checked against the
//! contract's `LayoutDrawingInput` schema too. Fixtures: `tests/fixtures/editor/` (written by
//! `make-fixtures.ts` from `admin-app/test/layout-editor/fixtures.ts`).

use std::{fs, path::PathBuf, sync::Arc};

use admin_rust_core::editor::doc::{
    EdFloor, EdLevel, EdRow, EdSeat, EdSection, EditorDoc, FloorKind, empty_doc, farthest,
    from_drawing, is_new, level_name, map_size, outline_of, seat_level, to_input,
};
use admin_rust_core::editor::overlap::{
    OVERLAP_DISTANCE, empty_levels, find_overlaps, warnings_of,
};
use admin_rust_core::seating::geometry::outline_around;
use serde_json::{Value, json};

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/editor")
        .join(name);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn repo_file(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    fs::read_to_string(root.join(path)).unwrap()
}

fn drawing() -> Value {
    fixture("drawing.json")
}

fn doc() -> EditorDoc {
    from_drawing(&drawing())
}

// ------------------------------------------------------------------------------ fromDrawing

#[test]
fn from_drawing_reads_levels_by_rank_and_sections_rows_seats_with_ids_and_own_levels() {
    let doc = doc();
    assert_eq!(doc.name, "Riverside");
    let levels: Vec<_> = doc
        .levels
        .iter()
        .map(|l| (l.id.as_str(), l.name.as_str(), l.color.as_str()))
        .collect();
    assert_eq!(
        levels,
        [
            ("lv-court", "Courtside", "red"),
            ("lv-std", "Standard", "violet")
        ]
    );
    let s101 = &doc.sections[0];
    assert_eq!(
        (
            s101.id.as_str(),
            s101.name.as_str(),
            s101.level_id.as_str(),
            s101.angle
        ),
        ("s-101", "101", "lv-std", 0.0)
    );
    assert_eq!(s101.generator.as_ref().unwrap().rows, 2.0);
    assert_eq!(
        (
            s101.rows[0].id.as_str(),
            s101.rows[0].label.as_str(),
            s101.rows[0].level_id.as_deref()
        ),
        ("r-101-a", "A", None)
    );
    assert_eq!(s101.rows[1].level_id.as_deref(), Some("lv-court"));
    assert_eq!(
        s101.rows[0].seats[0],
        EdSeat {
            id: "st-a1".into(),
            label: "1".into(),
            at: [18.0, 30.0],
            level_id: Some("lv-court".into()),
            accessible: true,
        }
    );
    assert_eq!(s101.rows[0].seats[1].level_id, None);
    assert!(!s101.rows[0].seats[1].accessible);
}

#[test]
fn from_drawing_draws_each_outline_around_its_seats_as_the_backend_will() {
    let doc = doc();
    let s = &doc.sections[0];
    let rows: Vec<Vec<[f64; 2]>> = s
        .rows
        .iter()
        .map(|r| r.seats.iter().map(|x| x.at).collect())
        .collect();
    assert_eq!(s.outline, outline_around(&rows).unwrap());
    // LE20: never the outline the drawing came with.
    assert_ne!(
        s.outline,
        vec![[16.5, 31.5], [16.5, 26.5], [23.5, 26.5], [23.5, 31.5]]
    );
}

#[test]
fn from_drawing_reads_levels_by_rank_even_when_sent_out_of_order() {
    let mut d = drawing();
    d["levels"].as_array_mut().unwrap().reverse();
    let names: Vec<_> = from_drawing(&d)
        .levels
        .iter()
        .map(|l| l.name.clone())
        .collect();
    assert_eq!(names, ["Courtside", "Standard"]);
}

#[test]
fn a_floor_of_kind_none_has_no_outline() {
    let mut d = drawing();
    d["floor"] = json!({ "kind": "NONE" });
    assert_eq!(
        from_drawing(&d).floor,
        EdFloor {
            kind: FloorKind::None,
            outline: None
        }
    );
}

#[test]
fn from_drawing_keeps_a_floor_kind_without_an_outline_as_the_react_app_does() {
    // `fromDrawing` keeps the kind (`{ kind: d.floor.kind, outline: null }`); LE74's "{NONE,
    // none}" is the checklist's simplification.
    let mut d = drawing();
    d["floor"] = json!({ "kind": "RING" });
    assert_eq!(
        from_drawing(&d).floor,
        EdFloor {
            kind: FloorKind::Ring,
            outline: None
        }
    );
}

#[test]
fn from_drawing_keeps_the_outline_of_a_section_with_no_seats_and_reads_no_generator_as_none() {
    let mut d = drawing();
    d["sections"][1]["rows"] = json!([]);
    let doc = from_drawing(&d);
    assert_eq!(
        doc.sections[1].outline,
        vec![[98.5, 28.5], [101.5, 28.5], [101.5, 33.5], [98.5, 33.5]]
    );
    assert_eq!(doc.sections[1].generator, None);
}

// ------------------------------------------------------------------------------ seatLevel

#[test]
fn seat_level_is_the_seats_own_else_its_rows_else_its_sections() {
    let doc = doc();
    let s = &doc.sections[0];
    assert_eq!(seat_level(s, &s.rows[0], &s.rows[0].seats[0]), "lv-court");
    assert_eq!(seat_level(s, &s.rows[0], &s.rows[0].seats[1]), "lv-std");
    assert_eq!(seat_level(s, &s.rows[1], &s.rows[1].seats[2]), "lv-court");
}

// ------------------------------------------------------------------------------ toInput

#[test]
fn to_input_round_trips_a_drawing_levels_keyed_by_rank_ids_kept_own_levels_by_key() {
    let input = to_input(&doc(), Some(4), false);
    assert_eq!(input["revision"], json!(4));
    assert_eq!(input["name"], json!("Riverside"));
    assert_eq!(input["floor"], drawing()["floor"]);
    assert_eq!(
        input["levels"],
        json!([
            { "id": "lv-court", "key": "l1", "name": "Courtside", "color": "red" },
            { "id": "lv-std", "key": "l2", "name": "Standard", "color": "violet" },
        ])
    );
    let s101 = &input["sections"][0];
    assert_eq!(s101["id"], json!("s-101"));
    assert_eq!(s101["name"], json!("101"));
    assert_eq!(s101["level"], json!("l2"));
    assert_eq!(s101["origin"], json!([20, 30]));
    assert_eq!(s101["angle"], json!(0));
    assert_eq!(s101["generator"], drawing()["sections"][0]["generator"]);
    assert_eq!(
        s101["rows"][0],
        json!({
            "id": "r-101-a",
            "label": "A",
            "seats": [
                { "id": "st-a1", "label": "1", "at": [18, 30], "level": "l1", "accessible": true },
                { "id": "st-a2", "label": "2", "at": [20, 30] },
                { "id": "st-a3", "label": "3", "at": [22, 30] },
            ],
        })
    );
    assert_eq!(s101["rows"][1]["id"], json!("r-101-b"));
    assert_eq!(s101["rows"][1]["label"], json!("B"));
    assert_eq!(s101["rows"][1]["level"], json!("l1"));
    // No outlines and no size: the Backend computes them (R5).
    assert!(s101.get("outline").is_none());
    assert!(input.get("size").is_none());
    // Places to 0.1; no generator sent as null when there is none.
    let s102 = &input["sections"][1];
    assert_eq!(s102["origin"], json!([100, 30]));
    let ats: Vec<&Value> = s102["rows"][0]["seats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| &s["at"])
        .collect();
    assert_eq!(ats, [&json!([100, 30]), &json!([100, 32])]);
    assert_eq!(s102["angle"], json!(90));
    assert!(s102.get("generator").is_none());
}

#[test]
fn to_input_sends_a_new_level_section_row_or_seat_without_an_id() {
    let mut doc = doc();
    doc.levels.push(EdLevel {
        id: "new:1".into(),
        name: "Upper".into(),
        color: "teal".into(),
    });
    let mut s = (*doc.sections[0]).clone();
    s.id = "new:2".into();
    s.rows = vec![EdRow {
        id: "new:3".into(),
        label: "Z".into(),
        level_id: Some("new:1".into()),
        seats: vec![EdSeat {
            id: "new:4".into(),
            label: "9".into(),
            at: [5.0, 5.0],
            level_id: None,
            accessible: false,
        }],
    }];
    doc.sections = vec![Arc::new(s)];
    let input = to_input(&doc, Some(4), false);
    assert_eq!(
        input["levels"][2],
        json!({ "key": "l3", "name": "Upper", "color": "teal" })
    );
    assert!(input["sections"][0].get("id").is_none());
    assert_eq!(
        input["sections"][0]["rows"][0],
        json!({ "label": "Z", "level": "l3", "seats": [{ "label": "9", "at": [5, 5] }] })
    );
}

#[test]
fn to_input_leaves_out_the_revision_for_a_new_layout() {
    let input = to_input(&empty_doc(), None, false);
    assert!(input.get("revision").is_none());
    assert_eq!(
        input["levels"],
        json!([{ "key": "l1", "name": "Standard", "color": "violet" }])
    );
    assert_eq!(input["floor"], json!({ "kind": "NONE" }));
}

#[test]
fn to_input_keeps_an_angle_in_the_half_open_range_after_rounding() {
    let mut doc = doc();
    let mut s = (*doc.sections[0]).clone();
    s.angle = -179.97;
    doc.sections = vec![Arc::new(s)];
    assert_eq!(
        to_input(&doc, Some(1), false)["sections"][0]["angle"],
        json!(180)
    );
}

#[test]
fn to_input_fresh_sends_no_id_at_all_and_trims_the_name() {
    let mut doc = doc();
    doc.name = "  Riverside  ".into();
    let input = to_input(&doc, None, true);
    assert_eq!(input["name"], json!("Riverside"));
    let text = input.to_string();
    assert!(!text.contains("\"id\""), "{text}");
    // An unknown level id is sent as it is (`keyOf.get(levelId) ?? levelId`).
    let mut s = (*doc.sections[0]).clone();
    s.level_id = "gone".into();
    doc.sections = vec![Arc::new(s)];
    assert_eq!(
        to_input(&doc, None, false)["sections"][0]["level"],
        json!("gone")
    );
}

#[test]
fn to_input_rounds_places_to_a_tenth_never_minus_zero() {
    let mut doc = doc();
    doc.floor.outline = Some(vec![
        [40.04, -0.04],
        [80.05, 40.0],
        [80.0, 60.0],
        [40.0, 60.0],
    ]);
    let input = to_input(&doc, None, false);
    assert_eq!(
        input["floor"]["outline"],
        json!([[40, 0], [80.1, 40], [80, 60], [40, 60]])
    );
    assert!(!input.to_string().contains("-0"));
}

/// The contract's `LayoutDrawingInput`, with the contract's `components` attached so every
/// `$ref` resolves.
fn input_validator() -> jsonschema::Validator {
    let contract: Value = serde_yaml::from_str(&repo_file("contracts/openapi.yaml")).unwrap();
    let mut schema = contract["components"]["schemas"]["LayoutDrawingInput"].clone();
    schema["components"] = contract["components"].clone();
    schema["$schema"] = json!("https://json-schema.org/draft/2020-12/schema");
    jsonschema::validator_for(&schema).unwrap()
}

#[test]
fn to_input_validates_against_the_contracts_layout_drawing_input() {
    let validator = input_validator();
    for input in [
        to_input(&doc(), Some(4), false),
        to_input(&doc(), None, true),
        to_input(&doc(), None, false),
    ] {
        let errors: Vec<String> = validator
            .iter_errors(&input)
            .map(|e| format!("{e} at {}", e.instance_path()))
            .collect();
        assert!(errors.is_empty(), "{errors:?}");
    }
    // And the check bites: an outline is not allowed in the body.
    let mut bad = to_input(&doc(), Some(4), false);
    bad["sections"][0]["outline"] = json!([[0, 0], [1, 0], [1, 1]]);
    assert!(!validator.is_valid(&bad));
}

// ------------------------------------------------------------------------------ emptyDoc

#[test]
fn empty_doc_is_a_new_layout_no_name_no_floor_one_level_standard_no_sections() {
    let doc = empty_doc();
    assert_eq!(doc.name, "");
    assert_eq!(
        doc.floor,
        EdFloor {
            kind: FloorKind::None,
            outline: None
        }
    );
    assert_eq!(doc.levels.len(), 1);
    assert_eq!(
        (doc.levels[0].name.as_str(), doc.levels[0].color.as_str()),
        ("Standard", "violet")
    );
    assert!(doc.levels[0].id.starts_with("new:"));
    assert!(is_new(&doc.levels[0].id));
    assert!(doc.sections.is_empty());
}

// ------------------------------------------------------------------------------ the rest of editor-doc.ts

#[test]
fn farthest_and_map_size_see_outlines_origins_and_the_floor() {
    let doc = doc();
    // 102's outline reaches x 101.54, its seats y 33.5; the floor reaches 80, 60.
    let [x, y] = farthest(&doc);
    let outlines = doc
        .sections
        .iter()
        .flat_map(|s| s.outline.iter().map(|p| p[0]));
    assert_eq!(x, outlines.fold(0.0, f64::max));
    assert!(y >= 60.0);
    let size = map_size(&doc);
    assert_eq!(size.width, x + 10.0);
    assert_eq!(size.height, y + 10.0);
    let empty = map_size(&empty_doc());
    assert_eq!((empty.width, empty.height), (10.0, 10.0));
    let mut far = empty_doc();
    far.floor.outline = Some(vec![[0.0, 0.0], [6000.0, 0.0], [0.0, 6000.0]]);
    let size = map_size(&far);
    assert_eq!((size.width, size.height), (5000.0, 5000.0));
}

#[test]
fn level_name_is_the_name_or_empty() {
    let doc = doc();
    assert_eq!(level_name(&doc, Some("lv-court")), "Courtside");
    assert_eq!(level_name(&doc, Some("nope")), "");
    assert_eq!(level_name(&doc, None), "");
}

#[test]
fn outline_of_no_seats_is_empty() {
    assert!(outline_of(&[]).is_empty());
}

#[test]
fn the_document_reads_and_writes_the_typescript_shape() {
    let doc = doc();
    let text = serde_json::to_value(&doc).unwrap();
    assert_eq!(text["sections"][0]["levelId"], json!("lv-std"));
    assert_eq!(text["floor"]["kind"], json!("COURT"));
    let back: EditorDoc = serde_json::from_value(text).unwrap();
    assert_eq!(back, doc);
}

// ------------------------------------------------------------------------------ overlap.test.ts

fn section(id: &str, name: &str, x: f64, y: f64) -> EdSection {
    let rows: Vec<EdRow> = (0..2)
        .map(|k| EdRow {
            id: format!("{id}-r{k}"),
            label: (k + 1).to_string(),
            level_id: None,
            seats: (0..3)
                .map(|i| EdSeat {
                    id: format!("{id}-r{k}-s{i}"),
                    label: (i + 1).to_string(),
                    at: [x + 2.0 * i as f64, y - 2.0 * k as f64],
                    level_id: None,
                    accessible: false,
                })
                .collect(),
        })
        .collect();
    EdSection {
        id: id.into(),
        name: name.into(),
        level_id: "new:0".into(),
        origin: [x + 2.0, y],
        angle: 0.0,
        generator: None,
        outline: outline_of(&rows),
        rows,
    }
}

fn doc_of(sections: Vec<EdSection>) -> EditorDoc {
    EditorDoc {
        sections: sections.into_iter().map(Arc::new).collect(),
        ..empty_doc()
    }
}

fn pairs(doc: &EditorDoc) -> Vec<(String, String)> {
    find_overlaps(doc).pairs
}

#[test]
fn finds_sections_with_seats_1_4_units_apart_and_not_1_6() {
    assert_eq!(OVERLAP_DISTANCE, 1.5);
    assert_eq!(
        pairs(&doc_of(vec![
            section("a", "101", 10.0, 10.0),
            section("b", "102", 15.4, 10.0)
        ])),
        [("a".to_string(), "b".to_string())]
    );
    assert!(
        pairs(&doc_of(vec![
            section("a", "101", 10.0, 10.0),
            section("b", "102", 15.6, 10.0)
        ]))
        .is_empty()
    );
}

#[test]
fn does_not_compare_sections_whose_bounds_do_not_meet() {
    let r = find_overlaps(&doc_of(vec![
        section("a", "101", 10.0, 10.0),
        section("b", "102", 100.0, 10.0),
        section("c", "103", 10.0, 100.0),
    ]));
    assert!(r.pairs.is_empty());
    assert_eq!(r.compared, 0);
}

#[test]
fn compares_sections_whose_bounds_meet_even_when_no_seats_are_near() {
    // Overlapping bounds, seats 2 apart on the grid's diagonal neighbours: compared, no overlap.
    let r = find_overlaps(&doc_of(vec![
        section("a", "101", 10.0, 10.0),
        section("b", "102", 11.0, 8.0),
    ]));
    assert_eq!(r.compared, 1);
    assert_eq!(r.pairs.len(), 1);
    let r = find_overlaps(&doc_of(vec![
        section("a", "101", 10.0, 10.0),
        section("b", "102", 16.0, 6.0),
    ]));
    assert_eq!(r.compared, 1);
    assert!(r.pairs.is_empty());
}

#[test]
fn names_each_overlap_and_each_level_with_no_seats() {
    let mut doc = doc_of(vec![
        section("a", "101", 10.0, 10.0),
        section("b", "102", 15.0, 10.0),
    ]);
    doc.levels = vec![
        EdLevel {
            id: "new:0".into(),
            name: "Standard".into(),
            color: "violet".into(),
        },
        EdLevel {
            id: "new:9".into(),
            name: "Upper".into(),
            color: "teal".into(),
        },
    ];
    let names: Vec<_> = empty_levels(&doc).into_iter().map(|l| l.name).collect();
    assert_eq!(names, ["Upper"]);
    let w = warnings_of(&doc);
    assert_eq!(
        w.messages,
        ["Section 102 overlaps 101", "Upper has no seats"]
    );
    assert_eq!(w.sections.into_iter().collect::<Vec<_>>(), ["a", "b"]);
}
