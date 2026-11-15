//! Parity V1 (`admin-app/src/pages/LocationList.tsx`): the venue list, searched by name or
//! address with the search kept in the address (`?q=`, spec 004 FR-008); a search pushes a
//! history entry, so Back restores the earlier one (S15).

use admin_rust_core::{
    api::types::Location, format::venue_zone, forms::section_lines::to_locale_string,
};
use leptos::{prelude::*, task::spawn_local};
use leptos_router::{
    NavigateOptions,
    hooks::{use_navigate, use_query_map},
};

use crate::{
    auth::use_auth,
    components::{AddressLink, AppLink, Notice},
    util::{enum_text, search_params, with_query},
};

/// The `?q=` a search keeps, as `setParams(t ? { q: t } : {})`.
fn list_url(q: &str) -> String {
    let query = if q.is_empty() {
        String::new()
    } else {
        search_params(&[("q", q.to_string())])
    };
    with_query("/locations", &query)
}

#[component]
pub fn VenueList() -> impl IntoView {
    let auth = use_auth();
    let navigate = use_navigate();
    let query = use_query_map();
    let q = Memo::new(move |_| query.with(|p| p.get("q").unwrap_or_default()));
    let text = RwSignal::new(q.get_untracked());
    let locations: RwSignal<Option<Vec<Location>>> = RwSignal::new(None);
    let error: RwSignal<Option<String>> = RwSignal::new(None);
    let asked = StoredValue::new(0u64);

    Effect::new(move |_| {
        let q = q.get();
        let ticket = asked.get_value() + 1;
        asked.set_value(ticket);
        locations.set(None);
        spawn_local(async move {
            let trimmed = q.trim().to_string();
            let result = auth
                .api()
                .list_locations((!trimmed.is_empty()).then_some(trimmed.as_str()))
                .await;
            if asked.try_get_value() != Some(ticket) {
                return;
            }
            match result {
                Ok(list) => locations.set(Some(list)),
                Err(e) => error.set(Some(e.page_message().to_string())),
            }
        });
    });

    let go = navigate.clone();
    let search = move |ev: leptos::ev::SubmitEvent| {
        ev.prevent_default();
        let t = text.get_untracked().trim().to_string();
        go(&list_url(&t), NavigateOptions::default());
    };
    let clear = move |_| {
        text.set(String::new());
        navigate(&list_url(""), NavigateOptions::default());
    };

    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">"Venues"</h1>
                    <p class="page-sub">
                        {move || match locations.get() {
                            Some(l) => format!(
                                "{} venue{} {}",
                                l.len(),
                                if l.len() == 1 { "" } else { "s" },
                                if q.get().is_empty() { "on file" } else { "match" },
                            ),
                            None => "Loading…".into(),
                        }}
                    </p>
                </div>
                <AppLink href="/locations/new" class="btn btn--primary">
                    <span aria-hidden="true">"+"</span>
                    " Add venue"
                </AppLink>
            </div>

            <Notice/>

            <form role="search" class="card form" on:submit=search>
                <div class="field-row">
                    <label class="field">
                        "Search venues"
                        <input
                            type="search"
                            maxlength="200"
                            placeholder="Name or address, such as a city"
                            prop:value=move || text.get()
                            on:input=move |ev| text.set(event_target_value(&ev))
                        />
                    </label>
                </div>
                <div class="form__actions">
                    <button type="submit" class="btn btn--primary">"Search"</button>
                    {move || (!q.get().is_empty()).then(|| view! {
                        <button type="button" class="btn" on:click=clear.clone()>"Clear"</button>
                    })}
                </div>
            </form>

            {move || error.get().map(|message| view! {
                <div role="alert" class="banner banner--error">
                    <span class="banner__icon" aria-hidden="true">"✕"</span>
                    <div class="banner__body">
                        <strong>"Could not load venues"</strong>
                        <p>{message}</p>
                    </div>
                </div>
            })}

            <div class="card">
                {move || match locations.get() {
                    None => view! { <p class="loading">"Loading venues…"</p> }.into_any(),
                    Some(l) if l.is_empty() && !q.get().is_empty() => view! {
                        <div class="empty">
                            <p class="empty__title">{format!("No venues match \"{}\".", q.get())}</p>
                        </div>
                    }
                    .into_any(),
                    Some(l) if l.is_empty() => view! {
                        <div class="empty">
                            <div class="empty__icon" aria-hidden="true">"◇"</div>
                            <p class="empty__title">"No venues yet"</p>
                            <p class="empty__body">"Add one to start scheduling events."</p>
                            <AppLink href="/locations/new" class="btn btn--primary">"Add venue"</AppLink>
                        </div>
                    }
                    .into_any(),
                    Some(l) => view! {
                        <div class="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>"Name"</th>
                                        <th>"Address"</th>
                                        <th>"Time zone"</th>
                                        <th>"Seating capacity"</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {l.into_iter().map(|v| {
                                        let id = v.id.to_string();
                                        let zone = venue_zone(
                                            Some(&enum_text(&v.time_zone)),
                                            Some(&enum_text(&v.time_zone_source)),
                                        );
                                        view! {
                                            <tr>
                                                <td class="cell-strong">
                                                    <AppLink href=format!("/locations/{id}") class="rowlink">
                                                        {v.name.to_string()}
                                                    </AppLink>
                                                </td>
                                                <td class="cell-muted">
                                                    <AddressLink address=v.address.to_string()/>
                                                    {(!v.address_verified).then(|| view! {
                                                        " "
                                                        <span class="pill">"Not verified"</span>
                                                    })}
                                                </td>
                                                <td>{zone}</td>
                                                <td class="cell-num">
                                                    {to_locale_string(v.seating_capacity.get() as f64)}
                                                </td>
                                                <td class="cell-action">
                                                    <AppLink href=format!("/locations/{id}/edit") class="rowlink">
                                                        "Edit"
                                                    </AppLink>
                                                </td>
                                            </tr>
                                        }
                                    }).collect_view()}
                                </tbody>
                            </table>
                        </div>
                    }
                    .into_any(),
                }}
            </div>
        </section>
    }
}
