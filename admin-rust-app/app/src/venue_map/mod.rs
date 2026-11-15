//! Spec 037 research R13: the shared venue map (`packages/shared/src/web/venue-map/`) as Leptos
//! views, drawn as inline SVG with the React components' elements, attributes, and classes.

pub mod layout_preview;
pub mod legend;
pub mod pan_zoom;
pub mod section_view;
#[allow(clippy::module_inception)]
pub mod venue_map;

pub use layout_preview::LayoutPreview;
