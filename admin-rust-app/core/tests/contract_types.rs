//! Spec 037 research R5, Principle I (tasks T022): the API types are generated from the contract
//! by `core/build.rs`, so they cannot drift from it. This checks one example per resource: each
//! is valid against its `components.schemas` entry (formats included), and decodes into the
//! generated type. The examples are the React Admin app's own test fixtures
//! (`tests/fixtures/api/generate.mts`). No type is hand-written (T021: typify built all 84
//! schemas), so there is no hand-written type to check here.

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
