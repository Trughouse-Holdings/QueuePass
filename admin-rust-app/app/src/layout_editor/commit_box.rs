//! Spec 039 FR-010, FR-012 (parity LE52), port of `admin-app/src/layout-editor/CommitBox.tsx`:
//! a name or label typed in place and kept on Enter or on leaving the box, if `check` finds
//! nothing wrong; otherwise its problem is shown beside the box and nothing changes. The box
//! follows the value when it changes elsewhere.

use admin_rust_core::editor::view::{CommitOutcome, commit_outcome};
use leptos::{ev, prelude::*};

use super::{bind_value, new_id};

#[component]
pub fn CommitBox(
    label: &'static str,
    #[prop(into)] value: Signal<String>,
    max_length: usize,
    /// The box's problem rule (`sectionNameProblem`, …).
    check: Callback<String, Option<String>>,
    on_commit: Callback<String>,
) -> impl IntoView {
    let id = new_id();
    let problem_id = new_id();
    let text = RwSignal::new(value.get_untracked());
    let problem: RwSignal<Option<String>> = RwSignal::new(None);
    let focused = StoredValue::new(false);
    Effect::new(move |_| {
        let v = value.get();
        if !focused.get_value() {
            text.set(v);
        }
        problem.set(None);
    });
    let keep = move || {
        let t = text.get_untracked();
        match commit_outcome(&t, &value.get_untracked(), |s| check.run(s.to_string())) {
            CommitOutcome::Same => problem.set(None),
            CommitOutcome::Problem(p) => problem.set(Some(p)),
            CommitOutcome::Commit(t) => {
                problem.set(None);
                on_commit.run(t);
            }
        }
    };
    let input = NodeRef::new();
    bind_value(input, move || text.get());
    let pid = problem_id.clone();
    view! {
        <div class="field">
            <label for=id.clone()>{label}</label>
            <input
                node_ref=input
                id=id
                maxlength=max_length.to_string()
                aria-invalid=move || problem.with(Option::is_some).then_some("true")
                aria-describedby=move || problem.with(Option::is_some).then(|| pid.clone())
                on:focus=move |_| focused.set_value(true)
                on:input=move |e| text.set(event_target_value(&e))
                on:keydown=move |e: ev::KeyboardEvent| {
                    if e.key() != "Enter" {
                        return;
                    }
                    e.prevent_default();
                    keep();
                }
                on:blur=move |_| {
                    focused.set_value(false);
                    keep();
                }
            />
            {move || problem.get().map(|p| view! {
                <span id=problem_id.clone() class="editor-field-error">{p}</span>
            })}
        </div>
    }
}
