//! Spec 040 T046 (parity M14, research R4's new work): `core::mine`, the `withMine` rules of the
//! shared seat stream (`packages/shared/src/web/use-seat-stream.ts` lines 123–163) and how
//! `GetTickets.tsx` (line 330) and its snapshot handler use them, ported from
//! `customer-app/test/seat-stream.test.tsx`: the customer's reservations are read on open; again
//! 200 ms after a change that touches one of their seats or makes any seat held; only the latest
//! request's answer counts; an answer older than the page's last hold or release is ignored; each
//! venue map after the first reads the availability and the reservations again.

use customer_rust_core::{
    mine::{MINE_REREAD_MS, MineReads},
    reservation::{Reservation, ReservedSeat},
    seating::map_state::{SeatMapChange, SeatState, SeatStateChange},
};

fn reservation(event_id: &str, seats: &[u64]) -> Reservation {
    Reservation {
        event_id: event_id.into(),
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

fn change(event_id: &str, seats: &[(u64, SeatState)]) -> SeatMapChange {
    SeatMapChange {
        event_id: event_id.into(),
        seq: 2,
        changes: seats
            .iter()
            .map(|&(seat, state)| SeatStateChange {
                section_id: "s-a".into(),
                row: 1,
                seat,
                state,
                from: SeatState::Open,
                level_id: "l-std".into(),
            })
            .collect(),
    }
}

#[test]
fn the_reservations_are_read_on_open_and_shown_with_when_they_were_asked() {
    let mut mine = MineReads::new();
    assert!(mine.list().is_none());
    let request = mine.request(1_000.0);
    assert!(mine.on_answer(request, vec![reservation("e1", &[2, 3])]));
    assert_eq!(mine.list().unwrap().len(), 1);
    assert_eq!(mine.at(), 1_000.0);
}

#[test]
fn only_the_latest_requests_answer_counts() {
    let mut mine = MineReads::new();
    let older = mine.request(1_000.0);
    let newer = mine.request(1_100.0);
    // The newer answers first; the older, which may predate the page's own write, comes late.
    assert!(mine.on_answer(newer, vec![reservation("e1", &[4])]));
    assert!(!mine.on_answer(older, vec![]));
    assert_eq!(mine.list().unwrap()[0].seats[0].seat, 4);
    assert_eq!(mine.at(), 1_100.0);
}

#[test]
fn a_change_touching_one_of_the_customers_seats_reads_them_again_after_200_ms() {
    assert_eq!(MINE_REREAD_MS, 200);
    let mut mine = MineReads::new();
    let r = mine.request(0.0);
    mine.on_answer(r, vec![reservation("e1", &[2, 3])]);
    // An admin change ended it: both seats are open again.
    assert!(mine.wants_reread(&change("e1", &[(2, SeatState::Open), (3, SeatState::Open)])));
}

#[test]
fn a_change_making_any_seat_held_reads_them_again_another_tabs_hold() {
    let mut mine = MineReads::new();
    let r = mine.request(0.0);
    mine.on_answer(r, vec![]);
    assert!(mine.wants_reread(&change("e1", &[(4, SeatState::Reserved)])));
}

#[test]
fn a_change_to_other_seats_that_holds_nothing_reads_nothing() {
    let mut mine = MineReads::new();
    let r = mine.request(0.0);
    mine.on_answer(r, vec![reservation("e1", &[2])]);
    assert!(!mine.wants_reread(&change("e1", &[(5, SeatState::Sold), (6, SeatState::Open)])));
    // The same seat numbers of another event's reservation are not this event's.
    let mut other = MineReads::new();
    let r = other.request(0.0);
    other.on_answer(r, vec![reservation("e2", &[5])]);
    assert!(!other.wants_reread(&change("e1", &[(5, SeatState::Open)])));
}

#[test]
fn before_the_first_answer_only_a_held_seat_reads_again() {
    let mine = MineReads::new();
    assert!(!mine.wants_reread(&change("e1", &[(2, SeatState::Open)])));
    assert!(mine.wants_reread(&change("e1", &[(2, SeatState::Reserved)])));
}

#[test]
fn an_answer_asked_before_the_pages_last_hold_or_release_is_ignored() {
    let mut mine = MineReads::new();
    let r = mine.request(1_000.0);
    mine.on_answer(r, vec![]);
    // The page held a seat at 1,500 ms: the list asked at 1,000 ms is out of date.
    assert!(mine.fresh_since(1_500.0).is_none());
    assert!(mine.fresh_since(1_000.0).is_some());
    let r = mine.request(2_000.0);
    mine.on_answer(r, vec![reservation("e1", &[1])]);
    assert_eq!(mine.fresh_since(1_500.0).unwrap().len(), 1);
}

#[test]
fn each_venue_map_after_the_first_reads_the_availability_and_reservations_again() {
    let mut mine = MineReads::new();
    assert!(!mine.on_map(), "the first map reads nothing more");
    assert!(
        mine.on_map(),
        "a reconnect's map may follow a price or layout change"
    );
    assert!(mine.on_map());
}
