//! Spec 039 research R2, R11 (parity LE21–LE35, LE44–LE47, LE60, LE61), port of
//! `admin-app/src/layout-editor/EditorCanvas.tsx` and `SectionSeatsView.tsx`, with the browser
//! glue of the shared `use-pan-zoom.ts` (research R13): the editor's map in an SVG, panned and
//! zoomed over its `viewBox`. Click selects a section, Shift-click adds or removes one; dragging a
//! selected section moves the selection, the round handle above it turns it (1°, Shift 15°), each
//! about its own origin; the floor object is dragged and resized by its corners. While dragging
//! only an SVG transform changes; letting go is one action, one Undo step. Each section is a
//! focusable button named with its level and seats. With the map focused, the arrow keys move the
//! selection (Shift 10), `[` and `]` turn it (Shift 15°), Escape clears it; without a selection
//! they pan and zoom. Zoomed into a section, its seats are drawn as buttons, with each row's label
//! at both ends, and Box select draws a box around seats.
//!
//! Every number (the fit, the snapping, the handles, the floor's stretch, the seat box, the pan and
//! zoom) comes from `core::editor::view` and `core::seating::pan_zoom`; this module holds only the
//! pointer, key, and animation glue.

use std::{
    collections::{BTreeSet, HashSet},
    sync::Arc,
    time::Duration,
};

use admin_rust_core::{
    editor::{
        doc::{EdLevel, EdSection, EditorDoc, FloorKind, Place, seat_level},
        state::{Action, Selection},
        view::{
            ACCESSIBLE_RADIUS, CORNERS, MapKey, ROW_LABEL_SIZE, SEAT_RADIUS, corner_box,
            degrees_of, delete_selection, handle_radius, level_color, map_fit, map_key, map_label,
            past_slop, row_click, row_label_ends, seat_click, seat_label, seats_in_box,
            section_font_size, section_label, selection_box, snap_turn, stretch_outline, tenth,
            turn_handle, view_center,
        },
    },
    seating::{
        map_geometry::{Bounds, Point, bounds, centroid, js_max, js_number, outline_path},
        pan_zoom::{
            MAX_ZOOM, Rect, View, animation_frame, client_to_map, drag_pan, is_drag, key_action,
            pinch_view, rect_or_fit, view_box, wheel_factor, zoom_at, zoom_by, zoom_to_target,
        },
    },
};
use leptos::{ev, prelude::*, svg};
use wasm_bindgen::JsCast;

use super::{Editor, guide::Guide, run_request, use_editor};

fn n(x: f64) -> String {
    js_number(x)
}

fn client(e: &web_sys::MouseEvent) -> Point {
    [f64::from(e.client_x()), f64::from(e.client_y())]
}

fn now_ms() -> f64 {
    window().performance().map_or(0.0, |p| p.now())
}

fn reduced_motion() -> bool {
    window()
        .match_media("(prefers-reduced-motion: reduce)")
        .ok()
        .flatten()
        .is_some_and(|m| m.matches())
}

// ------------------------------------------------------------------------------ pan and zoom

/// The shared `usePanZoom`'s glue: the view, the pointers, the animation.
#[derive(Clone, Copy)]
struct PanZoom {
    view: RwSignal<View>,
    fit: Memo<View>,
    svg: NodeRef<svg::Svg>,
    animation: StoredValue<u64>,
    pointers: StoredValue<Vec<(i32, Point)>>,
    pressed_at: StoredValue<Option<Point>>,
    was_drag: StoredValue<bool>,
    dragging: StoredValue<bool>,
    /// Hears the middle of the visible map, where a new section goes (FR-007).
    center: Option<StoredValue<Place>>,
}

impl PanZoom {
    fn new(fit: Memo<View>, svg: NodeRef<svg::Svg>, center: Option<StoredValue<Place>>) -> Self {
        let start = fit.get_untracked();
        if let Some(c) = center {
            c.set_value(view_center(&start));
        }
        PanZoom {
            view: RwSignal::new(start),
            fit,
            svg,
            animation: StoredValue::new(0),
            pointers: StoredValue::new(Vec::new()),
            pressed_at: StoredValue::new(None),
            was_drag: StoredValue::new(false),
            dragging: StoredValue::new(false),
            center,
        }
    }

    fn set_view(self, v: View) {
        if let Some(c) = self.center {
            c.set_value(view_center(&v));
        }
        self.view.set(v);
    }

    fn view_now(self) -> View {
        self.view.get_untracked()
    }

    fn fit_now(self) -> View {
        self.fit.get_untracked()
    }

    /// Any move by the person stops an animation on its way.
    fn stop(self) {
        self.animation.update_value(|a| *a += 1);
    }

    /// The SVG's box on screen, or one the fit's size when it has none.
    fn rect(self) -> Rect {
        let r = self.svg.get_untracked().map(|el| {
            let r = el.get_bounding_client_rect();
            Rect {
                left: r.left(),
                top: r.top(),
                width: r.width(),
                height: r.height(),
            }
        });
        rect_or_fit(r, &self.fit_now())
    }

    fn zoom_by(self, factor: f64) {
        self.stop();
        self.set_view(zoom_by(&self.view_now(), factor, &self.fit_now()));
    }

    fn animate_to(self, target: View) {
        self.animation.update_value(|a| *a += 1);
        let Some(id) = self.animation.try_get_value() else {
            return;
        };
        if reduced_motion() {
            self.set_view(target);
            return;
        }
        let from = self.view_now();
        let start = now_ms();
        fn step(pz: PanZoom, id: u64, from: View, target: View, start: f64) {
            if pz.animation.try_get_value() != Some(id) {
                return;
            }
            let (v, more) = animation_frame(&from, &target, now_ms() - start);
            pz.set_view(v);
            if more {
                request_animation_frame(move || step(pz, id, from, target, start));
            }
        }
        request_animation_frame(move || step(self, id, from, target, start));
    }

    /// A section's bounds with a margin (a tenth of its larger side unless given), animated.
    fn zoom_to(self, b: &Bounds, margin: Option<f64>) {
        self.animate_to(zoom_to_target(b, margin, &self.fit_now()));
    }

    /// The whole map, at once.
    fn fit_all(self) {
        self.stop();
        self.set_view(self.fit_now());
    }

    fn on_wheel(self, e: &web_sys::WheelEvent) {
        e.prevent_default();
        self.stop();
        let view = self.view_now();
        let at = client_to_map(&view, &self.rect(), client(e));
        self.set_view(zoom_at(
            &view,
            wheel_factor(e.delta_y(), e.delta_mode()),
            at,
            &self.fit_now(),
            MAX_ZOOM,
        ));
    }

    fn on_pointer_down(self, e: &web_sys::PointerEvent) {
        self.stop();
        let at = client(e);
        let id = e.pointer_id();
        self.pointers.update_value(|p| {
            p.retain(|(i, _)| *i != id);
            p.push((id, at));
        });
        if self.pointers.with_value(Vec::len) == 1 {
            self.pressed_at.set_value(Some(at));
            self.was_drag.set_value(false);
            self.dragging.set_value(false);
        }
    }

    fn on_pointer_move(self, e: &web_sys::PointerEvent) {
        let id = e.pointer_id();
        let Some(prev) = self
            .pointers
            .with_value(|p| p.iter().find(|(i, _)| *i == id).map(|(_, at)| *at))
        else {
            return;
        };
        let now = client(e);
        self.pointers.update_value(|p| {
            if let Some(entry) = p.iter_mut().find(|(i, _)| *i == id) {
                entry.1 = now;
            }
        });
        if self.pointers.with_value(Vec::len) >= 2 {
            self.dragging.set_value(true);
            let Some(other) = self
                .pointers
                .with_value(|p| p.iter().find(|(i, _)| *i != id).map(|(_, at)| *at))
            else {
                return;
            };
            self.set_view(pinch_view(
                &self.view_now(),
                &self.fit_now(),
                &self.rect(),
                [prev, other],
                [now, other],
            ));
            return;
        }
        if !self.dragging.get_value() {
            match self.pressed_at.get_value() {
                Some(p) if is_drag(p, now) => {}
                _ => return,
            }
            self.dragging.set_value(true);
            // Only now, so a plain click still reaches the section or seat it pressed.
            if let Some(el) = e
                .current_target()
                .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
            {
                let _ = el.set_pointer_capture(id);
            }
        }
        self.set_view(drag_pan(
            &self.view_now(),
            &self.rect(),
            prev,
            now,
            &self.fit_now(),
        ));
    }

    fn on_pointer_up(self, e: &web_sys::PointerEvent) {
        let id = e.pointer_id();
        self.pointers.update_value(|p| p.retain(|(i, _)| *i != id));
        if self.pointers.with_value(Vec::is_empty) {
            let was = self.dragging.get_value();
            self.was_drag.set_value(was);
            self.dragging.set_value(false);
            self.pressed_at.set_value(None);
            // The click that ends a drag comes in this same task; any later one must choose.
            if was {
                let was_drag = self.was_drag;
                set_timeout(move || was_drag.set_value(false), Duration::ZERO);
            }
        }
    }

    fn on_key_down(self, e: &web_sys::KeyboardEvent) {
        let Some(action) = key_action(&e.key()) else {
            return;
        };
        e.prevent_default();
        self.stop();
        self.set_view(action.apply(&self.view_now(), &self.fit_now()));
    }

    /// Whether a drag just ended, so the click that ends it chooses nothing.
    fn dragged(self) -> bool {
        self.was_drag.get_value()
    }
}

// ------------------------------------------------------------------------------ the canvas

/// A drag under way: what it moves, from where.
#[derive(Clone)]
enum Drag {
    Move {
        ids: Vec<String>,
        from: Place,
        client: Point,
        moved: bool,
    },
    Turn {
        ids: Vec<String>,
        center: Place,
        start: f64,
    },
    Floor {
        from: Place,
        client: Point,
        moved: bool,
    },
    Corner {
        fixed: Place,
    },
    Box {
        from: Place,
        add: bool,
    },
}

/// What the drag shows until it is let go: then it is one action (R11).
#[derive(Clone, Copy, PartialEq)]
enum Live {
    Move { dx: f64, dy: f64 },
    Turn { degrees: f64 },
    Floor { dx: f64, dy: f64 },
    Corner { b: Bounds },
    Box { from: Place, to: Place },
}

#[derive(Clone, Copy)]
struct Canvas {
    ed: Editor,
    pz: PanZoom,
    read_only: bool,
    drag: StoredValue<Option<Drag>>,
    live: RwSignal<Option<Live>>,
    box_select: RwSignal<bool>,
    zoom_section: Memo<Option<Arc<EdSection>>>,
}

impl Canvas {
    /// A pointer's place on the map.
    fn to_map(self, e: &web_sys::MouseEvent) -> Place {
        let view = self.pz.view_now();
        let r = self
            .pz
            .svg
            .get_untracked()
            .map(|el| el.get_bounding_client_rect());
        let rect = match r {
            Some(r) if r.width() > 0.0 && r.height() > 0.0 => Rect {
                left: r.left(),
                top: r.top(),
                width: r.width(),
                height: r.height(),
            },
            _ => Rect {
                left: 0.0,
                top: 0.0,
                width: view.width,
                height: view.height,
            },
        };
        client_to_map(&view, &rect, client(e))
    }

    fn capture(self, pointer_id: i32) {
        if let Some(el) = self.pz.svg.get_untracked() {
            let _ = el.set_pointer_capture(pointer_id);
        }
    }

    fn set_live(self, l: Option<Live>) {
        self.live.set(l);
    }

    fn press_section(self, e: &web_sys::PointerEvent, id: &str) {
        e.stop_propagation();
        if e.shift_key() {
            self.ed
                .dispatch(Action::ToggleSection { id: id.to_string() });
            return;
        }
        let selected: Vec<String> = self
            .ed
            .selection
            .with_untracked(|s| s.section_ids().to_vec());
        let is_selected = selected.iter().any(|s| s == id);
        let ids = if is_selected {
            selected
        } else {
            vec![id.to_string()]
        };
        if !is_selected {
            self.ed
                .dispatch(Action::SelectSections { ids: ids.clone() });
        }
        if self.read_only {
            return;
        }
        // Not captured yet: a click, or a double-click that zooms in, must still reach the
        // section. The pointer is taken once the drag moves.
        self.drag.set_value(Some(Drag::Move {
            ids,
            from: self.to_map(e),
            client: client(e),
            moved: false,
        }));
    }

    fn press_floor(self, e: &web_sys::PointerEvent) {
        if self.read_only {
            return;
        }
        e.stop_propagation();
        self.ed.dispatch(Action::SelectFloor);
        self.drag.set_value(Some(Drag::Floor {
            from: self.to_map(e),
            client: client(e),
            moved: false,
        }));
    }

    fn on_pointer_down(self, e: &web_sys::PointerEvent) {
        // Review B3: with Box select on in a zoomed section, a press anywhere not taken by a
        // seat or a row label starts the box, not a pan.
        if self.zoom_section.with_untracked(Option::is_some) && self.box_select.get_untracked() {
            self.drag.set_value(Some(Drag::Box {
                from: self.to_map(e),
                add: e.shift_key(),
            }));
            self.capture(e.pointer_id());
            return;
        }
        self.pz.on_pointer_down(e);
    }

    fn on_pointer_move(self, e: &web_sys::PointerEvent) {
        let Some(d) = self.drag.get_value() else {
            self.pz.on_pointer_move(e);
            return;
        };
        let at = self.to_map(e);
        match d {
            Drag::Move {
                from,
                client: c,
                moved,
                ..
            }
            | Drag::Floor {
                from,
                client: c,
                moved,
            } => {
                if !moved && !past_slop(c, client(e)) {
                    return;
                }
                if !moved {
                    self.capture(e.pointer_id());
                }
                let floor = matches!(d, Drag::Floor { .. });
                self.drag.update_value(|d| {
                    if let Some(Drag::Move { moved, .. } | Drag::Floor { moved, .. }) = d {
                        *moved = true;
                    }
                });
                let (dx, dy) = (at[0] - from[0], at[1] - from[1]);
                self.set_live(Some(if floor {
                    Live::Floor { dx, dy }
                } else {
                    Live::Move { dx, dy }
                }));
            }
            Drag::Turn { center, start, .. } => {
                self.set_live(Some(Live::Turn {
                    degrees: snap_turn(center, start, at, e.shift_key()),
                }));
            }
            Drag::Box { from, .. } => self.set_live(Some(Live::Box { from, to: at })),
            Drag::Corner { fixed } => self.set_live(Some(Live::Corner {
                b: corner_box(fixed, at),
            })),
        }
    }

    fn on_pointer_up(self, e: &web_sys::PointerEvent) {
        self.pz.on_pointer_up(e);
        let d = self.drag.get_value();
        self.drag.set_value(None);
        let shown = self.live.get_untracked();
        self.set_live(None);
        let (Some(d), Some(shown)) = (d, shown) else {
            return;
        };
        let ed = self.ed;
        match (d, shown) {
            (Drag::Move { ids, .. }, Live::Move { dx, dy }) => ed.dispatch(Action::MoveSections {
                ids,
                dx: tenth(dx),
                dy: tenth(dy),
            }),
            (Drag::Floor { .. }, Live::Floor { dx, dy }) => ed.dispatch(Action::MoveFloor {
                dx: tenth(dx),
                dy: tenth(dy),
            }),
            (Drag::Turn { ids, .. }, Live::Turn { degrees }) => {
                ed.dispatch(Action::TurnSections { ids, degrees });
            }
            (Drag::Box { add, .. }, Live::Box { from, to }) => {
                if let Some(z) = self.zoom_section.get_untracked() {
                    ed.dispatch(Action::SelectSeats {
                        section_id: z.id.clone(),
                        ids: seats_in_box(&z, from, to),
                        add,
                    });
                }
            }
            (Drag::Corner { .. }, Live::Corner { b }) => ed.dispatch(Action::ResizeFloor {
                to: Bounds {
                    x: tenth(b.x),
                    y: tenth(b.y),
                    width: tenth(b.width),
                    height: tenth(b.height),
                },
            }),
            _ => {}
        }
    }

    fn on_key_down(self, e: &web_sys::KeyboardEvent) {
        // The map itself, or a section on it: a keyboard user who chose a section with Space
        // moves and turns it from there.
        let target = e.target();
        let on_section = target
            .clone()
            .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
            .and_then(|el| el.closest(".editor-map__section").ok().flatten())
            .is_some();
        if target != e.current_target() && !on_section {
            return;
        }
        let ed = self.ed;
        let selection = ed.selection.get_untracked();
        let ids = selection.section_ids().to_vec();
        match map_key(
            &e.key(),
            e.shift_key(),
            self.read_only,
            self.zoom_section.with_untracked(Option::is_some),
            !ids.is_empty(),
        ) {
            MapKey::Clear => ed.dispatch(Action::ClearSelection),
            MapKey::Delete => {
                e.prevent_default();
                let req = ed.doc.with_untracked(|d| delete_selection(d, &selection));
                run_request(ed, req);
            }
            MapKey::Move { dx, dy } => {
                e.prevent_default();
                ed.dispatch(Action::MoveSections { ids, dx, dy });
            }
            MapKey::Turn { degrees } => {
                e.prevent_default();
                ed.dispatch(Action::TurnSections { ids, degrees });
            }
            MapKey::PanZoom => self.pz.on_key_down(e),
        }
    }
}

fn section_of(doc: &EditorDoc, id: &str) -> Option<Arc<EdSection>> {
    doc.sections.iter().find(|s| s.id == id).cloned()
}

fn ptr_changed<T>(a: Option<&Option<Arc<T>>>, b: Option<&Option<Arc<T>>>) -> bool {
    match (a, b) {
        (Some(Some(a)), Some(Some(b))) => !Arc::ptr_eq(a, b),
        (Some(None), Some(None)) => false,
        _ => true,
    }
}

#[component]
pub fn EditorCanvas(
    read_only: bool,
    /// Sections drawn with a warning outline (overlaps, R15).
    #[prop(optional)]
    warned: Option<RwSignal<BTreeSet<String>>>,
    /// Hears the middle of the visible map, where a new section goes (FR-007).
    #[prop(optional)]
    center: Option<StoredValue<Place>>,
) -> impl IntoView {
    let ed = use_editor();
    let fit = Memo::new(move |_| ed.doc.with(|d| map_fit(d)));
    let svg_ref = NodeRef::<svg::Svg>::new();
    let pz = PanZoom::new(fit, svg_ref, center);
    let zoom_section = Memo::new_with_compare(
        move |_| {
            ed.zoomed
                .get()
                .and_then(|id| ed.doc.with(|d| section_of(d, &id)))
        },
        ptr_changed,
    );
    let zoomed_in = Memo::new(move |_| zoom_section.with(Option::is_some));
    let cv = Canvas {
        ed,
        pz,
        read_only,
        drag: StoredValue::new(None),
        live: RwSignal::new(None),
        box_select: RwSignal::new(false),
        zoom_section,
    };
    let live = cv.live;
    let floor_kind = Memo::new(move |_| ed.doc.with(|d| d.floor.kind));

    // A different map: start again at its fit (`usePanZoom`). Zooming into a section shows it
    // whole, out the whole map at once. A floor object just chosen (put down in the middle of the
    // view and selected) is shown whole with room around it; opening a layout never moves the view.
    Effect::new(move |prev: Option<(View, Option<String>, FloorKind)>| {
        let f = fit.get();
        let z = ed.zoomed.get();
        let kind = floor_kind.get();
        if let Some((pf, pzoom, pkind)) = prev {
            if f != pf {
                pz.animation.update_value(|a| *a += 1);
                pz.set_view(f);
            }
            if z != pzoom {
                match zoom_section.get_untracked() {
                    Some(s) if z.is_some() => pz.zoom_to(&bounds(&s.outline), Some(4.0)),
                    _ => pz.fit_all(),
                }
            }
            if kind != pkind {
                let chosen = ed.selection.with_untracked(|s| *s == Selection::Floor);
                let outline = ed.doc.with_untracked(|d| d.floor.outline.clone());
                if let (true, Some(o)) = (chosen, outline) {
                    let b = bounds(&o);
                    pz.zoom_to(&b, Some(js_max([b.width, b.height]) / 4.0));
                }
            }
        }
        (f, z, kind)
    });

    let sel_box = Memo::new(move |_| {
        ed.doc
            .with(|d| ed.selection.with(|s| selection_box(d, s, zoomed_in.get())))
    });
    let floor_selected = Memo::new(move |_| ed.selection.with(|s| *s == Selection::Floor));
    // The floor, as the drag shows it.
    let floor = Memo::new(move |_| {
        ed.doc.with(|d| {
            d.floor.outline.as_ref().map(|o| match live.get() {
                Some(Live::Corner { b }) => stretch_outline(o, &b),
                _ => o.clone(),
            })
        })
    });
    let floor_shift = Memo::new(move |_| match live.get() {
        Some(Live::Floor { dx, dy }) => Some(format!("translate({} {})", n(dx), n(dy))),
        _ => None,
    });
    let handle_r = Memo::new(move |_| handle_radius(&pz.view.get()));
    let section_ids = move || {
        ed.doc
            .with(|d| d.sections.iter().map(|s| s.id.clone()).collect::<Vec<_>>())
    };
    // The zoomed section's seats are drawn again when it or the levels change.
    let seats_of = Memo::new_with_compare(
        move |_| {
            zoom_section
                .get()
                .map(|z| (z, ed.doc.with(|d| d.levels.clone())))
        },
        |a: Option<&Option<(Arc<EdSection>, Vec<EdLevel>)>>, b| match (a, b) {
            (Some(Some(a)), Some(Some(b))) => !Arc::ptr_eq(&a.0, &b.0) || a.1 != b.1,
            (Some(None), Some(None)) => false,
            _ => true,
        },
    );

    view! {
        <div class="editor-map-wrap">
            <div class="editor-map__toolbar" role="group" aria-label="Zoom">
                <button type="button" class="btn" on:click=move |_| pz.zoom_by(1.5)>"Zoom in"</button>
                <button type="button" class="btn" on:click=move |_| pz.zoom_by(1.0 / 1.5)>"Zoom out"</button>
                <button type="button" class="btn" on:click=move |_| pz.fit_all()>"Fit"</button>
                {move || zoomed_in.get().then(|| view! {
                    <button
                        type="button"
                        class="btn"
                        aria-pressed=move || cv.box_select.get().to_string()
                        on:click=move |_| cv.box_select.update(|b| *b = !*b)
                    >
                        "Box select"
                    </button>
                    <button
                        type="button"
                        class="btn"
                        on:click=move |_| ed.dispatch(Action::Zoom { id: None })
                    >
                        "Back to layout"
                    </button>
                })}
            </div>
            {(!read_only).then(|| view! { <Guide zoomed=zoomed_in/> })}
            <svg
                node_ref=svg_ref
                class="editor-map"
                role="application"
                aria-label=move || ed.doc.with(|d| map_label(d.sections.len()))
                aria-roledescription="layout map"
                tabindex="0"
                viewBox=move || view_box(&pz.view.get())
                preserveAspectRatio="xMidYMid meet"
                on:pointerdown=move |e| cv.on_pointer_down(&e)
                on:pointermove=move |e| cv.on_pointer_move(&e)
                on:pointerup=move |e| cv.on_pointer_up(&e)
                on:pointercancel=move |e| cv.on_pointer_up(&e)
                on:keydown=move |e| cv.on_key_down(&e)
                on:wheel=move |e: ev::WheelEvent| pz.on_wheel(&e)
            >
                <rect
                    class="editor-map__bg"
                    x=move || n(fit.get().x)
                    y=move || n(fit.get().y)
                    width=move || n(fit.get().width)
                    height=move || n(fit.get().height)
                    on:click=move |_| {
                        if !pz.dragged() {
                            ed.dispatch(Action::ClearSelection);
                        }
                    }
                />
                {move || floor.get().map(|f| view! {
                    <path
                        class=move || if floor_selected.get() {
                            "editor-map__floor editor-map__floor--selected"
                        } else {
                            "editor-map__floor"
                        }
                        d=outline_path(&f)
                        transform=move || floor_shift.get()
                        on:pointerdown=move |e| cv.press_floor(&e)
                    />
                })}
                {move || zoom_section.get().map(|z| ed.doc.with(|d| {
                    d.sections.iter().map(|s| {
                        if s.id == z.id {
                            view! {
                                <path class="editor-map__current" d=outline_path(&s.outline) aria-hidden="true"/>
                            }.into_any()
                        } else {
                            view! {
                                <path
                                    class=format!("editor-map__faded venue-map--{}", level_color(d, &s.level_id))
                                    d=outline_path(&s.outline)
                                    aria-hidden="true"
                                />
                            }.into_any()
                        }
                    }).collect_view()
                }))}
                {move || seats_of.get().map(|(z, _)| {
                    let doc = ed.doc.get_untracked();
                    view! { <SectionSeats doc=doc section=z/> }
                })}
                {move || (!zoomed_in.get()).then(|| view! {
                    <For each=section_ids key=|id| id.clone() let:id>
                        <SectionShape id=id cv=cv fit=fit warned=warned/>
                    </For>
                })}
                {move || sel_box.get().map(|b| view! {
                    <rect
                        class="editor-map__selection"
                        x=n(b.x - 1.0)
                        y=n(b.y - 1.0)
                        width=n(b.width + 2.0)
                        height=n(b.height + 2.0)
                        transform=move || match live.get() {
                            Some(Live::Move { dx, dy }) => Some(format!("translate({} {})", n(dx), n(dy))),
                            _ => None,
                        }
                        aria-hidden="true"
                    />
                })}
                {move || {
                    if read_only {
                        return None;
                    }
                    let b = sel_box.get()?;
                    let h = turn_handle(&b, &pz.view.get());
                    let r = handle_r.get();
                    Some(view! {
                        <g aria-hidden="true">
                            <line
                                class="editor-map__turn-line"
                                x1=n(h.line_from[0])
                                y1=n(h.line_from[1])
                                x2=n(h.at[0])
                                y2=n(h.at[1])
                            />
                            <circle
                                class="editor-map__turn"
                                cx=n(h.at[0])
                                cy=n(h.at[1])
                                r=n(r)
                                on:pointerdown=move |e| {
                                    e.stop_propagation();
                                    let ids = ed.selection.with_untracked(|s| s.section_ids().to_vec());
                                    cv.drag.set_value(Some(Drag::Turn {
                                        ids,
                                        center: h.center,
                                        start: degrees_of(h.center, cv.to_map(&e)),
                                    }));
                                    cv.capture(e.pointer_id());
                                }
                            />
                        </g>
                    })
                }}
                {move || match live.get() {
                    Some(Live::Box { from, to }) => Some(view! {
                        <rect
                            class="editor-map__box"
                            x=n(from[0].min(to[0]))
                            y=n(from[1].min(to[1]))
                            width=n((to[0] - from[0]).abs())
                            height=n((to[1] - from[1]).abs())
                            aria-hidden="true"
                        />
                    }),
                    _ => None,
                }}
                {move || {
                    if read_only || !floor_selected.get() || floor_shift.with(Option::is_some) {
                        return None;
                    }
                    let fb = floor.with(|f| f.as_ref().map(|f| bounds(f)))?;
                    let r = handle_r.get();
                    Some(view! {
                        <g aria-hidden="true">
                            {CORNERS.iter().map(|c| {
                                let [x, y] = c.at(&fb);
                                let fixed = c.opposite().at(&fb);
                                view! {
                                    <rect
                                        class="editor-map__corner"
                                        data-corner=c.as_str()
                                        x=n(x - r)
                                        y=n(y - r)
                                        width=n(r * 2.0)
                                        height=n(r * 2.0)
                                        on:pointerdown=move |e| {
                                            e.stop_propagation();
                                            cv.drag.set_value(Some(Drag::Corner { fixed }));
                                            cv.capture(e.pointer_id());
                                        }
                                    />
                                }
                            }).collect_view()}
                        </g>
                    })
                }}
            </svg>
        </div>
    }
}

/// One section on the map: a focusable button named with its level and seats (LE24–LE29).
#[component]
fn SectionShape(
    id: String,
    cv: Canvas,
    fit: Memo<View>,
    warned: Option<RwSignal<BTreeSet<String>>>,
) -> impl IntoView {
    let ed = cv.ed;
    let sid = id.clone();
    let section =
        Memo::new_with_compare(move |_| ed.doc.with(|d| section_of(d, &sid)), ptr_changed);
    let sid = id.clone();
    let selected = Memo::new(move |_| ed.selection.with(|s| s.section_ids().contains(&sid)));
    let sid = id.clone();
    let is_warned = Memo::new(move |_| warned.is_some_and(|w| w.with(|w| w.contains(&sid))));
    let live = cv.live;
    let (press, dbl, key) = (id.clone(), id.clone(), id);
    let outline = move || {
        section.with(|s| {
            s.as_ref()
                .map(|s| outline_path(&s.outline))
                .unwrap_or_default()
        })
    };
    let label_at = Memo::new(move |_| {
        section.with(|s| s.as_ref().map_or([0.0, 0.0], |s| centroid(&s.outline)))
    });
    view! {
        <g
            role="button"
            tabindex="0"
            aria-pressed=move || selected.get().to_string()
            aria-label=move || {
                section.with(|s| s.as_ref().map(|s| ed.doc.with(|d| section_label(d, s))).unwrap_or_default())
            }
            class=move || format!(
                "editor-map__section{}{}",
                if selected.get() { " editor-map__section--selected" } else { "" },
                if is_warned.get() { " editor-map__section--warn" } else { "" },
            )
            transform=move || {
                if !selected.get() {
                    return None;
                }
                let origin = section.with(|s| s.as_ref().map_or([0.0, 0.0], |s| s.origin));
                match live.get() {
                    Some(Live::Move { dx, dy }) => Some(format!("translate({} {})", n(dx), n(dy))),
                    Some(Live::Turn { degrees }) => Some(format!(
                        "rotate({} {} {})",
                        n(degrees),
                        n(origin[0]),
                        n(origin[1]),
                    )),
                    _ => None,
                }
            }
            on:pointerdown=move |e| cv.press_section(&e, &press)
            on:dblclick=move |_| ed.dispatch(Action::Zoom { id: Some(dbl.clone()) })
            on:keydown=move |e: ev::KeyboardEvent| {
                let k = e.key();
                if k != " " && k != "Enter" {
                    return;
                }
                e.prevent_default();
                e.stop_propagation();
                // R11: Enter zooms into the section, Space selects it (Shift adds).
                if k == "Enter" {
                    ed.dispatch(Action::Zoom { id: Some(key.clone()) });
                    return;
                }
                ed.dispatch(if e.shift_key() {
                    Action::ToggleSection { id: key.clone() }
                } else {
                    Action::SelectSections { ids: vec![key.clone()] }
                });
            }
        >
            <path
                class=move || {
                    section.with(|s| {
                        let level = s.as_ref().map(|s| s.level_id.clone()).unwrap_or_default();
                        ed.doc.with(|d| format!("venue-map--{}", level_color(d, &level)))
                    })
                }
                d=outline
            />
            <text
                class="editor-map__label"
                x=move || n(label_at.get()[0])
                y=move || n(label_at.get()[1])
                font-size=move || n(section_font_size(&fit.get()))
                text-anchor="middle"
                dominant-baseline="central"
                aria-hidden="true"
            >
                {move || section.with(|s| s.as_ref().map(|s| s.name.clone()).unwrap_or_default())}
            </text>
        </g>
    }
}

/// `SectionSeatsView`: the seats of the section zoomed into, each at its place in its level's
/// color, with the row's label at both ends of each row (LE44–LE47). Seats are not tab stops: the
/// Selection panel's row and seat lists are the keyboard path (FR-026).
#[component]
fn SectionSeats(doc: Arc<EditorDoc>, section: Arc<EdSection>) -> impl IntoView {
    let ed = use_editor();
    let sid = section.id.clone();
    let on = Memo::new(move |_| {
        ed.selection.with(|s| {
            let empty = HashSet::new;
            match s {
                Selection::Rows { section_id, ids } if *section_id == sid => {
                    (ids.iter().cloned().collect::<HashSet<String>>(), empty())
                }
                Selection::Seats { section_id, ids } if *section_id == sid => {
                    (empty(), ids.iter().cloned().collect())
                }
                _ => (empty(), empty()),
            }
        })
    });
    let rows = section
        .rows
        .iter()
        .map(|row| {
            let rid = row.id.clone();
            let row_on = Memo::new(move |_| on.with(|(rows, _)| rows.contains(&rid)));
            let label_class = move || {
                if row_on.get() {
                    "editor-map__row-label editor-map__row-label--selected"
                } else {
                    "editor-map__row-label"
                }
            };
            let ends = row_label_ends(row)
                .into_iter()
                .enumerate()
                .map(|(i, [x, y])| {
                    let (sid, rid) = (section.id.clone(), row.id.clone());
                    let press = move |e: web_sys::PointerEvent| {
                        e.stop_propagation();
                        ed.dispatch(row_click(&sid, &rid, e.shift_key()));
                    };
                    // The first end is the row's button; the second repeats it for the pointer.
                    if i == 0 {
                        view! {
                            <text
                                class=label_class
                                x=n(x)
                                y=n(y)
                                font-size=n(ROW_LABEL_SIZE)
                                text-anchor="middle"
                                dominant-baseline="central"
                                role="button"
                                aria-label=format!("Row {}", row.label)
                                aria-pressed=move || row_on.get().to_string()
                                on:pointerdown=press
                            >
                                {row.label.clone()}
                            </text>
                        }
                        .into_any()
                    } else {
                        view! {
                            <text
                                class=label_class
                                x=n(x)
                                y=n(y)
                                font-size=n(ROW_LABEL_SIZE)
                                text-anchor="middle"
                                dominant-baseline="central"
                                aria-hidden="true"
                                on:pointerdown=press
                            >
                                {row.label.clone()}
                            </text>
                        }
                        .into_any()
                    }
                })
                .collect_view();
            let seats = row
                .seats
                .iter()
                .map(|s| {
                    let level = seat_level(&section, row, s);
                    let qid = s.id.clone();
                    let pressed = Memo::new(move |_| on.with(|(_, seats)| seats.contains(&qid)) || row_on.get());
                    let (sid, qid) = (section.id.clone(), s.id.clone());
                    view! {
                        <g
                            role="button"
                            tabindex="-1"
                            aria-pressed=move || pressed.get().to_string()
                            aria-label=seat_label(&doc, &section, row, s)
                            class=move || if pressed.get() {
                                "editor-map__seat editor-map__seat--selected"
                            } else {
                                "editor-map__seat"
                            }
                            on:pointerdown=move |e: web_sys::PointerEvent| {
                                e.stop_propagation();
                                ed.dispatch(seat_click(&sid, &qid, e.shift_key()));
                            }
                        >
                            <circle
                                class=format!("editor-map__dot venue-map--{}", level_color(&doc, level))
                                cx=n(s.at[0])
                                cy=n(s.at[1])
                                r=n(SEAT_RADIUS)
                            />
                            {s.accessible.then(|| view! {
                                <circle
                                    class="editor-map__accessible"
                                    cx=n(s.at[0])
                                    cy=n(s.at[1])
                                    r=n(ACCESSIBLE_RADIUS)
                                />
                            })}
                        </g>
                    }
                })
                .collect_view();
            view! {
                <g class="editor-map__row">
                    {ends}
                    {seats}
                </g>
            }
        })
        .collect_view();
    view! { <g class="editor-map__seats">{rows}</g> }
}
