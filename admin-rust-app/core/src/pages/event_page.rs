//! Spec 037 (tasks T061–T063; parity E9–E11, E14): what the event page, its Ticket tiers and
//! Sales cards, and its image gallery say and work out, as plain functions so the app crate's
//! views only lay them out. Ported from `admin-app/src/pages/EventDetail.tsx`,
//! `admin-app/src/hooks/use-delete.ts`, `admin-app/src/components/TierSection.tsx`,
//! `SalesCard.tsx`, and the shared gallery (`packages/shared/src/web/gallery-size.ts`,
//! `gallery-parts.tsx`, `use-gallery-rotation.ts`).

use serde_json::{Map, Value};

use crate::money::usd;
use crate::pages::attendees_reports::count;
use crate::seating::map_geometry::{js_max, js_min, js_number};

// ------------------------------------------------------------------------------ event page

/// The Per customer line (spec 016 FR-011): a missing limit is "No limit", else "1 ticket",
/// "4 tickets" (`toLocaleString`).
pub fn per_customer(max: Option<u64>) -> String {
    match max {
        None => "No limit".into(),
        Some(n) => format!("{} {}", count(n), if n == 1 { "ticket" } else { "tickets" }),
    }
}

/// Spec 041 FR-019: the event page's link to the event's Season.
pub fn season_link(season_id: &str) -> String {
    format!("/seasons/{season_id}")
}

/// Spec 041 FR-013 (T040): while the presale runs, when single tickets go on sale, in the venue's
/// zone: "Single tickets on sale from Sep 28, 2026, 10:00 AM EDT".
pub fn single_sales_line(single_sales_open_at: &str, time_zone: Option<&str>) -> String {
    format!(
        "Single tickets on sale from {}",
        crate::format::when(single_sales_open_at, time_zone)
    )
}

/// `useCancel`'s question (spec 005 FR-008).
pub fn cancel_confirm(name: &str) -> String {
    format!(
        "Cancel \"{name}\"? Every ticket will be voided and every order refunded. This cannot be undone."
    )
}

/// `useCancel`'s success line: "Cancelled. 1 order refunded, 2 tickets voided." (raw counts).
pub fn cancel_done(orders_refunded: u64, tickets_voided: u64) -> String {
    format!(
        "Cancelled. {orders_refunded} {} refunded, {tickets_voided} {} voided.",
        if orders_refunded == 1 {
            "order"
        } else {
            "orders"
        },
        if tickets_voided == 1 {
            "ticket"
        } else {
            "tickets"
        },
    )
}

/// What `useDelete` deletes (`use-delete.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteKind {
    Venue,
    Event,
    /// Spec 041: a draft Season.
    Season,
}

impl DeleteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DeleteKind::Venue => "venue",
            DeleteKind::Event => "event",
            DeleteKind::Season => "season",
        }
    }
}

/// `useDelete`'s question: `Delete the event "X"? This cannot be undone.`.
pub fn delete_confirm(kind: DeleteKind, name: &str) -> String {
    format!(
        "Delete the {} \"{name}\"? This cannot be undone.",
        kind.as_str()
    )
}

/// `useDelete`'s success notice on the list page.
pub fn deleted_notice(name: &str) -> String {
    format!("Deleted \"{name}\".")
}

/// `useDelete`'s notice when someone else deleted it first (a 404).
pub fn already_gone_notice(name: &str) -> String {
    format!("\"{name}\" no longer exists. The list has been refreshed.")
}

// ------------------------------------------------------------------------------ tiers

/// `TierSection`'s remove question.
pub fn remove_tier_confirm(name: &str) -> String {
    format!("Remove the tier \"{name}\"? This cannot be undone.")
}

/// "Allocated 900 of 1,000 tickets" (`toLocaleString`).
pub fn allocated_line(allocated: u64, capacity: u64) -> String {
    format!(
        "Allocated {} of {} tickets",
        count(allocated),
        count(capacity)
    )
}

/// JavaScript's `Number(text)` for what a text or number input holds: whitespace trimmed, empty is
/// 0, a decimal or exponent number as written; anything else is `NaN` (`None`). An infinite
/// value is `None` too, as `JSON.stringify` writes both as `null`.
pub fn js_number_of(text: &str) -> Option<f64> {
    let t = text.trim();
    if t.is_empty() {
        return Some(0.0);
    }
    let digits_ok = t.chars().all(|c| c.is_ascii_digit() || "+-.eE".contains(c))
        && t.chars().any(|c| c.is_ascii_digit());
    if !digits_ok {
        return None;
    }
    t.parse::<f64>().ok().filter(|n| n.is_finite())
}

/// `JSON.stringify(Number(text))`'s value: an integer as an integer, a fraction as it is, `NaN`
/// as `null`.
pub fn json_number_of(text: &str) -> Value {
    match js_number_of(text) {
        None => Value::Null,
        Some(n) if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 => Value::from(n as i64),
        Some(n) => serde_json::Number::from_f64(n).map_or(Value::Null, Value::Number),
    }
}

/// What a tier form holds, as typed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TierDraft {
    pub name: String,
    pub price: String,
    pub quantity: String,
}

impl TierDraft {
    /// The edit row's starting values: the tier's own.
    pub fn of(name: &str, price: &str, quantity: u64) -> Self {
        TierDraft {
            name: name.into(),
            price: price.into(),
            quantity: quantity.to_string(),
        }
    }
}

/// `createTier`'s body (`TierSection`'s `add`): the typed name and price, and
/// `Number(quantity)`.
pub fn tier_create_body(draft: &TierDraft) -> Value {
    let mut body = Map::new();
    body.insert("name".into(), Value::String(draft.name.clone()));
    body.insert("price".into(), Value::String(draft.price.clone()));
    body.insert("quantity".into(), json_number_of(&draft.quantity));
    Value::Object(body)
}

/// `updateTier`'s body (`TierSection`'s `save`): only the fields that changed; the quantity only
/// for a general-admission event, compared as `Number(quantity) !== tier.quantity`.
pub fn tier_update_body(
    name: &str,
    price: &str,
    quantity: u64,
    draft: &TierDraft,
    seated: bool,
) -> Value {
    let mut body = Map::new();
    if draft.name != name {
        body.insert("name".into(), Value::String(draft.name.clone()));
    }
    if draft.price != price {
        body.insert("price".into(), Value::String(draft.price.clone()));
    }
    if !seated && js_number_of(&draft.quantity) != Some(quantity as f64) {
        body.insert("quantity".into(), json_number_of(&draft.quantity));
    }
    Value::Object(body)
}

// ------------------------------------------------------------------------------ sales

/// The Sales card's first line: "25 of 100 tickets sold".
pub fn sold_line(sold: u64, capacity: u64) -> String {
    format!("{} of {} tickets sold", count(sold), count(capacity))
}

/// The Sales card's checked-in line: "12 checked in".
pub fn checked_in_line(checked_in: u64) -> String {
    format!("{} checked in", count(checked_in))
}

/// A tier's Sold cell: "25 of 100".
pub fn tier_sold_cell(sold: u64, quantity: u64) -> String {
    format!("{} of {}", count(sold), count(quantity))
}

/// A level's Price cell: its price, or "—" when it has none on sale.
pub fn level_price_cell(price: Option<&str>) -> String {
    price.map_or_else(|| "—".into(), usd)
}

/// A level's Sold cell: "n of onSale", or just n for a level deleted since (no `levelId`).
pub fn level_sold_cell(deleted: bool, sold: u64, on_sale: u64) -> String {
    if deleted {
        count(sold)
    } else {
        format!("{} of {}", count(sold), count(on_sale))
    }
}

// ------------------------------------------------------------------------------ gallery

/// `GALLERY_INTERVAL_MS` (`event-image.ts`): the next image every 5 seconds.
pub const GALLERY_INTERVAL_MS: u64 = 5_000;
/// `SLIDE_MS` (`gallery-parts.tsx`): the slide between images.
pub const SLIDE_MS: u64 = 400;
/// `SHOWN_AND_NEXT`: the event page's gallery wants the shown image and the next one.
pub const SHOWN_AND_NEXT: [i64; 2] = [0, 1];
/// `SHOWN_AND_NEIGHBORS`: the full-screen view wants the shown image and both neighbours.
pub const SHOWN_AND_NEIGHBORS: [i64; 3] = [0, 1, -1];

/// `GalleryBox['variant']`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GalleryVariant {
    Card,
    Page,
}

const CARD_TALLEST: f64 = 3.0 / 4.0;
const CARD_FLATTEST: f64 = 2.0;
/// `CARD_MIN_HEIGHT`.
pub const CARD_MIN_HEIGHT: f64 = 160.0;
const PAGE_MIN: f64 = 200.0;
const PAGE_MAX_SHARE: f64 = 0.7;

fn clamp(min: f64, value: f64, max: f64) -> f64 {
    js_max([min, js_min([value, max])])
}

/// `galleryBoxHeight` (spec 014 FR-042, research R18): a card between a 3:4 portrait and a 2:1
/// panorama (4:3 with no shape), never under 160; the event page at least 200 and at most 70% of
/// the window's small height (200 wins), `clamp(200, 40% of the width, 480)` with no shape.
pub fn gallery_box_height(
    variant: GalleryVariant,
    width: f64,
    ratio: Option<f64>,
    viewport_height: f64,
) -> f64 {
    match variant {
        GalleryVariant::Card => {
            let shaped = match ratio {
                None => width * 3.0 / 4.0,
                Some(r) => width / clamp(CARD_TALLEST, r, CARD_FLATTEST),
            };
            js_max([CARD_MIN_HEIGHT, shaped])
        }
        GalleryVariant::Page => match ratio {
            None => clamp(PAGE_MIN, 0.4 * width, 480.0),
            Some(r) => js_max([
                PAGE_MIN,
                js_min([width / r, PAGE_MAX_SHARE * viewport_height]),
            ]),
        },
    }
}

/// The gallery's inline `height`, as React writes a number style: "312.5px".
pub fn height_style(height: f64) -> String {
    format!("{}px", js_number(height))
}

/// `useGalleryRotation`'s `step`: `by` from `index`, wrapping around `count` (0 with none).
pub fn step_index(index: usize, by: i64, count: usize) -> usize {
    if count == 0 {
        return 0;
    }
    let n = count as i64;
    (index as i64 + by).rem_euclid(n) as usize
}

/// `useWantedImages`' indexes around `index`: each at `offsets` from it, wrapping around.
pub fn wanted_around(index: usize, count: usize, offsets: &[i64]) -> Vec<usize> {
    if count == 0 {
        return Vec::new();
    }
    offsets
        .iter()
        .map(|&o| step_index(index, o, count))
        .collect()
}

/// The shown image's place in words: "image 2 of 5" (`ImageGallery`'s `position`).
pub fn image_position(index: usize, count: usize) -> String {
    format!("image {} of {count}", index + 1)
}

/// The count line under the arrows: "2 of 5".
pub fn count_line(index: usize, count: usize) -> String {
    format!("{} of {count}", index + 1)
}

/// The full-screen image button's name: "View {name}, image 2 of 5, full screen".
pub fn view_button_label(event_name: &str, index: usize, count: usize) -> String {
    format!(
        "View {event_name}, {}, full screen",
        image_position(index, count)
    )
}

/// The gallery image's `alt`, and the viewer's name: "{name}, image 2 of 5".
pub fn image_alt(event_name: &str, index: usize, count: usize) -> String {
    format!("{event_name}, {}", image_position(index, count))
}
