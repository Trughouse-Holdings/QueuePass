//! Spec 037 research R14 (T074): the save bar's rules, ported from
//! `admin-app/src/layout-editor/SaveBar.tsx` (`missingParts`, `sectionIndexOf`, `asApiError`,
//! the warnings before a save, the refusal and what it selects, Save as a new layout, Reload;
//! 039 FR-019, FR-020, FR-023, FR-024, research R9, R15, R16; parity LE67–LE79). The app keeps
//! the bar's status (idle, saving, saved, missing, warnings, refused) and calls these.

use std::collections::BTreeSet;

use serde_json::Value;

use super::doc::{EditorDoc, to_input};
use super::js;
use super::overlap::warnings_of;
use crate::api::client::ApiError;
use crate::seating::map_geometry::js_number;

/// `RELOAD` (R9): the question before Reload throws the changes away.
pub const RELOAD: &str = "Reload the layout? Your changes will be lost.";
/// The read-back block's text (LE71), beside a disabled Save with Reload.
pub const UNREAD: &str =
    "Saved, but the layout could not be read back. Reload it before saving again.";
/// `asApiError`'s message for a failure with no answer (LE76).
pub const CANT_REACH: &str = "Can't reach the QueuePass service.";
/// The heading of the missing-parts alert (LE68).
pub const CANT_SAVE_YET: &str = "The layout can't be saved yet";
/// The heading and name of the warnings group (LE69).
pub const BEFORE_SAVING: &str = "Before saving";
/// The heading of a refusal (LE76).
pub const COULD_NOT_SAVE: &str = "Could not save the layout";

/// `OFFER_COPY` (R9): the refusals after which the work can still be kept as a new layout.
const OFFER_COPY: [&str; 2] = ["LAYOUT_CHANGED", "LAYOUT_IN_USE"];

/// `sectionIndexOf` (R16): the section a problem's path points at (`sections[3].rows[1]…` → 3),
/// or none.
pub fn section_index_of(path: &str) -> Option<usize> {
    let rest = path.strip_prefix("sections[")?;
    let end = rest.find(']')?;
    let digits = &rest[..end];
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// `missingParts` (LE68): what stops a save before it is sent.
pub fn missing_parts(doc: &EditorDoc) -> Vec<&'static str> {
    let mut missing = Vec::new();
    if js::trim(&doc.name).is_empty() {
        missing.push("Name the layout");
    }
    if doc.sections.is_empty() {
        missing.push("Add at least one section");
    }
    missing
}

/// What pressing Save (or Save anyway) leads to, before anything is sent (`save`'s first half).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SaveCheck {
    /// The alert "The layout can't be saved yet" with these parts; nothing sent.
    Missing(Vec<&'static str>),
    /// The group "Before saving" with these warnings, Save anyway and Go back; the sections are
    /// outlined on the map.
    Warnings {
        messages: Vec<String>,
        sections: BTreeSet<String>,
    },
    /// Send it. `warned` is the new set of outlined sections (empty clears them), or `None` to
    /// leave them (Save anyway).
    Send { warned: Option<BTreeSet<String>> },
}

/// The checks before a save (LE68, LE69): missing parts, then (unless `anyway`) the warnings.
pub fn before_save(doc: &EditorDoc, anyway: bool) -> SaveCheck {
    let parts = missing_parts(doc);
    if !parts.is_empty() {
        return SaveCheck::Missing(parts);
    }
    if anyway {
        return SaveCheck::Send { warned: None };
    }
    let w = warnings_of(doc);
    if w.messages.is_empty() {
        SaveCheck::Send {
            warned: Some(w.sections),
        }
    } else {
        SaveCheck::Warnings {
            messages: w.messages,
            sections: w.sections,
        }
    }
}

/// `Problem`: a refusal's problem: where in the body, and what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    pub path: String,
    pub message: String,
}

/// A refused save as the bar shows it (`asApiError` and `Refusal`, LE76).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    /// The alert's `data-code`.
    pub code: String,
    pub message: String,
    /// `details.problems` of a `LAYOUT_FILE_INVALID` refusal, else none.
    pub problems: Vec<Problem>,
    /// `details.more` (as JavaScript writes it), or `None` when it is absent or 0.
    pub more: Option<String>,
}

impl Refusal {
    /// `asApiError`: a refusal as the Backend sent it; a failure with no answer (or one that
    /// isn't the Backend's) as `VALIDATION_FAILED` "Can't reach the QueuePass service.".
    pub fn from_error(error: &ApiError) -> Refusal {
        let ApiError::Status(e) = error else {
            return Refusal {
                code: "VALIDATION_FAILED".into(),
                message: CANT_REACH.into(),
                problems: Vec::new(),
                more: None,
            };
        };
        let details = e.details.as_ref();
        let problems = if e.code == "LAYOUT_FILE_INVALID" {
            details
                .and_then(|d| d.get("problems"))
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .map(|p| Problem {
                            path: p["path"].as_str().unwrap_or_default().to_string(),
                            message: p["message"].as_str().unwrap_or_default().to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let more = details
            .and_then(|d| d.get("more"))
            .and_then(Value::as_f64)
            .filter(|n| *n > 0.0)
            .map(js_number);
        Refusal {
            code: e.code.clone(),
            message: e.message.clone(),
            problems,
            more,
        }
    }

    /// "and <more> more", the problem list's last item when `details.more` > 0 and there are
    /// problems to list.
    pub fn more_text(&self) -> Option<String> {
        if self.problems.is_empty() {
            return None;
        }
        self.more.as_ref().map(|m| format!("and {m} more"))
    }

    /// Whether Save as a new layout is offered (LE78: `LAYOUT_CHANGED`, `LAYOUT_IN_USE`).
    pub fn offers_copy(&self) -> bool {
        OFFER_COPY.contains(&self.code.as_str())
    }

    /// Whether Reload is offered beside it (LE79: `LAYOUT_CHANGED` only).
    pub fn offers_reload(&self) -> bool {
        self.code == "LAYOUT_CHANGED"
    }
}

/// What a refusal does besides showing (LE77).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RefusalEffects {
    /// The message to show beside Layout name, if any.
    pub name_problem: Option<String>,
    /// The index of the section to select, if any.
    pub select_section: Option<usize>,
}

/// `save`'s refusal handling (LE77): `LAYOUT_NAME_TAKEN` goes beside the name box; the section
/// of the first problem whose path starts `sections[i]` is selected; a problem at `name` goes
/// beside the name box too.
pub fn refusal_effects(refusal: &Refusal) -> RefusalEffects {
    let mut name_problem = (refusal.code == "LAYOUT_NAME_TAKEN").then(|| refusal.message.clone());
    let select_section = refusal
        .problems
        .iter()
        .find_map(|p| section_index_of(&p.path));
    if let Some(named) = refusal.problems.iter().find(|p| p.path == "name") {
        name_problem = Some(named.message.clone());
    }
    RefusalEffects {
        name_problem,
        select_section,
    }
}

/// "Name of the new layout"'s first value (LE78): "<trimmed name> (copy)".
pub fn copy_name(doc: &EditorDoc) -> String {
    format!("{} (copy)", js::trim(&doc.name))
}

/// Save as a new layout's body (`saveAsNew`, LE78): every part sent as new, no revision, under
/// the name typed in "Name of the new layout", trimmed.
pub fn save_as_new_input(doc: &EditorDoc, name: &str) -> Value {
    let mut body = to_input(doc, None, true);
    body["name"] = Value::String(js::trim(name).to_string());
    body
}
