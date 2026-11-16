//! Parity P1–P11, M1–M16, E6–E8 (`customer-app/src/components/GetTickets.tsx`): the Get tickets
//! panel. `frame` is the card both kinds of event use (session C), `general` the general-admission
//! form (C), `seated` the seat map and holds (D); this module picks one (B's T037).

pub mod frame;
pub mod general;
pub mod seated;

use leptos::prelude::*;

/// The Get tickets panel of the event page. Stub until T043/T050.
#[component]
pub fn GetTickets(#[prop(into)] event_id: String) -> impl IntoView {
    let _ = event_id;
    view! { <></> }
}
