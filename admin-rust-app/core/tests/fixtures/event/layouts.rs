//! Spec 037: `admin-app/test/fixtures-038.ts` and the venue and event of `fixtures-005.ts`, as
//! JSON values, for the event form and off-sale tests. Arena: 70 seats; Floor A (Front) and
//! Floor B (Back) 3 rows of 10, Balcony (Upper) 2 rows of 5. Club: 12 seats, one level.

#![allow(dead_code)]

use serde_json::{Value, json};

pub const VENUE_ID: &str = "6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e";
pub const EVENT_ID: &str = "b92fc02c-6013-470d-a3bf-bf53648b0ebc";

fn rect(x: f64, y: f64, w: f64, h: f64) -> Value {
    json!([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
}

fn level(id: &str, name: &str, rank: u64, color: &str, seat_count: u64) -> Value {
    json!({ "id": id, "name": name, "rank": rank, "color": color, "seatCount": seat_count })
}

fn section(id: &str, name: &str, level_id: &str, x: f64, rows: u64, per_row: u64) -> Value {
    json!({
        "id": id,
        "name": name,
        "levelId": level_id,
        "outline": rect(x, 0.0, (per_row * 2 + 4) as f64, (rows * 2 + 4) as f64),
        "labelAt": [x + per_row as f64 + 2.0, rows as f64 + 2.0],
        "rowCount": rows,
        "seatCount": rows * per_row,
        "levelIds": [level_id],
    })
}

pub fn arena_summary() -> Value {
    json!({
        "id": "l-arena",
        "locationId": VENUE_ID,
        "name": "Arena",
        "source": "LINES",
        "floorKind": "NONE",
        "seatCount": 70,
        "sectionCount": 3,
        "levelCount": 3,
        "eventsUsing": 0,
        "locked": false,
    })
}

pub fn arena() -> Value {
    let mut v = arena_summary();
    let o = v.as_object_mut().unwrap();
    o.insert("size".into(), json!({ "width": 80, "height": 10 }));
    o.insert("floorOutline".into(), Value::Null);
    o.insert(
        "levels".into(),
        json!([
            level("l-front", "Front", 1, "violet", 30),
            level("l-back", "Back", 2, "teal", 30),
            level("l-upper", "Upper", 3, "blue", 10),
        ]),
    );
    o.insert(
        "sections".into(),
        json!([
            section("s-a", "Floor A", "l-front", 0.0, 3, 10),
            section("s-b", "Floor B", "l-back", 32.0, 3, 10),
            section("s-bal", "Balcony", "l-upper", 64.0, 2, 5),
        ]),
    );
    o.insert(
        "latestPrices".into(),
        json!({
            "eventId": "e-earlier",
            "eventName": "Earlier game",
            "startsAt": "2026-10-01T23:00:00.000Z",
            "prices": [
                { "levelId": "l-front", "price": "90.00" },
                { "levelId": "l-back", "price": "55.00" },
            ],
        }),
    );
    v
}

pub fn club_summary() -> Value {
    let mut v = arena_summary();
    let o = v.as_object_mut().unwrap();
    o.insert("id".into(), json!("l-club"));
    o.insert("name".into(), json!("Club"));
    o.insert("seatCount".into(), json!(12));
    o.insert("sectionCount".into(), json!(1));
    o.insert("levelCount".into(), json!(1));
    v
}

pub fn club() -> Value {
    let mut v = club_summary();
    let o = v.as_object_mut().unwrap();
    o.insert("size".into(), json!({ "width": 20, "height": 10 }));
    o.insert("floorOutline".into(), Value::Null);
    o.insert(
        "levels".into(),
        json!([level("l-club", "Club seats", 1, "orange", 12)]),
    );
    o.insert(
        "sections".into(),
        json!([section("s-club", "Club", "l-club", 0.0, 2, 6)]),
    );
    o.insert("latestPrices".into(), Value::Null);
    v
}

/// `sectionSeats`: one section of a layout, seat by seat.
pub fn section_seats(
    layout_id: &str,
    section_id: &str,
    name: &str,
    level_id: &str,
    rows: u64,
    per_row: u64,
) -> Value {
    let rows: Vec<Value> = (0..rows)
        .map(|r| {
            let seats: Vec<Value> = (0..per_row)
                .map(|s| {
                    json!({
                        "number": s + 1,
                        "label": (s + 1).to_string(),
                        "at": [3 + 2 * s, 3 + 2 * r],
                        "levelId": level_id,
                        "accessible": false,
                    })
                })
                .collect();
            json!({ "number": r + 1, "label": (r + 1).to_string(), "seats": seats })
        })
        .collect();
    json!({ "layoutId": layout_id, "sectionId": section_id, "name": name, "rows": rows })
}

/// `SECTIONS` by id.
pub fn section_by_id(id: &str) -> Value {
    match id {
        "s-a" => section_seats("l-arena", "s-a", "Floor A", "l-front", 3, 10),
        "s-b" => section_seats("l-arena", "s-b", "Floor B", "l-back", 3, 10),
        "s-bal" => section_seats("l-arena", "s-bal", "Balcony", "l-upper", 2, 5),
        "s-club" => section_seats("l-club", "s-club", "Club", "l-club", 2, 6),
        other => panic!("no section {other}"),
    }
}

/// `VENUE` of `fixtures-005.ts` (no zone: Eastern), with another capacity.
pub fn venue(id: &str, name: &str, capacity: u64) -> Value {
    json!({
        "id": id,
        "name": name,
        "address": "1 Arena Plaza, Louisville, KY 40202",
        "street": "1 Arena Plaza",
        "city": "Louisville",
        "state": "KY",
        "zip": "40202",
        "addressVerified": false,
        "seatingCapacity": capacity,
        "createdAt": "2026-09-20T18:57:51.352Z",
        "updatedAt": "2026-09-20T18:57:51.352Z",
    })
}

/// `CENTRAL` of `event-doors-open.test.tsx`: Prairie Hall in Central Time.
pub fn central() -> Value {
    let mut v = venue("v-central", "Prairie Hall", 22090);
    let o = v.as_object_mut().unwrap();
    o.insert("timeZone".into(), json!("America/Chicago"));
    o.insert("timeZoneSource".into(), json!("ADMIN"));
    v
}

/// `EVENT` of `fixtures-005.ts`.
pub fn event() -> Value {
    json!({
        "id": EVENT_ID,
        "name": "Season Opener",
        "locationId": VENUE_ID,
        "location": venue(VENUE_ID, "Yum Center", 22090),
        "startsAt": "2026-11-01T23:00:00.000Z",
        "endsAt": "2026-11-02T02:00:00.000Z",
        "doorsOpenAt": "2026-11-01T22:00:00.000Z",
        "entryOpensAt": "2026-11-01T21:00:00.000Z",
        "totalTicketCapacity": 100,
        "maxTicketsPerCustomer": null,
        "basePrice": "45.00",
        "status": "SCHEDULED",
        "cancelledAt": null,
        "reservedSeating": false,
        "createdAt": "2026-09-20T18:57:51.352Z",
        "updatedAt": "2026-09-20T18:57:51.352Z",
    })
}

/// `json` with `over`'s fields put over `base`'s.
pub fn with(mut base: Value, over: Value) -> Value {
    let o = base.as_object_mut().unwrap();
    for (k, v) in over.as_object().unwrap() {
        o.insert(k.clone(), v.clone());
    }
    base
}

/// A ticket type as `listTiers` gives it.
pub fn tier(id: &str, name: &str, price: &str, quantity: u64) -> Value {
    json!({
        "id": id,
        "eventId": EVENT_ID,
        "name": name,
        "price": price,
        "quantity": quantity,
        "createdAt": "2026-09-20T18:57:51.352Z",
        "updatedAt": "2026-09-20T18:57:51.352Z",
    })
}
