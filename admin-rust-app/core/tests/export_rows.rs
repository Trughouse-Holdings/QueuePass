//! Spec 037 T065 (research R7, SC-004; parity A1–A3, R1–R2, X4): the export tables and file
//! names. Ports `admin-app/test/export/{attendee-rows,sales-rows,file-name}.test.ts`, the ticket
//! code details of `admin-app/test/attendees.test.tsx`, and the table and file-name parts of
//! `attendees-export.test.tsx` and `reports-export.test.tsx`. The React app's own output for the
//! fixtures (`tests/fixtures/export/expected/`, made by `scripts/export-parity-fixtures.mjs`)
//! must equal the Rust output.

use std::path::PathBuf;

use admin_rust_core::export::file_name::{ExportFormat, ReportKind, file_name, slug};
use admin_rust_core::export::made::{made_lines, parse_instant};
use admin_rust_core::export::rows::{
    Event, Order, SalesReport, Ticket, attendee_table, sales_table, ticket_details,
    ticket_status_note,
};
use admin_rust_core::export::table::{Cell, CellKind, ExportTable};
use chrono::{DateTime, TimeZone, Utc};
use serde::Deserialize;
use serde_json::Value;

// ------------------------------------------------------------------ fixtures

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/export")
}

fn read_json(path: PathBuf) -> Value {
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap()
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Input {
    #[serde(rename_all = "camelCase")]
    Attendees {
        event: Event,
        orders: Vec<Order>,
        made_at: DateTime<Utc>,
        made_by: String,
        admin_zone: String,
        kept_checked_in: Option<i64>,
    },
    #[serde(rename_all = "camelCase")]
    Sales {
        report: SalesReport,
        made_by: String,
        admin_zone: String,
    },
    Table {
        #[allow(dead_code)]
        table: ExportTable,
    },
}

fn input(name: &str) -> Input {
    serde_json::from_value(read_json(fixtures().join(format!("{name}.json")))).unwrap()
}

fn table_of(input: &Input) -> ExportTable {
    match input {
        Input::Attendees {
            event,
            orders,
            made_at,
            made_by,
            admin_zone,
            kept_checked_in,
        } => attendee_table(
            event,
            orders,
            *made_at,
            made_by,
            admin_zone,
            *kept_checked_in,
        ),
        Input::Sales {
            report,
            made_by,
            admin_zone,
        } => sales_table(report, made_by, admin_zone),
        Input::Table { table } => table.clone(),
    }
}

const PAGES: [&str; 5] = [
    "attendees",
    "attendees-removed",
    "attendees-seated",
    "sales",
    "sales-seated",
];

fn attendees() -> (Event, Vec<Order>) {
    match input("attendees") {
        Input::Attendees { event, orders, .. } => (event, orders),
        _ => unreachable!(),
    }
}

/// The React tests' `EXPORT_ORDERS`: the fixture's orders before its added edge cases.
fn export_orders() -> Vec<Order> {
    attendees().1.into_iter().take(5).collect()
}

fn sales_report() -> SalesReport {
    match input("sales") {
        Input::Sales { report, .. } => report,
        _ => unreachable!(),
    }
}

fn at(s: &str) -> DateTime<Utc> {
    parse_instant(s).unwrap()
}

const MADE_AT: &str = "2026-10-30T18:05:00.000Z";

fn t(v: &str) -> Cell {
    Cell::Text(v.into())
}
fn d(v: &str) -> Cell {
    Cell::DateTime(v.into())
}
fn m(v: &str) -> Cell {
    Cell::Money(v.into())
}
fn n(v: i64) -> Cell {
    Cell::Count(v)
}

// ------------------------------------------------------------------ parity with the React app

#[test]
fn every_table_equals_the_react_table() {
    for name in PAGES {
        let ours = serde_json::to_value(table_of(&input(name))).unwrap();
        let theirs = read_json(fixtures().join(format!("expected/{name}.table.json")));
        assert_eq!(ours, theirs, "{name}");
    }
}

#[test]
fn every_file_name_equals_the_react_file_name() {
    for name in PAGES {
        let theirs = read_json(fixtures().join(format!("expected/{name}.file-names.json")));
        for (format, ext) in [
            (ExportFormat::Csv, "csv"),
            (ExportFormat::Xlsx, "xlsx"),
            (ExportFormat::Pdf, "pdf"),
        ] {
            let ours = match input(name) {
                Input::Attendees {
                    event,
                    made_at,
                    admin_zone,
                    ..
                } => file_name(
                    ReportKind::Attendees,
                    Some(&event.name),
                    made_at,
                    &admin_zone,
                    format,
                ),
                Input::Sales {
                    report, admin_zone, ..
                } => file_name(
                    ReportKind::SalesReport,
                    None,
                    report.generated_at,
                    &admin_zone,
                    format,
                ),
                Input::Table { .. } => unreachable!(),
            };
            assert_eq!(ours, theirs[ext], "{name} {ext}");
        }
    }
}

#[test]
fn every_slug_equals_the_react_slug() {
    let cases = read_json(fixtures().join("expected/slugs.json"));
    for case in cases.as_array().unwrap() {
        assert_eq!(slug(case["name"].as_str().unwrap()), case["slug"], "{case}");
    }
}

#[test]
fn made_at_lines_and_stamps_equal_the_react_ones_in_every_zone() {
    let cases = read_json(fixtures().join("expected/made-zones.json"));
    for case in cases.as_array().unwrap() {
        let zone = case["zone"].as_str().unwrap();
        let instant = at(case["at"].as_str().unwrap());
        let made = made_lines(instant, "admin1", zone);
        assert_eq!(made.made_at, case["madeAt"], "{case}");
        assert_eq!(
            serde_json::to_value(&made.lines).unwrap(),
            case["lines"],
            "{case}"
        );
        assert_eq!(
            file_name(
                ReportKind::SalesReport,
                None,
                instant,
                zone,
                ExportFormat::Csv
            ),
            case["fileName"],
            "{case}"
        );
    }
}

// ------------------------------------------------------------------ attendee-rows.test.ts

fn table() -> ExportTable {
    let (event, _) = attendees();
    attendee_table(
        &event,
        &export_orders(),
        at(MADE_AT),
        "admin1",
        "America/New_York",
        None,
    )
}

fn removed_event() -> Event {
    let (mut event, _) = attendees();
    event.check_in_details_removed_at = Some(at("2026-11-10T03:00:00Z"));
    event
}

#[test]
fn attendee_columns_are_those_of_fr_004_in_order_with_their_kinds() {
    let columns: Vec<(String, CellKind)> = table()
        .columns
        .into_iter()
        .map(|c| (c.header, c.kind))
        .collect();
    let expected = [
        ("Order placed", CellKind::DateTime),
        ("Customer", CellKind::Text),
        ("Name on tickets", CellKind::Text),
        ("Tier", CellKind::Text),
        ("Price level", CellKind::Text),
        ("Seat", CellKind::Text),
        ("Ticket code", CellKind::Text),
        ("Ticket status", CellKind::Text),
        ("Checked in", CellKind::DateTime),
        ("Order status", CellKind::Text),
        // Spec 041 (R8): the Season of an order bought on a pass.
        ("Pass", CellKind::Text),
        ("Price", CellKind::Money),
        ("Order", CellKind::Text),
    ];
    assert_eq!(
        columns,
        expected.map(|(h, k)| (h.to_string(), k)).to_vec(),
        "columns"
    );
}

#[test]
fn attendee_rows_are_one_per_ticket_in_page_order_in_the_venue_zone() {
    let rows = table().rows;
    assert_eq!(rows.len(), 7);
    assert_eq!(
        rows[0],
        vec![
            d("2026-09-30T10:00"),
            t("customer3"),
            t("Jordan Lee"),
            t("VIP"),
            t(""),
            t(""),
            t("ABCDEFGH2345"),
            t("Valid"),
            d("2026-11-01T16:45"),
            t("Confirmed"),
            t(""),
            m("84.30"),
            t("AAAAAAAA"),
        ]
    );
    assert_eq!(rows[2][3], t("General admission"));
    // Spec 041 (R8): an order bought on a pass names its Season.
    assert_eq!(
        rows[2][9..12],
        [t("Confirmed"), t("Louisville Hoops"), m("45.00")]
    );
    // Spec 038 R17: a carried-over ticket's level is its type's name; the row by its label.
    assert_eq!(
        rows[3][3..6],
        [t("Floor"), t("Floor"), t("Section A, Row C, Seat 7")]
    );
    // R13b: a void ticket's check-in stays empty, as the page shows only "(void)".
    assert_eq!(rows[4][2], t("No name on ticket"));
    assert_eq!(rows[4][7..11], [t("Void"), d(""), t("Refunded"), t("")]);
    // Spec 038 FR-030: a seated order has no tier; each ticket names its level and own price.
    assert_eq!(
        rows[5],
        vec![
            d("2026-10-07T07:00"),
            t("customer4"),
            t("Sam Park"),
            t(""),
            t("Courtside"),
            t("Section 115, Row D, Seat 2"),
            t("BCDFGHJK2345"),
            t("Valid"),
            d(""),
            t("Confirmed"),
            t(""),
            m("95.00"),
            t("EEEEEEEE"),
        ]
    );
    assert_eq!(
        rows[6][4..7],
        [
            t("Lower sideline"),
            t("Section 115, Row F, Seat 7"),
            t("LMNPQRST6789")
        ]
    );
}

#[test]
fn a_levelled_ticket_without_a_seat_is_not_general_admission() {
    let (event, orders) = attendees();
    let balcony: Vec<Order> = orders
        .into_iter()
        .filter(|o| o.id.starts_with("33333333"))
        .collect();
    let rows = attendee_table(&event, &balcony, at(MADE_AT), "admin1", "UTC", None).rows;
    assert_eq!(rows.len(), 2);
    for row in rows {
        assert_eq!(row[3..6], [t(""), t("Balcony"), t("")]);
    }
}

#[test]
fn prices_each_ticket_at_its_own_price_whatever_the_unit_price() {
    let (event, _) = attendees();
    let mut seated = export_orders()[4].clone();
    seated.unit_price = Some("77.50".into());
    let rows = attendee_table(&event, &[seated], at(MADE_AT), "admin1", "UTC", None).rows;
    assert_eq!(
        rows.iter().map(|r| r[11].clone()).collect::<Vec<_>>(),
        [m("95.00"), m("60.00")]
    );
}

#[test]
fn prices_add_up_to_the_pages_order_totals() {
    let cents = |s: &str| -> i64 {
        let (whole, frac) = s.split_once('.').unwrap();
        whole.parse::<i64>().unwrap() * 100 + frac.parse::<i64>().unwrap()
    };
    let sum: i64 = table()
        .rows
        .iter()
        .map(|r| match &r[11] {
            Cell::Money(v) => cents(v),
            other => panic!("{other:?}"),
        })
        .sum();
    let raw = read_json(fixtures().join("attendees.json"));
    let totals: i64 = raw["orders"].as_array().unwrap()[..5]
        .iter()
        .map(|o| cents(o["totalPrice"].as_str().unwrap()))
        .sum();
    assert_eq!(sum, totals);
}

#[test]
fn names_the_event_when_and_by_whom_it_was_made_and_the_zone() {
    let t = table();
    assert_eq!(t.title, "Attendees: Export Test, Café");
    assert_eq!(t.sheet_name, "Attendees");
    assert_eq!(t.made_at, "2026-10-30T14:05:00-04:00");
    assert_eq!(
        t.subtitle,
        [
            "Made at Oct 30, 2026, 2:05 PM EDT",
            "Made by admin1",
            "Times are in Central Time (the venue's time zone).",
        ]
    );
}

#[test]
fn states_the_made_at_time_in_the_given_admin_zone() {
    let (event, _) = attendees();
    let t = attendee_table(
        &event,
        &[],
        at(MADE_AT),
        "admin1",
        "America/Los_Angeles",
        None,
    );
    assert_eq!(t.made_at, "2026-10-30T11:05:00-07:00");
    assert_eq!(t.subtitle[0], "Made at Oct 30, 2026, 11:05 AM PDT");
    assert!(t.rows.is_empty());
}

#[test]
fn reads_a_venue_without_a_zone_as_the_default_zone() {
    let (mut event, _) = attendees();
    event.location.time_zone = None;
    let orders = &export_orders()[..1];
    let t = attendee_table(&event, orders, at(MADE_AT), "admin1", "UTC", None);
    assert_eq!(t.rows[0][0], d("2026-09-30T11:00"));
    assert_eq!(
        t.subtitle[2],
        "Times are in Eastern Time (the venue's time zone)."
    );
}

const SENTENCE: &str = "Check-in details removed on Nov 9, 2026 (kept for 7 days after the event).";

#[test]
fn a_removed_event_keeps_the_checked_in_column_empty_in_every_row() {
    let t = attendee_table(
        &removed_event(),
        &export_orders(),
        at(MADE_AT),
        "admin1",
        "America/New_York",
        Some(3),
    );
    assert_eq!(t.columns[8].header, "Checked in");
    let before = table().rows;
    assert_eq!(t.rows.len(), before.len());
    for (row, was) in t.rows.iter().zip(&before) {
        assert_eq!(row[8], d(""));
        assert_eq!(row[..8], was[..8]);
        assert_eq!(row[9..], was[9..]);
    }
}

#[test]
fn a_removed_event_adds_the_sentence_and_the_kept_count() {
    let t = attendee_table(
        &removed_event(),
        &export_orders(),
        at(MADE_AT),
        "admin1",
        "America/New_York",
        Some(3),
    );
    assert_eq!(
        t.subtitle,
        [
            "Made at Oct 30, 2026, 2:05 PM EDT",
            "Made by admin1",
            SENTENCE,
            "3 tickets were checked in.",
            "Times are in Central Time (the venue's time zone).",
        ]
    );
    let big = attendee_table(&removed_event(), &[], at(MADE_AT), "a", "UTC", Some(12_345));
    assert!(
        big.subtitle
            .contains(&"12,345 tickets were checked in.".to_string())
    );
}

#[test]
fn a_removed_event_says_1_ticket_was_checked_in_for_one() {
    let t = attendee_table(&removed_event(), &[], at(MADE_AT), "admin1", "UTC", Some(1));
    assert!(t.subtitle.contains(&"1 ticket was checked in.".to_string()));
    assert!(!t.subtitle.join(" ").contains("tickets were"));
}

#[test]
fn a_removed_event_adds_only_the_sentence_when_the_count_is_unknown() {
    let t = attendee_table(
        &removed_event(),
        &export_orders(),
        at(MADE_AT),
        "admin1",
        "America/New_York",
        None,
    );
    assert!(t.subtitle.contains(&SENTENCE.to_string()));
    assert!(!t.subtitle.join(" ").contains("checked in."));
    assert_eq!(t.subtitle.len(), 4);
}

#[test]
fn an_event_not_removed_is_as_before_whatever_the_count() {
    let (event, _) = attendees();
    let t = attendee_table(
        &event,
        &export_orders(),
        at(MADE_AT),
        "admin1",
        "America/New_York",
        Some(3),
    );
    assert_eq!(t, table());
}

// ------------------------------------------------------------------ sales-rows.test.ts

#[test]
fn sales_columns_are_those_of_fr_005_in_order_with_their_kinds() {
    let t = sales_table(&sales_report(), "admin2", "America/New_York");
    let columns: Vec<(&str, CellKind)> = t
        .columns
        .iter()
        .map(|c| (c.header.as_str(), c.kind))
        .collect();
    assert_eq!(
        columns,
        [
            ("Event", CellKind::Text),
            ("Venue", CellKind::Text),
            ("Starts", CellKind::DateTime),
            ("Time zone", CellKind::Text),
            ("Status", CellKind::Text),
            ("Tickets sold", CellKind::Count),
            ("Ticket capacity", CellKind::Count),
            ("Revenue", CellKind::Money),
            // Spec 041 (R8): after Revenue.
            ("Pass tickets", CellKind::Count),
            ("Pass revenue", CellKind::Money),
            ("Checked in", CellKind::Count),
        ]
    );
}

#[test]
fn sales_rows_are_one_per_event_each_in_its_own_zone_then_total() {
    let t = sales_table(&sales_report(), "admin2", "America/New_York");
    assert_eq!(
        t.rows,
        vec![
            vec![
                t_("Season Opener"),
                t_("Yum Center"),
                d("2026-11-01T18:00"),
                t_("Eastern Time"),
                t_("Scheduled"),
                n(25),
                n(100),
                m("1321.50"),
                n(3),
                m("100.00"),
                n(12),
            ],
            vec![
                t_("Winter Gala"),
                t_("Freedom Hall"),
                d("2026-12-20T15:00"),
                t_("Pacific Time"),
                t_("Scheduled"),
                n(50),
                n(200),
                m("3000.00"),
                n(0),
                m("0.00"),
                n(0),
            ],
            vec![
                t_("Rained Out"),
                t_("Freedom Hall"),
                d("2026-10-20T19:00"),
                t_("Eastern Time"),
                t_("Cancelled"),
                n(0),
                n(50),
                m("0.00"),
                n(0),
                m("0.00"),
                n(0),
            ],
            vec![
                t_("Total"),
                t_(""),
                d(""),
                t_(""),
                t_("2 scheduled events"),
                n(75),
                n(300),
                m("4321.50"),
                n(3),
                m("100.00"),
                n(12),
            ],
        ]
    );
}

fn t_(v: &str) -> Cell {
    t(v)
}

#[test]
fn sales_is_made_at_generated_at_in_the_admin_zone() {
    let t = sales_table(&sales_report(), "admin2", "America/New_York");
    assert_eq!(t.title, "Sales report");
    assert_eq!(t.sheet_name, "Sales");
    assert_eq!(t.made_at, "2026-10-30T14:05:00-04:00");
    assert_eq!(
        t.subtitle,
        [
            "Made at Oct 30, 2026, 2:05 PM EDT",
            "Made by admin2",
            "Each event's time is in its venue's time zone (the Time zone column).",
        ]
    );
    assert_eq!(
        sales_table(&sales_report(), "admin2", "America/Chicago").made_at,
        "2026-10-30T13:05:00-05:00"
    );
}

#[test]
fn sales_says_1_scheduled_event_and_reads_a_missing_zone_as_the_default() {
    let mut one = sales_report();
    one.totals.events = 1;
    one.events.truncate(1);
    one.events[0].time_zone = None;
    let rows = sales_table(&one, "admin2", "UTC").rows;
    assert_eq!(rows[0][2], d("2026-11-01T18:00"));
    assert_eq!(rows[0][3], t("Eastern Time"));
    assert_eq!(rows[1][4], t("1 scheduled event"));
}

#[test]
fn sales_gives_a_removed_events_row_the_reports_kept_count() {
    let mut report = sales_report();
    report.events[0].checked_in = 3;
    let rows = sales_table(&report, "admin2", "America/New_York").rows;
    assert_eq!(rows[0][10], n(3));
    assert_eq!(rows[0].len(), 11);
}

#[test]
fn a_seated_event_keeps_one_row_per_event_with_the_pages_figures() {
    // reports-export.test.tsx (023 FR-005; 038 R17): no row per price level.
    let table = table_of(&input("sales-seated"));
    assert_eq!(table.rows.len(), 3 + 1);
    assert_eq!(table.rows[0][0], t("Season Opener"));
    // Spec 041: a report without pass figures (an older Backend) shows none, as `?? 0`.
    assert_eq!(
        table.rows[0][5..11],
        [n(25), n(100), m("1321.50"), n(0), m("0.00"), n(12)]
    );
    // Made in the admin's zone, whatever it is: London in October is GMT+1 (X4).
    assert_eq!(table.subtitle[0], "Made at Oct 1, 2026, 1:00 PM GMT+1");
    assert_eq!(table.subtitle[1], "Made by admin1");
}

// ------------------------------------------------------------------ file-name.test.ts

#[test]
fn names_an_attendee_list_after_the_event_and_the_made_at_time_in_the_admin_zone() {
    let made = at("2026-10-30T18:05:00Z");
    let name = |zone| {
        file_name(
            ReportKind::Attendees,
            Some("Export Test, Café"),
            made,
            zone,
            ExportFormat::Csv,
        )
    };
    assert_eq!(
        name("America/New_York"),
        "attendees-export-test-cafe-2026-10-30-1405.csv"
    );
    assert_eq!(
        name("America/Los_Angeles"),
        "attendees-export-test-cafe-2026-10-30-1105.csv"
    );
}

#[test]
fn accepts_a_made_at_time_with_an_offset_as_the_tables_carry_it() {
    let made = parse_instant("2026-10-30T14:05:00-04:00").unwrap();
    assert_eq!(
        file_name(
            ReportKind::Attendees,
            Some("Gala"),
            made,
            "America/Chicago",
            ExportFormat::Xlsx
        ),
        "attendees-gala-2026-10-30-1305.xlsx"
    );
}

#[test]
fn names_the_sales_report_without_an_event() {
    assert_eq!(
        file_name(
            ReportKind::SalesReport,
            None,
            at("2026-10-30T18:05:00Z"),
            "America/New_York",
            ExportFormat::Pdf
        ),
        "sales-report-2026-10-30-1405.pdf"
    );
}

#[test]
fn an_attendee_list_without_an_event_name_is_event() {
    assert_eq!(
        file_name(
            ReportKind::Attendees,
            None,
            at(MADE_AT),
            "UTC",
            ExportFormat::Csv
        ),
        "attendees-event-2026-10-30-1805.csv"
    );
}

#[test]
fn slug_keeps_letters_and_digits_drops_diacritics_and_joins_the_rest() {
    assert_eq!(slug("  Zoë’s  Night — Part 2!! "), "zoe-s-night-part-2");
}

#[test]
fn slug_is_event_when_nothing_is_left() {
    assert_eq!(slug("山田 — !!"), "event");
    assert_eq!(slug(""), "event");
}

#[test]
fn slug_cuts_at_60_characters_never_ending_in_a_hyphen() {
    assert_eq!(slug(&format!("{} bcd", "a".repeat(59))), "a".repeat(59));
    assert_eq!(slug(&"b".repeat(61)), "b".repeat(60));
}

#[test]
fn an_unknown_zone_is_read_as_utc() {
    let made = made_lines(at(MADE_AT), "admin1", "Not/AZone");
    assert_eq!(made.made_at, "2026-10-30T18:05:00+00:00");
    assert_eq!(made.lines[0], "Made at Oct 30, 2026, 6:05 PM UTC");
}

#[test]
fn parse_instant_reads_rfc_3339_and_refuses_anything_else() {
    assert_eq!(
        parse_instant("2026-10-30T14:05:00-04:00"),
        Some(Utc.with_ymd_and_hms(2026, 10, 30, 18, 5, 0).unwrap())
    );
    assert_eq!(parse_instant("yesterday"), None);
}

// ------------------------------------------------------------------ attendees.test.tsx (A3)

fn seated_tickets() -> Vec<Ticket> {
    export_orders()[4].tickets.clone()
}

fn line(ticket: &Ticket, unit_price: Option<&str>, removed: bool, zone: Option<&str>) -> String {
    format!(
        "{}{}{}",
        ticket.code,
        ticket_details(ticket, unit_price),
        ticket_status_note(ticket, removed, zone)
    )
}

#[test]
fn a_seated_ticket_shows_its_seat_level_and_own_price() {
    let lines: Vec<String> = seated_tickets()
        .iter()
        .map(|t| line(t, None, false, Some("America/Chicago")))
        .collect();
    assert_eq!(
        lines,
        [
            "BCDFGHJK2345 Section 115, Row D, Seat 2, Courtside, $95.00",
            "LMNPQRST6789 Section 115, Row F, Seat 7, Lower sideline, $60.00",
        ]
    );
}

#[test]
fn a_general_admission_ticket_shows_no_price_of_its_own() {
    let order = &export_orders()[0];
    let details: String = order
        .tickets
        .iter()
        .map(|t| ticket_details(t, order.unit_price.as_deref()))
        .collect();
    assert_eq!(details, "");
}

#[test]
fn a_ticket_shows_its_price_when_the_order_has_no_unit_price() {
    let mut ticket = export_orders()[0].tickets[0].clone();
    ticket.price = "1234.5".into();
    assert_eq!(ticket_details(&ticket, None), " $1,234.50");
}

#[test]
fn a_seat_without_a_level_still_shows_the_price() {
    let mut ticket = export_orders()[0].tickets[1].clone();
    ticket.seat = seated_tickets()[0].seat.clone();
    assert_eq!(
        ticket_details(&ticket, Some("84.30")),
        " Section 115, Row D, Seat 2, $84.30"
    );
}

#[test]
fn a_checked_in_ticket_shows_when_in_the_venue_zone_until_removed() {
    let ticket = &export_orders()[0].tickets[0];
    assert_eq!(
        ticket_status_note(ticket, false, Some("America/Chicago")),
        " ✓ checked in Nov 1, 2026, 4:45 PM CST"
    );
    // A response without a zone is read as Eastern Time.
    assert_eq!(
        ticket_status_note(ticket, false, None),
        " ✓ checked in Nov 1, 2026, 5:45 PM EST"
    );
    // Spec 032 FR-010: hidden once the event's check-in details are removed.
    assert_eq!(
        ticket_status_note(ticket, true, Some("America/Chicago")),
        ""
    );
    assert_eq!(
        ticket_status_note(&export_orders()[0].tickets[1], false, None),
        ""
    );
}

#[test]
fn a_void_ticket_shows_void() {
    let ticket = &export_orders()[3].tickets[0];
    assert_eq!(ticket_status_note(ticket, false, None), " (void)");
    assert_eq!(ticket_status_note(ticket, true, None), " (void)");
}
