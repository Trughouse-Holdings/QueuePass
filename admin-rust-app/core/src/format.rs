//! Spec 037 (research R6): ports `admin-app/src/format.ts`, how the Admin pages show an event's
//! times, a seat, and a venue's zone. Times come in as the API's ISO strings, as in the
//! TypeScript; a response without a zone is read as [`DEFAULT_TIME_ZONE`].
//!
//! Where the TypeScript passes a string `Date` cannot read to `Intl` (which throws "Invalid time
//! value"), these show `Invalid Date`, `String(new Date('x'))`.

use crate::time::{
    CHECK_IN_RETENTION_DAYS, DEFAULT_TIME_ZONE, format_event_date, format_event_end,
    format_event_time, parse_instant, zone_name,
};

/// `timeZone || DEFAULT_TIME_ZONE`: a missing or empty zone is Eastern.
fn zone_or_default(time_zone: Option<&str>) -> &str {
    match time_zone {
        Some(zone) if !zone.is_empty() => zone,
        _ => DEFAULT_TIME_ZONE,
    }
}

const INVALID_DATE: &str = "Invalid Date";

/// Ports `when` (`format.ts`): an event time in its venue's zone, always with its date and the
/// zone's abbreviation, "Oct 1, 2026, 7:00 PM EDT" (002 FR-031; 020 FR-021).
pub fn when(iso: &str, time_zone: Option<&str>) -> String {
    parse_instant(iso).map_or(INVALID_DATE.into(), |at| {
        format_event_time(at, zone_or_default(time_zone))
    })
}

/// Ports `until` (`format.ts`): an event's end next to its start, the time, or the date and time
/// when the date differs.
pub fn until(start: &str, end: &str, time_zone: Option<&str>) -> String {
    match (parse_instant(start), parse_instant(end)) {
        (Some(s), Some(e)) => format_event_end(s, e, zone_or_default(time_zone)),
        _ => INVALID_DATE.into(),
    }
}

/// Ports `seatLabel` (`format.ts`): a seat by its labels as sold (007 FR-011, 038 FR-026),
/// "Section 115, Row F, Seat 7".
pub fn seat_label(section: &str, row_label: &str, seat_label: &str) -> String {
    format!("Section {section}, Row {row_label}, Seat {seat_label}")
}

/// Ports `SOURCE_TEXT` (`format.ts`): how a venue's zone was set, in words (020 R14), keyed by
/// the contract's `TimeZoneSource`.
pub const SOURCE_TEXT: [(&str, &str); 4] = [
    ("ADDRESS", "from the address"),
    ("STATE", "from the state"),
    ("ADMIN", "chosen by an admin"),
    ("DEFAULT", "the default"),
];

/// `SOURCE_TEXT[source]` (`format.ts`), or `None` for an unknown source.
pub fn source_text(source: &str) -> Option<&'static str> {
    SOURCE_TEXT
        .iter()
        .find(|(key, _)| *key == source)
        .map(|(_, text)| *text)
}

/// Ports `venueZone` (`format.ts`): "Eastern Time, from the address" (020 FR-024). As with the
/// TypeScript's `??`, only a missing zone or source takes the default; an unknown source reads
/// "undefined".
pub fn venue_zone(time_zone: Option<&str>, time_zone_source: Option<&str>) -> String {
    let source = source_text(time_zone_source.unwrap_or("DEFAULT")).unwrap_or("undefined");
    format!(
        "{}, {source}",
        zone_name(time_zone.unwrap_or(DEFAULT_TIME_ZONE))
    )
}

/// Ports `doorsOpen` (`format.ts`): an event's doors-open time next to its start, in its venue's
/// zone (025 FR-021): "5:30 PM EST" on the start's local date, "Nov 19, 2026, 11:30 PM EST"
/// otherwise.
pub fn doors_open(starts_at: &str, doors_open_at: &str, time_zone: Option<&str>) -> String {
    until(starts_at, doors_open_at, time_zone)
}

/// Ports `hasEnded` (`format.ts`): an event is past from the instant `now` (ms since the epoch,
/// passed in) reaches its end, half-open (030 FR-001). An end `Date` cannot read is never past
/// (`NaN <= now` is false).
pub fn has_ended(ends_at: &str, now: i64) -> bool {
    parse_instant(ends_at).is_some_and(|end| end.timestamp_millis() <= now)
}

fn event_date(at: &str, time_zone: Option<&str>) -> String {
    parse_instant(at).map_or(INVALID_DATE.into(), |t| {
        format_event_date(t, zone_or_default(time_zone))
    })
}

/// Ports `removedNote` (`format.ts`): "Check-in details removed on Nov 9, 2026 (kept for 7 days
/// after the event).", the date in the venue's zone (032 FR-010, FR-011).
pub fn removed_note(removed_at: &str, time_zone: Option<&str>) -> String {
    format!(
        "Check-in details removed on {} (kept for {CHECK_IN_RETENTION_DAYS} days after the event).",
        event_date(removed_at, time_zone)
    )
}

/// Ports `removedShort` (`format.ts`): the short form beside a count on Reports (032 FR-011).
pub fn removed_short(removed_at: &str, time_zone: Option<&str>) -> String {
    format!("Details removed {}", event_date(removed_at, time_zone))
}

/// Ports `mapsUrl` (`packages/shared/src/location.ts`): a venue's address as a Google Maps search
/// (spec 013 FR-014).
pub fn maps_url(address: &str) -> String {
    format!(
        "https://www.google.com/maps/search/?api=1&query={}",
        crate::api::seat_stream::encode_uri_component(address)
    )
}
