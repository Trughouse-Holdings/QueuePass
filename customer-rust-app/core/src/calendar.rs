//! Spec 040 T054 (parity T5–T7; research R10; spec 019): Add to calendar, ported from
//! `customer-app/src/calendar.ts`: the iCalendar text (escaped, folded at 75 UTF-8 octets, CRLF),
//! the file name, the Google Calendar link, and who is offered it. Checked byte for byte against
//! the TypeScript's own outputs (`tests/fixtures/customer/calendar.json`, written by
//! `scripts/customer-parity-fixtures.mjs`).

use std::sync::LazyLock;

use chrono::{DateTime, Datelike, Timelike, Utc};
use regress::Regex;
use unicode_normalization::UnicodeNormalization;

use crate::api::types::{MyOrder, OrderEvent, OrderEventStatus, TicketStatus};
use crate::time::{instant_from_ms, parse_instant, to_iso_string};

/// Research R12: the calendar file's media type.
pub const ICS_TYPE: &str = "text/calendar;charset=utf-8";

/// Spec 019 FR-003: the snapshot note, both controls' description.
pub const CALENDAR_NOTE: &str = "A copy for your calendar: it won't change if the event does.";

const CRLF: &str = "\r\n";
const GOOGLE_TEMPLATE: &str = "https://calendar.google.com/calendar/render?action=TEMPLATE";

/// Ports `CalendarEntry`: what is added for one event (FR-004, FR-007).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEntry {
    /// `queuepass-event-<event id>`.
    pub uid: String,
    pub title: String,
    /// The API's instants, as text.
    pub starts_at: String,
    pub ends_at: String,
    pub location_name: String,
    pub location_address: String,
}

/// Ports `calendarEntry`.
pub fn calendar_entry(event: &OrderEvent) -> CalendarEntry {
    CalendarEntry {
        uid: format!("queuepass-event-{}", event.id),
        title: event.name.clone(),
        starts_at: to_iso_string(event.starts_at),
        ends_at: to_iso_string(event.ends_at),
        location_name: event.location.name.clone(),
        location_address: event.location.address.as_str().to_owned(),
    }
}

/// Research R14: an entry whose end is not after its start (the TypeScript throws).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EndNotAfterStart(pub String);

/// `utc`: `YYYYMMDDTHHMMSSZ` from the UTC parts, milliseconds dropped.
fn utc(d: DateTime<Utc>) -> String {
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        d.year(),
        d.month(),
        d.day(),
        d.hour(),
        d.minute(),
        d.second()
    )
}

/// `times`: both instants in UTC form, or the error when the end is not after the start (an
/// unreadable time compares false, as `NaN` does).
fn times(entry: &CalendarEntry) -> Result<(String, String), EndNotAfterStart> {
    match (
        parse_instant(&entry.starts_at),
        parse_instant(&entry.ends_at),
    ) {
        (Some(s), Some(e)) if e > s => Ok((utc(s), utc(e))),
        _ => Err(EndNotAfterStart(format!(
            "calendar entry {}: the end is not after the start",
            entry.uid
        ))),
    }
}

/// `escapeText` (R6): backslash first, then `;` and `,`, line breaks as `\n`, and every other
/// control character but tab removed.
fn escape_text(s: &str) -> String {
    let s = s
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace(['\n', '\r'], "\\n");
    s.chars()
        .filter(|&c| !(matches!(c, '\u{0}'..='\u{8}' | '\u{a}'..='\u{1f}' | '\u{7f}')))
        .collect()
}

/// `fold` (R7): at 75 octets of UTF-8, never inside a character; continuation lines start with
/// one space.
fn fold(line: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut size = 0;
    for ch in line.chars() {
        let n = ch.len_utf8();
        if size + n > 75 {
            out.push(std::mem::take(&mut current));
            current.push(' ');
            size = 1;
        }
        current.push(ch);
        size += n;
    }
    out.push(current);
    out.join(CRLF)
}

/// Ports `icsFile` (R3): the whole file, every line ending in CRLF. `now_ms` is when it is made
/// (`DTSTAMP`).
pub fn ics_file(entry: &CalendarEntry, now_ms: i64) -> Result<String, EndNotAfterStart> {
    let (start, end) = times(entry)?;
    let stamp = instant_from_ms(now_ms).map(utc).unwrap_or_default();
    let lines = [
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".into(),
        "PRODID:-//QueuePass//Customer app//EN".into(),
        "CALSCALE:GREGORIAN".into(),
        "METHOD:PUBLISH".into(),
        "BEGIN:VEVENT".into(),
        format!("UID:{}", entry.uid),
        format!("DTSTAMP:{stamp}"),
        format!("DTSTART:{start}"),
        format!("DTEND:{end}"),
        format!("SUMMARY:{}", escape_text(&entry.title)),
        format!(
            "LOCATION:{}\\, {}",
            escape_text(&entry.location_name),
            escape_text(&entry.location_address)
        ),
        "END:VEVENT".into(),
        "END:VCALENDAR".into(),
    ];
    Ok(lines.iter().map(|l| fold(l) + CRLF).collect())
}

/// Ports `googleCalendarUrl` (R8, FR-011): the template page with `text`, `dates`, and
/// `location`, encoded as `URLSearchParams` does.
pub fn google_calendar_url(entry: &CalendarEntry) -> Result<String, EndNotAfterStart> {
    let (start, end) = times(entry)?;
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("text", &entry.title)
        .append_pair("dates", &format!("{start}/{end}"))
        .append_pair(
            "location",
            &format!("{}, {}", entry.location_name, entry.location_address),
        )
        .finish();
    Ok(format!("{GOOGLE_TEMPLATE}&{query}"))
}

/// `/\p{M}/gu`: a mark of any script.
static MARK: LazyLock<Regex> =
    LazyLock::new(|| Regex::with_flags(r"\p{M}", "u").expect("a valid pattern"));

/// Ports `icsFileName` (R12, FR-009): NFKD, marks dropped, lower case, runs outside `[a-z0-9]` one
/// `-`, trimmed of `-`, cut to 60, trimmed of a trailing `-` again, `.ics`; `event.ics` if empty.
pub fn ics_file_name(name: &str) -> String {
    let decomposed: String = name.nfkd().collect();
    let mut unmarked = String::with_capacity(decomposed.len());
    let mut last = 0;
    for m in MARK.find_iter(&decomposed) {
        unmarked.push_str(&decomposed[last..m.range().start]);
        last = m.range().end;
    }
    unmarked.push_str(&decomposed[last..]);
    let lower = unmarked.to_lowercase();
    let mut slug = String::new();
    let mut in_run = false;
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            slug.push(c);
            in_run = false;
        } else if !in_run {
            slug.push('-');
            in_run = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    let cut: String = trimmed.chars().take(60).collect();
    let cut = cut.trim_end_matches('-');
    format!("{}.ics", if cut.is_empty() { "event" } else { cut })
}

/// `calendarEligible` over its parts (R10, FR-002): not cancelled, both times readable with the
/// end after the start, `now_ms` before the end (exclusive), and a valid ticket, used or not.
pub fn eligible(
    cancelled: bool,
    starts_at: &str,
    ends_at: &str,
    any_valid: bool,
    now_ms: i64,
) -> bool {
    let (Some(start), Some(end)) = (parse_instant(starts_at), parse_instant(ends_at)) else {
        return false;
    };
    !cancelled && end > start && now_ms < end.timestamp_millis() && any_valid
}

/// Ports `calendarEligible`: whether an order card offers Add to calendar; `now_ms` is when My
/// tickets loaded.
pub fn calendar_eligible(order: &MyOrder, now_ms: i64) -> bool {
    eligible(
        order.event.status == OrderEventStatus::Cancelled,
        &to_iso_string(order.event.starts_at),
        &to_iso_string(order.event.ends_at),
        order
            .tickets
            .iter()
            .any(|t| t.status == TicketStatus::Valid),
        now_ms,
    )
}
