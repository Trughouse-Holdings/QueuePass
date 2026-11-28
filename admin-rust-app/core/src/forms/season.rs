//! Spec 041 (research R4, R11, R12; FR-002 to FR-006, FR-009, FR-010, FR-017): the Season form's
//! pure parts, ported case for case from `admin-app/src/pages/season-form-checks.ts`. The checks
//! preview the Backend's rules (the Backend stays authoritative, Constitution IV), keyed by the
//! Backend's own field paths, so `place_season_errors` puts a refusal where a preview would have
//! gone. The list's status text and the event picker's filter are in `crate::pages::seasons`.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};

use crate::api::client::ApiError;
use crate::forms::event::FieldMessages;
use crate::pages::event_page::json_number_of;
use crate::time::{
    ResolvedLocal, format_event_time, parse_instant, resolve_local, skipped_time_message,
    to_offset_date_time,
};

/// The sports a Season can be for, in the contract's order (`Sport`), with the words shown.
pub const SPORTS: [(&str, &str); 6] = [
    ("BASKETBALL", "Basketball"),
    ("FOOTBALL", "Football"),
    ("BASEBALL", "Baseball"),
    ("SOCCER", "Soccer"),
    ("HOCKEY", "Hockey"),
    ("VOLLEYBALL", "Volleyball"),
];

/// The layout select's value for general admission (`""` is nothing chosen yet).
pub const GENERAL_ADMISSION: &str = "ga";

/// The form as typed. Times are venue-local `YYYY-MM-DDTHH:mm`, or `""` when not filled in.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SeasonDraft {
    pub name: String,
    pub location_id: String,
    /// `""` (not chosen), [`GENERAL_ADMISSION`], or a layout id.
    pub layout: String,
    /// `""` or a [`SPORTS`] value.
    pub sport: String,
    pub team: String,
    pub sales_end_at: String,
    pub single_sales_open_at: String,
    pub max_passes_per_customer: String,
    pub event_ids: Vec<String>,
    /// Typed prices by price key: a level id (seated), or `tier:<name in lower case>`.
    pub prices: BTreeMap<String, String>,
}

/// A chosen event, as the checks read it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewEvent {
    pub id: String,
    pub name: String,
    /// An ISO instant, as the API gives it.
    pub starts_at: String,
    pub status: String,
}

/// One of the layout's levels (seated).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewLevel {
    pub id: String,
    pub name: String,
    pub rank: i64,
}

/// What the checks read besides the form (`SeasonPreviewContext`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SeasonPreviewContext {
    pub zone: String,
    /// The chosen events.
    pub events: Vec<PreviewEvent>,
    /// The layout's levels (seated).
    pub levels: Vec<PreviewLevel>,
    /// The ticket type names offered for a price (general admission), as spelled.
    pub tier_names: Vec<String>,
    /// A Season on sale, or being put on sale: every level (or at least one name) priced.
    pub complete: bool,
    /// Being put on sale (FR-010): also at least 2 events not cancelled.
    pub publishing: bool,
}

/// `SEASON_MSG`: the form's own messages.
pub mod season_msg {
    pub const NAME: &str = "Enter the season's name.";
    pub const NAME_LENGTH: &str = "name must be between 1 and 100 characters";
    pub const VENUE: &str = "Choose a venue first: times are in the venue's local time.";
    pub const LAYOUT: &str = "Choose a layout, or General admission.";
    pub const TEAM: &str = "Enter the team, or choose no sport.";
    pub const SPORT: &str = "Choose the sport, or leave the team blank.";
    pub const TEAM_LENGTH: &str = "team must be between 1 and 100 characters";
    pub const SALES_END: &str = "Enter when pass sales end.";
    pub const PRESALE_TIME: &str =
        "Enter when single tickets go on sale, or leave both its date and time blank.";
    pub const PRESALE: &str = "Single tickets must go on sale no later than the pass sales end.";
    pub const PASSES: &str =
        "Passes per customer must be a whole number from 1 to 10, or blank for no limit.";
    pub const PRICE: &str = "Enter a price such as 640.00, at most 99999999.99.";
    pub const TWO_EVENTS: &str = "Choose at least 2 events to put the season on sale.";
    pub const ONE_NAME: &str = "Price at least one ticket type.";
}

/// FR-009: a seated Season's empty price box, as the event form says it (`038`).
pub fn level_price_message(level: &str) -> String {
    format!("Give {level} a price.")
}

/// FR-006: the sales end after the first event's start.
pub fn sales_end_message(event_name: &str, start: &str, zone: &str) -> String {
    let when = parse_instant(start).map_or_else(
        || "Invalid Date".to_string(),
        |at| format_event_time(at, zone),
    );
    format!("Pass sales must end by the start of the first event, {event_name} ({when}).")
}

/// The contract's `SeasonPriceInput.price`, `/^\d{1,8}(\.\d{1,2})?$/`: at most 8 whole digits,
/// fitting decimal(10,2) (review 041).
pub fn is_pass_price(price: &str) -> bool {
    let (whole, fraction) = match price.split_once('.') {
        Some((w, f)) => (w, Some(f)),
        None => (price, None),
    };
    let digits =
        |s: &str, max: usize| (1..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit());
    digits(whole, 8) && fraction.is_none_or(|f| digits(f, 2))
}

/// Ticket type names in one order in both Admin apps (`byName`): their lower-case characters,
/// compared.
pub fn by_name(a: &str, b: &str) -> Ordering {
    a.to_lowercase().cmp(&b.to_lowercase())
}

/// A general-admission price key for a ticket type name.
pub fn tier_key(name: &str) -> String {
    format!("tier:{}", name.trim().to_lowercase())
}

/// The price keys the form shows, in order: levels by rank, or the offered names.
pub fn price_keys(draft: &SeasonDraft, ctx: &SeasonPreviewContext) -> Vec<String> {
    if draft.layout == GENERAL_ADMISSION {
        return ctx.tier_names.iter().map(|n| tier_key(n)).collect();
    }
    let mut levels: Vec<&PreviewLevel> = ctx.levels.iter().collect();
    levels.sort_by_key(|l| l.rank);
    levels.into_iter().map(|l| l.id.clone()).collect()
}

/// A venue-local time as an instant, the first of a repeated one; `None` if none or skipped.
pub fn instant_of(local: &str, zone: &str) -> Option<DateTime<Utc>> {
    if local.is_empty() {
        return None;
    }
    match resolve_local(local, zone).ok()? {
        ResolvedLocal::Ok(m) => Some(m.instant),
        ResolvedLocal::Repeated { first, .. } => Some(first.instant),
        ResolvedLocal::Skipped { .. } => None,
    }
}

/// A time field's own problem: missing, unreadable, or a local time the clocks skip.
fn time_problem(
    local: &str,
    zone: &str,
    missing: Option<&str>,
    unreadable: &str,
) -> Option<String> {
    if local.is_empty() {
        return missing.map(str::to_string);
    }
    match resolve_local(local, zone) {
        Ok(ResolvedLocal::Skipped {
            skipped_from,
            skipped_to,
        }) => Some(skipped_time_message(
            local,
            zone,
            &skipped_from,
            &skipped_to,
        )),
        Ok(_) => None,
        Err(_) => Some(unreadable.to_string()),
    }
}

/// JavaScript's `string.length`: UTF-16 code units.
fn js_length(s: &str) -> usize {
    s.encode_utf16().count()
}

/// The instant of an ISO string as `Date.parse` gives it, `None` for `NaN`.
fn ms_of(iso: &str) -> Option<i64> {
    parse_instant(iso).map(|at| at.timestamp_millis())
}

/// `/^\d+$/.test(most) && Number(most) >= 1 && Number(most) <= 10`.
fn passes_ok(most: &str) -> bool {
    !most.is_empty()
        && most.bytes().all(|b| b.is_ascii_digit())
        && most.parse::<f64>().is_ok_and(|n| (1.0..=10.0).contains(&n))
}

/// The chosen events not cancelled.
fn live<'a>(draft: &SeasonDraft, ctx: &'a SeasonPreviewContext) -> Vec<&'a PreviewEvent> {
    ctx.events
        .iter()
        .filter(|e| draft.event_ids.contains(&e.id) && e.status != "CANCELLED")
        .collect()
}

/// Every problem the form can see, by field path (R4), in the order the TypeScript sets them.
pub fn preview_season(draft: &SeasonDraft, ctx: &SeasonPreviewContext) -> FieldMessages {
    let mut errors = FieldMessages::default();
    let zone = ctx.zone.as_str();
    let name = draft.name.trim();
    if name.is_empty() {
        errors.set("name", season_msg::NAME);
    } else if js_length(name) > 100 {
        errors.set("name", season_msg::NAME_LENGTH);
    }
    if draft.location_id.is_empty() {
        errors.set("locationId", season_msg::VENUE);
    }
    if draft.layout.is_empty() {
        errors.set("layoutId", season_msg::LAYOUT);
    }

    let team = draft.team.trim();
    if js_length(team) > 100 {
        errors.set("team", season_msg::TEAM_LENGTH);
    } else if !draft.sport.is_empty() && team.is_empty() {
        errors.set("team", season_msg::TEAM);
    } else if draft.sport.is_empty() && !team.is_empty() {
        errors.set("sport", season_msg::SPORT);
    }

    if let Some(problem) = time_problem(
        &draft.sales_end_at,
        zone,
        Some(season_msg::SALES_END),
        season_msg::SALES_END,
    ) {
        errors.set("salesEndAt", problem);
    }
    if let Some(problem) = time_problem(
        &draft.single_sales_open_at,
        zone,
        None,
        season_msg::PRESALE_TIME,
    ) {
        errors.set("singleSalesOpenAt", problem);
    }
    let sales_end = instant_of(&draft.sales_end_at, zone);
    let presale = instant_of(&draft.single_sales_open_at, zone);
    if let (Some(end), Some(open)) = (sales_end, presale)
        && open > end
    {
        errors.set("singleSalesOpenAt", season_msg::PRESALE);
    }
    let mut live = live(draft, ctx);
    // A stable sort, as `Array.prototype.sort`.
    live.sort_by_key(|e| ms_of(&e.starts_at));
    if let (Some(end), Some(first)) = (sales_end, live.first())
        && ms_of(&first.starts_at).is_some_and(|start| end.timestamp_millis() > start)
    {
        errors.set(
            "salesEndAt",
            sales_end_message(&first.name, &first.starts_at, zone),
        );
    }

    let most = draft.max_passes_per_customer.trim();
    if !most.is_empty() && !passes_ok(most) {
        errors.set("maxPassesPerCustomer", season_msg::PASSES);
    }

    if ctx.publishing && live.len() < 2 {
        errors.set("eventIds", season_msg::TWO_EVENTS);
    }

    let ga = draft.layout == GENERAL_ADMISSION;
    let mut priced = 0;
    for key in price_keys(draft, ctx) {
        let typed = draft.prices.get(&key).map_or("", |p| p.trim());
        if !typed.is_empty() && !is_pass_price(typed) {
            errors.set(&format!("prices.{key}"), season_msg::PRICE);
        } else if !typed.is_empty() {
            priced += 1;
        } else if ctx.complete && !ga {
            let level = ctx.levels.iter().find(|l| l.id == key);
            errors.set(
                &format!("prices.{key}"),
                level_price_message(level.map_or(key.as_str(), |l| l.name.as_str())),
            );
        }
    }
    if ctx.complete && ga && priced == 0 {
        errors.set("prices", season_msg::ONE_NAME);
    }
    errors
}

/// Review 041 (`sameDraft`): whether the form still shows the saved Season, so Put on sale
/// publishes what is on screen. Prices compare by their filled boxes, in any order; blanks are
/// no price.
pub fn same_draft(a: &SeasonDraft, b: &SeasonDraft) -> bool {
    let filled = |d: &SeasonDraft| -> Vec<String> {
        let mut out: Vec<String> = d
            .prices
            .iter()
            .filter(|(_, v)| !v.trim().is_empty())
            .map(|(k, v)| format!("{k}={}", v.trim()))
            .collect();
        out.sort();
        out
    };
    let events = |d: &SeasonDraft| {
        let mut ids = d.event_ids.clone();
        ids.sort();
        ids
    };
    a.name == b.name
        && a.location_id == b.location_id
        && a.layout == b.layout
        && a.sport == b.sport
        && a.team == b.team
        && a.sales_end_at == b.sales_end_at
        && a.single_sales_open_at == b.single_sales_open_at
        && a.max_passes_per_customer == b.max_passes_per_customer
        && events(a) == events(b)
        && filled(a) == filled(b)
}

/// The form's fields top to bottom, for focus on the first at fault (FR-017).
pub fn field_order(keys: &[String]) -> Vec<String> {
    let mut order: Vec<String> = [
        "name",
        "locationId",
        "layoutId",
        "sport",
        "team",
        "salesEndAt",
        "singleSalesOpenAt",
        "maxPassesPerCustomer",
        "eventIds",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    order.extend(keys.iter().map(|k| format!("prices.{k}")));
    order.push("prices".into());
    order
}

/// The first field at fault, top to bottom; else the first key set; `None` for none.
pub fn first_error_key(present: &[String], keys: &[String]) -> Option<String> {
    field_order(keys)
        .into_iter()
        .find(|k| present.contains(k))
        .or_else(|| present.first().cloned())
}

/// The id of the control a field's error focuses.
pub fn focus_id_for(key: &str) -> String {
    if key == "salesEndAt" || key == "singleSalesOpenAt" {
        return format!("{key}-date");
    }
    match key.strip_prefix("prices.") {
        Some(price) if !price.is_empty() => format!("price-{price}"),
        _ => key.to_string(),
    }
}

/// The request the form sends (`SeasonInput`), and each sent price's key by its index (for
/// `prices.<i>`).
pub fn to_season_input(draft: &SeasonDraft, ctx: &SeasonPreviewContext) -> (Value, Vec<String>) {
    let at = |local: &str| -> Option<String> {
        let instant = instant_of(local, &ctx.zone)?;
        to_offset_date_time(instant, &ctx.zone).ok()
    };
    let ga = draft.layout == GENERAL_ADMISSION;
    let mut prices = Vec::new();
    let mut sent_keys = Vec::new();
    for key in price_keys(draft, ctx) {
        let price = draft.prices.get(&key).map_or("", |p| p.trim());
        if price.is_empty() {
            continue;
        }
        let mut entry = Map::new();
        if ga {
            let name = ctx
                .tier_names
                .iter()
                .find(|n| tier_key(n) == key)
                .cloned()
                .unwrap_or_else(|| key.chars().skip(5).collect());
            entry.insert("tierName".into(), Value::String(name));
        } else {
            entry.insert("levelId".into(), Value::String(key.clone()));
        }
        entry.insert("price".into(), Value::String(price.to_string()));
        prices.push(Value::Object(entry));
        sent_keys.push(format!("prices.{key}"));
    }
    let text_or_null = |s: &str| {
        if s.is_empty() {
            Value::Null
        } else {
            Value::String(s.to_string())
        }
    };
    let most = draft.max_passes_per_customer.trim();
    let mut input = Map::new();
    input.insert("name".into(), Value::String(draft.name.trim().to_string()));
    input.insert("sport".into(), text_or_null(&draft.sport));
    input.insert("team".into(), text_or_null(draft.team.trim()));
    input.insert(
        "locationId".into(),
        Value::String(draft.location_id.clone()),
    );
    input.insert(
        "layoutId".into(),
        if ga || draft.layout.is_empty() {
            Value::Null
        } else {
            Value::String(draft.layout.clone())
        },
    );
    input.insert(
        "salesEndAt".into(),
        Value::String(at(&draft.sales_end_at).unwrap_or_else(|| draft.sales_end_at.clone())),
    );
    input.insert(
        "singleSalesOpenAt".into(),
        at(&draft.single_sales_open_at).map_or(Value::Null, Value::String),
    );
    input.insert(
        "maxPassesPerCustomer".into(),
        if most.is_empty() {
            Value::Null
        } else {
            json_number_of(most)
        },
    );
    input.insert(
        "eventIds".into(),
        Value::Array(
            draft
                .event_ids
                .iter()
                .map(|id| Value::String(id.clone()))
                .collect(),
        ),
    );
    input.insert("prices".into(), Value::Array(prices));
    (Value::Object(input), sent_keys)
}

/// Refusals placed beside their fields (`031`), and the rest (`PlacedSeasonErrors`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PlacedSeasonErrors {
    /// By form key, in the order first placed.
    pub fields: Vec<(String, Vec<String>)>,
    pub unmapped: Vec<String>,
}

impl PlacedSeasonErrors {
    fn add(&mut self, key: String, message: String) {
        match self.fields.iter_mut().find(|(k, _)| *k == key) {
            Some((_, messages)) => messages.push(message),
            None => self.fields.push((key, vec![message])),
        }
    }

    /// The messages placed beside `key`.
    pub fn get(&self, key: &str) -> Option<&[String]> {
        self.fields
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, m)| m.as_slice())
    }

    /// The keys placed, in order.
    pub fn keys(&self) -> Vec<String> {
        self.fields.iter().map(|(k, _)| k.clone()).collect()
    }

    /// No message is beside a field.
    pub fn is_empty_fields(&self) -> bool {
        self.fields.is_empty()
    }
}

const NAMED_FIELDS: [&str; 8] = [
    "name",
    "locationId",
    "layoutId",
    "sport",
    "team",
    "salesEndAt",
    "singleSalesOpenAt",
    "maxPassesPerCustomer",
];

/// `/^\.\d+$/` on what follows a field name: a dot and one or more digits.
fn dot_index(rest: &str) -> Option<usize> {
    let digits = rest.strip_prefix('.')?;
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
        .then(|| digits.parse().unwrap_or(usize::MAX))
}

/// `\w+`: one or more of `[A-Za-z0-9_]`.
fn is_word(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// `/^prices\.(\d+)(\.(\w+))?$/`: a sent price entry's index, and the field of it named.
fn price_entry(path: &str) -> Option<(usize, Option<&str>)> {
    let rest = path.strip_prefix("prices.")?;
    let (index, field) = match rest.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (rest, None),
    };
    let i = dot_index(&format!(".{index}"))?;
    match field {
        Some(f) if !is_word(f) => None,
        _ => Some((i, field)),
    }
}

/// A refusal's field path as the form's key, or `None` for a field the form has no place for.
fn key_of(path: &str, sent_price_keys: &[String], shown: Option<&[String]>) -> Option<String> {
    if let Some(rest) = path.strip_prefix("eventIds")
        && (rest.is_empty() || dot_index(rest).is_some())
    {
        return Some("eventIds".into());
    }
    // A sent entry by its index, or one of its fields (`prices.<i>.price`, review).
    if let Some((i, _)) = price_entry(path) {
        return sent_price_keys.get(i).cloned();
    }
    if path == "prices" {
        return Some(path.to_string());
    }
    if path.len() > "prices.".len() && path.starts_with("prices.") {
        return shown
            .is_none_or(|keys| keys.iter().any(|k| k == path))
            .then(|| path.to_string());
    }
    NAMED_FIELDS.contains(&path).then(|| path.to_string())
}

/// R4: a refusal's field paths as the form's keys. `eventIds.<i>` all go beside the events;
/// `prices.<i>` names the i-th price sent; `prices.<levelId>` a level's box. A path with an index
/// or an id is left out of the message shown, the field says it; a sent entry's own field keeps
/// its name (`prices.<i>.price` → "price must be …", review). `shown` are the price boxes the
/// form shows (`prices.<key>`): a price path naming none of them is a general message.
pub fn place_season_errors(
    error: Option<&ApiError>,
    _sent_event_ids: &[String],
    sent_price_keys: &[String],
    shown: Option<&[String]>,
) -> PlacedSeasonErrors {
    let mut placed = PlacedSeasonErrors::default();
    let Some(error) = error else {
        return placed;
    };
    let details = error.details();
    if let Some(field) = details.and_then(|d| d.get("field")).and_then(Value::as_str) {
        match key_of(field, sent_price_keys, shown) {
            Some(key) => placed.add(key, error.message().to_string()),
            None => placed.unmapped.push(error.message().to_string()),
        }
        return placed;
    }
    if let Some(fields) = details
        .and_then(|d| d.get("fields"))
        .and_then(Value::as_array)
    {
        for entry in fields.iter().filter_map(Value::as_str) {
            let space = entry.find(' ');
            let head = space.map_or(entry, |at| &entry[..at]);
            match key_of(head, sent_price_keys, shown) {
                None => placed.unmapped.push(entry.to_string()),
                Some(key) => {
                    let rest = space.map_or(entry, |at| &entry[at + 1..]);
                    let message = match price_entry(head) {
                        Some((_, Some(field))) => format!("{field} {rest}"),
                        _ if head.contains('.') => rest.to_string(),
                        _ => entry.to_string(),
                    };
                    placed.add(key, message);
                }
            }
        }
        return placed;
    }
    if !error.message().is_empty() {
        placed.unmapped.push(error.message().to_string());
    }
    placed
}
