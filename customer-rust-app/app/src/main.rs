//! Spec 040 (#175): the Rust Customer app, a Leptos client-side app compiled to WebAssembly
//! (research R1), beside the React Customer app, in the Customer realm through its own client,
//! and in the Rust Admin app's red.

mod auth;
mod components;
mod config;
mod device_zone;
mod download;
mod load;
mod oidc_glue;
mod pages;
mod routes;
mod seat_stream;
mod shell;
mod util;
mod venue_map;

use customer_rust_core::auth::AuthStatus;
use leptos::prelude::*;

use crate::{auth::Auth, components::WrongRole, routes::AppRoutes};

/// Spec 001: sign in before anything renders; only customers get in (`main.tsx`,
/// `RequireRole`, parity S1, S7).
#[component]
fn App() -> impl IntoView {
    let auth = Auth::provide();
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
