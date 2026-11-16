//! Parity B5, B6, SL3 (`customer-app/src/components/EventCard.tsx`): one event as a card, built
//! only from what the list already has, so a list of cards needs no extra requests. Links carry
//! `tap` for a 44-pixel target (spec 008 FR-006). Spec 014 FR-020: the event's images, if any,
//! across the top of the card, loaded only while the card is on or near the screen.

use customer_rust_core::{
    api::types::{Event, EventStatus},
    format::{self, doors_open, when},
    time::to_iso_string,
};
use leptos::prelude::*;

use crate::{
    components::{
        AppLink,
        gallery::{GalleryImage, GalleryVariant, ImageGallery},
    },
    util::enum_text,
};

/// `eventPrice(e)` (parity F2) over the generated type.
pub fn event_price(e: &Event) -> String {
    format::event_price(
        &e.base_price,
        e.reserved_seating,
        e.price_max.as_deref().map(String::as_str),
    )
}

/// `count(n)` (parity F5) for the contract's positive counts.
pub fn count(n: u64) -> String {
    format::count(i64::try_from(n).unwrap_or(i64::MAX))
}

/// The event's zone as the API spells it (`location.timeZone`).
pub fn zone(e: &Event) -> String {
    enum_text(&e.location.time_zone)
}

/// `when(startsAt, timeZone)` and the like, from the generated type's instant.
pub fn event_when(at: chrono::DateTime<chrono::Utc>, e: &Event) -> String {
    when(&to_iso_string(at), Some(&zone(e)))
}

/// `doorsOpen(startsAt, doorsOpenAt, timeZone)` (parity B7).
pub fn event_doors_open(e: &Event) -> String {
    doors_open(
        &to_iso_string(e.starts_at),
        &to_iso_string(e.doors_open_at),
        Some(&zone(e)),
    )
}

/// The event's images as the gallery needs them.
pub fn gallery_images(e: &Event) -> Vec<GalleryImage> {
    e.images
        .iter()
        .map(|i| GalleryImage {
            id: i.id.to_string(),
            content_type: enum_text(&i.content_type),
        })
        .collect()
}

#[component]
pub fn EventCard(event: Event) -> impl IntoView {
    let e = event;
    let id = e.id.to_string();
    let heading_id = format!("event-{id}");
    let labelled_by = heading_id.clone();
    let href = format!("/events/{id}");
    let name = e.name.to_string();
    let images = gallery_images(&e);
    let cancelled = e.status == EventStatus::Cancelled;
    let (doors, starts, ends) = (
        event_doors_open(&e),
        event_when(e.starts_at, &e),
        event_when(e.ends_at, &e),
    );
    let venue_href = format!("/venues/{}", e.location_id);
    let venue = e.location.name.to_string();
    let price = event_price(&e);
    view! {
        <article class="card card--padded event-card" aria-labelledby=labelled_by>
            <ImageGallery
                event_id=id
                event_name=name.clone()
                images
                variant=GalleryVariant::Card
                event_href=href.clone()
            />
            <div class="event-card__head">
                <h2 id=heading_id class="event-card__title">
                    <AppLink href=href class="tap">{name}</AppLink>
                </h2>
                {cancelled.then(|| view! { <span class="pill pill--danger">"Cancelled"</span> })}
            </div>
            <dl class="event-card__facts">
                <dt>"Doors open"</dt>
                <dd>{doors}</dd>
                <dt>"Starts"</dt>
                <dd>{starts}</dd>
                <dt>"Ends"</dt>
                <dd>{ends}</dd>
                <dt>"Venue"</dt>
                <dd>
                    <AppLink href=venue_href class="tap">{venue}</AppLink>
                </dd>
                <dt>"Price"</dt>
                // Spec 038 FR-024: a seated event's price range, "$35–$95".
                <dd class="price">{price}</dd>
            </dl>
        </article>
    }
}

/// `EventCards`: cards side by side on a wide screen, one column on a phone (spec 008 FR-006).
#[component]
pub fn EventCards(events: Vec<Event>, #[prop(into)] label: String) -> impl IntoView {
    view! {
        <ul class="card-grid" aria-label=label>
            {events
                .into_iter()
                .map(|event| view! { <li><EventCard event/></li> })
                .collect_view()}
        </ul>
    }
}
