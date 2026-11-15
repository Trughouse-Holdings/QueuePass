//! Spec 037 research R15 (parity LE4): the unsaved-changes guard. The React app uses React
//! Router's `useBlocker` with `window.confirm("Leave without saving? Your changes will be lost.")`
//! and a `beforeunload` listener while the layout editor's document is dirty (039 R13);
//! `leptos_router` 0.8 has no blocker, so the app has this one:
//!
//! - in-app link clicks are seen in the capture phase, before the router's own listener, and a
//!   cancelled one is stopped there;
//! - Back and Forward (`popstate`) ask too; a cancelled one puts the editor's URL back;
//! - programmatic navigation goes through [`Guard::navigate`];
//! - `beforeunload` asks while dirty;
//! - the navigations 039 leaves unguarded (opening another layout after Save as new or Duplicate
//!   to edit, and the move after a new layout's first save) pass by [`Guard::pass_next`].

use leptos::{ev, prelude::*};
use leptos_router::NavigateOptions;
use wasm_bindgen::{JsCast, closure::Closure};

/// The question, word for word.
pub const LEAVE_TEXT: &str = "Leave without saving? Your changes will be lost.";

#[derive(Clone, Copy)]
pub struct Guard {
    dirty: RwSignal<bool>,
    /// The URL the guarded page is at, put back when the admin cancels Back or Forward.
    at: StoredValue<String>,
    /// One navigation passes unasked.
    pass: StoredValue<bool>,
}

fn here() -> String {
    let location = window().location();
    format!(
        "{}{}{}",
        location.pathname().unwrap_or_default(),
        location.search().unwrap_or_default(),
        location.hash().unwrap_or_default()
    )
}

impl Guard {
    /// Makes the guard, provides it, and installs its listeners. Call before the router starts,
    /// so the guard's `popstate` listener runs first.
    pub fn provide() -> Guard {
        let guard = Guard {
            dirty: RwSignal::new(false),
            at: StoredValue::new(String::new()),
            pass: StoredValue::new(false),
        };
        provide_context(guard);
        guard.listen();
        guard
    }

    /// Whether leaving may go ahead: yes when clean or passed, else the admin's answer.
    fn may_leave(&self) -> bool {
        if self.pass.get_value() {
            self.pass.set_value(false);
            return true;
        }
        if !self.dirty.get_untracked() {
            return true;
        }
        let ok = window().confirm_with_message(LEAVE_TEXT).unwrap_or(true);
        if ok {
            self.dirty.set(false);
        }
        ok
    }

    fn listen(&self) {
        let guard = *self;
        // Capture phase on the document: before the router's own click handling.
        let on_click =
            Closure::<dyn Fn(web_sys::MouseEvent)>::new(move |e: web_sys::MouseEvent| {
                if e.default_prevented() || e.button() != 0 || e.meta_key() || e.ctrl_key() {
                    return;
                }
                if e.shift_key() || e.alt_key() || !guard.dirty.get_untracked() {
                    return;
                }
                let path = e.composed_path();
                let anchor = (0..path.length())
                    .filter_map(|i| path.get(i).dyn_into::<web_sys::HtmlAnchorElement>().ok())
                    .next();
                let Some(a) = anchor else { return };
                if !a.target().is_empty() || a.has_attribute("download") {
                    return;
                }
                let origin = window().location().origin().unwrap_or_default();
                if !a.href().starts_with(&origin) {
                    return;
                }
                if !guard.may_leave() {
                    e.prevent_default();
                    e.stop_immediate_propagation();
                }
            });
        let options = web_sys::AddEventListenerOptions::new();
        options.set_capture(true);
        let _ = document().add_event_listener_with_callback_and_add_event_listener_options(
            "click",
            on_click.as_ref().unchecked_ref(),
            &options,
        );
        on_click.forget();

        // Registered before the router's, so a cancelled Back or Forward stops here.
        let on_pop = Closure::<dyn Fn(web_sys::Event)>::new(move |e: web_sys::Event| {
            if !guard.dirty.get_untracked() && !guard.pass.get_value() {
                return;
            }
            if !guard.may_leave() {
                e.stop_immediate_propagation();
                if let Ok(history) = window().history() {
                    let _ = history.push_state_with_url(
                        &wasm_bindgen::JsValue::NULL,
                        "",
                        Some(&guard.at.get_value()),
                    );
                }
            }
        });
        let _ =
            window().add_event_listener_with_callback("popstate", on_pop.as_ref().unchecked_ref());
        on_pop.forget();

        let _ = window_event_listener(ev::beforeunload, move |e| {
            if guard.dirty.get_untracked() {
                e.prevent_default();
                e.set_return_value(LEAVE_TEXT);
            }
        });
    }

    /// The guarded page's document has (or no longer has) unsaved changes.
    pub fn set_dirty(&self, dirty: bool) {
        if dirty && !self.dirty.get_untracked() {
            self.at.set_value(here());
        }
        if self.dirty.get_untracked() != dirty {
            self.dirty.set(dirty);
        }
    }

    /// Lets the next navigation through unasked (the unguarded moves of 039).
    pub fn pass_next(&self) {
        self.pass.set_value(true);
    }

    /// Navigates in the app with the page's `use_navigate()`, asking first while dirty.
    pub fn navigate(
        &self,
        navigate: &impl Fn(&str, NavigateOptions),
        to: &str,
        options: NavigateOptions,
    ) {
        if self.may_leave() {
            navigate(to, options);
        }
    }
}

/// The guard, from any view under the app.
pub fn use_guard() -> Guard {
    expect_context::<Guard>()
}
