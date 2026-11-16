//! Spec 040 T048 (parity M14; research R4's new work): the `withMine` rules of the shared seat
//! stream (`packages/shared/src/web/use-seat-stream.ts` lines 123–163), which neither of the Rust
//! Admin app's stream files has, and how `GetTickets.tsx` uses them (its `onSnapshot`):
//!
//! - the customer's reservations (`GET /me/reservations`, every event) are read on open;
//! - again 200 ms after a change that touches one of their seats or makes any seat held (the app
//!   waits, restarting the wait on each such change);
//! - only the latest request's answer counts (`mineRequest`): an older one may predate the
//!   page's own write;
//! - the list carries when it was asked (`mineAt`), so the page ignores one asked before its
//!   last hold or release ([`MineReads::fresh_since`]);
//! - each venue map after the first (a reconnect, maybe after a price or layout change) reads the
//!   availability and the reservations again.

use crate::{
    reservation::Reservation,
    seating::map_state::{SeatMapChange, SeatState},
};

/// How long after a change touching the customer's seats they are read again.
pub const MINE_REREAD_MS: u64 = 200;

/// One read of the reservations: which request it is and when it was asked (monotonic ms).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MineRequest {
    id: u64,
    at: f64,
}

/// The customer's reservations as last read, and the reads' bookkeeping.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MineReads {
    request: u64,
    list: Option<Vec<Reservation>>,
    at: f64,
    maps_seen: u32,
}

impl MineReads {
    pub fn new() -> Self {
        Self::default()
    }

    /// A read to send now, asked at `now`.
    pub fn request(&mut self, now: f64) -> MineRequest {
        self.request += 1;
        MineRequest {
            id: self.request,
            at: now,
        }
    }

    /// The answer to `request`: kept only if it is the latest request's. Returns whether kept.
    pub fn on_answer(&mut self, request: MineRequest, list: Vec<Reservation>) -> bool {
        if request.id != self.request {
            return false;
        }
        self.list = Some(list);
        self.at = request.at;
        true
    }

    /// The list as last read (`None` before the first answer).
    pub fn list(&self) -> Option<&[Reservation]> {
        self.list.as_deref()
    }

    /// When the list shown was asked.
    pub fn at(&self) -> f64 {
        self.at
    }

    /// The list, unless it was asked before `last_write`, the page's last hold or release
    /// (`live.mineAt < lastWrite.current` in `GetTickets.tsx`).
    pub fn fresh_since(&self, last_write: f64) -> Option<&[Reservation]> {
        self.list().filter(|_| self.at >= last_write)
    }

    /// Whether `change` calls for a read in [`MINE_REREAD_MS`]: it touches one of the customer's
    /// reserved seats of its event, or makes any seat held.
    pub fn wants_reread(&self, change: &SeatMapChange) -> bool {
        let mine = self.list.as_deref().unwrap_or_default();
        let touches_mine = change.changes.iter().any(|c| {
            mine.iter().any(|r| {
                r.event_id == change.event_id
                    && r.seats
                        .iter()
                        .any(|s| s.section_id == c.section_id && s.row == c.row && s.seat == c.seat)
            })
        });
        touches_mine
            || change
                .changes
                .iter()
                .any(|c| c.state == SeatState::Reserved)
    }

    /// A venue map arrived (`onSnapshot`): `true` for each after the first, which reads the
    /// availability and the reservations again.
    pub fn on_map(&mut self) -> bool {
        self.maps_seen += 1;
        self.maps_seen > 1
    }
}
