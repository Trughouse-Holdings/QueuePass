//! Spec 037 (task T062; parity E10), port of `admin-app/src/components/TierSection.tsx`.
//!
//! Spec 004 US1: an event's ticket tiers, with add, edit, and remove (research R7). The Backend
//! enforces the capacity and name rules; refusals show in the banner and the typed values stay.

use std::future::Future;

use admin_rust_core::{
    api::{client::ApiError, types::TicketTier},
    forms::layouts::as_api_error,
    pages::{
        attendees_reports::count,
        event_page::{
            TierDraft, allocated_line, remove_tier_confirm, tier_create_body, tier_update_body,
        },
    },
};
use leptos::{prelude::*, task::spawn_local};

use crate::{auth::use_auth, components::ErrorBanner};

/// The tiers' card. `read_only`: a cancelled event's tiers are shown but cannot change (spec
/// 005). `seated` and `capacity` are the event's.
#[component]
pub fn TierSection(
    event_id: String,
    capacity: u64,
    seated: bool,
    #[prop(into)] read_only: Signal<bool>,
) -> impl IntoView {
    let auth = use_auth();
    let tiers = RwSignal::new(None::<Vec<TicketTier>>);
    let load_failed = RwSignal::new(false);
    let draft = RwSignal::new(TierDraft::default());
    let editing = RwSignal::new(None::<(String, TierDraft)>);
    let busy = RwSignal::new(false);
    let error = RwSignal::new(None::<ApiError>);
    let event_id = StoredValue::new(event_id);

    let reload = move || {
        let api = auth.api();
        // After a write's answer the page may be gone; then there is nothing to reload.
        let id = event_id.try_get_value();
        async move {
            let Some(id) = id else { return };
            match api.list_tiers(&id).await {
                Ok(t) => {
                    tiers.try_set(Some(t));
                    load_failed.try_set(false);
                }
                Err(_) => {
                    load_failed.try_set(true);
                }
            }
        }
    };
    spawn_local(reload());

    let run = move |action: std::pin::Pin<Box<dyn Future<Output = Result<(), ApiError>>>>,
                    after: Box<dyn FnOnce()>| {
        busy.set(true);
        error.set(None);
        spawn_local(async move {
            match action.await {
                Ok(()) => {
                    after();
                    reload().await;
                }
                Err(e) => {
                    error.try_set(Some(as_api_error(e)));
                }
            }
            busy.try_set(false);
        });
    };

    let add = move |e: leptos::ev::SubmitEvent| {
        e.prevent_default();
        let api = auth.api();
        let id = event_id.get_value();
        let body = tier_create_body(&draft.get_untracked());
        run(
            Box::pin(async move { api.create_tier(&id, &body).await.map(|_| ()) }),
            Box::new(move || draft.set(TierDraft::default())),
        );
    };

    let save = move |tier: &TicketTier, d: &TierDraft| {
        let api = auth.api();
        let id = event_id.get_value();
        let tier_id = tier.id.to_string();
        let body = tier_update_body(&tier.name, &tier.price, tier.quantity, d, seated);
        run(
            Box::pin(async move { api.update_tier(&id, &tier_id, &body).await.map(|_| ()) }),
            Box::new(move || editing.set(None)),
        );
    };

    let remove = move |tier: &TicketTier| {
        let ok = window()
            .confirm_with_message(&remove_tier_confirm(&tier.name))
            .unwrap_or(false);
        if !ok {
            return;
        }
        let api = auth.api();
        let id = event_id.get_value();
        let tier_id = tier.id.to_string();
        run(
            Box::pin(async move { api.delete_tier(&id, &tier_id).await }),
            Box::new(|| {}),
        );
    };

    let row = move |t: TicketTier| {
        let tid = t.id.to_string();
        // Only a switch between the row and its edit form draws the row again, not each key.
        let is_editing = {
            let tid = tid.clone();
            Memo::new(move |_| {
                !read_only.get() && editing.with(|e| e.as_ref().is_some_and(|(id, _)| *id == tid))
            })
        };
        let t_view = t.clone();
        move || {
            let t = t_view.clone();
            if is_editing.get() {
                let name = t.name.to_string();
                let set = move |f: fn(&mut TierDraft, String), value: String| {
                    editing.update(|e| {
                        if let Some((_, d)) = e {
                            f(d, value);
                        }
                    });
                };
                let field = move |f: fn(&TierDraft) -> String| {
                    move || editing.with(|e| e.as_ref().map(|(_, d)| f(d)).unwrap_or_default())
                };
                let quantity_cell = if seated {
                    view! { <span class="cell-num">{count(t.quantity)}</span> }.into_any()
                } else {
                    view! {
                        <input
                            aria-label=format!("Quantity for {name}")
                            type="number"
                            min="1"
                            prop:value=field(|d| d.quantity.clone())
                            on:input=move |e| set(|d, v| d.quantity = v, event_target_value(&e))
                        />
                    }
                    .into_any()
                };
                let tier = t.clone();
                view! {
                    <tr>
                        <td>
                            <input
                                aria-label=format!("Name for {name}")
                                prop:value=field(|d| d.name.clone())
                                on:input=move |e| set(|d, v| d.name = v, event_target_value(&e))
                            />
                        </td>
                        <td>
                            <input
                                aria-label=format!("Price for {name}")
                                inputmode="decimal"
                                prop:value=field(|d| d.price.clone())
                                on:input=move |e| set(|d, v| d.price = v, event_target_value(&e))
                            />
                        </td>
                        <td>{quantity_cell}</td>
                        <td class="cell-action">
                            <button
                                type="button"
                                class="btn btn--primary"
                                disabled=move || busy.get()
                                on:click=move |_| {
                                    if let Some((_, d)) = editing.get_untracked() {
                                        save(&tier, &d);
                                    }
                                }
                            >
                                "Save"
                            </button>
                            " "
                            <button type="button" class="btn" on:click=move |_| editing.set(None)>
                                "Cancel"
                            </button>
                        </td>
                    </tr>
                }
                .into_any()
            } else {
                let start = TierDraft::of(&t.name, &t.price, t.quantity);
                let tid = tid.clone();
                let tier = t.clone();
                view! {
                    <tr>
                        <td class="cell-strong">{t.name.to_string()}</td>
                        <td class="price">"$" {t.price.to_string()}</td>
                        <td class="cell-num">{count(t.quantity)}</td>
                        <td class="cell-action">
                            {move || {
                                let start = start.clone();
                                let tid = tid.clone();
                                let tier = tier.clone();
                                (!read_only.get()).then(|| view! {
                                    <button
                                        type="button"
                                        class="btn"
                                        disabled=move || busy.get()
                                        on:click=move |_| editing.set(Some((tid.clone(), start.clone())))
                                    >
                                        "Edit"
                                    </button>
                                    " "
                                    <button
                                        type="button"
                                        class="btn"
                                        disabled=move || busy.get()
                                        on:click=move |_| remove(&tier)
                                    >
                                        "Remove"
                                    </button>
                                })
                            }}
                        </td>
                    </tr>
                }
                .into_any()
            }
        }
    };

    let list = move || {
        if load_failed.get() {
            return view! { <p class="note">"The tiers could not be loaded."</p> }.into_any();
        }
        let Some(list) = tiers.get() else {
            return view! { <p class="loading">"Loading tiers…"</p> }.into_any();
        };
        let allocated: u64 = list.iter().map(|t| t.quantity).sum();
        let table = if list.is_empty() {
            view! {
                <p class="note">
                    "No tiers yet. Without tiers, the event sells one admission type at its base price."
                </p>
            }
            .into_any()
        } else {
            view! {
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>"Tier"</th>
                                <th>"Price"</th>
                                <th>"Quantity"</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>{list.into_iter().map(row).collect_view()}</tbody>
                    </table>
                </div>
            }
            .into_any()
        };
        view! {
            <p class="note">{allocated_line(allocated, capacity)}</p>
            // Spec 038 (FR-015): a seated event has no ticket types; it sells seats by its
            // layout's price levels, set in the event form.
            {seated.then(|| view! {
                <p class="note">
                    "This event sells seats by price level, set in Edit event; ticket tiers are for general admission."
                </p>
            })}
            {table}
        }
        .into_any()
    };

    let form = move || {
        // Spec 038: the Backend refuses a tier on a seated event, so none is offered.
        (!read_only.get() && !seated).then(|| {
            view! {
                <form class="form" on:submit=add aria-label="Add a tier">
                    <div class="field-row">
                        <label class="field">
                            "Tier name"
                            <input
                                prop:value=move || draft.with(|d| d.name.clone())
                                required
                                maxlength="100"
                                on:input=move |e| draft.update(|d| d.name = event_target_value(&e))
                            />
                        </label>
                        <label class="field">
                            "Price"
                            <input
                                prop:value=move || draft.with(|d| d.price.clone())
                                required
                                inputmode="decimal"
                                placeholder="45.00"
                                on:input=move |e| draft.update(|d| d.price = event_target_value(&e))
                            />
                        </label>
                        <label class="field">
                            "Quantity"
                            <input
                                type="number"
                                min="1"
                                required
                                prop:value=move || draft.with(|d| d.quantity.clone())
                                on:input=move |e| {
                                    draft.update(|d| d.quantity = event_target_value(&e))
                                }
                            />
                        </label>
                    </div>
                    <div class="form__actions">
                        <button type="submit" class="btn btn--primary" disabled=move || busy.get()>
                            "Add tier"
                        </button>
                    </div>
                </form>
            }
        })
    };

    view! {
        <section class="card" aria-labelledby="tiers-heading">
            <h2 id="tiers-heading">"Ticket tiers"</h2>
            {move || error.get().map(|e| view! { <ErrorBanner error=e title="Could not save the tier"/> })}
            {list}
            {form}
        </section>
    }
}
