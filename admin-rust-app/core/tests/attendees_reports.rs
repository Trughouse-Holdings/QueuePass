//! Spec 037 (tasks T070, T071; parity A1, R1): the Attendees and Reports pages' figures, as
//! `admin-app/src/pages/Attendees.tsx` and `Reports.tsx` work them out.

use std::{fs, path::PathBuf};

use admin_rust_core::{
    api::types,
    export::rows,
    pages::attendees_reports::{
        attendee_summary, check_in_cell, count, export_input, meter_fill_style, order_levels,
        pass_cell, share, sold_cell, tier_cell, total_sold_cell,
    },
};
use serde::de::DeserializeOwned;

/// One of the React Admin app's API fixtures, decoded into its generated type.
fn fixture<T: DeserializeOwned>(name: &str) -> T {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/api/{name}.json"));
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn the_pages_read_the_generated_values_into_the_export_inputs() {
    let event: types::Event = fixture("Event");
    let input: rows::Event = export_input(&event).expect("an event fits");
    assert_eq!(input.name, *event.name);
    assert_eq!(
        input.location.time_zone.as_deref(),
        Some(event.location.time_zone.to_string().as_str())
    );
    assert_eq!(
        input.check_in_details_removed_at,
        event.check_in_details_removed_at
    );

    let order: types::Order = fixture("Order");
    let input: rows::Order = export_input(&order).expect("an order fits");
    assert_eq!(input.id, order.id.to_string());
    assert_eq!(input.customer_username, order.customer_username);
    assert_eq!(input.tickets.len(), order.tickets.len());
    for (t, generated) in input.tickets.iter().zip(&order.tickets) {
        assert_eq!(t.code, *generated.code);
        assert_eq!(t.price, *generated.price);
        assert_eq!(t.level_name, generated.level_name);
        assert_eq!(t.checked_in_at, generated.checked_in_at);
        assert_eq!(t.seat.is_some(), generated.seat.is_some());
    }

    let report: types::SalesReport = fixture("SalesReport");
    let input: rows::SalesReport = export_input(&report).expect("a report fits");
    assert_eq!(input.generated_at, report.generated_at);
    assert_eq!(input.events.len(), report.events.len());
    assert_eq!(input.totals.revenue, *report.totals.revenue);
    // Spec 041 (R8): the pass figures carry over, per event and in the totals.
    assert_eq!(
        input.totals.pass_tickets_sold,
        report.totals.pass_tickets_sold as i64
    );
    assert_eq!(input.totals.pass_revenue, *report.totals.pass_revenue);
    assert_eq!(input.events[0].pass_revenue, *report.events[0].pass_revenue);

    // Spec 041 (R8): an order bought on a pass carries its Season's name into the export.
    let mut on_pass = serde_json::to_value(&order).unwrap();
    on_pass["seasonPass"] = serde_json::json!({
        "id": "c0000000-0000-4000-8000-00000000000a",
        "seasonId": "c0000000-0000-4000-8000-00000000000c",
        "seasonName": "Louisville Hoops"
    });
    let order: types::Order = serde_json::from_value(on_pass).unwrap();
    let input: rows::Order = export_input(&order).expect("an order on a pass fits");
    assert_eq!(
        input.season_pass.map(|p| p.season_name).as_deref(),
        Some("Louisville Hoops")
    );
}

#[test]
fn the_pass_cell_names_the_season_or_is_empty() {
    // Spec 041 FR-020 (`pass-sales.test.tsx`): the attendee list's Pass column.
    assert_eq!(pass_cell(Some("Louisville Hoops")), "Louisville Hoops");
    assert_eq!(pass_cell(None), "");
}

#[test]
fn the_total_rows_sold_cell_has_the_counts() {
    // Spec 041 FR-020: the sales report's total row, under the events.
    assert_eq!(total_sold_cell(75, 300), "75 of 300");
    assert_eq!(total_sold_cell(1200, 25_000), "1,200 of 25,000");
}

#[test]
fn counts_are_grouped_as_en_us() {
    assert_eq!(count(0), "0");
    assert_eq!(count(999), "999");
    assert_eq!(count(1000), "1,000");
    assert_eq!(count(25_000), "25,000");
    assert_eq!(count(1_234_567), "1,234,567");
}

#[test]
fn share_rounds_like_math_round_and_is_0_of_nothing() {
    assert_eq!(share(0, 0), 0);
    assert_eq!(share(5, 0), 0);
    assert_eq!(share(1, 3), 33);
    assert_eq!(share(2, 3), 67);
    assert_eq!(share(1, 8), 13); // 12.5 rounds up
    assert_eq!(share(1, 200), 1); // 0.5 rounds up
    assert_eq!(share(1, 201), 0);
    assert_eq!(share(10, 10), 100);
    assert_eq!(share(12, 10), 120);
}

#[test]
fn the_meter_is_empty_at_zero_and_capped_at_100() {
    assert_eq!(meter_fill_style(0), None);
    assert_eq!(meter_fill_style(1).as_deref(), Some("width: 1%;"));
    assert_eq!(meter_fill_style(100).as_deref(), Some("width: 100%;"));
    assert_eq!(meter_fill_style(120).as_deref(), Some("width: 100%;"));
}

#[test]
fn the_attendee_summary_counts_and_leaves_out_an_unknown_check_in_count() {
    assert_eq!(
        attendee_summary(1, 1, Some(0)),
        "1 order · 1 valid ticket · 0 checked in"
    );
    assert_eq!(
        attendee_summary(2, 5, Some(3)),
        "2 orders · 5 valid tickets · 3 checked in"
    );
    assert_eq!(attendee_summary(0, 0, None), "0 orders · 0 valid tickets");
}

#[test]
fn price_levels_are_distinct_in_order() {
    assert_eq!(order_levels([None, None]), "");
    assert_eq!(
        order_levels([Some("Lower"), None, Some("Upper"), Some("Lower")]),
        "Lower, Upper"
    );
}

#[test]
fn the_tier_cell_never_calls_a_seat_general_admission() {
    assert_eq!(tier_cell(Some("VIP"), false), "VIP");
    assert_eq!(tier_cell(Some("VIP"), true), "VIP");
    assert_eq!(tier_cell(None, false), "General admission");
    assert_eq!(tier_cell(None, true), "");
}

#[test]
fn the_check_in_cell_is_a_dash_once_removed() {
    assert_eq!(check_in_cell(false, 1, 3), "1 of 3 checked in");
    assert_eq!(check_in_cell(true, 1, 3), "—");
}

#[test]
fn the_sold_cell_has_counts_and_percent() {
    assert_eq!(sold_cell(1200, 5000), "1,200 of 5,000 (24%)");
    assert_eq!(sold_cell(0, 0), "0 of 0 (0%)");
}
