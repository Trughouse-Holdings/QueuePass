//! Parity E1–E5, E8 (the page's part), SL6 (`customer-app/src/pages/EventDetail.tsx`): one event,
//! with a way to its venue, its images (the page gallery and the full-screen view), and a way to
//! get tickets. Spec 030 research R7: the time is read once, when the event loads, and kept with
//! it; spec 034 FR-017: once the Get tickets panel answers, its answer decides "ended".

use customer_rust_core::{
    api::{
        client::ApiClient,
        types::{Event, EventStatus},
    },
    event_page::{SalesAnswer, get_tickets_key, page_has_ended},
    load::Load,
    money::usd,
};
use leptos::prelude::*;
use leptos_router::hooks::use_params_map;

use crate::{
    components::{
        AppLink, ServiceUnreachable,
        event_card::{count, event_doors_open, event_price, event_when, gallery_images},
        gallery::{GalleryVariant, ImageGallery},
        get_tickets::GetTickets,
    },
    load::use_load,
    util::now_ms,
};

/// What the page shows, without the event's data, so the event view is built once per load.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shown {
    Loading,
    Unreachable,
    Missing,
    Ok,
}

#[component]
pub fn EventDetail() -> impl IntoView {
    let params = use_params_map();
    let id = Memo::new(move |_| params.read().get("id").unwrap_or_default());
    let load = use_load(
        move || id.get(),
        |api: ApiClient, id: String| async move { api.get_event(&id).await.map(|e| (e, now_ms())) },
    );
    // Spec 038 FR-010: the event as read again by the Get tickets panel when its seating became
    // general admission; it replaces the one loaded.
    let changed = RwSignal::new(None::<(Event, i64)>);
    // Spec 034 FR-017 (research R4): the panel's last answer about sales, by the Backend's clock.
    let sales = RwSignal::new(None::<SalesAnswer>);
    let on_sales = Callback::new(move |a: SalesAnswer| sales.set(Some(a)));
    let on_event_changed = Callback::new(move |e: Event| changed.set(Some((e, now_ms()))));

    let shown = Memo::new(move |_| {
        load.with(|l| match l {
            Load::Loading => Shown::Loading,
            Load::Unreachable => Shown::Unreachable,
            Load::Missing => Shown::Missing,
            Load::Ok(_) => Shown::Ok,
        })
    });
    // `changed?.event.id === id ? changed : load.data`.
    let loaded = Signal::derive(move || {
        let id = id.get();
        changed
            .with(|c| c.as_ref().filter(|(e, _)| e.id.to_string() == id).cloned())
            .or_else(|| load.with(|l| l.ok().cloned()))
    });

    move || match shown.get() {
        Shown::Loading => view! { <p>"Loading…"</p> }.into_any(),
        Shown::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
        Shown::Missing => view! {
            <section>
                <p>"This event is no longer available."</p>
                <AppLink href="/events">"Back to events"</AppLink>
            </section>
        }
        .into_any(),
        Shown::Ok => view! { <EventView loaded sales on_sales on_event_changed/> }.into_any(),
    }
}

/// The page once the event has loaded.
#[component]
fn EventView(
    loaded: Signal<Option<(Event, i64)>>,
    sales: RwSignal<Option<SalesAnswer>>,
    on_sales: Callback<SalesAnswer>,
    on_event_changed: Callback<Event>,
) -> impl IntoView {
    let part = move |f: fn(&Event) -> AnyView| {
        move || {
            loaded.with(|l| match l {
                Some((e, _)) => f(e),
                None => ().into_any(),
            })
        }
    };
    // Spec 030 FR-014 and 034 FR-017 (parity E5).
    let ended = move || {
        loaded.with(|l| {
            l.as_ref().is_some_and(|(e, at)| {
                sales.with(|s| {
                    page_has_ended(
                        &e.id.to_string(),
                        e.ends_at.timestamp_millis(),
                        *at,
                        s.as_ref(),
                    )
                })
            })
        })
    };
    // The gallery is drawn again only for another event (E8 keeps the images).
    let gallery_key = Memo::new(move |_| {
        loaded.with(|l| {
            l.as_ref()
                .map(|(e, _)| (e.id.to_string(), gallery_images(e)))
        })
    });
    // Keyed by its seating, so a switch to general admission starts the panel afresh.
    let key = Memo::new(move |_| {
        loaded.with(|l| {
            l.as_ref()
                .map(|(e, _)| get_tickets_key(&e.id.to_string(), e.reserved_seating))
        })
    });
    let panel = move || {
        key.track();
        loaded.get_untracked().map(|(event, loaded_at)| {
            view! { <GetTickets event loaded_at on_sales on_event_changed/> }
        })
    };
    let gallery = move || {
        gallery_key.track();
        loaded.with_untracked(|l| {
            let (e, _) = l.as_ref()?;
            let images = gallery_images(e);
            (!images.is_empty()).then(|| {
                view! {
                    <div class="page-band">
                        <ImageGallery
                            event_id=e.id.to_string()
                            event_name=e.name.to_string()
                            images
                            variant=GalleryVariant::Page
                        />
                    </div>
                }
            })
        })
    };

    view! {
        <section>
            // Spec 014 FR-021: the event's images across the full width of the app, above its name.
            {gallery}
            {part(|e| view! { <h1 class="page-title">{e.name.to_string()}</h1> }.into_any())}
            // Spec 005 FR-012: a cancelled event stays visible, clearly marked.
            {part(|e| {
                (e.status == EventStatus::Cancelled)
                    .then(|| {
                        view! {
                            <p>
                                <strong>"This event has been cancelled."</strong>
                            </p>
                        }
                    })
                    .into_any()
            })}
            // Spec 030 FR-014 (research R7): a past event's page still opens, and says so.
            {move || {
                ended()
                    .then(|| {
                        view! {
                            <p>
                                <strong>"This event has ended."</strong>
                            </p>
                        }
                    })
            }}
            {part(|e| {
                let price = if e.reserved_seating {
                    // Spec 038 FR-024: a seated event's price is the range of its level prices.
                    view! {
                        <dt>"Price"</dt>
                        <dd>{event_price(e)}</dd>
                    }
                    .into_any()
                } else {
                    view! {
                        <dt>"Base price"</dt>
                        <dd>{usd(&e.base_price.to_string())}</dd>
                    }
                    .into_any()
                };
                let venue = e.location.name.to_string();
                view! {
                    <div class="card">
                        <dl>
                            <dt>"Venue"</dt>
                            <dd>
                                <AppLink href=format!("/venues/{}", e.location_id)>{venue}</AppLink>
                            </dd>
                            <dt>"Doors open"</dt>
                            <dd>{event_doors_open(e)}</dd>
                            <dt>"Starts"</dt>
                            <dd>{event_when(e.starts_at, e)}</dd>
                            <dt>"Ends"</dt>
                            <dd>{event_when(e.ends_at, e)}</dd>
                            <dt>"Tickets"</dt>
                            <dd>{count(e.total_ticket_capacity.get())}</dd>
                            {price}
                        </dl>
                    </div>
                }
                .into_any()
            })}
            {panel}
            <AppLink href="/events">"All events"</AppLink>
        </section>
    }
}
