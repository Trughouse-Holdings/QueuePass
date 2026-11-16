//! Spec 040 (#175): the Rust Customer app's rules, natively testable (research R10, R11). The
//! `app` crate holds only views and browser glue; everything that can break quietly lives here.
//! Each module is owned by one implementer session (tasks.md "Parallel sessions"): B the copied
//! foundations, `filters`, `gallery`, `event_page`, and `load`; C `availability`, `holder_name`,
//! `buy`, `my_tickets`, `calendar`, `live_code`, and `qr`; D `hold_queue`, `reservation`, `mine`,
//! and `cart`.

pub mod api;
pub mod auth;
pub mod availability;
pub mod buy;
pub mod calendar;
pub mod cart;
pub mod event_page;
pub mod filters;
pub mod format;
pub mod gallery;
pub mod hold_queue;
pub mod holder_name;
pub mod live_code;
pub mod load;
pub mod mine;
pub mod money;
pub mod my_tickets;
pub mod qr;
pub mod reservation;
pub mod seating;
pub mod theme;
pub mod time;
