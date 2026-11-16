//! Spec 040 T053 (parity T1–T4, T8; research R10): My tickets and the printable ticket, ported
//! from `customer-app/src/pages/MyTickets.tsx` and `PrintTicket.tsx`: upcoming and Past by the
//! load time, the order card's texts, each ticket's state, which links show, and which tickets
//! can be printed.

use crate::api::types::{MyOrder, MyOrderStatus, OrderEventStatus, Ticket, TicketStatus};
use crate::buy::ticket_code_line;
use crate::format::{doors_open, has_ended, when};
use crate::time::to_iso_string;

/// The venue's zone of an order's event.
pub fn zone(order: &MyOrder) -> String {
    order.event.location.time_zone.to_string()
}

/// Spec 030 FR-015 (T1): the orders whose event had ended when the page loaded (`endsAt <=
/// loaded_at`), and the rest, each in the Backend's order (newest first).
pub fn split(orders: &[MyOrder], loaded_at_ms: i64) -> (Vec<&MyOrder>, Vec<&MyOrder>) {
    orders
        .iter()
        .partition(|o| !has_ended(&to_iso_string(o.event.ends_at), loaded_at_ms))
}

/// T1: the line when there is nothing upcoming, before "Browse events", or `None`.
pub fn empty_text(orders: usize, upcoming: usize) -> Option<&'static str> {
    if orders == 0 {
        Some("You have no tickets yet.")
    } else if upcoming == 0 {
        Some("You have no upcoming tickets.")
    } else {
        None
    }
}

/// Spec 032 FR-014: the event's check-in details were removed.
pub fn removed(order: &MyOrder) -> bool {
    order.event.check_in_details_removed_at.is_some()
}

/// Whether the event is cancelled ("This event has been cancelled.").
pub fn cancelled(order: &MyOrder) -> bool {
    order.event.status == OrderEventStatus::Cancelled
}

/// Spec 017 FR-004, FR-005: the holder's name, or "No name on ticket" for an older order.
pub fn holder_text(order: &MyOrder) -> String {
    order
        .holder_name
        .as_ref()
        .map_or_else(|| "No name on ticket".into(), |n| n.as_str().to_owned())
}

/// T2: "Refunded" or "Confirmed".
pub fn status_text(order: &MyOrder) -> &'static str {
    match order.status {
        MyOrderStatus::Refunded => "Refunded",
        MyOrderStatus::Confirmed => "Confirmed",
    }
}

/// T2: the start, "Oct 1, 2026, 7:00 PM EDT", in the venue's zone.
pub fn starts_text(order: &MyOrder) -> String {
    when(&to_iso_string(order.event.starts_at), Some(&zone(order)))
}

/// T2: the doors-open time beside the start.
pub fn doors_text(order: &MyOrder) -> String {
    doors_open(
        &to_iso_string(order.event.starts_at),
        &to_iso_string(order.event.doors_open_at),
        Some(&zone(order)),
    )
}

/// T2: when the order was placed, in the venue's zone.
pub fn placed_text(order: &MyOrder) -> String {
    when(&to_iso_string(order.created_at), Some(&zone(order)))
}

/// Ports `ticketState` (T3): "Void", "Event over" (details removed), "Used {time}" in the venue's
/// zone, or "Valid".
pub fn ticket_state(t: &Ticket, time_zone: &str, removed: bool) -> String {
    if t.status == TicketStatus::Void {
        "Void".into()
    } else if removed {
        "Event over".into()
    } else if let Some(at) = t.checked_in_at {
        format!("Used {}", when(&to_iso_string(at), Some(time_zone)))
    } else {
        "Valid".into()
    }
}

/// T3: "{code}: {state}", or with a seat "{code}, Section 115, Row F, Seat 7, Courtside, $95.00:
/// {state}".
pub fn ticket_line(t: &Ticket, time_zone: &str, removed: bool) -> String {
    format!(
        "{}: {}",
        ticket_code_line(t),
        ticket_state(t, time_zone, removed)
    )
}

/// T4: which links follow a ticket.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TicketLinks {
    /// "Show entry code" (upcoming cards only).
    pub entry_code: bool,
    /// "Print ticket" (past cards too).
    pub print: bool,
}

/// T4: a valid, unused ticket of an event whose details are not removed offers Print ticket, and
/// Show entry code while the event had not ended when the page loaded.
pub fn ticket_links(t: &Ticket, removed: bool, ended: bool) -> TicketLinks {
    let usable = t.status == TicketStatus::Valid && t.checked_in_at.is_none() && !removed;
    TicketLinks {
        entry_code: usable && !ended,
        print: usable,
    }
}

/// T8: what the printable ticket page shows for `ticket_id`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PrintState {
    /// "Ticket not found." (not the caller's).
    NotFound,
    /// "This ticket can't be printed." (void, used, or details removed).
    CantPrint,
    /// The order and the ticket, by index.
    Ticket { order: usize, ticket: usize },
}

/// Ports `PrintTicket`'s decision (T8).
pub fn print_state(orders: &[MyOrder], ticket_id: &str) -> PrintState {
    for (oi, o) in orders.iter().enumerate() {
        if let Some(ti) = o.tickets.iter().position(|t| t.id.to_string() == ticket_id) {
            let t = &o.tickets[ti];
            if t.status != TicketStatus::Valid || t.checked_in_at.is_some() || removed(o) {
                return PrintState::CantPrint;
            }
            return PrintState::Ticket {
                order: oi,
                ticket: ti,
            };
        }
    }
    PrintState::NotFound
}
