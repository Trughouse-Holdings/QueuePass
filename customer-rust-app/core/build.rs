// Copied from admin-rust-app/core/build.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R5 (tasks T021): the API types are generated from the contract on every
//! build, so they cannot drift from it. Every `components.schemas` entry is added to one typify
//! `TypeSpace` by name, so the contract's `$ref: '#/components/schemas/X'` resolve as they are.

use std::{collections::BTreeMap, env, fs, path::PathBuf};

use typify::{TypeSpace, TypeSpaceSettings};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let contract = manifest.join("../../contracts/openapi.yaml");
    println!("cargo:rerun-if-changed={}", contract.display());

    let text = fs::read_to_string(&contract).expect("read contracts/openapi.yaml");
    let doc: serde_json::Value = serde_yaml::from_str(&text).expect("parse contracts/openapi.yaml");
    let schemas = doc["components"]["schemas"]
        .as_object()
        .expect("components.schemas")
        .clone();

    let mut defs = BTreeMap::new();
    for (name, schema) in schemas {
        let schema: schemars::schema::Schema = serde_json::from_value(normalize(schema))
            .unwrap_or_else(|e| panic!("schema {name}: {e}"));
        defs.insert(name, schema);
    }

    let mut settings = TypeSpaceSettings::default();
    settings.with_struct_builder(false);
    let mut space = TypeSpace::new(&settings);
    space
        .add_ref_types(defs)
        .expect("typify: add the contract's schemas");

    let file = syn::parse2::<syn::File>(space.to_stream()).expect("typify output parses");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("api_types.rs");
    fs::write(out, prettyplease::unparse(&file)).expect("write api_types.rs");
}

/// OpenAPI 3.1 is JSON Schema 2020-12; schemars reads draft 7. The only forms the contract uses
/// that draft 7 lacks are rewritten here: `prefixItems` (2020-12's tuple form) becomes `items`
/// as a list. Everything else passes through.
fn normalize(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, v) in map {
                let v = normalize(v);
                if key == "prefixItems" {
                    out.insert("items".into(), v);
                } else if key.starts_with("x-") {
                    // Contract annotations (x-planned, x-retired, …) carry no type information.
                } else {
                    out.insert(key, v);
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(normalize).collect()),
        other => other,
    }
}
