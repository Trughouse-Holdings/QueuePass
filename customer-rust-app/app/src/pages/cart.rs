//! Parity C1–C10 (`customer-app/src/pages/Cart.tsx`; spec 033, 038): the customer's active
//! reservations, whichever Customer app made them, each bought on its own with Buy tickets before
//! its countdown ends, with one Name on tickets field for all. Every rule is `core::cart`'s; this
//! view does the reads (at once, every 1,000 ms while visible, at once on `visibilitychange` to
//! visible and on `focus`, never while hidden), the 250 ms ticks, the event details' reads, the
//! purchases, and the one `/me/orders` read of an entry that vanished. No seat stream and no
//! browser storage.

use std::{collections::BTreeMap, time::Duration};

use customer_rust_core::{
    api::{
        client::{ApiError, ops},
        types::{Event, MyOrder, Order},
    },
    buy::RateLimitedAction,
    cart::{
        Cart as CartState, CartStatus, CartView, DetailsAnswer, EMPTY, LOADING, PlacedOrder,
        READ_EVERY_MS, ShownEntry,
    },
    format::when,
    holder_name::HolderNameField as NameField,
    reservation::Reservation,
    time::to_iso_string,
};
use leptos::{html, prelude::*, task::spawn_local};
use wasm_bindgen::{JsCast, closure::Closure};

use crate::{
    auth::{Auth, use_auth},
    components::{
        AppLink,
        get_tickets::frame::{perf_now, random_uuid},
        hold_countdown::HoldCountdown,
        holder_name_field::HolderNameField,
        order_confirmation::{EventTimes, OrderConfirmation},
    },
};

/// The page's state and handles.
#[derive(Clone, Copy)]
struct Page {
    cart: RwSignal<CartState>,
    /// Each listed event as read, for the confirmation's admit line.
    events: RwSignal<BTreeMap<String, Event>>,
    name: RwSignal<NameField>,
    auth: Auth,
}

impl Page {
    /// One read of the reservations, unless one is in flight or a 401 stopped them.
    fn read(self) {
        if self.cart.try_update(CartState::begin_read) != Some(true) {
            return;
        }
        let api = self.auth.api();
        spawn_local(async move {
            let result = api
                .send_quiet::<Vec<Reservation>>(ops::my_reservations())
                .await;
            let Some(out) = self.cart.try_update(|c| c.on_read(result, perf_now())) else {
                return;
            };
            if out.sign_in {
                self.auth.sign_in();
            }
            for r in out.explain {
                self.explain(r);
            }
            self.read_details();
        });
    }

    /// C8: one `/me/orders` read says whether a vanished entry was bought.
    fn explain(self, r: Reservation) {
        let api = self.auth.api();
        spawn_local(async move {
            // A 401 here starts no sign-in (quirk kept): it is said as ended.
            let orders = api
                .send_quiet::<Vec<MyOrder>>(ops::my_orders())
                .await
                .ok()
                .map(|list| list.iter().map(PlacedOrder::from).collect::<Vec<_>>());
            let _ = self.cart.try_update(|c| c.explained(&r, orders.as_deref()));
        });
    }

    /// C3: each listed event, read once (again after a failure, with the reads).
    fn read_details(self) {
        let Some(ids) = self.cart.try_update(|c| c.details_wanted(perf_now())) else {
            return;
        };
        for id in ids {
            let api = self.auth.api();
            spawn_local(async move {
                let answer = match api.send_quiet::<Event>(ops::get_event(&id)).await {
                    Ok(event) => {
                        let found = DetailsAnswer::Found {
                            name: event.name.to_string(),
                            when: when(
                                &to_iso_string(event.starts_at),
                                Some(&event.location.time_zone.to_string()),
                            ),
                        };
                        let _ = self.events.try_update(|all| all.insert(id.clone(), event));
                        found
                    }
                    Err(e) => match e.status() {
                        Some(404) => DetailsAnswer::Missing,
                        Some(401) => DetailsAnswer::SignedOut,
                        _ => DetailsAnswer::Failed,
                    },
                };
                if self
                    .cart
                    .try_update(|c| c.on_details(&id, answer, perf_now()))
                    == Some(true)
                {
                    self.auth.sign_in();
                }
            });
        }
    }

    /// Buy tickets or Check again on an entry; `pressed` gets the focus back if it fell to the
    /// page during a BUY wait (spec 026 FR-013).
    fn buy(self, event_id: String, pressed: NodeRef<html::Button>) {
        let (ok, holder) = self
            .name
            .with_untracked(|n| (n.valid(), n.value().to_string()));
        let Some(Some(call)) = self
            .cart
            .try_update(|c| c.press(&event_id, ok, &holder, random_uuid))
        else {
            return;
        };
        let api = self.auth.api();
        spawn_local(async move {
            // A 401 sends the customer through sign-in (the client does it), nothing recorded.
            let result: Result<Order, ApiError> = api.send::<Order>(call).await;
            let _ = self
                .cart
                .try_update(|c| c.on_buy_answer(&event_id, result, perf_now()));
            let waiting = self
                .cart
                .try_with_untracked(|c| c.waits.get(RateLimitedAction::Buy).is_some())
                .unwrap_or(false);
            if waiting && focus_fell() {
                request_animation_frame(move || {
                    if let Some(button) = pressed.get_untracked() {
                        let _ = button.focus();
                    }
                });
            }
        });
    }
}

/// Whether the focus is on nothing or the page itself.
fn focus_fell() -> bool {
    let doc = document();
    match doc.active_element() {
        None => true,
        Some(active) => doc.body().is_some_and(|b| b.is_same_node(Some(&active))),
    }
}

fn visible() -> bool {
    document().visibility_state() == web_sys::VisibilityState::Visible
}

#[component]
pub fn Cart() -> impl IntoView {
    let page = Page {
        cart: RwSignal::new(CartState::new()),
        events: RwSignal::new(BTreeMap::new()),
        name: RwSignal::new(NameField::default()),
        auth: use_auth(),
    };

    // C2: at once; every second while visible; at once on becoming visible or gaining focus.
    let timer = StoredValue::new_local(None::<IntervalHandle>);
    let start = move || {
        if timer.with_value(Option::is_none) {
            let handle = set_interval_with_handle(
                move || page.read(),
                Duration::from_millis(u64::from(READ_EVERY_MS)),
            );
            timer.set_value(handle.ok());
        }
    };
    let stop = move || {
        if let Some(Some(h)) = timer.try_update_value(Option::take) {
            h.clear();
        }
    };
    page.read();
    if visible() {
        start();
    }
    let on_visibility = Closure::<dyn Fn()>::new(move || {
        if visible() {
            page.read();
            start();
        } else {
            stop();
        }
    });
    let _ = document().add_event_listener_with_callback(
        "visibilitychange",
        on_visibility.as_ref().unchecked_ref(),
    );
    let focus = window_event_listener(leptos::ev::focus, move |_| page.read());
    let on_visibility = StoredValue::new_local(on_visibility);
    // The countdowns' and the BUY wait's 250 ms ticks.
    let ticker = set_interval_with_handle(
        move || page.cart.update(|c| c.tick(perf_now())),
        Duration::from_millis(250),
    )
    .ok();
    on_cleanup(move || {
        stop();
        focus.remove();
        on_visibility.with_value(|cb| {
            let _ = document().remove_event_listener_with_callback(
                "visibilitychange",
                cb.as_ref().unchecked_ref(),
            );
        });
        if let Some(t) = ticker {
            t.clear();
        }
    });

    let view_state = Memo::new(move |_| page.cart.with(CartState::view));
    let keys = Memo::new(move |_| {
        page.cart
            .with(|c| c.shown().into_iter().map(|e| e.key).collect::<Vec<_>>())
    });
    let alert = Memo::new(move |_| page.cart.with(|c| c.alert.clone()));
    let status = Memo::new(move |_| page.cart.with(|c| c.status.clone()));
    let confirmed = Memo::new(move |_| {
        page.cart.with(|c| {
            c.confirmed
                .iter()
                .map(|x| {
                    (
                        x.order.id.to_string(),
                        x.event_id.clone(),
                        x.event_name.clone(),
                    )
                })
                .collect::<Vec<_>>()
        })
    });

    view! {
        <section>
            <h1 class="page-title">"Cart"</h1>
            <p
                class="visually-hidden"
                aria-live="assertive"
                aria-atomic="true"
                data-announces="rate-limit"
            >
                {move || page.cart.with(|c| c.waits.announcement().map(str::to_string))}
            </p>
            {move || {
                alert
                    .get()
                    .map(|text| view! { <p role="alert" class="banner banner--error">{text}</p> })
            }}
            <div role="status" class=move || status.with(Option::is_some).then_some("note")>
                {move || status.get().map(|s| match &s {
                    CartStatus::Bought(_) => view! {
                        <p>{s.text()}<AppLink href="/my-tickets">"My tickets"</AppLink>"."</p>
                    }
                    .into_any(),
                    CartStatus::Ended(_) => view! { <p>{s.text()}</p> }.into_any(),
                })}
            </div>
            <For each=move || confirmed.get() key=|(id, _, _)| id.clone() let:c>
                {
                    let (order_id, event_id, name) = c;
                    let order = page.cart.with_untracked(|cart| {
                        cart.confirmed
                            .iter()
                            .find(|x| x.order.id.to_string() == order_id)
                            .map(|x| x.order.clone())
                    });
                    let times = page.events.with_untracked(|all| all.get(&event_id).map(EventTimes::of));
                    order.map(|order| match times {
                        Some(times) => view! {
                            <OrderConfirmation event_name=name order event=times/>
                        }
                        .into_any(),
                        None => view! { <OrderConfirmation event_name=name order/> }.into_any(),
                    })
                }
            </For>
            {move || match view_state.get() {
                CartView::Loading => view! { <p>{LOADING}</p> }.into_any(),
                CartView::Empty => view! { <p>{EMPTY}</p> }.into_any(),
                CartView::Entries => view! {
                    <HolderNameField field=page.name/>
                    <For each=move || keys.get() key=|k| k.clone() let:key>
                        <CartEntry page entry_key=key/>
                    </For>
                }
                .into_any(),
            }}
        </section>
    }
}

/// C4: one event in the cart.
#[component]
fn CartEntry(page: Page, entry_key: String) -> impl IntoView {
    let entry = Memo::new(move |_| {
        page.cart
            .with(|c| c.shown().into_iter().find(|e| e.key == entry_key))
    });
    let get =
        move |f: fn(&ShownEntry) -> String| entry.with(|e| e.as_ref().map(f).unwrap_or_default());
    let event_id =
        entry.with_untracked(|e| e.as_ref().map(|e| e.event_id.clone()).unwrap_or_default());
    let heading_id = format!("cart-{event_id}");
    let labelled_by = heading_id.clone();
    let href = format!("/events/{event_id}");
    let seconds_left =
        Signal::derive(move || entry.with(|e| e.as_ref().map_or(0, |e| e.seconds_left)));
    let warning = Signal::derive(move || entry.with(|e| e.as_ref().and_then(|e| e.warning)));
    let unknown = Memo::new(move |_| entry.with(|e| e.as_ref().is_some_and(|e| e.unknown)));
    let waiting = Memo::new(move |_| {
        page.cart
            .with(|c| c.waits.get(RateLimitedAction::Buy).is_some())
    });
    let wait_text = move || {
        page.cart
            .with(|c| c.waits.text(RateLimitedAction::Buy))
            .map(|text| view! { <p class="banner banner--error" aria-live="off">{text}</p> })
    };
    let buy_button = NodeRef::<html::Button>::new();
    let check_button = NodeRef::<html::Button>::new();
    let actions = {
        let event_id = event_id.clone();
        let href = href.clone();
        move || {
            let id = event_id.clone();
            if unknown.get() {
                view! {
                    <div role="alert" class="banner banner--conflict">
                        <div class="banner__body">
                            <p>"We couldn't confirm whether your order went through."</p>
                            <p>
                                "Check again, which never places a second order, or look for it in "
                                <AppLink href="/my-tickets">"My tickets"</AppLink>
                                "."
                            </p>
                            {wait_text}
                            <button
                                node_ref=check_button
                                type="button"
                                class="btn btn--ghost"
                                aria-disabled=move || waiting.get().then_some("true")
                                on:click=move |_| page.buy(id.clone(), check_button)
                            >
                                "Check again"
                            </button>
                        </div>
                    </div>
                }
                .into_any()
            } else {
                view! {
                    <div class="form__actions">
                        <AppLink href=href.clone()>"Change seats"</AppLink>
                        {wait_text}
                        <button
                            node_ref=buy_button
                            type="button"
                            class="btn btn--primary"
                            prop:disabled=move || {
                                let ok = page.name.with(NameField::valid);
                                !entry.with(|e| e.as_ref().is_some_and(|e| e.buy_enabled(ok)))
                            }
                            aria-disabled=move || waiting.get().then_some("true")
                            on:click=move |_| page.buy(id.clone(), buy_button)
                        >
                            {move || entry.with(|e| e.as_ref().map_or("Buy tickets", |e| e.buy_text))}
                        </button>
                    </div>
                }
                .into_any()
            }
        }
    };
    let seats =
        Memo::new(move |_| entry.with(|e| e.as_ref().map(|e| e.seats.clone()).unwrap_or_default()));
    view! {
        <section class="card card--padded" aria-labelledby=labelled_by>
            <h2 id=heading_id>
                <AppLink href=href>{move || get(|e| e.heading.clone())}</AppLink>
            </h2>
            <HoldCountdown seconds_left warning/>
            {move || entry.with(|e| e.as_ref().and_then(|e| e.when.clone())).map(|w| view! { <p>{w}</p> })}
            <ul aria-label="Seats">
                {move || seats.get().into_iter().map(|s| view! { <li>{s}</li> }).collect_view()}
            </ul>
            <p>{move || get(|e| e.total.clone())}</p>
            {move || {
                entry
                    .with(|e| e.as_ref().and_then(|e| e.notice.clone()))
                    .map(|text| view! { <p role="alert" class="banner banner--error">{text}</p> })
            }}
            {actions}
        </section>
    }
}
