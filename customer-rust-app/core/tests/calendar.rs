//! Spec 040 T054 (parity T5–T7; spec 019): Add to calendar. The React app's own outputs for fixed
//! inputs (`fixtures/customer/calendar.json`, written by `scripts/customer-parity-fixtures.mjs`
//! from `customer-app/src/calendar.ts` unchanged) must equal the Rust's byte for byte; then cases
//! of `customer-app/test/calendar.test.ts` and `add-to-calendar.test.tsx` by hand.

use customer_rust_core::api::types::MyOrder;
use customer_rust_core::calendar::{
    CALENDAR_NOTE, CalendarEntry, ICS_TYPE, calendar_eligible, calendar_entry, eligible,
    google_calendar_url, ics_file, ics_file_name,
};
use customer_rust_core::time::parse_instant;
use serde_json::{Value, json};

const FIXTURES: &str = include_str!("fixtures/customer/calendar.json");

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).unwrap()
}

/// The entry the TypeScript's `calendarEntry` makes of a fixture event.
fn entry_of(event: &Value) -> CalendarEntry {
    let s = |v: &Value| v.as_str().unwrap().to_string();
    CalendarEntry {
        uid: format!("queuepass-event-{}", s(&event["id"])),
        title: s(&event["name"]),
        starts_at: s(&event["startsAt"]),
        ends_at: s(&event["endsAt"]),
        location_name: s(&event["location"]["name"]),
        location_address: s(&event["location"]["address"]),
    }
}

fn ms(iso: &str) -> i64 {
    parse_instant(iso).unwrap().timestamp_millis()
}

// ------------------------------------------------------------------ the TypeScript's outputs

#[test]
fn every_file_link_and_name_equals_the_typescripts() {
    let f = fixtures();
    let files = f["files"].as_array().unwrap();
    assert!(files.len() >= 15);
    for case in files {
        let label = case["label"].as_str().unwrap();
        let entry = entry_of(&case["event"]);
        let now = ms(case["now"].as_str().unwrap());
        match case["ics"].as_str() {
            Some(expected) => {
                assert_eq!(ics_file(&entry, now).unwrap(), expected, "{label}");
                assert_eq!(
                    google_calendar_url(&entry).unwrap(),
                    case["google"].as_str().unwrap(),
                    "{label}"
                );
            }
            None => {
                assert!(ics_file(&entry, now).is_err(), "{label}");
                assert!(google_calendar_url(&entry).is_err(), "{label}");
            }
        }
        assert_eq!(
            ics_file_name(&entry.title),
            case["fileName"].as_str().unwrap(),
            "{label}"
        );
    }
}

#[test]
fn every_file_name_equals_the_typescripts() {
    for case in fixtures()["fileNames"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        assert_eq!(
            ics_file_name(name),
            case["fileName"].as_str().unwrap(),
            "{name:?}"
        );
    }
}

#[test]
fn eligibility_equals_the_typescripts() {
    for case in fixtures()["eligible"].as_array().unwrap() {
        let o = &case["order"];
        let got = eligible(
            o["event"]["status"] == "CANCELLED",
            o["event"]["startsAt"].as_str().unwrap(),
            o["event"]["endsAt"].as_str().unwrap(),
            o["tickets"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["status"] == "VALID"),
            case["nowMs"].as_i64().unwrap(),
        );
        assert_eq!(
            got,
            case["eligible"].as_bool().unwrap(),
            "{}",
            case["label"]
        );
    }
}

// ------------------------------------------------------------------ calendar.test.ts by hand

const EVENT_ID: &str = "6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21";

fn opener() -> CalendarEntry {
    CalendarEntry {
        uid: format!("queuepass-event-{EVENT_ID}"),
        title: "Season Opener".into(),
        starts_at: "2026-10-31T23:30:00.000Z".into(),
        ends_at: "2026-11-01T02:45:00.000Z".into(),
        location_name: "KFC Yum! Center".into(),
        location_address: "1 ARENA PLAZA, LOUISVILLE, KY 40202".into(),
    }
}

#[test]
fn the_r3_example_character_for_character() {
    let expected = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QueuePass//Customer app//EN\r\n\
        CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\n\
        UID:queuepass-event-6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21\r\nDTSTAMP:20261024T153000Z\r\n\
        DTSTART:20261031T233000Z\r\nDTEND:20261101T024500Z\r\nSUMMARY:Season Opener\r\n\
        LOCATION:KFC Yum! Center\\, 1 ARENA PLAZA\\, LOUISVILLE\\, KY 40202\r\n\
        END:VEVENT\r\nEND:VCALENDAR\r\n";
    assert_eq!(
        ics_file(&opener(), ms("2026-10-24T15:30:00.000Z")).unwrap(),
        expected
    );
}

fn summary_lines(name: &str) -> Vec<String> {
    let entry = CalendarEntry {
        title: name.into(),
        ..opener()
    };
    let file = ics_file(&entry, 0).unwrap();
    let lines: Vec<&str> = file.trim_end_matches("\r\n").split("\r\n").collect();
    let i = lines
        .iter()
        .position(|l| l.starts_with("SUMMARY:"))
        .unwrap();
    let mut out = vec![lines[i].to_string()];
    out.extend(
        lines[i + 1..]
            .iter()
            .take_while(|l| l.starts_with(' '))
            .map(|l| l.to_string()),
    );
    out
}

#[test]
fn folds_at_75_octets_never_inside_a_character() {
    assert_eq!(
        summary_lines(&"y".repeat(67)),
        vec![format!("SUMMARY:{}", "y".repeat(67))]
    );
    assert_eq!(
        summary_lines(&"y".repeat(68)),
        vec![format!("SUMMARY:{}", "y".repeat(67)), " y".into()]
    );
    assert_eq!(
        summary_lines(&"é".repeat(100)),
        vec![
            format!("SUMMARY:{}", "é".repeat(33)),
            format!(" {}", "é".repeat(37)),
            format!(" {}", "é".repeat(30)),
        ]
    );
}

#[test]
fn escapes_backslash_first_and_drops_control_characters_but_tab() {
    assert_eq!(
        summary_lines("\\;,\r\n\n\r\u{0}\t:\""),
        vec!["SUMMARY:\\\\\\;\\,\\n\\n\\n\t:\"".to_string()]
    );
    assert_eq!(
        summary_lines("a\u{7f}b\u{1f}c"),
        vec!["SUMMARY:abc".to_string()]
    );
}

#[test]
fn refuses_an_end_not_after_the_start() {
    let equal = CalendarEntry {
        ends_at: "2026-10-31T23:30:00.000Z".into(),
        ..opener()
    };
    assert!(ics_file(&equal, 0).is_err());
    let garbage = CalendarEntry {
        starts_at: "garbage".into(),
        ..opener()
    };
    assert!(google_calendar_url(&garbage).is_err());
}

#[test]
fn the_google_link_has_only_the_title_times_and_place() {
    assert_eq!(
        google_calendar_url(&opener()).unwrap(),
        "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Season+Opener\
         &dates=20261031T233000Z%2F20261101T024500Z\
         &location=KFC+Yum%21+Center%2C+1+ARENA+PLAZA%2C+LOUISVILLE%2C+KY+40202"
    );
}

#[test]
fn file_names() {
    for (name, file) in [
        ("Season Opener", "season-opener.ics"),
        (
            "Rock, Paper; Scissors \\ Live",
            "rock-paper-scissors-live.ics",
        ),
        ("Café Noël", "cafe-noel.ics"),
        ("  --A--  ", "a.ics"),
        ("🎉🎉", "event.ics"),
        ("漢字", "event.ics"),
        ("", "event.ics"),
        ("Show #2: Encore!", "show-2-encore.ics"),
    ] {
        assert_eq!(ics_file_name(name), file, "{name:?}");
    }
    assert_eq!(
        ics_file_name(&"X".repeat(200)),
        format!("{}.ics", "x".repeat(60))
    );
    assert_eq!(
        ics_file_name(&format!("{} {}", "a".repeat(59), "b".repeat(140))),
        format!("{}.ics", "a".repeat(59))
    );
}

// ------------------------------------------------------------------ calendarEligible, typed

fn order(status: &str, ticket_status: &str) -> MyOrder {
    serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-0000000000f1",
        "eventId": EVENT_ID, "tierId": null, "tierName": null, "customerUsername": "c",
        "holderName": "Jordan Lee", "quantity": 1, "unitPrice": "45.50", "totalPrice": "45.50",
        "status": "CONFIRMED", "createdAt": "2026-10-03T15:00:00.000Z", "refundedAt": null, "seasonPass": null,
        "tickets": [{ "id": "00000000-0000-4000-8000-0000000000a1", "code": "AAAA2222BBBB",
                      "status": ticket_status, "checkedInAt": null, "seat": null,
                      "price": "45.50", "levelName": null }],
        "event": { "id": EVENT_ID, "name": "Season Opener",
                   "startsAt": "2026-10-31T23:30:00.000Z", "endsAt": "2026-11-01T02:45:00.000Z",
                   "doorsOpenAt": "2026-10-31T22:30:00.000Z", "status": status,
                   "checkInDetailsRemovedAt": null,
                   "location": { "id": "00000000-0000-4000-8000-0000000000b1",
                                 "name": "KFC Yum! Center",
                                 "address": "1 ARENA PLAZA, LOUISVILLE, KY 40202",
                                 "timeZone": "America/New_York" } },
    }))
    .unwrap()
}

#[test]
fn an_order_card_is_offered_it_until_the_end() {
    let end = ms("2026-11-01T02:45:00.000Z");
    let o = order("SCHEDULED", "VALID");
    assert!(calendar_eligible(&o, end - 1));
    assert!(!calendar_eligible(&o, end));
    assert!(!calendar_eligible(&order("CANCELLED", "VALID"), 0));
    assert!(!calendar_eligible(&order("SCHEDULED", "VOID"), 0));
    // The typed entry is the fixture's.
    assert_eq!(calendar_entry(&o.event), opener());
}

#[test]
fn the_type_and_note_are_the_react_texts() {
    assert_eq!(ICS_TYPE, "text/calendar;charset=utf-8");
    assert_eq!(
        CALENDAR_NOTE,
        "A copy for your calendar: it won't change if the event does."
    );
}
