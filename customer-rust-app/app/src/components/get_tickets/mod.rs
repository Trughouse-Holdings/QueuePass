//! Parity P1–P11, M1–M16, E6–E8 (`customer-app/src/components/GetTickets.tsx`): the Get tickets
//! panel. `frame` is the card both kinds of event use (session C), `general` the general-admission
//! form (C), `seated` the seat map and holds (D); this module picks one by `reservedSeating`
//! (B's T037). The event page keys it `{id}:seated` / `{id}:general`
//! (`core::event_page::get_tickets_key`), so a switch of seating starts it afresh (E8).

pub mod frame;
pub mod general;
pub mod seated;

use customer_rust_core::{api::types::Event, event_page::SalesAnswer};
use leptos::prelude::*;

/// What the panel gets from the event page, whichever kind of event (`GetTickets`' props).
// Read by C's and D's panels once they replace the placeholders below.
#[allow(dead_code)]
#[derive(Clone)]
pub struct PanelProps {
    /// The event as the page shows it.
    pub event: Event,
    /// When the event loaded (`Date.now()`, ms): spec 030 R7's clock.
    pub loaded_at: i64,
    /// `onSales`: each availability answer, through `core::event_page::sales_answer` (which drops
    /// an answer saying `STARTED` or without `inProgress`); the page decides E5 from it.
    pub on_sales: Callback<SalesAnswer>,
    /// `onEventChanged` (spec 038 FR-010, E8): the event as read again after its venue map went,
    /// now general admission; the page shows it and the panel starts afresh as general admission.
    pub on_event_changed: Callback<Event>,
}

/// The Get tickets panel of the event page.
#[component]
pub fn GetTickets(
    event: Event,
    loaded_at: i64,
    on_sales: Callback<SalesAnswer>,
    on_event_changed: Callback<Event>,
) -> impl IntoView {
    let seated = event.reserved_seating;
    let props = PanelProps {
        event,
        loaded_at,
        on_sales,
        on_event_changed,
    };
    if seated {
        seated_panel(props)
    } else {
        general_panel(props)
    }
}

/// PLACEHOLDER until session C's T043 lands: replace the body with C's general-admission panel
/// inside its frame (`frame.rs` + `general.rs`), passing `props`.
fn general_panel(props: PanelProps) -> AnyView {
    let _ = props;
    ().into_any()
}

/// PLACEHOLDER until session D's T050 lands: replace the body with D's seated panel
/// (`seated.rs`, inside C's frame), passing `props`.
fn seated_panel(props: PanelProps) -> AnyView {
    let _ = props;
    ().into_any()
}
