//! Spec 040 T048 (parity C1–C10; research R10): the Cart page (`customer-app/src/pages/Cart.tsx`)
//! as a pure state machine. The cart is the customer's active reservations as
//! `GET /me/reservations` gives them, newest first; nothing is stored in the browser. The app reads
//! them at once, every [`READ_EVERY_MS`] while the page is visible, and at once on
//! `visibilitychange` to visible and on `focus` ([`Cart::begin_read`] keeps it to one read at a
//! time; a 401 stops the reads); it reads each listed event once for its name and start
//! ([`Cart::details_wanted`], retried after 1, 2, 4, 8, then 10 s with the reads); it ticks every
//! 250 ms ([`Cart::tick`]); and it sends each entry's Buy tickets ([`Cart::press`], the purchase
//! being `core::buy`'s [`Buy`], with one BUY wait for the whole page).
//!
//! An entry that vanishes from a read while no purchase runs is a run-out within 2 s of its
//! deadline, else explained by one `GET /me/orders` read ([`Cart::explained`]). A reservation that
//! ran out or was bought here is never shown again.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};

use crate::{
    api::{
        client::{ApiError, Call, ops},
        types::{MyOrder, Order},
    },
    buy::{Buy, BuyOutcome, BuyPhase, RateLimitedAction, Waits},
    reservation::{ONE_MINUTE_LEFT, Reservation, seat_with_price},
    time::{parse_instant, to_iso_string},
};

/// How often the cart reads the reservations again while visible (033 research R8).
pub const READ_EVERY_MS: u32 = 1_000;
/// The heading of an entry whose event could not be read 3 times (review round 2, S2).
pub const DETAILS_UNAVAILABLE: &str = "Details unavailable";
pub const LOADING: &str = "Loading your cart…";
pub const EMPTY: &str =
    "Your cart is empty. Seats you hold on an event's page appear here for 5 minutes.";
/// An entry gone from a read this close to its deadline is the run-out its countdown shows.
const ENDING_SLACK_MS: f64 = 2_000.0;
/// After this many failed reads of an event, its entry shows without its details.
const DETAILS_TRIES: u32 = 3;

/// One reservation, by its event and when it was made: a later one for the event is another.
pub fn reservation_key(r: &Reservation) -> String {
    format!("{}:{}", r.event_id, r.created_at)
}

/// C7's alert.
pub fn ran_out_message(name: &str) -> String {
    format!(
        "Your reservation for {name} ran out, so its seats were released. You can hold them again \
         in 2 minutes if they are still open."
    )
}

/// Why an entry left by itself (C8), said politely in the status region.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CartStatus {
    /// "Your seats for {name} were bought. See them in [My tickets]."
    Bought(String),
    /// "Your reservation for {name} ended."
    Ended(String),
}

impl CartStatus {
    /// The text; for `Bought`, the part before the link "My tickets" (then ".").
    pub fn text(&self) -> String {
        match self {
            CartStatus::Bought(name) => format!("Your seats for {name} were bought. See them in "),
            CartStatus::Ended(name) => format!("Your reservation for {name} ended."),
        }
    }
}

/// How a read of one event (`GET /events/{id}`) went.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DetailsAnswer {
    /// Its name and its start in the venue's zone, as the entry shows them.
    Found { name: String, when: String },
    /// `404`: deleted since; its reservation went with it, so it is not shown.
    Missing,
    /// `401`: sign in (not read again).
    SignedOut,
    /// Anything else: read again later.
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Info {
    Details { name: String, when: String },
    Missing,
}

/// An order of the customer's, as C8 reads it: its event, when placed, and its tickets' seats
/// (section name, row, seat).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlacedOrder {
    pub event_id: String,
    pub created_at: String,
    pub seats: Vec<(String, u64, u64)>,
}

impl From<&MyOrder> for PlacedOrder {
    fn from(o: &MyOrder) -> Self {
        PlacedOrder {
            event_id: o.event_id.to_string(),
            created_at: to_iso_string(o.created_at),
            seats: o
                .tickets
                .iter()
                .filter_map(|t| t.seat.as_ref())
                .map(|s| (s.section.clone(), s.row.get(), s.seat.get()))
                .collect(),
        }
    }
}

/// An order bought here (P11), oldest first at the top.
#[derive(Clone, Debug)]
pub struct Confirmation {
    pub event_id: String,
    /// The event's name, or "this event" without its details.
    pub event_name: String,
    pub order: Order,
}

/// One reservation in the cart (`CartEntry`).
#[derive(Clone, Debug)]
struct Entry {
    reservation: Reservation,
    /// Fixed when the entry first appeared; never moves.
    deadline: f64,
    seconds_left: u64,
    warning: Option<&'static str>,
    /// Ran out, bought, or ended: its countdown says nothing more.
    settled: bool,
    buy: Buy,
    notice: Option<String>,
}

impl Entry {
    fn new(reservation: Reservation, now: f64) -> Self {
        let deadline = now + reservation.seconds_left as f64 * 1000.0;
        Entry {
            seconds_left: reservation.seconds_left,
            reservation,
            deadline,
            warning: None,
            settled: false,
            buy: Buy::default(),
            notice: None,
        }
    }

    /// A purchase in flight or awaiting Check again.
    fn in_progress(&self) -> bool {
        matches!(
            self.buy.phase(),
            BuyPhase::Confirming { .. } | BuyPhase::Unknown
        )
    }
}

/// What the page shows of an entry.
#[derive(Clone, Debug, PartialEq)]
pub struct ShownEntry {
    pub event_id: String,
    /// The entry's key (`reservationKey`), for the view's keys.
    pub key: String,
    /// The h2's link text: the event's name, or [`DETAILS_UNAVAILABLE`].
    pub heading: String,
    /// The start in the venue's zone, only with details.
    pub when: Option<String>,
    pub seconds_left: u64,
    pub warning: Option<&'static str>,
    /// "Section 115, Row F, Seat 7, Courtside, $95.00".
    pub seats: Vec<String>,
    /// "Total: $190.00".
    pub total: String,
    /// The entry's refusal.
    pub notice: Option<String>,
    /// The unknown-outcome box shows (with Check again) instead of the actions.
    pub unknown: bool,
    /// "Buy tickets", or "Buying…" while sending.
    pub buy_text: &'static str,
    choosing: bool,
}

impl ShownEntry {
    /// Buy tickets is enabled with a valid name while no purchase runs (`disabled` otherwise).
    pub fn buy_enabled(&self, name_ok: bool) -> bool {
        name_ok && self.choosing
    }
}

/// What the page shows below the confirmations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CartView {
    /// [`LOADING`]: before the first read, or while a listed event's details are unknown and
    /// nothing can be shown yet.
    Loading,
    /// [`EMPTY`].
    Empty,
    /// The Name on tickets field and the entries.
    Entries,
}

/// What a read of the reservations asks the app to do.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ReadOutcome {
    /// `401`: sign in again (the reads have stopped).
    pub sign_in: bool,
    /// Entries that vanished early: read `/me/orders` once for each and pass it to
    /// [`Cart::explained`].
    pub explain: Vec<Reservation>,
}

/// The Cart page's state.
#[derive(Clone, Debug, Default)]
pub struct Cart {
    entries: Option<Vec<Entry>>,
    infos: BTreeMap<String, Info>,
    failures: BTreeMap<String, u32>,
    retry_at: BTreeMap<String, f64>,
    requested: BTreeSet<String>,
    /// Reservations that ran out or were bought here: a read that still lists one is behind.
    finished: BTreeSet<String>,
    reading: bool,
    stopped: bool,
    /// The orders bought here, oldest first.
    pub confirmed: Vec<Confirmation>,
    /// C7's run-out alert.
    pub alert: Option<String>,
    /// C8's status.
    pub status: Option<CartStatus>,
    /// The page's one BUY wait (C4).
    pub waits: Waits,
}

impl Cart {
    pub fn new() -> Self {
        Self::default()
    }

    /// The event's name, or "this event" without its details.
    fn name_of(&self, event_id: &str) -> String {
        match self.infos.get(event_id) {
            Some(Info::Details { name, .. }) => name.clone(),
            _ => "this event".into(),
        }
    }

    fn entries_mut(&mut self) -> &mut Vec<Entry> {
        self.entries.get_or_insert_with(Vec::new)
    }

    /// Drops an entry, and remembers its reservation as finished.
    fn drop_entry(&mut self, r: &Reservation) {
        self.finished.insert(reservation_key(r));
        self.entries_mut()
            .retain(|e| e.reservation.event_id != r.event_id);
    }

    fn ran_out(&mut self, r: &Reservation) {
        self.drop_entry(r);
        self.alert = Some(ran_out_message(&self.name_of(&r.event_id)));
    }

    /// A read may start now (none in flight, and no 401 has stopped them).
    pub fn begin_read(&mut self) -> bool {
        if self.reading || self.stopped {
            return false;
        }
        self.reading = true;
        true
    }

    /// The answer to the read [`Cart::begin_read`] allowed.
    pub fn on_read(&mut self, result: Result<Vec<Reservation>, ApiError>, now: f64) -> ReadOutcome {
        self.reading = false;
        match result {
            Ok(list) => ReadOutcome {
                sign_in: false,
                explain: self.apply(list, now),
            },
            Err(e) if e.status() == Some(401) => {
                self.stopped = true;
                ReadOutcome {
                    sign_in: true,
                    explain: Vec::new(),
                }
            }
            // The next read tries again.
            Err(_) => ReadOutcome::default(),
        }
    }

    /// Research R8: the latest reservations, merged with what the cart shows.
    fn apply(&mut self, list: Vec<Reservation>, now: f64) -> Vec<Reservation> {
        let before = self.entries.take().unwrap_or_default();
        let mut next: Vec<Entry> = Vec::new();
        let mut rest = before;
        for r in list {
            if self.finished.contains(&reservation_key(&r)) {
                continue;
            }
            let key = reservation_key(&r);
            match rest
                .iter()
                .position(|e| reservation_key(&e.reservation) == key)
            {
                // The same reservation: its deadline, purchase, and words are kept; its seats'
                // levels and prices are the read's.
                Some(at) => {
                    let mut e = rest.remove(at);
                    e.reservation = r;
                    next.push(e);
                }
                None => next.push(Entry::new(r, now)),
            }
        }
        let mut explain = Vec::new();
        let mut ran_out = Vec::new();
        for e in rest {
            if next
                .iter()
                .any(|n| n.reservation.event_id == e.reservation.event_id)
            {
                continue;
            }
            if e.in_progress() {
                // A purchase in progress: its own answer decides what the entry shows.
                next.push(e);
            } else if e.deadline - now <= ENDING_SLACK_MS {
                // Gone within 2 seconds of its end: the run-out the countdown is about to show.
                ran_out.push(e.reservation);
            } else {
                self.finished.insert(reservation_key(&e.reservation));
                explain.push(e.reservation);
            }
        }
        next.sort_by_key(|e| std::cmp::Reverse(created(&e.reservation)));
        self.entries = Some(next);
        for r in ran_out {
            self.ran_out(&r);
        }
        explain
    }

    /// C8: one `/me/orders` read (`None`: no answer, or a 401) says whether a vanished entry was
    /// bought: an order for its event placed since the reservation was made, by the Backend's
    /// times, holding one of its seats.
    pub fn explained(&mut self, r: &Reservation, orders: Option<&[PlacedOrder]>) {
        let made = parse_instant(&r.created_at);
        let bought = orders.unwrap_or_default().iter().any(|o| {
            o.event_id == r.event_id
                && parse_instant(&o.created_at)
                    .zip(made)
                    .is_some_and(|(placed, made)| placed >= made)
                && o.seats.iter().any(|(section, row, seat)| {
                    r.seats
                        .iter()
                        .any(|s| &s.section == section && s.row == *row && s.seat == *seat)
                })
        });
        let name = self.name_of(&r.event_id);
        self.status = Some(if bought {
            CartStatus::Bought(name)
        } else {
            CartStatus::Ended(name)
        });
    }

    /// The listed events whose details to read now (each marked asked).
    pub fn details_wanted(&mut self, now: f64) -> Vec<String> {
        let ids: BTreeSet<String> = self
            .entries
            .iter()
            .flatten()
            .map(|e| e.reservation.event_id.clone())
            .collect();
        let mut wanted = Vec::new();
        for id in ids {
            if self.requested.contains(&id) || self.infos.contains_key(&id) {
                continue;
            }
            if now < self.retry_at.get(&id).copied().unwrap_or(0.0) {
                continue;
            }
            self.requested.insert(id.clone());
            wanted.push(id);
        }
        wanted
    }

    /// How the read of an event went; `true` for a 401 (sign in).
    pub fn on_details(&mut self, event_id: &str, answer: DetailsAnswer, now: f64) -> bool {
        let info = match answer {
            DetailsAnswer::Found { name, when } => Info::Details { name, when },
            DetailsAnswer::Missing => Info::Missing,
            DetailsAnswer::SignedOut => return true,
            DetailsAnswer::Failed => {
                self.requested.remove(event_id);
                let n = self.failures.get(event_id).copied().unwrap_or(0) + 1;
                self.failures.insert(event_id.to_string(), n);
                let wait = (1_000.0 * 2f64.powi(n as i32 - 1)).min(10_000.0);
                self.retry_at.insert(event_id.to_string(), now + wait);
                return false;
            }
        };
        self.infos.insert(event_id.to_string(), info);
        false
    }

    fn unavailable(&self, event_id: &str) -> bool {
        !self.infos.contains_key(event_id)
            && self.failures.get(event_id).copied().unwrap_or(0) >= DETAILS_TRIES
    }

    /// The 250 ms tick: each entry's countdown and warning, its run-out at 0 unless a purchase
    /// runs, and the BUY wait.
    pub fn tick(&mut self, now: f64) {
        self.waits.tick(now);
        let mut out = Vec::new();
        // Only an entry on screen counts down (React's countdown lives in a mounted `CartEntry`):
        // one whose details are unknown or gone leaves only through a read (C3, C5, C8).
        let hidden: Vec<String> = self
            .entries
            .iter()
            .flatten()
            .map(|e| e.reservation.event_id.clone())
            .filter(|id| match self.infos.get(id) {
                Some(Info::Details { .. }) => false,
                Some(Info::Missing) => true,
                None => !self.unavailable(id),
            })
            .collect();
        for e in self.entries.iter_mut().flatten() {
            if hidden.contains(&e.reservation.event_id) {
                continue;
            }
            let left = ((e.deadline - now) / 1000.0).ceil().max(0.0) as u64;
            e.seconds_left = left;
            if left > 0 && left <= 60 {
                e.warning = Some(ONE_MINUTE_LEFT);
            }
            if left == 0 && !e.in_progress() && !e.settled {
                e.settled = true;
                out.push(e.reservation.clone());
            }
        }
        for r in out {
            self.ran_out(&r);
        }
    }

    fn entry_mut(&mut self, event_id: &str) -> Option<&mut Entry> {
        self.entries
            .iter_mut()
            .flatten()
            .find(|e| e.reservation.event_id == event_id)
    }

    /// Buy tickets (or Check again) on `event_id`'s entry: the order to send, or `None` when
    /// nothing is sent (a name that is not valid outside Check again, the BUY wait, a purchase in
    /// flight). `new_id` makes the purchase's request id on its first press.
    pub fn press(
        &mut self,
        event_id: &str,
        name_ok: bool,
        holder_name: &str,
        new_id: impl FnOnce() -> String,
    ) -> Option<Call> {
        if self.waits.get(RateLimitedAction::Buy).is_some() {
            return None;
        }
        let waits = self.waits.clone();
        let e = self.entry_mut(event_id)?;
        if !name_ok && !matches!(e.buy.phase(), BuyPhase::Unknown) {
            return None;
        }
        e.notice = None;
        let request_id = e.buy.press(&waits, new_id)?;
        let r = &e.reservation;
        let mut body = Map::new();
        if let Some(tier) = &r.tier_id {
            body.insert("tierId".into(), json!(tier));
        }
        body.insert("holderName".into(), json!(holder_name));
        body.insert("quantity".into(), json!(r.seats.len()));
        body.insert(
            "seats".into(),
            Value::Array(r.seat_refs().iter().map(|s| s.json()).collect()),
        );
        body.insert("requestId".into(), json!(request_id));
        Some(ops::place_order(event_id, &Value::Object(body)))
    }

    /// The answer to `event_id`'s purchase; `true` for a 401 (sign in).
    pub fn on_buy_answer(
        &mut self,
        event_id: &str,
        result: Result<Order, ApiError>,
        now: f64,
    ) -> bool {
        let mut waits = std::mem::take(&mut self.waits);
        let outcome = match self.entry_mut(event_id) {
            Some(e) => e.buy.answer(result, &mut waits, now),
            None => {
                self.waits = waits;
                return false;
            }
        };
        self.waits = waits;
        let Some(e) = self.entry_mut(event_id) else {
            return false;
        };
        let r = e.reservation.clone();
        match outcome {
            // Still in progress: Check again settles it.
            BuyOutcome::Unknown | BuyOutcome::Limited => false,
            BuyOutcome::SignedOut => true,
            BuyOutcome::Done(order) => {
                e.settled = true;
                self.drop_entry(&r);
                self.confirmed.push(Confirmation {
                    event_id: r.event_id.clone(),
                    event_name: self.name_of(&r.event_id),
                    order: *order,
                });
                false
            }
            BuyOutcome::Refused(error) => {
                if error.code() == Some("RESERVATION_REQUIRED") {
                    // Nothing was bought; the reservation is gone.
                    e.settled = true;
                    let expired = error
                        .details()
                        .and_then(|d| d.get("expired"))
                        .and_then(Value::as_bool)
                        == Some(true);
                    if expired {
                        self.ran_out(&r);
                    } else {
                        self.drop_entry(&r);
                        self.status = Some(CartStatus::Ended(self.name_of(&r.event_id)));
                    }
                } else {
                    e.notice = Some(match &error {
                        ApiError::Status(s) if s.enveloped => s.message.clone(),
                        _ => "The purchase was refused.".into(),
                    });
                }
                false
            }
        }
    }

    /// What shows below the confirmations.
    pub fn view(&self) -> CartView {
        let Some(entries) = &self.entries else {
            return CartView::Loading;
        };
        let pending = entries.iter().any(|e| {
            let id = &e.reservation.event_id;
            !self.infos.contains_key(id) && !self.unavailable(id)
        });
        let shown = self.shown();
        if pending && shown.is_empty() {
            CartView::Loading
        } else if shown.is_empty() {
            CartView::Empty
        } else {
            CartView::Entries
        }
    }

    /// The entries shown, newest first: those with details, or whose details failed 3 times.
    pub fn shown(&self) -> Vec<ShownEntry> {
        self.entries
            .iter()
            .flatten()
            .filter_map(|e| {
                let id = &e.reservation.event_id;
                let (heading, when) = match self.infos.get(id) {
                    Some(Info::Details { name, when }) => (name.clone(), Some(when.clone())),
                    Some(Info::Missing) => return None,
                    None if self.unavailable(id) => (DETAILS_UNAVAILABLE.to_string(), None),
                    None => return None,
                };
                let r = &e.reservation;
                Some(ShownEntry {
                    event_id: id.clone(),
                    key: reservation_key(r),
                    heading,
                    when,
                    seconds_left: e.seconds_left,
                    warning: e.warning,
                    seats: r.seats.iter().map(seat_with_price).collect(),
                    total: format!("Total: {}", r.total()),
                    notice: e.notice.clone(),
                    unknown: e.buy.shows_unknown(),
                    buy_text: if matches!(e.buy.phase(), BuyPhase::Confirming { .. }) {
                        "Buying…"
                    } else {
                        "Buy tickets"
                    },
                    choosing: e.buy.choosing(),
                })
            })
            .collect()
    }
}

/// A reservation's `createdAt` for sorting: the instant, or none (first) when unreadable.
fn created(r: &Reservation) -> Option<chrono::DateTime<chrono::Utc>> {
    parse_instant(&r.created_at)
}
