// Copied from admin-rust-app/core/tests/seat_stream.rs at 680b4f7 (spec 040 R4).
//! Spec 037 T058 (#163, parity M16, research R13): the seat stream and the venue map's state,
//! ported test first from `packages/shared/test/web/seat-stream.test.ts` and
//! `packages/shared/test/venue-map/map-state.test.ts`. The fixtures under
//! `tests/fixtures/seat_stream/` are the TypeScript code's own outputs: `sse_cases.json` from
//! `readEvents` in `seat-stream.ts`, `map_scenarios.json` from `mapReducer` in `map-state.ts`.

use customer_rust_core::api::seat_stream::{
    LiveSeatStatus, LiveStatus, MapAnswer, RECONNECT_DELAYS_MS, SeatStream, SeatStreamStatus,
    SectionAnswer, SectionLoader, SseEvent, SseParser, StreamMessage, StreamStep, open_seat_stream,
    section_retry_delay_ms, section_wanted, stream_headers, stream_url,
};
use customer_rust_core::api::types;
use customer_rust_core::seating::map_state::{
    EMPTY_MAP_STATE, LevelSeatCounts, MapAction, MapSectionSummary, MapState, SeatMapChange,
    SeatState, VenueMap, VenueMapSection, map_reducer, needs_load, open_seats_in, section_level,
};
use serde_json::{Value, json};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/seat_stream");

fn fixture(name: &str) -> Value {
    let text = std::fs::read_to_string(format!("{FIXTURES}/{name}")).expect("fixture");
    serde_json::from_str(&text).expect("fixture JSON")
}

fn pairs(events: &[SseEvent]) -> Vec<(String, String)> {
    events
        .iter()
        .map(|e| (e.event.clone(), e.data.clone()))
        .collect()
}

// ------------------------------------------------------------------------------------------
// The parser (`readEvents`)
// ------------------------------------------------------------------------------------------

#[test]
fn parser_matches_the_typescript_on_every_fixture_case() {
    let cases = fixture("sse_cases.json");
    let cases = cases.as_array().expect("cases");
    assert!(cases.len() >= 20);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let expected: Vec<(String, String)> = case["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p[0].as_str().unwrap().to_owned(),
                    p[1].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let byte_chunks: Vec<Vec<u8>> = if let Some(chunks) = case["chunks"].as_array() {
            // Text chunks: fed as text, and as their UTF-8 bytes.
            let mut parser = SseParser::new();
            let mut got = Vec::new();
            for chunk in chunks {
                got.extend(parser.feed_str(chunk.as_str().unwrap()));
            }
            assert_eq!(pairs(&got), expected, "{name} (text)");
            chunks
                .iter()
                .map(|c| c.as_str().unwrap().as_bytes().to_vec())
                .collect()
        } else {
            case["byteChunks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| {
                    c.as_array()
                        .unwrap()
                        .iter()
                        .map(|b| u8::try_from(b.as_u64().unwrap()).unwrap())
                        .collect()
                })
                .collect()
        };
        let mut parser = SseParser::new();
        let mut got = Vec::new();
        for chunk in &byte_chunks {
            got.extend(parser.feed_bytes(chunk));
        }
        assert_eq!(pairs(&got), expected, "{name} (bytes)");
    }
}

#[test]
fn parser_gives_the_same_events_fed_one_byte_at_a_time() {
    let text =
        "event: venueMap\ndata: {\"a\":1}\n\n: ping\nevent: seats\ndata: caf\u{e9}\ndata: 2\n\n";
    let mut whole = SseParser::new();
    let expected = pairs(&whole.feed_bytes(text.as_bytes()));
    let mut parser = SseParser::new();
    let mut got = Vec::new();
    for b in text.as_bytes() {
        got.extend(parser.feed_bytes(std::slice::from_ref(b)));
    }
    assert_eq!(pairs(&got), expected);
    assert_eq!(
        expected,
        vec![
            ("venueMap".to_owned(), "{\"a\":1}".to_owned()),
            ("seats".to_owned(), "caf\u{e9}\n2".to_owned()),
        ]
    );
}

#[test]
fn parser_names_an_unnamed_event_message_and_keeps_named_ones() {
    let mut p = SseParser::default();
    let got = p.feed_str("data: 1\n\nevent: ping\ndata: {}\n\n");
    assert_eq!(
        got,
        vec![
            SseEvent {
                event: "message".into(),
                data: "1".into()
            },
            SseEvent {
                event: "ping".into(),
                data: "{}".into()
            },
        ]
    );
}

// ------------------------------------------------------------------------------------------
// The stream's payloads (spec 038 R12): a venue map, then `seats` changes
// ------------------------------------------------------------------------------------------

/// `seat-stream.test.ts`' `map()`: one section of 4 seats.
fn stream_map(reserved: i64, seq: u64) -> Value {
    json!({
        "eventId": "e1",
        "seq": seq,
        "layoutId": "lay-1",
        "layoutName": "Club",
        "size": { "width": 100, "height": 60 },
        "floorKind": "NONE",
        "floorOutline": null,
        "levels": [{ "levelId": "l1", "name": "Standard", "rank": 1, "color": "violet", "price": "40.00" }],
        "sections": [{
            "sectionId": "s-a",
            "name": "A",
            "outline": [[0, 0], [20, 0], [20, 10], [0, 10]],
            "labelAt": [10, 5],
            "counts": [{ "levelId": "l1", "open": 4 - reserved, "reserved": reserved, "sold": 0, "offSale": 0 }],
        }],
    })
}

/// `seat-stream.test.ts`' `section()`: section A's seats, read at `seq`.
fn stream_section(seq: u64) -> Value {
    let seats: Vec<Value> = (1..=4)
        .map(|n| {
            json!({
                "number": n, "label": n.to_string(), "at": [2 + 4 * n, 5],
                "levelId": "l1", "state": "open", "accessible": false,
            })
        })
        .collect();
    json!({
        "eventId": "e1", "seq": seq, "sectionId": "s-a", "name": "A",
        "rows": [{ "number": 1, "label": "1", "seats": seats }],
    })
}

/// `seat-stream.test.ts`' `change()`.
fn stream_change(seat: u64, state: &str, from: &str, seq: u64) -> Value {
    json!({
        "eventId": "e1",
        "seq": seq,
        "changes": [{ "sectionId": "s-a", "row": 1, "seat": seat, "state": state, "from": from, "levelId": "l1" }],
    })
}

fn as_map(v: Value) -> VenueMap {
    serde_json::from_value(v).expect("a VenueMap")
}
fn as_section(v: Value) -> VenueMapSection {
    serde_json::from_value(v).expect("a VenueMapSection")
}
fn as_change(v: Value) -> SeatMapChange {
    serde_json::from_value(v).expect("a SeatMapChange")
}

fn send(event: &str, data: &Value) -> Vec<u8> {
    format!("event: {event}\ndata: {data}\n\n").into_bytes()
}

/// A stream connected and answered 200, ready to read.
fn connected() -> SeatStream {
    let mut s = open_seat_stream();
    assert!(s.connect());
    assert_eq!(s.on_response(200), StreamStep::Read);
    s
}

#[test]
fn stream_parses_events_across_chunk_boundaries_and_ignores_ping() {
    let mut s = connected();
    let text = format!(
        "event: venueMap\ndata: {}\n\nevent: ping\ndata: {{}}\n\n",
        stream_map(0, 5)
    );
    let mut messages = Vec::new();
    for part in [&text[..17], &text[17..60], &text[60..]] {
        let r = s.on_chunk(part.as_bytes());
        assert_eq!(r.then, None);
        messages.extend(r.messages);
    }
    messages.extend(s.on_chunk(b"event: seats\r\ndata: ").messages);
    messages.extend(
        s.on_chunk(format!("{}\r\n\r\n", stream_change(3, "reserved", "open", 6)).as_bytes())
            .messages,
    );
    assert_eq!(
        messages,
        vec![
            StreamMessage::Map(Box::new(as_map(stream_map(0, 5)))),
            StreamMessage::Change(as_change(stream_change(3, "reserved", "open", 6))),
        ]
    );
}

#[test]
fn stream_sends_only_the_bearer_token_and_accept() {
    assert_eq!(
        stream_url("http://api.test", "e1"),
        "http://api.test/events/e1/seats/stream"
    );
    // `encodeURIComponent`.
    assert_eq!(
        stream_url("http://api.test", "a b/c?d=é~*'()!"),
        "http://api.test/events/a%20b%2Fc%3Fd%3D%C3%A9~*'()!/seats/stream"
    );
    assert_eq!(
        stream_headers(Some("tok-1")),
        vec![
            ("Accept", "text/event-stream".to_owned()),
            ("Authorization", "Bearer tok-1".to_owned()),
        ]
    );
    // No token (or an empty one): no `Authorization`.
    assert_eq!(
        stream_headers(None),
        vec![("Accept", "text/event-stream".to_owned())]
    );
    assert_eq!(
        stream_headers(Some("")),
        vec![("Accept", "text/event-stream".to_owned())]
    );
}

#[test]
fn stream_reconnects_at_once_when_the_server_ends_it_after_a_map() {
    let mut s = connected();
    assert_eq!(s.status(), SeatStreamStatus::Connecting);
    let r = s.on_chunk(&send("venueMap", &stream_map(0, 5)));
    assert_eq!(r.messages.len(), 1);
    assert_eq!(s.status(), SeatStreamStatus::Live);
    // The planned end at token expiry: connect again at once (with the token then current).
    assert_eq!(s.on_end(), StreamStep::Connect);
    assert!(s.connect());
    assert_eq!(s.on_response(200), StreamStep::Read);
    // The new connection has seen no map yet: an end now waits.
    assert_eq!(s.on_end(), StreamStep::ConnectAfter(1_000));
}

#[test]
fn stream_reconnects_after_a_drop_or_an_error_status_waiting_1_2_then_5_seconds() {
    assert_eq!(RECONNECT_DELAYS_MS, [1_000, 2_000, 5_000]);
    let mut s = open_seat_stream();
    assert!(s.connect());
    // fetch threw ("Failed to fetch").
    assert_eq!(s.on_error(), StreamStep::ConnectAfter(1_000));
    assert_eq!(s.status(), SeatStreamStatus::Reconnecting);
    assert!(s.connect());
    assert_eq!(s.on_response(401), StreamStep::ConnectAfter(2_000));
    assert!(s.connect());
    assert_eq!(s.on_response(503), StreamStep::ConnectAfter(5_000));
    assert!(s.connect());
    assert_eq!(s.on_response(302), StreamStep::ConnectAfter(5_000));
    assert!(s.connect());
    assert_eq!(s.on_response(200), StreamStep::Read);
    // Read, then dropped before any map: wait again, still 5 seconds.
    assert_eq!(s.on_error(), StreamStep::ConnectAfter(5_000));
    assert_eq!(s.status(), SeatStreamStatus::Reconnecting);
    // A map resets the count.
    assert!(s.connect());
    assert_eq!(s.on_response(200), StreamStep::Read);
    s.on_chunk(&send("venueMap", &stream_map(0, 5)));
    assert_eq!(s.status(), SeatStreamStatus::Live);
    assert_eq!(s.on_error(), StreamStep::ConnectAfter(1_000));
}

#[test]
fn stream_waits_again_after_a_stream_that_drops_or_ends_before_its_venue_map() {
    let mut s = connected();
    assert_eq!(s.on_error(), StreamStep::ConnectAfter(1_000));
    let mut s = connected();
    s.on_chunk(&send("seats", &stream_change(1, "sold", "open", 6)));
    assert_eq!(s.on_end(), StreamStep::ConnectAfter(1_000));
    assert!(s.connect());
    assert_eq!(s.on_response(200), StreamStep::Read);
    assert_eq!(s.on_end(), StreamStep::ConnectAfter(2_000));
}

#[test]
fn stream_stops_after_a_404() {
    let mut s = open_seat_stream();
    assert!(s.connect());
    assert_eq!(s.on_response(404), StreamStep::Stop);
    assert_eq!(s.status(), SeatStreamStatus::Gone);
    assert!(!s.connect());
    assert_eq!(s.on_error(), StreamStep::Stop);
    assert_eq!(s.on_end(), StreamStep::Stop);
}

#[test]
fn stream_hands_over_each_venue_map_the_first_and_any_later_one() {
    let mut s = connected();
    let mut bytes = send("venueMap", &stream_map(0, 5));
    bytes.extend(send("venueMap", &stream_map(1, 9)));
    let r = s.on_chunk(&bytes);
    assert_eq!(
        r.messages,
        vec![
            StreamMessage::Map(Box::new(as_map(stream_map(0, 5)))),
            StreamMessage::Map(Box::new(as_map(stream_map(1, 9)))),
        ]
    );
}

#[test]
fn stream_close_never_reconnects() {
    let mut s = connected();
    s.close();
    assert_eq!(s.status(), SeatStreamStatus::Closed);
    // The aborted read fails, or the server's end arrives: neither reconnects.
    assert_eq!(s.on_error(), StreamStep::Stop);
    assert_eq!(s.on_end(), StreamStep::Stop);
    assert!(!s.connect());
    assert_eq!(s.status(), SeatStreamStatus::Closed);
    // A chunk read after closing gives nothing.
    assert!(
        s.on_chunk(&send("venueMap", &stream_map(0, 5)))
            .messages
            .is_empty()
    );
}

#[test]
fn stream_treats_a_payload_that_is_not_json_as_a_drop_keeping_what_came_before() {
    let mut s = connected();
    let mut bytes = send("seats", &stream_change(1, "sold", "open", 6));
    bytes.extend(b"event: venueMap\ndata: {not json\n\n");
    bytes.extend(send("seats", &stream_change(2, "sold", "open", 7)));
    let r = s.on_chunk(&bytes);
    // The change before is handed over; the rest of the chunk is not read.
    assert_eq!(
        r.messages,
        vec![StreamMessage::Change(as_change(stream_change(
            1, "sold", "open", 6
        )))]
    );
    // `venueMap` set live and reset the failures before its payload was read (the TS order).
    assert_eq!(r.then, Some(StreamStep::ConnectAfter(1_000)));
    assert_eq!(s.status(), SeatStreamStatus::Reconnecting);

    let mut s = connected();
    let r = s.on_chunk(b"event: seats\ndata: [1]\n\n");
    assert!(r.messages.is_empty());
    assert_eq!(r.then, Some(StreamStep::ConnectAfter(1_000)));
}

#[test]
fn stream_starts_each_connection_with_a_fresh_parser() {
    let mut s = connected();
    // Half an event, then the connection drops.
    s.on_chunk(b"event: venueMap\ndata: {\"half\":");
    assert_eq!(s.on_error(), StreamStep::ConnectAfter(1_000));
    assert!(s.connect());
    assert_eq!(s.on_response(200), StreamStep::Read);
    let r = s.on_chunk(&send("seats", &stream_change(1, "sold", "open", 6)));
    assert_eq!(r.then, None);
    assert_eq!(r.messages.len(), 1);
}

// ------------------------------------------------------------------------------------------
// The open section's seats: retry (1, 2, 4, 8, then every 10 s) and the version check
// ------------------------------------------------------------------------------------------

#[test]
fn section_retry_waits_1_2_4_8_then_every_10_seconds() {
    let waits: Vec<u64> = (0..7).map(section_retry_delay_ms).collect();
    assert_eq!(
        waits,
        vec![1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]
    );
    assert_eq!(section_retry_delay_ms(64), 10_000);

    let mut l = SectionLoader::new();
    let v = l.map_version();
    let mut got = Vec::new();
    for answer in [
        SectionAnswer::NoAnswer,
        SectionAnswer::Status(503),
        SectionAnswer::Status(500),
        SectionAnswer::NoAnswer,
        SectionAnswer::Status(502),
        SectionAnswer::NoAnswer,
    ] {
        let r = l.on_answer(v, answer);
        assert!(!r.store);
        got.push(r.retry_after_ms);
    }
    assert_eq!(got, [1_000, 2_000, 4_000, 8_000, 10_000, 10_000].map(Some));
}

#[test]
fn section_retry_after_a_network_error_or_a_5xx_then_loads() {
    // `tries the open section again after a network error or a 5xx, waiting longer each time`.
    let mut l = SectionLoader::new();
    let v = l.map_version();
    assert_eq!(
        l.on_answer(v, SectionAnswer::NoAnswer).retry_after_ms,
        Some(1_000)
    );
    assert_eq!(
        l.on_answer(v, SectionAnswer::Status(503)).retry_after_ms,
        Some(2_000)
    );
    let r = l.on_answer(v, SectionAnswer::Loaded);
    assert!(r.store);
    assert_eq!(r.retry_after_ms, None);
    // Loaded: the next failure starts from the first wait again.
    assert_eq!(
        l.on_answer(v, SectionAnswer::NoAnswer).retry_after_ms,
        Some(1_000)
    );
}

#[test]
fn section_is_not_tried_again_after_a_4xx_the_known_quirk() {
    // `does not try a section again that is not there (404)`; a 401 is not retried either.
    let mut l = SectionLoader::new();
    let v = l.map_version();
    for status in [404, 401, 403, 400, 499, 302, 204] {
        let r = l.on_answer(v, SectionAnswer::Status(status));
        assert_eq!(r.retry_after_ms, None, "{status}");
        assert!(!r.store);
    }
    // A 4xx leaves the failure count as it was: no reset.
    assert_eq!(
        l.on_answer(v, SectionAnswer::Status(503)).retry_after_ms,
        Some(1_000)
    );
    assert_eq!(
        l.on_answer(v, SectionAnswer::Status(404)).retry_after_ms,
        None
    );
    assert_eq!(
        l.on_answer(v, SectionAnswer::Status(500)).retry_after_ms,
        Some(2_000)
    );
}

#[test]
fn section_tries_start_again_from_the_first_wait_for_another_section() {
    let mut l = SectionLoader::new();
    let v = l.map_version();
    l.on_answer(v, SectionAnswer::NoAnswer);
    l.on_answer(v, SectionAnswer::NoAnswer);
    l.open_changed();
    assert_eq!(
        l.on_answer(v, SectionAnswer::NoAnswer).retry_after_ms,
        Some(1_000)
    );
}

#[test]
fn section_read_before_a_newer_map_is_dropped() {
    let mut l = SectionLoader::new();
    let asked = l.map_version();
    l.on_map();
    assert_ne!(l.map_version(), asked);
    let r = l.on_answer(asked, SectionAnswer::Loaded);
    assert!(!r.store);
    assert_eq!(r.retry_after_ms, None);
    // But it still counts as an answer: failures reset.
    l.on_answer(asked, SectionAnswer::NoAnswer);
    let now = l.map_version();
    assert!(l.on_answer(now, SectionAnswer::Loaded).store);
}

#[test]
fn section_is_wanted_when_open_with_a_map_and_not_loaded_for_it() {
    let s = map_reducer(EMPTY_MAP_STATE, MapAction::Map(as_map(stream_map(0, 5))));
    assert!(!section_wanted(&EMPTY_MAP_STATE, Some("s-a")));
    assert!(!section_wanted(&s, None));
    assert!(section_wanted(&s, Some("s-a")));
    let s = map_reducer(s, MapAction::Section(as_section(stream_section(5))));
    assert!(!section_wanted(&s, Some("s-a")));
    // A new map: wanted again.
    let s = map_reducer(s, MapAction::Map(as_map(stream_map(1, 9))));
    assert!(section_wanted(&s, Some("s-a")));
}

// ------------------------------------------------------------------------------------------
// The status shown (parity M16)
// ------------------------------------------------------------------------------------------

#[test]
fn status_is_missing_when_the_map_answers_404_and_no_stream_opens() {
    let mut st = LiveStatus::new();
    assert_eq!(st.shown(false), LiveSeatStatus::Loading);
    assert!(!st.on_map_answer(MapAnswer::Status(404)));
    assert_eq!(st.shown(false), LiveSeatStatus::Missing);
}

#[test]
fn status_follows_the_stream_once_the_map_is_read() {
    let mut st = LiveStatus::new();
    assert!(st.on_map_answer(MapAnswer::Status(200)));
    assert_eq!(st.shown(true), LiveSeatStatus::Loading);
    st.on_stream_status(SeatStreamStatus::Connecting);
    assert_eq!(st.shown(true), LiveSeatStatus::Connecting);
    st.on_stream_status(SeatStreamStatus::Live);
    assert_eq!(st.shown(true), LiveSeatStatus::Live);
    st.on_stream_status(SeatStreamStatus::Reconnecting);
    assert_eq!(st.shown(true), LiveSeatStatus::Reconnecting);
    // Closing (leaving the page) changes nothing.
    st.on_stream_status(SeatStreamStatus::Closed);
    assert_eq!(st.shown(true), LiveSeatStatus::Reconnecting);
    // A 404 after it was live: the event was deleted or switched to general admission.
    st.on_stream_status(SeatStreamStatus::Gone);
    assert_eq!(st.shown(true), LiveSeatStatus::Missing);
    assert_eq!(st.shown(false), LiveSeatStatus::Missing);
}

#[test]
fn status_is_offline_after_a_404_before_the_stream_was_live() {
    let mut st = LiveStatus::new();
    assert!(st.on_map_answer(MapAnswer::Status(200)));
    st.on_stream_status(SeatStreamStatus::Connecting);
    st.on_stream_status(SeatStreamStatus::Gone);
    assert_eq!(st.shown(true), LiveSeatStatus::Offline);
    // With no map at all: unreachable.
    assert_eq!(st.shown(false), LiveSeatStatus::Unreachable);
}

#[test]
fn status_is_unreachable_while_reconnecting_with_no_map() {
    let mut st = LiveStatus::new();
    // A network error or a 5xx on the map: the stream may still deliver one.
    assert!(st.on_map_answer(MapAnswer::NoAnswer));
    assert_eq!(st.shown(false), LiveSeatStatus::Loading);
    st.on_stream_status(SeatStreamStatus::Reconnecting);
    assert_eq!(st.shown(false), LiveSeatStatus::Unreachable);
    assert_eq!(st.shown(true), LiveSeatStatus::Reconnecting);
    let mut st = LiveStatus::new();
    assert!(st.on_map_answer(MapAnswer::Status(503)));
    st.on_stream_status(SeatStreamStatus::Connecting);
    assert_eq!(st.shown(false), LiveSeatStatus::Connecting);
}

#[test]
fn status_starts_over_for_another_event() {
    let mut st = LiveStatus::new();
    st.on_map_answer(MapAnswer::Status(200));
    st.on_stream_status(SeatStreamStatus::Live);
    st.reset();
    assert_eq!(st.shown(true), LiveSeatStatus::Loading);
    // `wasLive` forgotten too.
    st.on_stream_status(SeatStreamStatus::Gone);
    assert_eq!(st.shown(true), LiveSeatStatus::Offline);
}

#[test]
fn stream_and_status_together_after_a_404() {
    let mut s = open_seat_stream();
    let mut st = LiveStatus::new();
    st.on_map_answer(MapAnswer::Status(200));
    st.on_stream_status(s.status());
    assert!(s.connect());
    assert_eq!(s.on_response(200), StreamStep::Read);
    s.on_chunk(&send("venueMap", &stream_map(0, 5)));
    st.on_stream_status(s.status());
    assert_eq!(st.shown(true), LiveSeatStatus::Live);
    assert_eq!(s.on_end(), StreamStep::Connect);
    assert!(s.connect());
    assert_eq!(s.on_response(404), StreamStep::Stop);
    st.on_stream_status(s.status());
    assert_eq!(st.shown(true), LiveSeatStatus::Missing);
}

// ------------------------------------------------------------------------------------------
// `mapReducer` (map-state.test.ts)
// ------------------------------------------------------------------------------------------

const L1: &str = "l-court";
const L2: &str = "l-side";
const L3: &str = "l-end";
const L4: &str = "l-upper";
const S115: &str = "s-115";
const S101: &str = "s-101";
const S301: &str = "s-301";

fn counts(level_id: &str, open: i64, reserved: i64, sold: i64, off_sale: i64) -> LevelSeatCounts {
    LevelSeatCounts {
        level_id: level_id.into(),
        open,
        reserved,
        sold,
        off_sale,
    }
}

fn venue_map(seq: u64) -> VenueMap {
    let square = json!([[0, 0], [10, 0], [10, 10], [0, 10]]);
    let c = |l: &str, open: i64, off: i64| json!({ "levelId": l, "open": open, "reserved": 0, "sold": 0, "offSale": off });
    as_map(json!({
        "eventId": "e1",
        "seq": seq,
        "layoutId": "lay-1",
        "layoutName": "Basketball",
        "size": { "width": 1000, "height": 640 },
        "floorKind": "COURT",
        "floorOutline": square,
        "levels": [
            { "levelId": L1, "name": "Courtside", "rank": 1, "color": "violet", "price": "95.00" },
            { "levelId": L2, "name": "Lower sideline", "rank": 2, "color": "blue", "price": "60.00" },
            { "levelId": L3, "name": "Lower end", "rank": 3, "color": "teal", "price": "35.00" },
            { "levelId": L4, "name": "Upper", "rank": 4, "color": "green", "price": null },
        ],
        "sections": [
            { "sectionId": S115, "name": "115", "outline": square, "labelAt": [5, 5], "counts": [c(L1, 2, 0), c(L2, 1, 0)] },
            { "sectionId": S101, "name": "101", "outline": square, "labelAt": [5, 5], "counts": [c(L3, 3, 0)] },
            { "sectionId": S301, "name": "301", "outline": square, "labelAt": [5, 5], "counts": [c(L4, 0, 4)] },
        ],
    }))
}

fn section115(seq: u64) -> VenueMapSection {
    let seat = |n: u64, x: u64, y: u64, l: &str| json!({ "number": n, "label": n.to_string(), "at": [x, y], "levelId": l, "state": "open", "accessible": false });
    as_section(json!({
        "eventId": "e1",
        "seq": seq,
        "sectionId": S115,
        "name": "115",
        "rows": [
            { "number": 1, "label": "F", "seats": [seat(7, 1, 1, L1), seat(8, 3, 1, L1)] },
            { "number": 2, "label": "P", "seats": [seat(7, 1, 3, L2)] },
        ],
    }))
}

fn change_at(
    seq: u64,
    seat: u64,
    from: &str,
    state: &str,
    row: u64,
    level_id: &str,
) -> SeatMapChange {
    as_change(json!({
        "eventId": "e1",
        "seq": seq,
        "changes": [{ "sectionId": S115, "row": row, "seat": seat, "from": from, "state": state, "levelId": level_id }],
    }))
}
fn change(seq: u64, seat: u64, from: &str, state: &str) -> SeatMapChange {
    change_at(seq, seat, from, state, 1, L1)
}

fn run(state: MapState, actions: impl IntoIterator<Item = MapAction>) -> MapState {
    actions.into_iter().fold(state, map_reducer)
}
fn level(s: &MapState, section_id: &str, level_id: &str) -> Option<LevelSeatCounts> {
    s.map
        .as_ref()?
        .sections
        .iter()
        .find(|x| x.section_id == section_id)?
        .counts
        .iter()
        .find(|c| c.level_id == level_id)
        .cloned()
}
fn seat_state(s: &MapState, row: u64, seat: u64) -> Option<SeatState> {
    s.sections
        .get(S115)?
        .section
        .rows
        .iter()
        .find(|r| r.number == row)?
        .seats
        .iter()
        .find(|x| x.number == seat)
        .map(|x| x.state)
}
use MapAction::{Change, Map, Reset, Section};

#[test]
fn reducer_starts_empty_and_takes_a_snapshot() {
    assert_eq!(EMPTY_MAP_STATE.map, None);
    assert_eq!(MapState::default(), EMPTY_MAP_STATE);
    let s = map_reducer(EMPTY_MAP_STATE, Map(venue_map(10)));
    assert_eq!(s.map, Some(venue_map(10)));
}

#[test]
fn reducer_applies_a_change_to_the_counts() {
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Change(change(11, 7, "open", "reserved")),
        ],
    );
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 1, 1, 0, 0)));
    // The other level and sections are untouched.
    assert_eq!(level(&s, S115, L2), Some(counts(L2, 1, 0, 0, 0)));
    assert_eq!(level(&s, S101, L3), Some(counts(L3, 3, 0, 0, 0)));
}

#[test]
fn reducer_skips_a_change_not_above_the_maps_seq_and_one_seen_before() {
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Change(change(9, 7, "open", "reserved")),
            Change(change(10, 7, "open", "reserved")),
            Change(change(11, 8, "open", "sold")),
            Change(change(11, 8, "open", "sold")),
        ],
    );
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 1, 0, 1, 0)));
    assert_eq!(s.applied, vec![11]);
    // A change seen before is still kept again (the TS keeps both).
    assert_eq!(
        s.recent.iter().map(|c| c.seq).collect::<Vec<_>>(),
        vec![11, 11]
    );
}

#[test]
fn reducer_gives_the_same_counts_whatever_order_the_changes_arrive_in() {
    let a = change(11, 7, "open", "reserved");
    let b = change(12, 7, "reserved", "sold");
    let c = change_at(13, 7, "open", "offSale", 2, L2);
    let base = map_reducer(EMPTY_MAP_STATE, Map(venue_map(10)));
    let in_order = run(base.clone(), [a.clone(), b.clone(), c.clone()].map(Change));
    let reversed = run(base, [c, b, a].map(Change));
    assert_eq!(reversed.map, in_order.map);
    assert_eq!(level(&in_order, S115, L1), Some(counts(L1, 1, 0, 1, 0)));
    assert_eq!(level(&in_order, S115, L2), Some(counts(L2, 0, 0, 0, 1)));
}

#[test]
fn reducer_lets_a_count_dip_below_zero_and_readers_clamp_it() {
    let base = map_reducer(EMPTY_MAP_STATE, Map(venue_map(10)));
    // The later change first: reserved goes to −1 until the earlier one arrives.
    let s = map_reducer(base, Change(change(12, 7, "reserved", "sold")));
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 2, -1, 1, 0)));
    let c = level(&s, S115, L1).unwrap();
    assert_eq!(c.clamped(SeatState::Reserved), 0);
    assert_eq!(c.clamped(SeatState::Sold), 1);
    assert_eq!(c.get(SeatState::Reserved), -1);
    let s = map_reducer(s, Change(change(11, 7, "open", "reserved")));
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 1, 0, 1, 0)));
}

#[test]
fn reducer_skips_a_change_to_the_same_state_and_adds_a_level_it_has_not_seen() {
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Change(change(11, 7, "open", "open")),
            Change(change_at(12, 9, "offSale", "open", 1, "l-new")),
        ],
    );
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 2, 0, 0, 0)));
    // Appended after the section's other levels, starting from 0.
    let sec = &s.map.as_ref().unwrap().sections[0];
    assert_eq!(sec.counts.len(), 3);
    assert_eq!(sec.counts[2], counts("l-new", 1, 0, 0, -1));
    // Both are counted as applied.
    assert_eq!(s.applied, vec![11, 12]);
}

#[test]
fn reducer_applies_changes_to_a_loaded_sections_seats_only_above_the_sections_seq() {
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Section(section115(12)),
            // In the counts (above 10), already in the section (not above 12).
            Change(change(11, 7, "open", "reserved")),
            Change(change(13, 8, "open", "sold")),
        ],
    );
    assert_eq!(seat_state(&s, 1, 7), Some(SeatState::Open));
    assert_eq!(seat_state(&s, 1, 8), Some(SeatState::Sold));
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 0, 1, 1, 0)));
}

#[test]
fn reducer_keeps_each_seat_at_its_latest_change_whatever_the_order() {
    let base = run(
        EMPTY_MAP_STATE,
        [Map(venue_map(10)), Section(section115(10))],
    );
    let later = change(12, 7, "reserved", "sold");
    let earlier = change(11, 7, "open", "reserved");
    let a = run(
        base.clone(),
        [Change(later.clone()), Change(earlier.clone())],
    );
    let b = run(base, [Change(earlier), Change(later)]);
    assert_eq!(seat_state(&a, 1, 7), Some(SeatState::Sold));
    assert_eq!(seat_state(&b, 1, 7), Some(SeatState::Sold));
    assert_eq!(a.sections[S115].seat_seq.get(&(1, 7)), Some(&12));
}

#[test]
fn reducer_brings_a_section_loaded_later_up_to_date_with_the_changes_after_its_seq() {
    // Read at 11: has seat 7 held, not seat 8.
    let mut read = section115(11);
    read.rows[0].seats[0].state = SeatState::Reserved;
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Change(change(11, 7, "open", "reserved")),
            Change(change(12, 8, "open", "reserved")),
            Section(read),
        ],
    );
    assert_eq!(seat_state(&s, 1, 7), Some(SeatState::Reserved));
    assert_eq!(seat_state(&s, 1, 8), Some(SeatState::Reserved));
}

#[test]
fn reducer_on_a_reconnect_replaces_the_map_and_asks_for_the_open_section_again() {
    let mut s = run(
        EMPTY_MAP_STATE,
        [Map(venue_map(10)), Section(section115(10))],
    );
    assert!(!needs_load(&s, S115));
    assert!(needs_load(&s, S101));
    let mut fresh = venue_map(20);
    fresh.sections[0].counts = vec![counts(L1, 0, 0, 2, 0), counts(L2, 1, 0, 0, 0)];
    s = map_reducer(s, Map(fresh.clone()));
    assert_eq!(s.map, Some(fresh));
    // The old seats stay shown until the reload, which needs_load asks for.
    assert!(s.sections.contains_key(S115));
    assert!(s.sections[S115].stale);
    assert!(needs_load(&s, S115));
    // A change from before the new map is not counted again.
    s = map_reducer(s, Change(change(15, 7, "open", "sold")));
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 0, 0, 2, 0)));
    s = map_reducer(s, Section(section115(20)));
    assert!(!needs_load(&s, S115));
}

#[test]
fn reducer_keeps_a_change_newer_than_a_map_read_again() {
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Change(change(12, 7, "open", "reserved")),
            // Read at 11, before the change at 12, answered after it.
            Map(venue_map(11)),
        ],
    );
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 1, 1, 0, 0)));
    // And not counted twice if it comes again.
    let again = map_reducer(s, Change(change(12, 7, "open", "reserved")));
    assert_eq!(level(&again, S115, L1), Some(counts(L1, 1, 1, 0, 0)));
}

#[test]
fn reducer_ignores_a_map_read_before_the_one_it_has() {
    let mut sold = venue_map(20);
    sold.sections[0].counts = vec![counts(L1, 0, 0, 2, 0), counts(L2, 1, 0, 0, 0)];
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Section(section115(20)),
            Map(sold.clone()),
            Section(section115(20)),
            // Read at 15, before the stream's map at 20, answered after it.
            Map(venue_map(15)),
        ],
    );
    assert_eq!(s.map, Some(sold));
    assert!(!needs_load(&s, S115));
}

#[test]
fn reducer_takes_a_map_at_the_same_seq() {
    let mut relaid = venue_map(20);
    relaid.layout_name = "Basketball, new".into();
    let s = run(EMPTY_MAP_STATE, [Map(venue_map(20)), Map(relaid.clone())]);
    assert_eq!(s.map, Some(relaid));
}

#[test]
fn reducer_takes_a_lower_seq_map_for_another_event() {
    let mut other = venue_map(5);
    other.event_id = "e2".into();
    let s = run(EMPTY_MAP_STATE, [Map(venue_map(20)), Map(other.clone())]);
    assert_eq!(s.map, Some(other));
}

#[test]
fn reducer_ignores_a_change_for_another_event_or_before_any_map() {
    assert_eq!(
        map_reducer(EMPTY_MAP_STATE, Change(change(11, 7, "open", "sold"))),
        EMPTY_MAP_STATE
    );
    let s = map_reducer(EMPTY_MAP_STATE, Map(venue_map(10)));
    let mut other = change(11, 7, "open", "sold");
    other.event_id = "e2".into();
    assert_eq!(map_reducer(s.clone(), Change(other)), s);
}

#[test]
fn reducer_ignores_a_section_of_another_event_but_takes_one_before_any_map() {
    let s = map_reducer(EMPTY_MAP_STATE, Map(venue_map(10)));
    let mut other = section115(12);
    other.event_id = "e2".into();
    assert_eq!(map_reducer(s.clone(), Section(other.clone())), s);
    let early = map_reducer(EMPTY_MAP_STATE, Section(other));
    assert!(early.sections.contains_key(S115));
    assert!(!needs_load(&early, S115));
}

#[test]
fn reducer_resets_to_empty() {
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Section(section115(10)),
            Change(change(11, 7, "open", "sold")),
            Reset,
        ],
    );
    assert_eq!(s, EMPTY_MAP_STATE);
}

#[test]
fn reducer_applies_kept_changes_again_in_seq_order_after_a_new_map() {
    let s = run(
        EMPTY_MAP_STATE,
        [
            Map(venue_map(10)),
            Change(change(13, 7, "reserved", "sold")),
            Change(change(11, 7, "open", "reserved")),
            Change(change(12, 8, "open", "sold")),
        ],
    );
    assert_eq!(s.applied, vec![13, 11, 12]);
    // The same seq again: kept changes above it are applied again, oldest first.
    let s = map_reducer(s, Map(venue_map(10)));
    assert_eq!(s.applied, vec![11, 12, 13]);
    assert_eq!(
        s.recent.iter().map(|c| c.seq).collect::<Vec<_>>(),
        vec![11, 12, 13]
    );
    assert_eq!(level(&s, S115, L1), Some(counts(L1, 0, 0, 2, 0)));
    // Read at 12: only the change at 13 is kept and applied.
    let s = map_reducer(s, Map(venue_map(12)));
    assert_eq!(s.applied, vec![13]);
    assert_eq!(s.recent.len(), 1);
}

#[test]
fn reducer_keeps_the_last_500_changes() {
    let mut s = map_reducer(EMPTY_MAP_STATE, Map(venue_map(10)));
    for seq in 11..=610 {
        s = map_reducer(s, Change(change(seq, 7, "open", "open")));
    }
    assert_eq!(s.recent.len(), 500);
    assert_eq!(s.recent.first().map(|c| c.seq), Some(111));
    assert_eq!(s.recent.last().map(|c| c.seq), Some(610));
    // `applied` is not trimmed.
    assert_eq!(s.applied.len(), 600);
}

// ------------------------------------------------------------------------------------------
// The TypeScript reducer's own outputs (map_scenarios.json)
// ------------------------------------------------------------------------------------------

/// `gen`'s `venueMap(eventId, seq, open)`.
fn scenario_map(event_id: &str, seq: u64, open: i64) -> VenueMap {
    let sections: Vec<Value> = ["s1", "s2"]
        .iter()
        .map(|id| {
            json!({
                "sectionId": id, "name": id.to_uppercase(),
                "outline": [[0, 0], [10, 0], [10, 10], [0, 10]], "labelAt": [5, 5],
                "counts": [{ "levelId": "l1", "open": open, "reserved": 0, "sold": 0, "offSale": 0 }],
            })
        })
        .collect();
    as_map(json!({
        "eventId": event_id, "seq": seq, "layoutId": "lay", "layoutName": "Arena",
        "size": { "width": 100, "height": 60 }, "floorKind": "END_STAGE", "floorOutline": null,
        "levels": [
            { "levelId": "l1", "name": "Floor", "rank": 1, "color": "violet", "price": "95.00" },
            { "levelId": "l2", "name": "Upper", "rank": 2, "color": "blue", "price": null },
        ],
        "sections": sections,
    }))
}

/// `gen`'s `sectionOf(eventId, sectionId, seq)`: 3 rows of 4 seats, row 3 in level `l2`.
fn scenario_section(event_id: &str, section_id: &str, seq: u64) -> VenueMapSection {
    let rows: Vec<Value> = (0..3u8)
        .map(|r| {
            let seats: Vec<Value> = (0..4u64)
                .map(|s| {
                    json!({
                        "number": s + 1, "label": (s + 1).to_string(), "at": [s, r],
                        "levelId": if r == 2 { "l2" } else { "l1" }, "state": "open", "accessible": s == 0,
                    })
                })
                .collect();
            json!({ "number": r + 1, "label": char::from(b'A' + r).to_string(), "seats": seats })
        })
        .collect();
    as_section(json!({
        "eventId": event_id, "seq": seq, "sectionId": section_id,
        "name": section_id.to_uppercase(), "rows": rows,
    }))
}

fn scenario_action(a: &Value) -> MapAction {
    let s = |i: usize| a[i].as_str().unwrap();
    let n = |i: usize| a[i].as_u64().unwrap();
    match s(0) {
        "map" => Map(scenario_map(s(1), n(2), a[3].as_i64().unwrap())),
        "section" => Section(scenario_section(s(1), s(2), n(3))),
        "reset" => Reset,
        "change" => {
            let changes: Vec<Value> = a[3]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| {
                    json!({
                        "sectionId": c[0], "row": c[1], "seat": c[2],
                        "from": c[3], "state": c[4], "levelId": c[5],
                    })
                })
                .collect();
            Change(as_change(
                json!({ "eventId": s(1), "seq": n(2), "changes": changes }),
            ))
        }
        other => panic!("unknown action {other}"),
    }
}

/// `gen`'s `digest(state)`.
fn digest(s: &MapState) -> Value {
    let map = s.map.as_ref();
    let counts: Vec<Value> = map
        .map(|m| {
            m.sections
                .iter()
                .flat_map(|x| {
                    x.counts.iter().map(|c| {
                        json!([
                            x.section_id,
                            c.level_id,
                            c.open,
                            c.reserved,
                            c.sold,
                            c.off_sale
                        ])
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let sections: Vec<Value> = s
        .sections
        .iter()
        .map(|(id, l)| {
            let seats: Vec<String> = l
                .section
                .rows
                .iter()
                .map(|r| {
                    r.seats
                        .iter()
                        .map(|x| x.state.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .collect();
            let mut seat_seq: Vec<(String, u64)> = l
                .seat_seq
                .iter()
                .map(|((r, x), q)| (format!("{r}/{x}"), *q))
                .collect();
            seat_seq.sort();
            json!({
                "id": id, "event": l.section.event_id, "seq": l.section.seq, "stale": l.stale,
                "needsLoad": needs_load(s, id), "seats": seats, "seatSeq": seat_seq,
            })
        })
        .collect();
    json!({
        "mapEvent": map.map(|m| m.event_id.clone()),
        "mapSeq": map.map(|m| m.seq),
        "layoutName": map.map(|m| m.layout_name.clone()),
        "counts": counts,
        "applied": s.applied,
        "recent": s.recent.iter().map(|c| c.seq).collect::<Vec<_>>(),
        "sections": sections,
    })
}

#[test]
fn reducer_matches_the_typescript_on_every_scenario() {
    let scenarios = fixture("map_scenarios.json");
    let scenarios = scenarios.as_array().unwrap();
    assert!(scenarios.len() >= 4);
    let mut checked = 0;
    for sc in scenarios {
        let name = sc["name"].as_str().unwrap();
        let actions = sc["actions"].as_array().unwrap();
        let steps = sc["steps"].as_array().unwrap();
        assert_eq!(actions.len(), steps.len(), "{name}");
        let mut s = EMPTY_MAP_STATE;
        for (i, (a, want)) in actions.iter().zip(steps).enumerate() {
            s = map_reducer(s, scenario_action(a));
            if !want.is_null() {
                assert_eq!(digest(&s), *want, "{name}, step {i}");
                checked += 1;
            }
        }
    }
    assert!(checked > 90);
}

// ------------------------------------------------------------------------------------------
// The colors and counts (map-state.test.ts; `formatPrice` is money.rs')
// ------------------------------------------------------------------------------------------

fn sec(map: &VenueMap, id: &str) -> MapSectionSummary {
    map.sections
        .iter()
        .find(|s| s.section_id == id)
        .unwrap()
        .clone()
}

#[test]
fn colors_a_section_by_its_cheapest_level_with_open_seats() {
    let map = venue_map(10);
    let name = |s: &MapSectionSummary| section_level(&map, s).map(|l| l.name.clone());
    assert_eq!(name(&sec(&map, S115)), Some("Lower sideline".into()));
    assert_eq!(name(&sec(&map, S101)), Some("Lower end".into()));
    // A level whose seats are all taken does not count.
    let mut sold = sec(&map, S115);
    sold.counts = vec![counts(L1, 1, 0, 0, 0), counts(L2, 0, 1, 1, 0)];
    assert_eq!(name(&sold), Some("Courtside".into()));
}

#[test]
fn colors_a_tie_in_price_by_rank_and_skips_an_unknown_level() {
    let mut map = venue_map(10);
    map.levels[0].price = Some("60.00".into());
    let mut s = sec(&map, S115);
    // Same price: the lower rank (Courtside, 1) wins, in either order.
    s.counts = vec![
        counts(L2, 1, 0, 0, 0),
        counts(L1, 1, 0, 0, 0),
        counts("l-x", 9, 0, 0, 0),
    ];
    assert_eq!(
        section_level(&map, &s).map(|l| l.name.as_str()),
        Some("Courtside")
    );
}

#[test]
fn is_unavailable_with_no_open_seat_on_sale() {
    let map = venue_map(10);
    assert_eq!(section_level(&map, &sec(&map, S301)), None);
    let mut taken = sec(&map, S115);
    taken.counts = vec![counts(L1, 0, 1, 1, 0), counts(L2, 0, 1, 0, 0)];
    assert_eq!(section_level(&map, &taken), None);
    // A count dipped below 0 is not open.
    taken.counts = vec![counts(L1, -1, 1, 1, 0)];
    assert_eq!(section_level(&map, &taken), None);
}

#[test]
fn counts_a_sections_open_seats_with_a_price_clamped_at_zero() {
    let map = venue_map(10);
    assert_eq!(open_seats_in(&map, &sec(&map, S115)), 3);
    assert_eq!(open_seats_in(&map, &sec(&map, S301)), 0);
    let mut s = sec(&map, S115);
    s.counts = vec![
        counts(L1, -2, 0, 0, 0),
        counts(L2, 5, 0, 0, 0),
        counts(L4, 7, 0, 0, 0),
        counts("l-x", 4, 0, 0, 0),
    ];
    assert_eq!(open_seats_in(&map, &s), 5);
}

// ------------------------------------------------------------------------------------------
// The contract's types (R5): the generated types convert to the reducer's own
// ------------------------------------------------------------------------------------------

const EVENT: &str = "6f1c2a52-0d55-4f0a-9d8e-0c2b9b2f4d11";
const LAYOUT: &str = "2b8c9a10-6d1e-4b7c-8f1a-3e5d7c9b1a22";
const LEVEL: &str = "9a7b5c3d-1e2f-4a6b-8c0d-2e4f6a8b0c33";
const SECTION: &str = "4d3c2b1a-0f9e-4d8c-b7a6-5f4e3d2c1b44";

#[test]
fn generated_venue_map_converts_to_the_reducers() {
    let v = json!({
        "eventId": EVENT, "seq": 0, "layoutId": LAYOUT, "layoutName": "Hall",
        "size": { "width": 1000, "height": 640 }, "floorKind": "CENTER_STAGE",
        "floorOutline": [[1.5, 2], [10, 0], [10, 10]],
        "levels": [
            { "levelId": LEVEL, "name": "Floor", "rank": 1, "color": "teal", "price": "1200.50" },
            { "levelId": LAYOUT, "name": "Upper", "rank": 2, "color": "brown", "price": null },
        ],
        "sections": [{
            "sectionId": SECTION, "name": "101", "outline": [[0, 0], [10, 0], [10, 10]], "labelAt": [5, 5.5],
            "counts": [{ "levelId": LEVEL, "open": 3, "reserved": 2, "sold": 1, "offSale": 4 }],
        }],
    });
    let generated: types::VenueMap = serde_json::from_value(v.clone()).unwrap();
    let ours: VenueMap = serde_json::from_value(v).unwrap();
    assert_eq!(VenueMap::from(generated), ours);
    assert_eq!(ours.floor_outline.as_ref().unwrap()[0], [1.5, 2.0]);
    assert_eq!(ours.levels[1].price, None);
    assert_eq!(ours.sections[0].counts[0], counts(LEVEL, 3, 2, 1, 4));

    let no_floor = json!({
        "eventId": EVENT, "seq": 3, "layoutId": LAYOUT, "layoutName": "Hall",
        "size": { "width": 10, "height": 10 }, "floorKind": "NONE", "floorOutline": null,
        "levels": [], "sections": [],
    });
    let generated: types::VenueMap = serde_json::from_value(no_floor.clone()).unwrap();
    assert_eq!(
        VenueMap::from(generated),
        serde_json::from_value::<VenueMap>(no_floor).unwrap()
    );
}

#[test]
fn generated_section_and_change_convert_to_the_reducers() {
    let v = json!({
        "eventId": EVENT, "seq": 7, "sectionId": SECTION, "name": "101",
        "rows": [{ "number": 1, "label": "A", "seats": [
            { "number": 1, "label": "1", "at": [1, 2], "levelId": LEVEL, "state": "offSale", "accessible": true },
            { "number": 2, "label": "2", "at": [3, 2], "levelId": LEVEL, "state": "reserved", "accessible": false },
        ] }],
    });
    let generated: types::VenueMapSection = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(
        VenueMapSection::from(generated),
        serde_json::from_value::<VenueMapSection>(v).unwrap()
    );

    let c = json!({
        "eventId": EVENT, "seq": 8,
        "changes": [{ "sectionId": SECTION, "row": 1, "seat": 2, "state": "sold", "from": "reserved", "levelId": LEVEL }],
    });
    let generated: types::SeatMapChange = serde_json::from_value(c.clone()).unwrap();
    let ours = SeatMapChange::from(generated);
    assert_eq!(ours, serde_json::from_value::<SeatMapChange>(c).unwrap());
    assert_eq!(ours.changes[0].from, SeatState::Reserved);
}
