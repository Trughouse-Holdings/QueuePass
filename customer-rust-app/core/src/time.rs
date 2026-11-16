// Copied from admin-rust-app/core/src/time.rs at 680b4f7 (spec 040 R4).
//! Spec 037 (research R6): times and time zones, ported from
//!
//! - `packages/shared/src/time-zone.ts` (spec 020): the US zones, local time ↔ instant, and every
//!   formatted event time;
//! - the doors-open helpers of `packages/shared/src/event.ts` (spec 025);
//! - `admin-app/src/pages/event-form-times.ts` (spec 036): doors-open lengths and the new event's
//!   default times.
//!
//! Every text is byte-identical to the TypeScript under Node 22's `Intl` (`en-US`), checked
//! against the TypeScript's own outputs in `core/tests/fixtures/time/`. Instants are
//! `DateTime<Utc>` at millisecond precision, as a JavaScript `Date`; "now" is always passed in,
//! never read from the system clock (which panics in `wasm32`).
//!
//! Zones are IANA names (`&str`), as in the TypeScript. Functions the TypeScript lets throw a
//! `RangeError` return a [`TimeError`] with the same message. The formatting functions, which
//! `Intl` would also make throw for an unknown zone name, format in UTC instead; the Backend only
//! ever sends the eight [`US_TIME_ZONES`].

use std::fmt;
use std::str::FromStr;
use std::sync::LazyLock;

use chrono::{DateTime, Datelike, Duration, NaiveDate, Offset, TimeZone, Timelike, Utc};
use chrono_tz::{OffsetComponents, Tz};
use regress::Regex;

// ---------------------------------------------------------------- the US zones (R2, R3)

/// One of the eight US zones a venue can have (`US_TIME_ZONES` entry in `time-zone.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsTimeZoneEntry {
    /// IANA name, `America/New_York`.
    pub id: &'static str,
    /// Shown name, `Eastern Time`.
    pub name: &'static str,
}

/// Ports `US_TIME_ZONES` (`time-zone.ts`): the eight US zones, by IANA name, in this order.
pub const US_TIME_ZONES: [UsTimeZoneEntry; 8] = [
    UsTimeZoneEntry {
        id: "America/New_York",
        name: "Eastern Time",
    },
    UsTimeZoneEntry {
        id: "America/Chicago",
        name: "Central Time",
    },
    UsTimeZoneEntry {
        id: "America/Denver",
        name: "Mountain Time",
    },
    UsTimeZoneEntry {
        id: "America/Phoenix",
        name: "Arizona Time (no daylight saving)",
    },
    UsTimeZoneEntry {
        id: "America/Los_Angeles",
        name: "Pacific Time",
    },
    UsTimeZoneEntry {
        id: "America/Anchorage",
        name: "Alaska Time",
    },
    UsTimeZoneEntry {
        id: "America/Adak",
        name: "Hawaii-Aleutian Time",
    },
    UsTimeZoneEntry {
        id: "Pacific/Honolulu",
        name: "Hawaii Time",
    },
];

/// Ports `DEFAULT_TIME_ZONE` (`time-zone.ts`): existing venues' zone, and the zone assumed when a
/// response has none.
pub const DEFAULT_TIME_ZONE: &str = "America/New_York";

/// Ports `isUsTimeZone` (`time-zone.ts`).
pub fn is_us_time_zone(value: &str) -> bool {
    US_TIME_ZONES.iter().any(|z| z.id == value)
}

/// Ports `zoneName` (`time-zone.ts`): "Eastern Time", or the zone itself when it is not a US zone.
pub fn zone_name(zone: &str) -> &str {
    US_TIME_ZONES
        .iter()
        .find(|z| z.id == zone)
        .map_or(zone, |z| z.name)
}

const ET: &str = "America/New_York";
const CT: &str = "America/Chicago";
const MT: &str = "America/Denver";
const AZ: &str = "America/Phoenix";
const PT: &str = "America/Los_Angeles";

/// Ports `STATE_TIME_ZONES` (`time-zone.ts`): the zones in use in each state and DC, most populous
/// first, in the TypeScript's key order.
pub const STATE_TIME_ZONES: [(&str, &[&str]); 51] = [
    ("AL", &[CT]),
    ("AK", &["America/Anchorage", "America/Adak"]),
    ("AZ", &[AZ, MT]),
    ("AR", &[CT]),
    ("CA", &[PT]),
    ("CO", &[MT]),
    ("CT", &[ET]),
    ("DE", &[ET]),
    ("DC", &[ET]),
    ("FL", &[ET, CT]),
    ("GA", &[ET]),
    ("HI", &["Pacific/Honolulu"]),
    ("ID", &[MT, PT]),
    ("IL", &[CT]),
    ("IN", &[ET, CT]),
    ("IA", &[CT]),
    ("KS", &[CT, MT]),
    ("KY", &[ET, CT]),
    ("LA", &[CT]),
    ("ME", &[ET]),
    ("MD", &[ET]),
    ("MA", &[ET]),
    ("MI", &[ET, CT]),
    ("MN", &[CT]),
    ("MS", &[CT]),
    ("MO", &[CT]),
    ("MT", &[MT]),
    ("NE", &[CT, MT]),
    ("NV", &[PT, MT]),
    ("NH", &[ET]),
    ("NJ", &[ET]),
    ("NM", &[MT]),
    ("NY", &[ET]),
    ("NC", &[ET]),
    ("ND", &[CT, MT]),
    ("OH", &[ET]),
    ("OK", &[CT]),
    ("OR", &[PT, MT]),
    ("PA", &[ET]),
    ("RI", &[ET]),
    ("SC", &[ET]),
    ("SD", &[CT, MT]),
    ("TN", &[CT, ET]),
    ("TX", &[CT, MT]),
    ("UT", &[MT]),
    ("VT", &[ET]),
    ("VA", &[ET]),
    ("WA", &[PT]),
    ("WV", &[ET]),
    ("WI", &[CT]),
    ("WY", &[MT]),
];

/// `STATE_TIME_ZONES[state]` (`time-zone.ts`): the zones of one state code, or `None`.
pub fn state_time_zones(state: &str) -> Option<&'static [&'static str]> {
    STATE_TIME_ZONES
        .iter()
        .find(|(s, _)| *s == state)
        .map(|(_, zones)| *zones)
}

// ---------------------------------------------------------------- errors and instants

/// The `RangeError`s the TypeScript time module throws, with the same messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimeError {
    /// `Intl`'s "Invalid time zone specified: Foo/Bar".
    InvalidTimeZone(String),
    /// `offsetAt`'s "No whole-minute UTC offset in {zone} at that time: {text}" (before 1883,
    /// local mean time such as `GMT-04:56:02`).
    NoWholeMinuteOffset { zone: String, text: String },
    /// `resolveLocal`'s "Not a local date-time: {local}".
    NotLocalDateTime(String),
    /// `Date`'s "Invalid time value": an instant out of `Date`'s range.
    InvalidTimeValue,
}

impl fmt::Display for TimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TimeError::InvalidTimeZone(zone) => write!(f, "Invalid time zone specified: {zone}"),
            TimeError::NoWholeMinuteOffset { zone, text } => {
                write!(
                    f,
                    "No whole-minute UTC offset in {zone} at that time: {text}"
                )
            }
            TimeError::NotLocalDateTime(local) => write!(f, "Not a local date-time: {local}"),
            TimeError::InvalidTimeValue => f.write_str("Invalid time value"),
        }
    }
}

impl std::error::Error for TimeError {}

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("a valid pattern")
}

static ISO_INSTANT: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2}):?(\d{2})))?$",
    )
});

/// The `InstantLike` string form, as `new Date(string)` reads it: an ISO 8601 date-time with `Z`
/// or an offset (`2026-11-01T23:00:00.000Z`, `2026-10-01T19:00-04:00`), or a date alone (UTC
/// midnight). `None` where `Date` gives an Invalid Date. Fractions past milliseconds are cut,
/// `T24:00` is the next midnight, and a day past the month's end rolls over, as in V8. A date-time
/// without an offset, which `Date` reads in the device's zone, is refused here (`None`).
pub fn parse_instant(s: &str) -> Option<DateTime<Utc>> {
    let m = ISO_INSTANT.find(s)?;
    let num = |i: usize| -> Option<i64> { m.group(i).map(|r| s[r].parse().unwrap_or(0)) };
    let (y, mo, d) = (num(1)?, num(2)?, num(3)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let mut ms = NaiveDate::from_ymd_opt(i32::try_from(y).ok()?, u32::try_from(mo).ok()?, 1)?
        .and_hms_opt(0, 0, 0)?
        .and_utc()
        .timestamp_millis()
        + (d - 1) * DAY_MS;
    if m.group(4).is_some() {
        let (h, mi, sec) = (num(4)?, num(5)?, num(6).unwrap_or(0));
        let frac = m.group(7).map_or(0, |r| millis_of_fraction(&s[r]));
        if h > 24 || mi > 59 || sec > 59 || (h == 24 && (mi > 0 || sec > 0 || frac > 0)) {
            return None;
        }
        ms += h * 3_600_000 + mi * MINUTE_MS + sec * 1000 + frac;
        if m.group(9).is_some() {
            let (oh, om) = (num(10)?, num(11)?);
            if oh > 23 || om > 59 {
                return None;
            }
            let offset = oh * 60 + om;
            let sign = if m.group(9).map(|r| &s[r]) == Some("-") {
                -1
            } else {
                1
            };
            ms -= sign * offset * MINUTE_MS;
        }
    }
    instant_from_ms(ms)
}

/// `new Date(ms)`: milliseconds since the epoch as an instant, or `None` out of range.
pub fn instant_from_ms(ms: i64) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp_millis(ms)
}

/// `Date.prototype.toISOString`: `2026-11-01T23:00:00.000Z`.
pub fn to_iso_string(instant: DateTime<Utc>) -> String {
    instant.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// The first three digits of a fraction, padded, as milliseconds (`.5` is 500, `.1234` is 123).
fn millis_of_fraction(digits: &str) -> i64 {
    let mut ms = 0;
    for i in 0..3 {
        ms = ms * 10 + digits.as_bytes().get(i).map_or(0, |b| i64::from(b - b'0'));
    }
    ms
}

fn tz_of(zone: &str) -> Result<Tz, TimeError> {
    Tz::from_str(zone).map_err(|_| TimeError::InvalidTimeZone(zone.to_string()))
}

/// A formatting function's zone: an unknown name is read as UTC (where `Intl` would throw).
fn tz_or_utc(zone: &str) -> Tz {
    tz_of(zone).unwrap_or(Tz::UTC)
}

const DAY_MS: i64 = 86_400_000;
const MINUTE_MS: i64 = 60_000;

/// Seconds from UTC at that instant in that zone, and whether daylight saving is in force.
fn offset_parts(instant: DateTime<Utc>, tz: Tz) -> (i32, bool) {
    let offset = tz.offset_from_utc_datetime(&instant.naive_utc());
    (
        offset.fix().local_minus_utc(),
        !offset.dst_offset().is_zero(),
    )
}

/// `GMT-04:56:02` or `GMT+05:30`, `Intl`'s `longOffset` text; `GMT` for zero.
fn long_offset_text(seconds: i32) -> String {
    if seconds == 0 {
        return "GMT".into();
    }
    let sign = if seconds < 0 { '-' } else { '+' };
    let abs = seconds.unsigned_abs();
    let (h, m, s) = (abs / 3600, abs / 60 % 60, abs % 60);
    if s == 0 {
        format!("GMT{sign}{h:02}:{m:02}")
    } else {
        format!("GMT{sign}{h:02}:{m:02}:{s:02}")
    }
}

/// Ports `offsetAt` (`time-zone.ts`): minutes from UTC at that instant in that zone (`-240` for
/// EDT). An offset with seconds (local mean time, before 1883) is refused, never read as 0.
pub fn offset_at(instant: DateTime<Utc>, zone: &str) -> Result<i32, TimeError> {
    let (seconds, _) = offset_parts(instant, tz_of(zone)?);
    if seconds % 60 != 0 {
        return Err(TimeError::NoWholeMinuteOffset {
            zone: zone.to_string(),
            text: long_offset_text(seconds),
        });
    }
    Ok(seconds / 60)
}

// ---------------------------------------------------------------- abbreviations (ICU en-US)

/// The en-US short names ICU gives a metazone: (standard, daylight).
type ShortNames = (&'static str, &'static str);

const EASTERN: ShortNames = ("EST", "EDT");
const CENTRAL: ShortNames = ("CST", "CDT");
const MOUNTAIN: ShortNames = ("MST", "MDT");
const PACIFIC: ShortNames = ("PST", "PDT");
const ATLANTIC: ShortNames = ("AST", "ADT");
const ALASKA: ShortNames = ("AKST", "AKDT");
const HAWAII_ALEUTIAN: ShortNames = ("HAST", "HADT");
const HAWAII: ShortNames = ("HST", "HDT");

/// Every zone (and common link) whose ICU metazone has en-US short names, read from Node 22's
/// `Intl` (`fixtures/time/abbreviations.tsv`).
const NAMED_ZONES: &[(&[&str], ShortNames)] = &[
    (
        &[
            "America/Detroit",
            "America/Fort_Wayne",
            "America/Grand_Turk",
            "America/Indiana/Indianapolis",
            "America/Indiana/Marengo",
            "America/Indiana/Petersburg",
            "America/Indiana/Vevay",
            "America/Indiana/Vincennes",
            "America/Indiana/Winamac",
            "America/Indianapolis",
            "America/Iqaluit",
            "America/Kentucky/Louisville",
            "America/Kentucky/Monticello",
            "America/Louisville",
            "America/Montreal",
            "America/Nassau",
            "America/New_York",
            "America/Port-au-Prince",
            "America/Toronto",
            "America/Nipigon",
            "America/Thunder_Bay",
            "America/Pangnirtung",
            "Canada/Eastern",
            "EST5EDT",
            "US/East-Indiana",
            "US/Eastern",
            "US/Michigan",
            "America/Cancun",
            "America/Cayman",
            "America/Coral_Harbour",
            "America/Atikokan",
            "America/Jamaica",
            "America/Panama",
            "EST",
            "Jamaica",
        ],
        EASTERN,
    ),
    (
        &[
            "America/Chicago",
            "America/Indiana/Knox",
            "America/Indiana/Tell_City",
            "America/Knox_IN",
            "America/Matamoros",
            "America/Menominee",
            "America/North_Dakota/Beulah",
            "America/North_Dakota/Center",
            "America/North_Dakota/New_Salem",
            "America/Ojinaga",
            "America/Rankin_Inlet",
            "America/Resolute",
            "America/Winnipeg",
            "America/Rainy_River",
            "Canada/Central",
            "CST6CDT",
            "US/Central",
            "US/Indiana-Starke",
            "America/Bahia_Banderas",
            "America/Belize",
            "America/Chihuahua",
            "America/Costa_Rica",
            "America/El_Salvador",
            "America/Guatemala",
            "America/Managua",
            "America/Merida",
            "America/Mexico_City",
            "America/Monterrey",
            "America/Regina",
            "America/Swift_Current",
            "America/Tegucigalpa",
            "Canada/Saskatchewan",
            "Mexico/General",
        ],
        CENTRAL,
    ),
    (
        &[
            "America/Boise",
            "America/Cambridge_Bay",
            "America/Ciudad_Juarez",
            "America/Denver",
            "America/Edmonton",
            "America/Inuvik",
            "America/Yellowknife",
            "America/Shiprock",
            "Canada/Mountain",
            "MST7MDT",
            "Navajo",
            "US/Mountain",
            "America/Creston",
            "America/Dawson_Creek",
            "America/Fort_Nelson",
            "America/Phoenix",
            "MST",
            "US/Arizona",
        ],
        MOUNTAIN,
    ),
    (
        &[
            "America/Los_Angeles",
            "America/Tijuana",
            "America/Ensenada",
            "America/Santa_Isabel",
            "Mexico/BajaNorte",
            "America/Vancouver",
            "Canada/Pacific",
            "PST8PDT",
            "US/Pacific",
        ],
        PACIFIC,
    ),
    (
        &[
            "America/Glace_Bay",
            "America/Goose_Bay",
            "America/Halifax",
            "America/Moncton",
            "America/Thule",
            "Atlantic/Bermuda",
            "Canada/Atlantic",
            "America/Anguilla",
            "America/Antigua",
            "America/Aruba",
            "America/Barbados",
            "America/Blanc-Sablon",
            "America/Curacao",
            "America/Dominica",
            "America/Grenada",
            "America/Guadeloupe",
            "America/Kralendijk",
            "America/Lower_Princes",
            "America/Marigot",
            "America/Martinique",
            "America/Montserrat",
            "America/Port_of_Spain",
            "America/Puerto_Rico",
            "America/Santo_Domingo",
            "America/St_Barthelemy",
            "America/St_Kitts",
            "America/St_Lucia",
            "America/St_Thomas",
            "America/St_Vincent",
            "America/Tortola",
            "America/Virgin",
        ],
        ATLANTIC,
    ),
    (
        &[
            "America/Anchorage",
            "America/Juneau",
            "America/Metlakatla",
            "America/Nome",
            "America/Sitka",
            "America/Yakutat",
            "US/Alaska",
        ],
        ALASKA,
    ),
    (
        &["America/Adak", "America/Atka", "US/Aleutian"],
        HAWAII_ALEUTIAN,
    ),
    (&["Pacific/Honolulu", "HST", "US/Hawaii"], HAWAII),
];

/// Zones ICU always names "UTC".
const UTC_ZONES: &[&str] = &[
    "UTC",
    "Etc/UTC",
    "Etc/UCT",
    "UCT",
    "GMT",
    "GMT0",
    "Etc/GMT",
    "Universal",
    "Etc/Universal",
    "Zulu",
    "Etc/Zulu",
];

/// Zones of ICU's GMT metazone, named "GMT" at offset 0 (its only en-US short name).
const GMT_ZONES: &[&str] = &[
    "Africa/Abidjan",
    "Africa/Accra",
    "Africa/Bamako",
    "Africa/Banjul",
    "Africa/Bissau",
    "Africa/Conakry",
    "Africa/Dakar",
    "Africa/Freetown",
    "Africa/Lome",
    "Africa/Monrovia",
    "Africa/Nouakchott",
    "Africa/Ouagadougou",
    "Africa/Sao_Tome",
    "Africa/Timbuktu",
    "America/Danmarkshavn",
    "Antarctica/Troll",
    "Atlantic/Reykjavik",
    "Atlantic/St_Helena",
    "Europe/Dublin",
    "Europe/Guernsey",
    "Europe/Isle_of_Man",
    "Europe/Jersey",
    "Europe/London",
    "Europe/Belfast",
    "GB",
    "Eire",
    "Iceland",
    "Etc/GMT0",
    "Greenwich",
    "Etc/Greenwich",
];

/// ICU applies the metazones from 1970-01-01T00:00Z; earlier times get the GMT form.
const METAZONE_START_MS: i64 = 0;

/// ICU's short localized GMT form: `GMT-4`, `GMT+5:30`, `GMT-4:56:02`, `GMT+0`.
fn short_gmt_text(seconds: i32) -> String {
    let sign = if seconds < 0 { '-' } else { '+' };
    let abs = seconds.unsigned_abs();
    let (h, m, s) = (abs / 3600, abs / 60 % 60, abs % 60);
    match (m, s) {
        (0, 0) => format!("GMT{sign}{h}"),
        (_, 0) => format!("GMT{sign}{h}:{m:02}"),
        _ => format!("GMT{sign}{h}:{m:02}:{s:02}"),
    }
}

/// Ports `abbreviationAt` (`time-zone.ts`): the zone's en-US abbreviation at that instant, as
/// `Intl` gives it (`EDT`, `HAST`, `UTC`, `GMT`), with ICU's own fallback (`GMT-4`, `GMT+5:30`).
/// The zone is required here; the TypeScript's optional zone means the device's, which the app
/// crate passes in (research R6).
pub fn abbreviation_at(instant: DateTime<Utc>, zone: &str) -> String {
    if UTC_ZONES.contains(&zone) {
        return "UTC".into();
    }
    let Ok(tz) = tz_of(zone) else {
        return "UTC".into();
    };
    let (seconds, dst) = offset_parts(instant, tz);
    if instant.timestamp_millis() >= METAZONE_START_MS {
        if let Some((_, (standard, daylight))) =
            NAMED_ZONES.iter().find(|(zones, _)| zones.contains(&zone))
        {
            return if dst { daylight } else { standard }.to_string();
        }
        if seconds == 0 && GMT_ZONES.contains(&zone) {
            return "GMT".into();
        }
    }
    short_gmt_text(seconds)
}

/// Ports `formatOffset` (`time-zone.ts`): `-04:00` from `-240`.
pub fn format_offset(minutes: i32) -> String {
    let sign = if minutes < 0 { '-' } else { '+' };
    let abs = minutes.unsigned_abs();
    format!("{sign}{:02}:{:02}", abs / 60, abs % 60)
}

/// `localParts` (`time-zone.ts`): `YYYY-MM-DDTHH:mm:ss` in the zone, the year unpadded as
/// `Intl`'s `year: 'numeric'` writes it.
fn local_parts(instant: DateTime<Utc>, tz: Tz) -> String {
    let l = instant.with_timezone(&tz);
    format!(
        "{}-{:02}-{:02}T{:02}:{:02}:{:02}",
        l.year(),
        l.month(),
        l.day(),
        l.hour(),
        l.minute(),
        l.second()
    )
}

/// The first `n` characters (the TypeScript's `slice(0, n)` on ASCII text).
fn head(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Ports `toLocalDateTime` (`time-zone.ts`): `2026-10-01T19:00`, the local date-time, also a
/// `datetime-local` input's value.
pub fn to_local_date_time(instant: DateTime<Utc>, zone: &str) -> String {
    head(&local_parts(instant, tz_or_utc(zone)), 16)
}

/// Ports `localDate` (`time-zone.ts`): `2026-10-01`, the local date.
pub fn local_date(instant: DateTime<Utc>, zone: &str) -> String {
    head(&local_parts(instant, tz_or_utc(zone)), 10)
}

/// Ports `toOffsetDateTime` (`time-zone.ts`): `2026-10-01T19:00:00-04:00`, the instant stated in
/// the zone's offset, what clients send.
pub fn to_offset_date_time(instant: DateTime<Utc>, zone: &str) -> Result<String, TimeError> {
    let tz = tz_of(zone)?;
    Ok(format!(
        "{}{}",
        local_parts(instant, tz),
        format_offset(offset_at(instant, zone)?)
    ))
}

// ---------------------------------------------------------------- local → instant

/// Ports `Moment` (`time-zone.ts`): one moment a local time names in a zone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Moment {
    pub instant: DateTime<Utc>,
    /// `-04:00`
    pub offset: String,
    /// `EDT`
    pub abbreviation: String,
}

/// Ports `ResolvedLocal` (`time-zone.ts`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedLocal {
    /// The local time names one moment.
    Ok(Moment),
    /// Clocks jump past it; the local `HH:mm` of the jump.
    Skipped {
        skipped_from: String,
        skipped_to: String,
    },
    /// Clocks fall back over it; `first` is the earlier moment.
    Repeated { first: Moment, second: Moment },
}

impl ResolvedLocal {
    /// The TypeScript's `kind`: `ok`, `skipped`, or `repeated`.
    pub fn kind(&self) -> &'static str {
        match self {
            ResolvedLocal::Ok(_) => "ok",
            ResolvedLocal::Skipped { .. } => "skipped",
            ResolvedLocal::Repeated { .. } => "repeated",
        }
    }
}

static LOCAL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$")
});

/// `localAsUtc` (`time-zone.ts`): the local time read as if it were UTC, in ms, or `None` when it
/// is not a real date-time. As `Date.UTC` reads years 0-99 as 1900-1999, those never read back
/// the same and are refused, as in the TypeScript.
fn local_as_utc(local: &str) -> Option<i64> {
    let m = LOCAL_PATTERN.find(local)?;
    let num = |i: usize| -> u32 { m.group(i).map_or(0, |r| local[r].parse().unwrap_or(0)) };
    let (y, mo, d, h, mi, s) = (num(1), num(2), num(3), num(4), num(5), num(6));
    let ms = m.group(7).map_or(0, |r| millis_of_fraction(&local[r]));
    if !(1..=12).contains(&mo) || d < 1 || h > 23 || mi > 59 || s > 59 || y < 100 {
        return None;
    }
    let date = NaiveDate::from_ymd_opt(i32::try_from(y).ok()?, mo, d)?;
    Some(date.and_hms_opt(h, mi, s)?.and_utc().timestamp_millis() + ms)
}

fn at_ms(ms: i64) -> Result<DateTime<Utc>, TimeError> {
    instant_from_ms(ms).ok_or(TimeError::InvalidTimeValue)
}

fn offset_at_ms(ms: i64, zone: &str) -> Result<i64, TimeError> {
    Ok(i64::from(offset_at(at_ms(ms)?, zone)?))
}

fn moment_at(instant: DateTime<Utc>, zone: &str) -> Result<Moment, TimeError> {
    Ok(Moment {
        instant,
        offset: format_offset(offset_at(instant, zone)?),
        abbreviation: abbreviation_at(instant, zone),
    })
}

/// `hhmm` (`time-zone.ts`): the UTC `HH:mm` of an instant in ms.
fn hhmm(ms: i64) -> Result<String, TimeError> {
    Ok(at_ms(ms)?.format("%H:%M").to_string())
}

/// Ports `resolveLocal` (`time-zone.ts`): the moments a local date-time
/// (`YYYY-MM-DDTHH:mm[:ss[.fff]]`) names in a zone. It reads `local` as if it were UTC (`t0`),
/// takes the zone's offsets a day before and a day after, and keeps each `t0 − offset` whose own
/// offset is that offset. None: skipped; one: ok; two: repeated, earlier first. A malformed or
/// impossible date-time is a [`TimeError::NotLocalDateTime`].
pub fn resolve_local(local: &str, zone: &str) -> Result<ResolvedLocal, TimeError> {
    tz_of(zone)?;
    let t0 = local_as_utc(local).ok_or_else(|| TimeError::NotLocalDateTime(local.to_string()))?;
    let before = offset_at_ms(t0 - DAY_MS, zone)?;
    let after = offset_at_ms(t0 + DAY_MS, zone)?;
    let offsets = if before == after {
        vec![before]
    } else {
        vec![before, after]
    };
    let mut found = Vec::new();
    for offset in offsets {
        let t = t0 - offset * MINUTE_MS;
        if offset_at_ms(t, zone)? == offset {
            found.push(t);
        }
    }
    found.sort_unstable();
    match found[..] {
        [t] => return Ok(ResolvedLocal::Ok(moment_at(at_ms(t)?, zone)?)),
        [a, b] => {
            return Ok(ResolvedLocal::Repeated {
                first: moment_at(at_ms(a)?, zone)?,
                second: moment_at(at_ms(b)?, zone)?,
            });
        }
        _ => {}
    }
    // A gap: find the minute the offset changes, between a day before and a day after.
    let mut lo = (t0 - DAY_MS - 12 * 3_600_000).div_euclid(MINUTE_MS);
    let mut hi = -(-(t0 + DAY_MS + 12 * 3_600_000)).div_euclid(MINUTE_MS);
    while hi - lo > 1 {
        let mid = (lo + hi).div_euclid(2);
        if offset_at_ms(mid * MINUTE_MS, zone)? == before {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let change = hi * MINUTE_MS;
    Ok(ResolvedLocal::Skipped {
        skipped_from: hhmm(change + before * MINUTE_MS)?,
        skipped_to: hhmm(change + after * MINUTE_MS)?,
    })
}

/// What [`parse_offset_date_time`] returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OffsetDateTimeParts {
    /// `2027-11-07T01:30:00`, with the fraction when sent.
    pub local: String,
    /// Minutes from UTC; `Z` is 0.
    pub offset_minutes: i32,
}

static OFFSET_DATE_TIME: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|([+-])(\d{2}):(\d{2}))$")
});

/// Ports `parseOffsetDateTime` (`time-zone.ts`): splits an RFC 3339 date-time with an offset into
/// its local date-time and its offset in minutes, or `None` when it has no offset or is not a real
/// date-time.
pub fn parse_offset_date_time(s: &str) -> Option<OffsetDateTimeParts> {
    let m = OFFSET_DATE_TIME.find(s)?;
    let group = |i: usize| m.group(i).map(|r| &s[r]);
    let local = format!(
        "{}:{}{}",
        group(1).unwrap_or(""),
        group(2).unwrap_or("00"),
        group(3).unwrap_or("")
    );
    local_as_utc(&local)?;
    if group(4) == Some("Z") {
        return Some(OffsetDateTimeParts {
            local,
            offset_minutes: 0,
        });
    }
    let hours: i32 = group(6)?.parse().ok()?;
    let minutes: i32 = group(7)?.parse().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    let offset = hours * 60 + minutes;
    let offset_minutes = if group(5) == Some("-") {
        -offset
    } else {
        offset
    };
    Some(OffsetDateTimeParts {
        local,
        offset_minutes,
    })
}

// ---------------------------------------------------------------- formatting

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Ports `formatEventDate` (`time-zone.ts`): `Oct 1, 2026` in the zone.
pub fn format_event_date(instant: DateTime<Utc>, zone: &str) -> String {
    let l = instant.with_timezone(&tz_or_utc(zone));
    format!("{} {}, {}", MONTHS[l.month0() as usize], l.day(), l.year())
}

/// `clock` (`time-zone.ts`): `7:00 PM`, with plain spaces.
fn clock(instant: DateTime<Utc>, tz: Tz) -> String {
    let l = instant.with_timezone(&tz);
    let h = l.hour();
    let hour = if h.is_multiple_of(12) { 12 } else { h % 12 };
    format!(
        "{hour}:{:02} {}",
        l.minute(),
        if h < 12 { "AM" } else { "PM" }
    )
}

/// Ports `formatTimeOfDay` (`time-zone.ts`): `7:00 PM EDT` in the zone.
pub fn format_time_of_day(instant: DateTime<Utc>, zone: &str) -> String {
    format!(
        "{} {}",
        clock(instant, tz_or_utc(zone)),
        abbreviation_at(instant, zone)
    )
}

/// Ports `formatEventTime` (`time-zone.ts`): `Oct 1, 2026, 7:00 PM EDT` in the zone, every event
/// time in every app (020 FR-021).
pub fn format_event_time(instant: DateTime<Utc>, zone: &str) -> String {
    format!(
        "{}, {}",
        format_event_date(instant, zone),
        format_time_of_day(instant, zone)
    )
}

/// Ports `formatViewerTime` (`time-zone.ts`): a time that belongs to no event, in the viewer's
/// own zone with its abbreviation (020 FR-023): `4:42 PM PDT`, or `Oct 1, 2026, 4:42 PM PDT` with
/// `date`. The TypeScript reads the device zone from `Intl`; here the app crate passes it in
/// (research R6).
pub fn format_viewer_time(instant: DateTime<Utc>, viewer_zone: &str, date: bool) -> String {
    let time = format_time_of_day(instant, viewer_zone);
    if date {
        format!("{}, {time}", format_event_date(instant, viewer_zone))
    } else {
        time
    }
}

/// The characters `from..to` (the TypeScript's `slice` on ASCII text).
fn slice(s: &str, from: usize, to: usize) -> String {
    s.chars().skip(from).take(to.saturating_sub(from)).collect()
}

/// JavaScript's `Number(text)` for the digit runs these helpers read; `NaN` as `None`.
fn number(text: &str) -> Option<u32> {
    let t = text.trim();
    if t.is_empty() {
        Some(0)
    } else if t.bytes().all(|b| b.is_ascii_digit()) {
        t.parse().ok()
    } else {
        None
    }
}

/// Ports `formatLocalTime` (`time-zone.ts`): `1:30 AM` from a local date-time
/// (`YYYY-MM-DDTHH:mm…`), with no zone involved.
pub fn format_local_time(local: &str) -> String {
    let m = slice(local, 14, 16);
    match number(&slice(local, 11, 13)) {
        Some(h) => {
            let hour = if h.is_multiple_of(12) { 12 } else { h % 12 };
            format!("{hour}:{m} {}", if h < 12 { "AM" } else { "PM" })
        }
        None => format!("NaN:{m} PM"),
    }
}

/// Ports `formatLocalDateTime` (`time-zone.ts`): `Mar 14, 2027, 2:30 AM` from a local date-time,
/// with no zone involved.
pub fn format_local_date_time(local: &str) -> String {
    let month = number(&slice(local, 5, 7))
        .and_then(|m| m.checked_sub(1))
        .and_then(|i| MONTHS.get(i as usize))
        .copied()
        .unwrap_or("undefined");
    let day = number(&slice(local, 8, 10)).map_or("NaN".into(), |d| d.to_string());
    format!(
        "{month} {day}, {}, {}",
        slice(local, 0, 4),
        format_local_time(local)
    )
}

/// Ports `skippedTimeMessage` (`time-zone.ts`): the one message for a local time a
/// daylight-saving change skips, used by the Backend's `LOCAL_TIME_SKIPPED` and by the event form
/// before it sends anything: `2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump
/// from 2:00 AM to 3:00 AM. Choose another time.`
pub fn skipped_time_message(
    local: &str,
    zone: &str,
    skipped_from: &str,
    skipped_to: &str,
) -> String {
    let day = slice(local, 0, 10);
    let date = format_local_date_time(local)
        .split(", ")
        .take(2)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{} on {date} doesn't exist in {}: clocks jump from {} to {}. Choose another time.",
        format_local_time(local),
        zone_name(zone),
        format_local_time(&format!("{day}T{skipped_from}")),
        format_local_time(&format!("{day}T{skipped_to}")),
    )
}

/// Ports `formatEventEnd` (`time-zone.ts`): an event's end next to its start, `10:00 PM EDT`, or
/// `Oct 2, 2026, 1:00 AM EDT` when its local date differs from the start's.
pub fn format_event_end(start: DateTime<Utc>, end: DateTime<Utc>, zone: &str) -> String {
    if local_date(start, zone) == local_date(end, zone) {
        format_time_of_day(end, zone)
    } else {
        format_event_time(end, zone)
    }
}

/// Ports `formatDoorsOpen` (`time-zone.ts`): an event's doors-open time next to its start, by the
/// same rule as its end (025 FR-021).
pub fn format_doors_open(start: DateTime<Utc>, doors_open: DateTime<Utc>, zone: &str) -> String {
    format_event_end(start, doors_open, zone)
}

// ---------------------------------------------------------------- doors open (event.ts, 025)

/// Ports `DEFAULT_DOORS_BEFORE_START_MINUTES` (`event.ts`): doors left out open this long before
/// the start.
pub const DEFAULT_DOORS_BEFORE_START_MINUTES: i64 = 60;

/// Ports `DOORS_OPEN_MAX_BEFORE_START_MINUTES` (`event.ts`): doors open at most this long before
/// the start, and never after it, both ends allowed, in elapsed time.
pub const DOORS_OPEN_MAX_BEFORE_START_MINUTES: i64 = 360;

/// Ports `ENTRY_OPENS_BEFORE_DOORS_MINUTES` (`event.ts`): gate check-in opens this long before
/// doors open.
pub const ENTRY_OPENS_BEFORE_DOORS_MINUTES: i64 = 60;

/// Ports `CHECK_IN_RETENTION_DAYS` (`event.ts`): check-in details are kept this many days after
/// the event ends (spec 032).
pub const CHECK_IN_RETENTION_DAYS: i64 = 7;

/// Ports `DoorsOpenProblem` (`event.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DoorsOpenProblem {
    TooEarly,
    AfterStart,
}

impl DoorsOpenProblem {
    /// `TOO_EARLY` or `AFTER_START`.
    pub fn as_str(self) -> &'static str {
        match self {
            DoorsOpenProblem::TooEarly => "TOO_EARLY",
            DoorsOpenProblem::AfterStart => "AFTER_START",
        }
    }
}

/// Ports `doorsOpenProblem` (`event.ts`): what is wrong with a doors-open time for a start, or
/// `None` when it is in range (025 FR-004).
pub fn doors_open_problem(
    starts_at: DateTime<Utc>,
    doors_open_at: DateTime<Utc>,
) -> Option<DoorsOpenProblem> {
    let start = starts_at.timestamp_millis();
    let doors = doors_open_at.timestamp_millis();
    if doors > start {
        Some(DoorsOpenProblem::AfterStart)
    } else if doors < start - DOORS_OPEN_MAX_BEFORE_START_MINUTES * MINUTE_MS {
        Some(DoorsOpenProblem::TooEarly)
    } else {
        None
    }
}

/// Ports `doorsOpenRangeMessage` (`event.ts`): the one message for a doors-open time out of range
/// (025 FR-005), `Doors must open no more than 6 hours before the start and not after it: between
/// Nov 20, 2026, 1:00 PM EST and 7:00 PM EST.`
pub fn doors_open_range_message(starts_at: DateTime<Utc>, zone: &str) -> String {
    let latest = starts_at;
    let earliest = latest - Duration::minutes(DOORS_OPEN_MAX_BEFORE_START_MINUTES);
    format!(
        "Doors must open no more than {} hours before the start and not after it: between {} and {}.",
        DOORS_OPEN_MAX_BEFORE_START_MINUTES / 60,
        format_event_time(earliest, zone),
        format_event_end(earliest, latest, zone),
    )
}

// ---------------------------------------------------------------- event-form-times.ts (036)

/// Ports `DOORS_OFFSET_STEP_MINUTES` (`event-form-times.ts`).
pub const DOORS_OFFSET_STEP_MINUTES: i64 = 15;
/// Ports `DOORS_OFFSET_MAX_MINUTES` (`event-form-times.ts`).
pub const DOORS_OFFSET_MAX_MINUTES: i64 = 6 * 60;
/// Ports `DEFAULT_DOORS_OFFSET_MINUTES` (`event-form-times.ts`).
pub const DEFAULT_DOORS_OFFSET_MINUTES: i64 = DEFAULT_DOORS_BEFORE_START_MINUTES;

/// Ports `DoorsMode` (`event-form-times.ts`): "Before the start" or "At a set time".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DoorsMode {
    Before,
    AtTime,
}

impl DoorsMode {
    /// `before` or `at-time`.
    pub fn as_str(self) -> &'static str {
        match self {
            DoorsMode::Before => "before",
            DoorsMode::AtTime => "at-time",
        }
    }
}

/// Ports `doorsOffsetMinutesList` (`event-form-times.ts`): every listed length, 0 through 6 hours
/// in 15-minute steps.
pub fn doors_offset_minutes_list() -> Vec<i64> {
    (0..=DOORS_OFFSET_MAX_MINUTES)
        .step_by(DOORS_OFFSET_STEP_MINUTES as usize)
        .collect()
}

/// Ports `doorsOffsetLabel` (`event-form-times.ts`): "At the start", "1 hour before",
/// "1 hour 30 minutes before", "6 hours before".
pub fn doors_offset_label(minutes: i64) -> String {
    if minutes == 0 {
        return "At the start".into();
    }
    let hours = minutes.div_euclid(60);
    let rest = minutes % 60;
    let mut parts: Vec<String> = Vec::new();
    if hours == 1 {
        parts.push("1 hour".into());
    } else if hours > 1 {
        parts.push(format!("{hours} hours"));
    }
    if rest > 0 {
        parts.push(format!("{rest} minutes"));
    }
    format!("{} before", parts.join(" "))
}

/// Ports `isExactDoorsOffsetMinutes` (`event-form-times.ts`): a listed length. Takes whole
/// minutes; the TypeScript's `Number.isInteger` check is the type here.
pub fn is_exact_doors_offset_minutes(minutes: i64) -> bool {
    (0..=DOORS_OFFSET_MAX_MINUTES).contains(&minutes) && minutes % DOORS_OFFSET_STEP_MINUTES == 0
}

/// Ports `doorsModeForStoredGapMs` (`event-form-times.ts`): the edit form opens a stored gap that
/// is a 15-minute step in range in "Before the start" (036 FR-005).
pub fn doors_mode_for_stored_gap_ms(gap_ms: i64) -> DoorsMode {
    if gap_ms < 0 || gap_ms % MINUTE_MS != 0 {
        return DoorsMode::AtTime;
    }
    if is_exact_doors_offset_minutes(gap_ms / MINUTE_MS) {
        DoorsMode::Before
    } else {
        DoorsMode::AtTime
    }
}

/// What [`split_local_date_time`] returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalDateTimeParts {
    pub date: String,
    pub time: String,
}

/// Ports `splitLocalDateTime` (`event-form-times.ts`): `2026-11-20T19:00` into its date and its
/// time to the minute.
pub fn split_local_date_time(value: &str) -> LocalDateTimeParts {
    let chars: Vec<char> = value.chars().collect();
    match chars.iter().position(|c| *c == 'T') {
        _ if value.is_empty() => LocalDateTimeParts {
            date: String::new(),
            time: String::new(),
        },
        None => LocalDateTimeParts {
            date: value.to_string(),
            time: String::new(),
        },
        Some(cut) => LocalDateTimeParts {
            date: chars[..cut].iter().collect(),
            time: chars[cut + 1..].iter().take(5).collect(),
        },
    }
}

/// Ports `joinLocalDateTime` (`event-form-times.ts`): empty unless both the date and the time are
/// present; the time is kept to the minute.
pub fn join_local_date_time(date: &str, time: &str) -> String {
    if date.is_empty() || time.is_empty() {
        return String::new();
    }
    format!("{date}T{}", head(time, 5))
}

/// Ports `doorsInstantBeforeStart` (`event-form-times.ts`): the start minus N elapsed minutes.
pub fn doors_instant_before_start(start: DateTime<Utc>, minutes: i64) -> DateTime<Utc> {
    start - Duration::minutes(minutes)
}

/// Ports `doorsOpenAtPreview` (`event-form-times.ts`): "Doors open at 6:00 PM EDT", with
/// " the day before" when doors fall on the day before the start's local date (036 FR-004).
pub fn doors_open_at_preview(
    instant: DateTime<Utc>,
    zone: &str,
    start: Option<DateTime<Utc>>,
) -> String {
    let line = format!("Doors open at {}", format_time_of_day(instant, zone));
    match start {
        Some(start) if local_date(instant, zone) < local_date(start, zone) => {
            format!("{line} the day before")
        }
        _ => line,
    }
}

/// One entry of [`doors_offset_options`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoorsOffsetOption {
    pub minutes: i64,
    pub label: String,
}

/// Ports `doorsOffsetOptions` (`event-form-times.ts`): each listed length with its label.
pub fn doors_offset_options() -> Vec<DoorsOffsetOption> {
    doors_offset_minutes_list()
        .into_iter()
        .map(|minutes| DoorsOffsetOption {
            minutes,
            label: doors_offset_label(minutes),
        })
        .collect()
}

/// Ports `DEFAULT_EVENT_LENGTH_MINUTES` (`event-form-times.ts`): a new event lasts 4 hours by
/// default, in elapsed time (036 FR-017).
pub const DEFAULT_EVENT_LENGTH_MINUTES: i64 = 4 * 60;

/// What [`default_event_instants`] returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefaultEventInstants {
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
}

/// Ports `defaultEventInstants` (`event-form-times.ts`): a new event starts at the next whole
/// hour after `now` (strictly after, so 1:00:00 PM gives 2:00 PM) and ends 4 elapsed hours later
/// (036 FR-017). `now` is passed in.
pub fn default_event_instants(now: DateTime<Utc>) -> DefaultEventInstants {
    const HOUR: i64 = 3_600_000;
    let start_ms = now.timestamp_millis().div_euclid(HOUR) * HOUR + HOUR;
    let starts_at = instant_from_ms(start_ms).unwrap_or(now);
    DefaultEventInstants {
        starts_at,
        ends_at: starts_at + Duration::minutes(DEFAULT_EVENT_LENGTH_MINUTES),
    }
}
