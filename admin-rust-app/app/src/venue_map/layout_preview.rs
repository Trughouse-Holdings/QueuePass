//! Parity M6 (`packages/shared/src/web/venue-map/layout-preview.tsx`): a small drawing of a
//! layout, its sections in place with their names around its floor object, never its seats. One
//! image, named for the layout and its section count ("Basketball: 54 sections"); the names drawn
//! are not read out one by one. The numbers come from `core::seating::venue_map::layout_preview`,
//! already written as JavaScript writes them.

use admin_rust_core::seating::venue_map::{PreviewLayout, layout_preview};
use leptos::prelude::*;

#[component]
pub fn LayoutPreview(layout: PreviewLayout) -> impl IntoView {
    let drawing = layout_preview(&layout);
    let font_size = drawing.font_size;
    view! {
        <svg
            class="layout-preview"
            role="img"
            aria-label=drawing.label
            viewBox=drawing.view_box
            preserveAspectRatio="xMidYMid meet"
        >
            {drawing.floor.map(|d| view! { <path class="layout-preview__floor" d=d/> })}
            {drawing
                .sections
                .into_iter()
                .map(|s| {
                    view! {
                        <g>
                            <path class="layout-preview__section" d=s.d/>
                            <text
                                class="layout-preview__label"
                                x=s.x
                                y=s.y
                                font-size=font_size.clone()
                                text-anchor="middle"
                                dominant-baseline="central"
                                aria-hidden="true"
                            >
                                {s.name}
                            </text>
                        </g>
                    }
                })
                .collect_view()}
        </svg>
    }
}
