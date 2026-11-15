//! Spec 039 FR-019, FR-020, FR-023, FR-024 (research R9, R15, R16; parity LE34, LE67–LE79),
//! port of `admin-app/src/layout-editor/SaveBar.tsx`: Save, "Saved", and a refusal placed where it
//! is: a `LAYOUT_FILE_INVALID` problem selects the section its path points at, a name refusal goes
//! beside the name box. A refused save never changes the document. Before sending, the warnings
//! that do not block a save (overlapping sections, levels with no seats) are listed with Save
//! anyway and Go back, the overlapping sections outlined on the map. After `LAYOUT_CHANGED` or
//! `LAYOUT_IN_USE` the work can be kept as a new layout, and after `LAYOUT_CHANGED` reloaded.

use admin_rust_core::{
    editor::save::{
        BEFORE_SAVING, CANT_SAVE_YET, COULD_NOT_SAVE, RELOAD, Refusal, SaveCheck, before_save,
        copy_name, refusal_effects,
    },
    seating::geometry::LAYOUT_LIMITS,
};
use leptos::{ev, prelude::*, task::spawn_local};

use super::{bind_value, new_id, page::PageCtx};
use admin_rust_core::editor::state::Action;

#[derive(Clone, PartialEq)]
enum Status {
    Idle,
    Saving,
    Saved,
    Missing(Vec<&'static str>),
    Warnings(Vec<String>),
    Refused(Refusal),
}

#[component]
pub fn SaveBar(
    ctx: PageCtx,
    /// The message beside Layout name, if any.
    name_problem: RwSignal<Option<String>>,
    /// Review B4: the editor opened on a layout it has just made, so it starts saved.
    initially_saved: bool,
) -> impl IntoView {
    let ed = ctx.ed;
    let status = RwSignal::new(if initially_saved {
        Status::Saved
    } else {
        Status::Idle
    });
    let copy: RwSignal<Option<String>> = RwSignal::new(None);
    let copy_error: RwSignal<Option<String>> = RwSignal::new(None);
    let copy_busy = RwSignal::new(false);
    let copy_id = new_id();
    let copy_error_id = new_id();
    let can_reload = ctx.layout_id.get_value().is_some();
    // Why Save can't be used now (shown beside it, with Reload), or nothing.
    let blocked = Memo::new(move |_| ctx.unread.get());

    // "Saved" lasts until the next change.
    Effect::new(move |_| {
        if ed.dirty.get() && status.with_untracked(|s| *s == Status::Saved) {
            status.set(Status::Idle);
        }
    });

    let save = move |anyway: bool| {
        let doc = ed.doc_now();
        match before_save(&doc, anyway) {
            SaveCheck::Missing(parts) => status.set(Status::Missing(parts)),
            SaveCheck::Warnings { messages, sections } => {
                ctx.warned.set(sections);
                status.set(Status::Warnings(messages));
            }
            SaveCheck::Send { warned } => {
                if let Some(w) = warned {
                    ctx.warned.set(w);
                }
                status.set(Status::Saving);
                name_problem.set(None);
                spawn_local(async move {
                    match ctx.save().await {
                        Ok(()) => status.set(Status::Saved),
                        Err(e) => {
                            let refusal = Refusal::from_error(&e);
                            let effects = refusal_effects(&refusal);
                            status.set(Status::Refused(refusal));
                            if let Some(p) = effects.name_problem {
                                name_problem.set(Some(p));
                            }
                            if let Some(i) = effects.select_section
                                && let Some(id) = ed
                                    .doc
                                    .try_with_untracked(|d| d.sections.get(i).map(|s| s.id.clone()))
                                    .flatten()
                            {
                                ed.dispatch(Action::SelectSections { ids: vec![id] });
                            }
                        }
                    }
                });
            }
        }
    };

    let reload = move || {
        if !can_reload || !window().confirm_with_message(RELOAD).unwrap_or(false) {
            return;
        }
        spawn_local(async move {
            match ctx.reload().await {
                Ok(()) => {
                    status.set(Status::Idle);
                    copy.set(None);
                }
                Err(e) => status.set(Status::Refused(Refusal::from_error(&e))),
            }
        });
    };

    let save_copy = move |name: String| {
        copy_error.set(None);
        copy_busy.set(true);
        spawn_local(async move {
            if let Err(e) = ctx.save_as_new(name.trim().to_string()).await {
                copy_error.set(Some(Refusal::from_error(&e).message));
            }
            copy_busy.set(false);
        });
    };

    let copy_input = NodeRef::new();
    bind_value(copy_input, move || copy.get().unwrap_or_default());
    let cid = copy_id.clone();
    let ceid = copy_error_id.clone();
    let ceid2 = copy_error_id.clone();

    view! {
        <div class="editor-save">
            <div class="editor-save__actions">
                <button
                    type="button"
                    class="btn btn--primary"
                    disabled=move || status.with(|s| *s == Status::Saving) || blocked.get()
                    on:click=move |_| save(false)
                >
                    {move || if status.with(|s| *s == Status::Saving) { "Saving…" } else { "Save" }}
                </button>
                {move || (status.with(|s| *s == Status::Saved) && !blocked.get()).then(|| view! {
                    <span class="editor-save__saved">"Saved"</span>
                })}
            </div>
            {move || blocked.get().then(|| view! {
                <div role="alert" class="banner banner--conflict">
                    <div class="banner__body">
                        <strong>{admin_rust_core::editor::save::UNREAD}</strong>
                        {can_reload.then(|| view! {
                            <div class="form__actions">
                                <button type="button" class="btn" on:click=move |_| reload()>
                                    "Reload"
                                </button>
                            </div>
                        })}
                    </div>
                </div>
            })}
            {move || match status.get() {
                Status::Missing(parts) => Some(view! {
                    <div role="alert" class="banner banner--error">
                        <div class="banner__body">
                            <strong>{CANT_SAVE_YET}</strong>
                            <ul>{parts.into_iter().map(|p| view! { <li>{p}</li> }).collect_view()}</ul>
                        </div>
                    </div>
                }.into_any()),
                Status::Warnings(messages) => Some(view! {
                    <div role="group" aria-label=BEFORE_SAVING class="banner banner--conflict">
                        <div class="banner__body">
                            <strong>{BEFORE_SAVING}</strong>
                            <ul>{messages.into_iter().map(|m| view! { <li>{m}</li> }).collect_view()}</ul>
                            <div class="form__actions">
                                <button type="button" class="btn btn--primary" on:click=move |_| save(true)>
                                    "Save anyway"
                                </button>
                                <button type="button" class="btn" on:click=move |_| status.set(Status::Idle)>
                                    "Go back"
                                </button>
                            </div>
                        </div>
                    </div>
                }.into_any()),
                Status::Refused(r) => {
                    let offers_copy = r.offers_copy();
                    let offers_reload = r.offers_reload() && can_reload;
                    Some(view! {
                        <RefusalBanner refusal=r/>
                        {offers_copy.then(|| view! {
                            <div class="form__actions">
                                {move || copy.with(Option::is_none).then(|| view! {
                                    <button
                                        type="button"
                                        class="btn"
                                        on:click=move |_| copy.set(Some(copy_name(&ed.doc_now())))
                                    >
                                        "Save as a new layout"
                                    </button>
                                })}
                                {offers_reload.then(|| view! {
                                    <button type="button" class="btn" on:click=move |_| reload()>
                                        "Reload"
                                    </button>
                                })}
                            </div>
                        })}
                    }.into_any())
                }
                Status::Idle | Status::Saving | Status::Saved => None,
            }}
            {move || copy.with(Option::is_some).then(|| {
                let (cid, ceid, ceid2) = (cid.clone(), ceid.clone(), ceid2.clone());
                view! {
                    <form
                        class="form"
                        aria-label="Save as a new layout"
                        on:submit=move |e: ev::SubmitEvent| {
                            e.prevent_default();
                            save_copy(copy.get_untracked().unwrap_or_default());
                        }
                    >
                        <div class="field">
                            <label for=cid.clone()>"Name of the new layout"</label>
                            <input
                                node_ref=copy_input
                                id=cid
                                maxlength=LAYOUT_LIMITS.name_max_length.to_string()
                                aria-invalid=move || copy_error.with(Option::is_some).then_some("true")
                                aria-describedby=move || copy_error.with(Option::is_some).then(|| ceid.clone())
                                on:input=move |e| copy.set(Some(event_target_value(&e)))
                            />
                            {move || copy_error.get().map(|m| view! {
                                <span id=ceid2.clone() class="editor-field-error">{m}</span>
                            })}
                        </div>
                        <div class="form__actions">
                            <button type="submit" class="btn btn--primary" disabled=move || copy_busy.get()>
                                "Save new layout"
                            </button>
                            <button type="button" class="btn" on:click=move |_| copy.set(None)>
                                "Cancel"
                            </button>
                        </div>
                    </form>
                }
            })}
        </div>
    }
}

/// The refusal in the Backend's words, with each problem (LE76).
#[component]
fn RefusalBanner(refusal: Refusal) -> impl IntoView {
    let more = refusal.more_text();
    let problems = refusal.problems.clone();
    view! {
        <div role="alert" class="banner banner--error" data-code=refusal.code.clone()>
            <div class="banner__body">
                <strong>{COULD_NOT_SAVE}</strong>
                <p>{refusal.message.clone()}</p>
                {(!problems.is_empty()).then(|| view! {
                    <ul>
                        {problems.into_iter().map(|p| view! { <li>{p.message}</li> }).collect_view()}
                        {more.map(|m| view! { <li>{m}</li> })}
                    </ul>
                })}
            </div>
        </div>
    }
}
