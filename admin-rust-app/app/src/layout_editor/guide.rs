//! Spec 039 US1 (parity LE10, LE11), port of `admin-app/src/layout-editor/Guide.tsx`: how a
//! layout is made, on the editor itself. The steps open on a new layout and tick off as each is
//! done; once the first section is made they fold away (they open again on request). One line
//! under them says what can be done with what is selected now. Neither is shown read-only.

use admin_rust_core::editor::view::{guide_open_after, guide_open_at_start, guide_steps, hint_for};
use leptos::prelude::*;
use wasm_bindgen::JsCast;

use super::use_editor;

#[component]
pub fn Guide(#[prop(into)] zoomed: Signal<bool>) -> impl IntoView {
    let ed = use_editor();
    let has_sections = Memo::new(move |_| ed.doc.with(|d| !d.sections.is_empty()));
    let open = RwSignal::new(ed.doc.with_untracked(|d| guide_open_at_start(d)));
    // The first section folds the steps away; later ones leave them as the admin left them.
    Effect::new(move |had: Option<bool>| {
        let has = has_sections.get();
        if let Some(had) = had
            && had != has
        {
            let next = guide_open_after(open.get_untracked(), had, has);
            if next != open.get_untracked() {
                open.set(next);
            }
        }
        has
    });
    view! {
        <div class="editor-guide">
            <details
                class="editor-guide__steps"
                aria-label="How to make a layout"
                prop:open=move || open.get()
                on:toggle=move |e| {
                    if let Some(d) = e
                        .current_target()
                        .and_then(|t| t.dyn_into::<web_sys::HtmlDetailsElement>().ok())
                    {
                        open.set(d.open());
                    }
                }
            >
                <summary>"How to make a layout"</summary>
                <ol>
                    {move || ed.doc.with(|d| {
                        guide_steps(d)
                            .into_iter()
                            .map(|s| {
                                if s.done {
                                    view! {
                                        <li class="editor-guide__step--done">
                                            <span class="visually-hidden">"Done: "</span>
                                            {s.text}
                                        </li>
                                    }
                                    .into_any()
                                } else {
                                    view! { <li>{s.text}</li> }.into_any()
                                }
                            })
                            .collect_view()
                    })}
                </ol>
            </details>
            <p class="editor-guide__hint" data-testid="editor-hint">
                {move || ed.selection.with(|s| hint_for(s, zoomed.get(), has_sections.get()))}
            </p>
        </div>
    }
}
