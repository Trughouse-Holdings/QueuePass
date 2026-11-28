//! Parity E2–E8, E15, E16, M8–M11, SL7 (`admin-app/src/pages/EventForm.tsx`,
//! `DateTimeFields.tsx`): Schedule event (`/events/new`) and Edit event (`/events/:id/edit`). The
//! rules (which checks show, the zone line and time notes, the doors length and preview, what a
//! save sends, where a refusal goes, which control is focused) are
//! `core::forms::event::EventFormState`; this is the markup, element for element, and the
//! requests: the loads, the one save request, then the pictures in order.

use std::{future::Future, task::Poll, time::Duration};

use admin_rust_core::{
    api::{
        client::{ApiError, ops},
        types,
    },
    forms::{
        event::{
            Availability, CONFLICT_PREFIX, EventFormState, EventLoad, EventSeating, LIMIT_HINT,
            NAVIGATE_AFTER_MS, NO_ANSWER_TITLE, Occurrence, PAGE_SUB, SAVED_MESSAGE, Submit, Tier,
            TimeField, TimeNote, TypeField, Venue, first_placed_key,
        },
        images::{EventImage, delete_done},
        off_sale::{LayoutDetail, LayoutSummary},
    },
    seating::venue_map::PreviewLayout,
    time::DoorsMode,
};
use chrono::{DateTime, Utc};
use leptos::{ev::SubmitEvent, prelude::*, task::spawn_local};
use leptos_router::{
    NavigateOptions,
    hooks::{use_navigate, use_params_map},
};

use crate::{
    auth::{Auth, use_auth},
    components::{
        AppLink, ErrorBanner, SuccessState,
        event_form::{
            FormSignal, PendingHandOver, edit, edit_with, focus_later, hand_over, hint,
            take_hand_over,
        },
        images_field::{ImagesField, content_type_of, file_bytes},
        seating_section::{PreviewSignal, SeatingSection, load_sections},
    },
    util::now_ms,
};

/// The browser's clock, as an instant.
fn now_utc() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(now_ms()).unwrap_or_default()
}

/// Three futures run at once, their outputs in order, as `Promise.all`.
async fn join3<A: Future, B: Future, C: Future>(
    a: A,
    b: B,
    c: C,
) -> (A::Output, B::Output, C::Output) {
    let (mut a, mut b, mut c) = (Box::pin(a), Box::pin(b), Box::pin(c));
    let (mut ra, mut rb, mut rc) = (None, None, None);
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
        if rc.is_none()
            && let Poll::Ready(v) = c.as_mut().poll(cx)
        {
            rc = Some(v);
        }
        if ra.is_some()
            && rb.is_some()
            && rc.is_some()
            && let (Some(x), Some(y), Some(z)) = (ra.take(), rb.take(), rc.take())
        {
            return Poll::Ready((x, y, z));
        }
        Poll::Pending
    })
    .await
}

/// `/events/new` and `/events/:id/edit`.
#[component]
pub fn EventForm() -> impl IntoView {
    let params = use_params_map();
    let id = Memo::new(move |_| params.with(|p| p.get("id")));
    move || {
        let id = id.get();
        view! { <EventFormPage id=id/> }
    }
}

/// `aria-invalid` on a field's control while a message is under it.
fn invalid_memo(state: FormSignal, key: &'static str) -> Memo<bool> {
    Memo::new(move |_| state.with(|s| s.field_invalid(key)))
}

/// A required field with no valid value yet: its control is outlined in red at once, and the
/// shared theme puts "Required" beside its label.
fn needed_class(state: FormSignal, key: &'static str) -> impl Fn() -> Option<&'static str> + Copy {
    let needed = Memo::new(move |_| state.with(|s| s.needed(key)));
    move || needed.get().then_some("input--needed")
}

#[component]
fn EventFormPage(id: Option<String>) -> impl IntoView {
    let auth = use_auth();
    let navigate = use_navigate();
    let is_edit = id.is_some();
    let state: FormSignal = RwSignal::new_local(match &id {
        Some(id) => EventFormState::edit(id),
        None => EventFormState::new_event(now_utc()),
    });
    let preview: PreviewSignal = RwSignal::new(None);

    // The venues to choose from (a failure is an empty list).
    spawn_local(async move {
        let venues = auth
            .api()
            .send::<Vec<Venue>>(ops::list_locations(None))
            .await
            .unwrap_or_default();
        edit(state, |s| s.venues_loaded(venues));
    });

    // Spec 038 (FR-010): the venue's layouts; a failed read counts as none. An answer for a venue
    // no longer chosen is dropped.
    let location = Memo::new(move |_| state.with(|s| s.location_id.clone()));
    Effect::new(move |_| {
        let location_id = location.get();
        if location_id.is_empty() {
            return;
        }
        spawn_local(async move {
            let answer = auth
                .api()
                .send::<Vec<LayoutSummary>>(ops::list_venue_layouts(&location_id))
                .await;
            if state.try_with_untracked(|s| s.location_id == location_id) != Some(true) {
                return;
            }
            edit(state, |s| match answer {
                Ok(layouts) => s.layouts_loaded(layouts),
                Err(_) => s.layouts_failed(),
            });
        });
    });

    // The chosen layout's levels and sections, and its preview drawing.
    let layout_id = Memo::new(move |_| state.with(|s| s.seating.layout_id.clone()));
    Effect::new(move |_| {
        let Some(layout_id) = layout_id.get() else {
            return;
        };
        spawn_local(async move {
            let Ok(bytes) = auth.api().send_raw(ops::get_venue_layout(&layout_id)).await else {
                return;
            };
            if let Ok(full) = serde_json::from_slice::<types::LayoutDetail>(&bytes) {
                preview.set(Some((layout_id.clone(), PreviewLayout::from(&full))));
            }
            if let Ok(detail) = serde_json::from_slice::<LayoutDetail>(&bytes) {
                edit(state, |s| s.layout_loaded(detail));
            }
        });
    });

    // The sections the counts by level need, loaded as soon as they are named.
    let missing = Memo::new(move |_| {
        state.with(|s| {
            (
                s.seating.layout_id.clone(),
                s.counts().map(|c| c.missing).unwrap_or_default(),
            )
        })
    });
    Effect::new(move |_| {
        if missing.with(|(_, m)| m.is_empty()) {
            return;
        }
        if let Some(requests) = state.try_update(|s| s.sections_needed()) {
            load_sections(auth, state, requests);
        }
    });

    // Edit: the event; then its ticket types, seating, and sales together.
    if let Some(event_id) = id.clone() {
        let pending = take_hand_over(&format!("/events/{event_id}/edit"));
        let pending_files = pending
            .as_ref()
            .map(|p| p.files.clone())
            .unwrap_or_default();
        if let Some(handed) = pending {
            state.update(|s| {
                s.images_notice = Some(handed.notice);
                s.images.load(Vec::new(), handed.files);
            });
        }
        let load_id = event_id.clone();
        spawn_local(async move {
            match auth.api().send::<EventLoad>(ops::get_event(&load_id)).await {
                Ok(event) => {
                    let season_id = event.season.as_ref().map(|s| s.id.clone());
                    edit(state, |s| s.event_loaded(&event, pending_files));
                    // Spec 041 FR-019: whether the Season holds the venue and seating (not
                    // cancelled), read from the Season itself; a failed read keeps them locked.
                    if let Some(season_id) = season_id
                        && let Ok(season) = auth.api().get_season(&season_id).await
                    {
                        let cancelled = season.status == types::SeasonStatus::Cancelled;
                        edit(state, |s| s.season_status_loaded(&season_id, cancelled));
                    }
                }
                Err(e) => edit(state, |s| s.event_failed(e)),
            }
        });
        spawn_local(async move {
            let api = auth.api();
            let (tiers, seating, availability) = join3(
                api.send::<Vec<Tier>>(ops::list_tiers(&event_id)),
                api.send::<EventSeating>(ops::get_event_seating(&event_id)),
                api.send::<Availability>(ops::get_availability(&event_id)),
            )
            .await;
            match tiers {
                Ok(tiers) => edit(state, |s| {
                    s.tiers_loaded(&tiers, seating.ok().as_ref(), availability.ok().as_ref())
                }),
                // Without its ticket types the form saves the event's details alone.
                Err(_) => edit(state, |s| s.tiers_failed()),
            }
        });
    }

    // A refusal's first placed field is focused again when the number of ticket types changes,
    // as the React form's effect on `[error, types.length]` does.
    let types_len = Memo::new(move |_| state.with(|s| s.types.len()));
    Effect::new(move |seen: Option<()>| {
        types_len.track();
        if seen.is_some() {
            focus_later(state.with_untracked(|s| {
                s.error.as_ref()?;
                first_placed_key(&s.placed(), s.types.len(), &s.level_ids())
                    .map(|k| s.focus_target(&k))
            }));
        }
    });

    let submit = move |ev: SubmitEvent| {
        ev.prevent_default();
        let Some(request) = edit_with(state, |s| s.submit()) else {
            return;
        };
        match request {
            Submit::Invalid { focus } => focus_later(focus),
            Submit::Nothing => {}
            request => {
                let navigate = navigate.clone();
                spawn_local(save(auth, state, request, navigate));
            }
        }
    };

    let saved = Memo::new(move |_| state.with(|s| s.saved));
    let images_notice = Memo::new(move |_| state.with(|s| s.images_notice.clone()));
    let show_tickets = Memo::new(move |_| state.with(|s| s.show_tickets_and_seating()));
    let details_only_note = Memo::new(move |_| state.with(|s| s.details_only_note()));
    let details_only_total = Memo::new(move |_| state.with(|s| s.details_only_total_note()));
    let no_answer = Memo::new(move |_| state.with(|s| s.no_answer));
    let submit_error = Memo::new(move |_| state.with(|s| s.submit_error()));
    let busy = Memo::new(move |_| state.with(|s| s.busy));
    let limit_invalid = invalid_memo(state, "maxTicketsPerCustomer");
    let limit_needed = needed_class(state, "maxTicketsPerCustomer");

    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">{if is_edit { "Edit event" } else { "Schedule event" }}</h1>
                    <p class="page-sub">{PAGE_SUB}</p>
                </div>
            </div>

            {move || saved.get().then(|| view! { <SuccessState message=SAVED_MESSAGE/> })}
            {move || {
                images_notice
                    .get()
                    .map(|notice| {
                        view! {
                            <div role="status" class="banner">
                                <div class="banner__body">
                                    <p>{notice}</p>
                                </div>
                            </div>
                        }
                    })
            }}

            <div class="card">
                <form class="form" on:submit=submit>
                    <VenueAndTimes state/>

                    {move || show_tickets.get().then(|| view! { <TicketsAndSeating state preview/> })}
                    {move || details_only_note.get().map(|note| view! { <p class="note">{note}</p> })}
                    {move || details_only_total.get().map(|note| view! { <p class="note">{note}</p> })}

                    <fieldset class="field">
                        <legend>"Details"</legend>
                        <div class="field">
                            <label for="maxTicketsPerCustomer">"Tickets per customer"</label>
                            <input
                                id="maxTicketsPerCustomer"
                                type="number"
                                min="1"
                                step="1"
                                prop:value=move || state.with(|s| s.max_per_customer.clone())
                                on:blur=move |_| edit(state, |s| s.blur("maxTicketsPerCustomer"))
                                on:input=move |ev| {
                                    let value = event_target_value(&ev);
                                    edit(state, |s| s.set_limit(&value));
                                }
                                on:invalid=move |ev| {
                                    ev.prevent_default();
                                    edit(state, |s| s.limit_invalid());
                                }
                                class=limit_needed
                                aria-invalid=move || limit_invalid.get().then_some("true")
                                aria-describedby=move || {
                                    limit_invalid.get().then_some("maxTicketsPerCustomer-error")
                                }
                            />
                            <span class="field__hint">{LIMIT_HINT}</span>
                            {hint(
                                || "maxTicketsPerCustomer-error".into(),
                                move || state.with(|s| s.field_hint("maxTicketsPerCustomer")),
                            )}
                        </div>

                        <ImagesField state event_id=id.clone()/>
                    </fieldset>

                    {move || {
                        no_answer
                            .get()
                            .then(|| {
                                view! {
                                    <div role="alert" data-testid="no-answer" class="banner banner--error">
                                        <span class="banner__icon" aria-hidden="true">"✕"</span>
                                        <div class="banner__body">
                                            <strong>{NO_ANSWER_TITLE}</strong>
                                            <p>
                                                "No answer from QueuePass, so the event may or may not have been scheduled. Check the "
                                                <AppLink href="/events">"Events list"</AppLink>
                                                " before scheduling it again."
                                            </p>
                                        </div>
                                    </div>
                                }
                            })
                    }}
                    {move || {
                        submit_error
                            .get()
                            .map(|message| {
                                view! {
                                    <p class="field__hint" role="alert" data-testid="submit-error">
                                        {message}
                                    </p>
                                }
                            })
                    }}
                    <p
                        aria-live="polite"
                        data-testid="form-status"
                        style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);"
                    >
                        {move || state.with(|s| s.live.clone())}
                    </p>

                    <div class="form__actions">
                        <button type="submit" class="btn btn--primary" disabled=move || busy.get()>
                            {move || state.with(|s| s.submit_label())}
                        </button>
                        <AppLink href="/events" class="btn btn--ghost">"Cancel"</AppLink>
                    </div>
                </form>
            </div>
        </section>
    }
}

// ---------------------------------------------------------------- Venue and times (E2)

/// The fieldset "Venue and times": name, venue, doors open, Starts and Ends, the zone line, and
/// a times refusal with a conflict's detail.
#[component]
fn VenueAndTimes(state: FormSignal) -> impl IntoView {
    let name_invalid = invalid_memo(state, "name");
    let venue_invalid = invalid_memo(state, "locationId");
    let venue_options = Memo::new(move |_| state.with(|s| s.venue_options()));
    let location = move || state.with(|s| s.location_id.clone());
    let doors_mode = Memo::new(move |_| state.with(|s| s.doors_mode));
    let range = Memo::new(move |_| state.with(|s| s.doors_range_note()));
    let range_alert = Memo::new(move |_| state.with(|s| s.doors_range_alert()));
    let times_error: Memo<Option<ApiError>> =
        Memo::new(move |_| state.with(|s| s.times_refusal().then(|| s.error.clone()).flatten()));
    let conflict = Memo::new(move |_| state.with(|s| s.conflict_parts()));
    // Spec 041 FR-007, FR-019: the Season the event is in, and why the venue can't change.
    let in_season = Memo::new(move |_| {
        state.with(|s| s.season.as_ref().map(|x| (x.id.clone(), x.name.clone())))
    });
    let season_lock = Memo::new(move |_| state.with(|s| s.season_lock().map(str::to_string)));

    view! {
        <fieldset class="field">
            <legend>"Venue and times"</legend>
            {move || {
                in_season
                    .get()
                    .map(|(id, name)| {
                        view! {
                            <p class="note" data-testid="in-season">
                                "In season: "
                                <AppLink href=format!("/seasons/{id}")>{name}</AppLink>
                            </p>
                        }
                    })
            }}
            <div class="field">
                <label for="name">"Event name"</label>
                <input
                    id="name"
                    prop:value=move || state.with(|s| s.name.clone())
                    placeholder="Season Opener"
                    on:blur=move |_| edit(state, |s| s.blur("name"))
                    on:input=move |ev| {
                        let value = event_target_value(&ev);
                        edit(state, |s| s.set_name(&value));
                    }
                    class=needed_class(state, "name")
                    aria-invalid=move || name_invalid.get().then_some("true")
                    aria-describedby=move || name_invalid.get().then_some("name-error")
                />
                {hint(|| "name-error".into(), move || state.with(|s| s.field_hint("name")))}
            </div>

            <div class="field">
                <label for="locationId">"Venue"</label>
                <select
                    id="locationId"
                    prop:value=location
                    disabled=move || season_lock.get().is_some()
                    on:blur=move |_| edit(state, |s| s.blur("locationId"))
                    on:change=move |ev| {
                        let value = event_target_value(&ev);
                        edit(state, |s| s.choose_venue(&value, now_utc()));
                    }
                    class=needed_class(state, "locationId")
                    aria-invalid=move || venue_invalid.get().then_some("true")
                    aria-describedby=move || venue_invalid.get().then_some("locationId-error")
                >
                    <option value="" prop:selected=move || location().is_empty()>
                        "Select a venue…"
                    </option>
                    {move || {
                        venue_options
                            .get()
                            .into_iter()
                            .map(|(value, label)| {
                                let v = value.clone();
                                view! {
                                    <option value=value prop:selected=move || location() == v>
                                        {label}
                                    </option>
                                }
                            })
                            .collect_view()
                    }}
                </select>
                {move || season_lock.get().map(|reason| view! { <span class="field__hint">{reason}</span> })}
                {hint(|| "locationId-error".into(), move || state.with(|s| s.field_hint("locationId")))}
            </div>

            <fieldset class="field">
                <legend>"Doors open"</legend>
                <label class="choice">
                    <input
                        type="radio"
                        name="doors-open-mode"
                        prop:checked=move || doors_mode.get() == DoorsMode::Before
                        on:change=move |_| edit(state, |s| s.switch_doors_mode(DoorsMode::Before))
                    />
                    "Before the start"
                </label>
                <label class="choice">
                    <input
                        type="radio"
                        name="doors-open-mode"
                        prop:checked=move || doors_mode.get() == DoorsMode::AtTime
                        on:change=move |_| edit(state, |s| s.switch_doors_mode(DoorsMode::AtTime))
                    />
                    "At a set time"
                </label>
                {move || match doors_mode.get() {
                    DoorsMode::Before => view! { <DoorsBefore state/> }.into_any(),
                    DoorsMode::AtTime => {
                        view! { <DateTimeFields state field=TimeField::DoorsOpenAt name="Doors open"/> }
                            .into_any()
                    }
                }}
                {time_note(state, TimeField::DoorsOpenAt)}
                {move || {
                    range
                        .get()
                        .map(|message| {
                            view! {
                                <span
                                    class="field__hint"
                                    data-testid="doorsOpenAt-range"
                                    role=move || range_alert.get().then_some("alert")
                                >
                                    {message}
                                </span>
                            }
                        })
                }}
                {hint(
                    || "doorsOpenAt-error".into(),
                    move || state.with(|s| s.time_field_hint(TimeField::DoorsOpenAt)),
                )}
            </fieldset>
            <div class="field-row">
                <div class="field">
                    <DateTimeFields state field=TimeField::StartsAt name="Starts"/>
                    {time_note(state, TimeField::StartsAt)}
                    {hint(
                        || "startsAt-error".into(),
                        move || state.with(|s| s.time_field_hint(TimeField::StartsAt)),
                    )}
                </div>
                <div class="field">
                    <DateTimeFields state field=TimeField::EndsAt name="Ends"/>
                    {time_note(state, TimeField::EndsAt)}
                    {hint(
                        || "endsAt-error".into(),
                        move || state.with(|s| s.time_field_hint(TimeField::EndsAt)),
                    )}
                </div>
            </div>
            <p class="note" data-testid="zone-line">
                {move || state.with(|s| s.zone_line(now_utc()))}
            </p>
            {move || times_error.get().map(|error| view! { <ErrorBanner error/> })}
            {move || {
                conflict
                    .get()
                    .map(|(name, rest)| {
                        view! {
                            <p data-testid="conflict-detail" class="conflict-detail">
                                {CONFLICT_PREFIX}
                                <strong>{name}</strong>
                                {rest}
                            </p>
                        }
                    })
            }}
        </fieldset>
    }
}

/// "Before the start": the length select and the live preview.
#[component]
fn DoorsBefore(state: FormSignal) -> impl IntoView {
    let invalid = invalid_memo(state, "doorsOpenAt");
    let value = move || {
        state.with(|s| {
            s.doors_offset_minutes
                .map(|m| m.to_string())
                .unwrap_or_default()
        })
    };
    let choices = Memo::new(move |_| state.with(|s| s.doors_offset_choices()));
    let line = Memo::new(move |_| state.with(|s| s.doors_preview()));
    view! {
        <div class="field">
            <label for="doorsOpenOffset">"How long before the start"</label>
            <select
                id="doorsOpenOffset"
                prop:value=value
                on:blur=move |_| edit(state, |s| s.blur("doorsOpenAt"))
                on:change=move |ev| {
                    if let Ok(minutes) = event_target_value(&ev).parse::<i64>() {
                        edit(state, |s| s.set_doors_offset(minutes));
                    }
                }
                class=needed_class(state, "doorsOpenAt")
                aria-invalid=move || invalid.get().then_some("true")
                aria-describedby=move || {
                    if invalid.get() { "doorsOpenAt-error doorsOpenAt-live" } else { "doorsOpenAt-live" }
                }
            >
                {move || {
                    choices
                        .get()
                        .into_iter()
                        .map(|(minutes, label)| match minutes {
                            None => {
                                view! {
                                    <option value="" disabled=true prop:selected=true>
                                        {label}
                                    </option>
                                }
                                    .into_any()
                            }
                            Some(m) => {
                                let v = m.to_string();
                                let selected = v.clone();
                                view! {
                                    <option value=v prop:selected=move || value() == selected>
                                        {label}
                                    </option>
                                }
                                    .into_any()
                            }
                        })
                        .collect_view()
                }}
            </select>
        </div>
        // FR-016: mounted from the first render so the first value is announced.
        <p class="note" id="doorsOpenAt-live" aria-live="polite">
            {move || {
                line.get().map(|text| view! { <span data-testid="doorsOpenAt-preview">{text}</span> })
            }}
        </p>
    }
}

/// `DateTimeFields`: a date control and a time control side by side, joined into one
/// venue-local value; each half is kept, so filling the date and then the time keeps both.
#[component]
fn DateTimeFields(state: FormSignal, field: TimeField, name: &'static str) -> impl IntoView {
    let key = field.key();
    let invalid = invalid_memo(state, key);
    let needed = needed_class(state, key);
    let date_id = format!("{key}-date");
    let time_id = format!("{key}-time");
    view! {
        <div class="field-row">
            <div class="field">
                <label for=date_id.clone()>{format!("{name} date")}</label>
                <input
                    id=date_id
                    type="date"
                    prop:value=move || state.with(|s| s.time(field).date.clone())
                    on:blur=move |_| edit(state, |s| s.blur(key))
                    on:input=move |ev| {
                        let value = event_target_value(&ev);
                        edit(state, |s| s.set_date(field, &value));
                    }
                    class=needed
                    aria-invalid=move || invalid.get().then_some("true")
                    aria-describedby=move || invalid.get().then(|| format!("{key}-error"))
                />
            </div>
            <div class="field">
                <label for=time_id.clone()>{format!("{name} time")}</label>
                <input
                    id=time_id
                    type="time"
                    step="60"
                    prop:value=move || state.with(|s| s.time(field).time.clone())
                    on:blur=move |_| edit(state, |s| s.blur(key))
                    on:input=move |ev| {
                        let value = event_target_value(&ev);
                        edit(state, |s| s.set_time(field, &value));
                    }
                    class=needed
                    aria-invalid=move || invalid.get().then_some("true")
                    aria-describedby=move || invalid.get().then(|| format!("{key}-error"))
                />
            </div>
        </div>
    }
}

/// A time note's look, without which of a repeated time is chosen (that is the radios' state).
#[derive(Clone, Debug, PartialEq, Eq)]
enum NoteShape {
    Skipped(String),
    Repeated {
        legend: String,
        first: String,
        second: String,
    },
}

/// `timeNote`: under a time field, a skipped time's message, or "Which 1:30 AM?" and its two
/// choices.
fn time_note(state: FormSignal, field: TimeField) -> impl IntoView {
    let key = field.key();
    let shape = Memo::new(move |_| {
        state.with(|s| {
            s.time_note(field).map(|note| match note {
                TimeNote::Skipped(message) => NoteShape::Skipped(message),
                TimeNote::Repeated {
                    legend,
                    first,
                    second,
                    ..
                } => NoteShape::Repeated {
                    legend,
                    first,
                    second,
                },
            })
        })
    });
    let chosen = move || state.with(|s| s.occurrence.get(field));
    move || {
        shape.get().map(|note| match note {
            NoteShape::Skipped(message) => view! {
                <span class="field__hint" data-testid=format!("{key}-skipped")>{message}</span>
            }
            .into_any(),
            NoteShape::Repeated {
                legend,
                first,
                second,
            } => view! {
                <fieldset class="field" data-testid=format!("{key}-occurrence")>
                    <legend>{legend}</legend>
                    <label class="choice">
                        <input
                            type="radio"
                            name=format!("{key}-occurrence")
                            prop:checked=move || chosen() == Occurrence::First
                            on:change=move |_| {
                                edit(state, |s| s.choose_occurrence(field, Occurrence::First))
                            }
                        />
                        {first}
                    </label>
                    <label class="choice">
                        <input
                            type="radio"
                            name=format!("{key}-occurrence")
                            prop:checked=move || chosen() == Occurrence::Second
                            on:change=move |_| {
                                edit(state, |s| s.choose_occurrence(field, Occurrence::Second))
                            }
                        />
                        {second}
                    </label>
                </fieldset>
            }
            .into_any(),
        })
    }
}

// ---------------------------------------------------------------- Tickets and seating (E15, M8)

/// The fieldset "Tickets and seating", once a venue is chosen and the types and its layouts have
/// loaded.
#[component]
fn TicketsAndSeating(state: FormSignal, preview: PreviewSignal) -> impl IntoView {
    let described = Memo::new(move |_| state.with(|s| !s.placed().seating.is_empty()));
    let show_select = Memo::new(move |_| state.with(|s| s.show_seating_select()));
    let seated = Memo::new(move |_| state.with(|s| s.seated()));
    view! {
        <fieldset
            class="field"
            id="tickets-and-seating"
            aria-describedby=move || described.get().then_some("seating-error")
        >
            <legend>"Tickets and seating"</legend>
            {hint(|| "seating-error".into(), move || state.with(|s| s.seating_hint()))}
            {move || show_select.get().then(|| view! { <SeatingSection state preview/> })}
            {move || {
                if seated.get() {
                    view! {
                        <p class="note">
                            {move || state.with(|s| s.seated_total_note()).unwrap_or_default()}
                        </p>
                    }
                        .into_any()
                } else {
                    view! { <GeneralAdmission state/> }.into_any()
                }
            }}
        </fieldset>
    }
}

/// General admission: the ticket type lines, "Add ticket type", the seat line, Total tickets.
#[component]
fn GeneralAdmission(state: FormSignal) -> impl IntoView {
    let count = Memo::new(move |_| state.with(|s| s.types.len()));
    let total_invalid = invalid_memo(state, "totalTicketCapacity");
    view! {
        <For each=move || 0..count.get() key=|i| *i children=move |i| type_line(state, i)/>
        <div>
            <button type="button" class="btn" on:click=move |_| edit(state, |s| s.add_type())>
                "Add ticket type"
            </button>
        </div>
        {hint(|| "tiers-error".into(), move || state.with(|s| s.tiers_hint()))}
        <p class="note" data-testid="seat-total">{move || state.with(|s| s.seat_total_line())}</p>
        <div class="field">
            <label for="totalTicketCapacity">"Total tickets"</label>
            <input
                id="totalTicketCapacity"
                type="number"
                min="1"
                prop:value=move || state.with(|s| s.total_ticket_capacity.clone())
                placeholder=move || state.with(|s| s.total_placeholder())
                on:blur=move |_| edit(state, |s| s.blur("totalTicketCapacity"))
                on:input=move |ev| {
                    let value = event_target_value(&ev);
                    edit(state, |s| s.set_total(&value));
                }
                class=needed_class(state, "totalTicketCapacity")
                aria-invalid=move || total_invalid.get().then_some("true")
                aria-describedby=move || total_invalid.get().then_some("totalTicketCapacity-error")
            />
            <span class="field__hint">{move || state.with(|s| s.total_hint())}</span>
            {hint(
                || "totalTicketCapacity-error".into(),
                move || state.with(|s| s.field_hint("totalTicketCapacity")),
            )}
        </div>
    }
}

/// One ticket type's input.
fn type_input(
    state: FormSignal,
    index: usize,
    field: TypeField,
    placeholder: &'static str,
) -> impl IntoView {
    let n = index + 1;
    let what = field.key();
    let invalid = Memo::new(move |_| state.with(|s| s.type_invalid(index, field)));
    let needed = Memo::new(move |_| state.with(|s| s.needed(&format!("tiers.{index}.{what}"))));
    let (input_mode, kind, min) = match field {
        TypeField::Name => (None, None, None),
        TypeField::Price => (Some("decimal"), None, None),
        TypeField::Quantity => (None, Some("number"), Some("1")),
    };
    view! {
        <input
            aria-label=format!("Ticket type {n} {what}")
            inputmode=input_mode
            type=kind
            min=min
            placeholder=placeholder
            prop:value=move || {
                state.with(|s| {
                    s.types
                        .get(index)
                        .map(|t| match field {
                            TypeField::Name => t.name.clone(),
                            TypeField::Price => t.price.clone(),
                            TypeField::Quantity => t.quantity.clone(),
                        })
                        .unwrap_or_default()
                })
            }
            on:input=move |ev| {
                let value = event_target_value(&ev);
                edit(state, |s| s.set_type(index, field, &value));
            }
            id=format!("type-{n}-{what}")
            class=move || needed.get().then_some("input--needed")
            aria-invalid=move || invalid.get().then_some("true")
            aria-describedby=move || invalid.get().then(|| format!("type-{n}-error"))
            on:blur=move |_| edit(state, |s| s.blur(&format!("tiers.{index}.{what}")))
        />
    }
}

/// A ticket type's line: name, price, quantity, and "Remove ticket type N"; its sold hint and its
/// messages.
fn type_line(state: FormSignal, index: usize) -> impl IntoView {
    let n = index + 1;
    let show_remove = Memo::new(move |_| state.with(|s| s.show_remove_type()));
    let lock = Memo::new(move |_| state.with(|s| s.remove_type_title(index)));
    let sold = Memo::new(move |_| state.with(|s| s.type_sold_hint(index)));
    let required = Memo::new(move |_| state.with(|s| s.type_required(index)));
    view! {
        <div class="form__row">
            {type_input(state, index, TypeField::Name, "Floor")}
            {type_input(state, index, TypeField::Price, "80.00")}
            {type_input(state, index, TypeField::Quantity, "100")}
            {move || {
                show_remove
                    .get()
                    .then(|| {
                        view! {
                            <button
                                type="button"
                                class="btn"
                                on:click=move |_| edit(state, |s| s.remove_type(index))
                                disabled=move || lock.get().is_some()
                                title=move || lock.get()
                            >
                                "Remove ticket type "
                                {n}
                            </button>
                        }
                    })
            }}
        </div>
        {move || {
            required
                .get()
                .map(|text| {
                    view! {
                        <span
                            class="required-tag"
                            aria-hidden="true"
                            data-testid=format!("type-{n}-required")
                        >
                            {text}
                        </span>
                    }
                })
        }}
        {move || sold.get().map(|text| view! { <span class="field__hint">{text}</span> })}
        {hint(move || format!("type-{n}-error"), move || state.with(|s| s.type_hint(index)))}
    }
}

// ---------------------------------------------------------------- saving (E5–E7, E16, M11)

/// Why the picture steps stopped.
enum ImageStep {
    /// An upload was refused (`refusal`), or could not be sent (`None`).
    Upload {
        key: String,
        file: String,
        refusal: Option<ApiError>,
    },
    /// A delete or the reorder was refused.
    Refused(ApiError),
}

/// `applyImages`: delete each removed image (404 is fine), upload each new picture in list order,
/// then send the order if it differs from the Backend's; each step updates the form as it
/// succeeds, so saving again finishes what is left.
async fn apply_images(auth: Auth, state: FormSignal, event_id: &str) -> Result<(), ImageStep> {
    let api = auth.api();
    let to_delete = state
        .try_with_untracked(|s| s.images.to_delete())
        .unwrap_or_default();
    for image in to_delete {
        match api
            .send_empty(ops::delete_event_image(event_id, &image.id))
            .await
        {
            Ok(()) => {}
            Err(e) if delete_done(&e) => {}
            Err(e) => return Err(ImageStep::Refused(e)),
        }
        edit(state, |s| s.images.deleted(&image.id));
    }

    while let Some((key, file)) = state
        .try_with_untracked(|s| s.images.next_upload())
        .flatten()
    {
        let name = file.0.name();
        let Some(bytes) = file_bytes(&file.0).await else {
            return Err(ImageStep::Upload {
                key,
                file: name,
                refusal: None,
            });
        };
        let call = ops::upload_event_image(event_id, &name, &content_type_of(&file.0), bytes);
        match api.send::<EventImage>(call).await {
            Ok(image) => {
                if state
                    .try_update(|s| s.images.uploaded(&key, image))
                    .is_none()
                {
                    return Ok(());
                }
            }
            Err(e) => {
                let refusal = (!matches!(e, ApiError::Unreachable)).then_some(e);
                return Err(ImageStep::Upload {
                    key,
                    file: name,
                    refusal,
                });
            }
        }
    }

    let ids = state
        .try_with_untracked(|s| {
            s.images
                .order_ids()
                .filter(|ids| s.images.needs_reorder(ids))
        })
        .flatten();
    if let Some(ids) = ids {
        match api
            .send::<Vec<EventImage>>(ops::reorder_event_images(event_id, &ids))
            .await
        {
            Ok(ordered) => edit(state, |s| s.images.reordered(ordered)),
            Err(e) => return Err(ImageStep::Refused(e)),
        }
    }
    Ok(())
}

/// `reloadImages`: after `IMAGES_CHANGED`, the event's current images, with the pictures not yet
/// added after them.
async fn reload_if_changed(auth: Auth, state: FormSignal, event_id: &str) {
    if state.try_with_untracked(|s| s.images_changed()) != Some(true) {
        return;
    }
    if let Ok(event) = auth.api().send::<EventLoad>(ops::get_event(event_id)).await {
        edit(state, |s| s.images.reload(event.images.unwrap_or_default()));
    }
}

/// `handleSubmit` after the checks: the one request (create or update, saved all or nothing),
/// then the pictures, then "Event saved." and the event's page 700 ms later.
async fn save<N>(auth: Auth, state: FormSignal, request: Submit, navigate: N)
where
    N: Fn(&str, NavigateOptions) + Clone + 'static,
{
    let api = auth.api();
    let (event_id, created) = match request {
        Submit::Create(body) => {
            match api
                .send::<serde_json::Value>(ops::create_event(&body))
                .await
            {
                Ok(event) => {
                    let id = event
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    edit(state, |s| s.created(&id));
                    (id, true)
                }
                Err(e) => {
                    // No answer: the no-answer banner, every value kept. A refusal: placed.
                    focus_later(edit_with(state, |s| s.create_failed(e)).flatten());
                    return;
                }
            }
        }
        Submit::Update { event_id, body } => {
            match api.send_empty(ops::update_event(&event_id, &body)).await {
                Ok(()) => {
                    edit(state, |s| s.updated());
                    (event_id, false)
                }
                Err(e) => {
                    focus_later(edit_with(state, |s| s.save_failed(e)).flatten());
                    return;
                }
            }
        }
        Submit::Invalid { .. } | Submit::Nothing => return,
    };

    match apply_images(auth, state, &event_id).await {
        Ok(()) => {
            edit(state, |s| s.finished());
            let to = format!("/events/{event_id}");
            set_timeout(
                move || navigate(&to, NavigateOptions::default()),
                Duration::from_millis(NAVIGATE_AFTER_MS.into()),
            );
        }
        Err(ImageStep::Upload { key, refusal, .. }) if created => {
            // Spec 014 FR-018: the event is saved; the form becomes its edit form with the
            // pictures not yet added, so saving again changes only this event.
            let Some(pending) =
                state.try_update(|s| s.image_failed_on_create(&key, refusal.as_ref()))
            else {
                return;
            };
            let path = pending.path.clone();
            hand_over(PendingHandOver {
                path: pending.path,
                files: pending.files,
                notice: pending.notice,
            });
            navigate(
                &path,
                NavigateOptions {
                    replace: true,
                    ..NavigateOptions::default()
                },
            );
        }
        Err(ImageStep::Upload { file, refusal, .. }) => {
            focus_later(
                edit_with(state, |s| s.image_failed_on_edit(&file, refusal.as_ref())).flatten(),
            );
            reload_if_changed(auth, state, &event_id).await;
        }
        Err(ImageStep::Refused(e)) => {
            focus_later(edit_with(state, |s| s.save_failed(e)).flatten());
            reload_if_changed(auth, state, &event_id).await;
        }
    }
}
