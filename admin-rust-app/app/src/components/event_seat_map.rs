//! Spec 037 (task T063; parity M12, E12), port of `admin-app/src/components/EventSeatMap.tsx`.
//!
//! Spec 038 US6 (FR-027, FR-028): the event page's Seating card. A seated event's seats on the
//! shared venue map colored by state (open, held, sold, off sale), each section with its counts,
//! the event's totals, a section zoomed into by a click, all kept live by the seat stream (spec
//! 015 FR-010). The map never says who holds or bought a seat; the attendee list does (FR-028).
//! The layout, prices and seats off sale are changed in the event form (FR-015), so the card only
//! points there.

use admin_rust_core::{
    api::types::Event,
    seating::venue_map::{
        ColorBy, LOADING_SEAT_MAP, RECONNECTING_NOTE, SEAT_MAP_UNAVAILABLE, SeatView, SeatingCard,
        is_seated, kept_open_section, seating_card, totals_line,
    },
};
use leptos::prelude::*;

use crate::{components::AppLink, seat_stream::use_seat_stream, venue_map::venue_map::VenueMap};

/// What the card shows, without the map's data, so the map itself is built once.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shown {
    Loading,
    Unavailable,
    Map,
}

/// The live part of a seated event's card.
#[component]
fn LiveSeatMap(event_id: String) -> impl IntoView {
    let open = RwSignal::new(None::<String>);
    let live = use_seat_stream(event_id, open.into());
    let shown = Memo::new(move |_| {
        let status = live.status.get();
        live.map
            .with(|m| match seating_card(true, status, m.as_ref()) {
                SeatingCard::Map { .. } => Shown::Map,
                SeatingCard::Unavailable => Shown::Unavailable,
                _ => Shown::Loading,
            })
    });
    move || match shown.get() {
        Shown::Loading => view! { <p class="loading">{LOADING_SEAT_MAP}</p> }.into_any(),
        Shown::Unavailable => view! { <p class="note">{SEAT_MAP_UNAVAILABLE}</p> }.into_any(),
        Shown::Map => {
            let Some(first) = live.map.get_untracked() else {
                return ().into_any();
            };
            // The map shown: the latest one, kept while the card shows it.
            let map = RwSignal::new(first);
            Effect::new(move |_| {
                if let Some(m) = live.map.get() {
                    map.set(m);
                }
            });
            // A section gone from a new layout (the stream ended on the change) is closed.
            let open_section_id = Signal::derive(move || {
                map.with(|m| kept_open_section(m, open.get().as_deref()).map(str::to_string))
            });
            view! {
                // Spec 015 FR-013: the event's seats by state, kept current by the stream.
                <p>{move || map.with(totals_line)}</p>
                {move || {
                    (live.status.get() == admin_rust_core::api::seat_stream::LiveSeatStatus::Reconnecting)
                        .then(|| view! { <p class="note">{RECONNECTING_NOTE}</p> })
                }}
                <VenueMap
                    map=map.into()
                    color_by=ColorBy::State
                    open_section_id
                    section=live.section.into()
                    on_open_section=Callback::new(move |id| open.set(id))
                    // The admin's map only shows the seats: none is chosen from it.
                    seat_view=Callback::new(|_| SeatView { shown: None, disabled: Some(true) })
                />
            }
            .into_any()
        }
    }
}

#[component]
pub fn EventSeatMap(event: Event) -> impl IntoView {
    let seated = is_seated(event.layout_id.is_some(), event.reserved_seating);
    let id = event.id.to_string();
    let body = if seated {
        view! {
            <p class="note">
                "Reserved seating: its layout, prices by level and seats off sale are changed in"
                " "
                <AppLink href=format!("/events/{id}/edit")>"Edit event"</AppLink>
                ". Who bought a seat is on the"
                " "
                <AppLink href=format!("/events/{id}/attendees")>"attendee list"</AppLink>
                "."
            </p>
            <LiveSeatMap event_id=id/>
        }
        .into_any()
    } else {
        view! { <p class="note">"General admission."</p> }.into_any()
    };
    view! {
        <section class="card" aria-labelledby="seating-heading">
            <h2 id="seating-heading">"Seating"</h2>
            {body}
        </section>
    }
}
