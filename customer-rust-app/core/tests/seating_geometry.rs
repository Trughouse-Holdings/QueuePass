// Copied from admin-rust-app/core/tests/seating_geometry.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R13 (T031): the seat-map geometry and the venue map's pan and zoom, ported
//! from `packages/shared/test/layout-geometry.test.ts`, `web/row-labels.test.ts`,
//! `seating.test.ts` (`LAYOUT_LIMITS`, `LEVEL_COLORS`), `venue-map/map-geometry.test.ts`, and the
//! pure cases of `venue-map/use-pan-zoom.test.ts` (its hook cases as cases of the functions the
//! hook's inline logic became). Then parity (M6, M13–M15): the TypeScript functions' own outputs
//! on fixed inputs, written by `scripts/seat-map-parity-fixtures.mjs` to
//! `tests/fixtures/seating/expected/`, must come out of the Rust ports the same, path strings
//! byte for byte and numbers to the same float.

use std::{fs, path::PathBuf};

use customer_rust_core::seating::geometry::{
    BlockError, BlockField, BlockProblem, BlockValues, Direction, LAYOUT_LIMITS, LEVEL_COLORS,
    OUTLINE_MARGIN, Pt, ROW_GAP, RowLabelStyle, SEAT_GAP, SIZE_MARGIN, check_block, generate_block,
    move_by, normalize_angle, outline_around, place_block, row_labels, seat_counts, turn_about,
};
use customer_rust_core::seating::map_geometry::{
    Bounds, Point, SECTION_VIEW_BOX_MARGIN, bounds, centroid, js_hypot, js_number, js_round,
    outline_path, section_view_box,
};
use customer_rust_core::seating::pan_zoom::{
    ANIMATION_MS, DRAG_SLOP, KeyAction, MAX_ZOOM, Rect, STEP, View, WHEEL_RATE, animation_frame,
    client_to_map, drag_pan, ease_out_cubic, fit_of, fit_view, is_drag, key_action,
    label_font_size, map_aspect, pan_by, pinch_view, rect_or_fit, view_box, wheel_factor, zoom_at,
    zoom_by, zoom_of, zoom_to_target,
};
use serde::Serialize;
use serde_json::{Value, json};

// ------------------------------------------------------------------------------ support

fn repo_file(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/seating/expected")
        .join(name);
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {name}: {e}"))
}

/// A fixture number: itself, or one JSON can't hold, by name.
fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap(),
        Value::String(s) => match s.as_str() {
            "-0" => -0.0,
            "NaN" => f64::NAN,
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            other => panic!("not a number: {other}"),
        },
        other => panic!("not a number: {other}"),
    }
}

fn opt_num(v: &Value) -> Option<f64> {
    if v.is_null() { None } else { Some(num(v)) }
}

fn pt(v: &Value) -> Point {
    [num(&v[0]), num(&v[1])]
}

fn pts(v: &Value) -> Vec<Point> {
    v.as_array().unwrap().iter().map(pt).collect()
}

fn view(v: &Value) -> View {
    View {
        x: num(&v["x"]),
        y: num(&v["y"]),
        width: num(&v["width"]),
        height: num(&v["height"]),
    }
}

fn rect(v: &Value) -> Rect {
    Rect {
        left: num(&v["left"]),
        top: num(&v["top"]),
        width: num(&v["width"]),
        height: num(&v["height"]),
    }
}

fn block_values(v: &Value) -> BlockValues {
    BlockValues {
        rows: num(&v["rows"]),
        seats_per_row: v["seatsPerRow"]
            .as_array()
            .unwrap()
            .iter()
            .map(num)
            .collect(),
        row_labels: style(&v["rowLabels"]),
        first_row: v["firstRow"].as_str().unwrap().to_string(),
        first_seat: num(&v["firstSeat"]),
        direction: match v["direction"].as_str().unwrap() {
            "LEFT_TO_RIGHT" => Direction::LeftToRight,
            "RIGHT_TO_LEFT" => Direction::RightToLeft,
            other => panic!("direction {other}"),
        },
        curve: num(&v["curve"]),
    }
}

fn style(v: &Value) -> RowLabelStyle {
    match v.as_str().unwrap() {
        "LETTERS" => RowLabelStyle::Letters,
        "NUMBERS" => RowLabelStyle::Numbers,
        other => panic!("style {other}"),
    }
}

/// Every number as JavaScript's `String(n)` (and `-0` by name), so two values are equal exactly
/// when their numbers are the same float (`js_number` is checked on its own, below).
fn canon(v: Value) -> Value {
    match v {
        Value::Number(n) => {
            let f = n.as_f64().unwrap();
            if f == 0.0 && f.is_sign_negative() {
                Value::String("-0".into())
            } else {
                Value::String(js_number(f))
            }
        }
        Value::Array(a) => Value::Array(a.into_iter().map(canon).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, canon(v))).collect()),
        other => other,
    }
}

#[track_caller]
fn same(actual: impl Serialize, expected: &Value, what: &str) {
    let a = canon(serde_json::to_value(actual).unwrap());
    let e = canon(expected.clone());
    assert_eq!(a, e, "{what}");
}

/// A call's result as the fixtures write it: `{ out }` or `{ error }`.
fn outcome<T: Serialize, E>(r: Result<T, E>, err: impl Fn(E) -> Value) -> Value {
    match r {
        Ok(v) => json!({ "out": serde_json::to_value(v).unwrap() }),
        Err(e) => json!({ "error": err(e) }),
    }
}

fn result_of(case: &Value) -> Value {
    let mut o = serde_json::Map::new();
    for k in ["out", "error"] {
        if let Some(v) = case.get(k) {
            o.insert(k.into(), v.clone());
        }
    }
    Value::Object(o)
}

fn close(a: Pt, b: Pt, eps: f64) -> bool {
    (a[0] - b[0]).abs() < eps && (a[1] - b[1]).abs() < eps
}

fn dist(a: Pt, b: Pt) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// Ray casting: whether `p` is inside the polygon.
fn inside(p: Pt, poly: &[Pt]) -> bool {
    let mut yes = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let [xi, yi] = poly[i];
        let [xj, yj] = poly[j];
        if (yi > p[1]) != (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi {
            yes = !yes;
        }
        j = i;
    }
    yes
}

/// A straight block of rows (seat counts), row k at y = -2k, centered on x = 0.
fn straight(counts: &[usize]) -> Vec<Vec<Pt>> {
    counts
        .iter()
        .enumerate()
        .map(|(k, &n)| {
            (0..n)
                .map(|i| {
                    [
                        (i as f64 - (n as f64 - 1.0) / 2.0) * SEAT_GAP,
                        -ROW_GAP * k as f64,
                    ]
                })
                .collect()
        })
        .collect()
}

fn values() -> BlockValues {
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

fn seats_of(v: &BlockValues) -> Vec<Vec<Pt>> {
    generate_block(v)
        .unwrap()
        .rows
        .iter()
        .map(|r| r.seats.iter().map(|s| s.at).collect())
        .collect()
}

fn placed_seats(v: &BlockValues, origin: Pt, angle: f64) -> Vec<Vec<Pt>> {
    place_block(&generate_block(v).unwrap(), origin, angle)
        .rows
        .iter()
        .map(|r| r.seats.iter().map(|s| s.at).collect())
        .collect()
}

// ------------------------------------------------------------------------------ layout-geometry.test.ts

#[test]
fn constants_are_the_standard_spacing_and_margins() {
    assert_eq!(
        [SEAT_GAP, ROW_GAP, OUTLINE_MARGIN, SIZE_MARGIN],
        [2.0, 2.0, 1.5, 10.0]
    );
}

#[test]
fn outline_of_a_3_by_4_straight_block() {
    let rows = straight(&[4, 4, 4]);
    let out = outline_around(&rows).unwrap();
    let d = OUTLINE_MARGIN / std::f64::consts::SQRT_2;
    let want: [Pt; 6] = [
        [-3.0 - d, d],
        [-4.5, -2.0],
        [-3.0 - d, -4.0 - d],
        [3.0 + d, -4.0 - d],
        [4.5, -2.0],
        [3.0 + d, d],
    ];
    assert_eq!(out.len(), 6);
    for (p, w) in out.iter().zip(want) {
        assert!(close(*p, w, 1e-9), "{p:?} vs {w:?}");
    }
    // Closed by the drawing, not by repeating its first point.
    assert!(!close(out[0], out[5], 1e-9));
    let seats: Vec<Pt> = rows.concat();
    for p in &out {
        let m = seats
            .iter()
            .map(|s| dist(*p, *s))
            .fold(f64::INFINITY, f64::min);
        assert!((m - 1.5).abs() < 1e-9);
    }
}

#[test]
fn outline_of_a_curved_block_hugs_the_arcs() {
    let mut v = values();
    v.rows = 12.0;
    v.seats_per_row = vec![20.0];
    v.curve = 40.0;
    let rows = seats_of(&v);
    let out = outline_around(&rows).unwrap();
    let seats: Vec<Pt> = rows.concat();
    for p in &out {
        let m = seats
            .iter()
            .map(|s| dist(*p, *s))
            .fold(f64::INFINITY, f64::min);
        assert!(m <= 1.5 + 1e-6);
    }
    for s in &seats {
        assert!(inside(*s, &out));
    }
    assert!(inside([0.0, 1.4], &out));
    assert!(!inside([0.0, 3.5], &out));
    assert!(out.len() > 6 && out.len() <= 64);
}

#[test]
fn outline_follows_rows_of_different_lengths() {
    let rows = straight(&[4, 6, 4]);
    let out = outline_around(&rows).unwrap();
    assert!(out.iter().any(|p| close(*p, [-6.5, -2.0], 1e-9)));
    assert!(out.iter().any(|p| close(*p, [6.5, -2.0], 1e-9)));
    for s in rows.concat() {
        assert!(inside(s, &out));
    }
}

#[test]
fn outline_of_100_rows_keeps_within_64_points_and_the_corners() {
    let mut v = values();
    v.rows = 100.0;
    v.seats_per_row = vec![30.0];
    v.curve = 30.0;
    let rows = seats_of(&v);
    let out = outline_around(&rows).unwrap();
    assert!(out.len() <= 64);
    for e in [rows[0][0], rows[0][29], rows[99][0], rows[99][29]] {
        assert!(out.iter().any(|p| (dist(*p, e) - 1.5).abs() < 1e-9));
    }
}

#[test]
fn outline_of_200_seats_strongly_curved_keeps_within_64_points() {
    let mut v = values();
    v.seats_per_row = vec![200.0];
    v.curve = 120.0;
    let out = outline_around(&seats_of(&v)).unwrap();
    assert!(out.len() <= 64 && out.len() >= 3);
}

#[test]
fn outline_of_one_row_is_a_rectangle() {
    assert_eq!(
        outline_around(&straight(&[5])).unwrap(),
        vec![[-5.5, 1.5], [-5.5, -1.5], [5.5, -1.5], [5.5, 1.5]]
    );
}

#[test]
fn outline_of_one_turned_row_turns_with_it() {
    let row = turn_about(&straight(&[3])[0], [0.0, 0.0], 90.0);
    let out = outline_around(std::slice::from_ref(&row)).unwrap();
    assert_eq!(out.len(), 4);
    for s in row {
        assert!(inside(s, &out));
    }
    let xs: Vec<f64> = out.iter().map(|p| p[0]).collect();
    let w =
        xs.iter().copied().fold(f64::MIN, f64::max) - xs.iter().copied().fold(f64::MAX, f64::min);
    assert!((w - 3.0).abs() < 1e-9);
}

#[test]
fn outline_of_one_seat_is_a_square() {
    assert_eq!(
        outline_around(&[vec![[10.0, 20.0]]]).unwrap(),
        vec![[8.5, 21.5], [8.5, 18.5], [11.5, 18.5], [11.5, 21.5]]
    );
}

#[test]
fn outline_of_a_column_of_one_seat_rows() {
    let rows = vec![vec![[0.0, 0.0]], vec![[0.0, -2.0]], vec![[0.0, -4.0]]];
    let out = outline_around(&rows).unwrap();
    for s in rows.concat() {
        assert!(inside(s, &out));
    }
}

#[test]
fn outline_of_seats_on_top_of_each_other_is_still_a_box() {
    let distinct = |p: &[Pt]| {
        let mut s: Vec<String> = p.iter().map(|q| format!("{},{}", q[0], q[1])).collect();
        s.sort();
        s.dedup();
        s.len()
    };
    let stacked = outline_around(&[vec![[10.0, 10.0]], vec![[10.0, 10.0]]]).unwrap();
    assert!(distinct(&stacked) >= 3);
    let pair = outline_around(&[vec![[10.0, 10.0], [10.0, 10.0]]]).unwrap();
    assert_eq!(distinct(&pair), 4);
    assert!(inside([10.0, 10.0], &pair));
}

#[test]
fn outline_of_rows_mixing_one_seat_and_many() {
    let mut rows = vec![vec![[0.0, 0.0]]];
    rows.extend(straight(&[1, 5]).into_iter().skip(1));
    let out = outline_around(&rows).unwrap();
    for s in rows.concat() {
        assert!(inside(s, &out));
    }
}

#[test]
fn outline_needs_a_seat() {
    let none: Vec<Vec<Pt>> = vec![vec![], vec![]];
    let e = outline_around(&none).unwrap_err();
    assert_eq!(e.to_string(), "outlineAround needs at least one seat");
}

#[test]
fn move_by_moves_every_point() {
    assert_eq!(
        move_by(&[[1.0, 2.0], [3.0, 4.0]], 10.0, -1.0),
        vec![[11.0, 1.0], [13.0, 3.0]]
    );
}

#[test]
fn turn_about_turns_clockwise_with_y_down() {
    let p = turn_about(&[[1.0, 0.0]], [0.0, 0.0], 90.0)[0];
    assert!(close(p, [0.0, 1.0], 1e-9));
    let q = turn_about(&[[12.0, 5.0]], [10.0, 5.0], -90.0)[0];
    assert!(close(q, [10.0, 3.0], 1e-9));
}

#[test]
fn normalize_angle_keeps_angles_in_minus_180_to_180() {
    for (a, b) in [
        (-180.0, 180.0),
        (190.0, -170.0),
        (360.0, 0.0),
        (-190.0, 170.0),
        (180.0, 180.0),
        (45.0, 45.0),
        (-725.0, -5.0),
    ] {
        assert_eq!(normalize_angle(a), b);
    }
    // No negative zero.
    assert!(normalize_angle(-360.0).is_sign_positive());
}

#[test]
fn generate_block_3_rows_by_4_straight() {
    let block = generate_block(&values()).unwrap();
    let labels: Vec<&str> = block.rows.iter().map(|r| r.label.as_str()).collect();
    assert_eq!(labels, ["A", "B", "C"]);
    for (k, row) in block.rows.iter().enumerate() {
        let seats: Vec<&str> = row.seats.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(seats, ["1", "2", "3", "4"]);
        for (i, s) in row.seats.iter().enumerate() {
            assert!(close(s.at, [(i as f64 - 1.5) * 2.0, -2.0 * k as f64], 1e-9));
        }
    }
}

#[test]
fn generate_block_centers_a_longer_row_on_the_first() {
    let mut v = values();
    v.rows = 2.0;
    v.seats_per_row = vec![4.0, 6.0];
    let block = generate_block(&v).unwrap();
    let xs = |k: usize| {
        block.rows[k]
            .seats
            .iter()
            .map(|s| s.at[0])
            .collect::<Vec<_>>()
    };
    assert_eq!(xs(1), [-5.0, -3.0, -1.0, 1.0, 3.0, 5.0]);
    assert_eq!(xs(0), [-3.0, -1.0, 1.0, 3.0]);
}

#[test]
fn generate_block_curved_rows_lie_on_arcs_two_apart() {
    let mut v = values();
    v.seats_per_row = vec![20.0, 20.0, 20.0];
    v.curve = 40.0;
    let block = generate_block(&v).unwrap();
    let r0 = (2.0 * 19.0) / ((40.0 * std::f64::consts::PI) / 180.0);
    let center = [0.0, r0];
    for (k, row) in block.rows.iter().enumerate() {
        let rk = r0 + 2.0 * k as f64;
        for s in &row.seats {
            assert!((dist(s.at, center) - rk).abs() < 1e-6);
        }
        for i in 1..row.seats.len() {
            let a = row.seats[i].at[0].atan2(center[1] - row.seats[i].at[1]);
            let b = row.seats[i - 1].at[0].atan2(center[1] - row.seats[i - 1].at[1]);
            assert!(((a - b) * rk - 2.0).abs() < 1e-6);
        }
        let n = row.seats.len();
        for i in 0..n {
            let (s, m) = (row.seats[i].at, row.seats[n - 1 - i].at);
            assert!((s[0] + m[0]).abs() < 1e-6 && (s[1] - m[1]).abs() < 1e-6);
        }
    }
    let front = &block.rows[0].seats;
    assert!(front[0].at[1] > 0.0);
    assert!((front[9].at[0] + front[10].at[0]).abs() < 1e-9);
}

#[test]
fn generate_block_small_radius_uses_2() {
    let mut v = values();
    v.rows = 2.0;
    v.seats_per_row = vec![1.0];
    v.curve = 120.0;
    let block = generate_block(&v).unwrap();
    assert!(close(block.rows[0].seats[0].at, [0.0, 0.0], 1e-9));
    assert!((dist(block.rows[1].seats[0].at, [0.0, 2.0]) - 4.0).abs() < 1e-9);
}

#[test]
fn row_labels_run_in_letters_and_numbers() {
    let l = |s, f, n| row_labels(s, f, n).unwrap();
    assert_eq!(
        l(RowLabelStyle::Letters, "A", 30)[25..],
        ["Z", "AA", "BB", "CC", "DD"]
    );
    assert_eq!(l(RowLabelStyle::Letters, "Y", 3), ["Y", "Z", "AA"]);
    assert_eq!(l(RowLabelStyle::Letters, "ZZ", 2), ["ZZ", "AAA"]);
    assert_eq!(l(RowLabelStyle::Letters, "b", 2), ["B", "C"]);
    assert_eq!(l(RowLabelStyle::Numbers, "99", 2), ["99", "100"]);
}

#[test]
fn generate_block_numbers_seats_right_to_left() {
    let mut v = values();
    v.rows = 1.0;
    v.first_seat = 101.0;
    v.direction = Direction::RightToLeft;
    let block = generate_block(&v).unwrap();
    let labels: Vec<&str> = block.rows[0]
        .seats
        .iter()
        .map(|s| s.label.as_str())
        .collect();
    assert_eq!(labels, ["104", "103", "102", "101"]);
    let xs: Vec<f64> = block.rows[0].seats.iter().map(|s| s.at[0]).collect();
    assert!(xs.windows(2).all(|w| w[0] <= w[1]));
}

#[test]
fn generate_block_origin_is_the_middle_of_the_front_row() {
    let mut v = values();
    v.rows = 4.0;
    v.seats_per_row = vec![5.0];
    v.curve = 60.0;
    assert!(close(
        generate_block(&v).unwrap().rows[0].seats[2].at,
        [0.0, 0.0],
        1e-9
    ));
}

#[test]
fn check_block_refuses_bad_values() {
    type Change = Box<dyn Fn(&mut BlockValues)>;
    let cases: Vec<(&str, Change, BlockField)> = vec![
        (
            "a first row not in sequence",
            Box::new(|v| v.first_row = "AB".into()),
            BlockField::FirstRow,
        ),
        (
            "a first row that is not a number",
            Box::new(|v| {
                v.row_labels = RowLabelStyle::Numbers;
                v.first_row = "A".into();
            }),
            BlockField::FirstRow,
        ),
        (
            "labels past five characters",
            Box::new(|v| {
                v.rows = 30.0;
                v.first_row = "ZZZZ".into();
            }),
            BlockField::FirstRow,
        ),
        ("101 rows", Box::new(|v| v.rows = 101.0), BlockField::Rows),
        ("0 rows", Box::new(|v| v.rows = 0.0), BlockField::Rows),
        (
            "201 seats",
            Box::new(|v| v.seats_per_row = vec![201.0]),
            BlockField::SeatsPerRow,
        ),
        (
            "0 seats",
            Box::new(|v| v.seats_per_row = vec![0.0]),
            BlockField::SeatsPerRow,
        ),
        (
            "a list of 2",
            Box::new(|v| v.seats_per_row = vec![4.0, 4.0]),
            BlockField::SeatsPerRow,
        ),
        (
            "a curve of 121",
            Box::new(|v| v.curve = 121.0),
            BlockField::Curve,
        ),
        (
            "a first seat of 0",
            Box::new(|v| v.first_seat = 0.0),
            BlockField::FirstSeat,
        ),
    ];
    for (what, change, field) in cases {
        let mut v = values();
        change(&mut v);
        assert!(check_block(&v).iter().any(|p| p.field == field), "{what}");
        let e: BlockError = generate_block(&v).unwrap_err();
        assert!(!e.problems.is_empty(), "{what}");
    }
}

#[test]
fn check_block_names_the_limit() {
    let mut v = values();
    v.rows = 101.0;
    assert!(check_block(&v).contains(&BlockProblem {
        field: BlockField::Rows,
        message: "At most 100 rows".into()
    }));
    let mut v = values();
    v.seats_per_row = vec![201.0];
    assert!(check_block(&v).contains(&BlockProblem {
        field: BlockField::SeatsPerRow,
        message: "At most 200 seats in a row".into()
    }));
}

#[test]
fn seat_counts_repeat_one_number_for_every_row() {
    assert_eq!(seat_counts(&values()), [4.0, 4.0, 4.0]);
}

#[test]
fn place_block_turns_then_moves() {
    let mut v = values();
    v.rows = 1.0;
    v.seats_per_row = vec![3.0];
    let placed = place_block(&generate_block(&v).unwrap(), [100.0, 50.0], 90.0);
    let at: Vec<Pt> = placed.rows[0]
        .seats
        .iter()
        .map(|s| [js_round(s.at[0] * 1e9) / 1e9, js_round(s.at[1] * 1e9) / 1e9])
        .collect();
    assert_eq!(at, [[100.0, 48.0], [100.0, 50.0], [100.0, 52.0]]);
}

// ------------------------------------------------------------------------------ seating.test.ts

fn contract_enum(contract: &str, schema: &str) -> Vec<String> {
    let start = contract
        .find(&format!("\n    {schema}:\n"))
        .expect("schema");
    let rest = &contract[start..];
    let at = rest.find("\n      enum: [").expect("enum") + "\n      enum: [".len();
    let end = rest[at..].find(']').unwrap();
    rest[at..at + end]
        .split(',')
        .map(|s| s.trim().to_string())
        .collect()
}

#[test]
fn level_colors_are_the_contracts_level_color_enum_in_order() {
    let contract = repo_file("contracts/openapi.yaml");
    assert_eq!(
        LEVEL_COLORS.to_vec(),
        contract_enum(&contract, "LevelColor")
    );
    assert_eq!(LEVEL_COLORS.len(), 12);
}

#[test]
fn layout_limits_state_every_limit() {
    let l = LAYOUT_LIMITS;
    assert_eq!(
        (
            l.max_sections,
            l.max_rows,
            l.max_seats_per_row,
            l.max_seats,
            l.max_levels
        ),
        (100, 100, 200, 30_000, 12)
    );
    assert_eq!(
        (
            l.max_carried_levels,
            l.name_max_length,
            l.label_max_length,
            l.max_outline_points
        ),
        (50, 50, 5, 64)
    );
    assert_eq!(
        (
            l.max_map_units,
            l.max_off_sale_selectors,
            l.max_import_bytes
        ),
        (5_000, 5_000, 4 * 1024 * 1024)
    );
}

#[test]
fn layout_limits_agree_with_the_contracts_layout_file() {
    let contract = repo_file("contracts/openapi.yaml");
    let start = contract.find("\n    LayoutFile:\n").unwrap();
    let end = contract[start..].find("\n    LayoutFileSection:").unwrap();
    let file = &contract[start..start + end];
    assert!(file.contains(&format!("maxItems: {}", LAYOUT_LIMITS.max_sections)));
    assert!(file.contains(&format!("maxItems: {}", LAYOUT_LIMITS.max_levels)));
    assert!(file.contains(&format!("maxLength: {}", LAYOUT_LIMITS.name_max_length)));
}

// ------------------------------------------------------------------------------ row-labels.test.ts

#[test]
fn row_labels_have_a_halo_sized_by_the_label_not_3_map_units() {
    for (css, selector) in [
        (
            repo_file("packages/shared/src/web/theme.css"),
            ".venue-map__row-label",
        ),
        (
            repo_file("admin-app/src/styles.css"),
            ".editor-map__row-label",
        ),
    ] {
        let rule = regress::Regex::new(&format!("\\{selector}\\s*\\{{([^}}]*)\\}}")).unwrap();
        let m = rule.find(&css).expect("rule");
        let body = &css[m.group(1).unwrap()];
        assert!(
            regress::Regex::new(r"stroke-width:\s*0?\.\d+em")
                .unwrap()
                .find(body)
                .is_some()
        );
        assert!(
            regress::Regex::new(r"stroke-width:\s*3px")
                .unwrap()
                .find(body)
                .is_none()
        );
    }
}

// ------------------------------------------------------------------------------ map-geometry.test.ts

const SQUARE: [Point; 4] = [[10.0, 20.0], [50.0, 20.0], [50.0, 60.0], [10.0, 60.0]];

#[test]
fn outline_path_draws_a_closed_svg_path() {
    assert_eq!(outline_path(&SQUARE), "M10 20L50 20L50 60L10 60Z");
    assert_eq!(
        outline_path(&[[0.5, 1.25], [3.0, 4.0], [5.0, 0.0]]),
        "M0.5 1.25L3 4L5 0Z"
    );
}

#[test]
fn bounds_of_points() {
    assert_eq!(
        bounds(&SQUARE),
        Bounds {
            x: 10.0,
            y: 20.0,
            width: 40.0,
            height: 40.0
        }
    );
    assert_eq!(
        bounds(&[[5.0, 9.0], [1.0, 3.0], [4.0, 12.0]]),
        Bounds {
            x: 1.0,
            y: 3.0,
            width: 4.0,
            height: 9.0
        }
    );
}

#[test]
fn centroid_is_the_center_of_the_area() {
    assert_eq!(centroid(&SQUARE), [30.0, 40.0]);
    let mut ell = vec![
        [0.0, 0.0],
        [20.0, 0.0],
        [20.0, 10.0],
        [10.0, 10.0],
        [10.0, 20.0],
        [0.0, 20.0],
    ];
    let [x, y] = centroid(&ell);
    assert!((x - 25.0 / 3.0).abs() < 1e-6 && (y - 25.0 / 3.0).abs() < 1e-6);
    ell.reverse();
    let [x, y] = centroid(&ell);
    assert!((x - 25.0 / 3.0).abs() < 1e-6 && (y - 25.0 / 3.0).abs() < 1e-6);
}

#[test]
fn centroid_without_area_is_the_average() {
    assert_eq!(
        centroid(&[[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]]),
        [10.0, 0.0]
    );
}

#[test]
fn section_view_box_is_the_bounds_with_a_margin() {
    assert_eq!(SECTION_VIEW_BOX_MARGIN, 4.0);
    assert_eq!(
        section_view_box(&SQUARE, SECTION_VIEW_BOX_MARGIN),
        "6 16 48 48"
    );
    assert_eq!(section_view_box(&SQUARE, 0.0), "10 20 40 40");
    assert_eq!(section_view_box(&SQUARE, 10.0), "0 10 60 60");
}

// ------------------------------------------------------------------------------ use-pan-zoom.test.ts

const FIT: View = View {
    x: 0.0,
    y: 0.0,
    width: 1000.0,
    height: 640.0,
};
const RECT: Rect = Rect {
    left: 0.0,
    top: 0.0,
    width: 1000.0,
    height: 640.0,
};

#[track_caller]
fn near(a: View, b: View) {
    for (x, y) in [
        (a.x, b.x),
        (a.y, b.y),
        (a.width, b.width),
        (a.height, b.height),
    ] {
        assert!((x - y).abs() < 5e-7, "{a:?} vs {b:?}");
    }
}

#[track_caller]
fn about(a: f64, b: f64) {
    assert!((a - b).abs() < 5e-3, "{a} vs {b}");
}

#[test]
fn pan_zoom_constants() {
    assert_eq!(
        (MAX_ZOOM, STEP, WHEEL_RATE, DRAG_SLOP, ANIMATION_MS),
        (40.0, 1.5, 0.002, 4.0, 200.0)
    );
}

#[test]
fn fit_view_adds_a_margin_on_every_side() {
    assert_eq!(
        fit_view(
            &Bounds {
                x: 100.0,
                y: 50.0,
                width: 40.0,
                height: 20.0
            },
            4.0
        ),
        View {
            x: 96.0,
            y: 46.0,
            width: 48.0,
            height: 28.0
        }
    );
}

#[test]
fn zoom_at_keeps_the_point_where_it_was() {
    let at = [250.0, 160.0];
    let v = zoom_at(&FIT, 2.0, at, &FIT, MAX_ZOOM);
    about(v.width, 500.0);
    about(v.height, 320.0);
    about((at[0] - v.x) / v.width, (at[0] - FIT.x) / FIT.width);
    about((at[1] - v.y) / v.height, (at[1] - FIT.y) / FIT.height);
}

#[test]
fn zoom_at_never_past_the_fit_nor_40() {
    near(zoom_at(&FIT, 0.5, [500.0, 320.0], &FIT, MAX_ZOOM), FIT);
    let deep = zoom_at(&FIT, 1000.0, [500.0, 320.0], &FIT, MAX_ZOOM);
    about(deep.width, 1000.0 / 40.0);
    about(deep.height, 640.0 / 40.0);
}

#[test]
fn pan_by_keeps_the_center_over_the_map() {
    let half = zoom_at(&FIT, 2.0, [500.0, 320.0], &FIT, MAX_ZOOM);
    near(
        pan_by(&half, 100.0, -50.0, &FIT),
        View {
            x: half.x + 100.0,
            y: half.y - 50.0,
            ..half
        },
    );
    let far = pan_by(&half, 10_000.0, 10_000.0, &FIT);
    about(far.x + far.width / 2.0, 1000.0);
    about(far.y + far.height / 2.0, 640.0);
}

#[test]
fn client_to_map_with_the_drawing_centered() {
    assert_eq!(client_to_map(&FIT, &RECT, [500.0, 320.0]), [500.0, 320.0]);
    let wide = Rect {
        left: 0.0,
        top: 0.0,
        width: 2560.0,
        height: 640.0,
    };
    assert_eq!(client_to_map(&FIT, &wide, [780.0, 0.0]), [0.0, 0.0]);
    assert_eq!(client_to_map(&FIT, &wide, [1780.0, 640.0]), [1000.0, 640.0]);
}

#[test]
fn pinch_twice_as_far_apart_zooms_2_times_around_the_middle() {
    let v = pinch_view(
        &FIT,
        &FIT,
        &RECT,
        [[400.0, 300.0], [600.0, 300.0]],
        [[300.0, 300.0], [700.0, 300.0]],
    );
    about(v.width, 500.0);
    let p = client_to_map(&v, &RECT, [500.0, 300.0]);
    about(p[0], 500.0);
    about(p[1], 300.0);
}

// The hook's cases, as cases of the functions its inline logic became.

#[test]
fn starts_at_the_fit_as_a_view_box() {
    assert_eq!(view_box(&FIT), "0 0 1000 640");
    assert_eq!(zoom_of(&FIT, &FIT), 1.0);
}

#[test]
fn a_drag_pans_after_the_slop() {
    let before = zoom_by(&FIT, STEP, &FIT);
    let (from, to) = ([500.0, 300.0], [450.0, 280.0]);
    assert!(is_drag(from, to));
    let v = drag_pan(&before, &RECT, from, to, &FIT);
    let units_per_pixel = before.width / 1000.0;
    about(v.x, before.x + 50.0 * units_per_pixel);
    about(v.y, before.y + 20.0 * units_per_pixel);
}

#[test]
fn a_press_without_a_move_is_not_a_drag() {
    assert!(!is_drag([500.0, 300.0], [501.0, 300.0]));
    assert!(!is_drag([500.0, 300.0], [503.9, 300.0]));
    assert!(is_drag([500.0, 300.0], [500.0, 304.0]));
}

#[test]
fn the_wheel_zooms_at_the_pointer() {
    let at = client_to_map(&FIT, &RECT, [250.0, 160.0]);
    let v = zoom_at(&FIT, wheel_factor(-500.0, 0), at, &FIT, MAX_ZOOM);
    assert!(zoom_of(&v, &FIT) > 1.0);
    about((250.0 - v.x) / v.width, 0.25);
    // Lines and pages are 16 and 400 pixels.
    assert_eq!(wheel_factor(-1.0, 1), wheel_factor(-16.0, 0));
    assert_eq!(wheel_factor(-1.0, 2), wheel_factor(-400.0, 0));
}

#[test]
fn keys_plus_minus_and_arrows_and_fit() {
    let press = |v: View, k: &str| key_action(k).expect(k).apply(&v, &FIT);
    let v = press(FIT, "+");
    about(zoom_of(&v, &FIT), 1.5);
    let v = press(press(v, "+"), "-");
    about(zoom_of(&v, &FIT), 1.5);
    let right = press(v, "ArrowRight");
    assert!(right.x > v.x);
    let up = press(right, "ArrowUp");
    assert!(up.y < v.y);
    for k in ["=", "−", "_", "ArrowLeft", "ArrowDown"] {
        assert!(key_action(k).is_some(), "{k}");
    }
    assert_eq!(key_action("+"), Some(KeyAction::ZoomIn));
    assert_eq!(key_action("Tab"), None);
    assert_eq!(key_action("Enter"), None);
}

#[test]
fn zooms_to_a_section_in_200_ms() {
    let b = Bounds {
        x: 100.0,
        y: 50.0,
        width: 40.0,
        height: 20.0,
    };
    let target = zoom_to_target(&b, None, &FIT);
    near(
        target,
        View {
            x: 96.0,
            y: 46.0,
            width: 48.0,
            height: 28.0,
        },
    );
    let (mid, more) = animation_frame(&FIT, &target, 100.0);
    assert!(more && mid.width > 48.0);
    let (end, more) = animation_frame(&FIT, &target, 250.0);
    assert!(!more);
    near(end, target);
    assert_eq!(ease_out_cubic(0.0), 0.0);
    assert_eq!(ease_out_cubic(1.0), 1.0);
    assert_eq!(ease_out_cubic(0.5), 0.875);
}

#[test]
fn zoom_target_never_deeper_than_40() {
    let b = Bounds {
        x: 500.0,
        y: 300.0,
        width: 2.0,
        height: 1.0,
    };
    let t = zoom_to_target(&b, None, &FIT);
    about(zoom_of(&t, &FIT), 40.0);
    about(t.x + t.width / 2.0, 501.0);
}

#[test]
fn an_unsized_box_counts_as_the_fit() {
    let zero = Rect {
        left: 3.0,
        top: 4.0,
        width: 0.0,
        height: 10.0,
    };
    assert_eq!(rect_or_fit(Some(zero), &FIT), RECT);
    assert_eq!(rect_or_fit(None, &FIT), RECT);
    assert_eq!(rect_or_fit(Some(RECT), &FIT), RECT);
}

#[test]
fn the_map_box_and_the_names_follow_the_frame() {
    assert_eq!(map_aspect(&FIT), 1.5625);
    assert_eq!(
        map_aspect(&View {
            width: 100.0,
            height: 300.0,
            ..FIT
        }),
        1.0
    );
    assert_eq!(
        map_aspect(&View {
            width: 1000.0,
            height: 100.0,
            ..FIT
        }),
        2.2
    );
    assert_eq!(label_font_size(&FIT, 1.0), 20.0);
    assert_eq!(label_font_size(&FIT, 0.5), 20.0);
    assert!(label_font_size(&FIT, 16.0) == 20.0 / 8.0);
}

#[test]
fn fit_of_frames_the_sections_and_the_floor() {
    let a: Vec<Point> = vec![
        [100.0, 100.0],
        [200.0, 100.0],
        [200.0, 150.0],
        [100.0, 150.0],
    ];
    let f = fit_of([a.as_slice()], None, 1000.0, 800.0);
    assert_eq!(
        f,
        View {
            x: 96.0,
            y: 96.0,
            width: 108.0,
            height: 58.0
        }
    );
    let none: [&[Point]; 0] = [];
    assert_eq!(
        fit_of(none, None, 640.0, 480.0),
        View {
            x: 0.0,
            y: 0.0,
            width: 640.0,
            height: 480.0
        }
    );
}

// ------------------------------------------------------------------------------ JavaScript numbers

#[test]
fn js_number_formats_as_string_of_a_number() {
    for (n, s) in [
        (0.0, "0"),
        (-0.0, "0"),
        (1.5, "1.5"),
        (-2.0, "-2"),
        (0.1 + 0.2, "0.30000000000000004"),
        (1e21, "1e+21"),
        (1e20, "100000000000000000000"),
        (1e-6, "0.000001"),
        (1e-7, "1e-7"),
        (1.5e-7, "1.5e-7"),
        (-1.234e25, "-1.234e+25"),
        (f64::NAN, "NaN"),
        (f64::INFINITY, "Infinity"),
        (f64::NEG_INFINITY, "-Infinity"),
        (5e-324, "5e-324"),
        (123.456, "123.456"),
        // Exactly halfway between two shortest candidates: the even one, as JavaScript.
        // 622087415307760.25, exactly.
        (f64::from_bits(0x4301_ae48_1b44_ef82), "622087415307760.2"),
    ] {
        assert_eq!(js_number(n), s);
    }
}

#[test]
fn js_round_and_hypot_are_javascripts() {
    assert_eq!(js_round(2.5), 3.0);
    assert_eq!(js_round(-2.5), -2.0);
    assert!(js_round(-0.4).is_sign_negative());
    assert_eq!(js_round(0.49999999999999994), 0.0);
    assert_eq!(js_hypot(3.0, 4.0), 5.0);
    assert_eq!(js_hypot(0.0, 0.0), 0.0);
    assert!(js_hypot(f64::NAN, 1.0).is_nan());
    assert_eq!(js_hypot(f64::NAN, f64::INFINITY), f64::INFINITY);
}

// ------------------------------------------------------------------------------ parity (R13)

#[test]
fn parity_js_number() {
    let cases = fixture("js-number.json");
    let cases = cases.as_array().unwrap();
    assert!(cases.len() > 600);
    for c in cases {
        let bits = u64::from_str_radix(c["bits"].as_str().unwrap(), 16).unwrap();
        assert_eq!(
            js_number(f64::from_bits(bits)),
            c["string"].as_str().unwrap(),
            "{bits:016x}"
        );
    }
}

#[test]
fn parity_constants() {
    let c = fixture("constants.json");
    let l = LAYOUT_LIMITS;
    let want = json!({
        "maxSections": l.max_sections,
        "maxRows": l.max_rows,
        "maxSeatsPerRow": l.max_seats_per_row,
        "maxSeats": l.max_seats,
        "maxLevels": l.max_levels,
        "maxCarriedLevels": l.max_carried_levels,
        "nameMaxLength": l.name_max_length,
        "labelMaxLength": l.label_max_length,
        "maxOutlinePoints": l.max_outline_points,
        "maxMapUnits": l.max_map_units,
        "maxOffSaleSelectors": l.max_off_sale_selectors,
        "maxImportBytes": l.max_import_bytes,
    });
    same(&want, &c["LAYOUT_LIMITS"], "LAYOUT_LIMITS");
    same(LEVEL_COLORS, &c["LEVEL_COLORS"], "LEVEL_COLORS");
    same(SEAT_GAP, &c["SEAT_GAP"], "SEAT_GAP");
    same(ROW_GAP, &c["ROW_GAP"], "ROW_GAP");
    same(OUTLINE_MARGIN, &c["OUTLINE_MARGIN"], "OUTLINE_MARGIN");
    same(SIZE_MARGIN, &c["SIZE_MARGIN"], "SIZE_MARGIN");
    same(MAX_ZOOM, &c["MAX_ZOOM"], "MAX_ZOOM");
}

fn block_rows_of(arg: &Value) -> Vec<Vec<Pt>> {
    if let Some(rows) = arg.get("rows") {
        rows.as_array().unwrap().iter().map(pts).collect()
    } else {
        placed_seats(
            &block_values(&arg["block"]),
            pt(&arg["origin"]),
            num(&arg["angle"]),
        )
    }
}

#[test]
fn parity_layout_geometry() {
    let cases = fixture("layout-geometry.json");
    let mut seen = std::collections::BTreeSet::new();
    for (i, c) in cases.as_array().unwrap().iter().enumerate() {
        let f = c["fn"].as_str().unwrap();
        seen.insert(f.to_string());
        let a = &c["args"];
        let what = format!("case {i}: {f} {a}");
        let block_err = |e: BlockError| serde_json::to_value(e).unwrap();
        let got = match f {
            "moveBy" => json!({ "out": move_by(&pts(&a[0]), num(&a[1]), num(&a[2])) }),
            "turnAbout" => json!({ "out": turn_about(&pts(&a[0]), pt(&a[1]), num(&a[2])) }),
            "normalizeAngle" => json!({ "out": normalize_angle(num(&a[0])) }),
            "outlineAround" => outcome(outline_around(&block_rows_of(&a[0])), |e| {
                Value::String(e.to_string())
            }),
            "rowLabels" => outcome(
                row_labels(
                    style(&a[0]),
                    a[1].as_str().unwrap(),
                    a[2].as_u64().unwrap() as usize,
                ),
                block_err,
            ),
            "checkBlock" => json!({ "out": check_block(&block_values(&a[0])) }),
            "seatCounts" => json!({ "out": seat_counts(&block_values(&a[0])) }),
            "generateBlock" => outcome(generate_block(&block_values(&a[0])), block_err),
            "placeBlock" => {
                let block = generate_block(&block_values(&a[0]["block"])).unwrap();
                json!({ "out": place_block(&block, pt(&a[1]), num(&a[2])) })
            }
            other => panic!("no case for {other}"),
        };
        same(&got, &result_of(c), &what);
    }
    for f in [
        "moveBy",
        "turnAbout",
        "normalizeAngle",
        "outlineAround",
        "rowLabels",
        "checkBlock",
        "seatCounts",
        "generateBlock",
        "placeBlock",
    ] {
        assert!(seen.contains(f), "no fixture case for {f}");
    }
}

#[test]
fn parity_map_geometry() {
    let cases = fixture("map-geometry.json");
    let mut seen = std::collections::BTreeSet::new();
    for (i, c) in cases.as_array().unwrap().iter().enumerate() {
        let f = c["fn"].as_str().unwrap();
        seen.insert(f.to_string());
        let a = &c["args"];
        let what = format!("case {i}: {f} {a}");
        match f {
            "outlinePath" => assert_eq!(
                outline_path(&pts(&a[0])),
                c["out"].as_str().unwrap(),
                "{what}"
            ),
            "sectionViewBox" => {
                let margin = opt_num(&a[1]).unwrap_or(SECTION_VIEW_BOX_MARGIN);
                assert_eq!(
                    section_view_box(&pts(&a[0]), margin),
                    c["out"].as_str().unwrap(),
                    "{what}"
                );
            }
            "bounds" => same(bounds(&pts(&a[0])), &c["out"], &what),
            "centroid" => same(centroid(&pts(&a[0])), &c["out"], &what),
            other => panic!("no case for {other}"),
        }
    }
    assert_eq!(seen.len(), 4);
}

#[test]
fn parity_pan_zoom_math() {
    let cases = fixture("pan-zoom.json");
    let mut seen = std::collections::BTreeSet::new();
    for (i, c) in cases.as_array().unwrap().iter().enumerate() {
        let f = c["fn"].as_str().unwrap();
        seen.insert(f.to_string());
        let a = &c["args"];
        let what = format!("case {i}: {f} {a}");
        let b = |v: &Value| view(v);
        let got = match f {
            "fitView" => json!(fit_view(&b(&a[0]), opt_num(&a[1]).unwrap_or(0.0))),
            "zoomOf" => json!(zoom_of(&b(&a[0]), &b(&a[1]))),
            "zoomAt" => json!(zoom_at(
                &b(&a[0]),
                num(&a[1]),
                pt(&a[2]),
                &b(&a[3]),
                opt_num(&a[4]).unwrap_or(MAX_ZOOM)
            )),
            "panBy" => json!(pan_by(&b(&a[0]), num(&a[1]), num(&a[2]), &b(&a[3]))),
            "clientToMap" => json!(client_to_map(&b(&a[0]), &rect(&a[1]), pt(&a[2]))),
            "pinchView" => json!(pinch_view(
                &b(&a[0]),
                &b(&a[1]),
                &rect(&a[2]),
                [pt(&a[3][0]), pt(&a[3][1])],
                [pt(&a[4][0]), pt(&a[4][1])]
            )),
            other => panic!("no case for {other}"),
        };
        same(&got, &c["out"], &what);
    }
    assert_eq!(seen.len(), 6);
}

/// A number as the fixtures write it: one JSON can't hold, by name.
fn jv(f: f64) -> Value {
    if f.is_nan() {
        json!("NaN")
    } else if f.is_infinite() {
        json!(if f > 0.0 { "Infinity" } else { "-Infinity" })
    } else {
        json!(f)
    }
}

/// What the hook shows for a view: the view, its `viewBox`, and its zoom.
fn shown(v: View, fit: &View) -> Value {
    json!({
        "view": { "x": jv(v.x), "y": jv(v.y), "width": jv(v.width), "height": jv(v.height) },
        "viewBox": view_box(&v),
        "zoom": jv(zoom_of(&v, fit)),
    })
}

fn state_of(c: &Value) -> Value {
    json!({ "view": c["view"], "viewBox": c["viewBox"], "zoom": c["zoom"] })
}

#[test]
fn parity_pan_zoom_hook() {
    let cases = fixture("pan-zoom-hook.json");
    let mut seen = std::collections::BTreeSet::new();
    for (i, c) in cases.as_array().unwrap().iter().enumerate() {
        let f = c["fn"].as_str().unwrap();
        seen.insert(f.to_string());
        let what = format!("case {i}: {f}");
        let fit = view(&c["fit"]);
        match f {
            "keyAction" => {
                let start = view(&c["start"]["view"]);
                same(shown(start, &fit), &c["start"], &what);
                let action = key_action(c["key"].as_str().unwrap());
                assert_eq!(
                    action.is_some(),
                    c["prevented"].as_bool().unwrap(),
                    "{what}"
                );
                let after = action.map_or(start, |a| a.apply(&start, &fit));
                same(shown(after, &fit), &state_of(c), &what);
            }
            "wheelFactor" => {
                let start = view(&c["start"]["view"]);
                same(shown(zoom_by(&fit, STEP, &fit), &fit), &c["start"], &what);
                let r = rect_or_fit(Some(rect(&c["rect"])), &fit);
                let at = client_to_map(&start, &r, pt(&c["client"]));
                let k = wheel_factor(num(&c["deltaY"]), c["deltaMode"].as_u64().unwrap() as u32);
                same(
                    shown(zoom_at(&start, k, at, &fit, MAX_ZOOM), &fit),
                    &state_of(c),
                    &what,
                );
            }
            "zoomToTarget" => {
                let b = view(&c["bounds"]);
                let target = zoom_to_target(&b, opt_num(&c["margin"]), &fit);
                same(shown(target, &fit), &state_of(c), &what);
            }
            "animationFrame" => {
                let start = view(&c["start"]["view"]);
                same(shown(zoom_by(&fit, STEP, &fit), &fit), &c["start"], &what);
                let target = zoom_to_target(&view(&c["bounds"]), None, &fit);
                for s in c["steps"].as_array().unwrap() {
                    let (v, more) = animation_frame(&start, &target, num(&s["elapsed"]));
                    assert_eq!(more, s["more"].as_bool().unwrap(), "{what} {s}");
                    same(
                        shown(v, &fit),
                        &state_of(s),
                        &format!("{what} {}", s["elapsed"]),
                    );
                }
            }
            "isDrag" => {
                let r = rect(&c["rect"]);
                let mut v = view(&c["start"]["view"]);
                same(
                    shown(zoom_by(&zoom_by(&fit, STEP, &fit), STEP, &fit), &fit),
                    &c["start"],
                    &what,
                );
                let path = pts(&c["path"]);
                let (pressed, mut prev, mut dragging) = (path[0], path[0], false);
                for (m, now) in c["moves"].as_array().unwrap().iter().zip(&path[1..]) {
                    if !dragging && is_drag(pressed, *now) {
                        dragging = true;
                    }
                    if dragging {
                        v = drag_pan(&v, &r, prev, *now, &fit);
                    }
                    prev = *now;
                    same(
                        shown(v, &fit),
                        &state_of(m),
                        &format!("{what} to {}", m["to"]),
                    );
                }
                assert_eq!(dragging, c["dragged"].as_bool().unwrap(), "{what}");
            }
            "pinchHook" => {
                let r = rect(&c["rect"]);
                let mut v = view(&c["start"]["view"]);
                let mut at: Vec<(u64, Point)> = c["down"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|d| (d[0].as_u64().unwrap(), pt(&d[1])))
                    .collect();
                for m in c["moves"].as_array().unwrap() {
                    let id = m["id"].as_u64().unwrap();
                    let now = pt(&m["to"]);
                    let me = at.iter().position(|(i, _)| *i == id).unwrap();
                    let prev = at[me].1;
                    at[me].1 = now;
                    let other = at.iter().find(|(i, _)| *i != id).unwrap().1;
                    v = pinch_view(&v, &fit, &r, [prev, other], [now, other]);
                    same(shown(v, &fit), &state_of(m), &format!("{what} {}", m["to"]));
                }
            }
            "fit" => same(shown(fit, &fit), &state_of(c), &what),
            other => panic!("no case for {other}"),
        }
    }
    for f in [
        "keyAction",
        "wheelFactor",
        "zoomToTarget",
        "animationFrame",
        "isDrag",
        "pinchHook",
        "fit",
    ] {
        assert!(seen.contains(f), "no fixture case for {f}");
    }
}

/// Whether `a` and `b` are at most 2 floats apart: the one allowance in these checks, for a
/// number from `**` (`js_pow`). V8's `Math.pow`, `Math.exp`, `Math.sin`, and `Math.cos` are fdlibm
/// compiled from C, and where Node is built for arm64 (Apple silicon, where these fixtures are
/// made) the compiler fuses fdlibm's multiply-adds: fdlibm's `exp` and `sin` with fused
/// multiply-adds give Node's `Math.exp` and `Math.sin` bit for bit on 200,000 inputs, and without
/// them differ in the last bit on 0.02% and 1% of them. The Rust ports are fdlibm without fused
/// multiply-adds, as V8 is built for x86-64, the same natively and in WebAssembly, so a JavaScript
/// number from those functions can be a float apart on one platform or the other. Every other
/// number and every string here must be the same exactly.
fn fused_last_bits(a: f64, b: f64) -> bool {
    a.is_finite()
        && b.is_finite()
        && a.signum() == b.signum()
        && a.to_bits().abs_diff(b.to_bits()) <= 2
}

#[test]
fn parity_venue_map() {
    let cases = fixture("venue-map.json");
    let mut seen = std::collections::BTreeSet::new();
    let mut off_by_fused = 0;
    for (i, c) in cases.as_array().unwrap().iter().enumerate() {
        let f = c["fn"].as_str().unwrap();
        seen.insert(f.to_string());
        let what = format!("case {i}: {f} {}", c["map"]["name"]);
        let m = &c["map"];
        let outlines: Vec<Vec<Point>> = m["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| pts(&s["outline"]))
            .collect();
        let floor = (m["floorKind"] != "NONE" && !m["floorOutline"].is_null())
            .then(|| pts(&m["floorOutline"]));
        let fit = fit_of(
            outlines.iter().map(Vec::as_slice),
            floor.as_deref(),
            num(&m["size"]["width"]),
            num(&m["size"]["height"]),
        );
        match f {
            "fitOf" => same(fit, &c["out"], &what),
            "venueMap" => {
                same(fit, &c["fit"], &what);
                assert_eq!(
                    Some(js_number(map_aspect(&fit))),
                    c["aspectRatio"].as_str().map(String::from),
                    "{what}"
                );
                let mut v = fit;
                for z in c["zooms"].as_array().unwrap() {
                    if z["presses"].as_u64().unwrap() > 0 {
                        v = zoom_by(&v, STEP, &fit);
                    }
                    assert_eq!(view_box(&v), z["viewBox"].as_str().unwrap(), "{what} {z}");
                    if let Some(size) = z["fontSize"].as_str() {
                        let fs = label_font_size(&fit, zoom_of(&v, &fit));
                        let fused = fused_last_bits(fs, size.parse().unwrap());
                        assert!(js_number(fs) == size || fused, "{what} {z}: {fs}");
                        if js_number(fs) != size {
                            off_by_fused += 1;
                        }
                    }
                }
            }
            other => panic!("no case for {other}"),
        }
    }
    assert_eq!(seen.len(), 2);
    // Today one size of the 40 (zoom 7.593750000000003 ** 0.75) is a bit apart.
    assert!(off_by_fused <= 2, "{off_by_fused} sizes apart");
}
