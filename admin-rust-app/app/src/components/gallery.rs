//! Spec 037 (task T061; parity E9): the event page's image gallery and its full-screen view, as
//! `packages/shared/src/web/image-gallery.tsx` (the `page` variant, the only one the Admin app
//! uses), `image-viewer.tsx`, `gallery-parts.tsx`, `use-gallery-rotation.ts`, and
//! `event-images.ts`.
//!
//! Spec 014 US2, US4, US5: the next image every 5 seconds, sliding between them, with previous and
//! next arrows, the position in words, and a Pause/Play button; it pauses while the pointer is over
//! an arrow, while an arrow or the image button has keyboard focus, and while the full-screen view
//! is open. Under reduced motion it never turns on its own and has no Pause/Play button. The box
//! takes the shown picture's shape (FR-042). The full-screen view is a dialog over the whole
//! window; the app behind it is inert and does not scroll; focus returns to the image button.

use std::{
    cell::{Cell, RefCell},
    collections::{BTreeSet, HashMap},
    rc::Rc,
    time::Duration,
};

use admin_rust_core::{
    api::client::{ApiClient, Body, Call, Method},
    pages::event_page::{
        GALLERY_INTERVAL_MS, GalleryVariant, SHOWN_AND_NEIGHBORS, SHOWN_AND_NEXT, SLIDE_MS,
        count_line, gallery_box_height, height_style, image_alt, step_index, view_button_label,
        wanted_around,
    },
};
use leptos::{html, mount::mount_to, prelude::*, task::spawn_local};
use wasm_bindgen::{JsCast, closure::Closure};

use crate::{auth::use_auth, venue_map::pan_zoom::use_media_query};

/// An event image as the gallery needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GalleryImage {
    pub id: String,
    pub content_type: String,
}

// ------------------------------------------------------------------------------ image cache

/// `EventImageState`: a page-local `blob:` URL once loaded, or that it failed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ImageState {
    url: Option<String>,
    failed: bool,
}

struct Entry {
    state: ArcRwSignal<ImageState>,
    loading: Cell<bool>,
    users: Cell<u32>,
    /// Every user let go; a load still in flight must not create a URL.
    dropped: Cell<bool>,
}

thread_local! {
    /// Spec 014 research R4: one shared cache, one request and one URL per image, revoked when
    /// the last holder lets go.
    static CACHE: RefCell<HashMap<String, Rc<Entry>>> = RefCell::new(HashMap::new());
}

fn load(api: ApiClient, event_id: String, image: GalleryImage, entry: Rc<Entry>) {
    entry.loading.set(true);
    entry.state.update(|s| s.failed = false);
    spawn_local(async move {
        let call = Call {
            method: Method::Get,
            path: format!("/events/{event_id}/images/{}", image.id),
            query: Vec::new(),
            body: Body::None,
        };
        let result = api.send_raw(call).await;
        entry.loading.set(false);
        if entry.dropped.get() {
            return;
        }
        let url = result.ok().and_then(|bytes| {
            let array = js_sys::Uint8Array::from(bytes.as_slice());
            let parts = js_sys::Array::of1(&array);
            let options = web_sys::BlobPropertyBag::new();
            options.set_type(&image.content_type);
            let blob =
                web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &options).ok()?;
            web_sys::Url::create_object_url_with_blob(&blob).ok()
        });
        let failed = url.is_none();
        entry.state.set(ImageState { url, failed });
    });
}

fn acquire(api: ApiClient, event_id: &str, image: &GalleryImage) -> Rc<Entry> {
    let (entry, fresh) = CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        match cache.get(&image.id) {
            Some(entry) => (entry.clone(), false),
            None => {
                let entry = Rc::new(Entry {
                    state: ArcRwSignal::new(ImageState::default()),
                    loading: Cell::new(false),
                    users: Cell::new(0),
                    dropped: Cell::new(false),
                });
                cache.insert(image.id.clone(), entry.clone());
                (entry, true)
            }
        }
    });
    // A failed load (a network blip, a 5xx) is tried again when another holder comes.
    let retry = !fresh && entry.state.with_untracked(|s| s.failed) && !entry.loading.get();
    if fresh || retry {
        load(api, event_id.to_string(), image.clone(), entry.clone());
    }
    entry.users.set(entry.users.get() + 1);
    entry
}

fn release(image_id: &str, entry: &Rc<Entry>) {
    entry.users.set(entry.users.get().saturating_sub(1));
    if entry.users.get() > 0 {
        return;
    }
    entry.dropped.set(true);
    if let Some(url) = entry.state.with_untracked(|s| s.url.clone()) {
        let _ = web_sys::Url::revoke_object_url(&url);
    }
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.get(image_id).is_some_and(|e| Rc::ptr_eq(e, entry)) {
            cache.remove(image_id);
        }
    });
}

/// `useEventImage`: one image for as long as the calling view lives. A failure is a state, never
/// an error, so the rest of the page is unaffected (FR-031).
fn use_event_image(
    api: ApiClient,
    event_id: &str,
    image: &GalleryImage,
) -> ArcRwSignal<ImageState> {
    let entry = acquire(api, event_id, image);
    let state = entry.state.clone();
    let held = StoredValue::new_local(Some(entry));
    let id = image.id.clone();
    on_cleanup(move || {
        if let Some(Some(entry)) = held.try_update_value(Option::take) {
            release(&id, &entry);
        }
    });
    state
}

/// `Held`: keeps one image loaded while it lives; draws nothing.
#[component]
fn Held(api: ApiClient, event_id: String, image: GalleryImage) -> impl IntoView {
    let _state = use_event_image(api, &event_id, &image);
}

/// `HeldImages`: keeps the images at the indexes in `held` loaded (research R4, R14).
#[component]
fn HeldImages(
    api: ApiClient,
    event_id: String,
    images: Vec<GalleryImage>,
    held: Signal<BTreeSet<usize>>,
) -> impl IntoView {
    let images = StoredValue::new(images);
    let api = StoredValue::new_local(api);
    view! {
        <For
            each=move || {
                let held = held.get();
                images.with_value(|all| {
                    all.iter()
                        .enumerate()
                        .filter(|(i, _)| held.contains(i))
                        .map(|(_, image)| image.clone())
                        .collect::<Vec<_>>()
                })
            }
            key=|image| image.id.clone()
            let:image
        >
            <Held api=api.get_value() event_id=event_id.clone() image/>
        </For>
    }
}

/// `EventPicture`: the image, or a placeholder of the same size while it loads or when it failed,
/// with the classes of `part` (`gallery` or `viewer`). `on_shape` hears the picture's width /
/// height once the browser has read it (FR-042).
#[component]
fn EventPicture(
    api: ApiClient,
    event_id: String,
    image: GalleryImage,
    #[prop(into)] alt: String,
    part: &'static str,
    #[prop(optional)] on_shape: Option<Callback<f64>>,
) -> impl IntoView {
    let state = use_event_image(api, &event_id, &image);
    move || {
        let s = state.get();
        match s.url {
            Some(url) => view! {
                <img
                    class=format!("{part}__image")
                    src=url
                    alt=alt.clone()
                    on:load=move |e| {
                        let Some(on_shape) = on_shape else { return };
                        let Some(img) = e
                            .current_target()
                            .and_then(|t| t.dyn_into::<web_sys::HtmlImageElement>().ok())
                        else {
                            return;
                        };
                        let (w, h) = (img.natural_width(), img.natural_height());
                        if w > 0 && h > 0 {
                            on_shape.run(f64::from(w) / f64::from(h));
                        }
                    }
                />
            }
            .into_any(),
            None => view! {
                <span class=format!("{part}__placeholder")>
                    {s.failed.then_some("Image unavailable")}
                </span>
            }
            .into_any(),
        }
    }
}

// ------------------------------------------------------------------------------ rotation

/// `SlideDirection`: `left` for the next image, `right` for the previous.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    Left,
    Right,
}

impl Direction {
    fn as_str(self) -> &'static str {
        match self {
            Direction::Left => "left",
            Direction::Right => "right",
        }
    }
}

/// `SlideState`: the outgoing image's index and which way it goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Slide {
    from: usize,
    direction: Direction,
}

const REDUCED_MOTION: &str = "(prefers-reduced-motion: reduce)";

/// `useReducedMotion`: whether the device asks for reduced motion, following changes.
fn use_reduced_motion() -> RwSignal<bool> {
    use_media_query(REDUCED_MOTION)
}

/// `useGalleryRotation` with `useSlide`: the shown image, its turn count (a change is seen even
/// when it lands on an index shown before), the slide between images, and reduced motion.
#[derive(Clone, Copy)]
struct Rotation {
    count: usize,
    index: RwSignal<usize>,
    turn: RwSignal<u64>,
    slide: RwSignal<Option<Slide>>,
    slide_id: StoredValue<u64>,
    reduced: RwSignal<bool>,
}

impl Rotation {
    fn new(count: usize, start: usize) -> Self {
        let rotation = Rotation {
            count,
            index: RwSignal::new(start.min(count.saturating_sub(1))),
            turn: RwSignal::new(0),
            slide: RwSignal::new(None),
            slide_id: StoredValue::new(0),
            reduced: use_reduced_motion(),
        };
        // Reduced motion means no slide at all.
        Effect::new(move |_| {
            if rotation.reduced.get() && rotation.slide.get_untracked().is_some() {
                rotation.slide.set(None);
            }
        });
        rotation
    }

    /// `step`: wrapping from the last image to the first still slides left. The outgoing image
    /// is the one shown now, so a change during a slide slides from the current one.
    fn step(&self, by: i64) {
        if self.count < 2 {
            return;
        }
        let from = self.index.get_untracked();
        let direction = if by > 0 {
            Direction::Left
        } else {
            Direction::Right
        };
        // The slide first, so the outgoing image is there from the change's first frame.
        let still = self.reduced.get_untracked();
        self.slide
            .set((!still).then_some(Slide { from, direction }));
        self.index.set(step_index(from, by, self.count));
        self.turn.update(|t| *t += 1);
        if still {
            return;
        }
        self.slide_id.update_value(|n| *n += 1);
        let id = self.slide_id.get_value();
        let (slide, slide_id) = (self.slide, self.slide_id);
        set_timeout(
            move || {
                if slide_id.try_get_value() == Some(id) {
                    slide.try_set(None);
                }
            },
            Duration::from_millis(SLIDE_MS),
        );
    }

    fn next(&self) {
        self.step(1);
    }

    fn prev(&self) {
        self.step(-1);
    }

    /// `show`: image `at` at once, as a jump: no slide (the viewer closing).
    fn show(&self, at: usize) {
        self.index.set(at.min(self.count.saturating_sub(1)));
    }

    fn end_slide(&self) {
        self.slide.set(None);
    }
}

/// `useWantedImages`: the indexes of every image wanted so far, growing as the shown image moves
/// and never shrinking.
fn use_wanted(
    rotation: Rotation,
    offsets: &'static [i64],
    initial: &[usize],
) -> RwSignal<BTreeSet<usize>> {
    let wanted = RwSignal::new(initial.iter().copied().collect::<BTreeSet<_>>());
    Effect::new(move |_| {
        let around = wanted_around(rotation.index.get(), rotation.count, offsets);
        if !wanted.with_untracked(|w| around.iter().all(|i| w.contains(i))) {
            wanted.update(|w| w.extend(around));
        }
    });
    wanted
}

// ------------------------------------------------------------------------------ the viewer

/// The app's root (the React app's `#root`): the shell `div.app`, a child of `body`.
fn app_root() -> Option<web_sys::Element> {
    document().query_selector("body > .app").ok().flatten()
}

/// `ImageViewer` (spec 014 US5, FR-029, FR-030): an event's image full screen. Previous and next
/// buttons and the arrow keys flip, sliding as the gallery does; it never changes on its own.
/// Esc and the close button close it, saying the image last viewed and whether a key did it.
#[component]
fn ImageViewer(
    api: ApiClient,
    event_id: String,
    event_name: String,
    images: Vec<GalleryImage>,
    start: usize,
    on_close: Callback<(usize, bool)>,
) -> impl IntoView {
    let count = images.len();
    let rotation = Rotation::new(count, start);
    let wanted = use_wanted(rotation, &SHOWN_AND_NEIGHBORS, &[]);
    let dialog = NodeRef::<html::Div>::new();
    let close = NodeRef::<html::Button>::new();
    let images = StoredValue::new(images);
    let several = count >= 2;

    // Research R12: the app behind is inert and does not scroll; focus starts on Close.
    let root = app_root();
    let was_inert = root.as_ref().is_some_and(|r| r.has_attribute("inert"));
    if let Some(root) = &root {
        let _ = root.set_attribute("inert", "");
    }
    if let Some(body) = document().body() {
        let _ = body.class_list().add_1("viewer-open");
    }
    Effect::new(move |_| {
        if let Some(button) = close.get() {
            let _ = button.focus();
        }
    });
    on_cleanup(move || {
        if !was_inert && let Some(root) = app_root() {
            let _ = root.remove_attribute("inert");
        }
        if let Some(body) = document().body() {
            let _ = body.class_list().remove_1("viewer-open");
        }
    });

    let label = {
        let name = event_name.clone();
        move || image_alt(&name, rotation.index.get(), count)
    };
    let on_key = move |e: leptos::ev::KeyboardEvent| {
        let key = e.key();
        if key == "Escape" {
            e.prevent_default();
            on_close.run((rotation.index.get_untracked(), true));
        } else if key == "ArrowRight" && several {
            e.prevent_default();
            rotation.next();
        } else if key == "ArrowLeft" && several {
            e.prevent_default();
            rotation.prev();
        } else if key == "Tab" {
            // FR-030: Tab and Shift+Tab cycle among the view's own buttons.
            let Some(el) = dialog.get_untracked() else {
                return;
            };
            let Ok(list) = el.query_selector_all("button") else {
                return;
            };
            let buttons: Vec<web_sys::HtmlElement> = (0..list.length())
                .filter_map(|i| list.get(i).and_then(|n| n.dyn_into().ok()))
                .collect();
            if buttons.is_empty() {
                return;
            }
            let active = document().active_element();
            let at = buttons.iter().position(|b| {
                active
                    .as_ref()
                    .is_some_and(|a| a == b.unchecked_ref::<web_sys::Element>())
            });
            let last = buttons.len() - 1;
            let to = if e.shift_key() {
                match at {
                    None | Some(0) => last,
                    Some(i) => i - 1,
                }
            } else {
                match at {
                    Some(i) if i < last => i + 1,
                    _ => 0,
                }
            };
            e.prevent_default();
            let _ = buttons[to].focus();
        }
    };

    let api_store = StoredValue::new_local(api.clone());
    let outgoing = {
        let event_id = event_id.clone();
        move || {
            let slide = rotation.slide.get()?;
            let leaving = images.with_value(|all| all.get(slide.from).cloned())?;
            Some(view! {
                // FR-040: the image shown before, on its way out; not announced.
                <div
                    class=format!("viewer__frame gallery__slide--out-{}", slide.direction.as_str())
                    aria-hidden="true"
                    on:animationend=move |e| {
                        if e.target() == e.current_target() {
                            rotation.end_slide();
                        }
                    }
                >
                    <EventPicture
                        api=api_store.get_value()
                        event_id=event_id.clone()
                        image=leaving
                        alt=""
                        part="viewer"
                    />
                </div>
            })
        }
    };
    let incoming = {
        let event_id = event_id.clone();
        let name = event_name.clone();
        move || {
            let index = rotation.index.get();
            let image = images.with_value(|all| all.get(index).cloned())?;
            let frame_class = move || match rotation.slide.get() {
                Some(slide) if slide.from < count => {
                    format!(
                        "viewer__frame gallery__slide--in-{}",
                        slide.direction.as_str()
                    )
                }
                _ => "viewer__frame".to_string(),
            };
            Some(view! {
                <div class=frame_class>
                    <EventPicture
                        api=api_store.get_value()
                        event_id=event_id.clone()
                        image
                        alt=image_alt(&name, index, count)
                        part="viewer"
                    />
                </div>
            })
        }
    };

    view! {
        <div
            node_ref=dialog
            class="viewer"
            role="dialog"
            aria-modal="true"
            aria-label=label
            // FR-029: a click on the picture or the backdrop focuses the dialog, not the page, so
            // Esc and the arrow keys still reach it.
            tabindex="-1"
            on:keydown=on_key
        >
            <HeldImages
                api=api.clone()
                event_id=event_id.clone()
                images=images.get_value()
                held=wanted.into()
            />
            <div class="viewer__stage">{outgoing} {incoming}</div>
            <button
                node_ref=close
                type="button"
                class="viewer__close"
                aria-label="Close full screen"
                // A click from a key press has no pointer clicks counted (`detail` 0).
                on:click=move |e| on_close.run((rotation.index.get_untracked(), e.detail() == 0))
            >
                <span aria-hidden="true">"×"</span>
            </button>
            {several.then(|| view! {
                <button
                    type="button"
                    class="viewer__arrow viewer__arrow--prev"
                    aria-label="Previous image"
                    on:click=move |_| rotation.prev()
                >
                    <span aria-hidden="true">"‹"</span>
                </button>
                <button
                    type="button"
                    class="viewer__arrow viewer__arrow--next"
                    aria-label="Next image"
                    on:click=move |_| rotation.next()
                >
                    <span aria-hidden="true">"›"</span>
                </button>
                <p class="viewer__count" aria-live="polite">
                    {move || count_line(rotation.index.get(), count)}
                </p>
            })}
        </div>
    }
}

// ------------------------------------------------------------------------------ the gallery

/// Research R18 (review of #73, S4): the window's small height, CSS `100svh`, read from the
/// theme's hidden `.viewport-probe`, added and removed at once; `innerHeight` where it measures 0.
fn small_viewport_height() -> f64 {
    let inner = window()
        .inner_height()
        .ok()
        .and_then(|h| h.as_f64())
        .unwrap_or(0.0);
    let (Ok(probe), Some(body)) = (document().create_element("div"), document().body()) else {
        return inner;
    };
    probe.set_class_name("viewport-probe");
    let _ = body.append_child(&probe);
    let height = probe.get_bounding_client_rect().height();
    probe.remove();
    if height > 0.0 { height } else { inner }
}

/// Research R11: one set of capture listeners on the document ends a pointer press at the click
/// that follows it, at `pointercancel`, or at the next key.
const PRESS_ENDS: [&str; 3] = ["click", "pointercancel", "keydown"];

fn listen_press_ends(pressed: StoredValue<bool>) {
    let end = Closure::<dyn Fn()>::new(move || {
        pressed.try_set_value(false);
    });
    for kind in PRESS_ENDS {
        let _ = document().add_event_listener_with_callback_and_bool(
            kind,
            end.as_ref().unchecked_ref(),
            true,
        );
    }
    let held = StoredValue::new_local(Some(end));
    on_cleanup(move || {
        if let Some(Some(end)) = held.try_update_value(Option::take) {
            for kind in PRESS_ENDS {
                let _ = document().remove_event_listener_with_callback_and_bool(
                    kind,
                    end.as_ref().unchecked_ref(),
                    true,
                );
            }
        }
    });
}

/// Research R18: the gallery's width, followed with a `ResizeObserver`, and the window's small
/// height, read again on each `resize`.
fn follow_box_size(
    root: NodeRef<html::Div>,
    width: RwSignal<Option<f64>>,
    viewport: RwSignal<f64>,
) {
    type Held = (
        web_sys::ResizeObserver,
        Closure<dyn Fn(js_sys::Array)>,
        Closure<dyn Fn()>,
    );
    let held = StoredValue::new_local(None::<Held>);
    Effect::new(move |_| {
        let Some(el) = root.get() else { return };
        if held.with_value(Option::is_some) {
            return;
        }
        let on_resize = Closure::<dyn Fn()>::new(move || {
            viewport.try_set(small_viewport_height());
        });
        viewport.set(small_viewport_height());
        let _ =
            window().add_event_listener_with_callback("resize", on_resize.as_ref().unchecked_ref());
        let on_size = Closure::<dyn Fn(js_sys::Array)>::new(move |entries: js_sys::Array| {
            for entry in entries.iter() {
                if let Ok(entry) = entry.dyn_into::<web_sys::ResizeObserverEntry>() {
                    width.try_set(Some(entry.content_rect().width()));
                }
            }
        });
        let Ok(observer) = web_sys::ResizeObserver::new(on_size.as_ref().unchecked_ref()) else {
            return;
        };
        observer.observe(&el);
        held.set_value(Some((observer, on_size, on_resize)));
    });
    on_cleanup(move || {
        if let Some(Some((observer, _on_size, on_resize))) = held.try_update_value(Option::take) {
            observer.disconnect();
            let _ = window()
                .remove_event_listener_with_callback("resize", on_resize.as_ref().unchecked_ref());
        }
    });
}

/// `ImageGallery` with `variant="page"`: across the top of the event page, its image a button
/// that opens it full screen. Draws nothing without images (FR-027).
#[component]
pub fn ImageGallery(
    #[prop(into)] event_id: String,
    #[prop(into)] event_name: String,
    images: Vec<GalleryImage>,
) -> impl IntoView {
    let count = images.len();
    if count == 0 {
        return ().into_any();
    }
    let api = use_auth().api();
    let root = NodeRef::<html::Div>::new();
    let open_button = NodeRef::<html::Button>::new();
    let images = StoredValue::new(images);
    let several = count >= 2;

    // FR-042 (research R18): the box takes the shown picture's shape, kept per image; until a
    // newly shown picture's shape is known, the last shape it showed.
    let width = RwSignal::new(None::<f64>);
    let viewport = RwSignal::new(
        window()
            .inner_height()
            .ok()
            .and_then(|h| h.as_f64())
            .unwrap_or(0.0),
    );
    follow_box_size(root, width, viewport);
    let shapes = RwSignal::new(HashMap::<String, f64>::new());
    let last_shape = RwSignal::new(None::<f64>);
    let reshaping = RwSignal::new(false);
    let reshape_id = StoredValue::new(0_u64);

    let stopped = RwSignal::new(false);
    let over_arrow = RwSignal::new(false);
    let keyboard_focus = RwSignal::new(false);
    // US5: the image open full screen, if any; the gallery does not turn meanwhile.
    let viewing = RwSignal::new(None::<usize>);
    // Research R11: a pointer press is followed by focus; that focus is not keyboard focus.
    let pointer_down = StoredValue::new(false);
    listen_press_ends(pointer_down);
    // Research R11: focus given back by a full-screen view a pointer closed is not keyboard focus.
    let closed_by_pointer = StoredValue::new(false);

    let rotation = Rotation::new(count, 0);
    let rotating = Memo::new(move |_| {
        let paused = over_arrow.get() || keyboard_focus.get() || viewing.with(Option::is_some);
        count >= 2 && !paused && !stopped.get() && !rotation.reduced.get()
    });
    // Every change, automatic or by an arrow, waits a fresh 5,000 ms.
    Effect::new(move |_| {
        rotation.turn.track();
        if !rotating.get() {
            return;
        }
        let handle = set_timeout_with_handle(
            move || rotation.next(),
            Duration::from_millis(GALLERY_INTERVAL_MS),
        );
        if let Ok(handle) = handle {
            on_cleanup(move || handle.clear());
        }
    });

    // Research R14: the shown image and the next one, each held until the page goes.
    let wanted = use_wanted(rotation, &SHOWN_AND_NEXT, &[0, 1]);

    let shown_id = Memo::new(move |_| {
        let index = rotation.index.get();
        images.with_value(|all| all.get(index).map(|i| i.id.clone()))
    });
    let shown_shape = Memo::new(move |_| {
        shown_id
            .get()
            .and_then(|id| shapes.with(|s| s.get(&id).copied()))
    });
    Effect::new(move |_| {
        if let Some(shape) = shown_shape.get()
            && last_shape.get_untracked() != Some(shape)
        {
            last_shape.set(Some(shape));
        }
    });
    let ratio = Memo::new(move |_| shown_shape.get().or_else(|| last_shape.get()));
    // Research R18 (review I8): the height moves with the slide only when the shape changes.
    Effect::watch(
        move || ratio.get(),
        move |_, _, _| {
            reshaping.set(true);
            reshape_id.update_value(|n| *n += 1);
            let id = reshape_id.get_value();
            set_timeout(
                move || {
                    if reshape_id.try_get_value() == Some(id) {
                        reshaping.try_set(false);
                    }
                },
                Duration::from_millis(SLIDE_MS),
            );
        },
        false,
    );
    let height = Memo::new(move |_| {
        width
            .get()
            .map(|w| gallery_box_height(GalleryVariant::Page, w, ratio.get(), viewport.get()))
    });
    let class = move || {
        let mut c = "gallery gallery--page".to_string();
        if height.with(Option::is_some) {
            c.push_str(" gallery--measured");
        }
        if reshaping.get() {
            c.push_str(" gallery--reshaping");
        }
        c
    };

    // The full-screen view, over the whole window: mounted on `body`, outside the app root that
    // it makes inert. FR-030: on closing, focus goes back to the image button, once the view has
    // made the app usable again.
    let owner = Owner::current();
    let viewer = StoredValue::new_local(None::<leptos::mount::UnmountHandle<_>>);
    let name_for_viewer = event_name.clone();
    let id_for_viewer = event_id.clone();
    let api_for_viewer = api.clone();
    Effect::watch(
        move || viewing.get(),
        move |now, before, _| match (*now, before.copied().flatten()) {
            (Some(start), _) => {
                if viewer.with_value(Option::is_some) {
                    return;
                }
                let (Some(owner), Some(body)) = (owner.clone(), document().body()) else {
                    return;
                };
                let api = api_for_viewer.clone();
                let event_id = id_for_viewer.clone();
                let event_name = name_for_viewer.clone();
                let images = images.get_value();
                let on_close = Callback::new(move |(last, by_keyboard): (usize, bool)| {
                    closed_by_pointer.set_value(!by_keyboard);
                    rotation.show(last);
                    viewing.set(None);
                });
                let handle = owner.with(|| {
                    mount_to(body, move || {
                        view! { <ImageViewer api event_id event_name images start on_close/> }
                    })
                });
                viewer.set_value(Some(handle));
            }
            (None, Some(_)) => {
                viewer.set_value(None);
                if let Some(button) = open_button.get_untracked() {
                    let _ = button.focus();
                }
                closed_by_pointer.set_value(false);
            }
            (None, None) => {}
        },
        false,
    );

    let keyboard_only_focus = move || {
        if !pointer_down.get_value() && !closed_by_pointer.get_value() {
            keyboard_focus.set(true);
        }
    };

    let api_store = StoredValue::new_local(api.clone());
    let outgoing = {
        let event_id = event_id.clone();
        move || {
            let slide = rotation.slide.get()?;
            let leaving = images.with_value(|all| all.get(slide.from).cloned())?;
            Some(view! {
                // FR-040: the image shown before, on its way out; not a control and not announced.
                <div
                    class=format!("gallery__frame gallery__slide--out-{}", slide.direction.as_str())
                    aria-hidden="true"
                    on:animationend=move |e| {
                        if e.target() == e.current_target() {
                            rotation.end_slide();
                        }
                    }
                >
                    <EventPicture
                        api=api_store.get_value()
                        event_id=event_id.clone()
                        image=leaving
                        alt=""
                        part="gallery"
                    />
                </div>
            })
        }
    };
    let incoming = {
        let event_id = event_id.clone();
        let name = event_name.clone();
        move || {
            let index = rotation.index.get();
            let image = images.with_value(|all| all.get(index).cloned())?;
            let frame_class = move || match rotation.slide.get() {
                Some(slide) if slide.from < count => {
                    format!(
                        "gallery__frame gallery__slide--in-{}",
                        slide.direction.as_str()
                    )
                }
                _ => "gallery__frame".to_string(),
            };
            let shape_id = image.id.clone();
            let on_shape = Callback::new(move |r: f64| {
                if shapes.with_untracked(|s| s.get(&shape_id) != Some(&r)) {
                    shapes.update(|s| {
                        s.insert(shape_id.clone(), r);
                    });
                }
            });
            Some(view! {
                <span class=frame_class>
                    <EventPicture
                        api=api_store.get_value()
                        event_id=event_id.clone()
                        image
                        alt=image_alt(&name, index, count)
                        part="gallery"
                        on_shape
                    />
                </span>
            })
        }
    };

    let open_label = {
        let name = event_name.clone();
        move || view_button_label(&name, rotation.index.get(), count)
    };
    let arrows = several.then(|| {
        let prev_label = format!("Previous image of {event_name}");
        let next_label = format!("Next image of {event_name}");
        let name = event_name.clone();
        view! {
            <button
                type="button"
                class="gallery__arrow gallery__arrow--prev"
                aria-label=prev_label
                on:click=move |_| rotation.prev()
                on:focus=move |_| keyboard_only_focus()
                on:blur=move |_| keyboard_focus.set(false)
                on:pointerenter=move |_| over_arrow.set(true)
                on:pointerleave=move |_| over_arrow.set(false)
            >
                <span aria-hidden="true">"‹"</span>
            </button>
            <button
                type="button"
                class="gallery__arrow gallery__arrow--next"
                aria-label=next_label
                on:click=move |_| rotation.next()
                on:focus=move |_| keyboard_only_focus()
                on:blur=move |_| keyboard_focus.set(false)
                on:pointerenter=move |_| over_arrow.set(true)
                on:pointerleave=move |_| over_arrow.set(false)
            >
                <span aria-hidden="true">"›"</span>
            </button>
            {move || {
                let name = name.clone();
                (!rotation.reduced.get()).then(|| view! {
                    <button
                        type="button"
                        class="gallery__toggle"
                        aria-label=move || {
                            format!(
                                "{} images of {name}",
                                if stopped.get() { "Play" } else { "Pause" },
                            )
                        }
                        on:click=move |_| stopped.update(|s| *s = !*s)
                    >
                        <span aria-hidden="true">
                            {move || if stopped.get() { "▶" } else { "❚❚" }}
                        </span>
                    </button>
                })
            }}
            <p class="gallery__count">{move || count_line(rotation.index.get(), count)}</p>
        }
    });

    view! {
        <div
            node_ref=root
            role="group"
            aria-roledescription="carousel"
            aria-label=format!("Images of {event_name}")
            class=class
            // A layout length only, never a color, font, or shadow (spec 012's inline rule).
            style:height=move || height.get().map(height_style)
            on:pointerdown=move |_| {
                pointer_down.set_value(true);
                keyboard_focus.set(false);
            }
        >
            <HeldImages
                api=api.clone()
                event_id=event_id.clone()
                images=images.get_value()
                held=wanted.into()
            />
            <div
                class="gallery__slide"
                aria-live=move || if rotating.get() { "off" } else { "polite" }
            >
                {outgoing}
                <button
                    node_ref=open_button
                    type="button"
                    class="gallery__open"
                    aria-label=open_label
                    on:click=move |_| viewing.set(Some(rotation.index.get_untracked()))
                    on:focus=move |_| keyboard_only_focus()
                    on:blur=move |_| keyboard_focus.set(false)
                >
                    {incoming}
                </button>
            </div>
            {arrows}
        </div>
    }
    .into_any()
}
