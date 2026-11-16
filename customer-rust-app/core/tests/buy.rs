//! Spec 040 T041 (parity P7–P11, C6; spec 006, 017, 026): one purchase and the waits out of a
//! refusal for the limit, ported from the logic of `customer-app/test/purchase.test.tsx`,
//! `purchase-unavailable.test.tsx`' refusal and unknown-outcome cases, and `rate-limit.test.tsx`
//! (`use-buy.ts`: `useBuy`, `useWaits`, `limitedFor`; `packages/shared/src/rate-limit.ts`).

use customer_rust_core::api::client::{ApiError, StatusError};
use customer_rust_core::api::types::{Order, Ticket};
use customer_rust_core::buy::{
    Buy, BuyOutcome, BuyPhase, RateLimitedAction, Waits, confirm_button_text, limited_for,
    order_body, order_is_late, rate_limit_message, refusal_message, ticket_code_line,
};
use customer_rust_core::time::parse_instant;
use serde_json::{Map, Value, json};

use RateLimitedAction::{Buy as BUY, Hold as HOLD};

fn order() -> Order {
    serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-0000000000f1",
        "eventId": "00000000-0000-4000-8000-0000000000e1",
        "tierId": null,
        "tierName": null,
        "customerUsername": "customer1",
        "holderName": "Jordan Lee",
        "quantity": 2,
        "unitPrice": "45.50",
        "totalPrice": "91.00",
        "status": "CONFIRMED",
        "createdAt": "2026-10-03T15:00:00.000Z",
        "refundedAt": null,
        "tickets": [
            { "id": "00000000-0000-4000-8000-000000000001", "code": "AAAA2222BBBB", "status": "VALID",
              "checkedInAt": null, "seat": null, "price": "45.50", "levelName": null },
        ],
    }))
    .unwrap()
}

fn status(code: u16, error_code: &str, message: &str, details: Option<Value>) -> ApiError {
    ApiError::Status(StatusError {
        status: code,
        code: error_code.into(),
        message: message.into(),
        details: details.map(|d| d.as_object().cloned().unwrap_or_else(Map::new)),
        enveloped: true,
    })
}

fn limited(seconds: Value) -> ApiError {
    status(
        429,
        "RATE_LIMITED",
        "Too many tries.",
        Some(json!({ "action": "BUY", "retryAfterSeconds": seconds })),
    )
}

/// A request id maker that counts, as `crypto.randomUUID` gives a new one each time.
fn ids() -> impl FnMut() -> String {
    let mut n = 0;
    move || {
        n += 1;
        format!("req-{n}")
    }
}

// ------------------------------------------------------------------ rate-limit.ts, limitedFor

#[test]
fn the_message_says_1_second_in_the_singular() {
    assert_eq!(
        rate_limit_message(3),
        "Too many tries. You can try again in 3 seconds."
    );
    assert_eq!(
        rate_limit_message(1),
        "Too many tries. You can try again in 1 second."
    );
}

#[test]
fn limited_for_reads_the_seconds_rounded_up() {
    assert_eq!(limited_for(&limited(json!(3))), Some(3));
    assert_eq!(limited_for(&limited(json!(2.2))), Some(3));
}

#[test]
fn a_429_that_is_not_a_refusal_for_the_limit_waits_for_nothing() {
    // No retryAfterSeconds, a string, zero, another code, another status.
    assert_eq!(
        limited_for(&status(429, "RATE_LIMITED", "Slow down.", None)),
        None
    );
    assert_eq!(limited_for(&limited(json!("3"))), None);
    assert_eq!(limited_for(&limited(json!(0))), None);
    assert_eq!(limited_for(&limited(json!(-1))), None);
    assert_eq!(
        limited_for(&status(
            429,
            "VALIDATION_FAILED",
            "Slow down.",
            Some(json!({ "retryAfterSeconds": 3 }))
        )),
        None
    );
    assert_eq!(
        limited_for(&status(
            409,
            "RATE_LIMITED",
            "x",
            Some(json!({ "retryAfterSeconds": 3 }))
        )),
        None
    );
    assert_eq!(limited_for(&ApiError::Unreachable), None);
}

// ------------------------------------------------------------------ useWaits

#[test]
fn a_wait_counts_down_once_a_second_and_ends_at_0() {
    let mut w = Waits::default();
    assert!(!w.waiting());
    w.start(HOLD, 3, 1_000.0);
    assert_eq!(w.get(HOLD).map(|x| x.left), Some(3));
    assert_eq!(
        w.text(HOLD).as_deref(),
        Some(rate_limit_message(3).as_str())
    );
    assert_eq!(w.announcement(), Some(rate_limit_message(3).as_str()));
    // Checked every 250 ms: nothing changes within the second.
    assert!(!w.tick(1_250.0));
    assert!(w.tick(2_000.0));
    assert_eq!(w.get(HOLD).map(|x| x.left), Some(2));
    w.tick(3_000.0);
    assert_eq!(
        w.text(HOLD).as_deref(),
        Some("Too many tries. You can try again in 1 second.")
    );
    // The announcement stays the first message while the wait runs (said once).
    assert_eq!(w.announcement(), Some(rate_limit_message(3).as_str()));
    assert!(w.tick(4_000.0));
    assert!(w.get(HOLD).is_none());
    assert!(!w.waiting());
    assert_eq!(w.announcement(), None);
}

#[test]
fn buy_and_hold_waits_are_kept_apart() {
    let mut w = Waits::default();
    w.start(BUY, 2, 0.0);
    w.start(HOLD, 5, 0.0);
    assert!(w.get(BUY).is_some() && w.get(HOLD).is_some());
    // The announcement is the latest refusal's.
    assert_eq!(w.announcement(), Some(rate_limit_message(5).as_str()));
    w.tick(2_000.0);
    assert!(w.get(BUY).is_none());
    assert_eq!(w.get(HOLD).map(|x| x.left), Some(3));
    assert_eq!(w.announcement(), Some(rate_limit_message(5).as_str()));
    w.tick(5_000.0);
    assert!(!w.waiting());
    assert_eq!(w.announcement(), None);
}

#[test]
fn the_announcement_goes_with_its_own_wait_only() {
    let mut w = Waits::default();
    w.start(HOLD, 5, 0.0);
    w.start(BUY, 2, 0.0);
    w.tick(2_000.0);
    // The BUY wait, the latest, ended: its announcement goes though HOLD still runs.
    assert_eq!(w.announcement(), None);
    assert!(w.get(HOLD).is_some());
}

// ------------------------------------------------------------------ useBuy (purchase.test.tsx)

#[test]
fn the_first_press_makes_a_request_id_and_a_second_press_sends_nothing() {
    let mut b = Buy::default();
    let w = Waits::default();
    let mut next = ids();
    assert_eq!(b.press(&w, &mut next).as_deref(), Some("req-1"));
    assert_eq!(b.phase(), &BuyPhase::Confirming { checking: false });
    assert_eq!(confirm_button_text(b.phase()), "Confirming…");
    assert_eq!(b.press(&w, &mut next), None);
}

#[test]
fn a_confirmed_order_is_done() {
    let mut b = Buy::default();
    let mut w = Waits::default();
    b.press(&w, ids());
    let out = b.answer(Ok(order()), &mut w, 0.0);
    assert!(matches!(out, BuyOutcome::Done(_)));
    assert!(matches!(b.phase(), BuyPhase::Done(_)));
}

#[test]
fn the_body_sends_the_tier_name_quantity_and_request_id() {
    let tier = "00000000-0000-4000-8000-00000000000b".parse().unwrap();
    assert_eq!(
        order_body(Some(&tier), "Jordan Lee", 3, "req-1"),
        json!({ "tierId": "00000000-0000-4000-8000-00000000000b", "holderName": "Jordan Lee",
                "quantity": 3, "requestId": "req-1" })
    );
    // No tier: omitted, not null.
    let body = order_body(None, "Jordan Lee", 1, "req-1");
    assert!(body.get("tierId").is_none());
    assert_eq!(body["quantity"], 1);
}

// ------------------------------------------------------------------ purchase-unavailable

#[test]
fn a_refusal_ends_the_purchase_and_the_next_press_is_a_new_one() {
    let mut b = Buy::default();
    let mut w = Waits::default();
    let mut next = ids();
    b.press(&w, &mut next);
    let refusal = status(
        409,
        "SOLD_OUT",
        "Only 1 ticket is left for Early Show; 2 were requested.",
        None,
    );
    let out = b.answer(Err(refusal.clone()), &mut w, 0.0);
    assert_eq!(out, BuyOutcome::Refused(refusal.clone()));
    assert_eq!(
        refusal_message(&refusal),
        "Only 1 ticket is left for Early Show; 2 were requested."
    );
    assert_eq!(b.phase(), &BuyPhase::Choosing);
    assert_eq!(b.press(&w, &mut next).as_deref(), Some("req-2"));
}

#[test]
fn a_refusal_without_the_envelope_says_the_request_was_refused() {
    let bare = ApiError::Status(StatusError {
        status: 400,
        code: "VALIDATION_FAILED".into(),
        message: "Request failed with status 400.".into(),
        details: None,
        enveloped: false,
    });
    assert_eq!(refusal_message(&bare), "The request was refused.");
}

#[test]
fn a_401_goes_back_through_sign_in_with_no_outcome_shown() {
    let mut b = Buy::default();
    let mut w = Waits::default();
    b.press(&w, ids());
    let out = b.answer(Err(status(401, "UNAUTHENTICATED", "x", None)), &mut w, 0.0);
    assert_eq!(out, BuyOutcome::SignedOut);
    assert_eq!(b.phase(), &BuyPhase::Choosing);
    assert!(!b.shows_unknown());
}

#[test]
fn no_answer_or_a_server_error_is_the_unknown_outcome_and_check_again_repeats_the_id() {
    for failure in [
        ApiError::Unreachable,
        status(500, "NOT_FOUND", "x", None),
        ApiError::Decode("bad".into()),
    ] {
        let mut b = Buy::default();
        let mut w = Waits::default();
        let mut next = ids();
        let first = b.press(&w, &mut next).unwrap();
        assert_eq!(b.answer(Err(failure), &mut w, 0.0), BuyOutcome::Unknown);
        assert_eq!(b.phase(), &BuyPhase::Unknown);
        assert!(b.shows_unknown());
        // Check again: the box stays mounted while it runs.
        let second = b.press(&w, &mut next).unwrap();
        assert_eq!(second, first);
        assert_eq!(b.phase(), &BuyPhase::Confirming { checking: true });
        assert!(b.shows_unknown());
        assert!(matches!(
            b.answer(Ok(order()), &mut w, 0.0),
            BuyOutcome::Done(_)
        ));
    }
}

#[test]
fn a_change_to_what_is_bought_starts_a_new_purchase() {
    let mut b = Buy::default();
    let mut w = Waits::default();
    let mut next = ids();
    b.press(&w, &mut next);
    b.answer(Err(ApiError::Unreachable), &mut w, 0.0);
    b.reset();
    assert_eq!(b.press(&w, &mut next).as_deref(), Some("req-2"));
}

// ------------------------------------------------------------------ rate-limit.test.tsx

#[test]
fn a_buy_refused_for_the_limit_waits_keeping_the_purchase() {
    let mut b = Buy::default();
    let mut w = Waits::default();
    let mut next = ids();
    let first = b.press(&w, &mut next).unwrap();
    assert_eq!(
        b.answer(Err(limited(json!(2))), &mut w, 10_000.0),
        BuyOutcome::Limited
    );
    assert_eq!(b.phase(), &BuyPhase::Choosing);
    assert_eq!(w.get(BUY).map(|x| x.left), Some(2));
    assert!(w.get(HOLD).is_none());
    // Waiting, the buying buttons do nothing.
    assert_eq!(b.press(&w, &mut next), None);
    w.tick(11_000.0);
    assert_eq!(
        w.text(BUY).as_deref(),
        Some("Too many tries. You can try again in 1 second.")
    );
    w.tick(12_000.0);
    assert!(w.get(BUY).is_none());
    // The same purchase, the same id.
    assert_eq!(b.press(&w, &mut next), Some(first));
}

#[test]
fn check_again_refused_for_the_limit_stays_unknown_then_repeats_the_same_id() {
    let mut b = Buy::default();
    let mut w = Waits::default();
    let mut next = ids();
    let first = b.press(&w, &mut next).unwrap();
    b.answer(Err(ApiError::Unreachable), &mut w, 0.0);
    assert_eq!(b.press(&w, &mut next).as_deref(), Some(first.as_str()));
    assert_eq!(
        b.answer(Err(limited(json!(2))), &mut w, 0.0),
        BuyOutcome::Limited
    );
    assert_eq!(b.phase(), &BuyPhase::Unknown);
    assert!(b.shows_unknown());
    w.tick(2_000.0);
    assert_eq!(b.press(&w, &mut next), Some(first));
}

#[test]
fn a_hold_wait_does_not_hold_back_buying() {
    let mut b = Buy::default();
    let mut w = Waits::default();
    w.start(HOLD, 30, 0.0);
    assert!(b.press(&w, ids()).is_some());
}

// ------------------------------------------------------------------ OrderConfirmation

#[test]
fn ticket_codes_with_their_seats() {
    let general: Ticket = serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-000000000001", "code": "AAAA2222BBBB", "status": "VALID",
        "checkedInAt": null, "seat": null, "price": "45.50", "levelName": null,
    }))
    .unwrap();
    assert_eq!(ticket_code_line(&general), "AAAA2222BBBB");
    let seated: Ticket = serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-000000000002", "code": "CCCC3333DDDD", "status": "VALID",
        "checkedInAt": null, "price": "95.00", "levelName": "Courtside",
        "seat": { "section": "115", "row": 1, "seat": 7, "rowLabel": "F", "seatLabel": "7" },
    }))
    .unwrap();
    assert_eq!(
        ticket_code_line(&seated),
        "CCCC3333DDDD, Section 115, Row F, Seat 7, Courtside, $95.00"
    );
}

#[test]
fn an_order_is_late_from_the_start_on() {
    let start = parse_instant("2026-11-21T00:00:00.000Z").unwrap();
    assert!(!order_is_late(
        parse_instant("2026-11-20T23:59:59.999Z").unwrap(),
        start
    ));
    assert!(order_is_late(start, start));
    assert!(order_is_late(
        parse_instant("2026-11-21T00:30:00.000Z").unwrap(),
        start
    ));
}
