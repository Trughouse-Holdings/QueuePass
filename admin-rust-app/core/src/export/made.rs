//! Spec 037 (research R6, R7), port of `admin-app/src/export/made.ts`: the made-at time with its
//! offset and the heading lines, in the admin's zone, which the caller passes in as an IANA name
//! (the `app` crate reads the device's zone from `Intl`; X4).
//!
//! The time helpers below are the parts of `packages/shared/src/time-zone.ts` the exports use,
//! built on `chrono-tz` to give what `Intl` (`en-US`) gives the React app, zone abbreviations
//! included.

use chrono::{DateTime, Datelike, Offset, Timelike, Utc};
use chrono_tz::{OffsetName, Tz};

/// The made-at time as the files carry it, and the heading lines "Made at …", "Made by …".
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Made {
    pub made_at: String,
    pub lines: Vec<String>,
}

/// Spec 023 FR-003 (research R7): `made_at` stated in `admin_zone` with its offset, and the lines.
pub fn made_lines(made_at: DateTime<Utc>, made_by: &str, admin_zone: &str) -> Made {
    Made {
        made_at: to_offset_date_time(made_at, admin_zone),
        lines: vec![
            format!("Made at {}", format_event_time(made_at, admin_zone)),
            format!("Made by {made_by}"),
        ],
    }
}

/// An instant as the API and the tables write it (RFC 3339, `Z` or an offset).
pub fn parse_instant(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

// ------------------------------------------------------------------ time-zone helpers

/// 037-merge: duplicate of `DEFAULT_TIME_ZONE` (packages/shared/src/time-zone.ts).
pub(crate) const DEFAULT_TIME_ZONE: &str = "America/New_York";

/// The zone by its IANA name. A name `chrono-tz` does not know is read as UTC, so a download
/// is still made (the browser's `Intl` only gives names it knows).
pub(crate) fn zone(name: &str) -> Tz {
    name.parse().unwrap_or(Tz::UTC)
}

fn local(at: DateTime<Utc>, zone_name: &str) -> DateTime<Tz> {
    at.with_timezone(&zone(zone_name))
}

/// 037-merge: duplicate of `toLocalDateTime` (packages/shared/src/time-zone.ts):
/// `2026-10-01T19:00`.
pub(crate) fn to_local_date_time(at: DateTime<Utc>, zone_name: &str) -> String {
    local(at, zone_name).format("%Y-%m-%dT%H:%M").to_string()
}

/// 037-merge: duplicate of `toOffsetDateTime` (packages/shared/src/time-zone.ts):
/// `2026-10-01T19:00:00-04:00`.
pub(crate) fn to_offset_date_time(at: DateTime<Utc>, zone_name: &str) -> String {
    local(at, zone_name)
        .format("%Y-%m-%dT%H:%M:%S%:z")
        .to_string()
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// 037-merge: duplicate of `formatEventDate` (packages/shared/src/time-zone.ts): `Oct 1, 2026`.
pub(crate) fn format_event_date(at: DateTime<Utc>, zone_name: &str) -> String {
    let l = local(at, zone_name);
    format!("{} {}, {}", MONTHS[l.month0() as usize], l.day(), l.year())
}

/// 037-merge: duplicate of `formatEventTime` (packages/shared/src/time-zone.ts):
/// `Oct 1, 2026, 7:00 PM EDT`.
pub(crate) fn format_event_time(at: DateTime<Utc>, zone_name: &str) -> String {
    let l = local(at, zone_name);
    let (pm, hour) = l.hour12();
    format!(
        "{}, {}:{:02} {} {}",
        format_event_date(at, zone_name),
        hour,
        l.minute(),
        if pm { "PM" } else { "AM" },
        abbreviation(&l)
    )
}

/// 037-merge: duplicate of `abbreviationAt` (packages/shared/src/time-zone.ts): the short zone
/// name `Intl` gives in `en-US`. It has an abbreviation only for the North American zones (and
/// "UTC"); everywhere else it is the offset from GMT ("GMT+1", "GMT+5:30", "GMT").
fn abbreviation(l: &DateTime<Tz>) -> String {
    let tz = l.timezone();
    if matches!(
        tz.name(),
        "UTC"
            | "Etc/UTC"
            | "Etc/UCT"
            | "UCT"
            | "Etc/Universal"
            | "Universal"
            | "Etc/Zulu"
            | "Zulu"
            | "GMT"
            | "Etc/GMT"
            | "Etc/GMT0"
            | "Etc/GMT+0"
            | "Etc/GMT-0"
            | "GMT0"
            | "GMT+0"
            | "GMT-0"
            | "Etc/Greenwich"
            | "Greenwich"
    ) {
        return "UTC".into();
    }
    let seconds = l.offset().fix().local_minus_utc();
    let hours = seconds / 3600;
    let named = l.offset().abbreviation().unwrap_or("");
    // ICU calls the Aleutian zone "Hawaii-Aleutian", HAST/HADT, where tzdata says HST/HDT.
    let named = match (tz, named) {
        (Tz::America__Adak, "HST") => "HAST",
        (Tz::America__Adak, "HDT") => "HADT",
        (_, other) => other,
    };
    let north_american = match named {
        "EST" | "CDT" => hours == -5,
        "EDT" | "AST" => hours == -4,
        "ADT" => hours == -3,
        "CST" | "MDT" => hours == -6,
        "MST" | "PDT" => hours == -7,
        "PST" | "AKDT" => hours == -8,
        "AKST" | "HADT" => hours == -9,
        "HST" | "HAST" => hours == -10,
        _ => false,
    };
    if north_american && seconds % 3600 == 0 {
        return named.into();
    }
    gmt_offset(seconds)
}

/// `GMT`, `GMT+1`, `GMT-3:30`: how `Intl` names an offset it has no abbreviation for.
fn gmt_offset(seconds: i32) -> String {
    if seconds == 0 {
        return "GMT".into();
    }
    let sign = if seconds < 0 { '-' } else { '+' };
    let minutes = seconds.unsigned_abs() / 60;
    match minutes % 60 {
        0 => format!("GMT{sign}{}", minutes / 60),
        m => format!("GMT{sign}{}:{m:02}", minutes / 60),
    }
}

/// 037-merge: duplicate of `zoneName` (packages/shared/src/time-zone.ts): a US zone's shown
/// name, or the IANA name itself for any other.
pub(crate) fn zone_name(zone_name: &str) -> String {
    match zone_name {
        "America/New_York" => "Eastern Time",
        "America/Chicago" => "Central Time",
        "America/Denver" => "Mountain Time",
        "America/Phoenix" => "Arizona Time (no daylight saving)",
        "America/Los_Angeles" => "Pacific Time",
        "America/Anchorage" => "Alaska Time",
        "America/Adak" => "Hawaii-Aleutian Time",
        "Pacific/Honolulu" => "Hawaii Time",
        other => other,
    }
    .to_string()
}
