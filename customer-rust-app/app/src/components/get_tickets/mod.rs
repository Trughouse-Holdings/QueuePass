//! Parity P1–P11, M1–M16, E6–E8 (`customer-app/src/components/GetTickets.tsx`): the Get tickets
//! panel. `frame` is the card both kinds of event use (session C), `general` the general-admission
//! form (C), `seated` the seat map and holds (D); this module picks one by `reservedSeating`
//! (B's T037). The event page keys it `{id}:seated` / `{id}:general`
//! (`core::event_page::get_tickets_key`), so a switch of seating starts it afresh (E8).

pub mod frame;
pub mod general;
pub mod seated;

use customer_rust_core::{
    api::types::{Availability, Event},
    event_page::{SalesAnswer, sales_answer},
};
use leptos::prelude::*;

/// The Get tickets panel of the event page. `on_sales` gets each availability answer through
/// `core::event_page::sales_answer` (an answer saying `STARTED` or without `inProgress` is
/// dropped), for the page's ended line (E5); `on_event_changed` gets the event read again after
/// its venue map went, now general admission (E8). `loaded_at` is the page's load time; the
/// panels read their own answers' times (E6).
#[component]
pub fn GetTickets(
    event: Event,
    loaded_at: i64,
    on_sales: Callback<SalesAnswer>,
    on_event_changed: Callback<Event>,
) -> impl IntoView {
    let _ = loaded_at;
    let event_id = event.id.to_string();
    let on_availability = Callback::new(move |a: Availability| {
        let v = serde_json::to_value(&a).unwrap_or_default();
        if let Some(answer) = sales_answer(
            &event_id,
            v["salesClosed"].as_str(),
            v["inProgress"].as_bool(),
        ) {
            on_sales.run(answer);
        }
    });
    let on_sales = Some(on_availability);
    let on_event_changed = Some(on_event_changed);
    if event.reserved_seating {
        view! { <seated::Seated event on_sales on_event_changed/> }.into_any()
    } else {
        view! { <general::General event on_sales on_event_changed/> }.into_any()
    }
}
