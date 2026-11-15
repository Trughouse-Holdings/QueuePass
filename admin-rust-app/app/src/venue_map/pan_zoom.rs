//! Spec 037 research R13 (task T063; parity M14): the venue map's pan and zoom, the browser glue
//! of `packages/shared/src/web/venue-map/use-pan-zoom.ts`. Pointer events with
//! `setPointerCapture` (only once a press moves 4 px, so a plain click still reaches its section
//! or seat), a non-passive `wheel` listener, two-pointer pinch, the keys, `prefers-reduced-motion`,
//! and `requestAnimationFrame` for the 200 ms zoom to a section live here; every number comes
//! from `core::seating::pan_zoom`.

use std::time::Duration;

use admin_rust_core::seating::{
    map_geometry::{Bounds, Point},
    pan_zoom::{
        MAX_ZOOM, Rect, STEP, View, animation_frame, client_to_map, drag_pan, is_drag, key_action,
        pinch_view, rect_or_fit, view_box, wheel_factor, zoom_at, zoom_by, zoom_of, zoom_to_target,
    },
};
use leptos::{prelude::*, svg::Svg};
use wasm_bindgen::{JsCast, closure::Closure};

/// `reducedMotion()`: whether the device asks for reduced motion, read when an animation starts.
pub fn reduced_motion() -> bool {
    window()
        .match_media("(prefers-reduced-motion: reduce)")
        .ok()
        .flatten()
        .is_some_and(|list| list.matches())
}

/// `useMediaQuery` (`admin-app/src/layout-editor/use-media.ts`): whether a media query matches,
/// following it as it changes (`prefers-reduced-motion`, the 640 px phone width), for as long as
/// the calling view lives.
pub fn use_media_query(query: &str) -> RwSignal<bool> {
    let list = window().match_media(query).ok().flatten();
    let matches = RwSignal::new(list.as_ref().is_some_and(|l| l.matches()));
    let Some(list) = list else {
        return matches;
    };
    let watched = list.clone();
    let on_change = Closure::<dyn Fn()>::new(move || {
        matches.try_set(watched.matches());
    });
    let _ = list.add_event_listener_with_callback("change", on_change.as_ref().unchecked_ref());
    let held = StoredValue::new_local(Some((list, on_change)));
    on_cleanup(move || {
        if let Some(Some((list, on_change))) = held.try_update_value(Option::take) {
            let _ = list
                .remove_event_listener_with_callback("change", on_change.as_ref().unchecked_ref());
        }
    });
    matches
}

fn now() -> f64 {
    window()
        .performance()
        .map_or_else(js_sys::Date::now, |p| p.now())
}

/// `usePanZoom`'s handle: copyable, so the view's event handlers can share it.
#[derive(Clone, Copy)]
pub struct PanZoom {
    view: RwSignal<View>,
    fit: Memo<View>,
    /// The SVG element: its size on screen, the pointer capture, and the wheel.
    pub node: NodeRef<Svg>,
    /// Bumped by any move of the person, so an animation on its way stops.
    animation: StoredValue<u64>,
    pointers: StoredValue<Vec<(i32, Point)>>,
    pressed_at: StoredValue<Option<Point>>,
    was_drag: StoredValue<bool>,
    dragging: StoredValue<bool>,
}

impl PanZoom {
    /// `usePanZoom(fit)`: the view starts at the fit and starts again there whenever the fit
    /// moves (a different map).
    pub fn new(fit: Memo<View>) -> Self {
        let pz = PanZoom {
            view: RwSignal::new(fit.get_untracked()),
            fit,
            node: NodeRef::new(),
            animation: StoredValue::new(0),
            pointers: StoredValue::new(Vec::new()),
            pressed_at: StoredValue::new(None),
            was_drag: StoredValue::new(false),
            dragging: StoredValue::new(false),
        };
        Effect::watch(
            move || fit.get(),
            move |f, _, _| {
                pz.stop();
                pz.view.set(*f);
            },
            false,
        );
        pz.listen_wheel();
        pz
    }

    /// Not React's `onWheel`, which is passive: the page must not scroll under the map.
    fn listen_wheel(self) {
        let listener = StoredValue::new_local(
            None::<(web_sys::Element, Closure<dyn Fn(web_sys::WheelEvent)>)>,
        );
        Effect::new(move |_| {
            let Some(el) = self.node.get() else { return };
            if listener.with_value(Option::is_some) {
                return;
            }
            let el: web_sys::Element = el.unchecked_into();
            let on_wheel =
                Closure::<dyn Fn(web_sys::WheelEvent)>::new(move |e: web_sys::WheelEvent| {
                    self.on_wheel(&e)
                });
            let options = web_sys::AddEventListenerOptions::new();
            options.set_passive(false);
            let _ = el.add_event_listener_with_callback_and_add_event_listener_options(
                "wheel",
                on_wheel.as_ref().unchecked_ref(),
                &options,
            );
            listener.set_value(Some((el, on_wheel)));
        });
        on_cleanup(move || {
            if let Some(Some((el, on_wheel))) = listener.try_update_value(Option::take) {
                let _ = el.remove_event_listener_with_callback(
                    "wheel",
                    on_wheel.as_ref().unchecked_ref(),
                );
            }
        });
    }

    fn stop(&self) {
        self.animation.update_value(|n| *n += 1);
    }

    fn rect(&self) -> Rect {
        let rect = self.node.get_untracked().map(|el| {
            let r = el.get_bounding_client_rect();
            Rect {
                left: r.left(),
                top: r.top(),
                width: r.width(),
                height: r.height(),
            }
        });
        rect_or_fit(rect, &self.fit.get_untracked())
    }

    /// The view as the SVG's `viewBox`, each number to a thousandth.
    pub fn view_box(&self) -> String {
        view_box(&self.view.get())
    }

    /// 1 at the fit, up to 40.
    pub fn zoom(&self) -> f64 {
        zoom_of(&self.view.get(), &self.fit.get())
    }

    fn zoom_by(&self, factor: f64) {
        self.stop();
        let next = zoom_by(
            &self.view.get_untracked(),
            factor,
            &self.fit.get_untracked(),
        );
        self.view.set(next);
    }

    pub fn zoom_in(&self) {
        self.zoom_by(STEP);
    }

    pub fn zoom_out(&self) {
        self.zoom_by(1.0 / STEP);
    }

    /// The whole map, at once: the Fit button, and Back to map.
    pub fn fit_all(&self) {
        self.stop();
        self.view.set(self.fit.get_untracked());
    }

    /// A section's bounds with a tenth of its larger side around them, animated over 200 ms
    /// (at once under reduced motion).
    pub fn zoom_to(&self, bounds: Bounds) {
        let target = zoom_to_target(&bounds, None, &self.fit.get_untracked());
        self.animate_to(target);
    }

    fn animate_to(&self, target: View) {
        self.animation.update_value(|n| *n += 1);
        let id = self.animation.get_value();
        if reduced_motion() {
            self.view.set(target);
            return;
        }
        let from = self.view.get_untracked();
        let start = now();
        let pz = *self;
        request_animation_frame(move || pz.frame(id, from, target, start));
    }

    fn frame(self, id: u64, from: View, target: View, start: f64) {
        // Stopped by the person, or the map is gone.
        if self.animation.try_get_value() != Some(id) {
            return;
        }
        let (view, more) = animation_frame(&from, &target, now() - start);
        self.view.set(view);
        if more {
            request_animation_frame(move || self.frame(id, from, target, start));
        }
    }

    fn on_wheel(&self, e: &web_sys::WheelEvent) {
        e.prevent_default();
        self.stop();
        let view = self.view.get_untracked();
        let fit = self.fit.get_untracked();
        let at = client_to_map(
            &view,
            &self.rect(),
            [e.client_x() as f64, e.client_y() as f64],
        );
        self.view.set(zoom_at(
            &view,
            wheel_factor(e.delta_y(), e.delta_mode()),
            at,
            &fit,
            MAX_ZOOM,
        ));
    }

    pub fn on_pointer_down(&self, e: &web_sys::PointerEvent) {
        self.stop();
        let id = e.pointer_id();
        let at = [e.client_x() as f64, e.client_y() as f64];
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

    pub fn on_pointer_move(&self, e: &web_sys::PointerEvent) {
        let id = e.pointer_id();
        let Some(prev) = self
            .pointers
            .with_value(|p| p.iter().find(|(i, _)| *i == id).map(|(_, at)| *at))
        else {
            return;
        };
        let now = [e.client_x() as f64, e.client_y() as f64];
        self.pointers.update_value(|p| {
            if let Some(entry) = p.iter_mut().find(|(i, _)| *i == id) {
                entry.1 = now;
            }
        });
        let fit = self.fit.get_untracked();
        if self.pointers.with_value(Vec::len) >= 2 {
            self.dragging.set_value(true);
            let Some(other) = self
                .pointers
                .with_value(|p| p.iter().find(|(i, _)| *i != id).map(|(_, at)| *at))
            else {
                return;
            };
            let next = pinch_view(
                &self.view.get_untracked(),
                &fit,
                &self.rect(),
                [prev, other],
                [now, other],
            );
            self.view.set(next);
            return;
        }
        if !self.dragging.get_value() {
            match self.pressed_at.get_value() {
                Some(pressed) if is_drag(pressed, now) => {}
                _ => return,
            }
            self.dragging.set_value(true);
            // Only now, so a plain click still reaches the section or seat it pressed.
            if let Some(el) = self.node.get_untracked() {
                let el: &web_sys::Element = el.unchecked_ref();
                let _ = el.set_pointer_capture(id);
            }
        }
        let next = drag_pan(&self.view.get_untracked(), &self.rect(), prev, now, &fit);
        self.view.set(next);
    }

    pub fn on_pointer_up(&self, e: &web_sys::PointerEvent) {
        let id = e.pointer_id();
        self.pointers.update_value(|p| p.retain(|(i, _)| *i != id));
        if self.pointers.with_value(Vec::is_empty) {
            let was_drag = self.dragging.get_value();
            self.was_drag.set_value(was_drag);
            self.dragging.set_value(false);
            self.pressed_at.set_value(None);
            // The click that ends a drag comes in this same task; any later one (a screen
            // reader's activation, with no press) must choose, so the mark lasts only until then.
            if was_drag {
                let flag = self.was_drag;
                set_timeout(
                    move || {
                        flag.try_set_value(false);
                    },
                    Duration::ZERO,
                );
            }
        }
    }

    /// `+` `=` in, `-` `−` `_` out, the arrows pan a tenth of the view; each `preventDefault`.
    pub fn on_key_down(&self, e: &web_sys::KeyboardEvent) {
        let Some(action) = key_action(&e.key()) else {
            return;
        };
        e.prevent_default();
        self.stop();
        let next = action.apply(&self.view.get_untracked(), &self.fit.get_untracked());
        self.view.set(next);
    }

    /// Whether a drag just ended, so the click that ends it chooses nothing.
    pub fn dragged(&self) -> bool {
        self.was_drag.try_get_value().unwrap_or(false)
    }
}
