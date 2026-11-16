//! Parity B1–B4, B8, S16, SL2 (`customer-app/src/pages/EventList.tsx`): every event, in the order
//! the Backend returns them (soonest first), narrowed by filters held in the page address and
//! applied by the Backend's search, except Hide cancelled, which only changes what is shown.
//! Quirk kept (B4): with a venue in the address the list loads first without `locationId`, then
//! again once the venues load; a failed `GET /locations` leaves "All venues" alone, silently.

use customer_rust_core::{
    api::{
        client::{ApiClient, EventQuery},
        types::{Event, EventStatus},
    },
    filters::{Filters, Visible, event_query, read_filters, shown_events, write_filters},
    load::Load,
};
use leptos::prelude::*;
use leptos_router::{
    NavigateOptions,
    hooks::{use_location, use_navigate},
};

use crate::{
    components::{
        ServiceUnreachable,
        event_card::EventCards,
        event_filters::{EventFilters, VenueOption},
    },
    load::use_load,
    util::with_query,
};

#[component]
pub fn EventList() -> impl IntoView {
    let location = use_location();
    let navigate = StoredValue::new_local(use_navigate());
    let filters = Memo::new(move |_| read_filters(&location.search.get()));
    let set_filters = Callback::new(move |(next, replace): (Filters, bool)| {
        let to = with_query(&location.pathname.get_untracked(), &write_filters(&next));
        navigate.with_value(|nav| {
            nav(
                &to,
                NavigateOptions {
                    replace,
                    ..Default::default()
                },
            )
        });
    });

    let venues = use_load(
        || (),
        |api: ApiClient, ()| async move { api.list_locations().await },
    );
    let venue_options = Signal::derive(move || {
        venues.with(|v| {
            v.ok()
                .map(|list| {
                    list.iter()
                        .map(|l| VenueOption {
                            id: l.id.to_string(),
                            name: l.name.to_string(),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        })
    });
    let query = Memo::new(move |_| {
        let ids = venues.with(|v| {
            v.ok()
                .map(|list| list.iter().map(|l| l.id.to_string()).collect::<Vec<_>>())
        });
        filters.with(|f| event_query(f, ids.as_deref()))
    });
    let load = use_load(
        move || query.get(),
        |api: ApiClient, q: EventQuery| async move { api.list_events(&q).await },
    );

    let state = move || {
        load.with(|l| match l {
            Load::Loading => view! { <p class="loading">"Loading…"</p> }.into_any(),
            Load::Unreachable | Load::Missing => view! { <ServiceUnreachable/> }.into_any(),
            Load::Ok(events) => {
                let f = filters.get();
                let shown: Vec<Event> =
                    shown_events(events, &f, |e: &Event| e.status == EventStatus::Cancelled)
                        .into_iter()
                        .cloned()
                        .collect();
                match Visible::of(&shown, &f) {
                    Visible::NoMatch => view! {
                        <div class="empty">
                            <p class="empty__title">"No events match your filters."</p>
                            <button
                                type="button"
                                class="btn btn--ghost"
                                on:click=move |_| set_filters.run((Filters::default(), false))
                            >
                                "Clear filters"
                            </button>
                        </div>
                    }
                    .into_any(),
                    Visible::NothingScheduled => {
                        view! { <p>"Nothing is scheduled yet."</p> }.into_any()
                    }
                    Visible::Cards => {
                        view! { <EventCards events=shown label="Events"/> }.into_any()
                    }
                }
            }
        })
    };

    view! {
        <section>
            <h1 class="page-title">"Events"</h1>
            <EventFilters filters venues=venue_options on_change=set_filters/>
            {state}
        </section>
    }
}
