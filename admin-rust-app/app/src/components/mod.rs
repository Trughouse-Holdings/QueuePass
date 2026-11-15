//! Spec 037: the small components every page uses, with the React Admin app's elements and
//! classes so the shared stylesheets apply (research R8).

pub mod banners;
pub mod link;

pub use banners::{ErrorBanner, Notice, NoticeKind, ServiceUnreachable, SuccessState, WrongRole};
pub use link::{AppLink, NavLink};
