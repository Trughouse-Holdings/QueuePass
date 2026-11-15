//! Parity V5, V7, M7 (`admin-app/src/pages/LocationDetail.tsx`, `hooks/use-delete.ts`): one
//! venue, the events scheduled there with its own Show past events (spec 030, kept in the
//! address as `past=1`), Edit and Delete, the capacity its largest layout sets, and the Layouts
//! card.

use std::{future::Future, pin::pin, task::Poll};

use admin_rust_core::{
    api::{
        client::{ApiError, EventFilters},
        types::{Event, LayoutSummary, Location},
    },
    format::{has_ended, venue_zone, when},
    forms::{
        layouts::{as_api_error, capacity_note, largest_capacity},
        section_lines::to_locale_string,
    },
    time::to_iso_string,
};
use leptos::{prelude::*, task::spawn_local};
use leptos_router::{
    NavigateOptions,
    hooks::{use_navigate, use_params_map, use_query_map},
};

use crate::{
    auth::use_auth,
    components::{
        AddressLink, AppLink, ErrorBanner, NoticeKind, ServiceUnreachable, banners::with_notice,
        layouts_card::LayoutsCard,
    },
    util::{enum_text, now_ms, search_params, with_query},
};

/// Both calls at once, as `Promise.all`.
async fn join2<A: Future, B: Future>(a: A, b: B) -> (A::Output, B::Output) {
    let mut a = pin!(a);
    let mut b = pin!(b);
    let mut ra = None;
    let mut rb = None;
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
        match (ra.take(), rb.take()) {
            (Some(x), Some(y)) => Poll::Ready((x, y)),
            (x, y) => {
                ra = x;
                rb = y;
                Poll::Pending
            }
        }
    })
    .await
}

#[derive(Clone)]
enum Load {
    Loading,
    Ok {
        venue: Box<Location>,
        events: Vec<Event>,
        loaded_at: i64,
    },
    Missing,
    Unreachable,
}

/// What the page shows; the venue view stays in place while the same venue reloads.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Shown {
    Loading,
    Venue(String),
    Missing,
    Unreachable,
}

/// `/locations/:id`.
#[component]
pub fn VenueDetail() -> impl IntoView {
    let auth = use_auth();
    let params = use_params_map();
    let query = use_query_map();
    let id = Memo::new(move |_| params.with(|p| p.get("id").unwrap_or_default()));
    let past = Memo::new(move |_| query.with(|p| p.get("past").as_deref() == Some("1")));
    let load = RwSignal::new(Load::Loading);
    let asked = StoredValue::new(0u64);

    Effect::new(move |_| {
        let id = id.get();
        let past = past.get();
        let ticket = asked.get_value() + 1;
        asked.set_value(ticket);
        spawn_local(async move {
            let api = auth.api();
            let filters = EventFilters {
                location_id: Some(id.clone()),
                include_past: past,
                ..EventFilters::default()
            };
            let (venue, events) = join2(api.get_location(&id), api.list_events(&filters)).await;
            if asked.try_get_value() != Some(ticket) {
                return;
            }
            // Spec 030 FR-012 (research R6): the time is read when the events arrive.
            load.set(match (venue, events) {
                (Ok(venue), Ok(events)) => Load::Ok {
                    venue: Box::new(venue),
                    events,
                    loaded_at: now_ms(),
                },
                (Err(e), _) if e.status() == Some(404) => Load::Missing,
                _ => Load::Unreachable,
            });
        });
    });

    let shown = Memo::new(move |_| {
        load.with(|l| match l {
            Load::Loading => Shown::Loading,
            Load::Ok { venue, .. } => Shown::Venue(venue.id.to_string()),
            Load::Missing => Shown::Missing,
            Load::Unreachable => Shown::Unreachable,
        })
    });

    move || match shown.get() {
        Shown::Loading => view! { <p class="loading">"Loading venue…"</p> }.into_any(),
        Shown::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
        Shown::Missing => view! {
            <section>
                <p>"This venue no longer exists."</p>
                <AppLink href="/locations" class="btn">"Back to venues"</AppLink>
            </section>
        }
        .into_any(),
        Shown::Venue(venue_id) => view! { <VenueView venue_id load past/> }.into_any(),
    }
}

#[component]
fn VenueView(venue_id: String, load: RwSignal<Load>, past: Memo<bool>) -> impl IntoView {
    let auth = use_auth();
    let navigate = use_navigate();
    let query = use_query_map();
    // `setParams`: `past=1` set or removed, the other parameters kept.
    let past_id = venue_id.clone();
    let go_past = navigate.clone();
    let on_past = move |on: bool| {
        let mut pairs: Vec<(String, String)> = query.with_untracked(|p| {
            p.into_iter()
                .filter(|(k, _)| k.as_ref() != "past")
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        });
        if on {
            pairs.push(("past".into(), "1".into()));
        }
        let pairs: Vec<(&str, String)> =
            pairs.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
        let to = with_query(&format!("/locations/{past_id}"), &search_params(&pairs));
        go_past(&to, NavigateOptions::default());
    };

    let venue = move || {
        load.with(|l| match l {
            Load::Ok { venue, .. } => Some((**venue).clone()),
            _ => None,
        })
    };
    let venue_text = move |f: fn(&Location) -> String| {
        move || {
            load.with(|l| match l {
                Load::Ok { venue, .. } => f(venue),
                _ => String::new(),
            })
        }
    };
    let name = venue_text(|v| v.name.to_string());

    // Spec 038 FR-009: while the venue has layouts, its capacity is its largest layout's.
    let layouts: RwSignal<Vec<LayoutSummary>> = RwSignal::new(Vec::new());
    let largest = Memo::new(move |_| layouts.with(|l| largest_capacity(l)));

    // `useDelete`: confirm, delete, then go to the list or say why not (spec 002 FR-026–FR-029).
    let deleting = RwSignal::new(false);
    let error: RwSignal<Option<ApiError>> = RwSignal::new(None);
    // Not state: a second click before the first is answered must see the first one.
    let in_flight = StoredValue::new(false);
    let delete_id = venue_id.clone();
    let remove = move |_| {
        if in_flight.get_value() {
            return;
        }
        let venue_name = name();
        let confirmed = window()
            .confirm_with_message(&format!(
                "Delete the venue \"{venue_name}\"? This cannot be undone."
            ))
            .unwrap_or(false);
        if !confirmed {
            return;
        }
        in_flight.set_value(true);
        deleting.set(true);
        error.set(None);
        let navigate = navigate.clone();
        let id = delete_id.clone();
        spawn_local(async move {
            let go = |kind, text: String| navigate("/locations", with_notice(kind, text));
            match auth.api().delete_location(&id).await {
                Ok(()) => go(NoticeKind::Success, format!("Deleted \"{venue_name}\".")),
                Err(e) => {
                    in_flight.set_value(false);
                    deleting.set(false);
                    if e.status() == Some(404) {
                        // Someone else deleted it first: the list page fetches fresh on arrival.
                        go(
                            NoticeKind::Info,
                            format!(
                                "\"{venue_name}\" no longer exists. The list has been refreshed."
                            ),
                        );
                    } else {
                        error.set(Some(as_api_error(e)));
                    }
                }
            }
        });
    };

    let events_table = move || {
        let Some((events, loaded_at)) = load.with(|l| match l {
            Load::Ok {
                events, loaded_at, ..
            } => Some((events.clone(), *loaded_at)),
            _ => None,
        }) else {
            return ().into_any();
        };
        if events.is_empty() {
            return view! { <p class="note">"Nothing is scheduled here."</p> }.into_any();
        }
        view! {
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>"Event"</th>
                            <th>"Starts"</th>
                            <th>"Ends"</th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.into_iter().map(|e| {
                            let zone = enum_text(&e.location.time_zone);
                            let ends = to_iso_string(e.ends_at);
                            let cancelled = enum_text(&e.status) == "CANCELLED";
                            view! {
                                <tr>
                                    <td class="cell-strong">
                                        <AppLink href=format!("/events/{}", e.id) class="rowlink">
                                            {e.name.to_string()}
                                        </AppLink>
                                        " "
                                        {cancelled.then(|| view! {
                                            <span class="pill pill--danger">"Cancelled"</span>
                                        })}
                                        " "
                                        // Spec 030 FR-011 (research R6): after Cancelled when both.
                                        {has_ended(&ends, loaded_at).then(|| view! {
                                            <span class="pill">"Ended"</span>
                                        })}
                                    </td>
                                    <td class="cell-time">
                                        {when(&to_iso_string(e.starts_at), Some(&zone))}
                                    </td>
                                    <td class="cell-time">{when(&ends, Some(&zone))}</td>
                                </tr>
                            }
                        }).collect_view()}
                    </tbody>
                </table>
            </div>
        }
        .into_any()
    };

    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">{name}</h1>
                    <p class="page-sub">
                        {move || venue().map(|v| view! { <AddressLink address=v.address.to_string()/> })}
                    </p>
                    // Spec 013 FR-017.
                    {move || {
                        venue()
                            .is_some_and(|v| !v.address_verified)
                            .then(|| view! {
                                <p class="note">"Address not verified. Edit the venue to verify it."</p>
                            })
                    }}
                    // Spec 020 FR-024 (research R14).
                    <p class="note">
                        {venue_text(|v| {
                            format!(
                                "Time zone: {}.",
                                venue_zone(
                                    Some(&enum_text(&v.time_zone)),
                                    Some(&enum_text(&v.time_zone_source)),
                                )
                            )
                        })}
                    </p>
                </div>
                <div class="form__actions">
                    <AppLink href=format!("/locations/{venue_id}/edit") class="btn">"Edit"</AppLink>
                    <button type="button" class="btn" on:click=remove disabled=move || deleting.get()>
                        {move || if deleting.get() { "Deleting…" } else { "Delete" }}
                    </button>
                </div>
            </div>

            {move || error.get().map(|e| view! { <ErrorBanner error=e title="Could not delete"/> })}

            <div class="card">
                <p>
                    "Seating capacity:"
                    " "
                    <span class="cell-num">
                        {move || {
                            let typed = venue().map_or(0, |v| v.seating_capacity.get());
                            to_locale_string(largest.get().unwrap_or(typed) as f64)
                        }}
                    </span>
                </p>
                {move || largest.get().map(|n| view! { <p class="note">{capacity_note(n)}</p> })}

                <h2>"Events here"</h2>
                <label class="choice">
                    <input
                        type="checkbox"
                        prop:checked=move || past.get()
                        on:change=move |ev| on_past(event_target_checked(&ev))
                    />
                    "Show past events"
                </label>
                // Spec 030 FR-009: said while the toggle is off, also when nothing is listed.
                {move || (!past.get()).then(|| view! { <p class="note">"Past events are hidden."</p> })}
                {events_table}
            </div>

            <LayoutsCard venue_id=venue_id.clone() on_layouts=layouts.write_only()/>
        </section>
    }
}
