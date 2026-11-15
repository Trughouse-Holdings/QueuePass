//! Spec 037 (#163): the Rust Admin app's rules, natively testable (research R9). The `app`
//! crate holds only views and browser glue; everything that can break quietly lives here.

pub mod api;
pub mod auth;
pub mod editor;
pub mod export;
pub mod format;
pub mod forms;
pub mod money;
pub mod pages;
pub mod seating;
pub mod theme;
pub mod time;
