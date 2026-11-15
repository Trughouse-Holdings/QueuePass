//! Spec 037 (#163): the Rust Admin app, a Leptos client-side app compiled to WebAssembly
//! (research R1, R2), beside the React Admin app, in its own realm and in red.

mod auth;
mod components;
mod config;
mod device_zone;
mod download;
mod guard;
mod oidc_glue;
mod pages;
mod routes;
mod shell;
mod util;
mod venue_map;

use admin_rust_core::auth::AuthStatus;
use leptos::prelude::*;

use crate::{auth::Auth, components::WrongRole, routes::AppRoutes};

/// Spec 001: sign in before anything renders; only QueuePass Admins get in (`main.tsx`,
/// `RequireRole`, parity S1, S4).
#[component]
fn App() -> impl IntoView {
    let auth = Auth::provide();
    guard::Guard::provide();
    // The machine is notified on every clock tick; the page changes only when the status does.
    let status = Memo::new(move |_| auth.status());
    move || match status.get() {
        AuthStatus::SignedIn => view! { <AppRoutes/> }.into_any(),
        AuthStatus::WrongRole => view! {
            <div class="app">
                <main class="main">
                    <WrongRole/>
                </main>
            </div>
        }
        .into_any(),
        _ => view! { <p>"Signing in…"</p> }.into_any(),
    }
}

fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(App);
}
