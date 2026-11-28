//! Spec 040 T055 (parity T9–T11; research R9; spec 018): the live entry code. Ported from
//! `packages/shared/test/live-code.test.ts` (the parts the Customer app uses) and the clock and
//! state cases of `customer-app/test/entry-code.test.tsx`, plus the TypeScript's own codes for
//! fixed keys, tickets, and windows (`fixtures/customer/live-codes.json`).

use customer_rust_core::api::client::{ApiError, StatusError};
use customer_rust_core::api::types::{MyOrder, TicketEntryKey};
use customer_rust_core::live_code::{
    EntryPage, GRACE_MS, LIVE_CODE_PREFIX, NO_CONNECTION, NO_CRYPTO, Tick, WINDOW_MS, base32,
    countdown_text, entry_page, key_from_base64url, key_to_base64url, live_code, measure_offset,
    server_now, server_time_ms, tick_at, window_at, window_start_ms,
};
use serde_json::{Map, Value, json};

const FIXTURES: &str = include_str!("fixtures/customer/live-codes.json");

// ------------------------------------------------------------------ the TypeScript's codes

#[test]
fn every_code_equals_the_typescripts() {
    let cases: Vec<Value> = serde_json::from_str(FIXTURES).unwrap();
    assert_eq!(cases.len(), 60);
    for c in cases {
        let key = key_from_base64url(c["key"].as_str().unwrap()).unwrap();
        assert_eq!(key_to_base64url(&key), c["key"].as_str().unwrap());
        assert_eq!(
            live_code(
                &key,
                c["ticketId"].as_str().unwrap(),
                c["window"].as_i64().unwrap()
            ),
            c["code"].as_str().unwrap()
        );
    }
}

// ------------------------------------------------------------------ live-code.test.ts

#[test]
fn constants_are_research_r2_and_r3() {
    assert_eq!(LIVE_CODE_PREFIX, "QP1:");
    assert_eq!(WINDOW_MS, 30_000);
    assert_eq!(GRACE_MS, 5_000);
}

#[test]
fn window_at_is_floor_ms_over_30000() {
    assert_eq!(window_at(0.0), 0);
    assert_eq!(window_at(29_999.0), 0);
    assert_eq!(window_at(30_000.0), 1);
    assert_eq!(window_start_ms(58_773_103), 58_773_103 * 30_000);
}

#[test]
fn a_code_is_62_characters_for_an_8_digit_window() {
    let code = live_code(
        &[0xff; 32],
        "00000000-0000-4000-8000-000000000000",
        58_773_103,
    );
    assert_eq!(code.len(), 62);
    assert!(code.starts_with("QP1:00000000000040008000000000000000:58773103:"));
}

#[test]
fn base32_is_rfc_4648_without_padding() {
    assert_eq!(base32(b""), "");
    assert_eq!(base32(b"f"), "MY");
    assert_eq!(base32(b"fo"), "MZXQ");
    assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
}

#[test]
fn keys_round_trip_as_43_characters() {
    let key: Vec<u8> = (0..32).collect();
    let text = key_to_base64url(&key);
    assert_eq!(text, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
    assert_eq!(key_from_base64url(&text), Some(key));
}

#[test]
fn other_keys_are_refused() {
    let good = key_to_base64url(&(0..32).collect::<Vec<u8>>());
    for text in [
        good[1..].to_string(),
        format!("{good}A"),
        format!("{}+", &good[1..]),
        format!("{}/", &good[1..]),
        format!("{}=", &good[1..]),
    ] {
        assert_eq!(key_from_base64url(&text), None, "{text}");
    }
}

// ------------------------------------------------------------------ live-code-clock.ts

#[test]
fn the_offset_is_the_backends_time_minus_the_middle_of_the_request() {
    let server = server_time_ms("2026-10-01T23:00:00.000Z").unwrap();
    assert_eq!(measure_offset(server, 1_000.0, 1_200.0), server - 1_100.0);
    assert_eq!(server_now(5_000.0, 100.0), 5_100.0);
    assert_eq!(server_time_ms("garbage"), None);
}

#[test]
fn the_backends_clock_is_kept_when_the_devices_jumps() {
    // The offset is measured once; only performance.now() moves it after.
    let offset = measure_offset(1_000_000_000_000.0, 0.0, 0.0);
    let before = tick_at(server_now(10_000.0, offset));
    let after = tick_at(server_now(11_000.0, offset));
    assert_eq!(after.window, before.window);
}

#[test]
fn the_countdown_restarts_with_each_window() {
    // 29.2 s into window 7: 1 s left (rounded up), then window 8 with 30 s.
    let start = window_start_ms(7) as f64;
    assert_eq!(
        tick_at(start + 29_200.0),
        Tick {
            window: 7,
            seconds_left: 1
        }
    );
    assert_eq!(
        tick_at(start + 30_000.0),
        Tick {
            window: 8,
            seconds_left: 30
        }
    );
    assert_eq!(
        tick_at(start + 30_250.0),
        Tick {
            window: 8,
            seconds_left: 30
        }
    );
    assert_eq!(countdown_text(30), "Changes in 30 s");
}

// ------------------------------------------------------------------ entry-code.test.tsx states

const TICKET: &str = "00000000-0000-4000-8000-0000000000a1";

fn orders() -> Vec<MyOrder> {
    serde_json::from_value(json!([{
        "id": "00000000-0000-4000-8000-0000000000f1",
        "eventId": "00000000-0000-4000-8000-0000000000e1", "tierId": null, "tierName": null,
        "customerUsername": "c", "holderName": "Jordan Lee", "quantity": 1,
        "unitPrice": "45.50", "totalPrice": "45.50", "status": "CONFIRMED",
        "createdAt": "2026-10-03T15:00:00.000Z", "refundedAt": null, "seasonPass": null,
        "tickets": [{ "id": TICKET, "code": "AAAA2222BBBB", "status": "VALID",
                      "checkedInAt": null, "seat": null, "price": "45.50", "levelName": null }],
        "event": { "id": "00000000-0000-4000-8000-0000000000e1", "name": "Early Show",
                   "startsAt": "2026-12-01T23:00:00.000Z", "endsAt": "2026-12-02T02:00:00.000Z",
                   "doorsOpenAt": "2026-12-01T22:00:00.000Z", "status": "SCHEDULED",
                   "checkInDetailsRemovedAt": null,
                   "location": { "id": "00000000-0000-4000-8000-0000000000b1",
                                 "name": "Alpha Arena", "address": "1 ARENA PLAZA",
                                 "timeZone": "America/New_York" } },
    }]))
    .unwrap()
}

fn key() -> TicketEntryKey {
    serde_json::from_value(json!({
        "ticketId": TICKET,
        "key": key_to_base64url(&[0u8; 32]),
        "serverTime": "2026-10-01T23:00:00.000Z",
    }))
    .unwrap()
}

fn refusal(status: u16, details: Option<Value>, message: &str) -> ApiError {
    ApiError::Status(StatusError {
        status,
        code: "TICKET_NOT_USABLE".into(),
        message: message.into(),
        details: details.map(|d| d.as_object().cloned().unwrap_or_else(Map::new)),
        enveloped: true,
    })
}

#[test]
fn both_answers_give_the_code_with_the_offset() {
    match entry_page(Ok(orders()), Ok(key()), TICKET, 100.0, 300.0) {
        EntryPage::Ok { order, key, offset } => {
            assert_eq!(order.event.name, "Early Show");
            assert_eq!(key, vec![0u8; 32]);
            assert_eq!(
                offset,
                server_time_ms("2026-10-01T23:00:00.000Z").unwrap() - 200.0
            );
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn no_answer_says_to_use_the_printed_ticket() {
    assert!(matches!(
        entry_page(Ok(orders()), Err(ApiError::Unreachable), TICKET, 0.0, 0.0),
        EntryPage::Offline
    ));
    assert!(matches!(
        entry_page(Err(ApiError::Unreachable), Ok(key()), TICKET, 0.0, 0.0),
        EntryPage::Offline
    ));
    assert_eq!(
        NO_CONNECTION,
        "Can't show the live code without a connection. Use your printed ticket with photo ID."
    );
    assert_eq!(
        NO_CRYPTO,
        "Can't show the live code in this browser. Use your printed ticket with photo ID."
    );
}

#[test]
fn a_401_on_either_signs_in_again() {
    assert!(matches!(
        entry_page(Ok(orders()), Err(refusal(401, None, "x")), TICKET, 0.0, 0.0),
        EntryPage::SignIn
    ));
    assert!(matches!(
        entry_page(Err(refusal(401, None, "x")), Ok(key()), TICKET, 0.0, 0.0),
        EntryPage::SignIn
    ));
}

#[test]
fn a_used_or_void_ticket_says_why_with_no_code() {
    let page = |details: Option<Value>, message: &str| match entry_page(
        Ok(orders()),
        Err(refusal(409, details, message)),
        TICKET,
        0.0,
        0.0,
    ) {
        EntryPage::Refused(text) => text,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        page(Some(json!({ "reason": "USED" })), "x"),
        "This ticket was already used."
    );
    assert_eq!(
        page(Some(json!({ "reason": "VOID" })), "x"),
        "This ticket was cancelled and refunded."
    );
    assert_eq!(page(None, "The event is over."), "The event is over.");
}

#[test]
fn a_404_or_a_ticket_not_in_the_orders_is_not_found() {
    assert!(matches!(
        entry_page(Ok(orders()), Err(refusal(404, None, "x")), TICKET, 0.0, 0.0),
        EntryPage::Missing
    ));
    assert!(matches!(
        entry_page(Ok(vec![]), Ok(key()), TICKET, 0.0, 0.0),
        EntryPage::Missing
    ));
}

#[test]
fn anything_else_is_the_standard_error_with_try_again() {
    assert!(matches!(
        entry_page(Ok(orders()), Err(refusal(500, None, "x")), TICKET, 0.0, 0.0),
        EntryPage::Failed
    ));
    // My tickets answering 500 is not "no connection".
    assert!(matches!(
        entry_page(Err(refusal(500, None, "x")), Ok(key()), TICKET, 0.0, 0.0),
        EntryPage::Failed
    ));
}

/// Review finding 4: a 2xx body that can't be read rejects `Promise.all` in React, so the page
/// says to use the printed ticket.
#[test]
fn an_unreadable_answer_is_treated_as_no_answer() {
    assert!(matches!(
        entry_page(
            Err(ApiError::Decode("bad json".into())),
            Ok(key()),
            TICKET,
            0.0,
            0.0
        ),
        EntryPage::Offline
    ));
}
