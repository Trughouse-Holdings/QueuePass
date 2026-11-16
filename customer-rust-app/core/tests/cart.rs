//! Spec 040 T047 (parity C1–C10; research R10): `core::cart`, the Cart page's rules
//! (`customer-app/src/pages/Cart.tsx`), ported from the logic of `customer-app/test/cart.test.tsx`:
//! the read schedule's decisions, entries by event and `createdAt` newest first, deadlines fixed
//! at first sight, the 1-minute warning on every tick, the event details' retries and "Details
//! unavailable", Buy tickets' outcomes, run out, vanished entries and their one `/me/orders`
//! read, and the reservations never shown again. Times are the monotonic clock's ms, passed in.

use customer_rust_core::{
    api::{
        client::{ApiError, Body, Method, StatusError, error_from},
        types::Order,
    },
    buy::RateLimitedAction,
    cart::{
        Cart, CartStatus, CartView, DETAILS_UNAVAILABLE, DetailsAnswer, EMPTY, LOADING,
        PlacedOrder, READ_EVERY_MS, ran_out_message, reservation_key,
    },
    reservation::{ONE_MINUTE_LEFT, Reservation, ReservedSeat},
};
use serde_json::json;

fn level(event_id: &str, seat: u64) -> (&'static str, &'static str) {
    match (event_id, seat) {
        ("e1", 5) => ("Courtside", "95.00"),
        ("e1", _) => ("Lower sideline", "60.00"),
        _ => ("Standard", "30.00"),
    }
}

fn reservation(event_id: &str, seats: &[u64], seconds_left: u64) -> Reservation {
    Reservation {
        event_id: event_id.into(),
        tier_id: None,
        seats: seats
            .iter()
            .map(|&n| {
                let (level_name, price) = level(event_id, n);
                ReservedSeat {
                    section_id: "s-a".into(),
                    section: "A".into(),
                    row: 1,
                    seat: n,
                    row_label: "1".into(),
                    seat_label: n.to_string(),
                    level_name: level_name.into(),
                    price: price.into(),
                }
            })
            .collect(),
        created_at: "2026-10-20T19:00:00.000Z".into(),
        seconds_left,
    }
}

fn order(event_id: &str) -> Order {
    serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-0000000000f1",
        "eventId": "00000000-0000-4000-8000-0000000000e1",
        "tierId": null, "tierName": null, "customerUsername": "customer1",
        "holderName": "Jordan Lee", "quantity": 1, "unitPrice": null, "totalPrice": "95.00",
        "status": "CONFIRMED", "createdAt": "2026-10-20T19:01:00.000Z", "refundedAt": null,
        "tickets": [],
    }))
    .map(|mut o: Order| {
        // The id says which event; only the cart's own bookkeeping reads it.
        let _ = event_id;
        o.quantity = std::num::NonZeroU64::new(1).unwrap();
        o
    })
    .unwrap()
}

fn refusal(status: u16, body: serde_json::Value) -> ApiError {
    ApiError::Status(error_from(status, body.to_string().as_bytes()))
}

fn details(name: &str) -> DetailsAnswer {
    DetailsAnswer::Found {
        name: name.into(),
        when: format!("{name}'s start"),
    }
}

/// A cart that has read `list` at `now` and the details of every event in it.
fn cart_with(list: Vec<Reservation>, now: f64) -> Cart {
    let mut cart = Cart::new();
    assert!(cart.begin_read());
    cart.on_read(Ok(list), now);
    for id in cart.details_wanted(now) {
        let name = match id.as_str() {
            "e1" => "Early Show",
            "e2" => "Late Play",
            other => other,
        }
        .to_string();
        cart.on_details(&id, details(&name), now);
    }
    cart.tick(now);
    cart
}

fn shown_names(cart: &Cart) -> Vec<String> {
    cart.shown().iter().map(|s| s.heading.clone()).collect()
}

const NO_ORDERS: Option<&[PlacedOrder]> = Some(&[]);

// ------------------------------------------------------------------------------ the cart (C1)

#[test]
fn the_words_are_the_react_apps() {
    assert_eq!(
        EMPTY,
        "Your cart is empty. Seats you hold on an event's page appear here for 5 minutes."
    );
    assert_eq!(LOADING, "Loading your cart…");
    assert_eq!(DETAILS_UNAVAILABLE, "Details unavailable");
    assert_eq!(READ_EVERY_MS, 1_000);
    assert_eq!(
        ran_out_message("Early Show"),
        "Your reservation for Early Show ran out, so its seats were released. You can hold them \
         again in 2 minutes if they are still open."
    );
    assert_eq!(
        CartStatus::Ended("Early Show".into()).text(),
        "Your reservation for Early Show ended."
    );
    assert_eq!(
        CartStatus::Bought("Early Show".into()).text(),
        "Your seats for Early Show were bought. See them in "
    );
}

#[test]
fn loading_until_the_first_read_then_empty_with_no_reservations() {
    let mut cart = Cart::new();
    assert_eq!(cart.view(), CartView::Loading);
    cart.begin_read();
    cart.on_read(Ok(vec![]), 0.0);
    assert_eq!(cart.view(), CartView::Empty);
}

#[test]
fn lists_each_reservation_newest_first_with_its_own_countdown_and_total() {
    let mut late = reservation("e2", &[3], 200);
    late.created_at = "2026-10-20T19:01:00.000Z".into();
    let cart = cart_with(vec![late, reservation("e1", &[5, 6], 120)], 0.0);
    assert_eq!(cart.view(), CartView::Entries);
    assert_eq!(shown_names(&cart), ["Late Play", "Early Show"]);
    let shown = cart.shown();
    assert_eq!(shown[1].when.as_deref(), Some("Early Show's start"));
    assert_eq!(
        shown[1].seats,
        [
            "Section A, Row 1, Seat 5, Courtside, $95.00",
            "Section A, Row 1, Seat 6, Lower sideline, $60.00"
        ]
    );
    assert_eq!(shown[1].total, "Total: $155.00");
    assert_eq!(shown[1].seconds_left, 120);
    assert_eq!(shown[0].seconds_left, 200);
    assert_eq!(shown[0].total, "Total: $30.00");
}

#[test]
fn a_reservation_is_one_entry_per_event_and_created_at() {
    let r = reservation("e1", &[5], 300);
    assert_eq!(reservation_key(&r), "e1:2026-10-20T19:00:00.000Z");
    let mut cart = cart_with(vec![r.clone()], 0.0);
    cart.tick(100_000.0);
    // A newer reservation of the event is a new entry, with its own countdown.
    let mut newer = reservation("e1", &[7], 300);
    newer.created_at = "2026-10-20T19:06:00.000Z".into();
    cart.begin_read();
    cart.on_read(Ok(vec![newer]), 100_000.0);
    cart.tick(100_000.0);
    assert_eq!(cart.shown()[0].seconds_left, 300);
}

// ------------------------------------------------------------------------------ the countdown (C5)

#[test]
fn the_deadline_is_fixed_when_the_entry_first_appears() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    // A later read says 290 again (the Backend's clock): the deadline never moves.
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5], 299)]), 10_000.0);
    cart.tick(10_000.0);
    assert_eq!(cart.shown()[0].seconds_left, 290);
}

#[test]
fn each_read_refreshes_the_seats_level_and_price() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    let mut repriced = reservation("e1", &[5], 300);
    repriced.seats[0].price = "99.00".into();
    cart.begin_read();
    cart.on_read(Ok(vec![repriced]), 1_000.0);
    assert_eq!(cart.shown()[0].total, "Total: $99.00");
}

#[test]
fn warns_at_one_minute_and_at_0_drops_the_entry_with_the_alert() {
    let mut cart = cart_with(
        vec![reservation("e1", &[5], 61), reservation("e2", &[3], 250)],
        0.0,
    );
    assert_eq!(cart.shown()[0].warning, None);
    cart.tick(1_000.0);
    let early = cart
        .shown()
        .into_iter()
        .find(|s| s.heading == "Early Show")
        .unwrap();
    assert_eq!(early.warning, Some(ONE_MINUTE_LEFT));
    cart.tick(61_000.0);
    assert_eq!(shown_names(&cart), ["Late Play"]);
    assert_eq!(
        cart.alert.as_deref(),
        Some(ran_out_message("Early Show").as_str())
    );
    assert_eq!(cart.shown()[0].seconds_left, 189);
}

#[test]
fn a_cart_opened_with_under_a_minute_left_warns_at_once() {
    let cart = cart_with(vec![reservation("e1", &[5], 45)], 0.0);
    assert_eq!(cart.shown()[0].warning, Some(ONE_MINUTE_LEFT));
}

#[test]
fn a_run_out_reservation_is_never_shown_again_even_if_a_late_read_lists_it() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 2)], 0.0);
    cart.tick(2_000.0);
    assert_eq!(cart.view(), CartView::Empty);
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5], 0)]), 2_100.0);
    assert_eq!(cart.view(), CartView::Empty);
}

// ------------------------------------------------------------------------------ reads (C2)

#[test]
fn one_read_at_a_time() {
    let mut cart = Cart::new();
    assert!(cart.begin_read());
    assert!(!cart.begin_read(), "no second read while one is in flight");
    cart.on_read(Ok(vec![reservation("e1", &[5], 300)]), 0.0);
    assert!(cart.begin_read());
}

#[test]
fn a_failed_read_waits_for_the_next() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    cart.begin_read();
    let out = cart.on_read(Err(ApiError::Unreachable), 1_000.0);
    assert!(!out.sign_in);
    assert_eq!(shown_names(&cart), ["Early Show"]);
    assert!(cart.begin_read());
}

#[test]
fn a_401_stops_the_reads_and_signs_in_again() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    cart.begin_read();
    let out = cart.on_read(
        Err(refusal(
            401,
            json!({ "error": { "code": "UNAUTHENTICATED", "message": "x" } }),
        )),
        1_000.0,
    );
    assert!(out.sign_in);
    assert!(!cart.begin_read(), "no more reads");
}

// ------------------------------------------------------------------------------ details (C3)

#[test]
fn loading_never_empty_until_the_listed_events_are_read() {
    let mut cart = Cart::new();
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5], 300)]), 0.0);
    assert_eq!(cart.details_wanted(0.0), ["e1"]);
    assert_eq!(cart.view(), CartView::Loading);
    // Asked once: not asked again while in flight.
    assert!(cart.details_wanted(500.0).is_empty());
    cart.on_details("e1", details("Early Show"), 600.0);
    assert_eq!(cart.view(), CartView::Entries);
    assert!(cart.details_wanted(5_000.0).is_empty(), "read once");
}

#[test]
fn a_deleted_event_404_is_not_listed() {
    let mut cart = Cart::new();
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5], 300)]), 0.0);
    cart.details_wanted(0.0);
    cart.on_details("e1", DetailsAnswer::Missing, 0.0);
    assert_eq!(cart.view(), CartView::Empty);
}

#[test]
fn a_failed_read_of_an_event_backs_off_1_2_4_8_then_10_s_with_the_reads() {
    let mut cart = Cart::new();
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5], 300)]), 0.0);
    let mut tries = vec![];
    // The reservations are read once a second; each read may try the event again.
    for second in 0..46 {
        let now = f64::from(second) * 1_000.0;
        for id in cart.details_wanted(now) {
            tries.push(second);
            // Each failure lands 10 ms after its request.
            cart.on_details(&id, DetailsAnswer::Failed, now + 10.0);
        }
    }
    assert_eq!(tries, [0, 2, 5, 10, 19, 30, 41]);
}

#[test]
fn after_3_failures_the_entry_shows_as_details_unavailable_and_can_still_be_bought() {
    let mut cart = Cart::new();
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5, 6], 200)]), 0.0);
    for now in [0.0, 2_000.0] {
        for id in cart.details_wanted(now) {
            cart.on_details(&id, DetailsAnswer::Failed, now + 10.0);
        }
        assert_eq!(cart.view(), CartView::Loading);
    }
    for id in cart.details_wanted(5_000.0) {
        cart.on_details(&id, DetailsAnswer::Failed, 5_010.0);
    }
    assert_eq!(cart.view(), CartView::Entries);
    let shown = cart.shown();
    assert_eq!(shown[0].heading, DETAILS_UNAVAILABLE);
    assert_eq!(shown[0].when, None);
    assert_eq!(shown[0].total, "Total: $155.00");
    // Bought without its details: the confirmation names "this event".
    let call = cart
        .press("e1", true, "Jordan Lee", || "rid".into())
        .unwrap();
    assert_eq!(call.path, "/events/e1/orders");
    cart.on_buy_answer("e1", Ok(order("e1")), 5_100.0);
    assert_eq!(cart.confirmed[0].event_name, "this event");
}

#[test]
fn a_401_reading_an_event_signs_in_and_is_not_retried() {
    let mut cart = Cart::new();
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5], 300)]), 0.0);
    cart.details_wanted(0.0);
    assert!(cart.on_details("e1", DetailsAnswer::SignedOut, 0.0));
    assert!(cart.details_wanted(20_000.0).is_empty());
}

// ------------------------------------------------------------------------------ buying (C6)

#[test]
fn buy_tickets_sends_that_reservations_seats_with_a_request_id_and_no_tier() {
    let mut cart = cart_with(vec![reservation("e1", &[5, 6], 300)], 0.0);
    let call = cart
        .press("e1", true, "Jordan Lee", || "req-1".into())
        .unwrap();
    assert_eq!(call.method, Method::Post);
    assert_eq!(
        call.body,
        Body::Json(json!({
            "holderName": "Jordan Lee", "quantity": 2, "requestId": "req-1",
            "seats": [{ "sectionId": "s-a", "row": 1, "seat": 5 },
                      { "sectionId": "s-a", "row": 1, "seat": 6 }],
        }))
    );
    // A second press before the answer sends nothing.
    assert!(
        cart.press("e1", true, "Jordan Lee", || "req-2".into())
            .is_none()
    );
    assert_eq!(cart.shown()[0].buy_text, "Buying…");
    cart.on_buy_answer("e1", Ok(order("e1")), 1_000.0);
    assert_eq!(cart.view(), CartView::Empty);
    assert_eq!(cart.confirmed.len(), 1);
    assert_eq!(cart.confirmed[0].event_name, "Early Show");
    assert_eq!(cart.confirmed[0].event_id, "e1");
    // Bought here: never shown again, even if a late read lists it.
    cart.begin_read();
    cart.on_read(Ok(vec![reservation("e1", &[5, 6], 290)]), 2_000.0);
    assert_eq!(cart.view(), CartView::Empty);
}

#[test]
fn a_tier_is_sent_when_the_reservation_has_one() {
    let mut r = reservation("e1", &[5], 300);
    r.tier_id = Some("t-1".into());
    let mut cart = cart_with(vec![r], 0.0);
    let call = cart.press("e1", true, "Jordan Lee", || "r".into()).unwrap();
    let Body::Json(body) = call.body else {
        panic!()
    };
    assert_eq!(body["tierId"], "t-1");
}

#[test]
fn buy_tickets_does_nothing_with_a_name_that_is_not_valid() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    assert!(cart.press("e1", false, "1234", || "r".into()).is_none());
    assert!(!cart.shown()[0].buy_enabled(false));
    assert!(cart.shown()[0].buy_enabled(true));
}

#[test]
fn the_unknown_outcome_keeps_the_entry_and_check_again_resends_the_same_id() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    cart.press("e1", true, "Jordan Lee", || "same".into());
    cart.on_buy_answer("e1", Err(ApiError::Unreachable), 500.0);
    assert!(cart.shown()[0].unknown);
    // Gone from a read meanwhile: kept, its purchase decides.
    cart.begin_read();
    cart.on_read(Ok(vec![]), 3_000.0);
    assert_eq!(shown_names(&cart), ["Early Show"]);
    // Check again works even with the name emptied since.
    let again = cart.press("e1", false, "", || "other".into()).unwrap();
    let Body::Json(body) = again.body else {
        panic!()
    };
    assert_eq!(body["requestId"], "same");
    cart.on_buy_answer("e1", Ok(order("e1")), 3_500.0);
    assert_eq!(cart.confirmed.len(), 1);
    assert_eq!(cart.status, None, "no 'ended' said for it");
}

#[test]
fn a_purchase_in_flight_keeps_its_entry_past_its_deadline() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 2)], 0.0);
    cart.press("e1", true, "Jordan Lee", || "r".into());
    cart.tick(3_000.0);
    assert_eq!(shown_names(&cart), ["Early Show"]);
    assert_eq!(cart.alert, None);
}

#[test]
fn a_429_starts_the_one_buy_wait_of_the_page_for_every_entry() {
    let mut cart = cart_with(
        vec![reservation("e1", &[5], 300), reservation("e2", &[3], 300)],
        0.0,
    );
    cart.press("e1", true, "Jordan Lee", || "r".into());
    cart.on_buy_answer(
        "e1",
        Err(refusal(
            429,
            json!({ "error": { "code": "RATE_LIMITED", "message": "Too many tries.",
                                "details": { "action": "BUY", "retryAfterSeconds": 2 } } }),
        )),
        0.0,
    );
    assert_eq!(
        cart.waits.text(RateLimitedAction::Buy).as_deref(),
        Some("Too many tries. You can try again in 2 seconds.")
    );
    assert_eq!(
        cart.waits.announcement(),
        Some("Too many tries. You can try again in 2 seconds.")
    );
    // Every Buy tickets does nothing until it ends.
    assert!(
        cart.press("e2", true, "Jordan Lee", || "r2".into())
            .is_none()
    );
    cart.tick(2_000.0);
    assert!(cart.waits.text(RateLimitedAction::Buy).is_none());
    assert!(
        cart.press("e2", true, "Jordan Lee", || "r2".into())
            .is_some()
    );
}

#[test]
fn ran_out_when_buying_too_late_drops_the_entry_with_the_alert() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    cart.press("e1", true, "Jordan Lee", || "r".into());
    cart.on_buy_answer(
        "e1",
        Err(refusal(
            409,
            json!({ "error": { "code": "RESERVATION_REQUIRED", "message": "ran out.",
                                "details": { "expired": true } } }),
        )),
        1_000.0,
    );
    assert_eq!(cart.view(), CartView::Empty);
    assert_eq!(
        cart.alert.as_deref(),
        Some(ran_out_message("Early Show").as_str())
    );
}

#[test]
fn a_reservation_required_without_expired_says_it_ended() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    cart.press("e1", true, "Jordan Lee", || "r".into());
    cart.on_buy_answer(
        "e1",
        Err(refusal(
            409,
            json!({ "error": { "code": "RESERVATION_REQUIRED", "message": "none." } }),
        )),
        1_000.0,
    );
    assert_eq!(cart.view(), CartView::Empty);
    assert_eq!(cart.status, Some(CartStatus::Ended("Early Show".into())));
}

#[test]
fn another_refusal_stays_in_the_entry_with_its_message() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    cart.press("e1", true, "Jordan Lee", || "r".into());
    cart.on_buy_answer(
        "e1",
        Err(refusal(
            409,
            json!({ "error": { "code": "SOLD_OUT", "message": "Sold out." } }),
        )),
        1_000.0,
    );
    assert_eq!(cart.shown()[0].notice.as_deref(), Some("Sold out."));
    cart.press("e1", true, "Jordan Lee", || "r".into());
    // A press clears it.
    assert_eq!(cart.shown()[0].notice, None);
    cart.on_buy_answer(
        "e1",
        Err(ApiError::Status(StatusError {
            status: 400,
            code: "VALIDATION_FAILED".into(),
            message: "Request failed with status 400.".into(),
            details: None,
            enveloped: false,
        })),
        2_000.0,
    );
    assert_eq!(
        cart.shown()[0].notice.as_deref(),
        Some("The purchase was refused.")
    );
}

// ------------------------------------------------------------------------------ vanished (C8)

#[test]
fn gone_within_2_s_of_its_deadline_is_the_run_out() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 3)], 0.0);
    cart.begin_read();
    let out = cart.on_read(Ok(vec![]), 1_500.0);
    assert!(out.explain.is_empty());
    assert_eq!(
        cart.alert.as_deref(),
        Some(ran_out_message("Early Show").as_str())
    );
}

#[test]
fn gone_earlier_is_explained_by_one_orders_read() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 300)], 0.0);
    cart.begin_read();
    let out = cart.on_read(Ok(vec![]), 2_000.0);
    assert_eq!(out.explain.len(), 1);
    assert_eq!(cart.view(), CartView::Empty);
    // The next read does not explain it again.
    cart.begin_read();
    assert!(cart.on_read(Ok(vec![]), 3_000.0).explain.is_empty());

    cart.explained(&out.explain[0], NO_ORDERS);
    assert_eq!(cart.status, Some(CartStatus::Ended("Early Show".into())));
}

fn placed(event_id: &str, created_at: &str, seats: &[u64]) -> PlacedOrder {
    PlacedOrder {
        event_id: event_id.into(),
        created_at: created_at.into(),
        seats: seats.iter().map(|&n| ("A".to_string(), 1, n)).collect(),
    }
}

#[test]
fn bought_elsewhere_when_a_later_order_for_the_event_holds_one_of_its_seats() {
    let r = reservation("e1", &[5], 300);
    let mut cart = cart_with(vec![r.clone()], 0.0);
    cart.explained(&r, Some(&[placed("e1", "2026-10-20T19:01:00.000Z", &[5])]));
    assert_eq!(cart.status, Some(CartStatus::Bought("Early Show".into())));
    // Placed at the same instant counts too.
    cart.explained(&r, Some(&[placed("e1", "2026-10-20T19:00:00.000Z", &[5])]));
    assert_eq!(cart.status, Some(CartStatus::Bought("Early Show".into())));
}

#[test]
fn ended_when_the_only_order_is_older_holds_none_of_its_seats_or_is_another_events() {
    let r = reservation("e1", &[5], 300);
    let mut cart = cart_with(vec![r.clone()], 0.0);
    for orders in [
        vec![placed("e1", "2026-10-20T18:00:00.000Z", &[5])],
        vec![placed("e1", "2026-10-20T19:01:00.000Z", &[])],
        vec![placed("e1", "2026-10-20T19:01:00.000Z", &[9])],
        vec![placed("e2", "2026-10-20T19:01:00.000Z", &[5])],
    ] {
        cart.explained(&r, Some(&orders));
        assert_eq!(cart.status, Some(CartStatus::Ended("Early Show".into())));
    }
    // No answer (or a 401: a quirk kept) says ended too.
    cart.explained(&r, None);
    assert_eq!(cart.status, Some(CartStatus::Ended("Early Show".into())));
}

#[test]
fn a_placed_order_reads_its_seats_from_my_orders() {
    let o: customer_rust_core::api::types::MyOrder = serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-0000000000f1",
        "eventId": "00000000-0000-4000-8000-0000000000e1",
        "tierId": null, "tierName": null, "customerUsername": "customer1",
        "holderName": "Jordan Lee", "quantity": 2, "unitPrice": null, "totalPrice": "95.00",
        "status": "CONFIRMED", "createdAt": "2026-10-20T19:01:00.000Z", "refundedAt": null,
        "tickets": [
            { "id": "00000000-0000-4000-8000-000000000001", "code": "AAAA2222BBBB",
              "status": "VALID", "checkedInAt": null, "price": "95.00", "levelName": "Courtside",
              "seat": { "section": "A", "row": 1, "seat": 5, "rowLabel": "1", "seatLabel": "5" } },
            { "id": "00000000-0000-4000-8000-000000000002", "code": "CCCC3333DDDD",
              "status": "VALID", "checkedInAt": null, "price": "95.00", "levelName": null,
              "seat": null }
        ],
        "event": {
            "id": "00000000-0000-4000-8000-0000000000e1", "name": "Early Show",
            "startsAt": "2026-12-01T23:00:00.000Z", "endsAt": "2026-12-02T02:00:00.000Z",
            "doorsOpenAt": "2026-12-01T22:00:00.000Z", "status": "SCHEDULED",
            "checkInDetailsRemovedAt": null,
            "location": { "id": "00000000-0000-4000-8000-0000000000a1", "name": "Hall",
                          "address": "1 Main St", "timeZone": "America/New_York" }
        }
    }))
    .unwrap();
    let p = PlacedOrder::from(&o);
    assert_eq!(p.event_id, "00000000-0000-4000-8000-0000000000e1");
    assert_eq!(p.created_at, "2026-10-20T19:01:00.000Z");
    assert_eq!(p.seats, [("A".to_string(), 1, 5)]);
}

#[test]
fn a_status_or_alert_stays_until_replaced() {
    let mut cart = cart_with(vec![reservation("e1", &[5], 2)], 0.0);
    cart.tick(2_000.0);
    assert!(cart.alert.is_some());
    cart.begin_read();
    cart.on_read(Ok(vec![]), 3_000.0);
    assert!(cart.alert.is_some());
}

/// Review finding 2: an entry not on screen (details unknown, or its event gone) has no
/// countdown, as React's `CartEntry` is not mounted: it never runs out on a tick.
#[test]
fn an_entry_not_shown_does_not_run_out_on_a_tick() {
    let mut cart = Cart::new();
    assert!(cart.begin_read());
    cart.on_read(Ok(vec![reservation("e1", &[1], 2)]), 0.0);
    // No details asked for or answered yet: nothing shown.
    cart.tick(5_000.0);
    assert!(cart.alert.is_none());
    assert!(cart.shown().is_empty());
}
