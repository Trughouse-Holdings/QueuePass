//! Spec 037 research R7 (task T069), port of `admin-app/src/export/save.ts`: the browser saves
//! the file through a `Blob` and a temporary link with `download`, as spec 019's calendar file
//! does; nothing is stored on the server.

use js_sys::{Array, Uint8Array};
use wasm_bindgen::{JsCast, JsValue, closure::Closure};
use web_sys::{Blob, BlobPropertyBag, HtmlAnchorElement, Url};

/// Research R12 of spec 019: an immediate revoke can cancel the download in Safari and Firefox.
const REVOKE_AFTER_MS: i32 = 60_000;

/// Saves `bytes` as a file called `name` of media type `media_type`.
pub fn save(bytes: &[u8], name: &str, media_type: &str) -> Result<(), JsValue> {
    let parts = Array::of1(&Uint8Array::from(bytes));
    let options = BlobPropertyBag::new();
    options.set_type(media_type);
    let blob = Blob::new_with_u8_array_sequence_and_options(&parts, &options)?;
    let url = Url::create_object_url_with_blob(&blob)?;

    let window = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
    let document = window
        .document()
        .ok_or_else(|| JsValue::from_str("no document"))?;
    let body = document
        .body()
        .ok_or_else(|| JsValue::from_str("no body"))?;
    let a: HtmlAnchorElement = document.create_element("a")?.dyn_into()?;
    a.set_href(&url);
    a.set_download(name);
    body.append_child(&a)?;
    a.click();
    a.remove();

    let revoke = Closure::once_into_js(move || {
        let _ = Url::revoke_object_url(&url);
    });
    window.set_timeout_with_callback_and_timeout_and_arguments_0(
        revoke.unchecked_ref(),
        REVOKE_AFTER_MS,
    )?;
    Ok(())
}
