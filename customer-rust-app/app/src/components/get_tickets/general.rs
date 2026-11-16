//! Parity P3–P11 (`customer-app/src/components/GetTickets.tsx`' `chooseAndConfirm`, `limitLine`,
//! `nameField`, and `confirm`; `use-buy.ts`): the general-admission form inside the panel frame
//! (`frame.rs`): the ticket type or base price, the limit line, the Name on tickets field, the
//! quantity, the exact total, and Confirm order, with the BUY wait above it and the focus kept on
//! the button pressed (spec 026 FR-013).

use customer_rust_core::api::client::ApiClient;
use customer_rust_core::api::types::{Availability, Event};
use customer_rust_core::availability::Uuid;
use customer_rust_core::availability::{
    base_line, can_confirm, limit_line, max_quantity, tickets_left_for, tier_choice, tier_left,
    total_line, unit_price,
};
use customer_rust_core::buy::{
    BuyOutcome, RateLimitedAction, confirm_button_text, order_body, refusal_message,
};
use customer_rust_core::holder_name::HolderNameField as NameField;
use leptos::{html, prelude::*, task::spawn_local};

use super::frame::{GetTicketsFrame, Panel, WaitMessage, perf_now, random_uuid};
use crate::components::holder_name_field::HolderNameField;

/// The general-admission panel: the frame with the form inside (interface notes in `frame.rs`).
#[component]
pub fn General(
    event: Event,
    #[prop(default = None)] on_sales: Option<Callback<Availability>>,
    #[prop(default = None)] on_event_changed: Option<Callback<Event>>,
) -> impl IntoView {
    let panel = Panel::new(event, on_sales, on_event_changed);
    let form = Form::new(panel);
    view! {
        <GetTicketsFrame panel>
            {form.view()}
        </GetTicketsFrame>
    }
}

/// The form's state, kept outside the frame so it outlives the unknown-outcome box (P8: tier,
/// quantity, and name kept).
#[derive(Clone, Copy)]
struct Form {
    panel: Panel,
    tier: RwSignal<Option<Uuid>>,
    quantity: RwSignal<u64>,
    name: RwSignal<NameField>,
    confirm_button: NodeRef<html::Button>,
    api: StoredValue<ApiClient, LocalStorage>,
}

impl Form {
    fn new(panel: Panel) -> Form {
        let form = Form {
            panel,
            tier: RwSignal::new(None),
            quantity: RwSignal::new(1),
            name: RwSignal::new(NameField::default()),
            confirm_button: NodeRef::new(),
            api: StoredValue::new_local(crate::auth::use_auth().api()),
        };
        panel.set_check_again(move || form.confirm());
        form
    }

    /// A change to what is bought starts a new purchase.
    fn choose(&self, change: impl FnOnce()) {
        change();
        self.panel.buy.update(|b| b.reset());
    }

    fn max(&self) -> u64 {
        let tier = self.tier.get();
        self.panel
            .availability
            .with(|a| a.as_ref().map_or(1, |a| max_quantity(a, tier.as_ref())))
    }

    /// The quantity shown and sent: `min(chosen, max)`.
    fn count(&self) -> u64 {
        self.quantity.get().min(self.max())
    }

    fn price(&self) -> Option<String> {
        let tier = self.tier.get();
        let base = self
            .panel
            .event
            .with_value(|e| e.base_price.as_str().to_owned());
        self.panel.tiers.with(|t| {
            unit_price(t.as_deref().unwrap_or(&[]), tier.as_ref(), &base).map(str::to_owned)
        })
    }

    /// Spec 006: Confirm order (and Check again, the same purchase).
    fn confirm(&self) {
        let form = *self;
        let panel = self.panel;
        let unknown = panel.buy.with_untracked(|b| b.shows_unknown());
        let pressed = if unknown {
            panel.check_again_button
        } else {
            self.confirm_button
        };
        let waits = panel.waits.get_untracked();
        let Some(request_id) = panel
            .buy
            .try_update(|b| b.press(&waits, random_uuid))
            .flatten()
        else {
            return;
        };
        let tier = self.tier.get_untracked();
        let body = order_body(
            tier.as_ref(),
            &self.name.with_untracked(|n| n.value().to_string()),
            untrack(|| form.count()),
            &request_id,
        );
        let id = panel.event.with_value(|e| e.id.to_string());
        let api = self.api.get_value();
        spawn_local(async move {
            let result = api.create_order(&id, &body).await;
            let now = perf_now();
            let mut outcome = None;
            panel.waits.update(|w| {
                panel
                    .buy
                    .update(|b| outcome = Some(b.answer(result, w, now)));
            });
            match outcome {
                Some(BuyOutcome::Done(_)) => panel.notice.set(None),
                Some(BuyOutcome::Refused(e)) => {
                    // Refused: nothing was recorded; what is left is loaded again (FR-006).
                    panel.notice.set(Some(refusal_message(&e)));
                    panel.refresh();
                }
                Some(BuyOutcome::Limited) => refocus(pressed),
                _ => {}
            }
        });
    }

    fn view(self) -> impl IntoView {
        let form = self;
        let panel = self.panel;
        let tiers = move || panel.tiers.get().unwrap_or_default();
        let left = move || panel.availability.get();
        let has_tiers = move || {
            panel
                .tiers
                .with(|t| t.as_ref().is_some_and(|t| !t.is_empty()))
        };
        let waiting = move || {
            panel
                .waits
                .with(|w| w.get(RateLimitedAction::Buy).is_some())
        };
        let can = move || {
            let price = form.price();
            let left_now = panel.availability.with(|a| {
                a.as_ref()
                    .map_or(0, |a| tickets_left_for(a, form.tier.get().as_ref()))
            });
            can_confirm(
                price.as_deref(),
                left_now,
                form.count(),
                form.name.with(NameField::valid),
                panel.buy.with(|b| b.choosing()),
            )
        };

        let choice = move || {
            if has_tiers() {
                let rows = move || {
                    let a = left();
                    tiers()
                        .into_iter()
                        .map(|t| {
                            let n = a.as_ref().map_or(0, |a| tier_left(a, &t.id));
                            let tid = t.id;
                            let text = tier_choice(&t, n);
                            view! {
                                <label class="choice">
                                    <input
                                        type="radio"
                                        name="tier"
                                        value=tid.to_string()
                                        prop:checked=move || form.tier.get() == Some(tid)
                                        disabled=n == 0
                                        on:change=move |_| form.choose(|| form.tier.set(Some(tid)))
                                    />
                                    " "
                                    {text}
                                    {(n == 0)
                                        .then(|| {
                                            view! {
                                                <span class="pill pill--danger" aria-hidden="true">
                                                    "Sold out"
                                                </span>
                                            }
                                        })}
                                </label>
                            }
                        })
                        .collect_view()
                };
                view! {
                    <fieldset>
                        <legend>"Ticket type"</legend>
                        {rows}
                    </fieldset>
                }
                .into_any()
            } else {
                let line = move || {
                    let base = panel.event.with_value(|e| e.base_price.as_str().to_owned());
                    left().map(|a| base_line(&base, a.tickets_left))
                };
                view! { <p>{line}</p> }.into_any()
            }
        };
        let limit = move || {
            left()
                .and_then(|a| limit_line(&a))
                .map(|text| view! { <p class="note">{text}</p> })
        };
        let options = move || {
            let max = form.max();
            (1..=max)
                .map(|n| {
                    view! {
                        <option value=n.to_string() prop:selected=move || form.count() == n>
                            {n}
                        </option>
                    }
                })
                .collect_view()
        };
        let total = move || {
            form.price()
                .map(|p| view! { <p>{total_line(&p, form.count())}</p> })
        };

        view! {
            {choice}
            {limit}
            <HolderNameField
                field=form.name
                on_input=Callback::new(move |()| panel.buy.update(|b| b.reset()))
            />
            <label>
                "Quantity "
                <select
                    prop:value=move || form.count().to_string()
                    on:change=move |ev| {
                        let n = event_target_value(&ev).parse().unwrap_or(1);
                        form.choose(|| form.quantity.set(n));
                    }
                >
                    {options}
                </select>
            </label>
            {total}
            <WaitMessage kind=RateLimitedAction::Buy/>
            <button
                node_ref=form.confirm_button
                type="button"
                class="btn btn--primary"
                disabled=move || !can()
                aria-disabled=move || waiting().then_some("true")
                on:click=move |_| form.confirm()
            >
                {move || panel.buy.with(|b| confirm_button_text(b.phase()))}
            </button>
        }
    }
}

/// Spec 026 FR-013: a button natively disabled while confirming may have lost focus to the page;
/// once it is back, focus returns to it.
fn refocus(button: NodeRef<html::Button>) {
    let lost = document()
        .active_element()
        .is_none_or(|a| document().body().is_some_and(|b| a == *b));
    if !lost {
        return;
    }
    request_animation_frame(move || {
        if let Some(b) = button.get_untracked() {
            let _ = b.focus();
        }
    });
}
