//! Spec 039 FR-009–FR-013, FR-026 (research R6, R7; parity LE49–LE58), port of
//! `admin-app/src/layout-editor/SelectionPanel.tsx`: what is selected. For one section: its name,
//! its place (x, y) and angle as number boxes, its generator values with Regenerate when it was
//! generated, Duplicate section and Delete section. For rows or seats of a section: Delete seats,
//! Mark accessible or not, and the label of one row or one seat. The chosen section's rows and
//! seats are listed as checkboxes, the keyboard path to them (FR-026).

use std::collections::HashSet;

use admin_rust_core::{
    editor::{
        doc::{EdSection, FloorKind},
        draft::{BlockDraft, DraftProblems, ReadDraftOptions, draft_of, read_draft},
        state::{
            Action, FLOOR_NAMES, Selection, regenerate_plan, row_label_problem, seat_count,
            seat_label_problem, section_name_problem, totals,
        },
        view::{
            confirm_delete_sections, delete_seats_request, parts_selected, regenerate_confirm,
            row_list_label, rows_list_section, seat_ids_of, selection_note,
        },
    },
    seating::geometry::LAYOUT_LIMITS,
};
use leptos::{ev, prelude::*};
use wasm_bindgen::JsCast;

use super::{
    Editor, add_section::BlockFields, commit_box::CommitBox, level_picker::LevelPicker,
    number_box::NumberBox, run_request, use_editor,
};

/// What the panel shows, by the selection's kind.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    None,
    Floor,
    Sections,
    Rows,
    Seats,
}

fn kind_of(s: &Selection) -> Kind {
    match s {
        Selection::None => Kind::None,
        Selection::Floor => Kind::Floor,
        Selection::Sections { .. } => Kind::Sections,
        Selection::Rows { .. } => Kind::Rows,
        Selection::Seats { .. } => Kind::Seats,
    }
}

/// Asks before deleting sections, then deletes them (FR-013).
fn delete_sections(ed: Editor, ids: Vec<String>) {
    let ask = ed.doc.with_untracked(|d| confirm_delete_sections(d, &ids));
    if let Some(text) = ask
        && window().confirm_with_message(&text).unwrap_or(false)
    {
        ed.dispatch(Action::DeleteSections { ids });
    }
}

#[component]
pub fn SelectionPanel() -> impl IntoView {
    let ed = use_editor();
    let kind = Memo::new(move |_| ed.selection.with(kind_of));
    // The one section selected, still there.
    let one = Memo::new(move |_| {
        ed.selection.with(|s| match s {
            Selection::Sections { ids } if ids.len() == 1 => ed
                .doc
                .with(|d| d.sections.iter().any(|x| x.id == ids[0]))
                .then(|| ids[0].clone()),
            _ => None,
        })
    });
    // The rows or seats selection's section, its kind, and its one row or seat.
    let parts = Memo::new(move |_| {
        ed.selection.with(|s| match s {
            Selection::Rows { section_id, ids } => Some((
                section_id.clone(),
                true,
                (ids.len() == 1).then(|| ids[0].clone()),
            )),
            Selection::Seats { section_id, ids } => Some((
                section_id.clone(),
                false,
                (ids.len() == 1).then(|| ids[0].clone()),
            )),
            _ => None,
        })
    });
    // The section whose rows and seats are listed.
    let listed = Memo::new(move |_| {
        ed.doc.with(|d| {
            ed.selection
                .with(|s| rows_list_section(d, s).map(|x| x.id.clone()))
        })
    });
    view! {
        <section class="card editor-panel" aria-labelledby="editor-selection-heading">
            <h2 id="editor-selection-heading">"Selection"</h2>
            {move || (kind.get() == Kind::None).then(|| view! {
                <p class="note">"Nothing selected."</p>
            })}
            {move || (kind.get() == Kind::Floor).then(|| view! {
                <p>{move || {
                    let k = ed.doc.with(|d| d.floor.kind);
                    let name = FLOOR_NAMES.iter().find(|(f, _)| *f == k).map_or("", |(_, n)| n);
                    format!("Floor object: {name}")
                }}</p>
                <div class="form__actions">
                    <button
                        type="button"
                        class="btn"
                        on:click=move |_| ed.dispatch(Action::SetFloor {
                            kind: FloorKind::None,
                            at: [0.0, 0.0],
                        })
                    >
                        "Delete floor object"
                    </button>
                </div>
            })}
            {move || matches!(kind.get(), Kind::Sections | Kind::Rows | Kind::Seats).then(|| view! {
                <LevelPicker/>
            })}
            {move || (kind.get() == Kind::Sections && one.with(Option::is_none)).then(|| view! {
                <p>{move || format!("{} sections selected", ed.selection.with(|s| s.section_ids().len()))}</p>
                <div class="form__actions">
                    <button
                        type="button"
                        class="btn"
                        on:click=move |_| {
                            delete_sections(ed, ed.selection.with_untracked(|s| s.section_ids().to_vec()));
                        }
                    >
                        "Delete sections"
                    </button>
                </div>
            })}
            {move || parts.get().map(|(section_id, rows, single)| view! {
                <PartsSelected section_id=section_id rows=rows single=single/>
            })}
            {move || one.get().map(|id| view! { <OneSection id=id/> })}
            {move || listed.get().map(|id| view! { <RowsList section_id=id/> })}
        </section>
    }
}

/// The section of `id` in the document now, reactively (none once it is gone).
fn section_memo(ed: Editor, id: String) -> Memo<Option<std::sync::Arc<EdSection>>> {
    Memo::new_with_compare(
        move |_| {
            ed.doc
                .with(|d| d.sections.iter().find(|s| s.id == id).cloned())
        },
        |a, b| match (a, b) {
            (Some(Some(a)), Some(Some(b))) => !std::sync::Arc::ptr_eq(a, b),
            (Some(None), Some(None)) => false,
            _ => true,
        },
    )
}

/// One section selected (LE50–LE54, LE58).
#[component]
fn OneSection(id: String) -> impl IntoView {
    let ed = use_editor();
    let section = section_memo(ed, id.clone());
    let read = move |f: fn(&EdSection) -> String| {
        move || section.with(|s| s.as_deref().map(f).unwrap_or_default())
    };
    let name = Memo::new(move |_| {
        section.with(|s| s.as_ref().map(|s| s.name.clone()).unwrap_or_default())
    });
    let origin = move |i: usize| {
        Signal::derive(move || section.with(|s| s.as_ref().map_or(0.0, |s| s.origin[i])))
    };
    let angle = Signal::derive(move || section.with(|s| s.as_ref().map_or(0.0, |s| s.angle)));
    let max = LAYOUT_LIMITS.max_map_units as f64;
    let (i1, i2, i3, i4, i5, i6) = (
        id.clone(),
        id.clone(),
        id.clone(),
        id.clone(),
        id.clone(),
        id.clone(),
    );
    let place = move |id: String, at: Option<(usize, f64)>, angle: Option<f64>| {
        let origin = at.and_then(|(i, v)| {
            section.with_untracked(|s| {
                s.as_ref().map(|s| {
                    let mut o = s.origin;
                    o[i] = v;
                    o
                })
            })
        });
        ed.dispatch(Action::PlaceSection { id, origin, angle });
    };
    // The generator's form starts again when the generator changes (React's `key`).
    let regen_key = Memo::new(move |_| {
        section.with(|s| {
            s.as_ref()
                .and_then(|s| s.generator.clone().map(|g| (s.id.clone(), g)))
        })
    });
    view! {
        <h3>{read(|s| format!("Section {}", s.name))}</h3>
        <p class="note">{move || {
            section.with(|s| s.as_ref().map(|s| ed.doc.with(|d| selection_note(d, s))).unwrap_or_default())
        }}</p>
        <CommitBox
            label="Section name"
            value=name
            max_length=LAYOUT_LIMITS.name_max_length
            check=Callback::new(move |text: String| ed.doc.with_untracked(|d| section_name_problem(d, &i1, &text)))
            on_commit=Callback::new(move |name: String| ed.dispatch(Action::RenameSection { id: i2.clone(), name }))
        />
        <div class="editor-place">
            <NumberBox
                label="x"
                value=origin(0)
                min=0.0
                max=max
                on_value=Callback::new(move |x: f64| place(i3.clone(), Some((0, x)), None))
            />
            <NumberBox
                label="y"
                value=origin(1)
                min=0.0
                max=max
                on_value=Callback::new(move |y: f64| place(i4.clone(), Some((1, y)), None))
            />
            <NumberBox
                label="Angle"
                value=angle
                min=-180.0
                max=180.0
                on_value=Callback::new(move |a: f64| place(i5.clone(), None, Some(a)))
            />
        </div>
        <div class="form__actions">
            <button
                type="button"
                class="btn"
                on:click=move |_| ed.dispatch(Action::DuplicateSection { id: i6.clone() })
            >
                "Duplicate section"
            </button>
            <button type="button" class="btn" on:click=move |_| delete_sections(ed, vec![id.clone()])>
                "Delete section"
            </button>
        </div>
        {move || regen_key.get().map(|(id, _)| view! { <Regenerate id=id/> })}
    }
}

/// FR-026, R11: the chosen section's rows as a checkbox list, each row's seats opening under it
/// as another. Checking adds to the selection, unchecking takes out.
#[component]
fn RowsList(section_id: String) -> impl IntoView {
    let ed = use_editor();
    let section = section_memo(ed, section_id.clone());
    let open: RwSignal<HashSet<String>> = RwSignal::new(HashSet::new());
    let on = Memo::new(move |_| {
        ed.selection.with(|s| match s {
            Selection::Rows { ids, .. } => {
                (ids.iter().cloned().collect::<HashSet<_>>(), HashSet::new())
            }
            Selection::Seats { ids, .. } => (HashSet::new(), ids.iter().cloned().collect()),
            _ => (HashSet::new(), HashSet::new()),
        })
    });
    let sid = section_id.clone();
    move || {
        let s = section.get()?;
        let sid = sid.clone();
        Some(view! {
            <div role="group" aria-label=format!("Rows of section {}", s.name) class="editor-rows">
                <h3>"Rows"</h3>
                <ul class="editor-rows__list">
                    {s.rows.iter().map(|r| {
                        let seats_id = format!("editor-seats-{}", r.id);
                        let (rid, rid2, rid3, rid4) = (r.id.clone(), r.id.clone(), r.id.clone(), r.id.clone());
                        let sid1 = sid.clone();
                        let sid2 = sid.clone();
                        let label = r.label.clone();
                        let seats = r.seats.clone();
                        let is_open = Memo::new(move |_| open.with(|o| o.contains(&rid)));
                        let row_on = Memo::new(move |_| on.with(|(rows, _)| rows.contains(&rid2)));
                        let sid_for_seats = sid2.clone();
                        let seats_id2 = seats_id.clone();
                        view! {
                            <li>
                                <span class="editor-rows__row">
                                    <label>
                                        <input
                                            type="checkbox"
                                            aria-label=format!("Row {}", r.label)
                                            prop:checked=row_on
                                            on:change=move |e: ev::Event| {
                                                ed.dispatch(Action::SelectRows {
                                                    section_id: sid1.clone(),
                                                    ids: vec![rid3.clone()],
                                                    add: true,
                                                });
                                                keep_checked(&e, row_on.get_untracked());
                                            }
                                        />
                                        {row_list_label(r)}
                                    </label>
                                    <button
                                        type="button"
                                        class="btn btn--ghost"
                                        aria-label=format!("Seats of row {label}")
                                        aria-expanded=move || is_open.get().to_string()
                                        aria-controls=move || is_open.get().then(|| seats_id.clone())
                                        on:click=move |_| open.update(|o| {
                                            if !o.remove(&rid4) {
                                                o.insert(rid4.clone());
                                            }
                                        })
                                    >
                                        {move || if is_open.get() { "Hide seats" } else { "Seats" }}
                                    </button>
                                </span>
                                {move || is_open.get().then(|| {
                                    let label = label.clone();
                                    view! {
                                        <div
                                            id=seats_id2.clone()
                                            role="group"
                                            aria-label=format!("Seats of row {label}")
                                            class="editor-rows__seats"
                                        >
                                            {seats.iter().map(|q| {
                                                let (qid, qid2) = (q.id.clone(), q.id.clone());
                                                let sid = sid_for_seats.clone();
                                                let seat_on = Memo::new(move |_| on.with(|(_, seats)| seats.contains(&qid)));
                                                view! {
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            aria-label=format!("Seat {}", q.label)
                                                            prop:checked=seat_on
                                                            on:change=move |e: ev::Event| {
                                                                ed.dispatch(Action::SelectSeats {
                                                                    section_id: sid.clone(),
                                                                    ids: vec![qid2.clone()],
                                                                    add: true,
                                                                });
                                                                keep_checked(&e, seat_on.get_untracked());
                                                            }
                                                        />
                                                        {q.label.clone()}
                                                    </label>
                                                }
                                            }).collect_view()}
                                        </div>
                                    }
                                })}
                            </li>
                        }
                    }).collect_view()}
                </ul>
            </div>
        })
    }
}

/// A checkbox shows what the selection now is (React re-asserts `checked` on every render).
fn keep_checked(e: &ev::Event, checked: bool) {
    if let Some(el) = e
        .target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
    {
        el.set_checked(checked);
    }
}

/// FR-009, R7: a generated section's values, changed and applied with Regenerate.
#[component]
fn Regenerate(id: String) -> impl IntoView {
    let ed = use_editor();
    let start: BlockDraft = ed.doc.with_untracked(|d| {
        d.sections
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| {
                s.generator
                    .as_ref()
                    .map(|g| draft_of(g, &s.name, &s.level_id))
            })
            .expect("Regenerate is shown for a generated section")
    });
    let draft = RwSignal::new(start);
    let problems: RwSignal<DraftProblems> = RwSignal::new(DraftProblems::new());
    let submit = move |e: ev::SubmitEvent| {
        e.prevent_default();
        let doc = ed.doc_now();
        let Some(section) = doc.sections.iter().find(|s| s.id == id) else {
            return;
        };
        let read = read_draft(
            &draft.get_untracked(),
            &doc,
            &ReadDraftOptions {
                except: Some(&id),
                seats_before: (totals(&doc).seats - seat_count(section)) as f64,
                check_name: false,
            },
        );
        let empty = read.problems.is_empty();
        problems.set(read.problems);
        if !empty {
            return;
        }
        let plan = regenerate_plan(&doc, &id, &read.values);
        if let Some(q) = regenerate_confirm(&plan)
            && !window().confirm_with_message(&q).unwrap_or(false)
        {
            return;
        }
        ed.dispatch(Action::Regenerate {
            id: id.clone(),
            values: read.values,
        });
    };
    view! {
        <form class="form editor-form" aria-label="Generator values" novalidate=true on:submit=submit>
            <h3>"Generator values"</h3>
            <BlockFields draft=draft problems=problems/>
            <div class="form__actions">
                <button type="submit" class="btn">"Regenerate"</button>
            </div>
        </form>
    }
}

/// "Rows A–D selected in section 101", with what can be done to them (LE56, LE57).
#[component]
fn PartsSelected(section_id: String, rows: bool, single: Option<String>) -> impl IntoView {
    let ed = use_editor();
    let section = section_memo(ed, section_id.clone());
    let exists = Memo::new(move |_| section.with(Option::is_some));
    move || {
        exists
            .get()
            .then(|| parts_view(ed, section, section_id.clone(), rows, single.clone()))
    }
}

fn parts_view(
    ed: Editor,
    section: Memo<Option<std::sync::Arc<EdSection>>>,
    sid: String,
    rows: bool,
    single: Option<String>,
) -> impl IntoView {
    let line = move || ed.doc.with(|d| ed.selection.with(|s| parts_selected(d, s)));
    let seat_ids = move || {
        let sel = ed.selection.get_untracked();
        section
            .get_untracked()
            .map(|s| seat_ids_of(&s, &sel))
            .unwrap_or_default()
    };
    let one_row = single.clone().filter(|_| rows).map(|row_id| {
        let (r1, r2, r3) = (row_id.clone(), row_id.clone(), row_id);
        let (s1, s2) = (sid.clone(), sid.clone());
        let value = Memo::new(move |_| {
            section.with(|s| {
                s.as_ref()
                    .and_then(|s| s.rows.iter().find(|r| r.id == r1).map(|r| r.label.clone()))
                    .unwrap_or_default()
            })
        });
        view! {
            <CommitBox
                label="Row label"
                value=value
                max_length=LAYOUT_LIMITS.label_max_length
                check=Callback::new(move |label: String| {
                    ed.doc.with_untracked(|d| row_label_problem(d, &s1, &r2, &label))
                })
                on_commit=Callback::new(move |label: String| ed.dispatch(Action::RelabelRow {
                    section_id: s2.clone(),
                    row_id: r3.clone(),
                    label,
                }))
            />
        }
    });
    let one_seat = single.filter(|_| !rows).map(|seat_id| {
        let (q1, q2, q3) = (seat_id.clone(), seat_id.clone(), seat_id);
        let (s1, s2) = (sid.clone(), sid.clone());
        let value = Memo::new(move |_| {
            section.with(|s| {
                s.as_ref()
                    .and_then(|s| {
                        s.rows
                            .iter()
                            .flat_map(|r| r.seats.iter())
                            .find(|q| q.id == q1)
                            .map(|q| q.label.clone())
                    })
                    .unwrap_or_default()
            })
        });
        view! {
            <CommitBox
                label="Seat label"
                value=value
                max_length=LAYOUT_LIMITS.label_max_length
                check=Callback::new(move |label: String| {
                    ed.doc.with_untracked(|d| seat_label_problem(d, &s1, &q2, &label))
                })
                on_commit=Callback::new(move |label: String| ed.dispatch(Action::RelabelSeat {
                    section_id: s2.clone(),
                    seat_id: q3.clone(),
                    label,
                }))
            />
        }
    });
    let (m1, m2, m3) = (sid.clone(), sid.clone(), sid);
    view! {
        <p>{line}</p>
        {one_row}
        {one_seat}
        <div class="form__actions">
            <button
                type="button"
                class="btn"
                on:click=move |_| ed.dispatch(Action::MarkAccessible {
                    section_id: m1.clone(),
                    ids: seat_ids(),
                    accessible: true,
                })
            >
                "Mark accessible"
            </button>
            <button
                type="button"
                class="btn"
                on:click=move |_| ed.dispatch(Action::MarkAccessible {
                    section_id: m2.clone(),
                    ids: seat_ids(),
                    accessible: false,
                })
            >
                "Mark not accessible"
            </button>
            <button
                type="button"
                class="btn"
                on:click=move |_| {
                    let req = ed.doc.with_untracked(|d| delete_seats_request(d, &m3, &seat_ids()));
                    run_request(ed, req);
                }
            >
                "Delete seats"
            </button>
        </div>
    }
}
