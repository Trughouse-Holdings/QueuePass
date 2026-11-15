//! Parity M3a (`admin-app/src/components/SectionLines.tsx`): a layout's price levels and its
//! section lines, with Add and Remove. Shared by the Layouts card's lines form and New venue ›
//! Seated. The rules are `core::forms::section_lines`; this is the markup, element for element.
//!
//! Rows are keyed by their index, as the React component's `key={i}`: removing a line keeps the
//! boxes in place and shows the next line's values in them, and the lines after it renumber.

use std::cell::Cell;

use admin_rust_core::forms::section_lines::{
    LEVEL_COLORS, LEVELS_HINT, LevelColor, LinesDraft, SECTIONS_HINT, SelectOption, line_seats,
    seats_text,
};
use leptos::prelude::*;

thread_local! {
    static NEXT_ID: Cell<u64> = const { Cell::new(0) };
}

/// React's `useId`: an id unique in the page, for `htmlFor`, `aria-labelledby`, and
/// `aria-describedby`. Call it once per component instance.
pub fn use_id() -> String {
    NEXT_ID.with(|n| {
        let id = n.get();
        n.set(id + 1);
        format!("qp-id-{id}")
    })
}

/// One change to the levels or lines, as the React component's `onLevelsChange` and `onChange`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinesEdit {
    LevelName(usize, String),
    LevelColor(usize, LevelColor),
    AddLevel,
    RemoveLevel(usize),
    LineName(usize, String),
    LineRows(usize, String),
    LineSeats(usize, String),
    LineLevel(usize, String),
    AddSection,
    RemoveSection(usize),
}

impl LinesEdit {
    /// Applies the change to the draft; an index that is no longer there changes nothing.
    pub fn apply(self, d: &mut LinesDraft) {
        let levels = d.levels.len();
        let lines = d.lines.len();
        match self {
            LinesEdit::LevelName(i, name) if i < levels => d.rename_level(i, &name),
            LinesEdit::LevelColor(i, color) if i < levels => d.set_level_color(i, color),
            LinesEdit::AddLevel => d.add_level(),
            LinesEdit::RemoveLevel(i) if i < levels => d.remove_level(i),
            LinesEdit::LineName(i, v) if i < lines => d.set_line_name(i, &v),
            LinesEdit::LineRows(i, v) if i < lines => d.set_line_rows(i, &v),
            LinesEdit::LineSeats(i, v) if i < lines => d.set_line_seats_per_row(i, &v),
            LinesEdit::LineLevel(i, v) if i < lines => d.set_line_level(i, &v),
            LinesEdit::AddSection => d.add_section(),
            LinesEdit::RemoveSection(i) if i < lines => d.remove_section(i),
            _ => {}
        }
    }
}

/// The color a select's value names (`LEVEL_COLORS` lists every one).
fn color_of(value: &str) -> Option<LevelColor> {
    LEVEL_COLORS
        .iter()
        .copied()
        .find(|c| c.to_string() == value)
}

/// `SectionLines`: the levels hint, a "Level {i}" fieldset per level, "Add level", the sections
/// hint, a "Section {i}" fieldset per line, and "Add section".
#[component]
pub fn SectionLines(
    #[prop(into)] draft: Signal<LinesDraft>,
    on_edit: Callback<LinesEdit>,
) -> impl IntoView {
    let prefix = use_id();
    let level_count = Memo::new(move |_| draft.with(|d| d.levels.len()));
    let line_count = Memo::new(move |_| draft.with(|d| d.lines.len()));

    let level_prefix = prefix.clone();
    let level_row = move |i: usize| {
        let id = |part: &str| format!("{level_prefix}-level-{i}-{part}");
        let labelled = |part: &str| format!("{} {}", id("legend"), id(part));
        let name =
            move || draft.with(|d| d.levels.get(i).map(|l| l.name.clone()).unwrap_or_default());
        let color = move || {
            draft.with(|d| {
                d.levels
                    .get(i)
                    .map(|l| l.color.to_string())
                    .unwrap_or_default()
            })
        };
        view! {
            <fieldset class="form__row form__row--level">
                <legend id=id("legend")>{format!("Level {}", i + 1)}</legend>
                <div class="field">
                    <label id=id("name-label") for=id("name")>"Level name"</label>
                    <input
                        id=id("name")
                        aria-labelledby=labelled("name-label")
                        prop:value=name
                        on:input=move |ev| on_edit.run(LinesEdit::LevelName(i, event_target_value(&ev)))
                    />
                </div>
                <div class="field">
                    <label id=id("color-label") for=id("color")>"Color"</label>
                    <select
                        id=id("color")
                        aria-labelledby=labelled("color-label")
                        prop:value=color
                        on:change=move |ev| {
                            if let Some(c) = color_of(&event_target_value(&ev)) {
                                on_edit.run(LinesEdit::LevelColor(i, c));
                            }
                        }
                    >
                        {LEVEL_COLORS
                            .iter()
                            .map(|c| {
                                let value = c.to_string();
                                let text = value.clone();
                                let v = value.clone();
                                view! {
                                    <option value=value prop:selected=move || color() == v>
                                        {text}
                                    </option>
                                }
                            })
                            .collect_view()}
                    </select>
                </div>
                <button
                    type="button"
                    class="btn"
                    on:click=move |_| on_edit.run(LinesEdit::RemoveLevel(i))
                >
                    {format!("Remove level {}", i + 1)}
                </button>
            </fieldset>
        }
    };

    let line_row = move |i: usize| {
        let id = |part: &str| format!("{prefix}-{i}-{part}");
        let labelled = |part: &str| format!("{} {}", id("legend"), id(part));
        let field =
            move |get: fn(&admin_rust_core::forms::section_lines::SectionLine) -> String| {
                move || draft.with(|d| d.lines.get(i).map(get).unwrap_or_default())
            };
        let level = field(|l| l.level.clone());
        // The options change only when the named levels or this line's level do.
        let options: Memo<Vec<SelectOption>> = Memo::new(move |_| {
            draft.with(|d| {
                d.lines
                    .get(i)
                    .map(|l| d.level_options(&l.level))
                    .unwrap_or_default()
            })
        });
        view! {
            <fieldset class="form__row form__row--section">
                <legend id=id("legend")>{format!("Section {}", i + 1)}</legend>
                <div class="field">
                    <label id=id("name-label") for=id("name")>"Section name"</label>
                    <input
                        id=id("name")
                        aria-labelledby=labelled("name-label")
                        prop:value=field(|l| l.name.clone())
                        on:input=move |ev| on_edit.run(LinesEdit::LineName(i, event_target_value(&ev)))
                    />
                </div>
                <div class="field">
                    <label id=id("rows-label") for=id("rows")>"Rows"</label>
                    <input
                        id=id("rows")
                        type="number"
                        min="1"
                        max="100"
                        aria-labelledby=labelled("rows-label")
                        prop:value=field(|l| l.rows.clone())
                        on:input=move |ev| on_edit.run(LinesEdit::LineRows(i, event_target_value(&ev)))
                    />
                </div>
                <span class="section-line__times" aria-hidden="true">"×"</span>
                <div class="field">
                    <label id=id("seats-label") for=id("seats")>"Seats per row"</label>
                    <input
                        id=id("seats")
                        type="number"
                        min="1"
                        max="200"
                        aria-labelledby=labelled("seats-label")
                        prop:value=field(|l| l.seats_per_row.clone())
                        on:input=move |ev| on_edit.run(LinesEdit::LineSeats(i, event_target_value(&ev)))
                    />
                </div>
                <div class="field section-line__level">
                    <label id=id("level-label") for=id("level")>"Price level"</label>
                    <select
                        id=id("level")
                        aria-labelledby=labelled("level-label")
                        prop:value=level
                        on:change=move |ev| on_edit.run(LinesEdit::LineLevel(i, event_target_value(&ev)))
                    >
                        {move || {
                            options
                                .get()
                                .into_iter()
                                .map(|o| {
                                    let v = o.value.clone();
                                    view! {
                                        <option value=o.value prop:selected=move || level() == v>
                                            {o.label}
                                        </option>
                                    }
                                })
                                .collect_view()
                        }}
                    </select>
                </div>
                <span class="section-line__seats">
                    {move || seats_text(draft.with(|d| d.lines.get(i).map(line_seats).unwrap_or(0.0)))}
                </span>
                <button
                    type="button"
                    class="btn"
                    on:click=move |_| on_edit.run(LinesEdit::RemoveSection(i))
                >
                    {format!("Remove section {}", i + 1)}
                </button>
            </fieldset>
        }
    };

    view! {
        <p class="field__hint">{LEVELS_HINT}</p>
        <For each=move || 0..level_count.get() key=|i| *i children=level_row/>
        <div>
            <button type="button" class="btn" on:click=move |_| on_edit.run(LinesEdit::AddLevel)>
                "Add level"
            </button>
        </div>

        <p class="field__hint">{SECTIONS_HINT}</p>
        <For each=move || 0..line_count.get() key=|i| *i children=line_row/>
        <div>
            <button type="button" class="btn" on:click=move |_| on_edit.run(LinesEdit::AddSection)>
                "Add section"
            </button>
        </div>
    }
}
