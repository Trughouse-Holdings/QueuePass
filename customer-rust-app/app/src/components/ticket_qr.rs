//! Parity T12 (`customer-app/src/components/TicketQr.tsx`; spec 017 FR-012, 018 R8): a code's QR
//! as one SVG path of the dark modules with a 4-module quiet zone, the same modules as the React
//! app's (`core::qr`). Colored by the theme's `--qr-dark` and `--qr-light` through `styles.css`.

use customer_rust_core::qr::{qr_matrix, qr_path, qr_size};
use leptos::prelude::*;

/// `<svg class="ticket-qr …" role="img">`. Its name is "QR code for ticket {code}" unless `label`
/// says otherwise; `class` is added after `ticket-qr` (the live one's `ticket-qr--live`).
#[component]
pub fn TicketQr(
    #[prop(into)] code: String,
    #[prop(optional, into)] label: Option<String>,
    #[prop(optional, into)] class: Option<String>,
) -> impl IntoView {
    let matrix = qr_matrix(&code).unwrap_or_default();
    let size = qr_size(&matrix);
    let path = qr_path(&matrix);
    let class = class.map_or_else(|| "ticket-qr".to_string(), |c| format!("ticket-qr {c}"));
    let label = label.unwrap_or_else(|| format!("QR code for ticket {code}"));
    let view_box = format!("0 0 {size} {size}");
    view! {
        <svg class=class viewBox=view_box role="img" aria-label=label>
            <rect class="ticket-qr__light" width=size height=size></rect>
            <path class="ticket-qr__dark" d=path></path>
        </svg>
    }
}
