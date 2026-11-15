//! Spec 037 research R13 (T032): the venue map's pan and zoom over the SVG `viewBox`, ported from
//! `packages/shared/src/web/venue-map/use-pan-zoom.ts` (038 R13, FR-018), with `fitOf` and the
//! map's shape and label size from `venue-map.tsx`. The view is a rectangle of map units; the SVG
//! shows it with `xMidYMid meet`. The hook's browser glue (pointer capture, the non-passive wheel
//! listener, `requestAnimationFrame`, `prefers-reduced-motion`) stays in the `app` crate; the
//! arithmetic it writes inline is here under new names: [`zoom_by`], [`zoom_to_target`],
//! [`key_action`], [`wheel_factor`], [`ease_out_cubic`], [`animation_frame`], [`is_drag`],
//! [`drag_pan`], [`rect_or_fit`], [`view_box`], [`map_aspect`], and [`label_font_size`].

use serde::{Deserialize, Serialize};

use super::map_geometry::{
    Bounds, Point, bounds, js_exp, js_hypot, js_max, js_min, js_number, js_pow, js_round,
};

/// `View` of `use-pan-zoom.ts`: the rectangle of map units the SVG shows (the same shape as
/// [`Bounds`]).
pub type View = Bounds;

/// `Rect` of `use-pan-zoom.ts`: the SVG's box on screen, in CSS pixels
/// (`getBoundingClientRect`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

/// `MAX_ZOOM`: the deepest zoom, 40 times the whole map (038 R13).
pub const MAX_ZOOM: f64 = 40.0;
/// `ANIMATION_MS`: zooming to a section takes this long (none under reduced motion).
pub const ANIMATION_MS: f64 = 200.0;
/// `STEP`: one press of a zoom button or key.
pub const STEP: f64 = 1.5;
/// `WHEEL_RATE`: how far one pixel of wheel travel zooms.
pub const WHEEL_RATE: f64 = 0.002;
/// `DRAG_SLOP`: a press that moves less than this many pixels is a click, not a drag.
pub const DRAG_SLOP: f64 = 4.0;

/// `FIT_MARGIN` (`venue-map.tsx`): the margin around what Fit map frames, as a share of its
/// larger side.
const FIT_MARGIN: f64 = 0.04;
/// `MIN_ASPECT` and `MAX_ASPECT` (`venue-map.tsx`): the map's box, width over height, follows
/// the frame between these.
const MIN_ASPECT: f64 = 1.0;
const MAX_ASPECT: f64 = 2.2;

fn clamp(n: f64, lo: f64, hi: f64) -> f64 {
    js_min([hi, js_max([lo, n])])
}

fn center(v: &View) -> Point {
    [v.x + v.width / 2.0, v.y + v.height / 2.0]
}

/// `fitView`: bounds with `margin` map units on every side (the TypeScript's default is 0).
pub fn fit_view(b: &Bounds, margin: f64) -> View {
    View {
        x: b.x - margin,
        y: b.y - margin,
        width: b.width + 2.0 * margin,
        height: b.height + 2.0 * margin,
    }
}

/// `zoomOf`: how far in a view is: 1 at the fit.
pub fn zoom_of(view: &View, fit: &View) -> f64 {
    fit.width / view.width
}

/// `zoomAt`: zooms by `factor` at the map place `at`, which keeps its place on screen; never out
/// past the fit (where the view is the fit again) nor in past `max_zoom` (the TypeScript's
/// default is [`MAX_ZOOM`]).
pub fn zoom_at(view: &View, factor: f64, at: Point, fit: &View, max_zoom: f64) -> View {
    let current = zoom_of(view, fit);
    let next = clamp(current * factor, 1.0, max_zoom);
    if next <= 1.0 {
        return *fit;
    }
    let k = current / next;
    View {
        x: at[0] - (at[0] - view.x) * k,
        y: at[1] - (at[1] - view.y) * k,
        width: view.width * k,
        height: view.height * k,
    }
}

/// `panBy`: moves the view by map units, its center kept over the map.
pub fn pan_by(view: &View, dx: f64, dy: f64, fit: &View) -> View {
    let cx = clamp(view.x + dx + view.width / 2.0, fit.x, fit.x + fit.width);
    let cy = clamp(view.y + dy + view.height / 2.0, fit.y, fit.y + fit.height);
    View {
        x: cx - view.width / 2.0,
        y: cy - view.height / 2.0,
        ..*view
    }
}

/// `clientToMap`: the map place under a point on screen, the view drawn centered in `rect`
/// (meet).
pub fn client_to_map(view: &View, rect: &Rect, client: Point) -> Point {
    let scale = js_min([rect.width / view.width, rect.height / view.height]);
    let off_x = (rect.width - view.width * scale) / 2.0;
    let off_y = (rect.height - view.height * scale) / 2.0;
    [
        view.x + (client[0] - rect.left - off_x) / scale,
        view.y + (client[1] - rect.top - off_y) / scale,
    ]
}

fn distance(a: Point, b: Point) -> f64 {
    js_hypot(a[0] - b[0], a[1] - b[1])
}

fn middle(a: Point, b: Point) -> Point {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}

/// `pinchView`: two fingers moved from `before` to `after` (screen points): zoomed by how much
/// further apart they are, around their middle, and moved with it, so the map stays under the
/// fingers. The hook passes the moved finger's last and new places, each with the other finger.
pub fn pinch_view(
    view: &View,
    fit: &View,
    rect: &Rect,
    before: [Point; 2],
    after: [Point; 2],
) -> View {
    let d0 = distance(before[0], before[1]);
    let factor = if d0 > 0.0 {
        distance(after[0], after[1]) / d0
    } else {
        1.0
    };
    let p = client_to_map(view, rect, middle(before[0], before[1]));
    let zoomed = zoom_at(view, factor, p, fit, MAX_ZOOM);
    let q = client_to_map(&zoomed, rect, middle(after[0], after[1]));
    pan_by(&zoomed, p[0] - q[0], p[1] - q[1], fit)
}

/// The hook's `zoomBy`: the zoom buttons and keys, by `factor` about the view's center
/// ([`STEP`] in, `1 / STEP` out).
pub fn zoom_by(view: &View, factor: f64, fit: &View) -> View {
    zoom_at(view, factor, center(view), fit, MAX_ZOOM)
}

/// The hook's `zoomTo` target: a section's bounds with `margin` (a tenth of its larger side when
/// `None`), widened about its center when that would zoom deeper than [`MAX_ZOOM`]. The app
/// animates to it ([`animation_frame`]), or jumps there under reduced motion.
pub fn zoom_to_target(b: &Bounds, margin: Option<f64>, fit: &View) -> View {
    let margin = margin.unwrap_or_else(|| js_max([b.width, b.height]) / 10.0);
    let target = fit_view(b, margin);
    if zoom_of(&target, fit) > MAX_ZOOM {
        let k = zoom_of(&target, fit) / MAX_ZOOM;
        let [cx, cy] = center(&target);
        return View {
            x: cx - (target.width * k) / 2.0,
            y: cy - (target.height * k) / 2.0,
            width: target.width * k,
            height: target.height * k,
        };
    }
    target
}

/// What a key does on the map (the hook's `onKeyDown` table): `+` `=` in, `-` `−` `_` out, the
/// arrows pan a tenth of the view. The app calls `preventDefault` and stops any animation only
/// for these.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyAction {
    ZoomIn,
    ZoomOut,
    PanLeft,
    PanRight,
    PanUp,
    PanDown,
}

/// The hook's `onKeyDown` table: the action for a `KeyboardEvent.key`, or `None` to leave the
/// key alone (a seat's Enter, Tab).
pub fn key_action(key: &str) -> Option<KeyAction> {
    Some(match key {
        "+" | "=" => KeyAction::ZoomIn,
        "-" | "−" | "_" => KeyAction::ZoomOut,
        "ArrowLeft" => KeyAction::PanLeft,
        "ArrowRight" => KeyAction::PanRight,
        "ArrowUp" => KeyAction::PanUp,
        "ArrowDown" => KeyAction::PanDown,
        _ => return None,
    })
}

impl KeyAction {
    /// The view after the key, as the hook sets it.
    pub fn apply(self, view: &View, fit: &View) -> View {
        match self {
            KeyAction::ZoomIn => zoom_by(view, STEP, fit),
            KeyAction::ZoomOut => zoom_by(view, 1.0 / STEP, fit),
            KeyAction::PanLeft => pan_by(view, -view.width / 10.0, 0.0, fit),
            KeyAction::PanRight => pan_by(view, view.width / 10.0, 0.0, fit),
            KeyAction::PanUp => pan_by(view, 0.0, -view.height / 10.0, fit),
            KeyAction::PanDown => pan_by(view, 0.0, view.height / 10.0, fit),
        }
    }
}

/// The hook's `onWheel` factor: `exp(−deltaY × k × 0.002)`, `k` the pixels of the event's
/// `deltaMode` (0 pixels: 1, 1 lines: 16, 2 pages: 400). The app zooms by it with [`zoom_at`]
/// at [`client_to_map`] of the pointer.
pub fn wheel_factor(delta_y: f64, delta_mode: u32) -> f64 {
    let scale = match delta_mode {
        1 => 16.0,
        2 => 400.0,
        _ => 1.0,
    };
    js_exp(-delta_y * scale * WHEEL_RATE)
}

/// The hook's animation easing: `1 − (1 − t)³`.
pub fn ease_out_cubic(t: f64) -> f64 {
    1.0 - js_pow(1.0 - t, 3.0)
}

/// One frame of the hook's `animateTo`: the view `elapsed_ms` after it started from `from`
/// toward `target` over [`ANIMATION_MS`], and whether another frame follows.
pub fn animation_frame(from: &View, target: &View, elapsed_ms: f64) -> (View, bool) {
    let t = js_min([1.0, elapsed_ms / ANIMATION_MS]);
    let e = ease_out_cubic(t);
    let view = View {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        width: from.width + (target.width - from.width) * e,
        height: from.height + (target.height - from.height) * e,
    };
    (view, t < 1.0)
}

/// The hook's drag check: whether one pointer, pressed at `pressed_at`, has moved [`DRAG_SLOP`]
/// pixels or more to `now`, so it pans (and only then captures the pointer).
pub fn is_drag(pressed_at: Point, now: Point) -> bool {
    // Not `>=`: as in JavaScript, a `NaN` distance is not under the slop.
    !matches!(
        distance(pressed_at, now).partial_cmp(&DRAG_SLOP),
        Some(std::cmp::Ordering::Less)
    )
}

/// The hook's drag pan: the view moved with one pointer from `prev` to `now` (screen points), at
/// the view's scale in `rect`.
pub fn drag_pan(view: &View, rect: &Rect, prev: Point, now: Point, fit: &View) -> View {
    let units_per_pixel = 1.0 / js_min([rect.width / view.width, rect.height / view.height]);
    pan_by(
        view,
        -(now[0] - prev[0]) * units_per_pixel,
        -(now[1] - prev[1]) * units_per_pixel,
        fit,
    )
}

/// The hook's `rect()`: the SVG's box, or one the fit's size at the corner when it has no size
/// on screen (`None`, or a zero width or height).
pub fn rect_or_fit(rect: Option<Rect>, fit: &View) -> Rect {
    match rect {
        Some(r) if r.width > 0.0 && r.height > 0.0 => r,
        _ => Rect {
            left: 0.0,
            top: 0.0,
            width: fit.width,
            height: fit.height,
        },
    }
}

/// The hook's `viewBox`: the view's numbers, each to a thousandth of a map unit.
pub fn view_box(view: &View) -> String {
    let round = |n: f64| js_number(js_round(n * 1000.0) / 1000.0);
    format!(
        "{} {} {} {}",
        round(view.x),
        round(view.y),
        round(view.width),
        round(view.height)
    )
}

/// `fitOf` (`venue-map.tsx`): what Fit map (and the overview) frames: the sections' outlines and
/// the floor's, with a margin of 4% of the larger side; the whole canvas (`width` × `height`)
/// when nothing is drawn. `floor_outline` is the floor's outline only when its kind is not `NONE`
/// (`map.floorKind !== 'NONE' && map.floorOutline`).
pub fn fit_of<'a>(
    section_outlines: impl IntoIterator<Item = &'a [Point]>,
    floor_outline: Option<&[Point]>,
    width: f64,
    height: f64,
) -> View {
    let mut points: Vec<Point> = section_outlines.into_iter().flatten().copied().collect();
    if let Some(floor) = floor_outline {
        points.extend_from_slice(floor);
    }
    if points.is_empty() {
        return View {
            x: 0.0,
            y: 0.0,
            width,
            height,
        };
    }
    let b = bounds(&points);
    fit_view(&b, js_max([b.width, b.height]) * FIT_MARGIN)
}

/// The map's `aspect-ratio` (`venue-map.tsx`): the fit's width over its height, between 1 and
/// 2.2. The app writes it with `js_number`.
pub fn map_aspect(fit: &View) -> f64 {
    js_min([MAX_ASPECT, js_max([MIN_ASPECT, fit.width / fit.height])])
}

/// The section names' font size (`venue-map.tsx`): `max(fit w, h) / 50 / max(1, zoom^0.75)`, so
/// they stay a steady size on screen as the map zooms. At zoom 1 it is the layout preview's
/// `max(width, height) / 50` (`layout-preview.tsx`, with the canvas as the fit).
pub fn label_font_size(fit: &View, zoom: f64) -> f64 {
    js_max([fit.width, fit.height]) / 50.0 / js_max([1.0, js_pow(zoom, 0.75)])
}
