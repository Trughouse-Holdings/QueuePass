//! Spec 039 (FR-001–FR-005, FR-019; research R13, R14; parity LE1–LE11, LE67–LE81), port of
//! `admin-app/src/layout-editor/LayoutEditor.tsx`: the layout editor, full page. It reads the
//! whole layout (`getLayoutDrawing`) or starts a new one, and holds it in one document until Save
//! sends it whole. A toolbar (name, Undo, Redo, Save), the map, and a side column of panels; a
//! polite status line announces every change (FR-027). A locked layout and a phone-width screen
//! are read-only (FR-002, FR-004). Leaving with unsaved changes asks first (`guard.rs`, R15).

use std::{
    collections::BTreeSet,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use admin_rust_core::{
    api::client::{ApiError, StatusError},
    editor::{
        doc::{EditorDoc, FloorKind, Place, empty_doc, from_drawing, map_size, to_input},
        save::{CANT_REACH, save_as_new_input},
        state::{Action, FLOOR_NAMES},
        view::{
            COULD_NOT_DUPLICATE, COULD_NOT_OPEN, LOADING, LayoutMeta, NEEDS_WIDER, editor_title,
            locked_note, meta_of, undo_key,
        },
    },
    seating::{
        geometry::LAYOUT_LIMITS,
        map_geometry::centroid,
        map_state,
        venue_map::{PreviewLayout, PreviewSection, PreviewSize},
    },
};
use leptos::{ev, prelude::*, task::spawn_local};
use leptos_router::{
    NavigateOptions,
    hooks::{use_location, use_navigate, use_params_map},
};
use serde_json::{Value, json};
use wasm_bindgen::JsValue;

use super::{
    Editor, bind_value, canvas::EditorCanvas, in_text_box, levels_panel::LevelsPanel, new_id,
    save_bar::SaveBar, sections_panel::SectionsPanel, selection_panel::SelectionPanel,
};
use crate::{
    auth::{Auth, use_auth},
    components::{AppLink, ErrorBanner},
    guard::{Guard, use_guard},
};

/// The theme's phone breakpoint: the editor is read-only at or under it.
const PHONE: &str = "(max-width: 640px)";

/// `asApiError`: any failure as a Backend refusal, so it can be shown.
fn as_api_error(e: ApiError) -> ApiError {
    match e {
        ApiError::Status(_) => e,
        _ => ApiError::Status(StatusError {
            status: 0,
            code: "VALIDATION_FAILED".into(),
            message: CANT_REACH.into(),
            details: None,
            enveloped: true,
        }),
    }
}

fn as_value<T: serde::Serialize>(d: &T) -> Value {
    serde_json::to_value(d).unwrap_or(Value::Null)
}

/// The route's element: one editor per layout, started afresh when the layout changes (LE1).
#[component]
pub fn LayoutEditorPage() -> impl IntoView {
    let params = use_params_map();
    let layout_id = Memo::new(move |_| params.with(|p| p.get("layoutId")));
    move || {
        let layout_id = layout_id.get();
        let venue_id = params.with_untracked(|p| p.get("id").unwrap_or_default());
        view! { <LayoutEditor venue_id=venue_id layout_id=layout_id/> }
    }
}

/// The router's `navigate`, kept for the save and duplicate that open another layout.
type Navigate = Rc<dyn Fn(&str, NavigateOptions)>;

/// What the editor page needs to save, reload, and open layouts; `Copy`, for the save bar.
#[derive(Clone, Copy)]
pub struct PageCtx {
    auth: Auth,
    guard: Guard,
    pub ed: Editor,
    venue_id: StoredValue<String>,
    pub layout_id: StoredValue<Option<String>>,
    meta: RwSignal<LayoutMeta>,
    /// Review S1: saved, but not read back, so Save waits for Reload.
    pub unread: RwSignal<bool>,
    /// Sections drawn with a warning outline (overlaps, R15).
    pub warned: RwSignal<BTreeSet<String>>,
    navigate: StoredValue<Navigate, LocalStorage>,
}

impl PageCtx {
    fn edit_path(&self, id: &str) -> String {
        format!(
            "/locations/{}/layouts/{id}/edit",
            self.venue_id.try_get_value().unwrap_or_default()
        )
    }

    /// Opens another layout: not leaving unsaved work, which has just been kept or given up.
    fn open_layout(&self, id: &str, options: NavigateOptions) {
        let to = self.edit_path(id);
        let Some(nav) = self.navigate.try_get_value() else {
            return;
        };
        self.guard.pass_next();
        self.guard.navigate(&|p: &str, o| nav(p, o), &to, options);
    }

    /// Saves the document whole (R3), then reads it back for the ids and revision it now has.
    pub async fn save(self) -> Result<(), ApiError> {
        let sent = self.ed.doc_now();
        let api = self.auth.api();
        let layout_id = self.layout_id.get_value();
        let venue_id = self.venue_id.get_value();
        let revision = self.meta.with_untracked(|m| m.revision);
        self.ed.set_saving(true);
        let result = async {
            if let Some(lid) = layout_id {
                api.save_layout_drawing(&lid, &to_input(&sent, revision, false))
                    .await?;
                match api.get_layout_drawing(&lid).await {
                    Ok(d) => {
                        let v = as_value(&d);
                        self.ed.dispatch(Action::Saved {
                            sent: sent.clone(),
                            doc: Some(from_drawing(&v)),
                        });
                        self.meta.set(meta_of(&v));
                    }
                    Err(_) => {
                        // Saved, but not read back: what was new has no id here and the
                        // revision is unknown, so Save waits for a Reload.
                        self.ed.dispatch(Action::Saved {
                            sent: sent.clone(),
                            doc: None,
                        });
                        self.unread.set(true);
                    }
                }
                return Ok(());
            }
            let made = api
                .create_layout_drawing(&venue_id, &to_input(&sent, None, false))
                .await?;
            self.ed.dispatch(Action::Saved {
                sent: sent.clone(),
                doc: None,
            });
            // Saved: the move to the new layout's route is not leaving unsaved work.
            self.open_layout(
                &made.id.to_string(),
                NavigateOptions {
                    replace: true,
                    state: leptos_router::location::State::new(Some(saved_state())),
                    ..NavigateOptions::default()
                },
            );
            Ok(())
        }
        .await;
        self.ed.set_saving(false);
        result
    }

    /// FR-023, FR-024: the work saved as a new layout at the venue, then opened.
    pub async fn save_as_new(self, name: String) -> Result<(), ApiError> {
        let body = save_as_new_input(&self.ed.doc_now(), &name);
        let venue_id = self.venue_id.get_value();
        let made = self
            .auth
            .api()
            .create_layout_drawing(&venue_id, &body)
            .await?;
        self.open_layout(&made.id.to_string(), NavigateOptions::default());
        Ok(())
    }

    /// FR-024: the layout as it is now, the changes thrown away.
    pub async fn reload(self) -> Result<(), ApiError> {
        let Some(lid) = self.layout_id.get_value() else {
            return Ok(());
        };
        let d = self.auth.api().get_layout_drawing(&lid).await?;
        let v = as_value(&d);
        self.ed.dispatch(Action::Load {
            doc: from_drawing(&v),
        });
        self.meta.set(meta_of(&v));
        self.warned.set(BTreeSet::new());
        self.unread.set(false);
        Ok(())
    }
}

/// The history state a new layout's first save opens its edit route with (review B4).
fn saved_state() -> JsValue {
    js_sys::JSON::parse(&json!({ "saved": true }).to_string()).unwrap_or(JsValue::NULL)
}

/// Whether the page was opened by a new layout's first save.
fn just_created() -> bool {
    use_location().state.with_untracked(|s| {
        js_sys::Reflect::get(&s.to_js_value(), &JsValue::from_str("saved"))
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    })
}

/// The phone-width check, followed live (`use-media.ts`).
fn use_phone() -> RwSignal<bool> {
    let read = || {
        window()
            .match_media(PHONE)
            .ok()
            .flatten()
            .is_some_and(|m| m.matches())
    };
    let narrow = RwSignal::new(read());
    let handle = window_event_listener(ev::resize, move |_| {
        let now = read();
        if narrow.get_untracked() != now {
            narrow.set(now);
        }
    });
    on_cleanup(move || handle.remove());
    narrow
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Loading,
    Failed,
    Narrow,
    Locked,
    Edit,
}

/// Spec 039: the editor of one layout (`layout_id`) or of a new one.
#[component]
fn LayoutEditor(venue_id: String, layout_id: Option<String>) -> impl IntoView {
    let auth = use_auth();
    let guard = use_guard();
    let navigate = use_navigate();
    let initially_saved = just_created();
    let ed = Editor::new(empty_doc());
    provide_context(ed);
    let loading = RwSignal::new(layout_id.is_some());
    let load_error: RwSignal<Option<ApiError>> = RwSignal::new(None);
    let meta = RwSignal::new(LayoutMeta::default());
    let name_problem: RwSignal<Option<String>> = RwSignal::new(None);
    let duplicate_error: RwSignal<Option<ApiError>> = RwSignal::new(None);
    let narrow = use_phone();
    let center: StoredValue<Place> = StoredValue::new([150.0, 100.0]);
    let ctx = PageCtx {
        auth,
        guard,
        ed,
        venue_id: StoredValue::new(venue_id.clone()),
        layout_id: StoredValue::new(layout_id.clone()),
        meta,
        unread: RwSignal::new(false),
        warned: RwSignal::new(BTreeSet::new()),
        navigate: StoredValue::new_local(Rc::new(navigate) as Navigate),
    };

    // R15 (LE4): leaving with unsaved changes asks first, by any link, Back or Forward; a reload
    // or a closed tab, through the browser's own question.
    Effect::new(move |_| guard.set_dirty(ed.dirty.get()));
    on_cleanup(move || guard.set_dirty(false));

    let live = Arc::new(AtomicBool::new(true));
    {
        let live = live.clone();
        on_cleanup(move || live.store(false, Ordering::Relaxed));
    }
    if let Some(lid) = layout_id.clone() {
        let live = live.clone();
        spawn_local(async move {
            let result = auth.api().get_layout_drawing(&lid).await;
            if !live.load(Ordering::Relaxed) {
                return;
            }
            match result {
                Ok(d) => {
                    let v = as_value(&d);
                    ed.dispatch(Action::Load {
                        doc: from_drawing(&v),
                    });
                    meta.set(meta_of(&v));
                }
                Err(e) => load_error.set(Some(as_api_error(e))),
            }
            loading.set(false);
        });
    }

    let existing = layout_id.is_some();
    let title = Memo::new(move |_| {
        let locked = meta.with(|m| m.locked);
        ed.with_state(|s| {
            editor_title(
                existing,
                locked,
                &admin_rust_core::editor::state::current_doc(s).name,
                &s.saved.name,
            )
        })
    });
    let mode = Memo::new(move |_| {
        if loading.get() {
            Mode::Loading
        } else if load_error.with(Option::is_some) {
            Mode::Failed
        } else if narrow.get() {
            Mode::Narrow
        } else if meta.with(|m| m.locked) {
            Mode::Locked
        } else {
            Mode::Edit
        }
    });
    let venue_path = format!("/locations/{venue_id}");

    let duplicate_to_edit = move || {
        let Some(lid) = ctx.layout_id.get_value() else {
            return;
        };
        duplicate_error.set(None);
        spawn_local(async move {
            match auth.api().duplicate_venue_layout(&lid, &json!({})).await {
                Ok(copy) => ctx.open_layout(&copy.id.to_string(), NavigateOptions::default()),
                Err(e) => duplicate_error.set(Some(as_api_error(e))),
            }
        });
    };

    move || {
        let back = {
            let href = venue_path.clone();
            move || {
                view! { <AppLink href=href.clone() class="tap">"Back to the venue"</AppLink> }
                    .into_any()
            }
        };
        match mode.get() {
            Mode::Loading => view! { <p class="loading">{LOADING}</p> }.into_any(),
            Mode::Failed => {
                let error = load_error.get_untracked().unwrap_or(ApiError::Unreachable);
                view! {
                    <div class="layout-editor">
                        <ErrorBanner error=error title=COULD_NOT_OPEN/>
                        <AppLink href=venue_path.clone()>"Back to the venue"</AppLink>
                    </div>
                }
                .into_any()
            }
            Mode::Narrow => view! {
                <div class="layout-editor">
                    <h1 class="page-title">{move || title.get()}</h1>
                    <PhonePreview/>
                    <p class="note">{NEEDS_WIDER}</p>
                    {back()}
                </div>
            }
            .into_any(),
            Mode::Locked => view! {
                <div class="layout-editor">
                    <div class="layout-editor__head">
                        <h1 class="page-title">{move || title.get()}</h1>
                        {back()}
                    </div>
                    <p class="note">
                        {move || meta.with(|m| {
                            locked_note(&m.locked_by.iter().map(|e| e.name.clone()).collect::<Vec<_>>())
                        })}
                    </p>
                    <div class="form__actions">
                        <button type="button" class="btn btn--primary" on:click=move |_| duplicate_to_edit()>
                            "Duplicate to edit"
                        </button>
                    </div>
                    {move || duplicate_error.get().map(|e| view! {
                        <ErrorBanner error=e title=COULD_NOT_DUPLICATE/>
                    })}
                    <div class="layout-editor__body">
                        <EditorCanvas read_only=true/>
                        <div class="layout-editor__side">
                            <LevelsPanel read_only=true/>
                        </div>
                    </div>
                </div>
            }
            .into_any(),
            Mode::Edit => view! {
                <EditMode ctx=ctx title=title name_problem=name_problem center=center initially_saved=initially_saved back=back()/>
            }
            .into_any(),
        }
    }
}

/// Edit mode (LE7, LE8): head, toolbar, status line, then the map and the side column.
#[component]
fn EditMode(
    ctx: PageCtx,
    title: Memo<String>,
    name_problem: RwSignal<Option<String>>,
    center: StoredValue<Place>,
    initially_saved: bool,
    back: AnyView,
) -> impl IntoView {
    let ed = ctx.ed;
    let name_id = new_id();
    let name_problem_id = new_id();
    let npid = name_problem_id.clone();
    let name_input = NodeRef::new();
    bind_value(name_input, move || ed.doc.with(|d| d.name.clone()));
    // FR-014, R11: Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z and Ctrl+Y redo; a text box keeps its own.
    let on_key_down = move |e: ev::KeyboardEvent| {
        if let Some(a) = undo_key(
            &e.key(),
            e.meta_key(),
            e.ctrl_key(),
            e.shift_key(),
            in_text_box(&e),
        ) {
            e.prevent_default();
            ed.dispatch(a);
        }
    };
    view! {
        // The key handler only hears keys of the controls inside; it adds no control of its own.
        <div class="layout-editor" on:keydown=on_key_down>
            <div class="layout-editor__head">
                <h1 class="page-title">{move || title.get()}</h1>
                {back}
            </div>
            <div class="layout-editor__toolbar">
                <div class="field layout-editor__name">
                    <label for=name_id.clone()>"Layout name"</label>
                    <input
                        node_ref=name_input
                        id=name_id
                        maxlength=LAYOUT_LIMITS.name_max_length.to_string()
                        aria-describedby=move || name_problem.with(Option::is_some).then(|| npid.clone())
                        aria-invalid=move || name_problem.with(Option::is_some).then_some("true")
                        on:input=move |e| {
                            name_problem.set(None);
                            ed.dispatch(Action::Rename { name: event_target_value(&e) });
                        }
                    />
                    {move || name_problem.get().map(|p| view! {
                        <span id=name_problem_id.clone() class="editor-field-error">{p}</span>
                    })}
                </div>
                <button
                    type="button"
                    class="btn"
                    disabled=move || ed.with_state(|s| s.cursor == 0)
                    on:click=move |_| ed.dispatch(Action::Undo)
                >
                    "Undo"
                </button>
                <button
                    type="button"
                    class="btn"
                    disabled=move || ed.with_state(|s| s.cursor + 1 == s.history.len())
                    on:click=move |_| ed.dispatch(Action::Redo)
                >
                    "Redo"
                </button>
                <SaveBar ctx=ctx name_problem=name_problem initially_saved=initially_saved/>
            </div>
            <p role="status" aria-live="polite" class="layout-editor__status">
                {move || ed.with_state(|s| s.message.clone())}
            </p>
            <div class="layout-editor__body">
                <EditorCanvas read_only=false warned=ctx.warned center=center/>
                <div class="layout-editor__side">
                    <FloorField center=center/>
                    <SectionsPanel center=center/>
                    <SelectionPanel/>
                    // After the sections, in the order of the steps (Guide): sections, then levels.
                    <LevelsPanel/>
                </div>
            </div>
        </div>
    }
}

/// FR-005 (LE30): the floor object: court, end stage, center stage, ring, or none.
#[component]
fn FloorField(center: StoredValue<Place>) -> impl IntoView {
    let ed = super::use_editor();
    let id = new_id();
    let kind = Memo::new(move |_| ed.doc.with(|d| d.floor.kind));
    view! {
        <div class="field">
            <label for=id.clone()>"Floor object"</label>
            <select
                id=id
                on:change=move |e| {
                    if let Some(kind) = FloorKind::parse(&event_target_value(&e)) {
                        ed.dispatch(Action::SetFloor { kind, at: center.get_value() });
                    }
                }
            >
                {FLOOR_NAMES.iter().map(|(k, name)| {
                    let k = *k;
                    view! {
                        <option value=k.as_str() prop:selected=move || kind.get() == k>{*name}</option>
                    }
                }).collect_view()}
            </select>
        </div>
    }
}

/// The layout as the shared preview draws it (`previewOf`).
fn preview_of(doc: &EditorDoc) -> PreviewLayout {
    let size = map_size(doc);
    PreviewLayout {
        name: if doc.name.is_empty() {
            "New layout".into()
        } else {
            doc.name.clone()
        },
        size: PreviewSize {
            width: size.width,
            height: size.height,
        },
        floor_kind: match doc.floor.kind {
            FloorKind::None => map_state::FloorKind::None,
            FloorKind::Court => map_state::FloorKind::Court,
            FloorKind::EndStage => map_state::FloorKind::EndStage,
            FloorKind::CenterStage => map_state::FloorKind::CenterStage,
            FloorKind::Ring => map_state::FloorKind::Ring,
        },
        floor_outline: doc.floor.outline.clone(),
        sections: doc
            .sections
            .iter()
            .map(|s| PreviewSection {
                id: s.id.clone(),
                name: s.name.clone(),
                outline: s.outline.clone(),
                label_at: centroid(&s.outline),
            })
            .collect(),
    }
}

/// LE9: the shared `LayoutPreview` (`layout-preview.tsx`) of the document, at phone width. The
/// lead folds this into the shared Leptos preview.
#[component]
fn PhonePreview() -> impl IntoView {
    let ed = super::use_editor();
    // The shared preview (LE9), redrawn as the document changes.
    move || {
        let layout = ed.doc.with(|d| preview_of(d));
        view! { <crate::venue_map::LayoutPreview layout=layout/> }
    }
}
