//! Spec 037 (#163): the Rust Admin app, a Leptos client-side app (research R1, R2).

mod config;

use leptos::prelude::*;

fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(|| view! { <p class="muted">"Signing in…"</p> });
}
