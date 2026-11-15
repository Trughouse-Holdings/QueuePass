//! Spec 037 (research R6, R7), port of `admin-app/src/export/made.ts`: the made-at time with its
//! offset and the heading lines, in the admin's zone, which the caller passes in as an IANA name
//! (the `app` crate reads the device's zone from `Intl`; X4).
//!
//! The time helpers below are the parts of `packages/shared/src/time-zone.ts` the exports use,
//! built on `chrono-tz` to give what `Intl` (`en-US`) gives the React app, zone abbreviations
//! included.

use chrono::{DateTime, Utc};
use chrono_tz::Tz;

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

pub(crate) use crate::time::DEFAULT_TIME_ZONE;

/// A zone name `time` can use. A name `chrono-tz` does not know is read as UTC, so a download is
/// still made (the browser's `Intl` only gives names it knows).
fn known(zone_name: &str) -> &str {
    if zone_name.parse::<Tz>().is_ok() {
        zone_name
    } else {
        "UTC"
    }
}

/// `toLocalDateTime` (`crate::time`): `2026-10-01T19:00`.
pub(crate) fn to_local_date_time(at: DateTime<Utc>, zone_name: &str) -> String {
    crate::time::to_local_date_time(at, known(zone_name))
}

/// `toOffsetDateTime` (`crate::time`): `2026-10-01T19:00:00-04:00`.
pub(crate) fn to_offset_date_time(at: DateTime<Utc>, zone_name: &str) -> String {
    crate::time::to_offset_date_time(at, known(zone_name)).unwrap_or_default()
}

/// `formatEventTime` (`crate::time`): `Oct 1, 2026, 7:00 PM EDT`.
pub(crate) fn format_event_time(at: DateTime<Utc>, zone_name: &str) -> String {
    crate::time::format_event_time(at, known(zone_name))
}

/// `zoneName` (`crate::time`): a US zone's shown name, or the IANA name itself.
pub(crate) fn zone_name(zone_name: &str) -> String {
    crate::time::zone_name(zone_name).to_string()
}
