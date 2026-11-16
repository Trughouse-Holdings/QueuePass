//! Parity B2, B3, SL2 (`customer-app/src/components/EventFilters.tsx`): name search, venue,
//! dates, and Hide cancelled. Every change goes straight to the page address through `on_change`
//! (a pushed entry), except typing, which waits for a 300 ms pause and then replaces the entry.

use std::time::Duration;

use customer_rust_core::filters::{Filters, SEARCH_PAUSE_MS, typed_search, venue_choice};
use leptos::prelude::*;

/// A listed venue: its id and name, in API order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VenueOption {
    pub id: String,
    pub name: String,
}

/// `on_change(next, replace)`.
pub type OnFiltersChange = Callback<(Filters, bool)>;

#[component]
pub fn EventFilters(
    filters: Memo<Filters>,
    venues: Signal<Vec<VenueOption>>,
    on_change: OnFiltersChange,
) -> impl IntoView {
    let text = RwSignal::new(filters.get_untracked().q);

    // The address can change without typing (Clear filters, the back button): follow it.
    Effect::watch(
        move || filters.with(|f| f.q.clone()),
        move |q, _, _| text.set(q.clone()),
        false,
    );

    // Typing settles for SEARCH_PAUSE_MS, then replaces the history entry with the trimmed text.
    Effect::new(move |_| {
        let Some(next) = filters.with(|f| typed_search(&text.get(), f)) else {
            return;
        };
        let handle = set_timeout_with_handle(
            move || on_change.run((next, true)),
            Duration::from_millis(SEARCH_PAUSE_MS),
        );
        if let Ok(handle) = handle {
            on_cleanup(move || handle.clear());
        }
    });

    let change = move |edit: fn(&mut Filters, String), value: String| {
        let mut next = filters.get_untracked();
        edit(&mut next, value);
        on_change.run((next, false));
    };
    let ids = move || venues.with(|v| v.iter().map(|o| o.id.clone()).collect::<Vec<_>>());
    let chosen = Memo::new(move |_| filters.with(|f| venue_choice(f, &ids())));

    view! {
        <form
            class="filters card card--padded"
            role="search"
            on:submit=move |e: leptos::ev::SubmitEvent| e.prevent_default()
        >
            <div class="field">
                <label for="filter-q">"Search events"</label>
                <input
                    id="filter-q"
                    type="search"
                    placeholder="Event name"
                    prop:value=move || text.get()
                    on:input=move |e| text.set(event_target_value(&e))
                />
            </div>
            <div class="field">
                <label for="filter-venue">"Venue"</label>
                <select
                    id="filter-venue"
                    prop:value=move || chosen.get()
                    on:change=move |e| change(|f, v| f.venue = v, event_target_value(&e))
                >
                    <option value="" prop:selected=move || chosen.with(String::is_empty)>
                        "All venues"
                    </option>
                    <For each=move || venues.get() key=|v| v.id.clone() let:venue>
                        {
                            let id = venue.id.clone();
                            view! {
                                <option
                                    value=venue.id.clone()
                                    prop:selected=move || chosen.with(|c| *c == id)
                                >
                                    {venue.name}
                                </option>
                            }
                        }
                    </For>
                </select>
            </div>
            <div class="field-row">
                <div class="field">
                    <label for="filter-from">"From"</label>
                    <input
                        id="filter-from"
                        type="date"
                        prop:value=move || filters.with(|f| f.from.clone())
                        on:change=move |e| change(|f, v| f.from = v, event_target_value(&e))
                    />
                </div>
                <div class="field">
                    <label for="filter-to">"To"</label>
                    <input
                        id="filter-to"
                        type="date"
                        prop:value=move || filters.with(|f| f.to.clone())
                        min=move || filters.with(|f| (!f.from.is_empty()).then(|| f.from.clone()))
                        on:change=move |e| change(|f, v| f.to = v, event_target_value(&e))
                    />
                </div>
            </div>
            <label class="choice">
                <input
                    type="checkbox"
                    prop:checked=move || filters.with(|f| f.hide_cancelled)
                    on:change=move |e| {
                        let mut next = filters.get_untracked();
                        next.hide_cancelled = event_target_checked(&e);
                        on_change.run((next, false));
                    }
                />
                "Hide cancelled"
            </label>
        </form>
    }
}
