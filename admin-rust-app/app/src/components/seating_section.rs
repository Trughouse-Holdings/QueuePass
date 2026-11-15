//! Parity M8–M10, SL13 (`admin-app/src/components/SeatingSection.tsx`): the event form's Seating
//! select, and for a layout its preview, the price table with the "Prices from" note, the seat
//! line, and the off-sale tool with its section drawing. Every rule and text is
//! `core::forms::event::EventFormState` and `core::forms::off_sale`; this is the markup, element
//! for element, and the section reads the tool asks for.

use admin_rust_core::{
    api::client::ops,
    forms::{
        event::{
            ALL_OFF_SALE, LOADING_LAYOUT, LevelRow, PRICE_PLACEHOLDER, PRICES_CAPTION,
            SectionRequest,
        },
        off_sale::{
            BACK_TO_SECTIONS, CHOOSE_SECTION_NOTE, LOADING_SEATS, LayoutSectionSeats,
            OFF_SALE_LEGEND, RowChoice, SeatChoice, seat_radius, section_seats_label,
            taken_from_map_section,
        },
    },
    seating::{
        map_geometry::{js_number, outline_path, section_view_box},
        map_state::VenueMapSection,
        venue_map::PreviewLayout,
    },
};
use leptos::{prelude::*, task::spawn_local};

use crate::{
    auth::{Auth, use_auth},
    components::event_form::{FormSignal, edit, edit_with, hint},
    venue_map::LayoutPreview,
};

/// The chosen layout's preview drawing, by layout id (read with the layout).
pub type PreviewSignal = RwSignal<Option<(String, PreviewLayout)>>;

/// `loadSection` of `EventForm.tsx`: makes the section reads the form asks for. A section's
/// seats, or (on edit of the saved layout) its sold and held seats; a failed seat read may be
/// asked again, a failed venue-map read is ignored (the Backend refuses a taken seat anyway).
pub fn load_sections(auth: Auth, state: FormSignal, requests: Vec<SectionRequest>) {
    for request in requests {
        spawn_local(async move {
            let api = auth.api();
            match request {
                SectionRequest::Layout {
                    layout_id,
                    section_id,
                } => {
                    let call = ops::get_venue_layout_section(&layout_id, &section_id);
                    match api.send::<LayoutSectionSeats>(call).await {
                        Ok(seats) => edit(state, |s| s.section_loaded(seats)),
                        Err(_) => edit(state, |s| s.section_failed(&layout_id, &section_id)),
                    }
                }
                SectionRequest::VenueMap {
                    event_id,
                    section_id,
                } => {
                    let call = ops::get_venue_map_section(&event_id, &section_id);
                    if let Ok(map) = api.send::<VenueMapSection>(call).await {
                        let taken = taken_from_map_section(&map);
                        edit(state, |s| s.taken_loaded(&section_id, taken));
                    }
                }
            }
        });
    }
}

/// What stands under the Seating select.
#[derive(Clone, Debug, PartialEq, Eq)]
enum LayoutShape {
    General,
    Loading,
    Loaded(String),
}

/// `SeatingSection`.
#[component]
pub fn SeatingSection(state: FormSignal, preview: PreviewSignal) -> impl IntoView {
    let options = Memo::new(move |_| state.with(|s| s.layout_options()));
    let lock = Memo::new(move |_| state.with(|s| s.layout_lock_reason()));
    let invalid = Memo::new(move |_| state.with(|s| s.field_invalid("layoutId")));
    let choice = move || state.with(|s| s.seating.layout_id.clone().unwrap_or_default());
    let shape = Memo::new(move |_| {
        state.with(|s| {
            if !s.seated() {
                LayoutShape::General
            } else {
                match s.layout_detail() {
                    Some(d) => LayoutShape::Loaded(d.id.clone()),
                    None => LayoutShape::Loading,
                }
            }
        })
    });

    view! {
        <div class="field">
            <label for="layoutId">"Seating"</label>
            <select
                id="layoutId"
                prop:value=choice
                disabled=move || lock.get().is_some()
                on:blur=move |_| edit(state, |s| s.blur("layoutId"))
                on:change=move |ev| {
                    let value = event_target_value(&ev);
                    edit(state, |s| s.choose_layout((!value.is_empty()).then_some(value.as_str())));
                }
                aria-invalid=move || invalid.get().then_some("true")
                aria-describedby=move || invalid.get().then_some("layoutId-error")
            >
                {move || {
                    options
                        .get()
                        .into_iter()
                        .map(|(value, label)| {
                            let v = value.clone();
                            view! {
                                <option value=value prop:selected=move || choice() == v>
                                    {label}
                                </option>
                            }
                        })
                        .collect_view()
                }}
            </select>
            {move || lock.get().map(|reason| view! { <span class="field__hint">{reason}</span> })}
            {hint(|| "layoutId-error".into(), move || state.with(|s| s.field_hint("layoutId")))}
        </div>
        {move || match shape.get() {
            LayoutShape::General => ().into_any(),
            LayoutShape::Loading => view! { <p class="loading">{LOADING_LAYOUT}</p> }.into_any(),
            LayoutShape::Loaded(id) => view! { <LayoutSeating state preview id/> }.into_any(),
        }}
    }
}

/// `LayoutSeating`: the preview, the price table, the "Prices from" note, the seat line, and the
/// off-sale tool of the loaded layout `id`.
#[component]
fn LayoutSeating(state: FormSignal, preview: PreviewSignal, id: String) -> impl IntoView {
    let drawing = {
        let id = id.clone();
        Memo::new(move |_| {
            preview.with(|p| {
                p.as_ref()
                    .filter(|(at, _)| *at == id)
                    .map(|(_, layout)| layout.clone())
            })
        })
    };
    let rows = Memo::new(move |_| state.with(|s| s.level_rows()));
    let prices_from = Memo::new(move |_| state.with(|s| s.prices_from_note()));
    let levels = rows.get_untracked();

    view! {
        {move || drawing.get().map(|layout| view! { <LayoutPreview layout/> })}
        <div id="levelPrices" tabindex="-1" class="table-wrap">
            <table>
                <caption>{PRICES_CAPTION}</caption>
                <thead>
                    <tr>
                        <th scope="col">"Level"</th>
                        <th scope="col">"Seats on sale"</th>
                        <th scope="col">"Price"</th>
                    </tr>
                </thead>
                <tbody>
                    {levels
                        .into_iter()
                        .enumerate()
                        .map(|(i, level)| level_row(state, rows, i, level))
                        .collect_view()}
                </tbody>
            </table>
        </div>
        {move || prices_from.get().map(|note| view! { <p class="note">{note}</p> })}
        {hint(|| "levelPrices-error".into(), move || state.with(|s| s.field_hint("levelPrices")))}
        <p class="note" data-testid="seat-line">
            {move || state.with(|s| s.seat_line()).unwrap_or_default()}
        </p>
        <OffSaleTool state/>
    }
}

/// One row of the price table: the swatch and name, the seats on sale, and the price box (or
/// "All seats off sale").
fn level_row(
    state: FormSignal,
    rows: Memo<Vec<LevelRow>>,
    index: usize,
    level: LevelRow,
) -> impl IntoView {
    let on_sale = move || rows.with(|r| r.get(index).map(|l| l.on_sale_text.clone()));
    let price_box = Memo::new(move |_| rows.with(|r| r.get(index).is_some_and(|l| l.price_box)));
    let LevelRow {
        id,
        name,
        swatch_class,
        price_id,
        price_label,
        ..
    } = level;
    let key = format!("levelPrices.{id}");
    let error_id = format!("{price_id}-error");
    let price_cell = move || {
        if !price_box.get() {
            return view! { <span class="note">{ALL_OFF_SALE}</span> }.into_any();
        }
        let (id, blur_key, hint_key, error_id) =
            (id.clone(), key.clone(), key.clone(), error_id.clone());
        let invalid_key = key.clone();
        let invalid = Memo::new(move |_| state.with(|s| s.field_invalid(&invalid_key)));
        let value_id = id.clone();
        let hint_id = error_id.clone();
        view! {
            <input
                id=price_id.clone()
                aria-label=price_label.clone()
                inputmode="decimal"
                placeholder=PRICE_PLACEHOLDER
                prop:value=move || {
                    state.with(|s| s.seating.prices.get(&value_id).cloned().unwrap_or_default())
                }
                on:blur=move |_| edit(state, |s| s.blur(&blur_key))
                on:input=move |ev| {
                    let value = event_target_value(&ev);
                    edit(state, |s| s.set_level_price(&id, &value));
                }
                aria-invalid=move || invalid.get().then_some("true")
                aria-describedby=move || invalid.get().then(|| error_id.clone())
            />
            {hint(move || hint_id.clone(), move || state.with(|s| s.field_hint(&hint_key)))}
        }
        .into_any()
    };
    view! {
        <tr>
            <td>
                // The name is always beside the color (Constitution VII).
                <span class=swatch_class aria-hidden="true"></span>
                {name}
            </td>
            <td>{on_sale}</td>
            <td>{price_cell}</td>
        </tr>
    }
}

/// What the off-sale tool shows.
#[derive(Clone, Debug, PartialEq, Eq)]
enum OpenShape {
    Overview,
    Open {
        id: String,
        heading: String,
        loaded: bool,
    },
}

/// `OffSaleTool`: the sections to choose from, then one section with its seats drawn in place.
#[component]
fn OffSaleTool(state: FormSignal) -> impl IntoView {
    let auth = use_auth();
    let messages = Memo::new(move |_| state.with(|s| s.field_hint("offSale")));
    let open = Memo::new(move |_| {
        state.with(|s| match (&s.open_section_id, s.open_section_heading()) {
            (Some(id), Some(heading)) => OpenShape::Open {
                id: id.clone(),
                heading,
                loaded: s.section_seats.contains_key(id),
            },
            _ => OpenShape::Overview,
        })
    });
    let choices = state.with_untracked(|s| s.section_choices());

    view! {
        <fieldset
            class="field"
            id="offSale"
            tabindex="-1"
            aria-describedby=move || (!messages.get().is_empty()).then_some("offSale-error")
        >
            <legend>{OFF_SALE_LEGEND}</legend>
            {hint(|| "offSale-error".into(), move || messages.get())}
            {move || match open.get() {
                OpenShape::Overview => {
                    view! {
                        <p class="note">{CHOOSE_SECTION_NOTE}</p>
                        <div class="section-choices">
                            {choices
                                .clone()
                                .into_iter()
                                .map(|(id, label)| {
                                    view! {
                                        <button
                                            type="button"
                                            class="btn"
                                            on:click=move |_| {
                                                if let Some(requests) = edit_with(
                                                    state,
                                                    |s| s.open_section(&id),
                                                ) {
                                                    load_sections(auth, state, requests);
                                                }
                                            }
                                        >
                                            {label}
                                        </button>
                                    }
                                })
                                .collect_view()}
                        </div>
                    }
                        .into_any()
                }
                OpenShape::Open { id, heading, loaded } => {
                    view! {
                        <h3>{heading}</h3>
                        <div class="form__row">
                            <button
                                type="button"
                                class="btn btn--ghost"
                                on:click=move |_| edit(state, |s| s.close_section())
                            >
                                {BACK_TO_SECTIONS}
                            </button>
                        </div>
                        {if loaded {
                            view! { <SectionSeats state id/> }.into_any()
                        } else {
                            view! { <p class="loading">{LOADING_SEATS}</p> }.into_any()
                        }}
                    }
                        .into_any()
                }
            }}
        </fieldset>
    }
}

/// `SectionSeats`: the whole-section button, the taken note, a checkbox per row, and the drawing
/// with a button per seat.
#[component]
fn SectionSeats(state: FormSignal, id: String) -> impl IntoView {
    let (seats, outline) = state.with_untracked(|s| {
        let seats = s.section_seats.get(&id).cloned();
        let outline = s
            .layout_detail()
            .and_then(|d| d.sections.iter().find(|x| x.id == id))
            .map(|x| x.outline.clone())
            .unwrap_or_default();
        (seats, outline)
    });
    let Some(seats) = seats else {
        return ().into_any();
    };
    let radius = seat_radius(&seats);
    let tool = Memo::new(move |_| {
        state.with(|s| {
            s.section_tool()
                .map(|t| (t.whole_label(), t.whole_disabled(), t.taken_note()))
        })
    });
    let rows: Memo<Vec<RowChoice>> =
        Memo::new(move |_| state.with(|s| s.section_tool().map(|t| t.rows()).unwrap_or_default()));
    let choices: Memo<Vec<SeatChoice>> =
        Memo::new(move |_| state.with(|s| s.section_tool().map(|t| t.seats()).unwrap_or_default()));
    let row_labels = rows.get_untracked();
    let seat_list = choices.get_untracked();
    let r = js_number(radius);

    view! {
        <div class="form__row">
            <button
                type="button"
                class="btn"
                disabled=move || tool.get().is_some_and(|t| t.1)
                on:click=move |_| edit(state, |s| s.toggle_whole_section())
            >
                {move || tool.get().map(|t| t.0)}
            </button>
        </div>
        {move || {
            tool.get().and_then(|t| t.2).map(|note| view! { <p class="note">{note}</p> })
        }}
        <div class="form__row">
            {row_labels
                .into_iter()
                .enumerate()
                .map(|(i, row)| {
                    let number = row.number;
                    view! {
                        <label class="choice">
                            <input
                                type="checkbox"
                                prop:checked=move || rows.with(|r| r.get(i).is_some_and(|c| c.checked))
                                disabled=move || rows.with(|r| r.get(i).is_some_and(|c| c.disabled))
                                on:change=move |_| edit(state, |s| s.toggle_row(number))
                            />
                            {row.label}
                        </label>
                    }
                })
                .collect_view()}
        </div>
        <svg
            class="off-sale-section"
            viewBox=section_view_box(&outline, radius * 2.0)
            preserveAspectRatio="xMidYMid meet"
            aria-label=section_seats_label(&seats.name)
            role="group"
        >
            <path class="layout-preview__section" d=outline_path(&outline)/>
            {seat_list
                .into_iter()
                .enumerate()
                .map(|(i, seat)| {
                    let (row, number) = (seat.row, seat.seat);
                    let press = move || edit(state, |s| s.toggle_seat(row, number));
                    let label = move || choices.with(|c| c.get(i).map(|c| c.label.clone()));
                    view! {
                        <g
                            role="button"
                            tabindex=move || choices.with(|c| c.get(i).map(|c| c.tab_index.to_string()))
                            aria-label=label
                            aria-pressed=move || choices.with(|c| c.get(i).map(|c| c.pressed.to_string()))
                            aria-disabled=move || {
                                choices.with(|c| c.get(i).is_some_and(|c| c.taken.is_some())).then_some("true")
                            }
                            class=move || choices.with(|c| c.get(i).map(|c| c.class))
                            on:click=move |_| press()
                            on:keydown=move |ev| {
                                let key = ev.key();
                                if key == "Enter" || key == " " {
                                    ev.prevent_default();
                                    press();
                                }
                            }
                        >
                            <title>{label}</title>
                            <circle cx=js_number(seat.at[0]) cy=js_number(seat.at[1]) r=r.clone()/>
                        </g>
                    }
                })
                .collect_view()}
        </svg>
    }
    .into_any()
}
