//! Spec 040 T022 (parity F1–F6, B7, E4): the Customer app's formats, ported case by case from
//!
//! - `customer-app/test/format.test.ts` (spec 003 FR-006, FR-007; 006 US1-3; 007 FR-011; 030
//!   FR-001; 034 FR-008 to FR-012);
//! - `customer-app/test/times.tz.test.tsx` (spec 020 FR-021, FR-022): the texts each screen shows;
//! - `customer-app/test/doors-open.test.tsx` (spec 025 FR-019, FR-021, FR-023): the values;
//! - the price texts of `cart.test.tsx` and `venue-map-flow.test.tsx` (spec 038 FR-022, FR-024,
//!   FR-026).
//!
//! The shared `time-zone.ts` cases (`formatEventTime`, `formatEventEnd`, `formatDoorsOpen`,
//! `formatViewerTime`) are in `tests/time.rs`, copied with `core::time`.

use customer_rust_core::format::{
    SeatRef, StartedNoticeKind, cents, count, doors_open, event_price, has_ended, seat_label,
    seat_with_price, started_notice, sum_usd, total_usd, usd, when,
};
use customer_rust_core::time::parse_instant;

fn ms(iso: &str) -> i64 {
    parse_instant(iso).unwrap().timestamp_millis()
}

// ------------------------------------------------------------------ format.test.ts

#[test]
fn usd_formats_without_going_through_a_float() {
    for (price, shown) in [
        ("45.5", "$45.50"),
        ("1200.00", "$1,200.00"),
        ("0", "$0.00"),
        ("7.05", "$7.05"),
        ("12345678.9", "$12,345,678.90"),
    ] {
        assert_eq!(usd(price), shown, "{price}");
    }
}

#[test]
fn when_shows_the_venue_local_date_and_time_with_the_abbreviation() {
    assert_eq!(
        when("2026-12-01T23:00:00.000Z", Some("America/New_York")),
        "Dec 1, 2026, 6:00 PM EST"
    );
    assert_eq!(
        when("2026-12-01T23:00:00.000Z", Some("America/Phoenix")),
        "Dec 1, 2026, 4:00 PM MST"
    );
}

#[test]
fn when_reads_a_missing_zone_as_eastern() {
    assert_eq!(
        when("2026-12-01T23:00:00.000Z", None),
        "Dec 1, 2026, 6:00 PM EST"
    );
    // `timeZone || DEFAULT_TIME_ZONE`: an empty zone is Eastern too.
    assert_eq!(
        when("2026-12-01T23:00:00.000Z", Some("")),
        "Dec 1, 2026, 6:00 PM EST"
    );
}

#[test]
fn when_gives_an_event_crossing_midnight_its_own_end_date() {
    assert_eq!(
        when("2026-12-02T07:00:00.000Z", Some("America/New_York")),
        "Dec 2, 2026, 2:00 AM EST"
    );
}

#[test]
fn when_of_a_time_date_cannot_read_is_invalid_date() {
    assert_eq!(when("garbage", None), "Invalid Date");
}

#[test]
fn total_usd_multiplies_without_going_through_a_float() {
    for (price, quantity, shown) in [
        ("19.99", 3, "$59.97"),
        ("0.10", 3, "$0.30"),
        ("1250.00", 10, "$12,500.00"),
        ("0.00", 4, "$0.00"),
        ("45.5", 2, "$91.00"),
    ] {
        assert_eq!(total_usd(price, quantity), shown, "{price} x {quantity}");
    }
}

#[test]
fn seat_label_names_the_section_row_and_seat() {
    assert_eq!(
        seat_label(&SeatRef::numbers("A", 3, 7)),
        "Section A, Row 3, Seat 7"
    );
    assert_eq!(
        seat_label(&SeatRef::numbers("Floor", 12, 140)),
        "Section Floor, Row 12, Seat 140"
    );
}

#[test]
fn seat_label_uses_the_labels_when_it_has_them() {
    let seat = SeatRef {
        section: "115",
        row: 1,
        seat: 7,
        row_label: Some("F"),
        seat_label: Some("7"),
    };
    assert_eq!(seat_label(&seat), "Section 115, Row F, Seat 7");
}

#[test]
fn has_ended_is_false_one_millisecond_before_the_end() {
    const END: &str = "2026-11-10T03:00:00.000Z";
    assert!(!has_ended(END, ms(END) - 1));
}

#[test]
fn has_ended_is_true_at_the_end_exactly_and_after() {
    const END: &str = "2026-11-10T03:00:00.000Z";
    assert!(has_ended(END, ms(END)));
    assert!(has_ended(END, ms(END) + 60_000));
}

#[test]
fn has_ended_is_false_for_a_time_date_cannot_read() {
    assert!(!has_ended("garbage", i64::MAX));
}

mod started_notice_034 {
    use super::*;

    // Nov 20, 2026, 7:00 PM to 10:00 PM EST.
    const START: &str = "2026-11-21T00:00:00.000Z";
    const END: &str = "2026-11-21T03:00:00.000Z";
    const AT: &str = "2026-11-21T00:30:00.000Z";
    const NY: Option<&str> = Some("America/New_York");

    #[test]
    fn says_both_sentences_while_the_customer_can_buy() {
        assert_eq!(
            started_notice(START, END, NY, AT, StartedNoticeKind::Buy),
            "This event has already started (began at 7:00 PM EST). You can still buy tickets until it ends at 10:00 PM EST."
        );
    }

    #[test]
    fn says_only_the_first_sentence_when_the_customer_cannot_buy() {
        assert_eq!(
            started_notice(START, END, NY, AT, StartedNoticeKind::First),
            "This event has already started (began at 7:00 PM EST)."
        );
    }

    #[test]
    fn says_how_long_the_tickets_admit_on_the_confirmation() {
        assert_eq!(
            started_notice(START, END, NY, AT, StartedNoticeKind::Admit),
            "This event has already started (began at 7:00 PM EST). Your tickets admit you until it ends at 10:00 PM EST."
        );
    }

    #[test]
    fn dates_an_end_on_another_local_date_than_the_reference_instant() {
        let past_midnight = "2026-11-21T06:00:00.000Z"; // Nov 21, 1:00 AM EST
        assert_eq!(
            started_notice(START, past_midnight, NY, AT, StartedNoticeKind::Buy),
            "This event has already started (began at 7:00 PM EST). You can still buy tickets until it ends at Nov 21, 2026, 1:00 AM EST."
        );
    }

    #[test]
    fn dates_a_start_on_another_local_date_once_the_venue_midnight_has_passed() {
        let after_midnight = "2026-11-21T05:30:00.000Z"; // Nov 21, 12:30 AM EST
        assert_eq!(
            started_notice(
                START,
                "2026-11-21T06:00:00.000Z",
                NY,
                after_midnight,
                StartedNoticeKind::First
            ),
            "This event has already started (began at Nov 20, 2026, 7:00 PM EST)."
        );
    }

    #[test]
    fn uses_the_venue_zone_and_eastern_when_none_is_given() {
        assert_eq!(
            started_notice(
                START,
                END,
                Some("America/Phoenix"),
                AT,
                StartedNoticeKind::First
            ),
            "This event has already started (began at 5:00 PM MST)."
        );
        assert_eq!(
            started_notice(START, END, None, AT, StartedNoticeKind::First),
            "This event has already started (began at 7:00 PM EST)."
        );
    }
}

// ------------------------------------------------------------------ times.tz.test.tsx

/// 7:00 PM to 10:00 PM local on Oct 1, 2026 at each venue: the event cards, the venue page, and
/// the event page show these texts.
#[test]
fn every_event_time_is_in_its_venue_zone() {
    for (zone, start, end, starts, ends) in [
        (
            "America/New_York",
            "2026-10-01T23:00:00.000Z",
            "2026-10-02T02:00:00.000Z",
            "Oct 1, 2026, 7:00 PM EDT",
            "Oct 1, 2026, 10:00 PM EDT",
        ),
        (
            "America/Phoenix",
            "2026-10-02T02:00:00.000Z",
            "2026-10-02T05:00:00.000Z",
            "Oct 1, 2026, 7:00 PM MST",
            "Oct 1, 2026, 10:00 PM MST",
        ),
        (
            "Pacific/Honolulu",
            "2026-10-02T05:00:00.000Z",
            "2026-10-02T08:00:00.000Z",
            "Oct 1, 2026, 7:00 PM HST",
            "Oct 1, 2026, 10:00 PM HST",
        ),
    ] {
        assert_eq!(when(start, Some(zone)), starts);
        assert_eq!(when(end, Some(zone)), ends);
    }
}

#[test]
fn a_card_reads_a_missing_zone_as_eastern() {
    assert_eq!(
        when("2026-12-02T01:00:00.000Z", None),
        "Dec 1, 2026, 8:00 PM EST"
    );
}

#[test]
fn my_tickets_shows_the_order_and_used_times_in_the_venue_zone() {
    let zone = Some("America/Phoenix");
    assert_eq!(
        when("2026-09-15T18:30:00.000Z", zone),
        "Sep 15, 2026, 11:30 AM MST"
    );
    assert_eq!(
        when("2026-10-02T01:45:00.000Z", zone),
        "Oct 1, 2026, 6:45 PM MST"
    );
}

// ------------------------------------------------------------------ doors-open.test.tsx

#[test]
fn doors_open_is_the_time_alone_on_the_start_local_date() {
    assert_eq!(
        doors_open(
            "2026-11-21T00:00:00.000Z",
            "2026-11-20T22:30:00.000Z",
            Some("America/New_York")
        ),
        "5:30 PM EST"
    );
}

#[test]
fn doors_open_has_the_date_when_doors_open_the_day_before() {
    assert_eq!(
        doors_open(
            "2026-11-20T06:00:00.000Z",
            "2026-11-20T04:30:00.000Z",
            Some("America/New_York")
        ),
        "Nov 19, 2026, 11:30 PM EST"
    );
    // A missing zone is Eastern.
    assert_eq!(
        doors_open("2026-11-20T06:00:00.000Z", "2026-11-20T04:30:00.000Z", None),
        "Nov 19, 2026, 11:30 PM EST"
    );
}

// ------------------------------------------------------------------ the rest of format.ts

#[test]
fn count_groups_thousands() {
    assert_eq!(count(0), "0");
    assert_eq!(count(999), "999");
    assert_eq!(count(1000), "1,000");
    assert_eq!(count(1_234_567), "1,234,567");
    assert_eq!(count(-1200), "-1,200");
}

#[test]
fn cents_reads_the_digits() {
    assert_eq!(cents("45.5"), Some(4550));
    assert_eq!(cents("7.059"), Some(705));
    assert_eq!(cents("12"), Some(1200));
}

#[test]
fn sum_usd_adds_prices_in_cents() {
    assert_eq!(sum_usd(&["95.00", "35.00", "35.5"]), "$165.50");
    assert_eq!(sum_usd(&["0.10", "0.20"]), "$0.30");
    assert_eq!(sum_usd(&[] as &[&str]), "$0.00");
    assert_eq!(sum_usd(&["999.99", "0.01"]), "$1,000.00");
}

#[test]
fn seat_with_price_adds_the_level_and_price() {
    let seat = SeatRef {
        section: "115",
        row: 1,
        seat: 7,
        row_label: Some("F"),
        seat_label: Some("7"),
    };
    assert_eq!(
        seat_with_price(&seat, Some("Courtside"), Some("95.00")),
        "Section 115, Row F, Seat 7, Courtside, $95.00"
    );
    let a = SeatRef::numbers("A", 1, 5);
    assert_eq!(
        seat_with_price(&a, Some("Courtside"), Some("95.00")),
        "Section A, Row 1, Seat 5, Courtside, $95.00"
    );
    assert_eq!(
        seat_with_price(&a, None, Some("95.00")),
        "Section A, Row 1, Seat 5, $95.00"
    );
    // An empty level name and an empty price are left out, as `levelName ?` and `price ?` do.
    assert_eq!(
        seat_with_price(&a, Some(""), Some("")),
        "Section A, Row 1, Seat 5"
    );
}

#[test]
fn event_price_of_a_seated_event_is_its_range() {
    assert_eq!(event_price("35.00", true, Some("95.00")), "$35–$95");
    assert_eq!(event_price("35.50", true, Some("1200.00")), "$35.50–$1,200");
    // One price when every level costs the same.
    assert_eq!(event_price("95.00", true, Some("95")), "$95");
}

#[test]
fn event_price_of_a_general_admission_event_is_its_base_price() {
    assert_eq!(event_price("45.5", false, Some("95.00")), "$45.50");
    assert_eq!(event_price("45.5", true, None), "$45.50");
    assert_eq!(event_price("45.5", true, Some("")), "$45.50");
}
