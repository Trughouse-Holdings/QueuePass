//! Spec 040 (task T033; parity B2–B4, S16): the event list's filters, held in the page address,
//! ported from `customer-app/src/filters.ts`, with the rules `EventFilters.tsx` and
//! `EventList.tsx` apply around them. Spec 008 US1 (FR-001–FR-003): invalid values are dropped
//! here, before any request, so a bad link never makes the Backend answer 400 for something the
//! customer did not type.

use url::form_urlencoded;

use crate::api::client::EventQuery;

/// `SEARCH_PAUSE_MS` (`EventFilters.tsx`): typing settles for this long before the list searches.
pub const SEARCH_PAUSE_MS: u64 = 300;

/// `Filters` (`filters.ts`); `Filters::default()` is `NO_FILTERS`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Filters {
    /// Name search, trimmed; empty when absent.
    pub q: String,
    /// A venue id; only sent once it is known to be one of the listed venues.
    pub venue: String,
    /// Whole days, `YYYY-MM-DD`, at each event's venue (spec 020 FR-020); empty when absent or
    /// invalid.
    pub from: String,
    pub to: String,
    /// Applied in the app: it changes only what is shown (FR-002).
    pub hide_cancelled: bool,
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            if leap { 29 } else { 28 }
        }
    }
}

/// `isDay`: whether `value` is a real calendar day, `YYYY-MM-DD` (ASCII digits only). Quirk kept:
/// `Date.UTC` reads the years 0 to 99 as 1900 to 1999, so the round trip fails and those years
/// are never days.
pub fn is_day(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        b[r].iter().try_fold(0u32, |n, c| {
            c.is_ascii_digit().then(|| n * 10 + u32::from(c - b'0'))
        })
    };
    let (Some(y), Some(m), Some(d)) = (digits(0..4), digits(5..7), digits(8..10)) else {
        return false;
    };
    if y <= 99 {
        return false;
    }
    (1..=12).contains(&m) && d >= 1 && d <= days_in_month(i64::from(y), m)
}

/// `URLSearchParams.get`: the first value of `key`, decoded.
fn param(pairs: &[(String, String)], key: &str) -> Option<String> {
    pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

/// `readFilters`: the filters in a page address's search (with or without its `?`).
pub fn read_filters(search: &str) -> Filters {
    let pairs: Vec<(String, String)> =
        form_urlencoded::parse(search.strip_prefix('?').unwrap_or(search).as_bytes())
            .into_owned()
            .collect();
    let day = |key: &str| param(&pairs, key).filter(|v| is_day(v)).unwrap_or_default();
    let from = day("from");
    let mut to = day("to");
    // An end before the start describes no days at all; drop it rather than fail.
    if !from.is_empty() && !to.is_empty() && to < from {
        to.clear();
    }
    Filters {
        q: param(&pairs, "q").unwrap_or_default().trim().to_string(),
        venue: param(&pairs, "venue").unwrap_or_default(),
        from,
        to,
        hide_cancelled: param(&pairs, "hideCancelled").as_deref() == Some("1"),
    }
}

/// `writeFilters(f).toString()`: only the set keys, in order, encoded as `URLSearchParams` does
/// (a space is `+`). Empty when nothing is set.
pub fn write_filters(f: &Filters) -> String {
    let mut out = form_urlencoded::Serializer::new(String::new());
    let q = f.q.trim();
    if !q.is_empty() {
        out.append_pair("q", q);
    }
    if !f.venue.is_empty() {
        out.append_pair("venue", &f.venue);
    }
    if !f.from.is_empty() {
        out.append_pair("from", &f.from);
    }
    if !f.to.is_empty() {
        out.append_pair("to", &f.to);
    }
    if f.hide_cancelled {
        out.append_pair("hideCancelled", "1");
    }
    out.finish()
}

/// `isFiltered`.
pub fn is_filtered(f: &Filters) -> bool {
    !f.q.is_empty()
        || !f.venue.is_empty()
        || !f.from.is_empty()
        || !f.to.is_empty()
        || f.hide_cancelled
}

/// `eventQuery` (spec 004's search; 020 FR-020): the days as chosen, both included; the venue
/// only once `GET /locations` has loaded (`venue_ids` is `Some`) and lists it. Never
/// `includePast` (spec 030).
pub fn event_query(f: &Filters, venue_ids: Option<&[String]>) -> EventQuery {
    let some = |v: &str| (!v.is_empty()).then(|| v.to_string());
    EventQuery {
        q: some(&f.q),
        location_id: venue_ids
            .filter(|ids| !f.venue.is_empty() && ids.contains(&f.venue))
            .map(|_| f.venue.clone()),
        from_date: is_day(&f.from).then(|| f.from.clone()),
        to_date: is_day(&f.to).then(|| f.to.clone()),
    }
}

/// `EventList.tsx`'s `shown`: Hide cancelled is applied here, in the app, never in the request.
pub fn shown_events<'a, E>(
    events: &'a [E],
    f: &Filters,
    cancelled: impl Fn(&E) -> bool,
) -> Vec<&'a E> {
    events
        .iter()
        .filter(|e| !(f.hide_cancelled && cancelled(e)))
        .collect()
}

/// What the event list shows once its events load (parity B1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Visible {
    /// "No events match your filters." and Clear filters.
    NoMatch,
    /// "Nothing is scheduled yet."
    NothingScheduled,
    /// The cards.
    Cards,
}

impl Visible {
    pub fn of<E>(shown: &[E], f: &Filters) -> Visible {
        match (shown.is_empty(), is_filtered(f)) {
            (false, _) => Visible::Cards,
            (true, true) => Visible::NoMatch,
            (true, false) => Visible::NothingScheduled,
        }
    }
}

/// `EventFilters.tsx`'s typing effect: once typing pauses for [`SEARCH_PAUSE_MS`], the filters to
/// write with the history entry **replaced**, or `None` when the trimmed text is already the
/// address's search. Every other change pushes an entry.
pub fn typed_search(text: &str, f: &Filters) -> Option<Filters> {
    let q = text.trim();
    (q != f.q).then(|| Filters {
        q: q.to_string(),
        ..f.clone()
    })
}

/// The Venue select's value: the address's venue only when it is a listed one, else "All venues".
pub fn venue_choice(f: &Filters, venue_ids: &[String]) -> String {
    if venue_ids.contains(&f.venue) {
        f.venue.clone()
    } else {
        String::new()
    }
}
