//! Parity E4, E4b (`admin-app/src/components/ImagesField.tsx`): the event form's Images: the
//! ordered list with previews, the Cover pill, Earlier, Later, Remove, the file input (or the full
//! note), and the per-file notes in a polite live region. The checks and texts are
//! `core::forms::images`; the list is the form's (`EventFormState::images`), changed on Save.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use admin_rust_core::{
    api::client::{Body, Call, Method},
    forms::images::{
        ACCEPT, ADD_IMAGES_LABEL, EVENT_IMAGE_LIMITS, IMAGES_HINT, ImageItem, choose, full_note,
        image_alt, item_controls, move_earlier_label, move_later_label, refusal_of, remove_label,
        thumb_class,
    },
};
use leptos::{prelude::*, task::spawn_local};
use wasm_bindgen_futures::JsFuture;

use crate::{
    auth::use_auth,
    components::event_form::{BrowserFile, FormSignal, edit},
};

/// `refusalOf`: why the form will not send `file`, or `None`; `Err` when it could not be read.
async fn refusal(file: &web_sys::File) -> Result<Option<&'static str>, ()> {
    let size = file.size() as u64;
    if size > EVENT_IMAGE_LIMITS.max_bytes {
        return Ok(refusal_of(size, &[]));
    }
    let buffer = JsFuture::from(file.array_buffer()).await.map_err(|_| ())?;
    Ok(refusal_of(size, &js_sys::Uint8Array::new(&buffer).to_vec()))
}

/// A file's bytes, read in the browser.
pub async fn file_bytes(file: &web_sys::File) -> Option<Vec<u8>> {
    let buffer = JsFuture::from(file.array_buffer()).await.ok()?;
    Some(js_sys::Uint8Array::new(&buffer).to_vec())
}

/// An object URL for `bytes`, as a picture of `content_type`.
fn object_url(bytes: &[u8], content_type: &str) -> Option<String> {
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let options = web_sys::BlobPropertyBag::new();
    options.set_type(content_type);
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &options).ok()?;
    web_sys::Url::create_object_url_with_blob(&blob).ok()
}

/// `ThumbImage`: a preview in its picture's own shape, in the 4:3 loading shape until loaded.
fn thumb_image(url: String, alt: impl Fn() -> String + Send + Sync + 'static) -> impl IntoView {
    let loaded = RwSignal::new(false);
    view! {
        <img
            class=move || thumb_class(loaded.get())
            src=url
            alt=alt
            on:load=move |_| loaded.set(true)
        />
    }
}

/// `NewThumb`: a chosen file's preview, from an object URL revoked when the item goes.
fn new_thumb(file: web_sys::File, alt: impl Fn() -> String + Send + Sync + 'static) -> AnyView {
    match web_sys::Url::create_object_url_with_blob(&file) {
        Ok(url) => {
            let revoke = url.clone();
            on_cleanup(move || {
                let _ = web_sys::Url::revoke_object_url(&revoke);
            });
            thumb_image(url, alt).into_any()
        }
        Err(_) => {
            view! { <span class="image-item__thumb image-item__thumb--loading"></span> }.into_any()
        }
    }
}

/// `SavedThumb`: a stored image's preview, read with the token (a plain `<img src>` cannot send
/// one) and shown from an object URL, revoked when the item goes.
fn saved_thumb(
    event_id: String,
    image_id: String,
    content_type: String,
    alt: impl Fn() -> String + Send + Sync + Clone + 'static,
) -> impl IntoView {
    let auth = use_auth();
    let url = RwSignal::new(None::<String>);
    let alive = Arc::new(AtomicBool::new(true));
    let made: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    {
        let (alive, made) = (alive.clone(), made.clone());
        on_cleanup(move || {
            alive.store(false, Ordering::Relaxed);
            if let Some(u) = made.lock().ok().and_then(|mut m| m.take()) {
                let _ = web_sys::Url::revoke_object_url(&u);
            }
        });
    }
    spawn_local(async move {
        let call = Call {
            method: Method::Get,
            path: format!("/events/{event_id}/images/{image_id}"),
            query: Vec::new(),
            body: Body::None,
        };
        let Ok(bytes) = auth.api().send_raw_quiet(call).await else {
            return;
        };
        if !alive.load(Ordering::Relaxed) {
            return;
        }
        if let Some(u) = object_url(&bytes, &content_type) {
            if let Ok(mut m) = made.lock() {
                *m = Some(u.clone());
            }
            url.set(Some(u));
        }
    });
    move || {
        match url.get() {
        Some(u) => thumb_image(u, alt.clone()).into_any(),
        None => view! {
            <span class="image-item__thumb image-item__thumb--loading" role="img" aria-label=alt.clone()></span>
        }
        .into_any(),
    }
    }
}

/// One item of the list, found by its key (its place changes as items move).
fn image_item(state: FormSignal, event_id: Option<String>, key: String) -> impl IntoView {
    let place = {
        let key = key.clone();
        Memo::new(move |_| {
            state.with(|s| {
                let items = &s.images.items;
                let index = items.iter().position(|i| i.key() == key).unwrap_or(0);
                (index, items.len())
            })
        })
    };
    let index = move || place.get().0;
    let alt = move || image_alt(index());
    let controls = Memo::new(move |_| {
        let (i, len) = place.get();
        item_controls(i, len)
    });
    let (file, saved) = state.with_untracked(|s| {
        s.images
            .items
            .iter()
            .find(|i| i.key() == key)
            .map(|item| {
                let saved = match item {
                    ImageItem::Saved { image, .. } => {
                        Some((image.id.clone(), image.content_type.clone()))
                    }
                    ImageItem::New { .. } => None,
                };
                (item.file().map(|f| f.0.clone()), saved)
            })
            .unwrap_or((None, None))
    });
    // Chosen here (sent or not): shown from the file, by the same preview across the upload.
    let thumb = match (file, saved, event_id) {
        (Some(file), _, _) => Some(new_thumb(file, alt)),
        (None, Some((image_id, content_type)), Some(event_id)) => {
            Some(saved_thumb(event_id, image_id, content_type, alt).into_any())
        }
        _ => None,
    };

    view! {
        <li class="image-item">
            {thumb}
            <span>{alt}</span>
            {move || controls.get().cover.then(|| view! { <span class="pill">"Cover"</span> })}
            <div class="image-item__actions">
                {move || {
                    controls
                        .get()
                        .earlier
                        .then(|| {
                            view! {
                                <button
                                    type="button"
                                    class="btn"
                                    aria-label=move || move_earlier_label(index())
                                    on:click=move |_| { let i = place.get_untracked().0; edit(state, |s| s.images.move_item(i, -1)) }
                                >
                                    "Earlier"
                                </button>
                            }
                        })
                }}
                {move || {
                    controls
                        .get()
                        .later
                        .then(|| {
                            view! {
                                <button
                                    type="button"
                                    class="btn"
                                    aria-label=move || move_later_label(index())
                                    on:click=move |_| { let i = place.get_untracked().0; edit(state, |s| s.images.move_item(i, 1)) }
                                >
                                    "Later"
                                </button>
                            }
                        })
                }}
                <button
                    type="button"
                    class="btn"
                    aria-label=move || remove_label(index())
                    on:click=move |_| { let i = place.get_untracked().0; edit(state, |s| s.images.remove(i)) }
                >
                    "Remove"
                </button>
            </div>
        </li>
    }
}

/// `ImagesField`. `event_id` is the edited event's (stored images are read from it).
#[component]
pub fn ImagesField(state: FormSignal, event_id: Option<String>) -> impl IntoView {
    let refused = RwSignal::new(Vec::<String>::new());
    let keys = Memo::new(move |_| {
        state.with(|s| {
            s.images
                .items
                .iter()
                .map(|i| i.key().to_string())
                .collect::<Vec<_>>()
        })
    });
    let any = Memo::new(move |_| !keys.get().is_empty());
    let full = Memo::new(move |_| state.with(|s| s.images.is_full()));

    let on_choose = move |ev: leptos::ev::Event| {
        let input: web_sys::HtmlInputElement = event_target(&ev);
        let files: Vec<web_sys::File> = input
            .files()
            .map(|list| (0..list.length()).filter_map(|i| list.get(i)).collect())
            .unwrap_or_default();
        // So the same file can be chosen again.
        input.set_value("");
        spawn_local(async move {
            let mut reasons = Vec::with_capacity(files.len());
            for file in &files {
                let Ok(why) = refusal(file).await else { return };
                reasons.push(why);
            }
            // From here on nothing awaits: the room is taken from the latest list.
            let Some(count) = state.try_with_untracked(|s| s.images.items.len()) else {
                return;
            };
            let files: Vec<BrowserFile> = files.into_iter().map(BrowserFile).collect();
            let choice = choose(&files, &reasons, count);
            refused.set(choice.notes);
            if !choice.accepted.is_empty() {
                edit(state, |s| s.images.add(choice.accepted));
            }
        });
    };

    view! {
        <fieldset class="field">
            <legend>"Images"</legend>
            <span class="field__hint">{IMAGES_HINT}</span>
            {move || {
                any.get()
                    .then(|| {
                        let event_id = event_id.clone();
                        view! {
                            <ol class="image-list">
                                <For
                                    each=move || keys.get()
                                    key=|k| k.clone()
                                    children=move |k| image_item(state, event_id.clone(), k)
                                />
                            </ol>
                        }
                    })
            }}
            {move || {
                if full.get() {
                    view! { <p class="note">{full_note()}</p> }.into_any()
                } else {
                    view! {
                        <div class="field">
                            <label for="event-images">{ADD_IMAGES_LABEL}</label>
                            <input
                                id="event-images"
                                type="file"
                                accept=ACCEPT
                                multiple=true
                                on:change=on_choose
                            />
                        </div>
                    }
                        .into_any()
                }
            }}
            // FR-016: the refusals are announced; the live region is there from the start so a
            // screen reader hears what is added to it.
            <div aria-live="polite" data-testid="images-live">
                {move || {
                    let notes = refused.get();
                    (!notes.is_empty())
                        .then(|| {
                            view! {
                                <div class="note" data-testid="images-note">
                                    {notes.into_iter().map(|r| view! { <p>{r}</p> }).collect_view()}
                                </div>
                            }
                        })
                }}
            </div>
        </fieldset>
    }
}

/// The type a picture is sent with: the file's own, as `FormData` sends it.
pub fn content_type_of(file: &web_sys::File) -> String {
    let t = file.type_();
    if t.is_empty() {
        "application/octet-stream".into()
    } else {
        t
    }
}
