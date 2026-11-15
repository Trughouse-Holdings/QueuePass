//! Spec 037 User Story 6 (T075–T077, research R13–R15): the layout editor
//! (`admin-app/src/layout-editor/`), as Leptos views over `core::editor`. The views hold one
//! signal with the editor's state, dispatch `Action`s through `core::editor::state::reduce`, and
//! draw what `core` gives; every rule, message, and label is there (R14). Each view keeps the
//! React component's elements, classes, text, and accessible names, so the React app's
//! stylesheets apply (R8) and 039's browser journeys drive both apps (R10).

mod add_section;
mod commit_box;
mod level_picker;
mod levels_panel;
mod number_box;
mod sections_panel;
mod selection_panel;

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use admin_rust_core::editor::{
    doc::EditorDoc,
    state::{Action, EditorState, Selection, current_doc, init_state, is_dirty, reduce},
    view::DeleteRequest,
};
use leptos::{html, prelude::*};

/// The editor's state and what the views read of it. `Copy`: every view holds it.
#[derive(Clone, Copy)]
pub struct Editor {
    state: RwSignal<EditorState>,
    /// While a save is on its way the document takes no change but `load` and `saved` (React's
    /// `savingRef`, review B1).
    saving: StoredValue<bool>,
    /// `currentDoc`, changed only when the document is another one (compared by pointer).
    pub doc: Memo<Arc<EditorDoc>>,
    pub selection: Memo<Selection>,
    /// The section zoomed into, or none.
    pub zoomed: Memo<Option<String>>,
    pub dirty: Memo<bool>,
}

impl Editor {
    pub fn new(doc: EditorDoc) -> Editor {
        let state = RwSignal::new(init_state(doc));
        Editor {
            state,
            saving: StoredValue::new(false),
            doc: Memo::new_with_compare(
                move |_| state.with(|s| current_doc(s).clone()),
                |a, b| match (a, b) {
                    (Some(a), Some(b)) => !Arc::ptr_eq(a, b),
                    _ => true,
                },
            ),
            selection: Memo::new(move |_| state.with(|s| s.selection.clone())),
            zoomed: Memo::new(move |_| state.with(|s| s.zoomed.clone())),
            dirty: Memo::new(move |_| state.with(is_dirty)),
        }
    }

    /// One action through the reducer; ignored while saving unless it is `load` or `saved`.
    pub fn dispatch(&self, a: Action) {
        let saving = self.saving.try_get_value().unwrap_or(false);
        if saving && !matches!(a, Action::Saved { .. } | Action::Load { .. }) {
            return;
        }
        self.state.update(|s| *s = reduce(s, a));
    }

    pub fn set_saving(&self, saving: bool) {
        self.saving.set_value(saving);
    }

    /// Reads the whole state (the status line, Undo and Redo, the saved name).
    pub fn with_state<T>(&self, f: impl FnOnce(&EditorState) -> T) -> T {
        self.state.with(f)
    }

    /// The document now, untracked (for event handlers and saves).
    pub fn doc_now(&self) -> Arc<EditorDoc> {
        self.state.with_untracked(|s| current_doc(s).clone())
    }
}

/// The editor of the page, for the panels and the map.
pub fn use_editor() -> Editor {
    expect_context::<Editor>()
}

/// React's `useId`: an id unique on the page, for `label for` and `aria-describedby`.
pub fn new_id() -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    format!("le-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

/// What a delete asks for, done: a confirm first when it asks one (`window.confirm`).
pub fn run_request(ed: Editor, req: DeleteRequest) {
    match req {
        DeleteRequest::Nothing => {}
        DeleteRequest::Confirm { text, action } => {
            if window().confirm_with_message(&text).unwrap_or(false) {
                ed.dispatch(action);
            }
        }
        DeleteRequest::Do(action) => ed.dispatch(action),
    }
}

/// A controlled box's value, written to the element only when it differs from what the box
/// holds (React's input wrapper does the same, so a number box half typed, "-", is not wiped).
pub fn bind_value(node: NodeRef<html::Input>, value: impl Fn() -> String + 'static) {
    Effect::new(move |_| {
        let v = value();
        if let Some(el) = node.get()
            && el.value() != v
        {
            el.set_value(&v);
        }
    });
}

/// Whether a keyboard event comes from inside an input, textarea, or select.
pub fn in_text_box(e: &web_sys::Event) -> bool {
    use wasm_bindgen::JsCast;
    e.target()
        .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
        .and_then(|el| el.closest("input, textarea, select").ok().flatten())
        .is_some()
}

/// A select whose options are drawn again as the document changes: its value set after them,
/// as React's controlled `<select value>` keeps it.
pub fn bind_select(node: NodeRef<html::Select>, value: impl Fn() -> String + 'static) {
    Effect::new(move |_| {
        let v = value();
        if let Some(el) = node.get()
            && el.value() != v
        {
            el.set_value(&v);
        }
    });
}
