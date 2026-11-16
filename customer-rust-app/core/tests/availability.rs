//! Spec 040 T039 (parity P1–P6, E6, E7): what the Get tickets panel shows from the Backend's
//! answers, ported from the logic of `customer-app/test/purchase-unavailable.test.tsx`,
//! `started-notice.test.tsx`, `ticket-limit.test.tsx`, `purchase.test.tsx`' choosing cases, and
//! `doors-open.test.tsx`' panel cases (the panel's times are the venue's, `format.rs`).

use customer_rust_core::api::types::{Availability, TicketTier};
use customer_rust_core::availability::{
    MAX_QUANTITY, MAX_SEATS, PanelBody, base_line, can_confirm, closed_badge, closed_text,
    from_price, limit_binds, limit_full_note, limit_line, max_quantity, max_seats_note, panel_body,
    reached_text, seats_left_label, started_note, tickets, tickets_left_for, tier_choice,
    tier_left, total_line, unit_price,
};
use customer_rust_core::time::parse_instant;
use serde_json::{Value, json};
use uuid::Uuid;

const E1: &str = "00000000-0000-4000-8000-0000000000e1";
const T_GENERAL: &str = "00000000-0000-4000-8000-00000000000a";
const T_VIP: &str = "00000000-0000-4000-8000-00000000000b";

fn id(s: &str) -> Uuid {
    s.parse().unwrap()
}

/// `availability(over)` of the React helpers: open, 100 left, not in progress, no limit.
fn avail(over: Value) -> Availability {
    let mut base = json!({
        "eventId": E1,
        "ticketsLeft": 100,
        "salesClosed": null,
        "inProgress": false,
        "tiers": [],
        "customerLimit": null,
    });
    for (k, v) in over.as_object().unwrap() {
        base[k] = v.clone();
    }
    serde_json::from_value(base).unwrap()
}

/// `limit(remaining, limit = 8)`.
fn limit(remaining: u64, of: u64) -> Value {
    json!({ "limit": of, "held": of - remaining, "remaining": remaining })
}

fn tier(tier_id: &str, name: &str, price: &str) -> TicketTier {
    serde_json::from_value(json!({
        "id": tier_id,
        "eventId": E1,
        "name": name,
        "price": price,
        "quantity": 100,
        "createdAt": "2026-09-01T12:00:00.000Z",
        "updatedAt": "2026-09-01T12:00:00.000Z",
    }))
    .unwrap()
}

fn tiered() -> (Availability, Vec<TicketTier>) {
    (
        avail(json!({
            "ticketsLeft": 56,
            "tiers": [
                { "tierId": T_GENERAL, "ticketsLeft": 50 },
                { "tierId": T_VIP, "ticketsLeft": 6 },
            ],
        })),
        vec![
            tier(T_GENERAL, "General", "19.99"),
            tier(T_VIP, "VIP", "120.00"),
        ],
    )
}

// ------------------------------------------------------------------ purchase-unavailable

#[test]
fn a_sold_out_tier_is_named_and_badged() {
    let a = avail(json!({ "ticketsLeft": 5, "tiers": [{ "tierId": T_VIP, "ticketsLeft": 0 }] }));
    let vip = tier(T_VIP, "VIP", "120.00");
    assert_eq!(tier_left(&a, &id(T_VIP)), 0);
    assert_eq!(tier_choice(&vip, 0), "VIP, $120.00, sold out");
    // A tier the answer does not list has none left.
    assert_eq!(tier_left(&a, &id(T_GENERAL)), 0);
}

#[test]
fn an_event_with_no_tickets_left_is_sold_out_with_no_form() {
    let a = avail(json!({ "ticketsLeft": 0 }));
    assert_eq!(closed_badge(&a), "Sold out");
    assert_eq!(
        closed_text(&a),
        Some("Sold out: no tickets are left for this event.")
    );
    assert_eq!(
        panel_body(&a, false),
        PanelBody::Closed {
            badge: "Sold out",
            text: "Sold out: no tickets are left for this event."
        }
    );
}

#[test]
fn the_quantity_stops_at_the_tickets_left() {
    let a = avail(json!({ "ticketsLeft": 3 }));
    assert_eq!(max_quantity(&a, None), 3);
}

#[test]
fn a_cancelled_event_offers_no_form() {
    let a = avail(json!({ "salesClosed": "CANCELLED" }));
    assert_eq!(closed_badge(&a), "Cancelled");
    assert_eq!(
        closed_text(&a),
        Some("No tickets: this event has been cancelled.")
    );
}

#[test]
fn an_ended_event_says_sales_closed() {
    let a = avail(json!({ "salesClosed": "ENDED" }));
    assert_eq!(closed_badge(&a), "Sales closed");
    assert_eq!(closed_text(&a), Some("Sales closed: this event has ended."));
}

#[test]
fn an_open_event_has_no_closed_text_and_the_unreachable_badge_branch() {
    // Quirk kept (E7): the badge's "Not on sale" branch, which never shows.
    let a = avail(json!({}));
    assert_eq!(closed_text(&a), None);
    assert_eq!(closed_badge(&a), "Not on sale");
    assert_eq!(panel_body(&a, false), PanelBody::Form);
}

// ------------------------------------------------------------------ purchase.test.tsx (choosing)

#[test]
fn each_tier_with_its_price_and_tickets_left() {
    let (a, tiers) = tiered();
    assert_eq!(
        tier_choice(&tiers[0], tier_left(&a, &tiers[0].id)),
        "General, $19.99, 50 left"
    );
    assert_eq!(
        tier_choice(&tiers[1], tier_left(&a, &tiers[1].id)),
        "VIP, $120.00, 6 left"
    );
    assert_eq!(
        tier_choice(&tier(T_VIP, "VIP", "1.00"), 1234),
        "VIP, $1.00, 1,234 left"
    );
}

#[test]
fn with_tiers_a_price_is_known_only_once_one_is_chosen() {
    let (_, tiers) = tiered();
    assert_eq!(unit_price(&tiers, None, "45.50"), None);
    assert_eq!(
        unit_price(&tiers, Some(&id(T_VIP)), "45.50"),
        Some("120.00")
    );
    assert_eq!(unit_price(&[], None, "45.50"), Some("45.50"));
}

#[test]
fn without_tiers_the_base_price_each() {
    assert_eq!(base_line("45.5", 7), "$45.50 each, 7 left");
    assert_eq!(base_line("45.50", 22_090), "$45.50 each, 22,090 left");
}

#[test]
fn from_is_the_lowest_tier_price_in_cents() {
    let (_, tiers) = tiered();
    assert_eq!(from_price(&tiers).as_deref(), Some("From $19.99"));
    assert_eq!(from_price(&[]), None);
    // Compared in cents, not as text ("10.00" < "9.50" as text).
    let t = vec![tier(T_VIP, "B", "10.00"), tier(T_GENERAL, "A", "9.50")];
    assert_eq!(from_price(&t).as_deref(), Some("From $9.50"));
}

#[test]
fn quantity_is_1_up_to_the_smaller_of_10_and_the_tickets_left() {
    let (a, _) = tiered();
    assert_eq!(MAX_QUANTITY, 10);
    assert_eq!(tickets_left_for(&a, Some(&id(T_VIP))), 6);
    assert_eq!(max_quantity(&a, Some(&id(T_VIP))), 6);
    assert_eq!(max_quantity(&a, Some(&id(T_GENERAL))), 10);
    // No tier chosen: the event's tickets left.
    assert_eq!(tickets_left_for(&a, None), 56);
    // Never below 1.
    assert_eq!(max_quantity(&avail(json!({ "ticketsLeft": 0 })), None), 1);
}

#[test]
fn the_total_is_exact() {
    assert_eq!(total_line("19.99", 3), "Total: $59.97");
}

#[test]
fn confirm_needs_a_price_tickets_a_name_and_no_confirmation_running() {
    assert!(can_confirm(Some("19.99"), 5, 1, true, true));
    assert!(!can_confirm(None, 5, 1, true, true));
    assert!(!can_confirm(Some("19.99"), 0, 1, true, true));
    assert!(!can_confirm(Some("19.99"), 5, 0, true, true));
    assert!(!can_confirm(Some("19.99"), 5, 1, false, true));
    assert!(!can_confirm(Some("19.99"), 5, 1, true, false));
}

// ------------------------------------------------------------------ ticket-limit.test.tsx

#[test]
fn says_the_limit_and_how_many_more_and_offers_up_to_that_many() {
    let a = avail(json!({ "customerLimit": limit(8, 8) }));
    assert_eq!(
        limit_line(&a).as_deref(),
        Some("Limit: 8 tickets per customer. You can get 8 more.")
    );
    assert_eq!(max_quantity(&a, None), 8);
}

#[test]
fn offers_no_more_than_the_customer_may_still_get() {
    let a = avail(json!({ "customerLimit": limit(3, 8) }));
    assert_eq!(
        limit_line(&a).as_deref(),
        Some("Limit: 8 tickets per customer. You can get 3 more.")
    );
    assert_eq!(max_quantity(&a, None), 3);
}

#[test]
fn the_tickets_left_win_when_fewer() {
    let a = avail(json!({ "ticketsLeft": 2, "customerLimit": limit(5, 8) }));
    assert_eq!(max_quantity(&a, None), 2);
}

#[test]
fn the_per_order_cap_wins_when_smaller() {
    let a = avail(json!({ "customerLimit": limit(20, 20) }));
    assert_eq!(max_quantity(&a, None), 10);
}

#[test]
fn one_ticket_in_the_singular() {
    assert_eq!(tickets(1), "1 ticket");
    assert_eq!(tickets(4), "4 tickets");
    let a = avail(json!({ "customerLimit": limit(1, 1) }));
    assert_eq!(
        limit_line(&a).as_deref(),
        Some("Limit: 1 ticket per customer. You can get 1 more.")
    );
}

#[test]
fn at_the_limit_the_reached_box_replaces_the_form() {
    let a = avail(json!({ "customerLimit": limit(0, 8) }));
    assert_eq!(
        reached_text(&a).as_deref(),
        Some("You have reached the limit of 8 tickets for this event.")
    );
    assert_eq!(
        panel_body(&a, false),
        PanelBody::Reached("You have reached the limit of 8 tickets for this event.".into())
    );
    // A reservation keeps the form (the seated panel's held seats).
    assert_eq!(panel_body(&a, true), PanelBody::Form);
}

#[test]
fn the_sold_out_and_cancelled_messages_come_first() {
    let sold = avail(json!({ "ticketsLeft": 0, "customerLimit": limit(0, 8) }));
    assert_eq!(reached_text(&sold), None);
    assert!(matches!(
        panel_body(&sold, false),
        PanelBody::Closed {
            badge: "Sold out",
            ..
        }
    ));
    let cancelled = avail(json!({ "salesClosed": "CANCELLED", "customerLimit": limit(0, 8) }));
    assert_eq!(reached_text(&cancelled), None);
    assert!(matches!(
        panel_body(&cancelled, false),
        PanelBody::Closed {
            badge: "Cancelled",
            ..
        }
    ));
}

#[test]
fn without_a_limit_no_line() {
    let a = avail(json!({ "ticketsLeft": 7 }));
    assert_eq!(limit_line(&a), None);
    assert_eq!(max_quantity(&a, None), 7);
    // A missing `customerLimit` reads as none.
    let missing: Availability = serde_json::from_value(json!({
        "eventId": E1, "ticketsLeft": 7, "salesClosed": null, "inProgress": false, "tiers": [],
    }))
    .unwrap();
    assert_eq!(limit_line(&missing), None);
}

#[test]
fn seats_stop_at_the_limit_and_say_why() {
    let a = avail(json!({ "ticketsLeft": 6, "customerLimit": limit(2, 3) }));
    assert!(limit_binds(&a, None));
    assert_eq!(
        limit_full_note(&a).as_deref(),
        Some("No more seats can be chosen: the limit of 3 tickets per customer allows you 2 more.")
    );
}

#[test]
fn the_limit_is_not_blamed_when_it_ties_with_the_seats_left() {
    let a = avail(json!({ "ticketsLeft": 2, "customerLimit": limit(2, 3) }));
    assert!(!limit_binds(&a, None));
    let none = avail(json!({ "ticketsLeft": 2 }));
    assert!(!limit_binds(&none, None));
    // Above the per-order cap the cap binds, not the limit.
    let big = avail(json!({ "ticketsLeft": 50, "customerLimit": limit(11, 20) }));
    assert!(!limit_binds(&big, None));
}

#[test]
fn seated_texts() {
    assert_eq!(MAX_SEATS, 10);
    assert_eq!(max_seats_note(), "A reservation holds at most 10 seats.");
    assert_eq!(seats_left_label(1), "Seat left");
    assert_eq!(seats_left_label(0), "Seats left");
    assert_eq!(seats_left_label(2), "Seats left");
}

// ------------------------------------------------------------------ started-notice.test.tsx

mod started_034 {
    use super::*;

    // Nov 20, 2026, 7:00 PM to 10:00 PM EST at the venue (New York).
    const START: &str = "2026-11-21T00:00:00.000Z";
    const END: &str = "2026-11-21T03:00:00.000Z";
    const NY: Option<&str> = Some("America/New_York");
    const STARTED: &str = "This event has already started (began at 7:00 PM EST).";

    fn during() -> i64 {
        parse_instant(START).unwrap().timestamp_millis() + 30 * 60_000
    }

    fn note(a: &Availability, has_reservation: bool) -> Option<String> {
        started_note(a, START, END, NY, during(), has_reservation)
    }

    #[test]
    fn says_the_event_started_and_until_when_tickets_are_on_sale() {
        let a = avail(json!({ "inProgress": true }));
        assert_eq!(
            note(&a, false).as_deref(),
            Some(
                "This event has already started (began at 7:00 PM EST). You can still buy tickets until it ends at 10:00 PM EST."
            )
        );
    }

    #[test]
    fn dates_an_end_past_the_venue_midnight() {
        let a = avail(json!({ "inProgress": true }));
        assert_eq!(
            started_note(&a, START, "2026-11-21T06:00:00.000Z", NY, during(), false).as_deref(),
            Some(
                "This event has already started (began at 7:00 PM EST). You can still buy tickets until it ends at Nov 21, 2026, 1:00 AM EST."
            )
        );
    }

    #[test]
    fn no_notice_for_an_event_not_yet_started() {
        assert_eq!(note(&avail(json!({ "inProgress": false })), false), None);
    }

    #[test]
    fn only_the_first_sentence_when_sold_out() {
        let a = avail(json!({ "inProgress": true, "ticketsLeft": 0 }));
        assert_eq!(note(&a, false).as_deref(), Some(STARTED));
    }

    #[test]
    fn only_the_first_sentence_at_the_limit_without_a_reservation() {
        let a = avail(json!({ "inProgress": true, "customerLimit": limit(0, 2) }));
        assert_eq!(note(&a, false).as_deref(), Some(STARTED));
        // With held seats the form stays, so both sentences.
        assert!(note(&a, true).unwrap().contains("You can still buy"));
    }

    #[test]
    fn a_cancelled_event_in_progress_shows_no_notice() {
        let a = avail(json!({ "inProgress": true, "salesClosed": "CANCELLED" }));
        assert_eq!(note(&a, false), None);
    }

    #[test]
    fn an_ended_event_shows_no_notice() {
        let a = avail(json!({ "inProgress": false, "salesClosed": "ENDED" }));
        assert_eq!(note(&a, false), None);
    }

    #[test]
    fn the_start_is_dated_once_the_answer_came_after_the_venue_midnight() {
        let a = avail(json!({ "inProgress": true }));
        let after_midnight = parse_instant("2026-11-21T05:30:00.000Z")
            .unwrap()
            .timestamp_millis();
        assert_eq!(
            started_note(
                &a,
                START,
                "2026-11-21T06:00:00.000Z",
                NY,
                after_midnight,
                false
            )
            .as_deref(),
            Some(
                "This event has already started (began at Nov 20, 2026, 7:00 PM EST). You can still buy tickets until it ends at 1:00 AM EST."
            )
        );
    }
}
