//! Spec 037 (research R7), ports of `admin-app/src/export/attendee-rows.ts` and `sales-rows.ts`,
//! and of the Attendees page's ticket code details (`pages/Attendees.tsx`, parity A3).
//!
//! The inputs are the API's JSON (`Event`, `Order`, `SalesReport` of contracts/openapi.yaml),
//! read into plain structs holding only the fields the React code reads. Fields the contract
//! lets an older Backend leave out (a venue's zone, `checkInDetailsRemovedAt`) may be missing,
//! as in the React app.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::made::{
    DEFAULT_TIME_ZONE, format_event_date, format_event_time, made_lines, to_local_date_time,
    zone_name,
};
use super::table::{Cell, CellKind, ExportColumn, ExportTable};

/// The parts of an `Event` the attendee list reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub name: String,
    pub location: EventLocation,
    #[serde(default)]
    pub check_in_details_removed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLocation {
    /// An IANA name; a response without one is read as Eastern Time (`DEFAULT_TIME_ZONE`).
    #[serde(default)]
    pub time_zone: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    Confirmed,
    Refunded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TicketStatus {
    Valid,
    Void,
}

/// The parts of an `Order` (`listAttendees`) the attendee list and page read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: String,
    #[serde(default)]
    pub tier_name: Option<String>,
    pub customer_username: String,
    #[serde(default)]
    pub holder_name: Option<String>,
    /// `null` when the tickets' prices differ (seats of several levels, spec 038).
    #[serde(default)]
    pub unit_price: Option<String>,
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub tickets: Vec<Ticket>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub code: String,
    pub status: TicketStatus,
    #[serde(default)]
    pub checked_in_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub seat: Option<SoldSeat>,
    /// What this ticket cost (spec 038 FR-022).
    pub price: String,
    #[serde(default)]
    pub level_name: Option<String>,
}

/// A ticket's seat by its labels as sold (spec 038 FR-026).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoldSeat {
    pub section: String,
    pub row_label: String,
    pub seat_label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventStatus {
    Scheduled,
    Cancelled,
}

/// The parts of a `SalesReport` (`getSalesReport`) the sales report file reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesReport {
    pub generated_at: DateTime<Utc>,
    pub totals: SalesTotals,
    pub events: Vec<EventSales>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesTotals {
    pub events: i64,
    pub ticket_capacity: i64,
    pub tickets_sold: i64,
    pub checked_in: i64,
    pub revenue: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSales {
    pub name: String,
    pub venue_name: String,
    pub starts_at: DateTime<Utc>,
    #[serde(default)]
    pub time_zone: Option<String>,
    pub status: EventStatus,
    pub ticket_capacity: i64,
    pub tickets_sold: i64,
    pub checked_in: i64,
    pub revenue: String,
}

fn text(value: impl Into<String>) -> Cell {
    Cell::Text(value.into())
}

fn ticket_status(status: TicketStatus) -> &'static str {
    match status {
        TicketStatus::Valid => "Valid",
        TicketStatus::Void => "Void",
    }
}

fn order_status(status: OrderStatus) -> &'static str {
    match status {
        OrderStatus::Confirmed => "Confirmed",
        OrderStatus::Refunded => "Refunded",
    }
}

/// Spec 038: Price level's room comes from Name on tickets, Tier and Seat, so the PDF's minimum
/// widths still fit letter landscape with the widest values (023 review round 1; `pdf.fit`).
fn attendee_columns() -> Vec<ExportColumn> {
    vec![
        ExportColumn::new("Order placed", CellKind::DateTime, 18),
        ExportColumn::new("Customer", CellKind::Text, 17),
        ExportColumn::new("Name on tickets", CellKind::Text, 20),
        ExportColumn::new("Tier", CellKind::Text, 15),
        ExportColumn::new("Price level", CellKind::Text, 14),
        ExportColumn::new("Seat", CellKind::Text, 20),
        ExportColumn::new("Ticket code", CellKind::Text, 15).nowrap(),
        ExportColumn::new("Ticket status", CellKind::Text, 13),
        ExportColumn::new("Checked in", CellKind::DateTime, 18),
        ExportColumn::new("Order status", CellKind::Text, 17),
        ExportColumn::new("Price", CellKind::Money, 11),
        ExportColumn::new("Order", CellKind::Text, 11).nowrap(),
    ]
}

/// Spec 023 FR-004 (data-model.md): one row per ticket, carrying its order's details, in the
/// page's order (the Backend's, oldest order first). Spec 038 FR-030 (research R17): a Price
/// level column beside Tier, and Price is each ticket's own. Every time is in the venue's zone
/// (R4). Spec 032 FR-012 (research R8): for an event whose check-in details were removed, the
/// Checked in column stays, empty in every row, and the heading lines say so, with
/// `kept_checked_in`, the sales report's kept count, when it could be read.
///
/// `made_at` is when the page's data arrived; `admin_zone` is the admin's device zone (X4).
pub fn attendee_table(
    event: &Event,
    orders: &[Order],
    made_at: DateTime<Utc>,
    made_by: &str,
    admin_zone: &str,
    kept_checked_in: Option<i64>,
) -> ExportTable {
    let zone = event
        .location
        .time_zone
        .as_deref()
        .unwrap_or(DEFAULT_TIME_ZONE);
    let local = |at: Option<DateTime<Utc>>| {
        Cell::DateTime(at.map_or_else(String::new, |at| to_local_date_time(at, zone)))
    };
    let made = made_lines(made_at, made_by, admin_zone);
    let removed_at = event.check_in_details_removed_at;
    let mut removed = Vec::new();
    if let Some(at) = removed_at {
        removed.push(removed_note(at, Some(zone)));
        match kept_checked_in {
            Some(1) => removed.push("1 ticket was checked in.".into()),
            Some(n) => removed.push(format!("{} tickets were checked in.", group_digits(n))),
            None => {}
        }
    }

    let rows = orders
        .iter()
        .flat_map(|o| {
            o.tickets.iter().map(move |t| {
                let seated = t.seat.is_some() || t.level_name.is_some();
                vec![
                    local(Some(o.created_at)),
                    text(&o.customer_username),
                    text(o.holder_name.as_deref().unwrap_or("No name on ticket")),
                    // Spec 038 FR-030 (research R17): a seat is never general admission.
                    text(match &o.tier_name {
                        Some(tier) => tier.as_str(),
                        None if seated => "",
                        None => "General admission",
                    }),
                    text(t.level_name.as_deref().unwrap_or("")),
                    text(t.seat.as_ref().map(seat_label).unwrap_or_default()),
                    text(&t.code),
                    text(ticket_status(t.status)),
                    // Research R13b: a void ticket shows no check-in, as the page shows "(void)".
                    local(if t.status == TicketStatus::Void || removed_at.is_some() {
                        None
                    } else {
                        t.checked_in_at
                    }),
                    text(order_status(o.status)),
                    // Spec 038 FR-030: each ticket's own price.
                    Cell::Money(t.price.clone()),
                    text(o.id.chars().take(8).collect::<String>().to_uppercase()),
                ]
            })
        })
        .collect();

    let mut subtitle = made.lines;
    subtitle.extend(removed);
    subtitle.push(format!(
        "Times are in {} (the venue's time zone).",
        zone_name(zone)
    ));
    ExportTable {
        title: format!("Attendees: {}", event.name),
        subtitle,
        made_at: made.made_at,
        sheet_name: "Attendees".into(),
        columns: attendee_columns(),
        rows,
    }
}

fn sales_columns() -> Vec<ExportColumn> {
    vec![
        ExportColumn::new("Event", CellKind::Text, 30),
        ExportColumn::new("Venue", CellKind::Text, 24),
        ExportColumn::new("Starts", CellKind::DateTime, 18),
        ExportColumn::new("Time zone", CellKind::Text, 24),
        ExportColumn::new("Status", CellKind::Text, 20),
        ExportColumn::new("Tickets sold", CellKind::Count, 13),
        ExportColumn::new("Ticket capacity", CellKind::Count, 15),
        ExportColumn::new("Revenue", CellKind::Money, 14),
        ExportColumn::new("Checked in", CellKind::Count, 12),
    ]
}

/// Spec 023 FR-005 (data-model.md): one row per event in the page's order, each time in its own
/// venue's zone (R4), then Total with the page's totals. Made at `generatedAt` (R7), stated in
/// `admin_zone`, the admin's device zone (X4).
pub fn sales_table(report: &SalesReport, made_by: &str, admin_zone: &str) -> ExportTable {
    let made = made_lines(report.generated_at, made_by, admin_zone);
    let mut rows: Vec<Vec<Cell>> = report
        .events
        .iter()
        .map(|e| {
            let zone = e.time_zone.as_deref().unwrap_or(DEFAULT_TIME_ZONE);
            vec![
                text(&e.name),
                text(&e.venue_name),
                Cell::DateTime(to_local_date_time(e.starts_at, zone)),
                text(zone_name(zone)),
                text(match e.status {
                    EventStatus::Scheduled => "Scheduled",
                    EventStatus::Cancelled => "Cancelled",
                }),
                Cell::Count(e.tickets_sold),
                Cell::Count(e.ticket_capacity),
                Cell::Money(e.revenue.clone()),
                Cell::Count(e.checked_in),
            ]
        })
        .collect();
    let totals = &report.totals;
    rows.push(vec![
        text("Total"),
        text(""),
        Cell::DateTime(String::new()),
        text(""),
        text(format!(
            "{} scheduled {}",
            totals.events,
            if totals.events == 1 {
                "event"
            } else {
                "events"
            }
        )),
        Cell::Count(totals.tickets_sold),
        Cell::Count(totals.ticket_capacity),
        Cell::Money(totals.revenue.clone()),
        Cell::Count(totals.checked_in),
    ]);

    let mut subtitle = made.lines;
    subtitle.push("Each event's time is in its venue's time zone (the Time zone column).".into());
    ExportTable {
        title: "Sales report".into(),
        subtitle,
        made_at: made.made_at,
        sheet_name: "Sales".into(),
        columns: sales_columns(),
        rows,
    }
}

/// Parity A3 (`ticketDetails` in `pages/Attendees.tsx`; spec 038 FR-026, FR-030): what follows a
/// ticket's code on the Attendees page: its seat by its labels, its price level, and its own
/// price, which the order's unit price does not give for a seated ticket or an order of several
/// prices: `" Section 115, Row F, Seat 7, Lower sideline, $60.00"`, or `""`.
pub fn ticket_details(ticket: &Ticket, unit_price: Option<&str>) -> String {
    let mut parts = Vec::new();
    if let Some(seat) = &ticket.seat {
        parts.push(seat_label(seat));
    }
    if let Some(level) = &ticket.level_name {
        parts.push(level.clone());
    }
    if ticket.seat.is_some() || ticket.level_name.is_some() || unit_price.is_none() {
        parts.push(usd(&ticket.price));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" {}", parts.join(", "))
    }
}

/// Parity A3 (`pages/Attendees.tsx`; spec 017 FR-020, spec 032 FR-010): after the details,
/// `" (void)"`, or `" ✓ checked in Oct 1, 2026, 7:00 PM EDT"` in the venue's zone unless the
/// event's check-in details were removed, or `""`.
pub fn ticket_status_note(ticket: &Ticket, removed: bool, venue_zone: Option<&str>) -> String {
    match (ticket.status, ticket.checked_in_at) {
        (TicketStatus::Void, _) => " (void)".into(),
        (_, Some(at)) if !removed => format!(
            " ✓ checked in {}",
            format_event_time(at, venue_zone.unwrap_or(DEFAULT_TIME_ZONE))
        ),
        _ => String::new(),
    }
}

/// 037-merge: duplicate of `seatLabel` (admin-app/src/format.ts): "Section 115, Row F, Seat 7".
fn seat_label(seat: &SoldSeat) -> String {
    format!(
        "Section {}, Row {}, Seat {}",
        seat.section, seat.row_label, seat.seat_label
    )
}

/// 037-merge: duplicate of `CHECK_IN_RETENTION_DAYS` (packages/shared/src/event.ts).
const CHECK_IN_RETENTION_DAYS: u32 = 7;

/// 037-merge: duplicate of `removedNote` (admin-app/src/format.ts).
fn removed_note(removed_at: DateTime<Utc>, zone: Option<&str>) -> String {
    format!(
        "Check-in details removed on {} (kept for {CHECK_IN_RETENTION_DAYS} days after the event).",
        format_event_date(removed_at, zone.unwrap_or(DEFAULT_TIME_ZONE))
    )
}

/// 037-merge: duplicate of `usd` (admin-app/src/money.ts): `"$1,234.50"` from the string's
/// digits, padded or cut to two decimals, never rounded, never a float.
pub(crate) fn usd(amount: &str) -> String {
    let (whole, fraction) = amount.split_once('.').unwrap_or((amount, ""));
    let cents: String = fraction.chars().chain("00".chars()).take(2).collect();
    format!("${}.{cents}", group(whole))
}

/// 037-merge: duplicate of `toLocaleString('en-US')` on a whole number: `"12,345"`, `"-1"`.
pub(crate) fn group_digits(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    format!("{}{}", if n < 0 { "-" } else { "" }, group(&digits))
}

/// Commas between groups of three digits from the right, as `/\B(?=(\d{3})+(?!\d))/g` does.
fn group(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    let chars: Vec<char> = digits.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        let left = chars.len() - i;
        let boundary = i > 0 && chars[i - 1].is_ascii_digit() && c.is_ascii_digit();
        if boundary && left.is_multiple_of(3) && chars[i..].iter().all(char::is_ascii_digit) {
            out.push(',');
        }
        out.push(*c);
    }
    out
}
