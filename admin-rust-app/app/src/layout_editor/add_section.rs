//! Spec 039 US1 (FR-006, FR-007, FR-017; research R7; parity LE12–LE16), port of
//! `admin-app/src/layout-editor/AddSectionForm.tsx`: Add section, and the generator's fields it
//! shares with Regenerate (`BlockFields`). A name; rows; seats per row as one number or one a
//! row; row labels and the first row; the first seat and the numbering direction; a curve (a
//! preset or degrees); the level. Each problem is shown beside its field, naming the limit; the
//! seats left under 30,000 are shown.

use admin_rust_core::{
    editor::{
        doc::SectionGenerator,
        draft::{
            BlockDraft, CURVES, CUSTOM, DraftField, DraftProblems, ReadDraftOptions, draft_of,
            new_block, read_draft, seats_left_note,
        },
        state::totals,
    },
    seating::{
        geometry::{Direction, LAYOUT_LIMITS, RowLabelStyle},
        map_geometry::js_number,
    },
};
use leptos::{ev, prelude::*};

use super::{bind_select, bind_value, new_id, use_editor};

#[component]
pub fn AddSectionForm(
    level_id: String,
    on_generate: Callback<(String, SectionGenerator, String)>,
    on_cancel: Callback<()>,
) -> impl IntoView {
    let ed = use_editor();
    let draft = RwSignal::new(draft_of(&new_block(), "", &level_id));
    let problems: RwSignal<DraftProblems> = RwSignal::new(DraftProblems::new());
    let submit = move |e: ev::SubmitEvent| {
        e.prevent_default();
        let doc = ed.doc_now();
        let d = draft.get_untracked();
        let read = read_draft(
            &d,
            &doc,
            &ReadDraftOptions {
                except: None,
                seats_before: totals(&doc).seats as f64,
                check_name: true,
            },
        );
        let empty = read.problems.is_empty();
        problems.set(read.problems);
        if !empty {
            return;
        }
        on_generate.run((d.name.trim().to_string(), read.values, d.level_id));
    };
    view! {
        <form class="form editor-form" aria-label="Add section" novalidate=true on:submit=submit>
            <BlockFields draft=draft problems=problems with_name=true with_level=true/>
            <p class="note">{move || ed.doc.with(|d| seats_left_note(d))}</p>
            <div class="form__actions">
                <button type="submit" class="btn btn--primary">"Generate"</button>
                <button type="button" class="btn" on:click=move |_| on_cancel.run(())>
                    "Cancel"
                </button>
            </div>
        </form>
    }
}

/// The ids of one field's input, hint, and problem (React's `Field` render prop).
#[derive(Clone)]
struct FieldIds {
    id: String,
    described_by: Signal<Option<String>>,
    invalid: Signal<Option<&'static str>>,
}

/// One field: its label, its input, its hint and its problem beside it.
fn field<V: IntoView + 'static>(
    label: &'static str,
    hint: Option<&'static str>,
    problem: Signal<Option<String>>,
    control: impl FnOnce(FieldIds) -> V,
) -> impl IntoView {
    let id = new_id();
    let hint_id = format!("{id}-hint");
    let problem_id = format!("{id}-problem");
    let (h, p) = (hint_id.clone(), problem_id.clone());
    let described_by = Signal::derive(move || {
        let parts: Vec<&str> = [
            hint.map(|_| h.as_str()),
            problem.with(Option::is_some).then_some(p.as_str()),
        ]
        .into_iter()
        .flatten()
        .collect();
        (!parts.is_empty()).then(|| parts.join(" "))
    });
    let invalid = Signal::derive(move || problem.with(Option::is_some).then_some("true"));
    let input = control(FieldIds {
        id: id.clone(),
        described_by,
        invalid,
    });
    view! {
        <div class="field">
            <label for=id>{label}</label>
            {input}
            {hint.map(|h| view! { <span id=hint_id class="field__hint">{h}</span> })}
            {move || problem.get().map(|p| view! {
                <span id=problem_id.clone() class="editor-field-error">{p}</span>
            })}
        </div>
    }
}

/// A text or number box of the draft.
fn draft_input(
    f: FieldIds,
    draft: RwSignal<BlockDraft>,
    kind: &'static str,
    min: Option<&'static str>,
    max: Option<String>,
    get: fn(&BlockDraft) -> String,
    set: fn(&mut BlockDraft, String),
) -> impl IntoView {
    let input = NodeRef::new();
    bind_value(input, move || draft.with(get));
    view! {
        <input
            node_ref=input
            id=f.id
            type=(kind != "text").then_some(kind)
            min=min
            max=max.clone().filter(|_| kind == "number")
            maxlength=max.filter(|_| kind == "text")
            aria-describedby=f.described_by
            aria-invalid=f.invalid
            on:input=move |e| {
                let v = event_target_value(&e);
                draft.update(|d| set(d, v));
            }
        />
    }
}

/// The generator's fields, for Add section and for Regenerate (FR-009).
#[component]
pub fn BlockFields(
    draft: RwSignal<BlockDraft>,
    problems: RwSignal<DraftProblems>,
    #[prop(optional)] with_name: bool,
    #[prop(optional)] with_level: bool,
) -> impl IntoView {
    let ed = use_editor();
    let problem =
        move |f: DraftField| Signal::derive(move || problems.with(|p| p.get(&f).cloned()));
    let name = with_name.then(move || {
        field("Section name", None, problem(DraftField::Name), move |f| {
            draft_input(
                f,
                draft,
                "text",
                None,
                Some(LAYOUT_LIMITS.name_max_length.to_string()),
                |d| d.name.clone(),
                |d, v| d.name = v,
            )
        })
    });
    let rows = field("Rows", None, problem(DraftField::Rows), move |f| {
        draft_input(
            f,
            draft,
            "number",
            Some("1"),
            Some(LAYOUT_LIMITS.max_rows.to_string()),
            |d| d.rows.clone(),
            |d, v| d.rows = v,
        )
    });
    let seats = field(
        "Seats per row",
        Some("One number, or one for each row from the front: 16, 16, 18"),
        problem(DraftField::SeatsPerRow),
        move |f| {
            draft_input(
                f,
                draft,
                "text",
                None,
                None,
                |d| d.seats_per_row.clone(),
                |d, v| d.seats_per_row = v,
            )
        },
    );
    let row_labels = field(
        "Row labels",
        None,
        problem(DraftField::RowLabels),
        move |f| {
            let is = move |s: RowLabelStyle| draft.with(|d| d.row_labels == s);
            view! {
                <select
                    id=f.id
                    aria-describedby=f.described_by
                    aria-invalid=f.invalid
                    on:change=move |e| {
                        let style = if event_target_value(&e) == "NUMBERS" {
                            RowLabelStyle::Numbers
                        } else {
                            RowLabelStyle::Letters
                        };
                        draft.update(|d| *d = d.with_row_labels(style));
                    }
                >
                    <option value="LETTERS" prop:selected=move || is(RowLabelStyle::Letters)>
                        "Letters (A, B … Z, AA)"
                    </option>
                    <option value="NUMBERS" prop:selected=move || is(RowLabelStyle::Numbers)>
                        "Numbers (1, 2, 3)"
                    </option>
                </select>
            }
        },
    );
    let first_row = field("First row", None, problem(DraftField::FirstRow), move |f| {
        draft_input(
            f,
            draft,
            "text",
            None,
            Some(LAYOUT_LIMITS.label_max_length.to_string()),
            |d| d.first_row.clone(),
            |d, v| d.first_row = v,
        )
    });
    let first_seat = field(
        "First seat",
        None,
        problem(DraftField::FirstSeat),
        move |f| {
            draft_input(
                f,
                draft,
                "number",
                Some("1"),
                None,
                |d| d.first_seat.clone(),
                |d, v| d.first_seat = v,
            )
        },
    );
    let direction = field(
        "Seat numbers",
        Some("As seen from the floor"),
        problem(DraftField::Direction),
        move |f| {
            let is = move |dir: Direction| draft.with(|d| d.direction == dir);
            view! {
                <select
                    id=f.id
                    aria-describedby=f.described_by
                    aria-invalid=f.invalid
                    on:change=move |e| {
                        let dir = if event_target_value(&e) == "RIGHT_TO_LEFT" {
                            Direction::RightToLeft
                        } else {
                            Direction::LeftToRight
                        };
                        draft.update(|d| d.direction = dir);
                    }
                >
                    <option value="LEFT_TO_RIGHT" prop:selected=move || is(Direction::LeftToRight)>
                        "Left to right"
                    </option>
                    <option value="RIGHT_TO_LEFT" prop:selected=move || is(Direction::RightToLeft)>
                        "Right to left"
                    </option>
                </select>
            }
        },
    );
    // The curve's problem is under Curve, or under Curve in degrees when it is shown.
    let custom = Memo::new(move |_| draft.with(BlockDraft::is_custom_curve));
    let curve_problem = Signal::derive(move || {
        if custom.get() {
            None
        } else {
            problems.with(|p| p.get(&DraftField::Curve).cloned())
        }
    });
    let curve = field("Curve", None, curve_problem, move |f| {
        let is = move |v: &str| draft.with(|d| d.curve_preset == v);
        view! {
            <select
                id=f.id
                aria-describedby=f.described_by
                aria-invalid=f.invalid
                on:change=move |e| {
                    let preset = event_target_value(&e);
                    draft.update(|d| *d = d.with_curve_preset(&preset));
                }
            >
                {CURVES.iter().map(|c| {
                    let value = js_number(c.degrees);
                    let v = value.clone();
                    view! {
                        <option value=value prop:selected=move || is(&v)>{c.label}</option>
                    }
                }).collect_view()}
                <option value=CUSTOM prop:selected=move || is(CUSTOM)>"Degrees…"</option>
            </select>
        }
    });
    let degrees = move || {
        custom.get().then(move || {
            field(
                "Curve in degrees",
                Some("0 (straight) to 120"),
                problem(DraftField::Curve),
                move |f| {
                    draft_input(
                        f,
                        draft,
                        "number",
                        Some("0"),
                        Some("120".into()),
                        |d| d.curve.clone(),
                        |d, v| d.curve = v,
                    )
                },
            )
        })
    };
    let level = with_level.then(move || {
        field("Price level", None, Signal::derive(|| None), move |f| {
            let select = NodeRef::new();
            bind_select(select, move || draft.with(|d| d.level_id.clone()));
            view! {
                <select
                    node_ref=select
                    id=f.id
                    aria-describedby=f.described_by
                    aria-invalid=f.invalid
                    on:change=move |e| {
                        let v = event_target_value(&e);
                        draft.update(|d| d.level_id = v);
                    }
                >
                    {move || {
                        let chosen = draft.with(|d| d.level_id.clone());
                        ed.doc.with(|d| {
                            d.levels
                                .iter()
                                .map(|l| view! {
                                    <option value=l.id.clone() prop:selected=chosen == l.id>
                                        {l.name.clone()}
                                    </option>
                                })
                                .collect_view()
                        })
                    }}
                </select>
            }
        })
    });
    view! {
        {name}
        {rows}
        {seats}
        {row_labels}
        {first_row}
        {first_seat}
        {direction}
        {curve}
        {degrees}
        {level}
    }
}
