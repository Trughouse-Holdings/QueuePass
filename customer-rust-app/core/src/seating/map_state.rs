// Copied from admin-rust-app/core/src/seating/map_state.rs at 680b4f7 (spec 040 R4).
//! Spec 037 T058 (parity M16, research R13): the venue map's state for one event, ported from
//! `packages/shared/src/web/venue-map/map-state.ts` (spec 038 research R11, R12).
//!
//! The map (`getVenueMap`, and the stream's `venueMap`) gives each section's seats per level and
//! state; a section's seats come one section at a time (`getVenueMapSection`). Both carry the
//! event's `seq` they were read at, and every `seats` change carries its own: a change whose `seq`
//! is not above the map's is already in the map's counts, and one not above a section's is already
//! in that section's seats, so nothing is counted twice, whatever order changes arrive in (FR-023).
//!
//! The payload types are the contract's (`VenueMap`, `VenueMapSection`, `SeatMapChange`), written
//! here as plain serde structs with the contract's field names rather than the generated
//! `crate::api::types` ones, because the reducer needs what those can't give: counts that may dip
//! below 0 between two out-of-order changes (the generated `LevelSeatCounts` fields are `u64`),
//! and `PartialEq`. Each converts `From` its generated type, and the enums (`SeatState`,
//! `LevelColor`, `FloorKind`) are the generated ones. Ids are strings, as in the TypeScript.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::api::types;
pub use crate::api::types::{FloorKind, LevelColor, SeatState};

/// The contract's `MapPoint`: `[x, y]`.
pub type MapPoint = [f64; 2];

/// The contract's `MapSize`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapSize {
    pub width: u64,
    pub height: u64,
}

/// The contract's `VenueMap` (TS `VenueMap`): an event's venue map, by section.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueMap {
    pub event_id: String,
    /// The event's seat-change sequence number this map was read at.
    pub seq: u64,
    pub layout_id: String,
    pub layout_name: String,
    pub size: MapSize,
    pub floor_kind: FloorKind,
    pub floor_outline: Option<Vec<MapPoint>>,
    /// By rank.
    pub levels: Vec<MapLevel>,
    pub sections: Vec<MapSectionSummary>,
}

/// TS `MapLevel` (`VenueMap['levels'][number]`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapLevel {
    pub level_id: String,
    pub name: String,
    pub rank: u64,
    pub color: LevelColor,
    /// This event's price (`"95.00"`); `None` when the level has no seats on sale.
    pub price: Option<String>,
}

/// TS `MapSectionSummary` (`VenueMap['sections'][number]`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSectionSummary {
    pub section_id: String,
    pub name: String,
    pub outline: Vec<MapPoint>,
    pub label_at: MapPoint,
    /// One entry per level the section has seats in.
    pub counts: Vec<LevelSeatCounts>,
}

/// The contract's `LevelSeatCounts`. Kept signed: a count may dip below 0 between two changes of
/// one seat that arrive out of order (see [`map_reducer`]); read it with [`Self::clamped`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelSeatCounts {
    pub level_id: String,
    pub open: i64,
    pub reserved: i64,
    pub sold: i64,
    pub off_sale: i64,
}

impl LevelSeatCounts {
    /// The count of one state, as kept (TS `n[state]`); may be below 0.
    pub fn get(&self, state: SeatState) -> i64 {
        match state {
            SeatState::Open => self.open,
            SeatState::Reserved => self.reserved,
            SeatState::Sold => self.sold,
            SeatState::OffSale => self.off_sale,
        }
    }

    fn slot(&mut self, state: SeatState) -> &mut i64 {
        match state {
            SeatState::Open => &mut self.open,
            SeatState::Reserved => &mut self.reserved,
            SeatState::Sold => &mut self.sold,
            SeatState::OffSale => &mut self.off_sale,
        }
    }

    /// The count of one state as readers show it: `Math.max(0, …)`.
    pub fn clamped(&self, state: SeatState) -> u64 {
        self.get(state).max(0).unsigned_abs()
    }
}

/// The contract's `VenueMapSection` (TS `VenueMapSection`): one section, seat by seat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueMapSection {
    pub event_id: String,
    /// As [`VenueMap::seq`]: only changes with a greater `seq` apply to this section.
    pub seq: u64,
    pub section_id: String,
    pub name: String,
    /// Front first.
    pub rows: Vec<MapRow>,
}

/// A row of `VenueMapSection.rows`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapRow {
    pub number: u64,
    pub label: String,
    pub seats: Vec<MapSeat>,
}

/// A seat of `VenueMapSection.rows[].seats`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSeat {
    pub number: u64,
    pub label: String,
    pub at: MapPoint,
    pub level_id: String,
    pub state: SeatState,
    pub accessible: bool,
}

/// The contract's `SeatMapChange` (TS `SeatMapChange`): seats of one event that changed state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatMapChange {
    pub event_id: String,
    /// The event's seat-change sequence number after this change.
    pub seq: u64,
    pub changes: Vec<SeatStateChange>,
}

/// The contract's `SeatStateChange`: one seat's new state, and the state it left.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatStateChange {
    pub section_id: String,
    pub row: u64,
    pub seat: u64,
    pub state: SeatState,
    pub from: SeatState,
    pub level_id: String,
}

/// TS `LoadedSection`: a section's seats as last loaded, kept current.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedSection {
    pub section: VenueMapSection,
    /// The `seq` of the last change applied to each seat, by `(row, seat)` (TS `"row/seat"`).
    pub seat_seq: BTreeMap<(u64, u64), u64>,
    /// Loaded before the map was read again (a reconnect): shown until loaded again.
    pub stale: bool,
}

/// TS `MapState`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MapState {
    /// The map as read, its counts kept current; its `seq` stays the one it was read at.
    pub map: Option<VenueMap>,
    /// The `seq`s above the map's already applied to its counts.
    pub applied: Vec<u64>,
    /// Changes above the map's `seq`, so a section loaded later catches up (newest last).
    pub recent: Vec<SeatMapChange>,
    /// Loaded sections, by id.
    pub sections: BTreeMap<String, LoadedSection>,
}

/// TS `MapAction`.
#[derive(Debug, Clone, PartialEq)]
pub enum MapAction {
    /// The map, read or sent first by the stream: the first, or the one after a reconnect.
    Map(VenueMap),
    Change(SeatMapChange),
    Section(VenueMapSection),
    Reset,
}

/// TS `EMPTY_MAP_STATE`.
pub const EMPTY_MAP_STATE: MapState = MapState {
    map: None,
    applied: Vec::new(),
    recent: Vec::new(),
    sections: BTreeMap::new(),
};

/// TS `RECENT_KEPT`: how many changes are kept for sections loaded later.
pub const RECENT_KEPT: usize = 500;

/// TS `countChange`: one change applied to a section's counts, −1 in `from`, +1 in `state`, for
/// its level. Not held at 0: two changes of one seat may arrive in either order, and the sum is
/// the same only if a count may dip below 0 between them. A level the section has no counts for
/// is added at the end, from 0.
fn count_change(map: &mut VenueMap, change: &SeatMapChange) {
    for section in &mut map.sections {
        for c in change
            .changes
            .iter()
            .filter(|c| c.section_id == section.section_id)
        {
            if c.from == c.state {
                continue;
            }
            if !section.counts.iter().any(|n| n.level_id == c.level_id) {
                section.counts.push(LevelSeatCounts {
                    level_id: c.level_id.clone(),
                    open: 0,
                    reserved: 0,
                    sold: 0,
                    off_sale: 0,
                });
            }
            for n in section
                .counts
                .iter_mut()
                .filter(|n| n.level_id == c.level_id)
            {
                *n.slot(c.from) -= 1;
                *n.slot(c.state) += 1;
            }
        }
    }
}

/// TS `seatChange`: one change applied to a loaded section's seats, seat by seat, only above the
/// section's `seq` and each seat's last `seq`. A seat named twice in one change takes the first
/// entry's state (TS `find`).
fn seat_change(loaded: &mut LoadedSection, change: &SeatMapChange) {
    let section = &mut loaded.section;
    if change.seq <= section.seq {
        return;
    }
    let here: Vec<&SeatStateChange> = change
        .changes
        .iter()
        .filter(|c| {
            c.section_id == section.section_id
                && change.seq > loaded.seat_seq.get(&(c.row, c.seat)).copied().unwrap_or(0)
        })
        .collect();
    if here.is_empty() {
        return;
    }
    for c in &here {
        loaded.seat_seq.insert((c.row, c.seat), change.seq);
    }
    for row in &mut section.rows {
        for seat in &mut row.seats {
            if let Some(c) = here
                .iter()
                .find(|c| c.row == row.number && c.seat == seat.number)
            {
                seat.state = c.state;
            }
        }
    }
}

/// TS `mapReducer` (research R12): the venue map's reducer.
///
/// - `Map`: a map of the same event with a strictly lower `seq` is ignored (a refresh answered
///   after the stream's newer map); the same `seq` is taken (a layout change or a lines edit ends
///   the stream without a seat change). Loaded sections are marked stale, still shown, and the
///   kept changes above the new map's `seq` are applied again in `seq` order.
/// - `Change`: ignored before any map or for another event. Counted only above the map's `seq`
///   and once per `seq`; applied to each loaded section; kept (up to [`RECENT_KEPT`], repeats
///   included) when above the map's `seq`.
/// - `Section`: ignored for another event than the map's (taken when there is no map); brought up
///   to date with the kept changes above its `seq`.
pub fn map_reducer(state: MapState, action: MapAction) -> MapState {
    match action {
        MapAction::Reset => EMPTY_MAP_STATE,
        MapAction::Map(map) => {
            let same_event = state
                .map
                .as_ref()
                .is_some_and(|m| m.event_id == map.event_id);
            if same_event && state.map.as_ref().is_some_and(|m| map.seq < m.seq) {
                return state;
            }
            let sections = state
                .sections
                .into_iter()
                .map(|(id, s)| (id, LoadedSection { stale: true, ..s }))
                .collect();
            let mut newer: Vec<SeatMapChange> = if same_event {
                state
                    .recent
                    .into_iter()
                    .filter(|c| c.seq > map.seq)
                    .collect()
            } else {
                Vec::new()
            };
            newer.sort_by_key(|c| c.seq);
            let fresh = MapState {
                map: Some(map),
                applied: Vec::new(),
                recent: Vec::new(),
                sections,
            };
            newer
                .into_iter()
                .fold(fresh, |s, change| map_reducer(s, MapAction::Change(change)))
        }
        MapAction::Change(change) => {
            let (mut map, mut applied, mut recent, mut sections) = match state {
                MapState {
                    map: Some(map),
                    applied,
                    recent,
                    sections,
                } if map.event_id == change.event_id => (map, applied, recent, sections),
                other => return other,
            };
            let counted = change.seq > map.seq && !applied.contains(&change.seq);
            for loaded in sections.values_mut() {
                seat_change(loaded, &change);
            }
            if counted {
                count_change(&mut map, &change);
                applied.push(change.seq);
            }
            if change.seq > map.seq {
                recent.push(change);
                if recent.len() > RECENT_KEPT {
                    recent.drain(..recent.len() - RECENT_KEPT);
                }
            }
            MapState {
                map: Some(map),
                applied,
                recent,
                sections,
            }
        }
        MapAction::Section(section) => {
            let mut state = state;
            if state
                .map
                .as_ref()
                .is_some_and(|m| m.event_id != section.event_id)
            {
                return state;
            }
            let mut later: Vec<&SeatMapChange> = state
                .recent
                .iter()
                .filter(|c| c.seq > section.seq)
                .collect();
            later.sort_by_key(|c| c.seq);
            let mut loaded = LoadedSection {
                section,
                seat_seq: BTreeMap::new(),
                stale: false,
            };
            for c in later {
                seat_change(&mut loaded, c);
            }
            state
                .sections
                .insert(loaded.section.section_id.clone(), loaded);
            state
        }
    }
}

/// TS `needsLoad`: whether a section's seats must be loaded: never loaded, or loaded before the
/// current map.
pub fn needs_load(state: &MapState, section_id: &str) -> bool {
    state.sections.get(section_id).is_none_or(|s| s.stale)
}

/// TS `sectionLevel` (FR-016): the level a section is drawn in, its cheapest level (by price,
/// then rank) with open seats; `None` when it has none (gray). Every priced level counts (spec
/// 039's walk removed the price filter); a level with no price, or not in the map, does not.
pub fn section_level<'a>(map: &'a VenueMap, section: &MapSectionSummary) -> Option<&'a MapLevel> {
    let mut best: Option<(&MapLevel, i64)> = None;
    for c in &section.counts {
        if c.open <= 0 {
            continue;
        }
        let Some(level) = map.levels.iter().find(|l| l.level_id == c.level_id) else {
            continue;
        };
        let Some(price) = level.price.as_deref() else {
            continue;
        };
        // The contract's price pattern means a price always reads; NaN in the TypeScript.
        let cents = crate::money::price_cents(price).unwrap_or(0);
        let better = match best {
            None => true,
            Some((b, b_cents)) => cents < b_cents || (cents == b_cents && level.rank < b.rank),
        };
        if better {
            best = Some((level, cents));
        }
    }
    best.map(|(level, _)| level)
}

/// TS `openSeatsIn`: a section's open seats with a price (a level with none is not on sale),
/// each level's count clamped at 0.
pub fn open_seats_in(map: &VenueMap, section: &MapSectionSummary) -> u64 {
    section
        .counts
        .iter()
        .filter(|c| {
            map.levels
                .iter()
                .find(|l| l.level_id == c.level_id)
                .is_some_and(|l| l.price.is_some())
        })
        .map(|c| c.clamped(SeatState::Open))
        .sum()
}

// ---- From the generated contract types (research R5) ----

fn point(p: &types::MapPoint) -> MapPoint {
    [p.0.0, p.0.1]
}

fn outline(o: &types::MapOutline) -> Vec<MapPoint> {
    o.iter().map(point).collect()
}

fn count(n: u64) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

impl From<types::LevelSeatCounts> for LevelSeatCounts {
    fn from(c: types::LevelSeatCounts) -> Self {
        Self {
            level_id: c.level_id.to_string(),
            open: count(c.open),
            reserved: count(c.reserved),
            sold: count(c.sold),
            off_sale: count(c.off_sale),
        }
    }
}

impl From<types::VenueMap> for VenueMap {
    fn from(m: types::VenueMap) -> Self {
        Self {
            event_id: m.event_id.to_string(),
            seq: m.seq,
            layout_id: m.layout_id.to_string(),
            layout_name: m.layout_name,
            size: MapSize {
                width: m.size.width.get(),
                height: m.size.height.get(),
            },
            floor_kind: m.floor_kind,
            floor_outline: m.floor_outline.as_ref().map(outline),
            levels: m
                .levels
                .into_iter()
                .map(|l| MapLevel {
                    level_id: l.level_id.to_string(),
                    name: l.name,
                    rank: l.rank.get(),
                    color: l.color,
                    price: l.price.map(String::from),
                })
                .collect(),
            sections: m
                .sections
                .into_iter()
                .map(|s| MapSectionSummary {
                    section_id: s.section_id.to_string(),
                    name: s.name,
                    outline: outline(&s.outline),
                    label_at: point(&s.label_at),
                    counts: s.counts.into_iter().map(LevelSeatCounts::from).collect(),
                })
                .collect(),
        }
    }
}

impl From<types::VenueMapSection> for VenueMapSection {
    fn from(s: types::VenueMapSection) -> Self {
        Self {
            event_id: s.event_id.to_string(),
            seq: s.seq,
            section_id: s.section_id.to_string(),
            name: s.name,
            rows: s
                .rows
                .into_iter()
                .map(|r| MapRow {
                    number: r.number.get(),
                    label: r.label,
                    seats: r
                        .seats
                        .into_iter()
                        .map(|x| MapSeat {
                            number: x.number.get(),
                            label: x.label,
                            at: point(&x.at),
                            level_id: x.level_id.to_string(),
                            state: x.state,
                            accessible: x.accessible,
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

impl From<types::SeatMapChange> for SeatMapChange {
    fn from(c: types::SeatMapChange) -> Self {
        Self {
            event_id: c.event_id.to_string(),
            seq: c.seq.get(),
            changes: c
                .changes
                .into_iter()
                .map(|x| SeatStateChange {
                    section_id: x.section_id.to_string(),
                    row: x.row.get(),
                    seat: x.seat.get(),
                    state: x.state,
                    from: x.from,
                    level_id: x.level_id.to_string(),
                })
                .collect(),
        }
    }
}
