//! Parity M1–M5 (`admin-app/src/components/LayoutsCard.tsx`): the venue page's Layouts card.
//! Each layout with its counts, the scheduled events using it, whether it is locked, and a
//! preview of its map; Import layout file, New layout (the editor), New layout from section
//! lines, and per layout Edit or View, Rename, Edit section lines (a layout made from lines only),
//! Duplicate, and Delete. One layout write at a time across the card; each refusal is shown
//! beside the control that was used, in the Backend's words, and nothing typed is lost. Every
//! list loaded is handed to `on_layouts`, for the venue's capacity (M7). The rules and texts are
//! `core::forms::layouts`.

use std::{collections::HashMap, future::Future, pin::Pin, task::Poll};

use admin_rust_core::{
    api::{
        client::ApiError,
        types::{LayoutDetail, LayoutSummary},
    },
    forms::{
        layouts::{
            EditorLink, IMPORT_HINT, ImportError, LOADING, LOADING_PREVIEW, LOCKED_NOTE,
            NAME_MAX_LENGTH, NO_LAYOUTS, SAVE_LAYOUT_TITLE, UNAVAILABLE, as_api_error,
            change_title, check_import_size, delete_confirm, duplicate_body, editor_link,
            import_problems, lines_form_label, new_layout_href, parse_import, rename_body,
            summary_line, takes_lines,
        },
        section_lines::{LinesDraft, draft_of, total_text},
    },
    seating::venue_map::PreviewLayout,
};
use leptos::{ev::SubmitEvent, prelude::*, task::spawn_local};
use wasm_bindgen_futures::JsFuture;

use crate::{
    auth::{Auth, use_auth},
    components::{
        AppLink, ErrorBanner,
        section_lines::{LinesEdit, SectionLines, use_id},
    },
    venue_map::LayoutPreview,
};

/// Every future at once, their outputs in order, as `Promise.all`.
async fn join_all<F: Future>(futures: Vec<F>) -> Vec<F::Output> {
    let mut futures: Vec<Pin<Box<F>>> = futures.into_iter().map(Box::pin).collect();
    let mut outputs: Vec<Option<F::Output>> = futures.iter().map(|_| None).collect();
    std::future::poll_fn(move |cx| {
        for (future, output) in futures.iter_mut().zip(outputs.iter_mut()) {
            if output.is_none()
                && let Poll::Ready(v) = future.as_mut().poll(cx)
            {
                *output = Some(v);
            }
        }
        if outputs.iter().all(Option::is_some) {
            Poll::Ready(outputs.iter_mut().filter_map(Option::take).collect())
        } else {
            Poll::Pending
        }
    })
    .await
}

/// The list as loaded: `null` (loading), `'unavailable'`, or the layouts.
#[derive(Clone, Debug)]
enum Listing {
    Loading,
    Unavailable,
    Loaded(Vec<LayoutSummary>),
}

/// The card's look, which changes only when the list's state does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Shape {
    Loading,
    Unavailable,
    Empty,
    List,
}

/// The card's shared state: the list, the details, and the one-write-at-a-time lock.
#[derive(Clone, Copy)]
struct Card {
    auth: Auth,
    venue_id: StoredValue<String>,
    layouts: RwSignal<Listing>,
    details: RwSignal<HashMap<String, LayoutDetail>>,
    busy: RwSignal<bool>,
    /// Not state: a second write started before the first one's answer must see it.
    busy_ref: StoredValue<bool>,
    on_layouts: Option<WriteSignal<Vec<LayoutSummary>>>,
}

impl Card {
    /// `load`: the list, then each layout's detail in parallel (a failed detail is dropped).
    async fn load(self) {
        let Some(venue_id) = self.venue_id.try_get_value() else {
            return;
        };
        let api = self.auth.api();
        match api.list_venue_layouts(&venue_id).await {
            Ok(list) => {
                self.layouts.set(Listing::Loaded(list.clone()));
                if let Some(out) = self.on_layouts {
                    out.set(list.clone());
                }
                let reads = list
                    .iter()
                    .map(|l| {
                        let api = api.clone();
                        let id = l.id.to_string();
                        async move { api.get_venue_layout(&id).await.ok() }
                    })
                    .collect();
                let loaded = join_all(reads).await;
                self.details.set(
                    loaded
                        .into_iter()
                        .flatten()
                        .map(|d| (d.id.to_string(), d))
                        .collect(),
                );
            }
            Err(_) => self.layouts.set(Listing::Unavailable),
        }
    }

    /// `run`: one write at a time, reloading the list after it. `None` when another write was
    /// running (nothing sent), else whether it went through.
    async fn run(
        self,
        action: impl Future<Output = Result<(), ApiError>>,
    ) -> Option<Result<(), ApiError>> {
        if self.busy_ref.try_get_value().unwrap_or(true) {
            return None;
        }
        self.busy_ref.set_value(true);
        self.busy.set(true);
        let result = match action.await {
            Ok(()) => {
                self.load().await;
                Ok(())
            }
            Err(e) => Err(as_api_error(e)),
        };
        self.busy_ref.set_value(false);
        self.busy.set(false);
        Some(result)
    }

    fn summary(&self, id: &str) -> Option<LayoutSummary> {
        self.layouts.with(|l| match l {
            Listing::Loaded(list) => list.iter().find(|s| s.id.to_string() == id).cloned(),
            _ => None,
        })
    }
}

/// The venue page's Layouts card.
#[component]
pub fn LayoutsCard(
    #[prop(into)] venue_id: String,
    /// Hears every list loaded, for the venue's capacity.
    #[prop(optional, into)]
    on_layouts: Option<WriteSignal<Vec<LayoutSummary>>>,
) -> impl IntoView {
    let card = Card {
        auth: use_auth(),
        venue_id: StoredValue::new(venue_id.clone()),
        layouts: RwSignal::new(Listing::Loading),
        details: RwSignal::new(HashMap::new()),
        busy: RwSignal::new(false),
        busy_ref: StoredValue::new(false),
        on_layouts,
    };
    let adding: RwSignal<Option<LinesDraft>> = RwSignal::new(None);
    let add_error: RwSignal<Option<ApiError>> = RwSignal::new(None);
    let file: RwSignal<Option<web_sys::File>, LocalStorage> = RwSignal::new_local(None);
    let import_error: RwSignal<Option<ImportError>> = RwSignal::new(None);
    let file_id = use_id();
    let problems_id = use_id();

    spawn_local(card.load());

    let shape = Memo::new(move |_| {
        card.layouts.with(|l| match l {
            Listing::Loading => Shape::Loading,
            Listing::Unavailable => Shape::Unavailable,
            Listing::Loaded(list) if list.is_empty() => Shape::Empty,
            Listing::Loaded(_) => Shape::List,
        })
    });
    let ids = move || {
        card.layouts.with(|l| match l {
            Listing::Loaded(list) => list.iter().map(|s| s.id.to_string()).collect(),
            _ => Vec::new(),
        })
    };

    let import_file = move |_| {
        let Some(chosen) = file.get_untracked() else {
            return;
        };
        import_error.set(None);
        let name = chosen.name();
        if let Err(e) = check_import_size(&name, chosen.size() as u64) {
            import_error.set(Some(e));
            return;
        }
        spawn_local(async move {
            // `File.text()`, then `JSON.parse`: a file that cannot be read is not JSON either.
            let bytes = JsFuture::from(chosen.array_buffer())
                .await
                .map(|buffer| js_sys::Uint8Array::new(&buffer).to_vec());
            let parsed = match bytes {
                Ok(bytes) => parse_import(&name, &bytes),
                Err(_) => Err(ImportError::Local(format!(
                    "{name} is not a layout file: it is not JSON."
                ))),
            };
            let body = match parsed {
                Ok(body) => body,
                Err(e) => {
                    import_error.set(Some(e));
                    return;
                }
            };
            let api = card.auth.api();
            let Some(venue_id) = card.venue_id.try_get_value() else {
                return;
            };
            let sent = card
                .run(async move { api.import_venue_layout(&venue_id, &body).await.map(|_| ()) })
                .await;
            if let Some(Err(e)) = sent {
                import_error.set(Some(ImportError::Api(e)));
            }
        });
    };

    let adding_draft = Signal::derive(move || adding.get().unwrap_or_else(LinesDraft::new_layout));
    let on_adding_name = Callback::new(move |name: String| {
        adding.update(|d| {
            if let Some(d) = d {
                d.set_name(&name);
            }
        })
    });
    let on_adding_lines = Callback::new(move |edit: LinesEdit| {
        adding.update(|d| {
            if let Some(d) = d {
                edit.apply(d);
            }
        })
    });
    let on_adding_save = Callback::new(move |()| {
        let Some(draft) = adding.get_untracked() else {
            return;
        };
        add_error.set(None);
        let api = card.auth.api();
        let Some(venue_id) = card.venue_id.try_get_value() else {
            return;
        };
        spawn_local(async move {
            let body = draft.to_lines_input();
            let sent = card
                .run(async move { api.create_venue_layout(&venue_id, &body).await.map(|_| ()) })
                .await;
            match sent {
                Some(Ok(())) => adding.set(None),
                Some(Err(e)) => add_error.set(Some(e)),
                None => {}
            }
        });
    });
    let on_adding_cancel = Callback::new(move |()| adding.set(None));
    let adding_open = Memo::new(move |_| adding.with(Option::is_some));

    let problems_ref = problems_id.clone();
    view! {
        <section class="card" aria-labelledby="layouts-heading">
            <h2 id="layouts-heading">"Layouts"</h2>
            {move || match shape.get() {
                Shape::Loading => view! { <p class="loading">{LOADING}</p> }.into_any(),
                Shape::Unavailable => view! { <p class="note">{UNAVAILABLE}</p> }.into_any(),
                Shape::Empty => view! { <p class="note">{NO_LAYOUTS}</p> }.into_any(),
                Shape::List => view! {
                    <div class="layout-list">
                        <For
                            each=ids
                            key=|id| id.clone()
                            children=move |id| view! { <LayoutItem card=card id=id/> }
                        />
                    </div>
                }
                .into_any(),
            }}

            <div class="field">
                <label for=file_id.clone()>"Layout file"</label>
                <input
                    id=file_id.clone()
                    type="file"
                    accept=".json,application/json"
                    aria-describedby=move || import_error.with(Option::is_some).then(|| problems_ref.clone())
                    on:change=move |ev| {
                        let input: web_sys::HtmlInputElement = event_target(&ev);
                        file.set(input.files().and_then(|files| files.get(0)));
                        import_error.set(None);
                    }
                />
                <span class="field__hint">{IMPORT_HINT}</span>
            </div>
            {move || {
                import_error.get().map(|e| view! { <ImportProblems id=problems_id.clone() error=e/> })
            }}
            <div class="form__actions">
                <button
                    type="button"
                    class="btn"
                    disabled=move || file.with(Option::is_none) || card.busy.get()
                    on:click=import_file
                >
                    "Import layout file"
                </button>
                // Spec 039 FR-001: the layout editor, on a new layout.
                <AppLink class="btn" href=new_layout_href(&venue_id)>"New layout"</AppLink>
                {move || (!adding_open.get()).then(|| view! {
                    <button
                        type="button"
                        class="btn"
                        on:click=move |_| {
                            add_error.set(None);
                            adding.set(Some(LinesDraft::new_layout()));
                        }
                    >
                        "New layout from section lines"
                    </button>
                })}
            </div>
            {move || adding_open.get().then(|| view! {
                <LinesForm
                    label=lines_form_label(None)
                    draft=adding_draft
                    on_name=on_adding_name
                    on_edit=on_adding_lines
                    error=add_error
                    busy=card.busy
                    on_save=on_adding_save
                    on_cancel=on_adding_cancel
                />
            })}
        </section>
    }
}

/// `ImportProblems`: the import's problems under the file input, each with its place in the file.
#[component]
fn ImportProblems(id: String, error: ImportError) -> impl IntoView {
    let shown = import_problems(&error);
    view! {
        <div id=id role="alert" class="banner banner--error">
            <div class="banner__body">
                <strong>{shown.title}</strong>
                <p>{shown.message}</p>
                {(!shown.problems.is_empty()).then(|| view! {
                    <ul>{shown.problems.into_iter().map(|p| view! { <li>{p}</li> }).collect_view()}</ul>
                })}
                {(!shown.fields.is_empty()).then(|| view! {
                    <ul>{shown.fields.into_iter().map(|f| view! { <li>{f}</li> }).collect_view()}</ul>
                })}
            </div>
        </div>
    }
}

/// `LayoutItem`: one layout, its counts, lock, preview, and its own controls and refusals.
#[component]
fn LayoutItem(card: Card, id: String) -> impl IntoView {
    let heading_id = use_id();
    let name_id = use_id();
    let error: RwSignal<Option<ApiError>> = RwSignal::new(None);
    let renaming: RwSignal<Option<String>> = RwSignal::new(None);
    let editing: RwSignal<Option<LinesDraft>> = RwSignal::new(None);
    let layout_id = StoredValue::new(id.clone());

    let item_id = id.clone();
    let name = Memo::new(move |_| {
        card.summary(&item_id)
            .map(|s| s.name.to_string())
            .unwrap_or_default()
    });
    let item_id = id.clone();
    let line = Memo::new(move |_| {
        card.summary(&item_id)
            .map(|s| summary_line(&s))
            .unwrap_or_default()
    });
    let item_id = id.clone();
    let locked = Memo::new(move |_| card.summary(&item_id).is_some_and(|s| s.locked));
    let item_id = id.clone();
    let link: Memo<Option<EditorLink>> =
        Memo::new(move |_| card.summary(&item_id).map(|s| editor_link(&s)));
    let item_id = id.clone();
    let preview: Memo<Option<PreviewLayout>> = Memo::new(move |_| {
        card.details
            .with(|d| d.get(&item_id).map(PreviewLayout::from))
    });
    let item_id = id.clone();
    let lines_offered = Memo::new(move |_| {
        let loaded = card.details.with(|d| d.contains_key(&item_id));
        card.summary(&item_id)
            .is_some_and(|s| takes_lines(&s, loaded))
    });
    let renaming_open = Memo::new(move |_| renaming.with(Option::is_some));
    let editing_open = Memo::new(move |_| editing.with(Option::is_some));

    /// `act`: clears the item's refusal, then runs the write; `then` follows a success.
    fn act(
        card: Card,
        error: RwSignal<Option<ApiError>>,
        action: impl Future<Output = Result<(), ApiError>> + 'static,
        then: impl FnOnce() + 'static,
    ) {
        error.set(None);
        spawn_local(async move {
            match card.run(action).await {
                Some(Ok(())) => then(),
                Some(Err(e)) => error.set(Some(e)),
                None => {}
            }
        });
    }

    let rename = move |ev: SubmitEvent| {
        ev.prevent_default();
        let to = renaming.get_untracked().unwrap_or_default();
        let api = card.auth.api();
        let id = layout_id.get_value();
        act(
            card,
            error,
            async move {
                api.update_venue_layout(&id, &rename_body(&to))
                    .await
                    .map(|_| ())
            },
            move || renaming.set(None),
        );
    };
    let duplicate = move |_| {
        let api = card.auth.api();
        let id = layout_id.get_value();
        act(
            card,
            error,
            async move {
                api.duplicate_venue_layout(&id, &duplicate_body())
                    .await
                    .map(|_| ())
            },
            || {},
        );
    };
    let remove = move |_| {
        let confirmed = window()
            .confirm_with_message(&delete_confirm(&name.get_untracked()))
            .unwrap_or(false);
        if !confirmed {
            return;
        }
        let api = card.auth.api();
        let id = layout_id.get_value();
        act(
            card,
            error,
            async move { api.delete_venue_layout(&id).await },
            || {},
        );
    };

    let editing_draft =
        Signal::derive(move || editing.get().unwrap_or_else(LinesDraft::new_layout));
    let on_editing_name = Callback::new(move |name: String| {
        editing.update(|d| {
            if let Some(d) = d {
                d.set_name(&name);
            }
        })
    });
    let on_editing_lines = Callback::new(move |edit: LinesEdit| {
        editing.update(|d| {
            if let Some(d) = d {
                edit.apply(d);
            }
        })
    });
    let on_editing_save = Callback::new(move |()| {
        let Some(draft) = editing.get_untracked() else {
            return;
        };
        let api = card.auth.api();
        let id = layout_id.get_value();
        act(
            card,
            error,
            async move {
                api.update_venue_layout(&id, &draft.to_lines_input())
                    .await
                    .map(|_| ())
            },
            move || editing.set(None),
        );
    });
    let on_editing_cancel = Callback::new(move |()| editing.set(None));

    let labelled_by = heading_id.clone();
    view! {
        <article class="layout-item" aria-labelledby=labelled_by>
            <h3 id=heading_id>{move || name.get()}</h3>
            <p>{move || line.get()}</p>
            {move || locked.get().then(|| view! { <p class="note">{LOCKED_NOTE}</p> })}
            {move || match preview.get() {
                Some(layout) => view! { <LayoutPreview layout/> }.into_any(),
                None => view! { <p class="loading">{LOADING_PREVIEW}</p> }.into_any(),
            }}

            {move || renaming_open.get().then(|| view! {
                <form class="form" on:submit=rename>
                    <div class="field">
                        <label for=name_id.clone()>{move || format!("New name for {}", name.get())}</label>
                        <input
                            id=name_id.clone()
                            prop:value=move || renaming.get().unwrap_or_default()
                            maxlength=NAME_MAX_LENGTH.to_string()
                            on:input=move |ev| renaming.set(Some(event_target_value(&ev)))
                        />
                    </div>
                    <div class="form__actions">
                        <button type="submit" class="btn btn--primary" disabled=move || card.busy.get()>
                            "Save name"
                        </button>
                        <button type="button" class="btn" on:click=move |_| renaming.set(None)>
                            "Cancel"
                        </button>
                    </div>
                </form>
            })}

            <div class="form__actions">
                // Spec 039 FR-001, FR-002: the layout editor; read-only with Duplicate to edit if locked.
                {move || link.get().map(|l| view! {
                    <a class="btn" href=l.href aria-label=l.label>{l.text}</a>
                })}
                <button
                    type="button"
                    class="btn"
                    aria-label=move || format!("Rename {}", name.get())
                    on:click=move |_| {
                        error.set(None);
                        renaming.set(Some(name.get_untracked()));
                    }
                >
                    "Rename"
                </button>
                {move || lines_offered.get().then(|| view! {
                    <button
                        type="button"
                        class="btn"
                        aria-label=move || format!("Edit section lines of {}", name.get())
                        on:click=move |_| {
                            error.set(None);
                            let id = layout_id.get_value();
                            let draft = card.details.with_untracked(|d| d.get(&id).map(draft_of));
                            editing.set(draft);
                        }
                    >
                        "Edit section lines"
                    </button>
                })}
                <button
                    type="button"
                    class="btn"
                    aria-label=move || format!("Duplicate {}", name.get())
                    disabled=move || card.busy.get()
                    on:click=duplicate
                >
                    "Duplicate"
                </button>
                <button
                    type="button"
                    class="btn"
                    aria-label=move || format!("Delete {}", name.get())
                    disabled=move || card.busy.get()
                    on:click=remove
                >
                    "Delete"
                </button>
            </div>
            {move || {
                if editing_open.get() {
                    return None;
                }
                error.get().map(|e| view! { <ErrorBanner error=e title=change_title(&name.get_untracked())/> })
            }}

            {move || editing_open.get().then(|| view! {
                <LinesForm
                    label=lines_form_label(Some(&name.get_untracked()))
                    draft=editing_draft
                    on_name=on_editing_name
                    on_edit=on_editing_lines
                    error=error
                    busy=card.busy
                    on_save=on_editing_save
                    on_cancel=on_editing_cancel
                />
            })}
        </article>
    }
}

/// `LinesForm`: a layout's name, levels and section lines, with Save layout and its refusal.
#[component]
fn LinesForm(
    label: String,
    draft: Signal<LinesDraft>,
    on_name: Callback<String>,
    on_edit: Callback<LinesEdit>,
    error: RwSignal<Option<ApiError>>,
    busy: RwSignal<bool>,
    on_save: Callback<()>,
    on_cancel: Callback<()>,
) -> impl IntoView {
    let name_id = use_id();
    view! {
        <form
            class="form"
            aria-label=label
            on:submit=move |ev: SubmitEvent| {
                ev.prevent_default();
                on_save.run(());
            }
        >
            <div class="field">
                <label for=name_id.clone()>"Layout name"</label>
                <input
                    id=name_id
                    prop:value=move || draft.with(|d| d.name.clone())
                    maxlength=NAME_MAX_LENGTH.to_string()
                    on:input=move |ev| on_name.run(event_target_value(&ev))
                />
            </div>
            <SectionLines draft=draft on_edit=on_edit/>
            <p class="note">{move || total_text(draft.with(LinesDraft::total_seats))}</p>
            {move || error.get().map(|e| view! { <ErrorBanner error=e title=SAVE_LAYOUT_TITLE/> })}
            <div class="form__actions">
                <button type="submit" class="btn btn--primary" disabled=move || busy.get()>
                    {move || if busy.get() { "Saving…" } else { "Save layout" }}
                </button>
                <button type="button" class="btn" on:click=move |_| on_cancel.run(())>
                    "Cancel"
                </button>
            </div>
        </form>
    }
}
