//! Spec 040 (task T037; parity E2, E5): the event page's rules, from
//! `customer-app/src/pages/EventDetail.tsx`, with the cases of `customer-app/test/past-events.test.tsx`
//! and `started-notice.test.tsx` ("one clock on the page", spec 034 FR-017).

use customer_rust_core::event_page::{
    SalesAnswer, SalesClosed, get_tickets_key, page_has_ended, sales_answer,
};

const E1: &str = "e1";
const END: i64 = 1_800_000_000_000;
const MINUTE: i64 = 60_000;

fn answer(closed: Option<SalesClosed>, in_progress: bool) -> Option<SalesAnswer> {
    Some(SalesAnswer {
        event_id: E1.into(),
        sales_closed: closed,
        in_progress,
    })
}

#[test]
fn reads_an_answer_and_ignores_started_or_no_in_progress() {
    assert_eq!(sales_answer(E1, None, Some(true)), answer(None, true));
    assert_eq!(
        sales_answer(E1, Some("ENDED"), Some(false)),
        answer(Some(SalesClosed::Ended), false)
    );
    assert_eq!(
        sales_answer(E1, Some("CANCELLED"), Some(true)),
        answer(Some(SalesClosed::Cancelled), true)
    );
    // An answer from before spec 034: STARTED, or no inProgress, counts as no answer.
    assert_eq!(sales_answer(E1, Some("STARTED"), Some(false)), None);
    assert_eq!(sales_answer(E1, Some("STARTED"), None), None);
    assert_eq!(sales_answer(E1, None, None), None);
    assert_eq!(sales_answer(E1, Some("ENDED"), None), None);
}

// "follows 030's browser clock before availability answers".
#[test]
fn before_an_answer_the_load_time_clock_decides() {
    assert!(page_has_ended(E1, END, END + 3 * MINUTE, None));
    assert!(page_has_ended(E1, END, END, None));
    assert!(!page_has_ended(E1, END, END - 1, None));
}

// "a fast browser clock shows no ended line while the Backend says in progress".
#[test]
fn never_ended_while_in_progress() {
    let after = END + 3 * MINUTE;
    assert!(!page_has_ended(E1, END, after, answer(None, true).as_ref()));
    assert!(!page_has_ended(
        E1,
        END,
        after,
        answer(Some(SalesClosed::Cancelled), true).as_ref()
    ));
    assert!(!page_has_ended(
        E1,
        END,
        after,
        answer(Some(SalesClosed::Ended), true).as_ref()
    ));
}

// "a slow browser clock still shows the ended line once the Backend says ENDED".
#[test]
fn ended_sales_decide_whatever_the_clock() {
    let before = END - 3 * MINUTE;
    assert!(page_has_ended(
        E1,
        END,
        before,
        answer(Some(SalesClosed::Ended), false).as_ref()
    ));
    // Not closed and not in progress (not started yet): not ended, even past the end by clock.
    assert!(!page_has_ended(
        E1,
        END,
        END + MINUTE,
        answer(None, false).as_ref()
    ));
}

// "a cancelled event past its end keeps the line, unless the Backend says in progress".
#[test]
fn a_cancelled_event_needs_the_load_time_clock() {
    let cancelled = answer(Some(SalesClosed::Cancelled), false);
    assert!(page_has_ended(
        E1,
        END,
        END + 3 * MINUTE,
        cancelled.as_ref()
    ));
    assert!(!page_has_ended(
        E1,
        END,
        END - 3 * MINUTE,
        cancelled.as_ref()
    ));
}

#[test]
fn an_answer_about_another_event_is_no_answer() {
    let other = SalesAnswer {
        event_id: "e2".into(),
        sales_closed: Some(SalesClosed::Ended),
        in_progress: false,
    };
    assert!(!page_has_ended(E1, END, END - MINUTE, Some(&other)));
    assert!(page_has_ended(E1, END, END + MINUTE, Some(&other)));
}

// E2, E8: the panel is keyed by its seating, so a switch to general admission starts it afresh.
#[test]
fn the_get_tickets_key_names_the_seating() {
    assert_eq!(get_tickets_key(E1, true), "e1:seated");
    assert_eq!(get_tickets_key(E1, false), "e1:general");
}
