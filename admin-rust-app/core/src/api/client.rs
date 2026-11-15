//! Spec 037 research R5 (tasks T024): the only network path from the Rust Admin app to data
//! (Constitution I). One operation per call `admin-app/src/api/*.ts` makes, with the same method,
//! path, query, and body; responses decode into the types generated from the contract. Request
//! bodies are JSON built by the form modules, which their tests check against the contract's
//! schemas: the Backend, not the client, refuses a bad value (Principle IV), as in the React app.
//!
//! Errors follow `admin-app/src/api/client.ts`' `unwrap`: a refusal with the error envelope keeps
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
    /// One `file` part, as `admin-app/src/api/images.ts` sends a picture.
    File {
        name: String,
        content_type: String,
        bytes: Vec<u8>,
    },
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

/// Spec 004 FR-006 filters, every one optional (`admin-app/src/api/events.ts`). Spec 020: the
/// dates are days (`YYYY-MM-DD`). Spec 030: `includePast` is sent only when true.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EventFilters {
    pub location_id: Option<String>,
    pub q: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub include_past: bool,
}

impl EventFilters {
    /// The query, leaving out what is empty, as `Object.entries(filters).filter(([, v]) => v)`.
    pub fn query(&self) -> Vec<(&'static str, String)> {
        let mut out = Vec::new();
        for (key, value) in [
            ("locationId", &self.location_id),
            ("q", &self.q),
            ("fromDate", &self.from_date),
            ("toDate", &self.to_date),
        ] {
            if let Some(v) = value.as_ref().filter(|v| !v.is_empty()) {
                out.push((key, v.clone()));
            }
        }
        if self.include_past {
            out.push(("includePast", "true".into()));
        }
        out
    }
}

/// Every call the React Admin app makes, described (`admin-app/src/api/*.ts`).
pub mod ops {
    use super::{Body, Call, EventFilters, Method};
    use serde_json::{Value, json};

    pub fn hello_admin() -> Call {
        Call::new(Method::Get, "/hello/admin".into())
    }

    // Venues (locations.ts).
    pub fn list_locations(q: Option<&str>) -> Call {
        let mut call = Call::new(Method::Get, "/locations".into());
        if let Some(q) = q.filter(|q| !q.is_empty()) {
            call.query.push(("q", q.to_string()));
        }
        call
    }
    pub fn get_location(id: &str) -> Call {
        Call::new(Method::Get, format!("/locations/{id}"))
    }
    pub fn create_location(input: &Value) -> Call {
        Call::new(Method::Post, "/locations".into()).json(input)
    }
    pub fn update_location(id: &str, input: &Value) -> Call {
        Call::new(Method::Patch, format!("/locations/{id}")).json(input)
    }
    pub fn delete_location(id: &str) -> Call {
        Call::new(Method::Delete, format!("/locations/{id}"))
    }

    // Layouts (layouts.ts; specs 038 and 039).
    pub fn list_venue_layouts(location_id: &str) -> Call {
        Call::new(Method::Get, format!("/locations/{location_id}/layouts"))
    }
    pub fn create_venue_layout(location_id: &str, input: &Value) -> Call {
        Call::new(Method::Post, format!("/locations/{location_id}/layouts")).json(input)
    }
    pub fn import_venue_layout(location_id: &str, input: &Value) -> Call {
        Call::new(
            Method::Post,
            format!("/locations/{location_id}/layouts/import"),
        )
        .json(input)
    }
    pub fn get_venue_layout(layout_id: &str) -> Call {
        Call::new(Method::Get, format!("/layouts/{layout_id}"))
    }
    pub fn get_venue_layout_section(layout_id: &str, section_id: &str) -> Call {
        Call::new(
            Method::Get,
            format!("/layouts/{layout_id}/sections/{section_id}"),
        )
    }
    pub fn update_venue_layout(layout_id: &str, input: &Value) -> Call {
        Call::new(Method::Put, format!("/layouts/{layout_id}")).json(input)
    }
    pub fn duplicate_venue_layout(layout_id: &str, input: &Value) -> Call {
        Call::new(Method::Post, format!("/layouts/{layout_id}/duplicate")).json(input)
    }
    pub fn delete_venue_layout(layout_id: &str) -> Call {
        Call::new(Method::Delete, format!("/layouts/{layout_id}"))
    }
    pub fn get_layout_drawing(layout_id: &str) -> Call {
        Call::new(Method::Get, format!("/layouts/{layout_id}/drawing"))
    }
    pub fn save_layout_drawing(layout_id: &str, input: &Value) -> Call {
        Call::new(Method::Put, format!("/layouts/{layout_id}/drawing")).json(input)
    }
    pub fn create_layout_drawing(location_id: &str, input: &Value) -> Call {
        Call::new(
            Method::Post,
            format!("/locations/{location_id}/layouts/drawing"),
        )
        .json(input)
    }

    // Events (events.ts).
    pub fn list_events(filters: &EventFilters) -> Call {
        let mut call = Call::new(Method::Get, "/events".into());
        call.query = filters.query();
        call
    }
    pub fn get_event(id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{id}"))
    }
    pub fn create_event(input: &Value) -> Call {
        Call::new(Method::Post, "/events".into()).json(input)
    }
    pub fn update_event(id: &str, input: &Value) -> Call {
        Call::new(Method::Patch, format!("/events/{id}")).json(input)
    }
    pub fn delete_event(id: &str) -> Call {
        Call::new(Method::Delete, format!("/events/{id}"))
    }

    // Ticket types (tiers.ts).
    pub fn list_tiers(event_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/tiers"))
    }
    pub fn create_tier(event_id: &str, input: &Value) -> Call {
        Call::new(Method::Post, format!("/events/{event_id}/tiers")).json(input)
    }
    pub fn update_tier(event_id: &str, tier_id: &str, input: &Value) -> Call {
        Call::new(Method::Patch, format!("/events/{event_id}/tiers/{tier_id}")).json(input)
    }
    pub fn delete_tier(event_id: &str, tier_id: &str) -> Call {
        Call::new(
            Method::Delete,
            format!("/events/{event_id}/tiers/{tier_id}"),
        )
    }

    // Orders (orders.ts).
    pub fn list_attendees(event_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/attendees"))
    }
    pub fn cancel_event(event_id: &str) -> Call {
        Call::new(Method::Post, format!("/events/{event_id}/cancel"))
    }

    // Seating (seating.ts).
    pub fn get_event_seating(event_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/seating"))
    }
    pub fn get_venue_map_section(event_id: &str, section_id: &str) -> Call {
        Call::new(
            Method::Get,
            format!("/events/{event_id}/venue-map/sections/{section_id}"),
        )
    }
    pub fn get_availability(event_id: &str) -> Call {
        Call::new(Method::Get, format!("/events/{event_id}/availability"))
    }

    // Images (images.ts).
    pub fn upload_event_image(
        event_id: &str,
        name: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Call {
        let mut call = Call::new(Method::Post, format!("/events/{event_id}/images"));
        call.body = Body::File {
            name: name.to_string(),
            content_type: content_type.to_string(),
            bytes,
        };
        call
    }
    pub fn delete_event_image(event_id: &str, image_id: &str) -> Call {
        Call::new(
            Method::Delete,
            format!("/events/{event_id}/images/{image_id}"),
        )
    }
    pub fn reorder_event_images(event_id: &str, image_ids: &[String]) -> Call {
        Call::new(Method::Put, format!("/events/{event_id}/images/order"))
            .json(&json!({ "imageIds": image_ids }))
    }

    // Reports (reports.ts).
    pub fn get_sales_report() -> Call {
        Call::new(Method::Get, "/reports/sales".into())
    }
}

/// Where the signed-in admin's current access token comes from.
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

    /// Sends `call` and returns the answer's body (empty for 204), or the error it is.
    pub async fn send_raw(&self, call: Call) -> Result<Vec<u8>, ApiError> {
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
            Body::File {
                name,
                content_type,
                bytes,
            } => {
                let part = reqwest::multipart::Part::bytes(bytes)
                    .file_name(name)
                    .mime_str(&content_type)
                    .map_err(|e| ApiError::Decode(e.to_string()))?;
                request.multipart(reqwest::multipart::Form::new().part("file", part))
            }
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
        if status == 401 {
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

    /// `/hello/admin`, as JSON: the greeting page shows its two strings.
    pub async fn hello_admin(&self) -> Result<Value, ApiError> {
        self.send(ops::hello_admin()).await
    }

    pub async fn list_locations(&self, q: Option<&str>) -> Result<Vec<types::Location>, ApiError> {
        self.send(ops::list_locations(q)).await
    }
    pub async fn get_location(&self, id: &str) -> Result<types::Location, ApiError> {
        self.send(ops::get_location(id)).await
    }
    pub async fn create_location(&self, input: &Value) -> Result<types::Location, ApiError> {
        self.send(ops::create_location(input)).await
    }
    pub async fn update_location(
        &self,
        id: &str,
        input: &Value,
    ) -> Result<types::Location, ApiError> {
        self.send(ops::update_location(id, input)).await
    }
    pub async fn delete_location(&self, id: &str) -> Result<(), ApiError> {
        self.send_empty(ops::delete_location(id)).await
    }

    pub async fn list_venue_layouts(
        &self,
        location_id: &str,
    ) -> Result<Vec<types::LayoutSummary>, ApiError> {
        self.send(ops::list_venue_layouts(location_id)).await
    }
    pub async fn create_venue_layout(
        &self,
        location_id: &str,
        input: &Value,
    ) -> Result<types::LayoutDetail, ApiError> {
        self.send(ops::create_venue_layout(location_id, input))
            .await
    }
    pub async fn import_venue_layout(
        &self,
        location_id: &str,
        input: &Value,
    ) -> Result<types::LayoutDetail, ApiError> {
        self.send(ops::import_venue_layout(location_id, input))
            .await
    }
    pub async fn get_venue_layout(&self, layout_id: &str) -> Result<types::LayoutDetail, ApiError> {
        self.send(ops::get_venue_layout(layout_id)).await
    }
    pub async fn get_venue_layout_section(
        &self,
        layout_id: &str,
        section_id: &str,
    ) -> Result<types::LayoutSectionSeats, ApiError> {
        self.send(ops::get_venue_layout_section(layout_id, section_id))
            .await
    }
    pub async fn update_venue_layout(
        &self,
        layout_id: &str,
        input: &Value,
    ) -> Result<types::LayoutDetail, ApiError> {
        self.send(ops::update_venue_layout(layout_id, input)).await
    }
    pub async fn duplicate_venue_layout(
        &self,
        layout_id: &str,
        input: &Value,
    ) -> Result<types::LayoutDetail, ApiError> {
        self.send(ops::duplicate_venue_layout(layout_id, input))
            .await
    }
    pub async fn delete_venue_layout(&self, layout_id: &str) -> Result<(), ApiError> {
        self.send_empty(ops::delete_venue_layout(layout_id)).await
    }
    pub async fn get_layout_drawing(
        &self,
        layout_id: &str,
    ) -> Result<types::LayoutDrawing, ApiError> {
        self.send(ops::get_layout_drawing(layout_id)).await
    }
    pub async fn save_layout_drawing(
        &self,
        layout_id: &str,
        input: &Value,
    ) -> Result<types::LayoutDetail, ApiError> {
        self.send(ops::save_layout_drawing(layout_id, input)).await
    }
    pub async fn create_layout_drawing(
        &self,
        location_id: &str,
        input: &Value,
    ) -> Result<types::LayoutDetail, ApiError> {
        self.send(ops::create_layout_drawing(location_id, input))
            .await
    }

    pub async fn list_events(&self, filters: &EventFilters) -> Result<Vec<types::Event>, ApiError> {
        self.send(ops::list_events(filters)).await
    }
    pub async fn get_event(&self, id: &str) -> Result<types::Event, ApiError> {
        self.send(ops::get_event(id)).await
    }
    pub async fn create_event(&self, input: &Value) -> Result<types::Event, ApiError> {
        self.send(ops::create_event(input)).await
    }
    pub async fn update_event(&self, id: &str, input: &Value) -> Result<types::Event, ApiError> {
        self.send(ops::update_event(id, input)).await
    }
    pub async fn delete_event(&self, id: &str) -> Result<(), ApiError> {
        self.send_empty(ops::delete_event(id)).await
    }

    pub async fn list_tiers(&self, event_id: &str) -> Result<Vec<types::TicketTier>, ApiError> {
        self.send(ops::list_tiers(event_id)).await
    }
    pub async fn create_tier(
        &self,
        event_id: &str,
        input: &Value,
    ) -> Result<types::TicketTier, ApiError> {
        self.send(ops::create_tier(event_id, input)).await
    }
    pub async fn update_tier(
        &self,
        event_id: &str,
        tier_id: &str,
        input: &Value,
    ) -> Result<types::TicketTier, ApiError> {
        self.send(ops::update_tier(event_id, tier_id, input)).await
    }
    pub async fn delete_tier(&self, event_id: &str, tier_id: &str) -> Result<(), ApiError> {
        self.send_empty(ops::delete_tier(event_id, tier_id)).await
    }

    pub async fn list_attendees(&self, event_id: &str) -> Result<Vec<types::Order>, ApiError> {
        self.send(ops::list_attendees(event_id)).await
    }
    pub async fn cancel_event(&self, event_id: &str) -> Result<types::Cancellation, ApiError> {
        self.send(ops::cancel_event(event_id)).await
    }

    pub async fn get_event_seating(&self, event_id: &str) -> Result<types::EventSeating, ApiError> {
        self.send(ops::get_event_seating(event_id)).await
    }
    pub async fn get_venue_map_section(
        &self,
        event_id: &str,
        section_id: &str,
    ) -> Result<types::VenueMapSection, ApiError> {
        self.send(ops::get_venue_map_section(event_id, section_id))
            .await
    }
    pub async fn get_availability(&self, event_id: &str) -> Result<types::Availability, ApiError> {
        self.send(ops::get_availability(event_id)).await
    }

    pub async fn upload_event_image(
        &self,
        event_id: &str,
        name: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<types::EventImage, ApiError> {
        self.send(ops::upload_event_image(event_id, name, content_type, bytes))
            .await
    }
    pub async fn delete_event_image(&self, event_id: &str, image_id: &str) -> Result<(), ApiError> {
        self.send_empty(ops::delete_event_image(event_id, image_id))
            .await
    }
    pub async fn reorder_event_images(
        &self,
        event_id: &str,
        image_ids: &[String],
    ) -> Result<Vec<types::EventImage>, ApiError> {
        self.send(ops::reorder_event_images(event_id, image_ids))
            .await
    }

    pub async fn get_sales_report(&self) -> Result<types::SalesReport, ApiError> {
        self.send(ops::get_sales_report()).await
    }
}

/// The JSON of an error envelope, for tests and for showing a made-up refusal.
pub fn envelope(code: &str, message: &str) -> Value {
    json!({ "error": { "code": code, "message": message } })
}
