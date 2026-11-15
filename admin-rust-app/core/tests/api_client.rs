//! Spec 037 research R5 (tasks T023; parity S2b, S11): the API client. Every call carries the
//! signed-in admin's token; a refusal with the contract's error envelope becomes an `ApiError`
//! with its status, code, message, and details; a body without the envelope becomes
//! `VALIDATION_FAILED` "Request failed with status {n}." marked not enveloped (as
//! `admin-app/src/api/client.ts`' `unwrap`); a failed connection is `Unreachable`; a 401 also asks
//! for sign-in again.

use std::{cell::Cell, rc::Rc};

use admin_rust_core::api::client::{ApiClient, ApiError, Body, Call, EventFilters, ops};
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
    let venues = client.list_locations(None).await.unwrap();
    assert_eq!(venues.len(), 1);
    assert_eq!(venues[0].name.as_str(), "Yum! Center");
}

#[tokio::test]
async fn the_search_is_sent_as_q_only_when_given() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/locations"))
        .and(query_param("q", "yum"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    assert!(client.list_locations(Some("yum")).await.unwrap().is_empty());
}

#[tokio::test]
async fn event_filters_send_only_the_ones_set_and_include_past_only_when_true() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/events"))
        .and(query_param("locationId", ID))
        .and(query_param("includePast", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let filters = EventFilters {
        location_id: Some(ID.into()),
        q: Some(String::new()),
        include_past: true,
        ..EventFilters::default()
    };
    assert_eq!(
        filters.query(),
        vec![
            ("locationId", ID.to_string()),
            ("includePast", "true".into())
        ]
    );
    client.list_events(&filters).await.unwrap();
    assert!(EventFilters::default().query().is_empty());
}

#[tokio::test]
async fn a_write_sends_its_json_body() {
    let server = MockServer::start().await;
    let input = json!({ "name": "Club", "street": "1 Main St" });
    Mock::given(method("POST"))
        .and(path("/locations"))
        .and(body_json(&input))
        .respond_with(ResponseTemplate::new(201).set_body_json(location(ID)))
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let made = client.create_location(&input).await.unwrap();
    assert_eq!(made.id.to_string(), ID);
}

#[tokio::test]
async fn a_delete_answers_nothing() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path(format!("/locations/{ID}")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    client.delete_location(ID).await.unwrap();
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
        .and(path("/locations"))
        .respond_with(ResponseTemplate::new(400).set_body_json(&body))
        .mount(&server)
        .await;
    let (client, asked) = client(&server);
    let err = client.create_location(&json!({})).await.unwrap_err();
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
        .and(path("/reports/sales"))
        .respond_with(ResponseTemplate::new(502).set_body_string("<html>Bad gateway</html>"))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    match client.get_sales_report().await.unwrap_err() {
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
async fn an_unknown_error_code_is_not_the_envelope() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/reports/sales"))
        .respond_with(
            ResponseTemplate::new(500)
                .set_body_json(json!({ "error": { "code": "SOMETHING_ELSE", "message": "x" } })),
        )
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let err = client.get_sales_report().await.unwrap_err();
    assert_eq!(err.message(), "Request failed with status 500.");
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
        .list_events(&EventFilters::default())
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
    let err = client.get_sales_report().await.unwrap_err();
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
        .and(path("/hello/admin"))
        .respond_with(move |req: &wiremock::Request| {
            assert!(!req.headers.contains_key("authorization"));
            ResponseTemplate::new(200)
                .set_body_json(json!({ "appName": "QueuePass Admin", "message": "Hello, admin1" }))
        })
        .mount(&server)
        .await;
    let client = ApiClient::new(server.uri(), Rc::new(|| None), Rc::new(|| {}));
    let hello = client.hello_admin().await.unwrap();
    assert_eq!(hello["appName"], "QueuePass Admin");
}

#[test]
fn each_operation_names_the_react_apps_method_and_path() {
    let s = "s-1";
    let cases: Vec<(Call, &str, String)> = vec![
        (ops::hello_admin(), "GET", "/hello/admin".into()),
        (ops::get_location(ID), "GET", format!("/locations/{ID}")),
        (
            ops::update_location(ID, &json!({})),
            "PATCH",
            format!("/locations/{ID}"),
        ),
        (
            ops::list_venue_layouts(ID),
            "GET",
            format!("/locations/{ID}/layouts"),
        ),
        (
            ops::create_venue_layout(ID, &json!({})),
            "POST",
            format!("/locations/{ID}/layouts"),
        ),
        (
            ops::import_venue_layout(ID, &json!({})),
            "POST",
            format!("/locations/{ID}/layouts/import"),
        ),
        (ops::get_venue_layout(ID), "GET", format!("/layouts/{ID}")),
        (
            ops::get_venue_layout_section(ID, s),
            "GET",
            format!("/layouts/{ID}/sections/{s}"),
        ),
        (
            ops::update_venue_layout(ID, &json!({})),
            "PUT",
            format!("/layouts/{ID}"),
        ),
        (
            ops::duplicate_venue_layout(ID, &json!({})),
            "POST",
            format!("/layouts/{ID}/duplicate"),
        ),
        (
            ops::delete_venue_layout(ID),
            "DELETE",
            format!("/layouts/{ID}"),
        ),
        (
            ops::get_layout_drawing(ID),
            "GET",
            format!("/layouts/{ID}/drawing"),
        ),
        (
            ops::save_layout_drawing(ID, &json!({})),
            "PUT",
            format!("/layouts/{ID}/drawing"),
        ),
        (
            ops::create_layout_drawing(ID, &json!({})),
            "POST",
            format!("/locations/{ID}/layouts/drawing"),
        ),
        (ops::get_event(ID), "GET", format!("/events/{ID}")),
        (ops::create_event(&json!({})), "POST", "/events".into()),
        (
            ops::update_event(ID, &json!({})),
            "PATCH",
            format!("/events/{ID}"),
        ),
        (ops::delete_event(ID), "DELETE", format!("/events/{ID}")),
        (ops::list_tiers(ID), "GET", format!("/events/{ID}/tiers")),
        (
            ops::create_tier(ID, &json!({})),
            "POST",
            format!("/events/{ID}/tiers"),
        ),
        (
            ops::update_tier(ID, s, &json!({})),
            "PATCH",
            format!("/events/{ID}/tiers/{s}"),
        ),
        (
            ops::delete_tier(ID, s),
            "DELETE",
            format!("/events/{ID}/tiers/{s}"),
        ),
        (
            ops::list_attendees(ID),
            "GET",
            format!("/events/{ID}/attendees"),
        ),
        (
            ops::cancel_event(ID),
            "POST",
            format!("/events/{ID}/cancel"),
        ),
        (
            ops::get_event_seating(ID),
            "GET",
            format!("/events/{ID}/seating"),
        ),
        (
            ops::get_venue_map_section(ID, s),
            "GET",
            format!("/events/{ID}/venue-map/sections/{s}"),
        ),
        (
            ops::get_availability(ID),
            "GET",
            format!("/events/{ID}/availability"),
        ),
        (
            ops::delete_event_image(ID, s),
            "DELETE",
            format!("/events/{ID}/images/{s}"),
        ),
        (
            ops::reorder_event_images(ID, &["a".into()]),
            "PUT",
            format!("/events/{ID}/images/order"),
        ),
        (ops::get_sales_report(), "GET", "/reports/sales".into()),
    ];
    for (call, verb, route) in cases {
        assert_eq!(
            (call.method.as_str(), call.path.as_str()),
            (verb, route.as_str())
        );
    }
    assert_eq!(
        ops::reorder_event_images(ID, &["a".into(), "b".into()]).body,
        Body::Json(json!({ "imageIds": ["a", "b"] }))
    );
}

#[tokio::test]
async fn an_image_is_sent_as_one_file_part() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/events/{ID}/images")))
        .respond_with(move |req: &wiremock::Request| {
            let ct = req
                .headers
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap()
                .to_string();
            assert!(ct.starts_with("multipart/form-data; boundary="), "{ct}");
            let body = String::from_utf8_lossy(&req.body);
            assert!(
                body.contains("name=\"file\"; filename=\"poster.png\""),
                "{body}"
            );
            assert!(
                body.contains("content-type: image/png")
                    || body.contains("Content-Type: image/png"),
                "{body}"
            );
            ResponseTemplate::new(201).set_body_json(json!({
                "id": ID,
                "position": 1,
                "contentType": "image/png",
                "byteSize": 4
            }))
        })
        .expect(1)
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let image = client
        .upload_event_image(ID, "poster.png", "image/png", vec![0x89, b'P', b'N', b'G'])
        .await
        .unwrap();
    assert_eq!(image.byte_size.get(), 4);
}
