//! Spec 037 T050 (parity E2–E8, E15, E16, M8–M11): the event form's rules, browser-free.
//!
//! Ports `admin-app/src/pages/event-form-checks.ts` (the preview checks, totals, field order,
//! focus ids, and the placement of the Backend's refusals) as plain functions, and the pure logic
//! of `admin-app/src/pages/EventForm.tsx`, `DateTimeFields.tsx`, and
//! `admin-app/src/components/SeatingSection.tsx` as [`EventFormState`]: what the React form keeps
//! in its `useState`s, with one method per handler and one per piece of text it shows. The
//! Backend stays authoritative (Constitution IV); these checks only spare a round trip.
//!
//! The Leptos form holds one [`EventFormState`], calls its methods from its event handlers, makes
//! the requests the methods ask for (the bodies are `serde_json::Value`s keyed exactly as the
//! React app sends them), hands the answers back, and renders from its getters. The React app's
//! quirks are kept (each is named where it happens).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use chrono::{DateTime, Duration, Utc};
use regress::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::api::client::ApiError;
use crate::format::{until, when};
use crate::forms::images::{EventImage, ImageFile, ImageList, image_step_error, pending_notice};
use crate::forms::off_sale::{
    LayoutDetail, LayoutSectionSeats, LayoutSummary, OffSaleCounts, OffSaleSelector, SectionTool,
    TakenSeats, count_off_sale, grouped,
};
use crate::money::is_base_price;
use crate::time::{
    DEFAULT_DOORS_OFFSET_MINUTES, DEFAULT_EVENT_LENGTH_MINUTES, DEFAULT_TIME_ZONE, DoorsMode,
    Moment, ResolvedLocal, abbreviation_at, default_event_instants, doors_instant_before_start,
    doors_mode_for_stored_gap_ms, doors_offset_options, doors_open_at_preview, doors_open_problem,
    doors_open_range_message, format_local_time, is_exact_doors_offset_minutes,
    join_local_date_time, parse_instant, resolve_local, skipped_time_message,
    split_local_date_time, to_local_date_time, to_offset_date_time, zone_name,
};

// ---------------------------------------------------------------- messages (event-form-checks.ts `MSG`)

/// `MSG.name`.
pub const MSG_NAME: &str = "Enter the event's name.";
/// `MSG.venue`, also the zone line before a venue is chosen.
pub const MSG_VENUE: &str = "Choose a venue first: times are in the venue's local time.";
/// `MSG.doors`.
pub const MSG_DOORS: &str = "Enter when doors open.";
/// `MSG.starts`.
pub const MSG_STARTS: &str = "Enter when the event starts.";
/// `MSG.ends`.
pub const MSG_ENDS: &str = "Enter when the event ends.";
/// `MSG.endOrder`.
pub const MSG_END_ORDER: &str = "endsAt must be later than startsAt";
/// `MSG.typeName`.
pub const MSG_TYPE_NAME: &str = "Give this ticket type a name.";
/// `MSG.typePrice`.
pub const MSG_TYPE_PRICE: &str = "Give this ticket type a price.";
/// `MSG.typeQuantity`.
pub const MSG_TYPE_QUANTITY: &str = "Give this ticket type a quantity.";
/// `MSG.badPrice`.
pub const MSG_BAD_PRICE: &str =
    "price must be a non-negative decimal string with at most 2 decimal places";
/// `MSG.badQuantity`.
pub const MSG_BAD_QUANTITY: &str = "quantity must be a positive whole number";
/// `MSG.noSeatOnSale`.
pub const MSG_NO_SEAT_ON_SALE: &str =
    "Every seat is off sale, so this event would sell nothing. Put some seats on sale.";

/// The page's sub line (E16).
pub const PAGE_SUB: &str = "Events at the same venue must be at least 60 minutes apart.";
/// The success state (E6).
pub const SAVED_MESSAGE: &str = "Event saved.";
/// After [`SAVED_MESSAGE`], the form goes to `/events/:id` this many ms later (E6).
pub const NAVIGATE_AFTER_MS: u32 = 700;
/// The no-answer banner's title (E6).
pub const NO_ANSWER_TITLE: &str = "Could not save";
/// The no-answer banner's text; "Events list" links to `/events` (E6).
pub const NO_ANSWER_TEXT: &str = "No answer from QueuePass, so the event may or may not have been scheduled. Check the Events list before scheduling it again.";
/// Tickets per customer's hint (E4).
pub const LIMIT_HINT: &str = "Leave blank for no limit.";
/// Shown while the chosen layout loads (M8).
pub const LOADING_LAYOUT: &str = "Loading the layout…";
/// The price table's caption (M9).
pub const PRICES_CAPTION: &str = "Prices by level";
/// A level price box's placeholder (M9).
pub const PRICE_PLACEHOLDER: &str = "60.00";
/// A level with no seat on sale, instead of its price box (M9).
pub const ALL_OFF_SALE: &str = "All seats off sale";
/// The scheduling conflict's detail starts with this, then the other event's name (E7).
pub const CONFLICT_PREFIX: &str = "Conflicts with ";
/// E8: the types or seating of an edited event could not be read.
pub const DETAILS_ONLY_NOTE: &str = "This event's ticket types or seating could not be loaded, so saving changes only the details above.";

/// Ports `levelPriceMessage`: an on-sale level's empty price box.
pub fn level_price_message(level: &str) -> String {
    format!("Give {level} a price.")
}

/// Ports `repeatedTypeNameMessage`.
pub fn repeated_type_name_message(
    later_index: usize,
    later_name: &str,
    earlier_index: usize,
    earlier_name: &str,
) -> String {
    format!(
        "Ticket type {}, '{later_name}', has the same name as ticket type {}, '{earlier_name}'. Give each ticket type its own name.",
        later_index + 1,
        earlier_index + 1
    )
}

/// Ports `overCapacityMessage`.
pub fn over_capacity_message(event_name: &str, capacity: i64, total: i64) -> String {
    let trimmed = event_name.trim();
    let who = if trimmed.is_empty() {
        "This event"
    } else {
        trimmed
    };
    format!("{who} has {capacity} tickets, but its ticket types add up to {total}.")
}

/// Ports `limitMessage`: the allowed range, or no upper bound while the capacity is unknown.
pub fn limit_message(most: Option<i64>) -> String {
    match most {
        Some(most) => format!(
            "Tickets per customer must be a whole number from 1 to {most}, or blank for no limit."
        ),
        None => "Tickets per customer must be a whole number of at least 1, or blank for no limit."
            .into(),
    }
}

/// Ports `lockReason`.
pub mod lock_reason {
    /// `lockReason.seating`: a general-admission event's seating, once tickets are sold.
    pub const SEATING: &str = "Can't be changed: tickets have been sold.";
    /// `lockReason.layout`: a seated event's layout, once seats are sold.
    pub const LAYOUT: &str = "Can't be changed: seats have been sold.";
    /// `lockReason.type`: Remove on a ticket type with sales.
    pub const TYPE: &str = "Can't be removed: tickets have been sold.";

    /// `lockReason.quantity`.
    pub fn quantity(sold: i64) -> String {
        format!(
            "This type has {} {} already sold.",
            super::grouped(sold),
            if sold == 1 { "ticket" } else { "tickets" }
        )
    }
}

// ---------------------------------------------------------------- types

/// Ports `Occurrence`: which of a repeated local time (`''`, `'first'`, `'second'`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Occurrence {
    #[default]
    Unset,
    First,
    Second,
}

impl Occurrence {
    /// `''`, `first`, or `second`.
    pub fn as_str(self) -> &'static str {
        match self {
            Occurrence::Unset => "",
            Occurrence::First => "first",
            Occurrence::Second => "second",
        }
    }
}

/// Ports `TimeField`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeField {
    StartsAt,
    EndsAt,
    DoorsOpenAt,
}

impl TimeField {
    /// The field key: `startsAt`, `endsAt`, `doorsOpenAt` (also the controls' id prefix).
    pub fn key(self) -> &'static str {
        match self {
            TimeField::StartsAt => "startsAt",
            TimeField::EndsAt => "endsAt",
            TimeField::DoorsOpenAt => "doorsOpenAt",
        }
    }

    fn empty_message(self) -> &'static str {
        match self {
            TimeField::StartsAt => MSG_STARTS,
            TimeField::EndsAt => MSG_ENDS,
            TimeField::DoorsOpenAt => MSG_DOORS,
        }
    }
}

/// `Record<TimeField, Occurrence>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Occurrences {
    pub starts_at: Occurrence,
    pub ends_at: Occurrence,
    pub doors_open_at: Occurrence,
}

impl Occurrences {
    pub fn get(&self, field: TimeField) -> Occurrence {
        match field {
            TimeField::StartsAt => self.starts_at,
            TimeField::EndsAt => self.ends_at,
            TimeField::DoorsOpenAt => self.doors_open_at,
        }
    }

    pub fn set(&mut self, field: TimeField, value: Occurrence) {
        match field {
            TimeField::StartsAt => self.starts_at = value,
            TimeField::EndsAt => self.ends_at = value,
            TimeField::DoorsOpenAt => self.doors_open_at = value,
        }
    }
}

/// A ticket type's field (`tiers.N.<field>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeField {
    Name,
    Price,
    Quantity,
}

impl TypeField {
    /// `name`, `price`, or `quantity`.
    pub fn key(self) -> &'static str {
        match self {
            TypeField::Name => "name",
            TypeField::Price => "price",
            TypeField::Quantity => "quantity",
        }
    }
}

/// Ports `TYPE_FIELDS`.
pub const TYPE_FIELDS: [&str; 3] = ["name", "price", "quantity"];

/// Ports `TicketType` (`EventForm.tsx`) and `TicketTypeDraft`: one ticket type as typed; `id` is
/// set for a type the event already has.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TicketType {
    pub id: Option<String>,
    pub name: String,
    pub price: String,
    pub quantity: String,
}

/// Ports `SeatingPreview`'s level.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LevelPreview {
    pub id: String,
    pub name: String,
    pub on_sale: i64,
    pub price: String,
}

/// Ports `SeatingPreview`: a seated event's levels as the form has them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatingPreview {
    pub seats_on_sale: i64,
    pub levels: Vec<LevelPreview>,
}

/// Ports `PreviewInput`.
#[derive(Debug, Clone)]
pub struct PreviewInput<'a> {
    pub name: &'a str,
    pub location_id: &'a str,
    pub starts_at: &'a str,
    pub ends_at: &'a str,
    pub doors_open_at: &'a str,
    pub venue_zone: &'a str,
    pub has_venue: bool,
    pub occurrence: Occurrences,
    pub types_loaded: bool,
    pub types: &'a [TicketType],
    /// `None` for general admission.
    pub seating: Option<&'a SeatingPreview>,
    pub total_ticket_capacity: &'a str,
    pub venue_capacity: Option<i64>,
    pub max_per_customer: &'a str,
    /// Doors are derived from the start ("Before the start" with a length).
    pub doors_from_start: bool,
}

/// A `Map<string, string>` of field keys to messages, in insertion order, as the TypeScript's
/// `Map` keeps them (setting a key again keeps its place).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FieldMessages(Vec<(String, String)>);

impl FieldMessages {
    pub fn set(&mut self, key: &str, message: impl Into<String>) {
        let message = message.into();
        match self.0.iter_mut().find(|(k, _)| k == key) {
            Some(entry) => entry.1 = message,
            None => self.0.push((key.to_string(), message)),
        }
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, m)| m.as_str())
    }

    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    pub fn delete(&mut self, key: &str) {
        self.0.retain(|(k, _)| k != key);
    }

    pub fn keys(&self) -> Vec<String> {
        self.0.iter().map(|(k, _)| k.clone()).collect()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.0.iter().map(|(k, m)| (k.as_str(), m.as_str()))
    }
}

// ---------------------------------------------------------------- JavaScript numbers

static JS_DECIMAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$").expect("a valid pattern")
});

/// `Number(text)`: blank is 0; decimal, exponent, `0x`/`0o`/`0b`, and `Infinity` forms; `NaN`
/// otherwise.
fn js_number(text: &str) -> f64 {
    let t = text.trim();
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = t.strip_prefix(prefix) {
            return u128::from_str_radix(digits, radix).map_or(f64::NAN, |n| n as f64);
        }
    }
    if JS_DECIMAL.find(t).is_some() {
        t.parse().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `Number.isInteger(n)`.
fn is_integer(n: f64) -> bool {
    n.is_finite() && n.fract() == 0.0
}

/// A number as `JSON.stringify` writes it: a whole number as an integer, `NaN` as `null`.
fn json_number(n: f64) -> Value {
    if is_integer(n) && n.abs() < 9_007_199_254_740_992.0 {
        json!(n as i64)
    } else {
        serde_json::Number::from_f64(n).map_or(Value::Null, Value::Number)
    }
}

/// `n.toLocaleString()` for a number that may not be whole.
fn locale_number(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if is_integer(n) && n.abs() < 9e15 {
        grouped(n as i64)
    } else {
        n.to_string()
    }
}

// ---------------------------------------------------------------- event-form-checks.ts

/// Ports `resolveField`: the moments a local value names in the zone, or `None` when it is empty
/// or not a date-time.
pub fn resolve_field(local: &str, zone: &str) -> Option<ResolvedLocal> {
    if local.is_empty() {
        return None;
    }
    resolve_local(local, zone).ok()
}

/// Ports `momentOf`: the one moment, or the chosen one of a repeated time.
pub fn moment_of(resolved: &ResolvedLocal, occurrence: Occurrence) -> Option<Moment> {
    match (resolved, occurrence) {
        (ResolvedLocal::Ok(m), _) => Some(m.clone()),
        (ResolvedLocal::Repeated { first, .. }, Occurrence::First) => Some(first.clone()),
        (ResolvedLocal::Repeated { second, .. }, Occurrence::Second) => Some(second.clone()),
        _ => None,
    }
}

static POSITIVE_WHOLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[1-9]\d*$").expect("a valid pattern"));

/// `parsedQuantity`.
fn parsed_quantity(raw: &str) -> Option<i64> {
    let t = raw.trim();
    if t.is_empty() || POSITIVE_WHOLE.find(t).is_none() {
        return None;
    }
    t.parse().ok()
}

/// Ports `capacityOf`: what the live total and the tickets-per-customer range compare against.
/// A seated event's is its seats on sale.
pub fn capacity_of(
    total_ticket_capacity: &str,
    venue_capacity: Option<i64>,
    seating: Option<&SeatingPreview>,
) -> Option<i64> {
    if let Some(s) = seating {
        return Some(s.seats_on_sale);
    }
    let typed = total_ticket_capacity.trim();
    if !typed.is_empty()
        && POSITIVE_WHOLE.find(typed).is_some()
        && let Ok(n) = typed.parse()
    {
        return Some(n);
    }
    venue_capacity
}

/// One type of [`SeatTotals::per_type`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeSeats {
    pub index: usize,
    pub name: String,
    pub seats: i64,
}

/// Ports `SeatTotals`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatTotals {
    pub assigned: i64,
    pub total: Option<i64>,
    pub leftover: i64,
    pub over: i64,
    pub summary: String,
    pub leftover_sentence: Option<String>,
    pub per_type: Vec<TypeSeats>,
}

fn seats_word(n: i64) -> &'static str {
    if n == 1 { "seat" } else { "seats" }
}

/// Ports `seatTotals`: how many seats a general-admission event's ticket types assign, what is
/// left, and whether they are over its capacity.
pub fn seat_totals(
    types: &[TicketType],
    total_ticket_capacity: &str,
    venue_capacity: Option<i64>,
) -> SeatTotals {
    let per_type: Vec<TypeSeats> = types
        .iter()
        .enumerate()
        .map(|(index, t)| {
            let trimmed = t.name.trim();
            TypeSeats {
                index,
                name: if trimmed.is_empty() {
                    format!("Ticket type {}", index + 1)
                } else {
                    trimmed.to_string()
                },
                seats: parsed_quantity(&t.quantity).unwrap_or(0),
            }
        })
        .collect();
    let assigned: i64 = per_type.iter().map(|t| t.seats).sum();
    let total = capacity_of(total_ticket_capacity, venue_capacity, None);
    let leftover = total.map_or(0, |t| (t - assigned).max(0));
    let over = total.map_or(0, |t| (assigned - t).max(0));
    let summary = match total {
        None => format!("{} {} assigned", grouped(assigned), seats_word(assigned)),
        Some(t) => format!("{} of {} seats assigned", grouped(assigned), grouped(t)),
    };
    let leftover_sentence = match total {
        Some(_) if over > 0 => Some(format!(
            "{} {} over the event's capacity",
            grouped(over),
            seats_word(over)
        )),
        Some(t) if leftover == 0 && assigned == t => {
            Some(format!("All {} seats are assigned.", grouped(t)))
        }
        Some(_) if leftover > 0 => Some(format!(
            "{} {} not assigned to a ticket type",
            grouped(leftover),
            seats_word(leftover)
        )),
        _ => None,
    };
    SeatTotals {
        assigned,
        total,
        leftover,
        over,
        summary,
        leftover_sentence,
        per_type,
    }
}

/// Ports `previewErrors`: every problem the form can see right now. The form shows a key once it
/// has been left or after submit ([`visible_errors`]).
pub fn preview_errors(input: &PreviewInput) -> FieldMessages {
    let mut errors = FieldMessages::default();
    if input.name.trim().is_empty() {
        errors.set("name", MSG_NAME);
    }
    if input.location_id.is_empty() {
        errors.set("locationId", MSG_VENUE);
    }

    if input.has_venue {
        let sent = |field: TimeField| match field {
            TimeField::StartsAt => input.starts_at,
            TimeField::EndsAt => input.ends_at,
            TimeField::DoorsOpenAt => input.doors_open_at,
        };
        let mut instants: BTreeMap<&str, DateTime<Utc>> = BTreeMap::new();
        for field in [
            TimeField::DoorsOpenAt,
            TimeField::StartsAt,
            TimeField::EndsAt,
        ] {
            let local = sent(field);
            let Some(r) = resolve_field(local, input.venue_zone) else {
                errors.set(field.key(), field.empty_message());
                continue;
            };
            if let ResolvedLocal::Skipped {
                skipped_from,
                skipped_to,
            } = &r
            {
                errors.set(
                    field.key(),
                    skipped_time_message(local, input.venue_zone, skipped_from, skipped_to),
                );
                continue;
            }
            let Some(m) = moment_of(&r, input.occurrence.get(field)) else {
                errors.set(
                    field.key(),
                    format!("Choose which {} you mean.", format_local_time(local)),
                );
                continue;
            };
            instants.insert(field.key(), m.instant);
        }
        let starts = instants.get("startsAt").copied();
        if let (Some(s), Some(e)) = (starts, instants.get("endsAt"))
            && *e <= s
        {
            errors.set("endsAt", MSG_END_ORDER);
        }
        if let (Some(s), Some(d)) = (starts, instants.get("doorsOpenAt"))
            && doors_open_problem(s, *d).is_some()
        {
            errors.set("doorsOpenAt", doors_open_range_message(s, input.venue_zone));
        }
        if input.doors_from_start && starts.is_none() {
            errors.delete("doorsOpenAt");
        }
    }

    if let Some(seating) = input.seating {
        for level in &seating.levels {
            if level.on_sale == 0 {
                continue;
            }
            let price = level.price.trim();
            let key = format!("levelPrices.{}", level.id);
            if price.is_empty() {
                errors.set(&key, level_price_message(&level.name));
            } else if !is_base_price(price) {
                errors.set(&key, MSG_BAD_PRICE);
            }
        }
        if seating.seats_on_sale == 0 {
            errors.set("offSale", MSG_NO_SEAT_ON_SALE);
        }
    } else if input.types_loaded {
        let mut seen: Vec<(String, usize, String)> = Vec::new();
        for (i, t) in input.types.iter().enumerate() {
            let name_key = format!("tiers.{i}.name");
            let name = t.name.trim();
            if name.is_empty() {
                errors.set(&name_key, MSG_TYPE_NAME);
            } else {
                let key = name.to_lowercase();
                match seen.iter().find(|(k, _, _)| *k == key) {
                    Some((_, index, earlier)) if !errors.has(&name_key) => {
                        errors.set(
                            &name_key,
                            repeated_type_name_message(i, name, *index, earlier),
                        );
                    }
                    _ => {
                        seen.retain(|(k, _, _)| *k != key);
                        seen.push((key, i, name.to_string()));
                    }
                }
            }
            let price_key = format!("tiers.{i}.price");
            if t.price.trim().is_empty() {
                errors.set(&price_key, MSG_TYPE_PRICE);
            } else if !is_base_price(t.price.trim()) {
                errors.set(&price_key, MSG_BAD_PRICE);
            }
            let quantity_key = format!("tiers.{i}.quantity");
            if t.quantity.trim().is_empty() {
                errors.set(&quantity_key, MSG_TYPE_QUANTITY);
            } else if parsed_quantity(&t.quantity).is_none() {
                errors.set(&quantity_key, MSG_BAD_QUANTITY);
            }
        }
        let totals = seat_totals(
            input.types,
            input.total_ticket_capacity,
            input.venue_capacity,
        );
        if let Some(total) = totals.total
            && totals.over > 0
        {
            errors.set(
                "tiers",
                over_capacity_message(input.name, total, totals.assigned),
            );
        }
    }

    let most = capacity_of(
        input.total_ticket_capacity,
        input.venue_capacity,
        input.seating,
    );
    let limit = input.max_per_customer.trim();
    if !limit.is_empty() {
        let n = js_number(limit);
        if !is_integer(n) || n < 1.0 || most.is_some_and(|m| n > m as f64) {
            errors.set("maxTicketsPerCustomer", limit_message(most));
        }
    }
    errors
}

/// Ports `fieldOrder`: the form's fields top to bottom; the seating (the layout, each level's
/// price box in rank order, the price table, the seats off sale) comes where the ticket types do.
pub fn field_order(type_count: usize, level_ids: &[String]) -> Vec<String> {
    let mut keys: Vec<String> = [
        "name",
        "locationId",
        "doorsOpenAt",
        "startsAt",
        "endsAt",
        "layoutId",
    ]
    .map(String::from)
    .to_vec();
    keys.extend(level_ids.iter().map(|id| format!("levelPrices.{id}")));
    keys.push("levelPrices".into());
    keys.push("offSale".into());
    for i in 0..type_count {
        for f in TYPE_FIELDS {
            keys.push(format!("tiers.{i}.{f}"));
        }
    }
    keys.extend(
        [
            "seating",
            "tiers",
            "totalTicketCapacity",
            "maxTicketsPerCustomer",
        ]
        .map(String::from),
    );
    keys
}

/// Ports `firstErrorKey`: the first key at fault in form order, else the first one set.
pub fn first_error_key(
    errors: &FieldMessages,
    type_count: usize,
    level_ids: &[String],
) -> Option<String> {
    field_order(type_count, level_ids)
        .into_iter()
        .find(|k| errors.has(k))
        .or_else(|| errors.keys().into_iter().next())
}

/// Ports `firstPlacedKey`: the first placed refusal key, in the same order as preview errors.
pub fn first_placed_key(
    placed: &PlacedErrors,
    type_count: usize,
    level_ids: &[String],
) -> Option<String> {
    let mut keys = FieldMessages::default();
    for (path, messages) in &placed.fields {
        if let Some(first) = messages.first() {
            keys.set(path, first.clone());
        }
    }
    for (i, errs) in &placed.types {
        for e in errs {
            keys.set(&format!("tiers.{i}.{}", e.field), e.message.clone());
        }
    }
    if let Some(m) = placed.tiers.first() {
        keys.set("tiers", m.clone());
    }
    if let Some(m) = placed.seating.first() {
        keys.set("seating", m.clone());
    }
    first_error_key(&keys, type_count, level_ids)
}

static FOCUS_TYPE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^tiers\.(\d+)\.(name|price|quantity)$").expect("a valid pattern")
});
static FOCUS_LEVEL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^levelPrices\.(.+)$").expect("a valid pattern"));

/// Ports `focusIdFor`: a form control's id for a key (`type-N-<field>`, `price-<levelId>`,
/// `tickets-and-seating`, else the key itself).
pub fn focus_id_for(key: &str) -> String {
    if let Some(m) = FOCUS_TYPE.find(key) {
        let index: usize = m.group(1).map_or(0, |r| key[r].parse().unwrap_or(0));
        let field = m.group(2).map_or("", |r| &key[r]);
        return format!("type-{}-{field}", index + 1);
    }
    if let Some(m) = FOCUS_LEVEL.find(key) {
        return format!("price-{}", m.group(1).map_or("", |r| &key[r]));
    }
    if key == "seating" || key == "tiers" {
        return "tickets-and-seating".into();
    }
    key.to_string()
}

/// Ports `TypeFieldError`: one refusal message placed on a ticket type, with the field it names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeFieldError {
    pub field: String,
    pub message: String,
}

/// Ports `PlacedErrors`: a refusal's messages by the place in the form they name, in the order
/// they were placed.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PlacedErrors {
    /// By ticket type index.
    pub types: Vec<(usize, Vec<TypeFieldError>)>,
    /// Beside "Add ticket type" (`tiers-error`).
    pub tiers: Vec<String>,
    /// At the top of "Tickets and seating" (`seating-error`).
    pub seating: Vec<String>,
    /// Event-detail and seating fields (`name`, the times, `maxTicketsPerCustomer`, `layoutId`,
    /// `levelPrices`, `levelPrices.<id>`, `offSale`, …).
    pub fields: Vec<(String, Vec<String>)>,
    /// Messages that name no field, shown next to submit (`submit-error`).
    pub unmapped: Vec<String>,
}

impl PlacedErrors {
    /// The messages placed on a field.
    pub fn field(&self, key: &str) -> Option<&Vec<String>> {
        self.fields.iter().find(|(k, _)| k == key).map(|(_, m)| m)
    }

    /// The messages placed on ticket type `index`.
    pub fn type_errors(&self, index: usize) -> &[TypeFieldError] {
        self.types
            .iter()
            .find(|(i, _)| *i == index)
            .map_or(&[], |(_, e)| e.as_slice())
    }

    fn add_field(&mut self, path: &str, message: &str) {
        match self.fields.iter_mut().find(|(k, _)| k == path) {
            Some((_, m)) => m.push(message.to_string()),
            None => self
                .fields
                .push((path.to_string(), vec![message.to_string()])),
        }
    }

    fn add_type(&mut self, index: usize, field: &str, message: &str) {
        let error = TypeFieldError {
            field: field.to_string(),
            message: message.to_string(),
        };
        match self.types.iter_mut().find(|(i, _)| *i == index) {
            Some((_, e)) => e.push(error),
            None => self.types.push((index, vec![error])),
        }
    }

    /// `place` in `fieldErrors`.
    fn place(&mut self, path: &str, message: &str, exact: bool) {
        if let Some(m) = TYPE_PATH.find(path) {
            let index = m
                .group(1)
                .map_or(usize::MAX, |r| path[r].parse().unwrap_or(usize::MAX));
            let field = m.group(2).map_or("", |r| &path[r]);
            self.add_type(index, field, message);
            return;
        }
        let tiers = if exact {
            path == "tiers"
        } else {
            TIERS_LOOSE.find(path).is_some()
        };
        if tiers {
            self.tiers.push(message.to_string());
            return;
        }
        let head = if exact {
            path
        } else {
            path.split(' ').next().unwrap_or("")
        };
        if head == "totalTicketCapacity" {
            self.seating.push(message.to_string());
            return;
        }
        if let Some(m) = SEATING_PATH.find(head) {
            let key = m.group(1).map_or("", |r| &head[r]);
            self.add_field(key, message);
            return;
        }
        if DETAIL_PATH.find(head).is_some() {
            self.add_field(head, message);
            return;
        }
        self.unmapped.push(message.to_string());
    }
}

static TYPE_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^tiers\.(\d+)\.(\w+)").expect("a valid pattern"));
static TIERS_LOOSE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^tiers[ .]").expect("a valid pattern"));
static SEATING_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(layoutId|levelPrices|offSale)(\.|$)").expect("a valid pattern")
});
static DETAIL_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(name|locationId|startsAt|endsAt|doorsOpenAt|maxTicketsPerCustomer)$")
        .expect("a valid pattern")
});

/// Ports `fieldErrors`: reads the path a refusal names, from `details.field` (exactly the path)
/// or from the start of each `details.fields` entry; a `levelPrices` refusal with
/// `details.levels` goes on each level's box; `DOORS_OPEN_OUT_OF_RANGE` on the doors. Unmapped
/// messages stay next to submit. An error with no answer (which the TypeScript cannot read) is an
/// unmapped message too.
pub fn field_errors(error: Option<&ApiError>) -> PlacedErrors {
    let mut placed = PlacedErrors::default();
    let Some(error) = error else {
        return placed;
    };
    let message = error.message();
    let details = error.details();
    let field = details.and_then(|d| d.get("field")).and_then(Value::as_str);
    let levels = details
        .and_then(|d| d.get("levels"))
        .and_then(Value::as_array)
        .filter(|l| !l.is_empty());
    match (field, levels) {
        (Some("levelPrices"), Some(levels)) => {
            for level in levels {
                if let Some(id) = level.get("levelId").and_then(Value::as_str) {
                    placed.add_field(&format!("levelPrices.{id}"), message);
                }
            }
        }
        (Some(f), _) => placed.place(f, message, true),
        _ => {}
    }
    let fields = details
        .and_then(|d| d.get("fields"))
        .and_then(Value::as_array);
    if field.is_none()
        && let Some(entries) = fields
    {
        for entry in entries.iter().filter_map(Value::as_str) {
            placed.place(entry, entry, false);
        }
    }
    if field.is_none() && fields.is_none() {
        if error.code() == Some("DOORS_OPEN_OUT_OF_RANGE") {
            placed.add_field("doorsOpenAt", message);
        } else if !message.is_empty() {
            placed.unmapped.push(message.to_string());
        }
    }
    placed
}

/// Ports `SoldCounts`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SoldCounts {
    pub event_sold: i64,
    pub sold_by_tier: BTreeMap<String, i64>,
}

/// Ports `visibleErrors`: the preview errors of the fields left, or all after submit.
pub fn visible_errors(
    all: &FieldMessages,
    touched: &BTreeSet<String>,
    submitted: bool,
) -> FieldMessages {
    if submitted {
        return all.clone();
    }
    let mut shown = FieldMessages::default();
    for (k, m) in all.iter() {
        if touched.contains(k) {
            shown.set(k, m);
        }
    }
    shown
}

// ---------------------------------------------------------------- EventForm.tsx helpers

/// Ports `localWithOccurrence`: a venue-local value for `instant`, and which occurrence it is when
/// that local time repeats.
pub fn local_with_occurrence(instant: DateTime<Utc>, zone: &str) -> (String, Occurrence) {
    let local = to_local_date_time(instant, zone);
    let occ = occurrence_of(&local, instant, zone);
    (local, occ)
}

/// The occurrence `instant` is of `local` (its own offset names it), `Unset` unless repeated.
fn occurrence_of(local: &str, instant: DateTime<Utc>, zone: &str) -> Occurrence {
    match resolve_field(local, zone) {
        Some(ResolvedLocal::Repeated { first, .. }) => {
            let own = to_offset_date_time(instant, zone).unwrap_or_default();
            if own.ends_with(&first.offset) {
                Occurrence::First
            } else {
                Occurrence::Second
            }
        }
        _ => Occurrence::Unset,
    }
}

/// What [`new_event_times`] returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEventTimes {
    pub starts_at: String,
    pub ends_at: String,
    pub doors_open_at: String,
    pub occurrence: Occurrences,
}

/// Ports `newEventTimes`: a new event's Starts (the next whole hour), Ends (4 hours later), and
/// Doors open (1 hour before the start), in `zone`.
pub fn new_event_times(now: DateTime<Utc>, zone: &str) -> NewEventTimes {
    let instants = default_event_instants(now);
    let (start, start_occ) = local_with_occurrence(instants.starts_at, zone);
    let (end, end_occ) = local_with_occurrence(instants.ends_at, zone);
    let (doors, doors_occ) = local_with_occurrence(
        doors_instant_before_start(instants.starts_at, DEFAULT_DOORS_OFFSET_MINUTES),
        zone,
    );
    NewEventTimes {
        starts_at: start,
        ends_at: end,
        doors_open_at: doors,
        occurrence: Occurrences {
            starts_at: start_occ,
            ends_at: end_occ,
            doors_open_at: doors_occ,
        },
    }
}

/// `cents`: "45.5" → 4550, so prices compare as money rather than as text (`Math.round(Number(p)
/// * 100)`; a price that is not a number never compares lower).
fn cents(price: &str) -> f64 {
    (js_number(price) * 100.0).round()
}

/// Ports `lowestPrice`: a general-admission event's base price, its lowest type price, trimmed.
pub fn lowest_price(types: &[TicketType]) -> String {
    let Some(first) = types.first() else {
        return String::new();
    };
    types
        .iter()
        .skip(1)
        .fold(first, |low, t| {
            if cents(&t.price) < cents(&low.price) {
                t
            } else {
                low
            }
        })
        .price
        .trim()
        .to_string()
}

/// Ports `lowestLevelPrice`: a seated event's base price, its lowest typed level price, else
/// `fallback`, else "0.00".
pub fn lowest_level_price(prices: &[String], fallback: &str) -> String {
    let typed: Vec<&str> = prices
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    match typed.split_first() {
        Some((first, rest)) => rest
            .iter()
            .fold(*first, |low, p| if cents(p) < cents(low) { p } else { low })
            .to_string(),
        None if fallback.is_empty() => "0.00".into(),
        None => fallback.to_string(),
    }
}

/// Ports `noAnswerFrom`: a schedule that got no answer (a failed send, or a 5xx without the
/// Backend's envelope) may or may not have been saved.
pub fn no_answer_from(error: &ApiError) -> bool {
    match error {
        ApiError::Status(e) => e.status >= 500 && !e.enveloped,
        _ => true,
    }
}

// ---------------------------------------------------------------- payloads the form reads

/// A venue as `listLocations` (or the event's `location`) gives it, as far as the form reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Venue {
    pub id: String,
    pub name: String,
    pub seating_capacity: i64,
    #[serde(default)]
    pub time_zone: Option<String>,
}

/// An event as `getEvent` gives it, as far as the edit form reads it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLoad {
    pub name: String,
    pub location_id: String,
    #[serde(default)]
    pub location: Option<Venue>,
    pub starts_at: String,
    pub ends_at: String,
    #[serde(default)]
    pub doors_open_at: Option<String>,
    pub total_ticket_capacity: i64,
    #[serde(default)]
    pub max_tickets_per_customer: Option<i64>,
    #[serde(default)]
    pub layout_id: Option<String>,
    #[serde(default)]
    pub reserved_seating: bool,
    pub base_price: String,
    #[serde(default)]
    pub images: Option<Vec<EventImage>>,
}

/// A ticket type as `listTiers` gives it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    pub id: String,
    pub name: String,
    pub price: String,
    pub quantity: i64,
}

/// One level of [`EventSeating`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSeatingLevel {
    pub level_id: String,
    pub price: Option<String>,
}

/// The contract's `EventSeating` (`getEventSeating`), as far as the form reads it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSeating {
    pub layout_id: Option<String>,
    pub levels: Vec<EventSeatingLevel>,
    pub off_sale: Vec<OffSaleSelector>,
    pub seats_on_sale: i64,
}

/// One tier of [`Availability`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TierAvailability {
    pub tier_id: String,
    pub tickets_left: i64,
}

/// The contract's `Availability` (`getAvailability`), as far as the form reads it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub tickets_left: i64,
    pub tiers: Vec<TierAvailability>,
}

/// What an edit has sold (`EventForm.tsx`, spec 038 FR-010): a seated event's seats on sale less
/// its tickets left, plus each type's quantity less its tickets left.
pub fn sold_counts(
    tiers: &[Tier],
    seating: Option<&EventSeating>,
    availability: &Availability,
) -> SoldCounts {
    let mut event_sold = match seating {
        Some(s) if s.layout_id.is_some() => (s.seats_on_sale - availability.tickets_left).max(0),
        _ => 0,
    };
    let mut sold_by_tier = BTreeMap::new();
    for t in tiers {
        let left = availability
            .tiers
            .iter()
            .find(|row| row.tier_id == t.id)
            .map(|row| row.tickets_left);
        let sold = left.map_or(0, |l| (t.quantity - l).max(0));
        sold_by_tier.insert(t.id.clone(), sold);
        event_sold += sold;
    }
    SoldCounts {
        event_sold,
        sold_by_tier,
    }
}

// ---------------------------------------------------------------- the form's state

/// Ports `SeatingDraft` (`SeatingSection.tsx`): what the form sends of its seating.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SeatingDraft {
    /// `None` for general admission.
    pub layout_id: Option<String>,
    /// The typed price of each level, by level id.
    pub prices: BTreeMap<String, String>,
    pub off_sale: Vec<OffSaleSelector>,
}

/// Ports `DateTimeFields`' state: one time field's joined local value (`YYYY-MM-DDTHH:mm`, or ''
/// unless both halves are given) and its two controls' halves, kept so filling the date and then
/// the time does not lose the first half.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TimeInput {
    /// The form's value for the field.
    pub value: String,
    /// The date control's value.
    pub date: String,
    /// The time control's value.
    pub time: String,
    /// The last value the pair sent up: an echo of it does not reset the halves.
    emitted: String,
}

impl TimeInput {
    fn of(value: String) -> Self {
        let parts = split_local_date_time(&value);
        Self {
            date: parts.date,
            time: parts.time,
            emitted: value.clone(),
            value,
        }
    }

    /// The form set the value itself: the halves follow unless it is the pair's own echo.
    fn set_outside(&mut self, value: String) {
        if value != self.emitted {
            let parts = split_local_date_time(&value);
            self.date = parts.date;
            self.time = parts.time;
            self.emitted = value.clone();
        }
        self.value = value;
    }

    /// The pair is mounted again (doors' controls, on switching to "At a set time").
    fn remount(&mut self) {
        *self = Self::of(self.value.clone());
    }
}

/// A read the form asks for when a section is opened or its seats are needed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SectionRequest {
    /// `GET /layouts/{layoutId}/sections/{sectionId}`; answer with
    /// [`EventFormState::section_loaded`] or [`EventFormState::section_failed`].
    Layout {
        layout_id: String,
        section_id: String,
    },
    /// On edit of the saved layout, `GET /events/{id}/venue-map/sections/{sectionId}`; answer with
    /// [`EventFormState::taken_loaded`] (a failure is ignored: the Backend refuses a taken seat).
    VenueMap {
        event_id: String,
        section_id: String,
    },
}

/// What [`EventFormState::submit`] asks for.
#[derive(Debug, Clone, PartialEq)]
pub enum Submit {
    /// A known problem: nothing is sent; focus the control with this id.
    Invalid { focus: Option<String> },
    /// Nothing sent and nothing to show (a time that names no moment without a venue to check it:
    /// quirk kept).
    Nothing,
    /// `POST /events` with this `EventInput`.
    Create(Value),
    /// `PATCH /events/{event_id}` with this `EventUpdate`.
    Update { event_id: String, body: Value },
}

/// Under a time field: a skipped time's message, or the question for a repeated one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimeNote {
    Skipped(String),
    Repeated {
        /// "Which 1:30 AM?"
        legend: String,
        /// "1:30 AM EDT (the first time)"
        first: String,
        /// "1:30 AM EST (the second time)"
        second: String,
        chosen: Occurrence,
    },
}

/// One row of the price table (M9).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LevelRow {
    pub id: String,
    pub name: String,
    /// `level-swatch level-swatch--{color}`.
    pub swatch_class: String,
    pub on_sale: i64,
    /// Seats on sale, grouped.
    pub on_sale_text: String,
    /// The price box shows; else [`ALL_OFF_SALE`].
    pub price_box: bool,
    /// `price-{levelId}`.
    pub price_id: String,
    /// "{level} price".
    pub price_label: String,
    pub price: String,
}

/// What the edit form receives after a create whose pictures were not all added (spec 014
/// FR-018): replace-navigate to `path` handing over `files` and showing `notice`.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingImages<F> {
    pub path: String,
    pub files: Vec<F>,
    pub notice: String,
}

/// A picked file known only by its name, for a form that needs no browser file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedFile(pub String);

impl ImageFile for NamedFile {
    fn name(&self) -> String {
        self.0.clone()
    }
}

const EMPTY_TAKEN: &TakenSeats = &BTreeMap::new();

/// Ports `EventForm`'s state: the Schedule event and Edit event form (E2–E8, E15, E16, M8–M11).
/// `F` is the picked-file type of its pictures.
#[derive(Debug, Clone)]
pub struct EventFormState<F = NamedFile> {
    pub is_edit: bool,
    /// The edited event, or the one just created.
    pub event_id: Option<String>,
    pub venues: Vec<Venue>,
    /// The edited event's own venue, standing in while the venue list has not arrived.
    pub event_venue: Option<Venue>,
    pub name: String,
    pub location_id: String,
    pub starts: TimeInput,
    pub ends: TimeInput,
    pub doors: TimeInput,
    pub starts_touched: bool,
    pub ends_touched: bool,
    pub doors_mode: DoorsMode,
    /// The chosen length; `None` for an off-step gap ("Choose a length…").
    pub doors_offset_minutes: Option<i64>,
    /// Once a save was tried, the range message under Doors open is announced.
    pub doors_checked: bool,
    pub occurrence: Occurrences,
    pub total_ticket_capacity: String,
    pub max_per_customer: String,
    /// An edited event that has a layout (or reserved seating).
    pub event_seated: bool,
    pub stored_base_price: String,
    pub venue_layouts: Vec<LayoutSummary>,
    pub layouts_ready: bool,
    pub seating: SeatingDraft,
    pub stored_layout_id: Option<String>,
    /// On edit, the event's seating could not be read.
    pub seating_missing: bool,
    /// The chosen layout as last loaded (maybe the previous one while the next loads).
    pub detail: Option<LayoutDetail>,
    pub section_seats: BTreeMap<String, LayoutSectionSeats>,
    pub taken: BTreeMap<String, TakenSeats>,
    /// The event the price boxes were started from.
    pub prices_from: Option<String>,
    /// A layout was just chosen: its latest prices fill the boxes once it loads.
    pub seed_prices: bool,
    /// "layoutId/sectionId" reads already asked for.
    pub requested: BTreeSet<String>,
    /// The off-sale tool's open section.
    pub open_section_id: Option<String>,
    pub types: Vec<TicketType>,
    pub types_loaded: bool,
    pub types_failed: bool,
    pub touched: BTreeSet<String>,
    pub submitted: bool,
    /// The polite live region's text (`form-status`); see [`EventFormState::refresh_live`].
    pub live: String,
    announced: BTreeSet<String>,
    pub sold: SoldCounts,
    /// The Backend's refusal, placed by [`field_errors`].
    pub error: Option<ApiError>,
    pub no_answer: bool,
    pub saved: bool,
    pub busy: bool,
    pub images: ImageList<F>,
    pub images_notice: Option<String>,
}

impl<F: ImageFile> EventFormState<F> {
    fn blank(is_edit: bool) -> Self {
        Self {
            is_edit,
            event_id: None,
            venues: Vec::new(),
            event_venue: None,
            name: String::new(),
            location_id: String::new(),
            starts: TimeInput::default(),
            ends: TimeInput::default(),
            doors: TimeInput::default(),
            starts_touched: is_edit,
            ends_touched: is_edit,
            doors_mode: DoorsMode::Before,
            doors_offset_minutes: Some(DEFAULT_DOORS_OFFSET_MINUTES),
            doors_checked: false,
            occurrence: Occurrences::default(),
            total_ticket_capacity: String::new(),
            max_per_customer: String::new(),
            event_seated: false,
            stored_base_price: String::new(),
            venue_layouts: Vec::new(),
            layouts_ready: false,
            seating: SeatingDraft::default(),
            stored_layout_id: None,
            seating_missing: false,
            detail: None,
            section_seats: BTreeMap::new(),
            taken: BTreeMap::new(),
            prices_from: None,
            seed_prices: false,
            requested: BTreeSet::new(),
            open_section_id: None,
            types: vec![TicketType::default()],
            types_loaded: !is_edit,
            types_failed: false,
            touched: BTreeSet::new(),
            submitted: false,
            live: String::new(),
            announced: BTreeSet::new(),
            sold: SoldCounts::default(),
            error: None,
            no_answer: false,
            saved: false,
            busy: false,
            images: ImageList::default(),
            images_notice: None,
        }
    }

    /// Schedule event: today's next whole hour, 4 hours long, doors 1 hour before, in Eastern
    /// until a venue is chosen (036 FR-017).
    pub fn new_event(now: DateTime<Utc>) -> Self {
        let mut f = Self::blank(false);
        let defaults = new_event_times(now, DEFAULT_TIME_ZONE);
        f.starts = TimeInput::of(defaults.starts_at);
        f.ends = TimeInput::of(defaults.ends_at);
        f.doors = TimeInput::of(defaults.doors_open_at);
        f.occurrence = defaults.occurrence;
        f
    }

    /// Edit event: `GET /events/{id}` ([`Self::event_loaded`]), then its tiers, seating, and
    /// availability together ([`Self::tiers_loaded`] or [`Self::tiers_failed`]).
    pub fn edit(event_id: &str) -> Self {
        let mut f = Self::blank(true);
        f.event_id = Some(event_id.to_string());
        f
    }

    // ------------------------------------------------------------ loads

    /// `listLocations` answered (a failure is an empty list).
    pub fn venues_loaded(&mut self, venues: Vec<Venue>) {
        self.venues = venues;
    }

    /// `listVenueLayouts(locationId)` answered.
    /// A new event starts on the venue's first layout that has seats (the list is by name); the
    /// admin can still choose General admission. An edit keeps the event's own seating.
    pub fn layouts_loaded(&mut self, layouts: Vec<LayoutSummary>) {
        if self.location_id.is_empty() {
            return;
        }
        let first = if self.event_id.is_none() {
            layouts
                .iter()
                .find(|l| l.seat_count > 0)
                .map(|l| l.id.clone())
        } else {
            None
        };
        self.venue_layouts = layouts;
        self.layouts_ready = true;
        if let Some(layout_id) = first {
            self.choose_layout_inner(Some(layout_id));
        }
    }

    /// `listVenueLayouts` failed: counts as none.
    pub fn layouts_failed(&mut self) {
        self.layouts_loaded(Vec::new());
    }

    /// `getEvent` answered on edit; `pending` are the pictures handed over after a create.
    pub fn event_loaded(&mut self, event: &EventLoad, pending: Vec<F>) {
        self.images
            .load(event.images.clone().unwrap_or_default(), pending);
        self.name = event.name.clone();
        self.location_id = event.location_id.clone();
        self.event_venue = event.location.clone();
        let zone = event
            .location
            .as_ref()
            .and_then(|l| l.time_zone.clone())
            .unwrap_or_else(|| DEFAULT_TIME_ZONE.to_string());
        let local = |iso: &str| -> (String, Occurrence) {
            parse_instant(iso).map_or((String::new(), Occurrence::Unset), |at| {
                local_with_occurrence(at, &zone)
            })
        };
        let (start, start_occ) = local(&event.starts_at);
        let (end, end_occ) = local(&event.ends_at);
        self.starts.set_outside(start);
        self.ends.set_outside(end);
        let start_at = parse_instant(&event.starts_at);
        let mut mode = DoorsMode::Before;
        let mut offset = Some(DEFAULT_DOORS_OFFSET_MINUTES);
        let (doors, doors_occ) = match &event.doors_open_at {
            Some(stored) => {
                match (start_at, parse_instant(stored)) {
                    (Some(s), Some(d)) => {
                        let gap_ms = (s - d).num_milliseconds();
                        mode = doors_mode_for_stored_gap_ms(gap_ms);
                        offset = (mode == DoorsMode::Before).then_some(gap_ms / 60_000);
                    }
                    _ => {
                        mode = DoorsMode::AtTime;
                        offset = None;
                    }
                }
                local(stored)
            }
            // No stored doors (a Backend before 025): 1 hour before the stored start.
            None => start_at.map_or((String::new(), Occurrence::Unset), |s| {
                local_with_occurrence(
                    doors_instant_before_start(s, DEFAULT_DOORS_OFFSET_MINUTES),
                    &zone,
                )
            }),
        };
        self.doors.set_outside(doors);
        self.doors_mode = mode;
        self.doors_offset_minutes = offset;
        self.occurrence = Occurrences {
            starts_at: start_occ,
            ends_at: end_occ,
            doors_open_at: doors_occ,
        };
        self.total_ticket_capacity = event.total_ticket_capacity.to_string();
        self.max_per_customer = event
            .max_tickets_per_customer
            .map_or(String::new(), |n| n.to_string());
        self.event_seated = event.layout_id.is_some() || event.reserved_seating;
        self.stored_base_price = event.base_price.clone();
    }

    /// `getEvent` failed on edit: its message goes by the buttons.
    pub fn event_failed(&mut self, error: ApiError) {
        self.error = Some(error);
    }

    /// `listTiers` answered, with `getEventSeating` and `getAvailability` (each `None` when it
    /// failed).
    pub fn tiers_loaded(
        &mut self,
        tiers: &[Tier],
        seating: Option<&EventSeating>,
        availability: Option<&Availability>,
    ) {
        self.types = if tiers.is_empty() {
            vec![TicketType::default()]
        } else {
            tiers
                .iter()
                .map(|t| TicketType {
                    id: Some(t.id.clone()),
                    name: t.name.clone(),
                    price: t.price.clone(),
                    quantity: t.quantity.to_string(),
                })
                .collect()
        };
        self.types_loaded = true;
        self.seating_missing = seating.is_none();
        if let Some(s) = seating
            && let Some(layout_id) = &s.layout_id
        {
            self.stored_layout_id = Some(layout_id.clone());
            self.seating = SeatingDraft {
                layout_id: Some(layout_id.clone()),
                prices: s
                    .levels
                    .iter()
                    .filter_map(|l| l.price.clone().map(|p| (l.level_id.clone(), p)))
                    .collect(),
                off_sale: s.off_sale.clone(),
            };
        }
        if let Some(a) = availability {
            self.sold = sold_counts(tiers, seating, a);
        }
    }

    /// `listTiers` failed: the form saves the event's details alone.
    pub fn tiers_failed(&mut self) {
        self.types_failed = true;
    }

    /// The layout whose `GET /layouts/{id}` the form needs, while it is not loaded.
    pub fn needs_layout(&self) -> Option<String> {
        self.layout_detail()
            .is_none()
            .then(|| self.seating.layout_id.clone())
            .flatten()
    }

    /// `GET /layouts/{id}` answered. An answer for a layout no longer chosen is dropped; a layout
    /// just chosen starts its price boxes from its latest prices (M9).
    pub fn layout_loaded(&mut self, detail: LayoutDetail) {
        if self.seating.layout_id.as_deref() != Some(detail.id.as_str()) {
            return;
        }
        if self.seed_prices {
            self.seed_prices = false;
            if let Some(latest) = &detail.latest_prices {
                self.seating.prices = latest
                    .prices
                    .iter()
                    .map(|p| (p.level_id.clone(), p.price.clone()))
                    .collect();
                self.prices_from = Some(latest.event_name.clone());
            }
        }
        self.detail = Some(detail);
    }

    // ------------------------------------------------------------ edits

    fn clear_server(&mut self) {
        self.error = None;
    }

    /// Event name changed.
    pub fn set_name(&mut self, value: &str) {
        self.clear_server();
        self.name = value.to_string();
    }

    /// Venue changed: general admission again; repeated times asked again; while no time was
    /// changed (new event, "Before the start"), the defaults are recomputed in the venue's zone,
    /// else doors (Before mode) and an unchanged Ends follow the start in it. The app then reads
    /// the venue's layouts ([`Self::layouts_loaded`]).
    pub fn choose_venue(&mut self, location_id: &str, now: DateTime<Utc>) {
        self.clear_server();
        if self.location_id != location_id {
            self.layouts_ready = false;
        }
        self.location_id = location_id.to_string();
        self.choose_layout_inner(None);
        self.occurrence = Occurrences::default();
        let Some(next) = self.venues.iter().find(|v| v.id == location_id) else {
            return;
        };
        let zone = next
            .time_zone
            .clone()
            .unwrap_or_else(|| DEFAULT_TIME_ZONE.to_string());
        let minutes = self.doors_offset_minutes;
        if !self.is_edit
            && !self.starts_touched
            && !self.ends_touched
            && self.doors_mode == DoorsMode::Before
        {
            let fresh = new_event_times(now, &zone);
            self.starts.set_outside(fresh.starts_at.clone());
            self.ends.set_outside(fresh.ends_at);
            self.occurrence.starts_at = fresh.occurrence.starts_at;
            self.occurrence.ends_at = fresh.occurrence.ends_at;
            self.apply_doors_offset(&fresh.starts_at, fresh.occurrence.starts_at, &zone, minutes);
            return;
        }
        let start = self.starts.value.clone();
        self.apply_doors_offset(&start, Occurrence::Unset, &zone, minutes);
        self.follow_end(&start, Occurrence::Unset, &zone);
    }

    /// A time field's value.
    pub fn time(&self, field: TimeField) -> &TimeInput {
        match field {
            TimeField::StartsAt => &self.starts,
            TimeField::EndsAt => &self.ends,
            TimeField::DoorsOpenAt => &self.doors,
        }
    }

    fn time_mut(&mut self, field: TimeField) -> &mut TimeInput {
        match field {
            TimeField::StartsAt => &mut self.starts,
            TimeField::EndsAt => &mut self.ends,
            TimeField::DoorsOpenAt => &mut self.doors,
        }
    }

    /// A time field's date control changed (`{field}-date`). The same value is no change.
    pub fn set_date(&mut self, field: TimeField, date: &str) {
        let input = self.time_mut(field);
        if input.date == date {
            return;
        }
        input.date = date.to_string();
        self.half_changed(field);
    }

    /// A time field's time control changed (`{field}-time`). The same value is no change.
    pub fn set_time(&mut self, field: TimeField, time: &str) {
        let input = self.time_mut(field);
        if input.time == time {
            return;
        }
        input.time = time.to_string();
        self.half_changed(field);
    }

    fn half_changed(&mut self, field: TimeField) {
        let input = self.time_mut(field);
        let joined = join_local_date_time(&input.date, &input.time);
        input.emitted = joined.clone();
        input.value = joined.clone();
        self.clear_server();
        let zone = self.venue_zone();
        match field {
            TimeField::StartsAt => {
                self.starts_touched = true;
                self.occurrence.starts_at = Occurrence::Unset;
                self.apply_doors_offset(
                    &joined,
                    Occurrence::Unset,
                    &zone,
                    self.doors_offset_minutes,
                );
                self.follow_end(&joined, Occurrence::Unset, &zone);
            }
            TimeField::EndsAt => {
                self.ends_touched = true;
                self.occurrence.ends_at = Occurrence::Unset;
            }
            TimeField::DoorsOpenAt => self.occurrence.doors_open_at = Occurrence::Unset,
        }
    }

    /// "Which 1:30 AM?" answered: a change to that field (doors and Ends follow a start).
    pub fn choose_occurrence(&mut self, field: TimeField, value: Occurrence) {
        self.occurrence.set(field, value);
        let zone = self.venue_zone();
        match field {
            TimeField::StartsAt => {
                self.starts_touched = true;
                let start = self.starts.value.clone();
                self.apply_doors_offset(&start, value, &zone, self.doors_offset_minutes);
                self.follow_end(&start, value, &zone);
            }
            TimeField::EndsAt => self.ends_touched = true,
            TimeField::DoorsOpenAt => {}
        }
    }

    /// `applyDoorsOffset`: in "Before the start" mode with a length, doors follow the start.
    fn apply_doors_offset(
        &mut self,
        local: &str,
        chosen: Occurrence,
        zone: &str,
        minutes: Option<i64>,
    ) {
        if self.doors_mode != DoorsMode::Before {
            return;
        }
        if let Some(m) = minutes {
            self.set_doors_from_start(local, chosen, zone, m);
        }
    }

    /// `setDoorsFromStart`: doors at the start minus `minutes`, once the start names one moment.
    fn set_doors_from_start(&mut self, local: &str, chosen: Occurrence, zone: &str, minutes: i64) {
        let Some(m) = resolve_field(local, zone).and_then(|r| moment_of(&r, chosen)) else {
            return;
        };
        let (value, occ) =
            local_with_occurrence(doors_instant_before_start(m.instant, minutes), zone);
        self.doors.set_outside(value);
        self.occurrence.doors_open_at = occ;
    }

    /// `followEnd`: until Ends is changed, it follows a start that names one moment, +4 h.
    fn follow_end(&mut self, local: &str, chosen: Occurrence, zone: &str) {
        if self.ends_touched {
            return;
        }
        let Some(m) = resolve_field(local, zone).and_then(|r| moment_of(&r, chosen)) else {
            return;
        };
        let (end, occ) = local_with_occurrence(
            m.instant + Duration::minutes(DEFAULT_EVENT_LENGTH_MINUTES),
            zone,
        );
        self.ends.set_outside(end);
        self.occurrence.ends_at = occ;
    }

    /// The Doors open radios ("Before the start" / "At a set time"). Switching keeps the instant;
    /// an off-step gap shows no length; doors that name no moment are derived from the start.
    pub fn switch_doors_mode(&mut self, next: DoorsMode) {
        if next == self.doors_mode {
            return;
        }
        self.clear_server();
        if next == DoorsMode::AtTime {
            self.doors_mode = DoorsMode::AtTime;
            self.doors.remount();
            return;
        }
        let start = self.moment(TimeField::StartsAt);
        let doors = self.moment(TimeField::DoorsOpenAt);
        match (&start, doors) {
            (Some(s), Some(d)) => {
                let ms = (s.instant - d.instant).num_milliseconds();
                self.doors_offset_minutes = (ms % 60_000 == 0
                    && is_exact_doors_offset_minutes(ms / 60_000))
                .then_some(ms / 60_000);
            }
            _ => {
                let minutes = self
                    .doors_offset_minutes
                    .unwrap_or(DEFAULT_DOORS_OFFSET_MINUTES);
                self.doors_offset_minutes = Some(minutes);
                if start.is_some() {
                    let (local, occ, zone) = (
                        self.starts.value.clone(),
                        self.occurrence.starts_at,
                        self.venue_zone(),
                    );
                    self.set_doors_from_start(&local, occ, &zone, minutes);
                }
            }
        }
        self.doors_mode = DoorsMode::Before;
    }

    /// "How long before the start" changed.
    pub fn set_doors_offset(&mut self, minutes: i64) {
        self.clear_server();
        self.doors_offset_minutes = Some(minutes);
        let (local, occ, zone) = (
            self.starts.value.clone(),
            self.occurrence.starts_at,
            self.venue_zone(),
        );
        self.set_doors_from_start(&local, occ, &zone, minutes);
    }

    /// A ticket type's input changed.
    pub fn set_type(&mut self, index: usize, field: TypeField, value: &str) {
        self.clear_server();
        if let Some(t) = self.types.get_mut(index) {
            let slot = match field {
                TypeField::Name => &mut t.name,
                TypeField::Price => &mut t.price,
                TypeField::Quantity => &mut t.quantity,
            };
            *slot = value.to_string();
        }
    }

    /// "Add ticket type" (a Backend refusal stays: quirk kept).
    pub fn add_type(&mut self) {
        self.types.push(TicketType::default());
    }

    /// "Remove ticket type N" (a Backend refusal stays: quirk kept).
    pub fn remove_type(&mut self, index: usize) {
        if index < self.types.len() {
            self.types.remove(index);
        }
    }

    /// Total tickets changed.
    pub fn set_total(&mut self, value: &str) {
        self.clear_server();
        self.total_ticket_capacity = value.to_string();
    }

    /// Tickets per customer changed.
    pub fn set_limit(&mut self, value: &str) {
        self.clear_server();
        self.max_per_customer = value.to_string();
    }

    /// The browser found Tickets per customer invalid on submit: its bubble is suppressed and the
    /// form's own check shows instead.
    pub fn limit_invalid(&mut self) {
        self.touched.insert("maxTicketsPerCustomer".into());
        self.submitted = true;
    }

    /// A field was left: its check shows from now on (`name`, `locationId`, `doorsOpenAt`,
    /// `startsAt`, `endsAt`, `tiers.N.<field>`, `totalTicketCapacity`, `maxTicketsPerCustomer`,
    /// `layoutId`, `levelPrices.<id>`).
    pub fn blur(&mut self, key: &str) {
        self.touched.insert(key.to_string());
    }

    /// The Seating select changed: another layout, or general admission (`None`); prices and
    /// seats off sale restart.
    /// The layout already chosen (a new event starts on one) keeps its prices.
    pub fn choose_layout(&mut self, layout_id: Option<&str>) {
        self.clear_server();
        if self.seating.layout_id.as_deref() == layout_id {
            return;
        }
        self.choose_layout_inner(layout_id.map(str::to_string));
    }

    fn choose_layout_inner(&mut self, layout_id: Option<String>) {
        self.seed_prices = layout_id.is_some();
        self.requested.clear();
        self.section_seats.clear();
        self.taken.clear();
        self.prices_from = None;
        self.open_section_id = None;
        self.detail = None;
        self.seating = SeatingDraft {
            layout_id,
            ..SeatingDraft::default()
        };
    }

    /// A level's price box changed.
    pub fn set_level_price(&mut self, level_id: &str, price: &str) {
        self.clear_server();
        self.seating
            .prices
            .insert(level_id.to_string(), price.to_string());
    }

    /// The seats off sale changed (already compacted).
    pub fn set_off_sale(&mut self, selectors: Vec<OffSaleSelector>) {
        self.clear_server();
        self.seating.off_sale = selectors;
    }

    /// `loadSection`: a section's seats and, on edit of the saved layout, its sold and held seats;
    /// each asked for once per layout.
    fn load_section(&mut self, section_id: &str) -> Vec<SectionRequest> {
        let Some(layout_id) = self.seating.layout_id.clone() else {
            return Vec::new();
        };
        if !self.requested.insert(format!("{layout_id}/{section_id}")) {
            return Vec::new();
        }
        let mut requests = vec![SectionRequest::Layout {
            layout_id: layout_id.clone(),
            section_id: section_id.to_string(),
        }];
        if self.is_edit
            && let Some(event_id) = &self.event_id
            && self.stored_layout_id.as_deref() == Some(layout_id.as_str())
        {
            requests.push(SectionRequest::VenueMap {
                event_id: event_id.clone(),
                section_id: section_id.to_string(),
            });
        }
        requests
    }

    /// "Section {name}" pressed in the off-sale tool: it opens, and its reads are asked for.
    pub fn open_section(&mut self, section_id: &str) -> Vec<SectionRequest> {
        let requests = self.load_section(section_id);
        self.open_section_id = Some(section_id.to_string());
        requests
    }

    /// "Back to all sections".
    pub fn close_section(&mut self) {
        self.open_section_id = None;
    }

    /// The sections the counts by level need (a row or seat off sale, or a section of several
    /// levels), not yet asked for; call after the seats off sale or the layout change.
    pub fn sections_needed(&mut self) -> Vec<SectionRequest> {
        let missing = self.counts().map(|c| c.missing).unwrap_or_default();
        missing
            .iter()
            .flat_map(|id| self.load_section(id))
            .collect()
    }

    /// A section's seats arrived (kept by section id even if the layout changed since: quirk kept).
    pub fn section_loaded(&mut self, seats: LayoutSectionSeats) {
        self.section_seats.insert(seats.section_id.clone(), seats);
    }

    /// A section's read failed: it may be asked for again (the tool keeps "Loading the seats…"
    /// until Back and reopen: quirk kept).
    pub fn section_failed(&mut self, layout_id: &str, section_id: &str) {
        self.requested.remove(&format!("{layout_id}/{section_id}"));
    }

    /// A section's sold and held seats arrived (on edit).
    pub fn taken_loaded(&mut self, section_id: &str, taken: TakenSeats) {
        self.taken.insert(section_id.to_string(), taken);
    }

    fn section_order(&self) -> Vec<String> {
        self.layout_detail()
            .map(|d| d.sections.iter().map(|s| s.id.clone()).collect())
            .unwrap_or_default()
    }

    /// The open section's tool, once its seats are loaded.
    pub fn section_tool(&self) -> Option<SectionTool<'_>> {
        let id = self.open_section_id.as_ref()?;
        self.layout_detail()?
            .sections
            .iter()
            .find(|s| s.id == *id)?;
        let seats = self.section_seats.get(id)?;
        let taken = self.taken.get(id).unwrap_or(EMPTY_TAKEN);
        Some(SectionTool::new(seats, taken, &self.seating.off_sale))
    }

    fn apply_tool(
        &mut self,
        change: impl Fn(&SectionTool<'_>, &[OffSaleSelector], &[String]) -> Option<Vec<OffSaleSelector>>,
    ) {
        let order = self.section_order();
        let next = self
            .section_tool()
            .and_then(|tool| change(&tool, &self.seating.off_sale, &order));
        if let Some(next) = next {
            self.set_off_sale(next);
        }
    }

    /// "Whole section off sale" / "Whole section on sale" in the open section.
    pub fn toggle_whole_section(&mut self) {
        self.apply_tool(|tool, sel, order| Some(tool.toggle_whole(sel, order)));
    }

    /// "Row {label} off sale" in the open section.
    pub fn toggle_row(&mut self, row: u64) {
        self.apply_tool(|tool, sel, order| Some(tool.toggle_row(row, sel, order)));
    }

    /// A seat pressed in the open section (a taken seat does nothing).
    pub fn toggle_seat(&mut self, row: u64, seat: u64) {
        self.apply_tool(|tool, sel, order| tool.toggle_seat(row, seat, sel, order));
    }

    // ------------------------------------------------------------ derived

    /// The chosen venue, else the edited event's own while the list lacks it.
    pub fn selected_venue(&self) -> Option<&Venue> {
        self.venues
            .iter()
            .find(|v| v.id == self.location_id)
            .or(self
                .event_venue
                .as_ref()
                .filter(|v| v.id == self.location_id))
    }

    /// The chosen venue's zone; Eastern until a venue is chosen.
    pub fn venue_zone(&self) -> String {
        self.selected_venue()
            .and_then(|v| v.time_zone.clone())
            .unwrap_or_else(|| DEFAULT_TIME_ZONE.to_string())
    }

    fn venue_capacity(&self) -> Option<i64> {
        self.selected_venue().map(|v| v.seating_capacity)
    }

    fn resolved(&self, field: TimeField) -> Option<ResolvedLocal> {
        resolve_field(&self.time(field).value, &self.venue_zone())
    }

    fn moment(&self, field: TimeField) -> Option<Moment> {
        self.resolved(field)
            .and_then(|r| moment_of(&r, self.occurrence.get(field)))
    }

    /// A layout is chosen (a seated event has no ticket types).
    pub fn seated(&self) -> bool {
        self.seating.layout_id.is_some()
    }

    /// The chosen layout as loaded.
    pub fn layout_detail(&self) -> Option<&LayoutDetail> {
        self.detail
            .as_ref()
            .filter(|d| Some(&d.id) == self.seating.layout_id.as_ref())
    }

    /// Each level's seats off sale and the totals, from the selectors.
    pub fn counts(&self) -> Option<OffSaleCounts> {
        self.layout_detail()
            .map(|d| count_off_sale(d, &self.seating.off_sale, &self.section_seats))
    }

    fn on_sale_of(&self, counts: Option<&OffSaleCounts>, level_id: &str, seat_count: i64) -> i64 {
        seat_count
            - counts
                .and_then(|c| c.off_by_level.get(level_id))
                .copied()
                .unwrap_or(0)
    }

    /// The level ids by rank (the price boxes' focus order).
    pub fn level_ids(&self) -> Vec<String> {
        self.layout_detail()
            .map(|d| d.levels.iter().map(|l| l.id.clone()).collect())
            .unwrap_or_default()
    }

    /// The levels with seats on sale, by rank, and their typed prices.
    fn priced_levels(&self) -> Vec<(String, String)> {
        let counts = self.counts();
        self.layout_detail()
            .map(|d| {
                d.levels
                    .iter()
                    .filter(|l| self.on_sale_of(counts.as_ref(), &l.id, l.seat_count) > 0)
                    .map(|l| {
                        (
                            l.id.clone(),
                            self.seating.prices.get(&l.id).cloned().unwrap_or_default(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// On edit, the types or the seating could not be read: details only.
    pub fn details_only(&self) -> bool {
        !self.types_loaded || (self.event_seated && self.seating_missing)
    }

    /// What the preview checks need of a seated event.
    pub fn seating_preview(&self) -> Option<SeatingPreview> {
        if !self.seated() {
            return None;
        }
        let detail = self.layout_detail();
        let counts = self.counts();
        Some(SeatingPreview {
            seats_on_sale: counts
                .as_ref()
                .map(|c| c.seats_on_sale)
                .or(detail.map(|d| d.seat_count))
                .unwrap_or(1),
            levels: detail
                .map(|d| {
                    d.levels
                        .iter()
                        .map(|l| LevelPreview {
                            id: l.id.clone(),
                            name: l.name.clone(),
                            on_sale: self.on_sale_of(counts.as_ref(), &l.id, l.seat_count),
                            price: self.seating.prices.get(&l.id).cloned().unwrap_or_default(),
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    /// Every problem the form can see now ([`preview_errors`] on the form).
    pub fn preview_all(&self) -> FieldMessages {
        let seating = self.seating_preview();
        let zone = self.venue_zone();
        preview_errors(&PreviewInput {
            name: &self.name,
            location_id: &self.location_id,
            starts_at: &self.starts.value,
            ends_at: &self.ends.value,
            doors_open_at: &self.doors.value,
            venue_zone: &zone,
            has_venue: self.selected_venue().is_some(),
            occurrence: self.occurrence,
            types_loaded: self.types_loaded,
            types: &self.types,
            seating: seating.as_ref(),
            total_ticket_capacity: &self.total_ticket_capacity,
            venue_capacity: self.venue_capacity(),
            max_per_customer: &self.max_per_customer,
            doors_from_start: self.doors_mode == DoorsMode::Before
                && self.doors_offset_minutes.is_some(),
        })
    }

    /// The problems shown: of the fields left, or all after submit.
    pub fn preview(&self) -> FieldMessages {
        visible_errors(&self.preview_all(), &self.touched, self.submitted)
    }

    /// The Backend's refusal, placed.
    pub fn placed(&self) -> PlacedErrors {
        field_errors(self.error.as_ref())
    }

    /// The general-admission seat line's numbers.
    pub fn seat_totals(&self) -> SeatTotals {
        seat_totals(
            &self.types,
            &self.total_ticket_capacity,
            self.venue_capacity(),
        )
    }

    /// The live region: newly shown messages, joined (the `form-status` effect). Call after each
    /// change.
    pub fn refresh_live(&mut self) {
        let preview = self.preview();
        self.announced.retain(|k| preview.has(k));
        let next: Vec<String> = preview
            .keys()
            .into_iter()
            .filter(|k| !self.announced.contains(k))
            .collect();
        if !next.is_empty() {
            self.live = next
                .iter()
                .filter_map(|k| preview.get(k))
                .collect::<Vec<_>>()
                .join(" ");
            self.announced.extend(next);
        } else if preview.is_empty() {
            self.live.clear();
        }
    }

    /// `timeAwareFocusId`: a time field's error focuses its date control, or its time control when
    /// only the time is missing; in "Before the start" mode a doors error focuses the length.
    pub fn focus_target(&self, key: &str) -> String {
        if key == "doorsOpenAt" && self.doors_mode == DoorsMode::Before {
            return "doorsOpenOffset".into();
        }
        let field = match key {
            "startsAt" => TimeField::StartsAt,
            "endsAt" => TimeField::EndsAt,
            "doorsOpenAt" => TimeField::DoorsOpenAt,
            _ => return focus_id_for(key),
        };
        let input = self.time(field);
        if !input.date.is_empty() && input.time.is_empty() {
            format!("{key}-time")
        } else {
            format!("{key}-date")
        }
    }

    // ------------------------------------------------------------ submit and answers

    fn payload(&self, sent: [String; 3]) -> Map<String, Value> {
        let [starts_at, ends_at, doors_open_at] = sent;
        let mut p = Map::new();
        p.insert("name".into(), json!(self.name));
        p.insert("locationId".into(), json!(self.location_id));
        p.insert("startsAt".into(), json!(starts_at));
        p.insert("endsAt".into(), json!(ends_at));
        p.insert("doorsOpenAt".into(), json!(doors_open_at));
        let details_only = self.details_only();
        let seated = self.seated();
        if !seated
            && !(details_only && self.event_seated)
            && !self.total_ticket_capacity.trim().is_empty()
        {
            p.insert(
                "totalTicketCapacity".into(),
                json_number(js_number(&self.total_ticket_capacity)),
            );
        }
        let limit = self.max_per_customer.trim();
        if !limit.is_empty() {
            p.insert(
                "maxTicketsPerCustomer".into(),
                json_number(js_number(limit)),
            );
        } else if self.is_edit {
            p.insert("maxTicketsPerCustomer".into(), Value::Null);
        }
        let base = if details_only {
            self.stored_base_price.clone()
        } else if seated {
            let prices: Vec<String> = self.priced_levels().into_iter().map(|(_, p)| p).collect();
            lowest_level_price(&prices, &self.stored_base_price)
        } else {
            lowest_price(&self.types)
        };
        p.insert("basePrice".into(), json!(base));
        p
    }

    /// The seating fields of a seated event's request: `layoutId`, `levelPrices` for the levels on
    /// sale, and the compacted `offSale`.
    fn seating_input(&self, p: &mut Map<String, Value>) {
        p.insert("layoutId".into(), json!(self.seating.layout_id));
        let prices: Vec<Value> = self
            .priced_levels()
            .into_iter()
            .map(|(id, price)| json!({ "levelId": id, "price": price.trim() }))
            .collect();
        p.insert("levelPrices".into(), Value::Array(prices));
        p.insert(
            "offSale".into(),
            serde_json::to_value(&self.seating.off_sale).unwrap_or(Value::Array(Vec::new())),
        );
    }

    /// The ticket types as the Backend takes them (`tierInput`): trimmed name and price, the
    /// quantity as a number; with `with_ids`, each existing type's `id` (the edit's tier writes).
    pub fn tier_inputs(&self, with_ids: bool) -> Vec<Value> {
        self.types
            .iter()
            .map(|t| {
                let mut v = Map::new();
                if with_ids && let Some(id) = &t.id {
                    v.insert("id".into(), json!(id));
                }
                v.insert("name".into(), json!(t.name.trim()));
                v.insert("price".into(), json!(t.price.trim()));
                v.insert("quantity".into(), json_number(js_number(&t.quantity)));
                Value::Object(v)
            })
            .collect()
    }

    /// `scheduleEvent`'s body (`EventInput`): the event and its ticket types, or its layout, level
    /// prices, and seats off sale, saved all or nothing.
    fn create_body(&self, sent: [String; 3]) -> Value {
        let mut p = self.payload(sent);
        if self.seated() {
            self.seating_input(&mut p);
        } else {
            p.insert("tiers".into(), Value::Array(self.tier_inputs(false)));
        }
        Value::Object(p)
    }

    /// `saveEvent`'s body (`EventUpdate`): details only when the types or seating could not be
    /// read; else the seating, or the ticket types with their ids (and `layoutId: null` when a
    /// seated event goes back to general admission).
    fn update_body(&self, sent: [String; 3]) -> Value {
        let mut p = self.payload(sent);
        if self.details_only() {
            return Value::Object(p);
        }
        if self.seated() {
            self.seating_input(&mut p);
            return Value::Object(p);
        }
        if self.stored_layout_id.is_some() {
            p.insert("layoutId".into(), Value::Null);
        }
        p.insert("tiers".into(), Value::Array(self.tier_inputs(true)));
        Value::Object(p)
    }

    /// "Schedule event" / "Save changes": never sends a known problem (every check shows and the
    /// first field at fault is focused); else the one request to make, and the form is busy.
    /// After it: [`Self::created`] or [`Self::create_failed`]; [`Self::updated`] or
    /// [`Self::save_failed`]; then the picture steps on [`Self::images`], then [`Self::finished`].
    pub fn submit(&mut self) -> Submit {
        self.error = None;
        self.no_answer = false;
        self.saved = false;
        self.images_notice = None;
        self.submitted = true;
        self.doors_checked = true;
        let all = self.preview_all();
        if !all.is_empty() {
            let focus = first_error_key(&all, self.types.len(), &self.level_ids())
                .map(|k| self.focus_target(&k));
            return Submit::Invalid { focus };
        }
        let zone = self.venue_zone();
        let mut sent: [String; 3] = Default::default();
        for (i, field) in [
            TimeField::StartsAt,
            TimeField::EndsAt,
            TimeField::DoorsOpenAt,
        ]
        .into_iter()
        .enumerate()
        {
            let Some(m) = self.moment(field) else {
                return Submit::Nothing;
            };
            let Ok(s) = to_offset_date_time(m.instant, &zone) else {
                return Submit::Nothing;
            };
            sent[i] = s;
        }
        self.busy = true;
        match (&self.event_id, self.is_edit) {
            (Some(id), true) => Submit::Update {
                event_id: id.clone(),
                body: self.update_body(sent),
            },
            _ => Submit::Create(self.create_body(sent)),
        }
    }

    fn refused(&mut self, error: ApiError) -> Option<String> {
        self.busy = false;
        self.error = Some(error);
        let placed = self.placed();
        first_placed_key(&placed, self.types.len(), &self.level_ids())
            .map(|k| self.focus_target(&k))
    }

    /// The create answered with the new event; its pictures go next.
    pub fn created(&mut self, event_id: &str) {
        self.event_id = Some(event_id.to_string());
    }

    /// The create failed: no answer shows the no-answer banner (every value kept); a refusal is
    /// placed on its fields, and the first placed field's control id is returned to focus.
    pub fn create_failed(&mut self, error: ApiError) -> Option<String> {
        if no_answer_from(&error) {
            self.no_answer = true;
            self.busy = false;
            return None;
        }
        self.refused(error)
    }

    /// The update answered; the pictures go next.
    pub fn updated(&mut self) {}

    /// The update failed: placed as [`Self::create_failed`] places a refusal (no answer is a
    /// message by the buttons).
    pub fn save_failed(&mut self, error: ApiError) -> Option<String> {
        self.refused(error)
    }

    /// Every step done: "Event saved.", then the event's page after [`NAVIGATE_AFTER_MS`].
    pub fn finished(&mut self) {
        self.saved = true;
        self.busy = false;
    }

    /// A picture step failed on create: the form becomes the new event's edit form, handed the
    /// pictures not yet added (from the one at `key`) and the notice.
    pub fn image_failed_on_create(
        &mut self,
        key: &str,
        refusal: Option<&ApiError>,
    ) -> PendingImages<F> {
        self.busy = false;
        let files = self.images.remaining_from(key);
        let names: Vec<String> = files.iter().map(ImageFile::name).collect();
        let (first, rest) = names
            .split_first()
            .map_or(("", &[][..]), |(f, r)| (f.as_str(), r));
        PendingImages {
            path: format!("/events/{}/edit", self.event_id.clone().unwrap_or_default()),
            notice: pending_notice(first, refusal, rest),
            files,
        }
    }

    /// A picture step failed on edit: "{file}: {message}" placed as a refusal. On
    /// `IMAGES_CHANGED` ([`Self::images_changed`]) the app reloads the event's images
    /// (`self.images.reload`).
    pub fn image_failed_on_edit(
        &mut self,
        file: &str,
        refusal: Option<&ApiError>,
    ) -> Option<String> {
        self.refused(image_step_error(file, refusal))
    }

    /// The refusal is `IMAGES_CHANGED`.
    pub fn images_changed(&self) -> bool {
        self.error.as_ref().and_then(ApiError::code) == Some("IMAGES_CHANGED")
    }

    // ------------------------------------------------------------ texts

    /// The h1.
    pub fn title(&self) -> &'static str {
        if self.is_edit {
            "Edit event"
        } else {
            "Schedule event"
        }
    }

    /// The submit button.
    pub fn submit_label(&self) -> &'static str {
        if self.busy {
            "Saving…"
        } else if self.is_edit {
            "Save changes"
        } else {
            "Schedule event"
        }
    }

    /// The Venue select's options after "Select a venue…": "Name (22,090 seats)".
    pub fn venue_options(&self) -> Vec<(String, String)> {
        self.venues
            .iter()
            .map(|v| {
                (
                    v.id.clone(),
                    format!("{} ({} seats)", v.name, grouped(v.seating_capacity)),
                )
            })
            .collect()
    }

    /// "How long before the start": "Choose a length…" (disabled, value '') while no length is
    /// chosen, then each length.
    pub fn doors_offset_choices(&self) -> Vec<(Option<i64>, String)> {
        let mut out = Vec::new();
        if self.doors_offset_minutes.is_none() {
            out.push((None, "Choose a length…".to_string()));
        }
        out.extend(
            doors_offset_options()
                .into_iter()
                .map(|o| (Some(o.minutes), o.label)),
        );
        out
    }

    /// The resulting doors time next to the length (`doorsOpenAt-preview`), once the start names
    /// one moment; with no length chosen, the kept doors time.
    pub fn doors_preview(&self) -> Option<String> {
        if self.doors_mode != DoorsMode::Before || self.selected_venue().is_none() {
            return None;
        }
        let start = self.moment(TimeField::StartsAt)?;
        let instant = match self.doors_offset_minutes {
            None => self.moment(TimeField::DoorsOpenAt)?.instant,
            Some(m) => doors_instant_before_start(start.instant, m),
        };
        Some(doors_open_at_preview(
            instant,
            &self.venue_zone(),
            Some(start.instant),
        ))
    }

    fn range_message(&self) -> Option<String> {
        self.selected_venue()?;
        let start = self.moment(TimeField::StartsAt)?;
        let doors = self.moment(TimeField::DoorsOpenAt)?;
        doors_open_problem(start.instant, doors.instant)?;
        Some(doors_open_range_message(start.instant, &self.venue_zone()))
    }

    /// The range message under Doors open (`doorsOpenAt-range`) once both times name one moment.
    pub fn doors_range_note(&self) -> Option<String> {
        self.range_message()
    }

    /// The range note is `role="alert"` once a save was tried.
    pub fn doors_range_alert(&self) -> bool {
        self.doors_checked
    }

    /// "Times are in the venue's time zone: Eastern Time (EDT)." with the typed start's
    /// abbreviation (else `now`'s), or [`MSG_VENUE`].
    pub fn zone_line(&self, now: DateTime<Utc>) -> String {
        if self.selected_venue().is_none() {
            return MSG_VENUE.into();
        }
        let zone = self.venue_zone();
        let m = match self.resolved(TimeField::StartsAt) {
            Some(ResolvedLocal::Ok(m)) => Some(m),
            Some(r @ ResolvedLocal::Repeated { .. }) => moment_of(&r, self.occurrence.starts_at)
                .or(match r {
                    ResolvedLocal::Repeated { first, .. } => Some(first),
                    _ => None,
                }),
            _ => None,
        };
        let abbreviation = m.map_or_else(|| abbreviation_at(now, &zone), |m| m.abbreviation);
        format!(
            "Times are in the venue's time zone: {} ({abbreviation}).",
            zone_name(&zone)
        )
    }

    /// Under a time field (once a venue is chosen): a skipped time's message, or "Which 1:30 AM?"
    /// with its two choices. Doors show it only "At a set time".
    pub fn time_note(&self, field: TimeField) -> Option<TimeNote> {
        if field == TimeField::DoorsOpenAt && self.doors_mode != DoorsMode::AtTime {
            return None;
        }
        self.selected_venue()?;
        let local = &self.time(field).value;
        match self.resolved(field)? {
            ResolvedLocal::Skipped {
                skipped_from,
                skipped_to,
            } => Some(TimeNote::Skipped(skipped_time_message(
                local,
                &self.venue_zone(),
                &skipped_from,
                &skipped_to,
            ))),
            ResolvedLocal::Repeated { first, second } => {
                let time = format_local_time(local);
                Some(TimeNote::Repeated {
                    legend: format!("Which {time}?"),
                    first: format!("{time} {} (the first time)", first.abbreviation),
                    second: format!("{time} {} (the second time)", second.abbreviation),
                    chosen: self.occurrence.get(field),
                })
            }
            ResolvedLocal::Ok(_) => None,
        }
    }

    /// The messages the time fields already show as their own notes (range, skipped).
    fn time_chrome_messages(&self) -> BTreeSet<String> {
        let mut msgs = BTreeSet::new();
        if let Some(m) = self.range_message() {
            msgs.insert(m);
        }
        if self.selected_venue().is_some() {
            for field in [
                TimeField::StartsAt,
                TimeField::EndsAt,
                TimeField::DoorsOpenAt,
            ] {
                if let Some(ResolvedLocal::Skipped {
                    skipped_from,
                    skipped_to,
                }) = self.resolved(field)
                {
                    msgs.insert(skipped_time_message(
                        &self.time(field).value,
                        &self.venue_zone(),
                        &skipped_from,
                        &skipped_to,
                    ));
                }
            }
        }
        msgs
    }

    /// The messages under a field (`{key}-error`, `role="alert"`): the Backend's placed ones, else
    /// the shown preview check.
    pub fn field_hint(&self, key: &str) -> Vec<String> {
        if let Some(placed) = self.placed().field(key) {
            return placed.clone();
        }
        self.preview()
            .get(key)
            .map(|m| vec![m.to_string()])
            .unwrap_or_default()
    }

    /// `aria-invalid` on a field's control.
    pub fn field_invalid(&self, key: &str) -> bool {
        !self.field_hint(key).is_empty()
    }

    /// A required field with no valid value yet is outlined in red at once; its message waits
    /// (R5).
    pub fn needed(&self, key: &str) -> bool {
        self.preview_all().has(key)
    }

    /// Ticket type `index`'s "Required: name, price" line under its boxes, when any is needed.
    pub fn type_required(&self, index: usize) -> Option<String> {
        let all = self.preview_all();
        let boxes: Vec<&str> = [TypeField::Name, TypeField::Price, TypeField::Quantity]
            .into_iter()
            .map(TypeField::key)
            .filter(|f| all.has(&format!("tiers.{index}.{f}")))
            .collect();
        (!boxes.is_empty()).then(|| format!("Required: {}", boxes.join(", ")))
    }

    /// A time field's `{key}-error` hint, less what its notes already say.
    pub fn time_field_hint(&self, field: TimeField) -> Vec<String> {
        let chrome = self.time_chrome_messages();
        self.field_hint(field.key())
            .into_iter()
            .filter(|m| !chrome.contains(m))
            .collect()
    }

    /// Ticket type `index`'s hint (`type-N-error`): the Backend's messages, else the shown checks
    /// of its name, price, and quantity.
    pub fn type_hint(&self, index: usize) -> Vec<String> {
        let placed = self.placed();
        let server: Vec<String> = placed
            .type_errors(index)
            .iter()
            .map(|e| e.message.clone())
            .collect();
        if !server.is_empty() {
            return server;
        }
        let preview = self.preview();
        TYPE_FIELDS
            .iter()
            .filter_map(|f| {
                preview
                    .get(&format!("tiers.{index}.{f}"))
                    .map(str::to_string)
            })
            .collect()
    }

    /// `aria-invalid` on a ticket type's input: a message names it (or names no known field), or
    /// its check shows.
    pub fn type_invalid(&self, index: usize, field: TypeField) -> bool {
        let placed = self.placed();
        placed
            .type_errors(index)
            .iter()
            .any(|e| e.field == field.key() || !TYPE_FIELDS.contains(&e.field.as_str()))
            || self
                .preview()
                .has(&format!("tiers.{index}.{}", field.key()))
    }

    /// The hint at the top of "Tickets and seating" (`seating-error`): placed capacity refusals,
    /// then the over-capacity check.
    pub fn seating_hint(&self) -> Vec<String> {
        let mut out = self.placed().seating;
        if let Some(m) = self.preview().get("tiers") {
            out.push(m.to_string());
        }
        out
    }

    /// The hint under "Add ticket type" (`tiers-error`).
    pub fn tiers_hint(&self) -> Vec<String> {
        self.placed().tiers
    }

    /// The refusal is shown as a banner under the zone line.
    pub fn times_refusal(&self) -> bool {
        matches!(
            self.error.as_ref().and_then(ApiError::code),
            Some("SCHEDULING_CONFLICT" | "CHECK_IN_DETAILS_REMOVED")
        )
    }

    /// The message by the buttons (`submit-error`): what names no field, unless the refusal is a
    /// times banner.
    pub fn submit_error(&self) -> Option<String> {
        let placed = self.placed();
        (!self.times_refusal() && !placed.unmapped.is_empty()).then(|| placed.unmapped.join(" "))
    }

    /// A scheduling conflict's detail (`conflict-detail`), [`Self::conflict_parts`] joined.
    pub fn conflict_line(&self) -> Option<String> {
        self.conflict_parts()
            .map(|(name, rest)| format!("{CONFLICT_PREFIX}{name}{rest}"))
    }

    /// A scheduling conflict's detail in the pieces the markup writes: after
    /// [`CONFLICT_PREFIX`], the other event's name (in `<strong>`), then the rest (", which runs
    /// {start} – {end}. Pick a slot …").
    pub fn conflict_parts(&self) -> Option<(String, String)> {
        let error = self.error.as_ref()?;
        if error.code() != Some("SCHEDULING_CONFLICT") {
            return None;
        }
        let other = error.details()?.get("conflictingEvent")?.as_object()?;
        let text = |k: &str| other.get(k).and_then(Value::as_str).unwrap_or_default();
        let zone = self.venue_zone();
        Some((
            text("name").to_string(),
            format!(
                ", which runs {} – {}. Pick a slot at least 60 minutes clear of it, or choose another venue.",
                when(text("startsAt"), Some(&zone)),
                until(text("startsAt"), text("endsAt"), Some(&zone)),
            ),
        ))
    }

    /// "Tickets and seating" shows: a venue is chosen, and the types and its layouts have loaded.
    pub fn show_tickets_and_seating(&self) -> bool {
        !self.location_id.is_empty() && self.types_loaded && self.layouts_ready
    }

    /// The Seating select shows: the venue has layouts or the event is seated.
    pub fn show_seating_select(&self) -> bool {
        !self.venue_layouts.is_empty() || self.seated()
    }

    /// The Seating select's options: "General admission" (value '') then "{name} ({n} seats)".
    pub fn layout_options(&self) -> Vec<(String, String)> {
        let mut out = vec![(String::new(), "General admission".to_string())];
        out.extend(self.venue_layouts.iter().map(|l| {
            (
                l.id.clone(),
                format!("{} ({} seats)", l.name, grouped(l.seat_count)),
            )
        }));
        out
    }

    /// Why the Seating select is disabled: once something is sold (M8, E8).
    pub fn layout_lock_reason(&self) -> Option<&'static str> {
        (self.sold.event_sold > 0).then_some(if self.seated() {
            lock_reason::LAYOUT
        } else {
            lock_reason::SEATING
        })
    }

    /// [`LOADING_LAYOUT`] while the chosen layout loads.
    pub fn seating_status(&self) -> Option<&'static str> {
        (self.seated() && self.layout_detail().is_none()).then_some(LOADING_LAYOUT)
    }

    /// Tickets sold of ticket type `index`.
    pub fn type_sold(&self, index: usize) -> i64 {
        self.types
            .get(index)
            .and_then(|t| t.id.as_ref())
            .and_then(|id| self.sold.sold_by_tier.get(id))
            .copied()
            .unwrap_or(0)
    }

    /// "Remove ticket type N" shows (more than one type).
    pub fn show_remove_type(&self) -> bool {
        self.types.len() > 1
    }

    /// "Remove ticket type N"'s title, and it is disabled, when the type has sales.
    pub fn remove_type_title(&self, index: usize) -> Option<&'static str> {
        (self.type_sold(index) > 0).then_some(lock_reason::TYPE)
    }

    /// "This type has {n} ticket(s) already sold."
    pub fn type_sold_hint(&self, index: usize) -> Option<String> {
        let sold = self.type_sold(index);
        (sold > 0).then(|| lock_reason::quantity(sold))
    }

    /// The general-admission seat line (`seat-total`).
    pub fn seat_total_line(&self) -> String {
        let totals = self.seat_totals();
        match totals.leftover_sentence {
            Some(s) => format!("{} {s}", totals.summary),
            None => totals.summary,
        }
    }

    /// Total tickets' placeholder: the venue's capacity, or 18000.
    pub fn total_placeholder(&self) -> String {
        self.venue_capacity()
            .map_or("18000".into(), |c| c.to_string())
    }

    /// Total tickets' hint.
    pub fn total_hint(&self) -> String {
        let up_to = self.selected_venue().map_or(String::new(), |v| {
            format!("Up to {} at {}. ", grouped(v.seating_capacity), v.name)
        });
        format!("{up_to}Leave blank to use the venue's capacity.")
    }

    /// A seated event's "Total tickets: {seats on sale}, the seats on sale." (M8).
    pub fn seated_total_note(&self) -> Option<String> {
        if !self.seated() {
            return None;
        }
        let n = self
            .counts()
            .map(|c| c.seats_on_sale)
            .or(self.layout_detail().map(|d| d.seat_count))
            .unwrap_or(0);
        Some(format!("Total tickets: {}, the seats on sale.", grouped(n)))
    }

    /// [`DETAILS_ONLY_NOTE`] when the types or seating could not be read (E8).
    pub fn details_only_note(&self) -> Option<&'static str> {
        (self.types_failed || (self.is_edit && self.types_loaded && self.details_only()))
            .then_some(DETAILS_ONLY_NOTE)
    }

    /// A seated event saved details only: "Total tickets: {n}, the seats on sale." (E8).
    pub fn details_only_total_note(&self) -> Option<String> {
        (self.is_edit && self.event_seated && self.details_only()).then(|| {
            format!(
                "Total tickets: {}, the seats on sale.",
                locale_number(js_number(&self.total_ticket_capacity))
            )
        })
    }

    /// The price table's rows, by rank, once the layout is loaded (M9).
    pub fn level_rows(&self) -> Vec<LevelRow> {
        let Some(detail) = self.layout_detail() else {
            return Vec::new();
        };
        let counts = self.counts();
        detail
            .levels
            .iter()
            .map(|l| {
                let on_sale = self.on_sale_of(counts.as_ref(), &l.id, l.seat_count);
                LevelRow {
                    id: l.id.clone(),
                    name: l.name.clone(),
                    swatch_class: format!("level-swatch level-swatch--{}", l.color),
                    on_sale,
                    on_sale_text: grouped(on_sale),
                    price_box: on_sale != 0,
                    price_id: format!("price-{}", l.id),
                    price_label: format!("{} price", l.name),
                    price: self.seating.prices.get(&l.id).cloned().unwrap_or_default(),
                }
            })
            .collect()
    }

    /// "Prices from {event}, the event most recently scheduled on {layout}." (M9).
    pub fn prices_from_note(&self) -> Option<String> {
        let detail = self.layout_detail()?;
        let from = self.prices_from.as_ref()?;
        Some(format!(
            "Prices from {from}, the event most recently scheduled on {}.",
            detail.name
        ))
    }

    /// "{on sale} seats on sale · {off} off sale" (`seat-line`, M9).
    pub fn seat_line(&self) -> Option<String> {
        let detail = self.layout_detail()?;
        let counts = self.counts();
        Some(format!(
            "{} seats on sale · {} off sale",
            grouped(
                counts
                    .as_ref()
                    .map_or(detail.seat_count, |c| c.seats_on_sale)
            ),
            grouped(counts.as_ref().map_or(0, |c| c.seats_off_sale)),
        ))
    }

    /// The off-sale overview's buttons, "Section {name}", in drawing order (M10).
    pub fn section_choices(&self) -> Vec<(String, String)> {
        self.layout_detail()
            .map(|d| {
                d.sections
                    .iter()
                    .map(|s| (s.id.clone(), format!("Section {}", s.name)))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The open section's h3, "Section {name}"; `None` shows the overview.
    pub fn open_section_heading(&self) -> Option<String> {
        let id = self.open_section_id.as_ref()?;
        let s = self
            .layout_detail()?
            .sections
            .iter()
            .find(|s| s.id == *id)?;
        Some(format!("Section {}", s.name))
    }
}
