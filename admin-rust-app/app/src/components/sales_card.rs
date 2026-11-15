//! Spec 037 (task T062; parity E11), port of `admin-app/src/components/SalesCard.tsx`.
//!
//! Spec 005 FR-006: one event's sales, with each tier broken out (each price level for a seated
//! event, spec 038 FR-030). Read from the sales report, which is small enough at this scale to
//! fetch whole (research R6). Shows nothing if the report cannot be loaded: the rest of the event
//! page still works.

use admin_rust_core::{
    api::types::EventSales,
    format::removed_note,
    money::usd,
    pages::event_page::{
        checked_in_line, level_price_cell, level_sold_cell, sold_line, tier_sold_cell,
    },
    time::to_iso_string,
};
use leptos::{prelude::*, task::spawn_local};

use crate::{auth::use_auth, util::enum_text};

fn card(sales: EventSales) -> impl IntoView {
    let zone = enum_text(&sales.time_zone);
    // Spec 032 FR-011: the count above is the one kept when the details were removed.
    let removed = sales
        .check_in_details_removed_at
        .map(|at| view! { <p class="note">{removed_note(&to_iso_string(at), Some(&zone))}</p> });
    let tiers = (!sales.tiers.is_empty()).then(|| {
        view! {
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>"Tier"</th>
                            <th>"Sold"</th>
                            <th>"Revenue"</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sales
                            .tiers
                            .iter()
                            .map(|t| view! {
                                <tr>
                                    <td class="cell-strong">{t.name.clone()}</td>
                                    <td class="cell-num">
                                        {tier_sold_cell(t.tickets_sold, t.quantity.get())}
                                    </td>
                                    <td class="price">{usd(&t.revenue)}</td>
                                </tr>
                            })
                            .collect_view()}
                    </tbody>
                </table>
            </div>
        }
    });
    // Spec 038 FR-030 (research R17): a seated event's sales by price level, as sold.
    let levels = (!sales.levels.is_empty()).then(|| {
        view! {
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>"Price level"</th>
                            <th>"Price"</th>
                            <th>"Sold"</th>
                            <th>"Revenue"</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sales
                            .levels
                            .iter()
                            .map(|l| view! {
                                <tr>
                                    <td class="cell-strong">{l.name.clone()}</td>
                                    <td class="price">
                                        {level_price_cell(l.price.as_ref().map(|p| p.as_str()))}
                                    </td>
                                    // A level deleted since: what was sold, with no seats on sale
                                    // to count.
                                    <td class="cell-num">
                                        {level_sold_cell(
                                            l.level_id.is_none(),
                                            l.tickets_sold,
                                            l.seats_on_sale,
                                        )}
                                    </td>
                                    <td class="price">{usd(&l.revenue)}</td>
                                </tr>
                            })
                            .collect_view()}
                    </tbody>
                </table>
            </div>
        }
    });
    view! {
        <section class="card" aria-labelledby="sales-heading">
            <h2 id="sales-heading">"Sales"</h2>
            <p>{sold_line(sales.tickets_sold, sales.ticket_capacity.get())}</p>
            <p class="price">{usd(&sales.revenue)}</p>
            <p class="note">{checked_in_line(sales.checked_in)}</p>
            {removed}
            {tiers}
            {levels}
        </section>
    }
}

/// The Sales card of one event; nothing until the report arrives, or if it fails or lacks the
/// event. The page builds it again after a cancel, so refunded sales disappear.
#[component]
pub fn SalesCard(event_id: String) -> impl IntoView {
    let auth = use_auth();
    let sales = RwSignal::new(None::<EventSales>);
    let api = auth.api();
    spawn_local(async move {
        if let Ok(report) = api.get_sales_report().await {
            let found = report
                .events
                .into_iter()
                .find(|e| e.event_id.to_string() == event_id);
            sales.try_set(found);
        }
    });
    move || sales.get().map(card)
}
