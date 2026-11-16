//! Spec 040 T042 (parity P1–P6, E6, E7; research R10): what the Get tickets panel shows from the
//! Backend's answers (`GET /events/{id}/availability` and `/tiers`), ported from
//! `customer-app/src/components/GetTickets.tsx`: the closed badge and text, the started note, the
//! limit line and box, the tier choices and "From", the quantity bounds, and the totals in cents.
//! The general-admission form (session C) and the seated panel (session D) both read these.

pub use uuid::Uuid;

use crate::api::types::{Availability, AvailabilitySalesClosed, TicketTier};
use crate::format::{StartedNoticeKind, cents, count, started_notice, total_usd, usd};
use crate::time::{instant_from_ms, to_iso_string};

/// `ORDER_LIMITS.maxQuantity` (`packages/shared/src/order.ts`): tickets per order.
pub const MAX_QUANTITY: u64 = 10;

/// `RESERVATION_LIMITS.maxSeats` (`packages/shared/src/seating.ts`): seats per reservation.
pub const MAX_SEATS: u64 = 10;

/// `tickets(n)`: "1 ticket", "4 tickets" (parity F6).
pub fn tickets(n: u64) -> String {
    format!("{n} {}", if n == 1 { "ticket" } else { "tickets" })
}

/// The badge beside the closed text (spec 008 US3-2). Quirk kept (E7): "Not on sale" never shows,
/// since the badge only shows with a closed text.
pub fn closed_badge(a: &Availability) -> &'static str {
    match a.sales_closed {
        Some(AvailabilitySalesClosed::Cancelled) => "Cancelled",
        Some(AvailabilitySalesClosed::Ended) => "Sales closed",
        None if a.tickets_left == 0 => "Sold out",
        None => "Not on sale",
    }
}

/// Why no tickets can be had, for every customer (E7), or `None`.
pub fn closed_text(a: &Availability) -> Option<&'static str> {
    match a.sales_closed {
        Some(AvailabilitySalesClosed::Cancelled) => {
            Some("No tickets: this event has been cancelled.")
        }
        Some(AvailabilitySalesClosed::Ended) => Some("Sales closed: this event has ended."),
        None if a.tickets_left == 0 => Some("Sold out: no tickets are left for this event."),
        None => None,
    }
}

/// Spec 016 FR-014 (P6): the customer is at their limit, after the closed messages.
pub fn reached_text(a: &Availability) -> Option<String> {
    let limit = a.customer_limit.as_ref()?;
    (closed_text(a).is_none() && limit.remaining == 0).then(|| {
        format!(
            "You have reached the limit of {} for this event.",
            tickets(limit.limit.get())
        )
    })
}

/// What the panel shows below its notices (P2), unless the unknown outcome shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PanelBody {
    /// `<p><span class="pill pill--danger">{badge}</span></p><p>{text}</p>` (E7).
    Closed {
        badge: &'static str,
        text: &'static str,
    },
    /// `<p class="banner banner--conflict">{text}</p>` (P6).
    Reached(String),
    /// The form: general admission's or the seated panel's.
    Form,
}

/// The panel's body: closed, the limit reached (unless seats are held), or the form.
pub fn panel_body(a: &Availability, has_reservation: bool) -> PanelBody {
    if let Some(text) = closed_text(a) {
        return PanelBody::Closed {
            badge: closed_badge(a),
            text,
        };
    }
    match reached_text(a) {
        Some(text) if !has_reservation => PanelBody::Reached(text),
        _ => PanelBody::Form,
    }
}

/// Spec 034 FR-008 to FR-010 (E6): the note at the top of the panel, from the Backend's answer
/// (`inProgress` and no `salesClosed`), never the browser's clock; its first sentence alone when
/// the panel shows a reason it offers no tickets. Times are relative to `loaded_at_ms`, when the
/// answer shown was loaded (`Date.now()`).
pub fn started_note(
    a: &Availability,
    starts_at: &str,
    ends_at: &str,
    time_zone: Option<&str>,
    loaded_at_ms: i64,
    has_reservation: bool,
) -> Option<String> {
    if !(a.in_progress && a.sales_closed.is_none()) {
        return None;
    }
    let kind = if closed_text(a).is_some() || (reached_text(a).is_some() && !has_reservation) {
        StartedNoticeKind::First
    } else {
        StartedNoticeKind::Buy
    };
    let at = instant_from_ms(loaded_at_ms).map(to_iso_string)?;
    Some(started_notice(starts_at, ends_at, time_zone, &at, kind))
}

/// Spec 016 FR-012: "Limit: 8 tickets per customer. You can get 3 more.", or `None` without a
/// limit (a missing `customerLimit` is none).
pub fn limit_line(a: &Availability) -> Option<String> {
    a.customer_limit.as_ref().map(|l| {
        format!(
            "Limit: {} per customer. You can get {} more.",
            tickets(l.limit.get()),
            l.remaining
        )
    })
}

/// A tier's tickets left, 0 when the answer does not list it.
pub fn tier_left(a: &Availability, tier_id: &Uuid) -> u64 {
    a.tiers
        .iter()
        .find(|t| &t.tier_id == tier_id)
        .map_or(0, |t| t.tickets_left)
}

/// The tickets left for the tier chosen, or the event's when none is.
pub fn tickets_left_for(a: &Availability, chosen: Option<&Uuid>) -> u64 {
    chosen.map_or(a.tickets_left, |t| tier_left(a, t))
}

/// P4: `max(1, min(10, tickets left, the limit's remaining))`, the quantity choices 1 … max.
pub fn max_quantity(a: &Availability, chosen: Option<&Uuid>) -> u64 {
    let remaining = a.customer_limit.as_ref().map_or(u64::MAX, |l| l.remaining);
    MAX_QUANTITY
        .min(tickets_left_for(a, chosen))
        .min(remaining)
        .max(1)
}

/// Spec 016 US4-3, research R3: the limit is what stops more seats; on a tie with the tickets
/// left it does not bind (the Backend answers SOLD_OUT).
pub fn limit_binds(a: &Availability, chosen: Option<&Uuid>) -> bool {
    a.customer_limit
        .as_ref()
        .is_some_and(|l| l.remaining <= MAX_QUANTITY && l.remaining < tickets_left_for(a, chosen))
}

/// The seated panel's note when the limit binds and no more seats can be chosen (M9).
pub fn limit_full_note(a: &Availability) -> Option<String> {
    let l = a.customer_limit.as_ref()?;
    Some(format!(
        "No more seats can be chosen: the limit of {} per customer allows you {} more.",
        tickets(l.limit.get()),
        l.remaining
    ))
}

/// The seated panel's note at the reservation's seat cap.
pub fn max_seats_note() -> String {
    format!("A reservation holds at most {MAX_SEATS} seats.")
}

/// The seated panel's stat tile label.
pub fn seats_left_label(n: u64) -> &'static str {
    if n == 1 { "Seat left" } else { "Seats left" }
}

/// Spec 008 FR-005: "From $19.99", the lowest tier price compared in whole cents (the first on
/// a tie), only with tiers.
pub fn from_price(tiers: &[TicketTier]) -> Option<String> {
    let first = tiers.first()?;
    let lowest = tiers.iter().fold(first.price.as_str(), |lo, t| {
        match (cents(&t.price), cents(lo)) {
            (Some(a), Some(b)) if a < b => t.price.as_str(),
            _ => lo,
        }
    });
    Some(format!("From {}", usd(lowest)))
}

/// P3: a tier's choice, "VIP, $120.00, 6 left" or "VIP, $120.00, sold out".
pub fn tier_choice(tier: &TicketTier, left: u64) -> String {
    if left == 0 {
        format!("{}, {}, sold out", tier.name.as_str(), usd(&tier.price))
    } else {
        format!(
            "{}, {}, {} left",
            tier.name.as_str(),
            usd(&tier.price),
            count(left as i64)
        )
    }
}

/// P3: without tiers, "$45.50 each, 7 left" (the base price).
pub fn base_line(base_price: &str, tickets_left: u64) -> String {
    format!(
        "{} each, {} left",
        usd(base_price),
        count(tickets_left as i64)
    )
}

/// The price of one ticket: the tier chosen's with tiers (none until one is chosen), else the
/// base price.
pub fn unit_price<'a>(
    tiers: &'a [TicketTier],
    chosen: Option<&Uuid>,
    base_price: &'a str,
) -> Option<&'a str> {
    if tiers.is_empty() {
        return Some(base_price);
    }
    let chosen = chosen?;
    tiers
        .iter()
        .find(|t| &t.id == chosen)
        .map(|t| t.price.as_str())
}

/// "Total: $59.97" (`totalUsd`, integer cents).
pub fn total_line(price: &str, quantity: u64) -> String {
    format!("Total: {}", total_usd(price, quantity as i64))
}

/// P4: Confirm order is enabled with a price, tickets left, a quantity, a valid name, and no
/// confirmation running.
pub fn can_confirm(
    price: Option<&str>,
    tickets_left: u64,
    quantity: u64,
    name_valid: bool,
    choosing: bool,
) -> bool {
    price.is_some() && tickets_left > 0 && quantity > 0 && name_valid && choosing
}
