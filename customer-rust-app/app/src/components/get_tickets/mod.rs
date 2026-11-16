//! Parity P1–P11, M1–M16, E6–E8 (`customer-app/src/components/GetTickets.tsx`): the Get tickets
//! panel. `frame` is the card both kinds of event use (session C), `general` the general-admission
//! form (C), `seated` the seat map and holds (D); this module picks one (B's T037).
//!
//! Filled minimally by session C for general admission (B owns this file): the seated branch
//! shows the frame alone until session D's `seated::Seated` (same props as `general::General`)
//! takes its place. The page keys the panel by `{id}:seated` / `{id}:general` (parity E2).

pub mod frame;
pub mod general;
pub mod seated;

use customer_rust_core::api::types::{Availability, Event};
use leptos::prelude::*;

/// The Get tickets panel of the event page. `on_sales`: each availability answer, for the page's
/// ended line (spec 034 FR-017); `on_event_changed`: the event read again after its venue map
/// went, now general admission (spec 038 FR-010).
#[component]
pub fn GetTickets(
    event: Event,
    #[prop(optional)] on_sales: Option<Callback<Availability>>,
    #[prop(optional)] on_event_changed: Option<Callback<Event>>,
) -> impl IntoView {
    if event.reserved_seating {
        let panel = frame::Panel::new(event, on_sales, on_event_changed);
        view! { <frame::GetTicketsFrame panel>""</frame::GetTicketsFrame> }.into_any()
    } else {
        view! { <general::General event on_sales on_event_changed/> }.into_any()
    }
}
