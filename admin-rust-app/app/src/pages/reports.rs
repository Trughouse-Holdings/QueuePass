//! Spec 037 (task T071; parity R1, R2, SL10), port of `admin-app/src/pages/Reports.tsx`.
//!
//! Spec 005 US2 (FR-005, FR-006): what's going on, right now. The Backend computes the report on
//! every request, so reloading the page always shows current figures. Spec 023 US2: Download
//! saves the report as CSV, Excel, or PDF, made at `generatedAt`; the signed-in username is the
//! file's made by.

use std::{rc::Rc, sync::Arc};

use admin_rust_core::{
    api::{
        client::ApiError,
        types::{EventSales, EventSalesStatus, SalesReport},
    },
    export::{
        file_name::{ReportKind, file_name},
        rows::{self, sales_table},
    },
    format::removed_short,
    money::usd,
    pages::attendees_reports::{
        count, export_input, meter_fill_style, share, sold_cell, total_sold_cell,
    },
    time::{format_event_date, format_viewer_time, to_iso_string},
};
use leptos::{prelude::*, task::spawn_local};

use crate::{
    auth::{Auth, use_auth},
    components::{AppLink, ServiceUnreachable, export_menu::ExportMenu},
    device_zone::device_zone,
};

#[derive(Clone)]
enum Load {
    Loading,
    Ok(Arc<(SalesReport, rows::SalesReport)>),
    Failed,
}

/// A thin sell-through bar. Decorative: the same figure is always written beside it.
#[component]
fn Meter(value: u64, #[prop(into)] label: String) -> impl IntoView {
    view! {
        <span class="meter" title=label aria-hidden="true">
            // Nothing at zero: even a sliver would read as "some sold".
            {meter_fill_style(value)
                .map(|style| view! { <span class="meter__fill" style=style></span> })}
        </span>
    }
}

#[component]
pub fn Reports() -> impl IntoView {
    let auth = use_auth();
    let load = RwSignal::new(Load::Loading);
    let api = auth.api();
    spawn_local(async move {
        let next = match api.get_sales_report().await {
            Ok(report) => match export_input::<rows::SalesReport>(&report) {
                Some(export) => Load::Ok(Arc::new((report, export))),
                None => Load::Failed,
            },
            // The client already sent the browser to sign in.
            Err(ApiError::Status(e)) if e.status == 401 => return,
            Err(_) => Load::Failed,
        };
        load.set(next);
    });

    move || match load.get() {
        Load::Failed => view! { <ServiceUnreachable/> }.into_any(),
        Load::Loading => view! { <p class="loading">"Loading report…"</p> }.into_any(),
        Load::Ok(data) => page(data, auth).into_any(),
    }
}

fn page(data: Arc<(SalesReport, rows::SalesReport)>, auth: Auth) -> impl IntoView {
    let report = &data.0;
    let totals = &report.totals;
    let sold_pct = share(totals.tickets_sold, totals.ticket_capacity);
    let checked_pct = share(totals.checked_in, totals.tickets_sold);
    let zone = device_zone();
    let generated_at = report.generated_at;
    let sold = format!(
        "{} of {}",
        count(totals.tickets_sold),
        count(totals.ticket_capacity)
    );

    let table_data = data.clone();
    let table_zone = zone.clone();
    let make_table = Rc::new(move || {
        sales_table(
            &table_data.1,
            &untrack(|| auth.username()).unwrap_or_else(|| "unknown".to_string()),
            &table_zone,
        )
    });
    let file_zone = zone.clone();
    let file = Rc::new(move |format| {
        file_name(
            ReportKind::SalesReport,
            None,
            generated_at,
            &file_zone,
            format,
        )
    });

    let body = if report.events.is_empty() {
        view! { <p class="note">"No events yet."</p> }.into_any()
    } else {
        let rows_view = report.events.iter().map(event_row).collect_view();
        let total_sold = total_sold_cell(totals.tickets_sold, totals.ticket_capacity);
        let total_revenue = usd(&totals.revenue);
        let total_pass_tickets = count(totals.pass_tickets_sold);
        let total_pass_revenue = usd(&totals.pass_revenue);
        let total_checked_in = count(totals.checked_in);
        view! {
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>"Event"</th>
                            <th>"Venue"</th>
                            <th>"Date"</th>
                            <th>"Sold"</th>
                            <th class="num-head">"Revenue"</th>
                            // Spec 041 FR-020 (R8): part of the sold and revenue figures.
                            <th class="num-head">"Pass tickets"</th>
                            <th class="num-head">"Pass revenue"</th>
                            <th class="num-head">"Checked in"</th>
                        </tr>
                    </thead>
                    <tbody>{rows_view}</tbody>
                    // Spec 041 FR-020: the totals, pass figures included, under the events.
                    <tfoot>
                        <tr>
                            <th scope="row" class="cell-strong">"Total"</th>
                            <td></td>
                            <td></td>
                            <td class="cell-num">{total_sold}</td>
                            <td class="price num">{total_revenue}</td>
                            <td class="cell-num num">{total_pass_tickets}</td>
                            <td class="price num">{total_pass_revenue}</td>
                            <td class="cell-num num">{total_checked_in}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        }
        .into_any()
    };

    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">"Reports"</h1>
                    <p class="page-sub">
                        "Live sales across every event · as of "
                        {format_viewer_time(generated_at, &zone, true)}
                    </p>
                </div>
                // Spec 023 FR-002: whenever the report is shown.
                <div class="form__actions">
                    <ExportMenu
                        label="Download the sales report"
                        make_table=make_table
                        file_name=file
                    />
                </div>
            </div>

            <section class="stats" aria-labelledby="totals-heading">
                <h2 id="totals-heading" class="visually-hidden">"Totals"</h2>
                <div class="stat stat--hero">
                    <p class="stat__label">"Revenue"</p>
                    <p class="stat__value">{usd(&totals.revenue)}</p>
                    <p class="stat__note">"Confirmed orders; refunds excluded"</p>
                </div>
                <div class="stat">
                    <p class="stat__label">"Tickets sold"</p>
                    <p class="stat__value">{sold}</p>
                    <Meter value=sold_pct label=format!("{sold_pct}% of capacity sold")/>
                    <p class="stat__note">{format!("{sold_pct}% of capacity")}</p>
                </div>
                <div class="stat">
                    <p class="stat__label">"Checked in"</p>
                    <p class="stat__value">{count(totals.checked_in)}</p>
                    <Meter
                        value=checked_pct
                        label=format!("{checked_pct}% of tickets sold checked in")
                    />
                    <p class="stat__note">{format!("{checked_pct}% of tickets sold")}</p>
                </div>
                <div class="stat">
                    <p class="stat__label">"Scheduled events"</p>
                    <p class="stat__value">{count(totals.events)}</p>
                    <p class="stat__note">"Cancelled events not counted"</p>
                </div>
            </section>

            <div class="card">
                <div class="card__head">
                    <h2 class="card__title">"By event"</h2>
                    <p class="card__sub">"Soonest first"</p>
                </div>
                {body}
            </div>
        </section>
    }
}

/// One event's row of the By event table.
fn event_row(e: &EventSales) -> impl IntoView {
    let capacity = e.ticket_capacity.get();
    let pct = share(e.tickets_sold, capacity);
    let cancelled = e.status == EventSalesStatus::Cancelled;
    let zone = e.time_zone.to_string();
    let name = e.name.clone();
    // Spec 032 FR-011: the kept count, and when the details were removed.
    let removed = e.check_in_details_removed_at.map(|at| {
        view! {
            <br/>
            <span class="note">{removed_short(&to_iso_string(at), Some(&zone))}</span>
        }
    });
    view! {
        <tr class=cancelled.then_some("row--muted")>
            <td class="cell-strong">
                <AppLink href=format!("/events/{}", e.event_id) class="rowlink">
                    {name}
                </AppLink>
                " "
                {cancelled.then(|| view! { <span class="pill pill--danger">"Cancelled"</span> })}
            </td>
            <td class="cell-muted">{e.venue_name.clone()}</td>
            // Spec 020 FR-022: an event's date in its venue's zone (research R12 of 020).
            <td class="cell-time">{format_event_date(e.starts_at, &zone)}</td>
            <td class="cell-meter">
                <span class="cell-num">{sold_cell(e.tickets_sold, capacity)}</span>
                <Meter value=pct label=format!("{pct}% sold")/>
            </td>
            <td class="price num">{usd(&e.revenue)}</td>
            <td class="cell-num num">{count(e.pass_tickets_sold)}</td>
            <td class="price num">{usd(&e.pass_revenue)}</td>
            <td class="cell-num num">
                <span>{count(e.checked_in)}</span>
                {removed}
            </td>
        </tr>
    }
}
