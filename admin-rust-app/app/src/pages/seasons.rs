//! Spec 041 FR-018 (research R11, R12; task T023), port of `admin-app/src/pages/Seasons.tsx`:
//! every Season, with its venue, sport and team, number of events, status (Draft, On sale,
//! Presale until …, Sales ended, Cancelled), passes sold and pass revenue. Ordered by the Backend
//! (earliest event first). The cells are `core::pages::seasons::SeasonRow`.

use admin_rust_core::pages::seasons::{SeasonRow, seasons_count};
use leptos::{prelude::*, task::spawn_local};

use crate::{
    auth::use_auth,
    components::{AppLink, Notice},
    util::now_ms,
};

#[component]
pub fn Seasons() -> impl IntoView {
    let auth = use_auth();
    // The time is read when the Seasons arrive and kept with them, as the event list does (030).
    let loaded: RwSignal<Option<Vec<SeasonRow>>> = RwSignal::new(None);
    let error: RwSignal<Option<String>> = RwSignal::new(None);

    spawn_local(async move {
        match auth.api().list_seasons().await {
            Ok(seasons) => {
                let at = now_ms();
                loaded.try_set(Some(seasons.iter().map(|s| SeasonRow::of(s, at)).collect()));
            }
            Err(e) => {
                error.try_set(Some(e.page_message().to_string()));
            }
        }
    });

    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">"Seasons"</h1>
                    <p class="page-sub">
                        {move || match (loaded.get(), error.get()) {
                            (Some(rows), _) => seasons_count(rows.len()),
                            (None, Some(_)) => String::new(),
                            (None, None) => "Loading…".into(),
                        }}
                    </p>
                </div>
                <AppLink href="/seasons/new" class="btn btn--primary">
                    <span aria-hidden="true">"+"</span>
                    " New season"
                </AppLink>
            </div>

            <Notice/>

            {move || error.get().map(|message| view! {
                <div role="alert" class="banner banner--error">
                    <span class="banner__icon" aria-hidden="true">"✕"</span>
                    <div class="banner__body">
                        <strong>"Could not load seasons"</strong>
                        <p>{message}</p>
                    </div>
                </div>
            })}

            <div class="card">
                {move || match loaded.get() {
                    None => (error.get().is_none())
                        .then(|| view! { <p class="loading">"Loading seasons…"</p> })
                        .into_any(),
                    Some(rows) if rows.is_empty() => view! {
                        <div class="empty">
                            <div class="empty__icon" aria-hidden="true">"◷"</div>
                            <p class="empty__title">"No seasons yet"</p>
                            <p class="empty__body">
                                "Group upcoming events at one venue into a season to sell them as one pass."
                            </p>
                            <AppLink href="/seasons/new" class="btn btn--primary">"New season"</AppLink>
                        </div>
                    }
                    .into_any(),
                    Some(rows) => view! {
                        <div class="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>"Season"</th>
                                        <th>"Venue"</th>
                                        <th>"Sport and team"</th>
                                        <th>"Events"</th>
                                        <th>"Status"</th>
                                        <th>"Passes sold"</th>
                                        <th>"Pass revenue"</th>
                                    </tr>
                                </thead>
                                <tbody>{rows.into_iter().map(season_row).collect_view()}</tbody>
                            </table>
                        </div>
                    }
                    .into_any(),
                }}
            </div>
        </section>
    }
}

fn season_row(r: SeasonRow) -> impl IntoView {
    view! {
        <tr>
            <td class="cell-strong">
                <AppLink href=r.href class="rowlink">{r.name}</AppLink>
            </td>
            <td>
                <span class="pill">{r.venue}</span>
            </td>
            <td>{r.sport_team}</td>
            <td class="cell-num">{r.events}</td>
            <td>{r.status}</td>
            <td class="cell-num">{r.passes_sold}</td>
            <td class="price">{r.pass_revenue}</td>
        </tr>
    }
}
