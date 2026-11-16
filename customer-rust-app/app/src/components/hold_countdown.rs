//! Parity M11, C5 (`customer-app/src/components/HoldCountdown.tsx`, spec 033 FR-010, FR-015): a
//! reservation's countdown in large type, as a timer that is not announced each second
//! (`aria-live="off"`), with its own status region for the 1-minute warning, always present so the
//! warning is announced, and boxed (`note`) only while it has something to say. Shared by the
//! event page's Your seats box and each cart entry.

use customer_rust_core::reservation::clock;
use leptos::prelude::*;

#[component]
pub fn HoldCountdown(
    #[prop(into)] seconds_left: Signal<u64>,
    #[prop(into)] warning: Signal<Option<&'static str>>,
) -> impl IntoView {
    view! {
        <p role="timer" aria-live="off" class="hold-countdown">
            "Time left: "
            <span class="hold-countdown__time">{move || clock(seconds_left.get())}</span>
        </p>
        <p role="status" class=move || warning.get().map(|_| "note")>
            {move || warning.get()}
        </p>
    }
}
