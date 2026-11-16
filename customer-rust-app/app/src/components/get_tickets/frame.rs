//! Parity P1, P2, P9, P10, E6–E8 (`customer-app/src/components/GetTickets.tsx`): the Get tickets
//! panel's frame, which both kinds of event use (session C). The general-admission form
//! (`general.rs`, session C) and the seated panel (`seated.rs`, session D) render inside it.
//!
//! # The interface (agreed in writing, tasks.md "Parallel sessions")
//!
//! A panel component (`general::General` or `seated::Seated`) does three things, in this order:
//!
//! 1. `let panel = Panel::new(event, on_sales, on_event_changed);` inside its own component body.
//!    This starts the reads (P1): the availability (again on [`Panel::refresh`]) and the tiers
//!    (once), keeps the last good answer of each, and runs the waits' 250 ms checks (P10). It
//!    `provide_context`s the panel, so children can call [`use_panel`].
//! 2. Makes its own state (signals) *outside* the frame, so the form keeps the customer's choices
//!    while the frame swaps between the form and the unknown-outcome box.
//! 3. Returns `view! { <GetTicketsFrame panel>{ /* the form */ }</GetTicketsFrame> }`. The frame
//!    shows, in order: "Loading tickets…" or an unavailable/deleted banner instead of the card
//!    while nothing is loaded; once [`Buy::done`] is set, the order confirmation instead of the
//!    card (P11); else the card with h2 "Get tickets", the started note (E6), the hidden
//!    assertive region (P10), "From" (with tiers), the notice (`panel.notice`), the run-out
//!    alert (`panel.ran_out`), and then the unknown-outcome box (P9), the closed text (E7), the
//!    limit-reached box (P6, unless `panel.has_reservation`), or the children (the form). The
//!    children are mounted once per stretch of "form" and are not re-run on other changes.
//!
//! What the seated panel sets on the [`Panel`] (all optional for general admission):
//!
//! - `has_reservation`: the customer holds seats of this event (the started note keeps both
//!   sentences and the limit box gives way to the form, as `reached && !reservation`);
//! - `seats_loading`: the venue map is still loading (`seatsLoading`): "Loading tickets…";
//! - `seats_failed`: no venue map could be had (`seatsFailed`): the unavailable banner;
//! - [`Panel::map_gone`]: the map answered 404 (E8): the frame reads the event again and shows
//!   "Loading tickets…", then "This event no longer exists.", the unavailable banner, or calls
//!   `on_event_changed` with the event now general admission (the page re-keys the panel);
//! - `ran_out`: "Your reservation ran out, …" (M13), shown by the frame after the notice;
//! - `notice`: a refusal's text (`<p role="alert" class="banner banner--error">`);
//! - `waits`: the HOLD wait is `panel.waits.update(|w| w.start(RateLimitedAction::Hold, n,
//!   perf_now()))`; its text is `w.text(Hold)` above the map, `<WaitMessage>` shows it.
//!
//! What the frame gives both: [`Panel::availability`] and [`Panel::tiers`] (last answers),
//! [`Panel::refresh`], [`Panel::started_note`]'s inputs, [`Panel::buy`] and [`Panel::waits`]
//! (`core::buy`), and [`WaitMessage`]. General admission also registers its Check again action
//! with [`Panel::set_check_again`] and names the pressed button for the focus return.

use std::rc::Rc;
use std::time::Duration;

use customer_rust_core::api::client::ApiClient;
use customer_rust_core::api::types::{Availability, Event, TicketTier};
use customer_rust_core::availability::{PanelBody, from_price, panel_body, started_note};
use customer_rust_core::buy::{Buy, RateLimitedAction, Waits};
use customer_rust_core::load::Load;
use customer_rust_core::time::to_iso_string;
use leptos::{html, prelude::*, task::spawn_local};

use crate::auth::use_auth;
use crate::components::AppLink;
use crate::components::order_confirmation::{EventTimes, OrderConfirmation};
use crate::load::use_load;
use crate::util::now_ms;

/// The browser's monotonic clock, `performance.now()` (ms).
pub fn perf_now() -> f64 {
    window().performance().map_or(0.0, |p| p.now())
}

/// `crypto.randomUUID()`: a purchase's request id.
pub fn random_uuid() -> String {
    window()
        .crypto()
        .map(|c| c.random_uuid())
        .unwrap_or_default()
}

/// E8: where the re-read of an event whose venue map went stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapGone {
    Checking,
    Deleted,
    Unavailable,
}

/// The panel's shared state. Copyable handles; see the module's interface notes.
#[derive(Clone, Copy)]
pub struct Panel {
    /// The event as the page read it.
    pub event: StoredValue<Event>,
    /// The last good availability answer (P1: a reload keeps it on screen, and if it fails).
    pub availability: RwSignal<Option<Availability>>,
    /// `Date.now()` when the answer shown was loaded (E6's reference instant).
    pub loaded_at: RwSignal<i64>,
    /// The tiers, read once per event.
    pub tiers: RwSignal<Option<Vec<TicketTier>>>,
    availability_failed: RwSignal<bool>,
    tiers_failed: RwSignal<bool>,
    reloads: RwSignal<u32>,
    /// FR-006: the Backend's reason for the last refusal, in its own words.
    pub notice: RwSignal<Option<String>>,
    /// Spec 026: the waits out of refusals for the limit, BUY and HOLD apart.
    pub waits: RwSignal<Waits>,
    /// Spec 006: the purchase (general admission's Confirm order).
    pub buy: RwSignal<Buy>,
    /// Seated: the customer holds seats of this event.
    pub has_reservation: RwSignal<bool>,
    /// Seated: the venue map is still loading.
    pub seats_loading: RwSignal<bool>,
    /// Seated: no venue map could be had.
    pub seats_failed: RwSignal<bool>,
    /// Seated: the reservation ran out (M13).
    pub ran_out: RwSignal<bool>,
    map_gone: RwSignal<Option<MapGone>>,
    on_event_changed: Option<Callback<Event>>,
    /// The Check again button of the unknown-outcome box.
    pub check_again_button: NodeRef<html::Button>,
    check_again: StoredValue<Option<Rc<dyn Fn()>>, LocalStorage>,
    api: StoredValue<ApiClient, LocalStorage>,
}

/// The panel provided by [`Panel::new`].
pub fn use_panel() -> Panel {
    expect_context::<Panel>()
}

impl Panel {
    /// Starts the panel's reads and checks, and provides it (step 1 of the interface).
    pub fn new(
        event: Event,
        on_sales: Option<Callback<Availability>>,
        on_event_changed: Option<Callback<Event>>,
    ) -> Panel {
        let id = event.id.to_string();
        let reloads = RwSignal::new(0u32);
        let panel = Panel {
            event: StoredValue::new(event),
            availability: RwSignal::new(None),
            loaded_at: RwSignal::new(0),
            tiers: RwSignal::new(None),
            availability_failed: RwSignal::new(false),
            tiers_failed: RwSignal::new(false),
            reloads,
            notice: RwSignal::new(None),
            waits: RwSignal::new(Waits::default()),
            buy: RwSignal::new(Buy::default()),
            has_reservation: RwSignal::new(false),
            seats_loading: RwSignal::new(false),
            seats_failed: RwSignal::new(false),
            ran_out: RwSignal::new(false),
            map_gone: RwSignal::new(None),
            on_event_changed,
            check_again_button: NodeRef::new(),
            check_again: StoredValue::new_local(None),
            api: StoredValue::new_local(use_auth().api()),
        };

        // P1: the availability, again after a refusal; the tiers once (key `tiers:{id}`).
        let avail_id = id.clone();
        let availability = use_load(
            move || (avail_id.clone(), reloads.get()),
            |api, (id, _)| async move { api.get_event_availability(&id).await },
        );
        Effect::new(move |_| {
            availability.with(|load| match load {
                Load::Ok(a) => {
                    panel.availability.set(Some(a.clone()));
                    panel.loaded_at.set(now_ms());
                    panel.availability_failed.set(false);
                    // Spec 034 FR-017: each answer, once, to the page.
                    if let Some(cb) = on_sales {
                        let a = a.clone();
                        untrack(move || cb.run(a));
                    }
                }
                Load::Missing | Load::Unreachable => panel.availability_failed.set(true),
                Load::Loading => {}
            });
        });
        let tiers = use_load(
            move || id.clone(),
            |api, id| async move { api.list_ticket_tiers(&id).await },
        );
        Effect::new(move |_| {
            tiers.with(|load| match load {
                Load::Ok(t) => panel.tiers.set(Some(t.clone())),
                Load::Missing | Load::Unreachable => panel.tiers_failed.set(true),
                Load::Loading => {}
            });
        });

        // Spec 026 FR-011: the waits are checked every 250 ms while one runs.
        let ticking: StoredValue<Option<IntervalHandle>, LocalStorage> =
            StoredValue::new_local(None);
        let stop = move || {
            if let Some(h) = ticking.try_update_value(Option::take).flatten() {
                h.clear();
            }
        };
        Effect::new(move |_| {
            let waiting = panel.waits.with(Waits::waiting);
            let running = ticking.with_value(Option::is_some);
            if waiting && !running {
                let handle = set_interval_with_handle(
                    move || {
                        let now = perf_now();
                        panel.waits.maybe_update(|w| w.tick(now));
                    },
                    Duration::from_millis(250),
                );
                ticking.set_value(handle.ok());
            } else if !waiting && running {
                stop();
            }
        });
        on_cleanup(stop);

        provide_context(panel);
        panel
    }

    /// Loads what is left again, keeping the last answer on screen (P1, P8).
    pub fn refresh(&self) {
        self.reloads.update(|n| *n += 1);
    }

    /// The started note (E6) for the answer shown.
    pub fn started_note(&self, a: &Availability) -> Option<String> {
        self.event.with_value(|e| {
            started_note(
                a,
                &to_iso_string(e.starts_at),
                &to_iso_string(e.ends_at),
                Some(&e.location.time_zone.to_string()),
                self.loaded_at.get(),
                self.has_reservation.get(),
            )
        })
    }

    /// Starts a wait out of a refusal for the limit, now.
    pub fn start_wait(&self, kind: RateLimitedAction, seconds: u64) {
        let now = perf_now();
        self.waits.update(|w| w.start(kind, seconds, now));
    }

    /// The Check again button's action (general admission registers its confirm).
    pub fn set_check_again(&self, f: impl Fn() + 'static) {
        self.check_again.set_value(Some(Rc::new(f)));
    }

    fn check_again(&self) {
        if let Some(f) = self.check_again.with_value(Clone::clone) {
            f();
        }
    }

    /// E8 (spec 038 FR-010): the seated event's venue map answered 404. The event is read again
    /// (no new sign-in on a 401: the unavailable banner, quirk kept): 404 → deleted; now general
    /// admission → `on_event_changed`; otherwise → unavailable.
    pub fn map_gone(&self) {
        if self.map_gone.get_untracked().is_some() {
            return;
        }
        self.map_gone.set(Some(MapGone::Checking));
        let panel = *self;
        let api = self.api.get_value();
        let id = self.event.with_value(|e| e.id.to_string());
        spawn_local(async move {
            let answer = api
                .send_quiet::<Event>(customer_rust_core::api::client::ops::get_event(&id))
                .await;
            let next = match answer {
                Err(e) if e.status() == Some(404) => Some(MapGone::Deleted),
                Ok(event) if !event.reserved_seating => match panel.on_event_changed {
                    Some(cb) => {
                        cb.run(event);
                        None
                    }
                    None => Some(MapGone::Unavailable),
                },
                _ => Some(MapGone::Unavailable),
            };
            if let Some(state) = next {
                let _ = panel.map_gone.try_set(Some(state));
            }
        });
    }
}

/// Spec 026 FR-011, FR-013: the countdown, directly above the control it holds back, not
/// announced each second (the frame's one live region says it once).
#[component]
pub fn WaitMessage(kind: RateLimitedAction) -> impl IntoView {
    let panel = use_panel();
    move || {
        panel.waits.with(|w| w.text(kind)).map(|text| {
            view! {
                <p class="banner banner--error" aria-live="off">
                    {text}
                </p>
            }
        })
    }
}

/// What the frame shows: the stage before the card, or the card's body.
#[derive(Clone, Debug, PartialEq)]
enum Stage {
    Loading,
    Deleted,
    Unavailable,
    Done,
    Card,
}

/// The card's body, below its notices.
#[derive(Clone, Debug, PartialEq)]
enum Body {
    Unknown,
    Closed(&'static str, &'static str),
    Reached(String),
    Form,
}

/// The Get tickets frame (step 3 of the interface).
#[component]
pub fn GetTicketsFrame(panel: Panel, children: ChildrenFn) -> impl IntoView {
    let stage = Memo::new(move |_| {
        let gone = panel.map_gone.get();
        let left = panel.availability.with(Option::is_some);
        let tiers = panel.tiers.with(Option::is_some);
        if (!left && !panel.availability_failed.get())
            || (!tiers && !panel.tiers_failed.get())
            || panel.seats_loading.get()
            || gone == Some(MapGone::Checking)
        {
            return Stage::Loading;
        }
        if gone == Some(MapGone::Deleted) {
            return Stage::Deleted;
        }
        if !left || !tiers || panel.seats_failed.get() || gone.is_some() {
            return Stage::Unavailable;
        }
        if panel.buy.with(|b| b.done().is_some()) {
            return Stage::Done;
        }
        Stage::Card
    });
    let body = Memo::new(move |_| {
        if panel.buy.with(Buy::shows_unknown) {
            return Body::Unknown;
        }
        let reserved = panel.has_reservation.get();
        panel
            .availability
            .with(|a| match a.as_ref().map(|a| panel_body(a, reserved)) {
                Some(PanelBody::Closed { badge, text }) => Body::Closed(badge, text),
                Some(PanelBody::Reached(text)) => Body::Reached(text),
                _ => Body::Form,
            })
    });

    let card = move || {
        let children = children.clone();
        let started = move || {
            panel
                .availability
                .with(|a| a.as_ref().and_then(|a| panel.started_note(a)))
                .map(|text| view! { <p class="note">{text}</p> })
        };
        let from = move || {
            panel
                .tiers
                .with(|t| t.as_deref().and_then(from_price))
                .map(|text| view! { <p class="price">{text}</p> })
        };
        let notice = move || {
            panel.notice.get().map(|text| {
                view! {
                    <p role="alert" class="banner banner--error">
                        {text}
                    </p>
                }
            })
        };
        let ran_out = move || {
            panel.ran_out.get().then(|| {
                view! {
                    <p role="alert" class="banner banner--error">
                        "Your reservation ran out, so its seats were released. You can hold them again in 2 minutes if they are still open."
                    </p>
                }
            })
        };
        let content = move || match body.get() {
            Body::Unknown => unknown_box(panel).into_any(),
            Body::Closed(badge, text) => view! {
                <p>
                    <span class="pill pill--danger">{badge}</span>
                </p>
                <p>{text}</p>
            }
            .into_any(),
            Body::Reached(text) => {
                view! { <p class="banner banner--conflict">{text}</p> }.into_any()
            }
            Body::Form => children().into_any(),
        };
        view! {
            <section class="card card--padded get-tickets" aria-labelledby="get-tickets">
                <h2 id="get-tickets">"Get tickets"</h2>
                {started}
                <p
                    class="visually-hidden"
                    aria-live="assertive"
                    aria-atomic="true"
                    data-announces="rate-limit"
                >
                    {move || panel.waits.with(|w| w.announcement().map(str::to_string))}
                </p>
                {from}
                {notice}
                {ran_out}
                {content}
            </section>
        }
    };

    move || match stage.get() {
        Stage::Loading => view! { <p>"Loading tickets…"</p> }.into_any(),
        Stage::Deleted => view! {
            <p class="banner banner--error">"This event no longer exists."</p>
        }
        .into_any(),
        Stage::Unavailable => view! {
            <p class="banner banner--error">
                "Ticket information is unavailable right now. Try again later."
            </p>
        }
        .into_any(),
        Stage::Done => {
            let order = panel.buy.with_untracked(|b| b.done().cloned());
            let (name, times) = panel
                .event
                .with_value(|e| (String::from(e.name.clone()), EventTimes::of(e)));
            order
                .map(|order| {
                    view! { <OrderConfirmation event_name=name order event=times/> }
                })
                .into_any()
        }
        Stage::Card => card().into_any(),
    }
}

/// P9: the unknown outcome, with Check again (the same request id); the box stays mounted while
/// Check again runs, so it is not announced again.
fn unknown_box(panel: Panel) -> impl IntoView {
    let waiting = move || {
        panel
            .waits
            .with(|w| w.get(RateLimitedAction::Buy).is_some())
    };
    view! {
        <div role="alert" class="banner banner--conflict">
            <div class="banner__body">
                <p>"We couldn't confirm whether your order went through."</p>
                <p>
                    "Check again, which never places a second order, or look for it in "
                    <AppLink href="/my-tickets">"My tickets"</AppLink>
                    "."
                </p>
                <WaitMessage kind=RateLimitedAction::Buy/>
                <button
                    node_ref=panel.check_again_button
                    type="button"
                    class="btn btn--ghost"
                    aria-disabled=move || waiting().then_some("true")
                    on:click=move |_| panel.check_again()
                >
                    "Check again"
                </button>
            </div>
        </div>
    }
}
