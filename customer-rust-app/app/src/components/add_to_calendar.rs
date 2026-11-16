//! Parity T5–T7 (`customer-app/src/components/AddToCalendar.tsx`; spec 019 FR-001, FR-003,
//! FR-008 to FR-011, FR-013, FR-014): the "Add to calendar" group on an eligible order card. The
//! file is made on the device at the click from what My tickets already loaded (`core::calendar`),
//! saved through a `Blob` and a temporary `<a download>` revoked after 60 s; nothing is requested.

use customer_rust_core::api::types::MyOrder;
use customer_rust_core::calendar::{
    CALENDAR_NOTE, ICS_TYPE, calendar_entry, google_calendar_url, ics_file, ics_file_name,
};
use leptos::prelude::*;

use crate::{download, util::now_ms};

#[component]
pub fn AddToCalendar(order: MyOrder) -> impl IntoView {
    let event = order.event.clone();
    let label_id = format!("calendar-label-{}", order.id);
    let note_id = format!("calendar-note-{}", order.id);
    let labelled_by = label_id.clone();
    let (note_for_button, note_for_link) = (note_id.clone(), note_id.clone());
    let name = event.name.clone();
    let google = google_calendar_url(&calendar_entry(&event)).unwrap_or_default();
    let save = move |_| {
        if let Ok(text) = ics_file(&calendar_entry(&event), now_ms()) {
            let _ = download::save(text.as_bytes(), &ics_file_name(&event.name), ICS_TYPE);
        }
    };
    view! {
        <div role="group" aria-labelledby=labelled_by class="calendar-actions">
            <span id=label_id class="calendar-actions__label">
                "Add to calendar"
            </span>
            <p id=note_id class="calendar-actions__note">
                {CALENDAR_NOTE}
            </p>
            <div class="calendar-actions__controls">
                <button
                    type="button"
                    class="btn btn--ghost"
                    aria-label=format!(
                        "Add to Apple Calendar or Outlook: {name}, downloads a calendar file",
                    )
                    aria-describedby=note_for_button
                    on:click=save
                >
                    "Add to Apple Calendar or Outlook"
                </button>
                <a
                    href=google
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn btn--ghost"
                    aria-label=format!("Add to Google Calendar: {name}, opens in a new tab")
                    aria-describedby=note_for_link
                >
                    "Add to Google Calendar"
                </a>
            </div>
        </div>
    }
}
