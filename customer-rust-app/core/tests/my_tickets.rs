//! Spec 040 T053 (parity T1–T4, T8): My tickets and the printable ticket, ported from the logic of
//! `customer-app/test/my-tickets.test.tsx`, `check-ins-removed.test.tsx`, `print-ticket.test.tsx`,
//! `entry-code.test.tsx`' link case, and `times.tz.test.tsx`' My tickets texts. (`past-events.test.tsx`
//! checks the event list and event page: session B's.)

use customer_rust_core::api::types::MyOrder;
use customer_rust_core::my_tickets::{
    PrintState, TicketLinks, cancelled, doors_text, empty_text, holder_text, placed_text,
    print_state, removed, split, starts_text, status_text, ticket_line, ticket_links, ticket_state,
    zone,
};
use customer_rust_core::time::parse_instant;
use serde_json::{Value, json};

const K1: &str = "00000000-0000-4000-8000-0000000000a1";
const K2: &str = "00000000-0000-4000-8000-0000000000a2";

fn ticket(id: &str, code: &str, over: Value) -> Value {
    let mut t = json!({
        "id": id, "code": code, "status": "VALID", "checkedInAt": null, "seat": null,
        "price": "45.50", "levelName": null,
    });
    for (k, v) in over.as_object().unwrap() {
        t[k] = v.clone();
    }
    t
}

/// `myOrder(over)` of the React helpers: Early Show at Alpha Arena, two valid tickets.
fn my_order(over: Value) -> MyOrder {
    let mut o = json!({
        "id": "00000000-0000-4000-8000-0000000000f1",
        "eventId": "00000000-0000-4000-8000-0000000000e1",
        "tierId": null, "tierName": null, "customerUsername": "customer1",
        "holderName": "Jordan Lee", "quantity": 2, "unitPrice": "45.50", "totalPrice": "91.00",
        "status": "CONFIRMED", "createdAt": "2026-10-03T15:00:00.000Z", "refundedAt": null,
        "tickets": [ticket(K1, "AAAA2222BBBB", json!({})), ticket(K2, "CCCC3333DDDD", json!({}))],
        "event": {
            "id": "00000000-0000-4000-8000-0000000000e1", "name": "Early Show",
            "startsAt": "2026-12-01T23:00:00.000Z", "endsAt": "2026-12-02T02:00:00.000Z",
            "doorsOpenAt": "2026-12-01T22:00:00.000Z", "status": "SCHEDULED",
            "checkInDetailsRemovedAt": null,
            "location": { "id": "00000000-0000-4000-8000-0000000000b1", "name": "Alpha Arena",
                          "address": "1 ARENA PLAZA, LOUISVILLE, KY 40202",
                          "timeZone": "America/New_York" },
        },
    });
    merge(&mut o, over);
    serde_json::from_value(o).unwrap()
}

fn merge(base: &mut Value, over: Value) {
    for (k, v) in over.as_object().unwrap() {
        if v.is_object() && base[k].is_object() {
            merge(&mut base[k], v.clone());
        } else {
            base[k] = v.clone();
        }
    }
}

fn ms(iso: &str) -> i64 {
    parse_instant(iso).unwrap().timestamp_millis()
}

// ------------------------------------------------------------------ my-tickets.test.tsx

#[test]
fn an_order_card_has_every_detail_in_the_venue_zone() {
    let o = my_order(json!({}));
    assert_eq!(zone(&o), "America/New_York");
    assert_eq!(starts_text(&o), "Dec 1, 2026, 6:00 PM EST");
    assert_eq!(doors_text(&o), "5:00 PM EST");
    assert_eq!(placed_text(&o), "Oct 3, 2026, 11:00 AM EDT");
    assert_eq!(status_text(&o), "Confirmed");
    assert_eq!(holder_text(&o), "Jordan Lee");
    assert!(!cancelled(&o));
}

#[test]
fn each_ticket_reads_valid_void_or_used() {
    let o = my_order(json!({}));
    let z = zone(&o);
    assert_eq!(ticket_line(&o.tickets[0], &z, false), "AAAA2222BBBB: Valid");
    let used = my_order(json!({ "tickets": [ticket(K1, "EEEE4444FFFF",
        json!({ "checkedInAt": "2026-12-01T23:10:00.000Z" }))] }));
    assert_eq!(
        ticket_line(&used.tickets[0], &z, false),
        "EEEE4444FFFF: Used Dec 1, 2026, 6:10 PM EST"
    );
    let refunded = my_order(json!({
        "status": "REFUNDED", "refundedAt": "2026-10-04T12:00:00.000Z",
        "tickets": [ticket(K1, "GGGG5555HHHH", json!({ "status": "VOID" }))],
        "event": { "status": "CANCELLED" },
    }));
    assert_eq!(
        ticket_line(&refunded.tickets[0], &z, false),
        "GGGG5555HHHH: Void"
    );
    assert_eq!(status_text(&refunded), "Refunded");
    assert!(cancelled(&refunded));
}

#[test]
fn a_seated_ticket_shows_its_seat_level_and_price() {
    let o = my_order(json!({ "tickets": [ticket(K1, "JJJJ7777KKKK", json!({
        "seat": { "section": "A", "row": 3, "seat": 7, "rowLabel": "3", "seatLabel": "7" },
        "levelName": "Standard",
    }))] }));
    assert_eq!(
        ticket_line(&o.tickets[0], "America/New_York", false),
        "JJJJ7777KKKK, Section A, Row 3, Seat 7, Standard, $45.50: Valid"
    );
}

#[test]
fn valid_unused_tickets_offer_the_entry_code_and_print() {
    let o = my_order(json!({}));
    assert_eq!(
        ticket_links(&o.tickets[0], false, false),
        TicketLinks {
            entry_code: true,
            print: true
        }
    );
    let used = my_order(
        json!({ "tickets": [ticket(K1, "XXXX2222YYYY", json!({ "checkedInAt": "2026-12-01T23:10:00.000Z" }))] }),
    );
    assert_eq!(
        ticket_links(&used.tickets[0], false, false),
        TicketLinks {
            entry_code: false,
            print: false
        }
    );
    let void =
        my_order(json!({ "tickets": [ticket(K1, "XXXX2222YYYY", json!({ "status": "VOID" }))] }));
    assert!(!ticket_links(&void.tickets[0], false, false).print);
}

#[test]
fn no_name_on_ticket_for_an_order_from_before_017() {
    assert_eq!(
        holder_text(&my_order(json!({ "holderName": null }))),
        "No name on ticket"
    );
}

// ------------------------------------------------------------------ upcoming, then Past (030)

mod past_030 {
    use super::*;

    const NOW: &str = "2026-11-09T17:00:00.000Z";

    fn ended() -> MyOrder {
        my_order(
            json!({ "id": "00000000-0000-4000-8000-0000000000f6", "event": {
            "name": "Ended Show", "startsAt": "2026-11-09T13:00:00.000Z",
            "endsAt": "2026-11-09T16:59:00.000Z", "doorsOpenAt": "2026-11-09T12:00:00.000Z",
        } }),
        )
    }

    fn ahead() -> MyOrder {
        my_order(
            json!({ "id": "00000000-0000-4000-8000-0000000000f5", "event": {
            "name": "Coming Soon", "startsAt": "2026-11-16T17:00:00.000Z",
            "endsAt": "2026-11-16T20:00:00.000Z", "doorsOpenAt": "2026-11-16T16:00:00.000Z",
        } }),
        )
    }

    #[test]
    fn upcoming_first_then_past_keeping_every_order_in_order() {
        let orders = vec![ended(), ahead()];
        let (upcoming, past) = split(&orders, ms(NOW));
        assert_eq!(upcoming.len(), 1);
        assert_eq!(upcoming[0].event.name, "Coming Soon");
        assert_eq!(past.len(), 1);
        assert_eq!(past[0].event.name, "Ended Show");
        assert_eq!(empty_text(orders.len(), upcoming.len()), None);
    }

    #[test]
    fn an_event_is_past_from_its_end_exactly() {
        let orders = vec![ended()];
        let end = ms("2026-11-09T16:59:00.000Z");
        assert_eq!(split(&orders, end - 1).0.len(), 1);
        assert_eq!(split(&orders, end).1.len(), 1);
    }

    #[test]
    fn under_past_a_valid_unused_ticket_prints_but_offers_no_entry_code() {
        let o = ended();
        assert_eq!(
            ticket_links(&o.tickets[0], false, true),
            TicketLinks {
                entry_code: false,
                print: true
            }
        );
    }

    #[test]
    fn only_past_orders_say_no_upcoming_tickets() {
        assert_eq!(empty_text(1, 0), Some("You have no upcoming tickets."));
    }

    #[test]
    fn no_orders_say_no_tickets_yet() {
        assert_eq!(empty_text(0, 0), Some("You have no tickets yet."));
    }
}

// ------------------------------------------------------------------ check-ins-removed.test.tsx

#[test]
fn a_removed_event_reads_event_over_with_no_links() {
    let o = my_order(json!({ "event": { "checkInDetailsRemovedAt": "2026-12-09T03:00:00.000Z" } }));
    assert!(removed(&o));
    assert_eq!(
        ticket_state(&o.tickets[0], "America/New_York", true),
        "Event over"
    );
    assert_eq!(
        ticket_links(&o.tickets[0], true, true),
        TicketLinks {
            entry_code: false,
            print: false
        }
    );
    // A void ticket stays Void.
    let void =
        my_order(json!({ "tickets": [ticket(K1, "XXXX2222YYYY", json!({ "status": "VOID" }))] }));
    assert_eq!(
        ticket_state(&void.tickets[0], "America/New_York", true),
        "Void"
    );
}

#[test]
fn a_removed_event_refuses_the_printable_ticket() {
    let o = my_order(json!({ "event": { "checkInDetailsRemovedAt": "2026-12-09T03:00:00.000Z" } }));
    assert_eq!(print_state(&[o], K1), PrintState::CantPrint);
}

// ------------------------------------------------------------------ print-ticket.test.tsx

#[test]
fn the_printable_ticket_is_found_by_its_id() {
    let orders = vec![my_order(json!({}))];
    assert_eq!(
        print_state(&orders, K2),
        PrintState::Ticket {
            order: 0,
            ticket: 1
        }
    );
}

#[test]
fn an_id_that_is_not_the_callers_is_not_found() {
    assert_eq!(
        print_state(
            &[my_order(json!({}))],
            "00000000-0000-4000-8000-0000000000ff"
        ),
        PrintState::NotFound
    );
}

#[test]
fn a_used_or_void_ticket_cannot_be_printed() {
    let used = my_order(
        json!({ "tickets": [ticket(K1, "XXXX2222YYYY", json!({ "checkedInAt": "2026-12-01T23:10:00.000Z" }))] }),
    );
    assert_eq!(print_state(&[used], K1), PrintState::CantPrint);
    let void =
        my_order(json!({ "tickets": [ticket(K1, "XXXX2222YYYY", json!({ "status": "VOID" }))] }));
    assert_eq!(print_state(&[void], K1), PrintState::CantPrint);
}

// ------------------------------------------------------------------ times.tz.test.tsx

#[test]
fn my_tickets_shows_phoenix_times_in_phoenix() {
    let o = my_order(json!({
        "createdAt": "2026-09-15T18:30:00.000Z",
        "tickets": [ticket(K1, "AAAA2222BBBB", json!({ "checkedInAt": "2026-10-02T01:45:00.000Z" }))],
        "event": { "startsAt": "2026-10-02T02:00:00.000Z", "endsAt": "2026-10-02T05:00:00.000Z",
                   "doorsOpenAt": "2026-10-02T01:00:00.000Z",
                   "location": { "timeZone": "America/Phoenix" } },
    }));
    assert_eq!(starts_text(&o), "Oct 1, 2026, 7:00 PM MST");
    assert_eq!(placed_text(&o), "Sep 15, 2026, 11:30 AM MST");
    assert_eq!(
        ticket_state(&o.tickets[0], &zone(&o), false),
        "Used Oct 1, 2026, 6:45 PM MST"
    );
}
