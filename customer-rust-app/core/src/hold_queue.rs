//! Spec 040 T048 (parity M10, research R10): the click queue of the seat map, ported from
//! `customer-app/src/use-hold-queue.ts` (spec 033 FR-007, research R6). Each click on a seat
//! becomes one hold or release request; they are sent one at a time, in click order, never the
//! same seat twice:
//!
//! - a click on a seat with a queued, unsent action removes it (nothing is sent for it);
//! - a click on a seat whose request is in flight queues the opposite action, sent after the
//!   answer;
//! - when an action is refused or unanswered, the opposite action queued behind it for the same
//!   seat is dropped; a hold refused for the allowance (`429`) drops every queued hold and that
//!   seat's queued action (other releases go on); `401` clears the queue.
//!
//! The app sends what [`HoldQueue::click`] and [`HoldQueue::answer`] hand back, and passes each
//! answer to `core::reservation::Holds::on_answer`, which says what it means on the page.

use std::collections::{BTreeMap, VecDeque};

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{
    api::client::{ApiError, Call, SeatRef, ops},
    reservation::{Reservation, seat_text},
};

/// What a click asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeatAction {
    Hold,
    Release,
}

impl SeatAction {
    fn opposite(self) -> Self {
        match self {
            SeatAction::Hold => SeatAction::Release,
            SeatAction::Release => SeatAction::Hold,
        }
    }
}

/// `placeKey`: a seat by its section, row, and seat numbers, `"{sectionId}-{row}-{seat}"`.
pub fn place_key(section_id: &str, row: u64, seat: u64) -> String {
    format!("{section_id}-{row}-{seat}")
}

/// `ChosenSeat` (`seats.ts`): a seat the customer clicked, as the hold routes name it, with its
/// section's name and, from the map, its labels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChosenSeat {
    pub section_id: String,
    pub section: String,
    pub row: u64,
    pub seat: u64,
    pub row_label: Option<String>,
    pub seat_label: Option<String>,
}

impl ChosenSeat {
    pub fn key(&self) -> String {
        place_key(&self.section_id, self.row, self.seat)
    }

    /// `seatLabel(seat)`: "Section A, Row 3, Seat 7".
    pub fn label(&self) -> String {
        seat_text(
            &self.section,
            self.row,
            self.seat,
            self.row_label.as_deref(),
            self.seat_label.as_deref(),
        )
    }

    fn seat_ref(&self) -> SeatRef {
        SeatRef {
            section_id: self.section_id.clone(),
            row: self.row,
            seat: self.seat,
        }
    }
}

/// `QueuedAction`: one click's request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueuedAction {
    pub kind: SeatAction,
    pub seat: ChosenSeat,
    pub key: String,
}

impl QueuedAction {
    /// `POST /events/{id}/reservation` or `…/reservation/release` with `{seats:[that seat]}`.
    pub fn call(&self, event_id: &str) -> Call {
        let seats = [self.seat.seat_ref()];
        match self.kind {
            SeatAction::Hold => ops::hold_seats(event_id, &seats),
            SeatAction::Release => ops::release_seats(event_id, &seats),
        }
    }
}

/// A refusal with the Backend's envelope: its code, message, and details (`ErrorEnvelope`).
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: String,
    pub message: String,
    pub details: Option<Map<String, Value>>,
}

/// How a hold or release was answered (`use-hold-queue.ts`' branches).
#[derive(Clone, Debug, PartialEq)]
pub enum HoldAnswer {
    /// The reservation as the Backend now has it (`None`: it ended); `created` for a 201.
    Done {
        reservation: Option<Reservation>,
        created: bool,
    },
    /// `401`.
    SignedOut,
    /// A hold refused for the hold allowance (spec 026), with the seconds to wait.
    Limited(u64),
    /// Refused for a reason of its own; `None` without the Backend's envelope.
    Refused(Option<Refusal>),
    /// No answer (or one that could not be read).
    NoAnswer,
}

#[derive(Deserialize)]
struct ReleaseAnswer {
    reservation: Option<Reservation>,
}

/// `limitedFor` (`use-buy.ts`, spec 026 FR-008): the seconds to wait, rounded up, when a refusal
/// is a `429` `RATE_LIMITED` with a positive `details.retryAfterSeconds`; otherwise `None`.
pub fn limited_for(error: &ApiError) -> Option<u64> {
    if error.status() != Some(429) || error.code() != Some("RATE_LIMITED") {
        return None;
    }
    let n = error.details()?.get("retryAfterSeconds")?.as_f64()?;
    (n.is_finite() && n > 0.0).then(|| n.ceil() as u64)
}

impl HoldAnswer {
    /// The answer to `kind`: the status and body of a 2xx, or the error.
    pub fn from_answer(kind: SeatAction, answer: Result<(u16, Vec<u8>), ApiError>) -> Self {
        match answer {
            Ok((status, body)) => {
                let reservation = match kind {
                    SeatAction::Hold => serde_json::from_slice::<Reservation>(&body).map(Some),
                    SeatAction::Release => {
                        serde_json::from_slice::<ReleaseAnswer>(&body).map(|a| a.reservation)
                    }
                };
                match reservation {
                    Ok(reservation) => HoldAnswer::Done {
                        reservation,
                        created: status == 201,
                    },
                    Err(_) => HoldAnswer::NoAnswer,
                }
            }
            Err(e) if e.status() == Some(401) => HoldAnswer::SignedOut,
            Err(e) if kind == SeatAction::Hold && limited_for(&e).is_some() => {
                HoldAnswer::Limited(limited_for(&e).unwrap_or_default())
            }
            Err(ApiError::Status(e)) => HoldAnswer::Refused(e.enveloped.then_some(Refusal {
                code: e.code,
                message: e.message,
                details: e.details,
            })),
            Err(_) => HoldAnswer::NoAnswer,
        }
    }
}

/// An answer applied: the action it answered, and the next one to send, if any.
#[derive(Clone, Debug, PartialEq)]
pub struct Answered {
    pub action: QueuedAction,
    pub next: Option<QueuedAction>,
}

/// The queue: actions waiting, in click order, and the one in flight.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HoldQueue {
    queue: VecDeque<QueuedAction>,
    in_flight: Option<QueuedAction>,
}

impl HoldQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// A click on `seat`, `held` as the page shows the reservation now; returns the action to
    /// send now, if the queue was idle.
    pub fn click(&mut self, seat: ChosenSeat, held: bool) -> Option<QueuedAction> {
        let key = seat.key();
        if let Some(at) = self.queue.iter().position(|q| q.key == key) {
            // Not sent yet: cancelled, so nothing is sent for this click or the one it undoes.
            self.queue.remove(at);
        } else if let Some(flying) = self.in_flight.as_ref().filter(|f| f.key == key) {
            let kind = flying.kind.opposite();
            self.queue.push_back(QueuedAction { kind, seat, key });
        } else {
            let kind = if held {
                SeatAction::Release
            } else {
                SeatAction::Hold
            };
            self.queue.push_back(QueuedAction { kind, seat, key });
        }
        self.pump()
    }

    fn pump(&mut self) -> Option<QueuedAction> {
        if self.in_flight.is_some() {
            return None;
        }
        let next = self.queue.pop_front()?;
        self.in_flight = Some(next.clone());
        Some(next)
    }

    /// The answer to the action in flight; `None` if nothing was in flight.
    pub fn answer(&mut self, answer: &HoldAnswer) -> Option<Answered> {
        let action = self.in_flight.take()?;
        match answer {
            HoldAnswer::Done { .. } => {}
            HoldAnswer::SignedOut => self.queue.clear(),
            HoldAnswer::Limited(_) => {
                // Every queued hold would be refused too; releases go on (they are never limited).
                self.queue
                    .retain(|q| q.kind != SeatAction::Hold && q.key != action.key);
            }
            HoldAnswer::Refused(_) | HoldAnswer::NoAnswer => {
                let opposite = action.kind.opposite();
                self.queue
                    .retain(|q| !(q.key == action.key && q.kind == opposite));
            }
        }
        let next = self.pump();
        Some(Answered { action, next })
    }

    /// What each seat with a queued or in-flight action will be: the last queued, or the one in
    /// flight.
    pub fn pending(&self) -> BTreeMap<String, SeatAction> {
        let mut pending = BTreeMap::new();
        if let Some(f) = &self.in_flight {
            pending.insert(f.key.clone(), f.kind);
        }
        for q in &self.queue {
            pending.insert(q.key.clone(), q.kind);
        }
        pending
    }

    /// Whether any action is queued or in flight.
    pub fn busy(&self) -> bool {
        self.in_flight.is_some() || !self.queue.is_empty()
    }

    pub fn in_flight(&self) -> Option<&QueuedAction> {
        self.in_flight.as_ref()
    }
}
