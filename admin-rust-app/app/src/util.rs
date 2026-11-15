//! Small helpers the views share.

use serde::Serialize;

/// A generated enum's value as the API spells it (`"CANCELLED"`, `"America/New_York"`).
pub fn enum_text<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// `new URLSearchParams(pairs).toString()`: form encoding, spaces as `+`.
pub fn search_params(pairs: &[(&str, String)]) -> String {
    let mut s = openidconnect::url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        s.append_pair(k, v);
    }
    s.finish()
}

/// `path` with `?query` when there is a query.
pub fn with_query(path: &str, query: &str) -> String {
    if query.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{query}")
    }
}

/// Milliseconds since the epoch, from the browser's clock.
pub fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}
