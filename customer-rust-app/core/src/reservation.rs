//! Spec 040 T048 (parity M3, M9, M11–M13, M15; research R10): the seated part of
//! `customer-app/src/components/GetTickets.tsx` and `HoldCountdown.tsx` as a pure state machine.
//! The app feeds it the hold queue's answers, the reservations read (`core::mine`), the open
//! section's changes, and 250 ms ticks of the monotonic clock (`performance.now()` ms), and draws
//! what it holds: the Your seats box with its countdown and warning, the run-out alert, the notice
//! (refusals), the hold log, and how each seat shows (`seatView`).

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::{Map, Value};

pub use crate::hold_queue::Refusal;
use crate::{
    api::client::SeatRef,
    format,
    hold_queue::{HoldAnswer, QueuedAction, SeatAction, place_key},
    seating::{
        map_state::SeatState,
        venue_map::{SeatView, ShownState},
    },
    time::{format_viewer_time, parse_instant},
};

/// `ONE_MINUTE_LEFT` (`HoldCountdown.tsx`, 033 FR-015).
pub const ONE_MINUTE_LEFT: &str = "1 minute left to buy your seats.";
/// The event page's run-out alert (015 FR-005, 033 FR-015).
pub const RAN_OUT: &str = "Your reservation ran out, so its seats were released. You can hold \
                           them again in 2 minutes if they are still open.";
/// The hold log keeps this many lines (033 research R10) …
pub const LOG_LINES: usize = 5;
/// … cleared this long after the last.
pub const LOG_CLEAR_MS: f64 = 10_000.0;
/// The countdown's tick.
pub const TICK_MS: u32 = 250;
/// A reservation that ends on the Backend this close to its local deadline is the run-out the
/// countdown is about to show.
const ENDING_SLACK_MS: f64 = 2_000.0;

/// The contract's `ReservedSeat`: a held seat with its labels, level, and price now.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservedSeat {
    pub section_id: String,
    pub section: String,
    pub row: u64,
    pub seat: u64,
    pub row_label: String,
    pub seat_label: String,
    pub level_name: String,
    pub price: String,
}

impl ReservedSeat {
    pub fn key(&self) -> String {
        place_key(&self.section_id, self.row, self.seat)
    }
}

/// The contract's `Reservation` (`listMyReservations`, the hold routes): `created_at` is kept as
/// the Backend wrote it, since a reservation is one per event and `createdAt`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reservation {
    pub event_id: String,
    pub tier_id: Option<String>,
    pub seats: Vec<ReservedSeat>,
    pub created_at: String,
    pub seconds_left: u64,
}

impl Reservation {
    /// "Total: …"'s sum, in cents (038 FR-022).
    pub fn total(&self) -> String {
        sum_usd(self.seats.iter().map(|s| s.price.as_str()))
    }

    /// The seats as an order or a release names them.
    pub fn seat_refs(&self) -> Vec<SeatRef> {
        self.seats
            .iter()
            .map(|s| SeatRef {
                section_id: s.section_id.clone(),
                row: s.row,
                seat: s.seat,
            })
            .collect()
    }
}

/// `clock` (`HoldCountdown.tsx`): seconds as `m:ss`.
pub fn clock(seconds: u64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

/// `seatLabel` (`format.ts`, 007 FR-011, 038 FR-026): "Section 115, Row F, Seat 7", by the labels
/// when known, else the numbers (`core::format::seat_label`).
pub fn seat_text(
    section: &str,
    row: u64,
    seat: u64,
    row_label: Option<&str>,
    seat_label: Option<&str>,
) -> String {
    format::seat_label(&format::SeatRef {
        section,
        row: row as i64,
        seat: seat as i64,
        row_label,
        seat_label,
    })
}

/// `seatWithPrice(s, s.levelName, s.price)` (`format.ts`, 038 FR-022): "Section 115, Row F,
/// Seat 7, Courtside, $95.00".
pub fn seat_with_price(s: &ReservedSeat) -> String {
    format::seat_with_price(
        &format::SeatRef::labelled(
            &s.section,
            s.row as i64,
            s.seat as i64,
            &s.row_label,
            &s.seat_label,
        ),
        Some(&s.level_name),
        Some(&s.price),
    )
}

/// `sumUsd` (`format.ts`): prices summed in integer cents from the strings' digits.
pub fn sum_usd<'a>(prices: impl IntoIterator<Item = &'a str>) -> String {
    format::sum_usd(&prices.into_iter().collect::<Vec<_>>())
}

/// A seat as a refusal's `details.seats` names it.
fn named_seat(v: &Value) -> Option<String> {
    let section = v.get("section")?.as_str()?;
    Some(seat_text(
        section,
        v.get("row")?.as_u64()?,
        v.get("seat")?.as_u64()?,
        v.get("rowLabel").and_then(Value::as_str),
        v.get("seatLabel").and_then(Value::as_str),
    ))
}

fn detail_seats(details: Option<&Map<String, Value>>) -> &[Value] {
    details
        .and_then(|d| d.get("seats"))
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

/// `cooldownMessage` (`GetTickets.tsx`, 033 FR-006, 020 FR-023): when the seats of an ended
/// reservation can be held again, in the viewer's own zone with its abbreviation.
pub fn cooldown_message(details: Option<&Map<String, Value>>, viewer_zone: &str) -> String {
    let seats: Vec<String> = detail_seats(details)
        .iter()
        .filter_map(named_seat)
        .collect();
    let at = details
        .and_then(|d| d.get("availableAt"))
        .and_then(Value::as_str)
        .and_then(parse_instant)
        .map_or_else(
            || "Invalid Date".to_string(),
            |at| format_viewer_time(at, viewer_zone, false),
        );
    format!(
        "Your reservation of {} ended less than 2 minutes ago. You can hold {} again at {at}.",
        seats.join("; "),
        if seats.len() == 1 { "it" } else { "them" }
    )
}

/// The hold log (M12): at most [`LOG_LINES`], each with an id for the view's keys, cleared
/// [`LOG_CLEAR_MS`] after the last.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HoldLog {
    lines: Vec<(u64, String)>,
    next: u64,
    last_at: Option<f64>,
}

impl HoldLog {
    /// One more line, said at `now`.
    pub fn say(&mut self, text: impl Into<String>, now: f64) {
        self.next += 1;
        self.lines.push((self.next, text.into()));
        if self.lines.len() > LOG_LINES {
            self.lines.remove(0);
        }
        self.last_at = Some(now);
    }

    pub fn lines(&self) -> &[(u64, String)] {
        &self.lines
    }

    /// When the log is to be cleared, while it has lines.
    pub fn clear_at(&self) -> Option<f64> {
        self.last_at
            .filter(|_| !self.lines.is_empty())
            .map(|at| at + LOG_CLEAR_MS)
    }

    /// Clears the log if its time has come; returns whether it did.
    pub fn clear_if_due(&mut self, now: f64) -> bool {
        match self.clear_at() {
            Some(at) if now >= at => {
                self.lines.clear();
                self.last_at = None;
                true
            }
            _ => false,
        }
    }
}

/// What an answer asks the app to do besides showing the new state.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Effects {
    /// Read the customer's reservations again (`reloadMine`).
    pub reload_mine: bool,
    /// Read the venue map again, keeping it shown (`live.refresh`).
    pub refresh_map: bool,
    /// Read what is left again (`setReloads`).
    pub reload_availability: bool,
    /// `401`: sign in again.
    pub sign_in: bool,
    /// Start the HOLD wait of this many seconds (spec 026).
    pub hold_wait: Option<u64>,
}

/// The seated panel's state of holds (`GetTickets.tsx`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Holds {
    /// The customer's active reservation for this event.
    pub reservation: Option<Reservation>,
    /// Its deadline by the monotonic clock, from the Backend's `secondsLeft`.
    deadline: Option<f64>,
    /// The countdown shown.
    pub seconds_left: Option<u64>,
    warned: bool,
    /// The 1-minute warning, once per reservation.
    pub warning: Option<&'static str>,
    /// The run-out alert ([`RAN_OUT`]) shows.
    pub ran_out: bool,
    /// The refusal or "didn't go through" alert.
    pub notice: Option<String>,
    pub log: HoldLog,
    /// Seats released here since the section last changed: open, though it still says held.
    released_here: BTreeSet<String>,
    /// Seats a hold was refused for as taken, before the section shows it: shown held.
    refused_taken: BTreeSet<String>,
    /// When this page last changed its reservation; a list asked before that is out of date.
    last_write: f64,
    /// Choose seats was pressed, or seats were held: the map stays open.
    pub map_open: bool,
}

impl Holds {
    pub fn new() -> Self {
        Self::default()
    }

    /// `adopt`: shows a reservation; the countdown starts only for a new one (a 201, none shown,
    /// or another `createdAt`) and never restarts while it lasts.
    pub fn adopt(&mut self, r: Option<Reservation>, created: bool, now: f64) {
        let before = self.reservation.take();
        let Some(r) = r else {
            self.deadline = None;
            self.seconds_left = None;
            return;
        };
        self.map_open = true;
        if created
            || self.deadline.is_none()
            || before.as_ref().map(|b| &b.created_at) != Some(&r.created_at)
        {
            self.deadline = Some(now + r.seconds_left as f64 * 1000.0);
            self.warned = false;
            self.warning = None;
            self.seconds_left = Some(r.seconds_left);
        }
        self.reservation = Some(r);
        self.ran_out = false;
    }

    /// Choose seats.
    pub fn open_map(&mut self) {
        self.map_open = true;
    }

    /// The map shows once asked for, while seats are held, or while a click is queued.
    pub fn show_map(&self, queue_busy: bool) -> bool {
        self.map_open || self.reservation.is_some() || queue_busy
    }

    /// A click on a seat (`toggleSeat`): the notice and the run-out alert go.
    pub fn click(&mut self) {
        self.notice = None;
        self.ran_out = false;
    }

    /// Whether `key` is one of the reservation's seats (the queue's `isHeld`).
    pub fn is_held(&self, key: &str) -> bool {
        self.reservation
            .as_ref()
            .is_some_and(|r| r.seats.iter().any(|s| s.key() == key))
    }

    /// The hold queue's answer to `action`. `section_id_of` finds a section by its name on the map
    /// (a refusal names seats by section name); `live` is whether the seat stream is live.
    pub fn on_answer(
        &mut self,
        action: &QueuedAction,
        answer: &HoldAnswer,
        section_id_of: &dyn Fn(&str) -> Option<String>,
        live: bool,
        viewer_zone: &str,
        now: f64,
    ) -> Effects {
        let label = action.seat.label();
        match answer {
            HoldAnswer::Done {
                reservation,
                created,
            } => {
                self.last_write = now;
                if action.kind == SeatAction::Release {
                    self.released_here.insert(action.key.clone());
                }
                self.adopt(reservation.clone(), *created, now);
                let text = match (action.kind, reservation) {
                    (SeatAction::Hold, r) => {
                        let left = match self.deadline {
                            None => r.as_ref().map_or(0, |r| r.seconds_left),
                            Some(d) => seconds_until(d, now),
                        };
                        format!("{label} held. {} left.", clock(left))
                    }
                    (SeatAction::Release, Some(_)) => format!("{label} released."),
                    (SeatAction::Release, None) => format!(
                        "{label} released. You hold no seats now; the next seat you click starts \
                         a new 5 minutes."
                    ),
                };
                self.log.say(text, now);
                Effects::default()
            }
            HoldAnswer::SignedOut => Effects {
                sign_in: true,
                ..Effects::default()
            },
            HoldAnswer::Limited(seconds) => Effects {
                hold_wait: Some(*seconds),
                ..Effects::default()
            },
            HoldAnswer::NoAnswer => {
                // The seat goes back; what is true is read again, so a hold that did go through
                // shows as held.
                self.notice = Some(format!(
                    "Your click on {label} didn't go through. Try again."
                ));
                Effects {
                    reload_mine: true,
                    refresh_map: true,
                    ..Effects::default()
                }
            }
            HoldAnswer::Refused(e) => {
                self.refused(action, e.as_ref(), section_id_of, live, viewer_zone)
            }
        }
    }

    /// `holdRefused` (033 FR-016): a refused click, as an alert naming the seat and the reason.
    fn refused(
        &mut self,
        action: &QueuedAction,
        e: Option<&Refusal>,
        section_id_of: &dyn Fn(&str) -> Option<String>,
        live: bool,
        viewer_zone: &str,
    ) -> Effects {
        let label = action.seat.label();
        if action.kind == SeatAction::Release {
            self.notice = Some(e.map_or_else(
                || format!("{label} couldn't be released."),
                |e| e.message.clone(),
            ));
            return Effects {
                reload_mine: true,
                ..Effects::default()
            };
        }
        match e {
            Some(e) if e.code == "SEAT_TAKEN" || e.code == "SEAT_OFF_SALE" => {
                // Someone else's, or no longer on sale: shown taken (still focusable) until the
                // section next changes; a live map shows it anyway, else the map is read again.
                self.notice = Some(e.message.clone());
                self.refused_taken.insert(action.key.clone());
                for s in detail_seats(e.details.as_ref()) {
                    let found = s
                        .get("section")
                        .and_then(Value::as_str)
                        .and_then(section_id_of)
                        .zip(s.get("row").and_then(Value::as_u64))
                        .zip(s.get("seat").and_then(Value::as_u64));
                    if let Some(((id, row), seat)) = found {
                        self.refused_taken.insert(place_key(&id, row, seat));
                    }
                }
                if live {
                    Effects::default()
                } else {
                    Effects {
                        reload_availability: true,
                        refresh_map: true,
                        ..Effects::default()
                    }
                }
            }
            Some(e) if e.code == "SEAT_COOLDOWN" => {
                self.notice = Some(cooldown_message(e.details.as_ref(), viewer_zone));
                Effects::default()
            }
            Some(e) => {
                self.notice = Some(e.message.clone());
                Effects::default()
            }
            None => {
                self.notice = Some(format!("{label} couldn't be held."));
                Effects::default()
            }
        }
    }

    /// The Backend's view of the customer's reservations (`GetTickets.tsx` line 329), asked at
    /// `asked`: ignored if asked before this page's last hold or release.
    pub fn on_mine(&mut self, list: &[Reservation], asked: f64, event_id: &str, now: f64) {
        if asked < self.last_write {
            return;
        }
        let found = list.iter().find(|r| r.event_id == event_id).cloned();
        if found.is_some() || self.reservation.is_none() {
            self.adopt(found, false, now);
            return;
        }
        // It ended on the Backend. Close to the end of the 5 minutes, that is the run-out the
        // countdown is about to show; otherwise it was released elsewhere or by an admin change.
        let left = self.deadline.map_or(0.0, |d| d - now);
        if left <= ENDING_SLACK_MS {
            self.deadline = Some(now);
            return;
        }
        self.adopt(None, false, now);
        self.log.say("Your held seats were released.", now);
    }

    /// The open section's seats changed: what this page knew ahead of them lasts until then.
    pub fn section_changed(&mut self) {
        self.released_here.clear();
        self.refused_taken.clear();
    }

    /// The 250 ms tick: the countdown, a single 1-minute warning, and the end of the 5 minutes.
    pub fn tick(&mut self, now: f64) {
        if self.reservation.is_none() {
            return;
        }
        let Some(deadline) = self.deadline else {
            return;
        };
        let left = seconds_until(deadline, now);
        self.seconds_left = Some(left);
        if left > 0 && left <= 60 && !self.warned {
            self.warned = true;
            self.warning = Some(ONE_MINUTE_LEFT);
        }
        if left == 0 {
            self.deadline = None;
            self.reservation = None;
            self.seconds_left = None;
            self.notice = None;
            self.ran_out = true;
        }
    }

    /// `seatView` (M9): how the map shows a seat. `pending` is the hold queue's; `hold_waiting`
    /// whether the HOLD wait runs; `full` whether no more seats can be chosen.
    pub fn seat_view(
        &self,
        key: &str,
        state: SeatState,
        pending: &BTreeMap<String, SeatAction>,
        hold_waiting: bool,
        full: bool,
    ) -> SeatView {
        let view = |shown, disabled| SeatView {
            shown: Some(shown),
            disabled: Some(disabled),
        };
        match pending.get(key) {
            Some(SeatAction::Hold) => return view(ShownState::Holding, false),
            Some(SeatAction::Release) => return view(ShownState::Releasing, false),
            None => {}
        }
        if self.is_held(key) {
            return view(ShownState::Mine, false);
        }
        let mut shown = ShownState::from(state);
        if shown == ShownState::Reserved && self.released_here.contains(key) {
            shown = ShownState::Open;
        }
        if shown == ShownState::Open && self.refused_taken.contains(key) {
            shown = ShownState::Reserved;
        }
        view(shown, shown != ShownState::Open || hold_waiting || full)
    }

    /// The seats held once every queued click is answered (`willHold.size`).
    pub fn will_hold(&self, pending: &BTreeMap<String, SeatAction>) -> usize {
        let mut keys: BTreeSet<String> = self
            .reservation
            .iter()
            .flat_map(|r| r.seats.iter().map(ReservedSeat::key))
            .collect();
        for (key, action) in pending {
            match action {
                SeatAction::Hold => keys.insert(key.clone()),
                SeatAction::Release => keys.remove(key),
            };
        }
        keys.len()
    }
}

/// Whole seconds from `now` to `deadline`, rounded up, never below 0.
fn seconds_until(deadline: f64, now: f64) -> u64 {
    ((deadline - now) / 1000.0).ceil().max(0.0) as u64
}
