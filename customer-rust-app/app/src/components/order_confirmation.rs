//! Parity P11 (`customer-app/src/components/OrderConfirmation.tsx`; spec 006 FR-004, 034 FR-012,
//! 038 FR-022, FR-026): what was bought, what it cost, and every ticket code with its seat. The
//! general-admission panel and the Cart (session D) confirm the same way. For an order placed at
//! or after its event's start, how long the tickets admit; without the event's times (the Cart
//! could not read them), no such line.

use chrono::{DateTime, Utc};
use customer_rust_core::api::types::Order;
use customer_rust_core::buy::{order_is_late, ticket_code_line};
use customer_rust_core::format::{StartedNoticeKind, started_notice, usd};
use customer_rust_core::time::to_iso_string;
use leptos::prelude::*;

use crate::components::AppLink;

/// The event's times the admit line needs (`Pick<Event, 'startsAt' | 'endsAt' | 'location'>`).
#[derive(Clone, Debug, PartialEq)]
pub struct EventTimes {
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    /// The venue's zone (`location.timeZone`).
    pub time_zone: String,
}

impl EventTimes {
    pub fn of(event: &customer_rust_core::api::types::Event) -> Self {
        EventTimes {
            starts_at: event.starts_at,
            ends_at: event.ends_at,
            time_zone: event.location.time_zone.to_string(),
        }
    }
}

/// `<section aria-label="Order confirmed">` (P11).
#[component]
pub fn OrderConfirmation(
    #[prop(into)] event_name: String,
    order: Order,
    #[prop(optional)] event: Option<EventTimes>,
) -> impl IntoView {
    let late = event
        .filter(|e| order_is_late(order.created_at, e.starts_at))
        .map(|e| {
            started_notice(
                &to_iso_string(e.starts_at),
                &to_iso_string(e.ends_at),
                Some(&e.time_zone),
                &to_iso_string(order.created_at),
                StartedNoticeKind::Admit,
            )
        });
    let lines: Vec<String> = order.tickets.iter().map(ticket_code_line).collect();
    view! {
        <section aria-label="Order confirmed">
            <h2>"Order confirmed"</h2>
            {late.map(|text| view! { <p class="note">{text}</p> })}
            <dl>
                <dt>"Event"</dt>
                <dd>{event_name}</dd>
                {order
                    .tier_name
                    .clone()
                    .filter(|t| !t.is_empty())
                    .map(|tier| view! {
                        <dt>"Tier"</dt>
                        <dd>{tier}</dd>
                    })}
                <dt>"Quantity"</dt>
                <dd>{order.quantity.get()}</dd>
                {order
                    .unit_price
                    .as_ref()
                    .map(|p| {
                        let each = usd(p);
                        view! {
                            <dt>"Price each"</dt>
                            <dd>{each}</dd>
                        }
                    })}
                <dt>"Total charged"</dt>
                <dd>{usd(&order.total_price)}</dd>
            </dl>
            <h3>"Your ticket codes"</h3>
            <ul aria-label="Ticket codes">
                {lines.into_iter().map(|line| view! { <li>{line}</li> }).collect_view()}
            </ul>
            <AppLink href="/my-tickets">"See all my tickets"</AppLink>
        </section>
    }
}
