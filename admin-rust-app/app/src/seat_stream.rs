//! Spec 037 research R5, R13 (task T063; parity M16): an event's venue map and the section zoomed
//! into, kept current by the live seat stream, as `packages/shared/src/web/use-seat-stream.ts`
//! (and `seat-stream.ts`' `fetch`). The map is first read with `GET /events/{id}/venue-map`; then
//! a streaming `fetch` of `/events/{id}/seats/stream` with `Accept: text/event-stream` and the
//! token current at each connect in `Authorization`, its body read through a `ReadableStream`.
//! Every decision (the parser, when to reconnect, which status shows, when to read the open
//! section again) is `core::api::seat_stream`'s; this module only does the I/O and the waits. The
//! stream closes when the view that opened it goes away.

use std::{cell::RefCell, rc::Rc};

use admin_rust_core::{
    api::{
        client::{ApiError, Body, Call, Method, ops},
        seat_stream::{
            LiveSeatStatus, LiveStatus, MapAnswer, SeatStream, SectionAnswer, SectionLoader,
            StreamMessage, StreamStep, encode_uri_component, open_seat_stream, section_wanted,
            stream_headers, stream_url,
        },
        types,
    },
    seating::map_state::{MapAction, MapState, VenueMap, VenueMapSection, map_reducer},
};
use leptos::{prelude::*, task::spawn_local};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use crate::auth::use_auth;

/// `LiveSeats`, for the admin: the map with its counts kept current, the open section's seats
/// (`None` until loaded, or when none is open), and the status shown.
#[derive(Clone, Copy)]
pub struct LiveSeats {
    pub map: Memo<Option<VenueMap>>,
    pub section: Memo<Option<VenueMapSection>>,
    pub status: Memo<LiveSeatStatus>,
}

/// Waits `ms` milliseconds.
async fn sleep(ms: u64) {
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        let _ = window().set_timeout_with_callback_and_timeout_and_arguments_0(
            &resolve,
            i32::try_from(ms).unwrap_or(i32::MAX),
        );
    });
    let _ = JsFuture::from(promise).await;
}

async fn fetch_stream(
    url: &str,
    headers: &[(&'static str, String)],
    signal: &web_sys::AbortSignal,
) -> Result<web_sys::Response, JsValue> {
    let h = web_sys::Headers::new()?;
    for (name, value) in headers {
        h.append(name, value)?;
    }
    let init = web_sys::RequestInit::new();
    init.set_method("GET");
    init.set_headers(&h);
    init.set_signal(Some(signal));
    let response = JsFuture::from(window().fetch_with_str_and_init(url, &init)).await?;
    response.dyn_into()
}

/// One read of the body: `Some(bytes)`, or `None` at its end.
async fn read_chunk(
    reader: &web_sys::ReadableStreamDefaultReader,
) -> Result<Option<Vec<u8>>, JsValue> {
    let result = JsFuture::from(reader.read()).await?;
    let done = js_sys::Reflect::get(&result, &JsValue::from_str("done"))?
        .as_bool()
        .unwrap_or(false);
    if done {
        return Ok(None);
    }
    let value = js_sys::Reflect::get(&result, &JsValue::from_str("value"))?;
    Ok(Some(js_sys::Uint8Array::new(&value).to_vec()))
}

/// `useSeatStream(eventId, { openSectionId })` for one event, for as long as the calling view
/// lives.
pub fn use_seat_stream(event_id: String, open_section_id: Signal<Option<String>>) -> LiveSeats {
    let auth = use_auth();
    let state = RwSignal::new(MapState::default());
    let live = RwSignal::new(LiveStatus::new());
    let loader = StoredValue::new(SectionLoader::new());
    // Counts the maps taken (as the loader does), for the section reads to follow.
    let map_version = RwSignal::new(0_u64);
    let section_try = RwSignal::new(0_u64);
    let alive = StoredValue::new(true);
    let stream = StoredValue::new_local(Rc::new(RefCell::new(open_seat_stream())));
    let controller = StoredValue::new_local(None::<web_sys::AbortController>);
    let section_request = StoredValue::new(None::<(String, u64, u64)>);
    let section_timer = StoredValue::new_local(None::<TimeoutHandle>);

    let is_alive = move || alive.try_get_value().unwrap_or(false);
    let dispatch = move |action: MapAction| {
        state.try_update(|s| *s = map_reducer(std::mem::take(s), action));
    };
    let take_map = move |map: VenueMap| {
        loader.try_update_value(SectionLoader::on_map);
        map_version.try_update(|n| *n += 1);
        dispatch(MapAction::Map(map));
    };
    let set_status = move |s| {
        live.try_update(|l| l.on_stream_status(s));
    };

    on_cleanup(move || {
        alive.try_set_value(false);
        if let Some(s) = stream.try_get_value() {
            s.borrow_mut().close();
        }
        if let Some(Some(c)) = controller.try_update_value(Option::take) {
            c.abort();
        }
        if let Some(Some(t)) = section_timer.try_update_value(Option::take) {
            t.clear();
        }
    });

    let api = auth.api();
    let id = event_id.clone();
    spawn_local(async move {
        let call = Call {
            method: Method::Get,
            path: format!("/events/{}/venue-map", encode_uri_component(&id)),
            query: Vec::new(),
            body: Body::None,
        };
        let answer = match api.send_quiet::<VenueMap>(call).await {
            Ok(map) => {
                // The stream's own first map may have come already; it is newer.
                if is_alive() && state.with_untracked(|s| s.map.is_none()) {
                    take_map(map);
                }
                MapAnswer::Status(200)
            }
            Err(ApiError::Status(e)) => MapAnswer::Status(e.status),
            Err(_) => MapAnswer::NoAnswer,
        };
        if !is_alive() {
            return;
        }
        let open = live
            .try_update(|l| l.on_map_answer(answer))
            .unwrap_or(false);
        if !open {
            return;
        }
        let Some(stream) = stream.try_get_value() else {
            return;
        };
        set_status(stream.borrow().status());
        let url = stream_url(api.base_url(), &id);
        loop {
            if !is_alive() || !stream.borrow_mut().connect() {
                return;
            }
            let Ok(abort) = web_sys::AbortController::new() else {
                return;
            };
            let signal = abort.signal();
            controller.try_set_value(Some(abort.clone()));
            let headers = stream_headers(auth.access_token().as_deref());
            let step = match fetch_stream(&url, &headers, &signal).await {
                Err(_) => stream.borrow_mut().on_error(),
                Ok(response) => {
                    let step = stream.borrow_mut().on_response(response.status());
                    // The stream: read its body until it ends or fails.
                    if step == StreamStep::Read {
                        read_body(&stream, &response, &abort, take_map, dispatch).await
                    } else {
                        step
                    }
                }
            };
            set_status(stream.borrow().status());
            match step {
                StreamStep::Connect | StreamStep::Read => {}
                StreamStep::ConnectAfter(ms) => sleep(ms).await,
                StreamStep::Stop => return,
            }
        }
    });

    // The open section's seats: loaded when opened, and again after each new map.
    let api = auth.api();
    let id = event_id;
    Effect::watch(
        move || open_section_id.get(),
        move |_, _, _| {
            // Another section (or none): its tries start from the first wait.
            if let Some(Some(t)) = section_timer.try_update_value(Option::take) {
                t.clear();
            }
            loader.update_value(SectionLoader::open_changed);
        },
        false,
    );
    Effect::new(move |_| {
        let open = open_section_id.get();
        let version = map_version.get();
        let tries = section_try.get();
        let wanted = state.with(|s| section_wanted(s, open.as_deref()));
        let Some(section_id) = open.filter(|_| wanted) else {
            return;
        };
        let key = (section_id.clone(), version, tries);
        if section_request.get_value().as_ref() == Some(&key) {
            return;
        }
        section_request.set_value(Some(key.clone()));
        if let Some(Some(t)) = section_timer.try_update_value(Option::take) {
            t.clear();
        }
        let asked = loader.with_value(SectionLoader::map_version);
        let api = api.clone();
        let id = id.clone();
        spawn_local(async move {
            let result = api
                .send_quiet::<types::VenueMapSection>(ops::get_venue_map_section(&id, &section_id))
                .await;
            if !is_alive() {
                return;
            }
            let (answer, section) = match result {
                Ok(section) => (SectionAnswer::Loaded, Some(VenueMapSection::from(section))),
                Err(ApiError::Status(e)) => (SectionAnswer::Status(e.status), None),
                Err(_) => (SectionAnswer::NoAnswer, None),
            };
            let Some(outcome) = loader.try_update_value(|l| l.on_answer(asked, answer)) else {
                return;
            };
            // Read before a newer map: the next request (for that map) brings it.
            if outcome.store
                && let Some(section) = section
            {
                dispatch(MapAction::Section(section));
            }
            if section_request.try_get_value().flatten().as_ref() != Some(&key) {
                return;
            }
            section_request.try_set_value(None);
            if let Some(wait) = outcome.retry_after_ms {
                let handle = set_timeout_with_handle(
                    move || {
                        section_try.try_update(|n| *n += 1);
                    },
                    std::time::Duration::from_millis(wait),
                );
                section_timer.try_set_value(handle.ok());
            }
        });
    });

    let map = Memo::new(move |_| state.with(|s| s.map.clone()));
    let section = Memo::new(move |_| {
        let open = open_section_id.get()?;
        state.with(|s| s.sections.get(&open).map(|l| l.section.clone()))
    });
    let status = Memo::new(move |_| {
        let has_map = state.with(|s| s.map.is_some());
        live.with(|l| l.shown(has_map))
    });
    LiveSeats {
        map,
        section,
        status,
    }
}

/// Reads one connection's body into the stream, applying each message; returns what to do next.
async fn read_body(
    stream: &Rc<RefCell<SeatStream>>,
    response: &web_sys::Response,
    abort: &web_sys::AbortController,
    take_map: impl Fn(VenueMap),
    dispatch: impl Fn(MapAction),
) -> StreamStep {
    let Some(body) = response.body() else {
        return stream.borrow_mut().on_error();
    };
    let reader: web_sys::ReadableStreamDefaultReader = body.get_reader().unchecked_into();
    loop {
        match read_chunk(&reader).await {
            Err(_) => return stream.borrow_mut().on_error(),
            Ok(None) => return stream.borrow_mut().on_end(),
            Ok(Some(chunk)) => {
                let result = stream.borrow_mut().on_chunk(&chunk);
                for message in result.messages {
                    match message {
                        StreamMessage::Map(map) => take_map(*map),
                        StreamMessage::Change(change) => dispatch(MapAction::Change(change)),
                    }
                }
                if let Some(then) = result.then {
                    // A payload that could not be read ends this connection.
                    abort.abort();
                    return then;
                }
            }
        }
    }
}
