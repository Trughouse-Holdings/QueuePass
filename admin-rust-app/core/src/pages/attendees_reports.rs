//! Spec 037 (tasks T070, T071; parity A1, R1): the small figures the Attendees and Reports pages
//! show (`admin-app/src/pages/Attendees.tsx`, `Reports.tsx`), as plain functions so the app
//! crate's views only lay them out.

use serde::{Serialize, de::DeserializeOwned};

/// A generated API value (`api::types`) read into the export module's own input struct
/// (`export::rows`), through its JSON; `None` if it does not fit.
pub fn export_input<T: DeserializeOwned>(value: &impl Serialize) -> Option<T> {
    serde_json::from_value(serde_json::to_value(value).ok()?).ok()
}

/// `n.toLocaleString()` in an en-US browser for a count: "12,345".
pub fn count(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// `share` (`Reports.tsx`): `part` as a whole percent of `whole`, `Math.round`ed (a half rounds
/// up); 0 when `whole` is 0.
pub fn share(part: u64, whole: u64) -> u64 {
    if whole == 0 {
        return 0;
    }
    let percent = part as f64 / whole as f64 * 100.0;
    (percent + 0.5).floor() as u64
}

/// The meter's fill (`Meter` in `Reports.tsx`): its inline style, `width: N%` capped at 100, or
/// `None` at zero, where even a sliver would read as "some sold".
pub fn meter_fill_style(value: u64) -> Option<String> {
    (value > 0).then(|| format!("width: {}%;", value.min(100)))
}

/// One or many (`Attendees.tsx`): "1 order", "2 orders".
fn counted(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// The Attendees head's sub line (parity A1): "{n} order(s) · {n} valid ticket(s) · {n} checked
/// in", the checked-in part left out while `checked_in` is not known (spec 032 FR-010).
pub fn attendee_summary(orders: usize, valid_tickets: usize, checked_in: Option<u64>) -> String {
    let mut parts = vec![
        counted(orders, "order", "orders"),
        counted(valid_tickets, "valid ticket", "valid tickets"),
    ];
    if let Some(n) = checked_in {
        parts.push(format!("{n} checked in"));
    }
    parts.join(" · ")
}

/// The Price level cell (spec 038 FR-030): an order's distinct level names, first seen first,
/// joined ", ".
pub fn order_levels<'a>(levels: impl IntoIterator<Item = Option<&'a str>>) -> String {
    let mut seen: Vec<&str> = Vec::new();
    for level in levels.into_iter().flatten() {
        if !seen.contains(&level) {
            seen.push(level);
        }
    }
    seen.join(", ")
}

/// The Tier cell: the tier's name, or for no tier "General admission", or nothing when a ticket
/// has a seat or a level (a seat is never general admission, spec 038 FR-030).
pub fn tier_cell(tier_name: Option<&str>, seated: bool) -> String {
    match tier_name {
        Some(name) => name.to_string(),
        None if seated => String::new(),
        None => "General admission".to_string(),
    }
}

/// The Check-in cell: "n of m checked in", or "—" once the event's check-in details are removed
/// (spec 032 FR-010).
pub fn check_in_cell(removed: bool, checked: usize, tickets: usize) -> String {
    if removed {
        "—".to_string()
    } else {
        format!("{checked} of {tickets} checked in")
    }
}

/// The Sold cell's figure (parity R1): "1,200 of 5,000 (24%)".
pub fn sold_cell(sold: u64, capacity: u64) -> String {
    format!(
        "{} of {} ({}%)",
        count(sold),
        count(capacity),
        share(sold, capacity)
    )
}
