//! Spec 037 T052–T056: what the event form's views share. The form's state is one
//! `core::forms::event::EventFormState`, held in a local signal (its pictures are browser files);
//! every change goes through [`edit`], which refreshes the polite live region as the React form's
//! `form-status` effect does.

use std::cell::RefCell;

use admin_rust_core::forms::{event::EventFormState, images::ImageFile};
use leptos::prelude::*;
use wasm_bindgen::JsCast;

/// A picture chosen in the browser.
#[derive(Clone, Debug, PartialEq)]
pub struct BrowserFile(pub web_sys::File);

impl ImageFile for BrowserFile {
    fn name(&self) -> String {
        self.0.name()
    }
}

/// The event form's state.
pub type FormSignal = RwSignal<EventFormState<BrowserFile>, LocalStorage>;

/// One change to the form, then the live region (`refresh_live`).
pub fn edit(state: FormSignal, change: impl FnOnce(&mut EventFormState<BrowserFile>)) {
    state.update(|s| {
        change(s);
        s.refresh_live();
    });
}

/// One change that returns something, then the live region; `None` once the form is gone.
pub fn edit_with<T>(
    state: FormSignal,
    change: impl FnOnce(&mut EventFormState<BrowserFile>) -> T,
) -> Option<T> {
    state.try_update(|s| {
        let out = change(s);
        s.refresh_live();
        out
    })
}

/// Focuses the control with this id on the next frame, after the form has rendered.
pub fn focus_later(id: Option<String>) {
    let Some(id) = id else { return };
    request_animation_frame(move || {
        if let Some(el) = document()
            .get_element_by_id(&id)
            .and_then(|e| e.dyn_into::<web_sys::HtmlElement>().ok())
        {
            let _ = el.focus();
        }
    });
}

/// `hint(id, messages)` of `EventForm.tsx` and `SeatingSection.tsx`: the messages beside a field,
/// `role="alert"`, rebuilt only when they change.
pub fn hint(
    id: impl Fn() -> String + Send + Sync + 'static,
    messages: impl Fn() -> Vec<String> + Send + Sync + 'static,
) -> impl IntoView {
    let shown = Memo::new(move |_| messages());
    move || {
        let messages = shown.get();
        (!messages.is_empty()).then(|| {
            let id = id();
            view! {
                <span class="field__hint" role="alert" id=id.clone() data-testid=id>
                    {messages.join(" ")}
                </span>
            }
        })
    }
}

/// What the form hands its edit form after creating an event whose pictures were not all added
/// (spec 014 research R9): the React app passes it in router state, read once; this is that
/// hand-over, taken once by the edit form of `path`.
pub struct PendingHandOver {
    pub path: String,
    pub files: Vec<BrowserFile>,
    pub notice: String,
}

thread_local! {
    static PENDING: RefCell<Option<PendingHandOver>> = const { RefCell::new(None) };
}

/// Leaves the pictures not yet added for the edit form at `path`.
pub fn hand_over(pending: PendingHandOver) {
    PENDING.with(|p| *p.borrow_mut() = Some(pending));
}

/// The pictures handed to the edit form at `path`, once.
pub fn take_hand_over(path: &str) -> Option<PendingHandOver> {
    PENDING.with(|p| {
        let mut slot = p.borrow_mut();
        if slot.as_ref().is_some_and(|h| h.path == path) {
            slot.take()
        } else {
            None
        }
    })
}
