//! Spec 037: the small components every page uses, with the React Admin app's elements and
//! classes so the shared stylesheets apply (research R8).

pub mod address_link;
pub mod banners;
pub mod event_form;
pub mod export_menu;
pub mod images_field;
pub mod layouts_card;
pub mod link;
pub mod seating_section;
pub mod section_lines;

pub use address_link::AddressLink;
pub use banners::{ErrorBanner, Notice, NoticeKind, ServiceUnreachable, SuccessState, WrongRole};
pub use link::{AppLink, NavLink};
