//! Spec 037 T042 (parity M1–M5, M7): the venue page's Layouts card, ported from
//! `admin-app/src/components/LayoutsCard.tsx`: the summary line (`count`), the import's checks
//! before sending and its problem list (`ImportProblems`), `asApiError`, the bodies of Rename and
//! Duplicate, the editor links, and the venue's capacity from its largest layout. The lines form
//! is [`super::section_lines::LinesDraft`]; refusals beside an action use
//! [`super::venue::refusal_banner`] with [`change_title`] or [`SAVE_LAYOUT_TITLE`].

use serde_json::{Value, json};

use super::section_lines::{js_trim, to_locale_string};
use crate::api::client::{ApiError, StatusError};
use crate::api::types::LayoutSummary;

/// `LAYOUT_LIMITS.maxImportBytes` (`packages/shared/src/seating.ts`): 4 MB.
pub const MAX_IMPORT_BYTES: u64 = 4 * 1024 * 1024;
/// `LAYOUT_LIMITS.nameMaxLength`: the Layout name and rename boxes' `maxLength`.
pub const NAME_MAX_LENGTH: usize = 50;

/// The card's states (M1).
pub const LOADING: &str = "Loading layouts…";
pub const UNAVAILABLE: &str = "The layouts are unavailable right now.";
pub const NO_LAYOUTS: &str = "No layouts yet.";
pub const LOADING_PREVIEW: &str = "Loading the preview…";
/// A locked layout's note; no event is named.
pub const LOCKED_NOTE: &str = "Locked: seats are sold or held";
/// The Layout file input's hint (M2).
pub const IMPORT_HINT: &str =
    "A layout file (JSON, format 1) of up to 4 MB: its sections, rows, seats and price levels.";
/// The import problems banner's title.
pub const IMPORT_TITLE: &str = "Could not import the layout";
/// The lines form's refusal title.
pub const SAVE_LAYOUT_TITLE: &str = "Could not save the layout";
/// `asApiError`'s message for a call nothing answered.
pub const UNREACHABLE: &str = "Can't reach the QueuePass service.";

/// `count` (`LayoutsCard.tsx`): `${n.toLocaleString()} ${n === 1 ? one : many}`, `many` being
/// `${one}s` unless given.
pub fn count_text(n: f64, one: &str, many: Option<&str>) -> String {
    let word = if n == 1.0 {
        one.to_string()
    } else {
        many.map_or_else(|| format!("{one}s"), str::to_string)
    };
    format!("{} {word}", to_locale_string(n))
}

/// A layout's line (M1): "22,090 seats · 54 sections · 4 price levels · used by 2 events".
pub fn summary_line(l: &LayoutSummary) -> String {
    format!(
        "{} · {} · {} · used by {}",
        count_text(l.seat_count.get() as f64, "seat", None),
        count_text(l.section_count.get() as f64, "section", None),
        count_text(l.level_count.get() as f64, "price level", None),
        count_text(l.events_using as f64, "event", None),
    )
}

/// The venue's capacity from its layouts (M7, spec 038 FR-009): the largest seat count, or
/// `None` without layouts.
pub fn largest_capacity(layouts: &[LayoutSummary]) -> Option<u64> {
    layouts.iter().map(|l| l.seat_count.get()).max()
}

/// "From the largest layout (22,090 seats)": always "seats", as in the React app.
pub fn capacity_note(largest: u64) -> String {
    format!(
        "From the largest layout ({} seats)",
        to_locale_string(largest as f64)
    )
}

/// `ImportError` (`LayoutsCard.tsx`): a refusal of the import, or a file that could not be read
/// as one.
#[derive(Clone, Debug, PartialEq)]
pub enum ImportError {
    Api(ApiError),
    Local(String),
}

/// The size check before reading (M2): over 4,194,304 bytes is refused, naming the file.
pub fn check_import_size(file_name: &str, size: u64) -> Result<(), ImportError> {
    if size > MAX_IMPORT_BYTES {
        Err(ImportError::Local(format!(
            "{file_name} is larger than 4 MB."
        )))
    } else {
        Ok(())
    }
}

/// The file's text as `JSON.parse(await file.text())` reads it, as the `LayoutImport` body
/// `{ file }`; text that is not JSON is refused, naming the file. `File.text()` decodes UTF-8
/// (a bad byte as U+FFFD) and drops a byte order mark.
pub fn parse_import(file_name: &str, bytes: &[u8]) -> Result<Value, ImportError> {
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    serde_json::from_str::<Value>(text)
        .map(import_body)
        .map_err(|_| {
            ImportError::Local(format!("{file_name} is not a layout file: it is not JSON."))
        })
}

/// `importVenueLayout(venue.id, { file: parsed })`'s body.
pub fn import_body(parsed: Value) -> Value {
    json!({ "file": parsed })
}

/// What `ImportProblems` shows under the file input (`role=alert`, `banner banner--error`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportProblems {
    /// "Could not import the layout".
    pub title: &'static str,
    pub message: String,
    /// `LAYOUT_FILE_INVALID`: "{message} ({path})" each, then "and {more} more" when more > 0.
    pub problems: Vec<String>,
    /// `VALIDATION_FAILED`: each of `details.fields`.
    pub fields: Vec<String>,
}

/// A value as a template literal writes it: a string as it is, a missing one as "undefined".
fn template(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

/// `ImportProblems` (`LayoutsCard.tsx`, 038 R5): the import's problems, each with its place in
/// the file.
pub fn import_problems(error: &ImportError) -> ImportProblems {
    let error = match error {
        ImportError::Local(message) => {
            return ImportProblems {
                title: IMPORT_TITLE,
                message: message.clone(),
                problems: Vec::new(),
                fields: Vec::new(),
            };
        }
        ImportError::Api(e) => e,
    };
    let details = error.details();
    let mut problems: Vec<String> = Vec::new();
    if error.code() == Some("LAYOUT_FILE_INVALID") {
        let listed = details
            .and_then(|d| d.get("problems"))
            .and_then(Value::as_array);
        for p in listed.into_iter().flatten() {
            problems.push(format!(
                "{} ({})",
                template(p.get("message")),
                template(p.get("path"))
            ));
        }
        let more = details
            .and_then(|d| d.get("more"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if !problems.is_empty() && more > 0.0 {
            problems.push(format!(
                "and {} more",
                template(details.and_then(|d| d.get("more")))
            ));
        }
    }
    let fields = if error.code() == Some("VALIDATION_FAILED") {
        error.fields()
    } else {
        Vec::new()
    };
    ImportProblems {
        title: IMPORT_TITLE,
        message: error.message().into(),
        problems,
        fields,
    }
}

/// `asApiError` (`LayoutsCard.tsx`): a refusal stays as it is; no answer (or one that could not be
/// read) becomes status 0 `VALIDATION_FAILED` "Can't reach the QueuePass service.".
pub fn as_api_error(error: ApiError) -> ApiError {
    match error {
        ApiError::Status(_) => error,
        ApiError::Unreachable | ApiError::Decode(_) => ApiError::Status(StatusError {
            status: 0,
            code: "VALIDATION_FAILED".into(),
            message: UNREACHABLE.into(),
            details: None,
            enveloped: true,
        }),
    }
}

/// The lines form's `aria-label` (M3): "New layout from section lines", or "Section lines of
/// {name}" when editing one.
pub fn lines_form_label(editing: Option<&str>) -> String {
    match editing {
        None => "New layout from section lines".into(),
        Some(name) => format!("Section lines of {name}"),
    }
}

/// "Edit section lines" is offered (M3): a `LINES` layout whose detail loaded.
pub fn takes_lines(l: &LayoutSummary, detail_loaded: bool) -> bool {
    l.source.to_string() == "LINES" && detail_loaded
}

/// Rename's body (M4), `PUT /layouts/{id}` `LayoutUpdate`: `{ name: to.trim() }`.
pub fn rename_body(to: &str) -> Value {
    json!({ "name": js_trim(to) })
}

/// Duplicate's body (M4), `POST /layouts/{id}/duplicate` `LayoutDuplicate`: `{}`.
pub fn duplicate_body() -> Value {
    json!({})
}

/// Delete's confirm (M4).
pub fn delete_confirm(name: &str) -> String {
    format!("Delete the layout \"{name}\"? This can't be undone.")
}

/// A refusal's title inside a layout (M4).
pub fn change_title(name: &str) -> String {
    format!("Could not change {name}")
}

/// "New layout" (M5) → the layout editor on a new layout.
pub fn new_layout_href(location_id: &str) -> String {
    format!("/locations/{location_id}/layouts/new")
}

/// A layout's link into the editor (M5): "Edit" or, when locked, "View".
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditorLink {
    pub text: &'static str,
    /// `aria-label`: "Edit {name}" / "View {name}".
    pub label: String,
    pub href: String,
}

/// The editor link of a layout of any source (M5, LE2).
pub fn editor_link(l: &LayoutSummary) -> EditorLink {
    let text = if l.locked { "View" } else { "Edit" };
    EditorLink {
        text,
        label: format!("{text} {}", l.name.as_str()),
        href: format!("/locations/{}/layouts/{}/edit", l.location_id, l.id),
    }
}
