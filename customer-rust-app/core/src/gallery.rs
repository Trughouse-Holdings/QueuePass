// Copied from admin-rust-app/core/src/pages/event_page.rs at 680b4f7 (spec 040 R4), the gallery part.
//! Spec 040 (task T034; parity B6, E3): what an event's image gallery works out, as plain
//! functions so the app crate's views only lay them out: the shared gallery's
//! `packages/shared/src/web/gallery-size.ts`, `gallery-parts.tsx`, `use-gallery-rotation.ts`, and
//! `image-gallery.tsx`. The Rust Admin app uses only the `page` variant; the Customer app's Events
//! list cards add the `card` variant (spec 014 FR-020–FR-028, FR-032, research R12, R14).

use std::collections::BTreeSet;

use crate::seating::map_geometry::{js_max, js_min, js_number};

/// `GALLERY_INTERVAL_MS` (`event-image.ts`): the next image every 5 seconds.
pub const GALLERY_INTERVAL_MS: u64 = 5_000;
/// `SLIDE_MS` (`gallery-parts.tsx`): the slide between images.
pub const SLIDE_MS: u64 = 400;
/// `SHOWN_AND_NEXT`: the event page's gallery wants the shown image and the next one.
pub const SHOWN_AND_NEXT: [i64; 2] = [0, 1];
/// `SHOWN_AND_NEIGHBORS`: the full-screen view wants the shown image and both neighbours.
pub const SHOWN_AND_NEIGHBORS: [i64; 3] = [0, 1, -1];
/// `NEAR_SCREEN` (`image-gallery.tsx`, research R14): how near the screen a card's gallery counts
/// as on it, the shared `IntersectionObserver`'s `rootMargin`.
pub const NEAR_SCREEN: &str = "200px";

/// `GalleryBox['variant']`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GalleryVariant {
    Card,
    Page,
}

impl GalleryVariant {
    pub fn as_str(self) -> &'static str {
        match self {
            GalleryVariant::Card => "card",
            GalleryVariant::Page => "page",
        }
    }
}

const CARD_TALLEST: f64 = 3.0 / 4.0;
const CARD_FLATTEST: f64 = 2.0;
/// `CARD_MIN_HEIGHT`.
pub const CARD_MIN_HEIGHT: f64 = 160.0;
const PAGE_MIN: f64 = 200.0;
const PAGE_MAX_SHARE: f64 = 0.7;

fn clamp(min: f64, value: f64, max: f64) -> f64 {
    js_max([min, js_min([value, max])])
}

/// `galleryBoxHeight` (spec 014 FR-042, research R18): a card between a 3:4 portrait and a 2:1
/// panorama (4:3 with no shape), never under 160; the event page at least 200 and at most 70% of
/// the window's small height (200 wins), `clamp(200, 40% of the width, 480)` with no shape.
pub fn gallery_box_height(
    variant: GalleryVariant,
    width: f64,
    ratio: Option<f64>,
    viewport_height: f64,
) -> f64 {
    match variant {
        GalleryVariant::Card => {
            let shaped = match ratio {
                None => width * 3.0 / 4.0,
                Some(r) => width / clamp(CARD_TALLEST, r, CARD_FLATTEST),
            };
            js_max([CARD_MIN_HEIGHT, shaped])
        }
        GalleryVariant::Page => match ratio {
            None => clamp(PAGE_MIN, 0.4 * width, 480.0),
            Some(r) => js_max([
                PAGE_MIN,
                js_min([width / r, PAGE_MAX_SHARE * viewport_height]),
            ]),
        },
    }
}

/// The gallery's inline `height`, as React writes a number style: "312.5px".
pub fn height_style(height: f64) -> String {
    format!("{}px", js_number(height))
}

/// The gallery's classes: `gallery gallery--{variant}`, plus `gallery--measured` once its height
/// is set and `gallery--reshaping` while the height moves with a slide.
pub fn gallery_class(variant: GalleryVariant, measured: bool, reshaping: bool) -> String {
    let mut c = format!("gallery gallery--{}", variant.as_str());
    if measured {
        c.push_str(" gallery--measured");
    }
    if reshaping {
        c.push_str(" gallery--reshaping");
    }
    c
}

/// `useGalleryRotation`'s `step`: `by` from `index`, wrapping around `count` (0 with none).
pub fn step_index(index: usize, by: i64, count: usize) -> usize {
    if count == 0 {
        return 0;
    }
    let n = count as i64;
    (index as i64 + by).rem_euclid(n) as usize
}

/// `useWantedImages`' indexes around `index`: each at `offsets` from it, wrapping around.
pub fn wanted_around(index: usize, count: usize, offsets: &[i64]) -> Vec<usize> {
    if count == 0 {
        return Vec::new();
    }
    offsets
        .iter()
        .map(|&o| step_index(index, o, count))
        .collect()
}

/// The shown image's place in words: "image 2 of 5" (`ImageGallery`'s `position`).
pub fn image_position(index: usize, count: usize) -> String {
    format!("image {} of {count}", index + 1)
}

/// The count line: "2 of 5".
pub fn count_line(index: usize, count: usize) -> String {
    format!("{} of {count}", index + 1)
}

/// The full-screen image button's name: "View {name}, image 2 of 5, full screen".
pub fn view_button_label(event_name: &str, index: usize, count: usize) -> String {
    format!(
        "View {event_name}, {}, full screen",
        image_position(index, count)
    )
}

/// The gallery image's `alt`, and the viewer's name: "{name}, image 2 of 5".
pub fn image_alt(event_name: &str, index: usize, count: usize) -> String {
    format!("{event_name}, {}", image_position(index, count))
}

/// The Pause/Play button's name (FR-038): "Pause images of {name}" / "Play images of {name}".
pub fn toggle_label(stopped: bool, event_name: &str) -> String {
    format!(
        "{} images of {event_name}",
        if stopped { "Play" } else { "Pause" }
    )
}

/// The Pause/Play button's mark.
pub fn toggle_icon(stopped: bool) -> &'static str {
    if stopped { "▶" } else { "❚❚" }
}

// ------------------------------------------------------------------------------ rotation

/// `SlideDirection`: `left` for the next image, `right` for the previous.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Left,
    Right,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Left => "left",
            Direction::Right => "right",
        }
    }
}

/// `useGalleryRotation`'s state: the shown image, the count of changes (`turn`, so a change is
/// seen even when it lands on an index shown before), and the last change's direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RotationState {
    pub count: usize,
    pub index: usize,
    pub turn: u64,
    pub direction: Direction,
}

impl RotationState {
    /// Starting at `start` (the full-screen view opens on the gallery's image), clamped.
    pub fn new(count: usize, start: usize) -> Self {
        RotationState {
            count,
            index: start.min(count.saturating_sub(1)),
            turn: 0,
            direction: Direction::Left,
        }
    }

    /// `step`: with 2 or more images, `by` from the shown one, wrapping; wrapping from the last
    /// to the first still slides left (research R11).
    pub fn step(&mut self, by: i64) {
        if self.count < 2 {
            return;
        }
        self.index = step_index(self.index, by, self.count);
        self.turn += 1;
        self.direction = if by > 0 {
            Direction::Left
        } else {
            Direction::Right
        };
    }

    /// `show`: image `at` at once, as a jump rather than a change (no new turn, no slide).
    pub fn show(&mut self, at: usize) {
        self.index = at.min(self.count.saturating_sub(1));
    }
}

/// What pauses a gallery (`ImageGallery`'s `paused`): the pointer over an arrow, keyboard focus on
/// an arrow or the full-screen image button, a card off screen, or the full-screen view open.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Pause {
    pub over_arrow: bool,
    pub keyboard_focus: bool,
    pub off_screen: bool,
    pub viewing: bool,
}

impl Pause {
    pub fn any(self) -> bool {
        self.over_arrow || self.keyboard_focus || self.off_screen || self.viewing
    }
}

/// `rotating` (FR-022 to FR-025, FR-038): with 2 or more images, nothing pausing it, not stopped
/// by Pause/Play, and no reduced motion. Every change then waits a fresh
/// [`GALLERY_INTERVAL_MS`].
pub fn rotating(count: usize, pause: Pause, stopped: bool, reduced_motion: bool) -> bool {
    count >= 2 && !pause.any() && !stopped && !reduced_motion
}

/// The slide's `aria-live`: announced politely only while it does not turn on its own (FR-028).
pub fn live_politeness(rotating: bool) -> &'static str {
    if rotating { "off" } else { "polite" }
}

/// `useSlide`'s `still`: no slide under reduced motion, or for a card off screen.
pub fn slide_still(reduced_motion: bool, on_screen: bool) -> bool {
    reduced_motion || !on_screen
}

/// FR-032, FR-039 (research R14): the images a card holds, the shown and the next one, plus the
/// outgoing one during a slide (FR-040), and nothing while off screen.
pub fn card_held(
    index: usize,
    count: usize,
    on_screen: bool,
    slide_from: Option<usize>,
) -> BTreeSet<usize> {
    if !on_screen || count == 0 {
        return BTreeSet::new();
    }
    let mut held: BTreeSet<usize> = [index, (index + 1) % count].into_iter().collect();
    if let Some(from) = slide_from.filter(|&f| f < count) {
        held.insert(from);
    }
    held
}
