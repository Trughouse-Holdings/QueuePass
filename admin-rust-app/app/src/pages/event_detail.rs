//! Spec 037 (task T061; parity E9, E12–E14, SL8), port of `admin-app/src/pages/EventDetail.tsx`
//! and `admin-app/src/hooks/use-delete.ts`.
//!
//! Spec 002 FR-025, FR-031: one event, with its venue, both times dated in its venue's zone, and
//! Edit and Delete. Deleting frees the event's window at the venue (FR-010). Spec 005 FR-008:
//! Cancel event confirms, cancels, shows the counts, and makes the page read-only.

use admin_rust_core::{
    api::{
        client::ApiError,
        types::{Event, EventStatus},
    },
    format::{doors_open, has_ended, when},
    forms::layouts::as_api_error,
    pages::{
        attendees_reports::count,
        event_page::{
            DeleteKind, already_gone_notice, cancel_confirm, cancel_done, delete_confirm,
            deleted_notice, per_customer,
        },
    },
    time::to_iso_string,
};
use leptos::{prelude::*, task::spawn_local};
use leptos_router::hooks::{use_navigate, use_params_map};

use crate::{
    auth::use_auth,
    components::{
        AppLink, ErrorBanner, NoticeKind, ServiceUnreachable, SuccessState,
        banners::with_notice,
        event_seat_map::EventSeatMap,
        gallery::{GalleryImage, ImageGallery},
        sales_card::SalesCard,
        tiers::TierSection,
    },
    util::{enum_text, now_ms},
};

/// What the page shows, without the event's data, so the event view is built once per load.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shown {
    Loading,
    Ok,
    Missing,
    Unreachable,
}

#[component]
pub fn EventDetail() -> impl IntoView {
    let auth = use_auth();
    let params = use_params_map();
    let id = Memo::new(move |_| params.read().get("id").unwrap_or_default());
    let shown = RwSignal::new(Shown::Loading);
    // The event, and spec 030 FR-012 (research R6): the time read when it loaded.
    let event = RwSignal::new(None::<(Event, i64)>);
    let generation = StoredValue::new(0_u64);

    Effect::new(move |_| {
        let id = id.get();
        generation.update_value(|g| *g += 1);
        let current = generation.get_value();
        shown.set(Shown::Loading);
        let api = auth.api();
        spawn_local(async move {
            let result = api.get_event(&id).await;
            if generation.try_get_value() != Some(current) {
                return;
            }
            match result {
                Ok(e) => {
                    event.set(Some((e, now_ms())));
                    shown.set(Shown::Ok);
                }
                Err(ApiError::Status(e)) if e.status == 404 => shown.set(Shown::Missing),
                Err(_) => shown.set(Shown::Unreachable),
            }
        });
    });

    move || match shown.get() {
        Shown::Loading => view! { <p class="loading">"Loading event…"</p> }.into_any(),
        Shown::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
        Shown::Missing => view! {
            <section>
                <p>"This event no longer exists."</p>
                <AppLink href="/events" class="btn">"Back to events"</AppLink>
            </section>
        }
        .into_any(),
        Shown::Ok => view! { <EventView event/> }.into_any(),
    }
}

/// `EventView`: the page once the event loaded. `event` changes only when a cancel answers.
#[component]
fn EventView(event: RwSignal<Option<(Event, i64)>>) -> impl IntoView {
    let auth = use_auth();
    let navigate = StoredValue::new_local(use_navigate());
    let Some((first, _)) = event.get_untracked() else {
        return ().into_any();
    };
    let get = move |f: fn(&Event) -> String| {
        event.with(|e| e.as_ref().map(|(e, _)| f(e)).unwrap_or_default())
    };
    let status = Memo::new(move |_| get(|e| enum_text(&e.status)));
    let cancelled = Memo::new(move |_| {
        event.with(|e| {
            e.as_ref()
                .is_some_and(|(e, _)| e.status == EventStatus::Cancelled)
        })
    });
    // Spec 030 FR-011: whether the event had ended when it loaded.
    let ended = Memo::new(move |_| {
        event.with(|e| {
            e.as_ref()
                .is_some_and(|(e, at)| has_ended(&to_iso_string(e.ends_at), *at))
        })
    });
    let id = first.id.to_string();
    let name = first.name.to_string();

    // Spec 005 FR-008 (`useCancel`): nothing is sent unless the admin confirms.
    let cancel_busy = RwSignal::new(false);
    let cancel_done_text = RwSignal::new(None::<String>);
    let cancel_error = RwSignal::new(None::<ApiError>);
    let cancel_in_flight = StoredValue::new(false);
    let run_cancel = {
        let id = id.clone();
        let name = name.clone();
        move || {
            if cancel_in_flight.get_value() {
                return;
            }
            let ok = window()
                .confirm_with_message(&cancel_confirm(&name))
                .unwrap_or(false);
            if !ok {
                return;
            }
            cancel_in_flight.set_value(true);
            cancel_busy.set(true);
            cancel_error.set(None);
            let api = auth.api();
            let id = id.clone();
            spawn_local(async move {
                match api.cancel_event(&id).await {
                    Ok(result) => {
                        cancel_done_text.try_set(Some(cancel_done(
                            result.orders_refunded,
                            result.tickets_voided,
                        )));
                        event.try_set(Some((result.event, now_ms())));
                    }
                    Err(e) => {
                        cancel_error.try_set(Some(as_api_error(e)));
                    }
                }
                cancel_in_flight.try_set_value(false);
                cancel_busy.try_set(false);
            });
        }
    };

    // Spec 002 FR-026, FR-027, FR-029 (`useDelete`): confirm, delete, then go to the list with a
    // notice or show why not.
    let deleting = RwSignal::new(false);
    let delete_error = RwSignal::new(None::<ApiError>);
    let delete_in_flight = StoredValue::new(false);
    let remove = {
        let id = id.clone();
        let name = name.clone();
        move || {
            if delete_in_flight.get_value() {
                return;
            }
            let ok = window()
                .confirm_with_message(&delete_confirm(DeleteKind::Event, &name))
                .unwrap_or(false);
            if !ok {
                return;
            }
            delete_in_flight.set_value(true);
            deleting.set(true);
            delete_error.set(None);
            let api = auth.api();
            let id = id.clone();
            let name = name.clone();
            let navigate = navigate.get_value();
            spawn_local(async move {
                let result = api.delete_event(&id).await;
                let go = |kind, text: String| navigate("/events", with_notice(kind, text));
                match result {
                    Ok(()) => go(NoticeKind::Success, deleted_notice(&name)),
                    Err(e) => {
                        delete_in_flight.try_set_value(false);
                        deleting.try_set(false);
                        if e.status() == Some(404) {
                            // Someone else deleted it first: the list page fetches fresh on
                            // arrival.
                            go(NoticeKind::Info, already_gone_notice(&name));
                        } else {
                            delete_error.try_set(Some(as_api_error(e)));
                        }
                    }
                }
            });
        }
    };

    // Spec 014 FR-019: the event's images, as customers see them.
    let band = (!first.images.is_empty()).then(|| {
        let images = first
            .images
            .iter()
            .map(|i| GalleryImage {
                id: i.id.to_string(),
                content_type: enum_text(&i.content_type),
            })
            .collect::<Vec<_>>();
        view! {
            <div class="page-band">
                <ImageGallery event_id=id.clone() event_name=name.clone() images/>
            </div>
        }
    });

    let actions = {
        let id = id.clone();
        move || {
            (!cancelled.get()).then(|| {
                let run_cancel = run_cancel.clone();
                let remove = remove.clone();
                view! {
                    <AppLink href=format!("/events/{id}/edit") class="btn">"Edit"</AppLink>
                    <button
                        type="button"
                        class="btn"
                        on:click=move |_| run_cancel()
                        disabled=move || cancel_busy.get()
                    >
                        {move || if cancel_busy.get() { "Cancelling…" } else { "Cancel event" }}
                    </button>
                    <button
                        type="button"
                        class="btn"
                        on:click=move |_| remove()
                        disabled=move || deleting.get()
                    >
                        {move || if deleting.get() { "Deleting…" } else { "Delete" }}
                    </button>
                }
            })
        }
    };

    let zone = enum_text(&first.location.time_zone);
    let details = {
        let zone = zone.clone();
        move || {
            let shown = event.with(|e| {
                let (e, _) = e.as_ref()?;
                let zone = Some(zone.as_str());
                let starts = to_iso_string(e.starts_at);
                Some((
                    format!("/locations/{}", e.location_id),
                    e.location.name.to_string(),
                    doors_open(&starts, &to_iso_string(e.doors_open_at), zone),
                    when(&starts, zone),
                    when(&to_iso_string(e.ends_at), zone),
                    count(e.total_ticket_capacity.get()),
                    per_customer(e.max_tickets_per_customer.map(|n| n.get())),
                    e.base_price.to_string(),
                ))
            });
            shown.map(
                |(venue_href, venue, doors, starts, ends, tickets, per, price)| {
                    view! {
                        <dl>
                            <dt>"Venue"</dt>
                            <dd>
                                <AppLink href=venue_href class="rowlink">{venue}</AppLink>
                            </dd>
                            <dt>"Doors open"</dt>
                            <dd class="cell-time">{doors}</dd>
                            <dt>"Starts"</dt>
                            <dd class="cell-time">{starts}</dd>
                            <dt>"Ends"</dt>
                            <dd class="cell-time">{ends}</dd>
                            <dt>"Tickets"</dt>
                            <dd class="cell-num">{tickets}</dd>
                            // Spec 016 FR-011: a missing value is no limit (research R9).
                            <dt>"Per customer"</dt>
                            <dd>{per}</dd>
                            <dt>"Base price"</dt>
                            <dd class="price">"$" {price}</dd>
                        </dl>
                    }
                },
            )
        }
    };

    let capacity = first.total_ticket_capacity.get();
    let seated = first.reserved_seating;
    let sales_id = id.clone();
    let tiers_id = id.clone();
    let title_name = name.clone();

    view! {
        <section>
            {band}
            <div class="page-head">
                <div>
                    <h1 class="page-title">
                        {title_name}
                        " "
                        {move || cancelled.get().then(|| view! { <span class="pill pill--danger">"Cancelled"</span> })}
                        " "
                        {move || ended.get().then(|| view! { <span class="pill">"Ended"</span> })}
                    </h1>
                </div>
                <div class="form__actions">
                    <AppLink href=format!("/events/{id}/attendees") class="btn">"Attendees"</AppLink>
                    {actions}
                </div>
            </div>

            {move || cancel_done_text.get().map(|m| view! { <SuccessState message=m/> })}
            {move || cancel_error.get().map(|e| view! { <ErrorBanner error=e title="Could not cancel"/> })}
            {move || delete_error.get().map(|e| view! { <ErrorBanner error=e title="Could not delete"/> })}

            <div class="card">{details}</div>

            // Keyed on status: cancelling refunds every sale, so the card must reload.
            {move || {
                status.track();
                view! { <SalesCard event_id=sales_id.clone()/> }
            }}
            // Spec 038: seating is set in the event form, so no card here changes another's data.
            <TierSection event_id=tiers_id capacity seated read_only=cancelled/>
            // Spec 007: hidden once cancelled, as the tier form's controls are. Spec 038 US6: the
            // seats on the venue map by state, live.
            {move || {
                (!cancelled.get()).then(|| {
                    event.get_untracked().map(|(e, _)| view! { <EventSeatMap event=e/> })
                })
            }}
        </section>
    }
    .into_any()
}
