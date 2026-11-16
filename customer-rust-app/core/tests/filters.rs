//! Spec 040 (task T033; parity B2–B4, S16): the event list's filters, ported from
//! `customer-app/test/filters.test.tsx` and `browse.test.tsx` (the logic their cases check) and
//! `customer-app/src/filters.ts`, `EventFilters.tsx`, and `EventList.tsx`.

use customer_rust_core::filters::{
    Filters, SEARCH_PAUSE_MS, Visible, event_query, is_day, is_filtered, read_filters,
    shown_events, typed_search, venue_choice, write_filters,
};

fn venues() -> Vec<String> {
    vec!["v1".into(), "v2".into()]
}

#[test]
fn no_filters_is_empty_and_not_filtered() {
    let none = Filters::default();
    assert_eq!(none, read_filters(""));
    assert!(!is_filtered(&none));
    assert_eq!(write_filters(&none), "");
}

// filters.test.tsx "fills the controls from the address and sends every filter in one request".
#[test]
fn reads_every_filter_from_the_address_and_sends_them_in_one_query() {
    let f = read_filters("?q=open&venue=v1&from=2026-12-01&to=2026-12-31&hideCancelled=1");
    assert_eq!(
        f,
        Filters {
            q: "open".into(),
            venue: "v1".into(),
            from: "2026-12-01".into(),
            to: "2026-12-31".into(),
            hide_cancelled: true,
        }
    );
    assert!(is_filtered(&f));
    let q = event_query(&f, Some(venues().as_slice()));
    assert_eq!(
        q.query(),
        vec![
            ("q", "open".to_string()),
            ("locationId", "v1".to_string()),
            ("fromDate", "2026-12-01".to_string()),
            ("toDate", "2026-12-31".to_string()),
        ]
    );
}

// filters.test.tsx "drops an unknown venue / an impossible date / an end before the start".
#[test]
fn drops_an_unknown_venue_from_the_query() {
    let f = read_filters("?venue=nope");
    assert_eq!(f.venue, "nope");
    assert!(
        event_query(&f, Some(venues().as_slice()))
            .location_id
            .is_none()
    );
}

#[test]
fn drops_an_impossible_date() {
    assert_eq!(read_filters("?from=2026-13-45").from, "");
    assert_eq!(read_filters("?to=2026-02-30").to, "");
    assert_eq!(read_filters("?from=2028-02-29").from, "2028-02-29");
    assert_eq!(read_filters("?from=2027-02-29").from, "");
    assert!(
        event_query(&read_filters("?from=2026-13-45"), None)
            .from_date
            .is_none()
    );
}

#[test]
fn drops_an_end_before_the_start() {
    let f = read_filters("?from=2026-12-31&to=2026-12-01");
    assert_eq!(f.from, "2026-12-31");
    assert_eq!(f.to, "");
    // The same day is kept: both days are included.
    assert_eq!(
        read_filters("?from=2026-12-01&to=2026-12-01").to,
        "2026-12-01"
    );
}

#[test]
fn a_day_is_a_real_calendar_day_in_the_exact_form() {
    for ok in ["2026-12-01", "2024-02-29", "0100-01-01", "9999-12-31"] {
        assert!(is_day(ok), "{ok}");
    }
    // Quirk kept: `Date.UTC` reads years 0 to 99 as 1900 to 1999, so those are never days.
    for quirk in ["0001-01-01", "0099-12-31", "0000-01-01"] {
        assert!(!is_day(quirk), "{quirk}");
    }
    for bad in [
        "",
        "2026-1-01",
        "2026-12-1",
        "26-12-01",
        "2026-00-10",
        "2026-12-00",
        "2026-12-32",
        "2026/12/01",
        " 2026-12-01",
        "2026-12-01T00:00",
        "２０２６-12-01",
    ] {
        assert!(!is_day(bad), "{bad}");
    }
}

// filters.test.tsx "searches by name after a pause in typing": `  open ` is sent as `open`.
#[test]
fn the_search_is_trimmed_when_read_and_written() {
    assert_eq!(read_filters("?q=++open+").q, "open");
    assert_eq!(read_filters("?q=%20open%20").q, "open");
    let f = Filters {
        q: "  open ".into(),
        ..Filters::default()
    };
    assert_eq!(write_filters(&f), "q=open");
    let blank = Filters {
        q: "   ".into(),
        ..Filters::default()
    };
    assert_eq!(write_filters(&blank), "");
}

#[test]
fn writes_only_the_set_keys_in_order_as_url_search_params() {
    let f = Filters {
        q: "rock & roll".into(),
        venue: "v2".into(),
        from: "2026-12-01".into(),
        to: "2026-12-31".into(),
        hide_cancelled: true,
    };
    assert_eq!(
        write_filters(&f),
        "q=rock+%26+roll&venue=v2&from=2026-12-01&to=2026-12-31&hideCancelled=1"
    );
    // And read back the same.
    assert_eq!(read_filters(&format!("?{}", write_filters(&f))), f);
    let only = Filters {
        hide_cancelled: true,
        ..Filters::default()
    };
    assert_eq!(write_filters(&only), "hideCancelled=1");
}

#[test]
fn only_hide_cancelled_1_hides() {
    assert!(read_filters("?hideCancelled=1").hide_cancelled);
    assert!(!read_filters("?hideCancelled=true").hide_cancelled);
    assert!(!read_filters("?hideCancelled=").hide_cancelled);
    // URLSearchParams.get: the first value of a key.
    assert_eq!(read_filters("?q=a&q=b").q, "a");
}

// Parity B4: `locationId` only once `GET /locations` has loaded and the venue is listed.
#[test]
fn the_venue_is_sent_only_once_the_venues_load() {
    let f = read_filters("?venue=v1");
    assert!(event_query(&f, None).location_id.is_none());
    assert_eq!(
        event_query(&f, Some(venues().as_slice()))
            .location_id
            .as_deref(),
        Some("v1")
    );
    assert!(event_query(&f, Some(&[][..])).location_id.is_none());
}

// filters.test.tsx "filters by whole days": `fromDate` and `toDate`, never `from` and `to`; and
// never `includePast` (spec 030).
#[test]
fn days_are_sent_as_from_date_and_to_date() {
    let f = read_filters("?from=2026-12-01&to=2026-12-31");
    let keys: Vec<_> = event_query(&f, None)
        .query()
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    assert_eq!(keys, vec!["fromDate", "toDate"]);
}

#[test]
fn hide_cancelled_changes_no_request() {
    let shown = read_filters("?q=x");
    let hidden = read_filters("?q=x&hideCancelled=1");
    assert_eq!(
        event_query(&shown, Some(venues().as_slice())),
        event_query(&hidden, Some(venues().as_slice()))
    );
}

// filters.test.tsx "hides cancelled events in the app" and "treats hiding every event as no
// match"; browse.test.tsx's empty list.
#[test]
fn hide_cancelled_is_applied_in_the_app() {
    let events = [("e1", false), ("e3", true)];
    let cancelled = |e: &(&str, bool)| e.1;
    let all = shown_events(&events, &Filters::default(), cancelled);
    assert_eq!(all.len(), 2);
    let hide = read_filters("?hideCancelled=1");
    let kept = shown_events(&events, &hide, cancelled);
    assert_eq!(kept, vec![&("e1", false)]);
    assert_eq!(
        Visible::of(&shown_events(&[("e3", true)], &hide, cancelled), &hide),
        Visible::NoMatch
    );
    assert_eq!(
        Visible::of(
            &shown_events(&[], &Filters::default(), cancelled),
            &Filters::default()
        ),
        Visible::NothingScheduled
    );
    assert_eq!(Visible::of(&kept, &hide), Visible::Cards);
}

// EventFilters.tsx: typing waits 300 ms, then replaces the history entry with the trimmed text,
// unless the trimmed text is already the address's.
#[test]
fn typing_waits_then_replaces_with_the_trimmed_text() {
    assert_eq!(SEARCH_PAUSE_MS, 300);
    let f = read_filters("?venue=v2");
    let next = typed_search("  open ", &f).expect("a search");
    assert_eq!(next.q, "open");
    assert_eq!(next.venue, "v2");
    let at = read_filters("?q=open");
    assert_eq!(typed_search("open  ", &at), None);
    assert_eq!(typed_search("", &Filters::default()), None);
    assert_eq!(typed_search("   ", &Filters::default()), None);
    // Clearing the box searches for everything again.
    assert_eq!(typed_search("", &at), Some(Filters::default()));
}

// EventFilters.tsx: the select shows the URL's venue only when it is a listed one.
#[test]
fn the_venue_select_shows_all_venues_for_an_unlisted_venue() {
    let ids = venues();
    assert_eq!(venue_choice(&read_filters("?venue=v2"), &ids), "v2");
    assert_eq!(venue_choice(&read_filters("?venue=nope"), &ids), "");
    assert_eq!(venue_choice(&read_filters("?venue=v1"), &[]), "");
    assert_eq!(venue_choice(&Filters::default(), &ids), "");
}
