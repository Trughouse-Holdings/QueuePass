//! Spec 041 US1, US2 (FR-005, FR-008, FR-014, FR-017; research R11, R12; tasks T023, T032), port
//! of `admin-app/src/pages/SeasonForm.tsx`: a new Season, or one to edit, put on sale, delete (a
//! draft) or cancel (on sale). Events, venue and layout are locked once a pass is sold; a
//! cancelled Season is read-only. The rules are `core::forms::season` and `core::pages::seasons`;
//! this is the markup, element for element, and the requests.

use std::collections::{BTreeMap, BTreeSet};

use admin_rust_core::{
    api::{
        client::{ApiError, EventFilters, ops},
        types::{Location, Season, SeasonStatus},
    },
    forms::{
        event::FieldMessages,
        layouts::as_api_error,
        season::{
            GENERAL_ADMISSION, PreviewLevel, SPORTS, SeasonDraft, SeasonPreviewContext,
            first_error_key, focus_id_for, missing_required, place_season_errors, preview_season,
            price_keys, same_draft, to_season_input,
        },
    },
    pages::{
        event_page::{DeleteKind, already_gone_notice, delete_confirm, deleted_notice},
        seasons::{
            LayoutLevels, PickerEvent, SeasonClock, cancel_season_confirm, draft_of, figures_line,
            no_prices_note, offered_events, offered_tier_names, on_sale_text, picker_label,
            preview_context, price_label, saved_price_keys, season_cancelled_text, season_lock,
            season_status_text,
        },
    },
    time::{DEFAULT_TIME_ZONE, join_local_date_time, split_local_date_time},
};
use leptos::{ev::SubmitEvent, prelude::*, task::spawn_local};
use leptos_router::hooks::{use_navigate, use_params_map};

use crate::{
    auth::use_auth,
    components::{
        AppLink, Notice, NoticeKind, SuccessState,
        banners::with_notice,
        event_form::{focus_later, hint},
    },
    util::now_ms,
};

/// `/seasons/new` and `/seasons/:id`, built again for each Season, so a save that moves from
/// `/seasons/new` to the Season's own address starts fresh.
#[component]
pub fn SeasonForm() -> impl IntoView {
    let params = use_params_map();
    let id = Memo::new(move |_| params.with(|p| p.get("id")));
    move || {
        let id = id.get();
        view! { <SeasonPage id=id/> }
    }
}

/// What the page shows before the form.
#[derive(Clone, PartialEq, Eq)]
enum Shown {
    Loading,
    Failed(String),
    Ready,
}

/// What the form works out from its loads and the draft (`useMemo`s of `SeasonForm.tsx`).
#[derive(Clone, PartialEq)]
struct Derived {
    zone: String,
    offered: Vec<PickerEvent>,
    tier_names: Vec<String>,
    ctx: SeasonPreviewContext,
    /// The publish rules' context (complete and publishing, review 041).
    publish_ctx: SeasonPreviewContext,
    keys: Vec<String>,
}

/// The fields sent last, for placing a refusal's `eventIds.<i>` and `prices.<i>`.
#[derive(Clone, Default, PartialEq)]
struct Sent {
    event_ids: Vec<String>,
    price_keys: Vec<String>,
}

#[component]
fn SeasonPage(id: Option<String>) -> impl IntoView {
    let auth = use_auth();
    let navigate = StoredValue::new_local(use_navigate());
    let venues: RwSignal<Vec<Location>> = RwSignal::new(Vec::new());
    let events: RwSignal<Vec<PickerEvent>> = RwSignal::new(Vec::new());
    let layouts: RwSignal<Vec<(String, String)>> = RwSignal::new(Vec::new());
    let levels: RwSignal<Vec<PreviewLevel>> = RwSignal::new(Vec::new());
    let tiers_of: RwSignal<BTreeMap<String, Vec<String>>> = RwSignal::new(BTreeMap::new());
    let tiers_asked = StoredValue::new(BTreeSet::<String>::new());
    let season: RwSignal<Option<Season>> = RwSignal::new(None);
    let load_error: RwSignal<Option<String>> = RwSignal::new(None);
    let draft = RwSignal::new(SeasonDraft::default());
    let submitted = RwSignal::new(false);
    let error: RwSignal<Option<ApiError>> = RwSignal::new(None);
    let sent = RwSignal::new(Sent::default());
    let busy = RwSignal::new(false);
    let saved: RwSignal<Option<String>> = RwSignal::new(None);
    // Review 041: the publish rules' failures, shown beside their fields until the next change.
    let publish_checks: RwSignal<Option<FieldMessages>> = RwSignal::new(None);
    let now = now_ms();

    spawn_local(async move {
        let list = auth.api().list_locations(None).await.unwrap_or_default();
        venues.try_set(list);
    });
    if let Some(season_id) = id.clone() {
        spawn_local(async move {
            match auth.api().get_season(&season_id).await {
                Ok(s) => {
                    draft.try_set(draft_of(&s));
                    season.try_set(Some(s));
                }
                Err(e) => {
                    load_error.try_set(Some(e.page_message().to_string()));
                }
            }
        });
    }

    // The venue's layouts; an answer for a venue no longer chosen is dropped.
    let location = Memo::new(move |_| draft.with(|d| d.location_id.clone()));
    // The picker asks for the chosen venue's events only (review 041).
    Effect::new(move |_| {
        let location_id = location.get();
        events.set(Vec::new());
        if location_id.is_empty() {
            return;
        }
        spawn_local(async move {
            let filters = EventFilters {
                location_id: Some(location_id.clone()),
                ..EventFilters::default()
            };
            let list = auth.api().list_events(&filters).await.unwrap_or_default();
            if draft.try_with_untracked(|d| d.location_id == location_id) == Some(true) {
                events.set(list.iter().map(PickerEvent::from).collect());
            }
        });
    });
    Effect::new(move |_| {
        let location_id = location.get();
        layouts.set(Vec::new());
        if location_id.is_empty() {
            return;
        }
        spawn_local(async move {
            let list = auth
                .api()
                .list_venue_layouts(&location_id)
                .await
                .unwrap_or_default();
            if draft.try_with_untracked(|d| d.location_id == location_id) == Some(true) {
                layouts.set(
                    list.iter()
                        .map(|l| (l.id.to_string(), l.name.to_string()))
                        .collect(),
                );
            }
        });
    });

    // The layout's levels (seated).
    let layout = Memo::new(move |_| draft.with(|d| d.layout.clone()));
    Effect::new(move |_| {
        let layout_id = layout.get();
        levels.set(Vec::new());
        if layout_id.is_empty() || layout_id == GENERAL_ADMISSION {
            return;
        }
        spawn_local(async move {
            let answer = auth
                .api()
                .send::<LayoutLevels>(ops::get_venue_layout(&layout_id))
                .await;
            if draft.try_with_untracked(|d| d.layout == layout_id) == Some(true) {
                levels.set(answer.map(|l| l.preview()).unwrap_or_default());
            }
        });
    });

    // General admission: each chosen event's ticket type names, read once.
    let ga_events = Memo::new(move |_| {
        draft.with(|d| {
            if d.layout == GENERAL_ADMISSION {
                d.event_ids.clone()
            } else {
                Vec::new()
            }
        })
    });
    Effect::new(move |_| {
        for event_id in ga_events.get() {
            if tiers_asked.with_value(|asked| asked.contains(&event_id)) {
                continue;
            }
            tiers_asked.update_value(|asked| {
                asked.insert(event_id.clone());
            });
            spawn_local(async move {
                let names = auth
                    .api()
                    .list_tiers(&event_id)
                    .await
                    .map(|tiers| tiers.iter().map(|t| t.name.to_string()).collect())
                    .unwrap_or_default();
                tiers_of.try_update(|map| {
                    map.insert(event_id, names);
                });
            });
        }
    });

    let cancelled = Memo::new(move |_| {
        season.with(|s| {
            s.as_ref()
                .is_some_and(|s| s.status == SeasonStatus::Cancelled)
        })
    });
    let passes_locked = Memo::new(move |_| {
        season.with(|s| s.as_ref().is_some_and(|s| s.passes_sold.unwrap_or(0) > 0))
    });

    let derived = Memo::new(move |_| {
        let d = draft.get();
        let zone = venues.with(|vs| {
            vs.iter()
                .find(|v| v.id.to_string() == d.location_id)
                .map(|v| v.time_zone.to_string())
        });
        let zone = zone
            .or_else(|| season.with(|s| s.as_ref().map(|s| s.time_zone.to_string())))
            .unwrap_or_else(|| DEFAULT_TIME_ZONE.to_string());
        let offered = season.with(|s| events.with(|es| offered_events(es, s.as_ref(), &d, now)));
        let chosen: Vec<PickerEvent> = offered
            .iter()
            .filter(|e| d.event_ids.contains(&e.id))
            .cloned()
            .collect();
        let tier_names = if d.layout == GENERAL_ADMISSION {
            let lists: Vec<Vec<String>> = tiers_of.with(|map| {
                chosen
                    .iter()
                    .filter(|e| e.status != "CANCELLED")
                    .map(|e| map.get(&e.id).cloned().unwrap_or_default())
                    .collect()
            });
            let priced: Vec<String> = season.with(|s| {
                s.as_ref()
                    .map(|s| {
                        s.prices
                            .iter()
                            .filter_map(|p| p.tier_name.as_ref().map(|n| n.to_string()))
                            .collect()
                    })
                    .unwrap_or_default()
            });
            offered_tier_names(&lists, &priced)
        } else {
            Vec::new()
        };
        let complete =
            season.with(|s| s.as_ref().is_some_and(|s| s.status == SeasonStatus::OnSale));
        let (ctx, publish_ctx) = levels.with(|ls| {
            (
                preview_context(&zone, &chosen, ls, &tier_names, complete, false),
                preview_context(&zone, &chosen, ls, &tier_names, true, true),
            )
        });
        let keys = price_keys(&d, &ctx);
        Derived {
            zone,
            offered,
            tier_names,
            ctx,
            publish_ctx,
            keys,
        }
    });
    let previews = Memo::new(move |_| derived.with(|x| draft.with(|d| preview_season(d, &x.ctx))));
    // #189: a required field with no value yet is outlined in red at once; its message waits.
    // Nothing is outlined on a cancelled Season.
    let missing = Memo::new(move |_| {
        if season.with(|s| {
            s.as_ref()
                .is_some_and(|s| s.status == SeasonStatus::Cancelled)
        }) {
            BTreeSet::new()
        } else {
            derived.with(|x| draft.with(|d| missing_required(d, &x.ctx)))
        }
    });
    let placed = Memo::new(move |_| {
        let shown: Vec<String> =
            derived.with(|x| x.keys.iter().map(|k| format!("prices.{k}")).collect());
        error.with(|e| {
            sent.with(|s| {
                place_season_errors(e.as_ref(), &s.event_ids, &s.price_keys, Some(&shown))
            })
        })
    });
    // Review 041: Put on sale publishes the saved Season, so only while the form still shows it.
    let dirty = Memo::new(move |_| {
        season.with(|s| {
            s.as_ref()
                .is_some_and(|s| draft.with(|d| !same_draft(&draft_of(s), d)))
        })
    });
    // A refusal's messages beside a field, else the publish rules' failure, else, once a save
    // was tried, the preview's.
    let hint_for = move |key: &str| -> Vec<String> {
        if let Some(messages) = placed.with(|p| p.get(key).map(<[String]>::to_vec)) {
            return messages;
        }
        if let Some(message) =
            publish_checks.with(|c| c.as_ref().and_then(|c| c.get(key)).map(str::to_string))
        {
            return vec![message];
        }
        if submitted.get()
            && let Some(message) = previews.with(|p| p.get(key).map(str::to_string))
        {
            return vec![message];
        }
        Vec::new()
    };

    let change = move |patch: &dyn Fn(&mut SeasonDraft)| {
        draft.update(|d| patch(d));
        error.set(None);
        publish_checks.set(None);
        saved.set(None);
    };

    // A refusal placed beside its fields, focus on the first (FR-016, FR-017).
    let refused = move |err: ApiError, mapping: Sent| {
        let api_error = as_api_error(err);
        let first = first_error_key(
            &place_season_errors(
                Some(&api_error),
                &mapping.event_ids,
                &mapping.price_keys,
                None,
            )
            .keys(),
            &derived.with_untracked(|x| x.keys.clone()),
        );
        error.try_set(Some(api_error));
        focus_later(first.map(|k| focus_id_for(&k)));
    };

    let save_id = id.clone();
    let save = move |ev: SubmitEvent| {
        ev.prevent_default();
        if busy.get_untracked() {
            return;
        }
        submitted.set(true);
        error.set(None);
        saved.set(None);
        let found = previews.get_untracked();
        if !found.is_empty() {
            let keys = derived.with_untracked(|x| x.keys.clone());
            focus_later(first_error_key(&found.keys(), &keys).map(|k| focus_id_for(&k)));
            return;
        }
        let (input, sent_keys) =
            derived.with_untracked(|x| to_season_input(&draft.get_untracked(), &x.ctx));
        let mapping = Sent {
            event_ids: draft.with_untracked(|d| d.event_ids.clone()),
            price_keys: sent_keys,
        };
        sent.set(mapping.clone());
        busy.set(true);
        let api = auth.api();
        let season_id = save_id.clone();
        spawn_local(async move {
            match season_id {
                None => match api.create_season(&input).await {
                    Ok(created) => {
                        let to = format!("/seasons/{}", created.id);
                        navigate.with_value(|go| {
                            go(&to, with_notice(NoticeKind::Success, "Season saved."))
                        });
                    }
                    Err(e) => refused(e, mapping),
                },
                Some(season_id) => match api.update_season(&season_id, &input).await {
                    Ok(updated) => {
                        draft.try_set(draft_of(&updated));
                        season.try_set(Some(updated));
                        submitted.try_set(false);
                        saved.try_set(Some("Season saved.".into()));
                    }
                    Err(e) => refused(e, mapping),
                },
            }
            busy.try_set(false);
        });
    };

    let publish = move || {
        let Some(s) = season.get_untracked() else {
            return;
        };
        if busy.get_untracked() || dirty.get_untracked() {
            return;
        }
        // FR-010: the publish rules previewed first (at least 2 events, every level priced, the
        // sales end ahead); nothing is sent while one fails.
        let (checks, keys) = derived.with_untracked(|x| {
            (
                draft.with_untracked(|d| preview_season(d, &x.publish_ctx)),
                x.keys.clone(),
            )
        });
        if !checks.is_empty() {
            error.set(None);
            saved.set(None);
            let first = first_error_key(&checks.keys(), &keys);
            publish_checks.set(Some(checks));
            focus_later(first.map(|k| focus_id_for(&k)));
            return;
        }
        publish_checks.set(None);
        let mapping = Sent {
            event_ids: s.events.iter().map(|e| e.id.to_string()).collect(),
            price_keys: saved_price_keys(&s),
        };
        sent.set(mapping.clone());
        error.set(None);
        saved.set(None);
        busy.set(true);
        let api = auth.api();
        spawn_local(async move {
            match api.publish_season(&s.id.to_string()).await {
                Ok(on_sale) => {
                    saved.try_set(Some(on_sale_text(on_sale.name.as_str())));
                    draft.try_set(draft_of(&on_sale));
                    season.try_set(Some(on_sale));
                }
                Err(e) => refused(e, mapping),
            }
            busy.try_set(false);
        });
    };

    let cancel = move || {
        let Some(s) = season.get_untracked() else {
            return;
        };
        if busy.get_untracked() {
            return;
        }
        let ok = window()
            .confirm_with_message(&cancel_season_confirm(s.name.as_str(), s.passes_sold))
            .unwrap_or(false);
        if !ok {
            return;
        }
        busy.set(true);
        error.set(None);
        saved.set(None);
        let api = auth.api();
        spawn_local(async move {
            match api.cancel_season(&s.id.to_string()).await {
                Ok(result) => {
                    saved.try_set(Some(season_cancelled_text(&result)));
                    draft.try_set(draft_of(&result.season));
                    season.try_set(Some(result.season));
                }
                Err(e) => {
                    let mapping = sent.get_untracked();
                    refused(e, mapping);
                }
            }
            busy.try_set(false);
        });
    };

    // `useDelete` (spec 002 FR-026, FR-027, FR-029): confirm, delete, then go to the list with
    // a notice or show why not.
    let deleting = RwSignal::new(false);
    let delete_error: RwSignal<Option<String>> = RwSignal::new(None);
    let delete_in_flight = StoredValue::new(false);
    let remove = move || {
        let Some(s) = season.get_untracked() else {
            return;
        };
        if delete_in_flight.get_value() {
            return;
        }
        let name = s.name.to_string();
        let ok = window()
            .confirm_with_message(&delete_confirm(DeleteKind::Season, &name))
            .unwrap_or(false);
        if !ok {
            return;
        }
        delete_in_flight.set_value(true);
        deleting.set(true);
        delete_error.set(None);
        let api = auth.api();
        spawn_local(async move {
            let result = api.delete_season(&s.id.to_string()).await;
            let go = |kind, text: String| {
                navigate.with_value(|nav| nav("/seasons", with_notice(kind, text)));
            };
            match result {
                Ok(()) => go(NoticeKind::Success, deleted_notice(&name)),
                Err(e) => {
                    delete_in_flight.try_set_value(false);
                    deleting.try_set(false);
                    if e.status() == Some(404) {
                        // Someone else deleted it first: the list fetches fresh on arrival.
                        go(NoticeKind::Info, already_gone_notice(&name));
                    } else {
                        delete_error.try_set(Some(as_api_error(e).message().to_string()));
                    }
                }
            }
        });
    };

    let is_edit = id.is_some();
    let shown = Memo::new(move |_| {
        if !is_edit {
            return Shown::Ready;
        }
        if let Some(message) = load_error.get() {
            return Shown::Failed(message);
        }
        if season.with(Option::is_none) {
            Shown::Loading
        } else {
            Shown::Ready
        }
    });

    let page = Form {
        is_edit,
        draft,
        season,
        venues,
        layouts,
        levels,
        derived,
        placed,
        busy,
        saved,
        cancelled,
        passes_locked,
        dirty,
        deleting,
        delete_error,
        missing,
    };

    move || match shown.get() {
        Shown::Loading => view! { <p class="loading">"Loading season…"</p> }.into_any(),
        Shown::Failed(message) => view! {
            <section>
                <div role="alert" class="banner banner--error">
                    <span class="banner__icon" aria-hidden="true">"✕"</span>
                    <div class="banner__body">
                        <strong>"Could not load the season"</strong>
                        <p>{message}</p>
                    </div>
                </div>
                <AppLink href="/seasons" class="btn">"Back to seasons"</AppLink>
            </section>
        }
        .into_any(),
        Shown::Ready => page
            .view(hint_for, change, save.clone(), publish, cancel, remove)
            .into_any(),
    }
}

/// The page's signals, for its markup.
#[derive(Clone, Copy)]
struct Form {
    is_edit: bool,
    draft: RwSignal<SeasonDraft>,
    season: RwSignal<Option<Season>>,
    venues: RwSignal<Vec<Location>>,
    layouts: RwSignal<Vec<(String, String)>>,
    levels: RwSignal<Vec<PreviewLevel>>,
    derived: Memo<Derived>,
    placed: Memo<admin_rust_core::forms::season::PlacedSeasonErrors>,
    busy: RwSignal<bool>,
    saved: RwSignal<Option<String>>,
    cancelled: Memo<bool>,
    passes_locked: Memo<bool>,
    dirty: Memo<bool>,
    deleting: RwSignal<bool>,
    delete_error: RwSignal<Option<String>>,
    missing: Memo<BTreeSet<String>>,
}

/// `aria-invalid` and `aria-describedby` on a control while messages are beside it.
fn invalid_attrs(
    hint_for: impl Fn(&str) -> Vec<String> + Copy + Send + Sync + 'static,
    key: &'static str,
    described: &'static str,
) -> (
    impl Fn() -> Option<&'static str> + Copy + Send + Sync + 'static,
    impl Fn() -> Option<&'static str> + Copy + Send + Sync + 'static,
) {
    (
        move || (!hint_for(key).is_empty()).then_some("true"),
        move || (!hint_for(key).is_empty()).then_some(described),
    )
}

impl Form {
    #[allow(clippy::too_many_arguments)]
    fn view(
        self,
        hint_for: impl Fn(&str) -> Vec<String> + Copy + Send + Sync + 'static,
        change: impl Fn(&dyn Fn(&mut SeasonDraft)) + Copy + Send + Sync + 'static,
        save: impl Fn(SubmitEvent) + Clone + 'static,
        publish: impl Fn() + Copy + Send + Sync + 'static,
        cancel: impl Fn() + Copy + Send + Sync + 'static,
        remove: impl Fn() + Copy + Send + Sync + 'static,
    ) -> impl IntoView {
        let Form {
            is_edit,
            draft,
            season,
            venues,
            layouts,
            levels,
            derived,
            placed,
            busy,
            saved,
            cancelled,
            passes_locked,
            dirty,
            deleting,
            delete_error,
            missing,
        } = self;
        // #189: `input--needed` on a required control with no value yet (its only class).
        let needed = move |key: &'static str| {
            move || missing.with(|m| m.contains(key)).then_some("input--needed")
        };
        let read_only = move || cancelled.get();
        let status = Memo::new(move |_| season.with(|s| s.as_ref().map(|s| s.status)));
        let title = move || {
            season.with(|s| {
                s.as_ref()
                    .map_or_else(|| "New season".to_string(), |s| s.name.to_string())
            })
        };
        let head_lines = move || {
            season.with(|s| match s {
                Some(s) => view! {
                    <p class="page-sub" data-testid="season-status">
                        {season_status_text(&SeasonClock::from(s), now_ms())}
                    </p>
                    <p class="page-sub" data-testid="season-figures">
                        {figures_line(s.passes_sold, s.pass_revenue.as_deref().map(|r| r.as_str()))}
                    </p>
                }
                .into_any(),
                None => view! {
                    <p class="page-sub">"Sell a set of events at one venue as one pass."</p>
                }
                .into_any(),
            })
        };
        let actions = move || {
            let status = status.get()?;
            (!read_only()).then(|| {
                view! {
                    <div class="form__actions">
                        {(status == SeasonStatus::Draft).then(|| view! {
                            <button
                                type="button"
                                class="btn btn--primary"
                                on:click=move |_| publish()
                                disabled=move || busy.get() || dirty.get()
                                aria-describedby=move || dirty.get().then_some("publish-hint")
                            >
                                "Put on sale"
                            </button>
                            {move || dirty.get().then(|| view! {
                                <span class="field__hint" id="publish-hint" data-testid="publish-hint">
                                    "Save your changes first."
                                </span>
                            })}
                        })}
                        {(status == SeasonStatus::OnSale).then(|| view! {
                            <button
                                type="button"
                                class="btn"
                                on:click=move |_| cancel()
                                disabled=move || busy.get()
                            >
                                "Cancel season"
                            </button>
                        })}
                        {(status == SeasonStatus::Draft).then(|| view! {
                            <button
                                type="button"
                                class="btn"
                                on:click=move |_| remove()
                                disabled=move || deleting.get()
                            >
                                {move || if deleting.get() { "Deleting…" } else { "Delete" }}
                            </button>
                        })}
                    </div>
                }
            })
        };

        let (name_invalid, name_described) = invalid_attrs(hint_for, "name", "name-error");
        let (sport_invalid, sport_described) = invalid_attrs(hint_for, "sport", "sport-error");
        let (team_invalid, team_described) = invalid_attrs(hint_for, "team", "team-error");
        let (venue_invalid, venue_described) =
            invalid_attrs(hint_for, "locationId", "locationId-error");
        let (layout_invalid, layout_described) =
            invalid_attrs(hint_for, "layoutId", "layoutId-error");
        let (passes_invalid, passes_described) = invalid_attrs(
            hint_for,
            "maxPassesPerCustomer",
            "maxPassesPerCustomer-error",
        );
        let (events_invalid, events_described) =
            invalid_attrs(hint_for, "eventIds", "eventIds-error");
        let (prices_invalid, prices_described) = invalid_attrs(hint_for, "prices", "prices-error");
        let sales_end_invalid = Signal::derive(move || !hint_for("salesEndAt").is_empty());
        let presale_invalid = Signal::derive(move || !hint_for("singleSalesOpenAt").is_empty());

        let value = move |f: fn(&SeasonDraft) -> String| move || draft.with(f);
        let sport = value(|d| d.sport.clone());
        let location = value(|d| d.location_id.clone());
        let layout = value(|d| d.layout.clone());

        let events_body = move || {
            let (has_shape, offered, zone) = (
                draft.with(|d| !d.location_id.is_empty() && !d.layout.is_empty()),
                derived.with(|x| x.offered.clone()),
                derived.with(|x| x.zone.clone()),
            );
            if !has_shape {
                return view! {
                    <p class="note">"Choose a venue and a layout to see its upcoming events."</p>
                }
                .into_any();
            }
            if offered.is_empty() {
                return view! { <p class="note">"No upcoming events at this venue on this layout."</p> }
                    .into_any();
            }
            offered
                .into_iter()
                .map(|e| {
                    let label = picker_label(&e, &zone);
                    let cancelled_event = e.status == "CANCELLED";
                    let event_id = e.id.clone();
                    let checked_id = e.id.clone();
                    view! {
                        <label class="choice">
                            <input
                                type="checkbox"
                                prop:checked=move || draft.with(|d| d.event_ids.contains(&checked_id))
                                disabled=move || read_only() || passes_locked.get()
                                on:change=move |ev| {
                                    let on = event_target_checked(&ev);
                                    let id = event_id.clone();
                                    change(&move |d: &mut SeasonDraft| {
                                        if on {
                                            d.event_ids.push(id.clone());
                                        } else {
                                            d.event_ids.retain(|x| *x != id);
                                        }
                                    });
                                }
                            />
                            {label}
                            {cancelled_event.then(|| view! {
                                " "
                                <span class="pill pill--danger">"Cancelled"</span>
                            })}
                        </label>
                    }
                })
                .collect_view()
                .into_any()
        };

        let prices_body = move || {
            let keys = derived.with(|x| x.keys.clone());
            let layout_now = draft.with(|d| d.layout.clone());
            if keys.is_empty() {
                return view! { <p class="note">{no_prices_note(&layout_now)}</p> }.into_any();
            }
            let seated = layout_now != GENERAL_ADMISSION;
            let tier_names = derived.with(|x| x.tier_names.clone());
            let level_list = levels.get();
            view! {
                <div class="field-row">
                    {keys
                        .into_iter()
                        .map(|key| {
                            let label = price_label(&key, seated, &level_list, &tier_names);
                            let input_id = format!("price-{key}");
                            let test_id = format!("price-{key}-error");
                            let field = format!("prices.{key}");
                            let invalid_field = field.clone();
                            let described_field = field.clone();
                            let hint_field = field.clone();
                            let needed_field = field.clone();
                            let described = test_id.clone();
                            let hint_id = test_id.clone();
                            let value_key = key.clone();
                            let input_key = key.clone();
                            view! {
                                <div class="field">
                                    <label for=input_id.clone()>{label}</label>
                                    <input
                                        id=input_id
                                        class=move || {
                                            missing
                                                .with(|m| m.contains(&needed_field))
                                                .then_some("input--needed")
                                        }
                                        inputmode="decimal"
                                        placeholder="0.00"
                                        prop:value=move || {
                                            draft.with(|d| d.prices.get(&value_key).cloned().unwrap_or_default())
                                        }
                                        disabled=read_only
                                        on:input=move |ev| {
                                            let typed = event_target_value(&ev);
                                            let key = input_key.clone();
                                            change(&move |d: &mut SeasonDraft| {
                                                d.prices.insert(key.clone(), typed.clone());
                                            });
                                        }
                                        aria-invalid=move || (!hint_for(&invalid_field).is_empty()).then_some("true")
                                        aria-describedby=move || {
                                            (!hint_for(&described_field).is_empty()).then(|| described.clone())
                                        }
                                    />
                                    {hint(move || hint_id.clone(), move || hint_for(&hint_field))}
                                </div>
                            }
                        })
                        .collect_view()}
                </div>
            }
            .into_any()
        };

        view! {
            <section>
                <div class="page-head">
                    <div>
                        <h1 class="page-title">{title}</h1>
                        {head_lines}
                    </div>
                    {actions}
                </div>

                <Notice/>
                {move || saved.get().map(|message| view! { <SuccessState message/> })}
                {move || delete_error.get().map(|message| view! {
                    <p class="field__hint" role="alert" data-testid="delete-error">{message}</p>
                })}
                {move || read_only().then(|| view! {
                    <div role="status" class="banner">
                        <div class="banner__body">
                            <p>{season_lock::CANCELLED}</p>
                        </div>
                    </div>
                })}

                <div class="card">
                    <form class="form" on:submit=save novalidate=true>
                        <fieldset class="field">
                            <legend>"Season"</legend>
                            <div class="field">
                                <label for="name">"Season name"</label>
                                <input
                                    id="name"
                                    class=needed("name")
                                    prop:value=value(|d| d.name.clone())
                                    placeholder="Louisville Cardinals Basketball 2026–27"
                                    disabled=read_only
                                    on:input=move |ev| {
                                        let typed = event_target_value(&ev);
                                        change(&move |d: &mut SeasonDraft| d.name = typed.clone());
                                    }
                                    aria-invalid=name_invalid
                                    aria-describedby=name_described
                                />
                                {hint(|| "name-error".into(), move || hint_for("name"))}
                            </div>
                            <div class="field-row">
                                <div class="field">
                                    <label for="sport">"Sport"</label>
                                    <select
                                        id="sport"
                                        prop:value=sport
                                        disabled=read_only
                                        on:change=move |ev| {
                                            let chosen = event_target_value(&ev);
                                            change(&move |d: &mut SeasonDraft| d.sport = chosen.clone());
                                        }
                                        aria-invalid=sport_invalid
                                        aria-describedby=sport_described
                                    >
                                        <option value="" prop:selected=move || sport().is_empty()>
                                            "No sport"
                                        </option>
                                        {SPORTS
                                            .iter()
                                            .map(|(v, label)| {
                                                let v = *v;
                                                view! {
                                                    <option value=v prop:selected=move || sport() == v>
                                                        {*label}
                                                    </option>
                                                }
                                            })
                                            .collect_view()}
                                    </select>
                                    {hint(|| "sport-error".into(), move || hint_for("sport"))}
                                </div>
                                <div class="field">
                                    <label for="team">"Team"</label>
                                    <input
                                        id="team"
                                        prop:value=value(|d| d.team.clone())
                                        placeholder="Louisville Cardinals"
                                        disabled=read_only
                                        on:input=move |ev| {
                                            let typed = event_target_value(&ev);
                                            change(&move |d: &mut SeasonDraft| d.team = typed.clone());
                                        }
                                        aria-invalid=team_invalid
                                        aria-describedby=team_described
                                    />
                                    {hint(|| "team-error".into(), move || hint_for("team"))}
                                </div>
                            </div>
                        </fieldset>

                        <fieldset class="field">
                            <legend>"Venue and seating"</legend>
                            <div class="field">
                                <label for="locationId">"Venue"</label>
                                <select
                                    id="locationId"
                                    class=needed("locationId")
                                    prop:value=location
                                    disabled=move || read_only() || passes_locked.get()
                                    on:change=move |ev| {
                                        let chosen = event_target_value(&ev);
                                        change(&move |d: &mut SeasonDraft| {
                                            d.location_id = chosen.clone();
                                            d.layout = String::new();
                                            d.event_ids = Vec::new();
                                            d.prices = BTreeMap::new();
                                        });
                                    }
                                    aria-invalid=venue_invalid
                                    aria-describedby=venue_described
                                >
                                    <option value="" prop:selected=move || location().is_empty()>
                                        "Select a venue…"
                                    </option>
                                    {move || {
                                        venues
                                            .get()
                                            .into_iter()
                                            .map(|v| {
                                                let id = v.id.to_string();
                                                let selected = id.clone();
                                                view! {
                                                    <option value=id prop:selected=move || location() == selected>
                                                        {v.name.to_string()}
                                                    </option>
                                                }
                                            })
                                            .collect_view()
                                    }}
                                </select>
                                {hint(|| "locationId-error".into(), move || hint_for("locationId"))}
                            </div>
                            <div class="field">
                                <label for="layoutId">"Layout"</label>
                                <select
                                    id="layoutId"
                                    class=needed("layoutId")
                                    prop:value=layout
                                    disabled=move || {
                                        read_only() || passes_locked.get() || location().is_empty()
                                    }
                                    on:change=move |ev| {
                                        let chosen = event_target_value(&ev);
                                        change(&move |d: &mut SeasonDraft| {
                                            d.layout = chosen.clone();
                                            d.event_ids = Vec::new();
                                            d.prices = BTreeMap::new();
                                        });
                                    }
                                    aria-invalid=layout_invalid
                                    aria-describedby=layout_described
                                >
                                    <option value="" prop:selected=move || layout().is_empty()>
                                        "Select a layout…"
                                    </option>
                                    <option
                                        value=GENERAL_ADMISSION
                                        prop:selected=move || layout() == GENERAL_ADMISSION
                                    >
                                        "General admission"
                                    </option>
                                    {move || {
                                        layouts
                                            .get()
                                            .into_iter()
                                            .map(|(id, name)| {
                                                let selected = id.clone();
                                                view! {
                                                    <option value=id prop:selected=move || layout() == selected>
                                                        {name}
                                                    </option>
                                                }
                                            })
                                            .collect_view()
                                    }}
                                </select>
                                {hint(|| "layoutId-error".into(), move || hint_for("layoutId"))}
                            </div>
                            {move || (passes_locked.get() && !read_only()).then(|| view! {
                                <span class="field__hint" data-testid="venue-locked">
                                    {season_lock::PASSES}
                                </span>
                            })}
                        </fieldset>

                        <fieldset class="field">
                            <legend>"Sales"</legend>
                            <div class="field">
                                <DateTimeFields
                                    id="salesEndAt"
                                    name="Pass sales end"
                                    value=Signal::derive(value(|d| d.sales_end_at.clone()))
                                    on_change=Callback::new(move |v: String| {
                                        change(&move |d: &mut SeasonDraft| d.sales_end_at = v.clone())
                                    })
                                    disabled=Signal::derive(read_only)
                                    invalid=sales_end_invalid
                                    needed=Signal::derive(move || missing.with(|m| m.contains("salesEndAt")))
                                />
                                <span class="field__hint">
                                    "In the venue's time zone; no later than the first event's start."
                                </span>
                                {hint(|| "salesEndAt-error".into(), move || hint_for("salesEndAt"))}
                            </div>
                            <div class="field">
                                <DateTimeFields
                                    id="singleSalesOpenAt"
                                    name="Single tickets on sale"
                                    value=Signal::derive(value(|d| d.single_sales_open_at.clone()))
                                    on_change=Callback::new(move |v: String| {
                                        change(&move |d: &mut SeasonDraft| d.single_sales_open_at = v.clone())
                                    })
                                    disabled=Signal::derive(read_only)
                                    invalid=presale_invalid
                                    needed=Signal::derive(|| false)
                                />
                                <span class="field__hint">
                                    "Until then the events sell only passes. Leave blank for no presale."
                                </span>
                                {hint(
                                    || "singleSalesOpenAt-error".into(),
                                    move || hint_for("singleSalesOpenAt"),
                                )}
                            </div>
                            <div class="field">
                                <label for="maxPassesPerCustomer">"Passes per customer"</label>
                                <input
                                    id="maxPassesPerCustomer"
                                    type="number"
                                    min="1"
                                    max="10"
                                    step="1"
                                    prop:value=value(|d| d.max_passes_per_customer.clone())
                                    disabled=read_only
                                    on:input=move |ev| {
                                        let typed = event_target_value(&ev);
                                        change(&move |d: &mut SeasonDraft| {
                                            d.max_passes_per_customer = typed.clone()
                                        });
                                    }
                                    aria-invalid=passes_invalid
                                    aria-describedby=passes_described
                                />
                                <span class="field__hint">"Leave blank for no limit."</span>
                                {hint(
                                    || "maxPassesPerCustomer-error".into(),
                                    move || hint_for("maxPassesPerCustomer"),
                                )}
                            </div>
                        </fieldset>

                        <fieldset
                            class="field"
                            id="eventIds"
                            tabindex="-1"
                            aria-invalid=events_invalid
                            aria-describedby=events_described
                        >
                            <legend>"Events"</legend>
                            // Review 041: the reason beside the locked boxes too (FR-017).
                            {move || (passes_locked.get() && !read_only()).then(|| view! {
                                <span class="field__hint" data-testid="events-locked">
                                    {season_lock::PASSES}
                                </span>
                            })}
                            {events_body}
                            {hint(|| "eventIds-error".into(), move || hint_for("eventIds"))}
                        </fieldset>

                        <fieldset
                            class="field"
                            id="prices"
                            tabindex="-1"
                            aria-invalid=prices_invalid
                            aria-describedby=prices_described
                        >
                            <legend>"Pass prices"</legend>
                            {prices_body}
                            <span class="field__hint">
                                "The whole season’s price, split evenly across its events."
                            </span>
                            {hint(|| "prices-error".into(), move || hint_for("prices"))}
                        </fieldset>

                        {move || {
                            let unmapped = placed.with(|p| p.unmapped.clone());
                            (!unmapped.is_empty()).then(|| view! {
                                <p class="field__hint" role="alert" data-testid="submit-error">
                                    {unmapped.join(" ")}
                                </p>
                            })
                        }}

                        <div class="form__actions">
                            {move || (!read_only()).then(|| view! {
                                <button type="submit" class="btn btn--primary" disabled=move || busy.get()>
                                    {move || {
                                        if busy.get() {
                                            "Saving…"
                                        } else if is_edit {
                                            "Save changes"
                                        } else {
                                            "Save season"
                                        }
                                    }}
                                </button>
                            })}
                            <AppLink href="/seasons" class="btn btn--ghost">"Back to seasons"</AppLink>
                        </div>
                    </form>
                </div>
            </section>
        }
    }
}

/// `DateTimeFields` (spec 036 FR-010): a date control and a time control side by side, joined
/// into one venue-local value. Each half is kept here, so filling the date and then the time does
/// not lose the first half before both exist; a value set from outside (a load, a save) resets
/// both, the pair's own echo does not.
#[component]
fn DateTimeFields(
    id: &'static str,
    name: &'static str,
    value: Signal<String>,
    on_change: Callback<String>,
    disabled: Signal<bool>,
    invalid: Signal<bool>,
    /// #189: both controls outlined as a required field with no value yet.
    needed: Signal<bool>,
) -> impl IntoView {
    let first = split_local_date_time(&value.get_untracked());
    let date = RwSignal::new(first.date);
    let time = RwSignal::new(first.time);
    let emitted = StoredValue::new(value.get_untracked());
    Effect::new(move |_| {
        let v = value.get();
        if emitted.with_value(|e| *e == v) {
            return;
        }
        emitted.set_value(v.clone());
        let parts = split_local_date_time(&v);
        date.set(parts.date);
        time.set(parts.time);
    });
    let set = move |next_date: String, next_time: String| {
        let joined = join_local_date_time(&next_date, &next_time);
        date.set(next_date);
        time.set(next_time);
        emitted.set_value(joined.clone());
        on_change.run(joined);
    };
    let date_id = format!("{id}-date");
    let time_id = format!("{id}-time");
    let described = format!("{id}-error");
    let described_time = described.clone();
    view! {
        <div class="field-row">
            <div class="field">
                <label for=date_id.clone()>{format!("{name} date")}</label>
                <input
                    id=date_id
                    type="date"
                    prop:value=move || date.get()
                    on:input=move |ev| set(event_target_value(&ev), time.get_untracked())
                    disabled=move || disabled.get()
                    class=move || needed.get().then_some("input--needed")
                    aria-invalid=move || invalid.get().then_some("true")
                    aria-describedby=move || invalid.get().then(|| described.clone())
                />
            </div>
            <div class="field">
                <label for=time_id.clone()>{format!("{name} time")}</label>
                <input
                    id=time_id
                    type="time"
                    step="60"
                    prop:value=move || time.get()
                    on:input=move |ev| set(date.get_untracked(), event_target_value(&ev))
                    disabled=move || disabled.get()
                    class=move || needed.get().then_some("input--needed")
                    aria-invalid=move || invalid.get().then_some("true")
                    aria-describedby=move || invalid.get().then(|| described_time.clone())
                />
            </div>
        </div>
    }
}
