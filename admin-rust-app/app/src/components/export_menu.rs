//! Spec 037 (task T069; parity A2, R1, X1–X5), port of `admin-app/src/export/ExportMenu.tsx`:
//! spec 023's Download menu. A native disclosure, so it opens by keyboard and is announced
//! without script; one file at a time, said while it is made, and a failure named by format.
//! The same elements and classes as the React menu, so the shared theme applies (research R8).

use std::{
    rc::Rc,
    sync::atomic::{AtomicUsize, Ordering},
};

use admin_rust_core::export::{
    csv::to_csv, file_name::ExportFormat, pdf::to_pdf, table::ExportTable, xlsx::to_xlsx,
};
use js_sys::{Function, Promise};
use leptos::{prelude::*, task::spawn_local};
use wasm_bindgen::{JsCast, closure::Closure};
use wasm_bindgen_futures::JsFuture;

use crate::download::save;

/// The three choices (FR-001): the format, the button, and the format's name in messages.
const FORMATS: [(ExportFormat, &str, &str); 3] = [
    (ExportFormat::Csv, "CSV", "CSV"),
    (ExportFormat::Xlsx, "Excel (XLSX)", "Excel file"),
    (ExportFormat::Pdf, "PDF", "PDF"),
];

/// The page's own data as a table, built at the click (FR-003).
pub type MakeTable = Rc<dyn Fn() -> ExportTable>;
/// The file's name for a format.
pub type FileName = Rc<dyn Fn(ExportFormat) -> String>;

/// The note's id, unique per menu (React's `useId`).
fn next_note_id() -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    format!("export-note-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

/// FR-014: lets the browser paint "Preparing…" before a writer runs; a large PDF is drawn in
/// one synchronous stretch (research R12 of spec 023).
async fn after_paint() {
    let promise = Promise::new(&mut |resolve: Function, _reject: Function| {
        let Some(window) = web_sys::window() else {
            let _ = resolve.call0(&wasm_bindgen::JsValue::UNDEFINED);
            return;
        };
        let timeout_window = window.clone();
        let after_frame = Closure::once_into_js(move || {
            if timeout_window
                .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, 0)
                .is_err()
            {
                let _ = resolve.call0(&wasm_bindgen::JsValue::UNDEFINED);
            }
        });
        let _ = window.request_animation_frame(after_frame.unchecked_ref());
    });
    let _ = JsFuture::from(promise).await;
}

/// The file's bytes in `format`.
fn write(format: ExportFormat, table: &ExportTable) -> Result<Vec<u8>, ()> {
    match format {
        ExportFormat::Csv => Ok(to_csv(table)),
        ExportFormat::Xlsx => to_xlsx(table).map_err(|_| ()),
        ExportFormat::Pdf => to_pdf(table).map_err(|_| ()),
    }
}

/// Spec 023 FR-001, FR-002, FR-011, FR-014, FR-015 (research R11 of 023).
#[component]
pub fn ExportMenu(
    /// The group's accessible name: "Download the attendee list".
    #[prop(into)]
    label: String,
    make_table: MakeTable,
    file_name: FileName,
    /// Shown with the choices and describing each (FR-011).
    #[prop(optional, into)]
    note: Option<String>,
) -> impl IntoView {
    let note_id = next_note_id();
    let busy = RwSignal::new(None::<&'static str>);
    let failed = RwSignal::new(None::<&'static str>);
    let make_table = StoredValue::new_local(make_table);
    let file_name = StoredValue::new_local(file_name);

    // Signals update at once, so `busy` alone blocks a second start (the React `running` ref).
    let download = move |format: ExportFormat, name: &'static str| {
        if busy.get_untracked().is_some() {
            return;
        }
        busy.set(Some(name));
        failed.set(None);
        let make_table = make_table.get_value();
        let file_name = file_name.get_value();
        spawn_local(async move {
            after_paint().await;
            let table = make_table();
            let saved = write(format, &table).and_then(|bytes| {
                save(&bytes, &file_name(format), format.media_type()).map_err(|_| ())
            });
            if saved.is_err() {
                failed.set(Some(name));
            }
            busy.set(None);
        });
    };

    let status = move || {
        busy.get()
            .map(|name| format!("Preparing the {name}…"))
            .unwrap_or_default()
    };
    let described_by = note.as_ref().map(|_| note_id.clone());
    let buttons = FORMATS
        .into_iter()
        .map(|(format, button, name)| {
            view! {
                <button
                    type="button"
                    class="btn btn--ghost"
                    disabled=move || busy.get().is_some()
                    aria-describedby=described_by.clone()
                    on:click=move |_| download(format, name)
                >
                    {button}
                </button>
            }
        })
        .collect_view();

    // Review round 1 of 023, finding 4: the status and the error sit outside the disclosure, so
    // closing it never hides them.
    view! {
        <div>
            <details>
                <summary class="btn">"Download " <span aria-hidden="true">"▾"</span></summary>
                <div role="group" aria-label=label class="form__actions">
                    {buttons}
                </div>
                {note.map(|note| view! { <p id=note_id class="note">{note}</p> })}
            </details>
            <p role="status" class="note">{status}</p>
            {move || failed.get().map(|name| view! {
                <p role="alert" class="banner banner--error">
                    {format!("Couldn't make the {name}. Try again.")}
                </p>
            })}
        </div>
    }
}
