//! Spec 040 T055 (parity T9–T11; research R9; spec 018): one ticket's live entry code, ported
//! from `packages/shared/src/live-code.ts` (the code, its window, the key's base64url) and
//! `customer-app/src/live-code-clock.ts` (the Backend's clock from one measured offset), and the
//! entry-code page's states from `customer-app/src/pages/EntryCode.tsx`.
//!
//! A live code is `QP1:<TICKET>:<WINDOW>:<MAC>`: the ticket's UUID as 32 upper-case hex digits,
//! the window number in decimal, and the first 10 bytes of HMAC-SHA256(key, "QP1:<TICKET>:<WINDOW>")
//! in RFC 4648 base32 without padding. The Rust app computes the HMAC itself, so the React app's
//! "no Web Crypto" state cannot happen here (parity T10 N/A); its text is kept for completeness.

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::api::client::ApiError;
use crate::api::types::{MyOrder, TicketEntryKey};
use crate::time::parse_instant;

/// `LIVE_CODE_PREFIX`.
pub const LIVE_CODE_PREFIX: &str = "QP1:";
/// Every window is 30 seconds (FR-002).
pub const WINDOW_MS: i64 = 30_000;
/// A code is accepted from 5 seconds before its window until 5 seconds after (FR-008).
pub const GRACE_MS: i64 = 5_000;
/// How often the page reads the clock (FR-002).
pub const TICK_MS: u32 = 250;

const MAC_BYTES: usize = 10;
const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Ports `windowAt`: the window an instant (Unix ms, possibly fractional) falls in.
pub fn window_at(ms: f64) -> i64 {
    (ms / WINDOW_MS as f64).floor() as i64
}

/// Ports `windowStartMs`.
pub fn window_start_ms(w: i64) -> i64 {
    w * WINDOW_MS
}

/// RFC 4648 base32, upper case, no padding.
pub fn base32(bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut acc: u32 = 0;
    let mut bits = 0;
    for &b in bytes {
        acc = (acc << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32[((acc >> bits) & 31) as usize] as char);
        }
        acc &= (1 << bits) - 1;
    }
    if bits > 0 {
        out.push(BASE32[((acc << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// Ports `liveCode`: the live code of one ticket for one window.
pub fn live_code(secret: &[u8], ticket_id: &str, window: i64) -> String {
    let message = format!(
        "{LIVE_CODE_PREFIX}{}:{window}",
        ticket_id.replace('-', "").to_uppercase()
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC takes a key of any length");
    mac.update(message.as_bytes());
    let digest = mac.finalize().into_bytes();
    format!("{message}:{}", base32(&digest[..MAC_BYTES]))
}

/// Ports `keyToBase64url`: a key as base64url without padding.
pub fn key_to_base64url(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = |i: usize| u32::from(chunk.get(i).copied().unwrap_or(0));
        let n = (b(0) << 16) | (b(1) << 8) | b(2);
        let chars = (chunk.len() * 8).div_ceil(6).min(4);
        for j in 0..chars {
            out.push(BASE64URL[((n >> (18 - 6 * j)) & 63) as usize] as char);
        }
    }
    out
}

/// Ports `keyFromBase64url`: the 32 bytes of a key, or `None` for anything but 43 characters of
/// `[A-Za-z0-9_-]`.
pub fn key_from_base64url(text: &str) -> Option<Vec<u8>> {
    if text.len() != 43 || !text.bytes().all(|c| BASE64URL.contains(&c)) {
        return None;
    }
    let mut bytes = Vec::with_capacity(32);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in text.bytes() {
        let v = BASE64URL.iter().position(|&x| x == c)? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push(((acc >> bits) & 0xff) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(bytes)
}

/// Ports `measureOffset` (FR-009, R3): the Backend's time minus the middle of the entry-key
/// request, both readings from `performance.now()`.
pub fn measure_offset(server_time_ms: f64, sent_ms: f64, received_ms: f64) -> f64 {
    server_time_ms - (sent_ms + received_ms) / 2.0
}

/// Ports `serverNow`: the Backend's time from `performance.now()` and the offset.
pub fn server_now(perf_now_ms: f64, offset: f64) -> f64 {
    perf_now_ms + offset
}

/// The window shown and the seconds until the next (`tickAt`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tick {
    pub window: i64,
    pub seconds_left: i64,
}

/// Ports `tickAt`: the window at the Backend's time `now`, and `ceil((next start - now) / 1000)`.
pub fn tick_at(now: f64) -> Tick {
    let window = window_at(now);
    let next = window_start_ms(window + 1) as f64;
    Tick {
        window,
        seconds_left: ((next - now) / 1000.0).ceil() as i64,
    }
}

/// "Changes in {n} s" (T10), plain text outside any live region.
pub fn countdown_text(seconds_left: i64) -> String {
    format!("Changes in {seconds_left} s")
}

/// T9: no answer.
pub const NO_CONNECTION: &str =
    "Can't show the live code without a connection. Use your printed ticket with photo ID.";
/// T10: no Web Crypto (cannot happen in the Rust app; kept for completeness).
pub const NO_CRYPTO: &str =
    "Can't show the live code in this browser. Use your printed ticket with photo ID.";

/// The entry-code page once both reads answered (`PageState`).
#[derive(Clone, Debug)]
pub enum EntryPage {
    /// 401 on either read: back through sign-in.
    SignIn,
    /// The code: the order, the key (in memory only, FR-010), and the clock's offset.
    Ok {
        order: Box<MyOrder>,
        key: Vec<u8>,
        offset: f64,
    },
    /// Neither read got an answer.
    Offline,
    /// "Ticket not found."
    Missing,
    /// A `409`: why the ticket can't be used.
    Refused(String),
    /// Anything else: the unreachable banner with Try again.
    Failed,
}

/// Ports `EntryCode`'s decision once both reads have answered (T9): `sent` and `received` are
/// `performance.now()` around the entry-key request.
pub fn entry_page(
    orders: Result<Vec<MyOrder>, ApiError>,
    key: Result<TicketEntryKey, ApiError>,
    ticket_id: &str,
    sent: f64,
    received: f64,
) -> EntryPage {
    // `Promise.all` rejects (no answer) when either fetch does, or when a 2xx body can't be
    // read as JSON (review finding 4: openapi-fetch's parse throws there too).
    let rejects =
        |e: Option<&ApiError>| matches!(e, Some(ApiError::Unreachable | ApiError::Decode(_)));
    if rejects(orders.as_ref().err()) || rejects(key.as_ref().err()) {
        return EntryPage::Offline;
    }
    let unauthorized = |e: Option<&ApiError>| e.and_then(ApiError::status) == Some(401);
    if unauthorized(orders.as_ref().err()) || unauthorized(key.as_ref().err()) {
        return EntryPage::SignIn;
    }
    let orders = match orders {
        // An unreadable 2xx is not OK either (no data).
        Ok(o) => o,
        Err(_) => return EntryPage::Failed,
    };
    let order = orders
        .into_iter()
        .find(|o| o.tickets.iter().any(|t| t.id.to_string() == ticket_id));
    match key {
        Err(e) if e.status() == Some(404) => EntryPage::Missing,
        _ if order.is_none() => EntryPage::Missing,
        Err(e) if e.status() == Some(409) => {
            let reason = e
                .details()
                .and_then(|d| d.get("reason"))
                .and_then(|r| r.as_str());
            EntryPage::Refused(match reason {
                Some("USED") => "This ticket was already used.".into(),
                Some("VOID") => "This ticket was cancelled and refunded.".into(),
                _ => match &e {
                    ApiError::Status(s) if s.enveloped => s.message.clone(),
                    _ => "This ticket can't be used.".into(),
                },
            })
        }
        Ok(k) => match (key_from_base64url(&k.key), order) {
            (Some(bytes), Some(order)) => EntryPage::Ok {
                order: Box::new(order),
                key: bytes,
                offset: measure_offset(k.server_time.timestamp_millis() as f64, sent, received),
            },
            _ => EntryPage::Failed,
        },
        Err(_) => EntryPage::Failed,
    }
}

/// `Date.parse(serverTime)`, for a server time given as text.
pub fn server_time_ms(text: &str) -> Option<f64> {
    parse_instant(text).map(|t| t.timestamp_millis() as f64)
}
