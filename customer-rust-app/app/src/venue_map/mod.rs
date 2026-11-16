//! Parity M4–M8 (`packages/shared/src/web/venue-map/`): the venue map, copied from the Rust Admin
//! app's (spec 040 R4) without its layout preview, with the Customer's Sections list and skip link
//! (task T049).

pub mod legend;
pub mod pan_zoom;
pub mod section_view;
pub mod sections_list;
#[allow(clippy::module_inception)]
pub mod venue_map;

pub use sections_list::SectionsList;
pub use venue_map::VenueMap;
