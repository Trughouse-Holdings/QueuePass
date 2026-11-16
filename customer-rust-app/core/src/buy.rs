//! Spec 040 T042 (parity P7–P11, C6; research R10): one purchase of one event and the waits out
//! of a refusal for the limit, ported from `customer-app/src/use-buy.ts` (`useBuy`, `useWaits`,
//! `limitedFor`) and `packages/shared/src/rate-limit.ts`, as pure state the views feed:
//!
//! - one request id per purchase, made on the first press and kept, so Check again never places
//!   a second order; a refusal ends the purchase (the next press is a new one), a refusal for the
//!   limit does not; a second press before the answer sends nothing;
//! - `401`: back through sign-in (the API client starts it), nothing shown;
//! - `429` for the limit: the BUY wait, back where the press came from;
//! - `5xx` or no answer: the unknown outcome, with Check again.
//!
//! [`Waits`] keeps the BUY and HOLD waits apart (session D's hold queue starts the HOLD one, and
//! the Cart's Buy tickets uses [`Buy`] too). Times are the browser's monotonic clock
//! (`performance.now()`, ms), passed in.

use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::api::client::ApiError;
use crate::api::types::{Order, Ticket};
use crate::format::{SeatRef, seat_with_price};

/// Ports `RateLimitedAction`: the two kinds of attempt each customer has an allowance for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RateLimitedAction {
    Buy,
    Hold,
}

/// Ports `rateLimitMessage`: the Backend's words, "1 second" in the singular.
pub fn rate_limit_message(seconds: u64) -> String {
    format!(
        "Too many tries. You can try again in {seconds} {}.",
        if seconds == 1 { "second" } else { "seconds" }
    )
}

/// Ports `limitedFor` (spec 026 FR-008): the seconds to wait, rounded up, when a refusal is one
/// for the limit (`429 RATE_LIMITED` with a positive number `details.retryAfterSeconds`).
pub fn limited_for(error: &ApiError) -> Option<u64> {
    if error.status() != Some(429) || error.code() != Some("RATE_LIMITED") {
        return None;
    }
    let n = error.details()?.get("retryAfterSeconds")?.as_f64()?;
    (n.is_finite() && n > 0.0).then(|| n.ceil() as u64)
}

/// A wait: its deadline by the monotonic clock, and the N shown.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wait {
    pub deadline: f64,
    pub left: u64,
}

/// Ports `useWaits` (spec 026 FR-011 to FR-013): the waits, BUY and HOLD apart, counting down
/// once a second from the Backend's N (checked every 250 ms), and the latest refusal's message
/// for the one hidden live region, kept until its own wait ends so it is said once.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Waits {
    buy: Option<Wait>,
    hold: Option<Wait>,
    announcement: Option<(RateLimitedAction, String)>,
}

impl Waits {
    fn slot(&mut self, kind: RateLimitedAction) -> &mut Option<Wait> {
        match kind {
            RateLimitedAction::Buy => &mut self.buy,
            RateLimitedAction::Hold => &mut self.hold,
        }
    }

    pub fn get(&self, kind: RateLimitedAction) -> Option<&Wait> {
        match kind {
            RateLimitedAction::Buy => self.buy.as_ref(),
            RateLimitedAction::Hold => self.hold.as_ref(),
        }
    }

    /// The countdown text above the control the wait holds back, while it runs.
    pub fn text(&self, kind: RateLimitedAction) -> Option<String> {
        self.get(kind).map(|w| rate_limit_message(w.left))
    }

    /// Whether either wait runs (the 250 ms checks run only then).
    pub fn waiting(&self) -> bool {
        self.buy.is_some() || self.hold.is_some()
    }

    /// The text of the one hidden live region, or `None`.
    pub fn announcement(&self) -> Option<&str> {
        self.announcement.as_ref().map(|(_, t)| t.as_str())
    }

    /// A refusal for the limit: a wait of `seconds` from `now`.
    pub fn start(&mut self, kind: RateLimitedAction, seconds: u64, now: f64) {
        *self.slot(kind) = Some(Wait {
            deadline: now + seconds as f64 * 1000.0,
            left: seconds,
        });
        self.announcement = Some((kind, rate_limit_message(seconds)));
    }

    /// One check: N is `ceil((deadline - now) / 1000)`, and at 0 the wait ends. Whether anything
    /// changed.
    pub fn tick(&mut self, now: f64) -> bool {
        let mut changed = false;
        for kind in [RateLimitedAction::Buy, RateLimitedAction::Hold] {
            let slot = self.slot(kind);
            if let Some(w) = slot {
                let left = ((w.deadline - now) / 1000.0).ceil();
                if left <= 0.0 {
                    *slot = None;
                    changed = true;
                } else if left as u64 != w.left {
                    w.left = left as u64;
                    changed = true;
                }
            }
        }
        if let Some((kind, _)) = self.announcement
            && self.get(kind).is_none()
        {
            self.announcement = None;
        }
        changed
    }
}

/// Ports `BuyPhase`. `checking`: Check again from the unknown outcome, whose box stays mounted
/// meanwhile, so it is not announced again.
#[derive(Clone, Debug)]
pub enum BuyPhase {
    Choosing,
    Confirming { checking: bool },
    Done(Box<Order>),
    Unknown,
}

impl PartialEq for BuyPhase {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (BuyPhase::Choosing, BuyPhase::Choosing) | (BuyPhase::Unknown, BuyPhase::Unknown) => {
                true
            }
            (BuyPhase::Confirming { checking: a }, BuyPhase::Confirming { checking: b }) => a == b,
            (BuyPhase::Done(a), BuyPhase::Done(b)) => a.id == b.id,
            _ => false,
        }
    }
}

/// Ports `BuyOutcome`: how an answer ended the attempt, for the page to show what it means.
#[derive(Clone, Debug)]
pub enum BuyOutcome {
    Done(Box<Order>),
    Refused(ApiError),
    Limited,
    Unknown,
    SignedOut,
}

impl PartialEq for BuyOutcome {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (BuyOutcome::Done(a), BuyOutcome::Done(b)) => a.id == b.id,
            (BuyOutcome::Refused(a), BuyOutcome::Refused(b)) => a == b,
            (BuyOutcome::Limited, BuyOutcome::Limited)
            | (BuyOutcome::Unknown, BuyOutcome::Unknown)
            | (BuyOutcome::SignedOut, BuyOutcome::SignedOut) => true,
            _ => false,
        }
    }
}

/// Ports `useBuy`: one purchase of one event.
#[derive(Clone, Debug)]
pub struct Buy {
    phase: BuyPhase,
    request_id: Option<String>,
    sending: bool,
    from_unknown: bool,
}

impl Default for Buy {
    fn default() -> Self {
        Buy {
            phase: BuyPhase::Choosing,
            request_id: None,
            sending: false,
            from_unknown: false,
        }
    }
}

impl Buy {
    pub fn phase(&self) -> &BuyPhase {
        &self.phase
    }

    /// Whether the unknown-outcome box shows (P9): the unknown outcome, or Check again running.
    pub fn shows_unknown(&self) -> bool {
        matches!(
            self.phase,
            BuyPhase::Unknown | BuyPhase::Confirming { checking: true }
        )
    }

    /// Confirm order is enabled only while choosing (P4).
    pub fn choosing(&self) -> bool {
        matches!(self.phase, BuyPhase::Choosing)
    }

    /// The order, once confirmed.
    pub fn done(&self) -> Option<&Order> {
        match &self.phase {
            BuyPhase::Done(order) => Some(order),
            _ => None,
        }
    }

    /// A press of Confirm order, Check again, or Buy tickets: the request id to send, or `None`
    /// when nothing is sent (a request is in flight, or the BUY wait runs). The id is made by
    /// `new_id` (`crypto.randomUUID()`) on the purchase's first press and kept.
    pub fn press(&mut self, waits: &Waits, new_id: impl FnOnce() -> String) -> Option<String> {
        if self.sending || waits.get(RateLimitedAction::Buy).is_some() {
            return None;
        }
        self.sending = true;
        let id = self.request_id.get_or_insert_with(new_id).clone();
        self.from_unknown = matches!(self.phase, BuyPhase::Unknown);
        self.phase = BuyPhase::Confirming {
            checking: self.from_unknown,
        };
        Some(id)
    }

    /// The answer to the request [`Buy::press`] sent. `now` starts the BUY wait on a refusal for
    /// the limit.
    pub fn answer(
        &mut self,
        result: Result<Order, ApiError>,
        waits: &mut Waits,
        now: f64,
    ) -> BuyOutcome {
        self.sending = false;
        let error = match result {
            Ok(order) => {
                let order = Box::new(order);
                self.phase = BuyPhase::Done(order.clone());
                return BuyOutcome::Done(order);
            }
            Err(e) => e,
        };
        if let Some(seconds) = limited_for(&error) {
            // Nothing was recorded; the same purchase (its request id) is kept.
            self.phase = if self.from_unknown {
                BuyPhase::Unknown
            } else {
                BuyPhase::Choosing
            };
            waits.start(RateLimitedAction::Buy, seconds, now);
            return BuyOutcome::Limited;
        }
        match error.status() {
            // The token is checked before any ordering rule, so nothing was recorded.
            Some(401) => {
                self.phase = BuyPhase::Choosing;
                BuyOutcome::SignedOut
            }
            Some(s) if s < 500 => {
                // Refused: nothing was recorded. The next press is a new purchase.
                self.request_id = None;
                self.phase = BuyPhase::Choosing;
                BuyOutcome::Refused(error)
            }
            // A server error, no answer, or an answer that could not be read.
            _ => {
                self.phase = BuyPhase::Unknown;
                BuyOutcome::Unknown
            }
        }
    }

    /// A change to what is bought starts a new purchase (a new request id).
    pub fn reset(&mut self) {
        self.request_id = None;
    }
}

/// The confirm button's text (P4).
pub fn confirm_button_text(phase: &BuyPhase) -> &'static str {
    if matches!(phase, BuyPhase::Confirming { .. }) {
        "Confirming…"
    } else {
        "Confirm order"
    }
}

/// P8: a refusal's text, the Backend's `error.message`, or "The request was refused." for an
/// answer without the envelope.
pub fn refusal_message(error: &ApiError) -> String {
    match error {
        ApiError::Status(e) if e.enveloped => e.message.clone(),
        _ => "The request was refused.".into(),
    }
}

/// P7: `POST /events/{id}/orders`' body, `{ tierId?, holderName, quantity, requestId }`.
pub fn order_body(
    tier_id: Option<&Uuid>,
    holder_name: &str,
    quantity: u64,
    request_id: &str,
) -> Value {
    let mut body = Map::new();
    if let Some(t) = tier_id {
        body.insert("tierId".into(), json!(t.to_string()));
    }
    body.insert("holderName".into(), json!(holder_name));
    body.insert("quantity".into(), json!(quantity));
    body.insert("requestId".into(), json!(request_id));
    Value::Object(body)
}

/// P11, T3: a ticket's code, and with a seat "{code}, Section 115, Row F, Seat 7, Courtside,
/// $95.00".
pub fn ticket_code_line(t: &Ticket) -> String {
    match &t.seat {
        Some(s) => format!(
            "{}, {}",
            t.code.as_str(),
            seat_with_price(
                &SeatRef::from_label(s),
                t.level_name.as_deref(),
                Some(t.price.as_str())
            )
        ),
        None => t.code.as_str().to_owned(),
    }
}

/// Spec 034 FR-012 (P11): an order placed at or after its event's start gets the admit line.
pub fn order_is_late(created_at: DateTime<Utc>, starts_at: DateTime<Utc>) -> bool {
    created_at >= starts_at
}
