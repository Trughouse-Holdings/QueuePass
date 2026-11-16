// Copied from admin-rust-app/app/src/venue_map/legend.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R13 (task T063; parity M13, M15): the venue map's legend and the seat marks,
//! as `packages/shared/src/web/venue-map/legend.tsx` (`Legend`, `SeatMark`). The texts, classes,
//! and mark geometry come from `core::seating::venue_map::legend` and `seat_mark`.

use customer_rust_core::seating::{
    map_state::VenueMap,
    venue_map::{ColorBy, LegendData, MarkPart, legend},
};
use leptos::prelude::*;

/// `SeatMark`: a seat's mark, its elements in order, inside the caller's `<g>`.
pub fn seat_mark_view(parts: Vec<MarkPart>) -> impl IntoView {
    parts
        .into_iter()
        .map(|part| match part {
            MarkPart::Circle { class, cx, cy, r } => {
                view! { <circle class=class cx=cx cy=cy r=r></circle> }.into_any()
            }
            MarkPart::Path { class, d } => view! { <path class=class d=d></path> }.into_any(),
        })
        .collect_view()
}

fn legend_view(data: LegendData) -> impl IntoView {
    let price_levels = data.price_levels.map(|items| {
        view! {
            <ul aria-label="Price levels" class="venue-map-legend__list">
                {items
                    .into_iter()
                    .map(|item| view! {
                        <li class="venue-map-legend__item">
                            <span class=item.swatch_class aria-hidden="true"></span>
                            {item.text}
                        </li>
                    })
                    .collect_view()}
            </ul>
        }
    });
    let sections = data.sections.map(|items| {
        view! {
            <ul aria-label="Sections" class="venue-map-legend__list">
                {items
                    .into_iter()
                    .map(|item| view! {
                        <li class="venue-map-legend__item">
                            <span class=item.swatch_class aria-hidden="true"></span>
                            {item.text}
                        </li>
                    })
                    .collect_view()}
            </ul>
            <p class="venue-map-legend__note">{data.note.unwrap_or_default()}</p>
        }
    });
    let states = data
        .seat_states
        .into_iter()
        .map(|mark| {
            view! {
                <li class="venue-map-legend__item">
                    <svg
                        class="venue-map-legend__mark"
                        viewBox="-1 -1 2 2"
                        width="16"
                        height="16"
                        aria-hidden="true"
                    >
                        <g class=mark.group_class>{seat_mark_view(mark.marks)}</g>
                    </svg>
                    {mark.name}
                </li>
            }
        })
        .collect_view();
    view! {
        <div class="venue-map-legend">
            {price_levels}
            {sections}
            <ul aria-label="Seat states" class="venue-map-legend__list">{states}</ul>
        </div>
    }
}

/// `Legend` (spec 038 FR-016, FR-019, FR-027): the price levels (by price) or what each section
/// fill means (by state), then each seat state beside the mark the map draws for it. Drawn again
/// only when what it says changes.
#[component]
pub fn Legend(map: Signal<VenueMap>, color_by: ColorBy) -> impl IntoView {
    let data = Memo::new(move |_| map.with(|m| legend(m, color_by)));
    move || legend_view(data.get())
}
