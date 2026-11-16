// Copied from admin-rust-app/core/src/api/client.rs at 680b4f7 (spec 040 R4).
//! Spec 040 research R5 (task T020), from spec 037 R5: the only network path from the Rust
//! Customer app to data (Constitution I). One operation per call the React Customer app makes,
//! with the same method, path, query, and body; responses decode into the types generated from
//! the contract. The Backend, not the client, refuses a bad value (Principle IV).
//!
//! Errors follow the Rust Admin app's `unwrap`: a refusal with the error envelope keeps
//! its status, code, message, and details; any other failed answer becomes `VALIDATION_FAILED`
//! "Request failed with status {n}." marked not enveloped; a 401 also asks for sign-in again.

use std::rc::Rc;

use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use super::types;

/// The HTTP method of a call.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Put => "PUT",
            Method::Patch => "PATCH",
            Method::Delete => "DELETE",
        }
    }

    fn reqwest(self) -> reqwest::Method {
        match self {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Put => reqwest::Method::PUT,
            Method::Patch => reqwest::Method::PATCH,
            Method::Delete => reqwest::Method::DELETE,
        }
    }
}

/// What a call sends.
#[derive(Clone, Debug, PartialEq)]
pub enum Body {
    None,
    Json(Value),
}

/// One API call, described without sending it.
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub method: Method,
    pub path: String,
    pub query: Vec<(&'static str, String)>,
    pub body: Body,
}

impl Call {
    fn new(method: Method, path: String) -> Self {
        Call {
            method,
            path,
            query: Vec::new(),
            body: Body::None,
        }
    }

    fn json(mut self, body: &Value) -> Self {
        self.body = Body::Json(body.clone());
        self
    }
}

/// A refusal the Backend (or something in front of it) answered.
#[derive(Clone, Debug, PartialEq)]
pub struct StatusError {
    pub status: u16,
    pub code: String,
    pub message: String,
    pub details: Option<Map<String, Value>>,
    /// False only for an answer without the Backend's error envelope (a proxy's gateway error),
    /// which may have come after the Backend saved the request (spec 031 research R5, R6).
    pub enveloped: bool,
}

/// Why a call failed.
#[derive(Clone, Debug, PartialEq)]
pub enum ApiError {
    /// An answer other than 2xx.
    Status(StatusError),
    /// No answer at all: the Backend could not be reached.
    Unreachable,
    /// A 2xx answer whose body is not what the contract says.
    Decode(String),
}

impl ApiError {
    pub fn status(&self) -> Option<u16> {
        match self {
            ApiError::Status(e) => Some(e.status),
            _ => None,
        }
    }

    pub fn code(&self) -> Option<&str> {
        match self {
            ApiError::Status(e) => Some(e.code.as_str()),
            _ => None,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            ApiError::Status(e) => &e.message,
            ApiError::Unreachable => "The Backend could not be reached.",
            ApiError::Decode(m) => m,
        }
    }

    /// The text a React page shows for `err.message` of a rejected call: the error's message,
    /// or, with no answer at all, the browser's own words for a failed `fetch` (Chromium's
    /// `TypeError: Failed to fetch`, the browser the tests and CI use).
    pub fn page_message(&self) -> &str {
        match self {
            ApiError::Unreachable => "Failed to fetch",
            _ => self.message(),
        }
    }

    pub fn details(&self) -> Option<&Map<String, Value>> {
        match self {
            ApiError::Status(e) => e.details.as_ref(),
            _ => None,
        }
    }

    /// The envelope's `details.fields` messages (a `VALIDATION_FAILED` refusal's field list).
    pub fn fields(&self) -> Vec<String> {
        self.details()
            .and_then(|d| d.get("fields"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Whether the answer carried the Backend's error envelope (see `StatusError::enveloped`).
    pub fn enveloped(&self) -> bool {
        matches!(self, ApiError::Status(e) if e.enveloped)
    }
}

/// The error a failed answer becomes, from its status and body (`unwrap` in client.ts). The
/// envelope counts only with a code the contract knows (`isErrorEnvelope`).
pub fn error_from(status: u16, body: &[u8]) -> StatusError {
    if let Ok(envelope) = serde_json::from_slice::<types::ErrorEnvelope>(body) {
        let value = serde_json::to_value(&envelope.error).unwrap_or(Value::Null);
        return StatusError {
            status,
            code: value["code"].as_str().unwrap_or_default().to_string(),
            message: value["message"].as_str().unwrap_or_default().to_string(),
            details: value.get("details").and_then(Value::as_object).cloned(),
            enveloped: true,
        };
    }
    StatusError {
        status,
        code: "VALIDATION_FAILED".into(),
        message: format!("Request failed with status {status}."),
        details: None,
        enveloped: false,
    }
}

/// Spec 004 FR-006 / 008 filters of the event list (`customer-app/src/filters.ts` `eventQuery`):
/// only the keys that are set, in the order the React app builds them. Spec 030: the Customer
/// app never sends `includePast`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EventQuery {
    pub q: Option<String>,
    pub location_id: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

impl EventQuery {
    /// The query keys that are set and not empty.
    pub fn query(&self) -> Vec<(&'static str, String)> {
        let mut out = Vec::new();
        for (key, value) in [
            ("q", &self.q),
            ("locationId", &self.location_id),
            ("fromDate", &self.from_date),
            ("toDate", &self.to_date),
        ] {
            if let Some(v) = value.as_ref().filter(|v| !v.is_empty()) {
                out.push((key, v.clone()));
            }
        }
        out
    }
}

/// One seat of a hold, a release, or a seated order (`SeatChoice`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeatRef {
    pub section_id: String,
    pub row: String,
    pub seat: String,
}

impl SeatRef {
    pub fn json(&self) -> Value {
        json!({ "sectionId": self.section_id, "row": self.row, "seat": self.seat })
    }
}

/// Every call the React Customer app makes, described (spec 040 R5): `customer-app/src` and the
/// shared web code it uses (`packages/shared/src/web/`), with the same method, path, query, and
/// body.
pub mod ops {
    use super::{Call, EventQuery, Method, SeatRef};
    use serde_json::{Value, json};

    // Events and venues (EventList.tsx, EventDetail.tsx, VenueList.tsx, VenueDetail.tsx).
    pub fn list_events(query: &EventQuery) -> Call {
        let mut call = Call::new(Method::Get, "/events".into());
        call.query = query.query();
        call
    }
    pub fn get_event(id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{id}"))
    }
    pub fn list_locations() -> Call {
        Call::new(Method::Get, "/locations".into())
    }
    pub fn get_location(id: &str) -> Call {
        Call::new(Method::Get, format!("/locations/{id}"))
    }
    /// A picture's bytes (`packages/shared/src/web/event-images.ts`).
    pub fn get_event_image(event_id: &str, image_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/images/{image_id}"))
    }

    // Get tickets (GetTickets.tsx, use-buy.ts, use-hold-queue.ts).
    pub fn get_availability(event_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/availability"))
    }
    pub fn list_tiers(event_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/tiers"))
    }
    /// `POST /events/{id}/orders`; the body is `core::buy`'s (`tierId?`, `holderName`,
    /// `quantity`, `seats?`, `requestId`).
    pub fn place_order(event_id: &str, body: &Value) -> Call {
        Call::new(Method::Post, format!("/events/{event_id}/orders")).json(body)
    }
    pub fn hold_seats(event_id: &str, seats: &[SeatRef]) -> Call {
        Call::new(Method::Post, format!("/events/{event_id}/reservation"))
            .json(&json!({ "seats": seats.iter().map(SeatRef::json).collect::<Vec<_>>() }))
    }
    pub fn release_seats(event_id: &str, seats: &[SeatRef]) -> Call {
        Call::new(
            Method::Post,
            format!("/events/{event_id}/reservation/release"),
        )
        .json(&json!({ "seats": seats.iter().map(SeatRef::json).collect::<Vec<_>>() }))
    }

    // The venue map (packages/shared/src/web/use-seat-stream.ts).
    pub fn get_venue_map(event_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/venue-map"))
    }
    pub fn get_venue_map_section(event_id: &str, section_id: &str) -> Call {
        Call::new(
            Method::Get,
            format!("/events/{event_id}/venue-map/sections/{section_id}"),
        )
    }

    // The customer's own (MyTickets.tsx, Cart.tsx, EntryCode.tsx, release-on-logout.ts).
    pub fn my_orders() -> Call {
        Call::new(Method::Get, "/me/orders".into())
    }
    pub fn my_reservations() -> Call {
        Call::new(Method::Get, "/me/reservations".into())
    }
    /// Release on logout (parity S6): no body.
    pub fn release_my_reservations() -> Call {
        Call::new(Method::Post, "/me/reservations/release".into())
    }
    pub fn entry_key(ticket_id: &str) -> Call {
        Call::new(Method::Get, format!("/me/tickets/{ticket_id}/entry-key"))
    }
}

/// Where the signed-in customer's current access token comes from.
pub type TokenSource = Rc<dyn Fn() -> Option<String>>;
/// What a 401 does: send the admin back through sign-in.
pub type OnUnauthorized = Rc<dyn Fn()>;

/// The API client: the Backend's address, the token source, and the 401 action.
#[derive(Clone)]
pub struct ApiClient {
    base_url: String,
    token: TokenSource,
    on_unauthorized: OnUnauthorized,
    http: reqwest::Client,
}

impl std::fmt::Debug for ApiClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApiClient")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

impl ApiClient {
    pub fn new(
        base_url: impl Into<String>,
        token: TokenSource,
        on_unauthorized: OnUnauthorized,
    ) -> Self {
        ApiClient {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            token,
            on_unauthorized,
            http: reqwest::Client::new(),
        }
    }

    /// The signed-in admin's current token, for the live seat stream (spec 015 research R9).
    pub fn access_token(&self) -> Option<String> {
        (self.token)()
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Sends `call` and returns the answer's body (empty for 204), or the error it is. A 401
    /// sends the browser to sign in (`useLoad`'s 401 rule, parity S3).
    pub async fn send_raw(&self, call: Call) -> Result<Vec<u8>, ApiError> {
        self.exchange(call, true).await
    }

    /// As `send_raw`, but a 401 is only an error: the background reads the React app makes with
    /// a bare `api.GET` (the venue map and its sections, event pictures) never sign in again.
    pub async fn send_raw_quiet(&self, call: Call) -> Result<Vec<u8>, ApiError> {
        self.exchange(call, false).await
    }

    /// As `send`, without the 401 action (`send_raw_quiet`).
    pub async fn send_quiet<T: DeserializeOwned>(&self, call: Call) -> Result<T, ApiError> {
        let body = self.send_raw_quiet(call).await?;
        serde_json::from_slice(&body).map_err(|e| ApiError::Decode(e.to_string()))
    }

    async fn exchange(&self, call: Call, sign_in_on_401: bool) -> Result<Vec<u8>, ApiError> {
        let mut request = self.http.request(
            call.method.reqwest(),
            format!("{}{}", self.base_url, call.path),
        );
        if !call.query.is_empty() {
            request = request.query(&call.query);
        }
        if let Some(token) = (self.token)() {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        request = match call.body {
            Body::None => request,
            Body::Json(value) => request.json(&value),
        };
        let response = request.send().await.map_err(|_| ApiError::Unreachable)?;
        let status = response.status().as_u16();
        let body = response
            .bytes()
            .await
            .map_err(|_| ApiError::Unreachable)?
            .to_vec();
        if (200..300).contains(&status) {
            return Ok(body);
        }
        if status == 401 && sign_in_on_401 {
            (self.on_unauthorized)();
        }
        Err(ApiError::Status(error_from(status, &body)))
    }

    /// Sends `call` and decodes its answer as `T`.
    pub async fn send<T: DeserializeOwned>(&self, call: Call) -> Result<T, ApiError> {
        let body = self.send_raw(call).await?;
        serde_json::from_slice(&body).map_err(|e| ApiError::Decode(e.to_string()))
    }

    /// Sends `call`, whose answer has no body.
    pub async fn send_empty(&self, call: Call) -> Result<(), ApiError> {
        self.send_raw(call).await.map(|_| ())
    }

    pub async fn list_events(&self, query: &EventQuery) -> Result<Vec<types::Event>, ApiError> {
        self.send(ops::list_events(query)).await
    }
    pub async fn get_event(&self, id: &str) -> Result<types::Event, ApiError> {
        self.send(ops::get_event(id)).await
    }
    pub async fn list_locations(&self) -> Result<Vec<types::Location>, ApiError> {
        self.send(ops::list_locations()).await
    }
    pub async fn get_location(&self, id: &str) -> Result<types::Location, ApiError> {
        self.send(ops::get_location(id)).await
    }
    pub async fn get_event_availability(
        &self,
        event_id: &str,
    ) -> Result<types::Availability, ApiError> {
        self.send(ops::get_availability(event_id)).await
    }
    pub async fn list_ticket_tiers(
        &self,
        event_id: &str,
    ) -> Result<Vec<types::TicketTier>, ApiError> {
        self.send(ops::list_tiers(event_id)).await
    }
    pub async fn create_order(
        &self,
        event_id: &str,
        body: &Value,
    ) -> Result<types::Order, ApiError> {
        self.send(ops::place_order(event_id, body)).await
    }
    pub async fn list_my_orders(&self) -> Result<Vec<types::MyOrder>, ApiError> {
        self.send(ops::my_orders()).await
    }
    pub async fn list_my_reservations(&self) -> Result<Vec<types::Reservation>, ApiError> {
        self.send(ops::my_reservations()).await
    }
    pub async fn get_ticket_entry_key(
        &self,
        ticket_id: &str,
    ) -> Result<types::TicketEntryKey, ApiError> {
        self.send(ops::entry_key(ticket_id)).await
    }
}

/// The JSON of an error envelope, for tests and for showing a made-up refusal.
pub fn envelope(code: &str, message: &str) -> Value {
    json!({ "error": { "code": code, "message": message } })
}
