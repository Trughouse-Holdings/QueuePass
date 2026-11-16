//! Parity V2, V3, B8, SL5 (`customer-app/src/pages/VenueDetail.tsx`): one venue and the events
//! scheduled there, soonest first. `GET /locations/{id}` and `GET /events?locationId={id}` load
//! together; the venue's own answer decides missing or not, then the events must load too.

use customer_rust_core::{
    api::{
        client::{ApiClient, ApiError, EventQuery},
        types::{Event, Location},
    },
    load::Load,
};
use leptos::prelude::*;
use leptos_router::hooks::use_params_map;

use crate::{
    components::{
        AddressLink, AppLink, ServiceUnreachable,
        event_card::{EventCards, count},
    },
    load::use_load,
};

/// Both reads at once (`Promise.all`); the venue's failure wins, then the events'.
async fn venue_and_events(api: ApiClient, id: String) -> Result<(Location, Vec<Event>), ApiError> {
    let query = EventQuery {
        location_id: Some(id.clone()),
        ..EventQuery::default()
    };
    let venue = api.get_location(&id);
    let events = api.list_events(&query);
    let (venue, events) = futures_join(venue, events).await;
    Ok((venue?, events?))
}

/// Polls both futures to completion together, as `Promise.all` does (both requests in flight).
async fn futures_join<A, B>(a: A, b: B) -> (A::Output, B::Output)
where
    A: std::future::Future,
    B: std::future::Future,
{
    use std::{pin::pin, task::Poll};
    let mut a = pin!(a);
    let mut b = pin!(b);
    let (mut ra, mut rb) = (None, None);
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
        if ra.is_some() && rb.is_some() {
            Poll::Ready((ra.take().unwrap(), rb.take().unwrap()))
        } else {
            Poll::Pending
        }
    })
    .await
}

#[component]
pub fn VenueDetail() -> impl IntoView {
    let params = use_params_map();
    let id = Memo::new(move |_| params.read().get("id").unwrap_or_default());
    let load = use_load(move || id.get(), venue_and_events);
    move || {
        load.with(|l| match l {
            Load::Loading => view! { <p>"Loading…"</p> }.into_any(),
            Load::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
            Load::Missing => view! {
                <section>
                    <p>"This venue is no longer available."</p>
                    <AppLink href="/venues">"Back to venues"</AppLink>
                </section>
            }
            .into_any(),
            Load::Ok((venue, events)) => {
                let name = venue.name.to_string();
                let events = (!events.is_empty()).then(|| events.clone());
                view! {
                    <section>
                        <h1 class="page-title">{name.clone()}</h1>
                        <div class="card">
                            <dl>
                                <dt>"Address"</dt>
                                <dd>
                                    <AddressLink address=venue.address.to_string()/>
                                </dd>
                                <dt>"Seating capacity"</dt>
                                <dd>{count(venue.seating_capacity.get())}</dd>
                            </dl>
                        </div>
                        <h2>"Events here"</h2>
                        {match events {
                            None => view! { <p>"Nothing is scheduled here."</p> }.into_any(),
                            Some(events) => {
                                view! { <EventCards events label=format!("Events at {name}")/> }
                                    .into_any()
                            }
                        }}
                        <AppLink href="/venues">"All venues"</AppLink>
                    </section>
                }
                .into_any()
            }
        })
    }
}
