//! Parity P5 (spec 017 FR-001 to FR-003): the Name on tickets field of the general-admission form
//! (`GetTickets.tsx`' `nameField`) and the Cart (`Cart.tsx`, the same markup), from
//! `core::holder_name::HolderNameField`: the message shows once the field was left, linked to it
//! for screen readers.

use customer_rust_core::holder_name::{HOLDER_NAME_HINT, HolderNameField as Field};
use leptos::prelude::*;

/// `div.holder-name` with its label, input, hint, and the message once the field was left.
/// `on_input` runs after each change (the general form starts a new purchase on it).
#[component]
pub fn HolderNameField(
    field: RwSignal<Field>,
    #[prop(optional)] on_input: Option<Callback<()>>,
) -> impl IntoView {
    let error = Memo::new(move |_| field.with(|f| f.error()));
    view! {
        <div class="holder-name">
            <label for="holder-name">"Name on tickets"</label>
            <input
                id="holder-name"
                type="text"
                prop:value=move || field.with(|f| f.value().to_string())
                autocomplete="name"
                aria-describedby=move || field.with(|f| f.described_by())
                aria-invalid=move || error.with(|e| e.is_some()).then_some("true")
                on:input=move |ev| {
                    field.update(|f| f.set(event_target_value(&ev)));
                    if let Some(cb) = on_input {
                        cb.run(());
                    }
                }
                on:blur=move |_| field.update(|f| f.leave())
            />
            <p id="holder-name-hint" class="note">
                {HOLDER_NAME_HINT}
            </p>
            {move || {
                error
                    .get()
                    .map(|message| {
                        view! {
                            <p id="holder-name-error" class="banner banner--error">
                                {message}
                            </p>
                        }
                    })
            }}
        </div>
    }
}
