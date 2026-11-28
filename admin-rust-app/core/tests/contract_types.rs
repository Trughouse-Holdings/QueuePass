//! Spec 037 research R5, Principle I (tasks T022): the API types are generated from the contract
//! by `core/build.rs`, so they cannot drift from it. This checks one example per resource: each
//! is valid against its `components.schemas` entry (formats included), and decodes into the
//! generated type. The examples are the React Admin app's own test fixtures
//! (`tests/fixtures/api/generate.mts`). Every schema's type is generated (T021: typify built all
//! 84). A few answers are also read into smaller hand-written structs, as far as a page reads them
//! (the edit form's event, ticket types, seating and availability; the venue map and its
//! sections): R5 checks each of those against its schema below, with every optional field there
//! and with only the required ones.

use std::{fs, path::PathBuf};

use admin_rust_core::api::types;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn components() -> Value {
    let text = fs::read_to_string(root().join("contracts/openapi.yaml")).unwrap();
    let doc: Value = serde_yaml::from_str(&text).unwrap();
    doc["components"].clone()
}

fn example(name: &str) -> Value {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/api/{name}.json"));
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// Validates `instance` against `schema` (a JSON Schema with `$ref`s into the contract).
fn validate(schema: Value, instance: &Value) -> Vec<String> {
    let mut root = schema;
    root["components"] = components();
    let validator = jsonschema::options()
        .should_validate_formats(true)
        .build(&root)
        .expect("the contract's schema compiles");
    validator
        .iter_errors(instance)
        .map(|e| format!("{} at {}", e, e.instance_path()))
        .collect()
}

fn check<T: DeserializeOwned>(schema: &str, name: &str, list: bool) {
    let instance = example(name);
    let reference = json!({ "$ref": format!("#/components/schemas/{schema}") });
    let schema_value = if list {
        json!({ "type": "array", "items": reference })
    } else {
        reference
    };
    let errors = validate(schema_value, &instance);
    assert!(
        errors.is_empty(),
        "{name} against {schema}:\n{}",
        errors.join("\n")
    );
    serde_json::from_value::<T>(instance).unwrap_or_else(|e| panic!("{name} decodes: {e}"));
}

#[test]
fn a_location_and_the_location_list() {
    check::<types::Location>("Location", "Location", false);
    check::<Vec<types::Location>>("Location", "LocationList", true);
}

#[test]
fn an_event() {
    check::<types::Event>("Event", "Event", false);
}

#[test]
fn a_sales_report() {
    check::<types::SalesReport>("SalesReport", "SalesReport", false);
}

#[test]
fn an_order_with_its_tickets() {
    check::<types::Order>("Order", "Order", false);
}

#[test]
fn a_season() {
    // Spec 041: the React app's own Season fixture (`fixtures-041.ts`), on sale with a pass sold.
    check::<types::Season>("Season", "Season", false);
}

#[test]
fn layouts() {
    check::<types::LayoutSummary>("LayoutSummary", "LayoutSummary", false);
    check::<types::LayoutDetail>("LayoutDetail", "LayoutDetail", false);
    check::<types::LayoutSectionSeats>("LayoutSectionSeats", "LayoutSectionSeats", false);
}

#[test]
fn a_layout_drawing() {
    check::<types::LayoutDrawing>("LayoutDrawing", "LayoutDrawing", false);
}

#[test]
fn a_venue_map_and_a_section_of_it() {
    check::<types::VenueMap>("VenueMap", "VenueMap", false);
    check::<types::VenueMapSection>("VenueMapSection", "VenueMapSection", false);
}

#[test]
fn an_error_envelope_and_the_code_list() {
    let envelope = json!({
        "error": {
            "code": "SCHEDULING_CONFLICT",
            "message": "Overlaps another event.",
            "details": { "conflictingEventId": "b92fc02c-6013-470d-a3bf-bf53648b0ebc" }
        }
    });
    assert!(
        validate(
            json!({ "$ref": "#/components/schemas/ErrorEnvelope" }),
            &envelope
        )
        .is_empty()
    );
    serde_json::from_value::<types::ErrorEnvelope>(envelope).unwrap();
    // A code the contract does not know is not the envelope (isErrorEnvelope).
    let unknown = json!({ "error": { "code": "NOPE", "message": "x" } });
    assert!(serde_json::from_value::<types::ErrorEnvelope>(unknown).is_err());
}

#[test]
fn the_validator_refuses_a_bad_example() {
    let mut bad = example("Location");
    bad["timeZone"] = json!("Europe/Paris");
    assert!(!validate(json!({ "$ref": "#/components/schemas/Location" }), &bad).is_empty());
}

/// The type each `ApiClient` method decodes is the one the contract's 2xx answer names, for every
/// method named after an operation (`createLayoutDrawing` → `create_layout_drawing`). Found in the
/// browser: drawing saves answer `LayoutDetail`, and reading them as `LayoutDrawing` failed after
/// the layout was saved.
#[test]
fn every_client_method_decodes_the_contracts_answer() {
    let text = fs::read_to_string(root().join("contracts/openapi.yaml")).unwrap();
    let doc: Value = serde_yaml::from_str(&text).unwrap();
    let snake = |s: &str| {
        s.chars().fold(String::new(), |mut out, c| {
            if c.is_ascii_uppercase() {
                out.push('_');
                out.push(c.to_ascii_lowercase());
            } else {
                out.push(c);
            }
            out
        })
    };
    let mut answers = std::collections::BTreeMap::new();
    for item in doc["paths"].as_object().unwrap().values() {
        for op in item.as_object().unwrap().values() {
            let Some(id) = op["operationId"].as_str() else {
                continue;
            };
            let ok = op["responses"]
                .as_object()
                .unwrap()
                .iter()
                .find(|(code, _)| code.starts_with('2'))
                .map(|(_, r)| r["content"]["application/json"]["schema"].clone());
            let name = |r: &Value| {
                r["$ref"]
                    .as_str()
                    .map(|s| s.rsplit('/').next().unwrap().to_string())
            };
            let ty = match ok {
                Some(s) if s["type"] == "array" => {
                    name(&s["items"]).map(|n| format!("Vec<types::{n}>"))
                }
                Some(s) if !s.is_null() => name(&s).map(|n| format!("types::{n}")),
                _ => Some("()".to_string()),
            };
            answers.insert(snake(id), ty);
        }
    }
    let client =
        fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/api/client.rs"))
            .unwrap();
    let mut checked = 0;
    let mut wrong = Vec::new();
    for part in client.split("pub async fn ").skip(1) {
        let name: String = part
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        let Some(Some(want)) = answers.get(&name) else {
            continue;
        };
        let after = &part[part.find("-> Result<").unwrap() + "-> Result<".len()..];
        let got: String = after[..after.find(", ApiError>").unwrap()]
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        checked += 1;
        if &got != want {
            wrong.push(format!(
                "{name}: decodes {got}, the contract answers {want}"
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
    assert!(checked >= 29, "only {checked} methods matched an operation");
}

// ---------------------------------------------------------------- hand-written answer types (R5)

/// `instance` cut down to what `schema` requires, at the top and in each array of objects one
/// level down: a hand-written type must decode what the contract promises and nothing more.
fn required_only(schema: &str, instance: &Value) -> Value {
    let all = components();
    let resolve = |s: &Value| -> Value {
        match s["$ref"].as_str() {
            Some(r) => all["schemas"][r.rsplit('/').next().unwrap()].clone(),
            None => s.clone(),
        }
    };
    fn cut(schema: &Value, value: &Value, resolve: &dyn Fn(&Value) -> Value) -> Value {
        let schema = resolve(schema);
        let Some(obj) = value.as_object() else {
            return value.clone();
        };
        let required: Vec<&str> = schema["required"]
            .as_array()
            .map(|r| r.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let mut out = serde_json::Map::new();
        for (k, v) in obj {
            if !required.contains(&k.as_str()) {
                continue;
            }
            let prop = resolve(&schema["properties"][k]);
            let v = match v.as_array() {
                Some(items) => Value::Array(
                    items
                        .iter()
                        .map(|i| cut(&prop["items"], i, resolve))
                        .collect(),
                ),
                None => v.clone(),
            };
            out.insert(k.clone(), v);
        }
        Value::Object(out)
    }
    let reference = json!({ "$ref": format!("#/components/schemas/{schema}") });
    cut(&reference, instance, &resolve)
}

/// `instance` is valid against `schema`, whole and cut to its required fields, and both decode
/// into the hand-written `T`.
fn check_hand_written<T: DeserializeOwned>(schema: &str, instance: Value) -> (T, T) {
    let reference = json!({ "$ref": format!("#/components/schemas/{schema}") });
    let errors = validate(reference.clone(), &instance);
    assert!(errors.is_empty(), "{schema}:\n{}", errors.join("\n"));
    let minimal = required_only(schema, &instance);
    let errors = validate(reference, &minimal);
    assert!(
        errors.is_empty(),
        "{schema}, required only:\n{}",
        errors.join("\n")
    );
    let full = serde_json::from_value::<T>(instance).unwrap_or_else(|e| panic!("{schema}: {e}"));
    let min = serde_json::from_value::<T>(minimal)
        .unwrap_or_else(|e| panic!("{schema}, required only: {e}"));
    (full, min)
}

#[test]
fn the_edit_forms_event_tiers_seating_and_availability() {
    use admin_rust_core::forms::event::{Availability, EventLoad, EventSeating, Tier};
    let (event, _) = check_hand_written::<EventLoad>("Event", example("Event"));
    assert_eq!(event.name, example("Event")["name"].as_str().unwrap());
    // Spec 041: an event in a Season names it.
    let mut in_season = example("Event");
    in_season["season"] = json!({ "id": "c0000000-0000-4000-8000-00000000000c", "name": "Hoops" });
    let (event, _) = check_hand_written::<EventLoad>("Event", in_season);
    assert_eq!(event.season.map(|s| s.name).as_deref(), Some("Hoops"));

    let tier = json!({
        "id": "0b8f5a0e-6a43-4c3a-9a55-0e1f4e0c2d11",
        "eventId": "5f1b8d2e-1c7a-4f0e-8a5b-2b6f0c1d9e33",
        "name": "Floor",
        "price": "40.00",
        "quantity": 20,
        "createdAt": "2026-11-15T12:00:00Z",
        "updatedAt": "2026-11-15T12:00:00Z"
    });
    let (tier, _) = check_hand_written::<Tier>("TicketTier", tier);
    assert_eq!((tier.name.as_str(), tier.quantity), ("Floor", 20));

    let seating = json!({
        "eventId": "5f1b8d2e-1c7a-4f0e-8a5b-2b6f0c1d9e33",
        "layoutId": "7a2c9d4e-3b1f-4e6a-9c8d-1e2f3a4b5c66",
        "levels": [{
            "levelId": "1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6",
            "name": "Floor", "rank": 1, "color": "violet",
            "seatCount": 15, "seatsOnSale": 10, "price": "50.00"
        }],
        "offSale": [{ "sectionId": "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", "row": 1 }],
        "seatsOnSale": 10,
        "seatsOffSale": 5
    });
    let (seating, _) = check_hand_written::<EventSeating>("EventSeating", seating);
    assert_eq!((seating.seats_on_sale, seating.off_sale.len()), (10, 1));

    let availability = json!({
        "eventId": "5f1b8d2e-1c7a-4f0e-8a5b-2b6f0c1d9e33",
        "customerLimit": null,
        "ticketsLeft": 8,
        "salesClosed": null,
        "inProgress": false,
        "tiers": [{ "tierId": "0b8f5a0e-6a43-4c3a-9a55-0e1f4e0c2d11", "ticketsLeft": 8 }]
    });
    let (availability, _) = check_hand_written::<Availability>("Availability", availability);
    assert_eq!(availability.tiers[0].tickets_left, 8);
}

#[test]
fn the_venue_map_and_a_section() {
    use admin_rust_core::seating::map_state::{VenueMap, VenueMapSection};
    check_hand_written::<VenueMap>("VenueMap", example("VenueMap"));
    check_hand_written::<VenueMapSection>("VenueMapSection", example("VenueMapSection"));
}
