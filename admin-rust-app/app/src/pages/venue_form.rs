//! Parity V2, V3, V4, V8, V9, V10, M7 (`admin-app/src/pages/LocationForm.tsx`): New venue and
//! Edit venue. The rules (which hints show, what a save sends, the notices) are
//! `core::forms::venue::VenueFormState`; this is the markup, element for element, and the calls.

use admin_rust_core::{
    api::{
        client::{ApiError, EventFilters},
        types::Location,
    },
    forms::{
        layouts::{as_api_error, capacity_note},
        section_lines::total_text,
        venue::{
            CAPACITY_HINT, CapacityField, LAYOUT_REFUSED_LINK, LAYOUT_REFUSED_TEXT,
            LAYOUT_REFUSED_TITLE, LayoutRefused, NoticeKind as SavedKind, PROBLEMS_TITLE, SUBTITLE,
            SaveRequest, SeatingKind, VenueFormState, ZoneHint, saved_notice, state_options,
        },
    },
};
use leptos::{ev::SubmitEvent, prelude::*, task::spawn_local};
use leptos_router::hooks::{use_navigate, use_params_map};

use crate::{
    auth::use_auth,
    components::{
        AppLink, ErrorBanner, NoticeKind,
        banners::with_notice,
        section_lines::{LinesEdit, SectionLines},
    },
};

/// What stands where Seating capacity goes, without the total (which changes as lines are typed,
/// and must not rebuild the lines).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Capacity {
    Lines,
    FromLayouts(u64),
    Typed,
}

/// `/locations/new` and `/locations/:id/edit`.
#[component]
pub fn VenueForm() -> impl IntoView {
    let params = use_params_map();
    let id = Memo::new(move |_| params.with(|p| p.get("id")));
    move || {
        let id = id.get();
        view! { <VenueFormPage id=id/> }
    }
}

#[component]
fn VenueFormPage(id: Option<String>) -> impl IntoView {
    let auth = use_auth();
    let navigate = use_navigate();
    let is_edit = id.is_some();
    let state = RwSignal::new(match &id {
        Some(id) => VenueFormState::edit(id),
        None => VenueFormState::new_venue(),
    });

    if let Some(id) = id {
        let venue_id = id.clone();
        spawn_local(async move {
            match auth.api().get_location(&venue_id).await {
                Ok(l) => state.update(|s| s.on_loaded(l)),
                Err(e) => state.update(|s| s.on_load_failed(as_api_error(e))),
            }
        });
        let venue_id = id.clone();
        spawn_local(async move {
            match auth.api().list_venue_layouts(&venue_id).await {
                Ok(layouts) => state.update(|s| s.on_layouts(&layouts)),
                Err(_) => state.update(VenueFormState::on_layouts_failed),
            }
        });
        // Spec 030 FR-010: changing the zone moves past events' times too, so they count.
        spawn_local(async move {
            let filters = EventFilters {
                location_id: Some(id),
                include_past: true,
                ..EventFilters::default()
            };
            let has_events = auth
                .api()
                .list_events(&filters)
                .await
                .ok()
                .map(|events| !events.is_empty());
            state.update(|s| s.set_has_events(has_events));
        });
    }

    let problems = Memo::new(move |_| state.with(|s| s.problems.clone()));
    let error: Memo<Option<ApiError>> = Memo::new(move |_| state.with(|s| s.error.clone()));
    let layout_refused: Memo<Option<LayoutRefused>> =
        Memo::new(move |_| state.with(|s| s.layout_refused.clone()));
    let address_note = Memo::new(move |_| state.with(VenueFormState::address_note));
    let zone_hints: Memo<Vec<ZoneHint>> = Memo::new(move |_| state.with(|s| s.zone_hints()));
    let busy = Memo::new(move |_| state.with(|s| s.busy));
    let kind = Memo::new(move |_| state.with(|s| s.kind));
    let capacity = Memo::new(move |_| {
        state.with(|s| match s.capacity_field() {
            CapacityField::Lines { .. } => Capacity::Lines,
            CapacityField::FromLayouts { value, .. } => Capacity::FromLayouts(value),
            CapacityField::Typed => Capacity::Typed,
        })
    });

    let submit = move |ev: SubmitEvent| {
        ev.prevent_default();
        let Some(request) = state.try_update(VenueFormState::save).flatten() else {
            return;
        };
        let navigate = navigate.clone();
        let done = move |venue: Location| {
            let notice = state
                .try_update(|s| s.on_saved(&venue))
                .unwrap_or_else(|| saved_notice(&venue));
            let kind = match notice.kind {
                SavedKind::Success => NoticeKind::Success,
                SavedKind::Info => NoticeKind::Info,
            };
            navigate("/locations", with_notice(kind, notice.text));
        };
        spawn_local(async move {
            let api = auth.api();
            match request {
                SaveRequest::Update { id, body } => match api.update_location(&id, &body).await {
                    Ok(venue) => done(venue),
                    Err(e) => state.update(|s| s.on_refused(as_api_error(e))),
                },
                SaveRequest::Create { body, layout } => match api.create_location(&body).await {
                    Ok(venue) => {
                        if let Some(layout) = layout {
                            let made = api
                                .create_venue_layout(&venue.id.to_string(), &layout)
                                .await;
                            if let Err(e) = made {
                                // The venue exists; only its layout was refused.
                                state.update(|s| s.on_layout_refused(&venue, as_api_error(e)));
                                return;
                            }
                        }
                        done(venue);
                    }
                    Err(e) => state.update(|s| s.on_refused(as_api_error(e))),
                },
            }
        });
    };

    let text_field = move |id: &'static str,
                           label: &'static str,
                           placeholder: &'static str,
                           autocomplete: Option<&'static str>,
                           numeric: bool,
                           get: fn(&VenueFormState) -> String,
                           set: fn(&mut VenueFormState, String)| {
        view! {
            <div class="field">
                <label for=id>{label}</label>
                <input
                    id=id
                    inputmode=numeric.then_some("numeric")
                    autocomplete=autocomplete
                    prop:value=move || state.with(get)
                    placeholder=placeholder
                    on:input=move |ev| {
                        let value = event_target_value(&ev);
                        state.update(|s| set(s, value));
                    }
                />
            </div>
        }
    };

    let state_choice = move || state.with(|s| s.address.state.clone());
    let zone_choice = move || state.with(|s| s.zone_choice.clone());
    let zone_options = state.with_untracked(VenueFormState::zone_options);

    let seating = Signal::derive(move || state.with(|s| s.seating.clone()));
    let on_lines =
        Callback::new(move |edit: LinesEdit| state.update(|s| edit.apply(&mut s.seating)));

    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">{if is_edit { "Edit venue" } else { "New venue" }}</h1>
                    <p class="page-sub">{SUBTITLE}</p>
                </div>
            </div>

            {move || {
                let found = problems.get();
                (!found.is_empty()).then(|| view! {
                    <div role="alert" class="banner banner--error">
                        <span class="banner__icon" aria-hidden="true">"✕"</span>
                        <div class="banner__body">
                            <strong>{PROBLEMS_TITLE}</strong>
                            <ul>{found.into_iter().map(|p| view! { <li>{p}</li> }).collect_view()}</ul>
                        </div>
                    </div>
                })
            }}
            {move || error.get().map(|e| view! { <ErrorBanner error=e/> })}
            {move || layout_refused.get().map(|r| view! {
                <div role="alert" class="banner banner--error">
                    <div class="banner__body">
                        <strong>{LAYOUT_REFUSED_TITLE}</strong>
                        <p>{r.message}</p>
                        <p>
                            {LAYOUT_REFUSED_TEXT}
                            " "
                            <AppLink href=r.href>{LAYOUT_REFUSED_LINK}</AppLink>
                        </p>
                        {r.not_verified.map(|t| view! { <p>{t}</p> })}
                    </div>
                </div>
            })}

            <div class="card">
                <form class="form" on:submit=submit>
                    {text_field("name", "Name", "KFC Yum! Center", None, false,
                        |s| s.name.clone(), |s, v| s.name = v)}

                    {move || address_note.get().map(|note| view! { <p class="note">{note}</p> })}

                    {text_field("street", "Street address", "430 W Vine St", Some("address-line1"), false,
                        |s| s.address.street.clone(), |s, v| s.address.street = v)}
                    {text_field("city", "City", "Lexington", Some("address-level2"), false,
                        |s| s.address.city.clone(), |s, v| s.address.city = v)}

                    <div class="field">
                        <label for="state">"State"</label>
                        <select
                            id="state"
                            autocomplete="address-level1"
                            prop:value=state_choice
                            on:change=move |ev| {
                                let value = event_target_value(&ev);
                                state.update(|s| s.address.state = value);
                            }
                        >
                            {state_options().into_iter().map(|o| {
                                let v = o.value.clone();
                                view! {
                                    <option value=o.value prop:selected=move || state_choice() == v>
                                        {o.label}
                                    </option>
                                }
                            }).collect_view()}
                        </select>
                    </div>

                    {text_field("zip", "ZIP code", "40507", Some("postal-code"), true,
                        |s| s.address.zip.clone(), |s, v| s.address.zip = v)}

                    // Spec 024 FR-001 to FR-004 (research R1): the admin's pick, required on create.
                    <div class="field">
                        <label for="timeZone">"Time zone"</label>
                        <select
                            id="timeZone"
                            prop:value=zone_choice
                            aria-invalid=move || state.with(|s| s.zone_invalid()).then_some("true")
                            aria-describedby=move || state.with(|s| s.zone_described_by())
                            on:change=move |ev| {
                                let value = event_target_value(&ev);
                                state.update(|s| s.choose_zone(&value));
                            }
                        >
                            {zone_options.into_iter().map(|o| {
                                let v = o.value.clone();
                                view! {
                                    <option value=o.value prop:selected=move || zone_choice() == v>
                                        {o.label}
                                    </option>
                                }
                            }).collect_view()}
                        </select>
                        <For
                            each=move || zone_hints.get()
                            key=|h| (h.id, h.text.clone())
                            children=|h| view! {
                                <span id=h.id class="field__hint" role=h.alert.then_some("alert")>
                                    {h.text}
                                </span>
                            }
                        />
                    </div>

                    {(!is_edit).then(|| view! {
                        <fieldset class="field">
                            <legend>"Seating"</legend>
                            <label class="choice">
                                <input
                                    type="radio"
                                    name="kind"
                                    prop:checked=move || kind.get() == SeatingKind::General
                                    on:change=move |_| state.update(|s| s.kind = SeatingKind::General)
                                />
                                "General admission"
                            </label>
                            <label class="choice">
                                <input
                                    type="radio"
                                    name="kind"
                                    prop:checked=move || kind.get() == SeatingKind::Seated
                                    on:change=move |_| state.update(|s| s.kind = SeatingKind::Seated)
                                />
                                "Seated"
                            </label>
                        </fieldset>
                    })}

                    {move || match capacity.get() {
                        Capacity::Lines => view! {
                            <SectionLines draft=seating on_edit=on_lines/>
                            <p class="note">
                                {move || total_text(state.with(|s| s.seating.total_seats()))}
                            </p>
                        }
                        .into_any(),
                        // Spec 038 FR-009: read-only, never sent; the largest layout sets it.
                        Capacity::FromLayouts(largest) => view! {
                            <div class="field">
                                <label for="seatingCapacity">"Seating capacity"</label>
                                <input
                                    id="seatingCapacity"
                                    type="number"
                                    readonly=true
                                    prop:value=largest.to_string()
                                    aria-describedby="seatingCapacity-hint"
                                />
                                <span id="seatingCapacity-hint" class="field__hint">
                                    {capacity_note(largest)}
                                </span>
                            </div>
                        }
                        .into_any(),
                        Capacity::Typed => view! {
                            <div class="field">
                                <label for="seatingCapacity">"Seating capacity"</label>
                                <input
                                    id="seatingCapacity"
                                    type="number"
                                    min="1"
                                    prop:value=move || state.with(|s| s.seating_capacity.clone())
                                    placeholder="22090"
                                    on:input=move |ev| {
                                        let value = event_target_value(&ev);
                                        state.update(|s| s.seating_capacity = value);
                                    }
                                />
                                <span class="field__hint">{CAPACITY_HINT}</span>
                            </div>
                        }
                        .into_any(),
                    }}

                    <div class="form__actions">
                        <button type="submit" class="btn btn--primary" disabled=move || busy.get()>
                            {move || state.with(|s| s.submit_label())}
                        </button>
                        <AppLink href="/locations" class="btn btn--ghost">"Cancel"</AppLink>
                    </div>
                </form>
            </div>
        </section>
    }
}
