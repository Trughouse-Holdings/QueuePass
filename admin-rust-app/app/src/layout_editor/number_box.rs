//! Spec 039 FR-011, FR-026 (parity LE51), port of `admin-app/src/layout-editor/NumberBox.tsx`: a
//! number typed into the Selection panel. What is typed is kept while the box has focus, and sent
//! on Enter or when focus leaves (a number on its way, "1" of "100", is never applied); the box
//! shows the value again when it changes elsewhere or focus leaves.

use admin_rust_core::editor::view::{number_to_send, shown};
use leptos::{ev, prelude::*};
use wasm_bindgen::JsCast;

use super::{bind_value, new_id};

fn box_value(e: &web_sys::Event) -> String {
    e.target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
        .map(|el| el.value())
        .unwrap_or_default()
}

#[component]
pub fn NumberBox(
    label: &'static str,
    #[prop(into)] value: Signal<f64>,
    on_value: Callback<f64>,
    min: f64,
    max: f64,
) -> impl IntoView {
    let id = new_id();
    let text = RwSignal::new(shown(value.get_untracked()));
    let focused = StoredValue::new(false);
    let send = move |raw: &str| {
        if let Some(n) = number_to_send(raw, value.get_untracked()) {
            on_value.run(n);
        }
    };
    Effect::new(move |_| {
        let v = value.get();
        if !focused.get_value() {
            text.set(shown(v));
        }
    });
    let input = NodeRef::new();
    bind_value(input, move || text.get());
    view! {
        <div class="field editor-number">
            <label for=id.clone()>{label}</label>
            <input
                node_ref=input
                id=id
                type="number"
                inputmode="decimal"
                step="1"
                min=shown(min)
                max=shown(max)
                on:focus=move |_| focused.set_value(true)
                on:blur=move |e: ev::FocusEvent| {
                    focused.set_value(false);
                    send(&box_value(&e));
                    text.set(shown(value.get_untracked()));
                }
                on:keydown=move |e: ev::KeyboardEvent| {
                    if e.key() != "Enter" {
                        return;
                    }
                    e.prevent_default();
                    send(&box_value(&e));
                }
                on:input=move |e| text.set(event_target_value(&e))
            />
        </div>
    }
}
