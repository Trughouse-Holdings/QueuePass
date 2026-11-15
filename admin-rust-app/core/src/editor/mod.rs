//! Spec 037: the layout editor (research R14). A pure port of the React editor's rules
//! (`admin-app/src/layout-editor/`): the document ([`doc`]), the reducer with its history
//! ([`state`]), the overlap warnings ([`overlap`]), and the pieces its components keep inside
//! them: the block generator's form ([`draft`]), the save bar ([`save`]), and the map, panels,
//! guide, and page ([`view`]). The `app` crate's Leptos editor holds one `EditorState`,
//! dispatches `Action`s, and draws what these give.

pub mod doc;
pub mod draft;
pub(crate) mod js;
pub mod overlap;
pub mod save;
pub mod state;
pub mod view;
