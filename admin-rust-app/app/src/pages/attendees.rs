//! Spec 037 (task T070; parity A1, A3, SL9), port of `admin-app/src/pages/Attendees.tsx`.
//!
//! Spec 005 US3 (FR-007): who has tickets for an event, every ticket code, and which tickets have
//! been checked in. Refunded orders stay listed, marked as such. Spec 023 US1: Download saves the
//! list as CSV, Excel, or PDF, made from what the page shows; the signed-in username is the
//! file's made by.

use std::{rc::Rc, sync::Arc};

use admin_rust_core::{
    api::{
        client::ApiError,
        types::{Event, Order, OrderStatus, TicketStatus},
    },
    export::{
        file_name::{ReportKind, file_name},
        rows::{self, attendee_table, ticket_details, ticket_status_note},
    },
    format::removed_note,
    money::usd,
    pages::attendees_reports::{
        attendee_summary, check_in_cell, export_input, order_levels, tier_cell,
    },
    time::{instant_from_ms, to_iso_string},
};
use chrono::{DateTime, Utc};
use leptos::{prelude::*, task::spawn_local};
use leptos_router::hooks::use_params_map;

use crate::{
    auth::{Auth, use_auth},
    components::{AppLink, ServiceUnreachable, export_menu::ExportMenu},
    device_zone::device_zone,
};

const PRIVATE_NOTE: &str = "The file contains customers' names and usernames. Keep it private.";

/// What arrived, and the same data read into the export module's structs (one per order, in the
/// same order), which the ticket code details and the file use.
struct Loaded {
    event: Event,
    orders: Vec<Order>,
    export_event: rows::Event,
    export_orders: Vec<rows::Order>,
    /// Spec 023 FR-003: when the answer arrived, every file's made-at time.
    loaded_at: DateTime<Utc>,
}

#[derive(Clone)]
enum Load {
    Loading,
    Ok(Arc<Loaded>),
    Missing,
    Unreachable,
}

fn loaded(event: Event, orders: Vec<Order>) -> Option<Loaded> {
    let export_event = export_input(&event)?;
    let export_orders = orders
        .iter()
        .map(export_input)
        .collect::<Option<Vec<rows::Order>>>()?;
    Some(Loaded {
        event,
        orders,
        export_event,
        export_orders,
        loaded_at: instant_from_ms(js_sys::Date::now() as i64).unwrap_or_default(),
    })
}

#[component]
pub fn Attendees() -> impl IntoView {
    let auth = use_auth();
    let params = use_params_map();
    let id = Memo::new(move |_| params.read().get("id").unwrap_or_default());
    let load = RwSignal::new(Load::Loading);
    // Spec 032 FR-010 (research R7 of 032): a removed event's checked-in count, kept in the
    // admin-only sales report; read only for a removed event, `None` until it arrives or when it
    // fails.
    let kept = RwSignal::new(None::<u64>);
    // Only the latest load's answers are used, as the React effects' `cancelled` flags do.
    let generation = StoredValue::new(0_u64);

    Effect::new(move |_| {
        let id = id.get();
        generation.update_value(|g| *g += 1);
        let current = generation.get_value();
        let is_current = move || generation.try_get_value() == Some(current);
        // Review round 1 of 032: another event's count is never shown or exported for this one.
        kept.set(None);
        load.set(Load::Loading);
        let api = auth.api();
        spawn_local(async move {
            let answer = match api.get_event(&id).await {
                Ok(event) => api.list_attendees(&id).await.map(|orders| (event, orders)),
                Err(e) => Err(e),
            };
            if !is_current() {
                return;
            }
            let next = match answer {
                Ok((event, orders)) => match loaded(event, orders) {
                    Some(l) => Load::Ok(Arc::new(l)),
                    None => Load::Unreachable,
                },
                // The client already sent the browser to sign in.
                Err(ApiError::Status(e)) if e.status == 401 => return,
                Err(ApiError::Status(e)) if e.status == 404 => Load::Missing,
                Err(_) => Load::Unreachable,
            };
            let removed =
                matches!(&next, Load::Ok(l) if l.event.check_in_details_removed_at.is_some());
            load.set(next);
            if !removed {
                return;
            }
            if let Ok(report) = api.get_sales_report().await
                && is_current()
                && let Some(row) = report.events.iter().find(|e| e.event_id.to_string() == id)
            {
                kept.set(Some(row.checked_in));
            }
        });
    });

    move || match load.get() {
        Load::Loading => view! { <p class="loading">"Loading attendees…"</p> }.into_any(),
        Load::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
        Load::Missing => view! {
            <section>
                <p>"This event no longer exists."</p>
                <AppLink href="/events" class="btn">"Back to events"</AppLink>
            </section>
        }
        .into_any(),
        Load::Ok(data) => page(data, kept, auth).into_any(),
    }
}

fn page(data: Arc<Loaded>, kept: RwSignal<Option<u64>>, auth: Auth) -> impl IntoView {
    let event = &data.event;
    let orders = &data.orders;
    let removed_at = event.check_in_details_removed_at;
    let removed = removed_at.is_some();
    let venue_zone = event.location.time_zone.to_string();
    let name = event.name.to_string();
    // Spec 023 FR-012: one zone for the made-at time and the file name, the admin's own.
    let zone = device_zone();

    let valid: Vec<_> = orders
        .iter()
        .flat_map(|o| &o.tickets)
        .filter(|t| t.status == TicketStatus::Valid)
        .collect();
    let valid_count = valid.len();
    let valid_checked = valid.iter().filter(|t| t.checked_in_at.is_some()).count() as u64;
    let order_count = orders.len();
    // Spec 032 FR-010: once removed, the kept count, or no checked-in part while it is not known.
    let summary = move || {
        let checked_in = if removed {
            kept.get()
        } else {
            Some(valid_checked)
        };
        attendee_summary(order_count, valid_count, checked_in)
    };

    let menu = (!orders.is_empty()).then(|| {
        let table_data = data.clone();
        let table_zone = zone.clone();
        let make_table = Rc::new(move || {
            attendee_table(
                &table_data.export_event,
                &table_data.export_orders,
                table_data.loaded_at,
                &untrack(|| auth.username()).unwrap_or_else(|| "unknown".to_string()),
                &table_zone,
                if removed {
                    kept.try_get_untracked().flatten().map(|n| n as i64)
                } else {
                    None
                },
            )
        });
        let file_event = name.clone();
        let loaded_at = data.loaded_at;
        let file_zone = zone.clone();
        let file = Rc::new(move |format| {
            file_name(
                ReportKind::Attendees,
                Some(&file_event),
                loaded_at,
                &file_zone,
                format,
            )
        });
        view! {
            <ExportMenu
                label="Download the attendee list"
                make_table=make_table
                file_name=file
                note=PRIVATE_NOTE
            />
        }
    });

    let rows_view = orders
        .iter()
        .zip(&data.export_orders)
        .map(|(o, export)| order_row(o, export, removed, &venue_zone))
        .collect_view();

    let body = if orders.is_empty() {
        view! { <p class="note">"No one has tickets for this event yet."</p> }.into_any()
    } else {
        view! {
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>"Customer"</th>
                            <th>"Name on tickets"</th>
                            <th>"Tier"</th>
                            <th>"Price level"</th>
                            <th>"Tickets"</th>
                            <th>"Total"</th>
                            <th>"Status"</th>
                            <th>"Ticket codes"</th>
                            <th>"Check-in"</th>
                        </tr>
                    </thead>
                    <tbody>{rows_view}</tbody>
                </table>
            </div>
        }
        .into_any()
    };

    let note = removed_at.map(
        |at| view! { <p class="note">{removed_note(&to_iso_string(at), Some(&venue_zone))}</p> },
    );

    view! {
        <section>
            <div class="page-head">
                <div>
                    <h1 class="page-title">"Attendees: " {name.clone()}</h1>
                    <p class="page-sub">{summary}</p>
                    {note}
                </div>
                <div class="form__actions">
                    {menu}
                    <AppLink href=format!("/events/{}", event.id) class="btn">
                        "Back to " {name}
                    </AppLink>
                </div>
            </div>
            <div class="card">{body}</div>
        </section>
    }
}

/// One order's row; `export` is the same order read into the export module's struct.
fn order_row(o: &Order, export: &rows::Order, removed: bool, venue_zone: &str) -> impl IntoView {
    let checked = o
        .tickets
        .iter()
        .filter(|t| t.checked_in_at.is_some())
        .count();
    let levels = order_levels(o.tickets.iter().map(|t| t.level_name.as_deref()));
    let seated = o
        .tickets
        .iter()
        .any(|t| t.seat.is_some() || t.level_name.is_some());
    let status = match o.status {
        OrderStatus::Confirmed => "Confirmed",
        OrderStatus::Refunded => "Refunded",
    };
    let holder = o
        .holder_name
        .as_ref()
        .map_or_else(|| "No name on ticket".to_string(), |n| n.to_string());
    let unit_price = export.unit_price.as_deref();
    // Spec 017 FR-020: the time of each entry, from checkedInAt; spec 038 FR-026, FR-030: the
    // seat, level, and own price after the code (parity A3).
    let tickets = export
        .tickets
        .iter()
        .map(|t| {
            view! {
                <li>
                    <code>{t.code.clone()}</code>
                    {ticket_details(t, unit_price)}
                    {ticket_status_note(t, removed, Some(venue_zone))}
                </li>
            }
        })
        .collect_view();
    view! {
        <tr>
            <td class="cell-strong">{o.customer_username.clone()}</td>
            <td>{holder}</td>
            <td>{tier_cell(o.tier_name.as_deref(), seated)}</td>
            <td>{levels}</td>
            <td class="cell-num">{o.quantity.get()}</td>
            <td class="price">{usd(&o.total_price)}</td>
            <td>
                <span class="pill">{status}</span>
            </td>
            <td>
                <ul>{tickets}</ul>
            </td>
            <td class="cell-num">{check_in_cell(removed, checked, o.tickets.len())}</td>
        </tr>
    }
}
