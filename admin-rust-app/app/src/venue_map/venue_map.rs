//! Spec 037 research R13 (task T063; parity M13–M15): an event's venue map, as
//! `packages/shared/src/web/venue-map/venue-map.tsx`, drawn as SVG with the shared theme's
//! classes. The overview draws the floor and every section with its name; a section is a button
//! that zooms into it, where its seats are drawn ("Back to map" returns). Pan and zoom by drag,
//! pinch, wheel, the zoom buttons, and the keys (`pan_zoom.rs`).
//!
//! Sections and seats are keyed, so a live count change updates them in place and keyboard focus
//! stays put, as React's re-render does. The Customer app's skip link and Sections-list focus
//! (`skipTo`, `focusSeats`) are not ported: the Admin app never passes them.

use admin_rust_core::seating::{
    map_geometry::{bounds, js_number, outline_path},
    map_state::{FloorKind, VenueMap, VenueMapSection},
    pan_zoom::{label_font_size, map_aspect},
    venue_map::{
        ColorBy, MapSeatInfo, SeatView, fit_of_map, loading_note, map_label, open_section,
        section_class, section_labels, section_name, section_view,
    },
};
use leptos::prelude::*;

use super::{legend::Legend, pan_zoom::PanZoom, section_view::SectionView};

#[component]
fn SectionShape(
    map: Signal<VenueMap>,
    id: String,
    color_by: ColorBy,
    open_id: Memo<Option<String>>,
    pz: PanZoom,
    on_open_section: Callback<Option<String>>,
) -> impl IntoView {
    let with_section = {
        let id = id.clone();
        move |f: &dyn Fn(
            &VenueMap,
            &admin_rust_core::seating::map_state::MapSectionSummary,
        ) -> String| {
            map.with(|m| {
                m.sections
                    .iter()
                    .find(|s| s.section_id == id)
                    .map(|s| f(m, s))
                    .unwrap_or_default()
            })
        }
    };
    let d = {
        let with_section = with_section.clone();
        move || with_section(&|_, s| outline_path(&s.outline))
    };
    let label = {
        let with_section = with_section.clone();
        move || with_section(&|m, s| section_name(m, s, color_by))
    };
    let class = move || {
        let open = open_id.get();
        with_section(&|m, s| section_class(m, s, color_by, open.as_deref()))
    };
    let current = {
        let id = id.clone();
        move || (open_id.get().as_deref() == Some(id.as_str())).then_some("true")
    };
    let click_id = id.clone();
    view! {
        <path
            role="button"
            tabindex="0"
            aria-label=label
            aria-current=current
            class=class
            d=d
            on:click=move |_| {
                if !pz.dragged() {
                    on_open_section.run(Some(click_id.clone()));
                }
            }
            on:keydown=move |e| {
                if e.key() != "Enter" && e.key() != " " {
                    return;
                }
                e.prevent_default();
                e.stop_propagation();
                on_open_section.run(Some(id.clone()));
            }
        ></path>
    }
}

/// `VenueMap` (spec 038 US3, FR-016 to FR-019, FR-027, FR-029). `open_section_id` is the section
/// zoomed into (`None` for the overview), `section` its seats once loaded, `seat_view` how each
/// seat is shown, and `on_open_section` asks for another section or the whole map.
#[component]
pub fn VenueMap(
    map: Signal<VenueMap>,
    #[prop(optional)] color_by: ColorBy,
    open_section_id: Signal<Option<String>>,
    section: Signal<Option<VenueMapSection>>,
    on_open_section: Callback<Option<String>>,
    #[prop(optional)] seat_view: Option<Callback<MapSeatInfo, SeatView>>,
    #[prop(optional)] on_seat: Option<Callback<MapSeatInfo>>,
) -> impl IntoView {
    let tip = RwSignal::new(None::<String>);
    // A new frame only when it moves, not on each count change.
    let fit = Memo::new(move |_| map.with(fit_of_map));
    let pz = PanZoom::new(fit);
    let open_id = Memo::new(move |_| open_section_id.get());
    // The open section, if it is on the map: its id and name.
    let open = Memo::new(move |_| {
        let id = open_id.get();
        map.with(|m| open_section(m, id.as_deref()).map(|s| (s.section_id.clone(), s.name.clone())))
    });
    // Only when another section is opened, not when its counts change.
    Effect::watch(
        move || open_id.get(),
        move |id, _, _| {
            let outline =
                map.with_untracked(|m| open_section(m, id.as_deref()).map(|s| bounds(&s.outline)));
            match outline {
                Some(b) => pz.zoom_to(b),
                None => pz.fit_all(),
            }
            tip.set(None);
        },
        true,
    );

    // The open section's seats, once loaded for it.
    let seats = Memo::new(move |_| {
        let open = open.get()?;
        section.with(|s| {
            let s = s.as_ref().filter(|s| s.section_id == open.0)?;
            map.with(|m| {
                let view_of = seat_view.map(|cb| move |seat: &MapSeatInfo| cb.run(seat.clone()));
                let view_fn = view_of
                    .as_ref()
                    .map(|f| f as &dyn Fn(&MapSeatInfo) -> SeatView);
                Some(section_view(m, s, view_fn))
            })
        })
    });
    let seats_for = Memo::new(move |_| {
        seats
            .with(|s| s.is_some())
            .then(|| open.get().map(|o| o.0))
            .flatten()
    });
    let section_ids = Memo::new(move |_| {
        map.with(|m| {
            m.sections
                .iter()
                .map(|s| s.section_id.clone())
                .collect::<Vec<_>>()
        })
    });

    let labels = move || {
        // Section names are drawn at a steady size on screen as the map zooms.
        let font_size = label_font_size(&fit.get(), pz.zoom());
        let open = open_id.get();
        map.with(|m| section_labels(m, color_by, open.as_deref(), font_size))
            .into_iter()
            .map(|l| match l.counts {
                // FR-027: the admin's map shows "sold / open" under each section's name.
                Some(counts) => {
                    let (x1, x2) = (l.x.clone(), l.x.clone());
                    view! {
                        <text
                            class="venue-map__label"
                            x=l.x
                            y=l.y
                            font-size=l.font_size
                            text-anchor="middle"
                            dominant-baseline="central"
                            aria-hidden="true"
                        >
                            <tspan x=x1>{l.name}</tspan>
                            <tspan class="venue-map__label-counts" x=x2 dy=counts.dy>
                                {counts.text}
                            </tspan>
                        </text>
                    }
                    .into_any()
                }
                None => view! {
                    <text
                        class="venue-map__label"
                        x=l.x
                        y=l.y
                        font-size=l.font_size
                        text-anchor="middle"
                        dominant-baseline="central"
                        aria-hidden="true"
                    >
                        {l.name}
                    </text>
                }
                .into_any(),
            })
            .collect_view()
    };

    let on_tip = Callback::new(move |t: Option<String>| tip.set(t));
    let dragged = Callback::new(move |()| pz.dragged());

    view! {
        <div class="venue-map">
            <Legend map color_by/>
            <div class="venue-map__toolbar">
                {move || open.with(Option::is_some).then(|| view! {
                    <button type="button" class="btn" on:click=move |_| on_open_section.run(None)>
                        "Back to map"
                    </button>
                })}
                <button
                    type="button"
                    class="btn btn--ghost"
                    aria-label="Zoom in"
                    on:click=move |_| pz.zoom_in()
                >
                    "+"
                </button>
                <button
                    type="button"
                    class="btn btn--ghost"
                    aria-label="Zoom out"
                    on:click=move |_| pz.zoom_out()
                >
                    "−"
                </button>
                <button type="button" class="btn btn--ghost" on:click=move |_| pz.fit_all()>
                    "Fit map"
                </button>
            </div>
            {move || {
                let loading = seats_for.get().is_none();
                open.get()
                    .filter(|_| loading)
                    .map(|(_, name)| view! { <p class="note">{loading_note(&name)}</p> })
            }}
            // FR-019: a seat's section, row, seat, level and price, on hover and focus; its
            // accessible name already says it, so this is for the eyes only.
            <p class="venue-map__tip" aria-hidden="true">
                {move || tip.get().unwrap_or_else(|| " ".into())}
            </p>
            <svg
                node_ref=pz.node
                class="venue-map__svg"
                style:aspect-ratio=move || js_number(map_aspect(&fit.get()))
                role="group"
                aria-label=move || map.with(map_label)
                viewBox=move || pz.view_box()
                preserveAspectRatio="xMidYMid meet"
                on:pointerdown=move |e| pz.on_pointer_down(&e)
                on:pointermove=move |e| pz.on_pointer_move(&e)
                on:pointerup=move |e| pz.on_pointer_up(&e)
                on:pointercancel=move |e| pz.on_pointer_up(&e)
                on:keydown=move |e| pz.on_key_down(&e)
            >
                <rect
                    class="venue-map__bg"
                    x="0"
                    y="0"
                    width=move || map.with(|m| js_number(m.size.width as f64))
                    height=move || map.with(|m| js_number(m.size.height as f64))
                ></rect>
                {move || {
                    map.with(|m| match (&m.floor_outline, m.floor_kind) {
                        (Some(f), kind) if kind != FloorKind::None => Some(outline_path(f)),
                        _ => None,
                    })
                    .map(|d| view! { <path class="venue-map__floor" d=d></path> })
                }}
                <For each=move || section_ids.get() key=|id| id.clone() let:id>
                    <SectionShape map id color_by open_id pz on_open_section/>
                </For>
                {labels}
                {move || {
                    seats_for.get().map(|_| view! {
                        <SectionView drawing=seats on_tip dragged on_seat/>
                    })
                }}
            </svg>
        </div>
    }
}
