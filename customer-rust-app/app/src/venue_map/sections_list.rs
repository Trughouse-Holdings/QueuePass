//! Spec 040 T049 (R4's new work, parity M7): the Sections list beside the map,
//! `packages/shared/src/web/venue-map/sections-list.tsx`, which the Rust Admin app does not have.
//! Every section in map order, as a button with its name, the price range of its open seats, and
//! their count (`core::seating::venue_map::sections_list_rows`); the open one is pressed and says
//! "On the map". Choosing one opens it on the map; choosing it again shows the whole map. Its
//! heading (`tabindex=-1`) is where the map's "Skip to the Sections list" moves the focus.

use customer_rust_core::seating::{
    map_state::VenueMap,
    venue_map::{SectionsListRow, sections_list_rows},
};
use leptos::prelude::*;

#[component]
fn SectionButton(
    rows: Memo<Vec<SectionsListRow>>,
    id: String,
    on_open_section: Callback<Option<String>>,
) -> impl IntoView {
    let row = Memo::new(move |_| rows.with(|r| r.iter().find(|r| r.section_id == id).cloned()));
    let get = move |f: fn(&SectionsListRow) -> String| {
        row.with(|r| r.as_ref().map(f).unwrap_or_default())
    };
    let chosen = move || row.with(|r| r.as_ref().is_some_and(|r| r.chosen));
    view! {
        <li>
            <button
                type="button"
                aria-label=move || get(|r| r.name.clone())
                aria-pressed=move || if chosen() { "true" } else { "false" }
                class=move || get(|r| r.class.clone())
                on:click=move |_| {
                    let choose = row.with_untracked(|r| r.as_ref().and_then(|r| r.on_choose().map(str::to_string)));
                    on_open_section.run(choose);
                }
            >
                <span class="sections-list__name">{move || get(|r| r.title.clone())}</span>
                {move || row.with(|r| r.as_ref().and_then(|r| r.prices.clone())).map(|p| view! { <span class="sections-list__prices">{p}</span> })}
                <span class="sections-list__count">{move || get(|r| r.count.clone())}</span>
                {move || chosen().then(|| view! {
                    <span class="sections-list__shown" aria-hidden="true">"On the map"</span>
                })}
            </button>
        </li>
    }
}

#[component]
pub fn SectionsList(
    map: Signal<VenueMap>,
    open_section_id: Signal<Option<String>>,
    on_open_section: Callback<Option<String>>,
    /// The heading's id, the skip link's target.
    #[prop(into)]
    heading_id: String,
) -> impl IntoView {
    let rows = Memo::new(move |_| {
        let open = open_section_id.get();
        map.with(|m| sections_list_rows(m, open.as_deref()))
    });
    let labelled_by = heading_id.clone();
    view! {
        <section class="sections-list" aria-labelledby=labelled_by>
            <h3 id=heading_id tabindex="-1">
                "Sections"
            </h3>
            <ul class="sections-list__sections">
                // Keyed, so a count change updates a button in place and the focus stays on it.
                <For each=move || rows.with(|r| r.iter().map(|r| r.section_id.clone()).collect::<Vec<_>>()) key=|id| id.clone() let:id>
                    <SectionButton rows id on_open_section/>
                </For>
            </ul>
        </section>
    }
}
