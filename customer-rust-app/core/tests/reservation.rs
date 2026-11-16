//! Spec 040 T046 (parity M3, M9, M11–M13, M15; research R10): `core::reservation`, the seated
//! part of `GetTickets.tsx` and `HoldCountdown.tsx`, ported from `seat-hold-click.test.tsx`,
//! `seat-holds.test.tsx`, `seats.test.tsx`, `venue-map-flow.test.tsx`, and `sections-list.test.tsx`
//! (their logic; their markup is checked in the browser). Times are the monotonic clock's
//! milliseconds (`performance.now()`), passed in.

use customer_rust_core::{
    hold_queue::{ChosenSeat, HoldAnswer, QueuedAction, SeatAction},
    reservation::{
        Effects, HoldLog, Holds, ONE_MINUTE_LEFT, RAN_OUT, Refusal, Reservation, ReservedSeat,
        clock, cooldown_message, seat_text, seat_with_price, sum_usd,
    },
    seating::{map_state::SeatState, venue_map::ShownState},
};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

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

fn reserved(n: u64) -> ReservedSeat {
    ReservedSeat {
        section_id: "s-a".into(),
        section: "A".into(),
        row: 1,
        seat: n,
        row_label: "1".into(),
        seat_label: n.to_string(),
        level_name: "Standard".into(),
        price: "40.00".into(),
    }
}

fn reservation(seats: &[u64]) -> Reservation {
    Reservation {
        event_id: "e1".into(),
        tier_id: None,
        seats: seats.iter().map(|&n| reserved(n)).collect(),
        created_at: "2026-10-20T19:00:00.000Z".into(),
        seconds_left: 300,
    }
}

fn action(kind: SeatAction, n: u64) -> QueuedAction {
    let seat = seat(n);
    QueuedAction {
        kind,
        key: seat.key(),
        seat,
    }
}

fn hold_done(h: &mut Holds, n: u64, seats: &[u64], created: bool, now: f64) -> Effects {
    h.on_answer(
        &action(SeatAction::Hold, n),
        &HoldAnswer::Done {
            reservation: Some(reservation(seats)),
            created,
        },
        &|_| None,
        true,
        "America/New_York",
        now,
    )
}

fn release_done(h: &mut Holds, n: u64, left: Option<&[u64]>, now: f64) -> Effects {
    h.on_answer(
        &action(SeatAction::Release, n),
        &HoldAnswer::Done {
            reservation: left.map(reservation),
            created: false,
        },
        &|_| None,
        true,
        "America/New_York",
        now,
    )
}

fn refused(
    h: &mut Holds,
    kind: SeatAction,
    n: u64,
    refusal: Option<Refusal>,
    live: bool,
) -> Effects {
    let lookup = |name: &str| (name == "A").then(|| "s-a".to_string());
    h.on_answer(
        &action(kind, n),
        &HoldAnswer::Refused(refusal),
        &lookup,
        live,
        "America/Los_Angeles",
        0.0,
    )
}

fn refusal(code: &str, message: &str, details: Value) -> Refusal {
    Refusal {
        code: code.into(),
        message: message.into(),
        details: details.as_object().cloned(),
    }
}

fn lines(h: &Holds) -> Vec<String> {
    h.log.lines().iter().map(|l| l.1.clone()).collect()
}

// ------------------------------------------------------------------------ words and formats

#[test]
fn a_clock_is_minutes_and_two_digit_seconds() {
    assert_eq!(clock(300), "5:00");
    assert_eq!(clock(299), "4:59");
    assert_eq!(clock(61), "1:01");
    assert_eq!(clock(0), "0:00");
}

#[test]
fn a_seat_reads_by_its_labels_when_known_else_its_numbers() {
    assert_eq!(
        seat_text("A", 1, 5, Some("1"), Some("5")),
        "Section A, Row 1, Seat 5"
    );
    assert_eq!(
        seat_text("115", 6, 7, Some("F"), Some("7")),
        "Section 115, Row F, Seat 7"
    );
    assert_eq!(seat_text("A", 3, 7, None, None), "Section A, Row 3, Seat 7");
    assert_eq!(seat(5).label(), "Section A, Row 1, Seat 5");
}

#[test]
fn a_held_seat_reads_with_its_level_and_price_and_seats_total_in_cents() {
    assert_eq!(
        seat_with_price(&reserved(5)),
        "Section A, Row 1, Seat 5, Standard, $40.00"
    );
    assert_eq!(sum_usd(["40.00", "25.00"]), "$65.00");
    assert_eq!(sum_usd(["0.10", "0.20"]), "$0.30");
    assert_eq!(sum_usd(["999.99", "1000.01"]), "$2,000.00");
    assert_eq!(reservation(&[5, 6]).total(), "$80.00");
}

#[test]
fn the_words_are_the_react_apps() {
    assert_eq!(ONE_MINUTE_LEFT, "1 minute left to buy your seats.");
    assert_eq!(
        RAN_OUT,
        "Your reservation ran out, so its seats were released. You can hold them again in 2 \
         minutes if they are still open."
    );
}

#[test]
fn the_cooldown_says_when_in_the_viewers_zone_it_or_them() {
    let one = json!({ "seats": [{ "section": "A", "row": 1, "seat": 5 }],
                      "availableAt": "2026-10-20T23:02:30.000Z" });
    assert_eq!(
        cooldown_message(one.as_object(), "America/Los_Angeles"),
        "Your reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago. You can hold \
         it again at 4:02 PM PDT."
    );
    let two = json!({ "seats": [{ "section": "A", "row": 1, "seat": 5 },
                                { "section": "B", "row": 2, "seat": 1, "rowLabel": "BB",
                                  "seatLabel": "101" }],
                      "availableAt": "2026-10-20T23:02:30.000Z" });
    assert_eq!(
        cooldown_message(two.as_object(), "America/New_York"),
        "Your reservation of Section A, Row 1, Seat 5; Section B, Row BB, Seat 101 ended less \
         than 2 minutes ago. You can hold them again at 7:02 PM EDT."
    );
}

// ------------------------------------------------------------------------ holding (M11)

#[test]
fn a_hold_starts_the_countdown_at_the_answers_seconds_and_logs_it() {
    let mut h = Holds::new();
    let mut r = reservation(&[5]);
    r.seconds_left = 299;
    h.on_answer(
        &action(SeatAction::Hold, 5),
        &HoldAnswer::Done {
            reservation: Some(r),
            created: true,
        },
        &|_| None,
        true,
        "America/New_York",
        0.0,
    );
    assert_eq!(h.seconds_left, Some(299));
    assert_eq!(lines(&h), ["Section A, Row 1, Seat 5 held. 4:59 left."]);
    assert!(h.map_open);
    assert_eq!(h.reservation.as_ref().unwrap().seats.len(), 1);
}

#[test]
fn a_second_seat_never_restarts_the_countdown() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.tick(10_000.0);
    assert_eq!(h.seconds_left, Some(290));
    hold_done(&mut h, 6, &[5, 6], false, 10_000.0);
    assert_eq!(h.seconds_left, Some(290));
    assert_eq!(
        lines(&h).last().unwrap(),
        "Section A, Row 1, Seat 6 held. 4:50 left."
    );
    assert_eq!(h.reservation.as_ref().unwrap().total(), "$80.00");
}

#[test]
fn a_reservation_with_another_created_at_starts_a_new_countdown() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.tick(30_000.0);
    let mut newer = reservation(&[8]);
    newer.created_at = "2026-10-20T19:06:00.000Z".into();
    h.adopt(Some(newer), false, 30_000.0);
    assert_eq!(h.seconds_left, Some(300));
}

#[test]
fn a_release_logs_it_and_keeps_the_countdown() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    hold_done(&mut h, 6, &[5, 6], false, 1_000.0);
    h.tick(20_000.0);
    release_done(&mut h, 6, Some(&[5]), 20_000.0);
    assert_eq!(
        lines(&h).last().unwrap(),
        "Section A, Row 1, Seat 6 released."
    );
    assert_eq!(h.seconds_left, Some(280));
}

#[test]
fn the_last_release_ends_the_box_and_the_next_hold_restarts_at_5_00() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.tick(30_000.0);
    release_done(&mut h, 5, None, 30_000.0);
    assert!(h.reservation.is_none());
    assert_eq!(h.seconds_left, None);
    assert_eq!(
        lines(&h).last().unwrap(),
        "Section A, Row 1, Seat 5 released. You hold no seats now; the next seat you click starts \
         a new 5 minutes."
    );
    // The map stays open after the seats are released.
    assert!(h.map_open);
    hold_done(&mut h, 8, &[8], true, 31_000.0);
    assert_eq!(h.seconds_left, Some(300));
}

#[test]
fn a_release_marks_the_seat_open_here_until_the_section_changes() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    release_done(&mut h, 5, None, 1_000.0);
    let none = BTreeMap::new();
    // The section still says held (no change has come yet): shown open, choosable.
    let v = h.seat_view(&seat(5).key(), SeatState::Reserved, &none, false, false);
    assert_eq!(v.shown, Some(ShownState::Open));
    assert_eq!(v.disabled, Some(false));
    h.section_changed();
    let v = h.seat_view(&seat(5).key(), SeatState::Reserved, &none, false, false);
    assert_eq!(v.shown, Some(ShownState::Reserved));
    assert_eq!(v.disabled, Some(true));
}

// ------------------------------------------------------------------------ the countdown

#[test]
fn ticks_warn_once_at_one_minute() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.tick(239_000.0);
    assert_eq!(h.seconds_left, Some(61));
    assert_eq!(h.warning, None);
    h.tick(240_000.0);
    assert_eq!(h.seconds_left, Some(60));
    assert_eq!(h.warning, Some(ONE_MINUTE_LEFT));
    h.tick(250_000.0);
    assert_eq!(h.warning, Some(ONE_MINUTE_LEFT));
}

#[test]
fn a_countdown_rounds_up_partial_seconds() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.tick(250.0);
    assert_eq!(h.seconds_left, Some(300));
    h.tick(1_000.0);
    assert_eq!(h.seconds_left, Some(299));
}

#[test]
fn at_0_00_the_box_goes_and_the_reservation_ran_out() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.notice = Some("an old notice".into());
    h.tick(300_000.0);
    assert!(h.reservation.is_none());
    assert_eq!(h.seconds_left, None);
    assert!(h.ran_out);
    assert_eq!(h.notice, None);
    // Nothing more happens on later ticks.
    h.tick(301_000.0);
    assert!(h.ran_out);
}

#[test]
fn a_click_clears_the_notice_and_the_run_out_alert() {
    let mut h = Holds::new();
    h.notice = Some("x".into());
    h.ran_out = true;
    h.click();
    assert_eq!(h.notice, None);
    assert!(!h.ran_out);
}

#[test]
fn a_new_reservation_clears_the_run_out_and_the_warning() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.tick(250_000.0);
    h.tick(300_000.0);
    assert!(h.ran_out);
    hold_done(&mut h, 6, &[6], true, 400_000.0);
    assert!(!h.ran_out);
    assert_eq!(h.warning, None);
}

// ------------------------------------------------------------------------ the hold log (M12)

#[test]
fn the_hold_log_keeps_5_lines_cleared_10_seconds_after_the_last() {
    let mut log = HoldLog::default();
    for n in 1..=6 {
        log.say(format!("line {n}"), f64::from(n) * 100.0);
    }
    let all: Vec<_> = log.lines().iter().map(|l| l.1.clone()).collect();
    assert_eq!(all, ["line 2", "line 3", "line 4", "line 5", "line 6"]);
    // Each line keeps its own id, for the view's keys.
    assert_eq!(log.lines()[0].0 + 4, log.lines()[4].0);
    assert_eq!(log.clear_at(), Some(10_600.0));
    assert!(!log.clear_if_due(10_599.0));
    assert!(log.clear_if_due(10_600.0));
    assert!(log.lines().is_empty());
    assert_eq!(log.clear_at(), None);
}

// ------------------------------------------------------------------------ refusals (M13)

#[test]
fn seat_taken_says_the_backends_words_and_shows_the_seats_held_until_the_section_changes() {
    let mut h = Holds::new();
    let e = refused(
        &mut h,
        SeatAction::Hold,
        3,
        Some(refusal(
            "SEAT_TAKEN",
            "Section A, Row 1, Seat 3 is already taken.",
            json!({ "seats": [{ "section": "A", "row": 1, "seat": 3 },
                              { "section": "A", "row": 1, "seat": 4 },
                              { "section": "Z", "row": 1, "seat": 9 }] }),
        )),
        false,
    );
    assert_eq!(
        h.notice.as_deref(),
        Some("Section A, Row 1, Seat 3 is already taken.")
    );
    // Not live: what is left and the map are read again, the form kept.
    assert_eq!(
        e,
        Effects {
            reload_availability: true,
            refresh_map: true,
            ..Effects::default()
        }
    );
    let none = BTreeMap::new();
    for n in [3, 4] {
        let v = h.seat_view(&seat(n).key(), SeatState::Open, &none, false, false);
        assert_eq!(v.shown, Some(ShownState::Reserved));
        assert_eq!(v.disabled, Some(true));
    }
    h.section_changed();
    let v = h.seat_view(&seat(3).key(), SeatState::Open, &none, false, false);
    assert_eq!(v.shown, Some(ShownState::Open));
}

#[test]
fn seat_taken_on_a_live_map_reads_nothing_again() {
    let mut h = Holds::new();
    let e = refused(
        &mut h,
        SeatAction::Hold,
        3,
        Some(refusal(
            "SEAT_OFF_SALE",
            "Seat 3 is not on sale.",
            json!({}),
        )),
        true,
    );
    assert_eq!(e, Effects::default());
    assert_eq!(h.notice.as_deref(), Some("Seat 3 is not on sale."));
}

#[test]
fn seat_cooldown_says_when_in_the_viewers_zone() {
    let mut h = Holds::new();
    refused(
        &mut h,
        SeatAction::Hold,
        5,
        Some(refusal(
            "SEAT_COOLDOWN",
            "ended less than 2 minutes ago.",
            json!({ "seats": [{ "section": "A", "row": 1, "seat": 5 }],
                    "availableAt": "2026-10-20T23:02:30.000Z" }),
        )),
        true,
    );
    assert_eq!(
        h.notice.as_deref(),
        Some(
            "Your reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago. You can \
             hold it again at 4:02 PM PDT."
        )
    );
    // Shown open: nothing marks it held.
    let v = h.seat_view(
        &seat(5).key(),
        SeatState::Open,
        &BTreeMap::new(),
        false,
        false,
    );
    assert_eq!(v.shown, Some(ShownState::Open));
}

#[test]
fn another_hold_refusal_says_its_message_or_that_the_seat_couldnt_be_held() {
    let mut h = Holds::new();
    hold_done(&mut h, 1, &[1], true, 0.0);
    refused(
        &mut h,
        SeatAction::Hold,
        2,
        Some(refusal(
            "TICKET_LIMIT_REACHED",
            "Early Show allows 1 ticket per customer.",
            json!({ "limit": 1 }),
        )),
        true,
    );
    assert_eq!(
        h.notice.as_deref(),
        Some("Early Show allows 1 ticket per customer.")
    );
    // The held seats are kept.
    assert_eq!(h.reservation.as_ref().unwrap().seats.len(), 1);
    refused(&mut h, SeatAction::Hold, 2, None, true);
    assert_eq!(
        h.notice.as_deref(),
        Some("Section A, Row 1, Seat 2 couldn't be held.")
    );
}

#[test]
fn a_refused_release_says_so_and_reads_the_reservation_again() {
    let mut h = Holds::new();
    let e = refused(
        &mut h,
        SeatAction::Release,
        5,
        Some(refusal(
            "VALIDATION_FAILED",
            "Section A, Row 1, Seat 5 is not in your reservation.",
            json!({}),
        )),
        true,
    );
    assert_eq!(
        h.notice.as_deref(),
        Some("Section A, Row 1, Seat 5 is not in your reservation.")
    );
    assert_eq!(
        e,
        Effects {
            reload_mine: true,
            ..Effects::default()
        }
    );
    refused(&mut h, SeatAction::Release, 5, None, true);
    assert_eq!(
        h.notice.as_deref(),
        Some("Section A, Row 1, Seat 5 couldn't be released.")
    );
}

#[test]
fn no_answer_says_try_again_and_reads_the_reservation_and_map_again() {
    let mut h = Holds::new();
    let e = h.on_answer(
        &action(SeatAction::Hold, 5),
        &HoldAnswer::NoAnswer,
        &|_| None,
        true,
        "UTC",
        0.0,
    );
    assert_eq!(
        h.notice.as_deref(),
        Some("Your click on Section A, Row 1, Seat 5 didn't go through. Try again.")
    );
    assert_eq!(
        e,
        Effects {
            reload_mine: true,
            refresh_map: true,
            ..Effects::default()
        }
    );
}

#[test]
fn a_hold_refused_for_the_limit_starts_the_hold_wait() {
    let mut h = Holds::new();
    let e = h.on_answer(
        &action(SeatAction::Hold, 2),
        &HoldAnswer::Limited(3),
        &|_| None,
        true,
        "UTC",
        0.0,
    );
    assert_eq!(
        e,
        Effects {
            hold_wait: Some(3),
            ..Effects::default()
        }
    );
    assert_eq!(h.notice, None);
}

#[test]
fn a_401_signs_in_again() {
    let mut h = Holds::new();
    let e = h.on_answer(
        &action(SeatAction::Hold, 2),
        &HoldAnswer::SignedOut,
        &|_| None,
        true,
        "UTC",
        0.0,
    );
    assert!(e.sign_in);
}

// ------------------------------------------------------------------------ how a seat shows (M9)

#[test]
fn a_queued_or_in_flight_hold_is_holding_and_a_release_is_releasing() {
    let h = Holds::new();
    let mut pending = BTreeMap::new();
    pending.insert(seat(1).key(), SeatAction::Hold);
    pending.insert(seat(2).key(), SeatAction::Release);
    let v = h.seat_view(&seat(1).key(), SeatState::Open, &pending, true, true);
    assert_eq!(
        (v.shown, v.disabled),
        (Some(ShownState::Holding), Some(false))
    );
    let v = h.seat_view(&seat(2).key(), SeatState::Reserved, &pending, true, true);
    assert_eq!(
        (v.shown, v.disabled),
        (Some(ShownState::Releasing), Some(false))
    );
}

#[test]
fn the_customers_own_seat_is_mine_and_always_choosable() {
    let mut h = Holds::new();
    hold_done(&mut h, 1, &[1], true, 0.0);
    let v = h.seat_view(
        &seat(1).key(),
        SeatState::Reserved,
        &BTreeMap::new(),
        true,
        true,
    );
    assert_eq!((v.shown, v.disabled), (Some(ShownState::Mine), Some(false)));
}

#[test]
fn an_open_seat_can_be_chosen_only_with_no_hold_wait_and_room_for_more() {
    let h = Holds::new();
    let none = BTreeMap::new();
    let key = seat(4).key();
    assert_eq!(
        h.seat_view(&key, SeatState::Open, &none, false, false)
            .disabled,
        Some(false)
    );
    assert_eq!(
        h.seat_view(&key, SeatState::Open, &none, true, false)
            .disabled,
        Some(true)
    );
    assert_eq!(
        h.seat_view(&key, SeatState::Open, &none, false, true)
            .disabled,
        Some(true)
    );
    for state in [SeatState::Reserved, SeatState::Sold, SeatState::OffSale] {
        assert_eq!(
            h.seat_view(&key, state, &none, false, false).disabled,
            Some(true)
        );
    }
}

#[test]
fn the_seats_held_once_every_queued_click_is_answered() {
    let mut h = Holds::new();
    hold_done(&mut h, 1, &[1, 2], true, 0.0);
    let mut pending = BTreeMap::new();
    pending.insert(seat(3).key(), SeatAction::Hold);
    pending.insert(seat(2).key(), SeatAction::Release);
    assert_eq!(h.will_hold(&pending), 2);
    assert_eq!(h.will_hold(&BTreeMap::new()), 2);
}

#[test]
fn the_map_shows_once_asked_while_seats_are_held_or_a_click_is_queued() {
    let mut h = Holds::new();
    assert!(!h.show_map(false));
    assert!(h.show_map(true));
    h.open_map();
    assert!(h.show_map(false));
    let mut other = Holds::new();
    other.adopt(Some(reservation(&[1])), false, 0.0);
    assert!(other.show_map(false));
}

// ------------------------------------------------------------------------ the Backend's view

#[test]
fn a_reservation_found_on_open_is_adopted_with_its_seconds_left_from_the_cart() {
    // M15: back from the cart's Change seats, the countdown goes on from the Backend's seconds.
    let mut h = Holds::new();
    let mut r = reservation(&[5, 6]);
    r.seconds_left = 200;
    h.on_mine(&[r], 0.0, "e1", 1_000.0);
    assert!(h.map_open);
    assert_eq!(h.seconds_left, Some(200));
    assert_eq!(h.reservation.as_ref().unwrap().seats.len(), 2);
}

#[test]
fn another_events_reservation_is_not_this_ones() {
    let mut h = Holds::new();
    let mut r = reservation(&[5]);
    r.event_id = "e2".into();
    h.on_mine(&[r], 0.0, "e1", 0.0);
    assert!(h.reservation.is_none());
    assert!(!h.map_open);
}

#[test]
fn a_list_asked_before_the_last_hold_or_release_is_ignored() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 1_000.0);
    // A read asked at 900 ms, before the hold, still says nothing is held.
    h.on_mine(&[], 900.0, "e1", 1_100.0);
    assert!(h.reservation.is_some());
    assert!(lines(&h).iter().all(|l| !l.contains("were released")));
}

#[test]
fn ended_elsewhere_more_than_2_s_early_says_the_held_seats_were_released() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.on_mine(&[], 10_000.0, "e1", 10_000.0);
    assert!(h.reservation.is_none());
    assert_eq!(lines(&h).last().unwrap(), "Your held seats were released.");
}

#[test]
fn ended_within_2_s_of_the_deadline_is_the_run_out_the_countdown_shows() {
    let mut h = Holds::new();
    hold_done(&mut h, 5, &[5], true, 0.0);
    h.on_mine(&[], 298_500.0, "e1", 298_500.0);
    // Still shown until the next tick, which runs it out.
    assert!(h.reservation.is_some());
    h.tick(298_600.0);
    assert!(h.ran_out);
    assert!(lines(&h).iter().all(|l| !l.contains("were released")));
}

#[test]
fn a_reservation_made_in_another_tab_shows() {
    let mut h = Holds::new();
    h.on_mine(&[reservation(&[4])], 0.0, "e1", 0.0);
    let v = h.seat_view(
        &seat(4).key(),
        SeatState::Reserved,
        &BTreeMap::new(),
        false,
        false,
    );
    assert_eq!(v.shown, Some(ShownState::Mine));
}

#[test]
fn a_reservation_decodes_from_the_contracts_json() {
    let r: Reservation = serde_json::from_value(json!({
        "eventId": "e1", "tierId": null,
        "seats": [{ "sectionId": "s-a", "section": "A", "row": 1, "seat": 5, "rowLabel": "1",
                    "seatLabel": "5", "levelName": "Standard", "price": "40.00" }],
        "createdAt": "2026-10-20T19:00:00.000Z", "expiresAt": "2026-10-20T19:05:00.000Z",
        "secondsLeft": 300
    }))
    .unwrap();
    assert_eq!(r, reservation(&[5]));
    assert_eq!(r.seats[0].key(), "s-a-1-5");
    assert_eq!(r.seat_refs()[0].row, 1);
    let _ = Map::<String, Value>::new();
}
