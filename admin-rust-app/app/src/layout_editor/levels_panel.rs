//! Spec 039 US2 (FR-015–FR-018; research R12; parity LE36–LE43), port of
//! `admin-app/src/layout-editor/LevelsPanel.tsx`: the layout's price levels, best first (the
//! order is the rank), each named beside its color with the seats in it, and the whole layout's
//! total. Each level is renamed in place, recolored from the 12 level colors, moved up or down,
//! or deleted after choosing the level its seats take; the last level can't be deleted.
//! Read-only, it is the list alone.

use admin_rust_core::{
    editor::{
        doc::EdLevel,
        state::{Action, level_name_problem, totals},
        view::{color_name, delete_level_label, seats_text, total_text},
    },
    seating::geometry::{LAYOUT_LIMITS, LEVEL_COLORS},
};
use leptos::{ev, prelude::*};

use super::{Editor, bind_value, new_id, use_editor};

#[component]
pub fn LevelsPanel(#[prop(optional)] read_only: bool) -> impl IntoView {
    let ed = use_editor();
    let edit = !read_only;
    let t = Memo::new(move |_| ed.doc.with(|d| totals(d)));
    let deleting: RwSignal<Option<String>> = RwSignal::new(None);
    let last_id = new_id();
    let one_level = Memo::new(move |_| ed.doc.with(|d| d.levels.len() <= 1));
    let last = last_id.clone();
    view! {
        <section class="card editor-panel" aria-labelledby="editor-levels-heading">
            <h2 id="editor-levels-heading">"Price levels"</h2>
            <ol class="editor-levels">
                <For
                    each=move || ed.doc.with(|d| d.levels.iter().map(|l| l.id.clone()).collect::<Vec<_>>())
                    key=|id| id.clone()
                    let:id
                >
                    <LevelItem id=id edit=edit t=t deleting=deleting last_id=last.clone()/>
                </For>
            </ol>
            <p class="editor-panel__totals">{move || total_text(&t.get())}</p>
            {move || (edit && one_level.get()).then(|| view! {
                <p id=last_id.clone() class="note">"The last level can't be deleted"</p>
            })}
            {edit.then(|| view! {
                <div class="form__actions">
                    <button
                        type="button"
                        class="btn"
                        disabled=move || ed.doc.with(|d| d.levels.len() >= LAYOUT_LIMITS.max_levels)
                        on:click=move |_| ed.dispatch(Action::AddLevel)
                    >
                        "Add level"
                    </button>
                </div>
                <p class="note">
                    "To give seats a level, select them, then choose it under Selection: Price level."
                </p>
            })}
        </section>
    }
}

/// One level's line: swatch, name, seats, and (editing) its controls.
#[component]
fn LevelItem(
    id: String,
    edit: bool,
    t: Memo<admin_rust_core::editor::state::Totals>,
    deleting: RwSignal<Option<String>>,
    last_id: String,
) -> impl IntoView {
    let ed = use_editor();
    let lid = id.clone();
    let level = Memo::new(move |_| {
        ed.doc
            .with(|d| d.levels.iter().find(|l| l.id == lid).cloned())
            .unwrap_or_else(|| EdLevel {
                id: lid.clone(),
                name: String::new(),
                color: "violet".into(),
            })
    });
    let lid = id.clone();
    let index = Memo::new(move |_| {
        ed.doc.with(|d| {
            (
                d.levels.iter().position(|l| l.id == lid).unwrap_or(0),
                d.levels.len(),
            )
        })
    });
    let lid = id.clone();
    let count = Memo::new(move |_| t.with(|t| t.level(&lid)));
    let name = move || level.with(|l| l.name.clone());
    view! {
        <li class="editor-levels__item">
            <span class="editor-levels__choose">
                <span
                    class=move || format!("level-swatch level-swatch--{}", level.with(|l| l.color.clone()))
                    aria-hidden="true"
                ></span>
                <span class="editor-levels__name">{name}</span>
            </span>
            <span class="editor-levels__count">{move || seats_text(count.get())}</span>
            {edit.then(|| {
                let up = id.clone();
                let down = id.clone();
                let del = id.clone();
                let open = id.clone();
                view! {
                    <div class="editor-levels__edit">
                        <LevelNameBox id=id.clone() level=level/>
                        <ColorSelect id=id.clone() level=level/>
                        <button
                            type="button"
                            class="btn btn--ghost"
                            aria-label=move || format!("Move {} up", name())
                            disabled=move || index.get().0 == 0
                            on:click=move |_| ed.dispatch(Action::MoveLevel { id: up.clone(), by: -1 })
                        >
                            "Up"
                        </button>
                        <button
                            type="button"
                            class="btn btn--ghost"
                            aria-label=move || format!("Move {} down", name())
                            disabled=move || { let (i, n) = index.get(); i + 1 == n }
                            on:click=move |_| ed.dispatch(Action::MoveLevel { id: down.clone(), by: 1 })
                        >
                            "Down"
                        </button>
                        <button
                            type="button"
                            class="btn btn--ghost"
                            aria-label=move || format!("Delete {}", name())
                            disabled=move || index.get().1 <= 1
                            aria-describedby=move || (index.get().1 <= 1).then(|| last_id.clone())
                            on:click=move |_| deleting.set(Some(del.clone()))
                        >
                            "Delete"
                        </button>
                        {move || (deleting.get().as_deref() == Some(open.as_str())).then(|| view! {
                            <DeleteLevel ed=ed level=level.get_untracked() count=count.get_untracked() deleting=deleting/>
                        })}
                    </div>
                }
            })}
        </li>
    }
}

/// The level's color, from the 12 level colors.
#[component]
fn ColorSelect(id: String, level: Memo<EdLevel>) -> impl IntoView {
    let ed = use_editor();
    view! {
        <select
            aria-label=move || format!("Color of {}", level.with(|l| l.name.clone()))
            on:change=move |e| ed.dispatch(Action::RecolorLevel {
                id: id.clone(),
                color: event_target_value(&e),
            })
        >
            {LEVEL_COLORS.iter().map(|c| view! {
                <option value=*c prop:selected=move || level.with(|l| l.color == *c)>
                    {color_name(c)}
                </option>
            }).collect_view()}
        </select>
    }
}

/// A level's name, typed in place and kept on Enter or leaving the box; a refusal beside it. As
/// the React box: no "same name" check (the reducer ignores the same name), and the problem stays
/// until the next keep (parity LE38).
#[component]
fn LevelNameBox(id: String, level: Memo<EdLevel>) -> impl IntoView {
    let ed = use_editor();
    let text = RwSignal::new(level.with_untracked(|l| l.name.clone()));
    let problem: RwSignal<Option<String>> = RwSignal::new(None);
    let focused = StoredValue::new(false);
    let problem_id = new_id();
    let name = Memo::new(move |_| level.with(|l| l.name.clone()));
    Effect::new(move |_| {
        let n = name.get();
        if !focused.get_value() {
            text.set(n);
        }
    });
    let keep = move || {
        let t = text.get_untracked();
        let p = level_name_problem(&ed.doc_now(), &id, &t);
        problem.set(p.clone());
        if p.is_none() {
            ed.dispatch(Action::RenameLevel {
                id: id.clone(),
                name: t,
            });
        }
    };
    let keep = StoredValue::new(keep);
    let input = NodeRef::new();
    bind_value(input, move || text.get());
    let pid = problem_id.clone();
    view! {
        <span class="editor-levels__rename">
            <input
                node_ref=input
                aria-label=move || format!("Name of {}", name.get())
                maxlength=LAYOUT_LIMITS.name_max_length.to_string()
                aria-invalid=move || problem.with(Option::is_some).then_some("true")
                aria-describedby=move || problem.with(Option::is_some).then(|| pid.clone())
                on:focus=move |_| focused.set_value(true)
                on:input=move |e| text.set(event_target_value(&e))
                on:keydown=move |e: ev::KeyboardEvent| {
                    if e.key() != "Enter" {
                        return;
                    }
                    e.prevent_default();
                    keep.with_value(|k| k());
                }
                on:blur=move |_| {
                    focused.set_value(false);
                    keep.with_value(|k| k());
                }
            />
            {move || problem.get().map(|p| view! {
                <span id=problem_id.clone() class="editor-field-error">{p}</span>
            })}
        </span>
    }
}

/// FR-015: the level a deleted level's seats take instead.
#[component]
fn DeleteLevel(
    ed: Editor,
    level: EdLevel,
    count: usize,
    deleting: RwSignal<Option<String>>,
) -> impl IntoView {
    let others: Vec<EdLevel> = ed.doc.with_untracked(|d| {
        d.levels
            .iter()
            .filter(|l| l.id != level.id)
            .cloned()
            .collect()
    });
    let to = RwSignal::new(others.first().map(|l| l.id.clone()).unwrap_or_default());
    let id = new_id();
    let level_id = level.id.clone();
    view! {
        <div role="group" aria-label=format!("Delete {}", level.name) class="editor-levels__delete">
            <div class="field">
                <label for=id.clone()>{delete_level_label(count)}</label>
                <select id=id on:change=move |e| to.set(event_target_value(&e))>
                    {others.into_iter().map(|l| {
                        let value = l.id.clone();
                        view! {
                            <option value=l.id.clone() prop:selected=move || to.with(|t| *t == value)>
                                {l.name}
                            </option>
                        }
                    }).collect_view()}
                </select>
            </div>
            <div class="form__actions">
                <button
                    type="button"
                    class="btn btn--primary"
                    on:click=move |_| {
                        ed.dispatch(Action::DeleteLevel {
                            id: level_id.clone(),
                            replacement: to.get_untracked(),
                        });
                        deleting.set(None);
                    }
                >
                    "Delete level"
                </button>
                <button type="button" class="btn" on:click=move |_| deleting.set(None)>
                    "Cancel"
                </button>
            </div>
        </div>
    }
}
