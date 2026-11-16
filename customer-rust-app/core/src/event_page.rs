//! Spec 040 (task T037; parity E2, E5): what the event page works out, from
//! `customer-app/src/pages/EventDetail.tsx`. Spec 030 FR-014 (research R7): a past event's page
//! still opens and says it has ended, judged by the browser's clock when the event loaded; spec
//! 034 FR-017: once the Get tickets panel has answered, its answer decides, and the page never
//! says "ended" while the event is in progress.

/// `Availability['salesClosed']` as the event page reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SalesClosed {
    Cancelled,
    Ended,
}

/// The Get tickets panel's last answer about sales (`onSales`), by the Backend's clock.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SalesAnswer {
    pub event_id: String,
    pub sales_closed: Option<SalesClosed>,
    pub in_progress: bool,
}

/// `onSales`: an availability answer as the page keeps it. An answer saying `STARTED`, or without
/// `inProgress` (a Backend from before 034), counts as no answer.
pub fn sales_answer(
    event_id: &str,
    sales_closed: Option<&str>,
    in_progress: Option<bool>,
) -> Option<SalesAnswer> {
    let in_progress = in_progress?;
    let sales_closed = match sales_closed {
        None => None,
        Some("CANCELLED") => Some(SalesClosed::Cancelled),
        Some("ENDED") => Some(SalesClosed::Ended),
        Some(_) => return None,
    };
    Some(SalesAnswer {
        event_id: event_id.to_string(),
        sales_closed,
        in_progress,
    })
}

/// Whether the page says "This event has ended." (parity E5): `ends_at_ms <= loaded_at` until
/// the panel answers for this event; then not in progress and (ENDED, or CANCELLED and past by
/// the load-time clock).
pub fn page_has_ended(
    event_id: &str,
    ends_at_ms: i64,
    loaded_at: i64,
    answer: Option<&SalesAnswer>,
) -> bool {
    let by_clock = ends_at_ms <= loaded_at;
    match answer.filter(|a| a.event_id == event_id) {
        None => by_clock,
        Some(a) => {
            !a.in_progress
                && match a.sales_closed {
                    Some(SalesClosed::Ended) => true,
                    Some(SalesClosed::Cancelled) => by_clock,
                    None => false,
                }
        }
    }
}

/// The Get tickets panel's key, `{id}:seated` or `{id}:general`: a switch of seating starts the
/// panel afresh (parity E2, E8).
pub fn get_tickets_key(event_id: &str, reserved_seating: bool) -> String {
    format!(
        "{event_id}:{}",
        if reserved_seating {
            "seated"
        } else {
            "general"
        }
    )
}
