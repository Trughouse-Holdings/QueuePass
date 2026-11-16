//! Spec 040 T022 (parity F1–F6, B7, E4): ports `customer-app/src/format.ts`, how the Customer
//! app shows prices, counts, seats, and an event's times. Started from the Rust Admin app's
//! `core/src/format.rs` (R4); its Admin-only helpers (`until`, `venueZone`, `removedNote`, …) are
//! dropped. Times come in as the API's ISO strings, as in the TypeScript; a response without a
//! zone (or with an empty one, `||`) is read as [`DEFAULT_TIME_ZONE`].
//!
//! Where the TypeScript passes a string `Date` cannot read to `Intl` (which throws "Invalid time
//! value"), these show `Invalid Date`, `String(new Date('x'))`.

use crate::money::{format_price, price_cents};
use crate::time::{
    DEFAULT_TIME_ZONE, format_doors_open, format_event_end, format_event_time, parse_instant,
};

pub use crate::money::usd;

/// `timeZone || DEFAULT_TIME_ZONE`: a missing or empty zone is Eastern.
fn zone_or_default(time_zone: Option<&str>) -> &str {
    match time_zone {
        Some(zone) if !zone.is_empty() => zone,
        _ => DEFAULT_TIME_ZONE,
    }
}

const INVALID_DATE: &str = "Invalid Date";

/// Ports `when`: an event time in its venue's zone, always with its date and the zone's
/// abbreviation, "Oct 1, 2026, 7:00 PM EDT" (003 FR-006; 020 FR-021).
pub fn when(iso: &str, time_zone: Option<&str>) -> String {
    parse_instant(iso).map_or(INVALID_DATE.into(), |at| {
        format_event_time(at, zone_or_default(time_zone))
    })
}

/// `formatEventEnd(start, end, zone)` over ISO strings.
fn event_end(start: &str, end: &str, zone: &str) -> String {
    match (parse_instant(start), parse_instant(end)) {
        (Some(s), Some(e)) => format_event_end(s, e, zone),
        _ => INVALID_DATE.into(),
    }
}

/// Ports `count`: a whole number with thousands separators, `n.toLocaleString('en-US')`.
pub fn count(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Ports `cents`: a decimal-string price in whole cents from its digits. `None` where the
/// TypeScript gives `NaN` (the Backend never sends such a price).
pub fn cents(price: &str) -> Option<i64> {
    price_cents(price)
}

/// `usd(`${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`)`, or the
/// TypeScript's `NaN` text.
fn usd_of_cents(total: Option<i64>) -> String {
    match total {
        Some(t) => usd(&format!("{}.{:0>2}", t.div_euclid(100), t.rem_euclid(100))),
        None => usd("NaN.NaN"),
    }
}

/// Ports `totalUsd`: a price times a quantity as US dollars, in integer cents (006 US1-3).
pub fn total_usd(price: &str, quantity: i64) -> String {
    usd_of_cents(cents(price).and_then(|c| c.checked_mul(quantity)))
}

/// Ports `sumUsd`: prices summed as US dollars, in integer cents (038 FR-022).
pub fn sum_usd<S: AsRef<str>>(prices: &[S]) -> String {
    usd_of_cents(
        prices
            .iter()
            .try_fold(0i64, |n, p| n.checked_add(cents(p.as_ref())?)),
    )
}

/// The seat `seatLabel` reads: its section, row and seat numbers, and the labels people read
/// (`rowLabel ?? row`, `seatLabel ?? seat`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeatRef<'a> {
    pub section: &'a str,
    pub row: i64,
    pub seat: i64,
    pub row_label: Option<&'a str>,
    pub seat_label: Option<&'a str>,
}

impl<'a> SeatRef<'a> {
    /// A seat known by its numbers only (no labels).
    pub fn numbers(section: &'a str, row: i64, seat: i64) -> Self {
        Self {
            section,
            row,
            seat,
            row_label: None,
            seat_label: None,
        }
    }

    /// A seat with its labels, as the contract's `SeatLabel` and `ReservedSeat` carry them.
    pub fn labelled(
        section: &'a str,
        row: i64,
        seat: i64,
        row_label: &'a str,
        seat_label: &'a str,
    ) -> Self {
        Self {
            section,
            row,
            seat,
            row_label: Some(row_label),
            seat_label: Some(seat_label),
        }
    }
}

impl<'a> SeatRef<'a> {
    /// The contract's `SeatLabel` (a ticket's seat), labels and all.
    pub fn from_label(s: &'a crate::api::types::SeatLabel) -> Self {
        Self::labelled(
            &s.section,
            s.row.get() as i64,
            s.seat.get() as i64,
            &s.row_label,
            &s.seat_label,
        )
    }
}

/// Ports `seatLabel`: "Section 115, Row F, Seat 7" (007 FR-011; 038 FR-026).
pub fn seat_label(s: &SeatRef<'_>) -> String {
    let row = s.row_label.map_or_else(|| s.row.to_string(), str::to_owned);
    let seat = s
        .seat_label
        .map_or_else(|| s.seat.to_string(), str::to_owned);
    format!("Section {}, Row {row}, Seat {seat}", s.section)
}

/// Ports `seatWithPrice`: "Section 115, Row F, Seat 7, Courtside, $95.00" (038 FR-022, FR-026). An
/// empty or missing level name or price is left out.
pub fn seat_with_price(s: &SeatRef<'_>, level_name: Option<&str>, price: Option<&str>) -> String {
    let mut parts = vec![seat_label(s)];
    if let Some(level) = level_name.filter(|l| !l.is_empty()) {
        parts.push(level.to_owned());
    }
    if let Some(p) = price.filter(|p| !p.is_empty()) {
        parts.push(usd(p));
    }
    parts.join(", ")
}

/// Ports `eventPrice` (038 FR-024): a seated event's range of on-sale level prices, "$35–$95"
/// (one price when they are all the same); a general-admission event's base price.
pub fn event_price(base_price: &str, reserved_seating: bool, price_max: Option<&str>) -> String {
    match price_max {
        Some(max) if reserved_seating && !max.is_empty() => {
            // `NaN === NaN` is false, so an unreadable price gives the range.
            let same = matches!((cents(max), cents(base_price)), (Some(a), Some(b)) if a == b);
            if same {
                format_price(base_price)
            } else {
                format!("{}–{}", format_price(base_price), format_price(max))
            }
        }
        _ => usd(base_price),
    }
}

/// Ports `doorsOpen` (025 FR-021): "5:30 PM EST" on the start's local date, "Nov 19, 2026,
/// 11:30 PM EST" otherwise, in the venue's zone.
pub fn doors_open(starts_at: &str, doors_open_at: &str, time_zone: Option<&str>) -> String {
    match (parse_instant(starts_at), parse_instant(doors_open_at)) {
        (Some(s), Some(d)) => format_doors_open(s, d, zone_or_default(time_zone)),
        _ => INVALID_DATE.into(),
    }
}

/// Ports `hasEnded` (030 FR-001): past from the instant `now` (ms since the epoch) reaches the
/// end, half-open. An end `Date` cannot read is never past (`NaN <= now` is false).
pub fn has_ended(ends_at: &str, now: i64) -> bool {
    parse_instant(ends_at).is_some_and(|end| end.timestamp_millis() <= now)
}

/// Ports `StartedNoticeKind` (034 R4, R5): `Buy` on the Get tickets panel while it offers tickets
/// (FR-008), `First` while it shows a reason it offers none (FR-010), `Admit` on the confirmation
/// of an order placed after the start (FR-012).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartedNoticeKind {
    Buy,
    First,
    Admit,
}

/// Ports `startedNotice` (034 FR-008 to FR-010, FR-012): "This event has already started (began
/// at 7:00 PM EST)." and, for `Buy` or `Admit`, the sentence that follows; each time alone on the
/// local date of `at` and with its date otherwise (FR-009).
pub fn started_notice(
    starts_at: &str,
    ends_at: &str,
    time_zone: Option<&str>,
    at: &str,
    kind: StartedNoticeKind,
) -> String {
    let zone = zone_or_default(time_zone);
    let first = format!(
        "This event has already started (began at {}).",
        event_end(at, starts_at, zone)
    );
    let end = || event_end(at, ends_at, zone);
    match kind {
        StartedNoticeKind::First => first,
        StartedNoticeKind::Buy => {
            format!(
                "{first} You can still buy tickets until it ends at {}.",
                end()
            )
        }
        StartedNoticeKind::Admit => {
            format!("{first} Your tickets admit you until it ends at {}.", end())
        }
    }
}

/// Ports `mapsUrl` (`packages/shared/src/location.ts`): a venue's address as a Google Maps search
/// (spec 013 FR-014). Kept from the Admin's module: the address link uses it.
pub fn maps_url(address: &str) -> String {
    format!(
        "https://www.google.com/maps/search/?api=1&query={}",
        crate::api::seat_stream::encode_uri_component(address)
    )
}
