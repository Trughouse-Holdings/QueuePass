//! Parity T9–T11 (`customer-app/src/pages/EntryCode.tsx`, `live-code-clock.ts`; spec 018 FR-001,
//! FR-002, FR-004, FR-009, FR-010): one ticket's live code, which changes every 30 seconds on the
//! Backend's clock. The key is asked for once, alongside My tickets' orders; after that the page
//! makes every code itself (`core::live_code`), so it keeps working without a signal while open.
//! The key lives in this page's memory only: never in storage, a cookie, or the URL.

use std::future::Future;
use std::pin::pin;
use std::task::Poll;
use std::time::Duration;

use customer_rust_core::api::client::ops;
use customer_rust_core::api::types::{MyOrder, TicketEntryKey};
use customer_rust_core::format::{SeatRef, seat_label};
use customer_rust_core::live_code::{
    EntryPage, NO_CONNECTION, TICK_MS, Tick, countdown_text, entry_page, live_code, server_now,
    tick_at,
};
use customer_rust_core::my_tickets::{holder_text, starts_text};
use leptos::{prelude::*, task::spawn_local};
use leptos_router::hooks::use_params_map;

use crate::auth::use_auth;
use crate::components::ticket_qr::TicketQr;
use crate::components::{AppLink, ServiceUnreachable};

/// The browser's monotonic clock, `performance.now()` (ms).
fn perf_now() -> f64 {
    window().performance().map_or(0.0, |p| p.now())
}

/// Both futures at once, as `Promise.all` (both always settle here).
async fn join2<A: Future, B: Future>(a: A, b: B) -> (A::Output, B::Output) {
    let mut a = pin!(a);
    let mut b = pin!(b);
    let mut ra = None;
    let mut rb = None;
    std::future::poll_fn(move |cx| {
        if ra.is_none()
            && let Poll::Ready(v) = a.as_mut().poll(cx)
        {
            ra = Some(v);
        }
        if rb.is_none()
            && let Poll::Ready(v) = b.as_mut().poll(cx)
        {
            rb = Some(v);
        }
        match (ra.take(), rb.take()) {
            (Some(x), Some(y)) => Poll::Ready((x, y)),
            (x, y) => {
                ra = x;
                rb = y;
                Poll::Pending
            }
        }
    })
    .await
}

/// What the page shows.
#[derive(Clone)]
enum Page {
    Loading,
    Done(EntryPage),
}

#[component]
pub fn EntryCode() -> impl IntoView {
    let params = use_params_map();
    let ticket_id = Memo::new(move |_| params.read().get("ticketId").unwrap_or_default());
    let auth = use_auth();
    let page = RwSignal::new(Page::Loading);
    let attempt = RwSignal::new(0u32);
    let asked = StoredValue::new(0u64);

    Effect::new(move |_| {
        let id = ticket_id.get();
        attempt.track();
        let ticket = asked.get_value() + 1;
        asked.set_value(ticket);
        page.set(Page::Loading);
        let api = auth.api();
        spawn_local(async move {
            let sent = perf_now();
            let key_id = id.clone();
            let key_api = api.clone();
            let key = async move {
                let k = key_api
                    .send_quiet::<TicketEntryKey>(ops::entry_key(&key_id))
                    .await;
                (k, perf_now())
            };
            let (orders, (key, received)) =
                join2(api.send_quiet::<Vec<MyOrder>>(ops::my_orders()), key).await;
            if asked.try_get_value() != Some(ticket) {
                return;
            }
            let next = entry_page(orders, key, &id, sent, received);
            if matches!(next, EntryPage::SignIn) {
                auth.sign_in();
                return;
            }
            page.set(Page::Done(next));
        });
    });

    let back = || view! { <AppLink href="/my-tickets">"Back to My tickets"</AppLink> };
    // Asks for both again: a customer whose signal comes back needn't leave the page.
    let try_again = move || {
        view! {
            <button type="button" class="btn" on:click=move |_| attempt.update(|n| *n += 1)>
                "Try again"
            </button>
        }
    };

    move || match page.get() {
        Page::Loading | Page::Done(EntryPage::SignIn) => {
            view! { <p>"Getting your entry code…"</p> }.into_any()
        }
        Page::Done(EntryPage::Offline) => view! {
            <section>
                <p role="alert" class="banner banner--error">
                    {NO_CONNECTION}
                </p>
                {try_again()}
                {back()}
            </section>
        }
        .into_any(),
        Page::Done(EntryPage::Refused(message)) => view! {
            <section>
                <p role="alert">{message}</p>
                {back()}
            </section>
        }
        .into_any(),
        Page::Done(EntryPage::Failed) => view! {
            <section>
                <ServiceUnreachable/>
                {try_again()}
            </section>
        }
        .into_any(),
        Page::Done(EntryPage::Missing) => view! {
            <section>
                <p>"Ticket not found."</p>
                {back()}
            </section>
        }
        .into_any(),
        Page::Done(EntryPage::Ok { order, key, offset }) => {
            let id = ticket_id.get_untracked();
            let seat = order
                .tickets
                .iter()
                .find(|t| t.id.to_string() == id)
                .and_then(|t| t.seat.as_ref())
                .map(|s| seat_label(&SeatRef::from_label(s)));
            view! {
                <section class="entry-code" aria-labelledby="entry-code-heading">
                    <div class="entry-code__card card card--padded">
                        <h1 id="entry-code-heading">{order.event.name.clone()}</h1>
                        <LiveCode secret=key offset ticket_id=id/>
                        <p class="note">"Show this at the gate. It changes every 30 seconds."</p>
                        <dl>
                            <dt>"Name on ticket"</dt>
                            <dd>{holder_text(&order)}</dd>
                            <dt>"Starts"</dt>
                            <dd>{starts_text(&order)}</dd>
                            {seat.map(|s| view! {
                                <dt>"Seat"</dt>
                                <dd>{s}</dd>
                            })}
                        </dl>
                    </div>
                    {back()}
                </section>
            }
            .into_any()
        }
    }
}

/// T10, T11: the current window's code and its countdown on the Backend's clock, read every
/// 250 ms. The countdown is plain text outside any live region (FR-004).
#[component]
fn LiveCode(secret: Vec<u8>, offset: f64, ticket_id: String) -> impl IntoView {
    let tick = RwSignal::new(tick_at(server_now(perf_now(), offset)));
    let handle = set_interval_with_handle(
        move || {
            let next: Tick = tick_at(server_now(perf_now(), offset));
            if tick.get_untracked() != next {
                tick.set(next);
            }
        },
        Duration::from_millis(u64::from(TICK_MS)),
    );
    on_cleanup(move || {
        if let Ok(h) = handle {
            h.clear();
        }
    });
    let code = Memo::new(move |_| live_code(&secret, &ticket_id, tick.with(|t| t.window)));
    view! {
        {move || {
            view! {
                <TicketQr
                    code=code.get()
                    label="Live entry code, changes every 30 seconds"
                    class="ticket-qr--live"
                />
            }
        }}
        <p class="entry-code__countdown">{move || countdown_text(tick.with(|t| t.seconds_left))}</p>
    }
}
