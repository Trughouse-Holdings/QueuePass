//! Spec 040 T045 (parity M10, research R10): `core::hold_queue`, ported from the queue cases of
//! `customer-app/test/seat-hold-click.test.tsx` (`use-hold-queue.ts`): one request at a time, in
//! click order; a click on a queued unsent action cancels it; a click on a seat in flight queues
//! the opposite; refused or unanswered drops the opposite queued behind it; a hold refused for the
//! limit drops every queued hold (and that seat's queued release); a 401 clears the queue.

use customer_rust_core::{
    api::client::{ApiError, Body, Method, StatusError, error_from},
    hold_queue::{ChosenSeat, HoldAnswer, HoldQueue, SeatAction, limited_for, place_key},
    reservation::{Reservation, ReservedSeat},
};
use serde_json::json;

fn seat(n: u64) -> ChosenSeat {
    ChosenSeat {
        section_id: "s-a".into(),
        section: "A".into(),
        row: 1,
        seat: n,
        row_label: Some("1".into()),
        seat_label: Some(n.to_string()),
    }
}

fn reservation(seats: &[u64]) -> Reservation {
    Reservation {
        event_id: "e1".into(),
        tier_id: None,
        seats: seats
            .iter()
            .map(|&n| ReservedSeat {
                section_id: "s-a".into(),
                section: "A".into(),
                row: 1,
                seat: n,
                row_label: "1".into(),
                seat_label: n.to_string(),
                level_name: "Standard".into(),
                price: "40.00".into(),
            })
            .collect(),
        created_at: "2026-10-20T19:00:00.000Z".into(),
        seconds_left: 300,
    }
}

fn done(seats: &[u64]) -> HoldAnswer {
    HoldAnswer::Done {
        reservation: Some(reservation(seats)),
        created: false,
    }
}

fn refusal(status: u16, body: serde_json::Value) -> ApiError {
    ApiError::Status(error_from(status, body.to_string().as_bytes()))
}

/// "hold 3", "release 6": what was sent, as the React test's `sent` lists it.
fn said(a: &customer_rust_core::hold_queue::QueuedAction) -> String {
    let verb = match a.kind {
        SeatAction::Hold => "hold",
        SeatAction::Release => "release",
    };
    format!("{verb} {}", a.seat.seat)
}

#[test]
fn a_seats_key_is_its_section_row_and_seat() {
    assert_eq!(place_key("s-a", 1, 5), "s-a-1-5");
    assert_eq!(seat(5).key(), "s-a-1-5");
}

#[test]
fn a_click_on_an_open_seat_sends_one_hold_of_that_seat() {
    let mut q = HoldQueue::new();
    let send = q.click(seat(5), false).expect("sent at once");
    assert_eq!(said(&send), "hold 5");
    let call = send.call("e1");
    assert_eq!(call.method, Method::Post);
    assert_eq!(call.path, "/events/e1/reservation");
    assert_eq!(
        call.body,
        Body::Json(json!({ "seats": [{ "sectionId": "s-a", "row": 1, "seat": 5 }] }))
    );
    assert!(q.busy());
}

#[test]
fn a_click_on_a_held_seat_sends_one_release() {
    let mut q = HoldQueue::new();
    let send = q.click(seat(6), true).unwrap();
    assert_eq!(said(&send), "release 6");
    let call = send.call("e1");
    assert_eq!(call.path, "/events/e1/reservation/release");
    assert_eq!(
        call.body,
        Body::Json(json!({ "seats": [{ "sectionId": "s-a", "row": 1, "seat": 6 }] }))
    );
}

#[test]
fn three_quick_clicks_are_sent_one_after_another_in_click_order() {
    let mut q = HoldQueue::new();
    let first = q.click(seat(3), false).unwrap();
    assert!(q.click(seat(1), false).is_none());
    assert!(q.click(seat(2), false).is_none());
    assert_eq!(said(&first), "hold 3");
    // Pending seats show as they will be: holding.
    let pending = q.pending();
    for n in [3, 1, 2] {
        assert_eq!(pending.get(&seat(n).key()), Some(&SeatAction::Hold));
    }

    let a = q.answer(&done(&[3])).unwrap();
    assert_eq!(said(&a.action), "hold 3");
    assert_eq!(said(a.next.as_ref().unwrap()), "hold 1");
    let a = q.answer(&done(&[3, 1])).unwrap();
    assert_eq!(said(a.next.as_ref().unwrap()), "hold 2");
    let a = q.answer(&done(&[3, 1, 2])).unwrap();
    assert!(a.next.is_none());
    assert!(!q.busy());
    assert!(q.pending().is_empty());
}

#[test]
fn a_second_click_on_a_queued_unsent_hold_cancels_it() {
    let mut q = HoldQueue::new();
    q.click(seat(3), false).unwrap();
    assert!(q.click(seat(4), false).is_none());
    assert!(q.click(seat(4), false).is_none());
    // Seat 4 shows open again: nothing pending for it.
    assert_eq!(q.pending().get(&seat(4).key()), None);
    let a = q.answer(&done(&[3])).unwrap();
    assert!(a.next.is_none(), "nothing is sent for seat 4");
}

#[test]
fn a_click_on_a_seat_in_flight_queues_the_opposite_sent_after_the_answer() {
    let mut q = HoldQueue::new();
    q.click(seat(3), false).unwrap();
    // The page shows it holding, so isHeld would say no; the queue looks at the flight.
    assert!(q.click(seat(3), false).is_none());
    assert_eq!(q.pending().get(&seat(3).key()), Some(&SeatAction::Release));
    let a = q.answer(&done(&[3])).unwrap();
    assert_eq!(said(a.next.as_ref().unwrap()), "release 3");
    let a = q
        .answer(&HoldAnswer::Done {
            reservation: None,
            created: false,
        })
        .unwrap();
    assert!(a.next.is_none());
}

#[test]
fn a_refused_hold_drops_the_release_queued_behind_it_for_that_seat() {
    let mut q = HoldQueue::new();
    q.click(seat(3), false).unwrap();
    q.click(seat(3), false);
    let a = q.answer(&HoldAnswer::Refused(None)).unwrap();
    assert!(a.next.is_none());
    assert!(!q.busy());
}

#[test]
fn a_refused_release_drops_the_hold_queued_behind_it_double_click_leaves_it_held() {
    let mut q = HoldQueue::new();
    assert_eq!(said(&q.click(seat(5), true).unwrap()), "release 5");
    q.click(seat(5), true);
    let a = q.answer(&HoldAnswer::Refused(None)).unwrap();
    assert!(a.next.is_none());
}

#[test]
fn an_unanswered_release_drops_the_hold_queued_behind_it() {
    let mut q = HoldQueue::new();
    q.click(seat(6), true).unwrap();
    q.click(seat(6), true);
    let a = q.answer(&HoldAnswer::NoAnswer).unwrap();
    assert!(a.next.is_none());
}

#[test]
fn a_refusal_leaves_other_seats_queued_actions_and_the_queue_goes_on() {
    let mut q = HoldQueue::new();
    q.click(seat(3), false).unwrap();
    q.click(seat(4), false);
    let a = q.answer(&HoldAnswer::Refused(None)).unwrap();
    assert_eq!(said(a.next.as_ref().unwrap()), "hold 4");
}

#[test]
fn a_hold_refused_for_the_limit_drops_every_queued_hold_and_that_seats_release() {
    let mut q = HoldQueue::new();
    q.click(seat(2), false).unwrap();
    q.click(seat(3), false); // a queued hold: dropped
    q.click(seat(1), true); // a queued release of another seat: goes on
    q.click(seat(2), false); // the opposite of the one in flight: dropped
    let a = q.answer(&HoldAnswer::Limited(3)).unwrap();
    assert_eq!(said(a.next.as_ref().unwrap()), "release 1");
    assert!(q.answer(&done(&[])).unwrap().next.is_none());
}

#[test]
fn a_401_clears_the_queue() {
    let mut q = HoldQueue::new();
    q.click(seat(1), false).unwrap();
    q.click(seat(2), false);
    q.click(seat(3), true);
    let a = q.answer(&HoldAnswer::SignedOut).unwrap();
    assert!(a.next.is_none());
    assert!(!q.busy());
    assert!(q.pending().is_empty());
}

#[test]
fn an_answer_with_nothing_in_flight_is_ignored() {
    let mut q = HoldQueue::new();
    assert!(q.answer(&HoldAnswer::NoAnswer).is_none());
}

#[test]
fn busy_while_anything_is_queued_or_in_flight() {
    let mut q = HoldQueue::new();
    assert!(!q.busy());
    q.click(seat(1), false);
    assert!(q.busy());
    assert_eq!(q.in_flight().map(said), Some("hold 1".to_string()));
}

// ------------------------------------------------------------------- answers (use-hold-queue)

#[test]
fn a_201_is_a_new_reservation_and_200_is_the_same_one() {
    let r = json!({
        "eventId": "e1", "tierId": null,
        "seats": [{ "sectionId": "s-a", "section": "A", "row": 1, "seat": 5, "rowLabel": "1",
                    "seatLabel": "5", "levelName": "Standard", "price": "40.00" }],
        "createdAt": "2026-10-20T19:00:00.000Z", "expiresAt": "2026-10-20T19:05:00.000Z",
        "secondsLeft": 299
    });
    let body = r.to_string().into_bytes();
    let a = HoldAnswer::from_answer(SeatAction::Hold, Ok((201, body.clone())));
    assert_eq!(
        a,
        HoldAnswer::Done {
            reservation: Some(Reservation {
                seconds_left: 299,
                ..reservation(&[5])
            }),
            created: true
        }
    );
    let a = HoldAnswer::from_answer(SeatAction::Hold, Ok((200, body)));
    assert!(matches!(a, HoldAnswer::Done { created: false, .. }));
}

#[test]
fn a_release_answers_the_reservation_left_or_null() {
    let a = HoldAnswer::from_answer(
        SeatAction::Release,
        Ok((200, br#"{"reservation":null}"#.to_vec())),
    );
    assert_eq!(
        a,
        HoldAnswer::Done {
            reservation: None,
            created: false
        }
    );
}

#[test]
fn a_401_signs_in_again() {
    let e = refusal(
        401,
        json!({ "error": { "code": "UNAUTHENTICATED", "message": "x" } }),
    );
    assert_eq!(
        HoldAnswer::from_answer(SeatAction::Hold, Err(e)),
        HoldAnswer::SignedOut
    );
}

#[test]
fn a_429_for_the_limit_is_a_wait_of_the_seconds_rounded_up_for_a_hold_only() {
    let limited = refusal(
        429,
        json!({ "error": { "code": "RATE_LIMITED", "message": "Too many tries.",
                            "details": { "action": "HOLD", "retryAfterSeconds": 2.1 } } }),
    );
    assert_eq!(limited_for(&limited), Some(3));
    assert_eq!(
        HoldAnswer::from_answer(SeatAction::Hold, Err(limited.clone())),
        HoldAnswer::Limited(3)
    );
    // A release is never limited: its 429 is a refusal like another.
    assert!(matches!(
        HoldAnswer::from_answer(SeatAction::Release, Err(limited)),
        HoldAnswer::Refused(Some(_))
    ));
}

#[test]
fn a_429_without_a_positive_wait_is_a_refusal() {
    for details in [
        json!({ "retryAfterSeconds": 0 }),
        json!({ "retryAfterSeconds": "3" }),
        json!({}),
    ] {
        let e = refusal(
            429,
            json!({ "error": { "code": "RATE_LIMITED", "message": "m", "details": details } }),
        );
        assert_eq!(limited_for(&e), None);
    }
    let other = refusal(
        429,
        json!({ "error": { "code": "SEAT_TAKEN", "message": "m" } }),
    );
    assert_eq!(limited_for(&other), None);
}

#[test]
fn a_refusal_keeps_the_backends_code_message_and_details() {
    let e = refusal(
        409,
        json!({ "error": { "code": "SEAT_TAKEN", "message": "Seat 3 is taken.",
                            "details": { "seats": [{ "section": "A", "row": 1, "seat": 3 }] } } }),
    );
    let HoldAnswer::Refused(Some(r)) = HoldAnswer::from_answer(SeatAction::Hold, Err(e)) else {
        panic!("a refusal");
    };
    assert_eq!(r.code, "SEAT_TAKEN");
    assert_eq!(r.message, "Seat 3 is taken.");
    assert!(r.details.unwrap().contains_key("seats"));
}

#[test]
fn an_answer_without_the_envelope_is_a_refusal_with_no_words() {
    let e = ApiError::Status(StatusError {
        status: 502,
        code: "VALIDATION_FAILED".into(),
        message: "Request failed with status 502.".into(),
        details: None,
        enveloped: false,
    });
    assert_eq!(
        HoldAnswer::from_answer(SeatAction::Hold, Err(e)),
        HoldAnswer::Refused(None)
    );
}

#[test]
fn no_answer_or_an_unreadable_one_is_no_answer() {
    assert_eq!(
        HoldAnswer::from_answer(SeatAction::Hold, Err(ApiError::Unreachable)),
        HoldAnswer::NoAnswer
    );
    assert_eq!(
        HoldAnswer::from_answer(SeatAction::Hold, Ok((201, b"not json".to_vec()))),
        HoldAnswer::NoAnswer
    );
}
