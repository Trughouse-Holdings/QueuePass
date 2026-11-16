//! Spec 040: the components the pages use, with the React Customer app's elements and classes so
//! the shared stylesheets apply (research R6). Each file is owned by one implementer session
//! (tasks.md "Parallel sessions").

pub mod add_to_calendar;
pub mod address_link;
pub mod banners;
pub mod event_card;
pub mod event_filters;
pub mod gallery;
pub mod get_tickets;
pub mod hold_countdown;
pub mod holder_name_field;
pub mod link;
pub mod order_confirmation;
pub mod ticket_qr;

pub use address_link::AddressLink;
pub use banners::{ServiceUnreachable, WrongRole};
pub use link::{AppLink, NavLink};
