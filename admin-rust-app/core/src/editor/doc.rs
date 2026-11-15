//! Spec 037 research R14 (T074): the layout editor's document, ported from
//! `admin-app/src/layout-editor/editor-doc.ts` (039 research R3, R4, R5, R10, R12; parity LE20,
//! LE36, LE73, LE74). The layout as the editor holds it while it is open. Every level, section,
//! row and seat keeps the id it was read with, or a temporary `new:<n>` id until it is saved
//! (what is sent without an id is new). Places are map units, `y` down. A seat's level is its
//! own, else its row's, else its section's (038 FR-003).
//!
//! Sections are shared between documents (`Arc`), as the TypeScript shares the objects a change
//! does not touch, so the history of 100 documents stays cheap. The layout's id and `revision`
//! are kept beside the document, not in it, so Undo past a save never sends a stale revision.

use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value, json};

use super::js;
use crate::seating::geometry::{
    BlockValues, LAYOUT_LIMITS, SIZE_MARGIN, normalize_angle, outline_around,
};
use crate::seating::map_geometry::{js_max, js_min, js_round};

/// `Place`: `[x, y]` in map units.
pub type Place = [f64; 2];

/// The contract's `SectionGenerator`: the values a section was generated from (`BlockValues`).
pub type SectionGenerator = BlockValues;

/// `EdSeat`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdSeat {
    pub id: String,
    pub label: String,
    pub at: Place,
    /// Its own level, or `None` for its row's.
    pub level_id: Option<String>,
    pub accessible: bool,
}

/// `EdRow`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdRow {
    pub id: String,
    pub label: String,
    /// Its own level, or `None` for its section's.
    pub level_id: Option<String>,
    /// Left to right as seen from the floor.
    pub seats: Vec<EdSeat>,
}

/// `EdSection`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdSection {
    pub id: String,
    pub name: String,
    pub level_id: String,
    /// The point it moves and turns about (R6).
    pub origin: Place,
    /// Degrees clockwise it has been turned, in (−180, 180].
    pub angle: f64,
    pub generator: Option<SectionGenerator>,
    /// Around its seats (`outlineAround`, R5): the editor never takes an outline from elsewhere.
    pub outline: Vec<Place>,
    /// Front first.
    pub rows: Vec<EdRow>,
}

/// `EdLevel`. `color` is one of `LEVEL_COLORS`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EdLevel {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// The contract's `FloorKind`, in the order of the editor's Floor object select.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FloorKind {
    None,
    Court,
    EndStage,
    CenterStage,
    Ring,
}

impl FloorKind {
    /// Every kind, in the select's order (`Object.keys(FLOOR_NAMES)`).
    pub const ALL: [FloorKind; 5] = [
        FloorKind::None,
        FloorKind::Court,
        FloorKind::EndStage,
        FloorKind::CenterStage,
        FloorKind::Ring,
    ];

    /// The contract's value: `NONE`, `COURT`, `END_STAGE`, `CENTER_STAGE`, `RING`.
    pub fn as_str(self) -> &'static str {
        match self {
            FloorKind::None => "NONE",
            FloorKind::Court => "COURT",
            FloorKind::EndStage => "END_STAGE",
            FloorKind::CenterStage => "CENTER_STAGE",
            FloorKind::Ring => "RING",
        }
    }

    /// `FLOOR_NAMES` (`editor-state.ts`): "None", "Court", "End stage", "Center stage", "Ring".
    pub fn name(self) -> &'static str {
        match self {
            FloorKind::None => "None",
            FloorKind::Court => "Court",
            FloorKind::EndStage => "End stage",
            FloorKind::CenterStage => "Center stage",
            FloorKind::Ring => "Ring",
        }
    }

    /// The kind of a contract value, or `None` (the Rust option) for another string.
    pub fn parse(s: &str) -> Option<FloorKind> {
        FloorKind::ALL.into_iter().find(|k| k.as_str() == s)
    }
}

/// `EdFloor`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EdFloor {
    pub kind: FloorKind,
    /// `None` with `NONE`.
    pub outline: Option<Vec<Place>>,
}

/// `EditorDoc`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EditorDoc {
    pub name: String,
    pub floor: EdFloor,
    /// Best first: the order is the rank.
    pub levels: Vec<EdLevel>,
    /// In drawing order; each shared with the documents it did not change in.
    #[serde(serialize_with = "ser_sections", deserialize_with = "de_sections")]
    pub sections: Vec<Arc<EdSection>>,
}

fn ser_sections<S: Serializer>(sections: &[Arc<EdSection>], s: S) -> Result<S::Ok, S::Error> {
    s.collect_seq(sections.iter().map(|x| &**x))
}

fn de_sections<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Arc<EdSection>>, D::Error> {
    Ok(Vec::<EdSection>::deserialize(d)?
        .into_iter()
        .map(Arc::new)
        .collect())
}

/// `isNew`: whether an id was made in the editor and has not been saved.
pub fn is_new(id: &str) -> bool {
    id.starts_with("new:")
}

/// `seatLevel`: the level a seat is in: its own, else its row's, else its section's.
pub fn seat_level<'a>(section: &'a EdSection, row: &'a EdRow, seat: &'a EdSeat) -> &'a str {
    seat.level_id
        .as_deref()
        .or(row.level_id.as_deref())
        .unwrap_or(&section.level_id)
}

/// `outlineOf`: the outline around a section's rows of seats (R5). Where the TypeScript would
/// throw (no seat at all), it is empty; the editor never asks for one then.
pub fn outline_of(rows: &[EdRow]) -> Vec<Place> {
    let places: Vec<Vec<Place>> = rows
        .iter()
        .map(|r| r.seats.iter().map(|s| s.at).collect())
        .collect();
    outline_around(&places).unwrap_or_default()
}

/// `emptyDoc` (R12, FR-001): a new layout starts with one level, "Standard", violet, and nothing
/// else.
pub fn empty_doc() -> EditorDoc {
    EditorDoc {
        name: String::new(),
        floor: EdFloor {
            kind: FloorKind::None,
            outline: None,
        },
        levels: vec![EdLevel {
            id: "new:0".into(),
            name: "Standard".into(),
            color: "violet".into(),
        }],
        sections: Vec::new(),
    }
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn place(v: &Value) -> Place {
    [
        v[0].as_f64().unwrap_or(f64::NAN),
        v[1].as_f64().unwrap_or(f64::NAN),
    ]
}

fn places(v: &Value) -> Vec<Place> {
    v.as_array()
        .map(|a| a.iter().map(place).collect())
        .unwrap_or_default()
}

fn own_level(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

/// `fromDrawing` (R3): a `LayoutDrawing` (as the Backend sends it) as the editor's document;
/// levels by rank, outlines drawn around the seats. A missing own level is none, `accessible`
/// defaults to false, no generator is none. The floor keeps its kind even without an outline
/// (`{ kind, outline: null }`), as the TypeScript does.
pub fn from_drawing(d: &Value) -> EditorDoc {
    let kind =
        FloorKind::parse(d["floor"]["kind"].as_str().unwrap_or("NONE")).unwrap_or(FloorKind::None);
    let outline = &d["floor"]["outline"];
    let floor = EdFloor {
        kind,
        outline: (kind != FloorKind::None && outline.is_array()).then(|| places(outline)),
    };
    let mut levels: Vec<&Value> = d["levels"]
        .as_array()
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    // Stable, as `Array.prototype.sort`.
    levels.sort_by(|a, b| {
        let (a, b) = (a["rank"].as_f64(), b["rank"].as_f64());
        a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
    });
    let empty = Vec::new();
    let sections = d["sections"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .map(|s| {
            let rows: Vec<EdRow> = s["rows"]
                .as_array()
                .unwrap_or(&empty)
                .iter()
                .map(|r| EdRow {
                    id: text(&r["id"]),
                    label: text(&r["label"]),
                    level_id: own_level(&r["levelId"]),
                    seats: r["seats"]
                        .as_array()
                        .unwrap_or(&empty)
                        .iter()
                        .map(|x| EdSeat {
                            id: text(&x["id"]),
                            label: text(&x["label"]),
                            at: place(&x["at"]),
                            level_id: own_level(&x["levelId"]),
                            accessible: x["accessible"].as_bool().unwrap_or(false),
                        })
                        .collect(),
                })
                .collect();
            let seated = rows.iter().any(|r| !r.seats.is_empty());
            Arc::new(EdSection {
                id: text(&s["id"]),
                name: text(&s["name"]),
                level_id: text(&s["levelId"]),
                origin: place(&s["origin"]),
                angle: s["angle"].as_f64().unwrap_or(0.0),
                generator: serde_json::from_value(s["generator"].clone()).ok(),
                outline: if seated {
                    outline_of(&rows)
                } else {
                    places(&s["outline"])
                },
                rows,
            })
        })
        .collect();
    EditorDoc {
        name: text(&d["name"]),
        floor,
        levels: levels
            .into_iter()
            .map(|l| EdLevel {
                id: text(&l["id"]),
                name: text(&l["name"]),
                color: text(&l["color"]),
            })
            .collect(),
        sections,
    }
}

/// `tenth`: a place to 0.1 of a map unit (R3), never `-0`.
fn tenth(n: f64) -> f64 {
    let r = js_round(n * 10.0) / 10.0;
    if r == 0.0 { 0.0 } else { r }
}

fn round_place(p: Place) -> Value {
    json!([js::json_number(tenth(p[0])), js::json_number(tenth(p[1]))])
}

/// The generator as sent, numbers written as JavaScript writes them.
pub(crate) fn generator_json(g: &SectionGenerator) -> Value {
    json!({
        "rows": js::json_number(g.rows),
        "seatsPerRow": g.seats_per_row.iter().map(|n| js::json_number(*n)).collect::<Vec<_>>(),
        "rowLabels": g.row_labels,
        "firstRow": g.first_row,
        "firstSeat": js::json_number(g.first_seat),
        "direction": g.direction,
        "curve": js::json_number(g.curve),
    })
}

/// `toInput` (R3, R10): the document as the contract's `LayoutDrawingInput`. Levels are keyed
/// `l1`… best first; sections, rows and seats name them by key; new items are sent without an
/// id; places to 0.1; no outlines and no size (the Backend draws and sizes them, R5). `revision`
/// only for a layout that exists. A saved item is sent with its id (R4: kept), a new one
/// without; `fresh` (FR-023, Save as a new layout) sends none.
pub fn to_input(doc: &EditorDoc, revision: Option<u64>, fresh: bool) -> Value {
    let with_id = |obj: &mut Map<String, Value>, id: &str| {
        if !(fresh || is_new(id)) {
            obj.insert("id".into(), json!(id));
        }
    };
    let key_of: HashMap<&str, String> = doc
        .levels
        .iter()
        .enumerate()
        .map(|(i, l)| (l.id.as_str(), format!("l{}", i + 1)))
        .collect();
    let key = |level_id: &str| -> String {
        key_of
            .get(level_id)
            .cloned()
            .unwrap_or_else(|| level_id.to_string())
    };
    let mut out = Map::new();
    if let Some(r) = revision {
        out.insert("revision".into(), json!(r));
    }
    out.insert("name".into(), json!(js::trim(&doc.name)));
    out.insert(
        "floor".into(),
        match (&doc.floor.outline, doc.floor.kind) {
            (Some(outline), kind) if kind != FloorKind::None => json!({
                "kind": kind.as_str(),
                "outline": outline.iter().map(|p| round_place(*p)).collect::<Vec<_>>(),
            }),
            _ => json!({ "kind": "NONE" }),
        },
    );
    let levels = doc
        .levels
        .iter()
        .map(|l| {
            let mut o = Map::new();
            with_id(&mut o, &l.id);
            o.insert("key".into(), json!(key(&l.id)));
            o.insert("name".into(), json!(l.name));
            o.insert("color".into(), json!(l.color));
            Value::Object(o)
        })
        .collect::<Vec<_>>();
    out.insert("levels".into(), Value::Array(levels));
    let sections = doc
        .sections
        .iter()
        .map(|s| {
            let mut o = Map::new();
            with_id(&mut o, &s.id);
            o.insert("name".into(), json!(s.name));
            o.insert("level".into(), json!(key(&s.level_id)));
            o.insert("origin".into(), round_place(s.origin));
            o.insert(
                "angle".into(),
                js::json_number(normalize_angle(tenth(s.angle))),
            );
            if let Some(g) = &s.generator {
                o.insert("generator".into(), generator_json(g));
            }
            let rows = s
                .rows
                .iter()
                .map(|r| {
                    let mut ro = Map::new();
                    with_id(&mut ro, &r.id);
                    ro.insert("label".into(), json!(r.label));
                    if let Some(l) = &r.level_id {
                        ro.insert("level".into(), json!(key(l)));
                    }
                    let seats = r
                        .seats
                        .iter()
                        .map(|x| {
                            let mut so = Map::new();
                            with_id(&mut so, &x.id);
                            so.insert("label".into(), json!(x.label));
                            so.insert("at".into(), round_place(x.at));
                            if let Some(l) = &x.level_id {
                                so.insert("level".into(), json!(key(l)));
                            }
                            if x.accessible {
                                so.insert("accessible".into(), json!(true));
                            }
                            Value::Object(so)
                        })
                        .collect::<Vec<_>>();
                    ro.insert("seats".into(), Value::Array(seats));
                    Value::Object(ro)
                })
                .collect::<Vec<_>>();
            o.insert("rows".into(), Value::Array(rows));
            Value::Object(o)
        })
        .collect::<Vec<_>>();
    out.insert("sections".into(), Value::Array(sections));
    Value::Object(out)
}

/// `farthest`: the furthest place drawn (outlines, origins, the floor), for the map's size (R5).
pub fn farthest(doc: &EditorDoc) -> Place {
    let (mut x, mut y) = (0.0_f64, 0.0_f64);
    let mut see = |p: &Place| {
        if p[0] > x {
            x = p[0];
        }
        if p[1] > y {
            y = p[1];
        }
    };
    for s in &doc.sections {
        s.outline.iter().for_each(&mut see);
        see(&s.origin);
    }
    if let Some(o) = &doc.floor.outline {
        o.iter().for_each(&mut see);
    }
    [x, y]
}

/// The size `mapSize` gives.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MapSize {
    pub width: f64,
    pub height: f64,
}

/// `mapSize` (R5): the map's size as the Backend will set it: everything drawn plus a margin, at
/// most 5,000.
pub fn map_size(doc: &EditorDoc) -> MapSize {
    let [x, y] = farthest(doc);
    let max = LAYOUT_LIMITS.max_map_units as f64;
    MapSize {
        width: js_min([max, js_max([1.0, x + SIZE_MARGIN])]),
        height: js_min([max, js_max([1.0, y + SIZE_MARGIN])]),
    }
}

/// `levelName`: a level's name, or `""` for none.
pub fn level_name<'a>(doc: &'a EditorDoc, id: Option<&str>) -> &'a str {
    doc.levels
        .iter()
        .find(|l| Some(l.id.as_str()) == id)
        .map_or("", |l| l.name.as_str())
}
