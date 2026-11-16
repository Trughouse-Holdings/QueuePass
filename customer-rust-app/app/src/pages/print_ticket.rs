//! Parity T8, T12, S15 (`customer-app/src/pages/PrintTicket.tsx`; spec 017 FR-012, FR-013, 030
//! FR-016, 032, 038 FR-026): one ticket on one printed page: the QR, the code in text, the
//! holder's name, the event, venue, times, and seat. It reads the caller's own orders, so it shows
//! only their tickets; a used or void ticket, or one of an event whose check-in details were
//! removed, has no printable view.

use customer_rust_core::api::types::MyOrder;
use customer_rust_core::format::{SeatRef, seat_label, usd};
use customer_rust_core::load::Load;
use customer_rust_core::my_tickets::{
    PrintState, doors_text, holder_text, print_state, starts_text,
};
use leptos::prelude::*;
use leptos_router::hooks::use_params_map;

use crate::components::{AppLink, ServiceUnreachable};
use crate::load::use_load;

#[component]
pub fn PrintTicket() -> impl IntoView {
    let params = use_params_map();
    let ticket_id = Memo::new(move |_| params.read().get("ticketId").unwrap_or_default());
    let load = use_load(
        || "my-orders",
        |api, _| async move { api.list_my_orders().await },
    );
    move || match load.get() {
        Load::Loading => view! { <p>"Loading…"</p> }.into_any(),
        Load::Missing | Load::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
        Load::Ok(orders) => page(&orders, &ticket_id.get()).into_any(),
    }
}

fn back_section(text: &'static str) -> AnyView {
    view! {
        <section>
            <p>{text}</p>
            <AppLink href="/my-tickets">"Back to My tickets"</AppLink>
        </section>
    }
    .into_any()
}

fn page(orders: &[MyOrder], ticket_id: &str) -> AnyView {
    let (oi, ti) = match print_state(orders, ticket_id) {
        PrintState::NotFound => return back_section("Ticket not found."),
        PrintState::CantPrint => return back_section("This ticket can't be printed."),
        PrintState::Ticket { order, ticket } => (order, ticket),
    };
    let order = &orders[oi];
    let ticket = &order.tickets[ti];
    let code = ticket.code.as_str().to_owned();
    let seat = ticket
        .seat
        .as_ref()
        .map(|s| seat_label(&SeatRef::from_label(s)));
    let level = ticket.level_name.clone().filter(|l| !l.is_empty());
    let price = (ticket.seat.is_some() && !ticket.price.is_empty()).then(|| usd(&ticket.price));
    view! {
        <section class="print-ticket" aria-labelledby="print-ticket-heading">
            <div class="print-ticket__page card card--padded">
                <h1 id="print-ticket-heading">{order.event.name.clone()}</h1>
                <crate::components::ticket_qr::TicketQr code=code.clone()/>
                <p class="print-ticket__code">{code}</p>
                <dl>
                    <dt>"Name on ticket"</dt>
                    <dd>{holder_text(order)}</dd>
                    <dt>"Venue"</dt>
                    <dd>{order.event.location.name.clone()}</dd>
                    <dt>"Doors open"</dt>
                    <dd>{doors_text(order)}</dd>
                    <dt>"Starts"</dt>
                    <dd>{starts_text(order)}</dd>
                    {seat.map(|s| view! {
                        <dt>"Seat"</dt>
                        <dd>{s}</dd>
                    })}
                    {level.map(|l| view! {
                        <dt>"Price level"</dt>
                        <dd>{l}</dd>
                    })}
                    {price.map(|p| view! {
                        <dt>"Price"</dt>
                        <dd>{p}</dd>
                    })}
                </dl>
                <p class="note">"Show this code at the gate with the photo ID named above."</p>
            </div>
            <div class="print-ticket__actions">
                <button
                    type="button"
                    class="btn btn--primary"
                    on:click=move |_| {
                        let _ = window().print();
                    }
                >
                    "Print"
                </button>
                <AppLink href="/my-tickets">"Back to My tickets"</AppLink>
            </div>
        </section>
    }
    .into_any()
}
