//! Spec 037 research R13 (task T063; parity M15): the seats of the one section zoomed into, as
//! `packages/shared/src/web/venue-map/section-view.tsx`. Each seat is a focusable
//! `<g role="button">` named "Row F, Seat 7, Courtside, $95, open", row labels at both ends of
//! each row; everything drawn comes from `core::seating::venue_map::section_view`. Rows and seats
//! are keyed, so a live change updates a seat in place and the keyboard's focus stays on it.

use admin_rust_core::seating::venue_map::{MapSeatInfo, SeatShape, SectionViewDrawing};
use leptos::prelude::*;

use super::legend::seat_mark_view;

fn with_seat<T>(
    drawing: Memo<Option<SectionViewDrawing>>,
    row: u64,
    seat: u64,
    f: impl FnOnce(&SeatShape) -> T,
) -> Option<T> {
    drawing.with(|d| {
        d.as_ref()?
            .rows
            .iter()
            .find(|r| r.number == row)?
            .seats
            .iter()
            .find(|s| s.seat.seat == seat)
            .map(f)
    })
}

#[component]
fn Seat(
    drawing: Memo<Option<SectionViewDrawing>>,
    row: u64,
    seat: u64,
    on_tip: Callback<Option<String>>,
    dragged: Callback<(), bool>,
    on_seat: Option<Callback<MapSeatInfo>>,
) -> impl IntoView {
    let get =
        move |f: fn(&SeatShape) -> String| with_seat(drawing, row, seat, f).unwrap_or_default();
    let choose = move || {
        let chosen = with_seat(drawing, row, seat, |s| {
            (!s.disabled).then(|| s.seat.clone())
        });
        if let (Some(Some(info)), Some(on_seat)) = (chosen, on_seat) {
            on_seat.run(info);
        }
    };
    let tip = move || on_tip.run(Some(get(|s| s.tip.clone())));
    view! {
        <g
            role="button"
            tabindex="0"
            aria-label=move || get(|s| s.name.clone())
            aria-pressed=move || {
                if with_seat(drawing, row, seat, |s| s.pressed).unwrap_or(false) { "true" } else { "false" }
            }
            aria-disabled=move || {
                with_seat(drawing, row, seat, |s| s.disabled).unwrap_or(false).then_some("true")
            }
            class=move || get(|s| s.class.clone())
            on:click=move |_| {
                if !dragged.run(()) {
                    choose();
                }
            }
            on:keydown=move |e| {
                if e.key() != "Enter" && e.key() != " " {
                    return;
                }
                e.prevent_default();
                e.stop_propagation();
                choose();
            }
            on:mouseenter=move |_| tip()
            on:mouseleave=move |_| on_tip.run(None)
            on:focus=move |_| tip()
            on:blur=move |_| on_tip.run(None)
        >
            {move || seat_mark_view(with_seat(drawing, row, seat, |s| s.marks.clone()).unwrap_or_default())}
        </g>
    }
}

#[component]
fn Row(
    drawing: Memo<Option<SectionViewDrawing>>,
    row: u64,
    on_tip: Callback<Option<String>>,
    dragged: Callback<(), bool>,
    on_seat: Option<Callback<MapSeatInfo>>,
) -> impl IntoView {
    let labels = move || {
        drawing.with(|d| {
            let Some(r) = d
                .as_ref()
                .and_then(|d| d.rows.iter().find(|r| r.number == row))
            else {
                return Vec::new();
            };
            r.label_ends
                .iter()
                .map(|(x, y)| (x.clone(), y.clone(), r.font_size.clone(), r.label.clone()))
                .collect()
        })
    };
    let seats = move || {
        drawing.with(|d| {
            d.as_ref()
                .and_then(|d| d.rows.iter().find(|r| r.number == row))
                .map(|r| r.seats.iter().map(|s| s.seat.seat).collect::<Vec<_>>())
                .unwrap_or_default()
        })
    };
    view! {
        <g class="venue-map__row">
            {move || {
                labels()
                    .into_iter()
                    .map(|(x, y, font_size, label)| view! {
                        <text
                            class="venue-map__row-label"
                            x=x
                            y=y
                            font-size=font_size
                            text-anchor="middle"
                            dominant-baseline="central"
                            aria-hidden="true"
                        >
                            {label}
                        </text>
                    })
                    .collect_view()
            }}
            <For each=seats key=|n| *n let:seat>
                <Seat drawing row seat on_tip dragged on_seat/>
            </For>
        </g>
    }
}

/// `SectionView` (spec 038 FR-018, FR-019): `<g class="venue-map__seats">` with a
/// `g.venue-map__row` per row. `on_tip` hears a seat's tip on hover and focus and `None` on
/// leaving; `dragged` says whether the press ending in a click was a drag of the map.
#[component]
pub fn SectionView(
    drawing: Memo<Option<SectionViewDrawing>>,
    on_tip: Callback<Option<String>>,
    dragged: Callback<(), bool>,
    on_seat: Option<Callback<MapSeatInfo>>,
) -> impl IntoView {
    let rows = move || {
        drawing.with(|d| {
            d.as_ref()
                .map(|d| d.rows.iter().map(|r| r.number).collect::<Vec<_>>())
                .unwrap_or_default()
        })
    };
    view! {
        <g class="venue-map__seats">
            <For each=rows key=|n| *n let:row>
                <Row drawing row on_tip dragged on_seat/>
            </For>
        </g>
    }
}
