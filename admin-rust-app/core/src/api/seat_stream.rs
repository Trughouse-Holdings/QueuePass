//! Spec 037 T058 (parity M16, research R5, R13): the live seat stream (`streamSeatMap`, spec 015
//! research R9, spec 038 research R12), ported from `packages/shared/src/web/seat-stream.ts` and
//! the policies of `packages/shared/src/web/use-seat-stream.ts`.
//!
//! Everything here is pure: no timers and no I/O. The app's streaming `fetch` glue drives it:
//!
//! 1. [`open_seat_stream`], then [`SeatStream::connect`] before each request. Send
//!    `GET {stream_url}` with [`stream_headers`] (the token current at that connect).
//! 2. Hand the response status to [`SeatStream::on_response`]; on [`StreamStep::Read`], feed each
//!    body chunk to [`SeatStream::on_chunk`] and apply its messages (`map_reducer`). A network
//!    error, a failed read, or a response without a body is [`SeatStream::on_error`]; the body's
//!    normal end is [`SeatStream::on_end`].
//! 3. Follow the [`StreamStep`] each call returns: connect at once, after a wait, or not at all.
//!
//! [`LiveStatus`] maps the stream's status to the one the page shows, and [`SectionLoader`] says
//! when to read the open section again.

use crate::seating::map_state::{MapState, SeatMapChange, VenueMap, needs_load};

/// TS `RECONNECT_DELAYS_MS` (spec 015 research R9): after a drop or an error status, wait 1, 2,
/// then 5 seconds between tries.
pub const RECONNECT_DELAYS_MS: [u64; 3] = [1_000, 2_000, 5_000];

/// `use-seat-stream.ts`: the longest wait before reading the open section again.
pub const SECTION_RETRY_MAX_MS: u64 = 10_000;

/// TS `STREAM_PATH`, with `{id}` filled as `encodeURIComponent` does:
/// `{base}/events/{id}/seats/stream`.
pub fn stream_url(base_url: &str, event_id: &str) -> String {
    format!(
        "{base_url}/events/{}/seats/stream",
        encode_uri_component(event_id)
    )
}

/// The stream request's headers, in order: `Accept: text/event-stream`, and
/// `Authorization: Bearer {token}` when there is a token (an empty one counts as none). Only these
/// two: the CORS policy allows no other request header (`seat-stream.ts`).
pub fn stream_headers(token: Option<&str>) -> Vec<(&'static str, String)> {
    let mut headers = vec![("Accept", "text/event-stream".to_owned())];
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        headers.push(("Authorization", format!("Bearer {token}")));
    }
    headers
}

/// JavaScript's `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// ------------------------------------------------------------------------------------------
// The parser (TS `readEvents`)
// ------------------------------------------------------------------------------------------

/// One dispatched `text/event-stream` event: its name (`message` when none was given) and its
/// `data:` lines joined with `\n`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

/// TS `readEvents`: an incremental `text/event-stream` parser. Feed it the body's chunks; it
/// returns each event as its blank line arrives.
///
/// As the TypeScript: bytes are decoded as `TextDecoder` does (`stream: true`), so a character
/// split across chunks is kept for the next one, an invalid sequence becomes U+FFFD, and one
/// byte order mark at the very start is dropped. Lines end at `\r\n`, `\r`, or `\n`. Fields are
/// `event` and `data` (case-sensitive, one leading space removed from the value, a line with no
/// colon is a field with an empty value); comments (`:`) and other fields are ignored; an event
/// with no `data` line is not dispatched. Quirks kept: a `\r\n` split between two chunks counts
/// as two line ends (so it can end an event early), and an event still open when the body ends is
/// dropped.
#[derive(Debug, Clone, Default)]
pub struct SseParser {
    undecoded: Vec<u8>,
    started: bool,
    pending: String,
    event: String,
    data: Vec<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds a chunk of the body's bytes; returns the events it completes.
    pub fn feed_bytes(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        let mut text = self.decode(chunk);
        if !self.started && !text.is_empty() {
            self.started = true;
            if let Some(rest) = text.strip_prefix('\u{feff}') {
                text = rest.to_owned();
            }
        }
        self.pending.push_str(&text);
        let mut events = Vec::new();
        let pending = std::mem::take(&mut self.pending);
        let bytes = pending.as_bytes();
        let mut start = 0;
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'\r' => {
                    self.line(&pending[start..i], &mut events);
                    if bytes.get(i + 1) == Some(&b'\n') {
                        i += 1;
                    }
                    start = i + 1;
                }
                b'\n' => {
                    self.line(&pending[start..i], &mut events);
                    start = i + 1;
                }
                _ => {}
            }
            i += 1;
        }
        self.pending = pending[start..].to_owned();
        events
    }

    /// Feeds a chunk of text, as its UTF-8 bytes.
    pub fn feed_str(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.feed_bytes(chunk.as_bytes())
    }

    /// `TextDecoder.decode(chunk, { stream: true })`.
    fn decode(&mut self, chunk: &[u8]) -> String {
        let mut buf = std::mem::take(&mut self.undecoded);
        buf.extend_from_slice(chunk);
        let mut out = String::new();
        let mut rest: &[u8] = &buf;
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    out.push_str(s);
                    rest = &[];
                    break;
                }
                Err(e) => {
                    let (valid, after) = rest.split_at(e.valid_up_to());
                    out.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match e.error_len() {
                        Some(n) => {
                            out.push('\u{fffd}');
                            rest = &after[n..];
                        }
                        // A character cut at the chunk's end: wait for the rest.
                        None => {
                            rest = after;
                            break;
                        }
                    }
                }
            }
        }
        self.undecoded = rest.to_vec();
        out
    }

    fn line(&mut self, text: &str, events: &mut Vec<SseEvent>) {
        if text.is_empty() {
            if !self.data.is_empty() {
                let event = std::mem::take(&mut self.event);
                events.push(SseEvent {
                    event: if event.is_empty() {
                        "message".to_owned()
                    } else {
                        event
                    },
                    data: self.data.join("\n"),
                });
            }
            self.event.clear();
            self.data.clear();
            return;
        }
        if text.starts_with(':') {
            return;
        }
        let (field, value) = match text.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (text, ""),
        };
        match field {
            "event" => value.clone_into(&mut self.event),
            "data" => self.data.push(value.to_owned()),
            _ => {}
        }
    }
}

// ------------------------------------------------------------------------------------------
// The connection (TS `openSeatStream`)
// ------------------------------------------------------------------------------------------

/// TS `SeatStreamStatus`: `Connecting` before the first venue map, `Live` once one arrived,
/// `Reconnecting` while waiting to try again, `Gone` after a 404 (the event was deleted, or has
/// no venue map), `Closed` after [`SeatStream::close`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeatStreamStatus {
    Connecting,
    Live,
    Reconnecting,
    Gone,
    Closed,
}

/// What the glue does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamStep {
    /// The response is the stream: read its body into [`SeatStream::on_chunk`].
    Read,
    /// Call [`SeatStream::connect`] and request the stream again now, with the current token.
    Connect,
    /// Wait this many milliseconds, then as [`StreamStep::Connect`].
    ConnectAfter(u64),
    /// Nothing more for this connection, and no new one: after a 404, after `close()`, or for a
    /// call that came after the connection was already done with.
    Stop,
}

/// A payload of the stream, decoded: `venueMap` (a full map) or `seats` (a change with `seq`).
#[derive(Debug, Clone, PartialEq)]
pub enum StreamMessage {
    Map(Box<VenueMap>),
    Change(SeatMapChange),
}

/// What [`SeatStream::on_chunk`] gives: the messages, and, when a payload could not be read, the
/// step to take instead of reading on (abort the request, then follow it).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ChunkResult {
    pub messages: Vec<StreamMessage>,
    pub then: Option<StreamStep>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Before a connect, or waiting to reconnect.
    Idle,
    /// Requested; no response yet.
    Fetching,
    Reading,
    Done,
}

/// TS `openSeatStream`'s state, without the `fetch` and the timers (research R13).
///
/// A 404 stops it (`Gone`). A 2xx is read. Any other status, a network error, or a drop waits
/// 1, 2, then 5 seconds ([`RECONNECT_DELAYS_MS`]) and connects again. The server ending the
/// stream after a venue map (token expiry, a layout or price change) connects again at once;
/// ending it before one waits as after a failure. Each `venueMap` sets `Live` and resets the
/// waits. A payload that is not the contract's shape is a failure, like a drop (the TypeScript's
/// `JSON.parse` throwing; it does not check the shape).
#[derive(Debug, Clone)]
pub struct SeatStream {
    status: SeatStreamStatus,
    closed: bool,
    failures: usize,
    map_seen: bool,
    phase: Phase,
    parser: SseParser,
}

/// TS `openSeatStream`: a new stream, `Connecting`. Call [`SeatStream::connect`] to make the
/// first request.
pub fn open_seat_stream() -> SeatStream {
    SeatStream {
        status: SeatStreamStatus::Connecting,
        closed: false,
        failures: 0,
        map_seen: false,
        phase: Phase::Idle,
        parser: SseParser::new(),
    }
}

impl SeatStream {
    pub fn status(&self) -> SeatStreamStatus {
        self.status
    }

    /// Before each request (the first, and each reconnect): `false` once closed or gone, when no
    /// request is made. Starts a fresh parser; this connection has seen no map yet.
    pub fn connect(&mut self) -> bool {
        if self.closed {
            return false;
        }
        self.map_seen = false;
        self.parser = SseParser::new();
        self.phase = Phase::Fetching;
        true
    }

    /// The response's status: 404 → [`StreamStep::Stop`] (`Gone`); 2xx → [`StreamStep::Read`];
    /// anything else (401 included) → wait and connect again.
    pub fn on_response(&mut self, status: u16) -> StreamStep {
        if self.closed || self.phase != Phase::Fetching {
            return StreamStep::Stop;
        }
        if status == 404 {
            self.closed = true;
            self.phase = Phase::Done;
            self.status = SeatStreamStatus::Gone;
            return StreamStep::Stop;
        }
        if (200..300).contains(&status) {
            self.phase = Phase::Reading;
            return StreamStep::Read;
        }
        self.retry_later()
    }

    /// A chunk of the body. `venueMap` and `seats` payloads come out as messages; other events
    /// (`ping`) are ignored. A payload that can't be read ends the connection: the messages
    /// before it are kept, the rest of the chunk is not read, and `then` says when to reconnect.
    pub fn on_chunk(&mut self, chunk: &[u8]) -> ChunkResult {
        let mut result = ChunkResult::default();
        if self.closed || self.phase != Phase::Reading {
            return result;
        }
        for event in self.parser.feed_bytes(chunk) {
            let message = match event.event.as_str() {
                "venueMap" => {
                    self.map_seen = true;
                    self.failures = 0;
                    self.status = SeatStreamStatus::Live;
                    serde_json::from_str(&event.data).map(|m| StreamMessage::Map(Box::new(m)))
                }
                "seats" => serde_json::from_str(&event.data).map(StreamMessage::Change),
                _ => continue,
            };
            match message {
                Ok(message) => result.messages.push(message),
                Err(_) => {
                    result.then = Some(self.retry_later());
                    break;
                }
            }
        }
        result
    }

    /// The request failed (no answer), the body could not be read, or there was no body: wait
    /// and connect again.
    pub fn on_error(&mut self) -> StreamStep {
        if !matches!(self.phase, Phase::Fetching | Phase::Reading) {
            return StreamStep::Stop;
        }
        self.retry_later()
    }

    /// The server ended the stream. After a venue map on this connection: connect again at once.
    /// Without one, something is wrong: wait as after any other failure.
    pub fn on_end(&mut self) -> StreamStep {
        if self.phase != Phase::Reading {
            return StreamStep::Stop;
        }
        if self.closed {
            self.phase = Phase::Done;
            return StreamStep::Stop;
        }
        if self.map_seen {
            self.phase = Phase::Idle;
            StreamStep::Connect
        } else {
            self.retry_later()
        }
    }

    /// TS `close()`: no more connects. The glue aborts the request and clears any wait.
    pub fn close(&mut self) {
        self.closed = true;
        self.phase = Phase::Done;
        self.status = SeatStreamStatus::Closed;
    }

    /// TS `retryLater`.
    fn retry_later(&mut self) -> StreamStep {
        if self.closed {
            self.phase = Phase::Done;
            return StreamStep::Stop;
        }
        self.phase = Phase::Idle;
        let delay = RECONNECT_DELAYS_MS[self.failures.min(RECONNECT_DELAYS_MS.len() - 1)];
        self.failures += 1;
        self.status = SeatStreamStatus::Reconnecting;
        StreamStep::ConnectAfter(delay)
    }
}

// ------------------------------------------------------------------------------------------
// The status shown (TS `useSeatStream`'s `LiveSeatStatus`, parity M16)
// ------------------------------------------------------------------------------------------

/// TS `LiveSeatStatus`: `Loading` before any map, `Connecting` until the stream's first venue
/// map, `Live` while it delivers, `Reconnecting` while it is down (the map shown may be behind),
/// `Offline` when it stopped, `Missing` for an unknown event or one without a venue map (general
/// admission, also after a switch to it while streaming), `Unreachable` when no map could be
/// loaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveSeatStatus {
    Loading,
    Connecting,
    Live,
    Reconnecting,
    Offline,
    Missing,
    Unreachable,
}

/// The answer to `GET /events/{id}/venue-map`, read before the stream opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapAnswer {
    /// The response's status.
    Status(u16),
    /// A network error.
    NoAnswer,
}

/// `useSeatStream`'s status for one event: `Loading`, then the stream's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiveStatus {
    status: LiveSeatStatus,
    was_live: bool,
}

impl Default for LiveStatus {
    fn default() -> Self {
        Self::new()
    }
}

impl LiveStatus {
    pub fn new() -> Self {
        Self {
            status: LiveSeatStatus::Loading,
            was_live: false,
        }
    }

    /// Another event (or a reload): `Loading` again.
    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// The venue map's answer. A 404: `Missing`, and the stream is not opened (`false`).
    /// Anything else opens the stream (`true`): a network error or an error status too, since the
    /// stream may still deliver a map. On a 2xx with a map, the caller takes it unless the
    /// stream's own map came first (it is newer).
    pub fn on_map_answer(&mut self, answer: MapAnswer) -> bool {
        if answer == MapAnswer::Status(404) {
            self.status = LiveSeatStatus::Missing;
            return false;
        }
        true
    }

    /// Each status of the stream. `Gone` after it was live: the event was deleted or switched to
    /// general admission (`Missing`; the caller reads the event to tell which). Before that, the
    /// map loaded, so streaming is just unavailable (`Offline`). `Closed` changes nothing.
    pub fn on_stream_status(&mut self, status: SeatStreamStatus) {
        match status {
            SeatStreamStatus::Connecting => self.status = LiveSeatStatus::Connecting,
            SeatStreamStatus::Live => {
                self.was_live = true;
                self.status = LiveSeatStatus::Live;
            }
            SeatStreamStatus::Reconnecting => self.status = LiveSeatStatus::Reconnecting,
            SeatStreamStatus::Gone => {
                self.status = if self.was_live {
                    LiveSeatStatus::Missing
                } else {
                    LiveSeatStatus::Offline
                };
            }
            SeatStreamStatus::Closed => {}
        }
    }

    /// The status as kept.
    pub fn status(&self) -> LiveSeatStatus {
        self.status
    }

    /// The status shown: with no map, `Offline` or `Reconnecting` reads `Unreachable`.
    pub fn shown(&self, has_map: bool) -> LiveSeatStatus {
        match self.status {
            LiveSeatStatus::Offline | LiveSeatStatus::Reconnecting if !has_map => {
                LiveSeatStatus::Unreachable
            }
            s => s,
        }
    }
}

// ------------------------------------------------------------------------------------------
// The open section's seats (TS `useSeatStream`)
// ------------------------------------------------------------------------------------------

/// `useSeatStream`'s `wanted`: a section is open, there is a map, and the section was never loaded
/// or was loaded before the current map (`needsLoad`). Then `GET
/// /events/{id}/venue-map/sections/{sectionId}`.
pub fn section_wanted(state: &MapState, open_section_id: Option<&str>) -> bool {
    match open_section_id {
        Some(id) => state.map.is_some() && needs_load(state, id),
        None => false,
    }
}

/// `useSeatStream`'s wait before reading the open section again after `failures` earlier
/// failures: 1, 2, 4, 8, then every 10 seconds (`Math.min(1_000 * 2 ** failures, 10_000)`).
pub fn section_retry_delay_ms(failures: u32) -> u64 {
    let factor = 1u64.checked_shl(failures).unwrap_or(u64::MAX);
    1_000u64.saturating_mul(factor).min(SECTION_RETRY_MAX_MS)
}

/// The answer to a section read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionAnswer {
    /// A 2xx with the section.
    Loaded,
    /// Any other answer, by status.
    Status(u16),
    /// A network error.
    NoAnswer,
}

/// What to do with a section read's answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionResult {
    /// Dispatch `MapAction::Section` (if the event is still the one asked about).
    pub store: bool,
    /// Read it again after this wait, while it stays open.
    pub retry_after_ms: Option<u64>,
}

/// `useSeatStream`'s section reads: the map version (counts the maps taken, so a section read
/// before the latest map is not stored as current) and the failure count for the retries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SectionLoader {
    failures: u32,
    map_version: u64,
}

impl SectionLoader {
    pub fn new() -> Self {
        Self::default()
    }

    /// A map was taken (`takeMap`): sections read before it are not stored, and are read again.
    pub fn on_map(&mut self) {
        self.map_version += 1;
    }

    /// The current map version; note it when sending a section read (TS `asked`).
    pub fn map_version(&self) -> u64 {
        self.map_version
    }

    /// Another section is open, or none: its tries start from the first wait.
    pub fn open_changed(&mut self) {
        self.failures = 0;
    }

    /// A section read's answer, for the read sent at map version `asked`. A section is stored only
    /// when read for the current map. No answer or a 5xx is read again after
    /// [`section_retry_delay_ms`]. Quirk kept (a known open bug): any other answer without the
    /// section, a 4xx and 401 included, is not tried again and leaves the failure count as it
    /// was, so "Loading the seats of section {name}…" stays until the section is closed and
    /// opened again.
    pub fn on_answer(&mut self, asked: u64, answer: SectionAnswer) -> SectionResult {
        let failed = match answer {
            SectionAnswer::Loaded => {
                self.failures = 0;
                false
            }
            SectionAnswer::Status(status) => status >= 500,
            SectionAnswer::NoAnswer => true,
        };
        let store = answer == SectionAnswer::Loaded && asked == self.map_version;
        let retry_after_ms = failed.then(|| {
            let wait = section_retry_delay_ms(self.failures);
            self.failures += 1;
            wait
        });
        SectionResult {
            store,
            retry_after_ms,
        }
    }
}
