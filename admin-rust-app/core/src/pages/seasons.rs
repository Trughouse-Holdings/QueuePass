//! Spec 041 (research R11, R12; FR-005, FR-008, FR-014, FR-017, FR-018): what the Seasons list
//! and a Season's page say and work out, as plain functions so the app crate's views only lay
//! them out. Ported from `admin-app/src/pages/season-form-checks.ts` (`pickableEvents`,
//! `seasonStatusText`, `sportTeamText`), `Seasons.tsx`, and `SeasonForm.tsx`.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};

use crate::api::types;
use crate::forms::season::{
    GENERAL_ADMISSION, PreviewEvent, PreviewLevel, SPORTS, SeasonDraft, SeasonPreviewContext,
    by_name, tier_key,
};
use crate::money::usd;
use crate::pages::attendees_reports::count;
use crate::time::{format_event_time, parse_instant, to_iso_string, to_local_date_time};

// ------------------------------------------------------------------------------ the picker

/// The Season an event is in (`SeasonRef`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeasonRef {
    pub id: String,
    pub name: String,
}

/// An event as the picker reads it (`PickerEvent`; `Event` from `listEvents`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PickerEvent {
    pub id: String,
    pub name: String,
    pub location_id: String,
    pub layout_id: Option<String>,
    pub status: String,
    /// An ISO instant, as the API gives it.
    pub starts_at: String,
    pub season: Option<SeasonRef>,
}

impl From<&types::Event> for PickerEvent {
    fn from(e: &types::Event) -> Self {
        PickerEvent {
            id: e.id.to_string(),
            name: e.name.to_string(),
            location_id: e.location_id.to_string(),
            layout_id: e.layout_id.map(|id| id.to_string()),
            status: e.status.to_string(),
            starts_at: to_iso_string(e.starts_at),
            season: e.season.as_ref().map(|s| SeasonRef {
                id: s.id.to_string(),
                name: s.name.to_string(),
            }),
        }
    }
}

/// What the picker filters by.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PickOptions {
    pub location_id: String,
    /// `None` for general admission.
    pub layout_id: Option<String>,
    /// The Season being edited, whose own events stay pickable.
    pub season_id: Option<String>,
    /// Now, in ms since the epoch.
    pub now_ms: i64,
    /// Events listed whatever their state: those the Season has already.
    pub keep: Vec<String>,
}

fn ms_of(iso: &str) -> Option<i64> {
    parse_instant(iso).map(|at| at.timestamp_millis())
}

/// R11 (US1 scenario 1): the events a Season can take: at its venue, on its layout (or general
/// admission), scheduled, not started, and in no other Season; plus those it has already
/// (`keep`), which stay listed though cancelled or started since. By start, then id.
pub fn pickable_events(events: &[PickerEvent], opts: &PickOptions) -> Vec<PickerEvent> {
    let mut out: Vec<PickerEvent> = events
        .iter()
        .filter(|e| {
            opts.keep.contains(&e.id)
                || (e.location_id == opts.location_id
                    && e.layout_id == opts.layout_id
                    && e.status == "SCHEDULED"
                    && ms_of(&e.starts_at).is_some_and(|start| start > opts.now_ms)
                    && e.season
                        .as_ref()
                        .is_none_or(|s| Some(&s.id) == opts.season_id.as_ref()))
        })
        .cloned()
        .collect();
    out.sort_by(|a, b| {
        ms_of(&a.starts_at)
            .cmp(&ms_of(&b.starts_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

// ------------------------------------------------------------------------------ status

/// The parts of a Season its status text reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeasonClock {
    pub status: types::SeasonStatus,
    pub sales_end_at: DateTime<Utc>,
    pub single_sales_open_at: Option<DateTime<Utc>>,
    pub time_zone: String,
}

impl From<&types::Season> for SeasonClock {
    fn from(s: &types::Season) -> Self {
        SeasonClock {
            status: s.status,
            sales_end_at: s.sales_end_at,
            single_sales_open_at: s.single_sales_open_at,
            time_zone: s.time_zone.to_string(),
        }
    }
}

/// FR-018: a Season's status as the list and its page say it: Draft, On sale, Presale until …,
/// Sales ended, Cancelled. `now_ms` is ms since the epoch.
pub fn season_status_text(season: &SeasonClock, now_ms: i64) -> String {
    match season.status {
        types::SeasonStatus::Draft => return "Draft".into(),
        types::SeasonStatus::Cancelled => return "Cancelled".into(),
        types::SeasonStatus::OnSale => {}
    }
    if now_ms >= season.sales_end_at.timestamp_millis() {
        return "Sales ended".into();
    }
    match season.single_sales_open_at {
        Some(open) if now_ms < open.timestamp_millis() => format!(
            "Presale until {}",
            format_event_time(open, &season.time_zone)
        ),
        _ => "On sale".into(),
    }
}

/// A sport's words (`SPORTS`), `None` for no sport or one the list does not have.
pub fn sport_label(value: &str) -> Option<&'static str> {
    SPORTS.iter().find(|(v, _)| *v == value).map(|(_, l)| *l)
}

/// FR-018: "Basketball · Louisville Cardinals", or a dash for a Season with no sport.
pub fn sport_team_text(sport: Option<&str>, team: Option<&str>) -> String {
    match (sport.and_then(sport_label), team) {
        (Some(sport), Some(team)) if !team.is_empty() => format!("{sport} · {team}"),
        _ => "—".into(),
    }
}

// ------------------------------------------------------------------------------ the list

/// One row of the Seasons list (`Seasons.tsx`), every cell as shown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeasonRow {
    pub href: String,
    pub name: String,
    pub venue: String,
    pub sport_team: String,
    pub events: String,
    pub status: String,
    pub passes_sold: String,
    pub pass_revenue: String,
}

impl SeasonRow {
    /// The row of `season`, its status as of `now_ms` (when the list arrived).
    pub fn of(season: &types::Season, now_ms: i64) -> Self {
        let sport = season.sport.map(|s| s.to_string());
        SeasonRow {
            href: format!("/seasons/{}", season.id),
            name: season.name.to_string(),
            venue: season.venue_name.clone(),
            sport_team: sport_team_text(sport.as_deref(), season.team.as_deref().map(|t| &**t)),
            events: season.events.len().to_string(),
            status: season_status_text(&SeasonClock::from(season), now_ms),
            passes_sold: count(season.passes_sold.unwrap_or(0)),
            pass_revenue: usd(season.pass_revenue.as_deref().map_or("0.00", |r| r)),
        }
    }
}

/// The list's sub line: "1 season", "5 seasons".
pub fn seasons_count(n: usize) -> String {
    format!("{n} season{}", if n == 1 { "" } else { "s" })
}

// ------------------------------------------------------------------------------ the page

/// FR-005, FR-017 (`SEASON_LOCK`): why a control is locked.
pub mod season_lock {
    pub const PASSES: &str = "Passes have been sold, so the events, venue and layout can't change.";
    pub const CANCELLED: &str = "This season is cancelled, so it can no longer be changed.";
}

fn plural(n: u64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// The page's figures line: "1 pass sold · $160.00 pass revenue".
pub fn figures_line(passes_sold: Option<u64>, pass_revenue: Option<&str>) -> String {
    format!(
        "{} · {} pass revenue",
        plural(passes_sold.unwrap_or(0), "pass sold", "passes sold"),
        usd(pass_revenue.unwrap_or("0.00"))
    )
}

/// FR-014: Cancel season's question, naming the passes to refund.
pub fn cancel_season_confirm(name: &str, passes_sold: Option<u64>) -> String {
    format!(
        "Cancel \"{name}\"? {} will be refunded: every order bought on a pass refunded and its \
         tickets voided. Its events stay scheduled. This cannot be undone.",
        plural(passes_sold.unwrap_or(0), "pass", "passes")
    )
}

/// What a cancel says once done.
pub fn season_cancelled_text(c: &types::SeasonCancellation) -> String {
    format!(
        "{} is cancelled. {} refunded, {} refunded, {} voided.",
        c.season.name.as_str(),
        plural(c.passes_refunded, "pass", "passes"),
        plural(c.orders_refunded, "order", "orders"),
        plural(c.tickets_voided, "ticket", "tickets"),
    )
}

/// What a publish says once done: "Spring Hoops is on sale.".
pub fn on_sale_text(name: &str) -> String {
    format!("{name} is on sale.")
}

/// The price key of a saved price: its level, or its name's `tier:` key.
fn saved_key(p: &types::SeasonPrice) -> String {
    p.level_id.map_or_else(
        || tier_key(p.tier_name.as_deref().map_or("", |n| n.as_str())),
        |id| id.to_string(),
    )
}

/// The form's values from a saved Season, its times in the venue's zone (`020`; `draftOf`).
pub fn draft_of(s: &types::Season) -> SeasonDraft {
    let zone = s.time_zone.to_string();
    let local =
        |at: Option<DateTime<Utc>>| at.map_or_else(String::new, |at| to_local_date_time(at, &zone));
    let prices: BTreeMap<String, String> = s
        .prices
        .iter()
        .map(|p| (saved_key(p), p.price.to_string()))
        .collect();
    SeasonDraft {
        name: s.name.to_string(),
        location_id: s.location_id.to_string(),
        layout: s
            .layout_id
            .map_or_else(|| GENERAL_ADMISSION.to_string(), |id| id.to_string()),
        sport: s.sport.map(|x| x.to_string()).unwrap_or_default(),
        team: s.team.as_deref().map(|t| t.to_string()).unwrap_or_default(),
        sales_end_at: local(Some(s.sales_end_at)),
        single_sales_open_at: local(s.single_sales_open_at),
        max_passes_per_customer: s
            .max_passes_per_customer
            .map(|n| n.to_string())
            .unwrap_or_default(),
        event_ids: s.events.iter().map(|e| e.id.to_string()).collect(),
        prices,
    }
}

/// The keys a publish refusal's `prices.<i>` names: the saved prices, in the page's order.
pub fn saved_price_keys(s: &types::Season) -> Vec<String> {
    s.prices
        .iter()
        .map(|p| format!("prices.{}", saved_key(p)))
        .collect()
}

/// The events the picker offers (`offered` in `SeasonForm.tsx`): `pickable_events` over the
/// listed events and the Season's own, which stay listed though past or cancelled.
pub fn offered_events(
    events: &[PickerEvent],
    season: Option<&types::Season>,
    draft: &SeasonDraft,
    now_ms: i64,
) -> Vec<PickerEvent> {
    if draft.location_id.is_empty() || draft.layout.is_empty() {
        return Vec::new();
    }
    let own: Vec<PickerEvent> = season.map_or_else(Vec::new, |s| {
        s.events
            .iter()
            .map(|e| PickerEvent {
                id: e.id.to_string(),
                name: e.name.clone(),
                location_id: s.location_id.to_string(),
                layout_id: s.layout_id.map(|id| id.to_string()),
                status: e.status.to_string(),
                starts_at: to_iso_string(e.starts_at),
                season: Some(SeasonRef {
                    id: s.id.to_string(),
                    name: s.name.to_string(),
                }),
            })
            .collect()
    });
    let mut all = events.to_vec();
    all.extend(
        own.iter()
            .filter(|o| !events.iter().any(|e| e.id == o.id))
            .cloned(),
    );
    let same_shape = season.is_some_and(|s| s.location_id.to_string() == draft.location_id);
    let seated = draft.layout != GENERAL_ADMISSION;
    pickable_events(
        &all,
        &PickOptions {
            location_id: draft.location_id.clone(),
            layout_id: seated.then(|| draft.layout.clone()),
            season_id: season.map(|s| s.id.to_string()),
            now_ms,
            keep: if same_shape {
                own.iter().map(|o| o.id.clone()).collect()
            } else {
                Vec::new()
            },
        },
    )
}

/// General admission: the names every chosen live event sells (ignoring case), from the first
/// event's list, and the names the Season already prices; each once, sorted ignoring case.
/// `lists` are the chosen events' ticket type names, cancelled events left out.
pub fn offered_tier_names(lists: &[Vec<String>], priced: &[String]) -> Vec<String> {
    let common: Vec<&String> = match lists.first() {
        None => Vec::new(),
        Some(first) => first
            .iter()
            .filter(|n| {
                lists
                    .iter()
                    .all(|l| l.iter().any(|m| tier_key(m) == tier_key(n)))
            })
            .collect(),
    };
    let mut out: Vec<String> = Vec::new();
    for n in common.into_iter().chain(priced) {
        if !out.iter().any(|o| tier_key(o) == tier_key(n)) {
            out.push(n.clone());
        }
    }
    out.sort_by(|a, b| by_name(a, b));
    out
}

/// The checks' context for the chosen events (`ctx` in `SeasonForm.tsx`); Put on sale checks with
/// `complete` and `publishing` both on (review 041).
pub fn preview_context(
    zone: &str,
    chosen: &[PickerEvent],
    levels: &[PreviewLevel],
    tier_names: &[String],
    complete: bool,
    publishing: bool,
) -> SeasonPreviewContext {
    SeasonPreviewContext {
        zone: zone.to_string(),
        events: chosen
            .iter()
            .map(|e| PreviewEvent {
                id: e.id.clone(),
                name: e.name.clone(),
                starts_at: e.starts_at.clone(),
                status: e.status.clone(),
            })
            .collect(),
        levels: levels.to_vec(),
        tier_names: tier_names.to_vec(),
        complete,
        publishing,
    }
}

/// A price box's label: "{level or name} pass price".
pub fn price_label(
    key: &str,
    seated: bool,
    levels: &[PreviewLevel],
    tier_names: &[String],
) -> String {
    let label = if seated {
        levels
            .iter()
            .find(|l| l.id == key)
            .map_or(key, |l| l.name.as_str())
    } else {
        tier_names
            .iter()
            .find(|n| tier_key(n) == key)
            .map_or(key, String::as_str)
    };
    format!("{label} pass price")
}

/// A layout's price levels, as far as the Season form reads `getVenueLayout`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct LayoutLevels {
    pub levels: Vec<LayoutLevel>,
}

/// One of [`LayoutLevels`].
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct LayoutLevel {
    pub id: String,
    pub name: String,
    pub rank: i64,
}

impl LayoutLevels {
    /// The levels as the checks read them.
    pub fn preview(&self) -> Vec<PreviewLevel> {
        self.levels
            .iter()
            .map(|l| PreviewLevel {
                id: l.id.clone(),
                name: l.name.clone(),
                rank: l.rank,
            })
            .collect()
    }
}

/// The note in Pass prices when there is no box to show.
pub fn no_prices_note(layout: &str) -> &'static str {
    if layout.is_empty() {
        "Choose a layout to price its levels."
    } else if layout == GENERAL_ADMISSION {
        "Choose events to price the ticket types they all sell."
    } else {
        "Loading the layout’s price levels…"
    }
}

/// An event's checkbox text in the picker: "{name} · {start in the venue's zone}".
pub fn picker_label(e: &PickerEvent, zone: &str) -> String {
    let when = parse_instant(&e.starts_at).map_or_else(
        || "Invalid Date".to_string(),
        |at| format_event_time(at, zone),
    );
    format!("{} · {when}", e.name)
}
