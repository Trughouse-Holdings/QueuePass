//! Spec 037 research R6 (task T069): the admin's own device time zone, as `deviceZone()` in
//! `admin-app/src/export/made.ts` reads it, for each download's made-at time and file name and
//! for times that belong to no event. `core` takes it as a zone name, so it stays testable
//! natively.

use js_sys::{Array, Intl::DateTimeFormat, Object, Reflect};
use wasm_bindgen::JsValue;

/// `Intl.DateTimeFormat().resolvedOptions().timeZone`, an IANA name such as
/// `America/Los_Angeles`; UTC in the unlikely case the browser gives none.
pub fn device_zone() -> String {
    let options = DateTimeFormat::new(&Array::new(), &Object::new()).resolved_options();
    Reflect::get(&options, &JsValue::from_str("timeZone"))
        .ok()
        .and_then(|zone| zone.as_string())
        .filter(|zone| !zone.is_empty())
        .unwrap_or_else(|| "UTC".to_string())
}
