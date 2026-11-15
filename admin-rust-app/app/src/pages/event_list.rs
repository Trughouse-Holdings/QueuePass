//! Parity E1, E17 (`admin-app/src/pages/EventList.tsx`): the event list, filtered by name,
//! venue, and date range (spec 004 US2), with Show past events (spec 030), all kept in the
//! address; each change pushes a history entry, so Back restores the earlier filter (S15).

use admin_rust_core::{
    api::{
        client::EventFilters,
        types::{Event, Location},
    },
    format::{has_ended, until},
    forms::section_lines::to_locale_string,
    time::{DEFAULT_TIME_ZONE, format_event_date, format_time_of_day, to_iso_string},
};
use leptos::{prelude::*, task::spawn_local};
use leptos_router::{
    NavigateOptions,
    hooks::{use_navigate, use_query_map},
};

use crate::{
    auth::use_auth,
    components::{AppLink, Notice},
    util::{enum_text, now_ms, search_params, with_query},
};

/// Spec 030 FR-009: said while Show past events is off, when the list is empty.
const PAST_HIDDEN_HINT: &str = "Past events are hidden; turn on Show past events to include them.";

/// The filters as the address holds them: human dates, `venue` for the venue id.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct UrlFilters {
    q: String,
    venue: String,
    from: String,
    to: String,
}

impl UrlFilters {
    fn any(&self) -> bool {
        !(self.q.is_empty() && self.venue.is_empty() && self.from.is_empty() && self.to.is_empty())
    }

    /// The address for these filters, `past=1` kept beside them (spec 030 research R5).
    fn url(&self, past: bool) -> String {
        let mut pairs = Vec::new();
        for (k, v) in [
            ("q", &self.q),
            ("venue", &self.venue),
            ("from", &self.from),
            ("to", &self.to),
        ] {
            let v = v.trim();
            if !v.is_empty() {
                pairs.push((k, v.to_string()));
            }
        }
        if past {
            pairs.push(("past", "1".to_string()));
        }
        with_query("/events", &search_params(&pairs))
    }

    /// Spec 020 FR-020: the days as typed; spec 030: `includePast` only while on.
    fn api(&self, past: bool) -> EventFilters {
        let opt = |s: &str| (!s.trim().is_empty()).then(|| s.trim().to_string());
        EventFilters {
            q: opt(&self.q),
            location_id: opt(&self.venue),
            from_date: opt(&self.from),
            to_date: opt(&self.to),
            include_past: past,
        }
    }
}

fn zone_of(e: &Event) -> String {
    let zone = enum_text(&e.location.time_zone);
    if zone.is_empty() {
        DEFAULT_TIME_ZONE.to_string()
    } else {
        zone
    }
}

#[component]
pub fn EventList() -> impl IntoView {
    let auth = use_auth();
    let navigate = use_navigate();
    let query = use_query_map();
    let applied = Memo::new(move |_| {
        query.with(|p| UrlFilters {
            q: p.get("q").unwrap_or_default(),
            venue: p.get("venue").unwrap_or_default(),
            from: p.get("from").unwrap_or_default(),
            to: p.get("to").unwrap_or_default(),
        })
    });
    let past = Memo::new(move |_| query.with(|p| p.get("past").as_deref() == Some("1")));
    let form = RwSignal::new(applied.get_untracked());
    let form_error: RwSignal<Option<&'static str>> = RwSignal::new(None);
    // Spec 030 FR-012: the time is read when the events arrive and kept with them.
    let loaded: RwSignal<Option<(Vec<Event>, i64)>> = RwSignal::new(None);
    let venues: RwSignal<Vec<Location>> = RwSignal::new(Vec::new());
    let error: RwSignal<Option<String>> = RwSignal::new(None);
    let asked = StoredValue::new(0u64);

    spawn_local(async move {
        venues.set(auth.api().list_locations(None).await.unwrap_or_default());
    });

    Effect::new(move |_| {
        let filters = applied.get().api(past.get());
        let ticket = asked.get_value() + 1;
        asked.set_value(ticket);
        loaded.set(None);
        error.set(None);
        spawn_local(async move {
            let result = auth.api().list_events(&filters).await;
            if asked.get_value() != ticket {
                return;
            }
            match result {
                Ok(events) => loaded.set(Some((events, now_ms()))),
                Err(e) => error.set(Some(e.message().to_string())),
            }
        });
    });

    let nav = navigate.clone();
    let apply = move |f: UrlFilters| nav(&f.url(past.get_untracked()), NavigateOptions::default());
    let search = {
        let apply = apply.clone();
        move |ev: leptos::ev::SubmitEvent| {
            ev.prevent_default();
            let f = form.get_untracked();
            if !f.from.is_empty() && !f.to.is_empty() && f.from > f.to {
                form_error.set(Some("From must be on or before To."));
                return;
            }
            form_error.set(None);
            apply(f);
        }
    };
    let clear = {
        let apply = apply.clone();
        move || {
            form.set(UrlFilters::default());
            form_error.set(None);
            apply(UrlFilters::default());
        }
    };
    let show_past = {
        let navigate = navigate.clone();
        move |on: bool| navigate(&applied.get_untracked().url(on), NavigateOptions::default())
    };

    let clear_a = clear.clone();
    let clear_b = clear.clone();
    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">"Events"</h1>
                    <p class="page-sub">
                        {move || match loaded.get() {
                            Some((events, _)) => format!(
                                "{} event{} {}{}",
                                events.len(),
                                if events.len() == 1 { "" } else { "s" },
                                if applied.get().any() { "match" } else { "scheduled" },
                                if past.get() { "" } else { " · past events hidden" },
                            ),
                            None => "Loading…".into(),
                        }}
                    </p>
                </div>
                <AppLink href="/events/new" class="btn btn--primary">
                    <span aria-hidden="true">"+"</span>
                    " Schedule event"
                </AppLink>
            </div>

            <Notice/>

            <form role="search" class="card form" on:submit=search>
                <div class="field-row">
                    <label class="field">
                        "Search events"
                        <input
                            type="search"
                            maxlength="200"
                            placeholder="Event name"
                            prop:value=move || form.get().q
                            on:input=move |ev| form.update(|f| f.q = event_target_value(&ev))
                        />
                    </label>
                    <label class="field">
                        "Venue"
                        <select
                            prop:value=move || form.get().venue
                            on:change=move |ev| form.update(|f| f.venue = event_target_value(&ev))
                        >
                            <option value="">"All venues"</option>
                            {move || venues.get().into_iter().map(|v| {
                                let id = v.id.to_string();
                                let selected = form.with_untracked(|f| f.venue == id);
                                view! { <option value=id selected=selected>{v.name.to_string()}</option> }
                            }).collect_view()}
                        </select>
                    </label>
                    <label class="field">
                        "From"
                        <input
                            type="date"
                            prop:value=move || form.get().from
                            on:input=move |ev| form.update(|f| f.from = event_target_value(&ev))
                        />
                    </label>
                    <label class="field">
                        "To"
                        <input
                            type="date"
                            prop:value=move || form.get().to
                            on:input=move |ev| form.update(|f| f.to = event_target_value(&ev))
                        />
                    </label>
                </div>
                {move || form_error.get().map(|m| view! {
                    <p role="alert" class="banner banner--error">{m}</p>
                })}
                <div class="form__actions">
                    <button type="submit" class="btn btn--primary">"Search"</button>
                    <button type="button" class="btn" on:click=move |_| clear_a()>"Clear"</button>
                </div>
            </form>

            <label class="choice">
                <input
                    type="checkbox"
                    prop:checked=move || past.get()
                    on:change=move |ev| show_past(event_target_checked(&ev))
                />
                "Show past events"
            </label>

            {move || error.get().map(|message| view! {
                <div role="alert" class="banner banner--error">
                    <span class="banner__icon" aria-hidden="true">"✕"</span>
                    <div class="banner__body">
                        <strong>"Could not load events"</strong>
                        <p>{message}</p>
                    </div>
                </div>
            })}

            <div class="card">
                {move || {
                    let clear = clear_b.clone();
                    match loaded.get() {
                        None => view! { <p class="loading">"Loading events…"</p> }.into_any(),
                        Some((events, _)) if events.is_empty() && applied.get().any() => view! {
                            <div class="empty">
                                <p class="empty__title">"No events match these filters."</p>
                                {(!past.get()).then(|| view! { <p class="empty__body">{PAST_HIDDEN_HINT}</p> })}
                                <button type="button" class="btn" on:click=move |_| clear()>
                                    "Clear filters"
                                </button>
                            </div>
                        }
                        .into_any(),
                        Some((events, _)) if events.is_empty() => view! {
                            <div class="empty">
                                <div class="empty__icon" aria-hidden="true">"◷"</div>
                                <p class="empty__title">"No events scheduled"</p>
                                <p class="empty__body">"Schedule one against a venue to get started."</p>
                                {(!past.get()).then(|| view! { <p class="empty__body">{PAST_HIDDEN_HINT}</p> })}
                                <AppLink href="/events/new" class="btn btn--primary">"Schedule event"</AppLink>
                            </div>
                        }
                        .into_any(),
                        Some((events, at)) => view! {
                            <div class="table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>"Event"</th>
                                            <th>"Venue"</th>
                                            <th>"Date"</th>
                                            <th>"Time"</th>
                                            <th>"Tickets"</th>
                                            <th>"Base price"</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {events.into_iter().map(|e| event_row(e, at)).collect_view()}
                                    </tbody>
                                </table>
                            </div>
                        }
                        .into_any(),
                    }
                }}
            </div>
        </section>
    }
}

fn event_row(e: Event, at: i64) -> impl IntoView {
    let id = e.id.to_string();
    let zone = zone_of(&e);
    let starts = to_iso_string(e.starts_at);
    let ends = to_iso_string(e.ends_at);
    let cancelled = enum_text(&e.status) == "CANCELLED";
    let ended = has_ended(&ends, at);
    view! {
        <tr>
            <td class="cell-strong">
                <AppLink href=format!("/events/{id}") class="rowlink">{e.name.to_string()}</AppLink>
                " "
                {cancelled.then(|| view! { <span class="pill pill--danger">"Cancelled"</span> })}
                " "
                {ended.then(|| view! { <span class="pill">"Ended"</span> })}
            </td>
            <td>
                <span class="pill">{e.location.name.to_string()}</span>
            </td>
            <td class="cell-time">{format_event_date(e.starts_at, &zone)}</td>
            <td class="cell-time">
                {format!(
                    "{} – {}",
                    format_time_of_day(e.starts_at, &zone),
                    until(&starts, &ends, Some(&zone)),
                )}
            </td>
            <td class="cell-num">{to_locale_string(e.total_ticket_capacity.get() as f64)}</td>
            <td class="price">{format!("${}", e.base_price.as_str())}</td>
            <td class="cell-action">
                <AppLink href=format!("/events/{id}/edit") class="rowlink">"Edit"</AppLink>
            </td>
        </tr>
    }
}
