//! Spec 039 US2 (FR-016, FR-018; parity LE48), port of
//! `admin-app/src/layout-editor/LevelPicker.tsx`: the selection's price level, chosen where the
//! selection is shown. It shows the level the selected sections, rows or seats have ("Mixed" when
//! they differ); choosing a level gives it to them at once (one Undo step). Rows and seats can
//! also take "Same as the section" or "Same as the row", which clears their own level.

use admin_rust_core::editor::view::{PickerValue, level_pick, pick_action};
use leptos::prelude::*;

use super::{bind_select, new_id, use_editor};

#[component]
pub fn LevelPicker() -> impl IntoView {
    let ed = use_editor();
    let pick = Memo::new(move |_| ed.doc.with(|d| ed.selection.with(|s| level_pick(d, s))));
    let shown = Memo::new(move |_| pick.with(Option::is_some));
    move || {
        shown.get().then(|| {
            let id = new_id();
            let select = NodeRef::new();
            bind_select(select, move || {
                pick.with(|p| p.as_ref().map(|p| p.value.as_value().to_string()).unwrap_or_default())
            });
            let swatch = move || pick.with(|p| p.as_ref().and_then(|p| p.swatch.clone()));
            view! {
                <div class="field editor-level-picker">
                    <label for=id.clone()>"Price level"</label>
                    <div class="editor-level-picker__row">
                        <span
                            class=move || format!(
                                "level-swatch level-swatch--{}",
                                swatch().unwrap_or_else(|| "none".into()),
                            )
                            aria-hidden="true"
                            hidden=move || swatch().is_none()
                        ></span>
                        <select
                            node_ref=select
                            id=id
                            on:change=move |e| {
                                let choice = PickerValue::from_value(&event_target_value(&e));
                                if let Some(a) = pick_action(&choice) {
                                    ed.dispatch(a);
                                }
                            }
                        >
                            {move || {
                                let Some(p) = pick.get() else { return Vec::new() };
                                let value = p.value.as_value().to_string();
                                let mut options = Vec::new();
                                if p.value == PickerValue::Mixed {
                                    options.push(view! {
                                        <option value="__mixed" disabled=true prop:selected=true>
                                            "Mixed"
                                        </option>
                                    }.into_any());
                                }
                                if let Some(label) = p.inherit {
                                    options.push(view! {
                                        <option value="__inherit" prop:selected=value == "__inherit">
                                            {label}
                                        </option>
                                    }.into_any());
                                }
                                ed.doc.with(|d| {
                                    for l in &d.levels {
                                        options.push(view! {
                                            <option value=l.id.clone() prop:selected=value == l.id>
                                                {l.name.clone()}
                                            </option>
                                        }.into_any());
                                    }
                                });
                                options
                            }}
                        </select>
                    </div>
                </div>
            }
        })
    }
}
