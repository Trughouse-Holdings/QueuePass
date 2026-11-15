//! Spec 037 T040, T042: checks a request body against `contracts/openapi.yaml`'s
//! `components.schemas.<name>`, with the contract's `components` attached so its `$ref`s resolve.
//! Included by `venue_form.rs` and `layouts_card.rs` with `#[path]`.

use std::sync::LazyLock;

use serde_json::{Value, json};

static COMPONENTS: LazyLock<Value> = LazyLock::new(|| {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../contracts/openapi.yaml");
    let text = std::fs::read_to_string(path).expect("read contracts/openapi.yaml");
    let doc: Value = serde_yaml::from_str(&text).expect("parse contracts/openapi.yaml");
    doc["components"].clone()
});

/// The problems `body` has against schema `name`; empty when it is valid.
pub fn problems(name: &str, body: &Value) -> Vec<String> {
    assert!(
        COMPONENTS["schemas"].get(name).is_some(),
        "no schema {name} in the contract"
    );
    let schema = json!({
        "$ref": format!("#/components/schemas/{name}"),
        "components": COMPONENTS.clone(),
    });
    let validator = jsonschema::validator_for(&schema).expect("the contract's schema compiles");
    validator
        .iter_errors(body)
        .map(|e| format!("{} at {}", e, e.instance_path()))
        .collect()
}

/// Panics unless `body` is valid against schema `name`.
#[track_caller]
pub fn assert_valid(name: &str, body: &Value) {
    let found = problems(name, body);
    assert!(found.is_empty(), "{name} refuses {body}: {found:?}");
}
