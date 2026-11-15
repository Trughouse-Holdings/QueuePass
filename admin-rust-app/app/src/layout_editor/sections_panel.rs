//! Spec 039 FR-011, FR-017, FR-026 (parity LE12, LE63), port of
//! `admin-app/src/layout-editor/SectionsPanel.tsx`: the Sections panel. The totals ("2 sections ·
//! 348 seats", the seats left under 30,000), every section as a button that selects it (Shift
//! adds), and Add section with the block generator.

use admin_rust_core::editor::{
    doc::{Place, SectionGenerator},
    state::{Action, totals},
    view::{section_item, sections_left, sections_totals},
};
use leptos::{ev, prelude::*};

use super::{add_section::AddSectionForm, use_editor};

#[component]
pub fn SectionsPanel(
    /// The middle of the visible map, where a new section goes (FR-007).
    center: StoredValue<Place>,
) -> impl IntoView {
    let ed = use_editor();
    let adding = RwSignal::new(false);
    let t = Memo::new(move |_| ed.doc.with(|d| totals(d)));
    let on_generate = Callback::new(
        move |(name, values, level_id): (String, SectionGenerator, String)| {
            ed.dispatch(Action::AddSection {
                name,
                values,
                level_id,
                at: center.get_value(),
            });
            adding.set(false);
        },
    );
    let on_cancel = Callback::new(move |()| adding.set(false));
    view! {
        <section class="card editor-panel" aria-labelledby="editor-sections-heading">
            <h2 id="editor-sections-heading">"Sections"</h2>
            <p class="editor-panel__totals">{move || sections_totals(&t.get())}</p>
            <p class="note">{move || sections_left(&t.get())}</p>
            {move || ed.doc.with(|d| {
                (!d.sections.is_empty()).then(|| view! {
                    <ul class="editor-list" aria-label="Sections of the layout">
                        {d.sections.iter().map(|s| {
                            let id = s.id.clone();
                            let pressed = id.clone();
                            view! {
                                <li>
                                    <button
                                        type="button"
                                        class="editor-list__item"
                                        aria-pressed=move || ed.selection.with(|sel| {
                                            sel.section_ids().contains(&pressed).to_string()
                                        })
                                        on:click=move |e: ev::MouseEvent| {
                                            ed.dispatch(if e.shift_key() {
                                                Action::ToggleSection { id: id.clone() }
                                            } else {
                                                Action::SelectSections { ids: vec![id.clone()] }
                                            });
                                        }
                                    >
                                        {section_item(s)}
                                    </button>
                                </li>
                            }
                        }).collect_view()}
                    </ul>
                })
            })}
            {move || if adding.get() {
                // The level a new section takes unless Add section says otherwise: the best.
                let level_id = ed.doc.with_untracked(|d| {
                    d.levels.first().map(|l| l.id.clone()).unwrap_or_default()
                });
                view! {
                    <AddSectionForm level_id=level_id on_generate=on_generate on_cancel=on_cancel/>
                }
                .into_any()
            } else {
                view! {
                    <div class="form__actions">
                        <button type="button" class="btn" on:click=move |_| adding.set(true)>
                            "Add section"
                        </button>
                    </div>
                }
                .into_any()
            }}
        </section>
    }
}
