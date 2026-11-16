//! Parity T1–T7 (`customer-app/src/pages/MyTickets.tsx`; spec 006 US3, 017, 019, 030 FR-015,
//! FR-016, 032 FR-014): every order the signed-in customer placed, newest first; orders whose
//! event had not ended when the page loaded, then a Past section. The load time is read once with
//! the orders, so a later render never re-decides Past or Add to calendar.

use customer_rust_core::api::types::MyOrder;
use customer_rust_core::calendar::calendar_eligible;
use customer_rust_core::format::usd;
use customer_rust_core::load::Load;
use customer_rust_core::my_tickets::{
    cancelled, doors_text, empty_text, holder_text, placed_text, removed, split, starts_text,
    status_text, ticket_line, ticket_links, zone,
};
use leptos::prelude::*;

use crate::components::add_to_calendar::AddToCalendar;
use crate::components::{AppLink, ServiceUnreachable};
use crate::load::use_load;
use crate::util::now_ms;

#[component]
pub fn MyTickets() -> impl IntoView {
    let load = use_load(
        || "my-orders",
        |api, _| async move { api.list_my_orders().await.map(|o| (o, now_ms())) },
    );
    move || match load.get() {
        Load::Loading => view! { <p>"Loading…"</p> }.into_any(),
        Load::Missing | Load::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
        Load::Ok((orders, loaded_at)) => page(&orders, loaded_at).into_any(),
    }
}

fn page(orders: &[MyOrder], loaded_at: i64) -> impl IntoView + use<> {
    let (upcoming, past) = split(orders, loaded_at);
    let empty = empty_text(orders.len(), upcoming.len()).map(|text| {
        view! {
            <p>{text} " " <AppLink href="/events">"Browse events"</AppLink></p>
        }
    });
    let upcoming = upcoming
        .into_iter()
        .map(|o| order_card(o, loaded_at, false))
        .collect_view();
    let past = (!past.is_empty()).then(|| {
        let cards = past
            .into_iter()
            .map(|o| order_card(o, loaded_at, true))
            .collect_view();
        view! {
            <section aria-labelledby="past-orders">
                <h2 id="past-orders">"Past"</h2>
                {cards}
            </section>
        }
    });
    view! {
        <section>
            <h1 class="page-title">"My tickets"</h1>
            {empty}
            {upcoming}
            {past}
        </section>
    }
}

/// T2–T5: one order's card. `ended`: the event had ended when the page loaded (under Past, its
/// heading one level lower, no entry code).
fn order_card(o: &MyOrder, loaded_at: i64, ended: bool) -> impl IntoView + use<> {
    let heading_id = format!("order-{}", o.id);
    let event_href = format!("/events/{}", o.event.id);
    let event_name = o.event.name.clone();
    let link = view! { <AppLink href=event_href>{event_name}</AppLink> };
    let heading = if ended {
        view! { <h3 id=heading_id.clone()>{link}</h3> }.into_any()
    } else {
        view! { <h2 id=heading_id.clone()>{link}</h2> }.into_any()
    };
    let is_removed = removed(o);
    let z = zone(o);
    let tier = o.tier_name.clone().filter(|t| !t.is_empty());
    let calendar =
        calendar_eligible(o, loaded_at).then(|| view! { <AddToCalendar order=o.clone()/> });
    let tickets = o
        .tickets
        .iter()
        .map(|t| {
            let line = ticket_line(t, &z, is_removed);
            let links = ticket_links(t, is_removed, ended);
            let code = t.code.as_str().to_owned();
            let id = t.id;
            let extra = links.print.then(|| {
                let entry = links.entry_code.then(|| {
                    view! {
                        <AppLink
                            href=format!("/my-tickets/{id}/entry-code")
                            attr:aria-label=format!("Show entry code for ticket {code}")
                        >
                            "Show entry code"
                        </AppLink>
                        " "
                    }
                });
                view! {
                    " "
                    {entry}
                    <AppLink
                        href=format!("/my-tickets/{id}/print")
                        attr:aria-label=format!("Print ticket {code}")
                    >
                        "Print ticket"
                    </AppLink>
                }
            });
            view! { <li>{line}{extra}</li> }
        })
        .collect_view();
    view! {
        <article class="card card--padded order-card" aria-labelledby=heading_id>
            {heading}
            {cancelled(o)
                .then(|| {
                    view! {
                        <p>
                            <strong>"This event has been cancelled."</strong>
                        </p>
                    }
                })}
            <dl>
                <dt>"Venue"</dt>
                <dd>{o.event.location.name.clone()}</dd>
                <dt>"Doors open"</dt>
                <dd>{doors_text(o)}</dd>
                <dt>"Starts"</dt>
                <dd>{starts_text(o)}</dd>
                {tier.map(|t| view! {
                    <dt>"Tier"</dt>
                    <dd>{t}</dd>
                })}
                <dt>"Name on tickets"</dt>
                <dd>{holder_text(o)}</dd>
                <dt>"Quantity"</dt>
                <dd>{o.quantity.get()}</dd>
                <dt>"Total"</dt>
                <dd>{usd(&o.total_price)}</dd>
                <dt>"Placed"</dt>
                <dd>{placed_text(o)}</dd>
                <dt>"Status"</dt>
                <dd>{status_text(o)}</dd>
            </dl>
            {calendar}
            <ul aria-label="Tickets" class="ticket-list">
                {tickets}
            </ul>
        </article>
    }
}
