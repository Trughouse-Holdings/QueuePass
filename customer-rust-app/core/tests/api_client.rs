// Copied from admin-rust-app/core/tests/api_client.rs at 680b4f7 (spec 040 R4).
//! Spec 040 research R5 (task T020), from spec 037's tests: the API client. Every call carries
//! the signed-in customer's token (parity S13); a refusal with the contract's error envelope becomes an `ApiError`
//! with its status, code, message, and details; a body without the envelope becomes
//! `VALIDATION_FAILED` "Request failed with status {n}." marked not enveloped (as
//! `admin-app/src/api/client.ts`' `unwrap`); a failed connection is `Unreachable`; a 401 also asks
//! for sign-in again.

use std::{cell::Cell, rc::Rc};

use customer_rust_core::api::client::{ApiClient, ApiError, Body, Call, EventQuery, SeatRef, ops};
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path, query_param},
};

fn client(server: &MockServer) -> (ApiClient, Rc<Cell<u32>>) {
    let asked = Rc::new(Cell::new(0));
    let counter = asked.clone();
    let client = ApiClient::new(
        server.uri(),
        Rc::new(|| Some("the-token".to_string())),
        Rc::new(move || counter.set(counter.get() + 1)),
    );
    (client, asked)
}

fn location(id: &str) -> serde_json::Value {
    json!({
        "id": id,
        "name": "Yum! Center",
        "address": "1 Arena Plaza, Louisville, KY 40202",
        "street": "1 Arena Plaza",
        "city": "Louisville",
        "state": "KY",
        "zip": "40202",
        "addressVerified": true,
        "seatingCapacity": 22090,
        "timeZone": "America/New_York",
        "timeZoneSource": "ADDRESS",
        "createdAt": "2026-11-01T12:00:00.000Z",
        "updatedAt": "2026-11-01T12:00:00.000Z"
    })
}

const ID: &str = "0b9d5c1e-1111-4111-8111-111111111111";

#[tokio::test]
async fn every_call_sends_the_bearer_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/locations"))
        .and(header("authorization", "Bearer the-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([location(ID)])))
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let venues = client.list_locations().await.unwrap();
    assert_eq!(venues.len(), 1);
    assert_eq!(venues[0].name.as_str(), "Yum! Center");
}

#[tokio::test]
async fn an_enveloped_refusal_becomes_an_api_error_with_its_details() {
    let server = MockServer::start().await;
    let body = json!({
        "error": {
            "code": "VALIDATION_FAILED",
            "message": "Request validation failed.",
            "details": { "fields": ["name must be between 1 and 200 characters"] }
        }
    });
    Mock::given(method("POST"))
        .and(path(format!("/events/{ID}/orders")))
        .respond_with(ResponseTemplate::new(400).set_body_json(&body))
        .mount(&server)
        .await;
    let (client, asked) = client(&server);
    let err = client.create_order(ID, &json!({})).await.unwrap_err();
    match &err {
        ApiError::Status(e) => {
            assert_eq!(e.status, 400);
            assert_eq!(e.code, "VALIDATION_FAILED");
            assert_eq!(e.message, "Request validation failed.");
            assert_eq!(
                e.details.as_ref().unwrap()["fields"][0],
                "name must be between 1 and 200 characters"
            );
            assert!(e.enveloped);
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(err.code(), Some("VALIDATION_FAILED"));
    assert_eq!(err.status(), Some(400));
    assert_eq!(asked.get(), 0, "only a 401 asks for sign-in");
}

#[tokio::test]
async fn a_body_without_the_envelope_is_a_not_enveloped_validation_failure() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/me/orders"))
        .respond_with(ResponseTemplate::new(502).set_body_string("<html>Bad gateway</html>"))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    match client.list_my_orders().await.unwrap_err() {
        ApiError::Status(e) => {
            assert_eq!(e.status, 502);
            assert_eq!(e.code, "VALIDATION_FAILED");
            assert_eq!(e.message, "Request failed with status 502.");
            assert!(e.details.is_none());
            assert!(!e.enveloped);
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn an_unknown_error_code_is_still_read_as_the_customer_pages_do() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/me/orders"))
        .respond_with(
            ResponseTemplate::new(500)
                .set_body_json(json!({ "error": { "code": "SOMETHING_ELSE", "message": "x" } })),
        )
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let err = client.list_my_orders().await.unwrap_err();
    // Spec 040 (review finding 3): the Customer pages read any `{ error: { code, message } }`.
    assert_eq!(err.message(), "x");
    assert_eq!(err.code(), Some("SOMETHING_ELSE"));
}

#[tokio::test]
async fn a_401_asks_for_sign_in_again() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/events"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "error": { "code": "UNAUTHENTICATED", "message": "A valid access token is required." }
        })))
        .mount(&server)
        .await;
    let (client, asked) = client(&server);
    let err = client
        .list_events(&EventQuery::default())
        .await
        .unwrap_err();
    assert_eq!(err.status(), Some(401));
    assert_eq!(asked.get(), 1);
}

#[tokio::test]
async fn no_answer_is_unreachable() {
    // A port nothing listens on (wiremock keeps dropped servers alive in a pool).
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let client = ApiClient::new(
        format!("http://127.0.0.1:{port}"),
        Rc::new(|| None),
        Rc::new(|| {}),
    );
    let err = client.list_my_orders().await.unwrap_err();
    assert!(matches!(err, ApiError::Unreachable));
    assert_eq!(err.code(), None);
    // A list page shows the browser's words for it, as React's `err.message` (review finding 4).
    assert_eq!(err.page_message(), "Failed to fetch");
}

#[tokio::test]
async fn a_quiet_read_does_not_sign_in_on_a_401() {
    // The venue map and pictures are read with a bare `api.GET` in React: a 401 there is only an
    // error (review finding 2).
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/events/e1/venue-map/sections/s1"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "error": { "code": "UNAUTHENTICATED", "message": "Sign in." }
        })))
        .mount(&server)
        .await;
    let (client, asked) = client(&server);
    let call = ops::get_venue_map_section("e1", "s1");
    let err = client.send_raw_quiet(call.clone()).await.unwrap_err();
    assert_eq!(err.status(), Some(401));
    assert_eq!(asked.get(), 0);
    client.send_raw(call).await.unwrap_err();
    assert_eq!(asked.get(), 1);
}

#[tokio::test]
async fn without_a_token_no_authorization_header_is_sent() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/locations"))
        .respond_with(move |req: &wiremock::Request| {
            assert!(!req.headers.contains_key("authorization"));
            ResponseTemplate::new(200).set_body_json(json!([]))
        })
        .mount(&server)
        .await;
    let client = ApiClient::new(server.uri(), Rc::new(|| None), Rc::new(|| {}));
    assert!(client.list_locations().await.unwrap().is_empty());
}

#[tokio::test]
async fn the_event_query_sends_only_the_keys_set_and_never_include_past() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/events"))
        .and(query_param("q", "jazz"))
        .and(query_param("locationId", ID))
        .and(query_param("fromDate", "2026-11-01"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let query = EventQuery {
        q: Some("jazz".into()),
        location_id: Some(ID.into()),
        from_date: Some("2026-11-01".into()),
        to_date: Some(String::new()),
    };
    assert_eq!(
        query.query(),
        vec![
            ("q", "jazz".to_string()),
            ("locationId", ID.to_string()),
            ("fromDate", "2026-11-01".to_string()),
        ]
    );
    assert!(client.list_events(&query).await.unwrap().is_empty());
    assert!(EventQuery::default().query().is_empty());
}

#[tokio::test]
async fn a_hold_and_a_release_send_the_seats() {
    let server = MockServer::start().await;
    let seats = vec![SeatRef {
        section_id: "s-1".into(),
        row: 6,
        seat: 7,
    }];
    let body = json!({ "seats": [{ "sectionId": "s-1", "row": 6, "seat": 7 }] });
    for route in ["reservation", "reservation/release"] {
        Mock::given(method("POST"))
            .and(path(format!("/events/{ID}/{route}")))
            .and(header("authorization", "Bearer the-token"))
            .and(body_json(&body))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;
    }
    let (client, _) = client(&server);
    client.send_raw(ops::hold_seats(ID, &seats)).await.unwrap();
    client
        .send_raw(ops::release_seats(ID, &seats))
        .await
        .unwrap();
}

#[tokio::test]
async fn an_order_sends_its_body() {
    let server = MockServer::start().await;
    let body = json!({ "holderName": "Ada", "quantity": 2, "requestId": "r-1" });
    Mock::given(method("POST"))
        .and(path(format!("/events/{ID}/orders")))
        .and(body_json(&body))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({})))
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let err = client.create_order(ID, &body).await.unwrap_err();
    assert_eq!(err.status(), Some(500));
}

#[tokio::test]
async fn release_on_logout_posts_no_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/me/reservations/release"))
        .respond_with(move |req: &wiremock::Request| {
            assert!(req.body.is_empty());
            ResponseTemplate::new(200).set_body_json(json!({ "released": 0 }))
        })
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    client
        .send_raw(ops::release_my_reservations())
        .await
        .unwrap();
}

#[tokio::test]
async fn each_customer_read_is_sent_with_the_token() {
    let server = MockServer::start().await;
    for route in [
        "/me/orders".to_string(),
        "/me/reservations".to_string(),
        format!("/me/tickets/{ID}/entry-key"),
        format!("/events/{ID}/tiers"),
        format!("/events/{ID}/availability"),
        format!("/events/{ID}/venue-map"),
        format!("/events/{ID}/venue-map/sections/s-1"),
        format!("/events/{ID}/images/i-1"),
        format!("/locations/{ID}"),
        format!("/events/{ID}"),
    ] {
        Mock::given(method("GET"))
            .and(path(route))
            .and(header("authorization", "Bearer the-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;
    }
    let (client, _) = client(&server);
    for call in [
        ops::my_orders(),
        ops::my_reservations(),
        ops::entry_key(ID),
        ops::list_tiers(ID),
        ops::get_availability(ID),
        ops::get_venue_map(ID),
        ops::get_venue_map_section(ID, "s-1"),
        ops::get_event_image(ID, "i-1"),
        ops::get_location(ID),
        ops::get_event(ID),
    ] {
        client.send_raw(call).await.unwrap();
    }
}

#[test]
fn each_operation_names_the_react_apps_method_and_path() {
    let seats = [SeatRef {
        section_id: "s".into(),
        row: 1,
        seat: 2,
    }];
    let cases: Vec<(Call, &str, String)> = vec![
        (
            ops::list_events(&EventQuery::default()),
            "GET",
            "/events".into(),
        ),
        (ops::get_event(ID), "GET", format!("/events/{ID}")),
        (ops::list_locations(), "GET", "/locations".into()),
        (ops::get_location(ID), "GET", format!("/locations/{ID}")),
        (
            ops::get_event_image(ID, "i"),
            "GET",
            format!("/events/{ID}/images/i"),
        ),
        (
            ops::get_availability(ID),
            "GET",
            format!("/events/{ID}/availability"),
        ),
        (ops::list_tiers(ID), "GET", format!("/events/{ID}/tiers")),
        (
            ops::place_order(ID, &json!({})),
            "POST",
            format!("/events/{ID}/orders"),
        ),
        (
            ops::hold_seats(ID, &seats),
            "POST",
            format!("/events/{ID}/reservation"),
        ),
        (
            ops::release_seats(ID, &seats),
            "POST",
            format!("/events/{ID}/reservation/release"),
        ),
        (
            ops::get_venue_map(ID),
            "GET",
            format!("/events/{ID}/venue-map"),
        ),
        (
            ops::get_venue_map_section(ID, "s"),
            "GET",
            format!("/events/{ID}/venue-map/sections/s"),
        ),
        (ops::my_orders(), "GET", "/me/orders".into()),
        (ops::my_reservations(), "GET", "/me/reservations".into()),
        (
            ops::release_my_reservations(),
            "POST",
            "/me/reservations/release".into(),
        ),
        (
            ops::entry_key(ID),
            "GET",
            format!("/me/tickets/{ID}/entry-key"),
        ),
    ];
    for (call, verb, route) in cases {
        assert_eq!(
            (call.method.as_str(), call.path.as_str()),
            (verb, route.as_str())
        );
    }
    assert_eq!(ops::release_my_reservations().body, Body::None);
}
